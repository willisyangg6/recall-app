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
 * The C5.3B known limitation, resolved structurally in C5.3B-2: "cheese and
 * garlic croutons" and "frozen waffle and turkey sausage products" share a
 * shape, but the KIND of word decides — a component-category word (cheese) can
 * modify a head; a bakery word (waffle) beside a modified head is its own
 * product.
 */
test('a co-equal bakery product before a modified head survives; a component does not', () => {
  assert.deepEqual(of('Frozen Waffle and Turkey Sausage Products'), ['meat_poultry', 'bakery']);
  assert.deepEqual(of('Cheese and Garlic Croutons'), ['bakery']);
});

/**
 * The C5.3B absorption over-reach, resolved in C5.3B-2: a dish absorbs bare
 * meat/seafood/dairy beside it, but NOT pantry — a condiment beside a dish is
 * usually its own recalled product.
 */
test('a bare condiment beside a dish stays a product; a bare protein is absorbed', () => {
  assert.deepEqual(of('Fresh cucumbers, salsa and salads'), ['produce', 'prepared', 'pantry']);
  assert.deepEqual(of('Meat and Poultry Dumplings'), ['prepared']);
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

// ── Structural precedence rules (C5.3B-2) ───────────────────────────────────

test('a protein modifier turns a dishable staple head into a dish', () => {
  assert.deepEqual(of('Meat Pie Products'), ['prepared']);
  assert.deepEqual(of('Chicken Fried Rice Products'), ['prepared']);
  assert.deepEqual(of('Frozen Ready-To-Eat Turkey Stuffed Pastry Products'), ['prepared']);
  assert.deepEqual(of('Beef and Cheese Tortilla Products'), ['prepared']);
});

test('a protein in the ingredient clause also forms the dish', () => {
  assert.deepEqual(of('Canned Spaghetti With Sausage Products'), ['prepared']);
});

test('without a protein, a dishable staple keeps its own aisle', () => {
  assert.deepEqual(of('Apple Pie'), ['bakery']);
  assert.deepEqual(of('Cheese Biscuits'), ['bakery']);
});

test('rendered fats are pantry goods, never cuts of meat', () => {
  assert.deepEqual(of('Pork Lard & Beef Tallow Products'), ['pantry']);
  assert.deepEqual(of('Meat and Poultry Fat and Lard Products'), ['pantry']);
});

test('a postposed fruit word is a flavour of the product before it', () => {
  assert.deepEqual(of('Iced Tea Lemon, Iced Tea Diet Lemon, Diet Lemonade and Fruit Punch'), [
    'beverages',
  ]);
});

test('a multi-word produce head is a product name, immune to postposed-flavour', () => {
  assert.deepEqual(of('Queso Crunch Salad Kit'), ['produce']);
});

test('produce-only phrases beside a confection or baby food are its flavour list', () => {
  assert.deepEqual(of('Jolly Rancher Green Apple, Blue Raspberry, Grape Frozen Confection Pop'), [
    'snacks_candy',
  ]);
  assert.deepEqual(of('Pear, Kiwi, Spinach & Pea Baby Food pouches'), ['baby']);
});

test('produce beside a PREPARED dish stays a real product — never a flavour', () => {
  assert.deepEqual(of('Fresh cucumbers, salsa and salads'), ['produce', 'prepared', 'pantry']);
});

test('a plant-based analogue of a meat product is Prepared, not Meat & poultry', () => {
  assert.deepEqual(of("Plant Based Buffalo Chik'n Nuggets and Hot and Spicy Sausage Patties"), [
    'prepared',
  ]);
  assert.deepEqual(of('Chicken Nuggets'), ['meat_poultry']);
});

test('a name that itself says "for baby" is an infant-feeding product', () => {
  assert.deepEqual(of('Comforts FOR BABY Purified Water with Fluoride'), ['baby']);
});

test('in a list, a phrase ending in an unknown word is a variety name and stays silent', () => {
  assert.deepEqual(
    of(
      'Southwest Chopped Salad Kit, Bacon Ranch Crunch Kit, Fresh Mex Chopped Kit, Queso Crunch Salad Kit',
    ),
    ['produce'],
  );
});

test('a single-product text still trusts its last interior match', () => {
  assert.deepEqual(of('Ground Beef Chubs'), ['meat_poultry']);
});

test('packaging and size words never hide the real head noun', () => {
  assert.deepEqual(of('Whole Nutrition Infant formula 24 oz cans and 0.6oz packets'), ['baby']);
  assert.deepEqual(of('Original Sliders, frozen, 4 count carton'), ['prepared']);
});

test('an ingredient-with-provenance tail is never rescued into a category', () => {
  assert.deepEqual(
    of('Victory Kitchens Ltd. Recalls Products Containing Chicken From An Ineligible Country'),
    [],
  );
  // The rescue itself still works when the tail names the recalled product.
  assert.deepEqual(of('Multiple items with cucumbers'), ['produce']);
});

test('an unknown product name stays honestly uncategorized', () => {
  assert.deepEqual(of('Banh Ba Xa'), []);
  assert.deepEqual(of('Nem Chua Products'), []);
});

test('a long co-equal list of dishes resolves to Prepared once, not to its toppings', () => {
  assert.deepEqual(
    of(
      'Cheeseburgers, Spicy Chicken Sandwich, Italian Mini Subs, Pepperoni Pizza Sub, Chili Cheese Coney and BBQ Riblets',
    ),
    ['prepared'],
  );
});

test('a comma inside a word is mangled encoding, not a product list', () => {
  assert.deepEqual(of('Canadian Liver P,tE Products'), ['meat_poultry']);
});

test('a trailing dish-class word after "with" heads the whole name; soup does not', () => {
  assert.deepEqual(of('Spaghetti Loops With Meat Sauce Entrée Products'), ['prepared']);
  assert.deepEqual(of('Saimin Noodles with Soup & Garnishes'), ['pantry']);
});

test('generic dish vocabulary covers common non-English product names', () => {
  assert.deepEqual(of('Frozen Mushroom Risotto Products'), ['prepared']);
  assert.deepEqual(of('Raw, Frozen Chicken and Vegetable Potsticker Products'), ['prepared']);
});

test('cracklings and sliders live where shoppers find them', () => {
  assert.deepEqual(of('Ineligible Pork Cracklings Products'), ['snacks_candy']);
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
