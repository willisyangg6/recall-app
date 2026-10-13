/**
 * Alert protection (age assurance, 2026-10-13), through the REAL alert
 * protocol (alert-intent.ts) against a small server model that mirrors the
 * rules of 20261017000000_consent_revocation (themselves verified on an
 * isolated Postgres stack — docs/recall-push-delivery.md):
 *
 * 1. A regulated 13–17 user's alerts are enabled only by the keyed
 *    registration, which stores the mapping in the same write. Missing or
 *    failed key acquisition leaves alerts DISABLED.
 * 2. A normal registration never revives a revoked row; only the same Apple
 *    Account's id renews it.
 * 3. The under-13 stop sends one disable (installation id only), persisted
 *    and retried until confirmed.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { alertIntent, type AlertIntentState, type WriteDecision } from './alert-intent';
import { disableAlertsAfterAgeStop } from './age-stop-alerts';
import {
  registrationRoute,
  RevocationKeyUnavailableError,
  routedRegistration,
  type RegistrationRoute,
} from './revocation-key';

const ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const ACCOUNT = '704289572311859823';
const OTHER_ACCOUNT = '999000111222333';

/** The server answered and refused (a 4xx): nothing committed. */
class Refused extends Error {}
/** No answer (offline, timeout): the outcome is unknown. */
class NoAnswer extends Error {}

interface Row {
  enabled: boolean;
  reason: string | null;
  hash: string | null;
}

/** The 20261017 rules, in memory. `hash()` stands in for the Vault HMAC. */
class ServerModel {
  rows = new Map<string, Row>();
  lastSequence = 0;
  online = true;
  calls: string[] = [];
  private hash = (id: string) => `hmac(${id})`;

  private gate(sequence: number): boolean {
    if (sequence <= this.lastSequence) return false;
    this.lastSequence = sequence;
    return true;
  }
  private answer(applied: boolean): WriteDecision {
    return { applied, lastSequence: this.lastSequence };
  }

  async registerPlain(sequence: number): Promise<WriteDecision> {
    this.calls.push(`plain#${sequence}`);
    if (!this.online) throw new NoAnswer();
    if (!this.gate(sequence)) return this.answer(false);
    const row = this.rows.get(ID) ?? { enabled: false, reason: null, hash: null };
    // register_push_subscription: never revives a revoked row.
    if (row.reason !== 'consent_revoked') Object.assign(row, { enabled: true, reason: null });
    this.rows.set(ID, row);
    return this.answer(true);
  }

  async registerKeyed(sequence: number, appTransactionId: string): Promise<WriteDecision> {
    this.calls.push(`keyed#${sequence}`);
    if (!this.online) throw new NoAnswer();
    const hash = this.hash(appTransactionId);
    const existing = this.rows.get(ID);
    if (existing?.reason === 'consent_revoked' && existing.hash !== hash) {
      throw new Refused('consent revoked for this installation');
    }
    if (!this.gate(sequence)) return this.answer(false);
    // Row and mapping in ONE write: enabled together with its hash.
    this.rows.set(ID, { enabled: true, reason: null, hash });
    return this.answer(true);
  }

  async disable(sequence: number): Promise<WriteDecision> {
    this.calls.push(`disable#${sequence}`);
    if (!this.online) throw new NoAnswer();
    if (!this.gate(sequence)) return this.answer(false);
    const row = this.rows.get(ID);
    if (row?.enabled) Object.assign(row, { enabled: false, reason: 'user_disabled' });
    return this.answer(true);
  }

  async clearKey(): Promise<void> {
    this.calls.push('clear');
    if (!this.online) throw new NoAnswer();
    const row = this.rows.get(ID);
    if (row && row.reason !== 'consent_revoked') row.hash = null;
  }

  /** apply_consent_revocation for one Apple Account. */
  revoke(appTransactionId: string): void {
    for (const row of this.rows.values()) {
      if (row.enabled && row.hash === this.hash(appTransactionId)) {
        Object.assign(row, { enabled: false, reason: 'consent_revoked' });
      }
    }
  }

  row(): Row | undefined {
    return this.rows.get(ID);
  }
}

