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
import { pairRowDatesAndCodes, type SemanticFact } from './source-tables';
import { packagingOnlyName, variantIdentityRejection } from './variant-identity';

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

/**
 * A stated net weight closing a name: "… EZ Peel Shrimp net wt. 2lbs.",
 * "… Tail-Off Shrimp, net wt. 2lbs.", "… Skewers; net wt. 1.25 lbs.". The
 * words "net wt" are the source labelling what follows as the package size,
 * so the measurement moves to the Size field and the product name ends where
 * the label begins. Without this the sentence's own abbreviation period cut
 * the name at "… Shrimp net wt" and the stated weight was lost entirely.
 */
const NAME_NET_WEIGHT_TAIL =
  /[\s,;]+net\s*\.?\s*w(?:eigh)?t\.?\s*:?\s*((\d[\d.,/]*)\s*-?\s*(?:oz|ounces?|lbs?|pounds?|g|grams?|kg|ml|l|fl\.?\s*oz)\b\.?)\s*[.,;]?\s*$/i;

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

/**
 * Leading container phrase with NO measurement: "Cardboard boxes containing
 * 100 pieces of “BUFFALO CHICKEN RANGOON” …" (recorded FSIS 018-2026). Read
 * whole, the container stood as the item's "name" while the source's own
 * quoted product identity after it went unread. The container is packaging
 * evidence, a stated piece count is the package size, and the quoted string is
 * the product. The captured phrase must itself pass the closed packaging
 * vocabulary, so a product name that merely ends in a container word ("Gift
 * Baskets containing …") never loses its head.
 */
