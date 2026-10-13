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
import {
  eligibleSubscriptions,
  queuedRowHorizonFailure,
  retryBackoffMs,
  runPushDelivery,
} from './worker';

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
    hazardCategory?: string;
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
    hazardCategory: (overrides.hazardCategory ?? 'allergen') as 'allergen',
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
function caseId(n: number): string {
  return `${String(n).padStart(8, '0')}-0000-4000-8000-00000000cccc`;
}
function addEvent(
  store: MemoryPushStore,
  createdAtMs: number,
  overrides: {
    suppressed?: string | null;
    title?: string;
    geography?: { scope: 'states' | 'nationwide' | 'unknown'; states: string[] };
    pathogenOrAllergen?: string | null;
    retailerNames?: string[];
    hazardCategory?: string;
    /** The ledger row's kind and trigger; a new recall by default. */
    kind?: 'initial' | 'material_update';
    triggerRuleId?: string;
    materialChangeRef?: string | null;
    /** The case the event sits on; a fresh case per event by default. */
    recallCaseId?: string;
  } = {},
): string {
  eventCounter += 1;
  const id = `${String(eventCounter).padStart(8, '0')}-0000-4000-8000-000000000000`;
  const kind = overrides.kind ?? 'initial';
  store.addEvent({
    id,
    recallCaseId: overrides.recallCaseId ?? caseId(eventCounter),
    kind,
    triggerRuleId:
      overrides.triggerRuleId ?? (kind === 'initial' ? 'new_case' : 'expansion_products'),
    materialChangeRef:
      overrides.materialChangeRef ??
      (kind === 'initial' ? null : `fp-${overrides.triggerRuleId ?? 'expansion_products'}`),
    payloadSummary: 'summary',
    createdAt: iso(createdAtMs),
    suppressed: overrides.suppressed ?? null,
    projection: fixtureProjection(overrides),
  });
  return id;
}

/** A subscriber with a state (and optionally more), enabled at `enabledAtMs`. */
function subscribe(
  store: MemoryPushStore,
  installation: string,
  token: string,
  prefs: { stateCodes: string[]; allergens: string[]; retailerIds: string[] } | null,
  enabledAtMs = HOUR,
): void {
  store.register(installation, token, 'ios', iso(enabledAtMs));
  if (prefs) store.setPreferences(installation, prefs, iso(enabledAtMs));
}

/**
 * A subscriber the fixture events reach: since 2026-10-04 delivery answers
 * as Affects You does, so a subscription with no preference row receives
 * nothing. The C2 transport and ledger tests therefore register with a
 * California + peanut profile, which the default fixture (unknown
 * geography, peanut) matches on its allergen signal.
 */
function registerMatching(
  store: MemoryPushStore,
  installationId: string,
  token: string,
  platform: 'ios' | 'android',
  enabledAtIso: string,
): void {
  store.register(installationId, token, platform, enabledAtIso);
  store.setPreferences(
    installationId,
    { stateCodes: ['CA'], allergens: ['peanut'], retailerIds: [] },
    enabledAtIso,
  );
}

/**
 * A nationwide general-hazard event: what the C2 transport and ledger tests
 * ledger, so every `registerMatching` profile is reached by geography alone
 * and no allergen or retailer detail of the fixture decides the outcome.
 */
function addNationwideEvent(
  store: MemoryPushStore,
  createdAtMs: number,
  overrides: Parameters<typeof addEvent>[2] = {},
): string {
  return addEvent(store, createdAtMs, {
    geography: { scope: 'nationwide', states: [] },
    pathogenOrAllergen: 'Salmonella',
    hazardCategory: 'pathogen',
    ...overrides,
  });
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
  registerMatching(store, 'a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  addNationwideEvent(store, HOUR);
  const result = await runAt(2 * HOUR);
  assert.equal(result.outcome, 'succeeded');
  assert.equal(result.metrics.activation, 'not_activated');
  assert.equal(transport.sends.length, 0);
  assert.equal(store.deliveries.size, 0);
});

