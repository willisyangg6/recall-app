/**
 * Imagery QA — read-only, answerable almost entirely from stored data:
 *
 *   npm run qa:imagery
 *
 * Three coverage concepts are deliberately distinct and never conflated:
 *
 *  - CARD HERO coverage: cases whose feed card has a `heroImageUrl` —
 *    today exclusively official FDA photographs selected under the
 *    historical behavior (not asserted to be professional packshots).
 *  - DETAIL VISUAL coverage: cases with any evidence imagery at all —
 *    a hero and/or rendered label pages in product_visuals. Evidence is
 *    valuable on the detail screen; it does not make a card hero.
 *  - PROFESSIONAL PACKSHOT coverage: NOT YET MEASURED. Defining and
 *    sourcing professional-quality card imagery is C9.1.
 *
 * Frozen interim policy (C9): an ordinary FSIS label render is never a
 * card hero — a gate below fails if one ever appears. Live network use is
 * bounded: a fixed-size sample of hero URLs and the (≤ a dozen) recorded
 * failure URLs get probes — never the full image corpus.
 *
 * Exits non-zero when a gate fails, so it can guard later imagery work.
 * Requires SUPABASE_URL / SUPABASE_SECRET_KEY (server-only). No writes.
 */

import { SupabaseLabelStore } from '../src/server/fsis/label-store';
import { auditFailureUrl } from '../src/server/imagery-audit';
import { exactMatchGtins, normalizeGtin } from '../src/lib/gtin';
import { classifyHeroUrl } from '../src/lib/hero-provenance';
import { FDA_HOSTS, FSIS_HOSTS, resolveOfficialUrl } from '../src/lib/official-urls';
import { buildConsumerCase } from '../src/lib/consumer-projection';
import { extractProductPhotos } from '../src/lib/product-photos';
import type { CaseProjection } from '../src/domain/recall-types';
import { createSupabaseServerClient } from '../src/server/store/supabase-store';

/** FDA 404s non-browser user agents; probes need a browser fingerprint. */
const PROBE_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
  Accept: 'image/avif,image/webp,image/*,application/pdf;q=0.9,*/*;q=0.8',
};

/** Bounded live validation: this many hero URLs get probed, never more. */
const HERO_PROBE_SAMPLE = 30;
const PROBE_TIMEOUT_MS = 20_000;

interface CaseRow {
  id: string;
  projection: CaseProjection;
}

interface VisualRow {
  recallCaseId: string;
  sourceUrl: string;
  page: number;
  url: string;
  role: string;
  width: number | null;
  height: number | null;
  contentHash: string;
}

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment may be configured another way.
  }
}

async function probe(url: string): Promise<'ok' | 'broken' | 'not-image'> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      let response = await fetch(url, {
        method: 'HEAD',
        headers: PROBE_HEADERS,
        signal: controller.signal,
      });
      if (response.status === 405 || response.status === 403) {
        response = await fetch(url, { headers: PROBE_HEADERS, signal: controller.signal });
        // Body is discarded; the probe only needs status + content type.
        await response.body?.cancel();
      }
      if (!response.ok) return 'broken';
      const media = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
      if (media.startsWith('text/') || media === 'application/json') return 'not-image';
      return 'ok';
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return 'broken';
  }
}

/** Every approved `upc` package field value in a consumer case, recursively. */
function collectUpcValues(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectUpcValues(item, out);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;
  if (record.key === 'upc' && Array.isArray(record.values)) {
    for (const value of record.values) if (typeof value === 'string') out.push(value);
    return;
  }
  for (const value of Object.values(record)) collectUpcValues(value, out);
}

