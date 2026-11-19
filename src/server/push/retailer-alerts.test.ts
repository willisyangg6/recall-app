/**
 * Alerts for approved retailer-only notices, end to end through the REAL
 * worker over the in-memory store (docs/recall-push-delivery.md,
 * "Retailer-only notices"): who matches, who never does, what fails closed,
 * and how one recall gets one new-recall alert.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  readRetailerNoticeFields,
  type RetailerNoticeFields,
} from '../../lib/retailer-notice-fields';
import { parseRecallPushPayload } from '../../lib/push-payload';
import {
  planRetailerNoticeEvents,
  retailerCaseProjection,
  type RetailerMatchEvidence,
  type RetailerNoticeSubject,
} from '../retailer/notice-events';
import type { AgencyCaseView } from '../retailer/types';
import { MemoryPushStore } from './memory-push-store';
import { ACTIVE_SOURCE, FAR_FUTURE, NEVER_HELD, registerEntitled } from './test-entitlement';
import type { PushMessage, PushReceipt, PushTicket, PushTransport } from './types';
import { runPushDelivery } from './worker';

const NOTICE_ID = '9f735b5d-a15d-4d12-b993-94e89ac3edc8';
const AGENCY_CASE = 'aaaaaaaa-0000-4000-8000-00000000a001';
const T0 = Date.parse('2026-11-18T15:00:00.000Z');
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(T0 + ms).toISOString();

const FIELDS = readRetailerNoticeFields(
  JSON.parse(
    readFileSync(
      join(__dirname, '..', 'retailer', 'fixtures', 'approvals', 'kirkland-whipped-cream.json'),
      'utf8',
    ),
  ).fields,
)!;

function subject(fields: RetailerNoticeFields = FIELDS): RetailerNoticeSubject {
  return {
    noticeId: NOTICE_ID,
    documentUrl: 'https://gdx-assets.costco.com/letter.pdf',
    statedNoticeDate: '2026-11-07',
    fields,
  };
}

/** What the monitor archived for the Kirkland letter: its index title and text. */
const EVIDENCE: RetailerMatchEvidence = {
  indexEntry: {
    nativeId: 'bltdc8f3dbbb7e4b836',
    indexTitle: 'Kirkland Signature Heavy Whipped Cream (Item #1777000) Select Locations',
  } as RetailerMatchEvidence['indexEntry'],
  statedNoticeDate: '2026-11-07',
  text: 'Alamance Foods is voluntarily recalling Kirkland Signature Real Heavy Whipped Cream, item 1777000.',
};

/** The agency's later notice for the same whipped cream. */
const AGENCY_VIEW: AgencyCaseView = {
  id: AGENCY_CASE,
  sourceAgency: 'FDA',
  noticeType: 'recall',
  state: 'active',
  publishedAt: '2026-11-19',
  title: 'Alamance Foods Recalls Kirkland Signature Heavy Whipped Cream',
  firm: 'Alamance Foods',
  brands: ['Kirkland Signature'],
  text: 'Alamance Foods recalls Kirkland Signature Real Heavy Whipped Cream because of a cleaning chemical.',
  retailerNames: ['Costco'],
  geography: { scope: 'states', states: ['Alabama', 'Florida', 'Georgia'] },
};

class Transport implements PushTransport {
  sent: PushMessage[] = [];
  private n = 0;
  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    this.sent.push(...messages);
    return messages.map(() => ({ status: 'ok' as const, id: `t-${(this.n += 1)}` }));
  }
  async getReceipts(): Promise<Record<string, PushReceipt>> {
    return {};
  }
  authProblem(): string | null {
    return null;
  }
}

function setup() {
  const store = new MemoryPushStore();
  store.pushEnabledAt = iso(-30 * 24 * HOUR);
  const transport = new Transport();
  const run = (ms: number, held = false) =>
    runPushDelivery(store, {
      transport,
      entitlements: ACTIVE_SOURCE,
      sendingHold: held ? () => true : NEVER_HELD,
      dryRun: false,
      now: () => new Date(T0 + ms),
    });
  return { store, transport, run };
}

function shopper(
  store: MemoryPushStore,
  id: string,
  prefs: { stateCodes: string[]; allergens?: string[]; retailerIds?: string[] },
  appVersion: string | null = '1.2.0',
) {
  registerEntitled(store, id, `ExponentPushToken[${id}]`, 'ios', iso(-10 * 24 * HOUR));
  store.setPreferences(
    id,
    {
      stateCodes: prefs.stateCodes,
      allergens: prefs.allergens ?? [],
      retailerIds: prefs.retailerIds ?? [],
    },
    iso(-10 * 24 * HOUR),
  );
  store.subscriptionOf(id)!.appVersion = appVersion;
}

