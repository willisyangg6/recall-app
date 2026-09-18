/**
 * The P1 presentation contract, tested pure: dates, names, brands, reasons,
 * illness, quantity, geography, official links, imagery, and the gated
 * Affected Products model. Recorded real records (the category gold set's
 * verbatim titles/summaries) back the fidelity scenarios; synthetic inputs
 * exist only where they exercise a shape no recorded fixture represents.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { HAZARD_GUIDES } from '@/content/hazard-guides';
import { classifyIllnessReport } from '@/domain/illness';
import type { CaseProjection, Geography, TimelineEntry } from '@/domain/recall-types';
import type { CaseDetail, CaseVisual, FeedItem } from './recall-feed';
import type { RecallImage } from './recall-images';
import {
  activityDisplay,
  AFFECTED_PRODUCTS_INITIAL_ROWS,
  affectedProductsModel,
  affectedProductsSection,
  affectedProductsTable,
  buildDetailModel,
  detailImageSet,
  imageCounterText,
  imageDotWindow,
  imagePageView,
  imagePositionLabel,
  imageUnavailableLabel,
  IMAGE_DOTS_WINDOW,
  productImagery,
  caseIdentity,
  buildHomeCardModel,
  cleanProductName,
  conciseReasonLine,
  displayBrand,
  formatActivityDate,
  healthRiskSection,
  geographyLocationState,
  homeLocationSummary,
  UNSPECIFIED_DISTRIBUTION,
  illnessLine,
  officialSourceLink,
  stripTrailingMeasurement,
  whereSoldModel,
  whereSoldSection,
} from './recall-presentation';
import {
  buildConsumerCase,
  type ConsumerDistribution,
  type ConsumerPackageCheck,
} from './consumer-projection';
import { PACKAGE_FIELD_LABEL } from './consumer-schema';
import { measurementOnlyName } from './variant-identity';
import { stripHtml } from '@/domain/text';

const TODAY = '2026-09-01';

// ── Shared builders ─────────────────────────────────────────────────────────

function projection(overrides: Partial<CaseProjection>): CaseProjection {
  return {
    sourceAgency: 'FDA',
    noticeType: 'recall',
    state: 'active',
    closedYear: null,
    classification: { value: 'not_yet_classified', sourceText: null },
    title: 'Acme Foods Recalls Widgets',
    summaryText: '',
    summaryHtml: null,
    reasonText: null,
    hazardCategory: 'unknown',
    pathogenOrAllergen: null,
    recallingFirm: { displayName: 'Acme Foods', rawVariants: ['Acme Foods'] },
    brands: [],
    productDescription: null,
    retailerNames: [],
    heroImageUrl: null,
    geography: { scope: 'unknown', states: [], confidence: 'inferred', sourceText: null },
    affectedProducts: [],
    quantityText: null,
    illnessStatement: null,
    reportsIllness: false,
    consumerAction: null,
    contactText: null,
    officialUrl: 'https://www.fda.gov/x',
    otherOfficialUrls: [],
    sourceIdentifiers: [],
    publishedAt: '2026-08-01',
    lastPublicActivityAt: '2026-08-01',
    ...overrides,
  };
}

function detail(overrides: Partial<CaseProjection>, extra: Partial<CaseDetail> = {}): CaseDetail {
  return {
    id: 'case-1',
    projection: projection(overrides),
    timeline: [],
    affectedProducts: [],
    visuals: [],
    ...extra,
  };
}

function feedItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: 'case-1',
    sourceAgency: 'FDA',
    noticeType: 'recall',
    state: 'active',
    title: 'Acme Foods Recalls Widgets',
    classification: { value: 'not_yet_classified', sourceText: null },
    hazardCategory: 'unknown',
    publishedAt: '2026-08-01',
    lastPublicActivityAt: '2026-08-01',
    reasonText: null,
    pathogenOrAllergen: null,
    firmName: 'Acme Foods',
    brands: [],
    productDescription: null,
    retailerNames: [],
    heroImageUrl: null,
    productNames: [],
    geography: { scope: 'unknown', states: [], confidence: 'inferred', sourceText: null },
    officialUrl: 'https://www.fda.gov/x',
    timeline: [],
    ...overrides,
  };
}

const GOLD_SET: {
  rows: { sourceId: string; title: string; announcementSummary: string | null }[];
} = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'domain', 'fixtures', 'category-gold-set.json'), 'utf8'),
);

/** A verbatim recorded real record (title + announcement summary). */
function recorded(sourceId: string): CaseProjection {
  const row = GOLD_SET.rows.find((entry) => entry.sourceId === sourceId);
  assert.ok(row?.announcementSummary, `recorded fixture missing: ${sourceId}`);
  return projection({ title: row.title, summaryText: row.announcementSummary });
}

function materialEntry(occurredAt: string): TimelineEntry {
  return {
    occurredAt,
    kind: 'expanded',
    summary: 'expansion',
    causedBySnapshotIds: [],
    material: true,
    ruleId: 'expansion_products',
  };
}

function bookkeepingEntry(occurredAt: string): TimelineEntry {
  return {
    occurredAt,
    kind: 'source_updated',
    summary: 'wording edit',
    causedBySnapshotIds: [],
    material: false,
  };
}

// ── 1–3: the one activity date ──────────────────────────────────────────────

test('first announcement reads Announced; only a MATERIAL update reads Updated', () => {
  const announced = activityDisplay('2026-08-01', [bookkeepingEntry('2026-08-20')], TODAY);
  assert.equal(announced.kind, 'announced');
  assert.equal(announced.text, 'Announced Aug 1');

  const updated = activityDisplay('2026-08-01', [materialEntry('2026-08-20')], TODAY);
  assert.equal(updated.kind, 'updated');
  assert.equal(updated.text, 'Updated Aug 20');
  // Exactly one label — the text never carries both dates.
  assert.ok(!updated.text.includes('Announced'));
});

test('Today, Yesterday, same-year, and prior-year formats', () => {
  assert.equal(formatActivityDate('2026-09-01', TODAY), 'Today');
  assert.equal(formatActivityDate('2026-08-31', TODAY), 'Yesterday');
  assert.equal(formatActivityDate('2026-08-29', TODAY), 'Aug 29');
  assert.equal(formatActivityDate('2025-08-29', TODAY), 'Aug 29, 2025');
  // Year boundary: yesterday computed by calendar, not by string decrement.
  assert.equal(formatActivityDate('2025-12-31', '2026-01-01'), 'Yesterday');
});

test('no hour-level relative time can ever be produced', () => {
  // Source precision is day-level; the formatter's whole output vocabulary is
  // Today / Yesterday / a calendar date.
  for (const [date, today] of [
    ['2026-09-01', TODAY],
    ['2026-08-31', TODAY],
    ['2026-01-15', TODAY],
    ['2024-02-29', TODAY],
  ] as const) {
    assert.ok(!/hour|minute|ago/i.test(formatActivityDate(date, today)));
  }
});

// ── 4: product-name measurement removal ─────────────────────────────────────

test('a trailing package size is removed only when preserved in package evidence', () => {
  // Safe: the size survives in the affected-product line.
  assert.equal(
    stripTrailingMeasurement('Enoki Mushroom 150g', ['Enoki Mushroom 150g, UPC 12345678']),
    'Enoki Mushroom',
  );
  assert.equal(
    stripTrailingMeasurement('Cream Cheese Spread 7 oz', ['7 oz tub']),
    'Cream Cheese Spread',
  );
  // Unsafe: no evidence carries the size — the official wording is preserved.
  assert.equal(stripTrailingMeasurement('Enoki Mushroom 150g', []), 'Enoki Mushroom 150g');
  // Unsafe: removal would leave no meaningful product name.
  assert.equal(stripTrailingMeasurement('7 oz', ['7 oz pack']), '7 oz');
  // No product-to-size pairing is invented: names without a trailing
  // measurement pass through byte-identical.
  assert.equal(
    stripTrailingMeasurement('Nerds Gummy Clusters', ['5 oz bag']),
    'Nerds Gummy Clusters',
  );
});

// ── 5–7: brands ─────────────────────────────────────────────────────────────

test('a consumer brand beats the legal company; the company is only a fallback', () => {
  const branded = displayBrand(['HEB'], 'NatureBest Precut & Produce LLC', 'title');
  assert.equal(branded.text, 'HEB');
  assert.equal(branded.usedBrand, true);

  const fallback = displayBrand([], 'RED’S ALL NATURAL, LLC.', 'title');
  assert.equal(fallback.text, 'Red’s All Natural');
  assert.equal(fallback.usedBrand, false);

  const nothing = displayBrand([], null, 'Various Brands of Cut Fruit Recalled');
  assert.equal(nothing.text, 'Multiple products and brands');
});

test('a known brand is kept even when the product name repeats it', () => {
  // The pre-P1 formatter replaced "Prince" with the company because the
  // context repeated it; the frozen rule keeps the brand.
  const brand = displayBrand(['Prince'], 'Prince Bakery Inc.', 'Prince Bakery Recalls Prince Pita');
  assert.equal(brand.text, 'Prince');
  assert.equal(brand.usedBrand, true);
});

test('multi-brand recalls compact deterministically to two names plus +N', () => {
  assert.equal(displayBrand(['Alpha', 'Beta'], null, 't').text, 'Alpha, Beta');
  assert.equal(displayBrand(['Alpha', 'Beta', 'Gamma', 'Delta'], null, 't').text, 'Alpha, Beta +2');
  // Duplicates collapse before counting.
  assert.equal(displayBrand(['Alpha', 'alpha', 'Beta', 'Gamma'], null, 't').text, 'Alpha, Beta +1');
  assert.ok(!displayBrand(['Alpha', 'Beta', 'Gamma'], null, 't').text.includes('Multiple'));
  // A source-written brand LIST stored as one entry still compacts (recorded
  // Dole shape), with placeholder tails like "and Others" never shown as a
  // brand — while "and" inside a single brand name is never split on.
  assert.equal(
    displayBrand(['Dole, Ahold, Kroger, Lidl, and Others'], null, 't').text,
    'Dole, Ahold +2',
  );
  assert.equal(displayBrand(['Premo and Fresh Grab'], null, 't').text, 'Premo and Fresh Grab');
  // A junk "brand" value falls through to the company (recorded Daiso shape).
  assert.equal(displayBrand(['Various'], 'Daiso California LLC', 't').text, 'Daiso California');
});

test('a duplicated brand prefix is removed from the product name, never the brand itself', () => {
  const name = cleanProductName({
    title: 'x',
    productDescription: 'Kirkland Signature Almond Butter',
    displayedBrands: ['Kirkland Signature'],
    packageEvidence: [],
  });
  assert.equal(name, 'Almond Butter');
  // Unsafe: stripping would leave nothing meaningful — repetition tolerated.
  const kept = cleanProductName({
    title: 'x',
    productDescription: 'Kirkland Signature',
    displayedBrands: ['Kirkland Signature'],
    packageEvidence: [],
  });
  assert.equal(kept, 'Kirkland Signature');
  // A partial-word prefix never triggers ("Great" vs "Great Value").
  const partial = cleanProductName({
    title: 'x',
    productDescription: 'Greatful Granola',
    displayedBrands: ['Great'],
    packageEvidence: [],
  });
  assert.equal(partial, 'Greatful Granola');
  // A remainder opening with the word "Brand" was naming the brand, not a
  // product (recorded VidaSlim shape) — the official wording is preserved.
  const vidaslim = cleanProductName({
    title: 'x',
    productDescription: 'VidaSlim Brand 90-day Original Root Capsules',
    displayedBrands: ['VidaSlim'],
    packageEvidence: [],
  });
  assert.equal(vidaslim, 'VidaSlim Brand 90-day Original Root Capsules');
});

// ── 8–10: concise reason line ───────────────────────────────────────────────

test('pathogen reasons use Potential with consumer pathogen names', () => {
  assert.equal(
    conciseReasonLine({
      reasonText: 'Product Contamination',
      hazardCategory: 'microbial_contamination',
      pathogenOrAllergen: 'Salmonella Enteritidis',
      title: null,
    }),
    'Potential Salmonella contamination.',
  );
  assert.equal(
    conciseReasonLine({
      reasonText: null,
      hazardCategory: 'microbial_contamination',
      pathogenOrAllergen: 'Listeria monocytogenes',
      title: null,
    }),
    'Potential Listeria contamination.',
  );
  assert.equal(
    conciseReasonLine({
      reasonText: null,
      hazardCategory: 'microbial_contamination',
      pathogenOrAllergen: 'E. coli O157:H7',
      title: null,
    }),
    'Potential E. coli contamination.',
  );
  // An unlisted agent is preserved verbatim, never shortened by guesswork.
  assert.equal(
    conciseReasonLine({
      reasonText: null,
      hazardCategory: 'microbial_contamination',
      pathogenOrAllergen: 'Clostridium botulinum',
      title: null,
    }),
    'Potential Clostridium botulinum contamination.',
  );
});

test('allergen reasons name only source-supported allergens, singular and plural', () => {
  assert.equal(
    conciseReasonLine({
      reasonText: 'Unreported Allergens',
      hazardCategory: 'allergen',
      pathogenOrAllergen: 'undeclared milk',
      title: null,
    }),
    'Undeclared milk allergen.',
  );
  assert.equal(
    conciseReasonLine({
      reasonText: null,
      hazardCategory: 'allergen',
      pathogenOrAllergen: 'undeclared milk and soy',
      title: null,
    }),
    'Undeclared milk and soy allergens.',
  );
  // Non-major sensitivity triggers read plainly, without the allergen suffix.
  assert.equal(
    conciseReasonLine({
      reasonText: null,
      hazardCategory: 'allergen',
      pathogenOrAllergen: 'undeclared gluten',
      title: null,
    }),
    'Undeclared gluten.',
  );
});

