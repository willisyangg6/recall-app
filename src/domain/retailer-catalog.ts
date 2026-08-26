/**
 * Canonical retailer catalog for store preferences (Phase C3).
 *
 * Retailer personalization must operate on stable canonical identity, not on
 * the raw strings extracted from notice prose ("Costco", "Costco Wholesale",
 * "costco store" are one chain; "Wal-Mart" and "Walmart" are one chain). This
 * module is that identity layer:
 *
 * - A bounded, curated registry: chains observed as retailer evidence in the
 *   live corpus (census 2026-08-26: 283 retailer-bearing cases, 661 distinct
 *   raw strings) plus major US chains a user will reasonably select. It is
 *   deliberately NOT a scraped retail directory — the long tail of one-off
 *   local shops stays uncanonicalized and simply never matches a preference.
 * - Alias resolution is exact against a normalized form, never fuzzy: a false
 *   retailer identity ("you shop there") is worse than an unmatched string.
 *   Distinct banners of one parent stay distinct — Fred Meyer is not Kroger,
 *   Safeway is not Albertsons — because notices name banners and people shop
 *   at banners.
 * - Known ambiguity stays unresolved: a bare "Giant" could be Giant Food
 *   (DC/MD/VA) or The GIANT Company (PA), so it matches neither.
 *
 * Matching is a positive signal only. An evidence string that resolves to no
 * catalog entry means "no retailer match", never "not sold there".
 */

export interface CanonicalRetailer {
  /** Stable id — what preferences persist. Never rename an id. */
  id: string;
  /** Consumer display name. */
  name: string;
  /**
   * Normalized alias forms (see `normalizeRetailerText`) beyond the
   * normalized display name, which always matches.
   */
  aliases?: string[];
}

