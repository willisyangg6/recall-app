/**
 * openFDA Food Enforcement fetch — server-side only.
 *
 * Two access paths, both official (docs/recall-source-contract.md §3.2):
 * - the query API (`api.fda.gov/food/enforcement.json`), paginated with
 *   `limit`/`skip` (limit ≤ 1000; skip capped at 25,000 by openFDA — beyond
 *   that the bulk export is the sanctioned path);
 * - the bulk export zip named by `api.fda.gov/download.json`, ONE ~5.5 MB
 *   request for the complete dataset — the polite choice for backfills.
 *
 * An API key (env OPENFDA_API_KEY, server-only) raises limits to 240
 * req/min / 120k/day; keyless works at 240/min / 1,000/day. Incremental
 * runs filter by report_date range so a weekly sync is a handful of pages.
 * The dataset updates WEEKLY — this source is for classification
 * enrichment, never discovery (FDA's own disclaimer).
 */

import type { OpenFdaEnforcementRaw } from './parse';

const API_URL = 'https://api.fda.gov/food/enforcement.json';
const PAGE_LIMIT = 1000;
/** openFDA rejects skip beyond 25,000 — the bulk export covers full pulls. */
const MAX_SKIP = 25_000;

export interface EnforcementFetchResult {
  records: OpenFdaEnforcementRaw[];
  /** openFDA's own dataset stamp (meta.last_updated). */
  sourceLastUpdated: string | null;
  fetchedAt: string;
  requests: number;
}

interface FetchOptions {
  /** Only records whose report_date is on/after this ISO date. */
  reportedSince?: string;
  apiKey?: string;
  /** Politeness delay between pages. */
  pageDelayMs?: number;
  fetchImpl?: typeof fetch;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Query-API pull, paginated; bounded by design (use bulk for full history). */
export async function fetchEnforcementRecords(
  options: FetchOptions = {},
): Promise<EnforcementFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const records: OpenFdaEnforcementRaw[] = [];
  let sourceLastUpdated: string | null = null;
  let requests = 0;

  const search = options.reportedSince
    ? `report_date:[${options.reportedSince.replace(/-/g, '')} TO 30000101]`
    : null;

  for (let skip = 0; skip <= MAX_SKIP; skip += PAGE_LIMIT) {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    params.set('limit', String(PAGE_LIMIT));
    params.set('skip', String(skip));
    params.set('sort', 'report_date:asc');
    if (options.apiKey) params.set('api_key', options.apiKey);

    if (requests > 0 && (options.pageDelayMs ?? 0) > 0) await sleep(options.pageDelayMs!);
    const response = await fetchImpl(`${API_URL}?${params}`);
    requests += 1;
    if (response.status === 404) break; // openFDA's "no results" answer
    if (!response.ok) {
      throw new Error(`openFDA enforcement fetch failed: HTTP ${response.status}`);
    }
    const body = (await response.json()) as {
      meta?: { last_updated?: string; results?: { total?: number } };
      results?: OpenFdaEnforcementRaw[];
    };
    sourceLastUpdated = body.meta?.last_updated ?? sourceLastUpdated;
    const page = body.results ?? [];
    records.push(...page);
    const total = body.meta?.results?.total ?? 0;
    if (records.length >= total || page.length < PAGE_LIMIT) break;
  }

  return {
    records,
    sourceLastUpdated,
    fetchedAt: new Date().toISOString(),
    requests,
  };
}

/** The official bulk export: manifest lookup, then one zip download. */
export async function fetchEnforcementBulkUrl(
  fetchImpl: typeof fetch = fetch,
): Promise<{ url: string; exportDate: string; totalRecords: number }> {
  const response = await fetchImpl('https://api.fda.gov/download.json');
  if (!response.ok) throw new Error(`openFDA download manifest failed: HTTP ${response.status}`);
  const manifest = (await response.json()) as {
    results: {
      food: {
        enforcement: {
          export_date: string;
          total_records: number;
          partitions: { file: string }[];
        };
      };
    };
  };
  const enforcement = manifest.results.food.enforcement;
  if (enforcement.partitions.length !== 1) {
    // The food enforcement export has always been one partition; more would
    // mean the download shape changed and needs a human look.
    throw new Error(`expected 1 food-enforcement partition, got ${enforcement.partitions.length}`);
  }
  return {
    url: enforcement.partitions[0].file,
    exportDate: enforcement.export_date,
    totalRecords: enforcement.total_records,
  };
}
