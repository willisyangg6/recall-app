/**
 * Official FSIS notice attachments → verified product facts.
 *
 * An FSIS notice often names its products only in linked PDFs: "View the
 * list of products subject to the public health alert" (a product table) and
 * "View product labels" / "view labels" (label pages). Before this module the
 * pipeline read neither for product facts — the label PDF was rasterized for
 * imagery (labels.ts) and the product list was never fetched at all — so a
 * notice like PHA-11142026 carried only its agency headline as a product name.
 *
 * Everything here is deterministic and conservative:
 *  - discovery reads the notice's own anchors, classifying each by its link
 *    TEXT first and its URL second, so "View labels", "View product labels",
 *    "view labels]" and "View the list of products" are all recognized;
 *  - PDFs are read through their text layer with the pdfjs the label
 *    renderer already uses — no OCR, no models; a page without a text layer
 *    yields nothing rather than a guess;
 *  - a product table is kept only when its header and every row verify; any
 *    doubt marks the attachment `needs_review` and keeps nothing from it;
 *  - a label page belongs to a product only when its own printed caption
 *    names exactly that product and no other — page ORDER is never evidence
 *    (PHA-11062026-01 prints its labels in the reverse of the notice's list).
 */

import { measurementKey } from '../../lib/variant-identity';
import { FSIS_HOSTS, resolveOfficialUrl } from '../../lib/official-urls';
import { normalizeStateToken } from '../../domain/us-geography';
import type { AttachmentTable, Geography } from '../../domain/recall-types';
import type { AttachmentEnrichment, AttachmentSource } from '../../domain/source-record';
import { decodeEntities, stripHtml } from '../../domain/text';
import { MULTIPLE_PRODUCTS_AND_BRANDS, PRODUCT_SOFT_LIMIT } from '../push/product-name';

// ── Discovery ───────────────────────────────────────────────────────────────

export type AttachmentKind = 'labels' | 'product_list' | 'distribution_list' | 'other';

export interface DiscoveredAttachment {
  url: string;
  kind: AttachmentKind;
  /** The anchor's own text, whitespace-collapsed ("View product labels."). */
  linkText: string;
}

const LABEL_TEXT = /\blabels?\b/i;
const PRODUCT_LIST_TEXT = /\blist of (?:the )?(?:affected )?products\b|\bproducts? list\b/i;
const DISTRIBUTION_TEXT = /\b(?:distribution|retail(?:er)?s?|stores?)\b/i;

/**
 * Every official FSIS-hosted PDF the notice links, classified. Link text
 * decides first because it is what the agency wrote for people; the URL is
 * the fallback for bare or generic anchors (the historical `food_label_pdf`
 * and `distro_list` paths). Order is the notice's own; duplicates collapse
 * on the resolved URL.
 */
