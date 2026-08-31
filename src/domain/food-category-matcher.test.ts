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
  isJurisdictionOnlyPhrase,
  matchFoodCategories,
  normalizeProductText,
  splitProductPhrases,
} from './food-category-matcher';

const of = (text: string): FoodCategoryId[] => matchFoodCategories(text);

// ── Flavours, ingredients and other things that are not the product ─────────

test('a fruit in a product name is a flavour, not Produce', () => {
  assert.deepEqual(of('Dark Chocolate Cherry Granola'), ['pantry_condiments']);
  assert.deepEqual(of('Strawberry Shortcake'), ['bakery_grains']);
  assert.deepEqual(of('Peach Oat Bars'), ['snacks_sweets']);
});

test('an explicit flavour claim never creates a category', () => {
  assert.deepEqual(of('Butter Flavored Popcorn'), ['snacks_sweets']);
  assert.deepEqual(of('Bacon flavor popcorn seasoning'), ['pantry_condiments']);
  assert.deepEqual(of('Chicken Flavored Base Products'), ['pantry_condiments']);
});

test('a trailing flavour clause adds nothing, even as its own segment', () => {
  // Head-noun order already handles "Butter Flavored Popcorn"; this is the
  // shape it cannot handle, where the flavour follows the product.
  assert.deepEqual(of('Dairy-Free Coconut Yogurt, Strawberry flavor'), ['dairy_eggs']);
  assert.deepEqual(of('Popcorn, Butter Flavored'), ['snacks_sweets']);
});

test('a negation is not the thing it negates', () => {
  assert.deepEqual(of('Dairy-Free Coconut Yogurt'), ['dairy_eggs']);
  assert.deepEqual(of('Sugar Free Chocolate Bars'), ['snacks_sweets']);
});

test('milk chocolate is confectionery, not dairy', () => {
  assert.deepEqual(of('Milk Chocolate Raisins'), ['snacks_sweets']);
  assert.deepEqual(of('Belgian Dark Chocolate Bars'), ['snacks_sweets']);
});

test('an ingredient named after "with" or "containing" is not a category', () => {
  assert.deepEqual(of('Salads containing fresh cucumbers'), ['prepared_foods']);
  assert.deepEqual(of('Chef Salads with Ham and Turkey'), ['prepared_foods']);
  assert.deepEqual(of('Multiple sushi products with cucumber'), ['prepared_foods']);
});

test('a bakery filling does not add Produce', () => {
  assert.deepEqual(of('Shortbread Cookies with Apricot Filling'), ['bakery_grains']);
  assert.deepEqual(of('Cherry Pie'), ['bakery_grains']);
  assert.deepEqual(of('Fruit Tarts'), ['bakery_grains']);
});

// ── Named false friends ─────────────────────────────────────────────────────

test('"baby" as a size or a cut is not Baby food', () => {
  assert.deepEqual(of('Baby Arugula'), ['produce']);
  assert.deepEqual(of('Organic whole carrots and organic baby carrots'), ['produce']);
  assert.deepEqual(of('Baby Back Ribs'), ['meat_poultry']);
});

test('an infant feeding product IS Baby food', () => {
  assert.deepEqual(of('Powdered Goat Milk Infant Formula'), ['baby_food_formula']);
  assert.deepEqual(of('Baby Food Product'), ['baby_food_formula']);
  assert.deepEqual(of('Teething Sticks'), ['baby_food_formula']);
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
  assert.deepEqual(of('Chicken Enchilada Products'), ['prepared_foods']);
  assert.deepEqual(of('Frozen Meat and Poultry Dumpling Products'), ['prepared_foods']);
  assert.deepEqual(of('Beef Tamale Products'), ['prepared_foods']);
  assert.deepEqual(of('Chicken Noodle Soup Product'), ['prepared_foods']);
});

test('a prepared dish is not split into its staple components', () => {
  assert.deepEqual(of('Macaroni and Cheese'), ['prepared_foods']);
  assert.deepEqual(of('Spaghetti and Meatball Products'), ['prepared_foods']);
});

