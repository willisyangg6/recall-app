/**
 * Category cannot reach anything a consumer's safety depends on (C10A/C10B).
 *
 * The shipped classifier is 87.5% exact-set on its final holdout. That is
 * accepted for discovery and would NOT be acceptable for deciding whether
 * someone gets an allergen alert, so the separation has to be structural
 * rather than a promise — and the lower the accuracy, the more load these
 * tests carry. Each one attaches categories to the very objects a decision
 * path consumes and requires the decision to be byte-identical.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FOOD_CATEGORY_IDS, type FoodCategoryId } from '@/domain/food-category';
import { consumerRiskTier } from '@/domain/risk-tier';
import { detectChanges } from '@/domain/material-change';
import { projectCase } from '@/domain/projection';
import type { CaseProjection } from '@/domain/recall-types';
import type { NormalizedSourceRecord } from '@/domain/source-record';
import type { UserRecallPreferences } from '@/domain/preferences';
import { buildAffectsMeSections } from './affects-me-ranking';
import { buildFeedSections } from './feed-relevance';
import { evaluatePersonalRelevance } from './relevance';
import { makeCorpus } from './feed-fixtures';
import type { FeedItem } from './recall-feed';
import { formatPushContent } from '../server/push/format';
import type { DeliverableEvent } from '../server/push/types';

const PROFILE: UserRecallPreferences = {
  state: 'CA',
  allergens: ['sesame', 'peanut'],
  retailers: ['costco', 'trader-joes'],
};

const NOW = new Date('2026-08-30T00:00:00.000Z');
const CORPUS: FeedItem[] = makeCorpus(24);

/** The same items, each carrying a (deliberately arbitrary) category set. */
function withCategories(items: FeedItem[]): FeedItem[] {
  return items.map((item, index) => ({
    ...item,
    ...({
      productCategories: [FOOD_CATEGORY_IDS[index % FOOD_CATEGORY_IDS.length]],
    } as unknown as Record<string, never>),
  }));
}

const relevanceOf = (item: FeedItem) =>
  evaluatePersonalRelevance(
    {
      geography: item.geography,
      pathogenOrAllergen: item.pathogenOrAllergen,
      retailerNames: item.retailerNames,
      hazardCategory: item.hazardCategory,
      reasonText: item.reasonText,
    },
    PROFILE,
  );

const ids = (list: readonly { id: string }[]): string => list.map((i) => i.id).join(',');

function baseProjection(): CaseProjection {
  const record = {
    sourceSystem: 'fda_announcement',
    sourceAgency: 'FDA',
    noticeType: 'recall',
    nativeId: 'inv',
    rawNativeId: 'inv',
    officialUrl: 'https://www.fda.gov/inv',
    title: 'Example Firm Recalls Chocolate Chip Cookies',
    summaryText: 'Example Firm is recalling cookies.',
    summaryHtml: null,
    reasonText: 'Undeclared shellfish',
    hazardCategory: 'allergen',
    pathogenOrAllergen: 'shellfish',
    firmDisplayName: 'Example Firm',
    firmRawVariants: ['Example Firm'],
    brands: [],
    productDescription: 'Chocolate Chip Cookies',
    retailerNames: [],
    heroImageUrl: null,
    geography: { scope: 'unknown', states: [], confidence: 'stated', sourceText: null },
    productLines: [],
    quantityText: null,
    illnessStatement: null,
    consumerAction: null,
    contactText: null,
    lifecycle: 'active',
    closedYear: null,
    classification: { value: 'class_I', sourceText: null },
    publishedAt: '2026-08-01',
    lastModifiedAt: '2026-08-01',
    isRetractionNotice: false,
  } as unknown as NormalizedSourceRecord;
  return projectCase([record]);
}

test('the fixture corpus is large enough for these invariants to mean something', () => {
  assert.ok(CORPUS.length >= 20, `only ${CORPUS.length} fixtures`);
});

