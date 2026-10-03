/**
 * The product name in an outgoing notification's title (2026-10-03): one
 * deterministic, source-derived, notification-only short name. It never
 * reaches the ledger, the projection or any screen; the full name stays on
 * the recall the notification opens.
 *
 * ## The order
 *
 * 1. The card's own name (`cleanProductName`): the structured product
 *    description, else the parsed headline, else the title, with the card's
 *    trailing-size rule and the shared shopper casing. WITHOUT the card's
 *    brand-prefix strip: the card shows the brand on its own line, a
 *    notification has no such line, so `Tostitos Avocado Salsa Dip` keeps
 *    `Tostitos`.
 * 2. Notification-only removals, each a confident classification, never a
 *    guess about meaning:
 *    - code metadata after a separator (`, UPC …`, `| Lot …`, `, best
 *      before …`);
 *    - parentheticals that hold only package sizes (`(NET WT 38 OZ, 107 G)`,
 *      `(16 FL OZ glass jars)`);
 *    - a trailing size list (`, 7 oz., 10 oz. and 16 oz`, `in 50 gram, …
 *      and 1 kilogram packages.`);
 *    - an exact repeat of a list item.
 *    Flavours, formulations, allergens and brands are words like any other
 *    and are never targeted: nothing here matches `Peanut Butter`,
 *    `Gluten-Free` or `Black Sesame`.
 * 3. Only when the name is still over `PRODUCT_SOFT_LIMIT` AND the recall
 *    names two or more distinct products: `{Brand} products` when exactly one
 *    real brand is on record (`displayBrand`'s junk and length rules) AND the
 *    name or every product line carries it, or the existing `Multiple
 *    products and brands` when several brands are on record. Never an
 *    invented category or brand.
 * 4. Otherwise a cut at a whole word with an ellipsis, dangling joiners and
 *    punctuation dropped, never inside a grapheme (a single overlong word is
 *    cut between graphemes).
 *
 * The limit is a soft one for the product part only (the `Recall alert: `
 * prefix is outside it). iOS decides the wrapping and truncation it shows;
 * nothing here promises a number of lines.
 */

import { parseProductLine } from '../../lib/consumer-summary';
import { cleanProductName, displayBrand } from '../../lib/recall-presentation';
import {
  measurementOnlyName,
  packagingOnlyName,
  splitTrailingMeasurements,
} from '../../lib/variant-identity';
import type { CaseProjection } from '../../domain/recall-types';

/**
 * The product part's soft limit, in graphemes. 55 keeps the longest prefix
 * (`Recall retracted: `, 18) plus the product at or under 73 characters:
 * the live corpus' longest titles today (74) are this formatter's truncated
 * ones, and 55 still holds every 50-character name whole (median 34).
 */
export const PRODUCT_SOFT_LIMIT = 55;

/** The existing generic label (lib/recall-presentation.ts `displayBrand`). */
export const MULTIPLE_PRODUCTS_AND_BRANDS = 'Multiple products and brands';

type NameSource = Pick<
  CaseProjection,
  'title' | 'productDescription' | 'brands' | 'recallingFirm' | 'affectedProducts'
>;

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
const graphemes = (text: string): string[] =>
  Array.from(segmenter.segment(text), (part) => part.segment);

