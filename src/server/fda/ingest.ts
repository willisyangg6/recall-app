/**
 * FDA announcement ingest orchestration (Milestone 2, discovery only):
 *
 *   listing JSON (primary discovery) ─┐
 *   food RSS (independent cross-check)─┤→ merge by announcement identity
 *                                      → fetch detail pages for new/changed
 *                                      → normalize → shared pipeline
 *
 * The listing JSON is the primary source identity; RSS corroborates it and
 * contributes discoveries only when the listing is missing an item (which is
 * itself an operational warning — the listing backend is undocumented and
 * assumed to break silently one day). One announcement seen through both
 * channels is one source record and one consumer case.
 *
 * Detail pages are fetched only for records that are new, changed, pending
 * (an interrupted apply awaiting retry), or applied_degraded (a record still
 * owed its detail page), so steady-state runs perform a handful of page
 * fetches, not hundreds.
 *
 * Detail completeness (O3-B1): a listing-backed record's contract includes
 * its detail page. When the fetch fails for an EXISTING record's changed
 * version, the item is DEFERRED whole — nothing archived, nothing applied,
 * the previous complete version stays authoritative, and the next run
 * retries even if the listing is unchanged (the job withholds the feed gate
 * on any deferral). A NEW listing-backed record still founds its case from
 * listing evidence (coverage invariant) but as `applied_degraded`, and every
 * later run retries its detail page until it lands. RSS-only records cannot
 * be normalized without the page and quarantine exactly as before.
 */

import type { NormalizedSourceRecord } from '../../domain/source-record';
import { isExpansionOfSameEvent, isRevisionOfSameEvent, isSameRecallEvent } from '../duplicates';
import {
  contentHash,
  runSourceIngest,
  type IngestOptions,
  type IngestSummary,
  type ParsedSourceItem,
  type SourceIngestInput,
} from '../pipeline';
import type { RecallStore } from '../store/types';
import type { FdaRssItem } from './fetch';
import {
  announcementIdentity,
  FdaParseError,
  foodScope,
  isFdaListingItem,
  parseFdaAnnouncement,
  parseFdaDetail,
  type FdaListingItem,
} from './parse';

export interface FdaIngestInput {
  listing: { items: unknown[]; fetchedAt: string };
  /** null when the RSS fetch failed — reported, never fatal. */
  rss: { items: FdaRssItem[] } | null;
  /** Fetches one announcement detail page → its <main> content region. */
  fetchDetail: (url: string) => Promise<string>;
  /** Politeness delay between detail-page fetches. */
  detailDelayMs?: number;
}

export interface FdaCrossCheck {
  itemsInListing: number;
  invalidListingItems: number;
  foodItems: number;
  excludedAnimal: number;
  excludedNonfood: number;
  rssItems: number;
  /** RSS announcements the primary listing did not contain. */
  rssOnlyIds: string[];
  detailPagesFetched: number;
  detailFetchFailures: { nativeId: string; reason: string }[];
  /**
   * Existing records whose changed version was deferred whole because its
   * required detail page failed to fetch (O3-B1) — retried next run.
   */
  deferredIds: string[];
  /** New records founded from listing evidence alone (applied_degraded). */
  degradedIds: string[];
  newestListingDate: string | null;
  newestRssDate: string | null;
  /** Operational warnings (stale primary, shape drift, RSS-only items…). */
  warnings: string[];
}

export interface FdaIngestResult {
  summary: IngestSummary;
  crossCheck: FdaCrossCheck;
}

interface Discovery {
  nativeId: string;
  path: string;
  listing: FdaListingItem | null;
  rssTitle: string | null;
  /** Hashed for change detection (listing item, or the RSS identity fields). */
  contentKey: unknown;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function changedStamp(item: FdaListingItem): string {
  return item.changed?.match(/datetime="([^"]+)"/)?.[1] ?? '';
}

/**
 * Change-detection key for a listing row. The row's `changed` timestamp
 * jitters by a few seconds between CDN generations of the listing JSON
 * (verified live: 20:38:50 vs 20:38:52 on a 2024 node), so raw-row hashing
 * would refetch every detail page on most runs. Truncating `changed` to
 * minute precision keeps real edits detectable while ignoring the jitter.
 */
export function listingContentKey(item: FdaListingItem): Record<string, unknown> {
  return { ...item, changed: changedStamp(item).slice(0, 16) };
}

