/**
 * Deterministic food-category matching (Phases C5.3B / C5.3B-2).
 *
 * A pure function from what a government notice says was recalled to a set of
 * consumer aisle categories. No network, no model, no randomness, no state:
 * the same product text always yields the same categories in the same order.
 *
 * ## What it is allowed to read
 *
 * The product text ONLY — FDA's structured `productDescription`, or the FSIS
 * title's regular product grammar. It never sees, and its signature cannot
 * accept, the hazard, the allergen, the recalling firm, the brand, the
 * retailer, the geography or the agency-as-evidence. That is not an oversight
 * to be fixed later; those fields describe who and why, and this module
 * answers what. A shellfish ALLERGEN in a cookie is a cookie.
 *
 * ## Why head nouns, and why rules over more words (C5.3B-2)
 *
 * The audit (C5.3A) measured the naive alternative — union every food word
 * found — at 34.8% multi-category on the active corpus, and most of those
 * extra labels were flavours and ingredients: "Dark Chocolate Cherry Granola"
 * came out as Produce + Snacks + Pantry. English puts the head noun of a food
 * name last and its modifiers first, so reading the LAST match in each product
 * phrase, after letting reviewed compounds claim their spans, cut multi-label
 * to 10.3% at unchanged coverage. Granola is granola.
 *
 * The first held-out evaluation (C5.3B) then failed at 74.2%, and its failure
 * analysis showed WHY a bare last-head reading cannot generalize: English
 * productively forms dish names whose head noun is a staple ("meat pie",
 * "chicken fried rice", "turkey stuffed pastry"), FDA marketing names postpose
 * flavours ("Iced Tea Lemon"), and coordination scope depends on what KIND of
 * word each conjunct is ("cheese and garlic croutons" vs "frozen waffle and
 * turkey sausage"). Those are patterns, not vocabulary, so this revision adds
 * structural rules driven by a small role ontology in the lexicon
 * (dish-forming proteins, dishable staples, flavour-taking categories) instead
 * of memorizing titles one at a time.
 *
 * ## Pipeline
 *
 *   product text → normalize → packaging preposition keeps what the package
 *   contains → ingredient preposition ends the product list (with a
 *   provenance-guarded rescue) → separators enumerate products → conjunctions
 *   resolved structurally by role → per phrase: compounds claim spans, head
 *   terms fill the rest, flavour/negation-marked matches dropped, LAST
 *   survivor wins, then dish-formation / postposed-flavour / analogue rules
 *   adjust the reading → list-level flavour-enumeration and stated-audience
 *   rules → union, dedupe, display order, cap at four
 */

import { MAX_CATEGORIES_PER_CASE, orderFoodCategories, type FoodCategoryId } from './food-category';
import {
  ABSORBABLE_CATEGORY_IDS,
  ANALOGUE_MARKERS,
  BABY_AUDIENCE_MARKERS,
  COMPONENT_CATEGORY_IDS,
  COMPOUND_TERMS,
  DESCRIPTOR_WORDS,
  DISH_CLASS_TERMS,
  DISHABLE_STAPLE_TERMS,
  FLAVOUR_MARKERS,
  FLAVOURABLE_TARGET_IDS,
  HEAD_TERMS,
  NEGATION_MARKERS,
  NON_FOOD_TERMS,
  PROTEIN_CATEGORY_IDS,
  type LexiconEntry,
} from './food-category-lexicon';
import type { SourceAgency } from './recall-types';

const DESCRIPTOR_SET = new Set(DESCRIPTOR_WORDS);
const COMPONENT_CATEGORIES = new Set<FoodCategoryId>(COMPONENT_CATEGORY_IDS);
const ABSORBABLE_CATEGORIES = new Set<FoodCategoryId>(ABSORBABLE_CATEGORY_IDS);
const PROTEIN_CATEGORIES = new Set<FoodCategoryId>(PROTEIN_CATEGORY_IDS);
const FLAVOURABLE_TARGETS = new Set<FoodCategoryId>(FLAVOURABLE_TARGET_IDS);

/** Which canonical field the product text came from. */
export type ProductTextBasis =
  'product_description' | 'title_grammar' | 'product_lines' | 'title_raw';