export function discoverFsisAttachments(summaryHtml: string | null): DiscoveredAttachment[] {
  if (!summaryHtml) return [];
  const out: DiscoveredAttachment[] = [];
  const seen = new Set<string>();
  for (const match of summaryHtml.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const raw = decodeEntities(match[1]).trim();
    const resolved = resolveOfficialUrl(raw, { approvedHosts: FSIS_HOSTS });
    if (!resolved) continue;
    const url = resolved.url;
    if (!/\.pdf(?:[?#]|$)/i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const linkText = stripHtml(match[2]).replace(/\s+/g, ' ').trim();
    out.push({ url, kind: classifyAttachment(linkText, url), linkText });
  }
  return out;
}

function classifyAttachment(linkText: string, url: string): AttachmentKind {
  const path = decodeURIComponent(new URL(url).pathname);
  if (PRODUCT_LIST_TEXT.test(linkText)) return 'product_list';
  if (DISTRIBUTION_TEXT.test(linkText) && !LABEL_TEXT.test(linkText)) return 'distribution_list';
  if (LABEL_TEXT.test(linkText)) return 'labels';
  if (/distro_list|distribution/i.test(path)) return 'distribution_list';
  if (/product[-_ ]?list/i.test(path)) return 'product_list';
  if (/food_label_pdf|labels?[^/]*\.pdf$/i.test(path)) return 'labels';
  return 'other';
}

// ── PDF text layer ──────────────────────────────────────────────────────────

/** One positioned run of text on a PDF page (PDF user-space units). */
export interface PdfTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
}

export interface PdfLayout {
  pages: { page: number; items: PdfTextItem[] }[];
  numPages: number;
}

/** Attachment documents are a few pages; past this they are not a list. */
export const MAX_ATTACHMENT_PAGES = 12;

/**
 * The text layer of a PDF, positioned. Throws on unreadable bytes — the
 * caller records that as an unreadable attachment and keeps the notice.
 */
export async function readPdfLayout(bytes: Uint8Array): Promise<PdfLayout> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({
    data: bytes.slice(),
    useSystemFonts: false,
    verbosity: 0,
  });
  try {
    const document = await loadingTask.promise;
    const pages: PdfLayout['pages'] = [];
    for (let page = 1; page <= Math.min(document.numPages, MAX_ATTACHMENT_PAGES); page++) {
      const content = await (await document.getPage(page)).getTextContent();
      const items: PdfTextItem[] = [];
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const text = item.str.replace(/\s+/g, ' ').trim();
        if (text === '') continue;
        items.push({ text, x: item.transform[4], y: item.transform[5], width: item.width });
      }
      pages.push({ page, items });
    }
    return { pages, numPages: document.numPages };
  } finally {
    await loadingTask.destroy();
  }
}

/** Items in reading order: top to bottom (PDF y grows upward), then left to right. */
function readingOrder(items: PdfTextItem[]): PdfTextItem[] {
  return [...items].sort((a, b) => (Math.abs(a.y - b.y) > 2 ? b.y - a.y : a.x - b.x));
}

// ── Label captions ──────────────────────────────────────────────────────────

/**
 * The document's own running title ("PHA 11142026 Product Labels") is not a
 * caption of the page's product and is dropped wherever it appears.
 */
const LABEL_DOCUMENT_TITLE = /^(?:PHA|recall)?[\s\d_-]*(?:product\s+)?labels?$/i;

/**
 * The printed caption of each label page: its text layer in reading order,
 * minus the document's running title. Null for a page with no text (a
 * scanned image) — a page is never captioned by guesswork.
 */
export function labelPageCaptions(layout: PdfLayout): { page: number; caption: string | null }[] {
  return layout.pages.map(({ page, items }) => {
    const lines = readingOrder(items)
      .map((item) => item.text)
      .filter((text) => !LABEL_DOCUMENT_TITLE.test(text));
    const caption = lines.join(' ').replace(/\s+/g, ' ').trim();
    return { page, caption: caption === '' ? null : caption.slice(0, 300) };
  });
}

/** Minimum identity-key length for a caption match (the allocator's floor). */
const MIN_NAME_KEY = 6;

export type PageMatch =
  | { page: number; productIndex: number }
  | { page: number; productIndex: null; reason: 'no_caption' | 'no_match' | 'ambiguous' };

/**
 * Which product each label page shows, by its printed caption alone. A page
 * matches a product when the caption contains that product's name and no
 * other product's; a name contained in a longer sibling name defers to the
 * sibling. Two pages claiming one product are both ambiguous — no page is
 * preferred by position.
 */