test('pre-activation deliverable events are excluded forever', async () => {
  const { store, transport, runAt } = setup(0);
  registerMatching(store, 'a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(-2 * HOUR));
  addNationwideEvent(store, -HOUR); // deliverable, but created before the horizon
  const result = await runAt(HOUR);
  assert.equal(result.metrics.deliveriesCreated, 0);
  assert.equal(result.metrics.sent, 0);
  assert.equal(result.metrics.skippedPreActivation, 1);
  assert.equal(transport.sends.length, 0);
});

test('post-activation event: one delivery, one send, ticket persisted — and reruns stay silent', async () => {
  const { store, transport, runAt } = setup(0);
  registerMatching(store, 'a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  addNationwideEvent(store, HOUR);

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
  registerMatching(store, 'a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(30 * MINUTE));
  registerMatching(store, 'b'.repeat(32), 'ExponentPushToken[b]', 'android', iso(2 * HOUR)); // late
  addNationwideEvent(store, HOUR);
  const result = await runAt(3 * HOUR);
  assert.equal(result.metrics.deliveriesCreated, 1);
  assert.equal(result.metrics.subscriptionHorizonSkipped, 1);
  const delivery = [...store.deliveries.values()][0];
  const early = [...store.subscriptions.values()].find((s) => s.installationId === 'a'.repeat(32));
  assert.equal(delivery.subscriptionId, early?.id);
});

test('suppressed events are never delivered, C2 cannot override suppression', async () => {
  const { store, transport, runAt } = setup(0);
  registerMatching(store, 'a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  addNationwideEvent(store, HOUR, { suppressed: 'backfill' });
  addNationwideEvent(store, HOUR, { suppressed: 'coalesced' });
  const result = await runAt(2 * HOUR);
  assert.equal(result.metrics.deliveriesCreated, 0);
  assert.equal(result.metrics.suppressedSkipped, 2);
  assert.equal(transport.sends.length, 0);
});

test('one event, two devices: exactly one delivery per device', async () => {
  const { store, transport, runAt } = setup(0);
  registerMatching(store, 'a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  registerMatching(store, 'b'.repeat(32), 'ExponentPushToken[b]', 'android', iso(-HOUR));
  addNationwideEvent(store, HOUR);
  const result = await runAt(2 * HOUR);
  assert.equal(result.metrics.deliveriesCreated, 2);
  assert.equal(result.metrics.sent, 2);
  assert.equal(transport.sentMessages.length, 2);
  const tokens = transport.sentMessages.map((m) => m.to).sort();
  assert.deepEqual(tokens, ['ExponentPushToken[a]', 'ExponentPushToken[b]']);
});

test('receipt ok marks receipt_ok only after the receipt delay', async () => {
  const { store, transport, runAt } = setup(0);
  registerMatching(store, 'a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  addNationwideEvent(store, HOUR);
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
  registerMatching(store, 'a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  addNationwideEvent(store, HOUR);
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
  addNationwideEvent(store, 3 * HOUR);
  const later = await runAt(4 * HOUR);
  assert.equal(later.metrics.deliveriesCreated, 0);
  assert.equal(transport.sentMessages.length, 1);

  // Re-registration with a fresh token re-enables with a new horizon.
  registerMatching(store, 'a'.repeat(32), 'ExponentPushToken[a2]', 'ios', iso(5 * HOUR));
  addNationwideEvent(store, 6 * HOUR);
  const revived = await runAt(7 * HOUR);
  assert.equal(revived.metrics.deliveriesCreated, 1);
  assert.equal(transport.sentMessages.at(-1)?.to, 'ExponentPushToken[a2]');
});

test('ticket-level DeviceNotRegistered also disables immediately', async () => {
  const { store, transport, runAt } = setup(0);
  registerMatching(store, 'a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  addNationwideEvent(store, HOUR);
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
  registerMatching(store, 'a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  addNationwideEvent(store, HOUR);
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
  registerMatching(rate.store, 'b'.repeat(32), 'ExponentPushToken[b]', 'ios', iso(-HOUR));
  addNationwideEvent(rate.store, HOUR);
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
  registerMatching(store, 'a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  addNationwideEvent(store, HOUR);
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
  registerMatching(store, 'a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  const eventId = addNationwideEvent(store, HOUR);
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
  registerMatching(store, 'a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  const eventId = addNationwideEvent(store, HOUR);
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
  registerMatching(store, 'a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  addNationwideEvent(store, HOUR);
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
  registerMatching(store, 'a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  addNationwideEvent(store, HOUR);
  addNationwideEvent(store, -HOUR); // pre-activation
  addNationwideEvent(store, HOUR, { suppressed: 'backfill' });
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
  registerMatching(store, 'a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(0));
  registerMatching(store, 'a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(HOUR));
  assert.equal(store.subscriptions.size, 1);
  assert.equal([...store.subscriptions.values()][0].enabledAt, iso(0)); // horizon kept

  // Token update on the same install: same row, new token.
  registerMatching(store, 'a'.repeat(32), 'ExponentPushToken[a2]', 'ios', iso(2 * HOUR));
  assert.equal(store.subscriptions.size, 1);
  assert.equal([...store.subscriptions.values()][0].expoPushToken, 'ExponentPushToken[a2]');

  // Reinstall: a new installation claims the same token — old row disabled.
  registerMatching(store, 'r'.repeat(32), 'ExponentPushToken[a2]', 'ios', iso(3 * HOUR));
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
  registerMatching(store, 'a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  store.userDisable('a'.repeat(32), iso(HOUR));
  addNationwideEvent(store, 2 * HOUR); // created while alerts were off
  registerMatching(store, 'a'.repeat(32), 'ExponentPushToken[a]', 'ios', iso(3 * HOUR));
  const result = await runAt(4 * HOUR);
  assert.equal(result.metrics.deliveriesCreated, 0);
  assert.equal(result.metrics.subscriptionHorizonSkipped, 1);

  addNationwideEvent(store, 5 * HOUR); // after re-enable: delivered
  const later = await runAt(6 * HOUR);
  assert.equal(later.metrics.deliveriesCreated, 1);
});

// ── Queued rows obey the CURRENT horizons (2026-10-10) ──────────────────────
// Before this, the send pool sent any pending / retryable / crash-recovered
// row regardless of horizon: a rollback + reactivation sent rows queued before
// it hours late, a re-enable revived a row from before the disable, and a
// ticket stranded by a deactivation was re-sent once its receipt expired.

const A = 'a'.repeat(32);

function onlyDelivery(store: MemoryPushStore) {
  assert.equal(store.deliveries.size, 1);
  return [...store.deliveries.values()][0];
}

test('rollback: a row that failed before deactivation is never sent after reactivation', async () => {
  const { store, transport, runAt } = setup(0);
  registerMatching(store, A, 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  addNationwideEvent(store, HOUR);
  transport.failSends = 1;
  await runAt(HOUR + MINUTE);
  assert.equal(onlyDelivery(store).status, 'retryable_failure');

  store.pushEnabledAt = null; // push:activate --deactivate --confirm
  await runAt(3 * HOUR);
  store.pushEnabledAt = iso(48 * HOUR); // reactivated two days later: a NEW horizon
  const result = await runAt(49 * HOUR);

  assert.equal(result.metrics.sent, 0);
  assert.equal(result.metrics.queuedBeforeHorizon, 1);
  assert.equal(transport.sentMessages.length, 0);
  const row = onlyDelivery(store);
  assert.equal(row.status, 'permanent_failure');
  assert.equal(row.failureCode, 'before_activation');
  assert.equal(row.attempts, 1, 'no further attempt was made');
  // And no historical event replays under the new horizon.
  assert.equal(result.metrics.deliveriesCreated, 0);
  assert.equal(result.metrics.skippedPreActivation, 1);
});

test('rollback: a ticket stranded by deactivation is not re-sent when its receipt has expired', async () => {
  const { store, transport, runAt } = setup(0);
  registerMatching(store, A, 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  addNationwideEvent(store, HOUR);
  await runAt(HOUR + MINUTE);
  assert.equal(onlyDelivery(store).status, 'ticket_accepted');

  store.pushEnabledAt = null; // receipts are not read while deactivated
  store.pushEnabledAt = iso(30 * HOUR);
  await runAt(30 * HOUR + MINUTE); // the receipt is gone (>24 h): outcome unknowable
  await runAt(31 * HOUR + MINUTE);

  assert.equal(transport.sentMessages.length, 1, 'the phone got it once — no duplicate');
  const row = onlyDelivery(store);
  assert.equal(row.status, 'permanent_failure');
  assert.equal(row.failureCode, 'before_activation');
});

test('rollback: events from the dark period stay unsent; new events after reactivation deliver', async () => {
  const { store, transport, runAt } = setup(0);
  registerMatching(store, A, 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  store.pushEnabledAt = null;
  addNationwideEvent(store, 2 * HOUR); // while deactivated
  await runAt(3 * HOUR);
  store.pushEnabledAt = iso(4 * HOUR);
  addNationwideEvent(store, 5 * HOUR);
  const result = await runAt(6 * HOUR);
  assert.equal(result.metrics.deliveriesCreated, 1);
  assert.equal(result.metrics.sent, 1);
  assert.equal(result.metrics.queuedBeforeHorizon, 0);
  assert.equal(transport.sentMessages.length, 1);
});

test('disable + re-enable before the next tick: the queued row fails closed', async () => {
  const { store, transport, runAt } = setup(0);
  registerMatching(store, A, 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  addNationwideEvent(store, HOUR);
  transport.failSends = 1;
  await runAt(HOUR + MINUTE);
  store.userDisable(A, iso(HOUR + 5 * MINUTE));
  registerMatching(store, A, 'ExponentPushToken[a]', 'ios', iso(2 * HOUR)); // enabled_at moves forward

  const result = await runAt(3 * HOUR);
  assert.equal(result.metrics.sent, 0);
  assert.equal(transport.sentMessages.length, 0);
  assert.equal(onlyDelivery(store).failureCode, 'before_subscription');

  addNationwideEvent(store, 4 * HOUR); // after the re-enable: delivered as usual
  const later = await runAt(5 * HOUR);
  assert.equal(later.metrics.sent, 1);
});

test('an ordinary retry under unchanged horizons is still retried and sent', async () => {
  const { store, transport, runAt } = setup(0);
  registerMatching(store, A, 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  addNationwideEvent(store, HOUR);
  transport.failSends = 1;
  await runAt(HOUR + MINUTE);
  const result = await runAt(2 * HOUR); // 30-minute backoff elapsed
  assert.equal(result.metrics.queuedBeforeHorizon, 0);
  assert.equal(result.metrics.sent, 1);
  assert.equal(onlyDelivery(store).status, 'ticket_accepted');
});

test('dry run reports queued rows the horizons would fail, and writes nothing', async () => {
  const { store, transport, runAt } = setup(0);
  registerMatching(store, A, 'ExponentPushToken[a]', 'ios', iso(-HOUR));
  addNationwideEvent(store, HOUR);
  transport.failSends = 1;
  await runAt(HOUR + MINUTE);
  store.pushEnabledAt = iso(48 * HOUR);
  const before = JSON.stringify([...store.deliveries.values()]);

  const result = await runAt(49 * HOUR, true);
  assert.equal(result.metrics.queuedBeforeHorizon, 1);
  assert.equal(result.metrics.sent, 0, 'would-send excludes the failed-closed row');
  assert.equal(JSON.stringify([...store.deliveries.values()]), before);
  assert.equal(transport.sentMessages.length, 0);
});

test('queuedRowHorizonFailure: activation first, then the subscription; equality passes', () => {
  assert.equal(queuedRowHorizonFailure(iso(0), iso(0), iso(0)), null);
  assert.equal(queuedRowHorizonFailure(iso(HOUR), iso(0), iso(2 * HOUR)), 'before_activation');
  assert.equal(queuedRowHorizonFailure(iso(HOUR), iso(2 * HOUR), iso(0)), 'before_subscription');
  assert.equal(
    queuedRowHorizonFailure(iso(HOUR), iso(3 * HOUR), iso(2 * HOUR)),
    'before_activation',
  );
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
  const preferences = new Map(
    ['i1', 'i2', 'i3'].map((installationId) => [
      installationId,
      {
        installationId,
        stateCodes: ['CA'],
        allergens: [],
        retailerIds: [],
        updatedAt: iso(-HOUR),
        allergenConsentVersion: null,
      },
    ]),
  );
  const eligible = eligibleSubscriptions(
    {
      createdAt: iso(HOUR),
      projection: fixtureProjection({
        geography: { scope: 'nationwide', states: [] },
        pathogenOrAllergen: 'Salmonella',
        hazardCategory: 'pathogen',
      }),
    },
    subscriptions,
    iso(0),
    preferences,
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
  store.setPreferences(ca, { stateCodes: ['CA'], allergens: [], retailerIds: [] }, iso(HOUR));
  store.setPreferences(tx, { stateCodes: ['TX'], allergens: [], retailerIds: [] }, iso(HOUR));
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
  store.setPreferences(one, { stateCodes: ['CA'], allergens: [], retailerIds: [] }, iso(HOUR));
  store.setPreferences(two, { stateCodes: ['CA'], allergens: [], retailerIds: [] }, iso(HOUR));
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
    { stateCodes: ['CA'], allergens: [], retailerIds: ['costco'] },
    iso(HOUR),
  );
  store.setPreferences(
    stateOnly,
    { stateCodes: ['CA'], allergens: [], retailerIds: [] },
    iso(HOUR),
  );
  store.setPreferences(
    withAllergen,
    { stateCodes: ['CA'], allergens: ['peanut'], retailerIds: [] },
    iso(HOUR),
  );
  // A PEANUT-only recall, sold at Costco, with no stated distribution.
  addEvent(store, 2 * HOUR, {
    geography: { scope: 'unknown', states: [] },
    pathogenOrAllergen: 'undeclared peanuts',
    retailerNames: ['Costco'],
  });
  const result = await runAt(3 * HOUR);
  // Only the peanut subscriber. C5.2B: an identified allergen-only recall that
  // matches none of a subscriber's selected allergens is withheld, and the
  // Costco preference cannot resurrect it — delivery agrees with Home.
  assert.equal(result.metrics.deliveriesCreated, 1);
  assert.equal(result.metrics.preferenceSkipped, 2);
  const recipients = transport.sentMessages.map((m) => m.to).sort();
  assert.deepEqual(recipients, ['ExponentPushToken[al]']);
});

test('personalized: a GENERAL hazard with no location still reaches the retailer subscriber', async () => {
  const { store, transport, runAt } = setup(0);
  const withRetailer = 'a'.repeat(32);
  const stateOnly = 'b'.repeat(32);
  store.register(withRetailer, 'ExponentPushToken[r]', 'ios', iso(HOUR));
  store.register(stateOnly, 'ExponentPushToken[s]', 'ios', iso(HOUR));
  store.setPreferences(
    withRetailer,
    { stateCodes: ['CA'], allergens: ['peanut'], retailerIds: ['costco'] },
    iso(HOUR),
  );
  store.setPreferences(
    stateOnly,
    { stateCodes: ['CA'], allergens: [], retailerIds: [] },
    iso(HOUR),
  );
  // Salmonella, not an allergen: the allergen-only rule must not touch it.
  addEvent(store, 2 * HOUR, {
    geography: { scope: 'unknown', states: [] },
    hazardCategory: 'microbial_contamination',
    pathogenOrAllergen: 'Salmonella',
    retailerNames: ['Costco'],
  });
  const result = await runAt(3 * HOUR);
  assert.equal(result.metrics.deliveriesCreated, 1);
  assert.deepEqual(
    transport.sentMessages.map((m) => m.to),
    ['ExponentPushToken[r]'],
  );
});

test('no state chosen: delivery answers as Affects You does — a personal signal or nothing (2026-10-04)', async () => {
  const { store, transport, runAt } = setup(0);
  const sesame = 'a'.repeat(32);
  const nothingChosen = 'b'.repeat(32);
  const noRow = 'c'.repeat(32);
  subscribe(store, sesame, 'ExponentPushToken[sesame]', {
    stateCodes: [],
    allergens: ['sesame'],
    retailerIds: [],
  });
  subscribe(store, nothingChosen, 'ExponentPushToken[none]', {
    stateCodes: [],
    allergens: [],
    retailerIds: [],
  });
  subscribe(store, noRow, 'ExponentPushToken[norow]', null);
  // A nationwide Salmonella recall: no signal for the sesame profile, and the
  // other two have nothing to match on. Before this date all three received
  // every event — the flood the audit named.
  addEvent(store, 2 * HOUR, {
    pathogenOrAllergen: 'Salmonella',
    hazardCategory: 'pathogen',
    geography: { scope: 'nationwide', states: [] },
  });
  // A nationwide sesame recall: the sesame profile's own signal.
  addEvent(store, 2 * HOUR, {
    pathogenOrAllergen: 'undeclared sesame',
    geography: { scope: 'nationwide', states: [] },
  });
  const result = await runAt(3 * HOUR);
  assert.equal(result.metrics.deliveriesCreated, 1);
  assert.equal(result.metrics.preferenceSkipped, 5);
  assert.deepEqual(
    transport.sentMessages.map((m) => m.to),
    ['ExponentPushToken[sesame]'],
  );
});

test('a nationwide non-allergen hazard reaches every valid selected-state profile; the allergen-only exclusion still holds', async () => {
  const { store, transport, runAt } = setup(0);
  const profiles: [string, string[]][] = [
    ['ca', ['CA']],
    ['ny', ['NY']],
    ['three', ['DC', 'MT', 'NY']],
    ['tx-peanut', ['TX']],
  ];
  for (const [name, stateCodes] of profiles) {
    subscribe(store, name.padEnd(32, '0'), `ExponentPushToken[${name}]`, {
      stateCodes,
      allergens: name === 'tx-peanut' ? ['peanut'] : [],
      retailerIds: [],
    });
  }
  // Nationwide Listeria: a general hazard, every state profile.
  addEvent(store, 2 * HOUR, {
    pathogenOrAllergen: 'Listeria monocytogenes',
    hazardCategory: 'pathogen',
    geography: { scope: 'nationwide', states: [] },
  });
  // Nationwide milk-only recall: withheld from every profile that chose none
  // of its allergens — including the ones that chose no allergen at all.
  addEvent(store, 2 * HOUR, {
    pathogenOrAllergen: 'undeclared milk',
    hazardCategory: 'allergen',
    geography: { scope: 'nationwide', states: [] },
  });
  const result = await runAt(3 * HOUR);
  assert.equal(result.metrics.deliveriesCreated, 4);
  assert.equal(result.metrics.preferenceSkipped, 4);
  assert.deepEqual(transport.sentMessages.map((m) => m.to).sort(), [
    'ExponentPushToken[ca]',
    'ExponentPushToken[ny]',
    'ExponentPushToken[three]',
    'ExponentPushToken[tx-peanut]',
  ]);
});

test('state-specific matching: a stated state list reaches the profiles that name one of its states', async () => {
  const { store, transport, runAt } = setup(0);
  subscribe(store, 'a'.repeat(32), 'ExponentPushToken[ca]', {
    stateCodes: ['CA'],
    allergens: [],
    retailerIds: [],
  });
  subscribe(store, 'b'.repeat(32), 'ExponentPushToken[tx]', {
    stateCodes: ['TX'],
    allergens: [],
    retailerIds: [],
  });
  subscribe(store, 'c'.repeat(32), 'ExponentPushToken[ny-ca]', {
    stateCodes: ['NY', 'CA'],
    allergens: [],
    retailerIds: [],
  });
  addEvent(store, 2 * HOUR, {
    pathogenOrAllergen: 'Salmonella',
    hazardCategory: 'pathogen',
    geography: { scope: 'states', states: ['California', 'Oregon'] },
  });
  const result = await runAt(3 * HOUR);
  assert.equal(result.metrics.deliveriesCreated, 2);
  assert.deepEqual(transport.sentMessages.map((m) => m.to).sort(), [
    'ExponentPushToken[ca]',
    'ExponentPushToken[ny-ca]',
  ]);
});

// ── Eligibility by event type (2026-10-04) ──────────────────────────────────

function nationwide(store: MemoryPushStore, token: string): void {
  subscribe(store, token.padEnd(32, '0'), `ExponentPushToken[${token}]`, {
    stateCodes: ['CA'],
    allergens: ['peanut'],
    retailerIds: [],
  });
}
const NATIONWIDE = { scope: 'nationwide' as const, states: [] };

test('a new recall on a case that has since closed or been retracted never alerts', async () => {
  const { store, transport, runAt } = setup(0);
  nationwide(store, 'a');
  addEvent(store, 2 * HOUR, { geography: NATIONWIDE, recallCaseId: caseId(901) });
  addEvent(store, 2 * HOUR, { geography: NATIONWIDE, recallCaseId: caseId(902) });
  addEvent(store, 2 * HOUR, { geography: NATIONWIDE, recallCaseId: caseId(903) });
  store.cases.get(caseId(901))!.state = 'closed';
  store.cases.get(caseId(902))!.state = 'retracted';
  const result = await runAt(3 * HOUR);
  assert.equal(result.metrics.lifecycleSkipped, 2);
  assert.equal(result.metrics.deliveriesCreated, 1);
  assert.equal(transport.sentMessages[0].data.recallCaseId, caseId(903));
});

test('a retraction alerts for the retracted case — the one update whose case is not active', async () => {
  const { store, transport, runAt } = setup(0);
  nationwide(store, 'a');
  store.setCase({
    id: caseId(910),
    projection: fixtureProjection({ geography: NATIONWIDE }),
    state: 'retracted',
  });
  addEvent(store, 2 * HOUR, {
    geography: NATIONWIDE,
    recallCaseId: caseId(910),
    kind: 'material_update',
    triggerRuleId: 'retraction',
    materialChangeRef: 'retraction',
  });
  // The same event shape on a case that is NOT retracted would mislead: skipped.
  addEvent(store, 2 * HOUR, {
    geography: NATIONWIDE,
    recallCaseId: caseId(911),
    kind: 'material_update',
    triggerRuleId: 'retraction',
    materialChangeRef: 'retraction',
  });
  const result = await runAt(3 * HOUR);
  assert.equal(result.metrics.deliveriesCreated, 1);
  assert.equal(result.metrics.lifecycleSkipped, 1);
  assert.equal(transport.sentMessages.length, 1);
  assert.equal(transport.sentMessages[0].data.recallCaseId, caseId(910));
  assert.match(transport.sentMessages[0].title, /retract/i);
});

test('important updates alert on an active case and not on a closed one', async () => {
  const { store, transport, runAt } = setup(0);
  nationwide(store, 'a');
  const rules = [
    'expansion_products',
    'expansion_geography',
    'correction_broadened',
    'classification_assigned',
    'classification_upgraded',
    'classification_downgraded',
    'classification_changed',
    'health_impact',
    'instructions_changed',
  ];
  for (const rule of rules) {
    addEvent(store, 2 * HOUR, {
      geography: NATIONWIDE,
      recallCaseId: caseId(920),
      kind: 'material_update',
      triggerRuleId: rule,
    });
  }
  store.setCase({
    id: caseId(921),
    projection: fixtureProjection({ geography: NATIONWIDE }),
    state: 'closed',
  });
  addEvent(store, 2 * HOUR, {
    geography: NATIONWIDE,
    recallCaseId: caseId(921),
    kind: 'material_update',
    triggerRuleId: 'health_impact',
  });
  const result = await runAt(3 * HOUR);
  assert.equal(result.metrics.deliveriesCreated, rules.length);
  assert.equal(result.metrics.lifecycleSkipped, 1);
  assert.ok(transport.sentMessages.every((m) => m.data.recallCaseId === caseId(920)));
});

test('merged cases: the duplicate initial is dropped; an update is re-pointed at the survivor, once', async () => {
  const { store, transport, runAt } = setup(0);
  nationwide(store, 'a');
  const survivor = caseId(930);
  const absorbed = caseId(931);
  store.setCase({
    id: survivor,
    projection: {
      ...fixtureProjection({ geography: NATIONWIDE }),
      productDescription: 'Survivor Trail Mix',
    },
  });
  store.setCase({
    id: absorbed,
    projection: {
      ...fixtureProjection({ geography: NATIONWIDE }),
      productDescription: 'Absorbed Trail Mix',
    },
  });
  // Both cards were founded, so both carry an initial; the absorbed one also
  // carries an expansion the survivor does not, and a classification the
  // survivor ALSO recorded for itself.
  addEvent(store, 2 * HOUR, { recallCaseId: survivor });
  addEvent(store, 2 * HOUR, { recallCaseId: absorbed });
  addEvent(store, 2 * HOUR, {
    recallCaseId: absorbed,
    kind: 'material_update',
    triggerRuleId: 'expansion_products',
    materialChangeRef: 'exp-1',
  });
  addEvent(store, 2 * HOUR, {
    recallCaseId: absorbed,
    kind: 'material_update',
    triggerRuleId: 'classification_assigned',
    materialChangeRef: 'class-1',
  });
  addEvent(store, 2 * HOUR, {
    recallCaseId: survivor,
    kind: 'material_update',
    triggerRuleId: 'classification_assigned',
    materialChangeRef: 'class-1',
  });
  store.merge(absorbed, survivor);

  const result = await runAt(3 * HOUR);
  // Survivor initial + re-pointed expansion + survivor classification = 3;
  // the absorbed initial and the twin classification are dropped.
  assert.equal(result.metrics.deliveriesCreated, 3);
  assert.equal(result.metrics.mergedDuplicateSkipped, 2);
  assert.equal(result.metrics.reroutedToSurvivor, 1);
  assert.equal(result.metrics.destinationUnresolved, 0);
  assert.equal(transport.sentMessages.length, 3);
  // Every alert opens the surviving case — the card the Feed lists — and the
  // re-pointed expansion is formatted from the survivor's projection.
  assert.ok(transport.sentMessages.every((m) => m.data.recallCaseId === survivor));
  assert.ok(
    transport.sentMessages.every((m) => m.title.includes('Survivor')),
    transport.sentMessages.map((m) => m.title).join(' | '),
  );
  // Exactly one alert per distinct change.
  const changes = transport.sentMessages.map((m) => m.title + '|' + m.body);
  assert.equal(new Set(changes).size, changes.length);
});

test('a merge chain is followed to the canonical case; a broken or circular chain never sends', async () => {
  const { store, transport, runAt } = setup(0);
  nationwide(store, 'a');
  const [a, b, c] = [caseId(940), caseId(941), caseId(942)];
  for (const id of [a, b, c])
    store.setCase({ id, projection: fixtureProjection({ geography: NATIONWIDE }) });
  store.merge(a, b);
  store.merge(b, c);
  addEvent(store, 2 * HOUR, {
    recallCaseId: a,
    kind: 'material_update',
    triggerRuleId: 'expansion_products',
    materialChangeRef: 'chain',
  });
  // A tombstone pointing at a case that does not exist.
  store.setCase({
    id: caseId(943),
    projection: fixtureProjection({ geography: NATIONWIDE }),
    mergedInto: caseId(999),
  });
  addEvent(store, 2 * HOUR, {
    recallCaseId: caseId(943),
    kind: 'material_update',
    triggerRuleId: 'expansion_products',
    materialChangeRef: 'lost',
  });
  // A cycle.
  store.setCase({
    id: caseId(944),
    projection: fixtureProjection({ geography: NATIONWIDE }),
    mergedInto: caseId(945),
  });
  store.setCase({
    id: caseId(945),
    projection: fixtureProjection({ geography: NATIONWIDE }),
    mergedInto: caseId(944),
  });
  addEvent(store, 2 * HOUR, {
    recallCaseId: caseId(944),
    kind: 'material_update',
    triggerRuleId: 'expansion_products',
    materialChangeRef: 'loop',
  });
  const result = await runAt(3 * HOUR);
  assert.equal(result.metrics.deliveriesCreated, 1);
  assert.equal(result.metrics.destinationUnresolved, 2);
  assert.equal(transport.sentMessages[0].data.recallCaseId, c);
});

test('a retry row whose case was merged or closed after the row was created fails closed instead of sending', async () => {
  const { store, transport, runAt } = setup(0);
  nationwide(store, 'a');
  transport.failSends = 1;
  const survivor = caseId(950);
  const absorbed = caseId(951);
  store.setCase({ id: survivor, projection: fixtureProjection({ geography: NATIONWIDE }) });
  store.setCase({ id: absorbed, projection: fixtureProjection({ geography: NATIONWIDE }) });
  addEvent(store, 2 * HOUR, { recallCaseId: absorbed });
  const first = await runAt(3 * HOUR);
  assert.equal(first.metrics.retryableFailures, 1);
  // Between runs the duplicate is reconciled into the survivor.
  store.merge(absorbed, survivor);
  const second = await runAt(3 * HOUR + 40 * MINUTE);
  assert.equal(second.metrics.sent, 0);
  assert.equal(second.metrics.permanentFailures, 1);
  const delivery = [...store.deliveries.values()][0];
  assert.equal(delivery.status, 'permanent_failure');
  assert.equal(delivery.failureCode, 'case_merged_duplicate');
  assert.equal(transport.sentMessages.length, 0);
});

test('no backlog: a retraction or update created before activation or before the subscription never sends', async () => {
  const { store, transport, runAt } = setup(2 * HOUR);
  nationwide(store, 'a'); // enabled at HOUR, before activation
  store.setCase({
    id: caseId(960),
    projection: fixtureProjection({ geography: NATIONWIDE }),
    state: 'retracted',
  });
  addEvent(store, HOUR, {
    recallCaseId: caseId(960),
    kind: 'material_update',
    triggerRuleId: 'retraction',
    materialChangeRef: 'retraction',
  });
  addEvent(store, HOUR + 30 * MINUTE, {
    recallCaseId: caseId(961),
    kind: 'material_update',
    triggerRuleId: 'health_impact',
  });
  // After activation: the one that may send.
  addEvent(store, 3 * HOUR, { recallCaseId: caseId(962), geography: NATIONWIDE });
  const result = await runAt(4 * HOUR);
  assert.equal(result.metrics.skippedPreActivation, 2);
  assert.equal(result.metrics.deliveriesCreated, 1);
  assert.equal(transport.sentMessages[0].data.recallCaseId, caseId(962));
});

test('changing state never backfills: old events stay behind the preference horizon', async () => {
  const { store, transport, runAt } = setup(0);
  const installation = 'a'.repeat(32);
  store.register(installation, 'ExponentPushToken[a]', 'ios', iso(HOUR));
  store.setPreferences(
    installation,
    { stateCodes: ['CA'], allergens: [], retailerIds: [] },
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
    { stateCodes: ['TX'], allergens: [], retailerIds: [] },
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
    { stateCodes: ['CA'], allergens: [], retailerIds: [] },
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
    { stateCodes: ['CA'], allergens: ['peanut'], retailerIds: [] },
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
    { stateCodes: ['CA'], allergens: [], retailerIds: ['costco'] },
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
    { stateCodes: ['CA'], allergens: [], retailerIds: [] },
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
    { stateCodes: ['CA'], allergens: [], retailerIds: [] },
    iso(HOUR),
  );
  addEvent(store, 2 * HOUR, { geography: { scope: 'states', states: ['California'] } });
  // App-launch re-sync writes identical values AFTER the event was created.
  store.setPreferences(
    installation,
    { stateCodes: ['CA'], allergens: [], retailerIds: [] },
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
    { stateCodes: ['CA'], allergens: [], retailerIds: [] },
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

// ── Allergen consent (2026-10-13) ─────────────────────────────────────────
// The worker is given allergens only for rows with a consent version. The
// relevance evaluation is unchanged — without allergens a profile is judged
// exactly like one that never chose any.

test('consent: an allergen-only recall reaches a consenting peanut watcher, not one without consent', async () => {
  const { store, transport, runAt } = setup(0);
  const consented = 'a'.repeat(32);
  const declined = 'b'.repeat(32);
  const legacy = 'c'.repeat(32);
  store.register(consented, 'ExponentPushToken[yes]', 'ios', iso(HOUR));
  store.register(declined, 'ExponentPushToken[no]', 'ios', iso(HOUR));
  store.register(legacy, 'ExponentPushToken[old]', 'ios', iso(HOUR));
  const prefs = { stateCodes: ['CA'], allergens: ['peanut'], retailerIds: [] };
  store.setPreferences(consented, prefs, iso(HOUR)); // current client, consent given
  store.setPreferences(declined, prefs, iso(HOUR), null); // declined: server keeps no allergens
  store.seedLegacyPreferences(legacy, prefs, iso(HOUR)); // stored before consent existed
  addEvent(store, 2 * HOUR, {
    geography: { scope: 'nationwide', states: [] },
    pathogenOrAllergen: 'undeclared peanuts',
  });
  const result = await runAt(3 * HOUR);
  assert.deepEqual(
    transport.sentMessages.map((m) => m.to),
    ['ExponentPushToken[yes]'],
  );
  assert.equal(result.metrics.preferenceSkipped, 2);
});

test('consent: without it, state matching for a general hazard is unchanged', async () => {
  const { store, transport, runAt } = setup(0);
  const declined = 'b'.repeat(32);
  const legacy = 'c'.repeat(32);
  store.register(declined, 'ExponentPushToken[no]', 'ios', iso(HOUR));
  store.register(legacy, 'ExponentPushToken[old]', 'ios', iso(HOUR));
  const prefs = { stateCodes: ['CA'], allergens: ['peanut'], retailerIds: [] };
  store.setPreferences(declined, prefs, iso(HOUR), null);
  store.seedLegacyPreferences(legacy, prefs, iso(HOUR));
  addEvent(store, 2 * HOUR, {
    geography: { scope: 'states', states: ['California'] },
    pathogenOrAllergen: 'Listeria monocytogenes',
    hazardCategory: 'pathogen',
  });
  await runAt(3 * HOUR);
  assert.deepEqual(transport.sentMessages.map((m) => m.to).sort(), [
    'ExponentPushToken[no]',
    'ExponentPushToken[old]',
  ]);
});

test('consent: an allergens-only profile without consent receives nothing (no other signal)', async () => {
  const { store, transport, runAt } = setup(0);
  const allergensOnly = 'd'.repeat(32);
  store.register(allergensOnly, 'ExponentPushToken[ao]', 'ios', iso(HOUR));
  store.setPreferences(
    allergensOnly,
    { stateCodes: [], allergens: ['peanut'], retailerIds: [] },
    iso(HOUR),
    null,
  );
  addEvent(store, 2 * HOUR, {
    geography: { scope: 'nationwide', states: [] },
    pathogenOrAllergen: 'undeclared peanuts',
  });
  addEvent(store, 2 * HOUR + 1, {
    geography: { scope: 'nationwide', states: [] },
    pathogenOrAllergen: 'Listeria monocytogenes',
    hazardCategory: 'pathogen',
  });
  await runAt(3 * HOUR);
  assert.deepEqual(transport.sentMessages, []);
});

test('consent: withdrawing it clears the server allergens and moves the preference horizon', async () => {
  const { store } = setup(0);
  const id = 'e'.repeat(32);
  const prefs = { stateCodes: ['CA'], allergens: ['peanut'], retailerIds: [] };
  store.setPreferences(id, prefs, iso(HOUR));
  store.setPreferences(id, prefs, iso(2 * HOUR), null); // the toggle turned off
  const [row] = await store.listPreferences();
  assert.deepEqual(row.allergens, []);
  assert.equal(row.allergenConsentVersion, null);
  assert.equal(row.updatedAt, iso(2 * HOUR));
  // An identical re-send is a strict no-op: the horizon does not move again.
  store.setPreferences(id, prefs, iso(3 * HOUR), null);
  assert.equal((await store.listPreferences())[0].updatedAt, iso(2 * HOUR));
});
