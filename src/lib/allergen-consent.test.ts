/**
 * Allergen consent (2026-10-13): the device rules, the mirror they drive,
 * and the copy contract. Server enforcement is pinned in
 * src/server/push/allergen-consent-migration.test.ts and the worker in
 * worker.test.ts; the RPC itself was run on an isolated stack.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { EMPTY_PREFERENCES, type UserRecallPreferences } from '@/domain/preferences';
import {
  ALLERGEN_CONSENT_VERSION,
  type AllergenConsentRecord,
  allergensAreOnlyAlertChoice,
  allergensForServer,
  CONSENT_DECLINE_LABEL,
  CONSENT_GRANT_LABEL,
  CONSENT_NOTIFICATIONS_NOTE,
  CONSENT_ONLY_CHOICE_NOTE,
  CONSENT_PARAGRAPHS,
  CONSENT_STATUS_GRANT_PENDING,
  CONSENT_STATUS_GRANTED,
  CONSENT_STATUS_NOT_GRANTED,
  CONSENT_STATUS_WITHDRAW_PENDING,
  CONSENT_TITLE,
  consentNewlyNeededBySave,
  consentStatusLine,
  nextDecisionTime,
  parseAllergenConsent,
  serializeAllergenConsent,
  serverAllergenConsent,
  shouldAskAllergenConsent,
} from './allergen-consent';
import { createPreferencePersistence, type PersistenceDeps } from './preference-persistence';
import { createSerialQueue } from './serial-queue';

const granted: AllergenConsentRecord = {
  decision: 'granted',
  version: ALLERGEN_CONSENT_VERSION,
  at: '2026-10-13T00:00:00Z',
};
const declined: AllergenConsentRecord = { ...granted, decision: 'declined' };
const withdrawn: AllergenConsentRecord = { ...granted, decision: 'withdrawn' };

test('only a grant under the current text is consent; everything else sends no allergens', () => {
  assert.equal(serverAllergenConsent(granted), ALLERGEN_CONSENT_VERSION);
  for (const record of [null, declined, withdrawn, { ...granted, version: 'allergens-v0' }]) {
    assert.equal(serverAllergenConsent(record), null);
    assert.deepEqual(allergensForServer(['peanut'], record), []);
  }
  assert.deepEqual(allergensForServer(['peanut', 'milk'], granted), ['peanut', 'milk']);
});

test('an unreadable or foreign stored record is no decision, never consent', () => {
  for (const raw of [
    null,
    '',
    '{',
    '{"decision":"granted"}',
    '{"decision":"yes","version":"x","at":"y"}',
  ]) {
    assert.equal(parseAllergenConsent(raw), null);
  }
  assert.deepEqual(parseAllergenConsent(serializeAllergenConsent(granted)), granted);
});

test('ask only with allergens chosen and no decision; a decline or withdrawal is never re-asked', () => {
  assert.equal(shouldAskAllergenConsent([], null), false);
  assert.equal(shouldAskAllergenConsent(['peanut'], null), true);
  assert.equal(shouldAskAllergenConsent(['peanut'], granted), false);
  assert.equal(shouldAskAllergenConsent(['peanut'], declined), false);
  assert.equal(shouldAskAllergenConsent(['peanut'], withdrawn), false);
  // A grant under an older text is asked again under the new one.
  assert.equal(shouldAskAllergenConsent(['peanut'], { ...granted, version: 'allergens-v0' }), true);
});

test('the only-choice note applies exactly when allergens are the only alert signal', () => {
  const base: UserRecallPreferences = { ...EMPTY_PREFERENCES, allergens: ['peanut'] };
  assert.equal(allergensAreOnlyAlertChoice(base), true);
  assert.equal(allergensAreOnlyAlertChoice({ ...base, states: ['CA'] }), false);
  assert.equal(allergensAreOnlyAlertChoice({ ...base, retailers: ['costco'] }), false);
  assert.equal(allergensAreOnlyAlertChoice(EMPTY_PREFERENCES), false);
});

// ── The mirror, driven by consent ──────────────────────────────────────────

function device(initial: UserRecallPreferences) {
  let consent: AllergenConsentRecord | null = null;
  let online = true;
  const world = {
    local: initial,
    dirty: false,
    sent: [] as { allergens: string[]; consent: string | null }[],
    server: null as { allergens: string[]; consent: string | null } | null,
  };
  const deps: PersistenceDeps = {
    enqueueLocal: createSerialQueue(),
    readLocal: async () => structuredClone(world.local),
    writeLocal: async (value) => {
      world.local = structuredClone(value);
    },
    isDirty: async () => world.dirty,
    setDirty: async (dirty) => {
      world.dirty = dirty;
    },
    // preferences-store.ts syncToServer, with the RPC as a fake server.
    syncRemote: async (prefs) => {
      if (!online) throw new Error('offline');
      const payload = {
        allergens: allergensForServer(prefs.allergens, consent),
        consent: serverAllergenConsent(consent),
      };
      world.sent.push(payload);
      // apply_installation_preferences: no consent, no allergens.
      world.server = {
        allergens: payload.consent ? payload.allergens : [],
        consent: payload.consent,
      };
    },
    mirrorKey: async () => serverAllergenConsent(consent) ?? 'none',
  };
  const store = createPreferencePersistence(deps);
  return {
    world,
    store,
    setConsent: (record: AllergenConsentRecord | null) => {
      consent = record;
    },
    setOnline: (value: boolean) => {
      online = value;
    },
  };
}

const PEANUT_CA: UserRecallPreferences = { states: ['CA'], allergens: ['peanut'], retailers: [] };

test('before any decision, saves mirror states and stores but no allergens', async () => {
  const { world, store } = device(EMPTY_PREFERENCES);
  await store.commit(PEANUT_CA);
  await store.mirrorIdle();
  assert.deepEqual(world.server, { allergens: [], consent: null });
});

test('granting consent with unchanged preferences is mirrored (touch), with the allergens', async () => {
  const { world, store, setConsent } = device(EMPTY_PREFERENCES);
  await store.commit(PEANUT_CA);
  await store.mirrorIdle();
  setConsent(granted);
  await store.touch();
  await store.mirrorIdle();
  assert.deepEqual(world.server, { allergens: ['peanut'], consent: ALLERGEN_CONSENT_VERSION });
  assert.equal(world.dirty, false);
});

test('online, a withdrawal removes the server copy and keeps the allergens on the device', async () => {
  const { world, store, setConsent } = device(EMPTY_PREFERENCES);
  setConsent(granted);
  await store.commit(PEANUT_CA);
  await store.mirrorIdle();
  assert.deepEqual(world.server?.allergens, ['peanut']);
  setConsent(withdrawn);
  await store.touch();
  await store.mirrorIdle();
  assert.deepEqual(world.server, { allergens: [], consent: null });
  assert.deepEqual(world.local.allergens, ['peanut'], 'on-device matching keeps them');
});

test('an offline consent change stays owed and the launch flush sends it', async () => {
  const { world, store, setConsent, setOnline } = device(EMPTY_PREFERENCES);
  setConsent(granted);
  await store.commit(PEANUT_CA);
  await store.mirrorIdle();
  setOnline(false);
  setConsent(withdrawn);
  await store.touch();
  await store.mirrorIdle();
  assert.equal(world.dirty, true, 'still owed');
  assert.deepEqual(world.server?.allergens, ['peanut'], 'the server has not heard yet');
  setOnline(true);
  await store.flush(); // the next launch
  await store.mirrorIdle();
  assert.deepEqual(world.server, { allergens: [], consent: null });
  assert.equal(world.dirty, false);
});

test('a retry of an already-mirrored consent sends nothing new', async () => {
  const { world, store, setConsent } = device(EMPTY_PREFERENCES);
  setConsent(granted);
  await store.commit(PEANUT_CA);
  await store.mirrorIdle();
  const sends = world.sent.length;
  await store.flush();
  await store.mirrorIdle();
  assert.equal(world.sent.length, sends);
});

// ── Copy contract ───────────────────────────────────────────────────────────

test('the consent copy states purpose, recipients, withdrawal and the decline consequence', () => {
  const text = [CONSENT_TITLE, ...CONSENT_PARAGRAPHS].join(' ');
  assert.match(text, /send you alerts for recalls that involve them/); // purpose
  assert.match(text, /Supabase/); // where
  assert.match(text, /Expo and Apple/); // who delivers
  assert.match(text, /never uses them for ads and never sells them/);
  assert.match(text, /turn this off at any time in Profile → Privacy & Data Controls/); // withdrawal
  assert.match(text, /still uses them here/); // on-device matching kept
  assert.match(text, /allergen-only recalls/); // the decline consequence
  assert.match(
    CONSENT_ONLY_CHOICE_NOTE,
    /won’t send you recall alerts unless you also choose states or stores/,
  );
  assert.match(CONSENT_STATUS_NOT_GRANTED, /stay on this iPhone/);
  assert.match(CONSENT_STATUS_GRANTED, /kept on Lotly’s server/);
  assert.match(CONSENT_NOTIFICATIONS_NOTE, /allergen-only recalls don’t send alerts/);
  for (const line of [CONSENT_TITLE, ...CONSENT_PARAGRAPHS, CONSENT_ONLY_CHOICE_NOTE]) {
    assert.doesNotMatch(line, /—/, 'house style: no em dash in product copy');
  }
});

test('the two choices are equal: same component and variant, neither pre-selected', () => {
  assert.equal(CONSENT_GRANT_LABEL, 'Use for alerts');
  assert.equal(CONSENT_DECLINE_LABEL, 'Keep on this iPhone only');
  const sheet = readFileSync(
    join(__dirname, '..', 'components', 'allergen-consent', 'allergen-consent-choice.tsx'),
    'utf8',
  );
  const buttons = sheet.match(/<Button\b[\s\S]*?\/>/g) ?? [];
  assert.equal(buttons.length, 2);
  for (const button of buttons) assert.match(button, /variant="secondary"/);
});

// ── Focused cases before the checkpoint (2026-10-13) ───────────────────────

test('Edit preferences asks only when a save ADDS an allergen with nothing decided', () => {
  // Newly needed: the save adds peanut, no decision.
  assert.equal(consentNewlyNeededBySave([], ['peanut'], null), true);
  // A later save that adds nothing (the sheet was closed earlier) never asks again.
  assert.equal(consentNewlyNeededBySave(['peanut'], ['peanut'], null), false);
  assert.equal(consentNewlyNeededBySave(['peanut', 'milk'], ['peanut'], null), false);
  // Existing consent is reused; a phone-only choice is respected.
  assert.equal(consentNewlyNeededBySave([], ['peanut'], granted), false);
  assert.equal(consentNewlyNeededBySave([], ['peanut'], declined), false);
  assert.equal(consentNewlyNeededBySave(['milk'], ['milk', 'peanut'], withdrawn), false);
});

test('decision times strictly increase, even when the clock moves backwards', () => {
  const earlier = new Date('2026-10-13T10:00:00.000Z');
  assert.equal(nextDecisionTime(null, earlier), '2026-10-13T10:00:00.000Z');
  const prior = { ...granted, at: '2026-10-13T12:00:00.000Z' };
  assert.equal(nextDecisionTime(prior, earlier), '2026-10-13T12:00:00.001Z');
  assert.equal(
    nextDecisionTime(prior, new Date('2026-10-13T13:00:00.000Z')),
    '2026-10-13T13:00:00.000Z',
  );
});

test('the status line never claims the server state before it confirms', () => {
  assert.equal(consentStatusLine(false, true), CONSENT_STATUS_WITHDRAW_PENDING);
  assert.match(CONSENT_STATUS_WITHDRAW_PENDING, /will finish when your iPhone is back online/);
  assert.doesNotMatch(CONSENT_STATUS_WITHDRAW_PENDING, /doesn’t have them/);
  assert.equal(consentStatusLine(true, true), CONSENT_STATUS_GRANT_PENDING);
  assert.equal(consentStatusLine(false, false), CONSENT_STATUS_NOT_GRANTED);
  assert.equal(consentStatusLine(true, false), CONSENT_STATUS_GRANTED);
  // No unconditional "right away" promise anywhere in the consent copy.
  for (const line of CONSENT_PARAGRAPHS) assert.doesNotMatch(line, /right away|immediately/);
  assert.match(CONSENT_PARAGRAPHS.join(' '), /as soon as your iPhone is online/);
});

test('offline withdrawal reports pending, then confirms after reconnecting', async () => {
  const { world, store, setConsent, setOnline } = device(EMPTY_PREFERENCES);
  setConsent(granted);
  await store.commit(PEANUT_CA);
  await store.mirrorIdle();
  setOnline(false);
  setConsent(withdrawn);
  assert.deepEqual(await store.touch(), { synced: false }, 'pending, not done');
  assert.equal(await store.mirrorOwed(), true);
  assert.deepEqual(world.server?.allergens, ['peanut'], 'the server still has them');
  setOnline(true);
  await store.flush(); // reconnect / next launch
  await store.mirrorIdle();
  assert.equal(await store.mirrorOwed(), false);
  assert.deepEqual(world.server, { allergens: [], consent: null });
});

// ── Decision ordering against a server that applies the migration's rule ──

type Body = { allergens: string[]; consent: string | null; decidedAt: string | null };

/**
 * A fake server with apply_installation_preferences' decision ordering
 * (20261014000000), refusal included. The rule itself is proven on real
 * Postgres (the handoff's ordering verification); this drives the CLIENT
 * against it.
 */