function listingDateIso(item: FdaListingItem): string {
  const m = (item.field_change_date_2 ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : '';
}

function rssDateIso(pubDate: string | null): string | null {
  if (!pubDate) return null;
  const time = Date.parse(pubDate);
  return Number.isNaN(time) ? null : new Date(time).toISOString().slice(0, 10);
}

export async function runFdaIngest(
  store: RecallStore,
  input: FdaIngestInput,
  options: IngestOptions = {},
): Promise<FdaIngestResult> {
  const crossCheck: FdaCrossCheck = {
    itemsInListing: input.listing.items.length,
    invalidListingItems: 0,
    foodItems: 0,
    excludedAnimal: 0,
    excludedNonfood: 0,
    rssItems: input.rss?.items.length ?? 0,
    rssOnlyIds: [],
    detailPagesFetched: 0,
    detailFetchFailures: [],
    deferredIds: [],
    degradedIds: [],
    newestListingDate: null,
    newestRssDate: null,
    warnings: [],
  };
  const quarantined: SourceIngestInput['quarantined'] = [];

  // ── Discovery: listing (primary), food-scoped, merged by identity ──────────
  const discoveries = new Map<string, Discovery>();
  for (const raw of input.listing.items) {
    if (!isFdaListingItem(raw)) {
      crossCheck.invalidListingItems += 1;
      continue;
    }
    const scope = foodScope(raw);
    if (scope === 'excluded_animal') {
      crossCheck.excludedAnimal += 1;
      continue;
    }
    if (scope === 'excluded_nonfood') {
      crossCheck.excludedNonfood += 1;
      continue;
    }
    crossCheck.foodItems += 1;
    const date = listingDateIso(raw);
    if (date > (crossCheck.newestListingDate ?? '')) crossCheck.newestListingDate = date;

    const { nativeId } = announcementIdentity(raw.path);
    const existing = discoveries.get(nativeId);
    // An update re-publish can coexist with its original row (verified live:
    // "update-…" + original Albertsons rows). One identity, newest edit wins.
    if (!existing || changedStamp(raw) > changedStamp(existing.listing as FdaListingItem)) {
      discoveries.set(nativeId, {
        nativeId,
        path: raw.path,
        listing: raw,
        rssTitle: null,
        contentKey: listingContentKey(raw),
      });
    }
  }

  if (crossCheck.invalidListingItems > 0) {
    crossCheck.warnings.push(
      `${crossCheck.invalidListingItems} listing item(s) had an unexpected shape — the undocumented listing backend may be drifting.`,
    );
  }

  // ── RSS cross-check (independent channel; contributes missing items) ───────
  if (input.rss === null) {
    crossCheck.warnings.push('FDA food RSS was unavailable — cross-check skipped this run.');
  } else {
    for (const item of input.rss.items) {
      const path = item.link.replace(/^https?:\/\/www\.fda\.gov/, '');
      if (!path.startsWith('/safety/recalls-market-withdrawals-safety-alerts/')) continue;
      const { nativeId } = announcementIdentity(path);
      const date = rssDateIso(item.pubDate);
      if (date && date > (crossCheck.newestRssDate ?? '')) crossCheck.newestRssDate = date;
      if (discoveries.has(nativeId)) continue;
      crossCheck.rssOnlyIds.push(nativeId);
      discoveries.set(nativeId, {
        nativeId,
        path,
        listing: null,
        rssTitle: item.title,
        contentKey: { link: item.link, title: item.title, pubDate: item.pubDate },
      });
    }
    if (crossCheck.rssOnlyIds.length > 0) {
      crossCheck.warnings.push(
        `${crossCheck.rssOnlyIds.length} RSS announcement(s) were missing from the primary listing (${crossCheck.rssOnlyIds.join(', ')}) — ingested from their official pages; check the listing backend.`,
      );
    }
    if (
      crossCheck.newestRssDate &&
      crossCheck.newestListingDate &&
      crossCheck.newestRssDate > crossCheck.newestListingDate
    ) {
      crossCheck.warnings.push(
        `RSS is fresher than the primary listing (RSS ${crossCheck.newestRssDate} vs listing ${crossCheck.newestListingDate}) — the listing backend may be stale.`,
      );
    }
  }

  // ── Fetch detail pages for new/changed/pending/degraded records ────────────
  const items: ParsedSourceItem[] = [];
  let fetchedAny = false;
  for (const discovery of discoveries.values()) {
    // The same gate the pipeline applies (gate slice + latest snapshot meta):
    // skip the detail fetch ONLY when the version is unchanged AND either
    // fully applied or legacy_unverified. Pending and applied_degraded
    // records refetch even with an unchanged hash — that retry is exactly
    // what the O3 contract exists to guarantee.
    const gate = await store.getSourceRecordGateByNativeId('fda_announcement', discovery.nativeId);
    const hash = contentHash(discovery.contentKey);
    const meta = gate ? await store.getLatestSnapshotMeta(gate.id) : null;
    const sameAsLatest = meta !== null && meta.contentHash === hash;
    const fullyApplied =
      gate !== null &&
      sameAsLatest &&
      gate.applyState === 'applied' &&
      gate.appliedSnapshotSeq === meta?.seq &&
      gate.appliedContentHash === hash;
    const unchanged = gate !== null && sameAsLatest && (gate.applyState == null || fullyApplied);

    let detailMainHtml: string | null = null;
    let detailFailed = false;
    if (!unchanged) {
      const url = `https://www.fda.gov${discovery.path}`;
      try {
        if (fetchedAny && (input.detailDelayMs ?? 0) > 0) await sleep(input.detailDelayMs!);
        detailMainHtml = await input.fetchDetail(url);
        fetchedAny = true;
        crossCheck.detailPagesFetched += 1;
      } catch (error) {
        detailFailed = true;
        crossCheck.detailFetchFailures.push({
          nativeId: discovery.nativeId,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // An EXISTING record's version needing its detail page: defer the whole
    // item — the previous complete version stays authoritative, nothing is
    // archived or applied, and the next run retries the fetch (the job
    // withholds the feed gate whenever anything was deferred). New
    // listing-backed records instead found degraded below (coverage
    // invariant); RSS-only records quarantine in the parse step.
    if (detailFailed && gate !== null) {
      crossCheck.deferredIds.push(discovery.nativeId);
      continue;
    }
    if (detailFailed && discovery.listing !== null) {
      crossCheck.degradedIds.push(discovery.nativeId);
    }

    // RSS-only discoveries bypass the listing's category tags; scope them by
    // the detail page's own Product Type field instead.
    if (discovery.listing === null && detailMainHtml !== null) {
      const productType = parseFdaDetail(detailMainHtml).productType ?? '';
      if (!/Food & Beverages/i.test(productType) || /Animal & Veterinary/i.test(productType)) {
        crossCheck.warnings.push(
          `RSS-only item ${discovery.nativeId} is outside the food scope (Product Type: ${productType || 'unknown'}) — skipped.`,
        );
        continue;
      }
    }

    let normalized: NormalizedSourceRecord;
    try {
      normalized = parseFdaAnnouncement({
        listing: discovery.listing,
        detailMainHtml,
        path: discovery.path,
        rssTitle: discovery.rssTitle,
      });
    } catch (error) {
      quarantined.push({
        rawNativeId: discovery.path,
        reason: error instanceof FdaParseError ? error.message : String(error),
      });
      continue;
    }

    items.push({
      raw: {
        listing: discovery.listing,
        detailMainHtml,
        path: discovery.path,
        rssTitle: discovery.rssTitle,
      },
      normalized,
      contentKey: discovery.contentKey,
      completeness: detailFailed ? 'degraded' : 'complete',
    });
  }

  if (crossCheck.detailFetchFailures.length > 3) {
    crossCheck.warnings.push(
      `${crossCheck.detailFetchFailures.length} detail-page fetches failed — fda.gov may be blocking or the page shape may have changed.`,
    );
  }

  const summary = await runSourceIngest(
    store,
    {
      sourceSystem: 'fda_announcement',
      items,
      quarantined,
      deferred: crossCheck.deferredIds.length,
      itemsSeen: input.listing.items.length,
      fetchedAt: input.listing.fetchedAt,
    },
    // Slug-collision parents ("…-health-risk-0"), declared expansions
    // ("…Expands Recall of…"), and declared revisions ("…updated their press
    // release to…") must corroborate before one consumer case absorbs both
    // announcements.
    {
      expansionGuard: isSameRecallEvent,
      expansionReferenceGuard: (child, parent) =>
        isExpansionOfSameEvent(child, parent) || isRevisionOfSameEvent(child, parent),
      ...options,
    },
  );

  if (quarantined.length > Math.max(3, items.length * 0.1)) {
    crossCheck.warnings.push(
      `${quarantined.length} record(s) failed to parse — FDA source shape may have changed materially.`,
    );
  }

  return { summary, crossCheck };
}
