/**
 * Deterministic food-category matching (C5.3B).
 *
 * The behavioural tests below are written as product language, not as case
 * fixes: every one states a rule about how food names work ("a flavour is not
 * a category", "a dish is not its ingredients"). None references a case id, a
 * brand or a firm — that is the anti-overfitting contract, and one of the
 * tests checks the lexicon for it directly.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAX_CATEGORIES_PER_CASE, type FoodCategoryId } from './food-category';
import { COMPOUND_TERMS, HEAD_TERMS } from './food-category-lexicon';
import {
  categoriesForCase,
  categoryProductText,
  matchFoodCategories,
  normalizeProductText,
  splitProductPhrases,
} from './food-category-matcher';

const of = (text: string): FoodCategoryId[] => matchFoodCategories(text);

// ── Flavours, ingredients and other things that are not the product ─────────

test('a fruit in a product name is a flavour, not Produce', () => {
  assert.deepEqual(of('Dark Chocolate Cherry Granola'), ['pantry']);
  assert.deepEqual(of('Strawberry Shortcake'), ['bakery']);
  assert.deepEqual(of('Peach Oat Bars'), ['snacks_candy']);
});

test('an explicit flavour claim never creates a category', () => {
  assert.deepEqual(of('Butter Flavored Popcorn'), ['snacks_candy']);
  assert.deepEqual(of('Bacon flavor popcorn seasoning'), ['pantry']);
  assert.deepEqual(of('Chicken Flavored Base Products'), ['pantry']);
});

test('a trailing flavour clause adds nothing, even as its own segment', () => {
  // Head-noun order already handles "Butter Flavored Popcorn"; this is the
  // shape it cannot handle, where the flavour follows the product.
  assert.deepEqual(of('Dairy-Free Coconut Yogurt, Strawberry flavor'), ['dairy_eggs']);
  assert.deepEqual(of('Popcorn, Butter Flavored'), ['snacks_candy']);
});

test('a negation is not the thing it negates', () => {
  assert.deepEqual(of('Dairy-Free Coconut Yogurt'), ['dairy_eggs']);
  assert.deepEqual(of('Sugar Free Chocolate Bars'), ['snacks_candy']);
});

test('milk chocolate is confectionery, not dairy', () => {
  assert.deepEqual(of('Milk Chocolate Raisins'), ['snacks_candy']);
  assert.deepEqual(of('Belgian Dark Chocolate Bars'), ['snacks_candy']);
});

test('an ingredient named after "with" or "containing" is not a category', () => {
  assert.deepEqual(of('Salads containing fresh cucumbers'), ['prepared']);
  assert.deepEqual(of('Chef Salads with Ham and Turkey'), ['prepared']);
  assert.deepEqual(of('Multiple sushi products with cucumber'), ['prepared']);
});

test('a bakery filling does not add Produce', () => {
  assert.deepEqual(of('Shortbread Cookies with Apricot Filling'), ['bakery']);
  assert.deepEqual(of('Cherry Pie'), ['bakery']);
  assert.deepEqual(of('Fruit Tarts'), ['bakery']);
});

// ── Named false friends ─────────────────────────────────────────────────────

test('"baby" as a size or a cut is not Baby food', () => {
  assert.deepEqual(of('Baby Arugula'), ['produce']);
  assert.deepEqual(of('Organic whole carrots and organic baby carrots'), ['produce']);
  assert.deepEqual(of('Baby Back Ribs'), ['meat_poultry']);
});

test('an infant feeding product IS Baby food', () => {
  assert.deepEqual(of('Powdered Goat Milk Infant Formula'), ['baby']);
  assert.deepEqual(of('Baby Food Product'), ['baby']);
  assert.deepEqual(of('Teething Sticks'), ['baby']);
});

test('cocktail shrimp is Seafood, not a drink', () => {
  assert.deepEqual(of('Cocktail Shrimp'), ['seafood']);
  assert.deepEqual(of('Shrimp Cocktail'), ['seafood']);
});

test('a seafood false friend keeps its own category', () => {
  assert.deepEqual(of('Crab Cake 2 Pack'), ['seafood']);
  assert.deepEqual(of('Fish Ball Products'), ['seafood']);
  assert.deepEqual(of('Salmon Burgers'), ['seafood']);
});

test('an ice cream novelty is Dairy, not a snack bar', () => {
  assert.deepEqual(of('Ice Cream Bars'), ['dairy_eggs']);
  assert.deepEqual(of('Passion Fruit Ice Cream Sandwiches'), ['dairy_eggs']);
});

// ── Product versus ingredient, across categories ────────────────────────────

test('meat sold as meat is Meat & poultry', () => {
  assert.deepEqual(of('Ground Beef Products'), ['meat_poultry']);
  assert.deepEqual(of('Raw Bone-In Beef Products'), ['meat_poultry']);
  assert.deepEqual(of('Beef and Chicken Products'), ['meat_poultry']);
});

test('a dish is the dish, not the meat inside it', () => {
  assert.deepEqual(of('Chicken Enchilada Products'), ['prepared']);
  assert.deepEqual(of('Frozen Meat and Poultry Dumpling Products'), ['prepared']);
  assert.deepEqual(of('Beef Tamale Products'), ['prepared']);
  assert.deepEqual(of('Chicken Noodle Soup Product'), ['prepared']);
});

test('a prepared dish is not split into its staple components', () => {
  assert.deepEqual(of('Macaroni and Cheese'), ['prepared']);
  assert.deepEqual(of('Spaghetti and Meatball Products'), ['prepared']);
});

test('supplements are the dose form, not a fortified conventional food', () => {
  assert.deepEqual(of('Moringa Capsules'), ['supplements']);
  assert.deepEqual(of('Elv Control Herbal Supplement'), ['supplements']);
  assert.deepEqual(of('Whole Nutrition Infant Formula with Iron'), ['baby']);
  assert.deepEqual(of('Cereal'), ['pantry']);
});

// ── The matcher cannot see hazards, allergens, firms or retailers ───────────

test('an allergen is not a category — the signature cannot even accept one', () => {
  // A cookie recalled for undeclared shellfish is a cookie.
  assert.deepEqual(of('Chocolate Chip Cookies'), ['bakery']);
  const input = {
    sourceAgency: 'FDA' as const,
    title: 'Firm Issues Allergy Alert on Undeclared Shellfish in Chocolate Chip Cookies',
    productDescription: 'Chocolate Chip Cookies',
  };
  assert.deepEqual(categoriesForCase(input).categories, ['bakery']);
  assert.equal('pathogenOrAllergen' in input, false);
  assert.equal('hazardCategory' in input, false);
  assert.equal('retailerNames' in input, false);
  assert.equal('recallingFirm' in input, false);
});

test('the same product text yields the same categories for either agency', () => {
  const fda = categoriesForCase({
    sourceAgency: 'FDA',
    title: 'Anything',
    productDescription: 'Ground Beef Products',
  });
  const fsis = categoriesForCase({
    sourceAgency: 'FSIS',
    title: 'A Firm Recalls Ground Beef Products Due to Possible Contamination',
    productDescription: null,
  });
  assert.deepEqual(fda.categories, fsis.categories);
});

// ── Multi-label behaviour ───────────────────────────────────────────────────

test('co-equal products in a long list are all kept', () => {
  assert.deepEqual(of('Whole Peaches, Plums, and Nectarines'), ['produce']);
  assert.deepEqual(of('Cereal, bars, and snacks'), ['pantry', 'snacks_candy']);
  assert.deepEqual(of('Raw Shrimp, Cooked Shrimp, Shrimp Skewers'), ['seafood']);
});

/**
 * KNOWN LIMITATION, asserted so it stays visible rather than being discovered
 * in production. "Cheese and garlic croutons" and "frozen waffle and turkey
 * sausage products" are the same shape — bare term, conjunction, modifier plus
 * head — but the first coordinates modifiers of one product and the second
 * lists two. Nothing in the text distinguishes them, so the matcher applies the
 * modifier reading and drops the waffles. See docs/recall-food-categories.md.
 */
