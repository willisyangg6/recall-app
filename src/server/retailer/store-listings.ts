/**
 * Store listings: retailers' public recall lists, attached to the agency case
 * each entry links (docs/recall-retailer-notices.md, "Store listings").
 *
 * Walmart (with Sam's Club), Target, Whole Foods Market and Publix publish a
 * list of recalls they sold, each linking the FDA or FSIS notice. Verified
 * 2026-11-16 against Lotly's production records: for the year to that day,
 * every US food entry on those lists was already a Lotly agency case. So a
 * listing is never a new recall. What it adds is the retailer's own word that
 * it sold the product, and where.
 *
 * The rules:
 * - A listing is LINKED only when its agency link is a source URL of exactly
 *   one Lotly case, or a reviewer confirmed the case. Anything else (no
 *   agency link, a link Lotly does not hold, several cases, a sold-at line we
 *   cannot read completely) goes to review and is never shown.
 * - Each store keeps its own facts. Walmart's states are Walmart's; when the
 *   line gives Sam's Club its own states ("OK, TX (Walmart); LA, TX (Sam's
 *   Club)"), each keeps its own. Nothing is merged into the agency's
 *   distribution, which stays exactly as the agency stated it.
 * - A listing never writes a case, a source record or the notification
 *   ledger, so it cannot change the feed or send an alert.
 */

import { POSTAL_TO_STATE, statesInText } from '../../domain/us-geography';

export type ListingPublisher = 'walmart' | 'target' | 'wholefoods' | 'publix';
export type ListingDecision = 'linked' | 'review' | 'excluded';
export type ListingReason =
  | 'agency_url_match'
  | 'reviewer_confirmed'
  | 'no_agency_link'
  | 'agency_link_not_in_lotly'
  | 'agency_link_matches_several_cases'
  | 'sold_at_unparsed'
  | 'not_a_us_agency_notice';

/** One store's facts, exactly as that store stated them. */
export interface StoreFact {
  store: string;
  /** 'states' = the listed states; 'nationwide' = "all states"; else unspecified. */
  scope: 'states' | 'nationwide' | 'unspecified';
  /** Full state names, canonical order of appearance. */
  states: string[];
  channels: ('stores' | 'online')[];
}

export interface ListingEntry {
  publisher: ListingPublisher;
  nativeId: string;
  title: string;
  listedOn: string | null;
  listingUrl: string;
  agencyUrls: string[];
  soldAtText: string | null;
  stores: StoreFact[];
  /** The sold-at line had text we could not read completely. */
  unparsed: boolean;
  /** The entry links only a non-US agency (Canada's CFIA). */
  foreign: boolean;
}

export const LISTING_SOURCES: Readonly<
  Record<ListingPublisher, { indexUrl: string; hosts: readonly string[]; parserVersion: string }>
> = {
  walmart: {
    indexUrl: 'https://corporate.walmart.com/recalls',
    hosts: ['corporate.walmart.com'],
    parserVersion: 'walmart-list/1',
  },
  target: {
    indexUrl: 'https://www.target.com/help/articles/news-safety/product-recalls',
    hosts: ['www.target.com'],
    parserVersion: 'target-articles/1',
  },
  wholefoods: {
    indexUrl: 'https://www.wholefoodsmarket.com/legal/product-recalls',
    hosts: ['www.wholefoodsmarket.com'],
    parserVersion: 'wholefoods-table/1',
  },
  publix: {
    indexUrl: 'https://corporate.publix.com/newsroom/recalls',
    hosts: ['corporate.publix.com'],
    parserVersion: 'publix-list/1',
  },
};

const MONTHS =
  'January|February|March|April|May|June|July|August|September|October|November|December';
const US_AGENCY = /^https:\/\/(?:www\.)?(?:fda\.gov|fsis\.usda\.gov|cpsc\.gov)\//i;
const CANADA = /^https:\/\/recalls-rappels\.canada\.ca\//i;

function decode(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;|’/g, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)));
}

function plain(html: string): string {
  return decode(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** A Proofpoint-wrapped link ("urldefense.com/v3/__URL__;…") is its target. */
export function unwrapLink(href: string): string {
  const url = decode(href).trim();
  const wrapped = /^https:\/\/urldefense\.com\/v3\/__(.+?)__;/.exec(url);
  return wrapped ? wrapped[1] : url;
}

/** Host without "www." + decoded path, lowercased, no trailing slash. */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname.replace(/^www\./, '').toLowerCase() +
      decodeURIComponent(parsed.pathname).replace(/\/+$/, '').toLowerCase()
    );
  } catch {
    return url.trim().toLowerCase();
  }
}

