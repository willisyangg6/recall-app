/**
 * The single canonical source of U.S. geographic knowledge: state names,
 * postal abbreviations, and a curated gazetteer of city/borough names.
 *
 * Three copies of the state tables used to live in the FDA parser, the
 * consumer projection, and the retailer extractor — and each had its own
 * gaps. Every layer that needs to answer "is this a state?", "which states
 * does this clause name?", or "is this a city rather than a store?" answers
 * it from here, so the ingest-time and display-time answers can never
 * disagree.
 *
 * Everything here is deterministic and offline. The gazetteer is a bounded,
 * curated list — deliberately not an external geocoding service — because its
 * job is narrow: recognize the place names that real recall notices actually
 * use, so a borough can never be classified as a retailer and a city list
 * after "stores in …" reads as geography.
 */

/** Full state names, plus DC and Puerto Rico, as sources spell them. */
export const STATE_NAMES: string[] = [
  'Alabama',
  'Alaska',
  'Arizona',
  'Arkansas',
  'California',
  'Colorado',
  'Connecticut',
  'Delaware',
  'Florida',
  'Georgia',
  'Hawaii',
  'Idaho',
  'Illinois',
  'Indiana',
  'Iowa',
  'Kansas',
  'Kentucky',
  'Louisiana',
  'Maine',
  'Maryland',
  'Massachusetts',
  'Michigan',
  'Minnesota',
  'Mississippi',
  'Missouri',
  'Montana',
  'Nebraska',
  'Nevada',
  'New Hampshire',
  'New Jersey',
  'New Mexico',
  'New York',
  'North Carolina',
  'North Dakota',
  'Ohio',
  'Oklahoma',
  'Oregon',
  'Pennsylvania',
  'Rhode Island',
  'South Carolina',
  'South Dakota',
  'Tennessee',
  'Texas',
  'Utah',
  'Vermont',
  'Virginia',
  'Washington',
  'West Virginia',
  'Wisconsin',
  'Wyoming',
  'District of Columbia',
  'Puerto Rico',
];

/** Postal abbreviation → full state name. */
export const POSTAL_TO_STATE: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  DC: 'District of Columbia',
  PR: 'Puerto Rico',
};

/** Full state name → postal abbreviation. */
export const STATE_TO_POSTAL: Record<string, string> = Object.fromEntries(
  Object.entries(POSTAL_TO_STATE).map(([code, name]) => [name, code]),
);

const STATE_NAME_SET = new Set(STATE_NAMES.map((name) => name.toLowerCase()));

/** True when the token is a full state name (case-insensitive). */
export function isStateName(token: string): boolean {
  return STATE_NAME_SET.has(token.trim().toLowerCase());
}

/**
 * Resolve a token to its canonical full state name: a full name in any case,
 * or an UPPERCASE postal code. Lowercase two-letter words ("in", "or", "me")
 * never resolve — the capitalization is part of the evidence.
 */
export function normalizeStateToken(token: string): string | null {
  const trimmed = token.trim().replace(/[.,;]+$/, '');
  if (/^[A-Z]{2}$/.test(trimmed)) return POSTAL_TO_STATE[trimmed] ?? null;
  const named = STATE_NAMES.find((name) => name.toLowerCase() === trimmed.toLowerCase());
  return named ?? null;
}

/**
 * Postal codes in the unambiguous ", XX" address/list form ("Detroit, MI").
 */
const ADDRESS_CODE = /,\s+([A-Z]{2})(?![A-Za-z])/g;

/**
 * A run of postal codes after a locality preposition:
 * "throughout MI, MN, and ND", "shipped to CA and NV", "in OR".
 * Each captured token is validated against the postal table; a lone code is
 * additionally rejected when a capitalized word follows it, because
 * "in NE Ohio" writes a compass direction, not Nebraska.
 */
const LOCALITY_CODE_RUN =
  /\b(?:in|to|throughout|across|within)\s+([A-Z]{2}\b(?:\s*(?:,|and|or|&)\s*(?:and\s+)?[A-Z]{2}\b)*)/g;

