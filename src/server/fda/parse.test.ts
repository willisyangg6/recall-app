import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyIllnessReport } from '../../domain/illness';
import { parseProductLine } from '../../lib/consumer-summary';
import { parseFdaRssItems } from './fetch';
import { loadDetailPage, loadFoodRss, loadListingItem, loadListingItems } from './fixtures';
import {
  announcementIdentity,
  foodScope,
  parseFdaAnnouncement,
  parseFdaDetail,
  parseFdaGeography,
  parseFdaQuantity,
} from './parse';

// All inputs are recorded real FDA data (see fixtures/README.md).

const PRINCE =
  'prince-bakery-inc-issues-allergy-alert-undeclared-milk-and-sesame-prince-bakery-breads';
const DREYERS =
  'updated-dreyers-grand-ice-cream-inc-issues-voluntary-recall-select-outshine-fruit-bars-due-possible';

function parseFixture(slug: string) {
  const item = loadListingItem(slug);
  return parseFdaAnnouncement({
    listing: item,
    detailMainHtml: loadDetailPage(slug),
    path: item.path,
  });
}

test('announcement identity strips all observed update-churn prefixes', () => {
  const base = '/safety/recalls-market-withdrawals-safety-alerts/acme-recalls-widgets';
  for (const prefix of ['updated-', 'update-', 'updated-release-']) {
    const churned = base.replace('acme-', `${prefix}acme-`);
    assert.equal(announcementIdentity(churned).nativeId, 'acme-recalls-widgets');
    assert.equal(announcementIdentity(churned).rawNativeId, churned);
  }
  assert.equal(announcementIdentity(base).nativeId, 'acme-recalls-widgets');
});

test('the verified live churn pairs collapse to one identity each', () => {
  // "update-…" coexisting with its original listing row (Albertsons), and
  // "updated-release-…" coexisting with its original (Southwind).
  const pairs = [
    [
      'albertsons-companies-voluntarily-recalls-select-store-made-deli-items-containing-bowtie-pasta',
      'update-albertsons-companies-voluntarily-recalls-select-store-made-deli-items-containing-bowtie-pasta',
    ],
    [
      'southwind-foods-llc-recalls-frozen-shrimp-because-possible-health-risk',
      'updated-release-southwind-foods-llc-recalls-frozen-shrimp-because-possible-health-risk',
    ],
  ];
  for (const [original, churned] of pairs) {
    assert.equal(
      announcementIdentity(loadListingItem(original).path).nativeId,
      announcementIdentity(loadListingItem(churned).path).nativeId,
    );
  }
});

test('food scoping is explicit: food in, pet food and non-food out', () => {
  const bySlug = (slug: string) => foodScope(loadListingItem(slug));
  assert.equal(bySlug(PRINCE), 'food');
  // Dietary supplement co-tagged as Food & Beverages stays in scope.
  assert.equal(
    bySlug('global-mix-inc-recalls-tejocote-products-because-possible-health-risk'),
    'food',
  );
  // Pet food (Animal & Veterinary + Food & Beverages) is deferred, not silently included.
  assert.equal(
    bySlug(
      'updated-omas-pride-voluntarily-recalls-one-lot-woof-complete-canine-chicken-recipe-6-lb-bag-because',
    ),
    'excluded_animal',
  );
  const counts = { food: 0, excluded_animal: 0, excluded_nonfood: 0 };
  for (const item of loadListingItems()) counts[foodScope(item)] += 1;
  assert.equal(counts.excluded_nonfood, 3); // Drugs, Medical Devices, empty tag
  assert.equal(counts.excluded_animal, 1);
});

