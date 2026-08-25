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
  declaresRevision,
  findDuplicateCandidates,
  isExpansionOfSameEvent,
  isRevisionOfSameEvent,
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

// ── Declared revisions (retitled corrections) ───────────────────────────────
// Live shape, verified 2026-08-25: FDA republished the Momchipz announcement
// under a fresh slug ("…due-undeclared-gluten" → "…due-undeclared-wheat")
// because the correction changed the title; the new body opens with an
// editorial note declaring the update, and the old URL 301-redirects to the
// new one. The old mechanisms missed it: no slug suffix, no expansion
// wording — which produced a second case and a second initial notification.

const MOMCHIPZ_GLUTEN_BODY =
  'August 14, 2026, Exotique Foods Inc in Ontario , Canada is recalling Momchipz Veggie Chips Broccoli Florets & Cauliflower because it may contain undeclared gluten. People who have an allergy or severe sensitivity to gluten run the risk of serious or life-threatening allergic reaction if they consume this product. The Momchipz Veggie Chips Broccoli Florets & Cauliflower was sold to 49 U.S. customers through Amazon.com between March 2026 and June 2026 Product information as follows: Brand: Momchipz Product: Veggie Chips – Broccoli Florets & Cauliflower Size: 3oz (85 g) UPC: 6 28634 44216 6 Best Before: 2026 AUGUST 31 No illnesses have been reported to date. This recall was initiated based on a retail sample result provided by the Canadian Food Inspection Agency. Consumers who have purchased this product and have an allergy or severe sensitivity to gluten are urged to not consume the product and should discard or return product to the place of purchase for a full refund. Consumers with questions may call the company at 1-647-528-7080 from Monday-Thursday, 9 AM to 12 PM EST. The recall is being made with the knowledge of the U.S. Food and Drug Administration.';

const MOMCHIPZ_WHEAT_BODY =
  '“On 8/24/2026, the recalling firm updated their press release to correctly identify wheat, rather than gluten, as the allergen.” ' +
  MOMCHIPZ_GLUTEN_BODY.replace(/gluten/g, 'wheat');

function momchipzGluten(): NormalizedSourceRecord {
  return record({
    nativeId:
      'exotique-foods-inc-recalls-momchipz-veggie-chips-broccoli-florets-cauliflower-due-undeclared-gluten',
    title:
      'Exotique Foods Inc Recalls Momchipz Veggie Chips Broccoli Florets & Cauliflower Due to Undeclared Gluten',
    summaryText: MOMCHIPZ_GLUTEN_BODY,
    firmDisplayName: 'Exotique Foods Inc',
    hazardCategory: 'allergen',
    pathogenOrAllergen: 'undeclared gluten',
    publishedAt: '2026-08-19',
  });
}

function momchipzWheat(): NormalizedSourceRecord {
  return record({
    nativeId:
      'exotique-foods-inc-recalls-momchipz-veggie-chips-broccoli-florets-cauliflower-due-undeclared-wheat',
    title:
      'Exotique Foods Inc Recalls Momchipz Veggie Chips Broccoli Florets & Cauliflower Due to Undeclared Wheat',
    summaryText: MOMCHIPZ_WHEAT_BODY,
    firmDisplayName: 'Exotique Foods Inc',
    hazardCategory: 'allergen',
    pathogenOrAllergen: 'undeclared wheat',
    publishedAt: '2026-08-24',
  });
}

test('golden Momchipz: a retitled correction links as a declared revision', () => {
  const gluten = momchipzGluten();
  const wheat = momchipzWheat();
  assert.ok(declaresRevision(wheat.summaryText));
  assert.ok(!declaresRevision(gluten.summaryText));
  // The revision wording is not expansion wording; only the new gate links it.
  assert.ok(!declaresExpansion(wheat.title, wheat.summaryText));
  assert.ok(isRevisionOfSameEvent(wheat, gluten));
  // Direction matters: the original does not "revise" its own correction.
  assert.ok(!isRevisionOfSameEvent(gluten, wheat));
});

test('every observed FDA revision-note phrasing is detected in the body opening', () => {
  const phrasings = [
    '“Press release was updated on August 18, 2026, to identify the ingredient supplier.” The Hampton Grocer, Inc. is recalling…',
    'This press release was updated on November 19, 2025; it replaces an earlier version issued on November 11, 2025.',
    '“The press release has been updated to reflect the removal of products that were not available to customers.”',
    '“This press release is an update to the company’s press release, previously issued on 07/25/2025, to include corrected product codes.”',
    'An earlier version of this press release was issued on 7/10/25. This press release was updated to include six additional lots.',
    'A previous press release was issued 08/19/2024. This updated press release includes information on the addition of Gutierrez brand ground cinnamon.',
  ];
  for (const opening of phrasings) {
    assert.ok(declaresRevision(opening), opening);
  }
});