test('non-pathogen reasons keep their distinctions and never become a pathogen template', () => {
  assert.equal(
    conciseReasonLine({
      reasonText: 'Mislabeling',
      hazardCategory: 'other_regulatory',
      pathogenOrAllergen: null,
      title: null,
    }),
    'Mislabeled product.',
  );
  assert.equal(
    conciseReasonLine({
      reasonText: 'Produced without benefit of inspection',
      hazardCategory: 'other_regulatory',
      pathogenOrAllergen: null,
      title: null,
    }),
    'Produced without required inspection.',
  );
  assert.equal(
    conciseReasonLine({
      reasonText: 'Product may contain pieces of metal',
      hazardCategory: 'foreign_material',
      pathogenOrAllergen: null,
      title: null,
    }),
    'Potential metal contamination.',
  );
  // Fallback: a short verbatim source reason is used as-is (documented rule);
  // an unusable one omits the line rather than hallucinating a template.
  assert.equal(
    conciseReasonLine({
      reasonText: 'Due to Elevated Levels of Lead',
      hazardCategory: 'unknown',
      pathogenOrAllergen: null,
      title: null,
    }),
    'Elevated Levels of Lead.',
  );
  assert.equal(
    conciseReasonLine({
      reasonText: null,
      hazardCategory: 'unknown',
      pathogenOrAllergen: null,
      title: null,
    }),
    null,
  );
  // The infant-formula nutrition family keeps a concise line rather than
  // being omitted for length (recorded Moor Herbs / Sammy's Milk shapes).
  assert.equal(
    conciseReasonLine({
      reasonText: 'Product does not provide sufficient nutrition when used as an infant formula',
      hazardCategory: 'unknown',
      pathogenOrAllergen: null,
      title: null,
    }),
    'Does not meet infant formula nutrition requirements.',
  );
});

// ── 11–12: What Happened and PHA wording ────────────────────────────────────

test('What Happened is clean, grammatical, and free of because-of-contains', () => {
  const model = buildDetailModel(
    detail({
      title: 'Acme Foods Recalls Cheese Products Due to Possible Listeria Contamination',
      reasonText: 'Product Contamination',
      hazardCategory: 'microbial_contamination',
      pathogenOrAllergen: 'Listeria monocytogenes',
      recallingFirm: { displayName: 'Acme Foods, LLC', rawVariants: [] },
    }),
    { today: TODAY, affectsYou: false },
  );
  assert.equal(
    model.whatHappened.text,
    'Acme Foods recalled Cheese products because the products may be contaminated with Listeria monocytogenes.',
  );
  assert.ok(!/because of contains/i.test(model.whatHappened.text));
});

test('a Public Health Alert keeps alert wording and its explicit label', () => {
  const model = buildDetailModel(
    detail({
      sourceAgency: 'FSIS',
      noticeType: 'public_health_alert',
      classification: { value: 'not_applicable_pha', sourceText: null },
      title:
        'FSIS Issues Public Health Alert for Frozen Taquitos Due To Possible Salmonella Contamination',
      reasonText: 'Product Contamination',
      hazardCategory: 'microbial_contamination',
      pathogenOrAllergen: 'Salmonella',
      officialUrl: 'https://www.fsis.usda.gov/x',
    }),
    { today: TODAY, affectsYou: false },
  );
  assert.equal(model.noticeTypeLabel, 'Public Health Alert');
  // Alert-specific construction — never recalled-language for a PHA.
  assert.match(model.whatHappened.text, /^A public health alert was issued for/);
  assert.ok(!/recalled/i.test(model.whatHappened.text));
  assert.equal(model.officialSource.label, 'View the official FSIS alert');
});

// ── 13–17: illness states ───────────────────────────────────────────────────

test('explicit zero illnesses — including negated statements — reads No illnesses reported', () => {
  const report = classifyIllnessReport(
    'No customer illnesses have been reported to date in connection with this problem.',
  );
  assert.equal(illnessLine(report), 'No illnesses reported.');
});

test('one illness reads with singular grammar', () => {
  const report = classifyIllnessReport(
    'One illness has been reported to date in connection with this product.',
  );
  assert.equal(illnessLine(report), '1 illness reported.');
});

test('a stated count is preserved with plural grammar', () => {
  const report = classifyIllnessReport(
    'A total of 55 illnesses have been reported in connection with this outbreak.',
  );
  assert.equal(illnessLine(report), '55 illnesses reported.');
});

test('reported illnesses without a reliable count read as a plain report', () => {
  const report = classifyIllnessReport(
    'Several illnesses have been reported in connection with this product.',
  );
  assert.equal(illnessLine(report), 'Illnesses have been reported.');
  // Hospitalization/death counts never become the illness count.
  const mixed = classifyIllnessReport(
    'Illnesses have been reported, and three deaths have been reported in connection with the outbreak.',
  );
  assert.equal(illnessLine(mixed), 'Illnesses have been reported.');
});

test('source silence omits the illness line entirely — never inferred zero', () => {
  assert.equal(illnessLine(classifyIllnessReport(null)), null);
  assert.equal(
    illnessLine(classifyIllnessReport('The product was distributed to retail stores in Ohio.')),
    null,
  );
});

// ── 18: quantity ────────────────────────────────────────────────────────────

test('the complete authoritative quantity is preserved, untruncated', () => {
  const model = buildDetailModel(
    detail({
      title: 'Acme Recalls Enoki Mushroom',
      productDescription: 'Enoki Mushroom',
      quantityText: '120 cases of Enoki Mushroom 150g',
    }),
    { today: TODAY, affectsYou: false },
  );
  // P3C-1: the quantity is a sentence of the What Happened narrative, not a
  // field of its own — it reads in the same paragraph and the same body type
  // as the reason sentence it follows.
  assert.ok(
    model.whatHappened.text.endsWith('The recall covers 120 cases of Enoki Mushroom 150g.'),
    model.whatHappened.text,
  );
  // A stored span carrying a clipped reason tail keeps its complete quantity
  // (amount, unit, product) and drops only the non-quantity clause — the
  // mid-word artifact ("…of the Fo.") can never render.
  const clipped = buildDetailModel(
    detail({
      quantityText: '1,506 boxes of Goat Milk Formula Recipe Kit on the recommendation of the Fo',
    }),
    { today: TODAY, affectsYou: false },
  );
  assert.ok(
    clipped.whatHappened.text.endsWith(
      'The recall covers 1,506 boxes of Goat Milk Formula Recipe Kit.',
    ),
    clipped.whatHappened.text,
  );
});

// ── 19: geography ───────────────────────────────────────────────────────────

test('Home location: one and two states as abbreviations, then +N, nationwide, unspecified', () => {
  const states = (names: string[]) =>
    homeLocationSummary({ scope: 'states', states: names, confidence: 'stated', sourceText: null });
  assert.equal(states(['California']), 'CA');
  assert.equal(states(['California', 'Washington']), 'CA, WA');
  assert.equal(states(['California', 'Washington', 'Oregon', 'Texas', 'Utah']), 'CA, WA +3');
  assert.equal(
    homeLocationSummary({
      scope: 'nationwide',
      states: [],
      confidence: 'stated',
      sourceText: null,
    }),
    'Nationwide',
  );
  assert.equal(
    homeLocationSummary({ scope: 'unknown', states: [], confidence: 'inferred', sourceText: null }),
    'Distribution not specified',
  );
});

test('Detail geography: full state names, a state derived from a stated metro, and exclusions', () => {
  // "Seattle and Tacoma metro areas in WA" — the display state comes from the
  // clearly identified area the source itself ties to Washington.
  const metro = buildConsumerCase(
    projection({
      summaryText:
        'The recalled product was sold at grocery stores within the Seattle and Tacoma metro areas in WA.',
    }),
    [],
  );
  const sold = whereSoldModel(metro.distribution);
  assert.deepEqual(sold.states, ['Washington']);

  // Exclusions hold: the firm's own address is never display geography.
  const firmOnly = buildConsumerCase(
    projection({
      summaryText:
        'Metro Produce Distributors Inc. of Minneapolis, Minnesota, is voluntarily recalling the product.',
    }),
    [],
  );
  const unspecified = whereSoldModel(firmOnly.distribution);
  assert.deepEqual(unspecified.states, []);
  // Leads carry no trailing period (P2a founder decision).
  assert.equal(unspecified.lead, 'Distribution not specified');
});

test('the Where It Was Sold model has no separate consumer AREAS field but keeps retailer names and count', () => {
  const consumer = buildConsumerCase(
    projection({
      summaryText:
        'The product was distributed in California and Washington and sold at Kroger, Safeway, Albertsons, Aldi, and Wegmans stores.',
    }),
    [],
  );
  const sold = whereSoldModel(consumer.distribution);
  assert.equal(sold.retailerCount, 5);
  assert.equal(sold.retailers.length, 5);
  // Noninteractive summary — a plain sentence, no dead disclosure control.
  assert.match(sold.retailerSummary!, /^Sold at /);
  assert.match(sold.retailerSummary!, /and 2 more retailers\.$/);
  assert.ok(!('areas' in sold));
});

// ── 20: affects-you flag on Home cards ──────────────────────────────────────

test('the Affects-you state rides the Home card model in any feed mode', () => {
  const flagged = buildHomeCardModel(feedItem(), { today: TODAY, affectsYou: true });
  assert.equal(flagged.affectsYou, true);
  const unflagged = buildHomeCardModel(feedItem(), { today: TODAY, affectsYou: false });
  assert.equal(unflagged.affectsYou, false);
});

// ── 21: optional imagery ────────────────────────────────────────────────────

test('absent imagery is a null model field, and the detail gallery deduplicates the hero', () => {
  assert.equal(
    buildHomeCardModel(feedItem(), { today: TODAY, affectsYou: false }).heroImageUrl,
    null,
  );

  const withHero = buildDetailModel(
    detail(
      { heroImageUrl: 'https://www.fda.gov/files/hero.jpg' },
      {
        visuals: [
          {
            url: 'https://cdn.example/label-1.webp',
            role: 'package_label',
            page: 1,
            width: 1024,
            height: 768,
            sourceUrl: 'https://www.fsis.usda.gov/label.pdf',
          },
        ],
      },
    ),
    { today: TODAY, affectsYou: false },
  );
  // Detail shows the SAME selected hero Home shows…
  assert.equal(withHero.heroImageUrl, 'https://www.fda.gov/files/hero.jpg');
  assert.equal(withHero.images.hero?.url, 'https://www.fda.gov/files/hero.jpg');
  // …and the allocation's gallery never repeats it — the label render is the
  // one remaining gallery candidate, carried with its provenance.
  assert.ok(!withHero.images.gallery.some((image) => image.url === withHero.heroImageUrl));
  assert.equal(withHero.images.gallery.length, 1);
  assert.equal(withHero.images.gallery[0].source, 'fsis_label_render');
  // A label render's stored alt is our wording, never an official caption.
  assert.equal(withHero.images.gallery[0].caption, null);

  const noHero = buildDetailModel(detail({}), { today: TODAY, affectsYou: false });
  assert.equal(noHero.heroImageUrl, null);
  assert.equal(noHero.images.hero, null);
  assert.deepEqual(noHero.images.gallery, []);
  assert.equal(noHero.images.rowImages.size, 0);
});

// ── 21b: the header's official product imagery (P2B7C, as corrected) ────────

/** One normalized official image, as the allocator hands it over. */
function officialImage(
  url: string,
  source: RecallImage['source'] = 'fda_announcement',
  aspectRatio: number | null = 1,
): RecallImage {
  return {
    url,
    source,
    caption: null,
    classification: null,
    width: null,
    height: null,
    aspectRatio,
  };
}

/** One affected-product row with enough stated identity to open the section. */
function productRow() {
  return {
    sourceNativeId: 'p1',
    name: '5-oz. plastic cups containing "ACME CHICKEN SALAD"',
    rawText: '5-oz. plastic cups containing "ACME CHICKEN SALAD" with lot code 1234',
    extractionConfidence: 'stated' as const,
  };
}

/** N official label pages, in the page order the renderer stored them. */
function labelVisuals(count: number): CaseVisual[] {
  return Array.from({ length: count }, (_, index) => ({
    url: `https://cdn.example/label-${index + 1}.webp`,
    role: 'package_label',
    page: index + 1,
    width: 1024,
    height: 768,
    sourceUrl: 'https://www.fsis.usda.gov/label.pdf',
  }));
}

test('the header set is complete and in official order — there is no presentation cap', () => {
  // AMENDED BY THE P2B7C CORRECTION. This test used to pin a six-image cap
  // and the sentence it disclosed ("Showing 6 of 51 official images."). Both
  // are retired by founder decision: a count a shopper cannot navigate to is
  // misleading, so every official photo is now reachable and the pager
  // virtualizes instead of dropping images.
  const urls = Array.from({ length: 51 }, (_, index) => `https://www.fda.gov/files/${index}.jpg`);
  const set = detailImageSet(
    urls.map((url) => officialImage(url)),
    'Chicken Salad Cup',
  );
  assert.ok(set);
  assert.equal(set.images.length, 51, 'the corpus outlier lost pages');
  assert.deepEqual(
    set.images.map((image) => image.url),
    urls,
    'the official order changed',
  );
  // Every image keeps the one factual label; no set-level count or copy
  // exists for a screen to render as prose.
  assert.deepEqual(
    new Set(set.images.map((image) => image.accessibilityLabel)),
    new Set(['Chicken Salad Cup']),
  );
  assert.deepEqual(Object.keys(set), ['images']);
});

test('the spoken position and the visible counter are the contract\u2019s, over reachable pages', () => {
  // AMENDED BY THE P2B7I CORRECTION: the six-page cap is gone, so every
  // counted page is reachable and the position needs no `shown` qualifier.
  assert.equal(imagePositionLabel(0, 74), 'Image 1 of 74');
  assert.equal(imagePositionLabel(1, 74), 'Image 2 of 74');
  assert.equal(imagePositionLabel(73, 74), 'Image 74 of 74');
  // The visible counter is the compact form over the pages that can be
  // shown \u2014 which IS the official total until something fails.
  assert.equal(imageCounterText(1, 74), '2 / 74');
  assert.equal(imageCounterText(73, 74), '74 / 74');
  assert.equal(imageCounterText(0, 6), '1 / 6');
  // Nothing failed: no second announcement, because each page already says
  // the same two numbers.
  assert.equal(imageUnavailableLabel(74, 74), null);
  assert.equal(imageUnavailableLabel(6, 6), null);
  // Something failed: the two totals are kept apart, and the visible
  // denominator stays the reachable one.
  assert.equal(
    imageUnavailableLabel(72, 74),
    '72 of 74 official images can be shown; the rest could not be loaded',
  );
  assert.equal(imageCounterText(1, 72), '2 / 72');
  assert.equal(imagePositionLabel(1, 72), 'Image 2 of 72');
  for (const rejected of ['Showing', 'shown', 'label pages']) {
    assert.ok(!imageCounterText(1, 74).includes(rejected));
    assert.ok(!imagePositionLabel(1, 74).includes(rejected));
  }
});

