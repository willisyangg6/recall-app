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
    'USA',
    'U.S.A.',
    'D.C.',
    'District of Columbia',
  ].map((s) => s.toLowerCase()),
);

/**
 * Trailing noise that is not part of the retailer name.
 *
 * The possessive is deliberately KEPT: the source writes "Baker's", "Fry's",
 * "Mariano's", and stripping the "'s" produced "Baker" — a fragment that
 * names no chain and resolves to nothing. The catalog normalizes apostrophes
 * away and strips a possessive tail itself (retailer-catalog.ts), so
 * preserving the source's own wording costs no matching and stops the
 * extractor from inventing truncated names.
 */
const NAME_TRIM = /\s+(?:brand|branded)$/;

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

/**
 * A trailing LOWERCASE venue word is the source describing the shop, not part
 * of its name: "Cumberland Farms convenience stores", "Schnucks retail".
 * Case is the whole test, exactly as it is elsewhere in this module — the
 * source capitalizes "PCC Markets" and lowercases "Publix retail stores", and
 * that is precisely the line between a name and a description.
 */
const VENUE_DESCRIPTOR_TAIL =
  /\s+(?:retail|grocery|wholesale|convenience|gas station|supermarkets?|stores?|markets?|locations?|clubs?|restaurants?|outlets?)$/;

