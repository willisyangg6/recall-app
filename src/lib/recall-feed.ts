/**
 * Mobile read path for the recall feed.
 *
 * Read-only queries against the Supabase Data API (PostgREST) using plain
 * `fetch` and client-safe configuration (EXPO_PUBLIC_* values only). Row Level
 * Security on the backend exposes exactly two readable tables to this key:
 * recall_cases and affected_products. There is no write path from the app.
 */

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
].join(',');

function toFeedItem(row: FeedRow): FeedItem {
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
