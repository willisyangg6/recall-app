/**
 * ALDI US "Product Recalls" index (https://corporate.aldi.us/newsroom/product-recalls).
 *
 * Verified 2026-11-16 (docs/recall-retailer-notices.md): server-rendered
 * HTML, answered to the honest client identity, with `robots.txt` disallowing
 * only four named crawlers. Each entry is one paragraph under a "<year>
 * Recalls" heading:
 *
 *   <p><b>November 16, 2026:</b> <a href="https://dm.cms.aldi.cx/is/content/prod1amer/…pdf">Title</a></p>
 *
 * Unlike Costco, the index DATES every entry, and ALDI's recall notices
 * themselves print no date line. That date is ALDI's own statement, so it is
 * carried on the entry and used only when the document states none.
 *
 * Only ALDI's own documents (on its asset host) become notices. A paragraph
 * linking an agency page (FSIS, CPSC) is the agency's notice, not ALDI's, and
 * is skipped: the agency adapters already read FSIS, and CPSC is not food.
 */

import type { RetailerIndexEntry } from './types';

export const ALDI_INDEX_URL = 'https://corporate.aldi.us/newsroom/product-recalls';
export const ALDI_DOCUMENT_HOST = 'dm.cms.aldi.cx';

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)));
}

function plain(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** "November 16, 2026" → "2026-11-16"; null for anything that is not a real date. */
export function aldiIndexDate(text: string): string | null {
  const match = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const month = MONTHS.indexOf(match[1].toLowerCase());
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (month < 0) return null;
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/** The document's path on ALDI's asset host: the entry's stable id. */
export function aldiNativeId(documentUrl: string): string | null {
  try {
    const url = new URL(documentUrl);
    if (url.protocol !== 'https:' || url.hostname !== ALDI_DOCUMENT_HOST) return null;
    const path = decodeURIComponent(url.pathname).replace(/^\/is\/content\//, '');
    return path.length > 0 ? path : null;
  } catch {
    return null;
  }
}

/** Every ALDI-hosted recall document on the index, newest first as listed. */
export function parseAldiIndex(html: string): RetailerIndexEntry[] {
  const entries = new Map<string, RetailerIndexEntry>();
  for (const paragraph of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const body = paragraph[1];
    const link = /<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(body);
    if (!link) continue;
    const documentUrl = decodeEntities(link[1]).trim();
    const nativeId = aldiNativeId(documentUrl);
    if (!nativeId || entries.has(nativeId)) continue;

    const before = plain(body.slice(0, link.index));
    const dateText = /([A-Za-z]+\s+\d{1,2},\s*\d{4})\s*:?\s*$/.exec(before)?.[1] ?? null;
    const title = plain(link[2]);
    if (!title) continue;
    entries.set(nativeId, {
      publisher: 'aldi',
      nativeId,
      indexLabel: null,
      indexTitle: title,
      documentUrl,
      indexDate: dateText ? aldiIndexDate(dateText) : null,
      indexDateText: dateText ? `${dateText}:` : null,
    });
  }
  return [...entries.values()];
}
