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
 * Request profile: see FDA_REQUEST_HEADERS below. www.fda.gov historically
 * 404'd non-browser user agents (contract §3.1); from 2026-10-28 the reverse
 * held on GitHub-hosted runners.
 */

import {
  classifyReadError,
  clipDiagnostic,
  InvalidSourceResponseError,
  retryTransientRead,
  type ErrorClassification,
  type RetryHooks,
  type RetryPolicy,
} from '../transient-retry';

export const FDA_LISTING_URL =
  'https://www.fda.gov/datatables-json/recalls-market-withdrawals.json';
export const FDA_FOOD_RSS_URL =
  'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/food-safety-recalls/rss.xml';

/**
 * Headers for every www.fda.gov read: the listing, the food RSS, and each
 * announcement detail page (all go through fetchSource). api.fda.gov
 * (enforcement) and FSIS have their own request paths and are unaffected.
 *
 * WHY (2026-11-01, three diagnostics-only runner probes): from 2026-10-28 the
 * previous browser profile — a Chrome User-Agent with Accept
 * "text/html,…,application/json;q=0.8,*\/*;q=0.7" and Accept-Language
 * "en-US,en;q=0.9" — was answered on GitHub-hosted runners with a 302 to
 * www.fda.gov/apology_objects/abuse-detection-apology.html, which then 404'd
 * (243 of 266 FDA runs failed). It failed the same way with Node fetch, Node
 * https, and curl, over HTTP/1.1 and HTTP/2. On a runner, the SAME Node fetch
 * client sending only a non-browser User-Agent got direct 200s with valid
 * content: `curl/8` through these production functions (listing 1,098 valid
 * records, RSS 20 items, a valid detail page), and this accurate application
 * identity, sent alone, for the same listing, RSS, and detail page.
 *
 * On the wire, Node fetch (undici) fills in the rest, so the outgoing profile
 * changes from the old one as follows:
 *   User-Agent       Chrome 139 string        → lotly-recall-ingest/1.0
 *   Accept           text/html,…;q=0.7        → *\/*   (fetch default)
 *   Accept-Language  en-US,en;q=0.9           → *     (fetch default)
 *   sec-fetch-mode   cors                     (unchanged, fetch default)
 *   Accept-Encoding  gzip, deflate            (unchanged, fetch default)
 * The whole profile changed, so the evidence does not isolate the User-Agent
 * as the sole deciding header. Keep it minimal: restoring the browser Accept
 * or Accept-Language is untested against the edge rule. No endpoint sent a
 * specific Accept before, and there are no conditional requests, so neither
 * is lost.
 */
export const FDA_REQUEST_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'User-Agent': 'lotly-recall-ingest/1.0',
});

/**
 * ── RESPONSE BOUNDARY (hardened 2026-09-09) ─────────────────────────────────
 *
 * Status check, body decode, AND payload parse all happen inside one bounded
 * attempt. Before this, only the status check was retried: `response.json()`
 * ran after `fetchWithRetry` returned, so the 2026-09-09 scheduled run that
 * received an HTML error page under HTTP 200 died on the first try with a raw,
 * unclassified `SyntaxError: Unexpected token '<'` — a transient edge artifact
 * presented as a code defect. (FSIS already had the parse inside its attempt
 * loop and is deliberately left untouched.)
 *
 * The line between retry and alarm is decode versus contract:
 *
 *   decode failure    HTML where JSON was promised, an empty body, truncated
 *                     JSON, a gateway status. Never a documented payload, so a
 *                     proxy produced it ⇒ bounded retry.
 *   contract drift    a well-formed payload of the wrong shape (JSON that is
 *                     not an array; valid XML with no <item>). The source
 *                     really did change ⇒ fail immediately and alarm. Retrying
 *                     would only delay the alarm, and loosening the check to
 *                     accept it would hide a real break.
 */

/**
 * The existing bounded policy, unchanged in width: 3 attempts, 1s then 2s.
 * What changed is which faults reach it — decode and parse failures now do.
 * A persistent 404/403 (www.fda.gov's documented bot gate) still exhausts all
 * three attempts and then fails as an unavailable source rather than a parse
 * crash. FSIS keeps its own 4-attempt fingerprint-rotating policy.
 */
export const FDA_FETCH_POLICY: RetryPolicy = {
  attempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 8000,
  rateLimitMinDelayMs: 2000,
};

/** Source-contract drift: a parseable payload of the wrong shape. Not retried. */
export class FdaSourceContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FdaSourceContractError';
  }
}

/** The source answered, but with nothing this client can use. Not retried. */
export class FdaSourceUnavailableError extends Error {
  constructor(url: string, detail: string) {
    super(`FDA source unavailable: ${url} (${detail})`);
    this.name = 'FdaSourceUnavailableError';
  }
}

/**
 * www.fda.gov's documented bot gate: it has historically served 403/404 to
 * non-browser clients (source contract §3.1), so for THIS source they are worth
 * the existing bounded retry before being reported as an unavailable source.
 * The shared classifier treats them as permanent, which is right for a database
 * read, so the exception is declared here and nowhere else.
 */