const tokensOf = (messages: PushMessage[]) => messages.map((m) => m.to).sort();

function publish(store: MemoryPushStore, eventId = 'e0000000-0000-4000-8000-000000000001') {
  store.addRetailerEvent({
    id: eventId,
    retailerNoticeId: NOTICE_ID,
    kind: 'initial',
    triggerRuleId: 'new_retailer_notice',
    payloadSummary: FIELDS.productName,
    createdAt: iso(0),
  });
  return eventId;
}

test('a verified retailer-only notice alerts exactly the shoppers it affects', async () => {
  const { store, transport, run } = setup();
  store.setRetailerNotice(subject(), { matchEvidence: EVIDENCE });
  shopper(store, 'al', { stateCodes: ['AL'] });
  shopper(store, 'nostate-costco', { stateCodes: [], retailerIds: ['costco'] });
  shopper(store, 'ca-costco', { stateCodes: ['CA'], retailerIds: ['costco'] }); // explicit exclusion
  shopper(store, 'nostate-target', { stateCodes: [], retailerIds: ['target'] });
  shopper(store, 'al-old-app', { stateCodes: ['AL'] }, '1.1.0'); // cannot open a retailer notice
  publish(store);

  const result = await run(HOUR);
  assert.deepEqual(tokensOf(transport.sent), [
    'ExponentPushToken[al]',
    'ExponentPushToken[nostate-costco]',
  ]);
  assert.equal(result.metrics.clientUnsupportedSkipped, 1);
  const [message] = transport.sent;
  assert.equal(message.title, 'Recall alert: Kirkland Signature Real Heavy Whipped Cream');
  // The retailer is who announced it, dated as the agency's late alerts are.
  assert.equal(
    message.body,
    'Potential cleaning chemical contamination. Costco announced this Nov 7. Check your package.',
  );
  // The tap opens the retailer notice's own Detail; no agency is named.
  assert.deepEqual(parseRecallPushPayload(message.data)?.recallCaseId, `retailer:${NOTICE_ID}`);
  assert.doesNotMatch(message.body, /FDA|FSIS/);
});

test('a notice withdrawn after its alert was queued never sends', async () => {
  const { store, transport, run } = setup();
  store.setRetailerNotice(subject(), { matchEvidence: EVIDENCE });
  shopper(store, 'al', { stateCodes: ['AL'] });
  publish(store);
  await run(HOUR, true); // overnight hold: the delivery is queued, not sent
  assert.equal(transport.sent.length, 0);
  assert.equal([...store.deliveries.values()].filter((d) => d.status === 'pending').length, 1);

  // Withdrawn (or revised, or matched): the read path no longer returns it.
  store.setRetailerNotice(subject(), { visible: false, live: false, matchEvidence: EVIDENCE });
  const result = await run(2 * HOUR);
  assert.equal(transport.sent.length, 0);
  const [row] = [...store.deliveries.values()];
  assert.equal(row.status, 'permanent_failure');
  assert.equal(row.failureCode, 'case_retailer_not_visible');
  assert.equal(result.metrics.retailerNotVisibleSkipped, 1);
});

test('an unapproved or superseded notice is never eligible', async () => {
  const { store, transport, run } = setup();
  store.setRetailerNotice(subject(), { visible: false, live: false });
  shopper(store, 'al', { stateCodes: ['AL'] });
  publish(store);
  const result = await run(HOUR);
  assert.equal(transport.sent.length, 0);
  assert.equal(store.deliveries.size, 0);
  assert.equal(result.metrics.retailerNotVisibleSkipped, 1);
});

test('an agency case for the same recall makes the retailer alert a duplicate', async () => {
  const { store, transport, run } = setup();
  store.setRetailerNotice(subject(), { matchEvidence: EVIDENCE });
  store.agencyCaseViews.push(AGENCY_VIEW);
  shopper(store, 'al', { stateCodes: ['AL'] });
  publish(store);
  const result = await run(HOUR);
  assert.equal(transport.sent.length, 0);
  assert.equal(result.metrics.agencyDuplicateSkipped, 1);
});

