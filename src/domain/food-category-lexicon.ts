/**
 * Reviewed lexical data for food-category matching (Phases C5.3B / C5.3B-2).
 *
 * This file is DATA. It holds no matching logic — that lives in
 * food-category-matcher.ts — so the vocabulary of product language can be
 * reviewed, extended and diffed by a human without reading an algorithm.
 *
 * ## What may be added here
 *
 * Reusable product-language patterns only: words and phrases shoppers use for
 * the thing in the package. Every entry must be justifiable to someone who has
 * never seen our corpus.
 *
 * ## What may NEVER be added here
 *
 * A term that repairs one record. No brand names, no firm names, no retailer
 * names, no case ids, no full titles, no allergen or hazard words. If an entry
 * would only ever match a single announcement, it is overfitting and belongs
 * nowhere. The tell: an entry whose `note` has to name a company.
 *
 * ## The two layers
 *
 * COMPOUND_TERMS are multi-word phrases matched FIRST, claiming their whole
 * span. They exist because English food names bury false friends in the head
 * position: a "crab cake" is not bakery, an "ice cream bar" is not a snack bar,
 * a "frying mix" is not seafood, "baby arugula" is not baby food. Once a
 * compound claims its span no single word inside it can be matched again.
 *
 * HEAD_TERMS are the ordinary product words. They are matched over whatever
 * span the compounds left, and the LAST surviving match in a phrase wins —
 * English puts the head noun last, so "Dark Chocolate Cherry Granola" is
 * granola, not chocolate and not cherries.
 *
 * ## Structural roles (C5.3B-2)
 *
 * The C5.3B locked evaluation failed (74.2% against a 95% gate), and the
 * failure analysis showed the losses were STRUCTURAL, not lexical: English
 * productively forms dish names ("meat pie", "chicken fried rice", "turkey
 * stuffed pastry") whose head noun is a staple, and FDA marketing names
 * postpose flavours ("Iced Tea Lemon"). A flat word list cannot express
 * either. The role exports below give the matcher a small ontology —
 * which staples form dishes with a protein, which categories treat a fruit
 * word as a flavour, which markers mark a meat analogue or an infant
 * audience — so those patterns are handled by RULES that generalize, not by
 * memorizing one title at a time.
 */

import type { FoodCategoryId } from './food-category';

export interface LexiconEntry {
  /**
   * Regular-expression source, matched case-insensitively. Keep these literal
   * and readable; the matcher supplies word boundaries and plural tolerance.
   */
  term: string;
  category: FoodCategoryId;
  /** Why this entry exists, when the reason is not self-evident. */
  note?: string;
}

/**
 * Multi-word product phrases, matched before any single word.
 *
 * Grouped by the job each group does, because that is what a reviewer needs to
 * check: is this phrase really how people name a product, and is the category
 * really the product rather than an ingredient?
 */
