/**
 * Deterministic food-category matching (Phase C5.3B).
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
 * ## Why head nouns
 *
 * The audit (C5.3A) measured the naive alternative — union every food word
 * found — at 34.8% multi-category on the active corpus, and most of those
 * extra labels were flavours and ingredients: "Dark Chocolate Cherry Granola"
 * came out as Produce + Snacks + Pantry. English puts the head noun of a food
 * name last and its modifiers first, so reading the LAST match in each product
 * phrase, after letting reviewed compounds claim their spans, cut multi-label
 * to 10.3% at unchanged coverage. Granola is granola.
 *
 * ## Pipeline
 *
 *   product text → normalize → non-food check → split into product phrases
 *   → per phrase: compounds claim spans, then head terms over what is left,
 *     flavour/negation-marked matches dropped, LAST survivor wins
 *   → union across phrases → dedupe, display order, cap at four
 */

import { MAX_CATEGORIES_PER_CASE, orderFoodCategories, type FoodCategoryId } from './food-category';
import {
  COMPONENT_CATEGORY_IDS,
  COMPOUND_TERMS,
  DESCRIPTOR_WORDS,
  FLAVOUR_MARKERS,
  HEAD_TERMS,
  NEGATION_MARKERS,
  NON_FOOD_TERMS,
  type LexiconEntry,
} from './food-category-lexicon';
import type { SourceAgency } from './recall-types';

const DESCRIPTOR_SET = new Set(DESCRIPTOR_WORDS);
const COMPONENT_CATEGORIES = new Set<FoodCategoryId>(COMPONENT_CATEGORY_IDS);

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

