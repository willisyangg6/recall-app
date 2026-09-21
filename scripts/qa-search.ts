/**
 * Search correctness QA (P2B7O) — read-only:
 *
 *   npm run qa:search
 *
 * This command exists because of what the P2B7O audit found, not because of
 * what it proposed. The audit's UI — a per-result "Matched retailer: …"
 * explanation — was rejected by founder decision. Its *findings* are what
 * matter and what this keeps measurable: search reads six stored fields, the
 * Feed card renders none of them directly, and two it never renders at all.
 * That is intended behaviour, not a defect. Matching stays invisible.
 *
 * So this audits SEARCH CORRECTNESS and nothing about presentation:
 *
 *  1. A BOUNDARY GATE that consults no corpus at all. It drives synthetic
 *     recalls carrying a value in each searchable field and proves every one
 *     is still reachable — retailer evidence and printed codes included —
 *     that code matching is exact rather than fuzzy, and that suppressing a
 *     malformed retailer NAME on Detail never removes its recall from the
 *     results. It decides the exit code.
 *
 *  2. A read-only CORPUS MEASUREMENT of the live active feed: how many
 *     consumer-visible cases each searchable field populates, how many are
 *     reachable ONLY through a field the card does not show, what each
 *     representative query returns, and the quality of the stored retailer
 *     evidence Detail names stores from. Measurement only — corpus counts
 *     move as the agencies publish and are NOT gates.
 *
 * Requires SUPABASE_URL / SUPABASE_SECRET_KEY (server-only) for part 2; with
 * no credentials the boundary gate still runs and still decides the exit
 * code. Reads `recall_cases`. Writes nothing to the database, ever.
 *
 * With `--report` it also writes a durable JSON artifact under `.reports/`
 * (git-ignored), so one measurement can be compared against a later one.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  displayableRetailerNames,
  isDisplayableRetailerName,
} from '../src/domain/retailer-display';
import type { CaseProjection } from '../src/domain/recall-types';
import {
  buildSearchEntry,
  matchesSearch,
  normalizeSearchText,
  parseSearchQuery,
} from '../src/lib/feed-search';
import type { FeedItem } from '../src/lib/recall-feed';
import { buildHomeCardModel } from '../src/lib/recall-presentation';
import { createSupabaseServerClient } from '../src/server/store/supabase-store';

const TODAY = new Date().toISOString().slice(0, 10);

function rule(label: string): string {
  return `\n${label}\n${'─'.repeat(78)}`;
}

/**
 * THE searchable field inventory, as `buildSearchEntry` composes it. Declared
 * here rather than exported from the matcher on purpose: the matcher stayed
 * byte-for-byte what it was before P2B7O, and this is a read-only audit's own
 * description of it. The boundary gate below proves the description is still
 * true by making each field the ONLY place a query can match.
 */
const SEARCHABLE_FIELDS = [
  'title',
  'productDescription',
  'productNames',
  'brands',
  'firmName',
  'retailerNames',
] as const;

type SearchableField = (typeof SEARCHABLE_FIELDS)[number];

function fieldValues(item: FeedItem, field: SearchableField): string[] {
  switch (field) {
    case 'title':
      return [item.title];
    case 'productDescription':
      return item.productDescription === null ? [] : [item.productDescription];
    case 'productNames':
      return item.productNames;
    case 'brands':
      return item.brands;
    case 'firmName':
      return item.firmName === null ? [] : [item.firmName];
    case 'retailerNames':
      return item.retailerNames;
  }
}

// ── Part 1: the boundary gate (no corpus, no network) ───────────────────────