test('P2B7I correction: the page view is UNCAPPED \u2014 every usable image is a page', () => {
  const urls = (count: number) =>
    Array.from({ length: count }, (_, index) => `https://www.fda.gov/files/p-${index + 1}.jpg`);
  const setOf = (count: number) =>
    detailImageSet(
      urls(count).map((url) => officialImage(url)),
      'Widget',
    )!;
  const none = new Set<string>();
  assert.equal(detailImageSet([], 'Widget'), null);
  // The founder's matrix. `pages` always equals the official count, because
  // nothing is ever dropped for presentation \u2014 74 official photos are 74
  // swipeable pages, and page 7 and page 74 are both reachable.
  for (const [count, indicator] of [
    [1, 'none'],
    [2, 'dots'],
    [5, 'dots'],
    [6, 'dots-and-counter'],
    [7, 'dots-and-counter'],
    [74, 'dots-and-counter'],
    [87, 'dots-and-counter'],
  ] as const) {
    const view = imagePageView(setOf(count), none);
    assert.equal(view.pages.length, count, `${count} official: a page was dropped`);
    assert.equal(view.usableCount, count, `${count} official`);
    assert.equal(view.officialCount, count, `${count} official`);
    assert.equal(view.indicator, indicator, `${count} official`);
    // Complete and in official order \u2014 the hero first, the last page last.
    assert.deepEqual(
      view.pages.map((image) => image.url),
      urls(count),
      `${count} official`,
    );
  }
  // Explicitly: the pages the old cap would have hidden.
  const many = imagePageView(setOf(74), none);
  assert.equal(many.pages[6].url, 'https://www.fda.gov/files/p-7.jpg', 'page 7 is unreachable');
  assert.equal(many.pages[73].url, 'https://www.fda.gov/files/p-74.jpg', 'page 74 is unreachable');
  assert.equal(imageCounterText(73, many.usableCount), '74 / 74');
  // The counter is only ever ADDED beside the dots; there is no shape with a
  // counter and no dots.
  assert.ok(!(['none', 'dots', 'dots-and-counter'] as const).includes('counter' as never));
});

test('P2B7I correction: a failed page leaves the set and every healthy image after it stays reachable', () => {
  const urls = (count: number) =>
    Array.from({ length: count }, (_, index) => `https://www.fda.gov/files/p-${index + 1}.jpg`);
  const setOf = (count: number) =>
    detailImageSet(
      urls(count).map((url) => officialImage(url)),
      'Widget',
    )!;
  // An EARLY failure in a long set: 73 pages remain, and the last official
  // photo is still reachable \u2014 paging does not stop at six.
  const many = setOf(74);
  const earlyFailed = imagePageView(many, new Set([many.images[1].url]));
  assert.equal(earlyFailed.pages.length, 73);
  assert.equal(earlyFailed.usableCount, 73);
  assert.equal(earlyFailed.officialCount, 74, 'a failure changes what was published');
  assert.ok(!earlyFailed.pages.some((image) => image.url === many.images[1].url));
  assert.equal(earlyFailed.pages[72].url, many.images[73].url, 'the last photo became unreachable');
  assert.equal(earlyFailed.indicator, 'dots-and-counter');
  // The denominator is the reachable count, and the shortfall is a separate
  // sentence \u2014 the failed image is never implied to be viewable.
  assert.equal(imageCounterText(72, earlyFailed.usableCount), '73 / 73');
  assert.equal(
    imageUnavailableLabel(earlyFailed.usableCount, earlyFailed.officialCount),
    '73 of 74 official images can be shown; the rest could not be loaded',
  );
  // A small set: a failure leaves fewer pages than were published, so the
  // counter appears even under the dot window to say so.
  const three = setOf(3);
  const oneOfThree = imagePageView(three, new Set([three.images[1].url]));
  assert.deepEqual(
    oneOfThree.pages.map((image) => image.url),
    [three.images[0].url, three.images[2].url],
  );
  assert.equal(oneOfThree.indicator, 'dots-and-counter');
  assert.equal(imageCounterText(1, oneOfThree.usableCount), '2 / 2');
  // Down to one page: the static tile, no indicator at all.
  const two = setOf(2);
  assert.equal(imagePageView(two, new Set([two.images[0].url])).indicator, 'none');
  // Every candidate failed: nothing to render.
  const allFailed = imagePageView(three, new Set(three.images.map((image) => image.url)));
  assert.equal(allFailed.pages.length, 0);
  assert.equal(allFailed.indicator, 'none');
  // The set itself is untouched \u2014 the view is derived, never written back.
  assert.equal(many.images.length, 74);
  assert.equal(three.images.length, 3);
});

test('P2B7I correction: the dot window is at most five, follows the page, and never bounds the set', () => {
  assert.equal(IMAGE_DOTS_WINDOW, 5);
  // A set that fits is marked one dot each, from the first page to the last.
  assert.deepEqual(imageDotWindow(0, 2), [0, 1]);
  assert.deepEqual(imageDotWindow(4, 5), [0, 1, 2, 3, 4]);
  // Beyond it the window slides: the first pages at the beginning, the
  // current page through the middle, the final pages at the end.
  assert.deepEqual(imageDotWindow(0, 74), [0, 1, 2, 3, 4]);
  assert.deepEqual(imageDotWindow(1, 74), [0, 1, 2, 3, 4]);
  assert.deepEqual(imageDotWindow(2, 74), [0, 1, 2, 3, 4]);
  assert.deepEqual(imageDotWindow(3, 74), [1, 2, 3, 4, 5]);
  assert.deepEqual(imageDotWindow(36, 74), [34, 35, 36, 37, 38]);
  assert.deepEqual(imageDotWindow(71, 74), [69, 70, 71, 72, 73]);
  assert.deepEqual(imageDotWindow(73, 74), [69, 70, 71, 72, 73]);
  // Whatever the set size, the window is bounded, contains the current page
  // (so the active dot is never off-window), and is contiguous and ordered.
  for (const count of [1, 2, 5, 6, 7, 15, 51, 74, 87]) {
    for (const current of [0, 1, Math.floor(count / 2), count - 2, count - 1]) {
      if (current < 0 || current >= count) continue;
      const window = imageDotWindow(current, count);
      assert.ok(window.length <= IMAGE_DOTS_WINDOW, `${count}/${current}: too many dots`);
      assert.equal(window.length, Math.min(IMAGE_DOTS_WINDOW, count), `${count}/${current}`);
      assert.ok(window.includes(current), `${count}/${current}: the active page has no dot`);
      assert.ok(window[0] >= 0 && window[window.length - 1] < count, `${count}/${current}`);
      assert.deepEqual(
        window,
        [...window].sort((a, b) => a - b),
        `${count}/${current}`,
      );
    }
  }
  // THE SEPARATION: the dot count never limits the page count.
  const urls = Array.from(
    { length: 74 },
    (_, index) => `https://www.fda.gov/files/p-${index + 1}.jpg`,
  );
  const view = imagePageView(
    detailImageSet(
      urls.map((url) => officialImage(url)),
      'Widget',
    )!,
    new Set<string>(),
  );
  assert.equal(imageDotWindow(0, view.usableCount).length, IMAGE_DOTS_WINDOW);
  assert.equal(view.pages.length, 74);
});

test('zero images is a null set; one image is a set of one', () => {
  assert.equal(detailImageSet([], 'Widget'), null);
  const one = detailImageSet([officialImage('https://www.fda.gov/files/a.jpg')], 'Widget')!;
  assert.equal(one.images.length, 1);
  assert.equal(one.images[0].url, 'https://www.fda.gov/files/a.jpg');
});

test('the header takes FDA photography only — a label render can never enter it', () => {
  const hero = officialImage('https://www.fda.gov/files/hero.jpg');
  const photo = officialImage('https://www.fda.gov/files/second.jpg');
  const label = officialImage('https://cdn.example/label-1.webp', 'fsis_label_render');
  // The hero leads, then the gallery in its own order; the label render is
  // filtered out by SOURCE, not by position.
  assert.deepEqual(
    productImagery({ hero, rowImages: new Map(), gallery: [photo, label], supporting: [] }).map(
      (image) => image.url,
    ),
    [hero.url, photo.url],
  );
  // Even a stored hero that somehow pointed at a label render (the frozen
  // imagery policy forbids it, and qa:imagery gates on it) stays out of the
  // header rather than leading it.
  assert.deepEqual(
    productImagery({
      hero: label,
      rowImages: new Map(),
      gallery: [photo],
      supporting: [],
    }).map((image) => image.url),
    [photo.url],
  );
});

test('an FSIS notice’s label pages reach NO screen surface — no gallery, no section', () => {
  // The P2B7C correction: a general label gallery under Affected Products,
  // and the standalone section for a notice without one, are both removed.
  // The pages stay in the allocation for the evidence pipeline.
  const withTable = buildDetailModel(
    detail(
      { sourceAgency: 'FSIS', heroImageUrl: null },
      { affectedProducts: [productRow()], visuals: labelVisuals(6) },
    ),
    { today: TODAY, affectsYou: false },
  );
  assert.equal(withTable.productImages, null, 'a label render reached the header');
  assert.ok(withTable.sections.affectedProducts, 'the product table disappeared');
  assert.deepEqual(
    Object.keys(withTable.sections.affectedProducts),
    ['table'],
    'the section still carries a label gallery',
  );
  assert.ok(!('officialLabels' in withTable.sections), 'the standalone label section survives');
  // Preserved: the pages are still allocated, so the evidence pipeline and
  // row matching keep everything they had.
  assert.equal(withTable.images.gallery.length, 6);
  assert.ok(withTable.images.gallery.every((image) => image.source === 'fsis_label_render'));

  // The notice that used to get the standalone section: no table at all.
  const withoutTable = buildDetailModel(
    detail({ sourceAgency: 'FSIS', heroImageUrl: null }, { visuals: labelVisuals(1) }),
    { today: TODAY, affectsYou: false },
  );
  assert.equal(withoutTable.sections.affectedProducts, null);
  assert.equal(withoutTable.productImages, null);
  assert.ok(!('officialLabels' in withoutTable.sections));
  assert.equal(withoutTable.images.gallery.length, 1);
});

test('an image matched to an exact affected-product row still renders on that row', () => {
  // The one image Affected Products may show, and the rule that survives the
  // correction: the allocator matched it to THIS version, so it is evidence
  // about the row it sits in.
  const model = buildDetailModel(
    detail(
      {
        heroImageUrl: 'https://www.fda.gov/files/hero.jpg',
      },
      { affectedProducts: [productRow()] },
    ),
    { today: TODAY, affectsYou: false },
  );
  const rows = model.sections.affectedProducts?.table.expanded.rows ?? [];
  assert.ok(rows.length >= 1);
  for (const row of rows) {
    // Either no image (nothing was matched) or the allocator's own verdict —
    // never an unmatched image handed to a row to fill space.
    if (row.image === null) continue;
    const assignment = [...model.images.rowImages.values()].map((entry) => entry.image.url);
    assert.ok(assignment.includes(row.image.url));
  }
});

test('P2B7C regression (biQ-FEL): the Feed hero IS Detail image one, from one identity', () => {
  // The reported acceptance failure: the Feed card showed this recall's
  // photo, and opening it produced an empty grey Detail tile with two dots.
  // The recorded identities below are the live case's own (A&P Creations /
  // biQ-FEL, FDA): Home and Detail resolve the SAME hero URL, and that hero
  // is the first page Detail renders — neither screen selects or transforms
  // it. (The grey tile itself was a RENDER failure, which the pager now
  // removes from the set instead of counting; component-level pins live in
  // detail-design.test.ts.)
  const hero =
    'https://www.fda.gov/files/styles/recall_image_small/public/image_1_237.png?itok=-77FKfJv';
  const second =
    'https://www.fda.gov/files/styles/recall_image_small/public/image_2_185.png?itok=StVjAsIY';
  const summaryHtml =
    `<p><img src="${hero}" alt="biQ-FEL front label"/>` +
    `<img src="${second}" alt="biQ-FEL back label"/></p>`;
  const source = detail({
    title: 'A&P Creations LLC Issues Nationwide Recall of biQ-FEL',
    heroImageUrl: hero,
    summaryHtml,
  });
  const card = buildHomeCardModel(
    feedItem({ id: source.id, title: source.projection.title, heroImageUrl: hero }),
    { today: TODAY, affectsYou: false },
  );
  const model = buildDetailModel(source, { today: TODAY, affectsYou: false });
  // One authoritative hero identity, byte-identical on both surfaces.
  assert.equal(card.heroImageUrl, hero);
  assert.equal(model.heroImageUrl, hero);
  assert.equal(card.heroImageUrl, model.heroImageUrl);
  // …and it is Detail's first page, with the second official photo after it.
  assert.ok(model.productImages);
  assert.equal(model.productImages.images[0].url, hero);
  assert.equal(model.productImages.images.length, 2);
  assert.equal(model.productImages.images[1].url, second);
  // No query rewriting, no normalization drift, no re-encoding.
  assert.ok(
    model.productImages.images.every((image) => image.url.startsWith('https://www.fda.gov/')),
  );
});

// ── 22: official-link labels ────────────────────────────────────────────────

test('official-source labels are dynamic per agency and notice type, preserving the URL', () => {
  assert.deepEqual(officialSourceLink('FDA', 'recall', 'https://www.fda.gov/x'), {
    url: 'https://www.fda.gov/x',
    label: 'View the official FDA report',
  });
  assert.equal(
    officialSourceLink('FSIS', 'recall', 'https://www.fsis.usda.gov/x').label,
    'View the official FSIS report',
  );
  assert.equal(
    officialSourceLink('FSIS', 'public_health_alert', 'https://www.fsis.usda.gov/x').label,
    'View the official FSIS alert',
  );
});

// ── 23–26: affected products through the gated P0A projection ───────────────

