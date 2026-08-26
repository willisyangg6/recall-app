/**
 * Delivery worker invariants (§C2):
 * - activation + subscription horizons make old events unreachable
 * - suppression is never overridden
 * - (event, subscription) uniqueness makes reruns and retries idempotent
 * - tickets are never conflated with delivery; receipts settle the handoff
 * - DeviceNotRegistered disables the token and stops future sends
 * - transient failures retry with bounded backoff; permanent ones stop
 * - registration semantics (mirrored from the SQL RPCs) are idempotent
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MemoryPushStore } from './memory-push-store';
import type { PushMessage, PushReceipt, PushTicket, PushTransport } from './types';
import { eligibleSubscriptions, retryBackoffMs, runPushDelivery } from './worker';

const T0 = Date.parse('2026-09-01T00:00:00.000Z');
const HOUR = 3_600_000;
const MINUTE = 60_000;

function iso(offsetMs: number): string {
  return new Date(T0 + offsetMs).toISOString();
}

class FakeTransport implements PushTransport {
  sends: PushMessage[][] = [];
  receiptRequests: string[][] = [];
  receipts: Record<string, PushReceipt> = {};
  failSends = 0;
  ticketFor: (message: PushMessage) => PushTicket;
  private counter = 0;

  constructor() {
    this.ticketFor = () => ({ status: 'ok', id: `ticket-${(this.counter += 1)}` });
  }

  get sentMessages(): PushMessage[] {
    return this.sends.flat();
  }

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    if (this.failSends > 0) {
      this.failSends -= 1;
      throw new Error('network down');
    }
    this.sends.push(messages);
    return messages.map((message) => this.ticketFor(message));
  }

  async getReceipts(ticketIds: string[]): Promise<Record<string, PushReceipt>> {
    this.receiptRequests.push(ticketIds);
    const out: Record<string, PushReceipt> = {};
    for (const id of ticketIds) if (this.receipts[id]) out[id] = this.receipts[id];
    return out;
  }
}

function fixtureProjection(
  overrides: {
    title?: string;
    geography?: { scope: 'states' | 'nationwide' | 'unknown'; states: string[] };
    pathogenOrAllergen?: string | null;
    retailerNames?: string[];
  } = {},
) {
  return {
    sourceAgency: 'FDA' as const,
    noticeType: 'recall' as const,
    state: 'active' as const,
    closedYear: null,
    classification: { value: 'not_yet_classified' as const, sourceText: null },
    title: overrides.title ?? 'Acme Recalls Trail Mix',
    summaryText: '',
    summaryHtml: null,
    reasonText: null,
    hazardCategory: 'allergen' as const,
    pathogenOrAllergen:
      overrides.pathogenOrAllergen === undefined ? 'peanut' : overrides.pathogenOrAllergen,
    recallingFirm: { displayName: 'Acme', rawVariants: [] },
    brands: [],
    productDescription: 'Trail Mix',
    retailerNames: overrides.retailerNames ?? [],
    heroImageUrl: null,
    geography: {
      scope: overrides.geography?.scope ?? ('unknown' as const),
      states: overrides.geography?.states ?? [],
      confidence: 'stated' as const,
      sourceText: null,
    },
    affectedProducts: [],
    quantityText: null,
    illnessStatement: null,
    reportsIllness: false,
    consumerAction: null,
    contactText: null,
    officialUrl: 'https://example.gov',
    otherOfficialUrls: [],
    sourceIdentifiers: [],
    publishedAt: '2026-09-01',
    lastPublicActivityAt: '2026-09-01',
  };
}

let eventCounter = 0;
function addEvent(
  store: MemoryPushStore,
  createdAtMs: number,
  overrides: {
    suppressed?: string | null;
    title?: string;
    geography?: { scope: 'states' | 'nationwide' | 'unknown'; states: string[] };
    pathogenOrAllergen?: string | null;
    retailerNames?: string[];
  } = {},
): string {
  eventCounter += 1;
  const id = `${String(eventCounter).padStart(8, '0')}-0000-4000-8000-000000000000`;
  store.addEvent({
    id,
    recallCaseId: `${String(eventCounter).padStart(8, '0')}-0000-4000-8000-00000000cccc`,
    kind: 'initial',
    triggerRuleId: 'new_case',
    payloadSummary: 'summary',
    createdAt: iso(createdAtMs),
    suppressed: overrides.suppressed ?? null,
    projection: fixtureProjection(overrides),
  });
  return id;
}

function setup(activatedAtMs: number | null = 0): {
  store: MemoryPushStore;
  transport: FakeTransport;
  runAt: (ms: number, dryRun?: boolean) => ReturnType<typeof runPushDelivery>;
} {
  const store = new MemoryPushStore();
  if (activatedAtMs !== null) store.pushEnabledAt = iso(activatedAtMs);
  const transport = new FakeTransport();
  return {
    store,
    transport,
    runAt: (ms, dryRun = false) =>
      runPushDelivery(store, { transport, dryRun, now: () => new Date(T0 + ms) }),
  };
}

test('not activated: no-send no-op even with waiting subscriptions and events', async () => {
  const { store, transport, runAt } = setup(null);
  store.register('a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  addEvent(store, HOUR);
  const result = await runAt(2 * HOUR);
  assert.equal(result.outcome, 'succeeded');
  assert.equal(result.metrics.activation, 'not_activated');
  assert.equal(transport.sends.length, 0);
  assert.equal(store.deliveries.size, 0);
});

test('pre-activation deliverable events are excluded forever', async () => {
  const { store, transport, runAt } = setup(0);
  store.register('a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(-2 * HOUR));
  addEvent(store, -HOUR); // deliverable, but created before the horizon
  const result = await runAt(HOUR);
  assert.equal(result.metrics.deliveriesCreated, 0);
  assert.equal(result.metrics.sent, 0);
  assert.equal(result.metrics.skippedPreActivation, 1);
  assert.equal(transport.sends.length, 0);
});

test('post-activation event: one delivery, one send, ticket persisted — and reruns stay silent', async () => {
  const { store, transport, runAt } = setup(0);
  store.register('a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  addEvent(store, HOUR);

  const first = await runAt(2 * HOUR);
  assert.equal(first.metrics.deliveriesCreated, 1);
  assert.equal(first.metrics.sent, 1);
  assert.equal(first.metrics.ticketsAccepted, 1);
  const delivery = [...store.deliveries.values()][0];
  assert.equal(delivery.status, 'ticket_accepted');
  assert.equal(delivery.ticketId, 'ticket-1');
  assert.equal(delivery.attempts, 1);

  // Scheduler retry / rerun: the persisted ticket blocks any duplicate send.
  const second = await runAt(2 * HOUR + 30 * MINUTE);
  assert.equal(second.metrics.deliveriesCreated, 0);
  assert.equal(second.metrics.sent, 0);
  assert.equal(transport.sentMessages.length, 1);
});

test('a subscription enabled after the event never receives it', async () => {
  const { store, runAt } = setup(0);
  store.register('a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(30 * MINUTE));
  store.register('b'.repeat(32), 'ExponentPushToken[b]', 'android', iso(2 * HOUR)); // late
  addEvent(store, HOUR);
  const result = await runAt(3 * HOUR);
  assert.equal(result.metrics.deliveriesCreated, 1);
  assert.equal(result.metrics.subscriptionHorizonSkipped, 1);
  const delivery = [...store.deliveries.values()][0];
  const early = [...store.subscriptions.values()].find((s) => s.installationId === 'a'.repeat(32));
  assert.equal(delivery.subscriptionId, early?.id);
});

test('suppressed events are never delivered, C2 cannot override suppression', async () => {
  const { store, transport, runAt } = setup(0);
  store.register('a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  addEvent(store, HOUR, { suppressed: 'backfill' });
  addEvent(store, HOUR, { suppressed: 'coalesced' });
  const result = await runAt(2 * HOUR);
  assert.equal(result.metrics.deliveriesCreated, 0);
  assert.equal(result.metrics.suppressedSkipped, 2);
  assert.equal(transport.sends.length, 0);
});

test('one event, two devices: exactly one delivery per device', async () => {
  const { store, transport, runAt } = setup(0);
  store.register('a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  store.register('b'.repeat(32), 'ExponentPushToken[b]', 'android', iso(-HOUR));
  addEvent(store, HOUR);
  const result = await runAt(2 * HOUR);
  assert.equal(result.metrics.deliveriesCreated, 2);
  assert.equal(result.metrics.sent, 2);
  assert.equal(transport.sentMessages.length, 2);
  const tokens = transport.sentMessages.map((m) => m.to).sort();
  assert.deepEqual(tokens, ['ExponentPushToken[a]', 'ExponentPushToken[b]']);
});

test('receipt ok marks receipt_ok only after the receipt delay', async () => {
  const { store, transport, runAt } = setup(0);
  store.register('a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  addEvent(store, HOUR);
  await runAt(2 * HOUR);
  transport.receipts['ticket-1'] = { status: 'ok' };

  // Too soon (< 15 min): the ticket is not even queried.
  await runAt(2 * HOUR + 10 * MINUTE);
  assert.equal([...store.deliveries.values()][0].status, 'ticket_accepted');

  const result = await runAt(2 * HOUR + 30 * MINUTE);
  assert.equal(result.metrics.receiptsOk, 1);
  const delivery = [...store.deliveries.values()][0];
  assert.equal(delivery.status, 'receipt_ok');
  assert.ok(delivery.receiptCheckedAt);
});

test('receipt DeviceNotRegistered disables the token, keeps history, stops future sends', async () => {
  const { store, transport, runAt } = setup(0);
  store.register('a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  addEvent(store, HOUR);
  await runAt(2 * HOUR);
  transport.receipts['ticket-1'] = {
    status: 'error',
    message: 'device gone',
    details: { error: 'DeviceNotRegistered' },
  };
  const result = await runAt(2 * HOUR + 30 * MINUTE);
  assert.equal(result.metrics.tokensDisabled, 1);

  const delivery = [...store.deliveries.values()][0];
  assert.equal(delivery.status, 'permanent_failure');
  assert.equal(delivery.failureCode, 'DeviceNotRegistered');
  const subscription = [...store.subscriptions.values()][0];
  assert.equal(subscription.enabled, false);
  assert.equal(subscription.disabledReason, 'device_not_registered');
  assert.equal(store.deliveries.size, 1); // history retained

  // A later event goes nowhere: the dead subscription is out of the pool.
  addEvent(store, 3 * HOUR);
  const later = await runAt(4 * HOUR);
  assert.equal(later.metrics.deliveriesCreated, 0);
  assert.equal(transport.sentMessages.length, 1);

  // Re-registration with a fresh token re-enables with a new horizon.
  store.register('a'.repeat(32), 'ExponentPushToken[a2]', 'ios', iso(5 * HOUR));
  addEvent(store, 6 * HOUR);
  const revived = await runAt(7 * HOUR);
  assert.equal(revived.metrics.deliveriesCreated, 1);
  assert.equal(transport.sentMessages.at(-1)?.to, 'ExponentPushToken[a2]');
});

test('ticket-level DeviceNotRegistered also disables immediately', async () => {
  const { store, transport, runAt } = setup(0);
  store.register('a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  addEvent(store, HOUR);
  transport.ticketFor = () => ({
    status: 'error',
    message: 'not registered',
    details: { error: 'DeviceNotRegistered' },
  });
  const result = await runAt(2 * HOUR);
  assert.equal(result.metrics.tokensDisabled, 1);
  assert.equal([...store.deliveries.values()][0].status, 'permanent_failure');
  assert.equal([...store.subscriptions.values()][0].enabled, false);
});

test('permanent ticket errors stop retrying; transient ones retry after backoff', async () => {
  const { store, transport, runAt } = setup(0);
  store.register('a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  addEvent(store, HOUR);
  transport.ticketFor = () => ({
    status: 'error',
    message: 'too big',
    details: { error: 'MessageTooBig' },
  });
  await runAt(2 * HOUR);
  assert.equal([...store.deliveries.values()][0].status, 'permanent_failure');
  await runAt(3 * HOUR);
  assert.equal(transport.sentMessages.length, 1); // never retried

  // Transient: MessageRateExceeded goes retryable and resends after backoff.
  const rate = setup(0);
  rate.store.register('b'.repeat(32), 'ExponentPushToken[b]', 'ios', iso(-HOUR));
  addEvent(rate.store, HOUR);
  rate.transport.ticketFor = () => ({
    status: 'error',
    message: 'slow down',
    details: { error: 'MessageRateExceeded' },
  });
  await rate.runAt(2 * HOUR);
  assert.equal([...rate.store.deliveries.values()][0].status, 'retryable_failure');
  rate.transport.ticketFor = () => ({ status: 'ok', id: 'ticket-ok' });
  // Inside the backoff window: deferred.
  await rate.runAt(2 * HOUR + 10 * MINUTE);
  assert.equal([...rate.store.deliveries.values()][0].status, 'retryable_failure');
  // After the 30-minute backoff: retried and accepted.
  await rate.runAt(2 * HOUR + 31 * MINUTE);
  assert.equal([...rate.store.deliveries.values()][0].status, 'ticket_accepted');
  assert.equal([...rate.store.deliveries.values()][0].attempts, 2);
});

test('a network failure marks the chunk retryable and the run partial', async () => {
  const { store, transport, runAt } = setup(0);
  store.register('a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  addEvent(store, HOUR);
  transport.failSends = 1;
  const result = await runAt(2 * HOUR);
  assert.equal(result.outcome, 'partial');
  const delivery = [...store.deliveries.values()][0];
  assert.equal(delivery.status, 'retryable_failure');
  assert.equal(delivery.failureCode, 'network');
  assert.equal(delivery.attempts, 1);

  const retried = await runAt(2 * HOUR + 31 * MINUTE);
  assert.equal(retried.outcome, 'succeeded');
  assert.equal([...store.deliveries.values()][0].status, 'ticket_accepted');
});

test('retries are bounded: attempts exhaust into permanent_failure', async () => {
  const { store, runAt } = setup(0);
  store.register('a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  const eventId = addEvent(store, HOUR);
  const subscription = [...store.subscriptions.values()][0];
  await store.createDeliveryIfAbsent(eventId, subscription.id, iso(2 * HOUR));
  const delivery = [...store.deliveries.values()][0];
  delivery.status = 'retryable_failure';
  delivery.attempts = 5;
  delivery.updatedAt = iso(2 * HOUR);
  const result = await runAt(12 * HOUR);
  assert.equal(result.metrics.sent, 0);
  assert.equal([...store.deliveries.values()][0].status, 'permanent_failure');
  assert.equal([...store.deliveries.values()][0].failureCode, 'attempts_exhausted');
});

test('a crashed run\'s "sending" row is recovered and retried', async () => {
  const { store, transport, runAt } = setup(0);
  store.register('a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  const eventId = addEvent(store, HOUR);
  const subscription = [...store.subscriptions.values()][0];
  await store.createDeliveryIfAbsent(eventId, subscription.id, iso(2 * HOUR));
  const delivery = [...store.deliveries.values()][0];
  delivery.status = 'sending';
  delivery.attempts = 1;
  const result = await runAt(3 * HOUR);
  assert.equal(result.metrics.sent, 1);
  assert.equal([...store.deliveries.values()][0].status, 'ticket_accepted');
  assert.equal([...store.deliveries.values()][0].attempts, 2);
  assert.equal(transport.sentMessages.length, 1);
});

test('a delivery whose subscription was disabled before send is never sent', async () => {
  const { store, transport, runAt } = setup(0);
  store.register('a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  addEvent(store, HOUR);
  transport.failSends = 1;
  await runAt(2 * HOUR); // delivery exists as retryable
  store.userDisable('a'.repeat(32), iso(2 * HOUR + 5 * MINUTE));
  await runAt(3 * HOUR);
  const delivery = [...store.deliveries.values()][0];
  assert.equal(delivery.status, 'permanent_failure');
  assert.equal(delivery.failureCode, 'subscription_disabled');
  assert.equal(transport.sentMessages.length, 0);
});

test('dry run: accurate would-counts, zero writes, zero Expo traffic', async () => {
  const { store, transport, runAt } = setup(0);
  store.register('a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  addEvent(store, HOUR);
  addEvent(store, -HOUR); // pre-activation
  addEvent(store, HOUR, { suppressed: 'backfill' });
  const result = await runAt(2 * HOUR, true);
  assert.equal(result.metrics.deliveriesCreated, 1);
  assert.equal(result.metrics.sent, 1);
  assert.equal(result.metrics.skippedPreActivation, 1);
  assert.equal(result.metrics.suppressedSkipped, 1);
  assert.equal(store.deliveries.size, 0);
  assert.equal(transport.sends.length, 0);
  assert.equal(transport.receiptRequests.length, 0);

  // After a real run, a dry rerun reports nothing left to do.
  await runAt(2 * HOUR);
  const again = await runAt(2 * HOUR + 5 * MINUTE, true);
  assert.equal(again.metrics.deliveriesCreated, 0);
  assert.equal(again.metrics.sent, 0);
});

test('registration is idempotent; token reassignment disables the stale install', () => {
  const store = new MemoryPushStore();
  store.register('a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(0));
  store.register('a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(HOUR));
  assert.equal(store.subscriptions.size, 1);
  assert.equal([...store.subscriptions.values()][0].enabledAt, iso(0)); // horizon kept

  // Token update on the same install: same row, new token.
  store.register('a'.repeat(32), 'ExponentPushToken[a2]', 'ios', iso(2 * HOUR));
  assert.equal(store.subscriptions.size, 1);
  assert.equal([...store.subscriptions.values()][0].expoPushToken, 'ExponentPushToken[a2]');

  // Reinstall: a new installation claims the same token — old row disabled.
  store.register('r'.repeat(32), 'ExponentPushToken[a2]', 'ios', iso(3 * HOUR));
  const rows = [...store.subscriptions.values()];
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.installationId === 'a'.repeat(32))?.enabled, false);
  assert.equal(
    rows.find((r) => r.installationId === 'a'.repeat(32))?.disabledReason,
    'token_reassigned',
  );
  assert.equal(rows.find((r) => r.installationId === 'r'.repeat(32))?.enabled, true);
});

test('disable + re-enable moves the horizon: dark-period events stay unsent', async () => {
  const { store, runAt } = setup(0);
  store.register('a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  store.userDisable('a'.repeat(32), iso(HOUR));
  addEvent(store, 2 * HOUR); // created while alerts were off
  store.register('a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(3 * HOUR));
  const result = await runAt(4 * HOUR);
  assert.equal(result.metrics.deliveriesCreated, 0);
  assert.equal(result.metrics.subscriptionHorizonSkipped, 1);

  addEvent(store, 5 * HOUR); // after re-enable: delivered
  const later = await runAt(6 * HOUR);
  assert.equal(later.metrics.deliveriesCreated, 1);
});

test('eligibility seam: the later of activation and enabled_at wins', () => {
  const subscriptions = [
    {
      id: 's1',
      installationId: 'i1',
      expoPushToken: 't1',
      platform: 'ios' as const,
      enabled: true,
      enabledAt: iso(-HOUR),
    },
    {
      id: 's2',
      installationId: 'i2',
      expoPushToken: 't2',
      platform: 'ios' as const,
      enabled: true,
      enabledAt: iso(2 * HOUR),
    },
    {
      id: 's3',
      installationId: 'i3',
      expoPushToken: 't3',
      platform: 'ios' as const,
      enabled: false,
      enabledAt: iso(-HOUR),
    },
  ];
  const eligible = eligibleSubscriptions(
    { createdAt: iso(HOUR), projection: fixtureProjection() },
    subscriptions,
    iso(0),
  );
  assert.deepEqual(
    eligible.map((s) => s.id),
    ['s1'],
  );
});

test('retry backoff grows exponentially and caps at 6 hours', () => {
  assert.equal(retryBackoffMs(1), 30 * MINUTE);
  assert.equal(retryBackoffMs(2), HOUR);
  assert.equal(retryBackoffMs(3), 2 * HOUR);
  assert.equal(retryBackoffMs(10), 6 * HOUR);
});

// ── Phase C3: personalized eligibility ───────────────────────────────────────

function subIdFor(store: MemoryPushStore, installationId: string): string {
  const row = [...store.subscriptions.values()].find((s) => s.installationId === installationId);
  assert.ok(row, `no subscription for ${installationId}`);
  return row.id;
}

test('personalized: a state-matching event delivers to the matching state only', async () => {
  const { store, transport, runAt } = setup(0);
  const ca = 'a'.repeat(32);
  const tx = 'b'.repeat(32);
  store.register(ca, 'ExponentPushToken[ca]', 'ios', iso(HOUR));
  store.register(tx, 'ExponentPushToken[tx]', 'ios', iso(HOUR));
  store.setPreferences(ca, { stateCode: 'CA', allergens: [], retailerIds: [] }, iso(HOUR));
  store.setPreferences(tx, { stateCode: 'TX', allergens: [], retailerIds: [] }, iso(HOUR));
  addEvent(store, 2 * HOUR, { geography: { scope: 'states', states: ['California'] } });

  // Dry run first: exactly one candidate, zero writes, zero traffic.
  const dry = await runAt(3 * HOUR, true);
  assert.equal(dry.metrics.deliveriesCreated, 1);
  assert.equal(dry.metrics.preferenceSkipped, 1);
  assert.equal(store.deliveries.size, 0);

  const result = await runAt(3 * HOUR);
  assert.equal(result.metrics.deliveriesCreated, 1);
  assert.equal(result.metrics.sent, 1);
  assert.equal(result.metrics.preferenceSkipped, 1);
  const delivery = [...store.deliveries.values()][0];
  assert.equal(delivery.subscriptionId, subIdFor(store, ca));
  assert.equal(transport.sentMessages.length, 1);
  assert.equal(transport.sentMessages[0].to, 'ExponentPushToken[ca]');
});

test('personalized: two matching users get one delivery candidate each', async () => {
  const { store, runAt } = setup(0);
  const one = 'a'.repeat(32);
  const two = 'b'.repeat(32);
  store.register(one, 'ExponentPushToken[a]', 'ios', iso(HOUR));
  store.register(two, 'ExponentPushToken[b]', 'android', iso(HOUR));
  store.setPreferences(one, { stateCode: 'CA', allergens: [], retailerIds: [] }, iso(HOUR));
  store.setPreferences(two, { stateCode: 'CA', allergens: [], retailerIds: [] }, iso(HOUR));
  addEvent(store, 2 * HOUR, { geography: { scope: 'nationwide', states: [] } });
  const result = await runAt(3 * HOUR);
  assert.equal(result.metrics.deliveriesCreated, 2);
  assert.equal(result.metrics.sent, 2);

  // Scheduler retry: the unique (event, subscription) pairs stay unique.
  const rerun = await runAt(3 * HOUR + 30 * MINUTE);
  assert.equal(rerun.metrics.deliveriesCreated, 0);
  assert.equal(rerun.metrics.sent, 0);
  assert.equal(store.deliveries.size, 2);
});

test('personalized: unknown geography delivers only with an allergen/retailer signal', async () => {
  const { store, transport, runAt } = setup(0);
  const withRetailer = 'a'.repeat(32);
  const stateOnly = 'b'.repeat(32);
  const withAllergen = 'c'.repeat(32);
  for (const [installation, token] of [
    [withRetailer, 'ExponentPushToken[r]'],
    [stateOnly, 'ExponentPushToken[s]'],
    [withAllergen, 'ExponentPushToken[al]'],
  ] as const) {
    store.register(installation, token, 'ios', iso(HOUR));
  }
  store.setPreferences(
    withRetailer,
    { stateCode: 'CA', allergens: [], retailerIds: ['costco'] },
    iso(HOUR),
  );
  store.setPreferences(stateOnly, { stateCode: 'CA', allergens: [], retailerIds: [] }, iso(HOUR));
  store.setPreferences(
    withAllergen,
    { stateCode: 'CA', allergens: ['peanut'], retailerIds: [] },
    iso(HOUR),
  );
  addEvent(store, 2 * HOUR, {
    geography: { scope: 'unknown', states: [] },
    pathogenOrAllergen: 'undeclared peanuts',
    retailerNames: ['Costco'],
  });
  const result = await runAt(3 * HOUR);
  assert.equal(result.metrics.deliveriesCreated, 2);
  assert.equal(result.metrics.preferenceSkipped, 1);
  const recipients = transport.sentMessages.map((m) => m.to).sort();
  assert.deepEqual(recipients, ['ExponentPushToken[al]', 'ExponentPushToken[r]']);
});

test('no state chosen: allergen/retailer-only preferences keep deliver-all behavior', async () => {
  const { store, runAt } = setup(0);
  const installation = 'a'.repeat(32);
  store.register(installation, 'ExponentPushToken[a]', 'ios', iso(HOUR));
  store.setPreferences(
    installation,
    { stateCode: null, allergens: ['sesame'], retailerIds: [] },
    iso(HOUR),
  );
  // A Salmonella event with no allergen match still delivers: preferences
  // without a state never become exclusion filters.
  addEvent(store, 2 * HOUR, { pathogenOrAllergen: 'Salmonella' });
  const result = await runAt(3 * HOUR);
  assert.equal(result.metrics.deliveriesCreated, 1);
  assert.equal(result.metrics.sent, 1);
});

test('changing state never backfills: old events stay behind the preference horizon', async () => {
  const { store, transport, runAt } = setup(0);
  const installation = 'a'.repeat(32);
  store.register(installation, 'ExponentPushToken[a]', 'ios', iso(HOUR));
  store.setPreferences(
    installation,
    { stateCode: 'CA', allergens: [], retailerIds: [] },
    iso(HOUR),
  );
  addEvent(store, 2 * HOUR, { geography: { scope: 'states', states: ['Texas'] } });

  const before = await runAt(3 * HOUR);
  assert.equal(before.metrics.deliveriesCreated, 0);
  assert.equal(before.metrics.preferenceSkipped, 1);

  // The user moves to Texas. The Texas-only event from before the change must
  // never become newly deliverable.
  store.setPreferences(
    installation,
    { stateCode: 'TX', allergens: [], retailerIds: [] },
    iso(4 * HOUR),
  );
  const after = await runAt(5 * HOUR);
  assert.equal(after.metrics.deliveriesCreated, 0);
  assert.equal(after.metrics.preferenceHorizonSkipped, 1);
  assert.equal(transport.sends.length, 0);

  // A Texas event created after the change delivers normally.
  addEvent(store, 6 * HOUR, { geography: { scope: 'states', states: ['Texas'] } });
  const future = await runAt(7 * HOUR);
  assert.equal(future.metrics.deliveriesCreated, 1);
  assert.equal(future.metrics.sent, 1);
});

test('adding an allergen never backfills; future matching events deliver', async () => {
  const { store, runAt } = setup(0);
  const installation = 'a'.repeat(32);
  store.register(installation, 'ExponentPushToken[a]', 'ios', iso(HOUR));
  store.setPreferences(
    installation,
    { stateCode: 'CA', allergens: [], retailerIds: [] },
    iso(HOUR),
  );
  addEvent(store, 2 * HOUR, {
    geography: { scope: 'unknown', states: [] },
    pathogenOrAllergen: 'undeclared peanuts',
  });
  const before = await runAt(3 * HOUR);
  assert.equal(before.metrics.deliveriesCreated, 0);

  store.setPreferences(
    installation,
    { stateCode: 'CA', allergens: ['peanut'], retailerIds: [] },
    iso(4 * HOUR),
  );
  const after = await runAt(5 * HOUR);
  assert.equal(after.metrics.deliveriesCreated, 0);
  assert.equal(after.metrics.preferenceHorizonSkipped, 1);

  addEvent(store, 6 * HOUR, {
    geography: { scope: 'unknown', states: [] },
    pathogenOrAllergen: 'undeclared peanut',
  });
  const future = await runAt(7 * HOUR);
  assert.equal(future.metrics.deliveriesCreated, 1);
});

test('removing a retailer stops the positive signal for future events', async () => {
  const { store, runAt } = setup(0);
  const installation = 'a'.repeat(32);
  store.register(installation, 'ExponentPushToken[a]', 'ios', iso(HOUR));
  store.setPreferences(
    installation,
    { stateCode: 'CA', allergens: [], retailerIds: ['costco'] },
    iso(HOUR),
  );
  addEvent(store, 2 * HOUR, {
    geography: { scope: 'unknown', states: [] },
    retailerNames: ['Costco'],
  });
  const before = await runAt(3 * HOUR);
  assert.equal(before.metrics.deliveriesCreated, 1);

  store.setPreferences(
    installation,
    { stateCode: 'CA', allergens: [], retailerIds: [] },
    iso(4 * HOUR),
  );
  addEvent(store, 5 * HOUR, {
    geography: { scope: 'unknown', states: [] },
    retailerNames: ['Costco'],
  });
  const after = await runAt(6 * HOUR);
  assert.equal(after.metrics.deliveriesCreated, 0);
  assert.equal(after.metrics.preferenceSkipped, 1);
});

test('re-syncing identical preferences keeps the horizon: pending eligibility unaffected', async () => {
  const { store, runAt } = setup(0);
  const installation = 'a'.repeat(32);
  store.register(installation, 'ExponentPushToken[a]', 'ios', iso(HOUR));
  store.setPreferences(
    installation,
    { stateCode: 'CA', allergens: [], retailerIds: [] },
    iso(HOUR),
  );
  addEvent(store, 2 * HOUR, { geography: { scope: 'states', states: ['California'] } });
  // App-launch re-sync writes identical values AFTER the event was created.
  store.setPreferences(
    installation,
    { stateCode: 'CA', allergens: [], retailerIds: [] },
    iso(2 * HOUR + 30 * MINUTE),
  );
  const result = await runAt(3 * HOUR);
  assert.equal(result.metrics.deliveriesCreated, 1);
  assert.equal(result.metrics.preferenceHorizonSkipped, 0);
});

test('personalization respects the untouched C2 safety rails', async () => {
  const { store, transport, runAt } = setup(2 * HOUR);
  const installation = 'a'.repeat(32);
  // Preferences existed long before activation and before enabling alerts.
  store.setPreferences(
    installation,
    { stateCode: 'CA', allergens: [], retailerIds: [] },
    iso(-HOUR),
  );
  store.register(installation, 'ExponentPushToken[a]', 'ios', iso(4 * HOUR));

  addEvent(store, HOUR, { geography: { scope: 'states', states: ['California'] } }); // pre-activation
  addEvent(store, 3 * HOUR, { geography: { scope: 'states', states: ['California'] } }); // pre-enable
  addEvent(store, 5 * HOUR, {
    geography: { scope: 'states', states: ['California'] },
    suppressed: 'backfill',
  });

  const result = await runAt(6 * HOUR);
  assert.equal(result.metrics.skippedPreActivation, 1);
  assert.equal(result.metrics.subscriptionHorizonSkipped, 1);
  assert.equal(result.metrics.deliveriesCreated, 0);
  assert.equal(transport.sends.length, 0);
});
