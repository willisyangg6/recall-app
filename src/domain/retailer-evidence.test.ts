/**
 * The persisted retailer contract (Phase C3.1).
 *
 * `projection.retailerNames` may hold only what an authoritative source
 * stated in a high-confidence sold-at construction. Every rejection asserted
 * below is a string a LIVE notice actually produced while wearing a capital
 * letter — census 2026-08-26 over 1,911 stored cases — so these are
 * regression tests against observed reality, not imagined inputs.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { projectCase } from './projection';
import type { Geography } from './recall-types';
import { canonicalRetailerIds } from './retailer-catalog';
import { deriveRetailerNames, evaluateRetailerEvidence } from './retailer-evidence';
import { isRetailerName } from './retailer';
import type { NormalizedSourceRecord } from './source-record';

const UNKNOWN_GEO: Geography = {
  scope: 'unknown',
  states: [],
  confidence: 'stated',
  sourceText: null,
};

function derive(
  summaryText: string,
  overrides: Partial<Parameters<typeof deriveRetailerNames>[0]> = {},
) {
  return deriveRetailerNames({
    title: '',
    summaryText,
    carried: [],
    geography: UNKNOWN_GEO,
    ...overrides,
  });
}

// ── The evidence that MUST be captured ──────────────────────────────────────

test('verb-gated sold-at sentences yield the retailer, and the catalog resolves it', () => {
  const cases: [string, string, string][] = [
    // [source sentence, expected evidence, expected catalog id]
    [
      'The product was sold at Costco Wholesale locations in California.',
      'Costco Wholesale',
      'costco',
    ],
    [
      'This item was shipped to Walmart stores in Illinois, Indiana and Ohio.',
      'Walmart',
      'walmart',
    ],
    ['The salad was sold exclusively at Trader Joes.', 'Trader Joes', 'trader-joes'],
    [
      'These items were shipped exclusively to ALDI grocery stores in Indiana and Ohio.',
      'ALDI',
      'aldi',
    ],
    ['The chicken was shipped to Kroger retail stores in Texas.', 'Kroger', 'kroger'],
  ];
  for (const [sentence, expected, id] of cases) {
    const names = derive(sentence);
    assert.deepEqual(names, [expected], sentence);
    assert.deepEqual(canonicalRetailerIds(names), [id], sentence);
  }
});

test('Kroger banners are enumerated separately, exactly as the notice names them', () => {
  // Kroger notices list every banner; people shop at banners, not at parents.
  const names = derive(
    'The products were shipped to Fred Meyer and King Soopers retail stores in Oregon.',
  );
  assert.deepEqual(canonicalRetailerIds(names), ['fred-meyer', 'king-soopers']);
});

test('a possessive banner keeps its apostrophe and still resolves — "Baker\'s" is not "Baker"', () => {
  // Stripping the possessive produced "Baker", a fragment naming no chain.
  const names = derive("The products were shipped to Baker's retail stores in Nebraska.");
  assert.deepEqual(names, ["Baker's"]);
  assert.deepEqual(canonicalRetailerIds(names), ['bakers']);
  // A possessive on a chain whose name has none still resolves, because the
  // catalog strips a possessive tail when the remainder is a known alias.
  assert.deepEqual(canonicalRetailerIds(["Costco's"]), ['costco']);
  // It only ever REMOVES a letter: a bare "Baker" is never guessed upward.
  assert.deepEqual(canonicalRetailerIds(['Baker']), []);
});

test('a legitimate one-off retailer is preserved even though it matches no catalog entry', () => {
  const names = derive('The product was shipped to Cumberland Farms convenience stores.');
  assert.deepEqual(names, ['Cumberland Farms']);
  // Unresolved is a valid outcome: it displays, and simply never matches a
  // stored preference. Absence of a catalog entry is not absence of evidence.
  assert.deepEqual(canonicalRetailerIds(names), []);
});

test('an ambiguous chain name stays a retailer but resolves to nothing', () => {
  // "Giant" could be Giant Food (DC/MD/VA) or The GIANT Company (PA).
  assert.ok(isRetailerName('Giant'));
  assert.deepEqual(canonicalRetailerIds(['Giant']), []);
});

// ── The evidence that MUST be refused ───────────────────────────────────────

test('geography never becomes a retailer, in any of its disguises', () => {
  // Export destinations (live: Boar's Head, "exported to the Cayman Islands,
  // Dominican Republic, Mexico, and Panama").
  for (const country of ['Mexico', 'Panama', 'Dominican Republic', 'Canada', 'Quebec']) {
    assert.ok(!isRetailerName(country), country);
  }
  // Newspaper state abbreviations from FSIS datelines ("a Ferrisburg, Vt.").
  for (const abbreviation of ['Vt', 'Minn', 'Calif', 'Tex']) {
    assert.ok(!isRetailerName(abbreviation), abbreviation);
  }
  // A locality carrying its postal code (live: the Walmart Texas store list).
  for (const locality of ['DALLAS TX', 'ALLEN, TX', 'MINEOLA TX.', 'Kaufman TX', 'Fl, GA, NC']) {
    assert.ok(!isRetailerName(locality), locality);
  }
  // A trailing state name is a geography qualifier, not part of the name.
  assert.ok(!isRetailerName('Washington State'));
  // ...but a company whose legal tail merely LOOKS like a postal code is safe,
  // because the code must be uppercase to count.
  assert.ok(isRetailerName('The Kroger Co'));
});

test("the case's own stated geography bars a name from also being a retailer", () => {
  const names = deriveRetailerNames({
    title: '',
    summaryText: 'The product was shipped to Springfield stores.',
    carried: ['Springfield'],
    geography: { scope: 'states', states: ['Springfield'], confidence: 'stated', sourceText: null },
  });
  assert.deepEqual(names, []);
});

test('a flattened table never becomes a retailer list: headers, barcodes, packages, addresses', () => {
  // Column headings (live: "PRODUCT / UPC / EXP. DATES").
  for (const heading of [
    'UPC',
    'Product Name',
    'Barcode UPC',
    'Best By Date',
    'EXP. DATES',
    'STORE',
    'ITEM DESCRIPTION',
    'Store Street Address',
    'Store City & State',
    'Description',
  ]) {
    assert.ok(!isRetailerName(heading), heading);
  }
  // Barcodes split across cells, and product codes.
  for (const code of ['8 50042 40847 6', '2972-3', '850054894519', 'VFVC 306']) {
    assert.ok(!isRetailerName(code), code);
  }
  // Package/size rows.
  for (const pack of [
    'Butternut Squash Cubes 12 oz',
    'Chopped Cilantro 2 oz',
    '5-gallon bucket (30-lbs)',
    'Vegetable Bowl $5',
  ]) {
    assert.ok(!isRetailerName(pack), pack);
  }
  // Store street addresses (live: the Walmart Texas store list).
  for (const address of [
    '555 W INTERSTATE 30',
    '135 NE LOOP 564',
    '15757 COIT RD',
    '2311 S JEFFERSON AV',
  ]) {
    assert.ok(!isRetailerName(address), address);
  }
  // A shop whose name merely starts with a number is NOT an address.
  assert.ok(isRetailerName('2 Kids Candy Store'));
});

test('a category of shop is not a shop', () => {
  // Live: "sold at Asian markets" produced a retailer called "Asian".
  for (const generic of ['Asian', 'Hispanic', 'Various', 'Independent', 'Wholesale', 'Markets']) {
    assert.ok(!isRetailerName(generic), generic);
  }
  assert.deepEqual(derive('The product was sold at Asian markets throughout the region.'), []);
  // A real chain whose name contains a venue word keeps it.
  assert.ok(isRetailerName('Whole Foods'));
  assert.ok(isRetailerName('Market of Choice'));
  assert.ok(isRetailerName("BJ's Wholesale Club"));
});

test('a fragment is never repaired into a guess', () => {
  // Clauses the extraction window cut mid-sentence.
  for (const fragment of [
    'New York through',
    'Wegmans or other',
    'Kraft Foods distribution centers and',
    'California to',
    'Northern California through retail',
    "Ohio and Illinois in Heinen's Grocery",
    'Buds Marketplace (Eagle',
    '2025 and August 11',
    'Kroger and its affiliated',
  ]) {
    assert.ok(!isRetailerName(fragment), fragment);
  }
  // A bare legal suffix left by a comma split, and commodity words an
  // allergen sentence puts beside a selling verb.
  for (const leftover of [
    'Inc',
    'LP',
    'Shop',
    'Tree Nuts',
    'Soy Ingredients',
    'Product of Korea',
  ]) {
    assert.ok(!isRetailerName(leftover), leftover);
  }
});

test('a distribution centre is a route, not a storefront', () => {
  for (const warehouse of [
    'Publix distribution',
    'Florida Distribution Center',
    'Dollar General Distribution Centers',
  ]) {
    assert.ok(!isRetailerName(warehouse), warehouse);
  }
});

test('contact details are never retailers', () => {
  assert.ok(!isRetailerName('1-800-555-0199'));
  assert.ok(!isRetailerName('555 123 4567'));
  assert.ok(!isRetailerName('Compliance@Snapchill'));
  assert.ok(!isRetailerName('AskKaren.gov'));
  assert.ok(!isRetailerName('Amazon.com'));
});

test('a notice that states no retailer relationship yields nothing at all', () => {
  // The overwhelming majority of cases (live: 1,689 of 1,911).
  assert.deepEqual(derive('Products were sold only in the state of Texas at retail level.'), []);
  assert.deepEqual(derive('The product was distributed nationwide.'), []);
  assert.deepEqual(derive(''), []);
});

// ── Carried evidence, idempotency, and independence ─────────────────────────

test('valid stored evidence survives a re-derivation that finds nothing new', () => {
  const names = deriveRetailerNames({
    title: '',
    summaryText: 'No retailer is named anywhere in this notice.',
    carried: ['Costco'],
    geography: UNKNOWN_GEO,
  });
  assert.deepEqual(names, ['Costco']);
});

test('stored evidence the contract rejects is reported, never silently dropped', () => {
  const { names, rejectedCarried } = evaluateRetailerEvidence({
    title: '',
    summaryText: 'The product was shipped to Costco stores.',
    carried: ['Mexico', 'UPC'],
    geography: UNKNOWN_GEO,
  });
  assert.deepEqual(names, ['Costco']);
  assert.deepEqual(rejectedCarried, ['Mexico', 'UPC']);
});

test('deriving twice changes nothing — the field is its own fixed point', () => {
  const summaryText =
    'The products were shipped to Kroger and Fred Meyer retail stores in Oregon, and sold at Costco Wholesale locations.';
  const first = derive(summaryText);
  const second = deriveRetailerNames({
    title: '',
    summaryText,
    carried: first,
    geography: UNKNOWN_GEO,
  });
  assert.deepEqual(second, first);
  const third = deriveRetailerNames({
    title: '',
    summaryText,
    carried: second,
    geography: UNKNOWN_GEO,
  });
  assert.deepEqual(third, first);
});

test('one spelling per retailer: a repeated name is not persisted twice', () => {
  const names = deriveRetailerNames({
    title: 'Recall of product sold at Costco',
    summaryText: 'The product was sold at Costco stores. It was also shipped to Costco.',
    carried: [],
    geography: UNKNOWN_GEO,
  });
  assert.deepEqual(names, ['Costco']);
});

// ── Forward projection: one derivation, both agencies ───────────────────────

function record(overrides: Partial<NormalizedSourceRecord>): NormalizedSourceRecord {
  return {
    sourceSystem: 'fsis_api',
    sourceAgency: 'FSIS',
    nativeId: '001-2026',
    rawNativeId: '001-2026',
    noticeType: 'recall',
    lifecycle: 'active',
    closedYear: null,
    classification: { value: 'class_I', sourceText: 'High - Class I' },
    expansionOfNativeId: null,
    isRetractionNotice: false,
    retractsNativeIds: [],
    title: 'Firm Recalls Product',
    summaryText: '',
    summaryHtml: null,
    reasonText: null,
    hazardCategory: 'unknown',
    pathogenOrAllergen: null,
    firmDisplayName: 'A Firm',
    firmRawVariants: ['A Firm'],
    geography: UNKNOWN_GEO,
    productLines: [],
    quantityText: null,
    illnessStatement: null,
    consumerAction: null,
    contactText: null,
    officialUrl: 'https://example.gov/001-2026',
    publishedAt: '2026-01-05',
    lastModifiedAt: null,
    ...overrides,
  };
}

test('FSIS forward projection persists retailer names — the agency gap that had no adapter', () => {
  // The FSIS adapter never set retailerNames at all, so every FSIS case
  // projected retailer-blind however good its prose was.
  const projection = projectCase([
    record({
      sourceAgency: 'FSIS',
      sourceSystem: 'fsis_api',
      summaryText: 'These items were shipped to Walmart stores in Illinois, Indiana and Ohio.',
    }),
  ]);
  assert.deepEqual(projection.retailerNames, ['Walmart']);
  assert.deepEqual(canonicalRetailerIds(projection.retailerNames), ['walmart']);
});

test('FDA forward projection persists retailer names through the same derivation', () => {
  const projection = projectCase([
    record({
      sourceAgency: 'FDA',
      sourceSystem: 'fda_announcement',
      nativeId: 'fda-1',
      officialUrl: 'https://example.gov/fda-1',
      summaryText: 'The product was sold at Costco Wholesale locations in California.',
    }),
  ]);
  assert.deepEqual(projection.retailerNames, ['Costco Wholesale']);
});

test('an adapter-supplied retailer name unions into the canonical result', () => {
  const projection = projectCase([
    record({
      retailerNames: ['Publix'],
      summaryText: 'The product was also shipped to Kroger retail stores.',
    }),
  ]);
  assert.deepEqual(projection.retailerNames, ['Publix', 'Kroger']);
});

test('an adapter-supplied name that fails the contract is not persisted', () => {
  const projection = projectCase([record({ retailerNames: ['Mexico', 'UPC'] })]);
  assert.deepEqual(projection.retailerNames, []);
});

test('re-projecting a case reproduces its retailer names — a repair is self-healing', () => {
  const input = record({
    summaryText: 'These items were shipped to Wegmans grocery stores in New York.',
  });
  const first = projectCase([input]);
  // A later re-projection recomputes the same answer rather than erasing it.
  assert.deepEqual(projectCase([input]).retailerNames, first.retailerNames);
  assert.deepEqual(first.retailerNames, ['Wegmans']);
});

test('retailer enrichment leaves the rest of the projection untouched', () => {
  const base = record({ summaryText: 'No retailer here.' });
  const withRetailer = record({
    summaryText: 'The product was shipped to Costco stores.',
  });
  const a = projectCase([base]);
  const b = projectCase([withRetailer]);
  // Only the retailer-bearing text differs, so only retailerNames and the
  // consumer text may differ; identity, dates, and classification may not.
  assert.equal(a.publishedAt, b.publishedAt);
  assert.equal(a.lastPublicActivityAt, b.lastPublicActivityAt);
  assert.deepEqual(a.classification, b.classification);
  assert.deepEqual(a.geography, b.geography);
  assert.deepEqual(a.sourceIdentifiers, b.sourceIdentifiers);
  assert.deepEqual(a.retailerNames, []);
  assert.deepEqual(b.retailerNames, ['Costco']);
});

// ── C3.1 residual audit: role, not shape ────────────────────────────────────
//
// These strings all LOOK like business names. What disqualifies them is the
// role the source gives them in the sentence, so each test quotes the live
// notice it came from.

test('a warehouse is not a storefront, however it is named', () => {
  // "Wakefern distribution centers in Elizabeth, NJ" — a wholesale co-op's DC.
  assert.deepEqual(
    derive('The product was distributed to Wakefern distribution centers in Elizabeth, NJ.'),
    [],
  );
  // "Restaurant Depot distribution centers located in NJ, GA, FL, IL, and OH."
  assert.deepEqual(
    derive('These products were shipped to Restaurant Depot distribution centers located in NJ.'),
    [],
  );
  // A DC named for its manufacturer, with retail mentioned only as an aside.
  assert.deepEqual(
    derive('The products were distributed to Kraft distribution centers and in retail stores.'),
    [],
  );
  // Cities listed only as the sites of distribution centres.
  assert.deepEqual(
    derive(
      'The recalled product was distributed through the Scottsville, KY, Jonesville, SC, Blair, NE, South Boston, VA, and Ardmore, OK, Dollar General Distribution Centers.',
    ),
    [],
  );
  // A DC wearing half a city's name: "Aldi's Haines City, Florida".
  assert.deepEqual(
    derive(
      "The product was distributed through Aldi's Haines City, Florida Distribution Center, which services select Aldi stores in Florida.",
    ),
    [],
  );
});

test('a warehouse delivery is kept when the source ALSO names the chain’s shops', () => {
  // Live FSIS: the notice names the warehouses and then the storefronts, so
  // the storefronts win. The escape hatch requires the chain's own name to
  // carry the venue word — a generic "and in retail stores nationwide" tail
  // never rescues a manufacturer's distribution centre (asserted above).
  const names = derive(
    'These items were shipped to Costco distribution centers in Arizona, California and Utah, and may have been further distributed to Costco retail locations.',
  );
  assert.deepEqual(canonicalRetailerIds(names), ['costco']);
  // The same sentence shape WITHOUT the retail clause stays rejected.
  assert.deepEqual(
    derive('These items were shipped to Aldi distribution centers in Connecticut and Georgia.'),
    [],
  );
});

test('named stores survive a sentence that also mentions distribution centres', () => {
  // The stores are named BEFORE the warehouses, so the warehouses are an
  // aside — this is the guard that keeps the rule above from over-reaching.
  const names = derive(
    'These products were shipped to Costco, Foodmaxx, Kroger, Safeway and other retail stores and distribution centers in Alaska, Arizona and California.',
  );
  assert.deepEqual(canonicalRetailerIds(names), ['costco', 'foodmaxx', 'kroger', 'safeway']);
});

test('a distributor the source itself labels as one is never a retailer', () => {
  // "shipped to AMD Imports Inc., a distributor in Houston, Texas"
  assert.deepEqual(
    derive(
      'The product was shipped to AMD Imports Inc., a distributor in Houston, Texas which was also the point of entry.',
    ),
    [],
  );
  // "TRIMAR USA LLC in Miami, FL who further distributed the product to
  // retail and wholesale customers" — an intermediary, stated as such.
  assert.deepEqual(
    derive(
      'Cachapa de Maiz was distributed to TRIMAR USA LLC in Miami, FL who further distributed the product to retail and wholesale customers.',
    ),
    [],
  );
});

test('the wholesale TRADE is excluded while warehouse clubs are preserved', () => {
  // "C&S Wholesale Grocers, Inc (Hatfield)" supplies supermarkets.
  assert.ok(!isRetailerName('C&S Wholesale Grocers'));
  assert.deepEqual(
    derive(
      'The Southwest Salad Kits were distributed to retail stores including C&S Wholesale Grocers, Inc (Hatfield) and Stew Leonard’s.',
    ).filter((n) => n.includes('Wholesale')),
    [],
  );
  // "processed and distributed through Russ Davis Wholesale." — the name ends
  // in the trade itself, and the capture truncates it to "Russ Davis".
  assert.deepEqual(
    derive(
      'Baloian Farms cucumbers had been processed and distributed through Russ Davis Wholesale.',
    ),
    [],
  );
  // The word alone must never disqualify a shop people walk into.
  assert.ok(isRetailerName('Costco Wholesale'));
  assert.ok(isRetailerName("BJ's Wholesale Club"));
  assert.deepEqual(
    canonicalRetailerIds(
      derive('The product was sold at Costco Wholesale locations in California.'),
    ),
    ['costco'],
  );
  assert.deepEqual(
    canonicalRetailerIds(
      derive("The salmon was sold in 2-lb bags at BJ's Wholesale Club stores in Florida."),
    ),
    ['bjs-wholesale-club'],
  );
});

test('institutional foodservice and events are channels, not shops', () => {
  // "distributed to HRI Commercial Food Service locations nationwide"
  assert.ok(!isRetailerName('HRI Commercial Food Service'));
  assert.deepEqual(
    derive(
      'The affected chicken products were distributed to HRI Commercial Food Service locations nationwide.',
    ),
    [],
  );
  // "produced for, shipped, and distributed to PGA golf events in Minneapolis"
  assert.deepEqual(
    derive('These items were produced for, shipped, and distributed to PGA golf events.'),
    [],
  );
});

test('half a name is not a name: an ampersand split is never reassembled', () => {
  // "shipped to Army & Air Force Exchange Services (AAFES) locations" — the
  // exchange is a real retailer, but "Army" is not its name and the intended
  // one is deliberately not guessed back.
  assert.deepEqual(
    derive('These items were shipped to Army & Air Force Exchange Services (AAFES) locations.'),
    [],
  );
});

test('a delivery made in error is not a distribution statement', () => {
  assert.deepEqual(
    derive(
      'These labels were created for an upcoming formulation change and were shipped to Elevation Foods in error.',
    ),
    [],
  );
});

test('a city list introduced as one stays geography', () => {
  // "…to grocery stores mainly in these cities: Sunnyvale, Santa Clara, …"
  assert.deepEqual(
    derive(
      'Products were distributed in California to grocery stores mainly in these cities: Sunnyvale, Santa Clara, Fremont, Hayward, Pittsburg, Tracy, Manteca, Dublin and El Cerrito.',
    ),
    [],
  );
  // "…: Specific store locations include: Manhasset, Center Moriches, …" —
  // the retailer named BEFORE the marker is unaffected.
  const names = derive(
    'The recalled Broccoli Cutlets were distributed only to King Kullen Grocery Stores located in Long Island, NY: Specific store locations include: Manhasset, Center Moriches, Bridgehampton, Shirley, Garden City Park and Eastport.',
  );
  assert.ok(!names.includes('Center Moriches'), JSON.stringify(names));
  assert.ok(!names.includes('Bridgehampton'), JSON.stringify(names));
});

test('a name followed by its state, spelled out, is a city', () => {
  // "shipped to Cleveland and Youngstown, Ohio Foodbanks only"
  assert.deepEqual(derive('Mixed Vegetable Box shipped to Cleveland and Youngstown, Ohio.'), []);
  // A trailing postal CODE is how a notice qualifies a real shop, so it must
  // not trigger the same rule.
  assert.ok(derive('The bread was sold at Bernat’s Deli, MA and Golemo’s Market, MA.').length > 0);
});

test('towns a store table printed without their state code are still towns', () => {
  // A live Walmart store-location table listed "GILMER" and "LONGVIEW" with
  // no state code, so the "City ST" rule could not see them.
  for (const town of ['GILMER', 'Gilmer', 'LONGVIEW', 'Longview', 'SULPHUR SPRINGS']) {
    assert.ok(!isRetailerName(town), town);
  }
});

test('contact blocks and cross-references are not shops', () => {
  for (const junk of ['Phone Hours: Monday-Friday', '8am-4pm CST', 'See store list above.']) {
    assert.ok(!isRetailerName(junk), junk);
  }
  // A bare postal code in a run of them ("AZ, CA, HI, LV, MD"), and a place
  // word left holding an orphan initial.
  assert.ok(!isRetailerName('LV'));
  assert.ok(!isRetailerName('Washington D'));
  assert.ok(!isRetailerName('South D'));
  // "Jay C" is a real Kroger banner and keeps its initial.
  assert.ok(isRetailerName('Jay C'));
});

test('legitimate one-off consumer retailers are preserved by every rule above', () => {
  const cases: [string, string][] = [
    ['These items were shipped to Cumberland Farms retail locations in Maine.', 'Cumberland Farms'],
    // The live sentence, whose consignee run mixes real shops with the
    // wholesaler rejected above — the shops must survive that filtering.
    [
      'The Southwest Salad Kits were distributed to retail stores including Ahold USA Freetown, Kilduff, Stew Leonard’s, Associated Grocers of New England, Shapiro Produce, and C&S Wholesale Grocers, Inc (Hatfield).',
      'Stew Leonard’s',
    ],
    ['The product was distributed to Karns Foods locations in Pennsylvania.', 'Karns Foods'],
    [
      'The bamboo shoot product was distributed at Tokyo Central Costa Mesa store.',
      'Tokyo Central Costa Mesa',
    ],
    ['These items were shipped to Lotte Plaza Market retail locations in Florida.', 'Lotte Plaza'],
  ];
  for (const [sentence, expected] of cases) {
    assert.ok(derive(sentence).includes(expected), `${expected} ← ${sentence}`);
  }
});