async function main(): Promise<void> {
  loadDotEnv();
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY.');
    process.exit(1);
  }
  const client = createSupabaseServerClient(url, secretKey);
  const visualUrlPrefix = `${url.replace(/\/$/, '')}/storage/v1/object/public/product-visuals/`;

  // ── Load cases (id + projection) and visuals, paged ────────────────────
  const cases: CaseRow[] = [];
  const pageSize = 200;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('recall_cases')
      .select('id, projection')
      .order('id')
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) cases.push(row as unknown as CaseRow);
    if (!data || data.length < pageSize) break;
  }
  const visuals: VisualRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from('product_visuals')
      .select('recall_case_id, source_url, page, url, role, width, height, content_hash')
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const record = row as Record<string, unknown>;
      visuals.push({
        recallCaseId: record.recall_case_id as string,
        sourceUrl: record.source_url as string,
        page: record.page as number,
        url: record.url as string,
        role: record.role as string,
        width: (record.width as number | null) ?? null,
        height: (record.height as number | null) ?? null,
        contentHash: record.content_hash as string,
      });
    }
    if (!data || data.length < 1000) break;
  }
  const labelStore = new SupabaseLabelStore(client);
  const failures = await labelStore.listFailures();

  const active = cases.filter((c) => c.projection.state === 'active');
  const withHero = (rows: CaseRow[]) => rows.filter((c) => c.projection.heroImageUrl != null);
  const visualsByCase = new Map<string, VisualRow[]>();
  for (const visual of visuals) {
    visualsByCase.set(visual.recallCaseId, [
      ...(visualsByCase.get(visual.recallCaseId) ?? []),
      visual,
    ]);
  }
  const hasDetailImagery = (row: CaseRow) =>
    row.projection.heroImageUrl != null || visualsByCase.has(row.id);

  console.log('\nCORPUS');
  console.log(`  cases:                          ${cases.length} (${active.length} active)`);
  console.log('\nCOVERAGE (three distinct concepts — never conflated)');
  console.log(
    `  card heroes:                    ${withHero(cases).length} total, ${withHero(active).length} active (official FDA photographs, historical selection)`,
  );
  console.log(
    `  detail visual evidence:         ${cases.filter(hasDetailImagery).length} total, ${active.filter(hasDetailImagery).length} active (hero and/or rendered label pages)`,
  );
  console.log(
    '  professional packshots:         not yet measured — C9.1 defines and sources these',
  );

  // ── Provenance breakdown + contradictions ──────────────────────────────
  let agencyPhoto = 0;
  let labelRenderHero = 0;
  let unknownProvenance = 0;
  let insecureHero = 0;
  const conflictSamples: string[] = [];
  for (const row of cases) {
    const hero = row.projection.heroImageUrl ?? null;
    if (hero === null) continue;
    if (hero.startsWith('http://')) insecureHero += 1;
    const provenance = classifyHeroUrl(hero, visualUrlPrefix);
    if (provenance === 'agency_photo') agencyPhoto += 1;
    else if (provenance === 'label_render') {
      // Frozen policy: label renders are detail evidence, never card
      // heroes. One appearing means a promotion path exists somewhere.
      labelRenderHero += 1;
      if (conflictSamples.length < 5) conflictSamples.push(`${row.id}: ${hero}`);
    } else {
      unknownProvenance += 1;
      if (conflictSamples.length < 5) conflictSamples.push(`${row.id}: ${hero}`);
    }
  }
  console.log('\nHERO PROVENANCE');
  console.log(`  official agency photograph:     ${agencyPhoto}`);
  console.log(`  label render as hero:           ${labelRenderHero}  (gate: 0 — frozen policy)`);
  console.log(`  unknown (contradiction):        ${unknownProvenance}  (gate: 0)`);
  console.log(`  non-https heroes:               ${insecureHero}  (gate: 0)`);
  for (const sample of conflictSamples) console.log(`    · ${sample}`);

  // ── URL-normalization byte-stability over the live corpus ──────────────
  const heroDrift: string[] = [];
  for (const row of withHero(cases)) {
    const hero = row.projection.heroImageUrl!;
    if (classifyHeroUrl(hero, visualUrlPrefix) !== 'agency_photo') continue;
    const resolved = resolveOfficialUrl(hero, { approvedHosts: FDA_HOSTS });
    if (!resolved || resolved.url !== hero) heroDrift.push(hero);
  }
  const sourceUrlDrift: string[] = [];
  for (const sourceUrl of new Set(visuals.map((visual) => visual.sourceUrl))) {
    const resolved = resolveOfficialUrl(sourceUrl, { approvedHosts: FSIS_HOSTS });
    if (!resolved || resolved.url !== sourceUrl) sourceUrlDrift.push(sourceUrl);
  }
  console.log('\nURL NORMALIZATION (byte-stability against the live corpus)');
  console.log(`  FDA hero URLs that would change:      ${heroDrift.length}  (gate: 0)`);
  console.log(`  rendered PDF URLs that would change:  ${sourceUrlDrift.length}  (gate: 0)`);
  for (const drift of [...heroDrift, ...sourceUrlDrift].slice(0, 5)) console.log(`    · ${drift}`);

  // ── Detail-evidence quality (stored metadata only) ─────────────────────
  const missingDims = visuals.filter((v) => v.width === null || v.height === null);
  const lowRes = visuals.filter(
    (v) => v.width !== null && v.height !== null && v.width * v.height < 50_000,
  );
  const extremeAspect = visuals.filter(
    (v) =>
      v.width !== null &&
      v.height !== null &&
      v.height > 0 &&
      (v.width / v.height > 4 || v.width / v.height < 0.25),
  );
  // A content hash shared by cases through DIFFERENT source PDFs is the
  // suspicious shape (a shared PDF across related notices is legitimate).
  const hashSources = new Map<string, Set<string>>();
  const hashCases = new Map<string, Set<string>>();
  for (const v of visuals) {
    (
      hashSources.get(v.contentHash) ??
      hashSources.set(v.contentHash, new Set()).get(v.contentHash)!
    ).add(v.sourceUrl);
    (
      hashCases.get(v.contentHash) ?? hashCases.set(v.contentHash, new Set()).get(v.contentHash)!
    ).add(v.recallCaseId);
  }
  const crossCaseHashes = [...hashCases.entries()].filter(([, ids]) => ids.size > 1);
  const suspiciousHashes = crossCaseHashes.filter(([hash]) => hashSources.get(hash)!.size > 1);
  console.log('\nRENDERED LABEL PAGES (detail evidence, not card imagery)');
  console.log(
    `  rows:                           ${visuals.length} across ${visualsByCase.size} cases`,
  );
  console.log(`  missing dimensions:             ${missingDims.length}  (gate: 0)`);
  console.log(`  low resolution (<50k px²):      ${lowRes.length}`);
  console.log(`  extreme aspect (print proofs):  ${extremeAspect.length}`);
  console.log(
    `  hashes shared across cases:     ${crossCaseHashes.length} (same shared PDF: legitimate)`,
  );
  console.log(`  suspicious (differing PDFs):    ${suspiciousHashes.length}`);
  for (const [hash, ids] of suspiciousHashes.slice(0, 5)) {
    console.log(`    · ${hash.slice(0, 12)}… in ${ids.size} cases`);
  }

  // ── FDA extraction-rejection sanity (stored HTML, no fetches) ──────────
  let extractorInputs = 0;
  let extractorPhotos = 0;
  let extractorMissingDims = 0;
  for (const row of active) {
    if (row.projection.sourceAgency !== 'FDA' || !row.projection.summaryHtml) continue;
    extractorInputs += 1;
    const photos = extractProductPhotos(row.projection.summaryHtml);
    extractorPhotos += photos.length;
    extractorMissingDims += photos.filter((p) => p.width === null || p.height === null).length;
  }
  console.log('\nFDA PHOTO EXTRACTION (over stored active-announcement HTML)');
  console.log(`  announcements scanned:          ${extractorInputs}`);
  console.log(`  photos accepted:                ${extractorPhotos}`);
  console.log(`  accepted without dimensions:    ${extractorMissingDims}`);

  // ── Failure ledger ─────────────────────────────────────────────────────
  console.log('\nFAILURE LEDGER');
  const dispositions = failures.map(auditFailureUrl);
  for (const entry of dispositions) {
    console.log(`  [${entry.disposition}] ${entry.sourceUrl}`);
  }
  const repairedUrls = dispositions.filter((d) => d.disposition === 'repaired-url');
  const withinCap = dispositions.filter((d) => d.disposition === 'within-new-size-cap');

  // ── Bounded live probes ────────────────────────────────────────────────
  const heroRows = withHero(active);
  const step = Math.max(1, Math.floor(heroRows.length / HERO_PROBE_SAMPLE));
  const sampled = heroRows.filter((_, index) => index % step === 0).slice(0, HERO_PROBE_SAMPLE);
  let ok = 0;
  const broken: string[] = [];
  const notImage: string[] = [];
  for (const row of sampled) {
    const result = await probe(row.projection.heroImageUrl!);
    if (result === 'ok') ok += 1;
    else if (result === 'broken') broken.push(row.projection.heroImageUrl!);
    else notImage.push(row.projection.heroImageUrl!);
  }
  console.log('\nLIVE PROBES (bounded sample)');
  console.log(`  hero sample:                    ${sampled.length} probed, ${ok} ok`);
  console.log(`  broken:                         ${broken.length}  (gate: 0)`);
  console.log(`  non-image responses:            ${notImage.length}  (gate: 0)`);
  for (const b of [...broken, ...notImage].slice(0, 5)) console.log(`    · ${b}`);
  let repairedFetchable = 0;
  for (const entry of repairedUrls) {
    if (entry.normalizedUrl && (await probe(entry.normalizedUrl)) !== 'broken') {
      repairedFetchable += 1;
    }
  }
  console.log(`  repaired ledger URLs fetchable: ${repairedFetchable}/${repairedUrls.length}`);

  // ── GTIN coverage (identifier foundation for C9.1) ─────────────────────
  let activeWithValidGtin = 0;
  let totalValidGtins = 0;
  let invalidCheckDigits = 0;
  let ambiguous8 = 0;
  const uniqueKeys = new Set<string>();
  let noDetailImageryWithGtin = 0;
  for (const row of active) {
    const consumer = buildConsumerCase(row.projection, row.projection.affectedProducts ?? []);
    const values: string[] = [];
    collectUpcValues(consumer.packageCheck, values);
    for (const value of values) {
      const result = normalizeGtin(value);
      if (!result.ok) {
        if (result.reason === 'check-digit') invalidCheckDigits += 1;
      } else if (result.ambiguous) {
        ambiguous8 += 1;
      }
    }
    const exact = exactMatchGtins(values);
    totalValidGtins += exact.length;
    for (const gtin of exact) uniqueKeys.add(gtin.key);
    if (exact.length > 0) {
      activeWithValidGtin += 1;
      if (!hasDetailImagery(row)) noDetailImageryWithGtin += 1;
    }
  }
  console.log('\nGTIN COVERAGE (active cases, display-layer derivation)');
  console.log(`  cases with ≥1 valid GTIN:       ${activeWithValidGtin}`);
  console.log(`  valid GTIN values:              ${totalValidGtins} (${uniqueKeys.size} unique)`);
  console.log(`  rejected check digits:          ${invalidCheckDigits}`);
  console.log(`  ambiguous 8-digit codes:        ${ambiguous8} (never used for matching)`);
  console.log(`  no detail imagery + valid GTIN: ${noDetailImageryWithGtin}`);
  console.log(
    '  (exact-GTIN sourcing of card imagery, if ever approved, is a C9.1 decision — no lookup exists)',
  );

  // ── Precision sample ───────────────────────────────────────────────────
  console.log('\nPRECISION SAMPLE (deterministic)');
  for (const row of [...withHero(active)].slice(0, 3)) {
    console.log(`  · ${row.projection.title.slice(0, 60)}`);
    console.log(`    hero: ${row.projection.heroImageUrl}`);
  }
  for (const row of active
    .filter((r) => !r.projection.heroImageUrl && visualsByCase.has(r.id))
    .slice(0, 3)) {
    console.log(`  · ${row.projection.title.slice(0, 60)}`);
    console.log(
      `    no card hero (frozen policy); detail evidence pages: ${visualsByCase.get(row.id)!.length}`,
    );
  }

  // ── Gates ──────────────────────────────────────────────────────────────
  const gates: [string, boolean][] = [
    ['zero label renders promoted to card hero (frozen policy)', labelRenderHero === 0],
    ['zero unknown-provenance heroes', unknownProvenance === 0],
    ['zero non-https heroes', insecureHero === 0],
    ['zero hero URL normalization drift', heroDrift.length === 0],
    ['zero rendered-PDF URL normalization drift', sourceUrlDrift.length === 0],
    ['zero renders missing dimensions', missingDims.length === 0],
    ['zero broken heroes in sample', broken.length === 0],
    ['zero non-image hero responses in sample', notImage.length === 0],
    [
      'every ledger failure has a disposition',
      dispositions.length === failures.length &&
        dispositions.every((d) => d.disposition !== undefined),
    ],
  ];
  const failed = gates.filter(([, passed]) => !passed);
  console.log('');
  for (const [name, passed] of gates) console.log(`  ${passed ? '✓' : '✗'} ${name}`);
  console.log(
    `\n${failed.length === 0 ? 'PASS' : 'FAIL'}: hero provenance, frozen policy, and normalization ${failed.length === 0 ? 'are consistent' : `— ${failed.length} gate(s) failed`}.` +
      `\n  (ledger: ${repairedUrls.length} repaired-url, ${withinCap.length} within-new-size-cap, ${dispositions.length - repairedUrls.length - withinCap.length} still-failing)`,
  );
  if (failed.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
