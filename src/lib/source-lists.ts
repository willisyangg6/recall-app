/**
 * Consumer Projection V2 — source-declared affected-product lists.
 *
 * Announcements without a product table often state their products as an
 * explicit HTML bullet list under a declared lead-in:
 *
 *   The affected products include White Cheddar Seasoning sold in the
 *   following consumer-facing formats:
 *   • Williams Sonoma–branded Popcorn Sampler Gift Box, … The affected lot
 *     codes are: 088594-2-1.
 *   • Fireworks White Cheddar Seasoning, 1.6 oz jars, … The affected lot
 *     codes are: 088594-7-1.
 *
 * Each list item is one product with its OWN identifiers, exactly as a table
 * row is. Read as loose prose, the three lot codes above merge into one flat
 * "Lot code: A, B, and C" against a single product — the relationship the
 * source stated is destroyed, and a shopper holding the 1.6 oz jar matches
 * against a gift box's code. This module gives list items the same
 * relation-preserving treatment tables already get.
 *
 * Extraction is evidence-gated: only a list whose preceding sentence declares
 * it ("The following … are included:", "affected products include …:") is
 * read as an affected-product list. Arbitrary page lists never qualify.
 */

import { stripHtml } from '@/domain/text';
import { normalizeStateToken } from '@/domain/us-geography';
import { conceptForLabel } from './consumer-concepts';
import { extractProseIdentifiers } from './prose-identifiers';
import type { SemanticFact } from './source-tables';
import { variantIdentityRejection } from './variant-identity';

/** One source-declared list item, as a variant source for `buildVariants`. */
export interface ListVariant {
  facts: SemanticFact[];
  scope: string;
}

/**
 * What a source list IS, decided before any item is interpreted. A list is not
 * an affected-product list just because recall prose precedes it: Pounded
 * Yam's "…distributed in Canada, Australia and the following United States:"
 * declares a GEOGRAPHY list, and reading its items as products rendered six
 * variant cards named California through Texas. Aquafaba's "The following
 * 'best buy' dates are included…" declares an IDENTIFIER list, and reading its
 * items as products named two variants after their own best-by dates.
 */
export type ListRole =
  | 'affected_products'
  | 'geography'
  | 'identifiers'
  /** Label:value rows describing ONE product ("Item name : …", "Lot code : …"). */
  | 'properties'
  /** What the shopper should DO, or which symptoms to watch for. */
  | 'instructions'
  /** Where it was sold — shops, not products. */
  | 'sellers'
  | 'other';

/** The lead-in noun after "following …" that names what the list holds. */
const LEAD_IN_GEOGRAPHY =
  /\bfollowing\s+(?:\w+\s+){0,2}?(?:united\s+states|states?|cities|counties|regions?|areas?)\s*[:\s]*$/i;