/** One device: its persisted intent, its key-held flag, and what StoreKit returns. */
function device(server: ServerModel, initial: { route: () => RegistrationRoute }) {
  let stored: AlertIntentState | null = null;
  let keyHeld = false;
  const intent = alertIntent({
    load: async () => stored,
    save: async (state) => {
      stored = state;
    },
    register: routedRegistration({
      resolveRoute: async () => initial.route(),
      registerPlain: (sequence) => server.registerPlain(sequence),
      registerKeyed: (sequence, id) => server.registerKeyed(sequence, id),
      clearKey: () => server.clearKey(),
      setKeyHeld: async (held) => {
        keyHeld = held;
      },
    }),
    disable: (sequence) => server.disable(sequence),
    isDefiniteRejection: (error) => error instanceof Refused,
  });
  return { intent, state: () => stored, keyHeld: () => keyHeld };
}

test('the route: regulated 13–17 needs the id; without it, blocked', () => {
  assert.deepEqual(
    registrationRoute({ eligible: true, keyHeld: false, appTransactionId: ACCOUNT }),
    {
      kind: 'keyed',
      appTransactionId: ACCOUNT,
      clearAfter: false,
    },
  );
  assert.deepEqual(registrationRoute({ eligible: true, keyHeld: true, appTransactionId: null }), {
    kind: 'blocked',
  });
  assert.deepEqual(registrationRoute({ eligible: false, keyHeld: false, appTransactionId: null }), {
    kind: 'plain',
    clearAfter: false,
  });
  // No longer eligible but a key may be held: keyed (can renew) then clear.
  assert.deepEqual(
    registrationRoute({ eligible: false, keyHeld: true, appTransactionId: ACCOUNT }),
    {
      kind: 'keyed',
      appTransactionId: ACCOUNT,
      clearAfter: true,
    },
  );
  assert.deepEqual(registrationRoute({ eligible: false, keyHeld: true, appTransactionId: null }), {
    kind: 'plain',
    clearAfter: true,
  });
});

test('a regulated teen is enabled only together with the mapping', async () => {
  const server = new ServerModel();
  const teen = device(server, {
    route: () => ({ kind: 'keyed', appTransactionId: ACCOUNT, clearAfter: false }),
  });
  await teen.intent.register();
  assert.deepEqual(server.row(), { enabled: true, reason: null, hash: `hmac(${ACCOUNT})` });
  assert.equal(teen.state()?.enabled, true);
  assert.equal(teen.keyHeld(), true);
  assert.deepEqual(server.calls, ['keyed#1'], 'never a plain registration first');
});

test('missing key acquisition: nothing registered, and an earlier row is disabled', async () => {
  const server = new ServerModel();
  // The device registered earlier as an adult (plain), then Apple reports a
  // regulated 13–17 user and StoreKit cannot produce the id.
  let route: RegistrationRoute = { kind: 'plain', clearAfter: false };
  const phone = device(server, { route: () => route });
  await phone.intent.register();
  assert.equal(server.row()?.enabled, true);

  route = { kind: 'blocked' };
  await assert.rejects(phone.intent.register(), RevocationKeyUnavailableError);
  // The protocol's outranking cleanup disabled the row; no keyless enable.
  assert.equal(server.row()?.enabled, false);
  assert.equal(phone.state()?.enabled, false);
  assert.ok(
    !server.calls.slice(1).some((call) => call.startsWith('plain') || call.startsWith('keyed')),
  );
});

test('failed key upload: unknown outcome is cleaned up; a later retry enables WITH the mapping', async () => {
  const server = new ServerModel();
  const teen = device(server, {
    route: () => ({ kind: 'keyed', appTransactionId: ACCOUNT, clearAfter: false }),
  });
  server.online = false;
  await assert.rejects(teen.intent.register(), NoAnswer);
  assert.equal(teen.state()?.enabled, false);
  assert.notEqual(teen.state()?.pending, null, 'the cleanup disable is owed');
  assert.equal(server.row(), undefined, 'nothing landed');

  server.online = true;
  await teen.intent.register(); // settles the owed cleanup first, then registers keyed
  assert.deepEqual(server.row(), { enabled: true, reason: null, hash: `hmac(${ACCOUNT})` });
  assert.equal(teen.state()?.enabled, true);
  assert.equal(teen.state()?.pending, null);
});

