/**
 * Retailer / "sold at" extraction (consumer role distinct from recalling firm
 * and brand — architecture Part 4 `retailers`; personalization readiness for
 * store preferences).
 *
 * Deterministic and source-grounded only: a retailer is reported when the
 * notice's own text names one in a sold-at/shipped-to/distributed-to
 * construction ("sold in 2-lb bags at BJ's Wholesale Club stores", "shipped
 * to Publix retail stores"). Retail footprint is never inferred from outside
 * knowledge, and a recalling company is never assumed to be the retailer.
 *
 * The structural guarantee (architecture: closed distribution taxonomy): a
 * string can appear as a retailer only through retailer EVIDENCE — a sold-at
 * construction with a venue word, an explicit store-list heading, or a
 * source table's Retailer column. Looking like a proper noun is not evidence,
 * and known place names (states, cities, boroughs) are rejected outright, so
 * "Brooklyn" or "Ann Arbor" can never render as somewhere to shop.
 */

import { isUsCityName, STATE_NAMES } from './us-geography';

/**
 * Matches "<verb-phrase> [the following] [select] <Name> [retail/grocery/…]
 * stores/locations/clubs…". The name must start capitalized so generic
 * phrases ("sold at grocery stores", "sold in the frozen section") never
 * qualify.
 */
const NAME = "[A-Z][A-Za-z0-9'’&.\\- ]{1,40}?";
/**
 * A retailer name used without a venue word must look like a brand: one or two
 * capitalized tokens, optionally hyphenated or possessive ("Costco", "H-E-B",
 * "Aldi's", "Trader Joe's"). Longer runs of prose can never qualify.
 */
const NAME_STRICT = "[A-Z][A-Za-z0-9'’&.-]{1,20}(?:\\s+[A-Z][A-Za-z0-9'’&.-]{1,20})?";
const VENUE =
  '(?:retail\\s+|grocery\\s+|wholesale\\s+)?((?:S|s)tores?|(?:L|l)ocations?|(?:C|c)lubs?|(?:M|m)arkets?|(?:S|s)upermarkets?)\\b';

const RETAILER_PATTERNS = [
  // "shipped to Publix retail stores", "distributed to the following Costco locations",
  // "sold at Walmart stores", "available at Whole Foods Market locations"
  new RegExp(
    `\\b(?:sold|shipped|distributed|available)(?:\\s+(?:exclusively|only|directly))?\\s+(?:at|in|to|through)\\s+(?:the\\s+following\\s+)?(?:select\\s+)?(?:\\d+\\s+)?(${NAME})\\s+${VENUE}`,
    'g',
  ),
  // Package phrase between verb and venue: "sold in 2-lb bags at BJ's Wholesale Club stores"
  new RegExp(
    `\\b(?:sold|available|purchased)\\b[^.;\\n]{0,40}?\\bat\\s+(?:select\\s+)?(?:\\d+\\s+)?(${NAME})\\s+${VENUE}`,
    'g',
  ),
  // Geography between verb and venue: "distributed in Southern California,
  // Southern Nevada, Arizona, and Utah through Target retail stores". The
  // name+venue construction is the retailer evidence; the places in between
  // belong to geography and are typed there.
  new RegExp(`\\bthrough\\s+(?:select\\s+)?(${NAME_STRICT})\\s+${VENUE}`, 'g'),
  // Named retailer without a venue word, which notices write constantly:
  // "sold only at Costco", "shipped to H-E-B", "distributed through Aldi's".
  // Restricted to exclusive/directed constructions so a bare place name in
  // ordinary distribution prose ("distributed in Pennsylvania") never matches;
  // place names are additionally rejected by NOT_RETAILERS below.
  new RegExp(
    `\\b(?:sold\\s+(?:exclusively|only)\\s+(?:at|in|through)|shipped\\s+to|available\\s+exclusively\\s+at|distributed\\s+(?:through|to))\\s+(?:select\\s+)?(${NAME_STRICT})\\b`,
    'g',
  ),
];

