/**
 * The alert entitlement gate, end to end through the worker (D2, 2026-10-14):
 * registration → scheduled refresh → the seam, the send pool and the send.
 *
 * Pinned here:
 * - known expiry stops alerts at that instant, with no refresh;
 * - a refund (or transfer, or promotional removal) is acted on at the next
 *   scheduled check, never relying on a status older than 3 hours;
 * - RevenueCat unreachable holds alerts (fail closed), and recovery sends
 *   nothing from before the entitlement began;
 * - a lapse is never backfilled after a renewal;
 * - reset continuity: the same purchase id under a new installation is
 *   entitled again after one check, and nothing links it to the old row;
 * - disable clears the purchase id; a changed id resets the entitlement;
 * - the refresh runs on its schedule, never because a recall matched;
 * - no log line, metric or error ever carries the purchase id.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { EntitlementObservation } from './entitlement';
import { refreshEntitlements } from './entitlement-refresh';
import { MemoryPushStore } from './memory-push-store';
import type { EntitlementSource } from './revenuecat-entitlement';
import { RevenueCatUnavailableError } from './revenuecat-entitlement';
import type { PushMessage, PushReceipt, PushTicket, PushTransport } from './types';
import { runPushDelivery } from './worker';

const T0 = Date.parse('2026-10-14T00:00:00.000Z');
const HOUR = 3_600_000;
const MINUTE = 60_000;
const iso = (ms: number) => new Date(T0 + ms).toISOString();

const INSTALLATION = 'a'.repeat(32);
const PURCHASE = '8a1f6c2e-3b4d-4e5f-9a0b-1c2d3e4f5a6b';

class Transport implements PushTransport {
  sent: PushMessage[] = [];
  private n = 0;
  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    this.sent.push(...messages);
    return messages.map(() => ({ status: 'ok' as const, id: `t-${(this.n += 1)}` }));
  }
  /** Every ticket's handoff succeeds (receipts are not what these tests are about). */
  async getReceipts(ids: string[]): Promise<Record<string, PushReceipt>> {
    return Object.fromEntries(ids.map((id) => [id, { status: 'ok' as const }]));
  }
}

/** RevenueCat as the test sets it: an observation per purchase id, or down. */
class FakeRevenueCat implements EntitlementSource {
  answers = new Map<string, EntitlementObservation>();
  down = false;
  calls: string[] = [];
  async check(purchaseId: string): Promise<EntitlementObservation> {
    this.calls.push(purchaseId);
    if (this.down) throw new RevenueCatUnavailableError('HTTP 503');
    return this.answers.get(purchaseId) ?? { active: false, expiresAt: null };
  }
}

let eventSeq = 0;
function addEvent(
  store: MemoryPushStore,
  createdAtMs: number,
  /** A material update on a recall first announced on `publishedAt` (default: a new recall). */
  update?: { publishedAt: string },
): string {
  eventSeq += 1;
  const id = `${String(eventSeq).padStart(8, '0')}-0000-4000-8000-0000000000ee`;
  store.addEvent({
    id,
    recallCaseId: `${String(eventSeq).padStart(8, '0')}-0000-4000-8000-0000000000cc`,
    kind: update ? 'material_update' : 'initial',
    triggerRuleId: update ? 'expansion_products' : 'new_case',
    materialChangeRef: update ? `fp-expansion-${eventSeq}` : null,
    payloadSummary: 'summary',
    createdAt: iso(createdAtMs),
    projection: {
      sourceAgency: 'FDA',
      noticeType: 'recall',
      state: 'active',
      closedYear: null,
      classification: { value: 'not_yet_classified', sourceText: null },
      title: 'Acme Recalls Trail Mix',
      summaryText: '',
      summaryHtml: null,
      reasonText: null,
      hazardCategory: 'pathogen',
      pathogenOrAllergen: 'Salmonella',
      recallingFirm: { displayName: 'Acme', rawVariants: [] },
      brands: [],
      productDescription: 'Trail Mix',
      retailerNames: [],
      heroImageUrl: null,
      geography: { scope: 'nationwide', states: [], confidence: 'stated', sourceText: null },
      affectedProducts: [],
      quantityText: null,
      illnessStatement: null,
      reportsIllness: false,
      consumerAction: null,
      contactText: null,
      officialUrl: 'https://example.gov',
      otherOfficialUrls: [],
      sourceIdentifiers: [],
      publishedAt: update?.publishedAt ?? '2026-10-14',
      lastPublicActivityAt: '2026-10-14',
    } as never,
  });
  return id;
}

