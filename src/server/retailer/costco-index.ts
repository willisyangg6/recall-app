/**
 * Costco "Recalls & Product Notices" index (https://www.costco.com/f/-/recalls).
 *
 * Verified 2026-11-13 (docs/recall-retailer-notices.md): the page is a Next.js
 * app whose entries arrive in the React flight stream
 * (`self.__next_f.push([1,"…"])` script tags) as CMS `text_builder` blocks.
 * Each block carries a stable `uniqueId` (`blt…`) and a `markdown_text` like
 *
 *   Recall Notice: [Kirkland Signature Heavy Whipped Cream (Item #1777000) …](https://gdx-assets.costco.com/…/FINAL KS Whipped Cream Member Letter.pdf)
 *
 * The index carries NO dates. Dates come only from the linked document. The
 * page's own "older than 120 days" note is not a reliable age signal either —
 * a November 2025 letter was still listed a year later — so neither presence
 * nor absence on this index says anything about a notice's age or status.
 *
 * Quirks contained here and nowhere else: links with literal spaces, links
 * with `%3A`-encoded URNs, one block (saunas) carrying two documents, and the
 * same block repeated in the stream.
 */

import type { RetailerIndexEntry } from './types';

export const COSTCO_INDEX_URL = 'https://www.costco.com/f/-/recalls';

const DOCUMENT_HOST = 'https://gdx-assets.costco.com/';
const IMAGE_EXTENSION = /\.(?:avif|png|jpe?g|webp|svg|gif)(?:$|\?)/i;

/** Join and JSON-decode every flight chunk on the page. */
export function decodeFlight(html: string): string {
  let text = '';
  for (const match of html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)) {
    text += JSON.parse(`"${match[1]}"`) as string;
  }
  return text;
}

/** A link URL as the HTTP layer needs it: literal spaces percent-encoded. */
export function normalizeDocumentUrl(url: string): string {
  return url.trim().replace(/ /g, '%20');
}

function plain(markdown: string): string {
  return markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>]/g, '')
    .replace(/-{3,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Every notice document on the index. One entry per document: a block with
 * two documents yields `uid:1` and `uid:2`, each titled with the block heading
 * plus its own link text.
 */
export function parseCostcoIndex(html: string): RetailerIndexEntry[] {
  const flight = decodeFlight(html);
  const entries = new Map<string, RetailerIndexEntry>();
  for (const match of flight.matchAll(/"markdown_text":"((?:[^"\\]|\\.)*)"/g)) {
    const markdown = JSON.parse(`"${match[1]}"`) as string;
    const links = [
      ...markdown.matchAll(/\[([^\]]+)\]\((https:\/\/gdx-assets\.costco\.com\/[^)]+)\)/g),
    ].filter((link) => link[2].startsWith(DOCUMENT_HOST) && !IMAGE_EXTENSION.test(link[2]));
    if (links.length === 0) continue;

    const tail = flight.slice(
      match.index! + match[0].length,
      match.index! + match[0].length + 4000,
    );
    const uid = /"uniqueId":"(blt[0-9a-f]+)"/.exec(tail)?.[1];
    if (!uid) continue;

    const label = /^\s*\**\s*([A-Za-z][A-Za-z ]*?Notice)\s*\**\s*:/.exec(markdown)?.[1] ?? null;
    const heading = plain(markdown.slice(0, links[0].index)).replace(
      /^[A-Za-z ]*Notice\s*:\s*/,
      '',
    );

    links.forEach((link, position) => {
      const linkText = link[1].trim();
      const nativeId = links.length === 1 ? uid : `${uid}:${position + 1}`;
      const title =
        heading && !linkText.toLowerCase().includes(heading.toLowerCase())
          ? `${heading.replace(/[\s,–—-]+$/, '')} — ${linkText}`
          : linkText;
      if (!entries.has(nativeId)) {
        entries.set(nativeId, {
          publisher: 'costco',
          nativeId,
          indexLabel: label,
          indexTitle: title,
          documentUrl: normalizeDocumentUrl(link[2]),
        });
      }
    });
  }
  return [...entries.values()];
}
