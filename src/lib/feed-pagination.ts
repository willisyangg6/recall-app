/**
 * Complete-feed loading (Phase C5.1): the paging core that guarantees Home
 * holds EVERY active case, with no fixed total ceiling.
 *
 * ## Why this exists
 *
 * Home used to issue one request with `limit=500` against a corpus of 882
 * active cases: 382 cases (43%) never reached the client, so All Recalls
 * silently omitted them, "Affects me" could not evaluate them, and the older
 * section undercounted. Raising the number would not fix it — measured live,
 * PostgREST enforces a hard server ceiling (`max_rows`, 1000 here): a request
 * for `limit=5000` returns exactly 1000 rows, with nothing in the response to
 * say the answer was cut short. Any single-request design is therefore a
 * silent-truncation bug waiting for the corpus to grow into it.
 *
 * `FEED_PAGE_SIZE` is a per-request transfer size, NOT a total: the loader
 * keeps paging until a page comes back short.
 *
 * ## Why the cursor is the case id
 *
 * Ingestion runs every 30 minutes and rewrites `last_public_activity_at` on
 * existing rows. Under offset/range paging that is a correctness bug: a row
 * whose activity date jumps to today moves onto page 1 while the client is
 * reading page 3, every later row shifts by one, and exactly one active case
 * is skipped — invisibly, since a short page never happens.
 *
 * Keying on `id` removes the failure mode rather than narrowing it. The id is
 * an immutable uuid primary key, so a row's position in an id-ordered scan
 * cannot change while we page: no reordering, no skips, no duplicates. The
 * residual cases are benign and self-correcting on the next refresh — a case
 * inserted behind the cursor mid-scan, or one whose lifecycle state flips
 * mid-scan. Neither can corrupt what we already hold.
 *
 * Display order is not the server's job here (see `buildFeedSections` and
 * `buildAffectsMeSections`, which impose their own total orders): the client
 * receives the complete set and sorts it. That is also why we can afford the
 * simplest possible cursor.
 */

/**
 * Rows per request. Comfortably under the measured 1000-row server cap, and
 * large enough that today's corpus loads in two requests (measured: 1.23 MB,
 * ~630 ms end to end — faster than the single truncated 500-row request it
 * replaces, which took ~1160 ms for 43% less data).
 *
 * This bounds one transfer. It never bounds the feed.
 */
export const FEED_PAGE_SIZE = 500;

/**
 * Runaway-loop backstop, far above any real corpus (500 × 200 = 100,000
 * cases). Tripping it means a bug — a cursor that stopped advancing, or a
 * server that ignores the filter — so it THROWS rather than returning what it
 * has. Returning a truncated feed here would recreate the exact silent
 * incompleteness this module exists to eliminate.
 */
export const MAX_FEED_PAGES = 200;

/** One page request. `cursor` is null for the first page. */
export type FetchFeedPage<T> = (cursor: string | null, pageSize: number) => Promise<T[]>;

export interface LoadAllPagesOptions {
  pageSize?: number;
  maxPages?: number;
  /** Attempts per page, including the first. Transient mobile blips are common. */
  attemptsPerPage?: number;
  /** Injectable for tests; real callers get a short backoff. */
  delay?: (ms: number) => Promise<void>;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Page through the complete set, or throw.
 *
 * There is deliberately no partial success: a caller that receives an array
 * has the whole corpus. "All Recalls" that quietly lost its tail is worse than
 * an honest error, because nothing downstream — counts, sections, "affects me"
 * eligibility — can tell the difference.
 *
 * Duplicates are collapsed by stable case id, so a retried or overlapping page
 * can never inflate a count.
 */
export async function loadAllPages<T extends { id: string }>(
  fetchPage: FetchFeedPage<T>,
  options: LoadAllPagesOptions = {},
): Promise<T[]> {
  const pageSize = options.pageSize ?? FEED_PAGE_SIZE;
  const maxPages = options.maxPages ?? MAX_FEED_PAGES;
  const attempts = options.attemptsPerPage ?? 3;
  const wait = options.delay ?? sleep;

  const byId = new Map<string, T>();
  let cursor: string | null = null;

  for (let page = 0; ; page += 1) {
    if (page >= maxPages) {
      throw new Error(
        `Recall feed exceeded ${maxPages} pages (${byId.size} rows loaded); refusing to return a partial feed.`,
      );
    }

    const rows: T[] = await fetchPageWithRetry(fetchPage, cursor, pageSize, attempts, wait);
    for (const row of rows) byId.set(row.id, row);

    // Explicit completion detection: only a short page ends the scan. A full
    // page always costs one more request, which correctly returns empty.
    if (rows.length < pageSize) break;

    const last = rows[rows.length - 1];
    // A page that does not advance the cursor would loop forever; that is a
    // server or filter fault, not an empty result.
    if (last.id === cursor) {
      throw new Error('Recall feed pagination stalled: cursor did not advance.');
    }
    cursor = last.id;
  }

  return [...byId.values()];
}

async function fetchPageWithRetry<T>(
  fetchPage: FetchFeedPage<T>,
  cursor: string | null,
  pageSize: number,
  attempts: number,
  wait: (ms: number) => Promise<void>,
): Promise<T[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchPage(cursor, pageSize);
    } catch (error) {
      lastError = error;
      // Retrying a keyset page is inherently safe: the same cursor asks the
      // same question, and ids dedupe anything that arrives twice.
      if (attempt < attempts) await wait(attempt * 250);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Recall feed page request failed.');
}