/** Words that are places, quantifiers, or prose — never retailer identities. */
const NOT_RETAILERS = new Set(
  [
    'The',
    'These',
    'Their',
    'Its',
    'Our',
    'Select',
    'Various',
    'Multiple',
    'All',
    'Both',
    'Consumers',
    'Customers',
    'Distributors',
    'Retailers',
    'Wholesalers',
    'Stores',
    'Retail',
    'Grocery',
    'Distribution',
    'Distribution Centers',
    // FSIS boilerplate offers its hotline "in English and Spanish"; a
    // language is never a store.
    'English',
    'Spanish',
    'USDA',
    'FSIS',
    'FDA',
    'Nationwide',
    ...STATE_NAMES,
    'United States',
    'US',
    'U.S.',
  ].map((s) => s.toLowerCase()),
);

/** Trailing corporate/possessive noise that is not part of the retailer name. */
const NAME_TRIM = /\s+(?:brand|branded)$|['’']s$/;

/**
 * A state the notice named before the store: "…distributed in Connecticut to
 * Big Y stores". A pattern whose name group tolerates spaces swallows the
 * geography along with the store, and the reader is told they shopped at a
 * place called "Connecticut to Big Y".
 */
const LEADING_PLACE = new RegExp(
  `^(?:${[...NOT_RETAILERS].map((n) => n.replace(/[.\\]/g, '\\$&')).join('|')})\\s+(?:to|in|at|through)\\s+`,
  'i',
);

/** One store name, cleaned of the wording around it. */
function cleanRetailerName(raw: string): string {
  return raw
    .replace(LEADING_PLACE, '')
    .replace(NAME_TRIM, '')
    .replace(/[\s,]+$/, '')
    .trim();
}

/** A trailing geography word makes the phrase a place ("Madison area stores"). */
const PLACE_TAIL = /\b(?:area|areas|region|regions|county|counties|metro|vicinity|market)$/i;

/**
 * A run of store names after one selling verb: "sold only at Costco, BJ's
 * Wholesale Club and Sam's Club". The verb is stated once and the rest of the
 * list inherits it, so a pattern anchored on the verb finds only the first
 * store and the others are silently lost — exactly the compression into
 * "grocery stores" this layer exists to prevent.
 */
/**
 * Two-letter state codes and contact addresses. A sentence pattern will happily
 * read "distributed to NY and NJ in supermarkets" or "available at
 * Compliance@Snapchill" as store names; neither is somewhere a person shopped.
 */
const STATE_CODE_NAME =
  /^(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)$/;

/**
 * Values that are the wrong KIND of thing to be a store. A "Sold After" column
 * holds dates and a product list holds barcodes; both start with a capital and
 * both were being read as retailer names.
 */
const NOT_A_RETAILER_VALUE =
  /^(?:January|February|March|April|May|June|July|August|September|October|November|December)\b|^\d+$|\b\d{6,}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|^(?:Sold|Distributed|Shipped|Available|Sells)\b|\b(?:grocery stores|retail stores|retail markets|convenience stores)\b/i;

/**
 * A street address. "2 B Sweet" and "2 Kids Candy Store" are real shops whose
 * names start with a number, so a bare leading-digit rule would lose them; an
 * address is told apart by its street suffix or its ZIP.
 */
const STREET_ADDRESS =
  /^\d{1,6}\s+.*\b(?:Ave|Avenue|St|Street|Rd|Road|Blvd|Dr|Drive|Ln|Lane|Way|Ct|Court|Hwy|Highway|Pkwy|Plaza|Plz|Sq|Ste|Suite|Blvd\.)\b|\b\d{5}(?:-\d{4})?$/i;

/**
 * A directional or scale prefix before a place name makes a REGION — "Southern
 * California", "Northern Nevada", "Greater Boston". A region is geography as
 * surely as the bare place is, and it was rendering under RETAILERS because
 * only exact state names were being rejected.
 */
const REGION_PREFIX =
  /^(?:Southern|Northern|Eastern|Western|Central|Northeastern|Northwestern|Southeastern|Southwestern|Upstate|Downstate|Greater|Metro)\s+(.+)$/;