test('a later agency match sends no second new-recall alert to anyone already alerted', async () => {
  const { store, transport, run } = setup();
  store.setRetailerNotice(subject(), { matchEvidence: EVIDENCE });
  shopper(store, 'al', { stateCodes: ['AL'] });
  publish(store);
  await run(HOUR);
  assert.deepEqual(tokensOf(transport.sent), ['ExponentPushToken[al]']);

  // FDA then publishes the same recall; a second shopper joins Florida.
  shopper(store, 'fl', { stateCodes: ['FL'] });
  store.subscriptionOf('fl')!.enabledAt = iso(-10 * 24 * HOUR);
  store.agencyCaseViews.push(AGENCY_VIEW);
  store.addEvent({
    id: 'e0000000-0000-4000-8000-00000000a0e1',
    recallCaseId: AGENCY_CASE,
    kind: 'initial',
    triggerRuleId: 'new_case',
    materialChangeRef: null,
    payloadSummary: 'Alamance Foods Recalls Kirkland Signature Heavy Whipped Cream',
    createdAt: iso(24 * HOUR),
    projection: {
      ...retailerCaseProjection(subject()),
      title: AGENCY_VIEW.title,
      geography: {
        scope: 'states',
        states: ['Alabama', 'Florida', 'Georgia'],
        confidence: 'stated',
        sourceText: null,
      },
    },
  });
  transport.sent = [];
  const result = await run(25 * HOUR);
  // The Alabama shopper already had this recall's alert; Florida is new to it.
  assert.deepEqual(tokensOf(transport.sent), ['ExponentPushToken[fl]']);
  assert.equal(result.metrics.duplicateAlertSkipped, 1);
});

test('publishing old intake never alerts: an old letter is ledgered as backfill', () => {
  const plan = planRetailerNoticeEvents({
    subject: { ...subject(), statedNoticeDate: '2026-09-01' },
    previous: null,
    history: [],
    now: new Date(T0),
  });
  assert.deepEqual(
    plan.map((event) => [event.kind, event.suppressed]),
    [['initial', 'backfill']],
  );
  // And a suppressed event is never delivered by the worker.
  return (async () => {
    const { store, transport, run } = setup();
    store.setRetailerNotice(subject(), {});
    shopper(store, 'al', { stateCodes: ['AL'] });
    store.addRetailerEvent({
      id: 'e0000000-0000-4000-8000-0000000000b1',
      retailerNoticeId: NOTICE_ID,
      kind: 'initial',
      triggerRuleId: 'new_retailer_notice',
      payloadSummary: 'x',
      createdAt: iso(0),
      suppressed: 'backfill',
    });
    await run(HOUR);
    assert.equal(transport.sent.length, 0);
    assert.equal(store.deliveries.size, 0);
  })();
});

test('one initial per notice ever; a revised letter alerts only on a material expansion', () => {
  const now = new Date(T0);
  const first = planRetailerNoticeEvents({ subject: subject(), previous: null, history: [], now });
  assert.deepEqual(
    first.map((e) => [e.kind, e.dedupKey, e.suppressed]),
    [['initial', `retailer_notice:${NOTICE_ID}`, null]],
  );
  const history = [{ kind: 'initial' as const, suppressed: null, createdAt: now.toISOString() }];

  // Re-approval of the same facts (a withdrawal undone): nothing new.
  assert.deepEqual(
    planRetailerNoticeEvents({ subject: subject(), previous: subject(), history, now }),
    [],
  );
  // A wording fix is not material.
  const reworded = structuredClone(FIELDS);
  reworded.whyRecalled = `${FIELDS.whyRecalled} (revised wording)`;
  assert.deepEqual(
    planRetailerNoticeEvents({ subject: subject(reworded), previous: subject(), history, now }),
    [],
  );
  // A revised letter adding a state is the shared expansion_geography update.
  const wider = structuredClone(FIELDS);
  wider.whereSold.states = [...FIELDS.whereSold.states, 'Texas'];
  const expanded = planRetailerNoticeEvents({
    subject: subject(wider),
    previous: subject(),
    history,
    now,
  });
  assert.deepEqual(
    expanded.map((e) => [e.kind, e.triggerRuleId, e.suppressed]),
    [['material_update', 'expansion_geography', null]],
  );
  // A second material change within 24 h is coalesced, as for agency cases.
  const again = planRetailerNoticeEvents({
    subject: subject(wider),
    previous: subject(),
    history: [
      ...history,
      { kind: 'material_update', suppressed: null, createdAt: now.toISOString() },
    ],
    now,
  });
  assert.deepEqual(
    again.map((e) => e.suppressed),
    ['coalesced'],
  );
});

