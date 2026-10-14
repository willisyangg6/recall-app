/**
 * WHEN does the server stop alerts to a device that should no longer get
 * them? (age assurance review, 2026-10-13; docs/recall-push-delivery.md,
 * "When the server stops alerts".) Two different routes, pinned run by run:
 *
 * - Under 13 (components/age-gate.tsx): the app only UNREGISTERS from
 *   Apple's push service, locally. The server learns nothing at that
 *   moment. Its subscription is disabled only after a later alert is sent
 *   to the old token AND Expo's receipt for it reports DeviceNotRegistered,
 *   read by a run at least RECEIPT_DELAY_MINUTES after that send — or at
 *   once if Expo's ticket already says so. Until then, queued alerts are
 *   still handed to Expo. While delivery is not activated, nothing is sent,
 *   so the subscription is never disabled this way.
 * - Revoked consent (apply_consent_revocation): the subscription is
 *   disabled on the server at once. Queued rows are failed closed at the
 *   next run and never sent; a row already handed to Expo (in flight)
 *   cannot be recalled.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MemoryPushStore } from './memory-push-store';
import { ACTIVE_SOURCE, NEVER_HELD, registerEntitled } from './test-entitlement';
import type { PushMessage, PushReceipt, PushTicket, PushTransport } from './types';
import { RECEIPT_DELAY_MINUTES, runPushDelivery } from './worker';

const T0 = Date.parse('2026-09-01T00:00:00.000Z');
const HOUR = 3_600_000;
const MINUTE = 60_000;
const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();
const INSTALLATION = 'a'.repeat(32);
const TOKEN = 'ExponentPushToken[teen-device]';

class FakeTransport implements PushTransport {
  sent: PushMessage[] = [];
  receipts: Record<string, PushReceipt> = {};
  private issued = 0;
  /** Tickets are numbered in send order from 0: ticket-0, ticket-1, … */
  ticketFor: (message: PushMessage) => PushTicket = () => ({
    status: 'ok',
    id: `ticket-${this.issued++}`,
  });

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    return messages.map((message) => {
      this.sent.push(message);
      return this.ticketFor(message);
    });
  }

  async getReceipts(ids: string[]): Promise<Record<string, PushReceipt>> {
    return Object.fromEntries(
      ids.filter((id) => this.receipts[id]).map((id) => [id, this.receipts[id]]),
    );
  }
}

let events = 0;
/** A nationwide pathogen recall: reaches any subscriber with a state chosen. */
function addRecall(store: MemoryPushStore, createdAtMs: number): string {
  events += 1;
  const id = `${String(events).padStart(8, '0')}-0000-4000-8000-000000000000`;
  store.addEvent({
    id,
    recallCaseId: `${String(events).padStart(8, '0')}-0000-4000-8000-00000000cccc`,
    kind: 'initial',
    triggerRuleId: 'new_case',
    payloadSummary: 'summary',
    createdAt: iso(createdAtMs),
    projection: {
      sourceAgency: 'FDA',
      noticeType: 'recall',
      state: 'active',
      closedYear: null,
      classification: { value: 'not_yet_classified', sourceText: null },
      title: `Recall ${events}`,
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
      publishedAt: '2026-09-01',
      lastPublicActivityAt: '2026-09-01',
    } as never,
  });
  return id;
}

function setup(activated: boolean) {
  const store = new MemoryPushStore();
  if (activated) store.pushEnabledAt = iso(0);
  const transport = new FakeTransport();
  registerEntitled(store, INSTALLATION, TOKEN, 'ios', iso(-HOUR));
  store.setPreferences(
    INSTALLATION,
    { stateCodes: ['TX'], allergens: [], retailerIds: [] },
    iso(-HOUR),
  );
  const runAt = (ms: number) =>
    runPushDelivery(store, {
      transport,
      entitlements: ACTIVE_SOURCE,
      sendingHold: NEVER_HELD,
      dryRun: false,
      now: () => new Date(T0 + ms),
    });
  const subscription = () => store.subscriptionOf(INSTALLATION);
  const deliveryFor = (eventId: string) =>
    [...store.deliveries.values()].find((delivery) => delivery.eventId === eventId);
  return { store, transport, runAt, subscription, deliveryFor };
}

const UNREGISTERED: PushReceipt = {
  status: 'error',
  message: 'The recipient device is not registered with FCM/APNs.',
  details: { error: 'DeviceNotRegistered' },
};

test('the receipt delay the timeline below depends on is 15 minutes', () => {
  assert.equal(RECEIPT_DELAY_MINUTES, 15);
});