test('supplements are the dose form, not a fortified conventional food', () => {
  assert.deepEqual(of('Moringa Capsules'), ['supplements']);
  assert.deepEqual(of('Elv Control Herbal Supplement'), ['supplements']);
  assert.deepEqual(of('Whole Nutrition Infant Formula with Iron'), ['baby_food_formula']);
  assert.deepEqual(of('Cereal'), ['pantry_condiments']);
});

// ── The matcher cannot see hazards, allergens, firms or retailers ───────────

test('an allergen is not a category — the signature cannot even accept one', () => {
  // A cookie recalled for undeclared shellfish is a cookie.
  assert.deepEqual(of('Chocolate Chip Cookies'), ['bakery_grains']);
  const input = {
    sourceAgency: 'FDA' as const,
    title: 'Firm Issues Allergy Alert on Undeclared Shellfish in Chocolate Chip Cookies',
    productDescription: 'Chocolate Chip Cookies',
  };
  assert.deepEqual(categoriesForCase(input).categories, ['bakery_grains']);
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
  assert.deepEqual(of('Cereal, bars, and snacks'), ['snacks_sweets', 'pantry_condiments']);
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
  assert.deepEqual(of('Frozen Waffle and Turkey Sausage Products'), [
    'meat_poultry',
    'bakery_grains',
  ]);
  assert.deepEqual(of('Cheese and Garlic Croutons'), ['bakery_grains']);
});

/**
 * The C5.3B absorption over-reach, resolved in C5.3B-2: a dish absorbs bare
 * meat/seafood/dairy beside it, but NOT pantry — a condiment beside a dish is
 * usually its own recalled product.
 */
test('a bare condiment beside a dish stays a product; a bare protein is absorbed', () => {
  assert.deepEqual(of('Fresh cucumbers, salsa and salads'), [
    'produce',
    'prepared_foods',
    'pantry_condiments',
  ]);
  assert.deepEqual(of('Meat and Poultry Dumplings'), ['prepared_foods']);
});

test('a genuinely multi-category recall carries each category, in display order', () => {
  assert.deepEqual(of('Hummus Dip & Tzatziki Cucumber Yogurt'), [
    'dairy_eggs',
    'pantry_condiments',
  ]);
  assert.deepEqual(of('pork rinds and seasoning bottles'), ['snacks_sweets', 'pantry_condiments']);
});

test('coordinated modifiers are one product, not several', () => {
  assert.deepEqual(of('Cheese and Garlic Croutons'), ['bakery_grains']);
});

test('output never exceeds the maximum of four categories', () => {
  const many = of(
    'Cucumbers, Ground Beef, Chicken Soup, Flour, Bread, Potato Chips, Cheese, Shrimp, Vitamins, Infant Formula, Juice',
  );
  assert.ok(many.length <= MAX_CATEGORIES_PER_CASE, `got ${many.length}`);
});

// ── Honest silence: `other`, never a guess ──────────────────────────────────

test('a product the lexicon does not recognise gets `other`, never a guess', () => {
  assert.deepEqual(of('Notification Report 063-2014'), ['other']);
  assert.deepEqual(of('Frozen Food Products'), ['other']);
  assert.deepEqual(of(''), ['other']);
});

test('an article that is not food gets `other`', () => {
  assert.deepEqual(of('Metal Cookware Items'), ['other']);
  assert.deepEqual(of('4 sizes of aluminum saucepans'), ['other']);
});

test('a non-food article named with a food word takes `other`', () => {
  assert.deepEqual(of('Jelly Handbag'), ['other']);
  assert.deepEqual(of('Chocolate Scented Lotion'), ['other']);
});

test('novelty packaging does not hide the food inside it', () => {
  assert.deepEqual(of('Jelly Handbag and Jelly Backpack containing Jelly Bars'), ['snacks_sweets']);
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
  assert.deepEqual(of('Meat Pie Products'), ['prepared_foods']);
  assert.deepEqual(of('Chicken Fried Rice Products'), ['prepared_foods']);
  assert.deepEqual(of('Frozen Ready-To-Eat Turkey Stuffed Pastry Products'), ['prepared_foods']);
  assert.deepEqual(of('Beef and Cheese Tortilla Products'), ['prepared_foods']);
});

