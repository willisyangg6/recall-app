/**
 * Installation data deletion (C7.1) — server-side semantics.
 *
 * Two layers of proof:
 *
 * 1. Behavioral, against MemoryPushStore.deleteInstallationData — the mirror
 *    of the delete_installation_data RPC — composed with the REAL delivery
 *    worker: scope-exactness (only the target installation's rows), shared
 *    records untouched byte-for-byte, idempotency, validation, the
 *    no-existence-oracle property, and the no-backfill guarantee (a
 *    re-registration after deletion can never receive events created before
 *    it — the horizon seam, not delivery-row dedup, is what prevents it, so
 *    deleting delivery rows is safe).
 *
 * 2. Textual, against the migration SQL itself — the properties that only
 *    exist in the SQL: SECURITY DEFINER + pinned search_path, the exact
 *    validation regex, the FOR UPDATE serialization lock, FK-safe delete
 *    order, scope (no statement may touch any shared table), and the
 *    revoke/grant surface. The same pin style as workflow-schedule.test.ts.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { MemoryPushStore } from './memory-push-store';
import type { PushMessage, PushReceipt, PushTicket, PushTransport } from './types';
import { runPushDelivery } from './worker';

const T0 = Date.parse('2026-09-01T00:00:00.000Z');
const HOUR = 3_600_000;

function iso(offsetMs: number): string {
  return new Date(T0 + offsetMs).toISOString();
}

class FakeTransport implements PushTransport {
  sends: PushMessage[][] = [];
  private counter = 0;

  get sentMessages(): PushMessage[] {
    return this.sends.flat();
  }

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    this.sends.push(messages);
    return messages.map(() => ({ status: 'ok', id: `ticket-${(this.counter += 1)}` }));
  }

  async getReceipts(ticketIds: string[]): Promise<Record<string, PushReceipt>> {
    const out: Record<string, PushReceipt> = {};
    for (const id of ticketIds) out[id] = { status: 'ok' };
    return out;
  }
}

let eventCounter = 0;
function addEvent(store: MemoryPushStore, createdAtMs: number): string {
  eventCounter += 1;
  const id = `${String(eventCounter).padStart(8, '0')}-0000-4000-8000-000000000000`;
  store.addEvent({
    id,
    recallCaseId: `${String(eventCounter).padStart(8, '0')}-0000-4000-8000-00000000cccc`,
    kind: 'initial',
    triggerRuleId: 'new_case',
    payloadSummary: 'summary',
    createdAt: iso(createdAtMs),
    projection: {
      sourceAgency: 'FDA' as const,
      noticeType: 'recall' as const,
      state: 'active' as const,
      closedYear: null,
      classification: { value: 'not_yet_classified' as const, sourceText: null },
      title: 'Acme Recalls Trail Mix',
      summaryText: '',
      summaryHtml: null,
      reasonText: null,
      hazardCategory: 'allergen',
      pathogenOrAllergen: 'peanut',
      recallingFirm: { displayName: 'Acme', rawVariants: [] },
      brands: [],
      productDescription: 'Trail Mix',
      retailerNames: [],
      heroImageUrl: null,
      // Nationwide: matches every state-holding installation, so both seeded
      // installations receive deliveries and deletion scope is fully exercised.
      geography: {
        scope: 'nationwide' as const,
        states: [],
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
    },
  });
  return id;
}

const INSTALL_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const INSTALL_B = 'bbbbbbbb-0000-4000-8000-000000000002';

/**
 * Two live installations with preferences, delivered history, and one
 * pending delivery each — the realistic state a deletion lands in.
 */
async function seededStore(): Promise<{ store: MemoryPushStore; transport: FakeTransport }> {
  const store = new MemoryPushStore();
  store.pushEnabledAt = iso(0);
  const transport = new FakeTransport();
  store.register(INSTALL_A, 'ExpoPushToken[AAAA]', 'ios', iso(0));
  store.register(INSTALL_B, 'ExpoPushToken[BBBB]', 'android', iso(0));
  store.setPreferences(
    INSTALL_A,
    { stateCode: 'CA', allergens: ['peanut'], retailerIds: ['costco'] },
    iso(0),
  );
  store.setPreferences(INSTALL_B, { stateCode: 'TX', allergens: [], retailerIds: [] }, iso(0));
  addEvent(store, 1 * HOUR);
  // Sent + ticketed for both installations.
  await runPushDelivery(store, { transport, dryRun: false, now: () => new Date(T0 + 2 * HOUR) });
  // A second event left PENDING (created but not sent: maxSends 0).
  addEvent(store, 3 * HOUR);
  await runPushDelivery(store, {
    transport,
    dryRun: false,
    now: () => new Date(T0 + 3 * HOUR),
    maxSendsPerRun: 0,
  });
  return { store, transport };
}

