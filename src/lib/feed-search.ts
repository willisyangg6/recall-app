/**
 * Feed search (C6) — pure, dependency-free, testable outside React.
 *
 * Two matching modes, chosen by what the user typed:
 *
 *   TEXT     — normalized, case- and diacritic-insensitive substring matching
 *              over the consumer-facing fields (title, product description,
 *              product/variant lines, brands, recalling firm, retailers).
 *              Every whitespace-separated query token must appear somewhere
 *              in the item's combined text ("solata spinach" matches
 *              "Greens Solata Spinach" regardless of word order).
 *
 *   IDENTIFIER — when the query looks like a printed code (≥4 digits after
 *              stripping label prefixes like "UPC", "Lot", "EST"), it is also
 *              compared against the code candidates extracted from the item's
 *              text with harmless punctuation, spaces, dots, and hyphens
 *              removed — so "0 12345 67890 5" on a label matches a query
 *              typed as "012345678905" or "0-12345-67890-5". Matching is
 *              exact substring over the normalized code: NEVER fuzzy — a
 *              single wrong digit does not match.
 *
 * Deliberately NOT searched: raw announcement HTML, summary prose, and
 * anything personal. Nothing here queries a service; the index is built once
 * per loaded corpus and every match is string containment.
 */

/** The searchable slice of a feed item. `FeedItem` satisfies it. */
export interface SearchableRecall {
  title: string;
  productDescription: string | null;
  brands: string[];
  firmName: string | null;
  retailerNames: string[];
  /** Affected product lines — carry variant names and printed codes. */
  productNames: string[];
}

/** Precomputed per-item haystacks; build once per corpus, match per keystroke. */
export interface SearchEntry {
  /** Normalized human text: lowercased, diacritics stripped, punctuation → space. */
  text: string;
  /** Normalized code candidates (uppercased, separators removed). */
  codes: string[];
}

/** Lowercase, strip diacritics, collapse everything non-alphanumeric to spaces. */
export function normalizeSearchText(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Code candidates in a piece of source text: words containing a digit, plus
 * runs of ADJACENT digit-bearing words joined together (so a spaced UPC like
 * "0 12345 67890 5" yields "012345678905"). Only candidates with at least
 * four digits survive — below that, dates and sizes would match everything.
 */
export function extractCodeCandidates(raw: string): string[] {
  const words = raw.toUpperCase().split(/[^0-9A-Z]+/);
  const candidates = new Set<string>();
  let run: string[] = [];
  const flush = () => {
    if (run.length > 1) {
      const joined = run.join('');
      if ((joined.match(/[0-9]/g) ?? []).length >= 4) candidates.add(joined);
    }
    run = [];
  };
  for (const word of words) {
    if (word !== '' && /[0-9]/.test(word)) {
      run.push(word);
      if ((word.match(/[0-9]/g) ?? []).length >= 4) candidates.add(word);
    } else {
      flush();
    }
  }
  flush();
  return [...candidates];
}

export function buildSearchEntry(item: SearchableRecall): SearchEntry {
  const humanParts = [
    item.title,
    item.productDescription ?? '',
    ...item.productNames,
    ...item.brands,
    item.firmName ?? '',
    ...item.retailerNames,
  ];
  const codeSources = [item.title, item.productDescription ?? '', ...item.productNames];
  return {
    text: normalizeSearchText(humanParts.join(' ')),
    codes: codeSources.flatMap(extractCodeCandidates),
  };
}

export interface ParsedSearchQuery {
  /** Normalized text tokens — ALL must match (AND). */
  tokens: string[];
  /** Normalized code, when the query reads as an identifier; else null. */
  identifier: string | null;
}

/**
 * Label prefixes people type in front of a code. Stripped repeatedly so
 * "UPC code 8543…" and "lot # 24TJ0055" both reduce to the code itself.
 */
const LABEL_PREFIX =
  /^(?:upc|gtin|ean|sku|lot|lots|batch|batches|case|code|codes|est|establishment|item|number|no)\b[\s#:.=-]*/i;

/** Null means "no search" — the caller must treat it as a strict no-op. */
export function parseSearchQuery(raw: string): ParsedSearchQuery | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  let candidate = trimmed;
  for (;;) {
    const next = candidate.replace(LABEL_PREFIX, '');
    if (next === candidate) break;
    candidate = next;
  }
  const digits = (candidate.match(/[0-9]/g) ?? []).length;
  const identifier =
    digits >= 4 && /^[0-9A-Za-z][0-9A-Za-z\s\-./#]*$/.test(candidate)
      ? candidate.replace(/[^0-9A-Za-z]/g, '').toUpperCase()
      : null;

  return { tokens: normalizeSearchText(trimmed).split(' ').filter(Boolean), identifier };
}

export function matchesSearch(entry: SearchEntry, query: ParsedSearchQuery): boolean {
  if (query.identifier !== null) {
    const identifier = query.identifier;
    if (entry.codes.some((code) => code.includes(identifier))) return true;
    // Fall through: an identifier-looking query may still be product text
    // ("V8", "7-Eleven") — text matching stays exact substring, never fuzzy.
  }
  return query.tokens.length > 0 && query.tokens.every((token) => entry.text.includes(token));
}

/**
 * The one search application both feed modes use: filter `items` by `rawQuery`
 * using precomputed entries, PRESERVING input order (so ranked Affects-Me
 * output keeps its ranking, and All-Recalls sectioning input keeps its shape).
 *
 * Returns the SAME array instance when the query is empty — empty search is a
 * strict no-op by construction, not by convention.
 */
export function filterBySearch<T>(
  items: T[],
  rawQuery: string,
  entryOf: (item: T) => SearchEntry,
): T[] {
  const query = parseSearchQuery(rawQuery);
  if (query === null) return items;
  return items.filter((item) => matchesSearch(entryOf(item), query));
}
