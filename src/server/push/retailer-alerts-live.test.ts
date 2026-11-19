/**
 * STAGING ONLY: retailer-only notice alerts end to end on an isolated local
 * stack with every migration (20261119000000 included), the REAL approval
 * step, the REAL Supabase push store and the REAL worker, over the retailers'
 * live public letters (read-only fetches; every write lands in the local
 * stack). Nothing is sent: the transport records messages.
 *
 *   SUPABASE_WORKDIR=<…/x-verify-stack> PATH=<shim>:$PATH LOTLY_RETAILER_STAGING=1 \
 *     npx tsx --test src/server/push/retailer-alerts-live.test.ts
 *
 * Optional: LOTLY_ALERT_REPORT=<file.json> writes the run-by-run report.
 *
 * The stack must be freshly reset; the agency case for Priano is copied in by
 * the operator (read-only from production) only when the test asks for it
 * (step 5), as `PRIANO_CASE_JSON` = the recall_cases row as JSON.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  applyApprovalPlan,
  planApproval,
  planWithdrawal,
  readApprovalRequest,
  type ApprovalRequest,
} from '../retailer/approval';
import { SupabaseApprovalStore } from '../retailer/approval-store';
import {
  applyRetailerPlan,
  liveCostcoSource,
  liveRetailerSource,
  planRetailerRun,
} from '../retailer/costco-monitor';
import { extractPdfPageTexts } from '../retailer/pdf-text';
import { ALDI_SOURCE, COSTCO_SOURCE } from '../retailer/sources';
import { SupabaseRetailerNoticeStore } from '../retailer/store';
import { createSupabaseServerClient } from '../store/supabase-store';
import { SupabasePushStore } from './push-store';
import { ACTIVE_SOURCE, FAR_FUTURE } from './test-entitlement';
import type { PushMessage, PushReceipt, PushTicket, PushTransport } from './types';
import { runPushDelivery } from './worker';

function stagingStack(): { apiUrl: string; serviceKey: string } | null {
  if (process.env.LOTLY_RETAILER_STAGING !== '1') return null;
  if (!/verify-stack/.test(process.env.SUPABASE_WORKDIR ?? '')) return null;
  let env: string;
  try {
    env = execFileSync('supabase', ['status', '-o', 'env'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 30_000,
    });
  } catch {
    return null;
  }
  const read = (key: string) => env.match(new RegExp(`^${key}="?([^"\n]+)"?$`, 'm'))?.[1] ?? null;
  const apiUrl = read('API_URL');
  const serviceKey = read('SERVICE_ROLE_KEY');
  if (!apiUrl || !serviceKey) return null;
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(apiUrl)) return null;
  return { apiUrl, serviceKey };
}

const STACK = stagingStack();
const SKIP = STACK
  ? false
  : 'staging only: LOTLY_RETAILER_STAGING=1 and a verify-stack SUPABASE_WORKDIR';

class RecordingTransport implements PushTransport {
  sent: PushMessage[] = [];
  private n = 0;
  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    this.sent.push(...messages);
    return messages.map(() => ({ status: 'ok' as const, id: `staging-ticket-${(this.n += 1)}` }));
  }
  /** Every ticket this transport issued is delivered (an `ok` receipt). */
  async getReceipts(ids: string[]): Promise<Record<string, PushReceipt>> {
    return Object.fromEntries(ids.map((id) => [id, { status: 'ok' } as PushReceipt]));
  }
  authProblem(): string | null {
    return null;
  }
}

const APPROVALS = join(__dirname, '..', 'retailer', 'fixtures', 'approvals');
function request(file: string): ApprovalRequest {
  const parsed = readApprovalRequest(JSON.parse(readFileSync(join(APPROVALS, file), 'utf8')));
  assert.ok(!('error' in parsed), file);
  return { ...parsed, approvedBy: 'staging (retailer alerts)' };
}