/** A single name that denotes US geography rather than a business. */
function isGeographicEntity(name: string): boolean {
  const trimmed = name.trim();
  if (NOT_RETAILERS.has(trimmed.toLowerCase())) return true;
  if (isUsCityName(trimmed)) return true;
  const region = trimmed.match(REGION_PREFIX);
  if (region && isGeographicEntity(region[1])) return true;
  // A run of state names is a mis-split geography cell ("California Nevada"),
  // never a chain.
  const words = trimmed.split(/\s+and\s+|\s+/);
  if (words.length > 1 && words.every((word) => NOT_RETAILERS.has(word.toLowerCase()))) {
    return true;
  }
  return false;
}

export function isRetailerName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 2 || !/^[A-Z0-9]/.test(trimmed)) return false;
  if (STREET_ADDRESS.test(trimmed)) return false;
  if (PLACE_TAIL.test(trimmed)) return false;
  if (STATE_CODE_NAME.test(trimmed) || trimmed.includes('@')) return false;
  if (NOT_A_RETAILER_VALUE.test(trimmed)) return false;
  // Known geography is never a store: states, cities, boroughs, directional
  // regions, and conjunctions of any of them ("Ann Arbor and Brighton",
  // "Southern California", "California Nevada").
  if (isGeographicEntity(trimmed)) return false;
  const conjuncts = trimmed.split(/\s+and\s+/);
  if (conjuncts.length > 1 && conjuncts.every((part) => isGeographicEntity(part.trim()))) {
    return false;
  }
  // Government/help-line domains are contact details, not stores.
  if (/\.(?:gov|org|net|edu)\b/i.test(trimmed)) return false;
  return true;
}

// The preposition matters: "sold AT Kroger, Safeway and Albertsons" names
// stores; "distributed IN Brooklyn, Queens" names places. A bare name list
// after "in" is geography until some other evidence says otherwise, so "in"
// is deliberately absent here.
const RETAILER_LIST = new RegExp(
  `\\b(?:sold(?:\\s+(?:exclusively|only))?\\s+(?:at|through)|shipped\\s+to|distributed\\s+(?:to|through)|available\\s+at)\\s+(?:the\\s+following\\s+)?(?:select\\s+)?(${NAME_STRICT}(?:\\s*,\\s*${NAME_STRICT})*(?:\\s*,?\\s+and\\s+${NAME_STRICT})?)`,
  'g',
);

/**
 * A run of stores each qualified by where it operates: "distributed to PCC
 * Markets in Washington, Earth Fare Stores in Florida and South Carolina, and
 * select independent retailers." A pattern anchored on one verb finds only the
 * first store; the rest are silently lost, which is precisely the compression
 * into "retail stores" this layer exists to prevent.
 */
const RETAILERS_IN_PLACES = new RegExp(
  `\\b(?:sold|shipped|distributed|available)(?:\\s+(?:exclusively|only|directly))?\\s+(?:at|in|to|through)\\s+([^.;\\n]{10,220})`,
  'gi',
);

/** The state qualifier a store name carries ("PCC Markets in Washington"). */
const IN_PLACE_TAIL = /\s+in\s+([A-Z][A-Za-z. ]*(?:\s+and\s+[A-Z][A-Za-z. ]*)*)$/;

/** A lowercase venue word is the source describing the name, not part of it. */
const VENUE_SUFFIX = /\s+(?:stores?|locations?|markets?|supermarkets?|clubs?)$/;

function namesInPlaceClause(clause: string): string[] {
  return (
    clause
      // A lowercase venue word followed by "in" hands the sentence over to
      // geography: everything after "Market of Choice stores in" is a city
      // list, not more stores. A capitalized venue word ("PCC Markets in
      // Washington") is part of the store's name and keeps its clause.
      .replace(/\b(stores?|locations?|shops?|outlets?)\s+in\s[\s\S]*$/, '$1')
      // The towns a notice puts in parentheses are geography, and their own
      // commas would otherwise split one store name into fragments:
      // "Labonne's Supermarkets (Watertown and Prospect)".
      .replace(/\([^)]*\)?/g, '')
      // Commas separate stores. A bare "and" does not — "Stop and Shop" is one.
      .split(/\s*,\s*(?:and\s+)?/)
      .map((part) =>
        part
          .replace(IN_PLACE_TAIL, '')
          // A lowercase venue word is the source describing the name, not part
          // of it; a capitalized one ("PCC Markets") is the name.
          .replace(VENUE_SUFFIX, '')
          .replace(/[\s,.;]+$/, ''),
      )
      .map(cleanRetailerName)
      .filter((part) => part.split(/\s+/).length <= 4 && isRetailerName(part))
  );
}

