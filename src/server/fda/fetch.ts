/**
 * Live FDA announcement fetch (source contract §3.1, re-verified 2026-08-21).
 *
 * Three official channels:
 * - Listing JSON backend (`/datatables-json/recalls-market-withdrawals.json`):
 *   the primary discovery feed. Undocumented site internal — fresh to the
 *   previous day, ~1,000 items over a rolling ~3-year window, NOT sorted by
 *   date. May change without notice; the ingest layer alarms on shape drift.
 * - Food-safety RSS: official documented feed, ~20-item rolling window used as
 *   an independent cross-check on the undocumented listing.
 * - Announcement detail pages: the authoritative consumer content (dates,
 *   press-release body, product tables, photos). Fetched per record, verified
 *   byte-stable across fetches, so content hashing is meaningful.
 *
 * www.fda.gov historically 404'd non-browser user agents (contract §3.1); the
 * gate was not enforced at re-verification but browser-like headers are still
 * sent for robustness.
 */

export const FDA_LISTING_URL =
  'https://www.fda.gov/datatables-json/recalls-market-withdrawals.json';
export const FDA_FOOD_RSS_URL =
  'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/food-safety-recalls/rss.xml';

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9',
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(
  url: string,
  fetchImpl: typeof fetch,
  attempts = 3,
): Promise<Response> {
  let lastError = 'no attempts made';
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetchImpl(url, { headers: BROWSER_HEADERS });
      if (response.ok) return response;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < attempts - 1) await sleep(1000 * 2 ** attempt);
  }
  throw new Error(`FDA fetch failed after ${attempts} attempts: ${url} (${lastError})`);
}

export interface FdaListingFetchResult {
  items: unknown[];
  fetchedAt: string;
  sourceUrl: string;
}

export async function fetchFdaListing(
  fetchImpl: typeof fetch = fetch,
): Promise<FdaListingFetchResult> {
  // Captured when the request STARTS (O3-B1 version ordering): a slow
  // response must not launder older content under a newer timestamp —
  // fetched_at is the monotonicity token archive_snapshot orders competing
  // fetches by.
  const fetchedAt = new Date().toISOString();
  const response = await fetchWithRetry(FDA_LISTING_URL, fetchImpl);
  const body = (await response.json()) as unknown;
  if (!Array.isArray(body)) {
    throw new Error(`FDA listing returned non-array JSON (${typeof body})`);
  }
  return { items: body, fetchedAt, sourceUrl: FDA_LISTING_URL };
}

export interface FdaRssItem {
  title: string;
  /** Normalized https link to the announcement (RSS serves http://). */
  link: string;
  pubDate: string | null;
  /** The raw <item> XML fragment, preserved for snapshots. */
  rawXml: string;
}

/** Minimal deterministic RSS item extraction — the feed is flat and stable. */
export function parseFdaRssItems(xml: string): FdaRssItem[] {
  const items: FdaRssItem[] = [];
  for (const match of xml.matchAll(/<item>[\s\S]*?<\/item>/g)) {
    const fragment = match[0];
    const pick = (tag: string) =>
      fragment.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1].trim() ?? null;
    const link = pick('link');
    const title = pick('title');
    if (!link || !title) continue;
    items.push({
      title,
      link: link.replace(/^http:\/\//, 'https://'),
      pubDate: pick('pubDate'),
      rawXml: fragment,
    });
  }
  return items;
}

export interface FdaRssFetchResult {
  items: FdaRssItem[];
  fetchedAt: string;
  sourceUrl: string;
}

export async function fetchFdaFoodRss(fetchImpl: typeof fetch = fetch): Promise<FdaRssFetchResult> {
  // Request-start capture, same rationale as fetchFdaListing.
  const fetchedAt = new Date().toISOString();
  const response = await fetchWithRetry(FDA_FOOD_RSS_URL, fetchImpl);
  const xml = await response.text();
  const items = parseFdaRssItems(xml);
  if (items.length === 0) {
    throw new Error('FDA food RSS returned no parseable items — feed shape may have changed');
  }
  return { items, fetchedAt, sourceUrl: FDA_FOOD_RSS_URL };
}

/**
 * Extract the announcement content region from a detail page. The full page
 * carries site chrome (nav, scripts) with no announcement value; the <main>
 * region holds the headline, the structured summary block, and the complete
 * press-release body, and is what snapshots preserve.
 */
export function extractMainRegion(html: string): string | null {
  return html.match(/<main\b[^>]*>[\s\S]*<\/main>/)?.[0] ?? null;
}

/** Fetch one announcement detail page; returns the <main> content region. */
export async function fetchFdaDetailPage(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchWithRetry(url, fetchImpl);
  const html = await response.text();
  const main = extractMainRegion(html);
  if (!main) {
    throw new Error(`FDA detail page has no <main> region — page shape may have changed: ${url}`);
  }
  return main;
}