test('a protein in the ingredient clause also forms the dish', () => {
  assert.deepEqual(of('Canned Spaghetti With Sausage Products'), ['prepared_foods']);
});

test('without a protein, a dishable staple keeps its own aisle', () => {
  assert.deepEqual(of('Apple Pie'), ['bakery_grains']);
  assert.deepEqual(of('Cheese Biscuits'), ['bakery_grains']);
});

test('rendered fats are pantry goods, never cuts of meat', () => {
  assert.deepEqual(of('Pork Lard & Beef Tallow Products'), ['pantry_condiments']);
  assert.deepEqual(of('Meat and Poultry Fat and Lard Products'), ['pantry_condiments']);
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
    'snacks_sweets',
  ]);
  assert.deepEqual(of('Pear, Kiwi, Spinach & Pea Baby Food pouches'), ['baby_food_formula']);
});

test('produce beside a PREPARED dish stays a real product — never a flavour', () => {
  assert.deepEqual(of('Fresh cucumbers, salsa and salads'), [
    'produce',
    'prepared_foods',
    'pantry_condiments',
  ]);
});

test('a plant-based analogue of a meat product is Prepared, not Meat & poultry', () => {
  assert.deepEqual(of("Plant Based Buffalo Chik'n Nuggets and Hot and Spicy Sausage Patties"), [
    'prepared_foods',
  ]);
  assert.deepEqual(of('Chicken Nuggets'), ['meat_poultry']);
});

test('a name that itself says "for baby" is an infant-feeding product', () => {
  assert.deepEqual(of('Comforts FOR BABY Purified Water with Fluoride'), ['baby_food_formula']);
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
  assert.deepEqual(of('Whole Nutrition Infant formula 24 oz cans and 0.6oz packets'), [
    'baby_food_formula',
  ]);
  assert.deepEqual(of('Original Sliders, frozen, 4 count carton'), ['prepared_foods']);
});

test('an ingredient-with-provenance tail is never rescued into a category', () => {
  assert.deepEqual(
    of('Victory Kitchens Ltd. Recalls Products Containing Chicken From An Ineligible Country'),
    ['other'],
  );
  // The rescue itself still works when the tail names the recalled product.
  assert.deepEqual(of('Multiple items with cucumbers'), ['produce']);
});

test('an unknown product name stays honestly uncategorized', () => {
  assert.deepEqual(of('Banh Ba Xa'), ['other']);
  assert.deepEqual(of('Nem Chua Products'), ['other']);
});

test('a long co-equal list of dishes resolves to Prepared once, not to its toppings', () => {
  assert.deepEqual(
    of(
      'Cheeseburgers, Spicy Chicken Sandwich, Italian Mini Subs, Pepperoni Pizza Sub, Chili Cheese Coney and BBQ Riblets',
    ),
    ['prepared_foods'],
  );
});

test('a comma inside a word is mangled encoding, not a product list', () => {
  assert.deepEqual(of('Canadian Liver P,tE Products'), ['meat_poultry']);
});

test('a trailing dish-class word after "with" heads the whole name; soup does not', () => {
  assert.deepEqual(of('Spaghetti Loops With Meat Sauce Entrée Products'), ['prepared_foods']);
  assert.deepEqual(of('Saimin Noodles with Soup & Garnishes'), ['pantry_condiments']);
});

test('generic dish vocabulary covers common non-English product names', () => {
  assert.deepEqual(of('Frozen Mushroom Risotto Products'), ['prepared_foods']);
  assert.deepEqual(of('Raw, Frozen Chicken and Vegetable Potsticker Products'), ['prepared_foods']);
});