function synthetic(overrides: Partial<FeedItem>): FeedItem {
  return {
    id: 'synthetic',
    sourceAgency: 'FDA',
    noticeType: 'recall',
    state: 'active',
    title: 'Example Foods Recalls Widgets Because of Possible Health Risk',
    classification: { value: 'class_I', sourceText: 'Class I' },
    hazardCategory: 'pathogen',
    publishedAt: '2026-09-01T00:00:00.000Z',
    lastPublicActivityAt: '2026-09-01T00:00:00.000Z',
    reasonText: null,
    pathogenOrAllergen: 'Salmonella',
    firmName: 'Example Foods Incorporated',
    brands: ['Examplebrand'],
    productDescription: 'Widgets',
    retailerNames: [],
    heroImageUrl: null,
    productNames: [],
    geography: { scope: 'nationwide', states: [], confidence: 'stated', sourceText: null },
    officialUrl: 'https://www.fda.gov/example',
    timeline: [],
    ...overrides,
  } as FeedItem;
}

function finds(item: FeedItem, query: string): boolean {
  const parsed = parseSearchQuery(query);
  return parsed !== null && matchesSearch(buildSearchEntry(item), parsed);
}

interface Failure {
  area: string;
  detail: string;
}

/** A recall whose ONLY occurrence of `token` is in `field`. */
function isolating(field: SearchableField, token: string): FeedItem {
  const blank = synthetic({
    title: 'Notice',
    productDescription: null,
    brands: [],
    firmName: null,
    retailerNames: [],
    productNames: [],
  });
  switch (field) {
    case 'title':
      return { ...blank, title: `Notice About ${token}` };
    case 'productDescription':
      return { ...blank, productDescription: `${token} Crisps` };
    case 'productNames':
      return { ...blank, productNames: [`${token} Crisps 8 oz | UPC: 0 99887 76655 4`] };
    case 'brands':
      return { ...blank, brands: [token] };
    case 'firmName':
      return { ...blank, firmName: `${token} Provisions LLC` };
    case 'retailerNames':
      return { ...blank, retailerNames: [`${token} Grocers`] };
  }
}

function runBoundaryGate(): Failure[] {
  const failures: Failure[] = [];

  // 1. Every inventoried field is genuinely searchable, on its own.
  for (const field of SEARCHABLE_FIELDS) {
    const item = isolating(field, 'Quarnbeck');
    if (!finds(item, 'Quarnbeck')) {
      failures.push({ area: 'inventory', detail: `${field} is no longer searched` });
    }
    // …and the token really is isolated, so the check above means what it says.
    const elsewhere = SEARCHABLE_FIELDS.filter((other) => other !== field).some((other) =>
      fieldValues(item, other).some((value) => /quarnbeck/i.test(value)),
    );
    if (elsewhere) {
      failures.push({
        area: 'inventory',
        detail: `${field}: the probe token leaked to another field`,
      });
    }
  }

  // 2. Printed codes: separators are irrelevant, and matching is never fuzzy.
  const coded = isolating('productNames', 'Quarnbeck');
  for (const typed of ['099887766554', '0-99887-76655-4', '0 99887 76655 4', 'UPC 099887766554']) {
    if (!finds(coded, typed)) {
      failures.push({ area: 'codes', detail: `a printed code was missed when typed "${typed}"` });
    }
  }
  if (finds(coded, '099887766655')) {
    failures.push({ area: 'codes', detail: 'code matching is fuzzy — a wrong digit matched' });
  }

  // 3. An empty query is a strict no-op, by identity of the returned array.
  if (parseSearchQuery('') !== null || parseSearchQuery('   ') !== null) {
    failures.push({ area: 'empty', detail: 'an empty query is no longer a strict no-op' });
  }

  // 4. The Detail display gate is a DISPLAY decision only. Suppressing a
  //    malformed store name must never remove its recall from the results.
  const placeNamed = synthetic({ retailerNames: ['Roseville and Sacr'] });
  if (displayableRetailerNames(placeNamed.retailerNames).length !== 0) {
    failures.push({
      area: 'retailer',
      detail: 'a place-shaped name is still printable as a store',
    });
  }
  if (!finds(placeNamed, 'Roseville')) {
    failures.push({
      area: 'retailer',
      detail: 'the display gate removed a recall from the search results',
    });
  }
  if (!isDisplayableRetailerName('Vandermeer Grocers')) {
    failures.push({ area: 'retailer', detail: 'a genuine store name was rejected' });
  }

  // 5. Matching stays INVISIBLE: the card model carries no match explanation
  //    and cannot be handed a query (the rejected P2B7O treatment).
  const card = buildHomeCardModel(synthetic({ retailerNames: ['Vandermeer Grocers'] }), {
    today: TODAY,
    prefs: null,
  });
  const rendered = JSON.stringify(card);
  if (rendered.includes('Matched') || 'searchProvenance' in card) {
    failures.push({ area: 'presentation', detail: 'the card model explains a search match' });
  }
  if (rendered.includes('Vandermeer')) {
    failures.push({ area: 'presentation', detail: 'a retailer reached the Feed card model' });
  }

  return failures;
}

