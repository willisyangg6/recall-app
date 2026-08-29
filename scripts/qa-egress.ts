/**
 * Egress QA (Phase C8) — read-only against the live DB.
 *
 *   npm run qa:egress
 *
 * Measures what the recall feed actually transfers, by driving the SHIPPING
 * client code (loader, manifest, sync engine) under the anon key with a
 * byte-counting fetch wrapper — never a reimplementation of the queries.
 * The service role is used only for the independent authoritative count and
 * for small samples that estimate scheduled-job transfer.
 *
 * Byte accounting is stated in three clearly separated terms:
 *   - MEASURED decompressed JSON (exact, what the wrapper observed);
 *   - ESTIMATED wire bytes (local gzip of the same payload — Supabase
 *     serves gzip, so this approximates HTTP transfer);
 *   - billed egress is NOT claimed: this script has no access to Supabase
 *     billing and does not pretend to.
 *
 * Hard gates (non-zero exit):
 *   - cold load complete: every consumer-visible active case exactly once;
 *   - manifest ids ≡ the authoritative visible set (no hidden/extra ids);
 *   - warm unchanged refresh downloads ZERO full feed rows;
 *   - warm unchanged refresh transfers ≤ 20% of the cold load's bytes.
 *
 * Before the consumer_feed_manifest migration is applied to the backend,
 * the manifest/warm gates cannot pass — the script says so explicitly and
 * exits non-zero rather than reporting a reduction it could not measure.
 */

import { gzipSync } from 'node:zlib';

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment may be configured another way.
  }
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

interface CapturedRequest {
  path: string;
  bytes: number;
  wireEstimate: number;
}

function installCapture(): { requests: CapturedRequest[]; restore: () => void } {
  const requests: CapturedRequest[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await realFetch(input, init);
    const body = await response.clone().arrayBuffer();
    const url = String(typeof input === 'string' ? input : ((input as Request).url ?? input));
    requests.push({
      path: url.split('?')[0].split('/rest/v1/')[1] ?? url,
      bytes: body.byteLength,
      wireEstimate: gzipSync(Buffer.from(body)).byteLength,
    });
    return response;
  }) as typeof fetch;
  return { requests, restore: () => void (globalThis.fetch = realFetch) };
}

const sum = (requests: CapturedRequest[]) => ({
  bytes: requests.reduce((total, r) => total + r.bytes, 0),
  wire: requests.reduce((total, r) => total + r.wireEstimate, 0),
});