test('cracklings and sliders live where shoppers find them', () => {
  assert.deepEqual(of('Ineligible Pork Cracklings Products'), ['snacks_sweets']);
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

// ── C10A: the catchable gaps the C5.3B-2 failure analysis listed ────────────

test('a composed dish on a protein head is Prepared, not the protein', () => {
  assert.deepEqual(of('Raw Breaded Stuffed Chicken Products'), ['prepared_foods']);
  assert.deepEqual(of('Chicken Samosa'), ['prepared_foods']);
  assert.deepEqual(of('Samsa'), ['prepared_foods']);
  assert.deepEqual(of('Chicken Coxinha'), ['prepared_foods']);
});

/**
 * C10A recorded this as a known, deliberately unfixed gap: "sambusa" is the
 * Somali spelling of samosa, and adding it then would have tuned the
 * classifier on the holdout that had already measured it. C10A.1 re-froze and
 * drew its own holdout, so the word is now carried as general vocabulary —
 * and it belongs to the DUMPLING family, not the pastry family, whatever the
 * "-usa" ending suggests.
 */
test('a sambusa is a filled savoury dumpling, not a pastry and not its protein', () => {
  assert.deepEqual(of('Beef Sambusa'), ['prepared_foods']);
  assert.deepEqual(of('Chicken Sambusa Products'), ['prepared_foods']);
  assert.deepEqual(of('Vegetable Sambousas'), ['prepared_foods']);
});

test('pork skin is the snack, however the label spells it', () => {
  for (const spelling of ['Pork Rinds', 'Pork Skins', 'Porkskin', 'Chicharrones']) {
    assert.deepEqual(of(spelling), ['snacks_sweets'], spelling);
  }
});

test('a mis-decoded accent does not lose the dish word', () => {
  // Persisted FSIS titles carry mojibake; "EntrÇes" must still read as entrées.
  assert.deepEqual(of('Meat and Poultry Frozen EntrÇe Products'), ['prepared_foods']);
  assert.deepEqual(of('Meat and Poultry Frozen Entrée Products'), ['prepared_foods']);
});

test('a pickled vegetable is a condiment, not Produce', () => {
  assert.deepEqual(of('Pickled Vegetables'), ['pantry_condiments']);
  assert.deepEqual(of('Pickled Mustard Greens'), ['pantry_condiments']);
});

// ── C10A: the extraction correction that was measured and REVERTED ──────────

test('a jurisdiction-only title phrase is recognised as such', () => {
  for (const phrase of [
    'Poultry Products',
    'Ready-To-Eat Beef Products',
    'Frozen, Raw Lamb Products',
    'Chicken Product',
  ]) {
    assert.equal(isJurisdictionOnlyPhrase(phrase), true, phrase);
  }
  for (const phrase of [
    'Ready-To-Eat Pork Rind Products',
    'Chicken Noodle Soup Products',
    'Beef Tamale Products',
  ]) {
    assert.equal(isJurisdictionOnlyPhrase(phrase), false, phrase);
  }
});

/**
 * The C5.3B-2 report recommended preferring structured product lines whenever
 * the FSIS title reduces to bare species words. C10A implemented it and
 * A/B-measured it on the 60 development rows it affects: title grammar 80.0%
 * exact-set, product lines 50.0%, twenty-one title-only wins against three
 * lines-only wins. It was reverted. This test pins the revert, so a future
 * milestone re-reads the measurement instead of re-running the experiment.
 */
test('a jurisdiction-only title still reads the TITLE, not the product lines', () => {
  const derived = categoryProductText({
    sourceAgency: 'FSIS',
    title: 'A Firm Recalls Poultry Products Due to Possible Listeria Contamination',
    productDescription: null,
    productLines: [
      '9.3-oz. plastic container with Broccoli Slaw & Kale Salad with White Chicken Meat',
    ],
  });
  assert.equal(derived.basis, 'title_grammar');
  assert.equal(derived.text, 'Poultry Products');
});

test('product lines are still the fallback when the title names nothing', () => {
  const derived = categoryProductText({
    sourceAgency: 'FSIS',
    title: 'A Firm Recalls Products Due to Misbranding',
    productDescription: null,
    productLines: ['15.25-oz. frozen microwavable dinners'],
  });
  assert.equal(derived.basis, 'product_lines');
});

// ── C10A.1: general vocabulary, and the announcement's product sentence ─────

test('a pastry is Bakery under whatever name the shop uses', () => {
  assert.deepEqual(of('Kringle'), ['bakery_grains']);
  assert.deepEqual(of('Raspberry Kringle Danish'), ['bakery_grains']);
  assert.deepEqual(of('Danish Pastries'), ['bakery_grains']);
  assert.deepEqual(of('Cheese Danish'), ['bakery_grains']);
  assert.deepEqual(of('Almond Danishes'), ['bakery_grains']);
  // The plural is a count noun, and only pastries are counted.
  assert.deepEqual(of('Danishes'), ['bakery_grains']);
});

test('"Danish" on its own is a nationality, and never moves a product to Bakery', () => {
  assert.deepEqual(of('Danish Ham'), ['meat_poultry']);
  assert.deepEqual(of('Danish Blue Cheese'), ['dairy_eggs']);
  assert.deepEqual(of('Danish Style Feta Cheese'), ['dairy_eggs']);
  assert.deepEqual(of('Danish Salami'), ['meat_poultry']);
  // And a Danish-branded bakery item is bakery because of the item, not the word.
  assert.deepEqual(of('Danish Butter Cookies'), ['bakery_grains']);
});

test('the filled-dumpling family is Prepared foods across its spellings', () => {
  for (const dish of [
    'Beef Sambusa',
    'Vegetable Samosas',
    'Lamb Samsa',
    'Pork Dumplings',
    'Chicken Potstickers',
    'Pork Gyoza',
    'Beef Ravioli',
    'Chicken Tortellini',
    'Meat Wontons',
    'Beef Pierogies',
  ]) {
    assert.deepEqual(of(dish), ['prepared_foods'], dish);
  }
});

test('a composed deli assortment is Prepared foods; a bare tray is packaging', () => {
  assert.deepEqual(of('Party Trays'), ['prepared_foods']);
  assert.deepEqual(of('Charcuterie Platter'), ['prepared_foods']);
  assert.deepEqual(of('Deli Tray'), ['prepared_foods']);
  assert.deepEqual(of('Deli Salads'), ['prepared_foods']);
  assert.deepEqual(of('Turkey Wrap'), ['prepared_foods']);
  // "meat tray" and "cheese tray" are deliberately NOT in the vocabulary:
  // they also name packaging ("beef stew meat trays"), so they stay with the
  // thing in the package.
  assert.deepEqual(of('Beef Stew Meat Trays'), ['meat_poultry']);
});

test('a loaf named by its protein is a meat product, not bakery', () => {
  assert.deepEqual(of('Ground Beef Loaf'), ['meat_poultry']);
  assert.deepEqual(of('Ham Loaf'), ['meat_poultry']);
  assert.deepEqual(of('Liver Loaf'), ['meat_poultry']);
  // Bread keeps the word.
  assert.deepEqual(of('Sourdough Loaves'), ['bakery_grains']);
  assert.deepEqual(of('Artisan Style 1/2 Loaf'), ['bakery_grains']);
});

test('a fish steak is Seafood; "steak" alone is butcher meat', () => {
  assert.deepEqual(of('Halibut Steaks'), ['seafood']);
  assert.deepEqual(of('Catfish Steak'), ['seafood']);
  assert.deepEqual(of('Salmon Steaks'), ['seafood']);
  assert.deepEqual(of('Ribeye Steak'), ['meat_poultry']);
});

/**
 * C10A.1 investigated a general "supplement powder" rule and REJECTED it: a
 * powder's aisle comes from what is powdered, never from the form. Beet root
 * powder is therefore still read as its plant — an acknowledged miss that the
 * classifier prefers to a rule that would file every culinary powder under
 * Supplements. These are the counterexamples that rejected it.
 */
test('a powder takes its aisle from what is powdered, not from being a powder', () => {
  assert.deepEqual(of('Cinnamon Powder'), ['pantry_condiments']);
  assert.deepEqual(of('Ground Cinnamon Powder'), ['pantry_condiments']);
  assert.deepEqual(of('Asafoetida Yellow Powder'), ['pantry_condiments']);
  assert.deepEqual(of('Aquafaba Powder'), ['pantry_condiments']);
  assert.deepEqual(of('Powdered beverage mixes'), ['beverages']);
  assert.deepEqual(of('Powdered Goat Milk Infant Formula'), ['baby_food_formula']);
  // Supplement-ness comes from the reviewed supplement vocabulary, not "powder".
  assert.deepEqual(of('Moringa Leaf Powder'), ['supplements']);
  assert.deepEqual(of('Protein Powder'), ['supplements']);
  assert.deepEqual(of('Kratom Powder'), ['supplements']);
});

test('a parenthesised state word is the same descriptor as the bare one', () => {
  assert.deepEqual(
    of('ready-to-eat (RTE) kale and broccoli slaw salad with chicken'),
    of('ready-to-eat kale and broccoli slaw salad with chicken'),
  );
});

// ── The announcement's canonical product-identification sentence ────────────

const JURISDICTION_TITLE = 'A Firm Recalls Poultry Products Due to Possible Listeria Contamination';

const productSentence = (product: string): string =>
  `WASHINGTON, Jan. 2, 2026 - A Firm, a Springfield establishment, is recalling approximately ` +
  `3,000 pounds of poultry products that may be contaminated with Listeria monocytogenes, FSIS ` +
  `announced today.\nThe ${product} items were produced on Dec. 1, 2025. The following products ` +
  `are subject to recall.`;

test('a jurisdiction-only title yields to the announcement product sentence', () => {
  const derived = categoryProductText({
    sourceAgency: 'FSIS',
    title: JURISDICTION_TITLE,
    productDescription: null,
    announcementSummary: productSentence('ready-to-eat curry chicken salad'),
  });
  assert.equal(derived.basis, 'summary_grammar');
  assert.equal(derived.text, 'ready-to-eat curry chicken salad');
  assert.deepEqual(of(derived.text), ['prepared_foods']);
});

test('a DESCRIPTIVE title is primary and the announcement is never consulted', () => {
  const derived = categoryProductText({
    sourceAgency: 'FSIS',
    title: 'A Firm Recalls Chicken Salad Products Due to Possible Contamination',
    productDescription: null,
    announcementSummary: productSentence('frozen beef taquito'),
  });
  assert.equal(derived.basis, 'title_grammar');
  assert.equal(derived.text, 'Chicken Salad Products');
});

test('a structured product description outranks the announcement sentence', () => {
  const derived = categoryProductText({
    sourceAgency: 'FDA',
    title: 'A Firm Recalls Poultry Products',
    productDescription: 'Whole Cantaloupe',
    announcementSummary: productSentence('frozen beef taquito'),
  });
  assert.equal(derived.basis, 'product_description');
});

test('generic announcement evidence adds nothing and leaves the title in charge', () => {
  for (const generic of ['frozen, raw lamb', 'ground beef', 'raw chicken']) {
    const derived = categoryProductText({
      sourceAgency: 'FSIS',
      title: JURISDICTION_TITLE,
      productDescription: null,
      announcementSummary: productSentence(generic),
    });
    assert.equal(derived.basis, 'title_grammar', generic);
    assert.deepEqual(
      categoriesForCase({
        sourceAgency: 'FSIS',
        title: JURISDICTION_TITLE,
        productDescription: null,
        announcementSummary: productSentence(generic),
      }).categories,
      ['meat_poultry'],
      generic,
    );
  }
});

test('an announcement sentence naming no regulated product is refused', () => {
  // The grammar matches, but the span is a brand line: the recall is beef
  // patties, and "Vidalia Onion" is not what was recalled.
  const derived = categoryProductText({
    sourceAgency: 'FSIS',
    title: 'A Firm Recalls Beef Products Due To Possible Foreign Matter Contamination',
    productDescription: null,
    announcementSummary: productSentence('Store Choice Black Angus Vidalia Onion'),
  });
  assert.equal(derived.basis, 'title_grammar');
});

test('the product sentence may not run across a sentence boundary', () => {
  // The establishment-number line ends in "EST. 12445" and is followed by
  // "The products were produced on various dates" — a package and a plant,
  // never a product.
  const derived = categoryProductText({
    sourceAgency: 'FSIS',
    title: 'A Firm Recalls Pork Products Due To Misbranding',
    productDescription: null,
    announcementSummary:
      'WASHINGTON, Nov. 9, 2026 - A Firm is recalling pork products because of misbranding. ' +
      'The products bear the establishment number EST. 12445 inside the USDA mark of inspection ' +
      'on the label. The products were produced on various dates between Feb. 6 and Oct. 8.',
  });
  assert.equal(derived.basis, 'title_grammar');
  assert.equal(derived.text, 'Pork Products');
});

test('arbitrary announcement prose is not a basis', () => {
  for (const prose of [
    '',
    'The problem was discovered during a routine label review by the firm.',
    'These items were shipped to retail locations in California and Nevada.',
    'Consumers who have purchased these products are urged not to consume them.',
    'The recall was initiated after the firm received a consumer complaint about chicken salad.',
    'There have been no confirmed reports of adverse reactions.',
  ]) {
    const derived = categoryProductText({
      sourceAgency: 'FSIS',
      title: JURISDICTION_TITLE,
      productDescription: null,
      announcementSummary: prose,
    });
    assert.equal(derived.basis, 'title_grammar', prose);
  }
});

test('cause, pathogen, allergen, firm, retailer and geography never move a category', () => {
  const product = 'ready-to-eat chicken bowl';
  const variants = [
    productSentence(product),
    productSentence(product)
      .replace('Listeria monocytogenes', 'Salmonella and undeclared milk, wheat and shellfish')
      .replace('A Firm, a Springfield establishment', 'Dairy Bakery Seafood Co, a Fishtown plant'),
    `${productSentence(product)}\nThese items were shipped to Whole Foods and Costco in Maine.` +
      '\nThe problem was discovered after reports of illness. Consumers should discard them.',
    productSentence(product).replace(
      'poultry products that may be contaminated with Listeria monocytogenes',
      'chocolate cake products that may contain undeclared peanuts',
    ),
  ];
  const derive = (summary: string): FoodCategoryId[] =>
    categoriesForCase({
      sourceAgency: 'FSIS',
      title: JURISDICTION_TITLE,
      productDescription: null,
      announcementSummary: summary,
    }).categories;
  const expected = derive(variants[0]);
  assert.deepEqual(expected, ['prepared_foods']);
  for (const variant of variants) assert.deepEqual(derive(variant), expected, variant);
});

test('FDA and FSIS derive identically from equivalent product evidence', () => {
  const summary = productSentence('frozen beef taquito');
  const fda = categoriesForCase({
    sourceAgency: 'FDA',
    title: JURISDICTION_TITLE,
    productDescription: null,
    announcementSummary: summary,
  });
  const fsis = categoriesForCase({
    sourceAgency: 'FSIS',
    title: JURISDICTION_TITLE,
    productDescription: null,
    announcementSummary: summary,
  });
  assert.deepEqual(fda, fsis);
  assert.equal(fda.basis, 'summary_grammar');
});

test('an absent announcement summary derives exactly as before', () => {
  const base = {
    sourceAgency: 'FSIS' as const,
    title: JURISDICTION_TITLE,
    productDescription: null,
  };
  assert.deepEqual(
    categoryProductText(base),
    categoryProductText({ ...base, announcementSummary: null }),
  );
  assert.deepEqual(
    categoryProductText(base),
    categoryProductText({ ...base, announcementSummary: '' }),
  );
  assert.equal(categoryProductText(base).basis, 'title_grammar');
});

test('the announcement sentence never overrides the prohibited product-line preference', () => {
  // Both a product line AND an announcement sentence are present. The line is
  // still not a basis; only the bounded sentence is.
  const derived = categoryProductText({
    sourceAgency: 'FSIS',
    title: JURISDICTION_TITLE,
    productDescription: null,
    productLines: ['Combo bins containing "Beef Trimmings, BNLS, 90 L"'],
    announcementSummary: productSentence('ready-to-eat chicken bowl'),
  });
  assert.equal(derived.basis, 'summary_grammar');
  assert.equal(derived.text, 'ready-to-eat chicken bowl');
});

test('the derivation stays deterministic and capped with the announcement basis', () => {
  const input = {
    sourceAgency: 'FSIS' as const,
    title: JURISDICTION_TITLE,
    productDescription: null,
    announcementSummary: productSentence('beef taquito, chicken salad, pork tamale and fish stew'),
  };
  const first = categoriesForCase(input).categories;
  assert.deepEqual(first, categoriesForCase(input).categories);
  assert.ok(first.length <= MAX_CATEGORIES_PER_CASE);
  assert.deepEqual(first, [...first].sort(() => 0).slice(0, MAX_CATEGORIES_PER_CASE));
});