export const RETAILER_CATALOG: CanonicalRetailer[] = [
  // National big box / warehouse
  {
    id: 'walmart',
    name: 'Walmart',
    aliases: ['wal-mart', 'walmart supercenter', 'walmart neighborhood market'],
  },
  { id: 'target', name: 'Target' },
  { id: 'costco', name: 'Costco', aliases: ['costco wholesale'] },
  { id: 'sams-club', name: "Sam's Club", aliases: ['sams'] },
  { id: 'bjs-wholesale-club', name: "BJ's Wholesale Club", aliases: ['bjs', 'bjs wholesale'] },
  // National / large grocery
  { id: 'kroger', name: 'Kroger', aliases: ['the kroger co', 'kroger marketplace'] },
  { id: 'albertsons', name: 'Albertsons', aliases: ['albertsons companies'] },
  { id: 'safeway', name: 'Safeway' },
  {
    id: 'publix',
    name: 'Publix',
    aliases: ['publix super markets', 'publix supermarkets', 'publix super'],
  },
  { id: 'aldi', name: 'Aldi', aliases: ['aldis'] },
  { id: 'lidl', name: 'Lidl' },
  { id: 'trader-joes', name: "Trader Joe's", aliases: ['trader joe'] },
  { id: 'whole-foods', name: 'Whole Foods Market', aliases: ['whole foods'] },
  { id: 'wegmans', name: 'Wegmans', aliases: ['wegman', 'wegmans grocery'] },
  { id: 'heb', name: 'H-E-B', aliases: ['heb', 'h e b'] },
  { id: 'meijer', name: 'Meijer' },
  { id: 'hy-vee', name: 'Hy-Vee', aliases: ['hyvee', 'hy vee', 'hy-vee drugstore'] },
  { id: 'winco', name: 'WinCo Foods', aliases: ['winco'] },
  { id: 'winn-dixie', name: 'Winn-Dixie', aliases: ['winn dixie'] },
  { id: 'shoprite', name: 'ShopRite', aliases: ['shop rite'] },
  { id: 'sprouts', name: 'Sprouts Farmers Market', aliases: ['sprouts'] },
  { id: 'fresh-market', name: 'The Fresh Market', aliases: ['fresh market'] },
  { id: 'save-a-lot', name: 'Save A Lot', aliases: ['save-a-lot'] },
  { id: 'piggly-wiggly', name: 'Piggly Wiggly' },
  { id: 'harris-teeter', name: 'Harris Teeter' },
  // Kroger-family banners (kept distinct from Kroger and each other — recall
  // notices enumerate banners, and observed evidence includes even the small
  // ones: Gerbes, Jay C, Pay Less, Ruler, Owen's, Baker's, Mariano's).
  { id: 'fred-meyer', name: 'Fred Meyer' },
  { id: 'qfc', name: 'QFC', aliases: ['quality food centers'] },
  { id: 'ralphs', name: 'Ralphs' },
  { id: 'king-soopers', name: 'King Soopers' },
  { id: 'smiths', name: "Smith's", aliases: ['smiths food and drug'] },
  { id: 'frys-food', name: "Fry's Food Stores", aliases: ['frys', 'frys food'] },
  { id: 'dillons', name: 'Dillons' },
  { id: 'marianos', name: "Mariano's", aliases: ['mariano'] },
  { id: 'pick-n-save', name: "Pick 'n Save", aliases: ['pick n save'] },
  { id: 'gerbes', name: 'Gerbes' },
  { id: 'jay-c', name: 'Jay C', aliases: ['jay c food', 'jay c food plus'] },
  { id: 'pay-less-supermarkets', name: 'Pay Less Supermarkets', aliases: ['pay less'] },
  { id: 'owens', name: "Owen's", aliases: ['owens'] },
  { id: 'ruler-foods', name: 'Ruler Foods', aliases: ['ruler'] },
  { id: 'bakers', name: "Baker's", aliases: ['bakers'] },
  { id: 'food-4-less', name: 'Food 4 Less', aliases: ['food 4 less', 'food4less'] },
  { id: 'city-market', name: 'City Market' },
  // Albertsons-family banners (same principle).
  { id: 'vons', name: 'Vons' },
  { id: 'jewel-osco', name: 'Jewel-Osco', aliases: ['jewel osco', 'jewel'] },
  { id: 'acme-markets', name: 'Acme Markets', aliases: ['acme'] },
  { id: 'randalls', name: 'Randalls' },
  { id: 'tom-thumb', name: 'Tom Thumb' },
  { id: 'shaws', name: "Shaw's", aliases: ['shaws'] },
  // Ahold Delhaize banners.
  { id: 'stop-and-shop', name: 'Stop & Shop', aliases: ['stop and shop'] },
  // "Giant" alone is ambiguous between these two and matches neither.
  { id: 'giant-food', name: 'Giant Food (DC/MD/VA)', aliases: ['giant food'] },
  {
    id: 'giant-company',
    name: 'GIANT (PA)',
    aliases: ['giant food stores', 'giant company', 'the giant company'],
  },
  { id: 'hannaford', name: 'Hannaford' },
  { id: 'food-lion', name: 'Food Lion' },
  // Regional grocery observed in corpus evidence.
  { id: 'giant-eagle', name: 'Giant Eagle' },
  { id: 'market-district', name: 'Market District' },
  { id: 'price-chopper', name: 'Price Chopper' },
  { id: 'tops', name: 'Tops Friendly Markets', aliases: ['tops', 'tops markets'] },
  { id: 'big-y', name: 'Big Y' },
  { id: 'weis-markets', name: 'Weis Markets', aliases: ['weis'] },
  { id: 'schnucks', name: 'Schnucks', aliases: ['schnuck'] },
  { id: 'dierbergs', name: 'Dierbergs', aliases: ['dierberg'] },
  { id: 'fareway', name: 'Fareway' },
  { id: 'lunds-byerlys', name: 'Lunds & Byerlys', aliases: ['lunds and byerlys'] },
  { id: 'market-of-choice', name: 'Market of Choice' },
  { id: 'grocery-outlet', name: 'Grocery Outlet' },
  { id: 'smart-and-final', name: 'Smart & Final', aliases: ['smart and final'] },
  { id: 'foodmaxx', name: 'FoodMaxx', aliases: ['food maxx'] },
  { id: 'lucky-supermarkets', name: 'Lucky Supermarkets', aliases: ['lucky', 'luckys'] },
  { id: 'raleys', name: "Raley's", aliases: ['raleys'] },
  { id: 'pcc', name: 'PCC Community Markets', aliases: ['pcc', 'pcc markets'] },
  { id: 'h-mart', name: 'H Mart', aliases: ['h mart', 'hmart'] },
  // Discount / convenience chains observed or clearly major.
  { id: 'dollar-general', name: 'Dollar General' },
  { id: 'dollar-tree', name: 'Dollar Tree' },
  { id: 'family-dollar', name: 'Family Dollar' },
  { id: 'seven-eleven', name: '7-Eleven', aliases: ['7 eleven', '7-11', '7 11'] },
  { id: 'wawa', name: 'Wawa' },
  { id: 'kwik-trip', name: 'Kwik Trip', aliases: ['kwik star'] },
];

const CATALOG_BY_ID = new Map(RETAILER_CATALOG.map((r) => [r.id, r]));

