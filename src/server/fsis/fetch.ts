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
 */

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchFsisRecords(fetchImpl: typeof fetch = fetch): Promise<FsisFetchResult> {
  const attempts = 4;
  let lastError: string = 'no attempts made';
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
      lastError = `HTTP ${response.status}`;
      // 403 = Akamai fingerprint rejection — try the next fingerprint variant.
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < attempts - 1) await sleep(1000 * 2 ** attempt);
  }
  throw new Error(
    `FSIS API fetch failed after ${attempts} attempts (last error: ${lastError}). ` +
      'If this persists with 403s, the Akamai fingerprint rules may have changed — see docs/recall-source-contract.md §4.1.',
  );
}