test('structured identifiers become items with stable, populated-only field order', () => {
  // Middlefield (recorded): lot codes 251661/2524061/251672 with package sizes
  // in prose. The presentation consumes only the gated fields.
  const consumer = buildConsumerCase(
    recorded(
      'middlefield-original-cheese-co-op-recalls-100-grass-fed-pepper-jack-cheese-and-horseradish-flavored',
    ),
    [],
  );
  const model = affectedProductsModel(consumer.packageCheck, 'Pepper Jack Cheese');
  assert.equal(model.coverage, 'structured');
  assert.ok(model.note === null);
  const item = model.items[0];
  assert.ok(item, 'expected at least one structured item');
  // Fields follow the frozen presentation order and none is empty.
  const order: string[] = item.fields.map((field) => field.key);
  const expectedOrder = [
    'size',
    'bestBy',
    'useBy',
    'sellBy',
    'expiration',
    'upc',
    'lotCodes',
    'batchCodes',
    'packaging',
  ];
  assert.deepEqual(
    order,
    expectedOrder.filter((key) => order.includes(key)),
  );
  for (const field of item.fields) assert.notEqual(field.value.trim(), '');
  assert.equal(
    item.fields.find((field) => field.key === 'lotCodes')?.value,
    '251661, 2524061, 251672',
  );
});

test('honest source silence: no identifiers, and the model says the source provides none', () => {
  const consumer = buildConsumerCase(
    projection({
      title: 'Acme Recalls Fresh Cilantro',
      summaryText: 'The product was distributed in Texas. Consumers should discard the product.',
    }),
    [],
  );
  const model = affectedProductsModel(consumer.packageCheck, 'Fresh Cilantro');
  assert.equal(model.coverage, 'source_silent');
  assert.equal(model.items.length, 0);
  assert.match(model.note!, /does not provide package-specific identifiers/);
});

test('evidence that cannot be structured is distinguished from source silence', () => {
  const consumer = buildConsumerCase(
    projection({
      title: 'Acme Recalls Frozen Meals',
      // The notice clearly talks about identifiers, in a shape the parser
      // cannot structure — this must never present as source silence.
      summaryText: 'Affected lot and UPC information is provided in the attached document.',
    }),
    [],
  );
  const model = affectedProductsModel(consumer.packageCheck, 'Frozen Meals');
  assert.equal(model.coverage, 'unstructured');
  assert.ok(!/does not provide/.test(model.note!));
  assert.match(model.note!, /can’t be shown reliably here yet/);
});

test('P0A fidelity crosses the presentation boundary: periods survive, the 40 lb artefact never appears', () => {
  // North Star Imports (recorded): the period-delimited code GP.1051.18.
  const northStar = affectedProductsModel(
    buildConsumerCase(recorded('048-2019'), []).packageCheck,
    'Pickled Pork Hocks',
  );
  const northStarValues = [
    ...northStar.items.flatMap((item) => item.fields.map((field) => field.value)),
    ...northStar.appliesToAll.map((field) => field.value),
  ];
  assert.ok(northStarValues.includes('GP.1051.18'), northStarValues.join(' | '));

  // Middlefield (recorded): "…8 oz. packages, 5 lb. loaves and 40 lb. loaves"
  // proposed "40 lb" as a lot code before P0A rejected it. It must never
  // reach any presented code or identifier.
  const middlefield = affectedProductsModel(
    buildConsumerCase(
      recorded(
        'middlefield-original-cheese-co-op-recalls-100-grass-fed-pepper-jack-cheese-and-horseradish-flavored',
      ),
      [],
    ).packageCheck,
    'Pepper Jack Cheese',
  );
  const middlefieldValues = [
    ...middlefield.items.flatMap((item) => [
      ...item.fields.map((field) => field.value),
      ...(item.codes?.codes ?? []),
    ]),
    ...middlefield.appliesToAll.map((field) => field.value),
    ...middlefield.sharedCodes.flatMap((shared) => shared.codes.codes),
  ];
  for (const value of middlefieldValues) {
    assert.ok(!/40\s*lb/i.test(value), `40 lb artefact reached presentation: ${value}`);
  }
});

test('leading zeroes and hyphens survive to the presented fields', () => {
  const consumer = buildConsumerCase(
    projection({
      title: 'Acme Recalls Trail Mix',
      summaryText: 'The affected product has lot codes 007-A12, 0416B and UPC 0 41415 06453 1.',
    }),
    [],
  );
  const model = affectedProductsModel(consumer.packageCheck, 'Trail Mix');
  const values = model.items.flatMap((item) => item.fields.map((field) => field.value)).join(' ');
  assert.match(values, /007-A12/);
  assert.match(values, /0416B/);
});

// ── Measurement-only version names (P1 correction) ──────────────────────────

test('the recorded Ukrop’s benchmark record pairs each size with its quoted product name', () => {
  // FSIS benchmark record 012-2026, verbatim: each list item reads
  // "62.4-oz. ALUMINUM PAN WITH PLASTIC OVERWRAP containing "Ukrop's Baked
  // Spaghetti - Bulk" and BEST BY dates …". Before the correction the item
  // parser truncated at the size token and rendered "62.4-oz" as the card's
  // Product.
  const records = JSON.parse(
    readFileSync(
      path.join(__dirname, '..', 'server', 'fsis', 'fixtures', 'benchmark-records.json'),
      'utf8',
    ),
  ) as { record?: Record<string, unknown> }[];
  const raw = records
    .map((entry) => (entry.record ?? entry) as Record<string, string>)
    .find((entry) => entry.field_recall_number_export === '012-2026');
  assert.ok(raw, 'recorded fixture 012-2026 missing');
  const summaryHtml = raw!.field_summary;
  const consumer = buildConsumerCase(
    projection({
      sourceAgency: 'FSIS',
      title:
        'Ukrop’s Homestyle Foods Recalls Spaghetti and Chicken Products Due to Possible Foreign Matter Contamination',
      summaryText: stripHtml(summaryHtml),
      summaryHtml,
    }),
    [],
  );
  const model = affectedProductsModel(consumer.packageCheck, 'Spaghetti and Chicken Products');
  assert.equal(model.items.length, 4);
  const names = model.items.map((item) => item.name);
  // The source's own quoted product names, not the size tokens.
  for (const expected of [
    'Baked Spaghetti - Bulk',
    'Baked Spaghetti',
    'Chicken Cobbler - Bulk',
    'Chicken Cobbler',
  ]) {
    assert.ok(
      names.some((name) => name !== null && name.includes(expected)),
      `missing product name containing "${expected}": ${JSON.stringify(names)}`,
    );
  }
  // The sizes render as Package Size fields, and no measurement-only value
  // renders as Product anywhere.
  const sizes = model.items.map((item) => item.fields.find((field) => field.key === 'size')?.value);
  assert.deepEqual(sizes.sort(), ['11.6 oz', '14.8 oz', '48 oz', '62.4 oz']);
  for (const name of names) {
    assert.ok(
      name === null || !measurementOnlyName(name),
      `measurement rendered as Product: ${name}`,
    );
  }
});

function recordedFsis(recallNumber: string, title: string): CaseProjection {
  const records = JSON.parse(
    readFileSync(
      path.join(__dirname, '..', 'server', 'fsis', 'fixtures', 'benchmark-records.json'),
      'utf8',
    ),
  ) as { record?: Record<string, string> }[];
  const raw = records
    .map((entry) => (entry.record ?? entry) as Record<string, string>)
    .find((entry) => entry.field_recall_number_export === recallNumber);
  assert.ok(raw, `recorded fixture ${recallNumber} missing`);
  return projection({
    sourceAgency: 'FSIS',
    title,
    summaryText: stripHtml(raw!.field_summary),
    summaryHtml: raw!.field_summary,
  });
}

test('comma-grouped weights pair with their quoted product exactly like their siblings', () => {
  // Recorded PHA-032614, verbatim: "3,884-lb. super sack of “OvaEasy Plain
  // Whole Egg” with the lot code “H0613-B”" beside a comma-less "958-lb."
  // sibling. Before the correction the comma broke the pairing and the sack
  // rendered as a Product named "3,884-lb".
  const consumer = buildConsumerCase(
    recordedFsis(
      'pha-032614',
      'FSIS Issues Public Health Alert For Egg Products Unfit For Human Consumption',
    ),
    [],
  );
  const model = affectedProductsModel(consumer.packageCheck, 'Egg Products');
  const sacks = model.items.filter((item) =>
    item.fields.some(
      (field) => field.key === 'size' && /\b(?:3,884|1,031|4,422)\b/.test(field.value),
    ),
  );
  assert.equal(sacks.length, 3);
  for (const sack of sacks) {
    assert.equal(sack.name, 'OvaEasy Plain Whole Egg');
    // Each sack keeps its OWN lot code — the source relationship survives.
    assert.ok(sack.fields.some((field) => field.key === 'lotCodes'));
  }
  for (const item of model.items) {
    assert.ok(item.name === null || !measurementOnlyName(item.name), String(item.name));
  }
});

test('a genuinely unrecoverable measurement-only version demotes honestly (recorded Boar’s Head)', () => {
  // Recorded 023-2024: "9.5-lb. and 4.5-lb. full product, or various weight
  // packages sliced in retail delis, containing “Boar’s Head VIRGINIA HAM…”"
  // — the double-size head defeats safe name recovery, so the card renders
  // Package Size + Sell by with no Product line, never "9.5-lb" as Product.
  const consumer = buildConsumerCase(
    recordedFsis(
      '023-2024',
      'Boar’s Head Provisions Co. Recalls Ready-To-Eat Liverwurst And Other Deli Meat Products Due to Possible Listeria Contamination',
    ),
    [],
  );
  const model = affectedProductsModel(consumer.packageCheck, 'Deli Meat Products');
  const demoted = model.items.filter((item) => item.name === null);
  assert.ok(demoted.length > 0, 'expected a demoted size-only card');
  for (const item of demoted) {
    assert.ok(
      item.fields.some((field) => field.key === 'size'),
      JSON.stringify(item.fields),
    );
  }
  for (const item of model.items) {
    assert.ok(item.name === null || !measurementOnlyName(item.name), String(item.name));
  }
});

function nameOnlyPackageCheck(name: string): ConsumerPackageCheck {
  return {
    render: true,
    productionDateValues: [],
    scopeStatement: 'Only packages matching the affected details below are part of this recall.',
    variants: [
      {
        name,
        fields: [],
        rejected: [],
        codeLocation: null,
        lotCodes: null,
        photo: null,
        scope: null,
      },
    ],
    sharedFields: [],
    fields: [],
    rejected: [],
    lotCodes: null,
    productionCodes: null,
    productionDates: null,
    codeLocation: null,
    photos: [],
    coverage: 'structured',
    hasIdentifiers: true,
  };
}

test('a residual measurement-only version name is demoted to Package Size, never Product', () => {
  const model = affectedProductsModel(nameOnlyPackageCheck('62.4-oz'), 'Product');
  assert.equal(model.items.length, 1);
  assert.equal(model.items[0].name, null);
  assert.deepEqual(
    model.items[0].fields.map((field) => [field.key, field.label, field.value]),
    [['size', 'Size', '62.4-oz']],
  );
});

test('demotion never duplicates an existing Size field carrying the same measurement', () => {
  const check = nameOnlyPackageCheck('62.4-oz');
  check.variants[0].fields = [
    {
      key: 'size',
      label: 'Size',
      value: '62.4 oz',
      values: ['62.4 oz'],
      raw: ['62.4 oz'],
      canonicalKeys: ['62.4 oz'],
    },
  ];
  const model = affectedProductsModel(check, 'Product');
  assert.equal(model.items[0].name, null);
  assert.deepEqual(
    model.items[0].fields.map((field) => [field.key, field.value]),
    [['size', '62.4 oz']],
  );
});

test('measurement recognition is conservative and unit-aware', () => {
  for (const positive of ['62.4-oz', '8 oz', '5 lb', '750 mL', '12-pack', '62.4-oz.']) {
    assert.equal(measurementOnlyName(positive), true, positive);
  }
  for (const negative of [
    '7-Eleven Wrap', // product name containing numbers
    '365', // numeric brand
    '0 41415 06453 1', // UPC
    'GP.1051.18', // period-delimited lot code
    '2457744.2', // decimal-looking lot code
    '07/08/26', // date
    'EST. 19979', // establishment number
    'Cream Cheese Spread 7 oz', // complete name ending with a measurement
    '100% Grass-fed Pepper Jack Cheese',
    'a2 Platinum Premium Infant Formula',
  ]) {
    assert.equal(measurementOnlyName(negative), false, negative);
  }
});

// ── 27: Home and Detail agree ───────────────────────────────────────────────

test('Home and Detail agree on identity, name, brand, activity, and imagery', () => {
  const shared = {
    title: 'BLUE RIDGE FARMS Recalls Chicken Salad Products Due to Possible Listeria Contamination',
    productDescription: 'Chicken Salad Cup 7 oz',
    brands: ['Blue Ridge'],
    firm: 'Blue Ridge Farms, LLC',
    published: '2026-08-10',
    timeline: [materialEntry('2026-08-25')],
    hero: 'https://www.fda.gov/files/photo.jpg',
    productNames: ['Chicken Salad Cup 7 oz, UPC 12345678'],
  };
  const home = buildHomeCardModel(
    feedItem({
      id: 'case-9',
      title: shared.title,
      productDescription: shared.productDescription,
      brands: shared.brands,
      firmName: shared.firm,
      publishedAt: shared.published,
      timeline: shared.timeline,
      heroImageUrl: shared.hero,
      productNames: shared.productNames,
    }),
    { today: TODAY, affectsYou: true },
  );
  const detailModel = buildDetailModel(
    {
      id: 'case-9',
      projection: projection({
        title: shared.title,
        productDescription: shared.productDescription,
        brands: shared.brands,
        recallingFirm: { displayName: shared.firm, rawVariants: [] },
        publishedAt: shared.published,
        heroImageUrl: shared.hero,
      }),
      timeline: shared.timeline,
      affectedProducts: shared.productNames.map((name, ordinal) => ({
        sourceNativeId: String(ordinal),
        name,
        rawText: name,
        extractionConfidence: 'stated' as const,
      })),
      visuals: [],
    },
    { today: TODAY, affectsYou: true },
  );

  assert.equal(home.id, detailModel.id);
  assert.equal(home.productName, detailModel.productName);
  // The measurement was removed on BOTH screens (evidence preserved it).
  assert.equal(home.productName, 'Chicken Salad Cup');
  assert.equal(home.brand.text, detailModel.brand.text);
  assert.equal(home.activity.text, detailModel.activity.text);
  assert.equal(home.activity.text, 'Updated Aug 25');
  assert.equal(home.heroImageUrl, detailModel.heroImageUrl);
  assert.equal(home.affectsYou, detailModel.affectsYou);
});

// ── P2a: identity, risk agreement, geography/channels, graded coverage ──────