export function categoryProductText(input: CategoryCaseInput): CategoryProductText {
  const description = (input.productDescription ?? '').trim();
  if (description !== '') return { text: description, basis: 'product_description' };

  const title = input.title ?? '';
  const phrase = (FSIS_ALERT.exec(title)?.[1] ?? FIRM_RECALLS.exec(title)?.[1] ?? '').trim();
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
 * carry meaning — a stripped word cannot be reviewed later. Hyphens become
 * spaces so one written form covers both ("chocolate-covered" and "chocolate
 * covered", "soup-mix" and "soup mix") without duplicating every entry.
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

/** Separators that genuinely introduce another product. */
const PRODUCT_SEPARATOR = /[;,]|\s+(?:such as|e\.g\.|including|includes)\s+/;

/** Conjunctions, handled separately because they also coordinate MODIFIERS. */
const CONJUNCTION = /\s+(?:and|&|\+)\s+/;

/**
 * Product phrases, in the order they appear.
 *
 * Three structures, handled in the order English applies them: the packaging
 * preposition names the product after it, the ingredient preposition ends the
 * product list, separators enumerate distinct products, and a conjunction may
 * join either two products ("cucumbers and salads") or two modifiers of one
 * product ("cheese and garlic croutons"). Only the last is ambiguous, and
 * `resolveConjuncts` decides it structurally.
 */
export function splitProductPhrases(normalized: string): string[] {
  const afterPackaging = normalized.replace(
    new RegExp(`^.*?${PACKAGING_CONTAINING.source}`, 'i'),
    '',
  );
  const [products, ...rest] = afterPackaging.split(INGREDIENT_CUT);
  const dish = trailingDish(afterPackaging, rest.join(' '));
  if (dish !== null) return [dish];

  const phrases = segmentsOf(products);
  // An ingredient cut that leaves nothing recognisable was not an ingredient
  // cut: "Beddar With Cheddar … Pork Sausage" and "Multiple items with
  // cucumbers" name their product on the far side of the preposition. Falling
  // back to the whole text is the honest reading.
  if (rest.length > 0 && !phrases.some((phrase) => headMatchOf(phrase) !== null)) {
    return segmentsOf(afterPackaging);
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
 * "Spaghetti Loops WITH Meat Sauce Entrée Products" is an entrée. A dish class
 * word — entrée, meal, bowl, dinner — cannot be an ingredient of the thing
 * before it, so when one ends the ingredient clause it is the head of the whole
 * name and replaces the phrases. Restricted to `with`: "Ground Beef IN Meal
 * Kits" is beef that shipped inside a kit, which is the opposite relationship.
 */
function trailingDish(full: string, tail: string): string | null {
  if (tail.trim() === '' || !/\s+(?:with|made with)\s+/.test(full)) return null;
  const head = headMatchOf(tail);
  return head !== null && head.category === 'prepared' ? tail.trim() : null;
}

/**
 * Decide whether a segment's conjuncts are separate products or one product.
 *
 * Three ways a conjunction turns out NOT to separate products:
 *
 *  1. A reviewed compound spans it — "macaroni and cheese", "spaghetti and
 *     meatballs" — so the segment is one dish and is never split.
 *  2. The last conjunct's head noun is preceded by a modifier ("chicken
 *     EMPANADA products", "garlic CROUTONS"), which makes the words before the
 *     conjunction modifiers of that same head; any conjunct that is nothing
 *     but a bare category word is one of them.
 *  3. A conjunct names a prepared DISH, in which case bare component words
 *     beside it — "meat and poultry DUMPLINGS", "pork and beef BEAN STEW" —
 *     are what the dish is made of. Produce is deliberately excluded from
 *     absorption: a contaminated-produce notice routinely recalls the raw
 *     item AND the prepared foods made from it, as two real products.
 */
/**
 * "Cheddar Cheese AND Bacon FLAVORED Pork Patty" coordinates two flavours, not
 * two products. A flavour marker immediately after the conjunct that follows
 * the conjunction proves the whole run is one flavour description.
 */
const FLAVOUR_COORDINATION = new RegExp(
  `\\b(?:and|&)\\s+\\S+\\s+(?:${FLAVOUR_MARKERS.join('|')})\\b`,
  'i',
);

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
  const lastHead = heads[heads.length - 1];
  const modifierCoordination = lastHead !== null && lastHead.start > 0;
  const hasDish = heads.some((head) => head?.category === 'prepared');

  return conjuncts.filter((conjunct, index) => {
    if (index === conjuncts.length - 1) return true;
    if (!isBareTerm(conjunct)) return true;
    if (modifierCoordination) return false;
    const head = heads[index];
    return !(hasDish && head !== null && COMPONENT_CATEGORIES.has(head.category));
  });
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
 * True when the conjunct is one lexicon term plus nothing but descriptors —
 * "frozen meat", "fully cooked beef", "the beef" all reduce to a bare category
 * word, and a bare category word beside a dish is an ingredient.
 */
function isBareTerm(raw: string): boolean {
  const conjunct = unhyphenate(raw);
  const stripped = conjunct
    .split(/\s+/)
    .filter((word) => word !== '' && !DESCRIPTOR_SET.has(word))
    .join(' ');
  if (stripped === '') return false;
  const match = headMatchOf(stripped);
  return match !== null && match.start === 0 && match.end === stripped.length;
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

/**
 * The head match of one phrase: compounds claim their spans first, head terms
 * fill what remains, and the LAST surviving match wins because that is where
 * English puts the head noun.
 */
function headMatchOf(raw: string): Match | null {
  const phrase = unhyphenate(raw);
  if (COMPILED_NON_FOOD.some((regex) => regex.test(phrase))) return null;
  const compounds = matchesIn(phrase, COMPILED_COMPOUNDS, []);
  const heads = matchesIn(phrase, COMPILED_HEADS, compounds);
  const all = [...compounds, ...heads].sort((a, b) => a.end - b.end || a.start - b.start);
  return all.length === 0 ? null : all[all.length - 1];
}

export function categoryOfPhrase(phrase: string): FoodCategoryId | null {
  return headMatchOf(phrase)?.category ?? null;
}

/**
 * Categories for one product text. Empty when the text describes something
 * that is not food, or names nothing the reviewed lexicon recognises — an
 * honest silence, never a guess.
 */
export function matchFoodCategories(text: string): FoodCategoryId[] {
  const normalized = normalizeProductText(text);
  if (normalized === '') return [];

  const categories: FoodCategoryId[] = [];
  for (const phrase of splitProductPhrases(normalized)) {
    const category = categoryOfPhrase(phrase);
    if (category !== null) categories.push(category);
  }
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
