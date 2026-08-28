/**
 * Reviewed lexical data for food-category matching (Phase C5.3B).
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
  { term: 'crab meat', category: 'seafood' },
  { term: 'imitation crab', category: 'seafood' },
  {
    term: 'ice cream (?:bars?|cakes?|sandwich(?:es)?|cones?|cups?|products?|treats?)',
    category: 'dairy_eggs',
    note: 'a novelty is still ice cream, not a snack bar or bakery',
  },
  {
    term: 'cracker sandwich(?:es)?',
    category: 'snacks_candy',
    note: 'a snack, not a deli sandwich',
  },
  { term: 'cookie sandwich(?:es)?', category: 'bakery' },
  { term: 'sandwich cookies?', category: 'bakery' },
  { term: 'cheese (?:curds?|sauce|spread|dip|powder)', category: 'dairy_eggs' },
  { term: 'cottage cheese', category: 'dairy_eggs' },
  { term: 'cream cheese', category: 'dairy_eggs' },
  { term: 'sour cream', category: 'dairy_eggs' },
  { term: 'peanut butter', category: 'pantry', note: 'a spread, not confectionery' },
  { term: '(?:almond|cashew|sunflower|seed|nut) butters?', category: 'pantry' },
  { term: 'apple ?sauce', category: 'pantry' },
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
  { term: 'milk chocolates?', category: 'snacks_candy', note: 'milk is the chocolate style' },
  { term: '(?:dark|white|semi ?sweet) chocolates?', category: 'snacks_candy' },
  {
    term: 'chocolate (?:bars?|chips?|chunks?|nonpareils?|pareils?|truffles?|raisins?|almonds?|peanuts?|pretzels?|nuts?|cherries|macadamias?)',
    category: 'snacks_candy',
  },
  { term: 'chocolate covered [a-z]+', category: 'snacks_candy' },
  { term: 'butter ?milk', category: 'dairy_eggs' },
  { term: 'corn dogs?', category: 'meat_poultry' },
  { term: 'hot ?dogs?', category: 'meat_poultry' },
  {
    term: 'pretzel dogs?',
    category: 'prepared',
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
    term: 'pork rinds?|chicharron(?:es)?',
    category: 'snacks_candy',
    note: 'shelved and eaten as a snack',
  },
  { term: 'meat snacks?', category: 'meat_poultry', note: 'jerky and sticks, not the snack aisle' },
  { term: '(?:pork|beef|meat|turkey|chicken|venison|elk) snack sticks?', category: 'meat_poultry' },
  { term: 'ham (?:and )?cheese loaf', category: 'meat_poultry', note: 'a deli luncheon loaf' },
  { term: '(?:monkfish|cod|fish) livers?', category: 'seafood' },
  { term: 'soybean paste|bean paste', category: 'pantry' },
  {
    term: 'chicken (?:nuggets?|strips?|wings?|tenders?|patt(?:y|ies)|fingers?)',
    category: 'meat_poultry',
  },
  { term: 'turkey burgers?', category: 'meat_poultry' },
  { term: 'beef (?:jerky|patt(?:y|ies)|tallow|sticks?)', category: 'meat_poultry' },
  { term: 'corned beef', category: 'meat_poultry' },
  { term: 'croutons?', category: 'bakery' },
  { term: 'bread ?crumbs?', category: 'bakery' },
  { term: 'potato bread', category: 'bakery' },
  {
    term: '(?:potato|sweet potato|corn|tortilla|veggie|vegetable) chips?',
    category: 'snacks_candy',
    note: 'a chip is a snack whatever it is made from',
  },
  { term: 'potato sourdough', category: 'bakery' },
  { term: 'sweet corn (?:pancakes?|cachapas?)', category: 'bakery' },

  // ── Mixes and bases: the product is the dry good, not its flavour ────────
  {
    term: '(?:frying|batter|baking|pancake|waffle|cake|muffin|bread|brownie|biscuit|stuffing|do(?:ugh)?nut) mix(?:es)?',
    category: 'pantry',
  },
  { term: 'pico de gallo', category: 'pantry', note: 'a fresh salsa, sold as a condiment' },
  { term: 'pounded yam', category: 'pantry', note: 'a dry staple flour, not fresh yam' },
  { term: 'aquafaba', category: 'pantry' },
  { term: 'snack mix(?:es)?|botana', category: 'snacks_candy' },
  { term: 'pancake (?:and |& )?waffle (?:complete|mix(?:es)?)', category: 'pantry' },
  { term: '(?:soup|broth|gravy|bouillon) (?:base|mix(?:es)?|powder|cubes?)', category: 'pantry' },
  { term: '(?:drink|beverage|cocktail|lemonade|smoothie) mix(?:es)?', category: 'beverages' },
  { term: 'seasoning (?:mix(?:es)?|blends?|packets?)', category: 'pantry' },
  { term: 'spice (?:mix(?:es)?|blends?)', category: 'pantry' },
  {
    term: '(?:salad|sandwich|taco|wing|pizza|pasta|meat|barbecue|bbq|hot) sauce',
    category: 'pantry',
  },
  { term: 'salad dressings?', category: 'pantry' },

  // ── Composed dishes: a single dish, never its parts ──────────────────────
  { term: "macaroni (?:and|&|n'?) cheese", category: 'prepared' },
  { term: 'chicken (?:and|&) (?:rice|waffles?|dumplings?|noodles?)', category: 'prepared' },
  { term: '(?:rice|beans) (?:and|&) (?:beans|rice)', category: 'prepared' },
  {
    term: '(?:beef|chicken|pork|turkey|vegetable|veggie) (?:enchiladas?|burritos?|tacos?|tamales?|empanadas?|lasagnas?|casseroles?|pot pies?|wraps?|bowls?|kabobs?|skewers?)',
    category: 'prepared',
  },
  {
    term: '(?:chicken|tuna|egg|pasta|potato|macaroni|seafood|shrimp|crab|ham|garden|greek|caesar|cranberry) salads?',
    category: 'prepared',
    note: 'a made salad is a dish, not its protein',
  },
  {
    term: 'salad kits?',
    category: 'produce',
    note: 'a bagged salad is produce a shopper assembles',
  },
  { term: '(?:chopped|garden|slaw|coleslaw) (?:salad )?kits?', category: 'produce' },
  { term: 'meal kits?', category: 'prepared' },
  {
    term: '(?:chicken|beef|pork|turkey|vegetable|noodle|wonton|tomato|potato|clam|corn) (?:noodle )?(?:soups?|chowders?|bisques?|stews?|chilis?)',
    category: 'prepared',
  },
  { term: 'ready ?meals?', category: 'prepared' },
  { term: 'deli (?:items?|meals?|salads?)', category: 'prepared' },
  { term: 'party trays?', category: 'prepared' },
  { term: 'lunch kits?', category: 'prepared' },
  {
    term: '(?:spaghetti|pasta|macaroni|noodles?) (?:and|&) (?:meatballs?|cheese|chicken|beef|pork|sauce|gravy)',
    category: 'prepared',
    note: 'a named dish, not two staples',
  },
  { term: 'stuffed (?:mushrooms?|peppers?|shells?|clams?|cabbages?)', category: 'prepared' },
  { term: 'rice balls?', category: 'prepared' },
  {
    term: 'egg rolls?|spring rolls?',
    category: 'prepared',
    note: 'no egg category here — it is a wrapper',
  },
  { term: '(?:pork|meat|chicken|bbq|steamed) buns?', category: 'prepared' },
  { term: 'dirty rice', category: 'prepared' },
  { term: '(?:meat|chicken|beef|pork|turkey|poultry|seafood) pasta', category: 'prepared' },
  { term: "shepherd'?s pies?|cottage pies?", category: 'prepared' },
  { term: '(?:pork|meat|chicken|bbq|steamed) (?:mini |small |large )?buns?', category: 'prepared' },
  { term: 'street corn|elote', category: 'prepared', note: 'a named dish, not an ear of corn' },
  {
    term: 'bagged salads?',
    category: 'produce',
    note: 'bagged greens are produce; made salads are dishes',
  },
  { term: 'sushi (?:rolls?|products?)?', category: 'prepared' },
  { term: 'breakfast (?:sandwich(?:es)?|burritos?|bowls?)', category: 'prepared' },

  // ── Baby: only where the product is sold for infants ─────────────────────
  { term: '(?:infant|baby|toddler) formula', category: 'baby' },
  { term: 'formula (?:powder|products?)', category: 'baby' },
  { term: 'baby foods?', category: 'baby' },
  { term: '(?:infant|baby) (?:cereals?|purees?|snacks?|puffs?|rice)', category: 'baby' },
  { term: 'teething (?:sticks?|biscuits?|wafers?|rings?)', category: 'baby' },

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
  { term: 'cheese ?cakes?', category: 'bakery' },
  {
    term: 'fruit (?:tarts?|pies?|cakes?|breads?)',
    category: 'bakery',
    note: 'the fruit is a filling',
  },
  {
    term: '(?:apple|cherry|pumpkin|pecan|peach|berry|lemon) (?:pies?|tarts?|cakes?|turnovers?|strudels?|danishes?)',
    category: 'bakery',
  },
  { term: 'granola (?:bars?|clusters?)', category: 'snacks_candy' },
  { term: '(?:protein|snack|energy|nutrition|cereal|fruit) bars?', category: 'snacks_candy' },
  { term: '(?:energy|protein) (?:balls?|bites?)', category: 'snacks_candy' },
  {
    term: 'chanachur|namkeen|bhujia|panjiri|pinni|la+ddoo?|barfi|jalebi',
    category: 'snacks_candy',
    note: 'South Asian sweet and savoury snack names',
  },
  { term: 'trail mix(?:es)?', category: 'snacks_candy' },
  { term: 'party mix(?:es)?', category: 'snacks_candy' },
  { term: 'popcorn', category: 'snacks_candy' },
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
    term: 'broccoli|cauliflower|peppers?|jalapenos?|jalapeños?|squash(?:es)?|zucchinis?|cabbages?|asparagus|beets?|radish(?:es)?|leeks?|scallions?',
    category: 'produce',
  },
  {
    term: 'mushrooms?|enoki|garlic|ginger|eggplants?|okra|artichokes?|yams?|cassava|plantains?|shallots?',
    category: 'produce',
  },
  { term: 'vegetables?|veggies?|produce|greens', category: 'produce' },
  { term: 'sprouts?|alfalfa', category: 'produce' },
  { term: 'cilantro|parsley|basil|dill|rosemary|thyme|scallion', category: 'produce' },
  { term: 'seaweed|nori|kelp|lily flowers?|bamboo shoots?|fungus|fungi', category: 'produce' },

  // ── Meat & poultry ───────────────────────────────────────────────────────
  {
    term: 'beef|steaks?|briskets?|veal|bison|meatloaf|meatballs?|koftas?|sliders?',
    category: 'meat_poultry',
  },
  {
    term: 'pork|bacon|hams?|chorizos?|sausages?|cracklings?|prosciutto|pepperoni|salam[ei]|carnitas|charcuterie|kielbasa|bratwurst',
    category: 'meat_poultry',
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
    category: 'bakery',
  },
  { term: 'tortillas?', category: 'bakery' },
  {
    term: 'cookies?|crackers?|biscuits?|shortbread|wafers?|macarons?|mooncakes?|pfeffernusse',
    category: 'bakery',
  },
  {
    term: 'cakes?|pies?|pastr(?:y|ies)|muffins?|brownies?|do(?:ugh)?nuts?|tarts?|cupcakes?|desserts?|cannoli|strudels?|churros?|mousses?|scones?|eclairs?|shortcakes?',
    category: 'bakery',
  },
  { term: 'waffles?|pancakes?|crepes?|hushpupp(?:y|ies)|cachapas?|gorditas?', category: 'bakery' },
  { term: 'dough|batter', category: 'bakery' },

  // ── Prepared meals ───────────────────────────────────────────────────────
  {
    term: 'entr[eé]es?|meals?|dinners?|casseroles?|lasagnas?|enchiladas?|tamales?|burritos?|empanadas?|dumplings?|wontons?|pierogi(?:es)?|pirozhki|vareniki|singaras?|samosas?',
    category: 'prepared',
  },
  { term: 'soups?|broths?|stews?|chilis?|bisques?|chowders?|ramen|pho', category: 'prepared' },
  {
    term: 'alfredo|jambalaya|gumbo|quiches?|croquettes?|blintz(?:es)?|cutlets?|coleslaw|slaw',
    category: 'prepared',
  },
  {
    term: 'sandwich(?:es)?|subs?|burgers?|cheeseburgers?|wraps?|paninis?|kimbap|gyros?',
    category: 'prepared',
  },
  { term: 'pizzas?|calzones?|strombolis?', category: 'prepared' },
  { term: 'sushi|poke|kimchi ?bap', category: 'prepared' },
  {
    term: 'bao|falafels?|kabobs?|kebabs?|quesadillas?|taquitos?|tacos?|chimichangas?',
    category: 'prepared',
  },
  {
    term: 'salads?',
    category: 'prepared',
    note: 'a made salad is a dish; bagged salad kits are a compound above',
  },

  // ── Snacks & candy ───────────────────────────────────────────────────────
  { term: 'chips?|pretzels?|puffs?|crisps?|snacks?|nachos?|bars?', category: 'snacks_candy' },
  {
    term: 'chocolates?|cand(?:y|ies)|confections?|confectionar(?:y|ies)|confectioner(?:y|ies)|gumm(?:y|ies)|nonpareils?|truffles?|fudge|marshmallows?|toffee|caramels?|brittle|bark|bonbons?|licorice',
    category: 'snacks_candy',
  },

  // ── Pantry staples ───────────────────────────────────────────────────────
  {
    term: 'peanuts?|almonds?|cashews?|pecans?|walnuts?|pistachios?|macadamias?|hazelnuts?|nuts?|pinenuts?',
    category: 'pantry',
  },
  { term: 'seeds?|kernels?|tahini|tahina|flax|chia', category: 'pantry' },
  { term: 'cereals?|granola|oatmeal|muesli|oats', category: 'pantry' },
  { term: 'flours?|cornmeal|semolina|starch|atta|meal', category: 'pantry' },
  {
    term: 'pastas?|noodles?|spaghetti|macaroni|orzo|campanelle|vermicelli|linguini?|fettuccine|penne|rigatoni|bowtie',
    category: 'pantry',
  },
  {
    term: 'rice|quinoa|couscous|barley|lentils?|beans?|chickpeas?|dal|grains?',
    category: 'pantry',
  },
  {
    term: 'sauces?|dressings?|salsas?|ketchup|mustard|mayonnaise|mayo|condiments?|vinegar|marinades?|grav(?:y|ies)|pesto',
    category: 'pantry',
  },
  {
    term: 'seasonings?|spices?|cinnamon|paprika|turmeric|cumin|asafoetida|herbs?|salt|pepper',
    category: 'pantry',
  },
  { term: 'oils?|shortening|lard', category: 'pantry' },
  {
    term: 'honey|syrups?|sugar|molasses|jams?|jell(?:y|ies)|preserves?|spreads?',
    category: 'pantry',
  },
  { term: 'hummus|dips?|guacamole|kimchi|tofu|miso', category: 'pantry' },
  { term: 'bases?|bouillon', category: 'pantry', note: 'soup and gravy bases' },

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
  { term: 'formulas?', category: 'baby' },

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
];

/**
 * Categories that can be an INGREDIENT of a prepared dish, so a bare mention of
 * one beside a dish is absorbed into it ("meat and poultry dumplings" is a
 * dumpling). Produce is deliberately absent: a contaminated-produce notice
 * routinely recalls the raw item and the prepared foods made from it as two
 * genuinely separate products ("cucumbers and salads").
 */
export const COMPONENT_CATEGORY_IDS: readonly FoodCategoryId[] = [
  'meat_poultry',
  'seafood',
  'dairy_eggs',
  'pantry',
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