function orderedServer() {
  const row = {
    allergens: [] as string[],
    consent: null as string | null,
    decidedAt: null as string | null,
  };
  const ms = (iso: string) => Date.parse(iso);
  return {
    row,
    fail: null as Error | null,
    apply(body: Body) {
      if (this.fail) throw this.fail;
      let { consent, decidedAt } = body;
      let allergens = consent ? body.allergens : [];
      if (row.decidedAt !== null) {
        if (decidedAt === null) {
          ({ consent, decidedAt, allergens } = row);
        } else if (
          ms(decidedAt) < ms(row.decidedAt) ||
          (ms(decidedAt) === ms(row.decidedAt) && consent !== null && row.consent === null)
        ) {
          if (consent !== row.consent) throw new Error('stale allergen consent decision');
          ({ decidedAt, allergens } = row);
        }
      }
      Object.assign(row, { allergens, consent, decidedAt });
    },
  };
}

/** A device whose decisions are timed exactly like setAllergenConsentDecision. */
function orderedDevice(server: ReturnType<typeof orderedServer>) {
  let consent: AllergenConsentRecord | null = null;
  let local: UserRecallPreferences = PEANUT_CA;
  let dirty = false;
  let hold: Body[] | null = null;
  const store = createPreferencePersistence({
    enqueueLocal: createSerialQueue(),
    readLocal: async () => local,
    writeLocal: async (v) => {
      local = v;
    },
    isDirty: async () => dirty,
    setDirty: async (d) => {
      dirty = d;
    },
    mirrorKey: async () => `${serverAllergenConsent(consent) ?? 'none'}@${consent?.at ?? ''}`,
    syncRemote: async (prefs) => {
      const body: Body = {
        allergens: allergensForServer(prefs.allergens, consent),
        consent: serverAllergenConsent(consent),
        decidedAt: consent?.at ?? null,
      };
      if (hold) {
        // Reaches a slow server: the client times out, the server commits later.
        hold.push(body);
        hold = null;
        throw new Error('timed out');
      }
      server.apply(body);
    },
  });
  return {
    store,
    /** setAllergenConsentDecision, with the device clock at `now`. */
    decide(decision: AllergenConsentRecord['decision'], now: string) {
      consent = {
        decision,
        version: ALLERGEN_CONSENT_VERSION,
        at: nextDecisionTime(consent, new Date(now)),
      };
      return store.touch();
    },
    holdNextRequest(into: Body[]) {
      hold = into;
    },
    get record() {
      return consent;
    },
  };
}