// ── Part 2: read-only corpus measurement ────────────────────────────────────

interface CaseRow {
  id: string;
  projection: CaseProjection;
  merged_into: string | null;
}

async function loadCases(url: string, secretKey: string): Promise<CaseRow[]> {
  const client = createSupabaseServerClient(url, secretKey);
  const rows: CaseRow[] = [];
  const pageSize = 200;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('recall_cases')
      .select('id, projection, merged_into')
      .eq('state', 'active')
      .order('id')
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) rows.push(row as unknown as CaseRow);
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

function feedItemOf(row: CaseRow): FeedItem {
  const projection = row.projection as CaseProjection & {
    productDescription?: string | null;
    retailerNames?: string[];
    heroImageUrl?: string | null;
    brands?: string[];
  };
  return {
    id: row.id,
    sourceAgency: projection.sourceAgency,
    noticeType: projection.noticeType,
    state: projection.state,
    title: projection.title,
    classification: projection.classification,
    hazardCategory: projection.hazardCategory,
    publishedAt: projection.publishedAt,
    lastPublicActivityAt: projection.lastPublicActivityAt,
    reasonText: projection.reasonText,
    pathogenOrAllergen: projection.pathogenOrAllergen,
    firmName: projection.recallingFirm.displayName,
    brands: projection.brands ?? [],
    productDescription: projection.productDescription ?? null,
    retailerNames: projection.retailerNames ?? [],
    heroImageUrl: projection.heroImageUrl ?? null,
    productNames: projection.affectedProducts.map((product) => product.name),
    geography: projection.geography,
    officialUrl: projection.officialUrl,
    timeline: [],
  } as FeedItem;
}

/** The representative queries the audit reports on every run. */
const MEASURED_QUERIES = [
  'Walmart',
  'Baloian Farms',
  'Costco',
  'Kroger',
  'ByHeart',
  'cucumber',
  'listeria',
  'Great Value',
  'Marketside',
  'salad kit',
];

