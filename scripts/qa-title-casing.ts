/**
 * Shopper-title casing QA (P2B7M) — read-only:
 *
 *   npm run qa:titles
 *
 * Two independent jobs, deliberately kept apart:
 *
 *  1. A BOUNDARY GATE that does not consult the live corpus at all. It drives
 *     synthetic titles of every shape the contract has to answer for — the two
 *     confirmed partial-sentence-case escapes, a lowercase leading article,
 *     jammed units, mixed-case brands, acronyms and codes, idempotence — and
 *     it re-derives, from the source files, that every shopper-facing surface
 *     still reaches the one shared title function. This half is what stops the
 *     fix from decaying into a memorized list of today's strings: a newly
 *     ingested title of either failure SHAPE fails it, whatever its words.
 *
 *  2. A read-only CORPUS MEASUREMENT of the live titles as shoppers see them,
 *     reported per segment (consumer-visible / merged-hidden / closed, FDA /
 *     FSIS, and the most recently ingested slice) so a regression can be seen
 *     arriving rather than inferred. Measurement only: corpus counts move as
 *     the agencies publish and are NOT gates.
 *
 * Requires SUPABASE_URL / SUPABASE_SECRET_KEY (server-only) for part 2; with
 * no credentials the boundary gate still runs and still decides the exit code.
 * Reads `recall_cases`. Writes nothing, anywhere.
 */

import {
  displayProductTitle,
  headlineCaseShopperTitle,
  normalizeUnitSpacing,
  productDisplayName,
} from '../src/lib/consumer-summary';
import { buildHomeCardModel, buildDetailModel } from '../src/lib/recall-presentation';
import { formatPushContent } from '../src/server/push/format';
import type { FeedItem } from '../src/lib/recall-feed';
import { buildSearchEntry, matchesSearch, parseSearchQuery } from '../src/lib/feed-search';
import type { CaseProjection } from '../src/domain/recall-types';
import { createSupabaseServerClient } from '../src/server/store/supabase-store';

const TODAY = new Date().toISOString().slice(0, 10);

function rule(label: string): string {
  return `\n${label}\n${'─'.repeat(78)}`;
}

// ── Part 1: the boundary gate (no corpus, no network) ───────────────────────

/**
 * Every shape the contract must answer for. `label` names the class, not the
 * example — a future ingest that arrives in the same shape with different
 * words is what this is really protecting.
 */