test('caseIdentity: one reliable brand is the subject; the firm stays traceable', () => {
  const identity = caseIdentity(['Little Temptations'], 'Crystal Temptations', 'any title');
  assert.equal(identity.whatHappenedSubject, 'Little Temptations');
  assert.equal(identity.legalFirm, 'Crystal Temptations');
  assert.equal(identity.brand.text, 'Little Temptations');
});

test('caseIdentity: multi-brand and brandless cases never invent a subject', () => {
  // Several brands: no single brand recalled anything — the firm did.
  assert.equal(caseIdentity(['Dole', 'Kroger'], 'Acme Foods, LLC', 't').whatHappenedSubject, null);
  // No brands at all: subject falls to the company inside What Happened.
  assert.equal(caseIdentity([], 'Acme Foods, LLC', 't').whatHappenedSubject, null);
  // A prose-length stored "brand" is not a name and never a subject.
  assert.equal(
    caseIdentity(
      ['Crazy Fresh and Quick & Easy an Unbranded and Bountiful Fresh gift baskets'],
      'Russ Davis Wholesale',
      't',
    ).whatHappenedSubject,
    null,
  );
});

test('placeholder brand values are junk everywhere — line, subject, and dedup', () => {
  // Recorded shapes: GHGA stores "No Brand Name"; Grimmway stores
  // "Multiple brand names". Neither names a brand.
  for (const junk of ['No Brand Name', 'Multiple brand names', 'Various', 'All brands']) {
    const identity = caseIdentity([junk], 'Acme Foods, LLC', 'title');
    assert.equal(identity.brand.usedBrand, false, junk);
    assert.equal(identity.brand.text, 'Acme Foods', junk);
    assert.equal(identity.whatHappenedSubject, null, junk);
  }
});

test('the What Happened subject is the shared identity decision, end to end', () => {
  const detailModel = buildDetailModel(
    detail({
      title: 'Crystal Temptations Issues Allergy Alert on Undeclared Milk in Chocolatey Eyeballs',
      productDescription: 'Chocolatey Eyeballs',
      brands: ['Little Temptations'],
      recallingFirm: { displayName: 'Crystal Temptations', rawVariants: [] },
      reasonText: 'Undeclared milk',
      hazardCategory: 'allergen',
      pathogenOrAllergen: 'undeclared milk',
    }),
    { today: TODAY, affectsYou: false },
  );
  assert.equal(
    detailModel.whatHappened.text,
    'Little Temptations recalled Chocolatey Eyeballs because the products may contain milk, an allergen that is not declared on the label.',
  );
});

test('Home and Detail render the same risk state: Pending, Unknown, and rated', () => {
  const pendingClassification = {
    value: 'not_yet_classified' as const,
    sourceText: null,
    officialClasses: [],
  };
  const home = buildHomeCardModel(feedItem({ classification: pendingClassification }), {
    today: TODAY,
    affectsYou: false,
  });
  const detailModel = buildDetailModel(detail({ classification: pendingClassification }), {
    today: TODAY,
    affectsYou: false,
  });
  // One shared "PENDING" on both surfaces, explained exactly once: the
  // top-level note carries it and the duplicate official block is gone. No
  // " RISK" suffix — an absent classification is not a level of risk.
  assert.equal(home.risk.badgeLabel, 'PENDING');
  assert.equal(detailModel.risk.headlineLabel, 'PENDING');
  assert.equal(home.risk.badgeLabel, detailModel.risk.headlineLabel);
  assert.ok(detailModel.risk.note);
  assert.equal(detailModel.risk.official, null);

  // A PHA reads "UNKNOWN" — it never receives a classification, so nothing is
  // pending for it — while its notice label stays a separate concept on both
  // screens. The word alone is not the whole story: the official block below
  // states exactly why no class exists, which is what keeps Unknown honest.
  const phaClassification = {
    value: 'not_applicable_pha' as const,
    sourceText: null,
    officialClasses: [],
  };
  const phaHome = buildHomeCardModel(
    feedItem({ classification: phaClassification, noticeType: 'public_health_alert' }),
    { today: TODAY, affectsYou: false },
  );
  const phaDetail = buildDetailModel(
    detail({ classification: phaClassification, noticeType: 'public_health_alert' }),
    { today: TODAY, affectsYou: false },
  );
  assert.equal(phaHome.risk.badgeLabel, 'UNKNOWN');
  assert.equal(phaDetail.risk.headlineLabel, 'UNKNOWN');
  assert.equal(phaHome.noticeLabel, 'Public Health Alert');
  assert.equal(phaDetail.noticeTypeLabel, 'Public Health Alert');
  // The PHA classification block is the one place that ADDS information
  // (why no class exists) — it stays.
  assert.equal(phaDetail.risk.official?.text, 'Not assigned');

  // Classified recalls keep their tier on both surfaces.
  const rated = buildHomeCardModel(
    feedItem({
      classification: { value: 'class_I', sourceText: 'Class I', officialClasses: ['class_I'] },
    }),
    { today: TODAY, affectsYou: false },
  );
  assert.equal(rated.risk.badgeLabel, 'CRITICAL');
});

test('the states lead is the ONE representation — a count lead becomes the full list', () => {
  const many = [
    'Alabama',
    'Arizona',
    'California',
    'Colorado',
    'Connecticut',
    'Florida',
    'Georgia',
    'Idaho',
    'Illinois',
    'Indiana',
    'Iowa',
    'Kansas',
    'Kentucky',
  ];
  const sold = whereSoldModel({
    scopeType: 'states',
    areaText: '13 states.',
    states: many,
    areas: [],
    coverage: [],
    retailers: [],
    retailersShown: [],
    retailersHidden: 0,
    retailLocations: [],
    onlinePlatforms: [],
    channels: [],
    unspecified: false,
  });
  assert.equal(
    sold.lead,
    'Alabama, Arizona, California, Colorado, Connecticut, Florida, Georgia, Idaho, Illinois, Indiana, Iowa, Kansas, and Kentucky',
  );
  // Small lists and the honest scopes pass through untouched.
  assert.equal(
    whereSoldModel({
      scopeType: 'states',
      areaText: 'California and Washington.',
      states: ['California', 'Washington'],
      areas: [],
      coverage: [],
      retailers: [],
      retailersShown: [],
      retailersHidden: 0,
      retailLocations: [],
      onlinePlatforms: [],
      channels: [],
      unspecified: false,
    }).lead,
    'California and Washington',
  );
});

test('named retailers render; trade channels stay in the model, off the screen', () => {
  const sold = whereSoldModel({
    scopeType: 'unspecified',
    areaText: '',
    states: [],
    areas: [],
    coverage: [],
    retailers: ['Walmart'],
    retailersShown: ['Walmart'],
    retailersHidden: 0,
    retailLocations: [],
    onlinePlatforms: [],
    channels: [
      'wholesalers',
      'distributors',
      'independent retailers',
      'food service',
      'farmers markets',
    ],
    unspecified: false,
  });
  // The Mangoes shape: the named retailer summary is untouched.
  assert.equal(sold.retailerSummary, 'Sold at Walmart.');
  // Robust Radish / Jalapeño Ranch shapes: trade channels never render, but
  // the evidence survives in the model for traceability.
  assert.deepEqual(sold.venueChannels, ['farmers markets']);
  assert.deepEqual(sold.channels, [
    'wholesalers',
    'distributors',
    'independent retailers',
    'food service',
    'farmers markets',
  ]);
});

test('graded coverage: partial evidence renders under conservative wording', () => {
  // Recorded Chocolatey shape: packaging text survived, but no identifying
  // dates, codes, or versions — rendered, honestly bounded, and never the
  // confident complete-coverage claim.
  const partial: ConsumerPackageCheck = {
    ...nameOnlyPackageCheck('ignored'),
    variants: [],
    fields: [
      {
        key: 'packaging',
        label: PACKAGE_FIELD_LABEL.packaging,
        value: 'plastic bag with designed header card',
        values: ['plastic bag with designed header card'],
        raw: ['plastic bag with designed header card'],
        canonicalKeys: ['packaging:plastic bag with designed header card'],
      },
    ],
    coverage: 'partial',
    scopeStatement:
      'The notice provides these package details. They may not identify every affected package.',
  };
  const model = affectedProductsModel(partial, 'Chocolatey Eyeballs');
  assert.equal(model.coverage, 'partial');
  assert.ok(!model.scopeStatement?.includes('Only packages matching'), model.scopeStatement ?? '');
  assert.match(model.scopeStatement ?? '', /may not identify every affected package/);
  assert.equal(model.items.length, 1);

  // The confident claim still stands where coverage is genuinely structured.
  const structured: ConsumerPackageCheck = {
    ...nameOnlyPackageCheck('Cheese Cup'),
    coverage: 'structured',
    scopeStatement: 'Only packages matching the affected details below are part of this recall.',
  };
  assert.equal(affectedProductsModel(structured, 'Cheese Cup').coverage, 'structured');
});

// ── P2b: trailing measurement lists, packaging demotion, the table ──────────

test('a trailing measurement LIST is removed only when every size is preserved', () => {
  // All three sizes preserved in evidence → the list strips.
  assert.equal(
    stripTrailingMeasurement('Olive Oil 500 ml, 250 ml, and 100 ml', [
      '500 ml bottle',
      '250 ml bottle',
      '100 ml bottle',
    ]),
    'Olive Oil',
  );
  // One size missing from evidence → the official wording stays whole.
  assert.equal(
    stripTrailingMeasurement('Olive Oil 500 ml, 250 ml, and 100 ml', ['500 ml bottle']),
    'Olive Oil 500 ml, 250 ml, and 100 ml',
  );
});

// ── P2B7G: the 500mL escape class, end to end through both models ──────────

test('P2B7G: the live 500mL escape renders spaced and cased on Home, Detail, and share alt', () => {
  // The recorded production shape: a stylized brand whose prefix is stripped
  // from the structured description, leaving "500mL supplement bottle" — the
  // uppercase L inside the jammed unit token defeated the P3D whole-string
  // gate, and no rule spaced the quantity.
  const item = feedItem({
    title:
      'A&P Creations LLC Issues Nationwide Recall of biQ-FEL Due to Undeclared Sildenafil and Tadalafil',
    productDescription: 'biQ-FEL 500mL supplement bottle',
    brands: ['biQ-FEL'],
    firmName: 'A&P Creations LLC',
  });
  const home = buildHomeCardModel(item, { today: TODAY, affectsYou: false });
  assert.equal(home.productName, '500 mL Supplement Bottle');
  // The stylized brand itself is never rewritten.
  assert.equal(home.brand.text, 'biQ-FEL');

  const model = buildDetailModel(
    detail({
      title: item.title,
      productDescription: item.productDescription,
      brands: item.brands,
      recallingFirm: { displayName: 'A&P Creations LLC', rawVariants: ['A&P Creations LLC'] },
    }),
    { today: TODAY, affectsYou: false },
  );
  // Detail receives the COMPLETE normalized title — identical to Home's, so
  // the two surfaces cannot disagree about product identity.
  assert.equal(model.productName, home.productName);
  // The exact official headline stays available, byte-identical to source.
  assert.equal(model.officialTitle, item.title);
});

test('P2B7G: normalization never mutates the stored fields the models read', () => {
  const item = feedItem({
    productDescription: 'biQ-FEL 500mL supplement bottle',
    brands: ['biQ-FEL'],
  });
  buildHomeCardModel(item, { today: TODAY, affectsYou: false });
  assert.equal(item.productDescription, 'biQ-FEL 500mL supplement bottle');
  assert.deepEqual(item.brands, ['biQ-FEL']);
  assert.equal(item.title, 'Acme Foods Recalls Widgets');
});

test('a description-derived name counts its own trailing sizes as evidence', () => {
  // The projection's description-size guarantee preserves these as Size
  // evidence, so the shared cleaner may move them out of the title — Home and
  // Detail apply the identical rule to the identical structured field.
  assert.equal(
    cleanProductName({
      title: 'Acme Recalls Olive Oil',
      productDescription: 'Garlic Infused Olive Oil 500 ml, 250 ml, and 100 ml',
      displayedBrands: [],
      packageEvidence: [],
    }),
    'Garlic Infused Olive Oil',
  );
  // A TITLE-derived name keeps the strict line-evidence gate: the size is
  // NOT stripped without evidence. P2B7G spaces the jammed quantity+unit
  // ("150g" → "150 g") — spacing preserves the measurement, it never moves
  // or removes it.
  assert.equal(
    cleanProductName({
      title: 'Acme Recalls Enoki Mushroom 150g',
      productDescription: null,
      displayedBrands: [],
      packageEvidence: [],
    }),
    'Enoki Mushroom 150 g',
  );
});

test('a prose-shaped brand entry never displays; the company fallback stands', () => {
  const prose = displayBrand(
    ['Crazy Fresh and Quick & Easy an Unbranded and Bountiful Fresh gift baskets'],
    'Russ Davis Wholesale',
    'Russ Davis Wholesale Recalls Peaches',
  );
  assert.equal(prose.text, 'Russ Davis Wholesale');
  assert.equal(prose.usedBrand, false);
  // Another concise stored brand wins when one exists — never sliced prose.
  const mixed = displayBrand(
    ['Crazy Fresh and Quick & Easy an Unbranded and Bountiful Fresh gift baskets', 'Crazy Fresh'],
    'Russ Davis Wholesale',
    'Russ Davis Wholesale Recalls Peaches',
  );
  assert.equal(mixed.text, 'Crazy Fresh');
  assert.equal(mixed.usedBrand, true);
});

test('a packaging-only version name is demoted to Packaging, never Product', () => {
  const model = affectedProductsModel(nameOnlyPackageCheck('Cardboard boxes'), 'Product');
  assert.equal(model.items.length, 1);
  assert.equal(model.items[0].name, null);
  assert.deepEqual(
    model.items[0].fields.map((field) => [field.key, field.label, field.value]),
    [['packaging', 'Packaging', 'Cardboard boxes']],
  );
});

test('packaging demotion never duplicates an existing Packaging value', () => {
  const check = nameOnlyPackageCheck('Cardboard boxes');
  check.variants[0].fields = [
    {
      key: 'packaging',
      label: 'Packaging',
      value: 'Cardboard boxes',
      values: ['Cardboard boxes'],
      raw: ['Cardboard boxes'],
      canonicalKeys: ['cardboardboxes'],
    },
  ];
  const model = affectedProductsModel(check, 'Product');
  assert.equal(model.items[0].name, null);
  assert.deepEqual(
    model.items[0].fields.map((field) => [field.key, field.value]),
    [['packaging', 'Cardboard boxes']],
  );
});