test('under 13, delivery NOT activated: nothing is sent, and the subscription stays enabled', async () => {
  const { store, transport, runAt, subscription } = setup(false);
  // The device unregistered locally at +30 min; the server cannot know.
  addRecall(store, HOUR);
  for (const at of [2 * HOUR, 26 * HOUR, 30 * 24 * HOUR]) await runAt(at);
  assert.equal(transport.sent.length, 0);
  assert.equal(subscription()?.enabled, true, 'only a send can reveal the dead token');
});

test('under 13, delivery activated: queued alerts still go out until a receipt reports the dead token', async () => {
  const { store, transport, runAt, subscription, deliveryFor } = setup(true);
  // +30 min: the app shows the under-13 stop and unregisters from APNs.
  // The server row is untouched.
  const first = addRecall(store, HOUR);

  // Run 1 (+2 h): the queued alert is handed to Expo; Expo's TICKET is ok
  // (APNs has not answered yet). The subscription is still enabled.
  await runAt(2 * HOUR);
  assert.equal(deliveryFor(first)?.status, 'ticket_accepted');
  assert.equal(subscription()?.enabled, true);
  transport.receipts['ticket-0'] = UNREGISTERED; // APNs: token no longer valid

  // Run 2 (+2 h 10 min, under the 15-minute receipt delay): the receipt is
  // not read yet, so a second queued alert is ALSO sent.
  const second = addRecall(store, 2 * HOUR + 5 * MINUTE);
  await runAt(2 * HOUR + 10 * MINUTE);
  assert.equal(deliveryFor(second)?.status, 'ticket_accepted');
  assert.equal(transport.sent.length, 2);
  assert.equal(subscription()?.enabled, true);
  transport.receipts['ticket-1'] = UNREGISTERED;

  // Run 3 (+2 h 20 min): the first receipt is due (20 min old; the second
  // is only 10), read BEFORE new work, and disables the subscription. A
  // third alert queued meanwhile is not sent.
  const third = addRecall(store, 2 * HOUR + 15 * MINUTE);
  const run3 = await runAt(2 * HOUR + 20 * MINUTE);
  assert.equal(run3.metrics.tokensDisabled, 1);
  assert.equal(subscription()?.enabled, false);
  assert.equal(subscription()?.disabledReason, 'device_not_registered');
  assert.equal(deliveryFor(first)?.status, 'permanent_failure');
  assert.notEqual(deliveryFor(third)?.status, 'ticket_accepted');
  assert.equal(transport.sent.length, 2, 'nothing more after the disable');

  // Run 4: the in-flight second alert's receipt is settled too; still 2 sends.
  await runAt(3 * HOUR);
  assert.equal(deliveryFor(second)?.status, 'permanent_failure');
  assert.equal(transport.sent.length, 2);
});

test('under 13, when Expo already knows the token is dead: disabled on the first send attempt', async () => {
  const { store, transport, runAt, subscription } = setup(true);
  addRecall(store, HOUR);
  addRecall(store, HOUR + MINUTE);
  transport.ticketFor = () => ({
    status: 'error',
    message: 'not registered',
    details: { error: 'DeviceNotRegistered' },
  });
  const run = await runAt(2 * HOUR);
  assert.equal(subscription()?.enabled, false);
  assert.ok(Number(run.metrics.tokensDisabled) >= 1);
});

test('revoked consent: disabled at once; queued rows are never sent; in-flight rows cannot be recalled', async () => {
  const { store, transport, runAt, subscription, deliveryFor } = setup(true);
  const inFlight = addRecall(store, HOUR);
  await runAt(2 * HOUR); // handed to Expo before the revocation
  assert.equal(deliveryFor(inFlight)?.status, 'ticket_accepted');

  // A new recall is ledgered and its row created, then the parent revokes
  // before the next send: apply_consent_revocation disables the row.
  const queued = addRecall(store, 2 * HOUR + 5 * MINUTE);
  await store.createDeliveryIfAbsent(queued, subscription()!.id, iso(2 * HOUR + 6 * MINUTE));
  await store.disableSubscription(
    subscription()!.id,
    'consent_revoked',
    iso(2 * HOUR + 7 * MINUTE),
  );

  const next = await runAt(2 * HOUR + 10 * MINUTE);
  assert.equal(deliveryFor(queued)?.status, 'permanent_failure');
  assert.equal(deliveryFor(queued)?.failureCode, 'subscription_disabled');
  assert.equal(transport.sent.length, 1, 'only the alert sent before the revocation');
  assert.equal(next.metrics.deliveriesCreated, 0);

  // Later recalls create nothing for the disabled subscription.
  addRecall(store, 3 * HOUR);
  const later = await runAt(4 * HOUR);
  assert.equal(later.metrics.deliveriesCreated, 0);
  assert.equal(transport.sent.length, 1);
  assert.equal(subscription()?.disabledReason, 'consent_revoked');
});