export const COMPOUND_TERMS: readonly LexiconEntry[] = [
  // ── False friends: the head noun belongs to another category ─────────────
  { term: 'crab cakes?', category: 'seafood', note: 'cake here is a patty, not bakery' },
  { term: 'fish (?:balls?|cakes?|sticks?|fillets?|patt(?:y|ies))', category: 'seafood' },
  { term: 'salmon burgers?', category: 'seafood' },
  { term: 'seafood burgers?', category: 'seafood' },
  { term: 'shrimp (?:meat|paste|scampi|skewers?)', category: 'seafood' },
  { term: 'cocktail shrimp', category: 'seafood', note: 'cocktail is a serving style' },
  { term: 'shrimp cocktail', category: 'seafood' },
  { term: 'crab ?meats?', category: 'seafood' },
  {
    term: '(?:claw|lump|leg) meats?',
    category: 'seafood',
    note: 'crab-grade names; "meat" here is never butcher meat',
  },
  { term: 'imitation crab', category: 'seafood' },
  {
    term: 'ice cream (?:bars?|cakes?|sandwich(?:es)?|cones?|cups?|products?|treats?)',
    category: 'dairy_eggs',
    note: 'a novelty is still ice cream, not a snack bar or bakery',
  },
  {
    term: 'cracker sandwich(?:es)?',
    category: 'snacks_sweets',
    note: 'a snack, not a deli sandwich',
  },
  { term: 'cookie sandwich(?:es)?', category: 'bakery_grains' },
  { term: 'sandwich cookies?', category: 'bakery_grains' },
  { term: 'cheese (?:curds?|sauce|spread|dip|powder)', category: 'dairy_eggs' },
  { term: 'cottage cheese', category: 'dairy_eggs' },
  { term: 'cream cheese', category: 'dairy_eggs' },
  { term: 'sour cream', category: 'dairy_eggs' },
  { term: 'peanut butter', category: 'pantry_condiments', note: 'a spread, not confectionery' },
  { term: '(?:almond|cashew|sunflower|seed|nut) butters?', category: 'pantry_condiments' },
  { term: 'apple ?sauce', category: 'pantry_condiments' },
  {
    term: 'baby (?:arugula|spinach|carrots?|greens?|kale|corn|bella mushrooms?|portabellas?)',
    category: 'produce',
    note: 'baby is a size, not an audience',
  },
  { term: 'baby back ribs?', category: 'meat_poultry', note: 'baby is a cut, not an audience' },
  { term: 'coconut (?:milk|water|cream)', category: 'beverages' },
  {
    term: '(?:almond|oat|soy|rice|cashew) milk',
    category: 'beverages',
    note: 'plant milks sit with drinks, not dairy',
  },
  { term: 'milk chocolates?', category: 'snacks_sweets', note: 'milk is the chocolate style' },
  { term: '(?:dark|white|semi ?sweet) chocolates?', category: 'snacks_sweets' },
  {
    term: 'chocolate (?:bars?|chips?|chunks?|nonpareils?|pareils?|truffles?|raisins?|almonds?|peanuts?|pretzels?|nuts?|cherries|macadamias?)',
    category: 'snacks_sweets',
  },
  {
    term: '(?:chocolate|yogurt|candy)[- ]?(?:covered|filled|dipped|coated) [a-z]+',
    category: 'snacks_sweets',
    note: 'the coating or filling is the confection; the covered thing is not the category',
  },
  {
    term: "cookies (?:and|&|'?n'?) cream",
    category: 'dairy_eggs',
    note: 'a flavour name of a dairy product, not cookies plus cream',
  },
  { term: 'butter ?milk', category: 'dairy_eggs' },
  { term: 'corn dogs?', category: 'meat_poultry' },
  { term: 'hot ?dogs?', category: 'meat_poultry' },
  {
    term: 'pretzel dogs?',
    category: 'prepared_foods',
    note: 'a wrapped sausage is a dish, not a pretzel',
  },
  { term: 'head cheese', category: 'meat_poultry', note: 'charcuterie, no dairy involved' },
  {
    term: '(?:bison|beef|turkey|lamb|veal|venison|elk|chicken) burgers?',
    category: 'meat_poultry',
    note: 'a raw patty is meat; a made burger is a sandwich',
  },
  { term: '(?:chicken|pork|veal|beef|turkey) cutlets?', category: 'meat_poultry' },
  {
    term: 'pork ?(?:rinds?|skins?)|chicharron(?:es)?|porkskins?',
    category: 'snacks_sweets',
    note: 'shelved and eaten as a snack; labels spell it porkskin as one word',
  },
  { term: 'meat snacks?', category: 'meat_poultry', note: 'jerky and sticks, not the snack aisle' },
  { term: '(?:pork|beef|meat|turkey|chicken|venison|elk) snack sticks?', category: 'meat_poultry' },
  { term: 'ham (?:and )?cheese loaf', category: 'meat_poultry', note: 'a deli luncheon loaf' },
  { term: '(?:monkfish|cod|fish) livers?', category: 'seafood' },
  { term: 'soybean paste|bean paste', category: 'pantry_condiments' },
  {
    term: 'chicken (?:nuggets?|strips?|wings?|tenders?|patt(?:y|ies)|fingers?)',
    category: 'meat_poultry',
  },
  { term: 'turkey burgers?', category: 'meat_poultry' },
  { term: 'beef (?:jerky|patt(?:y|ies)|sticks?)', category: 'meat_poultry' },
  { term: 'corned beef', category: 'meat_poultry' },
  {
    term: '(?:beef|pork|duck|chicken) (?:tallows?|lards?|fats?)',
    category: 'pantry_condiments',
    note: 'rendered cooking fats are shelved with oils, not cuts of meat',
  },
  {
    term: 'blood (?:curds?|tofu|cakes?|sausages?)',
    category: 'meat_poultry',
    note: 'blood curd/tofu is a meat product; no dairy curd involved',
  },
  {
    term: '(?:luncheon|olive|pickle|pimento) lo(?:af|aves)',
    category: 'meat_poultry',
    note: 'deli luncheon loaves are sliced meats, not bakery',
  },
  { term: 'croutons?', category: 'bakery_grains' },
  { term: 'bread ?crumbs?', category: 'bakery_grains' },
  { term: 'potato bread', category: 'bakery_grains' },
  {
    term: '(?:potato|sweet potato|corn|tortilla|veggie|vegetable) chips?',
    category: 'snacks_sweets',
    note: 'a chip is a snack whatever it is made from',
  },
  { term: 'potato sourdough', category: 'bakery_grains' },
  { term: 'sweet corn (?:pancakes?|cachapas?)', category: 'bakery_grains' },

  // ── Mixes and bases: the product is the dry good, not its flavour ────────
  {
    term: '(?:frying|batter|baking|pancake|waffle|cake|muffin|bread|brownie|biscuit|stuffing|do(?:ugh)?nut) mix(?:es)?',
    category: 'pantry_condiments',
  },
  {
    term: 'pico de gallo',
    category: 'pantry_condiments',
    note: 'a fresh salsa, sold as a condiment',
  },
  { term: 'pounded yam', category: 'pantry_condiments', note: 'a dry staple flour, not fresh yam' },
  { term: 'aquafaba', category: 'pantry_condiments' },
  { term: 'snack mix(?:es)?|botana', category: 'snacks_sweets' },
  { term: 'pancake (?:and |& )?waffle (?:complete|mix(?:es)?)', category: 'pantry_condiments' },
  {
    term: '(?:soup|broth|gravy|bouillon) (?:base|mix(?:es)?|powder|cubes?)',
    category: 'pantry_condiments',
  },
  { term: '(?:drink|beverage|cocktail|lemonade|smoothie) mix(?:es)?', category: 'beverages' },
  { term: 'seasoning (?:mix(?:es)?|blends?|packets?)', category: 'pantry_condiments' },
  { term: 'spice (?:mix(?:es)?|blends?)', category: 'pantry_condiments' },
  {
    term: '(?:salad|sandwich|taco|wing|pizza|pasta|meat|barbecue|bbq|hot) sauce',
    category: 'pantry_condiments',
  },
  { term: 'salad dressings?', category: 'pantry_condiments' },
  {
    term: '(?:cilantro|chipotle|jalape[nñ]o|garlic|avocado|lime) crema',
    category: 'pantry_condiments',
    note: 'a flavoured crema is a table sauce; bare crema stays the dairy staple',
  },

  // ── Composed dishes: a single dish, never its parts ──────────────────────
  { term: "macaroni (?:and|&|n'?) cheese", category: 'prepared_foods' },
  { term: 'chicken (?:and|&) (?:rice|waffles?|dumplings?|noodles?)', category: 'prepared_foods' },
  { term: '(?:rice|beans) (?:and|&) (?:beans|rice)', category: 'prepared_foods' },
  {
    term: '(?:beef|chicken|pork|turkey|vegetable|veggie) (?:enchiladas?|burritos?|tacos?|tamales?|empanadas?|lasagnas?|casseroles?|pot pies?|wraps?|bowls?|kabobs?|skewers?)',
    category: 'prepared_foods',
  },
  {
    term: '(?:chicken|tuna|egg|pasta|potato|macaroni|seafood|shrimp|crab|ham|garden|greek|caesar|cranberry) salads?',
    category: 'prepared_foods',
    note: 'a made salad is a dish, not its protein',
  },
  {
    term: 'salad kits?',
    category: 'produce',
    note: 'a bagged salad is produce a shopper assembles',
  },
  { term: '(?:chopped|garden|slaw|coleslaw) (?:salad )?kits?', category: 'produce' },
  { term: 'meal kits?', category: 'prepared_foods' },
  {
    term: '(?:chicken|beef|pork|turkey|vegetable|noodle|wonton|tomato|potato|clam|corn) (?:noodle )?(?:soups?|chowders?|bisques?|stews?|chilis?)',
    category: 'prepared_foods',
  },
  { term: 'ready ?meals?', category: 'prepared_foods' },
  { term: 'deli (?:items?|meals?|salads?)', category: 'prepared_foods' },
  { term: 'party trays?', category: 'prepared_foods' },
  { term: 'lunch kits?', category: 'prepared_foods' },
  {
    term: '(?:spaghetti|pasta|macaroni|noodles?) (?:and|&) (?:meatballs?|cheese|chicken|beef|pork|sauce|gravy)',
    category: 'prepared_foods',
    note: 'a named dish, not two staples',
  },
  {
    term: 'stuffed (?:mushrooms?|peppers?|shells?|clams?|cabbages?|chicken(?: breasts?)?)',
    category: 'prepared_foods',
    note: 'the stuffing composes a dish; a stuffed breast is not a cut',
  },
  { term: 'rice balls?', category: 'prepared_foods' },
  {
    term: 'pickled (?:vegetables?|radish(?:es)?|turnips?|mustard greens?|cabbages?)',
    category: 'pantry_condiments',
    note: 'a jarred condiment, not the fresh vegetable',
  },
  {
    term: 'egg rolls?|spring rolls?',
    category: 'prepared_foods',
    note: 'no egg category here — it is a wrapper',
  },
  { term: '(?:pork|meat|chicken|bbq|steamed) buns?', category: 'prepared_foods' },
  { term: 'dirty rice', category: 'prepared_foods' },
  { term: '(?:meat|chicken|beef|pork|turkey|poultry|seafood) pasta', category: 'prepared_foods' },
  { term: "shepherd'?s pies?|cottage pies?", category: 'prepared_foods' },
  {
    term: '(?:pork|meat|chicken|bbq|steamed) (?:mini |small |large )?buns?',
    category: 'prepared_foods',
  },
  {
    term: 'street corn|elote',
    category: 'prepared_foods',
    note: 'a named dish, not an ear of corn',
  },
  {
    term: 'bagged salads?',
    category: 'produce',
    note: 'bagged greens are produce; made salads are dishes',
  },
  { term: 'sushi (?:rolls?|products?)?', category: 'prepared_foods' },
  { term: 'breakfast (?:sandwich(?:es)?|burritos?|bowls?)', category: 'prepared_foods' },
  {
    term: 'fried (?:rice|noodles?)',
    category: 'prepared_foods',
    note: 'a dish name whatever precedes it',
  },
  { term: 'lo mein|chow mein|pad thai|chow fun', category: 'prepared_foods' },
  { term: 'sh(?:u|iu) ?mai|siu ?mai', category: 'prepared_foods', note: 'dim-sum dumpling names' },
  { term: 'banh mi', category: 'prepared_foods' },
  {
    term: 'banh pia',
    category: 'bakery_grains',
    note: 'a Vietnamese filled pastry, like adding "mooncake"',
  },
  {
    term: 'store[- ]?(?:prepared|made) (?:items?|foods?|products?|meals?|dish(?:es)?)',
    category: 'prepared_foods',
    note: 'deli-counter language for made-on-site dishes',
  },
  { term: 'salad mix(?:es)?', category: 'produce', note: 'bagged mixes, like salad kits' },

  // ── Baby: only where the product is sold for infants ─────────────────────
  { term: '(?:infant|baby|toddler) formula', category: 'baby_food_formula' },
  { term: 'formula (?:powder|products?)', category: 'baby_food_formula' },
  { term: 'baby foods?', category: 'baby_food_formula' },
  {
    term: '(?:infant|baby) (?:cereals?|purees?|snacks?|puffs?|rice)',
    category: 'baby_food_formula',
  },
  { term: 'teething (?:sticks?|biscuits?|wafers?|rings?)', category: 'baby_food_formula' },

  // ── Supplements: the dose form is the product ────────────────────────────
  { term: '(?:dietary|herbal|nutritional|food) supplements?', category: 'supplements' },
  { term: '(?:protein|green|superfood|collagen|greens) powders?', category: 'supplements' },
  {
    term: '(?:weight ?loss|energy|immune|detox) (?:supplements?|capsules?|tablets?|powders?)',
    category: 'supplements',
  },

  // ── Drinks whose head word is generic ────────────────────────────────────
  { term: '(?:milk|bubble|iced|green|black|herbal|chai) teas?', category: 'beverages' },
  { term: 'bloody mary', category: 'beverages' },
  { term: 'fruit punch', category: 'beverages' },
  {
    term: 'frozen dessert',
    category: 'dairy_eggs',
    note: 'the legal name for an ice-cream substitute',
  },
  { term: '(?:coffee|tea) (?:drinks?|beverages?|pods?|grounds?|creamers?)', category: 'beverages' },
  { term: '(?:fruit|apple|orange|grape|vegetable) juices?', category: 'beverages' },
  { term: 'nutrition(?:al)? (?:shakes?|drinks?)', category: 'beverages' },

  // ── Bakery vs snack, where both words appear ─────────────────────────────
  { term: 'cheese ?cakes?', category: 'bakery_grains' },
  {
    term: 'fruit (?:tarts?|pies?|cakes?|breads?)',
    category: 'bakery_grains',
    note: 'the fruit is a filling',
  },
  {
    term: '(?:apple|cherry|pumpkin|pecan|peach|berry|lemon) (?:pies?|tarts?|cakes?|turnovers?|strudels?|danishes?)',
    category: 'bakery_grains',
  },
  { term: 'granola (?:bars?|clusters?)', category: 'snacks_sweets' },
  { term: '(?:protein|snack|energy|nutrition|cereal|fruit) bars?', category: 'snacks_sweets' },
  { term: '(?:energy|protein) (?:balls?|bites?)', category: 'snacks_sweets' },
  {
    term: 'chanachur|namkeen|bhujia|panjiri|pinni|la+ddoo?|barfi|jalebi',
    category: 'snacks_sweets',
    note: 'South Asian sweet and savoury snack names',
  },
  { term: 'trail mix(?:es)?', category: 'snacks_sweets' },
  { term: 'party mix(?:es)?', category: 'snacks_sweets' },
  { term: 'popcorn', category: 'snacks_sweets' },
  {
    term: '(?:popped )?water lily seeds?',
    category: 'snacks_sweets',
    note: 'makhana — popped and eaten like popcorn, not a pantry seed',
  },
  {
    term: 'onion (?:flavou?red )?rings?',
    category: 'snacks_sweets',
    note: 'shelf-stable snack rings; the flavour word sits inside the name',
  },
  {
    term: '(?:waffle|sugar|ice cream) cones?',
    category: 'snacks_sweets',
    note: 'cones sold as a treat component, filled or empty',
  },

  // ── Pantry goods whose head word is a false friend ───────────────────────
  {
    term: '(?:processing|curing|brining) kits?',
    category: 'pantry_condiments',
    note: 'a seasoning/curing kit is a pantry good, not a meal kit',
  },

  // ── Baby audience stated in the name ─────────────────────────────────────
  {
    term: 'nursery water',
    category: 'baby_food_formula',
    note: 'water sold explicitly for preparing infant feeds',
  },
];