function tableCheck(
  variants: { name: string; fields: [string, string][] }[],
): ConsumerPackageCheck {
  return {
    render: true,
    productionDateValues: [],
    scopeStatement: 'Only packages matching the affected details below are part of this recall.',
    variants: variants.map(({ name, fields }, index) => ({
      name,
      fields: fields.map(([key, value]) => ({
        key: key as 'size' | 'bestBy' | 'upc' | 'lotCodes' | 'sellBy' | 'packaging',
        label: PACKAGE_FIELD_LABEL[key as 'size'],
        value,
        values: [value],
        raw: [value],
        canonicalKeys: [value.toLowerCase()],
      })),
      rejected: [],
      codeLocation: null,
      lotCodes: null,
      photo: null,
      scope: `t0r${index}`,
    })),
    sharedFields: [],
    fields: [],
    rejected: [],
    lotCodes: null,
    productionCodes: null,
    productionDates: null,
    codeLocation: null,
    photos: [],
    coverage: 'structured',
    hasIdentifiers: true,
  };
}

test('the table: headers once, Product first, columns only where a row has data', () => {
  const model = affectedProductsModel(
    tableCheck([
      {
        name: 'Strawberry Bars',
        fields: [
          ['size', '6 Bars'],
          ['upc', '041548610047'],
        ],
      },
      {
        name: 'Grape Bars',
        fields: [
          ['upc', '041548244044'],
          ['bestBy', 'October 31, 2027'],
        ],
      },
    ]),
    'Fruit Bars',
  );
  const table = affectedProductsTable(model);
  assert.ok(table);
  // Product leads; then the stable field order; no column exists without data.
  assert.deepEqual(
    table!.expanded.columns.map((column) => column.label),
    ['Product', 'Package Size', 'Best by', 'Barcode (UPC)'],
  );
  // A missing cell stays EMPTY (null) — never a dash, never a borrowed value.
  assert.deepEqual(
    table!.expanded.rows[0].cells.map((cell) => cell.text),
    ['Strawberry Bars', '6 Bars', null, '041548610047'],
  );
  assert.deepEqual(
    table!.expanded.rows[1].cells.map((cell) => cell.text),
    ['Grape Bars', null, 'October 31, 2027', '041548244044'],
  );
  // Two rows DO now need a reveal control — only a single-product recall
  // renders without one — and the collapsed view shows exactly the first row.
  assert.equal(table!.rowsDisclosure?.expandLabel, 'See all (2)');
  assert.equal(table!.initialRows, 1);
  assert.equal(table!.collapsed.rows.length, 1);
  assert.equal(table!.expanded.rows.length, 2);
  // Stable row identity for P2c image assignment.
  assert.deepEqual(
    table!.expanded.rows.map((row) => row.id),
    ['t0r0', 't0r1'],
  );
});

test('the table shows at most three rows initially, with See all (N) beyond', () => {
  const model = affectedProductsModel(
    tableCheck(
      ['A', 'B', 'C', 'D', 'E'].map((name) => ({
        name: `${name} Cookie Dough`,
        fields: [['upc', `0000000000${name.charCodeAt(0)}`]] as [string, string][],
      })),
    ),
    'Cookie Dough',
  );
  const table = affectedProductsTable(model);
  assert.ok(table);
  assert.equal(table!.expanded.rows.length, 5);
  assert.equal(table!.collapsed.rows.length, AFFECTED_PRODUCTS_INITIAL_ROWS);
  assert.equal(table!.initialRows, AFFECTED_PRODUCTS_INITIAL_ROWS);
  assert.equal(table!.rowsDisclosure?.expandLabel, 'See all (5)');
});

test('a demoted row keeps its own facts: name null, no Product masquerade', () => {
  const model = affectedProductsModel(
    tableCheck([
      { name: 'Cardboard boxes', fields: [['sellBy', 'July 8, 2026–June 29, 2027']] },
      { name: 'Potato Market Loaf', fields: [['sellBy', 'July 9, 2026']] },
    ]),
    'Frozen Products',
  );
  const table = affectedProductsTable(model);
  assert.ok(table);
  // The packaging-only name demoted: its row survives with an empty Product
  // cell and its own Sell by — the date is never relabeled or reassigned.
  assert.deepEqual(
    table!.expanded.columns.map((column) => column.label),
    ['Product', 'Sell by', 'Packaging'],
  );
  assert.deepEqual(
    table!.expanded.rows[0].cells.map((cell) => cell.text),
    [null, 'July 8, 2026–June 29, 2027', 'Cardboard boxes'],
  );
  assert.deepEqual(
    table!.expanded.rows[1].cells.map((cell) => cell.text),
    ['Potato Market Loaf', 'July 9, 2026', null],
  );
});

test('with no items there is no table; the model reports its honest state instead', () => {
  const detailless: ConsumerPackageCheck = {
    ...nameOnlyPackageCheck('x'),
    render: false,
    variants: [],
    coverage: 'source_silent',
    hasIdentifiers: false,
  };
  assert.equal(affectedProductsTable(affectedProductsModel(detailless, 'Product')), null);
});

test('proven-shared evidence repeats in every row — no shared-facts structure', () => {
  const check = tableCheck([
    { name: 'Buffalo Chicken Rangoon', fields: [['size', '100 pieces']] },
    { name: 'Benedetto’s Mozzarella Stick', fields: [['size', '120 pieces']] },
  ]);
  // Evidence the projection PROVED applies to every version (each row's own
  // source cell states it identically).
  check.sharedFields = [
    {
      key: 'sellBy',
      label: PACKAGE_FIELD_LABEL.sellBy,
      value: 'July 8, 2026–June 29, 2027',
      values: ['July 8, 2026–June 29, 2027'],
      raw: ['July 8, 2026–June 29, 2027'],
      canonicalKeys: ['range:date:2026-07-08:date:2027-06-29'],
    },
  ];
  const model = affectedProductsModel(check, 'Frozen Products');
  const table = affectedProductsTable(model);
  assert.ok(table);
  // The column exists once; the proven value repeats inside every row —
  // there is no separate shared-facts structure anywhere in the table shape.
  assert.deepEqual(
    table!.expanded.columns.map((column) => column.label),
    ['Product', 'Package Size', 'Sell by'],
  );
  assert.deepEqual(
    table!.expanded.rows[0].cells.map((cell) => cell.text),
    ['Buffalo Chicken Rangoon', '100 pieces', 'July 8, 2026–June 29, 2027'],
  );
  assert.deepEqual(
    table!.expanded.rows[1].cells.map((cell) => cell.text),
    ['Benedetto’s Mozzarella Stick', '120 pieces', 'July 8, 2026–June 29, 2027'],
  );
  // Row-specific values stay row-specific — sharing one field never merges
  // the others.
  assert.notEqual(table!.expanded.rows[0].cells[1].text, table!.expanded.rows[1].cells[1].text);
  assert.deepEqual(Object.keys(table!), ['collapsed', 'expanded', 'initialRows', 'rowsDisclosure']);
});

test('a collapsed code set is its row\u2019s own in-cell control — and its column obeys the views', () => {
  // Four rows: the three initially visible carry no codes; the hidden fourth
  // owns a large collapsed set. Collapsed shows NO codes column at all;
  // See all recomputes the columns and the code-bearing row presents its own
  // "View N codes" control — never an empty cell, never a list below the
  // table, never a sibling\u2019s codes.
  const check = tableCheck([
    { name: 'Vanilla Cup', fields: [['upc', '000000000001']] },
    { name: 'Chocolate Cup', fields: [['upc', '000000000002']] },
    { name: 'Caramel Cup', fields: [['upc', '000000000003']] },
    { name: 'Strawberry Cup', fields: [['upc', '000000000004']] },
  ]);
  const codeSet = {
    count: 6,
    codes: ['4327', '4330', '4331', '4332', '4333', '4334'],
    pairs: [{ code: '4327', date: 'November 22, 2025' }],
    label: 'Batch code',
  };
  check.variants[3].lotCodes = codeSet;
  const table = affectedProductsTable(affectedProductsModel(check, 'Cups'));
  assert.ok(table);
  assert.equal(table!.rowsDisclosure?.expandLabel, 'See all (4)');
  // Collapsed: no visible row justifies a codes column, so none renders.
  assert.deepEqual(
    table!.collapsed.columns.map((column) => column.key),
    ['product', 'upc'],
  );
  // Expanded: the column appears; the owning row carries the in-cell control
  // with exactly its own set; the visible siblings hold honest empty cells.
  assert.deepEqual(
    table!.expanded.columns.map((column) => column.key),
    ['product', 'upc', 'batchCodes'],
  );
  const codesIndex = 2;
  const cells = table!.expanded.rows.map((row) => row.cells[codesIndex]);
  assert.deepEqual(
    cells.map((cell) => cell.disclosure?.expandLabel ?? null),
    [null, null, null, 'See all (6)'],
  );
  assert.deepEqual(cells[3].values, codeSet.codes);
  assert.ok(cells.slice(0, 3).every((cell) => cell.text === null && cell.values.length === 0));
});

test('ambiguous case-level evidence never reaches a row cell', () => {
  // A fact whose owner could not be proven is rejected upstream
  // ('ambiguous-scope') and is structurally invisible to the table: it is
  // neither a row field nor shared evidence, so no column and no cell can
  // carry it — omission, never a guess.
  const check = tableCheck([
    { name: 'Strawberry Bars', fields: [['size', '6 Bars']] },
    { name: 'Grape Bars', fields: [['size', '6 Bars']] },
  ]);
  check.rejected = [
    { concept: 'lot', sourceLabel: 'Lot code', values: ['999111'], reason: 'ambiguous-scope' },
  ];
  const table = affectedProductsTable(affectedProductsModel(check, 'Fruit Bars'));
  assert.ok(table);
  assert.ok(!table!.expanded.columns.some((column) => column.key === 'lotCodes'));
  for (const row of table!.expanded.rows) {
    assert.ok(!row.cells.some((cell) => cell.text?.includes('999111')));
  }
});

test('P2e-B: the corrected anchovy recall renders its allergen on both surfaces', () => {
  // Before P2e-B this case was stored `foreign_material` and Home read
  // "Potential plastic contamination." — from its packaging, not its hazard.
  assert.equal(
    conciseReasonLine({
      reasonText: 'Product Contamination',
      hazardCategory: 'allergen',
      pathogenOrAllergen: 'undeclared fish',
      title: null,
    }),
    'Undeclared fish allergen.',
  );
  // And a foreign-material case whose only material word is packaging keeps
  // the truthful generic line instead of naming plastic.
  assert.equal(
    conciseReasonLine({
      reasonText: 'Product Contamination',
      hazardCategory: 'foreign_material',
      pathogenOrAllergen: null,
      title: null,
    }),
    'Potential foreign material contamination.',
  );
});

// ── P3A: optional section visibility ────────────────────────────────────────

/** A distribution the source said nothing usable about. */
function emptyDistribution(): ConsumerDistribution {
  return {
    scopeType: 'unspecified',
    areaText: '',
    states: [],
    areas: [],
    coverage: [],
    retailers: [],
    retailersShown: [],
    retailersHidden: 0,
    retailLocations: [],
    onlinePlatforms: [],
    channels: [],
    unspecified: true,
  };
}

/** A gated package check that survived nothing — the empty-section shape. */
function emptyPackageCheck(coverage: ConsumerPackageCheck['coverage']): ConsumerPackageCheck {
  return {
    ...nameOnlyPackageCheck('x'),
    render: false,
    variants: [],
    coverage,
    hasIdentifiers: false,
  };
}

test('P3A: a notice with nothing to show yields NO Affected Products section', () => {
  // Both identifier-less states: honest source silence and evidence we could
  // not structure. Neither is a reason to render a heading — the model's own
  // `note` explains the absence and is deliberately not content.
  for (const coverage of ['source_silent', 'parser_missed'] as const) {
    const model = affectedProductsModel(emptyPackageCheck(coverage), 'Product');
    assert.equal(model.items.length, 0);
    assert.notEqual(model.note, null, 'the honest state is still preserved in the model');
    assert.equal(affectedProductsSection(model), null, coverage);
  }
});

test('P3A: a product-name-only row is meaningful and keeps its section', () => {
  // The founder rule: a real affected product is never hidden because the
  // notice states no size, barcode, date, or code for it.
  const model = affectedProductsModel(nameOnlyPackageCheck('Buffalo Chicken Rangoon'), 'Product');
  const section = affectedProductsSection(model);
  assert.ok(section, 'a supported product name alone must keep the section');
  assert.deepEqual(
    section!.table!.expanded.columns.map((column) => column.key),
    ['product'],
  );
  assert.equal(section!.table!.expanded.rows[0].name, 'Buffalo Chicken Rangoon');
});

test('P3A: whitespace-only and value-less rows are not meaningful content', () => {
  // A row object exists, but every consumer-facing value is empty or
  // whitespace: no name, no fields, no codes. An empty row is not a row.
  const blank = nameOnlyPackageCheck('   ');
  const model = affectedProductsModel(blank, 'Product');
  assert.equal(affectedProductsSection(model), null);
  // The rejected package facts are structurally unreachable either way.
  assert.equal(
    model.items.every((item) => item.fields.length === 0),
    true,
  );
});

test('P3A: a row image alone never opens the section', () => {
  // Image allocation without an associated meaningful product row is
  // explicitly not content — no placeholder, no heading held open for it.
  const blank = affectedProductsModel(nameOnlyPackageCheck('   '), 'Product');
  const rowImages = new Map([
    [
      blank.items[0]?.rowId ?? 'v0',
      {
        image: { url: 'https://example.test/a.jpg' },
        accessibilityText: 'Official product photo',
      },
    ],
  ]);
  assert.equal(
    affectedProductsSection(blank, rowImages as never),
    null,
    'an image kept an otherwise-empty section open',
  );
});

