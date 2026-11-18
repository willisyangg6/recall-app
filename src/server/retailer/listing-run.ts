/**
 * Store listings, end to end: fetch a retailer's list, decide each entry
 * against Lotly's agency source URLs, and plan the private writes
 * (`retailer_store_listings` only). Two phases, as the notice monitor: a plan
 * that writes nothing, then an apply that writes exactly the plan.
 *
 * A reviewer's confirmation survives every later run: a listing a person
 * linked stays linked while its agency links are unchanged.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { RETAILER_USER_AGENT } from './costco-monitor';
import {
  decideListing,
  LISTING_SOURCES,
  normalizeUrl,
  parsePublixListings,
  parseTargetArticle,
  parseTargetIndex,
  parseWalmartListings,
  parseWholeFoodsListings,
  type ListingDecision,
  type ListingEntry,
  type ListingPublisher,
  type ListingReason,
  type StoreFact,
} from './store-listings';

export interface ListingRow {
  publisher: ListingPublisher;
  nativeId: string;
  indexUrl: string;
  listingUrl: string;
  title: string;
  listedOn: string | null;
  agencyUrls: string[];
  soldAtText: string | null;
  stores: StoreFact[];
  decision: ListingDecision;
  decisionReasons: ListingReason[];
  caseId: string | null;
  matchMethod: 'agency_url' | 'reviewer' | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  parserVersion: string;
}

export interface ListingStore {
  /** Normalized agency source URL → the case ids that carry it. */
  casesByUrl(): Promise<Map<string, string[]>>;
  listListings(publisher: ListingPublisher): Promise<Map<string, ListingRow>>;
  caseExists(caseId: string): Promise<boolean>;
  upsertListing(row: ListingRow): Promise<void>;
}

export interface ListingFetcher {
  fetchHtml(url: string): Promise<string>;
}

const TIMEOUT_MS = 30_000;
const MAX_BYTES = 8 * 1024 * 1024;