/**
 * The case facts category matching may read. Deliberately minimal — adding a
 * hazard, firm or retailer field here would be the first step of exactly the
 * inference this module refuses to do.
 */
export interface CategoryCaseInput {
  sourceAgency: SourceAgency;
  title: string;
  /** FDA's structured consumer product description; FSIS never has one. */
  productDescription: string | null;
  /** Structured product lines, used only as a conservative fallback. */
  productLines?: readonly string[];
}

export interface CategoryProductText {
  text: string;
  basis: ProductTextBasis;
}

// ── Product-text extraction ─────────────────────────────────────────────────
//
// FSIS titles follow a rigid grammar (measured: 179/179 active FSIS notices
// parse). The trailing cut list is every way FSIS pivots from naming the
// product to explaining the problem or the provenance. "Imported" needs
// "from"/"without"/"with" after it, or "Ineligible Imported Cooked Duck Blood
// Curds" loses its product entirely.

const CUT = String.raw`(?:\s+Due\s+to\b|\s+Because\b|\s+Produced\b|\s+Containing\b|\s+That\b|\s+(?:Illegally\s+)?Imported\s+(?:from|without|with)\b|\s+Served\b|\s+Associated\s+with\b|$)`;

const FSIS_ALERT = new RegExp(
  String.raw`^FSIS\s+Issues\s+(?:a\s+)?Public\s+Health\s+Alert\s+(?:for|Regarding)\s+(.+?)${CUT}`,
  'i',
);

const FIRM_RECALLS = new RegExp(String.raw`\bRecalls?\s+(.+?)${CUT}`, 'i');

/**
 * A title phrase too generic to be a product ("Products", "Ineligible") means
 * the grammar matched but told us nothing; fall through to the next basis.
 */
const EMPTY_PHRASE = /^(?:products?|items?|ineligible|various|certain|specific|multiple)$/i;

/**
 * Bare species and jurisdiction words — what FSIS REGULATES, never what a firm
 * made. "Beef" in a title is the agency's remit; "beef tamales" is a product.
 */
const JURISDICTION_WORDS = new Set([
  'beef',
  'pork',
  'poultry',
  'chicken',
  'turkey',
  'meat',
  'meats',
  'lamb',
  'veal',
  'goat',
  'mutton',
  'bison',
  'buffalo',
  'duck',
  'rabbit',
  'siluriformes',
  'fish',
  'catfish',
  'egg',
  'eggs',
]);

/**
 * True when a title phrase names ONLY the agency's jurisdiction — every
 * content word left after descriptors is a bare species word ("Poultry
 * Products", "Ready-To-Eat Beef Products", "Frozen, Raw Lamb Products").
 *
 * MEASURED AND NOT USED FOR EXTRACTION. See the note on `categoryProductText`:
 * this predicate identifies the family correctly (210 of 1,914 stored cases,
 * 11.0%), but switching those cases to their product lines was measured to
 * make them worse, so the switch was reverted. Kept because QA reports the
 * size of the family, and because a future milestone that finds a better
 * second basis needs this definition rather than a fresh guess at it.
 */
export function isJurisdictionOnlyPhrase(phrase: string): boolean {
  const words = phrase
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((word) => word !== '' && !DESCRIPTOR_SET.has(word));
  return words.length > 0 && words.every((word) => JURISDICTION_WORDS.has(word));
}

/**
 * The title phrase this case's grammar yields, or '' when the grammar does not
 * apply. Exported so QA can report the extraction family sizes without
 * re-deriving the regexes.
 */
export function titleProductPhrase(title: string): string {
  return (FSIS_ALERT.exec(title)?.[1] ?? FIRM_RECALLS.exec(title)?.[1] ?? '').trim();
}