test('a genuine expansion reaches the newly affected state through the usual update path', async () => {
  const { store, transport, run } = setup();
  const wider = structuredClone(FIELDS);
  wider.whereSold.states = [...FIELDS.whereSold.states, 'Texas'];
  store.setRetailerNotice(subject(wider), { matchEvidence: EVIDENCE });
  shopper(store, 'tx', { stateCodes: ['TX'] });
  store.addRetailerEvent({
    id: 'e0000000-0000-4000-8000-0000000000c1',
    retailerNoticeId: NOTICE_ID,
    kind: 'material_update',
    triggerRuleId: 'expansion_geography',
    payloadSummary: 'Affected area widened (Texas).',
    materialChangeRef: 'fp-geo',
    createdAt: iso(0),
  });
  await run(HOUR);
  assert.deepEqual(tokensOf(transport.sent), ['ExponentPushToken[tx]']);
  assert.equal(
    transport.sent[0].title,
    'Recall updated: Kirkland Signature Real Heavy Whipped Cream',
  );
  assert.equal(transport.sent[0].body, 'More areas are now affected by this recall.');
});

// ── With PR #8's overnight-hold scope (alert timing, 2026-11-19) ────────────
// The REAL hold rule (22:00–09:59 New York) and the approved production scope
// `except_new_recalls`: a retailer notice is held, exempted or dated by exactly
// the rule an agency recall is, through the same worker. Clocks are absolute:
// NIGHT is 23:00 EST on Nov 18 (04:00 UTC Nov 19), MORNING 10:07 EST Nov 19.

const NIGHT = Date.parse('2026-11-19T04:00:00.000Z');
const MORNING = Date.parse('2026-11-19T15:07:00.000Z');
const MIN = 60_000;

function scoped(
  scope: 'all' | 'except_new_recalls' = 'except_new_recalls',
  entitlements: typeof ACTIVE_SOURCE = ACTIVE_SOURCE,
) {
  const store = new MemoryPushStore();
  store.pushEnabledAt = iso(-30 * 24 * HOUR);
  const transport = new Transport();
  const runAt = (at: number, dryRun = false) => {
    transport.sent = [];
    return runPushDelivery(store, {
      transport,
      entitlements,
      sendingHoldScope: scope,
      dryRun,
      now: () => new Date(at),
    });
  };
  return { store, transport, runAt };
}

const dated = (statedNoticeDate: string, fields = FIELDS): RetailerNoticeSubject => ({
  ...subject(fields),
  statedNoticeDate,
});

function ledger(
  store: MemoryPushStore,
  at: number,
  kind: 'initial' | 'material_update' = 'initial',
  id = 'e0000000-0000-4000-8000-0000000000d1',
) {
  store.addRetailerEvent({
    id,
    retailerNoticeId: NOTICE_ID,
    kind,
    triggerRuleId: kind === 'initial' ? 'new_retailer_notice' : 'expansion_geography',
    payloadSummary: kind === 'initial' ? FIELDS.productName : 'Affected area widened (Texas).',
    materialChangeRef: kind === 'initial' ? null : 'fp-geo',
    createdAt: new Date(at).toISOString(),
  });
}

test('timing: a fresh retailer notice approved at 23:00 sends at once, undated; `all` holds it', async () => {
  for (const scope of ['except_new_recalls', 'all'] as const) {
    const { store, transport, runAt } = scoped(scope);
    store.setRetailerNotice(dated('2026-11-18'), { matchEvidence: EVIDENCE });
    shopper(store, 'al', { stateCodes: ['AL'] });
    ledger(store, NIGHT);
    const night = await runAt(NIGHT + 7 * MIN);
    assert.equal(night.metrics.sendingHeld, true, scope);
    if (scope === 'except_new_recalls') {
      assert.equal(night.metrics.sendingHoldExempted, 1);
      assert.deepEqual(tokensOf(transport.sent), ['ExponentPushToken[al]']);
      assert.doesNotMatch(transport.sent[0].body, /announced this/);
    } else {
      assert.equal(night.metrics.sendingHoldDeferred, 1);
      assert.equal(transport.sent.length, 0);
    }
    // The morning sends what is still owed, and nothing twice.
    await runAt(MORNING);
    assert.equal(transport.sent.length, scope === 'all' ? 1 : 0, scope);
  }
});