test('KNOWN LIMITATION: a co-equal product before a modified head is dropped', () => {
  assert.deepEqual(of('Frozen Waffle and Turkey Sausage Products'), ['meat_poultry']);
});

/**
 * KNOWN LIMITATION. Component absorption reads a bare staple beside a dish as
 * an ingredient of it, which is right for "meat and poultry dumplings" and
 * wrong here: the salsa is a third recalled product, not a salad ingredient.
 */
test('KNOWN LIMITATION: a bare staple beside a dish is read as its ingredient', () => {
  assert.deepEqual(of('Fresh cucumbers, salsa and salads'), ['produce', 'prepared']);
});

test('a genuinely multi-category recall carries each category, in display order', () => {
  assert.deepEqual(of('Hummus Dip & Tzatziki Cucumber Yogurt'), ['pantry', 'dairy_eggs']);
  assert.deepEqual(of('pork rinds and seasoning bottles'), ['pantry', 'snacks_candy']);
});

test('coordinated modifiers are one product, not several', () => {
  assert.deepEqual(of('Cheese and Garlic Croutons'), ['bakery']);
});

test('output never exceeds the maximum of four categories', () => {
  const many = of(
    'Cucumbers, Ground Beef, Chicken Soup, Flour, Bread, Potato Chips, Cheese, Shrimp, Vitamins, Infant Formula, Juice',
  );
  assert.ok(many.length <= MAX_CATEGORIES_PER_CASE, `got ${many.length}`);
});

// ── Honest silence ──────────────────────────────────────────────────────────

test('a product the lexicon does not recognise gets no category, never a guess', () => {
  assert.deepEqual(of('Notification Report 063-2014'), []);
  assert.deepEqual(of('Frozen Food Products'), []);
  assert.deepEqual(of(''), []);
});