test('the old page’s "Link to Updated Press Release" navigation link is not a revision note', () => {
  // The phrase lacks the declarative shape entirely…
  assert.ok(!declaresRevision('Link to Updated Press Release Company Contact Information'));
  // …and on real old pages it also sits far past the opening window.
  const oldPage = `${MOMCHIPZ_GLUTEN_BODY} Link to Updated Press Release Company Contact Information`;
  assert.ok(!declaresRevision(oldPage));
});

test('revision note alone never links: a shared barcode and near-copy body are required', () => {
  const gluten = momchipzGluten();
  // Same firm, hazard, and window, note present — but no barcode overlap.
  const noSharedUpc = momchipzWheat();
  noSharedUpc.summaryText = MOMCHIPZ_WHEAT_BODY.replace('6 28634 44216 6', '9 99999 99999 9');
  assert.ok(!isRevisionOfSameEvent(noSharedUpc, gluten));
  // Shared barcode but a genuinely different announcement (a second event
  // whose page happens to open with a note): body overlap below the
  // near-copy floor never links.
  const differentEvent = momchipzWheat();
  differentEvent.summaryText =
    '“This press release was updated to include additional retail distribution details.” Exotique Foods Inc is announcing a voluntary recall of Momchipz Sweet Potato Crisps after routine internal testing identified the potential presence of foreign material in select bags. The affected crisps carry UPC 6 28634 44216 6 and were shipped to distributors in the northeastern United States during July 2026. Retailers have been instructed to remove the product from shelves immediately, and the company has suspended the production line involved while equipment inspections are completed.';
  assert.ok(bodySimilarity(differentEvent.summaryText, gluten.summaryText) < 0.8);
  assert.ok(!isRevisionOfSameEvent(differentEvent, gluten));
});

test('FSIS records never link by revision wording — recall numbers are authoritative', () => {
  const gluten = momchipzGluten();
  const wheat = momchipzWheat();
  gluten.sourceSystem = 'fsis_api';
  gluten.sourceAgency = 'FSIS';
  wheat.sourceSystem = 'fsis_api';
  wheat.sourceAgency = 'FSIS';
  assert.ok(!isRevisionOfSameEvent(wheat, gluten));
});

test('candidate classification: a declared-revision pair is deterministic, with the evidence named', () => {
  const gluten = {
    caseId: 'gluten-case',
    title:
      'Exotique Foods Inc Recalls Momchipz Veggie Chips Broccoli Florets & Cauliflower Due to Undeclared Gluten',
    firm: 'Exotique Foods Inc',
    hazardCategory: 'allergen',
    publishedAt: '2026-08-19',
    sourceIds: [
      'exotique-foods-inc-recalls-momchipz-veggie-chips-broccoli-florets-cauliflower-due-undeclared-gluten',
    ],
    summaryText: MOMCHIPZ_GLUTEN_BODY,
    agency: 'FDA',
  };
  const wheat = {
    caseId: 'wheat-case',
    title:
      'Exotique Foods Inc Recalls Momchipz Veggie Chips Broccoli Florets & Cauliflower Due to Undeclared Wheat',
    firm: 'Exotique Foods Inc',
    hazardCategory: 'allergen',
    publishedAt: '2026-08-24',
    sourceIds: [
      'exotique-foods-inc-recalls-momchipz-veggie-chips-broccoli-florets-cauliflower-due-undeclared-wheat',
    ],
    summaryText: MOMCHIPZ_WHEAT_BODY,
    agency: 'FDA',
  };
  const candidates = findDuplicateCandidates([gluten, wheat]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].verdict, 'deterministic');
  assert.ok(candidates[0].signals.includes('revision-language'));
  assert.ok(candidates[0].signals.includes('upc-overlap'));
  assert.ok(candidates[0].signals.some((s) => s.startsWith('revision-body')));
  // Neither of the old identity signals applies — this is the third mechanism.
  assert.ok(!candidates[0].signals.includes('slug-collision'));
  assert.ok(!candidates[0].signals.includes('expansion-language'));
});