function setup() {
  const store = new MemoryPushStore();
  store.pushEnabledAt = iso(0);
  const rc = new FakeRevenueCat();
  const transport = new Transport();
  const subscribe = (
    installation = INSTALLATION,
    purchaseId: string | null = PURCHASE,
    atMs = HOUR,
  ) => {
    store.register(
      installation,
      `ExponentPushToken[${installation.slice(0, 6)}]`,
      'ios',
      iso(atMs),
      undefined,
      purchaseId,
    );
    store.setPreferences(
      installation,
      { stateCodes: ['CA'], allergens: [], retailerIds: [] },
      iso(atMs),
    );
  };
  const runAt = (ms: number, extra: { dryRun?: boolean; source?: EntitlementSource | null } = {}) =>
    runPushDelivery(store, {
      transport,
      entitlements: extra.source === undefined ? rc : extra.source,
      dryRun: extra.dryRun ?? false,
      now: () => new Date(T0 + ms),
    });
  const deliveredEvents = () =>
    [...store.deliveries.values()]
      .filter((d) => d.status === 'ticket_accepted' || d.status === 'receipt_ok')
      .map((d) => d.eventId);
  return { store, rc, transport, subscribe, runAt, deliveredEvents };
}

test('a new registration gets alerts only after its first check, and nothing from before it', async () => {
  const { store, rc, subscribe, runAt, deliveredEvents } = setup();
  rc.answers.set(PURCHASE, { active: true, expiresAt: iso(30 * 24 * HOUR) });
  subscribe();
  assert.equal(store.subscriptionOf(INSTALLATION)?.entitlement.status, 'unknown');

  const before = addEvent(store, 90 * MINUTE);
  await runAt(2 * HOUR);
  assert.deepEqual(rc.calls, [PURCHASE]);
  assert.equal(store.subscriptionOf(INSTALLATION)?.entitlement.entitledSince, iso(2 * HOUR));

  const after = addEvent(store, 150 * MINUTE);
  await runAt(3 * HOUR);
  assert.deepEqual(deliveredEvents(), [after]);
  assert.ok(!deliveredEvents().includes(before));
});

test('known expiry stops alerts at that instant, even with RevenueCat down', async () => {
  const { store, rc, subscribe, runAt, deliveredEvents } = setup();
  rc.answers.set(PURCHASE, { active: true, expiresAt: iso(5 * HOUR) });
  subscribe();
  await runAt(2 * HOUR); // first check: entitled until 5 h

  // A row queued while entitled, still pending when the expiry passes.
  const queuedEvent = addEvent(store, 4 * HOUR);
  const subscription = store.subscriptionOf(INSTALLATION)!;
  await store.createDeliveryIfAbsent(queuedEvent, subscription.id, iso(4 * HOUR));
  const lateEvent = addEvent(store, 290 * MINUTE);

  rc.down = true;
  const result = await runAt(5 * HOUR + MINUTE);
  assert.deepEqual(deliveredEvents(), []);
  const queued = [...store.deliveries.values()].find((d) => d.eventId === queuedEvent)!;
  assert.equal(queued.status, 'permanent_failure');
  assert.equal(queued.failureCode, 'not_entitled');
  assert.ok(![...store.deliveries.values()].some((d) => d.eventId === lateEvent));
  assert.ok(Number(result.metrics.entitlementSkipped) >= 1);
});

test('a refund is acted on at the next scheduled check, within the documented bound', async () => {
  const { store, rc, subscribe, runAt, deliveredEvents } = setup();
  rc.answers.set(PURCHASE, { active: true, expiresAt: iso(30 * 24 * HOUR) });
  subscribe();
  await runAt(2 * HOUR);

  rc.answers.set(PURCHASE, { active: false, expiresAt: null }); // refunded in RevenueCat
  // Within the refresh interval the cached status still stands: the documented lag.
  const inLag = addEvent(store, 2 * HOUR + 10 * MINUTE);
  await runAt(2 * HOUR + 30 * MINUTE);
  assert.deepEqual(deliveredEvents(), [inLag]);
  assert.equal(rc.calls.length, 1);

  // The next due check sees the refund; nothing more is sent.
  const afterCheck = addEvent(store, 3 * HOUR);
  await runAt(3 * HOUR + 5 * MINUTE);
  assert.equal(rc.calls.length, 2);
  assert.equal(store.subscriptionOf(INSTALLATION)?.entitlement.status, 'inactive');
  assert.ok(!deliveredEvents().includes(afterCheck));
});

