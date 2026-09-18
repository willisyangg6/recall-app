/**
 * The product-category tag's DISPLAY RULE (P2B7D).
 *
 * One question: which single category word, if any, may a recall card show?
 * The rule lives in `cardCategoryLabel` and reaches Feed and Saved through
 * the one `buildHomeCardModel` they both call, so these tests grade the model
 * rather than either screen. The card's rendering is pinned separately
 * (components/category-tag-design.test.ts).
 *
 * The load-bearing claims, in the order they matter:
 *
 *   1. the tag DISPLAYS a stored answer and never derives one;
 *   2. it can only show a category the Category filter also offers;
 *   3. it shows at most one;
 *   4. the launch-hidden ids and the absent case show nothing at all.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  FOOD_CATEGORIES,
  FOOD_CATEGORY_IDS,
  foodCategoryLabel,
  type FoodCategoryId,
} from '@/domain/food-category';
import { HIDDEN_LAUNCH_CATEGORY_IDS, LAUNCH_CATEGORY_IDS } from '@/domain/food-category-launch';
import type { FeedItem } from '@/lib/recall-feed';
import { buildHomeCardModel, cardCategoryLabel } from '@/lib/recall-presentation';

const TODAY = '2026-09-17';

function geo(scope: 'nationwide' | 'states' | 'unknown', states: string[] = []) {
  return { scope, states, confidence: 'stated' as const, sourceText: null };
}

function item(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: 'category-001',
    sourceAgency: 'FDA',
    noticeType: 'recall',
    state: 'active',
    title: 'Category Case',
    classification: {
      value: 'class_I',
      sourceText: 'Class I',
      officialClasses: ['class_I'],
    } as FeedItem['classification'],
    hazardCategory: 'unknown',
    publishedAt: '2026-09-01',
    lastPublicActivityAt: '2026-09-01',
    reasonText: null,
    pathogenOrAllergen: null,
    firmName: null,
    brands: [],
    productDescription: null,
    retailerNames: [],
    heroImageUrl: null,
    productNames: [],
    geography: geo('unknown'),
    officialUrl: 'https://example.gov',
    timeline: [],
    ...overrides,
  };
}

const labelOf = (categories: FoodCategoryId[] | undefined): string | null =>
  buildHomeCardModel(item({ productCategories: categories }), {
    today: TODAY,
    affectsYou: false,
  }).categoryLabel;

// ── 1. The authoritative value reaches the shared card model ────────────────

test('the stored category — and only the stored category — reaches the card model', () => {
  // The projection's own ids, read off the feed row, become the card's word.
  assert.equal(labelOf(['bakery_grains']), 'Bakery');
  assert.equal(labelOf(['produce']), 'Fruits & vegetables');
  // The model field exists on every card, and is null rather than absent, so
  // no screen has to distinguish "no category" from "field not built".
  const model = buildHomeCardModel(item(), { today: TODAY, affectsYou: false });
  assert.ok('categoryLabel' in model);
  assert.equal(model.categoryLabel, null);
});

// ── 2. Only launch-visible categories may be displayed ──────────────────────

test('every launch-visible id maps to its exact frozen label, and nothing else spells one', () => {
  // The nine, by name. A reworded label must change `food-category.ts` and be
  // reflected here — this is deliberately a spelling gate.
  assert.deepEqual(
    LAUNCH_CATEGORY_IDS.map((id) => [id, cardCategoryLabel([id])]),
    [
      ['produce', 'Fruits & vegetables'],
      ['meat_poultry', 'Meat & poultry'],
      ['seafood', 'Seafood'],
      ['dairy_eggs', 'Dairy & eggs'],
      ['bakery_grains', 'Bakery'],
      ['snacks_sweets', 'Snacks & sweets'],
      ['beverages', 'Beverages'],
      ['pantry_condiments', 'Pantry & staples'],
      ['baby_food_formula', 'Baby food & formula'],
    ],
  );
  // The word is the vocabulary's, never a copy: the tag and the Category
  // filter chip cannot disagree about how an aisle is spelled.
  for (const id of LAUNCH_CATEGORY_IDS) {
    assert.equal(cardCategoryLabel([id]), foodCategoryLabel(id));
  }
});

test('the excluded ids, null, unknown values and an empty list all render nothing', () => {
  // The three launch-hidden ids. Each is hidden for measured reasons
  // (docs/recall-food-categories.md §8) and none may reach a card.
  assert.deepEqual(HIDDEN_LAUNCH_CATEGORY_IDS.slice().sort(), [
    'other',
    'prepared_foods',
    'supplements',
  ]);
  for (const id of HIDDEN_LAUNCH_CATEGORY_IDS) {
    assert.equal(cardCategoryLabel([id]), null, `${id} reached a card`);
  }
  // "No categories stored" is NOT `other`, and neither shows a word.
  assert.equal(labelOf(undefined), null);
  assert.equal(cardCategoryLabel(null), null);
  assert.equal(cardCategoryLabel([]), null);
  // Anything a jsonb column could hold, including a value written by a
  // future vocabulary, degrades to silence instead of leaking or throwing.
  for (const junk of [
    'produce',
    42,
    {},
    ['not_a_category'],
    [null],
    [{ id: 'produce' }],
    ['future_category_id'],
  ]) {
    assert.equal(cardCategoryLabel(junk), null, `${JSON.stringify(junk)} produced a tag`);
  }
  // No placeholder wording exists anywhere in the rule's output.
  for (const id of FOOD_CATEGORY_IDS) {
    const label = cardCategoryLabel([id]);
    assert.ok(label === null || !/^(other|unknown|uncategori[sz]ed)$/i.test(label));
  }
});

test('the displayable set is exactly the filter’s offered set — one list, no second opinion', () => {
  // Partition: every vocabulary id either renders its own label or renders
  // nothing, and which one it does is decided by the launch allowlist alone.
  const displayable = FOOD_CATEGORY_IDS.filter((id) => cardCategoryLabel([id]) !== null);
  assert.deepEqual(displayable, [...LAUNCH_CATEGORY_IDS]);
  assert.equal(displayable.length + HIDDEN_LAUNCH_CATEGORY_IDS.length, FOOD_CATEGORY_IDS.length);
});

// ── 3. At most one tag ──────────────────────────────────────────────────────

test('a multi-category case shows exactly one label, deterministically, in canonical order', () => {
  // Real shapes from the live corpus (npm run qa:product-categories).
  assert.equal(cardCategoryLabel(['meat_poultry', 'bakery_grains']), 'Meat & poultry');
  assert.equal(cardCategoryLabel(['dairy_eggs', 'pantry_condiments']), 'Dairy & eggs');
  assert.equal(cardCategoryLabel(['meat_poultry', 'seafood']), 'Meat & poultry');
  // The canonical DISPLAY order decides, not the stored array's order, so a
  // list that reached the client out of order still reads the same.
  assert.equal(cardCategoryLabel(['bakery_grains', 'meat_poultry']), 'Meat & poultry');
  assert.equal(cardCategoryLabel(['pantry_condiments', 'dairy_eggs']), 'Dairy & eggs');
  // A hidden id never suppresses the visible one beside it, and never wins.
  assert.equal(cardCategoryLabel(['prepared_foods', 'pantry_condiments']), 'Pantry & staples');
  assert.equal(cardCategoryLabel(['prepared_foods', 'bakery_grains']), 'Bakery');
  // Every hidden id, and nothing else, means no tag at all.
  assert.equal(cardCategoryLabel(['prepared_foods', 'supplements']), null);
  // The result is a single string, never a list — one tag is structural.
  assert.equal(typeof cardCategoryLabel(FOOD_CATEGORY_IDS.slice()), 'string');
  // Duplicates cannot produce two.
  assert.equal(cardCategoryLabel(['seafood', 'seafood']), 'Seafood');
});

// ── 4. No client-side inference ─────────────────────────────────────────────

test('the label ignores every input a classifier would use — title, brand, reason, agency, image', () => {
  const evidence: Partial<FeedItem>[] = [
    { title: 'Ground Beef Products Recalled' },
    { brands: ['Ocean Catch Seafood'], firmName: 'Dairyland Creamery' },
    { reasonText: 'Undeclared milk.', pathogenOrAllergen: 'milk' },
    { hazardCategory: 'allergen' },
    { sourceAgency: 'FSIS' },
    { productDescription: 'Frozen cheese pizza' },
    { productNames: ['Whole Wheat Bread 24 oz'] },
    { heroImageUrl: 'https://example.gov/beef.png' },
  ];
  for (const overrides of evidence) {
    // With a stored category, the stored category wins outright.
    assert.equal(
      buildHomeCardModel(item({ ...overrides, productCategories: ['beverages'] }), {
        today: TODAY,
        affectsYou: false,
      }).categoryLabel,
      'Beverages',
      `${JSON.stringify(overrides)} changed the stored label`,
    );
    // With none stored, no amount of suggestive text invents one.
    assert.equal(
      buildHomeCardModel(item(overrides), { today: TODAY, affectsYou: false }).categoryLabel,
      null,
      `${JSON.stringify(overrides)} invented a label`,
    );
  }
  // Structural, not just behavioural: the rule takes ONE argument, so there
  // is no signature by which a title or a hazard could ever be passed in.
  assert.equal(cardCategoryLabel.length, 1);
  // And the presentation contract imports the two leaf category modules only
  // — never the classifier, its lexicon, or `domain/projection`.
  const PRESENTATION = readFileSync(join(__dirname, 'recall-presentation.ts'), 'utf8');
  const imports = [...PRESENTATION.matchAll(/^import[\s\S]*?from '([^']+)';$/gm)].map((m) => m[1]);
  assert.ok(imports.includes('@/domain/food-category'));
  assert.ok(imports.includes('@/domain/food-category-launch'));
  for (const forbidden of [
    '@/domain/projection',
    '@/domain/food-category-matcher',
    '@/domain/food-category-lexicon',
  ]) {
    assert.ok(!imports.includes(forbidden), `recall-presentation imports ${forbidden}`);
  }
  for (const forbidden of ['deriveProductCategories', 'categoriesForCase', 'categoryProductText']) {
    assert.ok(!PRESENTATION.includes(forbidden), `recall-presentation references ${forbidden}`);
  }
});

// ── 5. The word itself ──────────────────────────────────────────────────────

test('no label is all caps, an enum id, or otherwise unfit to read', () => {
  for (const id of LAUNCH_CATEGORY_IDS) {
    const label = cardCategoryLabel([id])!;
    assert.notEqual(label, label.toUpperCase(), `${id} renders all caps`);
    assert.equal(label, label.trim());
    assert.equal(label[0], label[0].toUpperCase(), `${id} does not start capitalized`);
    // Never the persisted identifier: no snake_case can reach a shopper.
    assert.ok(!label.includes('_'), `${id} leaks an enum id`);
    assert.notEqual(label, id);
    // Short enough to sit beside a product name without becoming a sentence.
    assert.ok(label.length <= 20, `${id}'s label is ${label.length} characters`);
  }
});

// ── 6. Detail and filtering are untouched ───────────────────────────────────

test('Recall Detail gains no category, and the filter’s own contract is unchanged', () => {
  const DETAIL_SCREEN = readFileSync(join(__dirname, '..', 'app', 'recall', '[id].tsx'), 'utf8');
  for (const forbidden of ['CategoryTag', 'categoryLabel', 'cardCategoryLabel', 'food-category']) {
    assert.ok(!DETAIL_SCREEN.includes(forbidden), `Recall Detail references ${forbidden}`);
  }
  // `buildDetailModel` has no category field to render in the first place.
  const PRESENTATION = readFileSync(join(__dirname, 'recall-presentation.ts'), 'utf8');
  const detailModel = PRESENTATION.slice(
    PRESENTATION.indexOf('export interface DetailModel {'),
    PRESENTATION.indexOf('export interface DetailContext'),
  );
  assert.ok(detailModel.length > 0);
  assert.ok(!detailModel.includes('categoryLabel'));

  // The filter still reads the raw stored ids, not the card's one label, and
  // the card's rule cannot narrow what the filter matches.
  const FILTERS = readFileSync(join(__dirname, 'feed-filters.ts'), 'utf8');
  assert.ok(FILTERS.includes('productCategories.some((id) => categoryIds.includes(id))'));
  for (const forbidden of ['cardCategoryLabel', 'categoryLabel', 'foodCategoryLabel']) {
    assert.ok(!FILTERS.includes(forbidden), `feed-filters references ${forbidden}`);
  }
  // A case whose only visible category is its SECOND stored id still matches
  // a filter on its first — the tag narrows a word, never a result set.
  const both: FoodCategoryId[] = ['prepared_foods', 'bakery_grains'];
  assert.equal(cardCategoryLabel(both), 'Bakery');
  assert.ok(both.includes('prepared_foods'), 'the stored list is not rewritten by display');
});

// ── 7. Real corpus coverage ─────────────────────────────────────────────────

interface GoldRow {
  caseId: string;
  title: string;
  expected: FoodCategoryId[];
}

const GOLD: GoldRow[] = (
  JSON.parse(
    readFileSync(join(__dirname, '..', 'domain', 'fixtures', 'category-gold-set.json'), 'utf8'),
  ) as { rows: GoldRow[] }
).rows;

test('the rule holds over the reviewed real corpus, in every state it actually contains', () => {
  // 1,496 human-reviewed rows drawn from the live corpus — the same gold set
  // the accuracy work used. Here it is not an accuracy measurement: the
  // reviewed labels are simply real category SHAPES, and every one of them
  // must resolve to a single legal word or to silence.
  assert.ok(GOLD.length > 1000, `only ${GOLD.length} reviewed rows`);

  const legal = new Set<string>(LAUNCH_CATEGORY_IDS.map((id) => foodCategoryLabel(id)));
  const seen = { approved: 0, excluded: 0, multi: 0, mixed: 0 };

  for (const row of GOLD) {
    const model = buildHomeCardModel(
      item({ id: row.caseId, title: row.title, productCategories: row.expected }),
      { today: TODAY, affectsYou: false },
    );
    const label = model.categoryLabel;
    if (label !== null) {
      // Always exactly one legal word, never an id, never a placeholder.
      assert.ok(legal.has(label), `${row.caseId} produced "${label}"`);
      seen.approved += 1;
      if (row.expected.some((id) => HIDDEN_LAUNCH_CATEGORY_IDS.includes(id))) seen.mixed += 1;
    } else {
      // Silence is only ever correct: every id on the row must be hidden.
      assert.ok(
        row.expected.every((id) => HIDDEN_LAUNCH_CATEGORY_IDS.includes(id)),
        `${row.caseId} (${row.expected.join('+')}) showed nothing`,
      );
      seen.excluded += 1;
    }
    if (row.expected.length > 1) seen.multi += 1;
    // An un-enriched version of the SAME real case shows nothing at all.
    assert.equal(
      buildHomeCardModel(item({ id: row.caseId, title: row.title }), {
        today: TODAY,
        affectsYou: false,
      }).categoryLabel,
      null,
    );
  }

  // The corpus really does exercise all three states, so the loop above is
  // not quietly grading one of them zero times.
  assert.ok(seen.approved > 500, `only ${seen.approved} rows show a tag`);
  assert.ok(seen.excluded > 100, `only ${seen.excluded} rows show none`);
  assert.ok(seen.multi > 10, `only ${seen.multi} multi-category rows`);
  assert.ok(seen.mixed > 0, 'no row mixes a hidden id with a visible one');

  // And every approved category in the vocabulary is represented by at least
  // one real reviewed case, so no label ships untested against real data.
  const produced = new Set(
    GOLD.map((row) => cardCategoryLabel(row.expected)).filter((l): l is string => l !== null),
  );
  assert.deepEqual(
    [...legal].filter((l) => !produced.has(l)),
    [],
  );
});

test('the vocabulary this rule depends on is the frozen twelve', () => {
  // A guard on the assumption the tests above encode: if a thirteenth
  // category is ever added, it lands in neither list until someone decides.
  assert.equal(FOOD_CATEGORIES.length, 12);
  assert.equal(LAUNCH_CATEGORY_IDS.length, 9);
  assert.equal(HIDDEN_LAUNCH_CATEGORY_IDS.length, 3);
});
