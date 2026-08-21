/**
 * Mobile read path for the recall feed.
 *
 * Read-only queries against the Supabase Data API (PostgREST) using plain
 * `fetch` and client-safe configuration (EXPO_PUBLIC_* values only). Row Level
 * Security on the backend exposes exactly two readable tables to this key:
 * recall_cases and affected_products. There is no write path from the app.
 */

import type { AffectedProduct, CaseProjection, TimelineEntry } from '@/domain/recall-types';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export function isFeedConfigured(): boolean {
  return Boolean(supabaseUrl && publishableKey);
}

export interface FeedItem {
  id: string;
  noticeType: 'recall' | 'public_health_alert';
  state: 'active' | 'closed' | 'retracted';
  title: string;
  classificationValue: string;
  hazardCategory: string;
  publishedAt: string;
  lastPublicActivityAt: string;
  reasonText: string | null;
  pathogenOrAllergen: string | null;
  firmName: string | null;
  geography: CaseProjection['geography'];
  officialUrl: string;
}

export interface CaseDetail {
  id: string;
  projection: CaseProjection;
  timeline: TimelineEntry[];
  affectedProducts: AffectedProduct[];
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
  notice_type: FeedItem['noticeType'];
  state: FeedItem['state'];
  title: string;
  classification_value: string;
  hazard_category: string;
  published_at: string;
  last_public_activity_at: string;
  reason_text: string | null;
  pathogen_or_allergen: string | null;
  firm_name: string | null;
  geography: CaseProjection['geography'];
  official_url: string;
}

const FEED_SELECT = [
  'id',
  'notice_type',
  'state',
  'title',
  'classification_value',
  'hazard_category',
  'published_at',
  'last_public_activity_at',
  'reason_text:projection->>reasonText',
  'pathogen_or_allergen:projection->>pathogenOrAllergen',
  'firm_name:projection->recallingFirm->>displayName',
  'geography:projection->geography',
  'official_url:projection->>officialUrl',
].join(',');

/**
 * Current items, most recent public activity first (architecture Part 2.3:
 * "current" = active; ordering by source-published activity, not fetch time).
 */
export async function fetchCurrentFeed(limit = 100): Promise<FeedItem[]> {
  const rows = await restGet<FeedRow[]>(
    `recall_cases?select=${FEED_SELECT}` +
      `&state=eq.active` +
      `&order=last_public_activity_at.desc,published_at.desc` +
      `&limit=${limit}`,
  );
  return rows.map((row) => ({
    id: row.id,
    noticeType: row.notice_type,
    state: row.state,
    title: row.title,
    classificationValue: row.classification_value,
    hazardCategory: row.hazard_category,
    publishedAt: row.published_at,
    lastPublicActivityAt: row.last_public_activity_at,
    reasonText: row.reason_text,
    pathogenOrAllergen: row.pathogen_or_allergen,
    firmName: row.firm_name,
    geography: row.geography,
    officialUrl: row.official_url,
  }));
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
  };
}