test('P3C-2: a code-only or date-only notice keeps the section, as ONE table row', () => {
  // No named row survived, but the notice DOES state recall-level codes or
  // the calendar dates its production codes stand for. That content belongs
  // in the table — the below-table disclosure is retired — so the section
  // stays and the facts arrive as one anonymous evidence row.
  const codes = { count: 3, codes: ['A1', 'A2', 'A3'], pairs: [], label: 'Lot code' };
  // `render: true` with no variants and no approved case fields is the real
  // shape: the notice states recall-level codes but no per-version rows.
  const codeOnly: ConsumerPackageCheck = {
    ...emptyPackageCheck('structured'),
    render: true,
    hasIdentifiers: true,
    lotCodes: codes,
  };
  const withCodes = affectedProductsModel(codeOnly, 'Product');
  const codeSection = affectedProductsSection(withCodes);
  assert.ok(codeSection);
  const codeTable = codeSection!.table.expanded;
  // No row has a name, so the Product column does not render at all — an
  // honest omission, never a column of empty cells and never the recall
  // title borrowed to fill one.
  assert.deepEqual(
    codeTable.columns.map((column) => column.key),
    ['lotCodes'],
  );
  assert.equal(codeTable.rows.length, 1);
  assert.equal(codeTable.rows[0].name, null);
  // Three codes exceed the two-value inline limit, so the cell shows its
  // first two and reveals the third in place.
  assert.equal(codeTable.rows[0].cells[0].text, 'A1, A2, A3');
  assert.equal(codeTable.rows[0].cells[0].collapsedText, 'A1, A2');
  assert.equal(codeTable.rows[0].cells[0].disclosure?.expandLabel, 'See all (3)');

  const withDates = affectedProductsModel(
    {
      ...emptyPackageCheck('structured'),
      render: true,
      hasIdentifiers: true,
      productionDates: 'July 11, 2026, July 22, 2026',
    },
    'Product',
  );
  const dateSection = affectedProductsSection(withDates);
  assert.ok(dateSection);
  const dateTable = dateSection!.table.expanded;
  assert.deepEqual(
    dateTable.columns.map((column) => column.key),
    ['productionDates'],
  );
  assert.equal(dateTable.rows[0].cells[0].text, 'July 11, 2026, July 22, 2026');
});