/**
 * A separated run of two or more postal codes, wherever it appears:
 * "SD, ND, MN, IA, WY", "(AZ, CA, CO, CT)", "AL, AR, FL, GA & TX".
 *
 * A locality preposition is not always what introduces a declared state list.
 * Sources write "…in the following states: SD, ND, MN, IA, WY", "…seventeen
 * states (AZ, CA, …)", "Distribution Areas: AZ, CA, …" — and the preposition
 * rule below then reads only the codes that happen to follow a comma, so the
 * FIRST state of the list is silently dropped. Measured across the live
 * corpus: 54 sentences, including a Trader Joe's dressing recall stored
 * without Arkansas. A missing state is not a harmless gap — it turns a
 * shopper in that state from "not sure" into "does not affect you".
 *
 * Safe because a run only reads as states when EVERY token in it resolves,
 * which is what keeps "SM, MD, LG" and "grades AA, AB" out.
 */
const CODE_RUN = /\b[A-Z]{2}\b(?:\s*(?:,|and|or|&)\s*(?:and\s+)?\b[A-Z]{2}\b)+/g;

/** Longest first, so "West Virginia" is claimed before "Virginia" can be. */
const NAMES_LONGEST_FIRST = [...STATE_NAMES].sort((a, b) => b.length - a.length);

/**
 * Full state names a text contains, ignoring any whose only occurrence sits
 * INSIDE a longer state name.
 *
 * "shipped to retail locations in West Virginia" used to yield Virginia AND
 * West Virginia, because `\bVirginia\b` matches inside "West Virginia". That
 * is a false geographic positive — the worst failure this domain has, since it
 * tells a Virginia shopper a recall reached them when the source never said
 * so. Positions are claimed longest-name-first, so the containment can only
 * resolve one way.
 */
function namedStates(text: string): { name: string; onlyInsideLongerName: boolean }[] {
  const claimed: { start: number; end: number }[] = [];
  const out: { name: string; onlyInsideLongerName: boolean }[] = [];
  for (const name of NAMES_LONGEST_FIRST) {
    let standalone = 0;
    let contained = 0;
    for (const match of text.matchAll(new RegExp(`\\b${name}\\b`, 'g'))) {
      const start = match.index!;
      const end = start + name.length;
      if (claimed.some((span) => start >= span.start && end <= span.end)) {
        contained += 1;
        continue;
      }
      claimed.push({ start, end });
      standalone += 1;
    }
    if (standalone > 0) out.push({ name, onlyInsideLongerName: false });
    else if (contained > 0) out.push({ name, onlyInsideLongerName: true });
  }
  return out;
}

/**
 * Every U.S. state a text names, deterministically: full names anywhere (never
 * one merely embedded in a longer state's name), postal codes only in
 * genuinely geographic shapes (", XX" address form, an all-resolving code run,
 * or a code list after a locality preposition). Arbitrary two-letter uppercase
 * strings — product codes, initialisms — never qualify.
 *
 * This is the one multi-state reader. "distributed in retail grocery stores
 * throughout MI, MN, and ND" must retain all three states; the ", XX"-only
 * rule used to keep just Minnesota.
 */
export function statesInText(text: string): string[] {
  const found = new Set<string>();
  for (const { name, onlyInsideLongerName } of namedStates(text)) {
    if (!onlyInsideLongerName) found.add(name);
  }
  for (const match of text.matchAll(ADDRESS_CODE)) {
    const state = POSTAL_TO_STATE[match[1]];
    if (state) found.add(state);
  }
  for (const match of text.matchAll(CODE_RUN)) {
    const codes = match[0].match(/\b[A-Z]{2}\b/g) ?? [];
    const states = codes.map((code) => POSTAL_TO_STATE[code]).filter((s): s is string => !!s);
    // A list only reads as states when every token is one.
    if (states.length === codes.length) for (const state of states) found.add(state);
  }
  for (const match of text.matchAll(LOCALITY_CODE_RUN)) {
    const codes = match[1].match(/\b[A-Z]{2}\b/g) ?? [];
    const states = codes.map((code) => POSTAL_TO_STATE[code]).filter((s): s is string => !!s);
    if (states.length === 0) continue;
    if (codes.length === 1) {
      // A lone code needs a clean boundary: "in NE Ohio" is a direction.
      const after = text.slice(match.index! + match[0].length);
      if (/^\s+[A-Z][a-z]/.test(after)) continue;
      if (states.length === 1) found.add(states[0]);
      continue;
    }
    if (states.length === codes.length) for (const state of states) found.add(state);
  }
  return [...found].sort();
}

/**
 * True when the text mentions this state's name ONLY inside a longer state
 * name — "Virginia" in a notice that says nothing but "West Virginia".
 *
 * The historical repair uses this and nothing else to justify REMOVING a
 * stored state. Any other disagreement between stored and re-derived
 * geography is reported for a human, never silently applied: dropping a state
 * a source really stated would exclude the people it was meant to warn.
 */