/**
 * Single-word and simple product heads.
 *
 * Order does not matter: the matcher resolves overlaps by length and then
 * takes the last surviving match in each phrase.
 */
export const HEAD_TERMS: readonly LexiconEntry[] = [
  // ── Produce ──────────────────────────────────────────────────────────────
  { term: 'cantaloupes?|honeydews?|melons?|watermelons?', category: 'produce' },
  { term: 'peach(?:es)?|nectarines?|plums?|apricots?|prunes?', category: 'produce' },
  {
    term: 'apples?|pears?|bananas?|mangos?|mangoes|papayas?|pineapples?|avocados?',
    category: 'produce',
  },
  {
    term: 'grapes?|raisins?|berr(?:y|ies)|strawberr(?:y|ies)|blueberr(?:y|ies)|raspberr(?:y|ies)|blackberr(?:y|ies)|cranberr(?:y|ies)|cherr(?:y|ies)',
    category: 'produce',
  },
  {
    term: 'lemons?|limes?|oranges?|grapefruits?|kiwis?|figs?|longans?|lychees?|persimmons?|pomegranates?|guavas?',
    category: 'produce',
  },
  {
    term: 'medjool dates?|date (?:paste|syrup|sugar)',
    category: 'produce',
    note: 'bare "date" is a calendar word in recall text',
  },
  { term: 'fruits?', category: 'produce' },
  {
    term: 'cucumbers?|tomatoe?s?|onions?|potatoes?|carrots?|celery|lettuce|romaine|spinach|kale|arugula',
    category: 'produce',
  },
  {
    term: 'broccoli|cauliflower|peppers?|jalapenos?|jalapeños?|squash(?:es)?|zucchinis?|cabbages?|asparagus|beets?|radish(?:es)?|leeks?|scallions?|peas?|florets?|corn',
    category: 'produce',
  },
  {
    term: 'mushrooms?|enoki|garlic|ginger|eggplants?|okra|artichokes?|yams?|cassava|plantains?|shallots?|coconuts?',
    category: 'produce',
  },
  { term: 'vegetables?|veggies?|produce|greens', category: 'produce' },
  { term: 'sprouts?|alfalfa', category: 'produce' },
  { term: 'cilantro|parsley|basil|dill|rosemary|thyme|scallion', category: 'produce' },
  { term: 'seaweed|nori|kelp|lily flowers?|bamboo shoots?|fungus|fungi', category: 'produce' },

  // ── Meat & poultry ───────────────────────────────────────────────────────
  {
    term: 'beef|steaks?|briskets?|veal|bison|meatloaf|meatballs?|koftas?',
    category: 'meat_poultry',
  },
  {
    term: 'pork|bacon|hams?|chorizos?|sausages?|prosciutto|pepperoni|salam[ei]|carnitas|charcuterie|kielbasa|bratwurst',
    category: 'meat_poultry',
  },
  {
    term: 'franks?|links?|patt(?:y|ies)|nuggets?',
    category: 'meat_poultry',
    note: 'generic butcher-counter forms; analogue markers move plant versions to Prepared',
  },
  { term: 'chicken|turkey|poultry|ducks?|hens?|quail', category: 'meat_poultry' },
  { term: 'goat|lamb|mutton|rabbits?|venison|elk|goose', category: 'meat_poultry' },
  { term: 'meats?', category: 'meat_poultry' },
  { term: 'jerky|pastrami|bologna|pat[eé]|liverwurst|livers?', category: 'meat_poultry' },
  {
    term: 'ribs?|tenderloins?|drumsticks?|thighs?|breasts?|chucks?|briskets?',
    category: 'meat_poultry',
  },
  { term: 'mortadella|boudin|squab|wieners?|frankfurters?|head ?cheese', category: 'meat_poultry' },
  {
    term: 'ribeyes?|carcass(?:es)?|sirloins?|chops?|roasts?|shanks?|loins?',
    category: 'meat_poultry',
  },

  // ── Seafood ──────────────────────────────────────────────────────────────
  {
    term: 'salmon|tuna|tilapia|cod(?:fish)?|halibut|herrings?|mackerel|trout|catfish|snappers?|flounder|sardines?|anchov(?:y|ies)',
    category: 'seafood',
  },
  {
    term: 'smelts?|mullets?|gob(?:y|ies)|capelin|monkfish|pollock|haddock|eels?|swai|sashimi|caviar|roe|vobla',
    category: 'seafood',
  },
  { term: 'fish|seafood|siluriformes', category: 'seafood' },
  {
    term: 'shrimps?|prawns?|crabs?|lobsters?|oysters?|clams?|mussels?|scallops?|squid|octopus|calamari|crawfish|shellfish',
    category: 'seafood',
  },

  // ── Dairy & eggs ─────────────────────────────────────────────────────────
  {
    term: 'cheeses?|queso|cuajada|ricotta|cheddar|mozzarella|brie|feta|cotija|parmesan|requeson|paneer|mascarpone|gouda|provolone',
    category: 'dairy_eggs',
  },
  { term: 'milk|yogurts?|yoghurts?|kefir|dairy|labneh|curds?', category: 'dairy_eggs' },
  { term: 'butter|ghee|crema|creamer|nog|eggnog', category: 'dairy_eggs' },
  { term: 'cream', category: 'dairy_eggs' },
  { term: 'ice ?cream|gelato|sorbets?|paletas?|popsicles?|custards?|ices', category: 'dairy_eggs' },
  { term: 'eggs?', category: 'dairy_eggs' },

  // ── Bakery ───────────────────────────────────────────────────────────────
  {
    term: 'breads?|buns?|rolls?|bagels?|baguettes?|croissants?|pitas?|naan|focaccia|loaf|loaves|sourdough|brioche',
    category: 'bakery_grains',
  },
  { term: 'tortillas?', category: 'bakery_grains' },
  {
    term: 'cookies?|crackers?|biscuits?|shortbread|wafers?|macarons?|mooncakes?|pfeffernusse',
    category: 'bakery_grains',
  },
  {
    term: 'cakes?|pies?|pastr(?:y|ies)|muffins?|brownies?|do(?:ugh)?nuts?|tarts?|cupcakes?|desserts?|cannoli|strudels?|churros?|mousses?|scones?|eclairs?|shortcakes?',
    category: 'bakery_grains',
  },
  {
    term: 'waffles?|pancakes?|crepes?|hushpupp(?:y|ies)|cachapas?|gorditas?',
    category: 'bakery_grains',
  },
  { term: 'dough|batter', category: 'bakery_grains' },

  // ── Prepared meals ───────────────────────────────────────────────────────
  {
    term: 'entr[eéçÇ]es?|meals?|dinners?|casseroles?|lasagnas?|enchiladas?|tamales?|burritos?|empanadas?|dumplings?|wontons?|pierogi(?:es)?|pirozhki|vareniki|singaras?|samosas?|samsas?|coxinhas?',
    category: 'prepared_foods',
  },
  {
    term: 'soups?|broths?|stews?|chilis?|bisques?|chowders?|ramen|pho',
    category: 'prepared_foods',
  },
  {
    term: 'alfredo|jambalaya|gumbo|quiches?|croquettes?|blintz(?:es)?|cutlets?|coleslaw|slaw',
    category: 'prepared_foods',
  },
  {
    term: 'risotto|paella|biryani|fritters?|coneys?|sliders?',
    category: 'prepared_foods',
    note: 'dish names; a slider or coney is a made sandwich, not a cut of meat',
  },
  { term: 'pot ?stickers?|gyozas?|pelmeni', category: 'prepared_foods' },
  {
    term: 'sandwich(?:es)?|subs?|burgers?|cheeseburgers?|wraps?|paninis?|kimbap|gyros?',
    category: 'prepared_foods',
  },
  { term: 'pizzas?|calzones?|strombolis?', category: 'prepared_foods' },
  { term: 'sushi|poke|kimchi ?bap', category: 'prepared_foods' },
  {
    term: 'bao|falafels?|kabobs?|kebabs?|quesadillas?|taquitos?|tacos?|chimichangas?',
    category: 'prepared_foods',
  },
  {
    term: 'salads?',
    category: 'prepared_foods',
    note: 'a made salad is a dish; bagged salad kits are a compound above',
  },

  // ── Snacks & candy ───────────────────────────────────────────────────────
  {
    term: 'chips?|pretzels?|puffs?|crisps?|snacks?|nachos?|bars?|cracklings?',
    category: 'snacks_sweets',
    note: 'cracklings sit with pork rinds and chicharrones in the snack aisle',
  },
  {
    term: 'chocolates?|cand(?:y|ies)|confections?|confectionar(?:y|ies)|confectioner(?:y|ies)|gumm(?:y|ies)|nonpareils?|truffles?|fudge|marshmallows?|toffee|caramels?|brittle|bark|bonbons?|licorice|pops?',
    category: 'snacks_sweets',
  },

  // ── Pantry staples ───────────────────────────────────────────────────────
  {
    term: 'peanuts?|almonds?|cashews?|pecans?|walnuts?|pistachios?|macadamias?|hazelnuts?|nuts?|pinenuts?',
    category: 'pantry_condiments',
  },
  { term: 'seeds?|kernels?|tahini|tahina|flax|chia', category: 'pantry_condiments' },
  { term: 'cereals?|granola|oatmeal|muesli|oats', category: 'pantry_condiments' },
  { term: 'flours?|cornmeal|semolina|starch|atta|meal', category: 'pantry_condiments' },
  {
    term: 'pastas?|noodles?|spaghetti|macaroni|orzo|campanelle|vermicelli|linguini?|fettuccine|penne|rigatoni|bowtie|raviolis?|tortellini|gnocchi',
    category: 'pantry_condiments',
  },
  {
    term: 'rice|quinoa|couscous|barley|lentils?|beans?|chickpeas?|dal|grains?',
    category: 'pantry_condiments',
  },
  {
    term: 'sauces?|dressings?|salsas?|ketchup|mustard|mayonnaise|mayo|condiments?|vinegar|marinades?|grav(?:y|ies)|pesto',
    category: 'pantry_condiments',
  },
  {
    term: 'seasonings?|spices?|cinnamon|paprika|turmeric|cumin|asafoetida|herbs?|salt|pepper',
    category: 'pantry_condiments',
  },
  { term: 'oils?|shortening|lards?|tallows?|fats?', category: 'pantry_condiments' },
  {
    term: 'honey|syrups?|sugar|molasses|jams?|jell(?:y|ies)|preserves?|spreads?',
    category: 'pantry_condiments',
  },
  { term: 'hummus|dips?|guacamole|kimchi|tofu|miso', category: 'pantry_condiments' },
  { term: 'bases?|bouillon', category: 'pantry_condiments', note: 'soup and gravy bases' },

  // ── Supplements ──────────────────────────────────────────────────────────
  {
    term: 'supplements?|capsules?|tablets?|vitamins?|probiotics?|nutraceuticals?|gummies vitamins?',
    category: 'supplements',
  },
  {
    term: 'kratom|moringa|shatavari|ashwagandha|ginseng|collagen|superfoods?|spirulina',
    category: 'supplements',
  },
  { term: 'angelicae?|tejocote|spermidine?|lactoferrin|apolactoferrin', category: 'supplements' },

  // ── Baby ─────────────────────────────────────────────────────────────────
  { term: 'formulas?', category: 'baby_food_formula' },

  // ── Drinks ───────────────────────────────────────────────────────────────
  { term: 'juices?|ciders?|smoothies?|lemonades?|nectars?', category: 'beverages' },
  {
    term: 'sodas?|seltzers?|colas?|beverages?|drinks?|shakes?|tonics?|waters?',
    category: 'beverages',
  },
  { term: 'coffee|teas?|espresso|lattes?|kombucha|matcha|cocoa', category: 'beverages' },
  {
    term: 'beers?|wines?|liquors?|spirits?|vodka|whiske?y|cocktails?|ciders?',
    category: 'beverages',
  },
];