/**
 * Which basis names the product, in order of how much the source structured it.
 *
 * ## The jurisdiction-only correction C10A tried, measured, and reverted
 *
 * C5.3B-2 named one residual error family as its largest and blamed this
 * seam: FSIS titles that state only the agency's remit ("Poultry Products")
 * while the real product — a salad, an entrée — appears in the structured
 * product lines. Its recommendation was to prefer those lines whenever the
 * title reduces to bare species words.
 *
 * C10A implemented exactly that and A/B-measured it on the 60 development
 * rows it affects, scoring BOTH arms against the same reviewed labels:
 *
 *     title grammar   80.0% exact-set     product lines   50.0% exact-set
 *     title-only correct: 21              lines-only correct: 3
 *
 * The recommendation is wrong about this corpus. FSIS product lines are
 * packaging prose — "Combo bins containing 'Beef Trimmings, BNLS, 90 L'",
 * "12-oz. metal cans containing 'SPAM Classic'" — and the names inside them
 * are brand-dominated. Reading them turns confident, correct Meat & poultry
 * readings into `other`, into `pantry_condiments` (a fat percentage read as a
 * pantry good), and into wrong aisles (fish-skin crackers read as bakery).
 * Extracting only the quoted label span was also tried and scored 50.0%.
 *
 * Two of the three lines-only wins were cases whose title phrase was empty or
 * generic, which ALREADY fall through to the lines below. The true yield of
 * the switch was one case against a cost of twenty-one, so it is not here.
 *
 * The family is real and its cases are genuinely mislabelled; the fix is not
 * a different basis but richer source text, which this app does not have.
 */
export function categoryProductText(input: CategoryCaseInput): CategoryProductText {
  const description = (input.productDescription ?? '').trim();
  if (description !== '') return { text: description, basis: 'product_description' };

  const title = input.title ?? '';
  const phrase = titleProductPhrase(title);
  if (phrase !== '' && !EMPTY_PHRASE.test(phrase)) {
    return { text: phrase, basis: 'title_grammar' };
  }

  // Conservative fallback. Product lines are identifier-dense ("… | UPC: … |
  // Lot: …"), so only their leading name segment is used, and only the first
  // few lines: a 565-line table describes one recall, not 565 categories.
  const lines = (input.productLines ?? [])
    .map((line) => line.split('|')[0].trim())
    .filter((line) => line !== '')
    .slice(0, 12);
  if (lines.length > 0) return { text: lines.join('; '), basis: 'product_lines' };

  return { text: title.trim(), basis: 'title_raw' };
}

// ── Normalization ───────────────────────────────────────────────────────────

/**
 * Conservative: case and punctuation shape only. Nothing is removed that could
 * carry meaning — a stripped word cannot be reviewed later.
 */
