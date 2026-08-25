/**
 * FSIS label PDFs → hosted product visuals.
 *
 *   npx tsx scripts/render-fsis-labels.ts                 # bounded local dry run
 *   npx tsx scripts/render-fsis-labels.ts --limit 8      # dry-run size
 *   npx tsx scripts/render-fsis-labels.ts --apply        # fetch, render, upload,
 *                                                        # and record product_visuals
 *
 * DRY RUN (default): fetches a bounded sample of label PDFs referenced by
 * FSIS source records, renders them locally, and reports page counts,
 * duplicate-page suppression, sizes, and an idempotency check (a second
 * render of the same bytes must produce identical content hashes). Nothing is
 * uploaded and nothing is written to the database.
 *
 * APPLY: requires the product_visuals migration (table + `product-visuals`
 * storage bucket). For each FSIS source record whose summary links a label
 * PDF and which has no visuals for the PDF's current bytes: upload each
 * rendered page to its content-addressed key and insert one product_visuals
 * row per page. Content-addressed keys make re-runs no-ops; a changed PDF
 * renders under new keys and its rows replace the old ones for that URL.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { NormalizedSourceRecord } from '../src/domain/source-record';
import {
  extractLabelPdfUrls,
  labelAssetKey,
  renderLabelPdf,
  sha256,
  MAX_PDF_BYTES,
} from '../src/server/fsis/labels';

const apply = process.argv.includes('--apply');
const limitFlag = process.argv.indexOf('--limit');
const limit = limitFlag >= 0 ? Number(process.argv[limitFlag + 1]) : apply ? Infinity : 8;
const FETCH_DELAY_MS = 300;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment may be configured another way.
  }
}

interface LabelSource {
  sourceRecordId: string;
  recallCaseId: string;
  nativeId: string;
  pdfUrl: string;
}

async function collectSources(client: SupabaseClient): Promise<LabelSource[]> {
  const out: LabelSource[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('source_records')
      .select('id, native_id, recall_case_id, normalized')
      .eq('source_system', 'fsis_api')
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`source_records read failed: ${error.message}`);
    for (const row of data ?? []) {
      const normalized = row.normalized as NormalizedSourceRecord;
      for (const pdfUrl of extractLabelPdfUrls(normalized.summaryHtml)) {
        out.push({
          sourceRecordId: row.id as string,
          recallCaseId: row.recall_case_id as string,
          nativeId: row.native_id as string,
          pdfUrl,
        });
      }
    }
    if (!data || data.length < pageSize) break;
  }
  return out;
}

async function fetchPdf(url: string): Promise<Uint8Array | null> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'recall-app label renderer (contact: dev)' },
  });
  if (!response.ok) {
    console.log(`    ✗ HTTP ${response.status} for ${url}`);
    return null;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_PDF_BYTES) {
    console.log(`    ✗ over size cap (${bytes.byteLength} bytes): ${url}`);
    return null;
  }
  return bytes;
}

async function main(): Promise<void> {
  loadDotEnv();
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY.');
    process.exit(1);
  }
  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const sources = await collectSources(client);
  console.log(
    `${sources.length} label PDF link(s) across FSIS source records` +
      `${apply ? '' : ` — DRY RUN over the first ${Math.min(limit, sources.length)}, local render only`}`,
  );

  const outDir = join(process.cwd(), '.fsis-label-dryrun');
  if (!apply) mkdirSync(outDir, { recursive: true });

  let fetched = 0;
  let rendered = 0;
  let pagesRendered = 0;
  let duplicatesSuppressed = 0;
  let failures = 0;
  let uploaded = 0;
  let skippedExisting = 0;
  let totalBytes = 0;

  const seenPdfUrls = new Set<string>();
  for (const source of sources) {
    if (fetched >= limit) break;
    if (seenPdfUrls.has(source.pdfUrl)) continue;
    seenPdfUrls.add(source.pdfUrl);
    console.log(`\n  ${source.nativeId}: ${source.pdfUrl}`);
    await sleep(FETCH_DELAY_MS);
    const bytes = await fetchPdf(source.pdfUrl);
    fetched += 1;
    if (!bytes) {
      failures += 1;
      continue;
    }
    const pdfHash = sha256(bytes);

    if (apply) {
      // Idempotency: rows for this exact PDF revision mean it is done.
      const existing = await client
        .from('product_visuals')
        .select('id', { count: 'exact', head: true })
        .eq('source_url', source.pdfUrl)
        .eq('source_sha256', pdfHash);
      if (existing.error) throw new Error(existing.error.message);
      if ((existing.count ?? 0) > 0) {
        skippedExisting += 1;
        console.log('    = already rendered for these bytes, skipping');
        continue;
      }
    }

    let pages;
    try {
      const result = await renderLabelPdf(bytes);
      pages = result.pages;
      duplicatesSuppressed += Math.min(result.numPages, 6) - pages.length;
    } catch (error) {
      failures += 1;
      console.log(`    ✗ render failed: ${error instanceof Error ? error.message : error}`);
      continue;
    }
    rendered += 1;
    pagesRendered += pages.length;
    for (const page of pages) totalBytes += page.bytes.byteLength;
    console.log(
      `    ✓ ${pages.length} page(s): ${pages
        .map((p) => `p${p.page} ${p.width}×${p.height} ${(p.bytes.byteLength / 1024).toFixed(0)}KB`)
        .join(', ')}`,
    );

    if (!apply) {
      // Idempotency check: identical bytes must render to identical hashes.
      const again = (await renderLabelPdf(bytes)).pages;
      const stable =
        again.length === pages.length &&
        again.every((page, index) => page.contentHash === pages[index].contentHash);
      console.log(`    idempotent re-render: ${stable ? 'identical hashes ✓' : 'HASH DRIFT ✗'}`);
      for (const page of pages) {
        writeFileSync(join(outDir, `${pdfHash.slice(0, 12)}-p${page.page}.webp`), page.bytes);
      }
      continue;
    }

    // APPLY: upload each page and record it.
    for (const page of pages) {
      const key = labelAssetKey(pdfHash, page.page);
      const upload = await client.storage
        .from('product-visuals')
        .upload(key, page.bytes, { contentType: 'image/webp', upsert: false });
      if (upload.error && !/already exists|duplicate/i.test(upload.error.message)) {
        throw new Error(`upload ${key} failed: ${upload.error.message}`);
      }
      const publicUrl = client.storage.from('product-visuals').getPublicUrl(key).data.publicUrl;
      const inserted = await client.from('product_visuals').upsert(
        {
          recall_case_id: source.recallCaseId,
          source_record_id: source.sourceRecordId,
          source_url: source.pdfUrl,
          source_sha256: pdfHash,
          page: page.page,
          url: publicUrl,
          role: 'package_label',
          width: page.width,
          height: page.height,
          content_hash: page.contentHash,
        },
        { onConflict: 'source_url,source_sha256,page' },
      );
      if (inserted.error) throw new Error(inserted.error.message);
      uploaded += 1;
    }
    // Stale revisions of this URL are superseded; drop their rows (the
    // objects remain content-addressed in storage for audit).
    const stale = await client
      .from('product_visuals')
      .delete()
      .eq('source_url', source.pdfUrl)
      .neq('source_sha256', pdfHash);
    if (stale.error) throw new Error(stale.error.message);
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  PDFs fetched:            ${fetched} (${failures} failures)`);
  console.log(`  PDFs rendered:           ${rendered}`);
  console.log(`  pages rendered:          ${pagesRendered}`);
  console.log(`  duplicate/blank dropped: ${duplicatesSuppressed}`);
  console.log(`  rendered bytes:          ${(totalBytes / 1024).toFixed(0)}KB`);
  if (apply) {
    console.log(`  uploaded pages:          ${uploaded}`);
    console.log(`  skipped (already done):  ${skippedExisting}`);
  } else {
    console.log(`  dry-run output:          ${outDir}`);
    console.log(
      `  est. full corpus:        ~${sources.length} PDFs · ` +
        `~${(((totalBytes / Math.max(1, rendered)) * sources.length) / 1024 / 1024).toFixed(1)}MB at this average`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