const BOUNDARY_CASES: { label: string; input: string; expected: string }[] = [
  {
    label: 'confirmed escape: capitalized head, sentence-cased tail',
    input: 'All purpose flour, bread mix, flat bread pizza mix',
    expected: 'All Purpose Flour, Bread Mix, Flat Bread Pizza Mix',
  },
  {
    label: 'confirmed escape: capitalized brand phrase, lowercase tail with units',
    input: 'Whole Nutrition Infant formula 24 oz cans and 0.6oz packets',
    expected: 'Whole Nutrition Infant Formula 24 oz Cans and 0.6 oz Packets',
  },
  {
    label: 'jammed quantity+unit is spaced and the tail titles',
    input: '500mL supplement bottle',
    expected: '500 mL Supplement Bottle',
  },
  {
    label: 'mixed-case brand survives beside a lowercase tail',
    input: 'biQ-FEL 500mL supplement bottle',
    expected: 'biQ-FEL 500 mL Supplement Bottle',
  },
  {
    label: 'lowercase leading article opens with a capital',
    input: 'a frozen pepperoni pizza',
    expected: 'A Frozen Pepperoni Pizza',
  },
  {
    label: 'leading article on an otherwise-cased name',
    input: 'a Frozen Pepperoni Pizza',
    expected: 'A Frozen Pepperoni Pizza',
  },
  {
    label: 'minor words stay lowercase inside the title',
    input: 'bags of flour with nuts and seeds in a box',
    expected: 'Bags of Flour with Nuts and Seeds in a Box',
  },
  {
    label: 'comma-separated enumeration titles every item',
    input: 'Cheddar cheese, sour cream, yogurt, and butter',
    expected: 'Cheddar Cheese, Sour Cream, Yogurt, and Butter',
  },
  {
    label: 'hyphenated compounds title each ordinary half',
    input: 'ready-to-eat, non-dairy, gluten-free, plant-based bars',
    expected: 'Ready-to-Eat, Non-Dairy, Gluten-Free, Plant-Based Bars',
  },
  {
    label: 'stylized identities are never rebuilt',
    input: 'a2 Platinum and iHerb and VidaSlim capsules',
    expected: 'a2 Platinum and iHerb and VidaSlim Capsules',
  },
  {
    label: 'acronyms and codes survive a lowercase tail',
    input: 'FDA and USDA FSIS UPC O157:H7 D3 lot 24TJ0055 tested samples',
    expected: 'FDA and USDA FSIS UPC O157:H7 D3 Lot 24TJ0055 Tested Samples',
  },
  {
    label: 'units, measurements and dates are preserved verbatim',
    input: '1 lb. and 8 oz and 40 g and 5 kg and 2L packs, best before 15.09.2027',
    expected: '1 lb. and 8 oz and 40 g and 5 kg and 2L Packs, Best Before 15.09.2027',
  },
  {
    label: 'scientific binomials keep their species epithet',
    input: 'Oven Dried Fish (Scomberomorus cavalla) with Listeria monocytogenes risk',
    expected: 'Oven Dried Fish (Scomberomorus cavalla) with Listeria monocytogenes Risk',
  },
  {
    label: 'an abbreviated genus is corrected, its species is not',
    input: 'e. coli contaminated spinach',
    expected: 'E. coli Contaminated Spinach',
  },
  {
    label: 'a clause opened by a colon capitalizes its minor word',
    input: 'crabmeat: the jumbo and lump grades',
    expected: 'Crabmeat: The Jumbo and Lump Grades',
  },
  {
    label: 'conventionally lowercase abbreviations are preserved',
    input: 'finished products (e.g. dips and salsa) containing jalapeno',
    expected: 'Finished Products (e.g. Dips and Salsa) Containing Jalapeno',
  },
  {
    label: 'an ALL-CAPS source is un-shouted, acronyms kept',
    input: 'TOP SIRLOIN BUTT FDA UPC',
    expected: 'Top Sirloin Butt FDA UPC',
  },
  {
    label: 'an already-correct title is a fixed point',
    input: 'Crunchy Trail Mix',
    expected: 'Crunchy Trail Mix',
  },
];

/**
 * A synthetic notice in the confirmed escape shape — a capitalized head over a
 * lowercase, unit-bearing tail — used to prove BEHAVIOURALLY that every
 * shopper surface reaches the shared contract. A surface that starts building
 * its own title renders this differently from the others and is caught here,
 * which a grep for an imported symbol would not do.
 */
function escapeShapedProjection(): CaseProjection {
  return {
    sourceAgency: 'FDA',
    noticeType: 'recall',
    state: 'active',
    closedYear: null,
    classification: { value: 'not_yet_classified', sourceText: null },
    title: 'Example Foods Issues Allergy Alert on Undeclared Peanut',
    summaryText: 'Example Foods recalled infant formula.',
    summaryHtml: null,
    reasonText: null,
    hazardCategory: 'allergen',
    pathogenOrAllergen: 'Undeclared Peanut',
    recallingFirm: { displayName: 'Example Foods', rawVariants: ['Example Foods'] },
    brands: [],
    productDescription: 'Whole Nutrition Infant formula 24 oz cans and 0.6oz packets',
    retailerNames: [],
    heroImageUrl: null,
    geography: { scope: 'unknown', states: [], confidence: 'inferred', sourceText: null },
    affectedProducts: [],
    quantityText: null,
    illnessStatement: null,
    reportsIllness: false,
    consumerAction: null,
    contactText: null,
    officialUrl: 'https://www.fda.gov/example',
    otherOfficialUrls: [],
    sourceIdentifiers: [],
    publishedAt: '2026-09-01',
    lastPublicActivityAt: '2026-09-01',
  } as CaseProjection;
}

const SHARED_TITLE = 'Whole Nutrition Infant Formula 24 oz Cans and 0.6 oz Packets';

interface Failure {
  area: string;
  detail: string;
}

