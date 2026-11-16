/**
 * The retailer notice flow end to end on a STAGING stack: the real monitor,
 * the real approval step, the real read path, read with the app's own
 * publishable key, and the agency feed read with the shipped loader.
 *
 * Opt-in and isolated by construction. It runs only with
 * LOTLY_RETAILER_STAGING=1 AND a SUPABASE_WORKDIR naming an isolated
 * `verify-stack` workdir (resolved through the repository's `supabase` shim),
 * so `npm run check` never writes to a shared local stack, and nothing here
 * can reach production: credentials come from that stack's own
 * `supabase status -o env`.
 *
 *   SUPABASE_WORKDIR=<…/x-verify-stack> PATH=<shim>:$PATH LOTLY_RETAILER_STAGING=1 \
 *     node --test --import tsx src/server/retailer/retailer-notice-live.test.ts
 *
 * The stack needs every migration applied and at least one agency case (any
 * FSIS or FDA ingest into it); the test is re-runnable on the same stack.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  applyApprovalPlan,
  planAgencyMatch,
  planApproval,
  planWithdrawal,
  readApprovalRequest,
  type ApprovalRequest,
} from './approval';
import { SupabaseApprovalStore } from './approval-store';
import { parseCostcoIndex } from './costco-index';
import { applyCostcoPlan, planCostcoRun, type CostcoSource } from './costco-monitor';
import {
  FIXTURE_IDS,
  fixtureDocument,
  fixtureExtract,
  fixtureIndexHtml,
  fixtureSource,
} from './fixtures/costco-fixtures';
import { extractPdfPageTexts } from './pdf-text';
import { SupabaseRetailerNoticeStore } from './store';
import { createSupabaseServerClient } from '../store/supabase-store';

interface Stack {
  apiUrl: string;
  anonKey: string;
  serviceKey: string;
}

function stagingStack(): Stack | null {
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
  const anonKey = read('ANON_KEY');
  const serviceKey = read('SERVICE_ROLE_KEY');
  if (!apiUrl || !anonKey || !serviceKey) return null;
  // Never a hosted project: a staging stack is a local container.
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(apiUrl)) return null;
  return { apiUrl, anonKey, serviceKey };
}

const STACK = stagingStack();
const SKIP = STACK
  ? false
  : 'staging only: set LOTLY_RETAILER_STAGING=1 and an isolated verify-stack SUPABASE_WORKDIR';

const REQUEST_PATH = join(__dirname, 'fixtures', 'approvals', 'kirkland-whipped-cream.json');
const LETTER = fixtureDocument(FIXTURE_IDS.whippedCream);
const REVISED = new Uint8Array([...LETTER, 0x0a]);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const WHIPPED_URL = parseCostcoIndex(fixtureIndexHtml()).find(
  (entry) => entry.nativeId === FIXTURE_IDS.whippedCream,
)!.documentUrl;

function request(documentContentHash = hash(LETTER)): ApprovalRequest {
  const parsed = readApprovalRequest(JSON.parse(readFileSync(REQUEST_PATH, 'utf8')));
  assert.ok(!('error' in parsed));
  // A reviewer approving a revised letter re-selects its photo, whose path
  // names that letter's hash.
  const fields = structuredClone(parsed.fields);
  if (fields.image)
    fields.image.path = fields.image.path.replace(hash(LETTER), documentContentHash);
  return { ...parsed, documentContentHash, fields };
}

/** The recorded Costco fixtures, with the whipped cream letter optionally revised. */
function source(revised: boolean): CostcoSource {
  const base = fixtureSource();
  return {
    fetchIndexHtml: () => base.fetchIndexHtml(),
    async fetchDocument(url) {
      if (revised && url === WHIPPED_URL) return { bytes: REVISED, contentType: 'application/pdf' };
      return base.fetchDocument(url);
    },
  };
}