/**
 * Words that, when they FOLLOW a matched term, prove the term named a flavour,
 * a style or an absence rather than the product.
 *
 * "Butter Flavored Popcorn" is popcorn. "Dairy-Free Coconut Yogurt" contains
 * no dairy. "Chicken Flavored Base" has no chicken in the sense a shopper
 * filtering Meat & poultry means. This is how the matcher refuses to turn an
 * adjective into a category.
 */
export const FLAVOUR_MARKERS: readonly string[] = [
  'flavored',
  'flavoured',
  'flavor',
  'flavour',
  'flavors',
  'flavours',
  'style',
  'styled',
  'scented',
  'infused',
  'inspired',
  'taste',
  'tasting',
  'substitute',
  'alternative',
  'imitation',
  'based',
];

/**
 * Words that describe a product's state or provenance without changing what it
 * is. Stripping them is how "frozen meat" and "fully cooked beef" are
 * recognised as bare category words when a conjunction has to be resolved.
 */
export const DESCRIPTOR_WORDS: readonly string[] = [
  'the',
  'a',
  'an',
  'various',
  'assorted',
  'select',
  'specific',
  'certain',
  'multiple',
  'frozen',
  'fresh',
  'refrigerated',
  'chilled',
  'raw',
  'cooked',
  'uncooked',
  'precooked',
  'fully',
  'partially',
  'heat',
  'treated',
  'ready',
  'to',
  'eat',
  'cook',
  'rte',
  'nrte',
  'dried',
  'dry',
  'canned',
  'jarred',
  'bottled',
  'packaged',
  'prepared',
  'organic',
  'natural',
  'whole',
  'sliced',
  'chopped',
  'diced',
  'shredded',
  'ground',
  'imported',
  'ineligible',
  'inspected',
  'voluntarily',
  'boneless',
  'skinless',
  'not',
  'products',
  'product',
  'items',
  'item',
  'brand',
  'branded',
  'varieties',
  'variety',
  'mini',
  'large',
  'small',
  'family',
  'pack',
  'size',
  'sizes',
  'premium',
  'deluxe',
  'for',
  'glazed',
  'seasoned',
  'marinated',
  'smoked',
  'cured',
  'breaded',
  'battered',
];

