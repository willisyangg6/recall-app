/**
 * The overnight sending hold (D1): no send while it is 22:00–09:59 in
 * America/New_York. These tests use the REAL rule and real UTC instants:
 * the boundaries in daylight and standard time, both nights the clocks
 * change, and the worker holding a queued alert overnight without changing
 * any eligibility decision.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MemoryPushStore } from './memory-push-store';
import { isSendingHeld, newYorkHour } from './sending-hold';
import { ACTIVE_SOURCE, FAR_FUTURE, registerEntitled } from './test-entitlement';
import type { PushMessage, PushReceipt, PushTicket, PushTransport } from './types';
import { runPushDelivery } from './worker';

const at = (utc: string) => new Date(utc);

test('daylight time: held from 22:00 to 09:59 New York (02:00–13:59 UTC)', () => {
  assert.equal(isSendingHeld(at('2026-10-14T01:59:59Z')), false); // 21:59:59 EDT
  assert.equal(isSendingHeld(at('2026-10-14T02:00:00Z')), true); // 22:00 EDT
  assert.equal(isSendingHeld(at('2026-10-14T08:00:00Z')), true); // 04:00 EDT
  assert.equal(isSendingHeld(at('2026-10-14T13:59:59Z')), true); // 09:59:59 EDT
  assert.equal(isSendingHeld(at('2026-10-14T14:00:00Z')), false); // 10:00 EDT
  assert.equal(isSendingHeld(at('2026-10-14T20:00:00Z')), false); // 16:00 EDT
});

test('standard time: the same local hours, one UTC hour later (03:00–14:59 UTC)', () => {
  assert.equal(isSendingHeld(at('2026-11-15T02:59:59Z')), false); // 21:59:59 EST
  assert.equal(isSendingHeld(at('2026-11-15T03:00:00Z')), true); // 22:00 EST
  assert.equal(isSendingHeld(at('2026-11-15T14:59:59Z')), true); // 09:59:59 EST
  assert.equal(isSendingHeld(at('2026-11-15T15:00:00Z')), false); // 10:00 EST
});

test('the night daylight time ends (2026-11-01): both 01:xx hours are held', () => {
  assert.equal(newYorkHour(at('2026-11-01T05:30:00Z')), 1); // 01:30 EDT
  assert.equal(newYorkHour(at('2026-11-01T06:30:00Z')), 1); // 01:30 EST, the repeated hour
  assert.equal(isSendingHeld(at('2026-11-01T05:30:00Z')), true);
  assert.equal(isSendingHeld(at('2026-11-01T06:30:00Z')), true);
  assert.equal(isSendingHeld(at('2026-11-01T14:59:59Z')), true); // 09:59:59 EST
  assert.equal(isSendingHeld(at('2026-11-01T15:00:00Z')), false); // 10:00 EST
});

test('the night daylight time starts (2027-03-14): 02:xx never exists, 10:00 EDT releases', () => {
  assert.equal(newYorkHour(at('2027-03-14T06:59:59Z')), 1); // 01:59:59 EST
  assert.equal(newYorkHour(at('2027-03-14T07:00:00Z')), 3); // 03:00 EDT
  assert.equal(isSendingHeld(at('2027-03-14T13:59:59Z')), true); // 09:59:59 EDT
  assert.equal(isSendingHeld(at('2027-03-14T14:00:00Z')), false); // 10:00 EDT
});

// ── The worker, with the real rule ──────────────────────────────────────────

class Transport implements PushTransport {
  sent: PushMessage[] = [];
  private n = 0;
  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    this.sent.push(...messages);
    return messages.map(() => ({ status: 'ok' as const, id: `t-${(this.n += 1)}` }));
  }
  async getReceipts(ids: string[]): Promise<Record<string, PushReceipt>> {
    return Object.fromEntries(ids.map((id) => [id, { status: 'ok' as const }]));
  }
}

let seq = 0;
function addEvent(
  store: MemoryPushStore,
  createdAt: string,
  retraction = false,
  publishedAt = '2026-10-13',
): { id: string; caseId: string } {
  seq += 1;
  const id = `${String(seq).padStart(8, '0')}-0000-4000-8000-0000000000aa`;
  const caseId = `${String(seq).padStart(8, '0')}-0000-4000-8000-0000000000bb`;
  store.addEvent({
    id,
    recallCaseId: caseId,
    kind: retraction ? 'material_update' : 'initial',
    triggerRuleId: retraction ? 'retraction' : 'new_case',
    materialChangeRef: retraction ? `fp-retraction-${seq}` : null,
    payloadSummary: 'summary',
    createdAt,
    projection: {
      sourceAgency: 'FDA',
      noticeType: 'recall',
      state: retraction ? 'retracted' : 'active',
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
      publishedAt,
      lastPublicActivityAt: publishedAt,
    } as never,
  });
  if (retraction)
    store.setCase({
      id: caseId,
      projection: store.cases.get(caseId)!.projection,
      state: 'retracted',
    });
  return { id, caseId };
}

function setup(entitledUntil = FAR_FUTURE) {
  const store = new MemoryPushStore();
  store.pushEnabledAt = '2026-10-13T12:00:00.000Z';
  const transport = new Transport();
  const installation = 'a'.repeat(32);
  registerEntitled(store, installation, 'ExponentPushToken[a]', 'ios', '2026-10-13T13:00:00.000Z');
  store.setPreferences(
    installation,
    { stateCodes: ['CA'], allergens: [], retailerIds: [] },
    '2026-10-13T13:00:00.000Z',
  );
  if (entitledUntil !== FAR_FUTURE) {
    store.seedEntitlement(installation, {
      status: 'active',
      expiresAt: entitledUntil,
      checkedAt: '2026-10-13T13:00:00.000Z',
      entitledSince: '2026-10-13T13:00:00.000Z',
    });
  }
  const runAt = (utc: string, dryRun = false) =>
    runPushDelivery(store, {
      transport,
      // The real hold: no sendingHold override.
      entitlements:
        entitledUntil === FAR_FUTURE
          ? ACTIVE_SOURCE
          : { check: async () => ({ active: true, expiresAt: entitledUntil }) },
      dryRun,
      now: () => new Date(utc),
    });
  return { store, transport, runAt };
}

test('a recall ledgered at night is matched at once, held, and sent by the first run after 10:00', async () => {
  const { store, transport, runAt } = setup();
  addEvent(store, '2026-10-14T03:00:00.000Z'); // 23:00 EDT

  const night = await runAt('2026-10-14T03:07:00.000Z');
  assert.equal(night.metrics.sendingHeld, true);
  assert.equal(night.metrics.deliveriesCreated, 1); // eligibility decided exactly as before
  assert.equal(night.metrics.sendingHoldDeferred, 1);
  assert.equal(transport.sent.length, 0);
  assert.equal([...store.deliveries.values()][0].status, 'pending');

  const early = await runAt('2026-10-14T13:52:00.000Z'); // 09:52 EDT: still held
  assert.equal(early.metrics.sendingHeld, true);
  assert.equal(transport.sent.length, 0);

  const morning = await runAt('2026-10-14T14:07:00.000Z'); // 10:07 EDT
  assert.equal(morning.metrics.sendingHeld, false);
  assert.equal(transport.sent.length, 1);
  assert.equal(morning.metrics.deliveriesCreated, 0); // the night's row, not a new one
});

test('the hold changes no eligibility decision: the held and the daytime run match identically', async () => {
  const held = setup();
  const day = setup();
  addEvent(held.store, '2026-10-14T03:00:00.000Z');
  addEvent(day.store, '2026-10-14T15:00:00.000Z');
  const nightRun = await held.runAt('2026-10-14T03:07:00.000Z');
  const dayRun = await day.runAt('2026-10-14T15:07:00.000Z');
  for (const key of [
    'eventsExamined',
    'deliveriesCreated',
    'subscriptionHorizonSkipped',
    'preferenceSkipped',
    'entitlementSkipped',
    'lifecycleSkipped',
  ]) {
    assert.equal(nightRun.metrics[key], dayRun.metrics[key], key);
  }
});

test('a subscription that expires overnight gets nothing in the morning (judged again at the send)', async () => {
  const { store, transport, runAt } = setup('2026-10-14T09:00:00.000Z'); // expires 05:00 EDT
  addEvent(store, '2026-10-14T03:00:00.000Z');
  await runAt('2026-10-14T03:07:00.000Z');
  assert.equal([...store.deliveries.values()][0].status, 'pending');

  await runAt('2026-10-14T14:07:00.000Z');
  assert.equal(transport.sent.length, 0);
  const row = [...store.deliveries.values()][0];
  assert.equal(row.status, 'permanent_failure');
  assert.equal(row.failureCode, 'not_entitled');
});

test('no exemptions: a retraction is held overnight too', async () => {
  const { store, transport, runAt } = setup();
  addEvent(store, '2026-10-14T03:00:00.000Z', true);
  const night = await runAt('2026-10-14T03:07:00.000Z');
  assert.equal(night.metrics.deliveriesCreated, 1);
  assert.equal(transport.sent.length, 0);
  await runAt('2026-10-14T14:07:00.000Z');
  assert.equal(transport.sent.length, 1);
  assert.match(transport.sent[0].title, /^Recall retracted:/);
});

test('a dry run during the hold reports zero would-send and what it would hold', async () => {
  const { store, transport, runAt } = setup();
  addEvent(store, '2026-10-14T03:00:00.000Z');
  const dry = await runAt('2026-10-14T03:07:00.000Z', true);
  assert.equal(dry.metrics.sendingHeld, true);
  assert.equal(dry.metrics.sent, 0);
  assert.equal(dry.metrics.sendingHoldDeferred, 1);
  assert.equal(store.deliveries.size, 0);
  assert.equal(transport.sent.length, 0);
});

test('late-alert dating (D4) is judged at the send: a recall held overnight past day 3 is dated', async () => {
  const { store, transport, runAt } = setup();
  // Announced Oct 11; ledgered at 23:00 EDT on Oct 13 (two days: not late).
  addEvent(store, '2026-10-14T03:00:00.000Z', false, '2026-10-11');
  await runAt('2026-10-14T03:07:00.000Z');
  assert.equal(transport.sent.length, 0);
  // Released at 10:07 EDT on Oct 14: three days after the announcement.
  await runAt('2026-10-14T14:07:00.000Z');
  assert.equal(transport.sent.length, 1);
  assert.match(transport.sent[0].body, /FDA announced this Oct 11\. Check your package/);
});