export function liveListingFetcher(
  publisher: ListingPublisher,
  fetchImpl: typeof fetch = fetch,
): ListingFetcher {
  const hosts = LISTING_SOURCES[publisher].hosts;
  return {
    async fetchHtml(url) {
      if (!hosts.includes(new URL(url).hostname))
        throw new Error(`${url} is not a ${publisher} page`);
      const response = await fetchImpl(url, {
        headers: { 'User-Agent': RETAILER_USER_AGENT, Accept: 'text/html' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const host = new URL(response.url || url).hostname;
      if (!hosts.includes(host)) throw new Error(`redirected off-site to ${host}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (text.length > MAX_BYTES) throw new Error(`page is ${text.length} bytes`);
      return text;
    },
  };
}

/** Every entry on the retailer's list, read with the verified parser. */
export async function readListings(
  publisher: ListingPublisher,
  fetcher: ListingFetcher,
): Promise<{ entries: ListingEntry[]; failures: { url: string; error: string }[] }> {
  const index = await fetcher.fetchHtml(LISTING_SOURCES[publisher].indexUrl);
  if (publisher === 'walmart') return { entries: parseWalmartListings(index), failures: [] };
  if (publisher === 'wholefoods') return { entries: parseWholeFoodsListings(index), failures: [] };
  if (publisher === 'publix') return { entries: parsePublixListings(index), failures: [] };
  const entries: ListingEntry[] = [];
  const failures: { url: string; error: string }[] = [];
  for (const ref of parseTargetIndex(index)) {
    try {
      entries.push(parseTargetArticle(await fetcher.fetchHtml(ref.url), ref));
    } catch (error) {
      failures.push({
        url: ref.url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { entries, failures };
}

export interface ListingPlan {
  publisher: ListingPublisher;
  fetchedAt: string;
  entries: number;
  failures: { url: string; error: string }[];
  planned: { row: ListingRow; change: 'insert' | 'update' | 'touch' }[];
  plannedWrites: number;
}

function contentKey(row: ListingRow): string {
  const { firstSeenAt: _f, lastSeenAt: _l, ...content } = row;
  return JSON.stringify(content);
}

export async function planListingRun(
  publisher: ListingPublisher,
  store: ListingStore,
  fetcher: ListingFetcher,
  now: () => Date,
): Promise<ListingPlan> {
  const fetchedAt = now().toISOString();
  const { entries, failures } = await readListings(publisher, fetcher);
  const [casesByUrl, existing] = await Promise.all([
    store.casesByUrl(),
    store.listListings(publisher),
  ]);
  const planned: ListingPlan['planned'] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.nativeId)) continue;
    seen.add(entry.nativeId);
    const stored = existing.get(entry.nativeId);
    const decided = decideListing(entry, casesByUrl);
    const keepReviewer =
      stored?.matchMethod === 'reviewer' &&
      JSON.stringify(stored.agencyUrls) === JSON.stringify(entry.agencyUrls) &&
      decided.decision !== 'linked';
    const row: ListingRow = {
      publisher,
      nativeId: entry.nativeId,
      indexUrl: LISTING_SOURCES[publisher].indexUrl,
      listingUrl: entry.listingUrl,
      title: entry.title,
      listedOn: entry.listedOn,
      agencyUrls: entry.agencyUrls,
      soldAtText: entry.soldAtText,
      stores: entry.stores,
      decision: keepReviewer ? stored.decision : decided.decision,
      decisionReasons: keepReviewer ? stored.decisionReasons : decided.reasons,
      caseId: keepReviewer ? stored.caseId : decided.caseId,
      matchMethod: keepReviewer ? 'reviewer' : decided.caseId ? 'agency_url' : null,
      confirmedBy: keepReviewer ? stored.confirmedBy : null,
      confirmedAt: keepReviewer ? stored.confirmedAt : null,
      firstSeenAt: stored?.firstSeenAt ?? fetchedAt,
      lastSeenAt: fetchedAt,
      parserVersion: LISTING_SOURCES[publisher].parserVersion,
    };
    const change = !stored ? 'insert' : contentKey(stored) === contentKey(row) ? 'touch' : 'update';
    planned.push({ row, change });
  }
  return {
    publisher,
    fetchedAt,
    entries: entries.length,
    failures,
    planned,
    plannedWrites: planned.length,
  };
}

export async function applyListingPlan(store: ListingStore, plan: ListingPlan): Promise<number> {
  for (const { row } of plan.planned) await store.upsertListing(row);
  return plan.planned.length;
}

/** A reviewer links one listing in review to the agency case it names. */
export async function planListingConfirmation(
  store: ListingStore,
  publisher: ListingPublisher,
  nativeId: string,
  caseId: string,
  confirmedBy: string,
  now: () => Date,
): Promise<{ row: ListingRow | null; problems: string[] }> {
  const stored = (await store.listListings(publisher)).get(nativeId);
  const problems: string[] = [];
  if (!stored) problems.push(`no ${publisher} listing has native id ${nativeId}`);
  else if (stored.decision !== 'review')
    problems.push(`the listing is ${stored.decision}, not in review`);
  else if (stored.decisionReasons.includes('sold_at_unparsed')) {
    problems.push('its sold-at line was not read completely; nothing could be shown');
  }
  if (!/^[0-9a-f-]{36}$/.test(caseId) || !(await store.caseExists(caseId))) {
    problems.push(`no agency case ${caseId}`);
  }
  if (!confirmedBy.trim()) problems.push('a reviewer name is required');
  if (problems.length > 0 || !stored) return { row: null, problems };
  return {
    row: {
      ...stored,
      decision: 'linked',
      decisionReasons: ['reviewer_confirmed'],
      caseId,
      matchMethod: 'reviewer',
      confirmedBy: confirmedBy.trim(),
      confirmedAt: now().toISOString(),
    },
    problems,
  };
}

// ── Stores ──────────────────────────────────────────────────────────────────

export class MemoryListingStore implements ListingStore {
  readonly rows = new Map<string, ListingRow>();
  constructor(
    private readonly urls: Map<string, string[]> = new Map(),
    private readonly cases: Set<string> = new Set(),
  ) {}
  async casesByUrl() {
    return this.urls;
  }
  async listListings(publisher: ListingPublisher) {
    const out = new Map<string, ListingRow>();
    for (const row of this.rows.values())
      if (row.publisher === publisher) out.set(row.nativeId, row);
    return out;
  }
  async caseExists(caseId: string) {
    return this.cases.has(caseId);
  }
  async upsertListing(row: ListingRow) {
    this.rows.set(`${row.publisher}:${row.nativeId}`, row);
  }
}

const PAGE = 1000;

export class SupabaseListingStore implements ListingStore {
  constructor(private readonly client: SupabaseClient) {}

  async casesByUrl(): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.client
        .from('source_records')
        .select('source_url, recall_case_id')
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`source_records read failed: ${error.message}`);
      const rows = (data ?? []) as { source_url: string; recall_case_id: string }[];
      for (const row of rows) {
        const key = normalizeUrl(row.source_url);
        const cases = out.get(key) ?? [];
        if (!cases.includes(row.recall_case_id)) cases.push(row.recall_case_id);
        out.set(key, cases);
      }
      if (rows.length < PAGE) return out;
    }
  }

  async listListings(publisher: ListingPublisher): Promise<Map<string, ListingRow>> {
    const { data, error } = await this.client
      .from('retailer_store_listings')
      .select('*')
      .eq('publisher', publisher);
    if (error) throw new Error(`retailer_store_listings read failed: ${error.message}`);
    const out = new Map<string, ListingRow>();
    for (const db of (data ?? []) as Record<string, unknown>[]) {
      out.set(db.native_id as string, {
        publisher: db.publisher as ListingPublisher,
        nativeId: db.native_id as string,
        indexUrl: db.index_url as string,
        listingUrl: db.listing_url as string,
        title: db.title as string,
        listedOn: (db.listed_on as string | null) ?? null,
        agencyUrls: db.agency_urls as string[],
        soldAtText: (db.sold_at_text as string | null) ?? null,
        stores: db.stores as StoreFact[],
        decision: db.decision as ListingDecision,
        decisionReasons: db.decision_reasons as ListingReason[],
        caseId: (db.case_id as string | null) ?? null,
        matchMethod: (db.match_method as ListingRow['matchMethod']) ?? null,
        confirmedBy: (db.confirmed_by as string | null) ?? null,
        confirmedAt: (db.confirmed_at as string | null) ?? null,
        firstSeenAt: db.first_seen_at as string,
        lastSeenAt: db.last_seen_at as string,
        parserVersion: db.parser_version as string,
      });
    }
    return out;
  }

  async caseExists(caseId: string): Promise<boolean> {
    const { data, error } = await this.client.from('recall_cases').select('id').eq('id', caseId);
    if (error) throw new Error(`recall_cases read failed: ${error.message}`);
    return (data ?? []).length === 1;
  }

  async upsertListing(row: ListingRow): Promise<void> {
    const { error } = await this.client.from('retailer_store_listings').upsert(
      {
        publisher: row.publisher,
        native_id: row.nativeId,
        index_url: row.indexUrl,
        listing_url: row.listingUrl,
        title: row.title,
        listed_on: row.listedOn,
        agency_urls: row.agencyUrls,
        sold_at_text: row.soldAtText,
        stores: row.stores,
        decision: row.decision,
        decision_reasons: row.decisionReasons,
        case_id: row.caseId,
        match_method: row.matchMethod,
        confirmed_by: row.confirmedBy,
        confirmed_at: row.confirmedAt,
        first_seen_at: row.firstSeenAt,
        last_seen_at: row.lastSeenAt,
        parser_version: row.parserVersion,
      },
      { onConflict: 'publisher,native_id' },
    );
    if (error) throw new Error(`retailer_store_listings upsert failed: ${error.message}`);
  }
}