/**
 * Categories that can MODIFY another product's name, so a bare mention of one
 * before a modified head is a modifier, not a product ("cheese and garlic
 * croutons" recalls croutons). Produce is deliberately absent: a
 * contaminated-produce notice routinely recalls the raw item and the prepared
 * foods made from it as two genuinely separate products ("cucumbers and
 * salads").
 */
export const COMPONENT_CATEGORY_IDS: readonly FoodCategoryId[] = [
  'meat_poultry',
  'seafood',
  'dairy_eggs',
  'pantry_condiments',
];

/**
 * Categories a prepared dish absorbs when they stand bare beside it ("meat and
 * poultry dumplings" is a dumpling). Narrower than COMPONENT_CATEGORY_IDS:
 * pantry is excluded because a condiment beside a dish is usually its own
 * recalled product ("salsa and salads" recalls both), while a bare protein or
 * dairy word beside a dish is what the dish is made of.
 */
export const ABSORBABLE_CATEGORY_IDS: readonly FoodCategoryId[] = [
  'meat_poultry',
  'seafood',
  'dairy_eggs',
];

/**
 * Categories that FORM A DISH when they modify a dishable staple: "meat pie",
 * "chicken fried rice", "turkey stuffed pastry", "beef and cheese tortilla".
 * Dairy alone does not ("cheese biscuits" are bakery); produce alone does not
 * ("mushroom tortillas" are tortillas).
 */