test('P3C-2: a large shared code set repeats into every named row, behind its own control', () => {
  const codes = {
    count: 6,
    codes: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'],
    pairs: [],
    label: 'Lot code',
  };
  const model = affectedProductsModel(
    {
      ...emptyPackageCheck('structured'),
      render: true,
      hasIdentifiers: true,
      lotCodes: codes,
      variants: [
        {
          name: 'Original',
          fields: [
            {
              key: 'upc',
              label: 'Barcode (UPC)',
              value: '111',
              values: ['111'],
              raw: ['111'],
              canonicalKeys: ['111'],
            },
          ],
          rejected: [],
          codeLocation: null,
          lotCodes: null,
          photo: null,
          scope: 't0r0',
        },
        {
          name: 'Spicy',
          fields: [
            {
              key: 'upc',
              label: 'Barcode (UPC)',
              value: '222',
              values: ['222'],
              raw: ['222'],
              canonicalKeys: ['222'],
            },
          ],
          rejected: [],
          codeLocation: null,
          lotCodes: null,
          photo: null,
          scope: 't0r1',
        },
      ],
    },
    'Product',
  );
  const view = affectedProductsSection(model)!.table.expanded;
  assert.deepEqual(
    view.columns.map((column) => column.key),
    ['product', 'upc', 'lotCodes'],
  );
  // Repetition is the contract: the same set renders in BOTH rows, each with
  // its own control opening its own row's codes. No block below the table.
  for (const row of view.rows) {
    const cell = row.cells[2];
    assert.equal(cell.disclosure?.expandLabel, 'See all (6)');
    assert.deepEqual(cell.values, ['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
  }
  assert.deepEqual(
    view.rows.map((row) => row.name),
    ['Original', 'Spicy'],
  );
});

test('P3C-2: a row that states its OWN codes is never overwritten by the shared set', () => {
  const own = { count: 5, codes: ['R1', 'R2', 'R3', 'R4', 'R5'], pairs: [], label: 'Lot code' };
  const shared = {
    count: 7,
    codes: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'],
    pairs: [],
    label: 'Lot code',
  };
  const model = affectedProductsModel(
    {
      ...emptyPackageCheck('structured'),
      render: true,
      hasIdentifiers: true,
      lotCodes: shared,
      variants: [
        {
          name: 'Owns its codes',
          fields: [],
          rejected: [],
          codeLocation: null,
          lotCodes: own,
          photo: null,
          scope: 't0r0',
        },
        {
          name: 'States none',
          fields: [],
          rejected: [],
          codeLocation: null,
          lotCodes: null,
          photo: null,
          scope: 't0r1',
        },
      ],
    },
    'Product',
  );
  const view = affectedProductsSection(model)!.table.expanded;
  const lot = view.columns.findIndex((column) => column.key === 'lotCodes');
  assert.deepEqual(view.rows[0].cells[lot].values, own.codes);
  assert.deepEqual(view.rows[1].cells[lot].values, shared.codes);
});

test('P3C-2: a nameless row keeps an honest empty Product cell beside a named sibling', () => {
  const field = (key: 'upc' | 'lotCodes', value: string) => ({
    key,
    label: key === 'upc' ? 'Barcode (UPC)' : 'Lot code',
    value,
    values: [value],
    raw: [value],
    canonicalKeys: [value],
  });
  const model = affectedProductsModel(
    {
      ...emptyPackageCheck('structured'),
      render: true,
      hasIdentifiers: true,
      variants: [
        {
          name: 'Named version',
          fields: [field('upc', '111')],
          rejected: [],
          codeLocation: null,
          lotCodes: null,
          photo: null,
          scope: 't0r0',
        },
        {
          name: null,
          fields: [field('lotCodes', 'K9')],
          rejected: [],
          codeLocation: null,
          lotCodes: null,
          photo: null,
          scope: 't0r1',
        },
      ],
    },
    'Product',
  );
  const view = affectedProductsSection(model)!.table.expanded;
  // Some rows have names, so the Product column stays — and the nameless
  // row's cell is empty rather than borrowed, invented, or dashed.
  assert.equal(view.columns[0].key, 'product');
  assert.equal(view.rows[0].cells[0].text, 'Named version');
  assert.equal(view.rows[1].cells[0].text, null);
  assert.equal(view.rows[1].name, null);
});

test('P2B7E: Where it was sold is ALWAYS present, and never leads with nothing', () => {
  const stated = whereSoldModel({
    ...emptyDistribution(),
    scopeType: 'states',
    states: ['Texas', 'Oklahoma'],
  });
  assert.equal(whereSoldSection(stated), stated);
  assert.equal(stated.locationState, 'states');

  // No states and no stated area text. This used to produce an empty lead
  // and no section at all; the honest line is not optional.
  const silent = whereSoldModel(emptyDistribution());
  assert.equal(silent.lead, UNSPECIFIED_DISTRIBUTION);
  assert.equal(silent.leadCollapsed, UNSPECIFIED_DISTRIBUTION);
  assert.equal(silent.locationState, 'unspecified');
  assert.equal(whereSoldSection(silent), silent);

  // A whitespace-only area text is equally not a representation, and is
  // replaced by the same honest line rather than removing the section.
  const blank = whereSoldModel({ ...emptyDistribution(), areaText: '   ' });
  assert.equal(blank.lead, UNSPECIFIED_DISTRIBUTION);
  assert.equal(whereSoldSection(blank), blank);

  // THE regression this milestone repairs (biQ-FEL, case
  // 1b5ead1a-4f0c-42a8-af9e-477824c8e114): an unspecified distribution that
  // still names an online platform. The projection leaves `areaText` empty
  // for exactly this shape, which silently removed the section.
  const onlineOnly = whereSoldModel({
    ...emptyDistribution(),
    areaText: '',
    onlinePlatforms: ['Amazon'],
  });
  assert.equal(onlineOnly.lead, UNSPECIFIED_DISTRIBUTION);
  assert.equal(whereSoldSection(onlineOnly), onlineOnly);

  // The same for a named retailer and for a bare channel.
  for (const distribution of [
    { ...emptyDistribution(), areaText: '', retailers: ['Costco Wholesale'] },
    { ...emptyDistribution(), areaText: '', channels: ['convenience stores'] },
  ]) {
    const model = whereSoldModel(distribution);
    assert.equal(model.lead, UNSPECIFIED_DISTRIBUTION);
    assert.notEqual(whereSoldSection(model), null);
  }
});

test('P2B7E: Feed and Detail read ONE location-state contract', () => {
  // Same verdict, two widths. The card abbreviates; Detail lists in full;
  // neither may answer "nowhere".
  const nationwide: Geography = {
    scope: 'nationwide',
    states: [],
    confidence: 'stated',
    sourceText: null,
  };
  assert.equal(geographyLocationState(nationwide), 'nationwide');
  assert.equal(homeLocationSummary(nationwide), 'Nationwide');
  assert.equal(
    whereSoldModel({ ...emptyDistribution(), scopeType: 'nationwide', areaText: 'Nationwide.' })
      .locationState,
    'nationwide',
  );

  const states: Geography = {
    scope: 'states',
    states: ['California', 'Nevada'],
    confidence: 'stated',
    sourceText: null,
  };
  assert.equal(geographyLocationState(states), 'states');
  assert.equal(homeLocationSummary(states), 'CA, NV');

  // A "states" scope with no states is NOT a known location on either side.
  const empty: Geography = { scope: 'states', states: [], confidence: 'stated', sourceText: null };
  assert.equal(geographyLocationState(empty), 'unspecified');
  assert.equal(homeLocationSummary(empty), UNSPECIFIED_DISTRIBUTION);

  const unknown: Geography = {
    scope: 'unknown',
    states: [],
    confidence: 'inferred',
    sourceText: null,
  };
  assert.equal(geographyLocationState(unknown), 'unspecified');
  assert.equal(homeLocationSummary(unknown), UNSPECIFIED_DISTRIBUTION);

  // The unspecified state renders the SAME words on both surfaces.
  assert.equal(homeLocationSummary(unknown), whereSoldModel(emptyDistribution()).lead);
});

// ── P3D: display capitalization through the shared models ───────────────────

test('P3D named regression (synthetic): dynacare renders as Dynacare on every surface', () => {
  // Synthetic reproduction of the production-observed Dynarex/Dynacare defect
  // (visually verified in production on 2026-09-04; that notice is not in the
  // recorded corpus, so these inputs mirror its shape rather than replay it).
  // The FDA structured brand field carried "dynacare" entirely lowercase.
  const item = feedItem({
    title:
      'Dynarex Corporation Expands Recall to Include Additional Products Due to Possible Health Risk',
    firmName: 'Dynarex Corporation',
    brands: ['dynacare'],
    productDescription: 'Baby Powder',
    hazardCategory: 'chemical_contamination',
    pathogenOrAllergen: 'asbestos',
  });
  const home = buildHomeCardModel(item, { today: TODAY, affectsYou: false });
  const model = buildDetailModel(
    detail({
      title: item.title,
      recallingFirm: { displayName: 'Dynarex Corporation', rawVariants: ['Dynarex Corporation'] },
      brands: ['dynacare'],
      productDescription: 'Baby Powder',
      hazardCategory: 'chemical_contamination',
      pathogenOrAllergen: 'asbestos',
    }),
    { today: TODAY, affectsYou: false },
  );
  // The one brand line, corrected, on both surfaces — never "dynacare".
  assert.equal(home.brand.text, 'Dynacare');
  assert.equal(model.brand.text, 'Dynacare');
  // The generated sentence opens with the corrected display subject.
  assert.equal(
    model.whatHappened.text,
    'Dynacare recalled Baby Powder because the products may be contaminated with asbestos.',
  );
  // Home/Detail parity for the product name is unaffected by the brand fix.
  assert.equal(home.productName, model.productName);
});

test('P3D named regression (synthetic): the lowercase supplements headline is headline-cased', () => {
  // Synthetic reproduction of the production-observed all-lowercase FDA
  // product description that rendered verbatim as a Home card title.
  const description = 'dietary supplements marketed for male sexual enhancement';
  const item = feedItem({ productDescription: description });
  const home = buildHomeCardModel(item, { today: TODAY, affectsYou: false });
  const model = buildDetailModel(detail({ productDescription: description }), {
    today: TODAY,
    affectsYou: false,
  });
  // Founder contract: every ordinary word capitalized, including "For".
  assert.equal(home.productName, 'Dietary Supplements Marketed For Male Sexual Enhancement');
  assert.equal(model.productName, home.productName);
});

test('P3D: the stylized brand a2 is preserved on the brand line and as sentence subject', () => {
  const overrides = {
    title: 'a2 Platinum USA label infant formula recalled',
    recallingFirm: { displayName: 'The a2 Milk Company', rawVariants: ['The a2 Milk Company'] },
    brands: ['a2'],
    productDescription: 'a2 Platinum Premium Infant Formula',
  };
  const item = feedItem({
    title: overrides.title,
    firmName: overrides.recallingFirm.displayName,
    brands: overrides.brands,
    productDescription: overrides.productDescription,
  });
  const home = buildHomeCardModel(item, { today: TODAY, affectsYou: false });
  const model = buildDetailModel(detail(overrides), { today: TODAY, affectsYou: false });
  // Brand identity wins over sentence-opening convention (P3D founder
  // decision A): never "A2".
  assert.equal(home.brand.text, 'a2');
  assert.equal(model.brand.text, 'a2');
  assert.match(model.whatHappened.text, /^a2 recalled a2 Platinum Premium Infant Formula/);
});

// ── P1B: the Health Risk section ────────────────────────────────────────────

test('the Health Risk section renders the reviewed guide for a recognized hazard', () => {
  const model = buildDetailModel(
    detail({
      hazardCategory: 'microbial_contamination',
      pathogenOrAllergen: 'Listeria monocytogenes',
      reasonText: 'Product Contamination',
    }),
    { today: TODAY, affectsYou: false },
  );
  const section = model.sections.healthRisk;
  assert.ok(section);
  assert.match(section.risk, /Listeria bacteria can cause/);
  // Founder visual QA (2026-09-10): the higher-risk group is folded into the
  // one risk paragraph — the section carries no separate second paragraph.
  assert.match(section.risk, /Pregnant women/);
  assert.equal(section.higherRisk, null);
  assert.ok(section.symptoms && section.symptoms.length > 0);
  // The source link label is model-owned and names the citing agency.
  assert.equal(section.source?.label, 'Learn more from CDC');
  assert.match(section.source?.url ?? '', /^https:\/\/www\.cdc\.gov\//);
});

test('the model passes every full guide’s source URL through unchanged', () => {
  // The section builder must never transform, truncate, or re-derive a
  // source URL — it is copied verbatim from the registry entry the case
  // resolved to. Exercised for every full guide, not just Listeria.
  const evidence: [string, Partial<CaseProjection>][] = [
    [
      'botulism',
      { hazardCategory: 'microbial_contamination', pathogenOrAllergen: 'Clostridium botulinum' },
    ],
    [
      'listeria',
      { hazardCategory: 'microbial_contamination', pathogenOrAllergen: 'Listeria monocytogenes' },
    ],
    ['stec', { hazardCategory: 'microbial_contamination', pathogenOrAllergen: 'E. coli O157:H7' }],
    ['undeclared-allergen', { hazardCategory: 'allergen', pathogenOrAllergen: 'Undeclared milk' }],
    ['salmonella', { hazardCategory: 'microbial_contamination', pathogenOrAllergen: 'Salmonella' }],
    [
      'hepatitis-a',
      { hazardCategory: 'microbial_contamination', pathogenOrAllergen: 'Hepatitis A' },
    ],
    ['cyclospora', { hazardCategory: 'microbial_contamination', pathogenOrAllergen: 'Cyclospora' }],
  ];
  for (const [key, overrides] of evidence) {
    const registryUrl = HAZARD_GUIDES.find((guide) => guide.key === key)?.source.url;
    assert.ok(registryUrl, `no registry entry for ${key}`);
    const section = buildDetailModel(
      detail({ ...overrides, reasonText: 'Product Contamination' }),
      { today: TODAY, affectsYou: false },
    ).sections.healthRisk;
    assert.equal(
      section?.source?.url,
      registryUrl,
      `${key} URL was altered on the way to the model`,
    );
  }
});

test('the same hazard yields the same section on two different recalls', () => {
  const one = buildDetailModel(
    detail({
      id: 'a',
      title: 'Alpha Foods Recalls Salad',
      recallingFirm: { displayName: 'Alpha Foods', rawVariants: ['Alpha Foods'] },
      hazardCategory: 'microbial_contamination',
      pathogenOrAllergen: 'Salmonella',
      reasonText: 'Product Contamination',
    } as Partial<CaseProjection>),
    { today: TODAY, affectsYou: false },
  ).sections.healthRisk;
  const two = buildDetailModel(
    detail({
      title: 'Beta Brands Recalls Snacks',
      recallingFirm: { displayName: 'Beta Brands', rawVariants: ['Beta Brands'] },
      hazardCategory: 'microbial_contamination',
      pathogenOrAllergen: 'Salmonella',
      reasonText: 'Potential Salmonella contamination',
    }),
    { today: TODAY, affectsYou: false },
  ).sections.healthRisk;
  assert.deepEqual(one, two);
});

test('an undeclared allergen gets the allergen guide, named to the allergen', () => {
  const section = buildDetailModel(
    detail({
      hazardCategory: 'allergen',
      pathogenOrAllergen: 'Undeclared milk',
      reasonText: 'Unreported Allergens',
    }),
    { today: TODAY, affectsYou: false },
  ).sections.healthRisk;
  assert.ok(section);
  assert.match(section.risk, /milk allergy/i);
  assert.ok(section.symptoms?.some((symptom) => /hives/i.test(symptom)));
  assert.equal(section.source?.label, 'Learn more from FDA');
  // Founder visual QA (2026-09-10): the section goes straight from the
  // allergen-specific opening sentence to Common Symptoms — no secondary
  // higher-risk paragraph renders in between.
  assert.equal(section.higherRisk, null);
});

test('a hazard with no reviewed guide renders risk only — never invented symptoms', () => {
  // Foreign material has an approved risk sentence but no defensible symptom
  // list. The section appears with the sentence alone, no bullets, no source.
  const foreign = buildDetailModel(
    detail({
      hazardCategory: 'foreign_material',
      reasonText: 'Potential glass contamination',
    }),
    { today: TODAY, affectsYou: false },
  ).sections.healthRisk;
  assert.ok(foreign);
  assert.match(foreign.risk, /Swallowing pieces of glass/);
  assert.equal(foreign.symptoms, null);
  assert.equal(foreign.higherRisk, null);
  assert.equal(foreign.source, null);
});

test('founder visual-QA pass (2026-09-10): foreign-material and metal output are byte-identical', () => {
  // This pass touched only the four consolidated guides (allergen, E. coli,
  // Listeria, Salmonella). The risk-only tier — which foreign material and
  // metal render through — is pinned here to prove it is untouched.
  const glass = buildDetailModel(
    detail({ hazardCategory: 'foreign_material', reasonText: 'Potential glass contamination' }),
    { today: TODAY, affectsYou: false },
  ).sections.healthRisk;
  assert.equal(
    glass?.risk,
    'Swallowing pieces of glass can injure the mouth, throat, or digestive tract.',
  );
  const metal = buildDetailModel(
    detail({ hazardCategory: 'foreign_material', reasonText: 'Potential metal contamination' }),
    { today: TODAY, affectsYou: false },
  ).sections.healthRisk;
  assert.equal(
    metal?.risk,
    'Swallowing pieces of metal can injure the mouth, throat, or digestive tract.',
  );
});

test('an unmapped or regulatory-only hazard omits the whole section', () => {
  for (const overrides of [
    { hazardCategory: 'other_regulatory', reasonText: 'Import Violation' },
    { hazardCategory: 'other_regulatory', reasonText: 'Produced Without Benefit of Inspection' },
    { hazardCategory: 'unknown', reasonText: null },
    { hazardCategory: 'unknown', reasonText: 'Product Contamination' },
  ] as Partial<CaseProjection>[]) {
    const model = buildDetailModel(detail(overrides), { today: TODAY, affectsYou: false });
    assert.equal(
      model.sections.healthRisk,
      null,
      `a health section rendered for ${overrides.reasonText}`,
    );
  }
});

test('a CLOSED recall keeps its Health Risk; a RETRACTED notice suppresses it', () => {
  const hazard: Partial<CaseProjection> = {
    hazardCategory: 'microbial_contamination',
    pathogenOrAllergen: 'Salmonella',
    reasonText: 'Product Contamination',
  };
  // Closed means the agency finished its process, not that the product left
  // anyone's kitchen — a shopper still holding it needs the hazard education.
  const closed = buildDetailModel(detail({ ...hazard, state: 'closed', closedYear: '2025' }), {
    today: TODAY,
    affectsYou: false,
  });
  assert.ok(closed.sections.healthRisk);
  assert.match(closed.sections.healthRisk.risk, /Salmonella/);
  // Retracted means the agency withdrew the claim that this product carries
  // the hazard; standing hazard education beside it would assert a risk the
  // source no longer states.
  const retracted = buildDetailModel(detail({ ...hazard, state: 'retracted' }), {
    today: TODAY,
    affectsYou: false,
  });
  assert.equal(retracted.sections.healthRisk, null);
  assert.equal(retracted.retracted, true);
  // The underlying evidence field is untouched — only the render is suppressed.
  assert.ok(retracted.healthRisk);
});

test('the Health Risk section is a pure function of the section builder', () => {
  const guidance = {
    key: 'salmonella' as const,
    version: 1,
    risk: 'Risk sentence.',
    symptoms: ['One', 'Two'],
    higherRisk: 'Group statement.',
    source: {
      organization: 'CDC' as const,
      url: 'https://www.cdc.gov/x',
      reviewedOn: '2026-09-09',
    },
  };
  assert.deepEqual(healthRiskSection(guidance, 'fallback', { retracted: false }), {
    risk: 'Risk sentence.',
    symptoms: ['One', 'Two'],
    higherRisk: 'Group statement.',
    source: { label: 'Learn more from CDC', url: 'https://www.cdc.gov/x' },
  });
  // A guide always outranks the fallback sentence — never both.
  assert.equal(
    healthRiskSection(guidance, 'fallback', { retracted: false })?.risk,
    'Risk sentence.',
  );
  // Retraction suppresses both tiers.
  assert.equal(healthRiskSection(guidance, 'fallback', { retracted: true }), null);
  assert.equal(healthRiskSection(null, 'fallback', { retracted: true }), null);
  // No guide and no fallback means no section.
  assert.equal(healthRiskSection(null, null, { retracted: false }), null);
});

test('recall-specific illness facts stay out of the standardized hazard content', () => {
  // A notice that REPORTS illnesses renders that fact in What happened; the
  // Health Risk copy is identical to the same hazard with no reported
  // illnesses, so a symptom list can never read as this recall's illnesses.
  const reported = buildDetailModel(
    detail({
      hazardCategory: 'microbial_contamination',
      pathogenOrAllergen: 'Salmonella',
      reasonText: 'Product Contamination',
      summaryText: 'A total of 12 illnesses have been reported in connection with this recall.',
    }),
    { today: TODAY, affectsYou: false },
  );
  const silent = buildDetailModel(
    detail({
      hazardCategory: 'microbial_contamination',
      pathogenOrAllergen: 'Salmonella',
      reasonText: 'Product Contamination',
    }),
    { today: TODAY, affectsYou: false },
  );
  assert.deepEqual(reported.sections.healthRisk, silent.sections.healthRisk);
  assert.ok(reported.illnessLine, 'the reported-illness fact was lost');
  // And the illness fact appears in exactly one place — never inside the guide.
  const section = reported.sections.healthRisk;
  assert.ok(section);
  const guideText = [section.risk, section.higherRisk ?? '', ...(section.symptoms ?? [])].join(' ');
  assert.doesNotMatch(guideText, /reported|illnesses have been|12/i);
});

test('P1B changes presentation only — parser output and canonical records are untouched', () => {
  const source = detail({
    hazardCategory: 'microbial_contamination',
    pathogenOrAllergen: 'Listeria monocytogenes',
    reasonText: 'Product Contamination',
    summaryText: 'Listeria can cause serious illness.',
  });
  const before = JSON.parse(JSON.stringify(source));
  const model = buildDetailModel(source, { today: TODAY, affectsYou: false });
  assert.ok(model.sections.healthRisk);
  // Building the model mutates nothing it was given.
  assert.deepEqual(source, before);
  // Feed ordering inputs and the notification-relevant fields are untouched.
  assert.equal(
    model.activity.text,
    buildDetailModel(source, { today: TODAY, affectsYou: false }).activity.text,
  );
});

// ── P1D: the community shopper-report section ───────────────────────────────

const STATES_GEO = {
  scope: 'states' as const,
  states: ['California', 'Nevada'],
  confidence: 'stated' as const,
  sourceText: 'California and Nevada',
};

function community(overrides: Partial<CaseProjection>) {
  return buildDetailModel(detail(overrides), { today: TODAY, affectsYou: false }).sections
    .communityReports;
}

test('P1D: an active case with official geography can take reports, with its own choices', () => {
  const section = community({
    state: 'active',
    geography: STATES_GEO,
    retailerNames: ['Costco Wholesale'],
  });
  assert.ok(section);
  assert.equal(section.caseId, 'case-1');
  // Exactly the notice's own jurisdictions, as postal codes, and exactly its
  // own retailer evidence — the questionnaire can offer nothing else.
  assert.deepEqual([...section.allowedStateCodes], ['CA', 'NV']);
  assert.deepEqual([...section.retailerChoices], ['Costco Wholesale']);
});

test('P1D: a nationwide case opens every supported jurisdiction; no retailers = no question', () => {
  const section = community({
    state: 'active',
    geography: { scope: 'nationwide', states: [], confidence: 'stated', sourceText: 'Nationwide' },
    retailerNames: [],
  });
  assert.ok(section);
  assert.equal(section.allowedStateCodes.length, 52);
  assert.deepEqual([...section.retailerChoices], []);
});

test('P1D: closed, retracted, and unknown-geography cases get no section at all', () => {
  // Mirrors the server's own eligibility rules, so the app never offers a
  // form whose submission the database would refuse.
  assert.equal(community({ state: 'closed', geography: STATES_GEO }), null);
  assert.equal(community({ state: 'retracted', geography: STATES_GEO }), null);
  assert.equal(
    community({
      state: 'active',
      geography: { scope: 'unknown', states: [], confidence: 'inferred', sourceText: null },
    }),
    null,
  );
});

test('P1D: the community section can never outlive the statement it corroborates', () => {
  // The block is nested under Where it was sold, so the two decisions are
  // coupled in the MODEL rather than by luck in the screen. The coupling is
  // direct: with no host section there is no community section, whatever
  // the case's own eligibility would otherwise say.
  // The coupling is now STRUCTURAL: `DetailSections.whereSold` is not
  // nullable, so a community block cannot outlive its host section by
  // construction rather than by a runtime guard that a caller could skip.
  // Across every geography the corpus produces, a community section still
  // implies a host section — and so does every other case.
  const geographies = [
    STATES_GEO,
    {
      scope: 'nationwide' as const,
      states: [],
      confidence: 'stated' as const,
      sourceText: 'Nationwide',
    },
    { scope: 'unknown' as const, states: [], confidence: 'inferred' as const, sourceText: null },
    { scope: 'states' as const, states: [], confidence: 'stated' as const, sourceText: null },
  ];
  for (const geography of geographies) {
    for (const state of ['active', 'closed', 'retracted'] as const) {
      const built = buildDetailModel(detail({ state, geography }), {
        today: TODAY,
        affectsYou: false,
      });
      if (built.sections.communityReports !== null) {
        assert.ok(
          built.sections.whereSold,
          `community block with no host section: ${state}/${geography.scope}`,
        );
      }
    }
  }
});

test('P1D: the community section changes no official field on the model', () => {
  // Community context is additive: adding the section leaves every official
  // rendering — risk, activity, narrative, geography, products — identical.
  const source = detail({
    state: 'active',
    geography: STATES_GEO,
    retailerNames: ['Costco Wholesale'],
    reasonText: 'Undeclared milk',
    hazardCategory: 'allergen',
  });
  const model = buildDetailModel(source, { today: TODAY, affectsYou: false });
  assert.ok(model.sections.communityReports);
  const { communityReports, ...official } = model.sections;
  assert.deepEqual(official, {
    whereSold: model.sections.whereSold,
    healthRisk: model.sections.healthRisk,
    affectedProducts: model.sections.affectedProducts,
  });
  assert.equal(model.whereSold.lead, 'California and Nevada');
  assert.equal(model.affectsYou, false);
});