test(
  'an approved Costco notice appears once, and only while it is approved and current',
  { skip: SKIP, timeout: 180_000 },
  async () => {
    const stack = STACK!;
    // The shipped agency loader, pointed at the staging stack with its anon key.
    process.env.EXPO_PUBLIC_SUPABASE_URL = stack.apiUrl;
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = stack.anonKey;
    const feed = await import('../../lib/recall-feed');
    const client = createSupabaseServerClient(stack.apiUrl, stack.serviceKey);
    const notices = new SupabaseRetailerNoticeStore(client);
    const approvals = new SupabaseApprovalStore(client);
    const now = () => new Date();

    const anon = async (path: string) => {
      const response = await fetch(`${stack.apiUrl}/rest/v1/${path}`, {
        headers: { apikey: stack.anonKey, Authorization: `Bearer ${stack.anonKey}` },
      });
      return { status: response.status, body: await response.json() };
    };
    const visible = async () => {
      const { status, body } = await anon('rpc/consumer_retailer_notices');
      assert.equal(status, 200, JSON.stringify(body));
      return body as Record<string, unknown>[];
    };
    const counts = async () => {
      const out: Record<string, number> = {};
      for (const table of [
        'recall_cases',
        'affected_products',
        'source_records',
        'source_snapshots',
        'notification_events',
      ]) {
        const { count, error } = await client
          .from(table)
          .select('*', { count: 'exact', head: true });
        assert.equal(error, null);
        out[table] = count ?? -1;
      }
      return out;
    };
    const agencySnapshot = async () => ({
      feed: await feed.fetchCurrentFeed(),
      manifest: await feed.fetchCurrentManifest(),
      counts: await counts(),
    });

    // Start from the recorded letters with no live approval (re-runnable).
    await applyCostcoPlan(
      notices,
      await planCostcoRun(notices, source(false), now, fixtureExtract),
    );
    await applyApprovalPlan(
      approvals,
      await planWithdrawal(
        approvals,
        'costco',
        FIXTURE_IDS.whippedCream,
        'staging test reset',
        now,
      ),
    );
    const before = await agencySnapshot();
    assert.ok(
      before.counts.recall_cases > 0,
      'seed at least one agency case into the staging stack',
    );

    // 1. Hidden before approval; the private tables refuse the app's key.
    assert.deepEqual(await visible(), []);
    for (const table of [
      'retailer_notices',
      'retailer_notice_documents',
      'retailer_notice_approvals',
    ]) {
      const { status, body } = await anon(`${table}?select=*&limit=1`);
      assert.equal(status, 401, `${table}: ${JSON.stringify(body)}`);
      assert.equal((body as { code: string }).code, '42501');
    }

    // 2. Approved: exactly one notice, display-safe columns only.
    const approve = await planApproval(approvals, request(), now, extractPdfPageTexts);
    assert.deepEqual(approve.problems, []);
    assert.equal(await applyApprovalPlan(approvals, approve), 2);
    const shown = await visible();
    assert.equal(shown.length, 1);
    // The photo is served from the existing public product-visuals bucket,
    // byte-identical to PDF object 11 of the approved letter.
    const photoPath = (shown[0].fields as { image: { path: string } }).image.path;
    const photo = await fetch(
      `${stack.apiUrl}/storage/v1/object/public/product-visuals/${photoPath}`,
    );
    assert.equal(photo.status, 200);
    assert.equal(
      createHash('sha256')
        .update(Buffer.from(await photo.arrayBuffer()))
        .digest('hex'),
      '8a1a80cbf85e3eb73d837f371c6272bde0a65e73147bb98ffc45cec4fa6cd1e9',
    );
    assert.deepEqual(Object.keys(shown[0]).sort(), [
      'approved_at',
      'document_url',
      'fields',
      'id',
      'notice_date',
      'publisher',
    ]);
    assert.equal(shown[0].document_url, WHIPPED_URL.replace(/ /g, '%20'));
    assert.equal(shown[0].notice_date, '2026-11-07');
    assert.deepEqual(shown[0].fields, request().fields);
    assert.doesNotMatch(
      JSON.stringify(shown),
      /review|evidence|excerpt|approved_by|staging fixture/i,
    );
    // Approving the same letter again writes nothing; a second monitor run changes nothing shown.
    assert.equal(
      (await planApproval(approvals, request(), now, extractPdfPageTexts)).writes.length,
      0,
    );
    await applyCostcoPlan(
      notices,
      await planCostcoRun(notices, source(false), now, fixtureExtract),
    );
    assert.equal((await visible()).length, 1);

    // 3. The letter is revised: hidden at once, and the old approval cannot be reused.
    const revisedRun = await planCostcoRun(notices, source(true), now, fixtureExtract);
    assert.equal(
      revisedRun.planned.find((p) => p.row.nativeId === FIXTURE_IDS.whippedCream)?.change,
      'update',
    );
    await applyCostcoPlan(notices, revisedRun);
    assert.deepEqual(await visible(), []);
    assert.ok(
      (await planApproval(approvals, request(), now, extractPdfPageTexts)).problems.length > 0,
    );
    // Re-approved for the revised letter: shown once again.
    const reapprove = await planApproval(
      approvals,
      request(hash(REVISED)),
      now,
      extractPdfPageTexts,
    );
    assert.deepEqual(
      reapprove.writes.map((write) => write.kind),
      ['withdraw', 'upload_image', 'insert'],
    );
    await applyApprovalPlan(approvals, reapprove);
    assert.equal((await visible()).length, 1);

    // 4. A matching agency case is confirmed later: hidden.
    const { data: agencyCase } = await client.from('recall_cases').select('id').limit(1).single();
    const match = await planAgencyMatch(
      approvals,
      'costco',
      FIXTURE_IDS.whippedCream,
      (agencyCase as { id: string }).id,
      now,
    );
    assert.equal(await applyApprovalPlan(approvals, match), 1);
    assert.deepEqual(await visible(), []);

    // 5. The agency feed, its manifest and every case/ledger table are unchanged.
    const after = await agencySnapshot();
    assert.deepEqual(after.counts, before.counts);
    assert.deepEqual(after.manifest, before.manifest);
    assert.deepEqual(after.feed, before.feed);
  },
);