export function retailerById(id: string): CanonicalRetailer | null {
  return CATALOG_BY_ID.get(id) ?? null;
}

/**
 * Normalize a retailer string for alias comparison: case, punctuation
 * (curly quotes, periods, apostrophes), "&" vs "and", collapsed whitespace.
 * Hyphens are kept — "H-E-B" and "Winn-Dixie" spell theirs.
 */
export function normalizeRetailerText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\./g, '')
    .replace(/&/g, ' and ')
    .replace(/'/g, '')
    .replace(/[^a-z0-9\- ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Trailing venue words are the source describing a chain, not part of its
 * identity ("Target stores", "Whole Foods Markets", "Hy-Vee Drugstore").
 * Stripping is lookup-driven: a stripped form counts only when the remainder
 * is itself a known alias, so "Central Market" can never decay to "Central".
 */
const VENUE_TAIL =
  /\s+(?:stores?|markets?|supermarkets?|locations?|clubs?|retail|grocery|drugstores?)$/;

const ALIAS_TO_ID = new Map<string, string>();
for (const retailer of RETAILER_CATALOG) {
  const forms = [retailer.name, ...(retailer.aliases ?? [])];
  for (const form of forms) {
    const key = normalizeRetailerText(form);
    const existing = ALIAS_TO_ID.get(key);
    if (existing !== undefined && existing !== retailer.id) {
      // A duplicate alias would silently make one chain masquerade as
      // another; fail loudly at module load instead.
      throw new Error(`retailer alias "${key}" maps to both ${existing} and ${retailer.id}`);
    }
    ALIAS_TO_ID.set(key, retailer.id);
  }
}

/** Exact alias lookup with bounded venue-tail stripping. */
function lookupNormalized(normalized: string): string | null {
  let candidate = normalized;
  for (let i = 0; i < 3; i += 1) {
    const hit = ALIAS_TO_ID.get(candidate);
    if (hit) return hit;
    const stripped = candidate.replace(VENUE_TAIL, '');
    if (stripped === candidate) return null;
    candidate = stripped;
  }
  return ALIAS_TO_ID.get(candidate) ?? null;
}

/**
 * Resolve ONE raw evidence string to canonical retailer ids.
 *
 * Compound strings are split conservatively: on commas always ("Albertsons,
 * Randalls, Tom Thumb"), and on " and " only at a split point where BOTH
 * sides independently resolve ("Costco and Sam's Club") — so "Stop and Shop"
 * (resolved whole, first) and prose fragments never fragment. Anything that
 * does not resolve contributes nothing.
 */
export function canonicalRetailerIdsForEvidence(raw: string): string[] {
  const found: string[] = [];
  const add = (id: string | null) => {
    if (id && !found.includes(id)) found.push(id);
  };

  const resolve = (text: string): boolean => {
    const normalized = normalizeRetailerText(text);
    if (normalized === '') return false;
    const whole = lookupNormalized(normalized);
    if (whole) {
      add(whole);
      return true;
    }
    const words = normalized.split(' ');
    for (let i = 1; i < words.length; i += 1) {
      if (words[i] !== 'and') continue;
      const left = words.slice(0, i).join(' ');
      const right = words.slice(i + 1).join(' ');
      const leftId = lookupNormalized(left);
      const rightId = lookupNormalized(right);
      if (leftId && rightId) {
        add(leftId);
        add(rightId);
        return true;
      }
    }
    return false;
  };

  if (raw.includes(',')) {
    for (const part of raw.split(',')) resolve(part);
  } else {
    resolve(raw);
  }
  return found;
}

/**
 * Canonical retailer ids across a case's retailer evidence strings — the one
 * matching entry point for feed, detail, push eligibility, and QA alike.
 */
export function canonicalRetailerIds(evidence: readonly string[]): string[] {
  const ids: string[] = [];
  for (const raw of evidence) {
    for (const id of canonicalRetailerIdsForEvidence(raw)) {
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/**
 * Catalog entries whose name or aliases match a search query (for the
 * preference selector). Empty query returns the full catalog in name order.
 */
export function searchRetailers(query: string): CanonicalRetailer[] {
  const sorted = [...RETAILER_CATALOG].sort((a, b) => a.name.localeCompare(b.name));
  const normalized = normalizeRetailerText(query);
  if (normalized === '') return sorted;
  return sorted.filter((retailer) =>
    [retailer.name, ...(retailer.aliases ?? [])].some((form) =>
      normalizeRetailerText(form).includes(normalized),
    ),
  );
}