function runBoundaryGate(): Failure[] {
  const failures: Failure[] = [];

  for (const { label, input, expected } of BOUNDARY_CASES) {
    const actual = displayProductTitle(input);
    if (actual !== expected) {
      failures.push({
        area: 'contract',
        detail: `${label}\n        input    ${JSON.stringify(input)}\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`,
      });
    }
    const twice = displayProductTitle(actual);
    if (twice !== actual) {
      failures.push({
        area: 'idempotence',
        detail: `${label}\n        once  ${JSON.stringify(actual)}\n        twice ${JSON.stringify(twice)}`,
      });
    }
    // Casing and unit spacing only: no word may be added, dropped or reordered.
    if (actual.replace(/\s+/g, '').toLowerCase() !== input.replace(/\s+/g, '').toLowerCase()) {
      failures.push({
        area: 'non-destructive',
        detail: `${label} changed more than casing and unit spacing\n        input  ${JSON.stringify(input)}\n        actual ${JSON.stringify(actual)}`,
      });
    }
  }

  // Every shopper surface, rendered from ONE synthetic escape-shaped notice.
  const projection = escapeShapedProjection();
  const id = '00000000-0000-4000-8000-000000000000';
  const item = feedItemOf({ id, projection, merged_into: null, created_at: '2026-09-01' });
  const home = buildHomeCardModel(item, { today: TODAY, affectsYou: false });
  const detail = buildDetailModel(
    { id, projection, timeline: [], affectedProducts: [], visuals: [] },
    { today: TODAY, affectsYou: false },
  );
  const push = formatPushContent({
    id,
    recallCaseId: id,
    kind: 'initial',
    triggerRuleId: 'new_recall',
    payloadSummary: '',
    createdAt: '2026-09-01T00:00:00.000Z',
    projection,
  });
  const surfaces: [string, string][] = [
    ['Feed / Saved card', home.productName],
    ['Recall Detail', detail.productName],
    // Share and accessibility copy read Detail's productName field directly,
    // so they cannot diverge from it without changing this value.
    ['share / accessibility copy', detail.productName],
    ['push notification', push.title.replace(/^Recall alert: /, '')],
  ];
  for (const [surface, rendered] of surfaces) {
    if (rendered !== SHARED_TITLE) {
      failures.push({
        area: 'shared boundary',
        detail: `${surface} bypasses the shared title contract\n        expected ${JSON.stringify(SHARED_TITLE)}\n        rendered ${JSON.stringify(rendered)}`,
      });
    }
  }

  // The canonical projection must survive every rendering untouched.
  if (
    projection.productDescription !== 'Whole Nutrition Infant formula 24 oz cans and 0.6oz packets'
  ) {
    failures.push({
      area: 'raw-source immutability',
      detail: 'rendering mutated the canonical product description',
    });
  }

  return failures;
}

// ── Part 2: read-only corpus measurement ────────────────────────────────────

