/**
 * Mobile read path for the recall feed.
 *
 * Read-only queries against the Supabase Data API (PostgREST) using plain
 * `fetch` and client-safe configuration (EXPO_PUBLIC_* values only). Row Level
 * Security on the backend exposes exactly two readable tables to this key:
 * recall_cases and affected_products. There is no write path from the app.
 */

import type { FoodCategoryId } from '@/domain/food-category';
// The LEAF reader, not `domain/projection`'s: that module hosts the derivation
// too, so importing it here put the whole classifier — matcher, lexicon,
// non-food terms — plus projectCase and deriveGeography into the shipped iOS
// and web bundles (measured with `expo export`). The two readers are pinned
// equivalent by product-categories-stored.test.ts.
import { readStoredProductCategories } from '@/domain/product-categories-stored';
import type {
  AffectedProduct,
  CaseProjection,
  Classification,
  TimelineEntry,
} from '@/domain/recall-types';
import { loadAllPages, type LoadAllPagesOptions } from './feed-pagination';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export function isFeedConfigured(): boolean {
  return Boolean(supabaseUrl && publishableKey);
}

export interface FeedItem {
  id: string;
  sourceAgency: 'FDA' | 'FSIS';
  noticeType: 'recall' | 'public_health_alert';
  state: 'active' | 'closed' | 'retracted';
  title: string;
  /**
   * The whole authoritative classification, not just its scalar: a case may
   * carry several official classes, and the card's risk tier is derived from
   * the SET. Selecting `classification_value` alone would have made a mixed
   * case indistinguishable from a uniform one on the card.
   */
  classification: Classification;
  hazardCategory: string;
  publishedAt: string;
  lastPublicActivityAt: string;
  reasonText: string | null;
  pathogenOrAllergen: string | null;
  firmName: string | null;
  /** Source-structured brands (FDA); empty for FSIS/older rows. */
  brands: string[];
  /** Source-structured product description (FDA); null for FSIS/older rows. */
  productDescription: string | null;
  /** Source-stated retailers ("Sold at") — future store-preference signal. */
  retailerNames: string[];
  /** Lead product photo for card recognition; null when none is available. */
  heroImageUrl: string | null;
  /**
   * Affected product lines (`affected_products.name`, ordinal order) — the
   * searchable product/variant text, which also carries source-stated UPC,
   * lot/batch and case codes for identifier search (C6). Measured live:
   * 3,607 lines across the 882 active cases, ~376 KB over the whole load —
   * accepted so a code printed on a package can find its recall from Home.
   * Empty for the ~490 cases whose notices name no per-product lines.
   */
  productNames: string[];
  geography: CaseProjection['geography'];
  officialUrl: string;
  /**
   * The case timeline, carried on the card row because "Affects me" ranks and
   * tiers by MATERIAL activity (domain/material-activity.ts) and the material
   * verdict lives per entry. Measured live: ~257 bytes per active case, so a
   * 500-row feed grows by ~130 KB — the only alternative would be a persisted
   * derived date, i.e. a second truth able to drift from the timeline.
   */
  timeline: TimelineEntry[];
  /**
   * Derived product categories (C10B) — a small array of canonical ids and
   * nothing else. No announcement text, no classifier input, no confidence,
   * no fixture: the app receives the ANSWER, never the evidence, and the
   * classifier itself never ships (proved by the bundle scan).
   *
   * OPTIONAL, and the optionality is load-bearing: `undefined` means "this
   * case carries no derived categories", which is NOT the same as `['other']`
   * ("derived, and the source never named the product"). An un-enriched row
   * is therefore never swept into a chip — it is simply not placed by an
   * active Category selection, and is never hidden from the unfiltered feed.
   * `readProductCategories` collapses a stored empty list to the same
   * `undefined`, so `[]` can never reach a consumer surface.
   */
  productCategories?: FoodCategoryId[];
}

/** A hosted visual rendered from an official source document (FSIS labels). */
export interface CaseVisual {
  url: string;
  role: string;
  page: number;
  width: number | null;
  height: number | null;
  /** The official document this image was rendered from. */
  sourceUrl: string;
}

export interface CaseDetail {
  id: string;
  projection: CaseProjection;
  timeline: TimelineEntry[];
  affectedProducts: AffectedProduct[];
  /** Rendered official-document visuals; [] until the backend generates them. */
  visuals: CaseVisual[];
}