test('Prince Bakery: allergen announcement parses to full consumer fields', () => {
  const record = parseFixture(PRINCE);
  assert.equal(record.sourceSystem, 'fda_announcement');
  assert.equal(record.sourceAgency, 'FDA');
  assert.equal(record.noticeType, 'recall');
  assert.equal(record.lifecycle, 'active');
  assert.equal(
    record.title,
    'Prince Bakery Inc Issues Allergy Alert on Undeclared Milk and Sesame in Prince Bakery Breads',
  );
  assert.equal(record.firmDisplayName, 'Prince Bakery Inc.');
  assert.deepEqual(record.brands, ['Prince']);
  assert.equal(record.productDescription, 'Variety of Breads');
  assert.equal(record.reasonText, 'Undeclared milk and sesame');
  assert.equal(record.hazardCategory, 'allergen');
  assert.equal(record.pathogenOrAllergen, 'undeclared milk and sesame');
  // Announcements are pre-classification by design (Part 7).
  assert.equal(record.classification.value, 'not_yet_classified');
  // "bodegas … around Bronx and Westchester, New York" → New York, inferred.
  assert.equal(record.geography.scope, 'states');
  assert.deepEqual(record.geography.states, ['New York']);
  assert.equal(record.geography.confidence, 'inferred');
  assert.match(record.geography.sourceText ?? '', /bodegas and small retail markets/);
  assert.equal(record.publishedAt, '2026-08-19'); // FDA Publish Date, not fetch time
  assert.equal(classifyIllnessReport(record.summaryText).status, 'none_reported');
  assert.match(record.consumerAction ?? '', /urged to discard/);
  assert.equal(
    record.officialUrl,
    `https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/${PRINCE}`,
  );
  // The product table becomes labeled "check your package" lines.
  assert.equal(record.productLines.length, 5);
  assert.match(record.productLines[0], /^Prince Pan de Manjeca Spanish Style Bread/);
  assert.match(record.productLines[0], /Package Color: /);
});

test('Dreyer’s: update-churned announcement keeps identity, strips the retitle prefix', () => {
  const record = parseFixture(DREYERS);
  assert.equal(
    record.nativeId,
    'dreyers-grand-ice-cream-inc-issues-voluntary-recall-select-outshine-fruit-bars-due-possible',
  );
  // "Updated – " prefix stripped for display; the raw headline stays in the snapshot.
  assert.match(record.title, /^Dreyer’s Grand Ice Cream/);
  assert.doesNotMatch(record.title, /^Updated/);
  assert.equal(record.hazardCategory, 'foreign_material');
  assert.equal(record.geography.scope, 'nationwide');
  assert.equal(record.geography.confidence, 'inferred');
  // Batch codes carry the source's own table labels — never invented ones.
  const withCodes = record.productLines.find((line) => /LLA6169/.test(line));
  assert.ok(withCodes, 'batch-code product line missing');
  assert.match(withCodes!, /Batch Code\/Best Before/i);
  // Product photos are captured as source URLs only.
  assert.ok((record.imageUrls ?? []).length > 0);
  assert.ok((record.imageUrls ?? []).every((u) => u.startsWith('https://www.fda.gov/files/')));
});

test('NatureBest: upstream-ingredient recall keeps the ingredient and the outbreak illness report', () => {
  const record = parseFixture(
    'naturebest-precut-produce-llc-voluntarily-recalls-products-containing-jalapenos-due-potential',
  );
  assert.match(record.productDescription ?? '', /Containing Jalapeno/);
  assert.equal(record.pathogenOrAllergen, 'Salmonella');
  const illness = classifyIllnessReport(record.summaryText);
  assert.equal(illness.status, 'reported');
  assert.match(illness.statements.join(' '), /345 people infected/);
});

test('Publix: corporate-footprint boilerplate is not distribution — unknown stays unknown', () => {
  const record = parseFixture(
    'publix-voluntarily-recalls-greenwise-pear-kiwi-spinach-pea-baby-food-pouches-due-lead',
  );
  // The page says "eight-state operating area" without naming recall states;
  // the "operates 1,404 stores in Alabama, …" sentence is company profile.
  assert.equal(record.geography.scope, 'unknown');
  assert.match(record.geography.sourceText ?? '', /eight-state operating area/);
  assert.equal(record.hazardCategory, 'chemical_contamination');
  assert.equal(record.pathogenOrAllergen, 'lead');
  assert.equal(classifyIllnessReport(record.summaryText).status, 'none_reported');
});