export function normalizeProductText(text: string): string {
  return (
    text
      .toLowerCase()
      // Undecoded entities reach some persisted titles, and the ';' in "&rsquo;"
      // would otherwise split "Beef Shepherd&rsquo;s Pie" into two products.
      .replace(/&(?:rsquo|lsquo|apos|#39);/g, "'")
      .replace(/&(?:rdquo|ldquo|quot);/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ')
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[‐-―]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Hyphens bind words, so they survive normalization and splitting — otherwise
 * "Raw Bone-In Beef" contains an " in " and loses its beef to the ingredient
 * cut. They become spaces only here, when a phrase is finally matched, so one
 * lexicon entry still covers "chocolate-covered" and "chocolate covered".
 */
function unhyphenate(phrase: string): string {
  return phrase.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * "<packaging> containing <product>" names the product AFTER the preposition —
 * the bag is not the recall. Everything before it is discarded. This is the one
 * place "containing" introduces a product rather than an ingredient, and it is
 * distinguished structurally, by the packaging noun, not by guessing.
 */
const PACKAGING_CONTAINING =
  /\b(?:bags?|packages?|cases?|cartons?|boxes|pouches|trays?|containers?|jars?|cans?|bottles?|tubs?|packs?|clamshells?|sleeves?|units?|handbags?|backpacks?)\s+(?:containing|of)\s+/i;

/**
 * Ingredient and packaging prepositions. Everything from here on describes
 * what is IN the product or WHERE it is, never what it is: "Salads containing
 * cucumbers" is a salad, "Ground Beef in Meal Kits" is beef, "Energy Balls
 * with Cacao, Coffee & Pumpkin Seeds" is a snack. The cut applies to the whole
 * remaining text, because an ingredient list keeps going past its commas.
 */
const INGREDIENT_CUT = /\s+(?:with|w\/|containing|contains|made with|made from|in)\s+/;

/**
 * Separators that genuinely introduce another product. A comma must be
 * followed by whitespace — a comma inside a word is mangled encoding
 * ("Liver P,tE"), not a list.
 */
const PRODUCT_SEPARATOR = /[;,](?=\s)|\s+(?:such as|e\.g\.|including|includes)\s+/;

/** Conjunctions, handled separately because they also coordinate MODIFIERS. */
const CONJUNCTION = /\s+(?:and|&|\+)\s+/;

/**
 * "Cheddar Cheese AND Bacon FLAVORED Pork Patty" coordinates two flavours, not
 * two products. A flavour marker immediately after the conjunct that follows
 * the conjunction proves the whole run is one flavour description.
 */
const FLAVOUR_COORDINATION = new RegExp(
  `\\b(?:and|&)\\s+\\S+\\s+(?:${FLAVOUR_MARKERS.join('|')})\\b`,
  'i',
);

/** Structural-role patterns, compiled once from the reviewed lexicon. */
const DISHABLE_HEAD = new RegExp(`^(?:${DISHABLE_STAPLE_TERMS.join('|')})$`, 'i');
const DISH_CLASS_WORD = new RegExp(`^(?:${DISH_CLASS_TERMS.join('|')})$`, 'i');
const ANALOGUE = new RegExp(`\\b(?:${ANALOGUE_MARKERS.join('|')})\\b`, 'i');
const BABY_AUDIENCE = new RegExp(`\\b(?:${BABY_AUDIENCE_MARKERS.join('|')})\\b`, 'i');

/**
 * Product phrases, in the order they appear.
 *
 * The packaging preposition names the product after it, the ingredient
 * preposition ends the product list, separators enumerate distinct products,
 * and a conjunction may join either two products ("cucumbers and salads") or
 * two modifiers of one product ("cheese and garlic croutons"). Only the last
 * is ambiguous, and `resolveConjuncts` decides it structurally.
 */
export function splitProductPhrases(normalized: string): string[] {
  const afterPackaging = normalized.replace(
    new RegExp(`^.*?${PACKAGING_CONTAINING.source}`, 'i'),
    '',
  );
  const [products, ...rest] = afterPackaging.split(INGREDIENT_CUT);
  const tail = rest.join(' ');
  const dish = trailingDish(afterPackaging, tail);
  if (dish !== null) return [dish];

  const phrases = segmentsOf(products);
  // An ingredient cut that leaves nothing recognisable was not an ingredient
  // cut: "Beddar With Cheddar … Pork Sausage" and "Multiple items with
  // cucumbers" name their product on the far side of the preposition. The one
  // exception is a provenance tail — "Products Containing Chicken FROM an
  // ineligible country" names an ingredient and its origin, never a product,
  // so it is left unrescued and the case stays honestly uncategorized.
  if (rest.length > 0 && !phrases.some((phrase) => headMatchOf(phrase) !== null)) {
    if (headMatchOf(tail) !== null && !/\bfrom\b/.test(tail)) {
      return segmentsOf(afterPackaging);
    }
  }
  return phrases;
}

function segmentsOf(text: string): string[] {
  const phrases: string[] = [];
  for (const segment of text.trim().split(PRODUCT_SEPARATOR)) {
    const trimmed = segment.trim();
    if (trimmed === '') continue;
    phrases.push(...resolveConjuncts(trimmed));
  }
  return phrases;
}

/**
 * "Spaghetti Loops WITH Meat Sauce Entrée Products" is an entrée. A dish-class
 * word — entrée, meal, bowl, dinner — cannot be an ingredient of the thing
 * before it, so when one heads the ingredient clause it is the head of the
 * whole name and replaces the phrases. Restricted to `with` ("Ground Beef IN
 * Meal Kits" is beef that shipped inside a kit) and to the reviewed dish-class
 * words ("Saimin Noodles WITH Soup & Garnishes" is a noodle cup whose soup
 * packet is an ingredient).
 */
function trailingDish(full: string, tail: string): string | null {
  if (tail.trim() === '' || !/\s+(?:with|made with)\s+/.test(full)) return null;
  const read = phraseMatches(tail);
  if (read === null || read.matches.length === 0) return null;
  const head = read.matches[read.matches.length - 1];
  if (head.category !== 'prepared_foods') return null;
  const headWords = read.phrase.slice(head.start, head.end).split(/\s+/);
  return DISH_CLASS_WORD.test(headWords[headWords.length - 1]) ? tail.trim() : null;
}

/**
 * Decide whether a segment's conjuncts are separate products or one product.
 *
 * Category roles decide what a conjunction means:
 *
 *  1. A reviewed compound spanning it — "macaroni and cheese" — makes the
 *     segment one dish; a flavour marker after the second conjunct — "cheddar
 *     cheese and bacon FLAVORED" — makes it one flavour description.
 *  2. Modifier coordination: when a later conjunct's head noun carries its own
 *     modifier ("garlic CROUTONS", "turkey SAUSAGE products"), earlier
 *     conjuncts that reduce to component-category words (meat, seafood, dairy,
 *     pantry) are modifiers of that head and are dropped — "cheese and garlic
 *     croutons" recalls croutons. A produce conjunct is dropped only when the
 *     modified head takes fruit words as flavours ("spinach & pea BABY FOOD
 *     pouches"); beside anything else, produce stays a real product. A bakery
 *     or snack conjunct always stays — "frozen waffle and turkey sausage" is
 *     two products.
 *  3. Dish absorption: a conjunct naming a prepared dish absorbs bare
 *     meat/seafood/dairy words beside it ("meat and poultry dumplings"), and
 *     absorbs a protein conjunct even when marketing words surround it
 *     ("gochujang-glazed salmon and pork bowls" is bowls). Pantry words are
 *     NOT absorbed — "salsa and salads" recalls both — and produce never is.
 */
function resolveConjuncts(segment: string): string[] {
  if (!CONJUNCTION.test(segment)) return [segment];
  if (compoundSpansConjunction(segment)) return [segment];
  if (FLAVOUR_COORDINATION.test(segment)) return [segment];

  const conjuncts = segment
    .split(CONJUNCTION)
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (conjuncts.length < 2) return conjuncts;

  const heads = conjuncts.map((conjunct) => headMatchOf(conjunct));

  let target = -1;
  for (let i = conjuncts.length - 1; i >= 0; i--) {
    if (heads[i] !== null && hasRealModifier(conjuncts[i])) {
      target = i;
      break;
    }
  }
  const targetCategory = target >= 0 ? heads[target]!.category : null;
  const dishIndex = heads.findIndex((head) => head?.category === 'prepared_foods');

  return conjuncts.filter((conjunct, index) => {
    const head = heads[index];
    if (head === null) return true;
    if (index < target && isModifierRun(conjunct)) {
      if (COMPONENT_CATEGORIES.has(head.category)) return false;
      if (
        head.category === 'produce' &&
        targetCategory !== null &&
        (targetCategory === 'prepared_foods' || FLAVOURABLE_TARGETS.has(targetCategory))
      ) {
        return false;
      }
    }
    if (dishIndex >= 0 && index !== dishIndex && ABSORBABLE_CATEGORIES.has(head.category)) {
      if (isModifierRun(conjunct) || PROTEIN_CATEGORIES.has(head.category)) return false;
    }
    return true;
  });
}

/**
 * True when a non-descriptor word precedes the conjunct's head noun — "turkey
 * SAUSAGE products" has one, "fully cooked beef" does not, so only the former
 * makes earlier bare conjuncts read as coordinated modifiers.
 */
function hasRealModifier(conjunct: string): boolean {
  const read = phraseMatches(conjunct);
  if (read === null || read.matches.length === 0) return false;
  const head = read.matches[read.matches.length - 1];
  return read.phrase
    .slice(0, head.start)
    .split(/\s+/)
    .some((word) => word !== '' && !DESCRIPTOR_SET.has(word));
}

/** A reviewed compound covering the conjunction means the segment is one dish. */
function compoundSpansConjunction(raw: string): boolean {
  const segment = unhyphenate(raw);
  for (const entry of COMPILED_COMPOUNDS) {
    entry.regex.lastIndex = 0;
    for (const m of segment.matchAll(entry.regex)) {
      if (CONJUNCTION.test(m[0])) return true;
    }
  }
  return false;
}

/**
 * True when the conjunct is a MODIFIER RUN rather than a product of its own:
 * it reduces to lexicon-recognised words plus descriptors ("frozen meat",
 * "fully cooked beef", "strawberry granola"), and those words do not all name
 * the same aisle. A run naming one aisle twice over — "hummus dip", "cream
 * cheeses" — is a coherent product, not a pile of modifiers.
 */
function isModifierRun(raw: string): boolean {
  const words = unhyphenate(raw)
    .split(/\s+/)
    .filter((word) => word !== '' && !DESCRIPTOR_SET.has(word));
  if (words.length === 0) return false;
  const stripped = words.join(' ');
  const read = phraseMatches(stripped);
  if (read === null || read.matches.length === 0) return false;
  let cursor = 0;
  for (const word of words) {
    const start = stripped.indexOf(word, cursor);
    const end = start + word.length;
    cursor = end;
    if (!read.matches.some((m) => m.start <= start && end <= m.end)) return false;
  }
  const categories = new Set(read.matches.map((m) => m.category));
  return !(read.matches.length >= 2 && categories.size === 1);
}

// ── Lexicon compilation ─────────────────────────────────────────────────────

interface CompiledEntry {
  regex: RegExp;
  category: FoodCategoryId;
}

function compile(entries: readonly LexiconEntry[]): CompiledEntry[] {
  return entries.map((entry) => ({
    regex: new RegExp(`\\b(?:${entry.term})\\b`, 'gi'),
    category: entry.category,
  }));
}

const COMPILED_COMPOUNDS = compile(COMPOUND_TERMS);
const COMPILED_HEADS = compile(HEAD_TERMS);
const COMPILED_NON_FOOD = NON_FOOD_TERMS.map((term) => new RegExp(`\\b(?:${term})\\b`, 'i'));

const FLAVOUR_SUFFIX = new RegExp(`^[\\s-]*(?:${FLAVOUR_MARKERS.join('|')})\\b`, 'i');
const NEGATION_SUFFIX = new RegExp(`^[\\s-]*(?:${NEGATION_MARKERS.join('|')})\\b`, 'i');

interface Match {
  category: FoodCategoryId;
  start: number;
  end: number;
}

/**
 * Non-overlapping matches, longest first so a compound always beats the words
 * inside it, then a match followed by a flavour or negation marker is dropped:
 * "butter flavored popcorn" has no butter in it, "dairy-free" is a promise
 * that dairy is absent.
 */
function matchesIn(phrase: string, compiled: CompiledEntry[], claimed: Match[]): Match[] {
  const found: Match[] = [];
  for (const entry of compiled) {
    entry.regex.lastIndex = 0;
    for (const m of phrase.matchAll(entry.regex)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      const after = phrase.slice(end);
      if (FLAVOUR_SUFFIX.test(after) || NEGATION_SUFFIX.test(after)) continue;
      found.push({ category: entry.category, start, end });
    }
  }
  found.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const kept: Match[] = [];
  for (const candidate of found) {
    const overlaps = (other: Match) => candidate.start < other.end && other.start < candidate.end;
    if (kept.some(overlaps) || claimed.some(overlaps)) continue;
    kept.push(candidate);
  }
  return kept;
}

interface PhraseRead {
  phrase: string;
  matches: Match[];
}

/**
 * All surviving matches of one phrase, in text order: compounds claim their
 * spans first, head terms fill what remains. Null when the phrase names
 * something that is not food.
 */
function phraseMatches(raw: string): PhraseRead | null {
  const phrase = unhyphenate(raw);
  if (COMPILED_NON_FOOD.some((regex) => regex.test(phrase))) return null;
  const compounds = matchesIn(phrase, COMPILED_COMPOUNDS, []);
  const heads = matchesIn(phrase, COMPILED_HEADS, compounds);
  const all = [...compounds, ...heads].sort((a, b) => a.end - b.end || a.start - b.start);
  return { phrase, matches: all };
}

/** The last surviving match — where English puts the head noun. */
function headMatchOf(raw: string): Match | null {
  const read = phraseMatches(raw);
  if (read === null || read.matches.length === 0) return null;
  return read.matches[read.matches.length - 1];
}

/** Facts about the whole product text that phrase readings may consult. */
interface PhraseContext {
  /** The text names more than one product phrase. */
  inList: boolean;
  /** An unsuppressed meat or seafood word appears somewhere in the text. */
  proteinNearby: boolean;
  /** A plant-based / meatless / vegan marker appears somewhere in the text. */
  analogue: boolean;
}

interface PhraseReading {
  category: FoodCategoryId;
  /** Every match in the phrase was a produce word — a flavour-list candidate. */
  produceOnly: boolean;
}

/**
 * Words that describe the package or the amount, never the product — ignored
 * when deciding what a phrase's final substantive word is ("Infant Formula 24
 * oz CANS" ends at formula). Any token containing a digit is a size or a
 * code and is ignored the same way.
 */
const PACKAGING_SIZE_WORDS = new Set([
  'bag',
  'bags',
  'package',
  'packages',
  'case',
  'cases',
  'carton',
  'cartons',
  'box',
  'boxes',
  'pouch',
  'pouches',
  'tray',
  'trays',
  'container',
  'containers',
  'jar',
  'jars',
  'can',
  'cans',
  'bottle',
  'bottles',
  'tub',
  'tubs',
  'packet',
  'packets',
  'clamshell',
  'clamshells',
  'sleeve',
  'sleeves',
  'unit',
  'units',
  'cup',
  'cups',
  'count',
  'ct',
  'oz',
  'lb',
  'lbs',
  'g',
  'kg',
  'ml',
  'l',
  'gallon',
  'gallons',
  'quart',
  'quarts',
  'pint',
  'pints',
  'piece',
  'pieces',
  'serving',
  'servings',
]);

/**
 * In a multi-product list, a phrase whose final substantive word is not part
 * of any match named its product with a word the lexicon does not know
 * ("Bacon Ranch Crunch Kit" beside real salad kits); trusting an interior
 * match would label the flavour, so the honest reading is silence. A
 * single-product text still trusts its last interior match — "Ground Beef
 * Chubs" is beef even though "chubs" is unknown.
 */
function finalWordCovered(read: PhraseRead): boolean {
  let position = read.phrase.length;
  for (const rawWord of read.phrase.split(/\s+/).reverse()) {
    position = read.phrase.lastIndexOf(rawWord, position - 1);
    const word = rawWord.replace(/[^a-z0-9$']/gi, '');
    if (word === '' || /\d/.test(word)) continue;
    if (DESCRIPTOR_SET.has(word) || PACKAGING_SIZE_WORDS.has(word)) continue;
    const start = position;
    const end = start + rawWord.length;
    return read.matches.some((m) => m.start < end && start < m.end);
  }
  return true;
}

/**
 * The category of one product phrase, after the structural rules:
 *
 * - DISH FORMATION: a dishable staple head with a protein anywhere in the
 *   text is a dish — "Meat Pie", "Chicken Fried Rice", "Turkey Stuffed
 *   Pastry", "Canned Spaghetti With Sausage" are Prepared meals, while
 *   "Apple Pie" and "Cheese Biscuits" keep their aisle.
 * - POSTPOSED FLAVOUR: a final produce word yields to an earlier match whose
 *   category takes fruit words as flavours — "Iced Tea Lemon" is tea.
 * - ANALOGUE: a meat or seafood reading in a plant-based product is the
 *   alternative aisle — Prepared meals.
 */
function readPhrase(raw: string, context: PhraseContext): PhraseReading | null {
  const read = phraseMatches(raw);
  if (read === null || read.matches.length === 0) return null;
  if (context.inList && !finalWordCovered(read)) return null;

  const { phrase, matches } = read;
  const head = matches[matches.length - 1];
  let category = head.category;

  const headText = phrase.slice(head.start, head.end);
  if (
    DISHABLE_HEAD.test(headText) &&
    (context.proteinNearby || matches.some((m) => PROTEIN_CATEGORIES.has(m.category)))
  ) {
    category = 'prepared_foods';
  }

  // Postposed flavour applies only to a BARE produce word in head position
  // ("Iced Tea LEMON") — a multi-word produce head like "salad kit" is a real
  // product name, not a flavour.
  if (category === 'produce' && !/\s/.test(headText)) {
    for (let i = matches.length - 2; i >= 0; i--) {
      if (matches[i].category === 'produce') continue;
      if (FLAVOURABLE_TARGETS.has(matches[i].category)) category = matches[i].category;
      break;
    }
  }

  if (context.analogue && (category === 'meat_poultry' || category === 'seafood')) {
    category = 'prepared_foods';
  }

  return { category, produceOnly: matches.every((m) => m.category === 'produce') };
}

/** An unsuppressed meat or seafood word anywhere in the text. */
function proteinIn(normalized: string): boolean {
  const read = phraseMatches(normalized);
  return read !== null && read.matches.some((m) => PROTEIN_CATEGORIES.has(m.category));
}

export function categoryOfPhrase(phrase: string): FoodCategoryId | null {
  const normalized = normalizeProductText(phrase);
  if (normalized === '') return null;
  const reading = readPhrase(normalized, {
    inList: false,
    proteinNearby: proteinIn(normalized),
    analogue: ANALOGUE.test(normalized),
  });
  return reading?.category ?? null;
}

/**
 * Categories for one product text. Empty when the text describes something
 * that is not food, or names nothing the reviewed lexicon recognises — an
 * honest silence, never a guess.
 *
 * Two list-level rules run after the phrases are read:
 *
 * - FLAVOUR ENUMERATION: when a list contains a phrase whose category takes
 *   fruit words as flavours, phrases that are nothing but produce words are
 *   its flavours — "Jolly Rancher Green Apple, Blue Raspberry, Grape Frozen
 *   Confection Pop" is one confection, "Apple, Cherry, and Peach Pies" are
 *   pies. A produce phrase beside Prepared or Meat stays a real product.
 * - STATED AUDIENCE: a name that itself says "for baby"/"for infants" is an
 *   infant-feeding product — "Comforts FOR BABY Purified Water" — which is
 *   the Baby food & formula definition verbatim, not audience inference.
 */
export function matchFoodCategories(text: string): FoodCategoryId[] {
  const normalized = normalizeProductText(text);
  // Empty text goes through the canonical funnel like every other outcome, so
  // the derivation is total: `orderFoodCategories([])` is `['other']`.
  if (normalized === '') return orderFoodCategories([]);

  const phrases = splitProductPhrases(normalized);
  // "In a list" means more than one phrase the lexicon RECOGNISES — a size
  // fragment like "4 count carton" beside one real product is not a list.
  const recognised = phrases.filter((phrase) => headMatchOf(phrase) !== null).length;
  const context: PhraseContext = {
    inList: recognised > 1,
    proteinNearby: proteinIn(normalized),
    analogue: ANALOGUE.test(normalized),
  };

  const readings: PhraseReading[] = [];
  for (const phrase of phrases) {
    const reading = readPhrase(phrase, context);
    if (reading !== null) readings.push(reading);
  }

  const flavourList = readings.some((r) => FLAVOURABLE_TARGETS.has(r.category));
  const kept = readings.filter((r) => !(flavourList && r.produceOnly && r.category === 'produce'));

  let categories = kept.map((r) => r.category);
  if (categories.length > 0 && BABY_AUDIENCE.test(normalized)) categories = ['baby_food_formula'];
  return orderFoodCategories(categories);
}

export interface CategoryResult extends CategoryProductText {
  categories: FoodCategoryId[];
}

/**
 * The whole derivation for one case. This is the seam a later milestone
 * (C5.3C) will call from `projectCase`; nothing calls it from the app yet.
 */
export function categoriesForCase(input: CategoryCaseInput): CategoryResult {
  const productText = categoryProductText(input);
  return { ...productText, categories: matchFoodCategories(productText.text) };
}

/** Re-exported so callers need not import the vocabulary for the cap alone. */
export { MAX_CATEGORIES_PER_CASE };