export function matchLabelPages(
  captions: { page: number; caption: string | null }[],
  productNames: string[],
): PageMatch[] {
  const keys = productNames.map((name) => measurementKey(name));
  const first: PageMatch[] = captions.map(({ page, caption }) => {
    if (caption === null) return { page, productIndex: null, reason: 'no_caption' };
    const captionKey = measurementKey(caption);
    let hits = keys
      .map((key, index) => ({ key, index }))
      .filter(({ key }) => key.length >= MIN_NAME_KEY && captionKey.includes(key));
    // "Gravy" inside "Biscuit & Sausage Gravy": the longer, more specific
    // name owns the caption.
    hits = hits.filter(
      (hit) =>
        !hits.some(
          (other) =>
            other !== hit && other.key.length > hit.key.length && other.key.includes(hit.key),
        ),
    );
    const distinct = new Set(hits.map((hit) => hit.key));
    if (distinct.size === 0) return { page, productIndex: null, reason: 'no_match' };
    if (distinct.size > 1 || hits.length > 1)
      return { page, productIndex: null, reason: 'ambiguous' };
    return { page, productIndex: hits[0].index };
  });
  const claims = new Map<number, number>();
  for (const match of first) {
    if (match.productIndex !== null)
      claims.set(match.productIndex, (claims.get(match.productIndex) ?? 0) + 1);
  }
  return first.map((match) =>
    match.productIndex !== null && (claims.get(match.productIndex) ?? 0) > 1
      ? { page: match.page, productIndex: null, reason: 'ambiguous' }
      : match,
  );
}

// ── Product-list tables ─────────────────────────────────────────────────────

/** Header vocabulary of FSIS product-list tables, one entry per printed line. */
const HEADER_LINES = [
  /^size$/i,
  /^brand(?: name)?$/i,
  /^name$/i,
  /^product(?: name)?$/i,
  /^lot codes?(?: and\/or)?$/i,
  /^(?:and\/or )?(?:use|sell|best) by(?: dates?)?$/i,
  /^dates?$/i,
  /^est(?:\.|ablishment)?(?: number)?$/i,
  /^number$/i,
  /^states?(?: affected)?$/i,
  /^affected$/i,
  /^media and$/i,
  /^(?:media and )?consumer contact$/i,
  /^contact$/i,
];

function isHeaderLine(text: string): boolean {
  return HEADER_LINES.some((pattern) => pattern.test(text.trim()));
}

interface Column {
  heading: string;
  left: number;
  right: number;
  center: number;
}

export type ProductListParse =
  | { status: 'verified'; table: Omit<AttachmentTable, 'sourceUrl' | 'sha256'> }
  | { status: 'needs_review'; reasons: string[] };

/** The column that names the product — every verified row must fill it. */
const PRODUCT_HEADING = /^product(?: name)?$/i;
/** A cell this far below the previous line of its column starts a new row. */
const ROW_GAP = 18;

/**
 * Read a product-list PDF's table. Columns are found from the printed
 * header (multi-line headings merge by horizontal overlap); each body run
 * joins the column whose span contains its center; rows begin where the
 * product-name column starts a new cell. Verification refuses — never
 * repairs — a table whose header is not recognized, a row without a product
 * name, or a run that falls between columns.
 */