/** Synthetic installations, one per truth-table row (no real person). */
const SHOPPERS: [
  string,
  { states: string[]; allergens?: string[]; retailers?: string[] },
  string,
][] = [
  ['ca-costco', { states: ['CA'], retailers: ['costco'] }, '1.2.0'],
  ['ca-only', { states: ['CA'] }, '1.2.0'],
  ['nostate-costco', { states: [], retailers: ['costco'] }, '1.2.0'],
  ['ca-costco-old-app', { states: ['CA'], retailers: ['costco'] }, '1.1.0'],
  ['al', { states: ['AL'] }, '1.2.0'],
  ['ia-costco', { states: ['IA'], retailers: ['costco'] }, '1.2.0'],
  ['tx-costco', { states: ['TX'], retailers: ['costco'] }, '1.2.0'],
  ['ga', { states: ['GA'] }, '1.2.0'],
  ['nc-aldi', { states: ['NC'], retailers: ['aldi'] }, '1.2.0'],
  ['al-old-app', { states: ['AL'] }, '1.1.0'],
];

const tokenOf = (installation: string) => `ExponentPushToken[staging-${installation}]`;
const shoppersOf = (messages: PushMessage[]) =>
  messages.map((m) => /staging-([^\]]+)/.exec(m.to)![1]).sort();

