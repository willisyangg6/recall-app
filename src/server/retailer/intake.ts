/**
 * Manual intake: a person's saved copy of one official retailer notice, run
 * through the SAME pipeline as an automated source (archive by hash, read,
 * duplicate-check against agency cases, decide). Used for retailers whose
 * sites refuse an honestly identified client (H-E-B; see sources.ts and
 * docs/recall-retailer-notices.md, "Manual intake").
 *
 * The saved file is the evidence. Its SHA-256 is what a reviewer approves,
 * exactly as for a fetched letter, and the URL recorded is the official page
 * the person saved it from. Nothing here fetches anything.
 */

import type { RetailerSource } from './costco-monitor';
import { extractPdfText, isPdf, type ExtractedPdfText } from './pdf-text';
import type { RetailerIndexEntry, RetailerPublisher } from './types';

const ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  ndash: '–',
  mdash: '—',
  reg: '®',
  trade: '™',
};

/** A saved web page's readable text: block elements become line breaks. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match)
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** A saved PDF reads as any letter does; a saved page reads as its text. */
export async function intakeExtract(bytes: Uint8Array): Promise<ExtractedPdfText> {
  if (isPdf(bytes)) return extractPdfText(bytes);
  const text = htmlToText(new TextDecoder().decode(bytes));
  return text
    ? { extraction: 'text', text, pages: 1 }
    : { extraction: 'failed', text: '', pages: 0 };
}

/** The intake's one index entry. The id is the official page's host + path. */
export function intakeEntry(
  publisher: RetailerPublisher,
  officialUrl: string,
  title: string,
): RetailerIndexEntry {
  const url = new URL(officialUrl);
  if (url.protocol !== 'https:') throw new Error('the official URL must be https');
  const trimmed = title.replace(/\s+/g, ' ').trim();
  if (!trimmed) throw new Error('a title is required');
  return {
    publisher,
    nativeId: `${url.hostname}${url.pathname.replace(/\/+$/, '')}`,
    indexLabel: null,
    indexTitle: trimmed,
    documentUrl: url.toString(),
  };
}

/** A source that serves the saved copy and nothing else. */
export function intakeSource(
  entry: RetailerIndexEntry,
  bytes: Uint8Array,
  contentType: string | null,
): RetailerSource {
  return {
    fetchIndexHtml: async () => JSON.stringify([entry]),
    async fetchDocument(url) {
      if (url !== entry.documentUrl) throw new Error(`intake has no copy of ${url}`);
      return { bytes, contentType };
    },
  };
}