test('timing: the late-alert boundary — a letter 2 NY days old is fresh, 3 days waits and is dated', async () => {
  for (const [letter, exempt] of [
    ['2026-11-16', true],
    ['2026-11-15', false],
  ] as const) {
    const { store, transport, runAt } = scoped();
    store.setRetailerNotice(dated(letter), { matchEvidence: EVIDENCE });
    shopper(store, 'al', { stateCodes: ['AL'] });
    ledger(store, NIGHT);
    await runAt(NIGHT + 7 * MIN);
    assert.equal(transport.sent.length, exempt ? 1 : 0, letter);
    await runAt(MORNING);
    assert.equal(transport.sent.length, exempt ? 0 : 1, letter);
    if (!exempt) assert.match(transport.sent[0].body, /Costco announced this Nov 15\./);
  }
});

test('timing: old intake — a 30-day-old letter alerts (in the morning, dated); 31 days is backfill', async () => {
  const at = new Date(NIGHT);
  const plan = (statedNoticeDate: string) =>
    planRetailerNoticeEvents({
      subject: dated(statedNoticeDate),
      previous: null,
      history: [],
      now: at,
    })[0].suppressed;
  // The agency rule exactly (pipeline.ts): older than 30 × 24 h, counted from
  // the letter date's UTC midnight. At NIGHT (Nov 19 04:00 UTC) Oct 21 is
  // 29 d 4 h old and alerts; Oct 20 is 30 d 4 h old and is backfill.
  assert.equal(plan('2026-10-21'), null);
  assert.equal(plan('2026-10-20'), 'backfill');

  const { store, transport, runAt } = scoped();
  store.setRetailerNotice(dated('2026-10-21'), { matchEvidence: EVIDENCE });
  shopper(store, 'al', { stateCodes: ['AL'] });
  ledger(store, NIGHT);
  await runAt(NIGHT + 7 * MIN);
  assert.equal(transport.sent.length, 0, 'an old letter is never urgent at night');
  await runAt(MORNING);
  assert.match(transport.sent[0].body, /Costco announced this Oct 21\./);
});

test('timing: an outage backlog is never released at night, even for a fresh letter', async () => {
  const { store, transport, runAt } = scoped();
  store.setRetailerNotice(dated('2026-11-18'), { matchEvidence: EVIDENCE });
  shopper(store, 'al', { stateCodes: ['AL'] });
  // Approved 10:30 EST; push was down all day and first runs at 23:07 EST.
  ledger(store, Date.parse('2026-11-18T15:30:00.000Z'));
  const night = await runAt(NIGHT + 7 * MIN);
  assert.equal(night.metrics.sendingHoldDeferred, 1);
  assert.equal(night.metrics.sendingHoldExempted, 0);
  assert.equal(transport.sent.length, 0);
  await runAt(MORNING);
  assert.equal(transport.sent.length, 1);
});

test('timing: a revised letter (material update) approved at night waits for 10:00', async () => {
  const { store, transport, runAt } = scoped();
  const wider = structuredClone(FIELDS);
  wider.whereSold.states = [...FIELDS.whereSold.states, 'Texas'];
  store.setRetailerNotice(dated('2026-11-18', wider), { matchEvidence: EVIDENCE });
  shopper(store, 'tx', { stateCodes: ['TX'] });
  ledger(store, NIGHT, 'material_update');
  const night = await runAt(NIGHT + 7 * MIN);
  assert.equal(night.metrics.sendingHoldDeferred, 1);
  assert.equal(transport.sent.length, 0);
  await runAt(MORNING);
  assert.deepEqual(tokensOf(transport.sent), ['ExponentPushToken[tx]']);
  assert.match(transport.sent[0].title, /^Recall updated:/);
});

test('timing: a notice withdrawn overnight while its alert waits never sends in the morning', async () => {
  const { store, transport, runAt } = scoped();
  store.setRetailerNotice(dated('2026-11-07'), { matchEvidence: EVIDENCE }); // dated: held
  shopper(store, 'al', { stateCodes: ['AL'] });
  ledger(store, NIGHT);
  await runAt(NIGHT + 7 * MIN);
  assert.equal([...store.deliveries.values()][0].status, 'pending');
  store.setRetailerNotice(dated('2026-11-07'), {
    visible: false,
    live: false,
    matchEvidence: EVIDENCE,
  });
  const morning = await runAt(MORNING);
  assert.equal(transport.sent.length, 0);
  assert.equal([...store.deliveries.values()][0].failureCode, 'case_retailer_not_visible');
  assert.equal(morning.metrics.retailerNotVisibleSkipped, 1);
});