interface CaseRow {
  id: string;
  projection: CaseProjection;
  merged_into: string | null;
  created_at: string;
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

const UNIT_TOKEN = /^[([]*(?:oz|lbs?|g|kg|mg|ml|mL|l|L|ct|pk|pc|qt|pt|gal|fl|ea)[.,;:)\]]*$/;
const JAMMED =
  /(?<![\p{L}\p{Nd}.])\p{Nd}+(?:\.\p{Nd}+)?(?:gal|lbs?|oz|kg|mg|ml|mL|ct|pk|pc|qt|pt|g)(?![\p{L}\p{Nd}])/u;

/**
 * An ordinary word: a token that carries no measurement and is not a unit.
 * Slash-joined tokens are judged by their segments, so "mg/" and "mg/mL)" are
 * unit notation rather than lowercase words that escaped capitalization.
 */
function ordinaryTokens(title: string): string[] {
  return title.split(/\s+/).filter((token) => {
    if (token === '' || /\p{Nd}/u.test(token)) return false;
    return !token.split('/').every((segment) => segment === '' || UNIT_TOKEN.test(segment));
  });
}

/**
 * A minor word, which headline style leaves lowercase mid-title — including
 * the conventionally lowercase abbreviations and the "w/" that abbreviates
 * "with". Compared on letters and interior dots only, so surrounding
 * punctuation ("(with", "w/", "e.g.") does not hide one.
 */
const MINOR_WORD =
  /^(?:a|an|the|and|or|nor|but|of|to|in|on|at|by|for|from|with|as|de|del|da|di|du|van|von|e\.g|i\.e|etc|w)$/iu;

function isMinorWord(token: string): boolean {
  return MINOR_WORD.test(token.replace(/[^\p{L}.]/gu, '').replace(/\.+$/, ''));
}

/**
 * A token that escaped capitalization: some segment of it is an ordinary
 * word (not a unit, not a minor word) written in lowercase with no uppercase
 * anywhere. Judged per slash segment, so "w/Coleslaw" is correctly cased and
 * "w/" is a minor word, while a bare "coleslaw" is an escape.
 */
function isLowercaseOrdinary(token: string): boolean {
  return token
    .split('/')
    .some(
      (segment) =>
        segment !== '' &&
        /\p{L}/u.test(segment) &&
        !/\p{Lu}/u.test(segment) &&
        !UNIT_TOKEN.test(segment) &&
        !isMinorWord(segment),
    );
}

interface Measurement {
  total: number;
  lowercaseLeadingWord: number;
  allLowercase: number;
  allUppercase: number;
  mixedHeadlineSentence: number;
  lowercaseTailAfterCapitalizedPrefix: number;
  enumerationInconsistent: number;
  jammedUnits: number;
  nonIdempotent: number;
}

function measure(titles: string[]): Measurement {
  const m: Measurement = {
    total: titles.length,
    lowercaseLeadingWord: 0,
    allLowercase: 0,
    allUppercase: 0,
    mixedHeadlineSentence: 0,
    lowercaseTailAfterCapitalizedPrefix: 0,
    enumerationInconsistent: 0,
    jammedUnits: 0,
    nonIdempotent: 0,
  };
  for (const title of titles) {
    const letters = title.replace(/[^\p{L}]/gu, '');
    if (letters !== '' && letters === letters.toLowerCase()) m.allLowercase += 1;
    if (letters !== '' && letters === letters.toUpperCase()) m.allUppercase += 1;
    if (JAMMED.test(title)) m.jammedUnits += 1;
    if (displayProductTitle(title) !== title) m.nonIdempotent += 1;

    const ordinary = ordinaryTokens(title);
    const isLower = isLowercaseOrdinary;
    const lowerOrdinary = ordinary.filter(isLower);
    const upperOrdinary = ordinary.filter((token) => /^\p{Lu}/u.test(token));
    if (ordinary.length > 0 && isLower(ordinary[0])) m.lowercaseLeadingWord += 1;
    if (lowerOrdinary.length > 0 && upperOrdinary.length > 0) m.mixedHeadlineSentence += 1;
    // The confirmed escape SHAPE: a capitalized prefix followed by a
    // lowercase ordinary word later in the same title.
    const firstUpper = ordinary.findIndex((token) => /^\p{Lu}/u.test(token));
    const tailEscape = ordinary.slice(firstUpper + 1).some(
      (token, index) =>
        isLower(token) &&
        // A species epithet closing a parenthesized binomial
        // ("(Scomberomorus cavalla)") is protected, not an escape.
        !/^[([]\p{Lu}/u.test(ordinary[firstUpper + index] ?? ''),
    );
    if (firstUpper >= 0 && tailEscape) m.lowercaseTailAfterCapitalizedPrefix += 1;
    // Enumeration consistency: every comma-separated clause should open the
    // same way (all capitalized, or all lowercase) — a mix is the escape.
    // Minor-word openers ("…, and Spicy Murukku") are correct headline style,
    // and an opener carrying any uppercase is intentional casing the contract
    // never touches — neither is an inconsistency.
    const clauses = title
      .split(',')
      .map((clause) => ordinaryTokens(clause.trim())[0])
      .filter(
        (token): token is string =>
          token !== undefined && /\p{L}/u.test(token) && !isMinorWord(token),
      );
    if (clauses.length > 1) {
      const escaped = clauses.filter(isLowercaseOrdinary).length;
      if (escaped > 0 && escaped < clauses.length) m.enumerationInconsistent += 1;
    }
  }
  return m;
}

const METRIC_LABELS: [keyof Measurement, string][] = [
  ['total', 'titles measured'],
  ['lowercaseLeadingWord', 'lowercase ordinary leading word'],
  ['allLowercase', 'all-lowercase titles'],
  ['allUppercase', 'all-uppercase titles'],
  ['mixedHeadlineSentence', 'mixed headline/sentence case'],
  ['lowercaseTailAfterCapitalizedPrefix', 'lowercase tail after capitalized prefix'],
  ['enumerationInconsistent', 'inconsistent comma enumerations'],
  ['jammedUnits', 'jammed quantity/unit tokens'],
  ['nonIdempotent', 'non-idempotent under the contract'],
];

function printMeasurement(name: string, m: Measurement): void {
  console.log(`\n  ${name}`);
  for (const [key, label] of METRIC_LABELS) {
    console.log(`    ${label.padEnd(44)} ${String(m[key]).padStart(5)}`);
  }
}

async function loadCases(url: string, secretKey: string): Promise<CaseRow[]> {
  const client = createSupabaseServerClient(url, secretKey);
  const rows: CaseRow[] = [];
  const pageSize = 200;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('recall_cases')
      .select('id, projection, merged_into, created_at')
      .order('id')
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) rows.push(row as unknown as CaseRow);
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment may be configured another way.
  }

  console.log(rule('BOUNDARY GATE (no corpus — this decides the exit code)'));
  const failures = runBoundaryGate();
  console.log(
    `  ${BOUNDARY_CASES.length} contract shapes · 4 shopper surfaces rendered end to end`,
  );
  if (failures.length === 0) {
    console.log('  PASS — every shape renders to contract, is idempotent, and changes only');
    console.log('  casing and unit spacing; every shopper surface still reaches the one');
    console.log('  shared title function.');
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

  const cases = await loadCases(url, secretKey);
  const titled = cases.map((row) => {
    const item = feedItemOf(row);
    return {
      row,
      title: buildHomeCardModel(item, { today: TODAY, affectsYou: false }).productName,
    };
  });

  console.log(rule('CORPUS MEASUREMENT (read-only — reported, never gated)'));
  const segments: [string, typeof titled][] = [
    ['ALL', titled],
    [
      'active, consumer-visible',
      titled.filter((t) => t.row.projection.state === 'active' && t.row.merged_into === null),
    ],
    ['active, merged-hidden', titled.filter((t) => t.row.merged_into !== null)],
    ['closed / retracted', titled.filter((t) => t.row.projection.state !== 'active')],
    ['FDA', titled.filter((t) => t.row.projection.sourceAgency === 'FDA')],
    ['FSIS', titled.filter((t) => t.row.projection.sourceAgency === 'FSIS')],
  ];
  const recent = [...titled]
    .sort((a, b) => b.row.created_at.localeCompare(a.row.created_at))
    .slice(0, 100);
  segments.push(['100 most recently ingested', recent]);
  for (const [name, rows] of segments) {
    printMeasurement(name, measure(rows.map((t) => t.title)));
  }

  // Display-form search support: both the official source spelling and the
  // rendered display form must still find the case.
  let searchMisses = 0;
  for (const { row, title } of titled) {
    const entry = buildSearchEntry(feedItemOf(row));
    const raw = productDisplayName(row.projection.productDescription ?? null, row.projection.title);
    for (const query of [raw, title, title.toLowerCase(), normalizeUnitSpacing(raw)]) {
      const parsed = parseSearchQuery(query.slice(0, 120));
      if (parsed && !matchesSearch(entry, parsed)) searchMisses += 1;
    }
  }
  console.log(rule('SEARCH (read-only)'));
  console.log(`  raw-form and display-form queries that miss their own case: ${searchMisses}`);

  console.log(rule('VERDICT'));
  console.log(
    failures.length === 0
      ? '  PASS — the shopper-title contract holds at the boundary.\n'
      : '  FAIL — see the boundary gate above.\n',
  );
}

if (require.main === module) void main();

export { measure, ordinaryTokens, type Measurement, METRIC_LABELS };
