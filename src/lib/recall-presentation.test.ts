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

import { classifyIllnessReport } from '@/domain/illness';
import type { CaseProjection, TimelineEntry } from '@/domain/recall-types';
import type { CaseDetail, FeedItem } from './recall-feed';
import {
  activityDisplay,
  AFFECTED_PRODUCTS_INITIAL_ROWS,
  affectedProductsModel,
  affectedProductsTable,
  buildDetailModel,
  caseIdentity,
  buildHomeCardModel,
  cleanProductName,
  conciseReasonLine,
  displayBrand,
  formatActivityDate,
  homeLocationSummary,
  illnessLine,
  officialSourceLink,
  stripTrailingMeasurement,
  whereSoldModel,
} from './recall-presentation';
import { buildConsumerCase, type ConsumerPackageCheck } from './consumer-projection';
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
    }),
    'Potential Salmonella contamination.',
  );
  assert.equal(
    conciseReasonLine({
      reasonText: null,
      hazardCategory: 'microbial_contamination',
      pathogenOrAllergen: 'Listeria monocytogenes',
    }),
    'Potential Listeria contamination.',
  );
  assert.equal(
    conciseReasonLine({
      reasonText: null,
      hazardCategory: 'microbial_contamination',
      pathogenOrAllergen: 'E. coli O157:H7',
    }),
    'Potential E. coli contamination.',
  );
  // An unlisted agent is preserved verbatim, never shortened by guesswork.
  assert.equal(
    conciseReasonLine({
      reasonText: null,
      hazardCategory: 'microbial_contamination',
      pathogenOrAllergen: 'Clostridium botulinum',
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
    }),
    'Undeclared milk allergen.',
  );
  assert.equal(
    conciseReasonLine({
      reasonText: null,
      hazardCategory: 'allergen',
      pathogenOrAllergen: 'undeclared milk and soy',
    }),
    'Undeclared milk and soy allergens.',
  );
  // Non-major sensitivity triggers read plainly, without the allergen suffix.
  assert.equal(
    conciseReasonLine({
      reasonText: null,
      hazardCategory: 'allergen',
      pathogenOrAllergen: 'undeclared gluten',
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
    }),
    'Mislabeled product.',
  );
  assert.equal(
    conciseReasonLine({
      reasonText: 'Produced without benefit of inspection',
      hazardCategory: 'other_regulatory',
      pathogenOrAllergen: null,
    }),
    'Produced without required inspection.',
  );
  assert.equal(
    conciseReasonLine({
      reasonText: 'Product may contain pieces of metal',
      hazardCategory: 'foreign_material',
      pathogenOrAllergen: null,
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
    }),
    'Elevated Levels of Lead.',
  );
  assert.equal(
    conciseReasonLine({ reasonText: null, hazardCategory: 'unknown', pathogenOrAllergen: null }),
    null,
  );
  // The infant-formula nutrition family keeps a concise line rather than
  // being omitted for length (recorded Moor Herbs / Sammy's Milk shapes).
  assert.equal(
    conciseReasonLine({
      reasonText: 'Product does not provide sufficient nutrition when used as an infant formula',
      hazardCategory: 'unknown',
      pathogenOrAllergen: null,
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
  assert.equal(model.quantityLine, 'The recall covers 120 cases of Enoki Mushroom 150g.');
  // A stored span carrying a clipped reason tail keeps its complete quantity
  // (amount, unit, product) and drops only the non-quantity clause — the
  // mid-word artifact ("…of the Fo.") can never render.
  const clipped = buildDetailModel(
    detail({
      quantityText: '1,506 boxes of Goat Milk Formula Recipe Kit on the recommendation of the Fo',
    }),
    { today: TODAY, affectsYou: false },
  );
  assert.equal(
    clipped.quantityLine,
    'The recall covers 1,506 boxes of Goat Milk Formula Recipe Kit.',
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
    '251661, 2524061, and 251672',
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
    ...(middlefield.caseCodes?.codes ?? []),
    ...(middlefield.productionCodes?.codes ?? []),
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

test('Home and Detail render the same risk state: pending, unrated, and rated', () => {
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
  // One shared "Risk pending" on both surfaces, explained exactly once: the
  // top-level note carries it and the duplicate official block is gone.
  assert.equal(home.risk.badgeLabel, 'Risk pending');
  assert.equal(detailModel.risk.headlineLabel, 'Risk pending');
  assert.equal(home.risk.badgeLabel, detailModel.risk.headlineLabel);
  assert.ok(detailModel.risk.note);
  assert.equal(detailModel.risk.official, null);

  // A PHA reads "Not rated" — never Unknown — while its notice label stays a
  // separate concept on both screens.
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
  assert.equal(phaHome.risk.badgeLabel, 'Not rated');
  assert.equal(phaDetail.risk.headlineLabel, 'Not rated');
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
  // A TITLE-derived name keeps the strict line-evidence gate.
  assert.equal(
    cleanProductName({
      title: 'Acme Recalls Enoki Mushroom 150g',
      productDescription: null,
      displayedBrands: [],
      packageEvidence: [],
    }),
    'Enoki Mushroom 150g',
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
  // Two rows need no reveal control, and the two views are identical.
  assert.equal(table!.seeAllLabel, null);
  assert.equal(table!.initialRows, 2);
  assert.deepEqual(table!.collapsed, table!.expanded);
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
  assert.equal(table!.seeAllLabel, 'See all (5)');
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
  assert.deepEqual(Object.keys(table!), ['collapsed', 'expanded', 'initialRows', 'seeAllLabel']);
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
  assert.equal(table!.seeAllLabel, 'See all (4)');
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
    cells.map((cell) => cell.codesLabel),
    [null, null, null, 'View 6 codes'],
  );
  assert.deepEqual(cells[3].codes, codeSet);
  assert.ok(cells.slice(0, 3).every((cell) => cell.text === null && cell.codes === null));
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
    }),
    'Potential foreign material contamination.',
  );
});