test('All Recalls membership and order are unchanged by categories', () => {
  const before = buildFeedSections(CORPUS, NOW);
  const after = buildFeedSections(withCategories(CORPUS), NOW);
  assert.equal(ids(after.recent), ids(before.recent));
  assert.equal(ids(after.olderActive), ids(before.olderActive));
  assert.equal(
    before.recent.length + before.olderActive.length,
    CORPUS.length,
    'every case is placed exactly once, with or without categories',
  );
});

test('personal relevance is unchanged by categories', () => {
  const tagged = withCategories(CORPUS);
  for (const [index, item] of CORPUS.entries()) {
    const a = relevanceOf(item);
    const b = relevanceOf(tagged[index]);
    assert.equal(b.affectsMe, a.affectsMe, item.id);
    assert.equal(b.geographic, a.geographic, item.id);
    assert.deepEqual(b.matchedAllergens, a.matchedAllergens, item.id);
    assert.deepEqual(b.matchedRetailers, a.matchedRetailers, item.id);
    assert.deepEqual(b.reasons, a.reasons, item.id);
  }
});

test('Affects Me eligibility, membership and order are unchanged by categories', () => {
  const before = buildAffectsMeSections(CORPUS, relevanceOf, { now: NOW });
  const after = buildAffectsMeSections(withCategories(CORPUS), relevanceOf, { now: NOW });
  assert.equal(ids(after.affects), ids(before.affects));
  assert.equal(ids(after.older), ids(before.older));
  const qualifyingBefore = CORPUS.filter((i) => relevanceOf(i).affectsMe).length;
  const qualifyingAfter = withCategories(CORPUS).filter((i) => relevanceOf(i).affectsMe).length;
  assert.equal(qualifyingAfter, qualifyingBefore);
});

test('the consumer risk tier is unchanged by categories', () => {
  for (const item of CORPUS) {
    const tier = consumerRiskTier(item.classification);
    const tagged = {
      ...item,
      ...({ productCategories: ['other'] as FoodCategoryId[] } as unknown as Record<string, never>),
    };
    assert.equal(consumerRiskTier(tagged.classification), tier, item.id);
  }
});

test('push copy is unchanged by categories, and the payload carries none', () => {
  const projection = baseProjection();
  const event: DeliverableEvent = {
    id: 'event-1',
    recallCaseId: 'case-1',
    kind: 'initial',
    triggerRuleId: 'initial',
    payloadSummary: 'Announced.',
    createdAt: '2026-08-01T00:00:00.000Z',
    projection,
  };
  const base = formatPushContent(event);
  for (const id of FOOD_CATEGORY_IDS) {
    const tagged = formatPushContent({
      ...event,
      projection: { ...projection, productCategories: [id] },
    });
    assert.deepEqual(tagged, base, id);
  }
  const serialized = JSON.stringify(base);
  assert.equal(serialized.includes('productCategories'), false);
  assert.equal(/bakery|seafood|pantry_condiments/.test(serialized), false);
});

test('no material-change rule diffs the category field', () => {
  // Exhaustive rather than by example: flip the categories to every value in
  // the vocabulary and require silence every time.
  const base = baseProjection();
  for (const id of FOOD_CATEGORY_IDS) {
    const next: CaseProjection = { ...base, productCategories: [id] };
    const result = detectChanges(base, next);
    assert.deepEqual(result.material, [], id);
    assert.deepEqual(result.nonMaterial, [], id);
  }
});

test('categories do not disturb a real material change', () => {
  const base = baseProjection();
  const widened: CaseProjection = {
    ...base,
    geography: { scope: 'nationwide', states: [], confidence: 'stated', sourceText: null },
  };
  const plain = detectChanges(base, widened);
  const tagged = detectChanges(
    { ...base, productCategories: ['produce'] },
    { ...widened, productCategories: ['seafood'] },
  );
  assert.equal(plain.material.length, 1);
  assert.deepEqual(
    tagged.material.map((m) => [m.ruleId, m.fingerprint]),
    plain.material.map((m) => [m.ruleId, m.fingerprint]),
  );
});