const BOT_GATE_STATUS = new Set([403, 404]);

/** Statuses that cannot become valid by trying again. */
const FAIL_FAST_STATUS = new Set([400, 401, 405, 406, 409, 410, 413, 414, 415, 422, 431]);

/** The shared classifier, plus this source's bot-gate exception. */
function classifySourceError(error: unknown): ErrorClassification {
  if (error instanceof BotGateError) return { retryable: true, errorClass: 'gateway' };
  return classifyReadError(error);
}

/** A bot-gate status, retryable for this source only. */
class BotGateError extends Error {
  constructor(
    readonly status: number,
    detail = '',
  ) {
    super(`HTTP ${status}${detail ? ` (${detail})` : ''}`);
    this.name = 'BotGateError';
  }
}

/**
 * What a 403/404 response looked like, without its body (2026-10-31): from
 * 2026-10-28 the listing answered GitHub runners with 404 on ~9 in 10 runs
 * while the same request, client, and Node major got 200 from elsewhere, and
 * "HTTP 404" alone could not say whether that was an edge deny page or a
 * genuinely missing resource. Content type, size, server, page title, and an
 * Akamai reference number (an opaque request id) can.
 *
 * Redirects come first (2026-11-01): a runner probe showed the runner's 404
 * was not www.fda.gov's — fetch had followed a redirect and the 10-byte 404
 * came from AkamaiNetStorage. Redirects are still followed (legitimate ones
 * must keep working); the error now names where the request ended up, as
 * scheme, host and a clipped path only — never a query string.
 */
async function describeGateResponse(response: Response): Promise<string> {
  const parts: string[] = [];
  if (response.redirected && response.url) {
    try {
      const final = new URL(response.url);
      parts.push(`redirected to ${final.protocol}//${final.host}${final.pathname.slice(0, 60)}`);
    } catch {
      parts.push('redirected');
    }
  }
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim();
  if (contentType) parts.push(contentType);
  let body = '';
  try {
    body = await response.text();
  } catch {
    // An unreadable error body is still an error; describe what we have.
  }
  parts.push(`${body.length} B`);
  const server = response.headers.get('server');
  if (server) parts.push(`server ${server.slice(0, 40)}`);
  const title = /<title[^>]*>\s*([^<]{1,80})/i.exec(body)?.[1]?.replace(/\s+/g, ' ').trim();
  if (title) parts.push(`title "${title.slice(0, 60)}"`);
  const reference = /Reference\s*#\s*([0-9a-f.]{6,64})/i.exec(body)?.[1];
  if (reference) parts.push(`ref #${reference}`);
  return parts.join(', ');
}

/** The request ended on FDA's abuse-detection apology page (any host, any status). */
function isApologyRedirect(response: Response): boolean {
  if (!response.url) return false;
  try {
    return new URL(response.url).pathname.startsWith('/apology_objects/');
  } catch {
    return false;
  }
}

/** Bounded Retry-After: seconds or HTTP-date, clamped to the policy cap. */
function retryAfterMs(response: Response, policy: RetryPolicy): number | null {
  const header = response.headers.get('retry-after');
  if (!header) return null;
  const seconds = Number(header.trim());
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.min(ms, policy.maxDelayMs);
}

/** An HTML/XHTML error page served where a data payload was promised. */
const LOOKS_LIKE_HTML = /^\s*(?:<!doctype\s+html|<html\b|<head\b|<body\b)/i;

interface SourceFetchOptions {
  policy?: RetryPolicy;
  hooks?: RetryHooks;
}

/**
 * One bounded source read: fetch, check status, decode the body, and parse it —
 * every step retried together, nothing after the loop.
 *
 * `parse` must throw InvalidSourceResponseError for an undecodable body and
 * FdaSourceContractError for a well-formed payload of the wrong shape.
 */
async function fetchSource<T>(
  url: string,
  fetchImpl: typeof fetch,
  parse: (body: string, contentType: string | null) => T,
  options: SourceFetchOptions = {},
): Promise<T> {
  const policy = options.policy ?? FDA_FETCH_POLICY;
  try {
    return await retryTransientRead(
      `fda.fetch ${url}`,
      async () => {
        const response = await fetchImpl(url, { headers: { ...FDA_REQUEST_HEADERS } });
        // FDA's abuse-detection redirect target. It is never source content,
        // whatever its status: a detail page is HTML too, so the HTML check
        // alone could not keep a 200 apology page out of ingestion. Other
        // redirects are still followed and judged on their content.
        if (isApologyRedirect(response)) {
          throw new BotGateError(response.status, await describeGateResponse(response));
        }
        if (!response.ok) {
          if (FAIL_FAST_STATUS.has(response.status)) {
            throw new FdaSourceUnavailableError(url, `HTTP ${response.status}`);
          }
          if (BOT_GATE_STATUS.has(response.status)) {
            throw new BotGateError(response.status, await describeGateResponse(response));
          }
          // Gateway statuses: classified transient, bounded retry.
          throw Object.assign(new Error(`HTTP ${response.status}`), {
            status: response.status,
            retryAfterMs: retryAfterMs(response, policy),
          });
        }
        const contentType = response.headers.get('content-type');
        const body = await response.text();
        if (body.trim().length === 0) {
          throw new InvalidSourceResponseError('empty body', contentType);
        }
        return parse(body, contentType);
      },
      policy,
      {
        classify: classifySourceError,
        // Built here rather than by the generic exhausted error so the final
        // message carries the last response's description instead of
        // repeating the URL inside the shared 200-character diagnostic cap.
        onExhausted: (_operation, attempts, cause) =>
          new FdaSourceUnavailableError(
            url,
            `failed after ${attempts} attempt(s) [${classifySourceError(cause).errorClass}]: ${clipDiagnostic(cause)}`,
          ),
        ...options.hooks,
      },
    );
  } catch (error) {
    if (error instanceof FdaSourceContractError || error instanceof FdaSourceUnavailableError) {
      throw error;
    }
    // Bounded, payload-free: never the body, never a query string.
    throw new FdaSourceUnavailableError(
      url,
      `failed after ${policy.attempts} attempt(s): ${clipDiagnostic(error)}`,
    );
  }
}