async function main(): Promise<void> {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment may be configured another way.
  }

  console.log(rule('BOUNDARY GATE (no corpus — this decides the exit code)'));
  const failures = runBoundaryGate();
  console.log(`  ${SEARCHABLE_FIELDS.length} searchable fields · codes · display gate`);
  if (failures.length === 0) {
    console.log('  PASS — every inventoried field is still reachable on its own, codes match');
    console.log('  exactly and never fuzzily, an empty query is a no-op, the Detail display');
    console.log('  gate removes no result, and no card explains why it matched.');
  } else {
    console.log(`  FAIL — ${failures.length} breach(es):`);
    for (const failure of failures) console.log(`    · [${failure.area}] ${failure.detail}`);
    process.exitCode = 1;
  }

  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.log(rule('CORPUS MEASUREMENT'));
    console.log('  SKIPPED — no SUPABASE_URL / SUPABASE_SECRET_KEY. The gate above still ran.\n');
    return;
  }

  const rows = await loadCases(url, secretKey);
  const consumer = rows.filter((row) => row.merged_into === null);
  const items = consumer.map(feedItemOf);
  const cards = items.map((item) => buildHomeCardModel(item, { today: TODAY, prefs: null }));
  // What each card actually shows, for the "reachable but invisible" measure.
  const visible = cards.map((card) =>
    normalizeSearchText(
      [
        card.productName,
        card.brand.text,
        card.reasonLine ?? '',
        card.categoryLabel ?? '',
        card.locationSummary,
        card.risk.badgeLabel ?? '',
        card.noticeLabel ?? '',
        card.activity.text,
      ].join(' '),
    ),
  );

  console.log(rule('CORPUS MEASUREMENT (read-only — reported, never gated)'));
  console.log(`  active cases                      ${String(rows.length).padStart(5)}`);
  console.log(`  consumer-visible (not merged)     ${String(consumer.length).padStart(5)}`);

  console.log('\n  SEARCHABLE FIELD INVENTORY');
  console.log('    field                 populated   carrying a word the card never shows');
  const population: Record<string, number> = {};
  const hiddenReach: Record<string, number> = {};
  for (const field of SEARCHABLE_FIELDS) {
    let populated = 0;
    let hidden = 0;
    items.forEach((item, index) => {
      const values = fieldValues(item, field).filter((value) => value.trim() !== '');
      if (values.length === 0) return;
      populated += 1;
      const words = new Set(
        values.flatMap((value) => normalizeSearchText(value).split(' ')).filter(Boolean),
      );
      if ([...words].some((word) => !visible[index].includes(word))) hidden += 1;
    });
    population[field] = populated;
    hiddenReach[field] = hidden;
    console.log(
      `    ${field.padEnd(20)} ${String(populated).padStart(6)}   ${String(hidden).padStart(6)}`,
    );
  }
  console.log('    (a word the card never shows is EXPECTED — matching is deliberately silent)');

  console.log('\n  QUERY RESULTS');
  console.log('    query             results');
  const measurements: { query: string; results: number }[] = [];
  for (const raw of MEASURED_QUERIES) {
    const query = parseSearchQuery(raw);
    if (query === null) continue;
    const count = items.filter((item) => matchesSearch(buildSearchEntry(item), query)).length;
    measurements.push({ query: raw, results: count });
    console.log(`    ${raw.padEnd(17)} ${String(count).padStart(6)}`);
  }

  console.log('\n  STORED RETAILER EVIDENCE (what Detail names stores from)');
  const retailerEntries = items.flatMap((item) => item.retailerNames);
  const distinct = [...new Set(retailerEntries)];
  const rejected = distinct.filter((name) => !isDisplayableRetailerName(name));
  const bearing = items.filter((item) => item.retailerNames.length > 0);
  const emptied = bearing.filter(
    (item) => displayableRetailerNames(item.retailerNames).length === 0,
  );
  console.log(`    cases carrying retailer evidence  ${String(bearing.length).padStart(5)}`);
  console.log(
    `    entries / distinct strings        ${retailerEntries.length} / ${distinct.length}`,
  );
  console.log(`    distinct strings the gate rejects ${String(rejected.length).padStart(5)}`);
  for (const name of rejected) console.log(`      · ${JSON.stringify(name)}`);
  console.log(`    cases left with no nameable store ${String(emptied.length).padStart(5)}`);
  for (const item of emptied) console.log(`      · ${item.id}`);

  if (process.argv.includes('--report')) {
    const dir = join(process.cwd(), '.reports');
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = join(dir, `p2b7o-search-${stamp}.json`);
    writeFileSync(
      file,
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          activeCases: rows.length,
          consumerVisibleCases: consumer.length,
          searchableFields: SEARCHABLE_FIELDS,
          fieldPopulation: population,
          fieldHiddenReach: hiddenReach,
          queries: measurements,
          retailerEvidence: {
            casesBearing: bearing.length,
            entries: retailerEntries.length,
            distinct: distinct.length,
            rejectedByDisplayGate: rejected,
            casesLeftWithNoNameableStore: emptied.map((item) => item.id),
          },
          boundaryGateFailures: failures,
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`\n  report written: ${file}`);
  }

  console.log(rule('VERDICT'));
  console.log(
    failures.length === 0
      ? '  PASS — search reads every field it is supposed to, and says nothing about it.\n'
      : '  FAIL — see the boundary gate above.\n',
  );
}

if (require.main === module) void main();