export function isContainedStateArtifact(state: string, text: string): boolean {
  const entry = namedStates(text).find((s) => s.name === state);
  return entry?.onlyInsideLongerName === true;
}

/**
 * Curated city/borough/metro gazetteer, lowercase.
 *
 * Coverage: every place name observed in real notices during QA, the NYC
 * boroughs, and the ~250 largest US cities. The list exists to answer one
 * question — "is this a place rather than a store?" — so precision matters
 * more than completeness: adding a name here removes it from retailer
 * eligibility everywhere.
 *
 * Deliberately absent: city names that are primarily known as grocery chains
 * or common brand words, to avoid demoting a genuine retailer.
 */
const US_CITIES: string[] = [
  // NYC boroughs and observed Northeast places
  'new york city',
  'bronx',
  'the bronx',
  'brooklyn',
  'queens',
  'manhattan',
  'staten island',
  'long island',
  'westchester',
  'yonkers',
  'albany',
  'buffalo',
  'rochester',
  'syracuse',
  'newark',
  'jersey city',
  'paterson',
  'elizabeth',
  'edison',
  'trenton',
  'philadelphia',
  'pittsburgh',
  'allentown',
  'boston',
  'worcester',
  'springfield',
  'cambridge',
  'lowell',
  'providence',
  'hartford',
  'new haven',
  'bridgeport',
  'stamford',
  'waterbury',
  'watertown',
  'prospect',
  'baltimore',
  'annapolis',
  'wilmington',
  'portland maine',
  'burlington',
  'manchester',
  'nashua',
  'concord',
  'bay shore',
  // Observed Michigan / Midwest places
  'ann arbor',
  'brighton',
  'detroit',
  'grand rapids',
  'lansing',
  'flint',
  'warren',
  'sterling heights',
  'dearborn',
  'livonia',
  'troy',
  'chicago',
  'aurora',
  'naperville',
  'joliet',
  'rockford',
  'peoria',
  'indianapolis',
  'fort wayne',
  'evansville',
  'south bend',
  'columbus',
  'cleveland',
  'cincinnati',
  'toledo',
  'akron',
  'dayton',
  'milwaukee',
  'madison',
  'green bay',
  'kenosha',
  'racine',
  'minneapolis',
  'saint paul',
  'st. paul',
  'st paul',
  'duluth',
  'bloomington',
  'des moines',
  'cedar rapids',
  'davenport',
  'kansas city',
  'st. louis',
  'st louis',
  'saint louis',
  'wichita',
  'topeka',
  'omaha',
  'lincoln',
  'fargo',
  'bismarck',
  'sioux falls',
  'rapid city',
  // Observed Oregon / Northwest places
  'ashland',
  'bend',
  'corvallis',
  'eugene',
  'hillsboro',
  'medford',
  'portland',
  'west linn',
  'salem',
  'gresham',
  'beaverton',
  'tigard',
  'lake oswego',
  'seattle',
  'tacoma',
  'spokane',
  'vancouver',
  'bellevue',
  'everett',
  'kent',
  'renton',
  'olympia',
  'bellingham',
  'kirkland',
  'redmond',
  'boise',
  'nampa',
  'meridian',
  'missoula',
  'billings',
  'helena',
  'anchorage',
  'fairbanks',
  'juneau',
  // West / Southwest
  'los angeles',
  'san diego',
  'san jose',
  'san francisco',
  'fresno',
  'sacramento',
  'long beach',
  'oakland',
  'bakersfield',
  'anaheim',
  'santa ana',
  'riverside',
  'stockton',
  'irvine',
  'chula vista',
  'fremont',
  'san bernardino',
  'modesto',
  'fontana',
  'oxnard',
  'moreno valley',
  'glendale',
  'huntington beach',
  'santa clarita',
  'oceanside',
  'garden grove',
  'rancho cucamonga',
  'santa rosa',
  'ontario',
  'elk grove',
  'corona',
  'hayward',
  'lancaster',
  'palmdale',
  'sunnyvale',
  'pomona',
  'escondido',
  'torrance',
  'pasadena',
  'fullerton',
  'orange',
  'roseville',
  'visalia',
  'santa clara',
  'concord',
  'thousand oaks',
  'simi valley',
  'berkeley',
  'santa monica',
  'sonoma',
  'napa',
  'san rafael',
  'daly city',
  'san mateo',
  'redwood city',
  'palo alto',
  'mountain view',
  'milpitas',
  'cupertino',
  'phoenix',
  'tucson',
  'mesa',
  'chandler',
  'scottsdale',
  'gilbert',
  'tempe',
  'peoria arizona',
  'surprise',
  'yuma',
  'flagstaff',
  'las vegas',
  'henderson',
  'reno',
  'north las vegas',
  'sparks',
  'carson city',
  'salt lake city',
  'west valley city',
  'provo',
  'ogden',
  'denver',
  'colorado springs',
  'fort collins',
  'lakewood',
  'thornton',
  'arvada',
  'westminster',
  'pueblo',
  'boulder',
  'albuquerque',
  'las cruces',
  'santa fe',
  'rio rancho',
  'honolulu',
  'kaheka',
  'kakaako',
  'pearl city',
  'hilo',
  'kailua',
  // South / Southeast
  'houston',
  'san antonio',
  'dallas',
  'austin',
  'fort worth',
  'el paso',
  'arlington',
  'corpus christi',
  'plano',
  'laredo',
  'lubbock',
  'garland',
  'irving',
  'amarillo',
  'grand prairie',
  'brownsville',
  'mckinney',
  'frisco',
  'pasadena texas',
  'mesquite',
  'killeen',
  'mcallen',
  'waco',
  'carrollton',
  'denton',
  'midland',
  'abilene',
  'beaumont',
  'round rock',
  'odessa',
  'missouri city',
  'sugar land',
  'oklahoma city',
  'tulsa',
  'norman',
  'broken arrow',
  'little rock',
  'fort smith',
  'fayetteville',
  'new orleans',
  'baton rouge',
  'shreveport',
  'lafayette',
  'jackson',
  'gulfport',
  'memphis',
  'nashville',
  'knoxville',
  'chattanooga',
  'clarksville',
  'murfreesboro',
  'louisville',
  'lexington',
  'bowling green',
  'birmingham',
  'montgomery',
  'mobile',
  'huntsville',
  'tuscaloosa',
  'atlanta',
  'augusta',
  'columbus georgia',
  'savannah',
  'athens',
  'macon',
  'jacksonville',
  'miami',
  'tampa',
  'orlando',
  'st. petersburg',
  'st petersburg',
  'hialeah',
  'tallahassee',
  'fort lauderdale',
  'port st. lucie',
  'cape coral',
  'pembroke pines',
  'hollywood',
  'gainesville',
  'coral springs',
  'clearwater',
  'palm bay',
  'west palm beach',
  'lakeland',
  'pompano beach',
  'boca raton',
  'sarasota',
  'charlotte',
  'raleigh',
  'greensboro',
  'durham',
  'winston-salem',
  'winston salem',
  'cary',
  'wilmington north carolina',
  'asheville',
  'columbia',
  'charleston',
  'north charleston',
  'mount pleasant',
  'greenville',
  'richmond',
  'virginia beach',
  'norfolk',
  'chesapeake',
  'newport news',
  'alexandria',
  'hampton',
  'roanoke',
  'washington dc',
  'jamestown',
  'west allis',
  // Texas towns a live Walmart store-location table printed WITHOUT their
  // state code, so the "City ST" rule could not see them and they rendered
  // as shops. Added as observed evidence, not as the start of a gazetteer:
  // the neighbouring rows ("DALLAS TX", "GARLAND TX") were already handled.
  'gilmer',
  'longview',
  'sulphur springs',
];

const CITY_SET = new Set(US_CITIES);

/** True when the name is a known U.S. city, borough, or metro place. */
export function isUsCityName(name: string): boolean {
  const key = name.trim().toLowerCase().replace(/\s+/g, ' ');
  if (CITY_SET.has(key)) return true;
  // "Portland, OR" / "Brooklyn, NY" — the city with its state attached.
  const withState = key.match(/^(.+?),\s*(?:[a-z]{2}|[a-z][a-z ]+)$/);
  return withState !== null && CITY_SET.has(withState[1].trim());
}

/**
 * Split a run of place names that lost its separator in the source
 * ("Eugene Hillsboro" — a real FDA typo). Returns the parts only when EVERY
 * token resolves to a known city on its own, and the whole string does not:
 * "West Linn" is one city and must never split.
 */
export function splitAdjacentCities(name: string): string[] | null {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (isUsCityName(trimmed)) return null;
  const tokens = trimmed.split(' ');
  if (tokens.length < 2 || tokens.length > 4) return null;
  if (!tokens.every((token) => CITY_SET.has(token.toLowerCase()))) return null;
  return tokens;
}