export interface RetailerPlaces {
  retailer: string;
  /** The place names the source's own clause attached to this retailer. */
  places: string[];
}

/**
 * Retailer → place relationships from "X in Washington, Y in Florida and
 * South Carolina" clauses. The places come from the SAME clause item as the
 * store name, so the relationship is the source's own statement, never an
 * inference. Callers classify each place as a state or a city.
 */
export function retailersWithPlaces(text: string | null): RetailerPlaces[] {
  if (!text) return [];
  const out: RetailerPlaces[] = [];
  for (const match of text.matchAll(RETAILERS_IN_PLACES)) {
    const clause = match[1]
      .replace(/\b(stores?|locations?|shops?|outlets?)\s+in\s[\s\S]*$/, '$1')
      .replace(/\([^)]*\)?/g, '');
    for (const part of clause.split(/\s*,\s*(?:and\s+)?/)) {
      const tail = part.match(IN_PLACE_TAIL);
      if (!tail) continue;
      const name = cleanRetailerName(
        part
          .replace(IN_PLACE_TAIL, '')
          .replace(VENUE_SUFFIX, '')
          .replace(/[\s,.;]+$/, ''),
      );
      if (name.split(/\s+/).length > 4 || !isRetailerName(name)) continue;
      const places = tail[1]
        .split(/\s+and\s+/)
        .map((place) => place.trim().replace(/[.,;]+$/, ''))
        .filter((place) => place !== '');
      if (places.length === 0) continue;
      if (!out.some((entry) => entry.retailer.toLowerCase() === name.toLowerCase())) {
        out.push({ retailer: name, places });
      }
    }
  }
  return out;
}

/**
 * Source-stated retailer names from notice text, in order of appearance.
 * Empty array = the source states no retailer relationship (most notices) —
 * never a guess.
 */
export function extractRetailerNames(text: string | null): string[] {
  if (!text) return [];
  const names: string[] = [];
  for (const match of text.matchAll(RETAILER_LIST)) {
    // Only a genuine list; a lone name is already handled by the patterns
    // below, which apply their own stricter context checks.
    const parts = match[1].split(/\s*,\s*|\s+and\s+/).filter((part) => part.trim() !== '');
    if (parts.length < 2) continue;
    for (const part of parts) {
      const name = cleanRetailerName(part);
      if (!isRetailerName(name)) continue;
      if (!names.some((existing) => existing.toLowerCase() === name.toLowerCase()))
        names.push(name);
    }
  }
  for (const match of text.matchAll(RETAILERS_IN_PLACES)) {
    const parts = namesInPlaceClause(match[1]);
    // Only a genuine multi-store run; a lone name is left to the stricter
    // patterns below, which check the context around it.
    if (parts.length < 2) continue;
    for (const name of parts) {
      if (!names.some((existing) => existing.toLowerCase() === name.toLowerCase()))
        names.push(name);
    }
  }
  for (const pattern of RETAILER_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      // A chain whose name ENDS in the venue word keeps it: the source
      // capitalizes "PCC Markets" and lowercases "Publix retail stores", which
      // is exactly the distinction between a name and a description.
      const venue = match[2] ?? '';
      const name = cleanRetailerName(`${match[1]}${/^[A-Z]/.test(venue) ? ` ${venue}` : ''}`);
      if (!isRetailerName(name)) continue;
      // "distributed to the following Madison area stores" — a name followed
      // by ", ST", ", State", or "area/County" is a place, not a retailer.
      const after = text.slice(
        (match.index ?? 0) + match[0].length,
        (match.index ?? 0) + match[0].length + 30,
      );
      if (/^\s*,?\s*(?:[A-Z]{2}\b|[A-Z][a-z]+\s+(?:area|County)\b)/.test(after)) continue;
      if (!names.some((n) => n.toLowerCase() === name.toLowerCase())) names.push(name);
    }
  }
  return names;
}