export const PROTEIN_CATEGORY_IDS: readonly FoodCategoryId[] = ['meat_poultry', 'seafood'];

/**
 * Staple head nouns that name a DISH once a protein modifies them or is listed
 * as their ingredient. Matched against the head noun's own text, whole-word:
 * a compound like "apple pie" has already claimed its span and is never
 * re-read here.
 */
export const DISHABLE_STAPLE_TERMS: readonly string[] = [
  'rice',
  'noodles?',
  'pastas?',
  'spaghetti',
  'macaroni',
  'vermicelli',
  'raviolis?',
  'tortellini',
  'pies?',
  'pastr(?:y|ies)',
  'turnovers?',
  'tortillas?',
  'biscuits?',
];

/**
 * Dish-class words that cannot be an INGREDIENT of the thing before them, so
 * when one heads the clause after "with" it is the head of the whole name
 * ("Spaghetti Loops With Meat Sauce Entrée Products" is an entrée). "Soup" is
 * deliberately absent — an instant-noodle cup comes "with soup base", and the
 * soup packet is an ingredient.
 */
export const DISH_CLASS_TERMS: readonly string[] = [
  'entr[eéçÇ]es?',
  'meals?',
  'dinners?',
  'bowls?',
  'kits?',
  'platters?',
  'trays?',
];