function snapshotInstallation(store: MemoryPushStore, installationId: string) {
  const subscriptions = [...store.subscriptions.values()].filter(
    (row) => row.installationId === installationId,
  );
  const subscriptionIds = new Set(subscriptions.map((row) => row.id));
  return JSON.parse(
    JSON.stringify({
      subscriptions,
      preferences: store.preferences.get(installationId) ?? null,
      deliveries: [...store.deliveries.values()]
        .filter((d) => subscriptionIds.has(d.subscriptionId))
        .sort((a, b) => a.id.localeCompare(b.id)),
    }),
  );
}

test('deletion removes exactly the target installation: preferences, subscriptions, deliveries', async () => {
  const { store } = await seededStore();
  const before = snapshotInstallation(store, INSTALL_A);
  assert.equal(before.subscriptions.length, 1, 'seed must have a subscription');
  assert.ok(before.preferences, 'seed must have preferences');
  assert.equal(before.deliveries.length, 2, 'seed must have delivered + pending rows');

  store.deleteInstallationData(INSTALL_A);

  const after = snapshotInstallation(store, INSTALL_A);
  assert.deepEqual(after, { subscriptions: [], preferences: null, deliveries: [] });
});

test('another installation and the shared ledger remain byte-identical', async () => {
  const { store } = await seededStore();
  const bBefore = snapshotInstallation(store, INSTALL_B);
  const eventsBefore = JSON.parse(JSON.stringify(store.events));

  store.deleteInstallationData(INSTALL_A);

  assert.deepEqual(snapshotInstallation(store, INSTALL_B), bBefore);
  assert.deepEqual(JSON.parse(JSON.stringify(store.events)), eventsBefore);
});

test('repeated deletion is idempotent, and a nonexistent id is indistinguishable from a deleted one', async () => {
  const { store } = await seededStore();
  store.deleteInstallationData(INSTALL_A);
  const afterFirst = JSON.parse(JSON.stringify([...store.subscriptions.values()]));

  // Deleting again — and deleting an id that never existed — both return
  // void and change nothing: no existence oracle, safe retries.
  assert.equal(store.deleteInstallationData(INSTALL_A), undefined);
  assert.equal(store.deleteInstallationData('cccccccc-0000-4000-8000-000000000003'), undefined);
  assert.deepEqual(JSON.parse(JSON.stringify([...store.subscriptions.values()])), afterFirst);
});

test('a malformed installation id is rejected before anything is read or deleted', async () => {
  const { store } = await seededStore();
  const before = JSON.parse(JSON.stringify([...store.subscriptions.values()]));
  for (const bad of ['', 'short', 'a'.repeat(65), 'has spaces here!', "x'; drop table--"]) {
    assert.throws(() => store.deleteInstallationData(bad), /invalid installation id/);
  }
  assert.deepEqual(JSON.parse(JSON.stringify([...store.subscriptions.values()])), before);
});

test('NO BACKFILL: a re-registration after deletion never receives pre-deletion events', async () => {
  const { store, transport } = await seededStore();
  const sentBefore = transport.sentMessages.length;
  store.deleteInstallationData(INSTALL_A);

  // The same device re-enables alerts at T+6h — same installation id string,
  // but a FRESH subscription row (the old row is gone, so the RPC takes its
  // insert path) with enabledAt = now. A brand-new installation id behaves
  // identically; both are covered.
  store.register(INSTALL_A, 'ExpoPushToken[AAAA]', 'ios', iso(6 * HOUR));
  store.register(
    'cccccccc-0000-4000-8000-000000000003',
    'ExpoPushToken[CCCC]',
    'ios',
    iso(6 * HOUR),
  );

  const result = await runPushDelivery(store, {
    transport,
    dryRun: false,
    now: () => new Date(T0 + 7 * HOUR),
  });

  // Both historical events (T+1h, T+3h) predate the new enabled_at horizons:
  // structurally undeliverable — deleting the old delivery rows did not
  // resurrect them, because dedup was never what prevented delivery. The
  // fresh registrations therefore gained ZERO delivery rows; B keeps its own
  // two untouched rows and nothing else.
  const freshSubscriptionIds = new Set(
    [...store.subscriptions.values()]
      .filter((row) => row.installationId !== INSTALL_B)
      .map((row) => row.id),
  );
  assert.equal(freshSubscriptionIds.size, 2, 'the re-registration and the new install exist');
  const freshDeliveries = [...store.deliveries.values()].filter((d) =>
    freshSubscriptionIds.has(d.subscriptionId),
  );
  assert.equal(freshDeliveries.length, 0, 'no historical event reached a post-reset registration');
  // 2 events × 2 fresh subscriptions, all excluded by the enabled_at horizon.
  assert.ok((result.metrics.subscriptionHorizonSkipped as number) >= 4);
  // Nothing was sent to either fresh registration (B's own pending send may
  // legitimately go out in this run).
  for (const message of transport.sentMessages.slice(sentBefore)) {
    assert.notEqual(message.to, 'ExpoPushToken[CCCC]');
    assert.notEqual(message.to, 'ExpoPushToken[AAAA]');
  }
});

