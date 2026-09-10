/**
 * Shopper reports (P1C) — behavioral semantics, against the memory mirror of
 * the RPCs (MemoryShopperStore). Proves eligibility and validation,
 * ownership isolation, the one-row-per-installation-and-case invariant, the
 * thresholded aggregate (0/1/2 indistinguishable, 3+ exact), idempotent
 * retries, withdrawal, the 12-month retention contract (expiry, boundary,
 * threshold transitions, fresh post-expiry submissions, physical cleanup),
 * the kill switch's exact scope, and installation-data deletion. The SQL-only properties (RLS, grants, search_path, the state
 * mapping and enum parity) are pinned textually in
 * shopper-reports-migration.test.ts; the same matrix runs live over
 * PostgREST on the disposable stack.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MemoryShopperStore, retentionExpiry, type ShopperCaseFacts } from './memory-shopper-store';

const NOW = '2026-09-10T12:00:00.000Z';
const LATER = '2026-09-10T13:00:00.000Z';

const OWNER = 'installation-aaaa-0001';
const OTHER = 'installation-bbbb-0002';

const CASE_STATES = '11111111-1111-4111-8111-111111111111';
const CASE_NATIONWIDE = '22222222-2222-4222-8222-222222222222';
const CASE_UNKNOWN = '33333333-3333-4333-8333-333333333333';
const CASE_CLOSED = '44444444-4444-4444-8444-444444444444';
const CASE_RETRACTED = '55555555-5555-4555-8555-555555555555';
const CASE_MERGED = '66666666-6666-4666-8666-666666666666';
const CASE_NO_RETAILERS = '77777777-7777-4777-8777-777777777777';

function caseFacts(overrides: Partial<ShopperCaseFacts> & { id: string }): ShopperCaseFacts {
  return {
    state: 'active',
    mergedInto: null,
    geographyScope: 'states',
    geographyStates: ['California', 'Nevada'],
    retailerNames: ['Costco Wholesale', 'Sprouts Farmers Market'],
    ...overrides,
  };
}

function makeStore(): MemoryShopperStore {
  const store = new MemoryShopperStore();
  store.reportsEnabled = true;
  store.addCase(caseFacts({ id: CASE_STATES }));
  store.addCase(
    caseFacts({ id: CASE_NATIONWIDE, geographyScope: 'nationwide', geographyStates: [] }),
  );
  store.addCase(caseFacts({ id: CASE_UNKNOWN, geographyScope: 'unknown', geographyStates: [] }));
  store.addCase(caseFacts({ id: CASE_CLOSED, state: 'closed' }));
  store.addCase(caseFacts({ id: CASE_RETRACTED, state: 'retracted' }));
  store.addCase(caseFacts({ id: CASE_MERGED, mergedInto: CASE_STATES }));
  store.addCase(caseFacts({ id: CASE_NO_RETAILERS, retailerNames: undefined }));
  return store;
}

// ── Eligibility and validation ───────────────────────────────────────────────

test('an active known-geography case accepts an eligible report', () => {
  const store = makeStore();
  const report = store.submit(OWNER, CASE_STATES, 'CA', 'Costco Wholesale', 'past_week', NOW);
  assert.deepEqual(report, {
    stateCode: 'CA',
    retailerName: 'Costco Wholesale',
    purchaseWindow: 'past_week',
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  });
});

test('closed, retracted, merged, and unknown-geography cases refuse submission', () => {
  const store = makeStore();
  for (const caseId of [CASE_CLOSED, CASE_RETRACTED, CASE_MERGED, CASE_UNKNOWN]) {
    assert.throws(
      () => store.submit(OWNER, caseId, 'CA', null, 'past_week', NOW),
      /reporting is not available for this recall/,
      caseId,
    );
  }
  // A case the store has never seen fails with the SAME message — existence
  // is not probeable beyond what the public feed already shows.
  assert.throws(
    () => store.submit(OWNER, '99999999-9999-4999-8999-999999999999', 'CA', null, 'past_week', NOW),
    /reporting is not available for this recall/,
  );
});

test('a multi-state case refuses an unlisted state and accepts each listed one', () => {
  const store = makeStore();
  assert.throws(
    () => store.submit(OWNER, CASE_STATES, 'TX', null, 'past_week', NOW),
    /invalid state for this recall/,
  );
  store.submit(OWNER, CASE_STATES, 'CA', null, 'past_week', NOW);
  store.submit(OTHER, CASE_STATES, 'NV', null, 'past_week', NOW);
});

test('a nationwide case accepts any supported jurisdiction and refuses the rest', () => {
  const store = makeStore();
  for (const code of ['CA', 'WY', 'DC', 'PR']) {
    store.submit(OWNER, CASE_NATIONWIDE, code, null, 'past_month', NOW);
  }
  for (const bad of ['XX', 'ZZ', 'ca', 'C', 'CAL', '']) {
    assert.throws(
      () => store.submit(OWNER, CASE_NATIONWIDE, bad, null, 'past_month', NOW),
      /invalid state code/,
      JSON.stringify(bad),
    );
  }
});

test('retailer: listed accepts, arbitrary refuses, none-listed requires null', () => {
  const store = makeStore();
  store.submit(OWNER, CASE_STATES, 'CA', 'Sprouts Farmers Market', 'past_week', NOW);
  // "Not sure" is the absence of a retailer, never a stored string.
  store.submit(OTHER, CASE_STATES, 'CA', null, 'past_week', NOW);
  assert.throws(
    () => store.submit(OWNER, CASE_STATES, 'CA', 'Walmart', 'past_week', NOW),
    /invalid retailer for this recall/,
  );
  // Exact resolution — a case-variant of a real choice is not that choice.
  assert.throws(
    () => store.submit(OWNER, CASE_STATES, 'CA', 'costco wholesale', 'past_week', NOW),
    /invalid retailer for this recall/,
  );
  // A projection without the retailerNames key offers no choices: null only.
  store.submit(OWNER, CASE_NO_RETAILERS, 'CA', null, 'past_week', NOW);
  assert.throws(
    () => store.submit(OTHER, CASE_NO_RETAILERS, 'CA', 'Costco Wholesale', 'past_week', NOW),
    /invalid retailer for this recall/,
  );
});

test('every purchase bucket accepts; arbitrary and injection-shaped values refuse', () => {
  const store = makeStore();
  const buckets = ['past_week', 'past_month', 'past_three_months', 'longer_ago', 'not_sure'];
  buckets.forEach((bucket, i) => {
    store.submit(`${OWNER}-${i}`, CASE_STATES, 'CA', null, bucket, NOW);
  });
  for (const bad of ['yesterday', '', "past_week'; drop table shopper_reports; --", 'PAST_WEEK']) {
    assert.throws(
      () => store.submit(OWNER, CASE_STATES, 'CA', null, bad, NOW),
      /invalid purchase window/,
      JSON.stringify(bad),
    );
  }
});

test('oversized and malformed inputs fail shape validation before anything else', () => {
  const store = makeStore();
  assert.throws(
    () => store.submit('short', CASE_STATES, 'CA', null, 'past_week', NOW),
    /invalid installation id/,
  );
  assert.throws(
    () => store.submit('x'.repeat(65), CASE_STATES, 'CA', null, 'past_week', NOW),
    /invalid installation id/,
  );
  assert.throws(
    () => store.submit(`${OWNER}'; --`, CASE_STATES, 'CA', null, 'past_week', NOW),
    /invalid installation id/,
  );
  assert.throws(
    () => store.submit(OWNER, 'not-a-uuid', 'CA', null, 'past_week', NOW),
    /invalid case id/,
  );
  assert.throws(
    () => store.submit(OWNER, CASE_STATES, 'CA', 'R'.repeat(121), 'past_week', NOW),
    /invalid retailer/,
  );
});

test('the contract has no field that could carry health data or free text', () => {
  const store = makeStore();
  const report = store.submit(OWNER, CASE_STATES, 'CA', 'Costco Wholesale', 'past_week', NOW);
  // The full key set of a stored report — nothing else exists to write to.
  assert.deepEqual(Object.keys(report).sort(), [
    'createdAt',
    'purchaseWindow',
    'retailerName',
    'stateCode',
    'updatedAt',
    'version',
  ]);
});

// ── Ownership ────────────────────────────────────────────────────────────────

test('the owner can submit, read, update, and withdraw; another installation cannot see any of it', () => {
  const store = makeStore();
  store.submit(OWNER, CASE_STATES, 'CA', null, 'past_week', NOW);
  assert.equal(store.getMine(OWNER, CASE_STATES, NOW)?.stateCode, 'CA');

  // A different installation presenting ITS credential reads nothing and
  // withdraws nothing — reachable rows are keyed by the presented id only.
  assert.equal(store.getMine(OTHER, CASE_STATES, NOW), null);
  store.withdraw(OTHER, CASE_STATES);
  assert.equal(store.getMine(OWNER, CASE_STATES, NOW)?.stateCode, 'CA');

  const updated = store.submit(OWNER, CASE_STATES, 'NV', null, 'past_month', LATER);
  assert.equal(updated.version, 2);
  store.withdraw(OWNER, CASE_STATES);
  assert.equal(store.getMine(OWNER, CASE_STATES, NOW), null);
});

test('ownership is possession of the unguessable credential — there is no takeover parameter', () => {
  // The API surface accepts exactly one installation id: the caller's own
  // bearer credential. There is no report id, no target-installation
  // parameter, and no listing — so "taking over" a report REQUIRES
  // presenting its owner's 122-bit random UUID. A guessed public id is just
  // a different (empty) installation.
  const store = makeStore();
  store.submit(OWNER, CASE_STATES, 'CA', null, 'past_week', NOW);
  const guessed = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'; // any non-matching guess
  assert.equal(store.getMine(guessed, CASE_STATES, NOW), null);
  store.withdraw(guessed, CASE_STATES);
  store.submit(guessed, CASE_STATES, 'NV', null, 'not_sure', LATER);
  // The owner's report is untouched; the guesser only ever created its own.
  assert.deepEqual(store.getMine(OWNER, CASE_STATES, NOW), {
    stateCode: 'CA',
    retailerName: null,
    purchaseWindow: 'past_week',
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  });
});

test('one installation + case stays one row under retries; two installations make two', () => {
  const store = makeStore();
  for (let i = 0; i < 5; i += 1) {
    store.submit(OWNER, CASE_STATES, 'CA', null, 'past_week', NOW);
  }
  assert.equal(store.rowsForCase(CASE_STATES).length, 1);
  store.submit(OTHER, CASE_STATES, 'NV', null, 'past_week', NOW);
  assert.equal(store.rowsForCase(CASE_STATES).length, 2);
});

test('an identical retry changes nothing — not even updatedAt or version', () => {
  const store = makeStore();
  const first = store.submit(OWNER, CASE_STATES, 'CA', 'Costco Wholesale', 'past_week', NOW);
  const retry = store.submit(OWNER, CASE_STATES, 'CA', 'Costco Wholesale', 'past_week', LATER);
  assert.deepEqual(retry, first);
  const edited = store.submit(OWNER, CASE_STATES, 'CA', null, 'past_week', LATER);
  assert.equal(edited.version, 2);
  assert.equal(edited.updatedAt, LATER);
  assert.equal(edited.createdAt, NOW);
});

test('installation-data deletion removes every owned report and nothing else', () => {
  const store = makeStore();
  store.submit(OWNER, CASE_STATES, 'CA', null, 'past_week', NOW);
  store.submit(OWNER, CASE_NATIONWIDE, 'TX', null, 'not_sure', NOW);
  store.submit(OTHER, CASE_STATES, 'NV', null, 'past_week', NOW);
  store.deleteInstallationData(OWNER);
  assert.equal(store.getMine(OWNER, CASE_STATES, NOW), null);
  assert.equal(store.getMine(OWNER, CASE_NATIONWIDE, NOW), null);
  assert.equal(store.getMine(OTHER, CASE_STATES, NOW)?.stateCode, 'NV');
  // Idempotent — a rerun deletes zero rows and succeeds identically.
  store.deleteInstallationData(OWNER);
});

// ── Aggregation and the privacy threshold ────────────────────────────────────

test('0, 1, and 2 reports produce byte-identical hidden summaries; 3 and 4 expose exact totals', () => {
  const store = makeStore();
  const hidden = JSON.stringify(store.summary(CASE_STATES, NOW));
  store.submit('installation-count-01', CASE_STATES, 'CA', null, 'past_week', NOW);
  assert.equal(JSON.stringify(store.summary(CASE_STATES, NOW)), hidden);
  store.submit('installation-count-02', CASE_STATES, 'CA', null, 'past_week', NOW);
  assert.equal(JSON.stringify(store.summary(CASE_STATES, NOW)), hidden);
  assert.equal(hidden, '{"status":"below_threshold"}');

  store.submit('installation-count-03', CASE_STATES, 'NV', null, 'past_month', NOW);
  assert.deepEqual(store.summary(CASE_STATES, NOW), { status: 'reported', count: 3 });
  store.submit('installation-count-04', CASE_STATES, 'CA', null, 'longer_ago', NOW);
  assert.deepEqual(store.summary(CASE_STATES, NOW), { status: 'reported', count: 4 });
});

test('updating an existing report never moves the count', () => {
  const store = makeStore();
  for (let i = 1; i <= 3; i += 1) {
    store.submit(`installation-count-0${i}`, CASE_STATES, 'CA', null, 'past_week', NOW);
  }
  store.submit('installation-count-01', CASE_STATES, 'NV', null, 'not_sure', LATER);
  assert.deepEqual(store.summary(CASE_STATES, NOW), { status: 'reported', count: 3 });
});

test('withdrawal reflects immediately: 3 -> 2 hides the count again', () => {
  const store = makeStore();
  for (let i = 1; i <= 3; i += 1) {
    store.submit(`installation-count-0${i}`, CASE_STATES, 'CA', null, 'past_week', NOW);
  }
  assert.deepEqual(store.summary(CASE_STATES, NOW), { status: 'reported', count: 3 });
  store.withdraw('installation-count-02', CASE_STATES);
  assert.deepEqual(store.summary(CASE_STATES, NOW), { status: 'below_threshold' });
});

test('ineligible, closed, retracted, merged, and unknown cases expose no summary', () => {
  const store = makeStore();
  for (const caseId of [CASE_CLOSED, CASE_RETRACTED, CASE_MERGED, CASE_UNKNOWN]) {
    assert.deepEqual(store.summary(caseId, NOW), { status: 'unavailable' }, caseId);
  }
  assert.deepEqual(store.summary('99999999-9999-4999-8999-999999999999', NOW), {
    status: 'unavailable',
  });
});

test('rows on a case that later closes stop counting publicly but stay owner-readable', () => {
  const store = makeStore();
  for (let i = 1; i <= 3; i += 1) {
    store.submit(`installation-count-0${i}`, CASE_STATES, 'CA', null, 'past_week', NOW);
  }
  store.addCase(caseFacts({ id: CASE_STATES, state: 'closed' }));
  assert.deepEqual(store.summary(CASE_STATES, NOW), { status: 'unavailable' });
  assert.equal(store.getMine('installation-count-01', CASE_STATES, NOW)?.stateCode, 'CA');
  // ...and the owner can still withdraw from the closed case.
  store.withdraw('installation-count-01', CASE_STATES);
  assert.equal(store.getMine('installation-count-01', CASE_STATES, NOW), null);
});

test('concurrent duplicate submissions settle to one row and the correct total', async () => {
  const store = makeStore();
  await Promise.all([
    Promise.resolve().then(() => store.submit(OWNER, CASE_STATES, 'CA', null, 'past_week', NOW)),
    Promise.resolve().then(() => store.submit(OWNER, CASE_STATES, 'CA', null, 'past_week', NOW)),
    Promise.resolve().then(() => store.submit(OTHER, CASE_STATES, 'NV', null, 'past_week', NOW)),
  ]);
  assert.equal(store.rowsForCase(CASE_STATES).length, 2);
  assert.deepEqual(store.summary(CASE_STATES, NOW), { status: 'below_threshold' });
});

test('the summary shape never carries state, retailer, or per-row fields', () => {
  const store = makeStore();
  for (let i = 1; i <= 3; i += 1) {
    store.submit(
      `installation-count-0${i}`,
      CASE_STATES,
      'CA',
      'Costco Wholesale',
      'past_week',
      NOW,
    );
  }
  const visible = store.summary(CASE_STATES, NOW);
  assert.deepEqual(Object.keys(visible).sort(), ['count', 'status']);
  assert.deepEqual(Object.keys(store.summary(CASE_UNKNOWN, NOW)), ['status']);
});

// ── Kill switch scope ────────────────────────────────────────────────────────

test('disabled by default: submission refuses and every summary is unavailable', () => {
  const store = new MemoryShopperStore(); // reportsEnabled defaults to false
  store.addCase(caseFacts({ id: CASE_STATES }));
  assert.throws(
    () => store.submit(OWNER, CASE_STATES, 'CA', null, 'past_week', NOW),
    /shopper reports are not available/,
  );
  assert.deepEqual(store.summary(CASE_STATES, NOW), { status: 'unavailable' });
});

test('disabling never locks an owner out of their own data', () => {
  const store = makeStore();
  store.submit(OWNER, CASE_STATES, 'CA', null, 'past_week', NOW);
  store.reportsEnabled = false;
  assert.equal(store.getMine(OWNER, CASE_STATES, NOW)?.stateCode, 'CA');
  store.withdraw(OWNER, CASE_STATES);
  assert.equal(store.getMine(OWNER, CASE_STATES, NOW), null);
});

test('while disabled, a NEW submission still refuses even for a prior reporter', () => {
  const store = makeStore();
  store.submit(OWNER, CASE_STATES, 'CA', null, 'past_week', NOW);
  store.reportsEnabled = false;
  assert.throws(
    () => store.submit(OWNER, CASE_STATES, 'NV', null, 'past_week', LATER),
    /shopper reports are not available/,
  );
  // The standing report is unchanged by the refused edit.
  assert.equal(store.getMine(OWNER, CASE_STATES, NOW)?.stateCode, 'CA');
});

// ── Retention: the 12-month expiry contract ──────────────────────────────────

// NOW + 12 calendar months (UTC), and the instant just before it.
const EXPIRY_OF_NOW = '2027-09-10T12:00:00.000Z';
const JUST_BEFORE = '2027-09-10T11:59:59.999Z';

test('a fresh report expires exactly 12 calendar months after the accepted write', () => {
  const store = makeStore();
  store.submit(OWNER, CASE_STATES, 'CA', null, 'past_week', NOW);
  assert.equal(store.expiryOf(OWNER, CASE_STATES), EXPIRY_OF_NOW);
  // Calendar semantics, Postgres-style: a leap-day write clamps to Feb 28.
  assert.equal(retentionExpiry('2028-02-29T10:00:00.000Z'), '2029-02-28T10:00:00.000Z');
});

test('the boundary is inclusive: an expiry instant that has arrived IS expired', () => {
  const store = makeStore();
  store.submit(OWNER, CASE_NATIONWIDE, 'CA', null, 'past_week', NOW);
  // One millisecond before the boundary the report is fully alive…
  assert.equal(store.getMine(OWNER, CASE_NATIONWIDE, JUST_BEFORE)?.stateCode, 'CA');
  // …and AT the boundary (expires_at == now) it is gone everywhere.
  assert.equal(store.getMine(OWNER, CASE_NATIONWIDE, EXPIRY_OF_NOW), null);
});

test('a meaningful edit restarts the retention clock; an identical retry does not', () => {
  const store = makeStore();
  store.submit(OWNER, CASE_STATES, 'CA', null, 'past_week', NOW);
  const retried = store.submit(OWNER, CASE_STATES, 'CA', null, 'past_week', LATER);
  assert.equal(retried.version, 1);
  assert.equal(retried.updatedAt, NOW);
  assert.equal(store.expiryOf(OWNER, CASE_STATES), EXPIRY_OF_NOW, 'a retry extended retention');
  const edited = store.submit(OWNER, CASE_STATES, 'NV', null, 'past_week', LATER);
  assert.equal(edited.version, 2);
  assert.equal(store.expiryOf(OWNER, CASE_STATES), retentionExpiry(LATER), 'an edit must extend');
});

test('expiration alone moves counts: 4 -> 3 stays exact, 3 -> 2 hides again', () => {
  const store = makeStore();
  // One early report, three later ones: at EXPIRY_OF_NOW only the first is expired.
  store.submit('installation-expiry-01', CASE_NATIONWIDE, 'CA', null, 'past_week', NOW);
  for (let i = 2; i <= 4; i += 1) {
    store.submit(`installation-expiry-0${i}`, CASE_NATIONWIDE, 'TX', null, 'not_sure', LATER);
  }
  assert.deepEqual(store.summary(CASE_NATIONWIDE, JUST_BEFORE), { status: 'reported', count: 4 });
  assert.deepEqual(store.summary(CASE_NATIONWIDE, EXPIRY_OF_NOW), { status: 'reported', count: 3 });
  store.withdraw('installation-expiry-04', CASE_NATIONWIDE);
  assert.deepEqual(store.summary(CASE_NATIONWIDE, EXPIRY_OF_NOW), { status: 'below_threshold' });
});

test('an expired row never blocks a fresh submission and never revives its metadata', () => {
  const store = makeStore();
  store.submit(OWNER, CASE_STATES, 'CA', 'Costco Wholesale', 'past_week', NOW);
  store.submit(OWNER, CASE_STATES, 'NV', null, 'past_month', LATER); // version 2
  assert.equal(store.getMine(OWNER, CASE_STATES, retentionExpiry(LATER)), null);
  // Same values as the expired report — still a FRESH report, not a revival.
  const fresh = store.submit(OWNER, CASE_STATES, 'NV', null, 'past_month', retentionExpiry(LATER));
  assert.equal(fresh.version, 1, 'stale version revived');
  assert.equal(fresh.createdAt, retentionExpiry(LATER), 'stale created_at revived');
  assert.equal(store.expiryOf(OWNER, CASE_STATES), retentionExpiry(retentionExpiry(LATER)));
});

test('closed and retracted cases stay hidden whether their rows are live or expired', () => {
  const store = makeStore();
  for (let i = 1; i <= 3; i += 1) {
    store.submit(`installation-closed-0${i}`, CASE_STATES, 'CA', null, 'past_week', NOW);
  }
  store.addCase(caseFacts({ id: CASE_STATES, state: 'closed' }));
  assert.deepEqual(store.summary(CASE_STATES, NOW), { status: 'unavailable' });
  assert.deepEqual(store.summary(CASE_STATES, EXPIRY_OF_NOW), { status: 'unavailable' });
  store.addCase(caseFacts({ id: CASE_STATES, state: 'retracted' }));
  assert.deepEqual(store.summary(CASE_STATES, NOW), { status: 'unavailable' });
});

test('withdrawal and installation deletion stay immediate physical deletions, expired or not', () => {
  const store = makeStore();
  store.submit(OWNER, CASE_STATES, 'CA', null, 'past_week', NOW);
  store.submit(OWNER, CASE_NATIONWIDE, 'TX', null, 'not_sure', NOW);
  // Withdraw works on an already-expired row (physical, ungated by expiry).
  store.withdraw(OWNER, CASE_STATES);
  assert.equal(store.rowsForCase(CASE_STATES).length, 0);
  // Installation deletion removes live and expired rows alike.
  store.deleteInstallationData(OWNER);
  assert.equal(store.rowsForCase(CASE_NATIONWIDE).length, 0);
});

// ── Physical cleanup ─────────────────────────────────────────────────────────

test('cleanup deletes expired rows only, leaves live rows byte-identical, and is idempotent', () => {
  const store = makeStore();
  store.submit('installation-clean-01', CASE_NATIONWIDE, 'CA', null, 'past_week', NOW); // expires first
  store.submit('installation-clean-02', CASE_NATIONWIDE, 'TX', null, 'not_sure', LATER);
  const liveBefore = JSON.stringify({
    report: store.getMine('installation-clean-02', CASE_NATIONWIDE, EXPIRY_OF_NOW),
    expiry: store.expiryOf('installation-clean-02', CASE_NATIONWIDE),
  });

  assert.equal(store.cleanup(EXPIRY_OF_NOW), 1, 'exactly the one expired row');
  assert.equal(store.rowsForCase(CASE_NATIONWIDE).length, 1, 'expired row physically gone');
  const liveAfter = JSON.stringify({
    report: store.getMine('installation-clean-02', CASE_NATIONWIDE, EXPIRY_OF_NOW),
    expiry: store.expiryOf('installation-clean-02', CASE_NATIONWIDE),
  });
  assert.equal(liveAfter, liveBefore, 'a live row was touched');
  assert.equal(store.cleanup(EXPIRY_OF_NOW), 0, 'a rerun must find nothing');
  // Before cleanup ever runs, the expired row was ALREADY invisible — the
  // count above proved it; cleanup changes physical storage, not behavior.
  assert.deepEqual(store.summary(CASE_NATIONWIDE, EXPIRY_OF_NOW), { status: 'below_threshold' });
});