const LEAD_IN_IDENTIFIERS =
  /\bfollowing\s+(?:[\w“”"']+\s+){0,3}?(?:dates?|codes?|lots?|numbers?|upcs?|barcodes?)\b/i;

/** An item that is a `Label: value` row for a known concept. */
function isPropertyItem(text: string): boolean {
  const segments = text.split(/\s*[•·]\s*/);
  const labelled = segments[0].match(/^([A-Za-z][A-Za-z /()#-]{1,40}?)\s*:\s*\S/);
  if (!labelled) return false;
  return conceptForLabel(labelled[1]) !== 'unknown';
}

/**
 * A lead-in declaring what the shopper should DO, or what illness looks like.
 * FDA closes most announcements with "Consumers should take the following
 * actions:" over a bulleted list — structurally identical to a product list,
 * and read as one it produced five affected-version cards of instructions.
 */
const LEAD_IN_INSTRUCTIONS =
  /\bfollowing\s+(?:\w+\s+){0,2}?(?:actions?|steps?|instructions?|precautions?|recommendations?|symptoms?)\b/i;

/**
 * A lead-in declaring where the product was sold ("Other grocery stores in
 * Seattle/Tacoma area in WA:"). Only when the sentence never mentions products
 * — "the following products are subject to recall at our stores:" is a product
 * list that happens to name a shop.
 */
const LEAD_IN_SELLERS = /\b(?:stores?|retailers?|supermarkets?|markets?|shops?)\b[^:]{0,60}:\s*$/i;
const LEAD_IN_MENTIONS_PRODUCTS = /\b(?:products?|items?|flavou?rs?|varieties|brands?)\b/i;

/** An item that IS an identifier statement ("Best by 12/14/2026"). */
const IDENTIFIER_ITEM =
  /^["“]?(?:best[- ](?:if[- ]used[- ])?b(?:y|efore)|use[- ]by|sell[- ]by|expir\w*|lot|batch|upc|date)\b/i;

/**
 * Classify one declared list from its lead-in and its items' own shapes. The
 * items outvote the lead-in: whatever the sentence promised, a list whose
 * entries are all states holds geography.
 */
export function classifyListRole(lead: string, items: string[]): ListRole {
  if (items.length === 0) return 'other';
  const states = items.filter((item) => normalizeStateToken(item.trim()) !== null).length;
  if (states === items.length) return 'geography';
  if (LEAD_IN_GEOGRAPHY.test(lead)) return 'geography';
  // Instructions and symptoms are declared exactly as products are, and only
  // the lead-in and the items' own kind tell them apart.
  if (LEAD_IN_INSTRUCTIONS.test(lead)) return 'instructions';
  const narrative = items.filter((item) => {
    const rejection = variantIdentityRejection(item.trim().replace(/[.;]+$/, ''));
    return rejection === 'prose' || rejection === 'symptom';
  }).length;
  if (narrative * 2 > items.length) return 'instructions';
  if (LEAD_IN_SELLERS.test(lead) && !LEAD_IN_MENTIONS_PRODUCTS.test(lead)) return 'sellers';
  const identifierItems = items.filter((item) => IDENTIFIER_ITEM.test(item.trim())).length;
  if (identifierItems * 2 >= items.length && identifierItems > 0) return 'identifiers';
  if (LEAD_IN_IDENTIFIERS.test(lead)) return 'identifiers';
  const propertyItems = items.filter(isPropertyItem).length;
  if (propertyItems * 2 >= items.length && propertyItems > 0) return 'properties';
  return 'affected_products';
}

/**
 * The lead-in must both talk about affected products and hand off with a
 * colon. FSIS interleaves a "[view labels]" link between the words and the
 * colon; it is stripped before the test.
 */
const LEAD_IN_WORDS =
  /\b(?:following|affected\s+products?|products?\s+(?:are\s+)?included|subject\s+to\s+recall)\b/i;

/** A shared size stated in the lead-in itself ("The following 4-count tamales…"). */
const LEAD_IN_SIZE = /\bfollowing\s+(\d+[\s-]?(?:count|ct|pack|pk))\b/i;

/**
 * Boundaries after which an item stops being the product's name. "with" cuts
 * only when an identifier label follows — "Mushroom Spinach & Salsa with Two
 * Cheeses" is a name, "… with lot code 088594-2-1" is a name plus its code.
 */
const NAME_BOUNDARY =
  /(?:,\s*|\s+)(?:containing|sold|available|distributed|packaged|produced|with\s+(?:lot|batch|UPC|a\s+lot|best[-\s]|use[-\s]|sell[-\s]|expiration))\b|\.\s|\s+The\s+affected\b/i;

/** Trailing size(+container) on a name: "…, 1.6 oz jars". */
const NAME_SIZE_TAIL =
  /,\s*((\d[\d./]*)\s*-?\s*(oz|ounces?|lbs?|pounds?|g|grams?|kg|ml|l|fl\.?\s*oz|count|ct|pack|pk)\b\.?)\s*([a-z][a-z ]{0,20})?$/i;

/**
 * Leading package descriptor: "8-oz. glass jars containing …". The descriptor
 * allowance covers FSIS's longer container phrases ("62.4-oz. ALUMINUM PAN
 * WITH PLASTIC OVERWRAP containing …") — a shorter cap left the size token
 * standing as the item's "name" while the source's own quoted product name
 * went unread (benchmark record 012-2026). Comma-grouped weights qualify too:
 * "3,884-lb. super sack of “OvaEasy Plain Whole Egg”" pairs the sack with the
 * quoted product exactly as its comma-less siblings already did.
 */
const PACKAGE_PREFIX =
  /^\s*((\d[\d,./]*)\s*-?\s*(oz|ounces?|lbs?|pounds?|g|grams?|kg|ml|l|fl\.?\s*oz|count|ct|pack|pk)\b\.?)\s+([a-z][a-z -]{0,40}?)\s+(?:packages?|bags?|jars?|boxes?|cartons?|containers?|tubs?|bottles?|cans?|pouches?)?\s*(?:containing|of|holding|labeled)\s+/i;

function fact(
  concept: SemanticFact['concept'],
  sourceLabel: string,
  value: string,
  scope: string,
): SemanticFact {
  return { concept, sourceLabel, value, raw: value, evidence: 'prose', scope };
}

/** Trailing separator/serialization artifacts that are not part of a name. */
const TRAILING_ARTIFACT = /[\s,.;:•·–—-]+$/;

/** The item's product name, with identifier/merchant tails removed. */
function itemName(text: string): {
  name: string;
  size: string | null;
  packaging: string | null;
  /** True when the name was the source's own quoted product string. */
  quoted: boolean;
} {
  let size: string | null = null;
  let packaging: string | null = null;
  let working = text.replace(/[-–—]\s*branded/gi, '').trim();

  // "8-oz. glass jars containing “NAME”" — the descriptor precedes the name.
  const prefix = working.match(PACKAGE_PREFIX);
  if (prefix) {
    size = `${prefix[2]} ${prefix[3].toLowerCase().replace(/\.$/, '')}`;
    const container = working.match(
      /^\s*[\d,./-]+\s*(?:oz|ounces?|lbs?|pounds?|g|grams?|kg|ml|l|ct|count|pack|pk)\.?\s+([a-z][a-z -]{0,40}?)\s+(?:containing|of|holding|labeled)/i,
    );
    if (container) packaging = container[1].trim();
    working = working.slice(prefix[0].length);
  }

  const boundary = working.search(NAME_BOUNDARY);
  let name = (boundary >= 0 ? working.slice(0, boundary) : working).trim();
  // A name the source itself quoted is exactly the quoted string, wherever
  // the boundary landed — FSIS items open with the quoted label text
  // ('10.5-oz can of "tasty KITCHEN …"'), and the quotes make the identity
  // certain whatever the boundary search saw after them.
  let quotedName = false;
  const leadQuoted = name.match(/^[“"']([^“”"]{3,80})(?:[”"']|$)/);
  if (leadQuoted) {
    name = leadQuoted[1];
    quotedName = true;
  } else {
    name = name.replace(/^[“"']|[”"']$/g, '');
    const quoted = name.match(/[“"]([^“”"]{3,80})[”"]/);
    if (quoted) {
      name = quoted[1];
      quotedName = true;
    }
  }
  name = name.replace(TRAILING_ARTIFACT, '').trim();

  // "…, 1.6 oz jars" at the end of the name is the size, not the name.
  const tail = name.match(NAME_SIZE_TAIL);
  if (tail && tail.index !== undefined && tail.index >= 3) {
    size = size ?? `${tail[2]} ${tail[3].toLowerCase()}`;
    if (tail[4] && tail[4].trim() !== '') packaging = packaging ?? tail[4].trim();
    name = name.slice(0, tail.index).replace(/[\s,]+$/, '');
  }
  return { name, size, packaging, quoted: quotedName };
}

/** One declared list: its lead-in sentence tail and its items' text. */
interface DeclaredList {
  lead: string;
  items: string[];
  role: ListRole;
}

/**
 * Every list the announcement's own prose declares with a lead-in ending in a
 * colon. Page chrome, figures, and undeclared lists never qualify.
 */
function declaredLists(summaryHtml: string | null): DeclaredList[] {
  if (!summaryHtml) return [];
  const out: DeclaredList[] = [];
  let cursor = 0;
  for (const match of summaryHtml.matchAll(/<[ou]l\b[^>]*>([\s\S]*?)<\/[ou]l>/gi)) {
    const before = summaryHtml.slice(cursor, match.index);
    cursor = match.index! + match[0].length;

    // Page-chrome and figure/photo lists are never product lists.
    if (/<(?:img|figure|picture|svg|nav)\b/i.test(match[1])) continue;
    if (/class="[^"]*(?:lcds|nav|menu|list-unstyled)[^"]*"/i.test(match[0])) continue;

    // The declaring lead-in, from the text directly before the list. The
    // "[view labels]" link FSIS inserts is dropped before testing the tail.
    const lead = stripHtml(before)
      .replace(/\[[^\]]{0,80}\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(-240);
    if (!/[:]\s*$/.test(lead) || !LEAD_IN_WORDS.test(lead)) continue;

    const items = [...match[1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
      .map((item) => stripHtml(item[1]).replace(/\s+/g, ' ').trim())
      .filter((text) => text.length >= 2 && text.length <= 400);
    if (items.length < 2) continue;
    out.push({ lead, items, role: classifyListRole(lead, items) });
  }
  return out;
}

/**
 * Extract source-declared affected-product lists from the announcement's own
 * HTML, one variant per item, each owning the identifiers its item states.
 * Returns [] whenever the structural evidence is absent — never a guess.
 * Lists whose role is geography, identifiers, sellers, instructions, or
 * single-product properties are NOT product lists and contribute no variants;
 * their content reaches the consumer through the distribution and prose paths
 * that own those kinds.
 */
export function extractAffectedProductLists(summaryHtml: string | null): ListVariant[] {
  const out: ListVariant[] = [];
  let listIndex = 0;
  for (const list of declaredLists(summaryHtml)) {
    if (list.role !== 'affected_products') continue;
    const sharedSize = list.lead.match(LEAD_IN_SIZE)?.[1]?.replace(/-/g, ' ') ?? null;
    const index = listIndex++;
    list.items.forEach((text, itemIndex) => {
      if (text.length < 4) return;
      const scope = `list${index}i${itemIndex}`;
      const { name, size, packaging, quoted } = itemName(text);
      // A lowercase lead marks a prose fragment — unless the source itself
      // quoted the name ("tasty KITCHEN Chicken Noodle Condensed Soup"),
      // which makes the identity certain whatever its casing.
      if (name.length < 3 || (!quoted && /^[a-z]/.test(name))) return;
      const facts: SemanticFact[] = [fact('variant', 'affected product list', name, scope)];
      const stated = size ?? sharedSize;
      if (stated) facts.push(fact('package_size', 'affected product list', stated, scope));
      if (packaging) facts.push(fact('packaging', 'affected product list', packaging, scope));
      for (const identifier of extractProseIdentifiers(text).facts) {
        facts.push({ ...identifier, scope });
      }
      out.push({ facts, scope });
    });
  }
  return out;
}

/**
 * States stated as a declared geography list under a distribution lead-in —
 * "OLA-OLA POUNDED YAM was distributed … in Canada, Australia and the
 * following United States:" followed by one state per bullet. These are
 * distribution facts the sentence-level extractors cannot see (each state
 * stands on its own line), and losing them left the case with no geography at
 * all while the states rendered as product variants.
 */
export function extractDistributionListStates(summaryHtml: string | null): string[] {
  const states: string[] = [];
  for (const list of declaredLists(summaryHtml)) {
    if (list.role !== 'geography') continue;
    if (!/\b(?:distribut\w+|sold|shipped|available|deliver\w+)\b/i.test(list.lead)) continue;
    for (const item of list.items) {
      const state = normalizeStateToken(item.trim());
      if (state && !states.includes(state)) states.push(state);
    }
  }
  return states;
}