test('a normal registration never revives a revoked row; only the same account renews it', async () => {
  const server = new ServerModel();
  let route: RegistrationRoute = { kind: 'keyed', appTransactionId: ACCOUNT, clearAfter: false };
  const teen = device(server, { route: () => route });
  await teen.intent.register();
  server.revoke(ACCOUNT);
  assert.deepEqual(server.row(), {
    enabled: false,
    reason: 'consent_revoked',
    hash: `hmac(${ACCOUNT})`,
  });

  // A plain registration (an older build, or a forged call with the id).
  route = { kind: 'plain', clearAfter: false };
  await teen.intent.register();
  assert.equal(server.row()?.enabled, false, 'plain registration did not revive it');
  assert.equal(server.row()?.reason, 'consent_revoked');

  // Another Apple Account's id: refused outright (a definite 4xx).
  route = { kind: 'keyed', appTransactionId: OTHER_ACCOUNT, clearAfter: false };
  await assert.rejects(teen.intent.register(), Refused);
  assert.equal(server.row()?.enabled, false);

  // The same account's app presents its id: renewed (server-side evidence
  // only — that Apple lets the app launch again after a parent restores
  // consent, with the same id, is proved on a device).
  route = { kind: 'keyed', appTransactionId: ACCOUNT, clearAfter: false };
  await teen.intent.register();
  assert.deepEqual(server.row(), { enabled: true, reason: null, hash: `hmac(${ACCOUNT})` });
});

test('no longer eligible: keyed once (so a revoked row can renew), then the key is cleared', async () => {
  const server = new ServerModel();
  let route: RegistrationRoute = { kind: 'keyed', appTransactionId: ACCOUNT, clearAfter: false };
  const phone = device(server, { route: () => route });
  await phone.intent.register();
  route = { kind: 'keyed', appTransactionId: ACCOUNT, clearAfter: true };
  await phone.intent.register();
  assert.deepEqual(server.row(), { enabled: true, reason: null, hash: null });
  assert.equal(phone.keyHeld(), false);
});

test('under 13: one disable with the installation id only, retried until confirmed', async () => {
  const server = new ServerModel();
  const phone = device(server, {
    route: () => ({ kind: 'plain', clearAfter: false }),
  });
  await phone.intent.register(); // alerts were on under an earlier account
  server.calls.length = 0;

  // Launch 1, offline: the disable is owed, the local flag already off.
  server.online = false;
  const first = await disableAlertsAfterAgeStop({
    peekInstallationId: async () => ID,
    intentFor: () => phone.intent,
  });
  assert.equal(first, 'pending');
  assert.equal(phone.state()?.enabled, false);
  assert.equal(server.row()?.enabled, true, 'offline: the server row is still enabled');

  // Launch 2, online: the owed disable is sent and confirmed.
  server.online = true;
  const second = await disableAlertsAfterAgeStop({
    peekInstallationId: async () => ID,
    intentFor: () => phone.intent,
  });
  assert.equal(second, 'confirmed');
  assert.equal(server.row()?.enabled, false);
  // Only disables were ever sent: no registration, nothing else.
  assert.ok(
    server.calls.every((call) => call.startsWith('disable#')),
    server.calls.join(','),
  );

  // Later launches send nothing more.
  const third = await disableAlertsAfterAgeStop({
    peekInstallationId: async () => ID,
    intentFor: () => phone.intent,
  });
  assert.equal(third, 'nothing-owed');
});

test('under 13 with no stored installation id, or alerts never on: nothing is sent', async () => {
  const server = new ServerModel();
  const phone = device(server, { route: () => ({ kind: 'plain', clearAfter: false }) });
  assert.equal(
    await disableAlertsAfterAgeStop({
      peekInstallationId: async () => null,
      intentFor: () => phone.intent,
    }),
    'no-installation',
  );
  assert.equal(
    await disableAlertsAfterAgeStop({
      peekInstallationId: async () => ID,
      intentFor: () => phone.intent,
    }),
    'nothing-owed',
  );
  assert.deepEqual(server.calls, []);
});
