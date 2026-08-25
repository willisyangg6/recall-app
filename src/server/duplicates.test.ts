/**
 * Duplicate real-world-recall detection: the Primavera Nueva slug-collision
 * pair must link deterministically, and a same-titled but genuinely distinct
 * second recall (the JFE cucumber shape — identical headline, different
 * event, low body overlap) must never merge. A false merge is worse than a
 * temporary duplicate, and these tests pin that asymmetry.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { NormalizedSourceRecord } from '../domain/source-record';
import { collisionBaseIdentity } from './fda/parse';
import {
  bodySimilarity,
  declaresExpansion,
  findDuplicateCandidates,
  isExpansionOfSameEvent,
  isSameRecallEvent,
  normalizeFirmName,
  titlesRelate,
} from './duplicates';

const PRIMAVERA_BODY =
  'Sonoma, CA — Primavera Nueva Inc. is voluntarily recalling certain lots of its 4-count tamales because the products have the potential to be contaminated with Listeria monocytogenes. Product was distributed by Primavera Nueva Inc. in California and Nevada to retail stores. The following 4-count tamales, produced between October 10, 2024 and October 10, 2025 are included: Roasted Green Chile & Jack Cheese, Black Bean Bonanza & Jack Cheese. Consumers who have tamales with date codes 10/22 (year 2024) - 10/22 (year 2025) should not consume the product and should discard it.';

function record(overrides: Partial<NormalizedSourceRecord>): NormalizedSourceRecord {
  return {
    sourceSystem: 'fda_announcement',
    sourceAgency: 'FDA',
    nativeId: 'primavera-nueva-inc-issues-voluntary-recall-select-4-count-tamales',
    rawNativeId: '/safety/x',
    noticeType: 'recall',
    lifecycle: 'active',
    closedYear: null,
    classification: { value: 'not_yet_classified', sourceText: null },
    expansionOfNativeId: null,
    isRetractionNotice: false,
    retractsNativeIds: [],
    title:
      'Primavera Nueva Inc. Issues Voluntary Recall of Select 4-Count Tamales Because of Possible Health Risk',
    summaryText: PRIMAVERA_BODY,
    summaryHtml: null,
    reasonText: null,
    hazardCategory: 'microbial_contamination',
    pathogenOrAllergen: 'Listeria monocytogenes',
    firmDisplayName: 'Primavera Nueva Inc.',
    firmRawVariants: ['Primavera Nueva Inc.'],
    brands: [],
    productDescription: null,
    imageUrls: [],
    geography: { scope: 'unknown', states: [], confidence: 'inferred', sourceText: null },
    retailerNames: [],
    heroImageUrl: null,
    productLines: [],
    quantityText: null,
    illnessStatement: null,
    consumerAction: null,
    contactText: null,
    officialUrl: 'https://www.fda.gov/x',
    publishedAt: '2025-12-17',
    lastModifiedAt: null,
    ...overrides,
  };
}

test('a slug collision suffix proposes its base identity — and nothing else does', () => {
  assert.equal(
    collisionBaseIdentity(
      'primavera-nueva-inc-issues-voluntary-recall-select-4-count-tamales-because-possible-health-risk-0',
    ),
    'primavera-nueva-inc-issues-voluntary-recall-select-4-count-tamales-because-possible-health-risk',
  );
  // Ordinary slugs, including ones ending in words or measurements, propose nothing.
  assert.equal(collisionBaseIdentity('rudolphs-onyums-onion-flavored-rings-3-oz'), null);
  assert.equal(
    collisionBaseIdentity('allergy-alert-undeclared-peanut-maggi-2-minute-noodles'),
    null,
  );
  // Short slugs never qualify.
  assert.equal(collisionBaseIdentity('a-recall-3'), null);
});

test('golden Primavera: revised re-publication corroborates as the same recall event', () => {
  const original = record({});
  const revised = record({
    nativeId: `${original.nativeId}-0`,
    title: `${original.title}- Revised to Include Roasted Pumpkin & White Cheddar, a Seasonal Item`,
    summaryText: `${PRIMAVERA_BODY} Roasted Pumpkin & White Cheddar.`,
    publishedAt: '2026-01-07',
  });
  assert.ok(titlesRelate(original.title, revised.title));
  assert.ok(bodySimilarity(original.summaryText, revised.summaryText) > 0.9);
  assert.ok(isSameRecallEvent(revised, original));
});

test('an identical title with a different body never merges (second distinct event)', () => {
  const first = record({});
  const second = record({
    nativeId: `${first.nativeId}-0`,
    publishedAt: '2026-04-20',
    // Same headline, but the announcement describes a different event:
    // different products, different codes, different reason narrative.
    summaryText:
      'Primavera Nueva Inc. announced today a recall of its frozen enchilada verde entrees after a supplier notified the company that a spice blend may contain undeclared peanut protein. Affected lots 88301 through 88377 were shipped to distributors in Arizona and sold between March 2 and April 11, 2026. No illnesses have been reported to date and the company is working with regulators.',
  });
  assert.ok(!isSameRecallEvent(second, first));
});

test('a different firm or hazard never merges, whatever the slugs look like', () => {
  const original = record({});
  assert.ok(
    !isSameRecallEvent(
      record({ nativeId: `${original.nativeId}-0`, firmDisplayName: 'Other Foods LLC' }),
      original,
    ),
  );
  assert.ok(
    !isSameRecallEvent(
      record({ nativeId: `${original.nativeId}-0`, hazardCategory: 'allergen' }),
      original,
    ),
  );
});

test('firm identity ignores legal suffixes and punctuation', () => {
  assert.equal(normalizeFirmName('Primavera Nueva, Inc.'), normalizeFirmName('Primavera Nueva'));
  assert.equal(normalizeFirmName('Acme Foods LLC'), normalizeFirmName('ACME FOODS'));
});

test('candidate classification: deterministic needs the identity signal AND shared content', () => {
  const base = {
    caseId: 'a',
    title:
      'Primavera Nueva Inc. Issues Voluntary Recall of Select 4-Count Tamales Because of Possible Health Risk',
    firm: 'Primavera Nueva Inc.',
    hazardCategory: 'microbial_contamination',
    publishedAt: '2025-12-17',
    sourceIds: ['primavera-nueva-inc-issues-voluntary-recall-select-4-count-tamales-hr'],
    summaryText: PRIMAVERA_BODY,
  };
  const revised = {
    ...base,
    caseId: 'b',
    publishedAt: '2026-01-07',
    sourceIds: ['primavera-nueva-inc-issues-voluntary-recall-select-4-count-tamales-hr-0'],
    summaryText: `${PRIMAVERA_BODY} Roasted Pumpkin & White Cheddar.`,
  };
  const secondEvent = {
    ...base,
    caseId: 'c',
    publishedAt: '2026-04-20',
    sourceIds: ['primavera-nueva-inc-issues-voluntary-recall-select-4-count-tamales-hr-1'],
    summaryText:
      'A completely different announcement describing enchilada verde entrees, undeclared peanut protein from a spice supplier, lots 88301 through 88377 shipped to Arizona distributors only.',
  };
  const verdicts = new Map(
    findDuplicateCandidates([base, revised, secondEvent]).map((candidate) => [
      `${candidate.a.caseId}:${candidate.b.caseId}`,
      candidate.verdict,
    ]),
  );
  assert.equal(verdicts.get('a:b'), 'deterministic');
  // The identity signal without content overlap stays a review item — flagged,
  // never merged.
  assert.equal(verdicts.get('a:c'), 'review');
});

// ── Declared-expansion lineage ──────────────────────────────────────────────

const ERIDANOUS_BASE =
  'Company Announcement ARLINGTON, VA – JULY 24, 2026 – Lidl US is recalling all units of Eridanous Shortbread Cookies with Chocolate Truffle Coating & Apricot Filling 11.6 oz (330 g) box UPC 4056489125839 with foreign language ingredients and nutrition facts panel due to undeclared wheat, soy, milk, and egg allergens. People who have an allergy run the risk of serious or life-threatening allergic reactions. The products were distributed between 07/15/2026 - 07/22/2026 to all Lidl US retail store locations in Delaware, District of Columbia, Georgia, Maryland, New Jersey, New York, North Carolina, Pennsylvania, South Carolina, and Virginia.';
const ERIDANOUS_EXPANSION =
  'Company Announcement ARLINGTON, VA – JULY 31, 2026 – Lidl US is expanding its July 24, 2026 recall of Eridanous Shortbread Cookies to include all units with a foreign language ingredients and nutrition facts panel for the following products: Eridanous Shortbread Cookies with Chocolate Truffle Coating & Apricot Filling - 11.6 oz (330 g) box (UPC 4056489125839) and Eridanous Shortbread Cookies with Apricot Filling and Cocoa Topping with Coconut Sprinkles - 11.6 oz (330 g) box (UPC 4056489125846). People who have an allergy run the risk of serious or life-threatening allergic reactions. The products were distributed between 07/15/2026 - 07/28/2026 to all Lidl US retail store locations in Delaware, District of Columbia, Georgia, Maryland, New Jersey, New York, North Carolina, Pennsylvania, South Carolina, and Virginia.';

test('a declared expansion with shared product identity links to its parent recall', () => {
  const base = record({
    nativeId: 'lidl-us-recalls-eridanous-shortbread-cookies-chocolate-truffle',
    title:
      'Lidl US Recalls Eridanous Shortbread Cookies with Chocolate Truffle Coating & Apricot Filling Due to Undeclared Wheat, Soy, Milk, and Eggs',
    summaryText: ERIDANOUS_BASE,
    firmDisplayName: 'Lidl US',
    hazardCategory: 'allergen',
    publishedAt: '2026-07-28',
  });
  const expansion = record({
    nativeId: 'lidl-us-expands-recall-eridanous-shortbread-cookies',
    title:
      'Lidl US Expands Recall of Eridanous Shortbread Cookies Due to Undeclared Wheat, Soy, Milk, Egg and Tree Nut (Coconut) Allergens',
    summaryText: ERIDANOUS_EXPANSION,
    firmDisplayName: 'Lidl US',
    hazardCategory: 'allergen',
    publishedAt: '2026-07-31',
  });
  assert.ok(declaresExpansion(expansion.title, expansion.summaryText));
  assert.ok(!declaresExpansion(base.title, base.summaryText));
  assert.ok(isExpansionOfSameEvent(expansion, base));
  // Direction matters: the base does not "expand" the expansion.
  assert.ok(!isExpansionOfSameEvent(base, expansion));
});

test('a declared expansion without a linkable id links by product phrase when no UPCs exist', () => {
  const base = record({
    nativeId: 'fayus-inc-recalls-ola-ola-pounded-yam',
    title:
      'Fayus Inc., dba Yusol International Foods Recalls OLA-OLA POUNDED YAM Due to Undeclared Milk Allergen',
    summaryText:
      'Fayus Inc., doing business as Yusol International Foods (Sacramento, CA) is voluntarily recalling OLA-OLA POUNDED YAM because the product may contain undeclared milk in the form of sodium caseinate, which is not declared on the label. The recall is being initiated as a result of an internal investigation discovering that some packaged OLA-OLA POUNDED YAM had been distributed in packaging that did not disclose the presence of sodium caseinate derived from milk. OLA-OLA POUNDED YAM was distributed through distribution outlets between December 2025 – May 2026 in Canada, Australia and the following United States: California Georgia Illinois New Jersey New York Texas. Consumers who have purchased the product are urged to return it to the place of purchase.',
    firmDisplayName: 'Fayus, Inc.',
    hazardCategory: 'allergen',
    publishedAt: '2026-07-07',
  });
  const expansion = record({
    nativeId: 'fayus-inc-expands-recall-ola-ola-pounded-yam',
    title:
      'Fayus Inc., dba Yusol International Foods Expands Recall of OLA-OLA POUNDED YAM Due to Undeclared Milk Allergen',
    summaryText:
      'Fayus Inc., doing business as Yusol International Foods (Sacramento, CA) is expanding its recall of OLA-OLA POUNDED YAM to include product sizes 2lbs, 4lbs, 5lbs, and 10lbs due to product labeling omission of an undeclared milk allergen for sodium caseinate, a milk derivative. The recall was initiated, and later expanded, as a result of an internal investigation discovering that some packaged OLA-OLA POUNDED YAM had been distributed in packaging that did not disclose the presence of sodium caseinate derived from milk. OLA-OLA POUNDED YAM was distributed through distribution outlets in the African and Caribbean markets between December 2025 – May 2026 in Canada, Australia and the following United States: California Georgia Illinois New Jersey New York Texas. Consumers who have purchased the product are urged to return it to the place of purchase.',
    firmDisplayName: 'Fayus, Inc.',
    hazardCategory: 'allergen',
    publishedAt: '2026-07-17',
  });
  assert.ok(isExpansionOfSameEvent(expansion, base));
});

test('expansion language alone never links: product identity is required', () => {
  const base = record({
    nativeId: 'acme-recalls-peanut-butter',
    title: 'Acme Foods Recalls Crunchy Peanut Butter Due to Salmonella',
    summaryText:
      'Acme Foods is recalling Crunchy Peanut Butter 16 oz jars with UPC 111111111111 sold in retail stores nationwide because the product may be contaminated with Salmonella.',
    firmDisplayName: 'Acme Foods',
    hazardCategory: 'microbial_contamination',
    publishedAt: '2026-07-01',
  });
  const unrelatedExpansion = record({
    nativeId: 'acme-expands-recall-granola-bars',
    title: 'Acme Foods Expands Recall of Granola Bars Due to Possible Salmonella',
    summaryText:
      'Acme Foods is expanding its recall of Granola Bars to include additional lots with UPC 222222222222 after further testing. The granola bars were sold in club stores.',
    firmDisplayName: 'Acme Foods',
    hazardCategory: 'microbial_contamination',
    publishedAt: '2026-07-10',
  });
  assert.ok(!isExpansionOfSameEvent(unrelatedExpansion, base));
});

test('FSIS records never link by expansion wording — recall numbers are authoritative', () => {
  const base = record({
    sourceSystem: 'fsis_api',
    sourceAgency: 'FSIS',
    nativeId: '010-2026',
    title: 'Acme Meats Recalls Ground Beef Products',
    summaryText: 'Acme Meats is recalling ground beef products with UPC 333333333333.',
    firmDisplayName: 'Acme Meats',
    hazardCategory: 'microbial_contamination',
    publishedAt: '2026-07-01',
  });
  const expansion = record({
    sourceSystem: 'fsis_api',
    sourceAgency: 'FSIS',
    nativeId: '011-2026',
    title: 'Acme Meats Expands Recall of Ground Beef Products',
    summaryText:
      'Acme Meats is expanding its recall of ground beef products with UPC 333333333333 to include additional production dates.',
    firmDisplayName: 'Acme Meats',
    hazardCategory: 'microbial_contamination',
    publishedAt: '2026-07-08',
  });
  assert.ok(!isExpansionOfSameEvent(expansion, base));
});

test('candidate classification: a declared-expansion pair is deterministic, with the evidence named', () => {
  const base = {
    caseId: 'base',
    title:
      'Khong Guan Corporation Issues Recall of Glutinous Rice Balls With Black Sesame Filling Due to Undeclared Peanuts',
    firm: 'Khong Guan Corporation',
    hazardCategory: 'allergen',
    publishedAt: '2026-07-16',
    sourceIds: ['khong-guan-corporation-issues-recall-glutinous-rice-balls'],
    summaryText:
      'The press release has been updated on 7/16/2026 reflecting removal of specific customer names. Khong Guan Corporation is recalling specific lots of Glutinous Rice Balls with Black Sesame Filling because they may contain undeclared peanuts. Product Details: Product: Glutinous Rice Balls with Black Sesame Filling Size/Packaging: 14.1 oz bag UPC: 6-908791-000053 Date Code: 10/19/2027 Distribution: AZ, CA, CO, HI, NJ, NV, OR, TX, WA – online and retail stores.',
    agency: 'FDA',
  };
  const expansion = {
    caseId: 'expansion',
    title:
      'Khong Guan Corporation Issues Expanded Recall of Glutinous Rice Balls With Black Sesame Filling to Include Black & White Glutinous Rice Balls With Black Sesame Filling Due to Undeclared Peanuts',
    firm: 'Khong Guan Corporation',
    hazardCategory: 'allergen',
    publishedAt: '2026-07-15',
    sourceIds: ['khong-guan-corporation-issues-expanded-recall-glutinous-rice-balls'],
    summaryText:
      'Khong Guan Corporation (Union City, CA) is recalling specific lots of Glutinous Rice Balls with Black Sesame Filling and Black & White Glutinous Rice Balls with Black Sesame Filling in their recall expansion because they may contain undeclared peanuts. Product Details: (1) Glutinous Rice Balls with Black Sesame Filling; UPC 6908791000053; Date Codes 9/22/2027 and 10/19/2027 (2) Black & White Glutinous Rice balls With Black Sesame Filling; UPC 6908791000084 Size/Packaging: 14.1 oz flexible plastic bag (same for both) Distribution: AZ, CA, CO, HI, NJ, NV, OR, TX, WA – online and retail stores.',
    agency: 'FDA',
  };
  const candidates = findDuplicateCandidates([base, expansion]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].verdict, 'deterministic');
  assert.ok(candidates[0].signals.includes('expansion-language'));
  assert.ok(candidates[0].signals.includes('upc-overlap'));
});