test(
  'retailer-only alerts on staging: matching, exclusion, withdrawal, backfill, one recall one alert',
  { skip: SKIP, timeout: 600_000 },
  async () => {
    const { apiUrl, serviceKey } = STACK!;
    const client = createSupabaseServerClient(apiUrl, serviceKey);
    const notices = new SupabaseRetailerNoticeStore(client);
    const approvals = new SupabaseApprovalStore(client);
    const report: Record<string, unknown>[] = [];
    let clock = Date.parse('2025-11-10T16:00:00Z');
    const now = () => new Date(clock);

    // ── Setup: activation, shoppers, the retailers' live letters ────────────
    const ok = (r: { error: { message: string } | null }, what: string) =>
      assert.equal(r.error, null, `${what}: ${r.error?.message}`);
    ok(
      await client
        .from('push_delivery_config')
        .upsert({ id: true, push_enabled_at: '2025-01-01T00:00:00Z', activated_by: 'staging' }),
      'activation',
    );
    for (const [id, prefs, appVersion] of SHOPPERS) {
      ok(
        await client.from('push_subscriptions').upsert(
          {
            installation_id: `staging-${id}`,
            expo_push_token: tokenOf(id),
            platform: 'ios',
            app_version: appVersion,
            enabled: true,
            enabled_at: '2025-01-01T00:00:00Z',
            registered_at: '2025-01-01T00:00:00Z',
            last_seen_at: '2025-01-01T00:00:00Z',
            purchase_id: `p-staging-${id}`.padEnd(16, '0'),
            entitlement_status: 'active',
            entitlement_expires_at: FAR_FUTURE,
            entitlement_checked_at: '2025-01-01T00:00:00Z',
            entitled_since: '2025-01-01T00:00:00Z',
          },
          { onConflict: 'installation_id' },
        ),
        `subscription ${id}`,
      );
      ok(
        await client.from('installation_preferences').upsert(
          {
            installation_id: `staging-${id}`,
            state_codes: prefs.states,
            allergens: prefs.allergens ?? [],
            retailer_ids: prefs.retailers ?? [],
            updated_at: '2025-01-01T00:00:00Z',
            allergen_consent_version: 'allergens-v1',
            allergen_consent_at: '2025-01-01T00:00:00Z',
            allergen_consent_decided_at: '2025-01-01T00:00:00Z',
          },
          { onConflict: 'installation_id' },
        ),
        `preferences ${id}`,
      );
    }
    for (const [spec, source] of [
      [COSTCO_SOURCE, liveCostcoSource()],
      [ALDI_SOURCE, liveRetailerSource(ALDI_SOURCE)],
    ] as const) {
      await applyRetailerPlan(notices, await planRetailerRun(spec, notices, source, now));
    }

    const transport = new RecordingTransport();
    const run = async (label: string, options: { held?: boolean; dryRun?: boolean } = {}) => {
      transport.sent = [];
      const result = await runPushDelivery(new SupabasePushStore(client, apiUrl), {
        transport,
        entitlements: ACTIVE_SOURCE,
        sendingHold: options.held ? () => true : () => false,
        dryRun: options.dryRun ?? false,
        now,
      });
      const recipients = shoppersOf(transport.sent);
      report.push({ label, at: now().toISOString(), recipients, metrics: result.metrics });
      return { recipients, metrics: result.metrics as Record<string, number> };
    };
    const approve = async (file: string) => {
      const plan = await planApproval(approvals, request(file), now, extractPdfPageTexts);
      assert.deepEqual(plan.problems, [], file);
      await applyApprovalPlan(approvals, plan);
      return plan;
    };

    // 1. Unknown distribution (Caesar, no state stated), 3 days old: the store
    //    signal reaches every Costco shopper; CA alone and an app that cannot
    //    open a retailer notice are not reached.
    const caesar = await approve('caesar-salad.json');
    assert.deepEqual(
      caesar.writes.filter((w) => w.kind === 'notification_event').map((w) => w.event.suppressed),
      [null],
    );
    clock += 30 * 60_000;
    const r1 = await run('caesar: unknown distribution');
    // Unknown is never an exclusion: every Costco shopper qualifies on the
    // store signal, whatever state they chose; CA without Costco does not.
    assert.deepEqual(r1.recipients, ['ca-costco', 'ia-costco', 'nostate-costco', 'tx-costco']);
    assert.ok(r1.metrics.clientUnsupportedSkipped >= 1);

    // 2. First publication of old intake: Madeleines (2026-04-07) approved on
    //    2026-11-19 is ledgered as backfill and alerts nobody.
    clock = Date.parse('2026-11-19T15:30:00Z'); // 10:30 New York
    const madeleines = await approve('traditional-madeleines.json');
    assert.deepEqual(
      madeleines.writes
        .filter((w) => w.kind === 'notification_event')
        .map((w) => [w.event.kind, w.event.suppressed]),
      [['initial', 'backfill']],
    );

    // 3. Kirkland (AL, FL, GA, IA, NC, …): matching shoppers are queued under the
    //    overnight hold; then the approval is withdrawn and the queued alerts
    //    fail closed — unapproved content never sends.
    await approve('kirkland-whipped-cream.json');
    const queued = await run('kirkland: queued under hold', { held: true });
    assert.deepEqual(queued.recipients, []);
    const { data: pending } = await client
      .from('notification_deliveries')
      .select('status, push_subscriptions(installation_id)')
      .eq('status', 'pending');
    const pendingFor = (pending ?? [])
      .map(
        (row) => (row.push_subscriptions as unknown as { installation_id: string }).installation_id,
      )
      .sort();
    // Kirkland's letter states AL, FL, GA, IA, IL, IN, MO, MS, NC, SC, TN, WI.
    // TX + Costco is an explicit exclusion: the store choice never overrides it.
    assert.deepEqual(pendingFor, [
      'staging-al',
      'staging-ga',
      'staging-ia-costco',
      'staging-nc-aldi',
      'staging-nostate-costco',
    ]);
    await applyApprovalPlan(
      approvals,
      await planWithdrawal(approvals, 'costco', 'bltdc8f3dbbb7e4b836', 'staging: withdrawn', now),
    );
    clock += 60_000;
    const withdrawn = await run('kirkland: withdrawn before send');
    assert.deepEqual(withdrawn.recipients, []);
    assert.equal(withdrawn.metrics.retailerNotVisibleSkipped >= 0, true);
    const { data: failed } = await client
      .from('notification_deliveries')
      .select('failure_code')
      .eq('failure_code', 'case_retailer_not_visible');
    assert.equal((failed ?? []).length, 5);

    // 4. Priano (ALDI; AL, GA, NC, SC), published before any agency case:
    //    reaches AL, GA and the NC ALDI shopper; never the 1.1.0 app.
    clock += 60_000;
    await approve('aldi-priano-tortelloni.json');
    const priano = await run('priano: retailer first');
    assert.deepEqual(priano.recipients, ['al', 'ga', 'nc-aldi']);

    // 5. FDA then publishes the same recall. The operator copies production's
    //    case in; its new-recall alert reaches only shoppers not already alerted.
    const caseJson = process.env.PRIANO_CASE_JSON;
    if (caseJson) {
      const row = JSON.parse(readFileSync(caseJson, 'utf8')) as { id: string; projection: unknown };
      ok(
        await client.from('recall_cases').upsert({
          id: row.id,
          projection: row.projection,
          timeline: [],
          last_changed_at: now().toISOString(),
        }),
        'agency case',
      );
      clock += 60 * 60_000;
      ok(
        await client.from('notification_events').insert({
          recall_case_id: row.id,
          kind: 'initial',
          trigger_rule_id: 'new_case',
          dedup_key: row.id,
          payload_summary: 'FDA Priano',
          created_at: now().toISOString(),
        }),
        'agency initial',
      );
      clock += 5 * 60_000;
      const agency = await run('priano: agency case later');
      // AL and GA already had this recall's alert; the 1.1.0 AL app had not.
      assert.deepEqual(agency.recipients, ['al-old-app']);
      assert.equal(agency.metrics.duplicateAlertSkipped, 3);

      // 6. A genuine agency expansion still follows the update policy.
      clock += 30 * 60_000;
      ok(
        await client.from('notification_events').insert({
          recall_case_id: row.id,
          kind: 'material_update',
          trigger_rule_id: 'expansion_products',
          dedup_key: `mu:${row.id}:expansion_products:staging`,
          material_change_ref: 'staging',
          payload_summary: 'Affected products expanded.',
          created_at: now().toISOString(),
        }),
        'agency update',
      );
      clock += 5 * 60_000;
      const update = await run('priano: agency expansion');
      assert.deepEqual(update.recipients, ['al', 'al-old-app', 'ga', 'nc-aldi']);

      // 7. One card: the monitor re-decides Priano against the agency case.
      await applyRetailerPlan(
        notices,
        await planRetailerRun(ALDI_SOURCE, notices, liveRetailerSource(ALDI_SOURCE), now),
      );
      const { data: shown } = await client.rpc('consumer_retailer_notices');
      assert.ok(
        !((shown ?? []) as { publisher: string }[]).some((n) => n.publisher === 'aldi'),
        'Priano is no longer a standalone card',
      );
    }

    // 8. An event for a notice that was never approved is never eligible.
    const { data: unapproved } = await client
      .from('retailer_notices')
      .select('id')
      .eq('publisher', 'costco')
      .eq('decision', 'review')
      .limit(1)
      .single();
    ok(
      await client.from('notification_events').insert({
        retailer_notice_id: (unapproved as { id: string }).id,
        kind: 'initial',
        trigger_rule_id: 'new_retailer_notice',
        dedup_key: `retailer_notice:${(unapproved as { id: string }).id}`,
        payload_summary: 'never approved',
        created_at: now().toISOString(),
      }),
      'unapproved event',
    );
    clock += 60_000;
    const never = await run('unapproved notice');
    assert.deepEqual(never.recipients, []);
    assert.ok(never.metrics.retailerNotVisibleSkipped >= 1);

    // The alert dry run as an operator would read it, after everything above.
    clock += 60_000;
    await run('final dry run', { dryRun: true });

    if (process.env.LOTLY_ALERT_REPORT) {
      writeFileSync(process.env.LOTLY_ALERT_REPORT, `${JSON.stringify(report, null, 2)}\n`);
    }
  },
);
