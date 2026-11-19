/**
 * Store listings (docs/recall-retailer-notices.md, "Store listings"): the
 * stores that publicly listed an agency recall they sold, read from
 * `consumer_store_listings()` and shown on that recall's Recall Details.
 *
 * A listing never creates a card, never changes the agency's own
 * distribution and never reaches the alert verdict. Its store name joins the
 * case's existing store row on Recall Details, named once; its own states,
 * channels and page link are kept in the data (and privately with the
 * evidence) and are not rendered. Strict: a row whose publisher, store name
 * or page host do not agree is dropped whole. Fault tolerant: any failure
 * reads as no listings.
 */

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export type StoreListingPublisher = 'walmart' | 'target' | 'wholefoods' | 'publix';

const PUBLISHERS: Record<StoreListingPublisher, { stores: readonly string[]; host: string }> = {
  walmart: { stores: ['Walmart', "Sam's Club"], host: 'corporate.walmart.com' },
  target: { stores: ['Target'], host: 'www.target.com' },
  wholefoods: { stores: ['Whole Foods Market'], host: 'www.wholefoodsmarket.com' },
  publix: { stores: ['Publix'], host: 'corporate.publix.com' },
};

export interface StoreListing {
  caseId: string;
  publisher: StoreListingPublisher;
  store: string;
  scope: 'states' | 'nationwide' | 'unspecified';
  states: string[];
  channels: ('stores' | 'online')[];
  listingUrl: string;
  listedOn: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function isPublisher(value: unknown): value is StoreListingPublisher {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PUBLISHERS, value);
}

function strings(value: unknown): string[] | null {
  return Array.isArray(value) &&
    value.every((item) => typeof item === 'string' && item.trim() === item && item)
    ? (value as string[])
    : null;
}

/** Strict: each malformed row is dropped whole, never shown in part. */
export function readStoreListingRows(rows: unknown): StoreListing[] {
  if (!Array.isArray(rows)) return [];
  const out: StoreListing[] = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    if (typeof raw !== 'object' || raw === null) continue;
    const row = raw as Record<string, unknown>;
    const states = strings(row.states);
    const channels = strings(row.channels);
    if (
      typeof row.case_id !== 'string' ||
      !UUID.test(row.case_id) ||
      !isPublisher(row.publisher) ||
      typeof row.store !== 'string' ||
      !PUBLISHERS[row.publisher].stores.includes(row.store) ||
      !['states', 'nationwide', 'unspecified'].includes(row.scope as string) ||
      !states ||
      (row.scope === 'states') !== states.length > 0 ||
      !channels ||
      !channels.every((channel) => channel === 'stores' || channel === 'online') ||
      typeof row.listing_url !== 'string' ||
      (row.listed_on !== null && (typeof row.listed_on !== 'string' || !DAY.test(row.listed_on)))
    ) {
      continue;
    }
    let pageOk = false;
    try {
      const url = new URL(row.listing_url);
      pageOk = url.protocol === 'https:' && url.hostname === PUBLISHERS[row.publisher].host;
    } catch {
      pageOk = false;
    }
    const key = `${row.case_id}|${row.store}`;
    if (!pageOk || seen.has(key)) continue;
    seen.add(key);
    out.push({
      caseId: row.case_id,
      publisher: row.publisher,
      store: row.store,
      scope: row.scope as StoreListing['scope'],
      states,
      channels: channels as StoreListing['channels'],
      listingUrl: row.listing_url,
      listedOn: (row.listed_on as string | null) ?? null,
    });
  }
  return out;
}

/** Every linked listing, or [] on any failure. Never throws. */
export async function fetchStoreListings(): Promise<StoreListing[]> {
  if (!supabaseUrl || !publishableKey) return [];
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/consumer_store_listings`, {
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
        Accept: 'application/json',
      },
    });
    if (!response.ok) return [];
    return readStoreListingRows(await response.json());
  } catch {
    return [];
  }
}

// ── The store row ───────────────────────────────────────────────────────────

/**
 * The verified store names that listed this case, in store-name order, each
 * once — what the existing Where It Was Sold store row adds. Nothing else of
 * a listing is shown.
 */
export function listedStoreNames(listings: readonly StoreListing[], caseId: string): string[] {
  return [
    ...new Set(listings.filter((listing) => listing.caseId === caseId).map((l) => l.store)),
  ].sort((a, b) => a.localeCompare(b));
}