test('an article that is not food gets no category', () => {
  assert.deepEqual(of('Metal Cookware Items'), []);
  assert.deepEqual(of('4 sizes of aluminum saucepans'), []);
});

test('a non-food article named with a food word takes no category', () => {
  assert.deepEqual(of('Jelly Handbag'), []);
  assert.deepEqual(of('Chocolate Scented Lotion'), []);
});

test('novelty packaging does not hide the food inside it', () => {
  assert.deepEqual(of('Jelly Handbag and Jelly Backpack containing Jelly Bars'), ['snacks_candy']);
});

// ── Determinism ─────────────────────────────────────────────────────────────

test('repeated calls produce identical output', () => {
  const samples = [
    'Dark Chocolate Cherry Granola',
    'Frozen Meat and Poultry Dumpling Products',
    'Cheese and Garlic Croutons',
    'Whole Peaches, Plums, and Nectarines',
  ];
  for (const sample of samples) {
    const first = of(sample);
    for (let i = 0; i < 5; i++) assert.deepEqual(of(sample), first, sample);
  }
});

test('phrase order does not change the ordered result', () => {
  assert.deepEqual(of('Bread and Shrimp'), of('Shrimp and Bread'));
});

// ── Extraction ──────────────────────────────────────────────────────────────

test('FDA extraction prefers the structured product description', () => {
  const result = categoryProductText({
    sourceAgency: 'FDA',
    title: 'A Long Announcement Title That Should Not Be Used',
    productDescription: 'Whole Cantaloupe',
  });
  assert.deepEqual(result, { text: 'Whole Cantaloupe', basis: 'product_description' });
});

test('FSIS extraction reads the product out of the title grammar', () => {
  assert.deepEqual(
    categoryProductText({
      sourceAgency: 'FSIS',
      title: 'FSIS Issues Public Health Alert for Raw Sirloin Beef Tip Product Due to Misbranding',
      productDescription: null,
    }),
    { text: 'Raw Sirloin Beef Tip Product', basis: 'title_grammar' },
  );
  assert.deepEqual(
    categoryProductText({
      sourceAgency: 'FSIS',
      title: 'A Firm Recalls Chicken Salad Products Due to Possible Contamination',
      productDescription: null,
    }),
    { text: 'Chicken Salad Products', basis: 'title_grammar' },
  );
});

test('"Imported" as an adjective does not truncate the product away', () => {
  const text = categoryProductText({
    sourceAgency: 'FSIS',
    title:
      'FSIS Issues Public Health Alert for Ineligible Imported Cooked Duck Blood Curds from China',
    productDescription: null,
  }).text;
  assert.ok(text.includes('Duck Blood Curds'), text);
  assert.equal(
    categoryProductText({
      sourceAgency: 'FSIS',
      title: 'FSIS Issues Public Health Alert for Pork Products Imported From Ecuador',
      productDescription: null,
    }).text,
    'Pork Products',
  );
});

test('structured product lines are only a fallback, and are trimmed of identifiers', () => {
  const result = categoryProductText({
    sourceAgency: 'FSIS',
    title: 'FSIS Retracts Public Health Alert',
    productDescription: null,
    productLines: ['Chicken Nuggets | UPC: 012345678905 | Lot: A1', 'Beef Patties | UPC: 9'],
  });
  assert.equal(result.basis, 'product_lines');
  assert.equal(result.text, 'Chicken Nuggets; Beef Patties');
});

test('normalization keeps hyphens so bound words survive splitting', () => {
  assert.equal(normalizeProductText('Raw  Bone-In   Beef'), 'raw bone-in beef');
  assert.equal(normalizeProductText('Beef Shepherd&rsquo;s Pie'), "beef shepherd's pie");
});

test('phrase splitting separates products but not ingredients', () => {
  assert.deepEqual(splitProductPhrases('cucumbers and salads'), ['cucumbers', 'salads']);
  assert.deepEqual(splitProductPhrases('salads containing cucumbers'), ['salads']);
});

// ── Anti-overfitting contract ───────────────────────────────────────────────

test('the lexicon contains no case ids, urls or obvious firm markers', () => {
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-/i;
  const corporate = /\b(?:llc|inc\b|corp\b|company|co\.|https?:)/i;
  for (const entry of [...COMPOUND_TERMS, ...HEAD_TERMS]) {
    assert.equal(uuid.test(entry.term), false, `case id in lexicon: ${entry.term}`);
    assert.equal(corporate.test(entry.term), false, `firm marker in lexicon: ${entry.term}`);
    assert.ok(entry.term.length < 260, `suspiciously long lexicon entry: ${entry.term}`);
  }
});

test('lexicon entries have no duplicate terms', () => {
  const terms = [...COMPOUND_TERMS, ...HEAD_TERMS].map((entry) => entry.term);
  assert.equal(new Set(terms).size, terms.length);
});