async function restGet<T>(pathAndQuery: string): Promise<T> {
  if (!supabaseUrl || !publishableKey) {
    throw new Error('Recall feed backend is not configured.');
  }
  const response = await fetch(`${supabaseUrl}/rest/v1/${pathAndQuery}`, {
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${publishableKey}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Recall feed request failed (HTTP ${response.status}).`);
  }
  return (await response.json()) as T;
}

interface FeedRow {
  id: string;
  source_agency: FeedItem['sourceAgency'];
  notice_type: FeedItem['noticeType'];
  state: FeedItem['state'];
  title: string;
  classification: Classification;
  hazard_category: string;
  published_at: string;
  last_public_activity_at: string;
  reason_text: string | null;
  pathogen_or_allergen: string | null;
  firm_name: string | null;
  brands: string[] | null;
  product_description: string | null;
  retailer_names: string[] | null;
  hero_image_url: string | null;
  product_names: { name: string }[] | null;
  geography: CaseProjection['geography'];
  official_url: string;
  timeline: TimelineEntry[] | null;
  /**
   * Raw JSON straight off the projection column. Typed `unknown` on purpose:
   * nothing in Postgres constrains the shape of a jsonb key, so this is
   * normalized by the canonical reader and is never trusted as-is.
   */
  product_categories: unknown;
}

const FEED_SELECT = [
  'id',
  'source_agency',
  'notice_type',
  'state',
  'title',
  'classification:projection->classification',
  'hazard_category',
  'published_at',
  'last_public_activity_at',
  'reason_text:projection->>reasonText',
  'pathogen_or_allergen:projection->>pathogenOrAllergen',
  'firm_name:projection->recallingFirm->>displayName',
  'brands:projection->brands',
  'product_description:projection->>productDescription',
  'retailer_names:projection->retailerNames',
  'hero_image_url:projection->>heroImageUrl',
  // Embedded relation (same anon-readable table the detail screen loads).
  'product_names:affected_products(name)',
  'geography:projection->geography',
  'official_url:projection->>officialUrl',
  'timeline',
  // C10B: the derived category ids only — a JSON array of at most four short
  // strings per case. Never the announcement text, the classifier's inputs, a
  // confidence, or a fixture. Egress measured over the complete active feed
  // with `npm run qa:egress`; see docs/recall-feed-usability.md.
  'product_categories:projection->productCategories',
].join(',');

function toFeedItem(row: FeedRow): FeedItem {
  // The canonical stored-value reader, never a second parse here: it drops
  // unknown ids, collapses duplicates, removes `other` where a real category
  // survives, sorts into display order, caps the list, and returns null both
  // for an absent key and for a list with nothing valid left. `?? undefined`
  // then keeps "no derived categories" a single representation, so the filter
  // never has to distinguish null from undefined from [] — and, critically,
  // never confuses any of them with `['other']`.
  const productCategories = readStoredProductCategories(row.product_categories) ?? undefined;
  return {
    id: row.id,
    sourceAgency: row.source_agency,
    noticeType: row.notice_type,
    state: row.state,
    title: row.title,
    classification: row.classification,
    hazardCategory: row.hazard_category,
    publishedAt: row.published_at,
    lastPublicActivityAt: row.last_public_activity_at,
    reasonText: row.reason_text,
    pathogenOrAllergen: row.pathogen_or_allergen,
    firmName: row.firm_name,
    // Older persisted projections predate these fields; absent means unknown.
    brands: row.brands ?? [],
    productDescription: row.product_description ?? null,
    retailerNames: row.retailer_names ?? [],
    heroImageUrl: row.hero_image_url ?? null,
    productNames: (row.product_names ?? []).map((product) => product.name),
    geography: row.geography,
    officialUrl: row.official_url,
    timeline: row.timeline ?? [],
    productCategories,
  };
}

/**
 * One page of active cases after `cursor`, ordered by the immutable primary
 * key. Exported for the completeness QA script, which drives the real loader
 * rather than reimplementing the query.
 */
export function fetchFeedPage(cursor: string | null, pageSize: number): Promise<FeedItem[]> {
  const after = cursor ? `&id=gt.${encodeURIComponent(cursor)}` : '';
  return restGet<FeedRow[]>(
    `recall_cases?select=${FEED_SELECT}` +
      `&state=eq.active${after}` +
      `&order=id.asc` +
      `&affected_products.order=ordinal.asc` +
      `&limit=${pageSize}`,
  ).then((rows) => rows.map(toFeedItem));
}

/**
 * THE canonical Home feed loader: every active case, or an error.
 *
 * "Current" = `state = active` (architecture Part 2.3). Completeness is the
 * contract — All Recalls, "affects me" eligibility and ranking, the recent /
 * older split, and every section count are all computed client-side over this
 * one set, so a short read would corrupt all of them at once and none of them
 * visibly. It therefore either returns the whole corpus or throws; see
 * lib/feed-pagination.ts for why the cursor is the case id and why the page
 * size is not a ceiling.
 *
 * Rows come back in cursor (id) order. Display order belongs to the section
 * builders — `buildFeedSections` for All Recalls, `buildAffectsMeSections` for
 * the personalized tab — each of which imposes its own total order.
 */
export function fetchCurrentFeed(options?: LoadAllPagesOptions): Promise<FeedItem[]> {
  return loadAllPages(fetchFeedPage, options);
}

/**
 * One manifest row per consumer-visible active case (C8): the case id plus an
 * opaque version token computed server-side over the exact client-visible
 * representation (see supabase/migrations/20260904000000_consumer_feed_manifest.sql).
 * Tokens are compared for equality only — the client never derives them.
 */
export interface FeedManifestEntry {
  id: string;
  version: string;
}

/**
 * Manifest rows are ~100 bytes each, so a single request comfortably covers
 * corpora several times today's size while staying under the measured
 * 1000-row PostgREST ceiling. Like the feed itself, the manifest is paged by
 * immutable id cursor and is complete-or-throw.
 */
export const MANIFEST_PAGE_SIZE = 1000;

export function fetchManifestPage(
  cursor: string | null,
  pageSize: number,
): Promise<FeedManifestEntry[]> {
  const after = cursor ? `&id=gt.${encodeURIComponent(cursor)}` : '';
  return restGet<FeedManifestEntry[]>(
    `consumer_feed_manifest?select=id,version${after}&order=id.asc&limit=${pageSize}`,
  );
}

/** The complete manifest, or a throw — never a silently short list. */
export function fetchCurrentManifest(): Promise<FeedManifestEntry[]> {
  return loadAllPages(fetchManifestPage, { pageSize: MANIFEST_PAGE_SIZE });
}

/**
 * How many case ids one changed-row request carries. 60 uuids keep the URL
 * around 3 KB — far below request-line limits — while a typical incremental
 * sync (a handful of changed cases) still needs exactly one request.
 */
export const FEED_IDS_CHUNK_SIZE = 60;

/**
 * The full feed rows for specific case ids — the incremental half of the C8
 * sync. Same SELECT, same `state=eq.active` contract, same RLS as the paged
 * loader, so a row this returns is byte-identical to the one a cold load
 * would have produced. An id that comes back missing is authoritatively no
 * longer consumer-visible (closed, retracted, or merged) — the sync engine
 * removes it; this function never throws for missing rows, only for failed
 * requests.
 */
export async function fetchFeedItemsByIds(ids: string[]): Promise<FeedItem[]> {
  const items: FeedItem[] = [];
  for (let from = 0; from < ids.length; from += FEED_IDS_CHUNK_SIZE) {
    const chunk = ids.slice(from, from + FEED_IDS_CHUNK_SIZE);
    const rows = await restGet<FeedRow[]>(
      `recall_cases?select=${FEED_SELECT}` +
        `&state=eq.active` +
        `&id=in.(${chunk.map((id) => encodeURIComponent(id)).join(',')})` +
        `&order=id.asc` +
        `&affected_products.order=ordinal.asc`,
    );
    items.push(...rows.map(toFeedItem));
  }
  return items;
}

interface DetailRow {
  id: string;
  projection: CaseProjection;
  timeline: TimelineEntry[];
  affected_products: {
    ordinal: number;
    source_native_id: string;
    name: string;
    raw_text: string;
    extraction_confidence: AffectedProduct['extractionConfidence'];
  }[];
}

interface VisualRow {
  url: string;
  role: string;
  page: number;
  width: number | null;
  height: number | null;
  source_url: string;
}

/**
 * Rendered official-document visuals for a case. A separate, fault-tolerant
 * request: the table arrives with the FSIS label pipeline's migration, and a
 * backend that does not have it yet must degrade to "no visuals", never break
 * the detail screen.
 */
async function fetchCaseVisuals(id: string): Promise<CaseVisual[]> {
  try {
    const rows = await restGet<VisualRow[]>(
      `product_visuals?select=url,role,page,width,height,source_url` +
        `&recall_case_id=eq.${encodeURIComponent(id)}&order=page.asc`,
    );
    return rows.map((row) => ({
      url: row.url,
      role: row.role,
      page: row.page,
      width: row.width,
      height: row.height,
      sourceUrl: row.source_url,
    }));
  } catch {
    return [];
  }
}

export async function fetchCaseDetail(id: string): Promise<CaseDetail | null> {
  const rows = await restGet<DetailRow[]>(
    `recall_cases?select=id,projection,timeline,affected_products(*)` +
      `&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id,
    projection: row.projection,
    timeline: row.timeline,
    affectedProducts: [...row.affected_products]
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((p) => ({
        sourceNativeId: p.source_native_id,
        name: p.name,
        rawText: p.raw_text,
        extractionConfidence: p.extraction_confidence,
      })),
    visuals: await fetchCaseVisuals(id),
  };
}