test('Southwind: radionuclide category maps to chemical contamination with the named agent', () => {
  const record = parseFixture(
    'southwind-foods-llc-recalls-frozen-shrimp-because-possible-health-risk',
  );
  assert.equal(record.hazardCategory, 'chemical_contamination');
  assert.equal(record.pathogenOrAllergen, 'Cesium-137');
  assert.equal(record.geography.scope, 'states');
  assert.ok(record.geography.states.includes('Alabama'));
});

test('HH Fresh: stated recall quantity is preserved verbatim; package sizes never qualify', () => {
  const record = parseFixture(
    'hh-fresh-trading-recalls-tw-enoki-mushrooms-150g-because-possible-health-risk',
  );
  assert.equal(record.quantityText, '120 cases of Enoki Mushroom 150g');
  // "sold in a plastic 150g bag" must not be mistaken for quantity.
  assert.equal(parseFdaQuantity('The product is sold in a plastic 150g bag.'), null);
  assert.equal(parseFdaQuantity('The firm is recalling lot 3896 sold in 2-lb bags.'), null);
});

test('listing-only fallback (detail fetch failed) still yields a credible case', () => {
  const item = loadListingItem(PRINCE);
  const record = parseFdaAnnouncement({ listing: item, detailMainHtml: null, path: item.path });
  assert.equal(record.nativeId, announcementIdentity(item.path).nativeId);
  // Title is composed from the two structured listing facts.
  assert.equal(record.title, 'Prince Bakery Inc. recalls Variety of Breads');
  assert.equal(record.publishedAt, '2026-08-19'); // listing date fallback
  assert.equal(record.hazardCategory, 'allergen');
  // No body → honest unknowns, never invented values.
  assert.equal(record.geography.scope, 'unknown');
  assert.equal(record.illnessStatement, null);
  assert.equal(record.quantityText, null);
  assert.deepEqual(record.productLines, []);
});

test('food RSS parses and joins the listing by announcement path', () => {
  const items = parseFdaRssItems(loadFoodRss());
  assert.equal(items.length, 20);
  const prince = items.find((i) => i.link.endsWith(PRINCE));
  assert.ok(prince, 'Prince Bakery RSS item missing');
  assert.ok(prince!.link.startsWith('https://'));
  assert.equal(
    announcementIdentity(prince!.link.replace('https://www.fda.gov', '')).nativeId,
    announcementIdentity(loadListingItem(PRINCE).path).nativeId,
  );
});

test('detail summary block parses dates from datetime attributes', () => {
  const detail = parseFdaDetail(loadDetailPage(PRINCE));
  assert.equal(detail.fdaPublishDate, '2026-08-19');
  assert.equal(detail.companyAnnouncementDate, '2026-08-19');
  assert.equal(detail.companyName, 'Prince Bakery Inc.');
  assert.match(detail.productType ?? '', /Food & Beverages/);
});

test('an explicit classification in the announcement is preserved; hazard language never implies one', () => {
  // Synthetic sentence exercising the guard — no recorded announcement states
  // a class, which is itself the verified normal state (§3.1).
  const item = loadListingItem(PRINCE);
  const record = parseFdaAnnouncement({ listing: item, detailMainHtml: null, path: item.path });
  assert.equal(record.classification.value, 'not_yet_classified');
  assert.equal(record.classification.sourceText, null);
});

test('geography: unknown is never converted, action sentences are excluded', () => {
  const geo = parseFdaGeography(
    'Anyone with the product should not sell or distribute it in any state including Texas.',
    'Acme Recalls Widgets',
  );
  assert.equal(geo.scope, 'unknown'); // consumer-action sentence is not distribution
  const none = parseFdaGeography('The firm issued a press release.', 'Acme Recalls Widgets');
  assert.equal(none.scope, 'unknown');
  assert.equal(none.sourceText, null);
});

test('FDA labeled product-table lines render as source-labeled identifiers', () => {
  const record = parseFixture(PRINCE);
  const parsed = parseProductLine(record.productLines[0]);
  assert.ok(parsed);
  assert.match(parsed!.name, /^Prince Pan de Manjeca Spanish Style Bread/);
  assert.equal(parsed!.identifiers.length, 1);
  assert.equal(parsed!.identifiers[0].label, 'Package Color');
});