/** A code/date field label opening a metadata tail. */
const CODE_LABEL =
  /(?:\s*[,;|]\s*|\s+[-–—]\s+|\s*\(\s*)(?:upcs?|upc\/code date|lot(?:\s+(?:codes?|numbers?|no\.?|#))?s?|batch(?:\s+codes?)?|item\s+codes?|sku|code\s+dates?|best[\s-]+(?:before|by)|use[\s-]+by|sell[\s-]+by|exp(?:iration|iry)?\.?(?:\s+dates?)?)\b[\s\S]*$/i;

const UNIT = String.raw`(?:fl\.?\s*oz|oz|ounces?|lbs?|pounds?|g|grams?|kg|kilograms?|mg|ml|mL|l|liters?|litres?|gal(?:lons?)?|qt|pt|ct|count|pack|pk|pcs?|pieces?)\.?`;
/** A container word that may follow a size: `16 FL OZ glass jars`, `34 oz Tubs`. */
const CONTAINER = String.raw`(?:\s+(?:glass|plastic|paper|metal|foil|single|retail))?\s+(?:packages?|packs?|packets?|bags?|jars?|bottles?|containers?|pouches?|cans?|boxes?|tubs?|cartons?|cups?|trays?|tins?)`;
/** One size: `12.6`, `19.8 oz`, `NET WT 38 OZ`, `34 oz Tubs`. */
const SIZE = String.raw`(?:net\s+wt\.?\s*|net\s+weight\s*)?\d+(?:[.,/]\d+)?(?:\s*${UNIT})?(?:${CONTAINER})?`;
const SIZES = String.raw`${SIZE}(?:\s*(?:,|/|&|\bor\b|\band\b)\s*(?:and\s+|or\s+)?${SIZE})*`;
/** A list counts as sizes only when at least one number carries a unit. */
const HAS_UNIT = new RegExp(String.raw`\d\s*${UNIT}(?![\p{L}])`, 'iu');
/** A parenthetical made of package sizes (and container words) only. */
const SIZE_PARENTHETICAL = new RegExp(String.raw`\s*\(\s*${SIZES}\s*\)`, 'gi');
/** A closing size list, after `in` or not: `… Powder in 50 gram, …, and 1 kilogram packages.` */
const SIZE_TAIL = new RegExp(String.raw`(?:\s+in)?\s+${SIZES}\s*\.?$`, 'i');
const unlessSizes = (match: string) => (HAS_UNIT.test(match) ? '' : match);

/** Drops brackets left unmatched (by the source or a removal): `(12 oz Pouches`. */
function balanceBrackets(text: string): string {
  const open: number[] = [];
  const drop = new Set<number>();
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '(') open.push(i);
    else if (text[i] === ')' && open.pop() === undefined) drop.add(i);
  }
  for (const i of open) drop.add(i);
  return drop.size === 0 ? text : [...text].filter((_, i) => !drop.has(i)).join('');
}

/** Joiners and punctuation a cut or a removal must never leave at the end. */
const DANGLING =
  /(?:[\s,;:/+&(–—-]+|\s+(?:and|or|with|in|of|for|the|a|an|including|includes|plus|from|to|by)\.?)+$/i;

function tidy(text: string): string {
  let out = text.replace(/\s+/g, ' ').trim();
  for (let previous = ''; previous !== out;) {
    previous = out;
    out = out.replace(DANGLING, '').trim();
  }
  return out;
}

const itemKey = (item: string) =>
  item
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Drops a list item that EXACTLY repeats an earlier one (case, spacing and
 * punctuation aside). Items are split on commas and `and` only to find
 * repeats; a name with no exact repeat is returned untouched, so `Black &
 * White` or `Hard and Soft Cheese` are never re-joined differently.
 */
export function dropExactRepeats(name: string): string {
  const parts = name.split(/(\s*,\s*(?:and\s+)?|\s+and\s+)/i);
  const seen = new Set<string>();
  const kept: string[] = [];
  let dropped = false;
  for (let i = 0; i < parts.length; i += 2) {
    const key = itemKey(parts[i]);
    if (key !== '' && seen.has(key)) {
      dropped = true;
      continue;
    }
    seen.add(key);
    if (kept.length > 0) kept.push(parts[i - 1]);
    kept.push(parts[i]);
  }
  return dropped ? tidy(kept.join('')) : name;
}

/** The notification-only removals (step 2), each a confident classification. */
export function stripNotificationNoise(name: string): string {
  let out = name.replace(CODE_LABEL, '');
  out = out.replace(SIZE_PARENTHETICAL, unlessSizes);
  out = tidy(out).replace(SIZE_TAIL, unlessSizes);
  out = tidy(out);
  const trailing = splitTrailingMeasurements(out);
  if (trailing) out = trailing.base;
  return dropExactRepeats(tidy(balanceBrackets(out)));
}

/**
 * Cuts to at most `limit` graphemes INCLUDING the ellipsis: at the last
 * whole word that fits, joiners dropped; a single word longer than the limit
 * is cut between graphemes.
 */
export function ellipsize(name: string, limit = PRODUCT_SOFT_LIMIT): string {
  const all = graphemes(name);
  if (all.length <= limit) return name;
  const head = all.slice(0, limit - 1);
  const breakAt = head.lastIndexOf(' ');
  const wordCut =
    breakAt > 0 && all[limit - 1] !== ' ' ? head.slice(0, breakAt).join('') : head.join('');
  const cut = tidy(wordCut);
  return `${cut === '' ? tidy(head.join('')) : cut}…`;
}

/**
 * Distinct affected products, sizes and codes aside: each line's own product
 * name (`parseProductLine` splits FDA's `Name | UPC … | Size …` rows and
 * FSIS's quoted names), so one formula in three sizes is one product.
 */
function distinctProducts(source: NameSource): number {
  const keys = new Set<string>();
  for (const line of source.affectedProducts ?? []) {
    const parsed = parseProductLine(line.rawText || line.name)?.name ?? line.name;
    const name = stripNotificationNoise(parsed);
    // A size, a container, a code or a `Field: value` fragment names no product.
    const unsized = tidy(name.replace(new RegExp(SIZE, 'gi'), ' '));
    if (unsized === '' || measurementOnlyName(name) || packagingOnlyName(unsized)) continue;
    if (/^[^:]{1,40}:\s/.test(name) || !/\p{L}{3}/u.test(name)) continue;
    keys.add(itemKey(name));
  }
  return keys.size;
}

/** `American Regent, Inc.` is one brand, though its comma splits it in two. */
const CORPORATE_SUFFIX = /^(?:inc|llc|l\.l\.c|ltd|co|corp|corporation|company|limited)\.?$/i;

/** `text` names `brand` as whole words (case, spacing and punctuation aside). */
function names(text: string, brand: string): boolean {
  return ` ${itemKey(text)} `.includes(` ${itemKey(brand)} `);
}

/**
 * The one brand on record is SHARED by the products only with evidence: the
 * name itself carries it, or every affected-product line does. A brand field
 * the product lines contradict (`Marcum … & Supreme Tradition …` under
 * `Colonna`) never becomes `Colonna products`.
 */
function brandShared(brand: string, name: string, source: NameSource): boolean {
  if (names(name, brand)) return true;
  const lines = source.affectedProducts ?? [];
  return lines.length > 0 && lines.every((line) => names(`${line.name} ${line.rawText}`, brand));
}

/** The product part of a notification title. */
export function notificationProductName(source: NameSource): string {
  const evidence = (source.affectedProducts ?? []).map(
    (product) => product.rawText ?? product.name ?? '',
  );
  const full = cleanProductName({
    title: source.title,
    productDescription: source.productDescription ?? null,
    displayedBrands: [],
    packageEvidence: evidence,
  });
  const cleaned = stripNotificationNoise(full);
  // A removal never empties a name: the app's own fallback name stands.
  const name = /\p{L}/u.test(cleaned) && cleaned.length >= 3 ? cleaned : tidy(full);
  if (graphemes(name).length <= PRODUCT_SOFT_LIMIT) return name;
  if (distinctProducts(source) >= 2) {
    const brand = displayBrand(
      source.brands,
      source.recallingFirm?.displayName ?? null,
      source.title,
    );
    if (
      brand.usedBrand &&
      brand.brands.length === 1 &&
      brandShared(brand.brands[0], name, source)
    ) {
      const group = `${brand.brands[0]} products`;
      if (graphemes(group).length <= PRODUCT_SOFT_LIMIT) return group;
    }
    const realBrands = brand.brands.filter((name) => !CORPORATE_SUFFIX.test(name));
    if (brand.usedBrand && realBrands.length >= 2) return MULTIPLE_PRODUCTS_AND_BRANDS;
  }
  return ellipsize(name);
}