test('a deletion between delivery creation and send leaves the worker sane and sends nothing for it', async () => {
  const { store, transport } = await seededStore();
  // A's pending row (from the maxSends: 0 run) — delete A before the send.
  store.deleteInstallationData(INSTALL_A);
  const sentBefore = transport.sentMessages.length;
  const result = await runPushDelivery(store, {
    transport,
    dryRun: false,
    now: () => new Date(T0 + 4 * HOUR),
  });
  assert.equal(result.outcome, 'succeeded');
  // Everything sent AFTER the deletion goes to surviving installations only.
  for (const message of transport.sentMessages.slice(sentBefore)) {
    assert.notEqual(message.to, 'ExpoPushToken[AAAA]');
  }
});

// ── Migration pins: the properties only the SQL can prove ───────────────────

const MIGRATION = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    '..',
    'supabase',
    'migrations',
    '20260902000000_installation_deletion.sql',
  ),
  'utf8',
);
/** The statements only — with SQL comments stripped, so a commented-out line can never satisfy a pin. */
const SQL = MIGRATION.replace(/^\s*--.*$/gm, '');

test('the deletion RPC is SECURITY DEFINER with a pinned search_path and the shared id shape', () => {
  assert.match(SQL, /create or replace function public\.delete_installation_data/);
  assert.match(SQL, /security definer/);
  assert.match(SQL, /set search_path = public/);
  // The exact validation the other installation RPCs use.
  assert.ok(SQL.includes(String.raw`'^[A-Za-z0-9-]{16,64}$'`));
  assert.match(SQL, /raise exception 'invalid installation id'/);
});

test('the deletion runs in FK order behind the FOR UPDATE serialization lock', () => {
  const lock = SQL.indexOf('for update');
  const deliveries = SQL.indexOf('delete from public.notification_deliveries');
  const subscriptions = SQL.indexOf('delete from public.push_subscriptions');
  const preferences = SQL.indexOf('delete from public.installation_preferences');
  assert.ok(lock > 0 && deliveries > lock, 'lock precedes the deletes');
  assert.ok(deliveries < subscriptions, 'deliveries deleted before their subscriptions (FK)');
  assert.ok(subscriptions < preferences, 'preferences deleted last');
});

test('the migration touches ONLY the three installation tables — no shared record is reachable', () => {
  const deletes = SQL.match(/delete from\s+[a-z_.]+/g) ?? [];
  assert.deepEqual(deletes.sort(), [
    'delete from public.installation_preferences',
    'delete from public.notification_deliveries',
    'delete from public.push_subscriptions',
  ]);
  assert.doesNotMatch(
    SQL,
    /\b(update|insert|truncate|drop|alter)\s/i,
    'deletion only — no other mutation',
  );
  for (const shared of [
    'recall_cases',
    'notification_events',
    'source_records',
    'source_snapshots',
    'affected_products',
    'product_visuals',
    'ingest_runs',
    'job_leases',
    'push_delivery_config',
    'watchdog',
  ]) {
    assert.ok(!SQL.includes(shared), `migration statements must not reference ${shared}`);
  }
});

test('execute is revoked from public and granted only to the standard client roles', () => {
  assert.match(
    SQL,
    /revoke execute on function public\.delete_installation_data\(text\) from public/,
  );
  assert.match(
    SQL,
    /grant execute on function public\.delete_installation_data\(text\)\s*\n?\s*to anon, authenticated, service_role/,
  );
  // One function, no side objects.
  assert.equal((SQL.match(/create or replace function/g) ?? []).length, 1);
  assert.doesNotMatch(SQL, /create (table|policy|index|trigger)/i);
});

test('no secret, credential, or key material appears anywhere in the migration', () => {
  assert.doesNotMatch(
    MIGRATION,
    /sb_secret|service_role_key|ghp_[A-Za-z0-9]|github_pat_|password/i,
  );
});