const CONTAINER_PREFIX =
  /^\s*((?:[A-Za-z]+\s+){0,2}?(?:box(?:es)?|bags?|jars?|cartons?|cases?|containers?|tubs?|bottles?|cans?|pouch(?:es)?|trays?|packages?|packs?|sleeves?|wrappers?))\s+(?:containing|holding)\s+(?:(\d[\d,]*)[\s-]*(pieces?|units?|bars?|packets?|pouches?|links?|patties?|count|ct)\s+of\s+)?/i;

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

  // A labelled net weight is package-size evidence wherever the sentence's
  // own punctuation would otherwise have ended the name inside it.
  const netWeight = working.match(NAME_NET_WEIGHT_TAIL);
  if (netWeight) {
    size = netWeight[1].trim();
    working = working.slice(0, netWeight.index).replace(/[\s,;]+$/, '');
  }

  // "8-oz. glass jars containing “NAME”" — the descriptor precedes the name.
  const prefix = working.match(PACKAGE_PREFIX);
  if (prefix) {
    size = `${prefix[2]} ${prefix[3].toLowerCase().replace(/\.$/, '')}`;
    const container = working.match(
      /^\s*[\d,./-]+\s*(?:oz|ounces?|lbs?|pounds?|g|grams?|kg|ml|l|ct|count|pack|pk)\.?\s+([a-z][a-z -]{0,40}?)\s+(?:containing|of|holding|labeled)/i,
    );
    if (container) packaging = container[1].trim();
    working = working.slice(prefix[0].length);
  } else {
    // A container phrase without a measurement, verified against the closed
    // packaging vocabulary before anything is removed.
    const container = working.match(CONTAINER_PREFIX);
    if (container && packagingOnlyName(container[1])) {
      packaging = container[1].trim();
      if (container[2] && container[3]) {
        size = `${container[2]} ${container[3].toLowerCase()}`;
      }
      working = working.slice(container[0].length);
    }
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
  if (size === null && tail && tail.index !== undefined && tail.index >= 3) {
    size = `${tail[2]} ${tail[3].toLowerCase()}`;
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
 * The product a declared IDENTIFIER list belongs to, read from the lead-in
 * sentence that introduces it.
 *
 * AquaStar's combined announcement states three products, each followed by
 * its own bullet list of `UPC …, lot code …, Best If Used By: …` tuples:
 *
 *   <p>The recalled Kroger Raw Colossal EZ Peel Shrimp net wt. 2lbs., is
 *      packaged in … and has the following codes:</p>
 *   <ul><li>UPC 20011110643906, lot code 10662 5085 10, …</li> … </ul>
 *
 * The list itself is correctly classified `identifiers` — its items are
 * markings, not products — and before P3C-2 that meant its contents reached
 * the consumer through the recall-wide prose path: three products' barcodes,
 * fourteen dates and fifteen lot codes pooled into one undifferentiated row,
 * so a shopper holding the 1.25-lb skewers matched against the colossal
 * shrimp's codes.
 *
 * The lead-in paragraph is the source's own statement of who owns the list
 * that follows it. Reading it is structural DOM ownership — the `<p>` before
 * this `<ul>`, nothing else — never pairing by array position across
 * unrelated lists.
 */
const IDENTIFIER_LIST_OWNER =
  /\bthe\s+recalled\s+(.{4,140}?)\s*,?\s+(?:is|are|was|were|has|have|can|could|may|might|will|which|that)\b/i;

/**
 * The lead-in's own last sentence — the one that ends in the colon and hands
 * the list off. A 240-character lead-in usually carries the tail of the
 * paragraph before it as well ("… sold exclusively through Kroger, Meijer,
 * and Target retail stores nationwide between 03/06/2026 and 07/13/2026."),
 * and that sentence can mention a recalled thing of its own. Only the
 * handing-off sentence declares ownership of the list beneath it.
 */
function owningSentence(lead: string): string {
  const sentences = lead.split(/(?<=[.!?])\s+(?=[A-Z“"'])/);
  return sentences[sentences.length - 1];
}

/**
 * The lead-in must hand the list off as THIS product's codes. "has the
 * following codes:" qualifies; a sentence that merely mentions a product
 * before an unrelated list does not.
 */
const LEAD_IN_ITS_CODES = /\b(?:following|these)\s+(?:\w+\s+){0,2}?(?:codes?|lots?|numbers?)\b/i;

/**
 * Affected products declared as a NAMED lead-in over an identifier list
 * (source-shape A). One variant per list — the product the lead-in names,
 * owning every marking its own list states and no other list's.
 *
 * Returns [] whenever the structural evidence is absent: a list with no
 * declaring lead-in, a lead-in that names no product, or a lead-in whose
 * product name fails the closed identity contract. Nothing is guessed, and
 * two lists are never merged.
 */
export function extractIdentifierListOwners(summaryHtml: string | null): ListVariant[] {
  const out: ListVariant[] = [];
  const lists = declaredLists(summaryHtml);
  // The ownership question only exists when the announcement declares SEVERAL
  // such lists. One list and the recall cover the same population, so making
  // a row for it asserts nothing new — and it costs the case-level evidence
  // the source stated elsewhere: the recorded PT Organics notice declares one
  // list, and routing it through a row dropped the metric weight "(113 g)"
  // that its product description preserved. Below two, the existing case path
  // is both correct and richer.
  if (lists.filter((list) => list.role === 'identifiers').length < 2) return out;
  let listIndex = 0;
  for (const list of lists) {
    const index = listIndex++;
    if (list.role !== 'identifiers') continue;
    if (!LEAD_IN_ITS_CODES.test(list.lead)) continue;
    const owner = owningSentence(list.lead).match(IDENTIFIER_LIST_OWNER);
    if (!owner) continue;
    const { name, size, packaging } = itemName(owner[1].trim());
    // The same closed identity contract every other variant name passes. A
    // lead-in that resolves to a date, a place, a code, or a package
    // measurement names no product, and the list stays unowned.
    if (name.length < 3 || variantIdentityRejection(name) !== null) continue;
    // The list's own identity, derived from the source structure — never from
    // where the list happened to fall among unrelated lists.
    const scope = `idlist${index}`;
    const facts: SemanticFact[] = [fact('variant', 'affected product list', name, scope)];
    if (size) facts.push(fact('package_size', 'affected product list', size, scope));
    if (packaging) facts.push(fact('packaging', 'affected product list', packaging, scope));
    // Every tuple in THIS list, with its internal UPC/code/date relationships
    // preserved as the extractor read them. Aggregation into one row per
    // product happens downstream, where the row-local modal can still show
    // each code beside the date the source printed with it.
    for (const item of list.items) {
      // One `<li>` is one row: the code it states and the date it states are
      // the source's own pairing, and it is read by the same shared owner a
      // table row is. A code can never acquire another item's date, and the
      // barcode is deliberately left unpaired.
      for (const identifier of pairRowDatesAndCodes(extractProseIdentifiers(item).facts)) {
        facts.push({ ...identifier, scope });
      }
    }
    if (facts.length === 1) continue;
    out.push({ facts, scope });
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