test('RevenueCat unreachable: alerts are held once the status is 3 h old; recovery sends no backlog', async () => {
  const { store, rc, subscribe, runAt, deliveredEvents } = setup();
  rc.answers.set(PURCHASE, { active: true, expiresAt: iso(30 * 24 * HOUR) });
  subscribe();
  await runAt(2 * HOUR); // checked at 2 h

  rc.down = true;
  const held = addEvent(store, 5 * HOUR + 30 * MINUTE);
  const outage = await runAt(5 * HOUR + 31 * MINUTE); // 3 h 31 min since the last check
  assert.deepEqual(deliveredEvents(), []);
  assert.ok(Number(outage.metrics.entitlementUnverified) >= 1);
  assert.equal(outage.outcome, 'partial');
  assert.match(String(outage.error), /RevenueCat entitlement check failed \(HTTP 503\)/);

  // Recovery: still continuously entitled, so the held recall goes out now.
  rc.down = false;
  await runAt(6 * HOUR);
  assert.deepEqual(deliveredEvents(), [held]);
});

test('normal use: continuous renewals keep the horizon, so no recall is lost at a renewal', async () => {
  const { store, rc, subscribe, runAt, deliveredEvents } = setup();
  const DAY = 24 * HOUR;
  // A monthly subscriber: each period ends, and RevenueCat reports the renewal
  // (a later expiry) shortly before it does.
  rc.answers.set(PURCHASE, { active: true, expiresAt: iso(30 * DAY) });
  subscribe();
  await runAt(2 * HOUR);
  const since = store.subscriptionOf(INSTALLATION)?.entitlement.entitledSince;
  assert.equal(since, iso(2 * HOUR));

  const expected: string[] = [];
  for (const period of [1, 2, 3]) {
    const end = period * 30 * DAY;
    // Within the last hour before expiry the row is checked every run, so the
    // renewal is seen before the old expiry passes.
    rc.answers.set(PURCHASE, { active: true, expiresAt: iso(end + 30 * DAY) });
    await runAt(end - 40 * MINUTE);
    // Recalls just before and just after the renewal both go out.
    expected.push(addEvent(store, end - 20 * MINUTE));
    await runAt(end - 10 * MINUTE);
    expected.push(addEvent(store, end + 5 * MINUTE));
    await runAt(end + 10 * MINUTE);
    assert.equal(store.subscriptionOf(INSTALLATION)?.entitlement.entitledSince, since);
  }
  assert.deepEqual(deliveredEvents().sort(), expected.sort());
});

test('normal use: an update to an old recall reaches a newer subscriber', async () => {
  const { store, rc, subscribe, runAt, deliveredEvents } = setup();
  rc.answers.set(PURCHASE, { active: true, expiresAt: iso(30 * 24 * HOUR) });
  subscribe();
  await runAt(2 * HOUR); // entitled since 2 h on 2026-10-14
  // A recall first announced months before this subscription began receives a
  // material update (an expansion) while the subscription is active. The
  // horizon judges the UPDATE's own ledger time, not the original announcement.
  const update = addEvent(store, 3 * HOUR, { publishedAt: '2026-06-01' });
  await runAt(3 * HOUR + 10 * MINUTE);
  assert.deepEqual(deliveredEvents(), [update]);
});

test('a lapse is never backfilled after a renewal', async () => {
  const { store, rc, subscribe, runAt, deliveredEvents } = setup();
  rc.answers.set(PURCHASE, { active: true, expiresAt: iso(4 * HOUR) });
  subscribe();
  await runAt(2 * HOUR);

  rc.answers.set(PURCHASE, { active: false, expiresAt: null });
  const duringLapse = addEvent(store, 5 * HOUR);
  await runAt(5 * HOUR + 10 * MINUTE);

  rc.answers.set(PURCHASE, { active: true, expiresAt: iso(30 * 24 * HOUR) }); // renewed
  await runAt(6 * HOUR + 20 * MINUTE);
  await runAt(7 * HOUR + 30 * MINUTE);
  assert.ok(!deliveredEvents().includes(duringLapse));

  const afterRenewal = addEvent(store, 8 * HOUR);
  await runAt(8 * HOUR + 10 * MINUTE);
  assert.deepEqual(deliveredEvents(), [afterRenewal]);
});

