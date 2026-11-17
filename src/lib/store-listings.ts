/**
 * Store listings (docs/recall-retailer-notices.md, "Store listings"): the
 * stores that publicly listed an agency recall they sold, read from
 * `consumer_store_listings()` and shown on that recall's Recall Details.
 *
 * A listing never creates a card and never changes the agency's own
 * distribution. Each store is shown as that store stated it, with a link to
 * the store's own page. Strict: a row whose publisher, store name or page
 * host do not agree is dropped whole. Fault tolerant: any failure reads as no
 * listings.
 */

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export type StoreListingPublisher = 'walmart' | 'target' | 'wholefoods' | 'publix';

const PUBLISHERS: Record<
  StoreListingPublisher,
  { stores: readonly string[]; host: string; page: string }
> = {
  walmart: {
    stores: ['Walmart', "Sam's Club"],
    host: 'corporate.walmart.com',
    page: 'recall list',
  },
  target: { stores: ['Target'], host: 'www.target.com', page: 'recall notice' },
  wholefoods: {
    stores: ['Whole Foods Market'],
    host: 'www.wholefoodsmarket.com',
    page: 'recall list',
  },
  publix: { stores: ['Publix'], host: 'corporate.publix.com', page: 'recall list' },
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

// ── The Recall Details rows ─────────────────────────────────────────────────

export interface StoreListingRow {
  store: string;
  /** What THAT store stated: its states, "Nationwide", or its channels. */
  detail: string;
  /** "Walmart’s recall list": the store's own page, never the agency's. */
  sourceLabel: string;
  url: string;
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

const INLINE_STATES = 4;

function detailOf(listing: StoreListing): string {
  if (listing.scope === 'nationwide') return 'Nationwide';
  if (listing.scope === 'states') {
    return listing.states.length <= INLINE_STATES
      ? joinNames(listing.states)
      : `${listing.states.length} states`;
  }
  const stores = listing.channels.includes('stores');
  const online = listing.channels.includes('online');
  return stores && online ? 'In stores and online' : online ? 'Online' : 'In stores';
}

/** One row per store for this case, in store-name order. Never merged. */
export function storeListingRows(
  listings: readonly StoreListing[],
  caseId: string,
): StoreListingRow[] {
  return listings
    .filter((listing) => listing.caseId === caseId)
    .sort((a, b) => a.store.localeCompare(b.store))
    .map((listing) => ({
      store: listing.store,
      detail: detailOf(listing),
      sourceLabel: `${PUBLISHERS[listing.publisher].stores[0]}’s ${PUBLISHERS[listing.publisher].page}`,
      url: listing.listingUrl,
    }));
}