/** One store name, cleaned of the wording around it. */
function cleanRetailerName(raw: string): string {
  return raw
    .replace(LEADING_PLACE, '')
    .replace(NAME_TRIM, '')
    .replace(VENUE_DESCRIPTOR_TAIL, '')
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
 *
 * The suffix list covers the shapes a store-location table actually prints
 * (verified live: "555 W INTERSTATE 30", "135 NE LOOP 564", "2311 S JEFFERSON
 * AV") — a Walmart store list is an address list, never a retailer list.
 */
const STREET_ADDRESS =
  /^\d{1,6}\s+.*\b(?:Ave|Av|Avenue|St|Street|Rd|Road|Blvd|Dr|Drive|Ln|Lane|Way|Ct|Court|Hwy|Highway|Interstate|Loop|Pike|Turnpike|Tpke|Expy|Expressway|Fwy|Freeway|Route|Rte|Trail|Trl|Cir|Circle|Ter|Terrace|Pl|Place|Pkwy|Plaza|Plz|Sq|Ste|Suite|Blvd\.)\b|\b\d{5}(?:-\d{4})?$/i;

/**
 * A foreign country. FSIS export sentences read "distributed to retail
 * locations nationwide and some were exported to the Cayman Islands,
 * Dominican Republic, Mexico, and Panama" — an export destination is
 * geography, and reading it as a store told users they shopped at "Mexico".
 */
const COUNTRY_NAMES = new Set(
  [
    'Mexico',
    'Canada',
    'Panama',
    'Dominican Republic',
    'Cayman Islands',
    'Bahamas',
    'Jamaica',
    'Haiti',
    'Guatemala',
    'Honduras',
    'El Salvador',
    'Nicaragua',
    'Costa Rica',
    'Colombia',
    'Ecuador',
    'Peru',
    'Chile',
    'Brazil',
    'Argentina',
    'United Kingdom',
    'England',
    'Ireland',
    'France',
    'Germany',
    'Italy',
    'Spain',
    'Portugal',
    'Netherlands',
    'Belgium',
    'Israel',
    'India',
    'China',
    'Japan',
    'Korea',
    'South Korea',
    'Taiwan',
    'Vietnam',
    'Thailand',
    'Philippines',
    'Indonesia',
    'Malaysia',
    'Singapore',
    'Australia',
    'New Zealand',
    'Bermuda',
    'Aruba',
    'Curacao',
    'Barbados',
    'Trinidad and Tobago',
    // Canadian provinces: a foreign subdivision is geography exactly as a
    // foreign country is.
    'British Columbia',
    'Ontario',
    'Quebec',
    'Alberta',
    'Manitoba',
    'Saskatchewan',
    'Nova Scotia',
    'Newfoundland',
    'Prince Edward Island',
  ].map((name) => name.toLowerCase()),
);

/**
 * A sentence's own grammar surviving inside a captured name. A store is a
 * noun phrase; "Northern California through retail", "Ohio and Illinois in
 * Heinen's Grocery", and "Texas by local vendors at the Flea Markets" are
 * clauses the extraction window cut out of the middle of a sentence.
 *
 * Lowercase is the test: the source capitalizes words inside a real name
 * ("Alimentari By Pig In A Fur Coat"), so only a lowercase locative or
 * temporal word means prose. "of" and "and" are deliberately absent — real
 * names use them constantly ("Market of Choice", "Stop and Shop").
 */
const SENTENCE_GRAMMAR =
  /\b(?:in|at|to|through|between|beginning|available|from|by|via|including|located|only|during|near|within|per)\b/;

/** A month anywhere means a date cell, not a store ("2025 and August 11"). */
const CALENDAR_TEXT =
  /\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i;

/** A bare legal-entity tail left behind by a comma split. */
const BARE_CORPORATE_SUFFIX = /^(?:inc|llc|l\.l\.c|ltd|co|corp|lp|llp|incorporated|company)\.?$/i;

/**
 * Commodity and allergen vocabulary. Allergen sentences put these next to a
 * selling verb ("Tree Nuts", "Soy Ingredients", "Enoki Mushrooms"), and a
 * food is not a shop.
 */
const COMMODITY_TERM = new Set([
  'egg',
  'eggs',
  'wheat',
  'milk',
  'soy',
  'soy ingredients',
  'sesame',
  'peanut',
  'peanuts',
  'tree nuts',
  'nuts',
  'shellfish',
  'fish',
  'cheese',
  'cheese plate',
  'produce',
  'meat',
  'poultry',
  'beef',
  'chicken',
  'pork',
  'seafood',
  'chocolate',
  'candy',
  'mushrooms',
  'enoki mushrooms',
]);

/**
 * Words too generic to name a business on their own — usually the surviving
 * half of a split name ("Stop & Shop" leaving "Shop") or a lone table cell.
 * An ambiguous but real brand ("Giant", "Holiday") is deliberately NOT here:
 * it stays a legitimate name that the catalog simply declines to resolve.
 */
const BARE_GENERIC_WORD = new Set([
  'shop',
  'stop',
  'big',
  'food',
  'foods',
  'department',
  'sourcing',
  'star',
  'plus',
  'general',
  'super',
  'fresh',
  'quality',
  'value',
  'main',
  'central',
  'first',
  'best',
  'micro markets',
]);

/** A country-of-origin or measurement label from a product row. */
const PRODUCT_LABEL = /^(?:product of|net weight|net wt)\b/i;

/** A trailing state name is a geography qualifier ("Bristol Farms California"). */
const TRAILING_STATE_NAME = new RegExp(`\\b(?:${STATE_NAMES.join('|')})\\.?$|\\bStates?$`, 'i');

/**
 * The wholesale TRADE, as opposed to a warehouse club a consumer shops at.
 * "C&S Wholesale Grocers" supplies supermarkets; "Costco Wholesale" and "BJ's
 * Wholesale Club" are shops people walk into. The word "Wholesale" alone
 * decides nothing — what FOLLOWS it does, which is why this requires a trade
 * noun and can never match a name ending in "Wholesale" or "Wholesale Club".
 */
const WHOLESALE_TRADE = /\bWholesale\s+(?:Grocers?|Distributors?|Produce|Supply|Suppliers?)\b/i;

/**
 * Institutional foodservice. Hotels, restaurants, and institutions buy
 * through these channels; a consumer never walks into one. "HRI Commercial
 * Food Service" is a distribution route wearing a company name.
 */
const FOODSERVICE_CHANNEL = /\b(?:commercial\s+food\s+service|food\s?service)\b/i;

/** Contact-block text a "Sold At" cell sometimes carries. */
const CONTACT_TEXT =
  /\bhours\b|\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i;

/** A cross-reference to something elsewhere in the notice, not a name. */
const CROSS_REFERENCE = /^see\b/i;

/**
 * A place word left holding a single orphan initial: "Washington D" from
 * "Washington D.C.", "South D" from "South Dakota". The remainder must itself
 * be a place — "Jay C", a real Kroger banner, keeps its initial because "Jay"
 * is not one.
 */
function isTruncatedPlace(name: string): boolean {
  const match = name.match(/^(.+?)\s+[A-Z]$/);
  if (!match) return false;
  const head = match[1].toLowerCase();
  return NOT_RETAILERS.has(head) || ['north', 'south', 'east', 'west'].includes(head);
}

/**
 * Newspaper-style state abbreviations, which FSIS datelines use constantly
 * ("a Ferrisburg, Vt., establishment"). These are states written short, and a
 * state is never somewhere to shop.
 */
const STATE_ABBREVIATIONS = new Set([
  'ala',
  'ariz',
  'ark',
  'calif',
  'colo',
  'conn',
  'del',
  'fla',
  'ida',
  'ill',
  'ind',
  'kan',
  'kans',
  'ken',
  'mass',
  'mich',
  'minn',
  'miss',
  'mont',
  'neb',
  'nebr',
  'nev',
  'okla',
  'ore',
  'oreg',
  'penn',
  'penna',
  'tenn',
  'tex',
  'vt',
  'wash',
  'wis',
  'wisc',
  'wyo',
]);

/**
 * A trailing UPPERCASE postal code makes the phrase a locality: "DALLAS TX",
 * "ALLEN, TX", "MINEOLA TX.", "Fl, GA, NC". The uppercase requirement is what
 * keeps "The Kroger Co" (Colorado's code, but written "Co") a company.
 */
const TRAILING_STATE_CODE =
  /(?:^|[\s,])(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\.?$/;

/**
 * Column headings from a table the source flattened into text. A recall's
 * product table opens "PRODUCT / UPC / EXP. DATES", and a store table opens
 * "Store Number / Store Street Address / Store City & State"; every one of
 * those cells starts with a capital and none of them is a shop.
 */
const COLUMN_HEADER =
  /^(?:upc|upcs?|barcode(?:\s+upc)?|item(?:\s+(?:code|number|description|no\.?))?|sku|product(?:\s+(?:name|code|description|type))?|products|description|descriptions|brand|brands|size|sizes|quantity|quantities|qty|net\s+wt\.?|weight|lot|lot\s+codes?|code|codes|date|dates|best\s+by(?:\s+dates?)?|sell\s+by(?:\s+dates?)?|use\s+by(?:\s+dates?)?|exp\.?\s+dates?|expiration\s+dates?|purchase\s+dates?|package\s+size|store|store\s+(?:number|name|street\s+address|city(?:\s+&\s+state)?|address)|city|state|states|county|zip|address|distributor|distributors|retailer|retailers|distribution|location|locations)$/i;

/**
 * True when a value is a table's column heading rather than a cell value.
 * A block of lines that OPENS with one of these is a table the source
 * flattened into text, not a list of stores — the caller abandons it whole
 * rather than filtering it row by row, because a product table's rows are
 * product names and no shape test tells "Chef Salad" from a delicatessen.
 */
export function looksLikeColumnHeading(value: string): boolean {
  return COLUMN_HEADER.test(value.trim());
}

/**
 * A category of shop rather than a shop: "sold at Asian markets" names no
 * business. The whole cleaned name must be the descriptor — "Fresh Market"
 * and "Natural Grocers" are chains and keep their names.
 */
const GENERIC_VENUE = new Set([
  'asian',
  'hispanic',
  'latino',
  'mexican',
  'chinese',
  'korean',
  'japanese',
  'indian',
  'italian',
  'ethnic',
  'international',
  'oriental',
  'halal',
  'kosher',
  'specialty',
  'independent',
  'local',
  'regional',
  'national',
  'various',
  'select',
  'natural',
  'organic',
  'gourmet',
  'health',
  'discount',
  'convenience',
  'wholesale',
  'online',
  'foodservice',
  'restaurant',
  'restaurants',
  'club',
  'clubs',
  'market',
  'markets',
  'supermarket',
  'supermarkets',
  'store',
  'stores',
  'outlet',
  'outlets',
  'chain',
  'chains',
]);

/** A contact phone number, which a "Sold At" cell sometimes carries. */
const PHONE_NUMBER = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/;

/**
 * A value made only of digits and separators — a barcode split across cells
 * ("8 50042 40847 6"), a product code ("2972-3"), a date range.
 */
const CODE_ONLY = /^[\d\s.,;:\-/#]+$/;

/** An internal item code: an initialism plus a bare number ("VFVC 306"). */
const ITEM_CODE = /^[A-Z]{2,6}\s+\d{1,4}$/;

/**
 * A package/size row: a number with a unit of measure. Product rows read
 * "Butternut Squash Cubes 12 oz" and "5-gallon bucket (30-lbs)"; a store
 * name does not carry its own net weight.
 */
const PACKAGE_MEASURE =
  /\b\d+(?:\.\d+)?\s*-?\s*(?:oz|ozs|ounce|ounces|lb|lbs|pound|pounds|g|kg|mg|ml|l|liter|liters|gallon|gallons|gal|ct|count|pk|pack|packs|piece|pieces|pc|pcs|dozen)\b/i;

/**
 * A phrase that stops mid-thought. The extractor's window ended before the
 * sentence did ("New York through", "Wegmans or other", "Kraft Foods
 * distribution centers and"), and half a clause is not a store. The intended
 * name is deliberately NOT guessed back out of it.
 */
const DANGLING_TAIL =
  /\b(?:and|or|through|in|at|to|of|the|a|an|other|others|with|for|from|by|via|plus|but|including|include|includes|its|their|affiliated|located)$/i;

/** A determiner that belongs to the sentence, not to any business name. */
const PRONOUN_TOKEN = /\b(?:its|their|his|her|our|your|these|those)\b/i;

/**
 * An opening parenthesis with no partner. A comma split inside "Buds
 * Marketplace (Eagle, ID)" leaves "Buds Marketplace (Eagle" — a real store
 * wearing half a city.
 */
const UNBALANCED_PAREN = /\([^)]*$/;

/** Distribution infrastructure. A warehouse is not where a consumer shopped. */
const DISTRIBUTION_ROLE = /\bdistribution\b/i;

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

/**
 * The single gate every retailer seam passes through — sentence extraction,
 * source-table cells, and block store lists alike. Everything it rejects is
 * something a live notice actually produced while wearing a capital letter:
 * column headings, barcodes, package weights, street addresses, export
 * countries, and clauses that stopped mid-sentence.
 *
 * It answers only "is this the right KIND of thing to be a shop". Whether the
 * shop is one a user can select is the catalog's separate question, and a
 * name that resolves to no catalog entry is still a legitimate retailer.
 */
export function isRetailerName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 2 || !/^[A-Z0-9]/.test(trimmed)) return false;
  if (STREET_ADDRESS.test(trimmed)) return false;
  if (PLACE_TAIL.test(trimmed)) return false;
  if (STATE_CODE_NAME.test(trimmed) || trimmed.includes('@')) return false;
  if (NOT_A_RETAILER_VALUE.test(trimmed)) return false;
  // Structurally the wrong kind of value: a table heading, a code, a
  // measurement, a phone number, or a price.
  if (COLUMN_HEADER.test(trimmed)) return false;
  if (CODE_ONLY.test(trimmed) || ITEM_CODE.test(trimmed)) return false;
  if (PACKAGE_MEASURE.test(trimmed) || trimmed.includes('$')) return false;
  if (PHONE_NUMBER.test(trimmed)) return false;
  // Geography in its remaining disguises: a country, a shortened state, or a
  // locality carrying its postal code.
  if (COUNTRY_NAMES.has(trimmed.toLowerCase())) return false;
  if (STATE_ABBREVIATIONS.has(trimmed.toLowerCase().replace(/\.$/, ''))) return false;
  if (TRAILING_STATE_CODE.test(trimmed)) return false;
  // A category of shop is not a shop.
  if (GENERIC_VENUE.has(trimmed.toLowerCase())) return false;
  // Fragments: a clause that stopped early, or one carrying sentence grammar.
  if (DANGLING_TAIL.test(trimmed)) return false;
  if (PRONOUN_TOKEN.test(trimmed)) return false;
  if (UNBALANCED_PAREN.test(trimmed)) return false;
  // A warehouse is a route, not a storefront.
  if (DISTRIBUTION_ROLE.test(trimmed)) return false;
  // Prose that never became a name: a clause carrying sentence grammar, a
  // date cell, a product label, or text spanning a line break.
  if (trimmed.includes('\n') || /\.\s+[A-Z]/.test(trimmed)) return false;
  if (SENTENCE_GRAMMAR.test(trimmed) || CALENDAR_TEXT.test(trimmed)) return false;
  if (/^\d{4}\b/.test(trimmed) || PRODUCT_LABEL.test(trimmed)) return false;
  if (TRAILING_STATE_NAME.test(trimmed)) return false;
  if (isTruncatedPlace(trimmed)) return false;
  // A bare two-letter initialism in a run of postal codes ("AZ, CA, HI, LV,
  // MD") is a code, not a chain.
  if (/^[A-Z]{2}$/.test(trimmed)) return false;
  // Trade intermediaries a consumer cannot shop at, and contact-block text.
  if (WHOLESALE_TRADE.test(trimmed) || FOODSERVICE_CHANNEL.test(trimmed)) return false;
  if (CONTACT_TEXT.test(trimmed) || CROSS_REFERENCE.test(trimmed)) return false;
  // Leftovers of a split: a bare legal suffix, a commodity, a word too
  // generic to be a business, or a token too short to be a mixed-case brand.
  if (BARE_CORPORATE_SUFFIX.test(trimmed)) return false;
  if (COMMODITY_TERM.has(trimmed.toLowerCase())) return false;
  if (BARE_GENERIC_WORD.has(trimmed.toLowerCase())) return false;
  if (!trimmed.includes(' ') && trimmed.length < 4 && /[a-z]/.test(trimmed)) return false;
  // An online storefront is a channel the distribution projection types
  // separately; it is never a place a person walked into.
  if (/\.com\b/i.test(trimmed)) return false;
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
 * How far past a name the surrounding sentence is read for its role. Wide
 * enough to reach the destination at the end of a long consignee run:
 * "…Jonesville, SC, Blair, NE, South Boston, VA, and Ardmore, OK, Dollar
 * General Distribution Centers."
 */
const CONTEXT_WINDOW = 160;

/** Words that mark the destination as somewhere a consumer shops. */
const RETAIL_VENUE_WORD = /\b(?:retail|stores?|shops?|markets?|supermarkets?|locations?|clubs?)\b/i;

/**
 * Roles the source states for a destination that is NOT a consumer storefront.
 * Each is quoted from a live notice.
 */
const CONTEXT_REJECTS: RegExp[] = [
  // "shipped to AMD Imports Inc., a distributor in Houston, Texas"
  /^[\s,]*(?:Inc\.?|LLC|L\.L\.C\.|Corp\.?|Co\.?|Ltd\.?)?[\s,]*(?:is\s+|was\s+)?(?:a|an)\s+(?:distributor|wholesaler|importer|exporter|broker|supplier)\b/i,
  // "distributed to TRIMAR USA LLC in Miami, FL who further distributed the
  // product to retail and wholesale customers" — an intermediary says so.
  /\b(?:who|which)\s+(?:then\s+|also\s+)?further\s+distribut/i,
  // "were shipped to Elevation Foods in error" — not a distribution statement.
  /^\s+in\s+error\b/i,
  // "distributed to PGA golf events in Minneapolis" — an event is not a shop.
  /^\s+(?:golf\s+)?(?:events?|festivals?|tournaments?|fairs?)\b/i,
  // "distributed through Russ Davis Wholesale." — the name ends in the trade
  // itself. A venue word after it means the opposite ("Costco Wholesale
  // stores", "BJ's Wholesale Club"), so those are excluded explicitly.
  /^\s+Wholesale\b(?!\s+(?:Club|Warehouse|[Ss]tores?|[Ll]ocations?|[Mm]arkets?|[Ss]upermarkets?|[Oo]utlets?|[Cc]lubs?))/,
  // "distributed to HRI Commercial Food Service locations nationwide" — the
  // capture stops short of the channel word, so the channel is read after it.
  /^\s+(?:Commercial\s+)?Food\s?Service\b/i,
  // "shipped to Army & Air Force Exchange Services (AAFES)" — the capture
  // split a compound name at the ampersand. Half a name is not a name, and
  // the intended one is deliberately not reconstructed.
  /^\s*&\s*[A-Z]/,
];

/**
 * "shipped to Cleveland and Youngstown, Ohio Foodbanks" — a name followed by
 * its state, spelled out, is a city. Only full state NAMES count: a trailing
 * ", MA" is how a notice qualifies a real deli ("Bernat's Deli, MA").
 */
const CITY_IN_STATE = new RegExp(`^\\s*,\\s*(?:${STATE_NAMES.join('|')})\\b`, 'i');

/**
 * A lead-in that hands the rest of the sentence to geography:
 *
 *   "distributed in California to grocery stores mainly in these cities:
 *    Sunnyvale, Santa Clara, Fremont, …"
 *   "distributed only to King Kullen Grocery Stores located in Long Island,
 *    NY: Specific store locations include: Manhasset, Center Moriches, …"
 *
 * Everything after the marker is a place list. The retailer, when there is
 * one, is named BEFORE it and is unaffected.
 */
const GEOGRAPHY_LEAD_IN = /\b(?:cities|towns)\s*:|\b(?:store\s+)?locations?\s+(?:include|are)\b/i;

/**
 * "Distribution centers" as the destination. The name qualifies a warehouse —
 * "Wakefern distribution centers", "Dollar General Distribution Centers" —
 * unless a retail venue word intervenes, as in "Costco, Foodmaxx, Kroger,
 * Safeway and other retail stores and distribution centers", where the stores
 * are named and the warehouses are an aside.
 */
/** "<Name> retail locations", "<Name> stores" — the name IS the venue. */
const NAMED_VENUE_FOLLOWS =
  /^\s*(?:retail\s+|grocery\s+|wholesale\s+)?(?:stores?|locations?|markets?|supermarkets?|clubs?|outlets?)\b/i;

function namedRetailVenueFollows(text: string, name: string): boolean {
  for (let from = 0; ;) {
    const index = text.indexOf(name, from);
    if (index < 0) return false;
    from = index + name.length;
    if (NAMED_VENUE_FOLLOWS.test(text.slice(from, from + 30))) return true;
  }
}

function qualifiesADistributionCentre(after: string): boolean {
  const match = after.match(/distribution\s+cent(?:er|re)/i);
  if (!match) return false;
  return !RETAIL_VENUE_WORD.test(after.slice(0, match.index));
}

/**
 * True when the source, anywhere it names this string, gives it a role other
 * than "a shop the product was sold at".
 *
 * Read at the sentence level because that is where the role lives: the same
 * two words are a supermarket in one notice and a warehouse in another, and
 * only the words around them say which. ANY such mention disqualifies the
 * name — a false "Sold at" is worse than a missing one, and each test below
 * is individually guarded so an ordinary retail sentence never trips one.
 * ("Costco, Foodmaxx, Kroger, Safeway and other retail stores and
 * distribution centers" keeps all four, because the stores are named before
 * the warehouses.)
 *
 * A name the text does not contain verbatim is never rejected — absence of
 * context is not evidence.
 */
export function contextRejectsRetailer(text: string, name: string): boolean {
  // One escape hatch, and it is the source's own words: somewhere the notice
  // attaches THIS name directly to a shopping venue. "shipped to Costco
  // distribution centers … and may have been further distributed to Costco
  // retail locations" names the warehouses and the shops, so the shops win.
  // A generic tail does not qualify — "to Kraft distribution centers and in
  // retail stores nationwide" never says Kraft itself is a shop.
  if (namedRetailVenueFollows(text, name)) return false;
  for (let from = 0; ;) {
    const index = text.indexOf(name, from);
    if (index < 0) return false;
    from = index + name.length;
    // Whole-name matches only, so "Giant" is not judged by a sentence about
    // "Giant Foods" — that is a different name with its own context.
    const preceding = index === 0 ? '' : text[index - 1];
    if (/[A-Za-z0-9]/.test(preceding) || /^[A-Za-z0-9]/.test(text.slice(from, from + 1))) {
      continue;
    }
    const after = text.slice(from, from + CONTEXT_WINDOW);
    const sentenceStart = Math.max(
      text.lastIndexOf('.', index - 1),
      text.lastIndexOf('\n', index - 1),
    );
    const before = text.slice(sentenceStart + 1, index);
    if (
      qualifiesADistributionCentre(after) ||
      CITY_IN_STATE.test(after) ||
      GEOGRAPHY_LEAD_IN.test(before) ||
      CONTEXT_REJECTS.some((pattern) => pattern.test(after))
    ) {
      return true;
    }
  }
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
  // Last: drop names the surrounding sentence proves are playing a
  // non-retail role. This runs on the assembled list, not inside each
  // pattern, so every seam gets the same judgement.
  return names.filter((name) => !contextRejectsRetailer(text, name));
}