export function parseProductList(layout: PdfLayout): ProductListParse {
  const reasons: string[] = [];
  let headers: string[] | null = null;
  const rows: AttachmentTable['rows'] = [];
  // The last header page's columns and the running page text printed above
  // its header ("PHA 11142026 Products List", "Last Updated – …"), for a
  // continuation page that does not repeat the header (2026-11-20 revision).
  let lastColumns: Column[] | null = null;
  let runningText = new Set<string>();

  for (const { page, items } of layout.pages) {
    const headerItems = items.filter((item) => isHeaderLine(item.text));
    let columns: Column[];
    let body: PdfTextItem[];
    if (headerItems.length === 0) {
      if (items.length === 0 || headers === null) continue;
      if (lastColumns === null) {
        reasons.push(`page ${page}: no table header`);
        continue;
      }
      // A continuation page: the previous header's columns, minus the
      // running page text. Every check below still applies — a run between
      // columns or above the first product row refuses it as before.
      columns = lastColumns;
      body = items.filter((item) => !runningText.has(item.text));
    } else {
      columns = columnsFromHeader(headerItems);
      const pageHeaders = columns.map((column) => column.heading);
      if (!pageHeaders.some((heading) => PRODUCT_HEADING.test(heading))) {
        reasons.push(
          `page ${page}: header has no product-name column (${pageHeaders.join(' | ')})`,
        );
        continue;
      }
      if (headers === null) headers = pageHeaders;
      else if (headers.join('|') !== pageHeaders.join('|')) {
        reasons.push(`page ${page}: header differs from page 1`);
        continue;
      }
      const headerTop = Math.max(...headerItems.map((item) => item.y));
      const headerBottom = Math.min(...headerItems.map((item) => item.y));
      lastColumns = columns;
      runningText = new Set(
        items.filter((item) => item.y > headerTop + 2).map((item) => item.text),
      );
      body = items.filter((item) => item.y < headerBottom - 2 && !isHeaderLine(item.text));
    }
    const productColumn = columns.findIndex((column) => PRODUCT_HEADING.test(column.heading));
    const placed: { item: PdfTextItem; column: number }[] = [];
    for (const item of body) {
      const center = item.x + item.width / 2;
      const column = columns.findIndex((c) => center >= c.left && center <= c.right);
      if (column === -1) {
        reasons.push(`page ${page}: text "${item.text.slice(0, 40)}" falls between columns`);
        continue;
      }
      placed.push({ item, column });
    }

    // Row tops: the product column's cells, split where a gap opens.
    const productLines = placed
      .filter((p) => p.column === productColumn)
      .map((p) => p.item.y)
      .sort((a, b) => b - a);
    const rowTops: number[] = [];
    productLines.forEach((y, index) => {
      if (index === 0 || productLines[index - 1] - y > ROW_GAP) rowTops.push(y);
    });
    if (rowTops.length === 0) {
      reasons.push(`page ${page}: table has no product rows`);
      continue;
    }
    const pageTop = Math.max(...placed.map((p) => p.item.y));
    if (pageTop > rowTops[0] + 3) {
      reasons.push(`page ${page}: text above the first product row`);
      continue;
    }
    for (let r = 0; r < rowTops.length; r++) {
      const top = rowTops[r] + 3;
      const bottom = r + 1 < rowTops.length ? rowTops[r + 1] + 3 : -Infinity;
      const inRow = placed.filter((p) => p.item.y <= top && p.item.y > bottom);
      const cells = columns.map((_, index) =>
        readingOrder(inRow.filter((p) => p.column === index).map((p) => p.item))
          .map((item) => item.text)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
      );
      if (cells[productColumn] === '') {
        reasons.push(`page ${page}: row ${r + 1} has no product name`);
        continue;
      }
      rows.push({ page, cells });
    }
  }

  if (headers === null) reasons.push('no recognizable product table');
  if (reasons.length > 0 || headers === null) return { status: 'needs_review', reasons };
  return { status: 'verified', table: { headers, rows } };
}

function columnsFromHeader(headerItems: PdfTextItem[]): Column[] {
  const spans = readingOrder(headerItems).map((item) => ({
    left: item.x,
    right: item.x + item.width,
    lines: [item],
  }));
  // Multi-line headings ("Brand" over "Name") overlap horizontally: merge.
  spans.sort((a, b) => a.left - b.left);
  const merged: typeof spans = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.left <= last.right - 1) {
      last.right = Math.max(last.right, span.right);
      last.lines.push(...span.lines);
    } else {
      merged.push({ ...span, lines: [...span.lines] });
    }
  }
  const columns: Column[] = merged.map((span) => ({
    heading: readingOrder(span.lines)
      .map((item) => item.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
    left: span.left,
    right: span.right,
    center: (span.left + span.right) / 2,
  }));
  // A column owns the space up to the midpoint between neighbouring headings.
  return columns.map((column, index) => ({
    ...column,
    left: index === 0 ? -Infinity : (columns[index - 1].center + column.center) / 2,
    right:
      index === columns.length - 1 ? Infinity : (column.center + columns[index + 1].center) / 2,
  }));
}

// ── Product identity from a verified table ──────────────────────────────────

export interface TableProduct {
  name: string;
  brand: string | null;
  states: string[];
  page: number;
}