async function main(): Promise<void> {
  loadDotEnv();
  const capture = installCapture();

  // Client modules read EXPO_PUBLIC_* at import time — import after env load.
  const { fetchCurrentManifest, fetchFeedItemsByIds, fetchCurrentFeed, isFeedConfigured } =
    await import('../src/lib/recall-feed');
  const { syncFeed } = await import('../src/lib/feed-sync');
  const { createSupabaseServerClient } = await import('../src/server/store/supabase-store');

  if (!isFeedConfigured()) {
    console.error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.');
    process.exit(1);
  }
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY (needed for authoritative counts).');
    process.exit(1);
  }

  console.log('EGRESS QA (C8) — read-only\n');
  const failures: string[] = [];

  // ── Authoritative visible set (service role, independent of client path) ──
  const admin = createSupabaseServerClient(url, secretKey);
  const authoritativeIds = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('recall_cases')
      .select('id')
      .eq('state', 'active')
      .is('merged_into', null)
      .order('id')
      .range(from, from + 999);
    if (error || !data) {
      console.error(`Authoritative id sweep failed: ${error?.message}`);
      process.exit(1);
    }
    for (const row of data) authoritativeIds.add(row.id as string);
    if (data.length < 1000) break;
  }
  capture.requests.length = 0; // service-role traffic is not client egress
  console.log('AUTHORITATIVE (service role)');
  console.log(`  consumer-visible active cases:  ${authoritativeIds.size}\n`);

  // ── Cold full load: the frozen C5.1 loader ────────────────────────────────
  const coldStarted = Date.now();
  const coldItems = await fetchCurrentFeed();
  const coldMs = Date.now() - coldStarted;
  const coldRequests = capture.requests.splice(0);
  const cold = sum(coldRequests);
  const coldIds = new Set(coldItems.map((item) => item.id));
  const coldDuplicates = coldItems.length - coldIds.size;
  const coldMissing = [...authoritativeIds].filter((id) => !coldIds.has(id));
  console.log('COLD FULL LOAD (real client loader, anon key + RLS)');
  console.log(`  rows:                           ${coldItems.length}`);
  console.log(`  requests:                       ${coldRequests.length}`);
  console.log(`  measured decompressed JSON:     ${kb(cold.bytes)}`);
  console.log(`  estimated wire (gzip):          ${kb(cold.wire)}`);
  console.log(`  duration:                       ${coldMs} ms`);
  console.log(`  missing active ids:             ${coldMissing.length}  (gate: 0)`);
  console.log(`  duplicate ids:                  ${coldDuplicates}  (gate: 0)`);
  if (coldMissing.length > 0 || coldDuplicates > 0 || coldItems.length !== authoritativeIds.size) {
    failures.push('cold load is not the complete visible corpus exactly once');
  }

  // Largest client-visible rows and fields.
  const rowSizes = coldItems
    .map((item) => ({ id: item.id, bytes: JSON.stringify(item).length }))
    .sort((a, b) => b.bytes - a.bytes);
  const fieldBytes = new Map<string, number>();
  for (const item of coldItems) {
    for (const [key, value] of Object.entries(item)) {
      fieldBytes.set(key, (fieldBytes.get(key) ?? 0) + JSON.stringify(value ?? null).length);
    }
  }
  console.log('  largest cases (client-visible representation):');
  for (const row of rowSizes.slice(0, 3)) console.log(`    ${row.id}: ${kb(row.bytes)}`);
  console.log('  heaviest fields across the corpus:');
  for (const [key, bytes] of [...fieldBytes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    console.log(`    ${key}: ${kb(bytes)}`);
  }

  // ── Manifest ──────────────────────────────────────────────────────────────
  console.log('\nSYNC MANIFEST (consumer_feed_manifest view)');
  let manifestAvailable = true;
  let manifestBytes = { bytes: 0, wire: 0 };
  try {
    const manifest = await fetchCurrentManifest();
    const manifestRequests = capture.requests.splice(0);
    manifestBytes = sum(manifestRequests);
    const manifestIds = new Set(manifest.map((entry) => entry.id));
    const hidden = [...manifestIds].filter((id) => !authoritativeIds.has(id));
    const absent = [...authoritativeIds].filter((id) => !manifestIds.has(id));
    console.log(`  entries:                        ${manifest.length}`);
    console.log(`  requests:                       ${manifestRequests.length}`);
    console.log(`  measured decompressed JSON:     ${kb(manifestBytes.bytes)}`);
    console.log(`  estimated wire (gzip):          ${kb(manifestBytes.wire)}`);
    console.log(
      `  ids not in the visible set:     ${hidden.length}  (gate: 0 — no hidden leakage)`,
    );
    console.log(`  visible ids missing:            ${absent.length}  (gate: 0)`);
    if (hidden.length > 0) failures.push('manifest exposes ids outside the visible active set');
    if (absent.length > 0) failures.push('manifest omits visible active cases');
  } catch (error) {
    manifestAvailable = false;
    capture.requests.length = 0;
    console.log('  UNAVAILABLE: the consumer_feed_manifest view did not answer.');
    console.log(`  (${error instanceof Error ? error.message : String(error)})`);
    console.log('  If the C8 migration has not been applied yet, run: supabase db push');
    failures.push('sync manifest not deployed — warm-refresh gates unmeasurable');
  }

  // ── Warm refresh: prime an in-memory cache, then sync again unchanged ─────
  if (manifestAvailable) {
    let stored: string | null = null;
    const memoryStore = {
      read: async () => stored,
      write: async (text: string) => ((stored = text), true),
      clear: async () => void (stored = null),
    };
    const transport = {
      fetchManifest: fetchCurrentManifest,
      fetchAll: fetchCurrentFeed,
      fetchByIds: fetchFeedItemsByIds,
    };

    capture.requests.length = 0;
    const first = await syncFeed({ store: memoryStore, transport });
    capture.requests.length = 0;
    const warm = await syncFeed({ store: memoryStore, transport });
    const warmRequests = capture.requests.splice(0);
    const warmBytes = sum(warmRequests);
    const warmRowRequests = warmRequests.filter((request) =>
      request.path.startsWith('recall_cases'),
    );
    const reduction = 100 * (1 - warmBytes.bytes / cold.bytes);
    const cacheIds = new Set(warm.items.map((item) => item.id));
    const cacheMissing = [...authoritativeIds].filter((id) => !cacheIds.has(id));

    console.log('\nWARM UNCHANGED REFRESH (cache primed, corpus unchanged)');
    console.log(`  cold sync mode:                 ${first.mode} (${first.downloadedRows} rows)`);
    console.log(`  warm sync mode:                 ${warm.mode}`);
    console.log(`  full feed rows downloaded:      ${warm.downloadedRows}  (gate: 0)`);
    console.log(`  feed-row requests issued:       ${warmRowRequests.length}  (gate: 0)`);
    console.log(`  requests:                       ${warmRequests.length}`);
    console.log(`  measured decompressed JSON:     ${kb(warmBytes.bytes)}`);
    console.log(`  estimated wire (gzip):          ${kb(warmBytes.wire)}`);
    console.log(`  reduction vs cold load:         ${reduction.toFixed(1)}%  (gate: >= 80%)`);
    console.log(`  cache completeness:             ${cacheIds.size}/${authoritativeIds.size}`);
    console.log(`  cache missing ids:              ${cacheMissing.length}  (gate: 0)`);
    if (warm.downloadedRows !== 0 || warmRowRequests.length !== 0) {
      failures.push('warm unchanged refresh downloaded full feed rows');
    }
    if (reduction < 80) failures.push('warm refresh saved less than 80% of cold-load bytes');
    if (cacheMissing.length > 0 || cacheIds.size !== authoritativeIds.size) {
      failures.push('synced cache is not the complete visible corpus');
    }

    // One changed case: bounded metadata + that case alone.
    capture.requests.length = 0;
    const exampleId = coldItems[Math.floor(coldItems.length / 2)].id;
    await fetchFeedItemsByIds([exampleId]);
    const changed = sum(capture.requests.splice(0));
    console.log('\nCHANGED-ROW EXAMPLE (one case re-downloaded)');
    console.log(`  measured decompressed JSON:     ${kb(changed.bytes)}`);
    console.log(`  estimated wire (gzip):          ${kb(changed.wire)}`);
    console.log(
      `  one-changed-case refresh total: ~${kb(manifestBytes.bytes + changed.bytes)} decompressed`,
    );
  }

  // ── Scheduled-job transfer estimates (service role, small samples) ────────
  console.log('\nSCHEDULED-JOB TRANSFER (estimates from run history + sampled row sizes)');
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: runs } = await admin
    .from('ingest_runs')
    .select('job_name, metrics')
    .gte('started_at', since)
    .limit(3000);
  const jobRuns = (name: string) => (runs ?? []).filter((run) => run.job_name === name);
  for (const [job, system] of [
    ['fda_announcements', 'fda_announcement'],
    ['fsis_ingest', 'fsis_api'],
  ] as const) {
    const all = jobRuns(job);
    const full = all.filter(
      (run) =>
        (run.metrics as Record<string, unknown> | null)?.skipped === undefined &&
        (run.metrics as Record<string, unknown> | null)?.skippedLease === undefined,
    );
    const parsedAvg =
      full.length === 0
        ? 0
        : full.reduce(
            (total, run) => total + (Number((run.metrics as Record<string, unknown>)?.parsed) || 0),
            0,
          ) / full.length;
    const { data: sample } = await admin
      .from('source_records')
      .select('*')
      .eq('source_system', system)
      .order('id')
      .limit(60);
    const fullRowAvg =
      (sample ?? []).reduce((total, row) => total + JSON.stringify(row).length, 0) /
      Math.max(1, sample?.length ?? 0);
    const before = parsedAvg * fullRowAvg;
    const after = parsedAvg * 120; // narrow id+case link response, measured ~0.1 KB
    console.log(
      `  ${job}: ${all.length} runs / 7d, ${full.length} full; ` +
        `per full run ~${kb(before)} before C8 -> ~${kb(after)} with the identity-slice read ` +
        `(avg full row ${kb(fullRowAvg)}, ${Math.round(parsedAvg)} records; estimate)`,
    );
  }
  console.log(
    '  (Estimates only — decompressed JSON from 60-row samples and 7-day run metrics; ' +
      'billed egress is compressed and is not claimed here.)',
  );

  capture.restore();

  console.log('');
  if (failures.length > 0) {
    console.log('FAIL:');
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exit(1);
  }
  console.log('PASS: complete cold load, hidden-free manifest, and row-free warm refresh.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