test('reset continuity: the same purchase id under a new installation is entitled again, with no trace of the old row', async () => {
  const { store, rc, subscribe, runAt, deliveredEvents } = setup();
  rc.answers.set(PURCHASE, { active: true, expiresAt: iso(30 * 24 * HOUR) });
  subscribe();
  await runAt(2 * HOUR);

  store.deleteInstallationData(INSTALLATION); // "Reset app and delete my data"
  assert.ok(!JSON.stringify([...store.subscriptions.values()]).includes(PURCHASE));
  assert.ok(!JSON.stringify([...store.deliveries.values()]).includes(PURCHASE));

  const fresh = 'b'.repeat(32);
  subscribe(fresh, PURCHASE, 3 * HOUR); // the purchase id survives the reset on the device
  await runAt(3 * HOUR + 10 * MINUTE);
  assert.equal(store.subscriptionOf(fresh)?.entitlement.status, 'active');
  const after = addEvent(store, 4 * HOUR);
  await runAt(4 * HOUR + 10 * MINUTE);
  assert.deepEqual(deliveredEvents(), [after]);
  assert.equal(store.subscriptions.size, 1);
});

test('turning alerts off clears the purchase id and the entitlement; on again needs a fresh check', async () => {
  const { store, rc, subscribe, runAt } = setup();
  rc.answers.set(PURCHASE, { active: true, expiresAt: iso(30 * 24 * HOUR) });
  subscribe();
  await runAt(2 * HOUR);

  store.userDisable(INSTALLATION, iso(3 * HOUR));
  const off = store.subscriptionOf(INSTALLATION)!;
  assert.equal(off.purchaseId, null);
  assert.equal(off.entitlement.status, 'unknown');
  assert.equal(off.entitlement.checkedAt, null);

  subscribe(INSTALLATION, PURCHASE, 4 * HOUR);
  assert.equal(store.subscriptionOf(INSTALLATION)?.entitlement.status, 'unknown');

  // The server's own disables clear it too.
  await runAt(4 * HOUR + 10 * MINUTE);
  const row = store.subscriptionOf(INSTALLATION)!;
  await store.disableSubscription(row.id, 'device_not_registered', iso(5 * HOUR));
  assert.equal(store.subscriptionOf(INSTALLATION)?.purchaseId, null);
});

test('a changed purchase id resets the entitlement, and a check made under the old id never lands', async () => {
  const { store, rc, subscribe, runAt } = setup();
  rc.answers.set(PURCHASE, { active: true, expiresAt: iso(30 * 24 * HOUR) });
  subscribe();
  await runAt(2 * HOUR);

  const other = '0f0e0d0c-0b0a-4908-8706-050403020100';
  subscribe(INSTALLATION, other, 3 * HOUR);
  const row = store.subscriptionOf(INSTALLATION)!;
  assert.equal(row.entitlement.status, 'unknown');
  const landed = await store.recordEntitlement(row.id, PURCHASE, {
    status: 'active',
    expiresAt: iso(30 * 24 * HOUR),
    checkedAt: iso(3 * HOUR),
    entitledSince: iso(3 * HOUR),
  });
  assert.equal(landed, false);
  assert.equal(store.subscriptionOf(INSTALLATION)?.entitlement.status, 'unknown');
});

test('an older client that sends no purchase id is never checked and never sent to', async () => {
  const { store, rc, subscribe, runAt, deliveredEvents } = setup();
  subscribe(INSTALLATION, null);
  addEvent(store, 90 * MINUTE);
  await runAt(2 * HOUR);
  assert.deepEqual(rc.calls, []);
  assert.deepEqual(deliveredEvents(), []);
});

test('no entitlement source configured: nothing is sent, and the run says why', async () => {
  const { store, subscribe, runAt, deliveredEvents } = setup();
  subscribe();
  addEvent(store, 90 * MINUTE);
  const result = await runAt(2 * HOUR, { source: null });
  assert.deepEqual(deliveredEvents(), []);
  assert.equal(result.metrics.entitlementSource, 'unconfigured');
  assert.equal(result.outcome, 'partial');
  assert.match(String(result.error), /entitlement check not configured/);
});

