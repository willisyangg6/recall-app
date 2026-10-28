/**
 * Live FSIS Recall API fetch.
 *
 * fsis.usda.gov sits behind Akamai bot filtering: minimal user agents get 403
 * and the accepted fingerprint has been observed to vary same-day (source
 * contract §4.1/§8). So we send a full browser-like header fingerprint and
 * retry across fingerprint variants with backoff. No auth exists or is needed.
 *
 * There is no pagination — the endpoint returns the entire filtered set as one
 * JSON array (~1 MB for English), so we fetch it all and diff downstream.
 *
 * FAILURE DIAGNOSIS (2026-10-27): undici rejects every transport fault with the
 * same bare `TypeError: fetch failed` and hides the reason in `error.cause`.
 * On 2026-10-27 www.fsis.usda.gov stopped resolving (public resolvers answered
 * SERVFAIL for usda.gov); undici reported each attempt as a 10 s
 * UND_ERR_CONNECT_TIMEOUT, and the run failed as "fetch failed" with a hint
 * blaming Akamai fingerprints. The final error now carries the transport cause,
 * the result of a one-shot DNS lookup when every attempt failed below HTTP, and
 * the Akamai hint only when the source actually answered 403. The DNS result
 * is an observation from this runner at that moment, not a verdict on where
 * the fault lies. Retry count and backoff are unchanged, and the failure stays
 * loud.
 */

import { lookup } from 'node:dns/promises';

import { clipDiagnostic } from '../transient-retry';
import type { FsisRawRecord } from './parse';

export const FSIS_API_URL =
  'https://www.fsis.usda.gov/fsis/api/recall/v/1?field_translation_language=en';

const CHROME_FINGERPRINT: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'sec-ch-ua': '"Not;A=Brand";v="99", "Google Chrome";v="139", "Chromium";v="139"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
};

const FIREFOX_FINGERPRINT: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
};

const FINGERPRINTS = [CHROME_FINGERPRINT, FIREFOX_FINGERPRINT];

export interface FsisFetchResult {
  records: FsisRawRecord[];
  fetchedAt: string;
  sourceUrl: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const DNS_CHECK_TIMEOUT_MS = 5000;

export interface FsisFetchOptions {
  sleep?: (ms: number) => Promise<void>;
  /**
   * Resolves the API host once, after every attempt failed below HTTP. Returns
   * null when the name resolves, else a short reason. Never throws.
   */
  checkDns?: (hostname: string) => Promise<string | null>;
}

/**
 * The getaddrinfo path fetch itself uses, hard-capped: a dead authority makes
 * the lookup hang for tens of seconds, and the cap keeps the diagnosis cheap.
 */
export async function checkHostResolves(hostname: string): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<string>((resolve) => {
    timer = setTimeout(
      () => resolve(`no answer within ${DNS_CHECK_TIMEOUT_MS / 1000} s`),
      DNS_CHECK_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([
      lookup(hostname).then(
        () => null,
        (error: NodeJS.ErrnoException) => error.code ?? clipDiagnostic(error),
      ),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `fetch failed` plus the undici cause that actually says what failed
 * (UND_ERR_CONNECT_TIMEOUT, ENOTFOUND, ECONNRESET, …). Clipped: no query
 * string, no body.
 */
function describeTransportError(error: unknown): string {
  const message = clipDiagnostic(error);
  const cause = error instanceof Error ? (error.cause as NodeJS.ErrnoException | undefined) : null;
  if (!cause || typeof cause !== 'object') return message;
  const detail = [cause.code, cause.message ? clipDiagnostic(cause) : null]
    .filter((part): part is string => Boolean(part))
    .join(': ');
  return detail ? `${message} (${detail})` : message;
}

export async function fetchFsisRecords(
  fetchImpl: typeof fetch = fetch,
  options: FsisFetchOptions = {},
): Promise<FsisFetchResult> {
  const wait = options.sleep ?? sleep;
  const attempts = 4;
  let lastError: string = 'no attempts made';
  let lastStatus: number | null = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const headers = FINGERPRINTS[attempt % FINGERPRINTS.length];
    // Captured when the request STARTS, not when the response lands (O3-B1
    // version ordering): a slow response must not launder older content
    // under a newer timestamp, because fetched_at is the monotonicity token
    // archive_snapshot orders competing fetches by.
    const fetchedAt = new Date().toISOString();
    try {
      const response = await fetchImpl(FSIS_API_URL, { headers });
      if (response.ok) {
        const body = (await response.json()) as unknown;
        if (!Array.isArray(body)) {
          throw new Error(`FSIS API returned non-array JSON (${typeof body})`);
        }
        return {
          records: body as FsisRawRecord[],
          fetchedAt,
          sourceUrl: FSIS_API_URL,
        };
      }
      lastStatus = response.status;
      lastError = `HTTP ${response.status}`;
      // 403 = Akamai fingerprint rejection — try the next fingerprint variant.
    } catch (error) {
      lastStatus = null;
      lastError = describeTransportError(error);
    }
    if (attempt < attempts - 1) await wait(1000 * 2 ** attempt);
  }

  let diagnosis = '';
  if (lastStatus === 403) {
    diagnosis =
      ' If this persists with 403s, the Akamai fingerprint rules may have changed — see docs/recall-source-contract.md §4.1.';
  } else if (lastStatus === null) {
    // Every attempt died below HTTP. Report what a separate lookup observed,
    // so the first thing checked is name resolution, not fingerprints. It
    // does not by itself locate the fault (source authority, resolver, or
    // runner network) or rule out other transport causes.
    const hostname = new URL(FSIS_API_URL).hostname;
    const dnsFailure = await (options.checkDns ?? checkHostResolves)(hostname).catch(() => null);
    if (dnsFailure) {
      diagnosis =
        ` A separate DNS lookup for ${hostname} also failed (${dnsFailure}): ` +
        'the hostname did not resolve from this runner. Check DNS resolution first.';
    }
  }
  throw new Error(
    `FSIS API fetch failed after ${attempts} attempts (last error: ${lastError}).${diagnosis}`,
  );
}