/** Columns of a verified table that carry the consumer product identity. */
export function tableProducts(
  table: Omit<AttachmentTable, 'sourceUrl' | 'sha256'>,
): TableProduct[] {
  const at = (pattern: RegExp) => table.headers.findIndex((heading) => pattern.test(heading));
  const product = at(PRODUCT_HEADING);
  const brand = at(/^brand/i);
  const states = at(/^states?/i);
  return table.rows.map((row) => ({
    name: row.cells[product],
    brand: brand === -1 || row.cells[brand] === '' ? null : brandDisplayCase(row.cells[brand]),
    states: states === -1 ? [] : statesIn(row.cells[states]),
    page: row.page,
  }));
}

const SMALL_WORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'for',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

/**
 * A printed brand un-shouted for display, word by word: an ALL-CAPS word
 * becomes Capitalized (small joining words lowercase after the first), and
 * every other word — "Mmm!", "McCormick" — is kept exactly as printed.
 * Casing only; the printed cell stays verbatim in the stored table.
 */
export function brandDisplayCase(printed: string): string {
  return printed
    .split(/\s+/)
    .map((word, index) => {
      if (!/^[A-Z][A-Z'&.-]+$/.test(word)) return word;
      const lower = word.toLowerCase();
      if (index > 0 && SMALL_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/** Full state names a cell lists ("AR, LA, MS, OK, TN, and TX …"). */
export function statesIn(cell: string): string[] {
  const out = new Set<string>();
  for (const token of cell.split(/[\s,;]+/)) {
    const state = normalizeStateToken(token.replace(/\.$/, ''));
    if (state) out.add(state);
  }
  if (/\bnationwide\b/i.test(cell)) out.add('Nationwide');
  return [...out].sort();
}

// ── Enrichment ──────────────────────────────────────────────────────────────

/** What one attachment yielded, for `buildEnrichment`. */
export type AttachmentReading =
  | {
      kind: 'product_list';
      url: string;
      linkText: string;
      sha256: string;
      parse: ProductListParse;
    }
  | {
      kind: 'labels';
      url: string;
      linkText: string;
      sha256: string;
      captions: { page: number; caption: string | null }[];
      /** Public URL of each stored page render (absent = not rendered). */
      renderUrls: Map<number, string>;
    }
  | {
      kind: 'product_list' | 'labels';
      url: string;
      linkText: string;
      sha256: string | null;
      unreadable: string;
    };

export interface EnrichmentInput {
  /** The notice's own product names (its product items), source order. */
  noticeProductNames: string[];
  geography: Geography;
  readings: AttachmentReading[];
}

/**
 * The verified product facts the attachments add, plus a verdict per
 * attachment. Never throws and never guesses: a disagreement or doubt is a
 * review reason and contributes nothing.
 */
export function buildEnrichment(input: EnrichmentInput): AttachmentEnrichment {
  const sources: AttachmentSource[] = [];
  const tables: AttachmentTable[] = [];
  const listProducts: TableProduct[] = [];

  for (const reading of input.readings) {
    if ('unreadable' in reading) {
      sources.push({
        url: reading.url,
        kind: reading.kind,
        linkText: reading.linkText,
        sha256: reading.sha256 ?? '',
        status: 'unreadable',
        reviewReasons: [reading.unreadable],
      });
      continue;
    }
    if (reading.kind !== 'product_list') continue;
    if (reading.parse.status !== 'verified') {
      sources.push(source(reading, 'needs_review', reading.parse.reasons));
      continue;
    }
    const products = tableProducts(reading.parse.table);
    const reasons = statesDisagreement(products, input.geography);
    if (reasons.length > 0) {
      sources.push(source(reading, 'needs_review', reasons));
      continue;
    }
    tables.push({ sourceUrl: reading.url, sha256: reading.sha256, ...reading.parse.table });
    listProducts.push(...products);
    sources.push(source(reading, 'verified', []));
  }

  // Names to match label pages against: the verified list when there is
  // one, else the notice's own product items.
  const names =
    listProducts.length > 0 ? listProducts.map((p) => p.name) : input.noticeProductNames;
  for (const reading of input.readings) {
    if ('unreadable' in reading || reading.kind !== 'labels') continue;
    const matches = matchLabelPages(reading.captions, names);
    const reasons = matches.flatMap((match) =>
      match.productIndex === null ? [`page ${match.page}: ${match.reason.replace('_', ' ')}`] : [],
    );
    const covered = new Set(
      matches.flatMap((m) => (m.productIndex === null ? [] : [m.productIndex])),
    );
    for (let index = 0; index < names.length; index++) {
      if (!covered.has(index)) reasons.push(`no label page names "${names[index]}"`);
    }
    // Matched pages reach Detail rows through their stored captions (the
    // allocator re-checks the same evidence). Never a card photo: a full
    // label page is too small to identify a product in a 112 pt tile.
    sources.push(source(reading, reasons.length === 0 ? 'verified' : 'needs_review', reasons));
  }

  return {
    version: 1,
    productDescription: listProducts.length > 0 ? productDescriptionFor(listProducts) : null,
    brands: [...new Set(listProducts.flatMap((p) => (p.brand ? [p.brand] : [])))],
    tables,
    sources,
  };
}

function source(
  reading: { kind: 'product_list' | 'labels'; url: string; linkText: string; sha256: string },
  status: AttachmentSource['status'],
  reviewReasons: string[],
): AttachmentSource {
  return {
    url: reading.url,
    kind: reading.kind,
    linkText: reading.linkText,
    sha256: reading.sha256,
    status,
    reviewReasons,
  };
}

/**
 * The PDF's states must agree with the notice's own distribution: a product
 * list naming a state the notice does not is a document we do not
 * understand, not new geography to adopt.
 */
function statesDisagreement(products: TableProduct[], geography: Geography): string[] {
  if (geography.scope !== 'states') return [];
  const notice = new Set(geography.states);
  const extra = [...new Set(products.flatMap((p) => p.states))].filter(
    (state) => state !== 'Nationwide' && !notice.has(state),
  );
  return extra.length > 0
    ? [`product list names states the notice does not: ${extra.join(', ')}`]
    : [];
}

/**
 * The product name for cards and the Detail header. One product: its own
 * printed name. Several: their names joined while they fit the shared
 * product-name limit; otherwise the push shortener's grouping —
 * `{Brand} products` for one brand, `Multiple products and brands` for more.
 */
export function productDescriptionFor(products: { name: string; brand: string | null }[]): string {
  // Cased like the brand, so prose that quotes the name verbatim ("…issued
  // for Biscuit & Sausage Gravy from…") never shouts. The printed cell stays
  // verbatim in the stored table.
  const names = [...new Set(products.map((p) => brandDisplayCase(p.name)))];
  if (names.length === 1) return names[0];
  const joined = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  if ([...joined].length <= PRODUCT_SOFT_LIMIT) return joined;
  const brands = [...new Set(products.flatMap((p) => (p.brand ? [p.brand] : [])))];
  return brands.length === 1 ? `${brands[0]} products` : MULTIPLE_PRODUCTS_AND_BRANDS;
}

/**
 * The notice's own product names, from its structured product items: the
 * source's quoted identity when it quotes one ("…of 6-piece “Bami Rolls”
 * with…" → Bami Rolls), else the whole item. Used only to match label
 * pages; never displayed by this module.
 */
export function noticeProductNames(productLines: string[]): string[] {
  return productLines.map((line) => {
    const quoted = line.match(/[“"]([^”"]{3,80})[”"]/);
    if (quoted) return quoted[1].trim();
    // "9.5 oz Biscuit & Sausage Gravy": the leading net weight is not name.
    return line
      .replace(/^[•\s]+/, '')
      .replace(/^\d+(?:\.\d+)?[-\s]?(?:oz|ounces?|lbs?|pounds?|g|kg|grams?)\.?\s+/i, '')
      .trim();
  });
}
