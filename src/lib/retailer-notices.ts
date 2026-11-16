/**
 * The new client's read path for approved retailer notices
 * (docs/recall-retailer-notices.md, "Approval and the client read path").
 *
 * A separate path from the agency feed on purpose: it never touches
 * recall_cases, the feed cache or `FeedItem`, so the agency feed is exactly
 * what it was, and builds without this module never see a retailer notice.
 * It calls the read-only `consumer_retailer_notices()` function, which
 * returns only approved, standalone notices and their display-safe fields;
 * raw letters, evidence and review notes never reach a client.
 *
 * Fault-tolerant by design: any failure reads as "no retailer notices", so a
 * missing function (a backend without the migration) or an outage can never
 * break or empty the agency feed beside it.
 */

import { readRetailerNoticeFields, type RetailerNoticeFields } from './retailer-notice-fields';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export interface RetailerNotice {
  id: string;
  publisher: 'costco';
  /** The retailer's own letter (https on costco.com only). */
  documentUrl: string;
  /** The date printed on the letter, YYYY-MM-DD. */
  noticeDate: string;
  fields: RetailerNoticeFields;
  /**
   * The approved product photo's public URL in the product-visuals bucket
   * (the same delivery as other product visuals), or null when none was
   * approved or the backend is not configured.
   */
  imageUrl: string | null;
}

/** The public product-visuals URL for an approved image path. */
export function retailerImageUrl(baseUrl: string | undefined, path: string): string | null {
  if (!baseUrl) return null;
  return `${baseUrl.replace(/\/+$/, '')}/storage/v1/object/public/product-visuals/${path}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Only an https letter on Costco's own domain is ever linked. */
export function isRetailerDocumentUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'costco.com' || url.hostname.endsWith('.costco.com'))
    );
  } catch {
    return false;
  }
}

/** Strict: each malformed row is dropped whole, never shown in part. */
export function readRetailerNoticeRows(
  rows: unknown,
  baseUrl: string | undefined = supabaseUrl,
): RetailerNotice[] {
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const out: RetailerNotice[] = [];
  for (const raw of rows) {
    if (typeof raw !== 'object' || raw === null) continue;
    const row = raw as Record<string, unknown>;
    const fields = readRetailerNoticeFields(row.fields);
    if (
      typeof row.id !== 'string' ||
      !UUID.test(row.id) ||
      seen.has(row.id) ||
      row.publisher !== 'costco' ||
      !isRetailerDocumentUrl(row.document_url) ||
      typeof row.notice_date !== 'string' ||
      !DAY.test(row.notice_date) ||
      fields === null
    ) {
      continue;
    }
    seen.add(row.id);
    out.push({
      id: row.id,
      publisher: 'costco',
      documentUrl: row.document_url,
      noticeDate: row.notice_date,
      fields,
      imageUrl: fields.image ? retailerImageUrl(baseUrl, fields.image.path) : null,
    });
  }
  return out;
}

/** Every approved notice, or [] on any failure. Never throws. */
export async function fetchRetailerNotices(): Promise<RetailerNotice[]> {
  if (!supabaseUrl || !publishableKey) return [];
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/rpc/consumer_retailer_notices` +
        '?select=id,publisher,document_url,notice_date,fields',
      {
        headers: {
          apikey: publishableKey,
          Authorization: `Bearer ${publishableKey}`,
          Accept: 'application/json',
        },
      },
    );
    if (!response.ok) return [];
    return readRetailerNoticeRows(await response.json());
  } catch {
    return [];
  }
}