test('withdrawing while a grant is in flight: the later withdrawal wins, even if the grant lands last', async () => {
  const server = orderedServer();
  const phone = orderedDevice(server);
  const late: Body[] = [];
  phone.holdNextRequest(late);
  assert.deepEqual(await phone.decide('granted', '2026-10-13T10:00:00Z'), { synced: false });
  assert.deepEqual(await phone.decide('withdrawn', '2026-10-13T10:00:05Z'), { synced: true });
  assert.deepEqual(server.row.allergens, []);
  // The delayed grant now commits: refused as stale, nothing restored.
  assert.throws(() => server.apply(late[0]), /stale allergen consent decision/);
  assert.deepEqual(server.row, {
    allergens: [],
    consent: null,
    decidedAt: '2026-10-13T10:00:05.000Z',
  });
});

test('equal decision times: a device never produces two, and a tie never restores allergens', async () => {
  // Two decisions in the same millisecond still get distinct, increasing times.
  const at = new Date('2026-10-13T10:00:00Z');
  const first = nextDecisionTime(null, at);
  const second = nextDecisionTime({ ...granted, at: first }, at);
  assert.ok(Date.parse(second) > Date.parse(first));
  // Even so, the server breaks a tie toward the withdrawal.
  const server = orderedServer();
  const t = '2026-10-13T10:00:00.000Z';
  server.apply({ allergens: [], consent: null, decidedAt: t });
  assert.throws(
    () => server.apply({ allergens: ['peanut'], consent: ALLERGEN_CONSENT_VERSION, decidedAt: t }),
    /stale allergen consent decision/,
  );
  assert.deepEqual(server.row.allergens, []);
  const other = orderedServer();
  other.apply({ allergens: ['peanut'], consent: ALLERGEN_CONSENT_VERSION, decidedAt: t });
  other.apply({ allergens: [], consent: null, decidedAt: t });
  assert.deepEqual(other.row, { allergens: [], consent: null, decidedAt: t });
});