function isoFromWords(text: string): string | null {
  const match = new RegExp(`(${MONTHS})\\s+(\\d{1,2})(?:st|nd|rd|th)?,\\s*(\\d{4})`).exec(text);
  if (!match) return null;
  const month = MONTHS.split('|').indexOf(match[1]) + 1;
  return `${match[3]}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')}`;
}

function isoFromSlashes(text: string): string | null {
  const match = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(text);
  return match ? `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}` : null;
}

/** States from a list of postal codes and/or names; null if any token is not one. */
function statesFromList(list: string): string[] | null {
  const tokens = list
    .replace(/\.$/, '')
    .split(/,\s*|\s+and\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const states: string[] = [];
  for (const token of tokens) {
    const state = /^[A-Z]{2}$/.test(token) ? POSTAL_TO_STATE[token] : statesInText(token)[0];
    if (!state || (!/^[A-Z]{2}$/.test(token) && state.toLowerCase() !== token.toLowerCase())) {
      return null;
    }
    if (!states.includes(state)) states.push(state);
  }
  return states.length > 0 ? states : null;
}

/**
 * Walmart's sold-at line, store by store. Shapes seen on 2026-11-16:
 *   "Sold at Walmart stores and Walmart.com"
 *   "Sold at select Walmart stores in the following states: CT, MA, ME"
 *   "Sold at select Walmart stores in CT, NY, NJ, PA"
 *   "Sold at Walmart stores and Sam's Club in Puerto Rico"
 *   "Sold at select Walmart stores and Sam's Club in the following states: OK, TX (Walmart); LA, TX (Sam's Club)"
 *   "Sold at select Walmart stores in all states and Walmart.com"
 */
export function walmartStores(line: string): { stores: StoreFact[]; unparsed: boolean } {
  const text = decode(line).replace(/\s+/g, ' ').trim();
  const named: { store: string; online: boolean }[] = [];
  if (/\bWalmart\b(?!\.com)/i.test(text) || /Walmart\.com/i.test(text)) {
    named.push({ store: 'Walmart', online: /Walmart\.com/i.test(text) });
  }
  if (/Sam's Club/i.test(text))
    named.push({ store: "Sam's Club", online: /samsclub\.com/i.test(text) });
  if (named.length === 0) return { stores: [], unparsed: true };
  const instore = (store: string) =>
    store === 'Walmart' ? /\bWalmart stores?\b/i.test(text) : /Sam's Club\b(?!\.com)/i.test(text);
  const channels = (entry: { store: string; online: boolean }) => [
    ...(instore(entry.store) ? ['stores' as const] : []),
    ...(entry.online ? ['online' as const] : []),
  ];

  const grouped = [...text.matchAll(/([A-Z]{2}(?:\s*,\s*[A-Z]{2})*)\s*\((Walmart|Sam's Club)\)/g)];
  if (grouped.length > 0) {
    const stores: StoreFact[] = [];
    for (const [, list, store] of grouped) {
      const states = statesFromList(list);
      if (!states) return { stores: [], unparsed: true };
      const entry = named.find((item) => item.store === store) ?? { store, online: false };
      stores.push({ store, scope: 'states', states, channels: channels(entry) });
    }
    return { stores, unparsed: false };
  }
  if (/\bin all states\b/i.test(text)) {
    return {
      stores: named.map((entry) => ({
        store: entry.store,
        scope: 'nationwide',
        states: [],
        channels: channels(entry),
      })),
      unparsed: false,
    };
  }
  const place =
    /\bin (?:the following states:\s*)?(.+?)(?:\s+and\s+(?:Walmart|Samsclub)\.com)?\.?$/i.exec(
      text,
    );
  if (place) {
    const states = statesFromList(place[1]);
    if (!states) return { stores: [], unparsed: true };
    return {
      stores: named.map((entry) => ({
        store: entry.store,
        scope: 'states',
        states,
        channels: channels(entry),
      })),
      unparsed: false,
    };
  }
  return {
    stores: named.map((entry) => ({
      store: entry.store,
      scope: 'unspecified',
      states: [],
      channels: channels(entry),
    })),
    unparsed: false,
  };
}

/** Walmart's food recalls (the "Food Recalls" section of its recall page). */
export function parseWalmartListings(html: string): ListingEntry[] {
  const start = html.indexOf('id="food"');
  const end = html.indexOf('id="pharmacy"');
  if (start < 0 || end < start) throw new Error('Walmart page has no food section: shape changed');
  const section = html.slice(start, end);
  const entries: ListingEntry[] = [];
  const dated = new RegExp(
    `(${MONTHS}) (\\d{1,2}), (\\d{4})([\\s\\S]*?)(?=(?:${MONTHS}) \\d{1,2}, \\d{4}|$)`,
    'g',
  );
  for (const match of section.matchAll(dated)) {
    const link = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(match[4]);
    if (!link) continue;
    const url = unwrapLink(link[1]);
    const soldAt = /(Sold at[^<]+)/.exec(match[4])?.[1].trim() ?? null;
    const parsed = soldAt ? walmartStores(soldAt) : { stores: [], unparsed: true };
    const listedOn = isoFromWords(match[0]);
    entries.push({
      publisher: 'walmart',
      nativeId: `${listedOn}|${normalizeUrl(url)}`,
      title: plain(link[2]),
      listedOn,
      listingUrl: LISTING_SOURCES.walmart.indexUrl,
      agencyUrls: [url],
      soldAtText: soldAt ? decode(soldAt) : null,
      stores: parsed.stores,
      unparsed: parsed.unparsed,
      foreign: false,
    });
  }
  return entries;
}

/** Target's recall page: the Grocery/OTC articles it highlights (title, date, article). */
export function parseTargetIndex(html: string): { title: string; url: string; date: string }[] {
  const flat = html.replace(/\\"/g, '"');
  const at = flat.indexOf('"title":"Grocery/OTC"');
  if (at < 0) throw new Error('Target page has no Grocery/OTC block: shape changed');
  const open = flat.lastIndexOf('"content":[', at);
  const block = flat.slice(open, at);
  return [
    ...block.matchAll(/"title":"([^"]+)","url":"(\/help\/article\/\d+)","subHeading":"([^"]+)"/g),
  ].map(([, title, url, date]) => ({
    title: decode(title),
    url: `https://www.target.com${url}`,
    date,
  }));
}

/** One Target recall article: where Target sold it, and the agency's notice. */
export function parseTargetArticle(
  html: string,
  ref: { title: string; url: string; date: string },
): ListingEntry {
  const text = plain(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' '));
  const soldAt = /Sold at:\s*(.+?)\s+Recall Date:/.exec(text)?.[1] ?? null;
  const agencyUrls = [
    ...new Set([...html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => unwrapLink(m[1]))),
  ].filter((url) => US_AGENCY.test(url));
  const channels: StoreFact['channels'] = [
    ...(soldAt && /Target Stores?/i.test(soldAt) ? ['stores' as const] : []),
    ...(soldAt && /Target\.com/i.test(soldAt) ? ['online' as const] : []),
  ];
  return {
    publisher: 'target',
    nativeId: normalizeUrl(ref.url),
    title: ref.title,
    listedOn: isoFromSlashes(/Recall Date:\s*(\S+)/.exec(text)?.[1] ?? ref.date),
    listingUrl: ref.url,
    agencyUrls,
    soldAtText: soldAt,
    stores: soldAt ? [{ store: 'Target', scope: 'unspecified', states: [], channels }] : [],
    unparsed: !soldAt || channels.length === 0,
    foreign: false,
  };
}

/** Whole Foods Market's recall table: date, product, reason, linked notice. */
export function parseWholeFoodsListings(html: string): ListingEntry[] {
  const entries: ListingEntry[] = [];
  for (const row of html.matchAll(/<tr[\s\S]*?<\/tr>/g)) {
    const cells = [...row[0].matchAll(/<td[\s\S]*?<\/td>/g)].map((cell) => plain(cell[0]));
    const href = /href="([^"]+)"/.exec(row[0])?.[1];
    if (cells.length < 3 || !href) continue;
    const url = unwrapLink(href);
    const foreign = CANADA.test(url);
    entries.push({
      publisher: 'wholefoods',
      nativeId: normalizeUrl(url),
      title: cells[1],
      listedOn: isoFromWords(cells[0]),
      listingUrl: LISTING_SOURCES.wholefoods.indexUrl,
      agencyUrls: US_AGENCY.test(url) ? [url] : [],
      soldAtText: null,
      stores: [
        { store: 'Whole Foods Market', scope: 'unspecified', states: [], channels: ['stores'] },
      ],
      unparsed: false,
      foreign,
    });
  }
  return entries;
}

/**
 * Publix's recall page renders its list from an inline component property,
 * `<recall-list :item-list="…">`. The entry shape is Publix's own: its
 * `RecallList` component (cp_RecallList.js on assets.publixcdn.com, read
 * 2026-11-17) renders each item's `RecallDateText`, `Title` (linking
 * `RecallDetailsUrl`) and `SoldAtPublixText`. Observed values: only the
 * empty list (`null`, with "There are no Publix recalls at this time.").
 *
 * An entry links a Publix page, not an agency notice, so it can never link
 * to a case on its own: every entry goes to review. Anything that is not
 * the empty state or an array of exactly those four text fields stops the
 * run for a person rather than being read by guesswork.
 */
const PUBLIX_FIELDS = ['RecallDateText', 'RecallDetailsUrl', 'SoldAtPublixText', 'Title'];

export function parsePublixListings(html: string): ListingEntry[] {
  const attribute = /<recall-list\b[^>]*:item-list="([^"]*)"/.exec(html)?.[1];
  if (attribute === undefined) throw new Error('Publix page has no recall list: shape changed');
  if (attribute === 'null') {
    if (!/There are no Publix recalls at this time\./.test(html)) {
      throw new Error('Publix list is null without its empty-state sentence: shape changed');
    }
    return [];
  }
  let items: unknown;
  try {
    items = JSON.parse(decode(attribute).replace(/&quot;/g, '"'));
  } catch {
    throw new Error('Publix list is not readable JSON: review the page by hand');
  }
  if (!Array.isArray(items))
    throw new Error('Publix list is not an array: review the page by hand');
  return items.map((raw) => {
    const item = raw as Record<string, unknown>;
    const keys = Object.keys(item ?? {}).sort();
    if (
      keys.length !== PUBLIX_FIELDS.length ||
      !keys.every((key, i) => key === PUBLIX_FIELDS[i] && typeof item[key] === 'string')
    ) {
      throw new Error(
        `Publix entry fields ${keys.join(',')} are not the verified four: review by hand`,
      );
    }
    const detail = new URL(item.RecallDetailsUrl as string, LISTING_SOURCES.publix.indexUrl);
    if (detail.protocol !== 'https:' || detail.hostname !== 'corporate.publix.com') {
      throw new Error(`Publix entry links off Publix (${detail.hostname}): review by hand`);
    }
    const dateText = item.RecallDateText as string;
    return {
      publisher: 'publix' as const,
      nativeId: normalizeUrl(detail.toString()),
      title: plain(item.Title as string),
      listedOn: isoFromWords(dateText) ?? isoFromSlashes(dateText),
      listingUrl: detail.toString(),
      agencyUrls: [],
      soldAtText: plain(item.SoldAtPublixText as string),
      stores: [
        {
          store: 'Publix',
          scope: 'unspecified' as const,
          states: [],
          channels: ['stores' as const],
        },
      ],
      unparsed: false,
      foreign: false,
    };
  });
}

/** The decision for one listing, from Lotly's agency source URLs. */
export function decideListing(
  entry: ListingEntry,
  casesByUrl: ReadonlyMap<string, readonly string[]>,
): { decision: ListingDecision; reasons: ListingReason[]; caseId: string | null } {
  if (entry.agencyUrls.length === 0) {
    return entry.foreign
      ? { decision: 'excluded', reasons: ['not_a_us_agency_notice'], caseId: null }
      : { decision: 'review', reasons: ['no_agency_link'], caseId: null };
  }
  const cases = new Set(entry.agencyUrls.flatMap((url) => casesByUrl.get(normalizeUrl(url)) ?? []));
  if (cases.size === 0)
    return { decision: 'review', reasons: ['agency_link_not_in_lotly'], caseId: null };
  if (cases.size > 1) {
    return { decision: 'review', reasons: ['agency_link_matches_several_cases'], caseId: null };
  }
  if (entry.unparsed || entry.stores.length === 0) {
    return { decision: 'review', reasons: ['sold_at_unparsed'], caseId: null };
  }
  return { decision: 'linked', reasons: ['agency_url_match'], caseId: [...cases][0] };
}