/**
 * Decode a JSON payload. HTML, an unparseable body, or truncation is a
 * transient decode failure; a parseable non-array is contract drift.
 */
function parseJsonArray(label: string, body: string, contentType: string | null): unknown[] {
  if (LOOKS_LIKE_HTML.test(body)) {
    throw new InvalidSourceResponseError(
      `${label} returned an HTML page where JSON was expected (${body.length} bytes)`,
      contentType,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(body) as unknown;
  } catch {
    // Shape only — the body itself never reaches a log line.
    throw new InvalidSourceResponseError(
      `${label} returned unparseable JSON (${body.length} bytes)`,
      contentType,
    );
  }
  if (!Array.isArray(value)) {
    throw new FdaSourceContractError(`${label} returned non-array JSON (${typeof value})`);
  }
  return value;
}

export interface FdaListingFetchResult {
  items: unknown[];
  fetchedAt: string;
  sourceUrl: string;
}

export async function fetchFdaListing(
  fetchImpl: typeof fetch = fetch,
  options: SourceFetchOptions = {},
): Promise<FdaListingFetchResult> {
  // Captured when the request STARTS (O3-B1 version ordering): a slow
  // response must not launder older content under a newer timestamp —
  // fetched_at is the monotonicity token archive_snapshot orders competing
  // fetches by.
  const fetchedAt = new Date().toISOString();
  const items = await fetchSource(
    FDA_LISTING_URL,
    fetchImpl,
    (body, contentType) => parseJsonArray('FDA listing', body, contentType),
    options,
  );
  return { items, fetchedAt, sourceUrl: FDA_LISTING_URL };
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

export async function fetchFdaFoodRss(
  fetchImpl: typeof fetch = fetch,
  options: SourceFetchOptions = {},
): Promise<FdaRssFetchResult> {
  // Request-start capture, same rationale as fetchFdaListing.
  const fetchedAt = new Date().toISOString();
  const items = await fetchSource(
    FDA_FOOD_RSS_URL,
    fetchImpl,
    (body, contentType) => {
      // An HTML error page is a decode failure; valid XML carrying no items is
      // contract drift. Both were one indistinguishable hard failure before.
      if (LOOKS_LIKE_HTML.test(body)) {
        throw new InvalidSourceResponseError(
          `FDA food RSS returned an HTML page where XML was expected (${body.length} bytes)`,
          contentType,
        );
      }
      const parsed = parseFdaRssItems(body);
      if (parsed.length === 0) {
        if (!/<\s*(?:\?xml|rss|feed)\b/i.test(body)) {
          throw new InvalidSourceResponseError(
            `FDA food RSS returned a non-XML body (${body.length} bytes)`,
            contentType,
          );
        }
        throw new FdaSourceContractError(
          'FDA food RSS returned no parseable items — feed shape may have changed',
        );
      }
      return parsed;
    },
    options,
  );
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

/** A proxy/edge error page served under HTTP 200 in place of the real page. */
const GATEWAY_ERROR_PAGE =
  /bad gateway|gateway time-?out|service (?:temporarily )?unavailable|\b50[234]\b|cloudflare|error code: \d+|request timed out/i;

/** Fetch one announcement detail page; returns the <main> content region. */
export async function fetchFdaDetailPage(
  url: string,
  fetchImpl: typeof fetch = fetch,
  options: SourceFetchOptions = {},
): Promise<string> {
  return fetchSource(
    url,
    fetchImpl,
    (body) => {
      const main = extractMainRegion(body);
      if (main) return main;
      // A real announcement page is a large document that always carries
      // <main>. A short body, or one naming a gateway fault, is an edge error
      // page served under 200 — retry it instead of alarming on page shape.
      if (body.length < 4096 || GATEWAY_ERROR_PAGE.test(body)) {
        throw new InvalidSourceResponseError(
          `FDA detail page returned an error page instead of content (${body.length} bytes)`,
          null,
        );
      }
      throw new FdaSourceContractError(
        `FDA detail page has no <main> region — page shape may have changed: ${url}`,
      );
    },
    options,
  );
}