test('timing: retailer at 23:00, agency for the same recall at 01:00 — one new-recall alert each', async () => {
  const { store, transport, runAt } = scoped();
  store.setRetailerNotice(dated('2026-11-18'), { matchEvidence: EVIDENCE });
  shopper(store, 'al', { stateCodes: ['AL'] });
  shopper(store, 'al-old-app', { stateCodes: ['AL'] }, '1.1.0');
  ledger(store, NIGHT);
  await runAt(NIGHT + 7 * MIN);
  assert.deepEqual(tokensOf(transport.sent), ['ExponentPushToken[al]']);

  // FDA publishes the same recall at 01:00 EST; a fresh agency initial is exempt too.
  store.agencyCaseViews.push(AGENCY_VIEW);
  const agencyAt = NIGHT + 2 * HOUR;
  store.addEvent({
    id: 'e0000000-0000-4000-8000-00000000a0e2',
    recallCaseId: AGENCY_CASE,
    kind: 'initial',
    triggerRuleId: 'new_case',
    materialChangeRef: null,
    payloadSummary: AGENCY_VIEW.title,
    createdAt: new Date(agencyAt).toISOString(),
    projection: {
      ...retailerCaseProjection(dated('2026-11-19')),
      title: AGENCY_VIEW.title,
      geography: { scope: 'states', states: ['Alabama'], confidence: 'stated', sourceText: null },
    },
  });
  const agency = await runAt(agencyAt + 7 * MIN);
  // The 1.2.0 shopper already had it; the 1.1.0 app never could, so it gets the agency alert.
  assert.deepEqual(tokensOf(transport.sent), ['ExponentPushToken[al-old-app]']);
  assert.equal(agency.metrics.duplicateAlertSkipped, 1);
  assert.equal(agency.metrics.sendingHoldExempted, 1);
  await runAt(MORNING);
  assert.equal(transport.sent.length, 0, 'nothing is re-sent in the morning');
});

test('timing: the exemption never bypasses entitlement or the app-version gate', async () => {
  const lapsed = 'p-lapsed'.padEnd(16, '0');
  const source = {
    async check(purchaseId: string) {
      return purchaseId === lapsed
        ? { active: false, expiresAt: null }
        : { active: true, expiresAt: FAR_FUTURE };
    },
  } as typeof ACTIVE_SOURCE;
  const { store, transport, runAt } = scoped('except_new_recalls', source);
  store.setRetailerNotice(dated('2026-11-18'), { matchEvidence: EVIDENCE });
  shopper(store, 'al', { stateCodes: ['AL'] });
  shopper(store, 'al-old-app', { stateCodes: ['AL'] }, '1.1.0');
  shopper(store, 'lapsed', { stateCodes: ['AL'] });
  store.subscriptionOf('lapsed')!.purchaseId = lapsed;
  store.seedEntitlement('lapsed', {
    status: 'inactive',
    expiresAt: null,
    checkedAt: new Date(NIGHT - HOUR).toISOString(),
    entitledSince: null,
  });
  ledger(store, NIGHT);
  const night = await runAt(NIGHT + 7 * MIN);
  assert.deepEqual(tokensOf(transport.sent), ['ExponentPushToken[al]']);
  assert.equal(night.metrics.clientUnsupportedSkipped, 1);
  assert.ok(Number(night.metrics.entitlementSkipped) >= 1);
});

test('timing: the dry run reports a fresh retailer alert as would-send and the rest as held', async () => {
  const { store, transport, runAt } = scoped();
  store.setRetailerNotice(dated('2026-11-18'), { matchEvidence: EVIDENCE });
  shopper(store, 'al', { stateCodes: ['AL'] });
  ledger(store, NIGHT);
  ledger(store, NIGHT, 'material_update', 'e0000000-0000-4000-8000-0000000000d2');
  const dry = await runAt(NIGHT + 7 * MIN, true);
  assert.equal(dry.metrics.sendingHoldExempted, 1);
  assert.equal(dry.metrics.sendingHoldDeferred, 1);
  assert.equal(dry.metrics.sent, 1);
  assert.equal(store.deliveries.size, 0);
  assert.equal(transport.sent.length, 0);
});