/**
 * Categories whose product names take a produce word as a FLAVOUR, wherever it
 * sits: "Iced Tea Lemon" is tea, "Pear, Kiwi, Spinach & Pea Baby Food" is baby
 * food, "Apple, Cherry, and Peach Pies" are pies. Prepared and meat are
 * deliberately absent — beside those, produce is usually a genuinely recalled
 * second product.
 */
export const FLAVOURABLE_TARGET_IDS: readonly FoodCategoryId[] = [
  'bakery_grains',
  'snacks_sweets',
  'dairy_eggs',
  'seafood',
  'supplements',
  'baby_food_formula',
  'beverages',
];

/**
 * Markers proving a meat or seafood word names a plant-based analogue. The
 * product is sold as a ready alternative — Prepared meals — because
 * Meat & poultry is for meat products. Note the asymmetry with dairy:
 * "dairy-free yogurt" is still yogurt (Dairy & eggs), but "plant-based
 * chik'n nuggets" contain no chicken at all.
 */
export const ANALOGUE_MARKERS: readonly string[] = [
  'plant[- ]?based',
  'meat[- ]?less',
  'meat[- ]free',
  'vegan',
  'veggie',
  'vegetarian',
];

/**
 * The product text itself stating an infant audience. This is not audience
 * INFERENCE (which stays forbidden — a brand aimed at parents proves nothing);
 * it is the name saying "for baby", which is the Baby food & formula
 * definition verbatim.
 */
export const BABY_AUDIENCE_MARKERS: readonly string[] = [
  'for bab(?:y|ies)',
  'for infants?',
  'for toddlers?',
];

/** Words that, when they follow a term, negate it ("dairy-free", "sugar free"). */
export const NEGATION_MARKERS: readonly string[] = ['free', 'less'];

/**
 * Terms proving the recalled article is not food at all. When one matches, the
 * case takes NO category — a lead-contaminated saucepan belongs in All Recalls
 * and under no aisle. These are suppressors, never a category of their own.
 */
export const NON_FOOD_TERMS: readonly string[] = [
  'cookware',
  'saucepans?',
  'skillets?',
  'stockpots?',
  'baby powder',
  'talc',
  'handbags?',
  'backpacks?',
  'toys?',
  'cosmetics?',
  'lotions?',
  'shampoos?',
  'sunscreens?',
  'dog (?:food|treats?)',
  'cat (?:food|treats?)',
  'pet (?:food|treats?)',
  'animal feed',
];