test('a clock moved backwards or far forwards never stops a later withdrawal', async () => {
  for (const [grantClock, withdrawClock] of [
    ['2026-10-13T10:00:00Z', '2026-10-13T09:00:00Z'], // moved back an hour
    ['2026-10-13T10:00:00Z', '2001-01-01T00:00:00Z'], // reset to a factory date
    ['2031-06-01T00:00:00Z', '2026-10-13T10:00:00Z'], // granted far ahead, then corrected
    ['2026-10-13T10:00:00Z', '2031-06-01T00:00:00Z'], // withdrawn far ahead
  ]) {
    const server = orderedServer();
    const phone = orderedDevice(server);
    assert.deepEqual(await phone.decide('granted', grantClock), { synced: true });
    assert.deepEqual(server.row.allergens, ['peanut']);
    assert.deepEqual(await phone.decide('withdrawn', withdrawClock), { synced: true });
    assert.deepEqual(server.row.allergens, [], `${grantClock} then ${withdrawClock}`);
    assert.equal(server.row.consent, null);
    // And a re-consent after a far-ahead withdrawal is not stuck behind it.
    assert.deepEqual(await phone.decide('granted', grantClock), { synced: true });
    assert.equal(server.row.consent, ALLERGEN_CONSENT_VERSION);
  }
});

test('a server error or refusal leaves the withdrawal pending until the server confirms it', async () => {
  const server = orderedServer();
  const phone = orderedDevice(server);
  await phone.decide('granted', '2026-10-13T10:00:00Z');
  for (const failure of [
    new Error('HTTP 500'),
    new Error('HTTP 503'),
    new Error('stale allergen consent decision'),
  ]) {
    server.fail = failure;
    const { synced } = await phone.decide('withdrawn', '2026-10-13T10:01:00Z');
    assert.equal(synced, false, failure.message);
    assert.equal(await phone.store.mirrorOwed(), true);
    assert.equal(consentStatusLine(false, !synced), CONSENT_STATUS_WITHDRAW_PENDING);
    assert.deepEqual(server.row.allergens, ['peanut'], 'the server still has them');
    // Retried by the next launch: still failing, still pending.
    await phone.store.flush();
    await phone.store.mirrorIdle();
    assert.equal(await phone.store.mirrorOwed(), true);
  }
  server.fail = null;
  await phone.store.flush();
  await phone.store.mirrorIdle();
  assert.equal(await phone.store.mirrorOwed(), false, 'confirmed only now');
  assert.deepEqual(server.row.allergens, []);
});