test('the refresh follows its schedule, never a match', async () => {
  const { store, rc, subscribe, runAt } = setup();
  const second = 'c'.repeat(32);
  const secondPurchase = '11111111-2222-4333-8444-555555555555';
  rc.answers.set(PURCHASE, { active: true, expiresAt: iso(30 * 24 * HOUR) });
  rc.answers.set(secondPurchase, { active: true, expiresAt: iso(30 * 24 * HOUR) });
  subscribe();
  subscribe(second, secondPurchase);

  // No event at all: both rows are still checked (they are due).
  await runAt(2 * HOUR);
  assert.deepEqual(new Set(rc.calls), new Set([PURCHASE, secondPurchase]));

  // A recall that matches both, 30 min later: nobody is due, nobody is checked.
  rc.calls = [];
  addEvent(store, 2 * HOUR + 20 * MINUTE);
  await runAt(2 * HOUR + 30 * MINUTE);
  assert.deepEqual(rc.calls, []);
});

test('no log line, metric or error carries the purchase id', async () => {
  const { store, rc, subscribe, runAt } = setup();
  rc.answers.set(PURCHASE, { active: true, expiresAt: iso(30 * 24 * HOUR) });
  subscribe();
  addEvent(store, 90 * MINUTE);

  const lines: string[] = [];
  const saved = { log: console.log, warn: console.warn, error: console.error };
  for (const level of ['log', 'warn', 'error'] as const) {
    console[level] = (...args: unknown[]) => void lines.push(args.map(String).join(' '));
  }
  const results = [];
  try {
    results.push(await runAt(2 * HOUR));
    rc.down = true;
    addEvent(store, 5 * HOUR + 30 * MINUTE);
    results.push(await runAt(5 * HOUR + 40 * MINUTE));
    results.push(await runAt(6 * HOUR, { dryRun: true }));
  } finally {
    Object.assign(console, saved);
  }
  assert.ok(lines.length > 0);
  for (const line of lines) assert.ok(!line.includes(PURCHASE), line);
  for (const result of results) assert.ok(!JSON.stringify(result).includes(PURCHASE));
  for (const delivery of store.deliveries.values()) {
    assert.ok(!JSON.stringify(delivery).includes(PURCHASE));
  }
});

test('a dry run checks but writes nothing', async () => {
  const { store, rc, subscribe, runAt } = setup();
  rc.answers.set(PURCHASE, { active: true, expiresAt: iso(30 * 24 * HOUR) });
  subscribe();
  addEvent(store, 2 * HOUR + 30 * MINUTE);
  const result = await runAt(2 * HOUR, { dryRun: true });
  assert.equal(rc.calls.length, 1);
  assert.equal(result.metrics.entitlementActive, 1);
  assert.equal(store.subscriptionOf(INSTALLATION)?.entitlement.status, 'unknown');
  assert.equal(store.deliveries.size, 0);
});

test('the per-run budget defers the rest, oldest-checked first', async () => {
  const store = new MemoryPushStore();
  const rc = new FakeRevenueCat();
  for (const n of [1, 2, 3]) {
    const purchase = `${n}`.repeat(8) + '-0000-4000-8000-000000000000';
    store.register(
      `${n}`.repeat(32),
      `ExponentPushToken[${n}]`,
      'ios',
      iso(0),
      undefined,
      purchase,
    );
    rc.answers.set(purchase, { active: true, expiresAt: iso(30 * 24 * HOUR) });
  }
  const result = await refreshEntitlements(store, rc, {
    nowIso: iso(HOUR),
    dryRun: false,
    maxChecks: 1,
  });
  assert.equal(result.metrics.entitlementRowsDue, 3);
  assert.equal(result.metrics.entitlementChecks, 1);
  assert.equal(result.metrics.entitlementDeferred, 2);
});

test('a rate-limited RevenueCat ends the run’s checking at once; nothing is written', async () => {
  const store = new MemoryPushStore();
  let calls = 0;
  const limited: EntitlementSource = {
    async check() {
      calls += 1;
      throw new RevenueCatUnavailableError('HTTP 429', true);
    },
  };
  for (const n of [1, 2, 3]) {
    const purchase = `${n}`.repeat(8) + '-0000-4000-8000-000000000000';
    store.register(
      `${n}`.repeat(32),
      `ExponentPushToken[${n}]`,
      'ios',
      iso(0),
      undefined,
      purchase,
    );
  }
  const result = await refreshEntitlements(store, limited, { nowIso: iso(HOUR), dryRun: false });
  assert.equal(calls, 1);
  assert.equal(result.metrics.entitlementCheckFailures, 1);
  assert.equal(result.metrics.entitlementDeferred, 2);
  assert.deepEqual(result.errors, ['RevenueCat entitlement check failed (HTTP 429)']);
  for (const row of store.subscriptions.values()) assert.equal(row.entitlement.status, 'unknown');
});
