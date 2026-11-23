/**
 * FSIS label documents → the PRODUCT PHOTOGRAPHS inside them
 * (docs/recall-imagery.md §16).
 *
 * A label PDF is a sheet of paper; the product photographs are images placed
 * on it. A whole rendered page shrinks the package to a third of a card tile
 * (§15, measured 2026-11-16), so this module finds each placed image, crops
 * exactly that rectangle out of a high-resolution render, and decides — from
 * the document's own text, never from pixels or page position — what each
 * crop is:
 *
 *  - **product**: a package photograph. Kept.
 *  - **panel**: the text the PDF carries INSIDE the image (an OCR layer over a
 *    scanned nutrition-facts or ingredient panel) reads as panel copy. Not a
 *    product picture; dropped.
 *  - too small (a logo, a stamp, a barcode strip): dropped.
 *
 * Each kept crop carries its own caption: the printed text beside it (a
 * per-photo "SKU… NAME…" block), else the page's title text above every
 * image ("Product Labels: Grace Chicken Vienna Sausages"), else null. Text
 * inside an image is evidence for classifying it, never a caption.
 *
 * Deterministic: a pure function of the PDF bytes (pdfjs + a raster canvas,
 * no OCR, no models, no network). Rendering a crop instead of decoding the
 * embedded stream handles every image encoding pdfjs can draw (JPEG,
 * JPEG2000, JBIG2, masks) and anything drawn over the image, exactly as the
 * page shows it.
 */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { labelPageCaptions, type PdfTextItem } from './attachments';
import { MAX_PDF_BYTES } from './labels';

/** Pages read per document. Kayem's 27-page sheet is the largest observed. */
export const MAX_PHOTO_PAGES = 30;
/** Product photos kept per document, in document order. */
export const MAX_PHOTOS_PER_DOCUMENT = 40;
/** Longest edge of a stored crop, px. */
const MAX_EDGE = 1400;
/** A placed image smaller than this share of the page is a logo, stamp or strip. */
const MIN_AREA_SHARE = 0.02;
/** …or shorter than this on its short side, in rendered px. */
const MIN_SHORT_EDGE = 140;
/** Render resolution bounds (page px per PDF point). */
const MIN_SCALE = 1.5;
const MAX_SCALE = 4;
/** Rendered canvases larger than this many px are scaled down (memory bound). */
const MAX_CANVAS_PIXELS = 40_000_000;
/** Near-white threshold for trimming a crop's paper margins (0–255). */
const WHITE = 245;

export type LabelPhotoClass = 'product' | 'panel' | 'too_small';

/**
 * product: a package photograph. detail: a long strip or tall sliver (a
 * side panel, a printed date-code band) — kept for the carousel, after the
 * products, and never a card or row image.
 */
export type LabelPhotoKind = 'product' | 'detail';

/** A crop this elongated is a strip, not a package photograph. */
export const DETAIL_ASPECT = 2.4;

export function photoKind(width: number, height: number): LabelPhotoKind {
  const aspect = width / height;
  return aspect >= DETAIL_ASPECT || aspect <= 1 / DETAIL_ASPECT ? 'detail' : 'product';
}

export interface LabelPhoto {
  /** 1-based page in the source document. */
  page: number;
  /** 0-based order of the image on its page (drawing order). */
  index: number;
  /** Encoded WebP bytes of the trimmed crop. */
  bytes: Buffer;
  width: number;
  height: number;
  /** sha256 of the encoded bytes. */
  contentHash: string;
  /** 64-bit difference hash (hex) of the crop — near-duplicate detection. */
  dHash: string;
  kind: LabelPhotoKind;
  /** The printed text that names this photo, or null. Never OCR inside it. */
  caption: string | null;
  /** The image's rectangle as page fractions (x, y from top-left). */
  box: { x: number; y: number; w: number; h: number };
}

export interface LabelPhotoExtraction {
  photos: LabelPhoto[];
  numPages: number;
  /** What was dropped, by reason — never silent. */
  dropped: { panel: number; tooSmall: number; duplicate: number; overCap: number };
}

// ── Pure decisions (exported for tests) ─────────────────────────────────────

/**
 * Panel copy: nutrition-facts, ingredient and barcode wording. Two distinct
 * hits are required, so one stray word on a front label ("Protein") never
 * reclassifies a package photograph.
 */
const PANEL_TERMS = [
  /nutrition\s*facts?/i,
  /serving\s*size/i,
  /servings?\s*per/i,
  /daily\s*value/i,
  /\bcalories\b/i,
  /total\s*fat/i,
  /saturated/i,
  /cholesterol/i,
  /\bsodium\b/i,
  /carbohydrate/i,
  /\bprotein\b/i,
  /vitamin\s*d/i,
  /\bcalcium\b/i,
  /\bpotassium\b/i,
  /\bingredients?\s*:/i,
  /\bcontains\s*:/i,
];

export function isPanelText(text: string): boolean {
  let hits = 0;
  for (const term of PANEL_TERMS) if (term.test(text)) hits += 1;
  return hits >= 2;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function inside(item: { cx: number; cy: number }, box: Box): boolean {
  return (
    item.cx >= box.x && item.cx <= box.x + box.w && item.cy >= box.y && item.cy <= box.y + box.h
  );
}

/** Page-fraction text item: its centre point and text. */
export interface PlacedText {
  text: string;
  cx: number;
  cy: number;
}

/**
 * Each image's caption from the printed text OUTSIDE every image:
 *  - text above the topmost image is the page title and applies to all;
 *  - any other outside text belongs to the nearest image (by distance from
 *    the text to the image's rectangle), so a per-photo "SKU… NAME…" block
 *    names its own photo.
 * An image's own caption is its assigned text when it has any, else the page
 * title, else null.
 */
export function captionsForBoxes(boxes: Box[], texts: PlacedText[]): (string | null)[] {
  if (boxes.length === 0) return [];
  const top = Math.min(...boxes.map((b) => b.y));
  const outside = texts.filter((t) => !boxes.some((b) => inside(t, b)));
  const title: string[] = [];
  const own: string[][] = boxes.map(() => []);
  for (const text of outside) {
    if (text.cy < top) {
      title.push(text.text);
      continue;
    }
    let best = -1;
    let bestDistance = Infinity;
    boxes.forEach((b, i) => {
      const dx = Math.max(b.x - text.cx, 0, text.cx - (b.x + b.w));
      const dy = Math.max(b.y - text.cy, 0, text.cy - (b.y + b.h));
      const distance = Math.hypot(dx, dy);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    });
    if (best >= 0) own[best].push(text.text);
  }
  const clean = (parts: string[]) => {
    const caption = parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    return caption === '' ? null : caption;
  };
  const pageTitle = clean(title);
  return own.map((parts) => clean(parts) ?? pageTitle);
}

/** Hamming distance between two hex dHashes. */
export function hashDistance(a: string, b: string): number {
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      distance += x & 1;
      x >>= 1;
    }
  }
  return distance;
}

/** Two crops this close are the same photograph (re-encoded or rescaled). */
export const NEAR_DUPLICATE_BITS = 6;

// ── Extraction ──────────────────────────────────────────────────────────────

type Matrix = [number, number, number, number, number, number];
const multiply = (a: Matrix, b: number[]): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];

interface CanvasLike {
  width: number;
  height: number;
  getContext(kind: '2d'): {
    getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
    drawImage(...args: unknown[]): void;
    fillStyle: string;
    fillRect(x: number, y: number, w: number, h: number): void;
  };
  encode(format: 'webp', quality: number): Promise<Buffer>;
}

/** The non-white bounding box of a region, so paper margins never reach a card. */
function trimWhite(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (data[i] < WHITE || data[i + 1] < WHITE || data[i + 2] < WHITE) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** 9×8 grayscale difference hash of an RGBA region. */
function dHashOf(data: Uint8ClampedArray, width: number, height: number): string {
  const gray = (x: number, y: number) => {
    const sx = Math.min(width - 1, Math.floor(((x + 0.5) * width) / 9));
    const sy = Math.min(height - 1, Math.floor(((y + 0.5) * height) / 8));
    const i = (sy * width + sx) * 4;
    return data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  };
  let bits = '';
  for (let y = 0; y < 8; y += 1)
    for (let x = 0; x < 8; x += 1) bits += gray(x, y) < gray(x + 1, y) ? '1' : '0';
  let hex = '';
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

/**
 * Extract the product photographs of a label PDF, in document order:
 * page by page, then drawing order on the page. Throws on oversized or
 * unparseable input; the caller records the failure and moves on.
 */
export async function extractLabelPhotos(pdfBytes: Uint8Array): Promise<LabelPhotoExtraction> {
  if (pdfBytes.byteLength > MAX_PDF_BYTES) {
    throw new Error(`label PDF is ${pdfBytes.byteLength} bytes (cap ${MAX_PDF_BYTES})`);
  }
  const canvasModule = await import('@napi-rs/canvas');
  const g = globalThis as Record<string, unknown>;
  g.DOMMatrix ??= canvasModule.DOMMatrix;
  g.ImageData ??= canvasModule.ImageData;
  g.Path2D ??= canvasModule.Path2D;
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfjsRoot = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  const assetUrl = (part: string) => `${pathToFileURL(join(pdfjsRoot, part)).href}/`;
  const loadingTask = pdfjs.getDocument({
    data: pdfBytes.slice(),
    useSystemFonts: true,
    wasmUrl: assetUrl('wasm'),
    standardFontDataUrl: assetUrl('standard_fonts'),
    cMapUrl: assetUrl('cmaps'),
  });
  const document = await loadingTask.promise;
  const OPS = pdfjs.OPS as Record<string, number>;
  const IMAGE_OPS = new Set(
    [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat].filter(
      (op) => op !== undefined,
    ),
  );

  const photos: LabelPhoto[] = [];
  const dropped = { panel: 0, tooSmall: 0, duplicate: 0, overCap: 0 };
  const seenHashes = new Set<string>();
  const pages = Math.min(document.numPages, MAX_PHOTO_PAGES);
  try {
    for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });

      // 1. Where each image is drawn, from the page's own drawing operations.
      const operators = await page.getOperatorList();
      const stack: Matrix[] = [];
      let ctm: Matrix = [1, 0, 0, 1, 0, 0];
      const placements: { box: Box; intrinsicWidth: number | null }[] = [];
      for (let i = 0; i < operators.fnArray.length; i += 1) {
        const fn = operators.fnArray[i];
        const args = operators.argsArray[i] as unknown[];
        if (fn === OPS.save) stack.push(ctm);
        else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
        else if (fn === OPS.transform) ctm = multiply(ctm, args as number[]);
        else if (IMAGE_OPS.has(fn)) {
          // The unit square in image space, through the CTM, into the
          // viewport's top-left page space.
          const corners = [
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
          ].map(([u, v]) =>
            base.convertToViewportPoint(
              ctm[0] * u + ctm[2] * v + ctm[4],
              ctm[1] * u + ctm[3] * v + ctm[5],
            ),
          );
          const xs = corners.map((c) => c[0]);
          const ys = corners.map((c) => c[1]);
          const x0 = Math.max(0, Math.min(...xs));
          const y0 = Math.max(0, Math.min(...ys));
          const x1 = Math.min(base.width, Math.max(...xs));
          const y1 = Math.min(base.height, Math.max(...ys));
          if (x1 <= x0 || y1 <= y0) continue;
          let intrinsicWidth: number | null = null;
          if (fn === OPS.paintImageXObject && typeof args[1] === 'number') intrinsicWidth = args[1];
          placements.push({
            box: {
              x: x0 / base.width,
              y: y0 / base.height,
              w: (x1 - x0) / base.width,
              h: (y1 - y0) / base.height,
            },
            intrinsicWidth,
          });
        }
      }
      if (placements.length === 0) continue;

      // 2. The page's text, as page-fraction points.
      const content = await page.getTextContent();
      const texts: PlacedText[] = [];
      const items: PdfTextItem[] = [];
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const text = item.str.replace(/\s+/g, ' ').trim();
        if (text === '') continue;
        items.push({ text, x: item.transform[4], y: item.transform[5], width: item.width });
        const [vx, vy] = base.convertToViewportPoint(
          item.transform[4] + item.width / 2,
          item.transform[5] + (item.height ?? 0) / 2,
        );
        texts.push({ text, cx: vx / base.width, cy: vy / base.height });
      }
      const boxes = placements.map((p) => p.box);
      // A page whose one image covers it whole is a scanned sheet: its only
      // "outside" text is none, so its caption is the page caption.
      const captions = captionsForBoxes(boxes, texts);
      if (placements.length === 1 && captions[0] === null) {
        captions[0] = labelPageCaptions({
          pages: [{ page: pageNumber, items }],
          numPages: document.numPages,
        })[0].caption;
        if (captions[0] !== null && isPanelText(captions[0])) captions[0] = null;
      }

      // 3. Render once, at the resolution the images need.
      const wanted = Math.max(
        MIN_SCALE,
        ...placements.map((p) =>
          p.intrinsicWidth ? p.intrinsicWidth / (p.box.w * base.width) : MIN_SCALE,
        ),
      );
      let scale = Math.min(MAX_SCALE, wanted);
      if (base.width * base.height * scale * scale > MAX_CANVAS_PIXELS) {
        scale = Math.sqrt(MAX_CANVAS_PIXELS / (base.width * base.height));
      }
      const viewport = page.getViewport({ scale });
      const canvas = canvasModule.createCanvas(
        Math.round(viewport.width),
        Math.round(viewport.height),
      ) as unknown as CanvasLike;
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;

      // 4. Classify, crop, trim, dedupe.
      for (const [index, { box }] of placements.entries()) {
        const inner = texts
          .filter((t) => inside(t, box))
          .map((t) => t.text)
          .join(' ');
        if (isPanelText(inner)) {
          dropped.panel += 1;
          continue;
        }
        const px = Math.floor(box.x * canvas.width);
        const py = Math.floor(box.y * canvas.height);
        const pw = Math.max(1, Math.floor(box.w * canvas.width));
        const ph = Math.max(1, Math.floor(box.h * canvas.height));
        const region = context.getImageData(px, py, pw, ph);
        const trim = trimWhite(region.data, pw, ph);
        if (box.w * box.h < MIN_AREA_SHARE || Math.min(trim.w, trim.h) < MIN_SHORT_EDGE) {
          dropped.tooSmall += 1;
          continue;
        }
        const ratio = Math.min(1, MAX_EDGE / Math.max(trim.w, trim.h));
        const out = canvasModule.createCanvas(
          Math.max(1, Math.round(trim.w * ratio)),
          Math.max(1, Math.round(trim.h * ratio)),
        ) as unknown as CanvasLike;
        const outContext = out.getContext('2d');
        outContext.fillStyle = '#ffffff';
        outContext.fillRect(0, 0, out.width, out.height);
        outContext.drawImage(
          canvas,
          px + trim.x,
          py + trim.y,
          trim.w,
          trim.h,
          0,
          0,
          out.width,
          out.height,
        );
        const pixels = outContext.getImageData(0, 0, out.width, out.height).data;
        const dHash = dHashOf(pixels, out.width, out.height);
        const bytes = await out.encode('webp', 84);
        const contentHash = createHash('sha256').update(bytes).digest('hex');
        if (
          seenHashes.has(contentHash) ||
          photos.some((p) => hashDistance(p.dHash, dHash) <= NEAR_DUPLICATE_BITS)
        ) {
          dropped.duplicate += 1;
          continue;
        }
        if (photos.length >= MAX_PHOTOS_PER_DOCUMENT) {
          dropped.overCap += 1;
          continue;
        }
        seenHashes.add(contentHash);
        photos.push({
          page: pageNumber,
          index,
          bytes,
          width: out.width,
          height: out.height,
          contentHash,
          dHash,
          kind: photoKind(out.width, out.height),
          caption: captions[index],
          box,
        });
      }
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }
  return { photos, numPages: document.numPages, dropped };
}

// ── Image files (a linked .jpg/.png, an <img> in the announcement) ──────────

/**
 * One photograph from an image file: decoded, paper margins trimmed, stored
 * as WebP. No caption: a link's own words ("View Label") never name a
 * product, so an image file is never matched to a variety on its own.
 */
export async function extractImageFilePhoto(bytes: Uint8Array): Promise<LabelPhotoExtraction> {
  const canvasModule = await import('@napi-rs/canvas');
  const image = await canvasModule.loadImage(Buffer.from(bytes));
  // A few hundred bytes can declare a vast image: decode no further than the
  // render bound the PDF path uses.
  if (image.width * image.height > MAX_CANVAS_PIXELS) {
    throw new Error(`image is ${image.width}×${image.height} px (cap ${MAX_CANVAS_PIXELS} px)`);
  }
  const source = canvasModule.createCanvas(image.width, image.height) as unknown as CanvasLike;
  const sourceContext = source.getContext('2d');
  sourceContext.fillStyle = '#ffffff';
  sourceContext.fillRect(0, 0, source.width, source.height);
  sourceContext.drawImage(image, 0, 0);
  const region = sourceContext.getImageData(0, 0, source.width, source.height);
  const trim = trimWhite(region.data, source.width, source.height);
  const dropped = { panel: 0, tooSmall: 0, duplicate: 0, overCap: 0 };
  if (Math.min(trim.w, trim.h) < MIN_SHORT_EDGE) {
    dropped.tooSmall = 1;
    return { photos: [], numPages: 1, dropped };
  }
  const ratio = Math.min(1, MAX_EDGE / Math.max(trim.w, trim.h));
  const out = canvasModule.createCanvas(
    Math.max(1, Math.round(trim.w * ratio)),
    Math.max(1, Math.round(trim.h * ratio)),
  ) as unknown as CanvasLike;
  const context = out.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, out.width, out.height);
  context.drawImage(source, trim.x, trim.y, trim.w, trim.h, 0, 0, out.width, out.height);
  const pixels = context.getImageData(0, 0, out.width, out.height).data;
  const encoded = await out.encode('webp', 84);
  return {
    photos: [
      {
        page: 1,
        index: 0,
        bytes: encoded,
        width: out.width,
        height: out.height,
        contentHash: createHash('sha256').update(encoded).digest('hex'),
        dHash: dHashOf(pixels, out.width, out.height),
        kind: photoKind(out.width, out.height),
        caption: null,
        box: { x: 0, y: 0, w: 1, h: 1 },
      },
    ],
    numPages: 1,
    dropped,
  };
}

// ── Discovery: which links lead to product images ──────────────────────────

export type LabelSourceKind = 'pdf' | 'image' | 'page';

export interface LabelPhotoSource {
  url: string;
  kind: LabelSourceKind;
  /** The link's own words, or "inline image" for an <img> in the notice. */
  linkText: string;
}

/**
 * Words that say a link leads to pictures of the product: "View Labels",
 * "Product Labels", "Photos", "Product label photos", "Larger images",
 * "Pictures". Matched on the link's own text or, for a bare link ("here"),
 * on its file name.
 */
const PICTURE_WORDS = /\b(?:labels?|photos?|photographs?|images?|pictures?)\b/i;
const PICTURE_FILE = /(?:labels?|photos?|images?)[^/]*$/i;
/** FSIS publishes label documents under this path. */
const LABEL_FOLDER = /\/food_label_pdf\//i;
/**
 * Distribution and store lists. A product list in the label folder is still
 * read: the extractor keeps only placed photographs, so a pure table yields
 * nothing, and a list that carries labels yields its pictures.
 */
const DISTRIBUTION_LIST =
  /distro_list|\bdistribution\b|\bretail(?:er)?s?\s*list\b|\bstores?\s*list\b/i;
const IMAGE_FILE = /\.(?:jpe?g|png|gif|webp)(?:[?#].*)?$/i;
const PDF_FILE = /\.pdf(?:[?#].*)?$/i;

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}

/**
 * The official sources of product pictures an announcement links or embeds,
 * in the order the announcement presents them. Only approved FSIS hosts, via
 * the one canonical URL resolver; in-page fragments ("#label") are not
 * sources (their pictures are the announcement's own <img> tags, read here).
 */
export function discoverLabelPhotoSources(
  summaryHtml: string | null,
  resolve: (raw: string) => string | null,
): LabelPhotoSource[] {
  if (!summaryHtml) return [];
  const out: LabelPhotoSource[] = [];
  const seen = new Set<string>();
  const add = (raw: string, linkText: string, inline: boolean) => {
    const href = decodeEntities(raw).trim();
    if (href === '' || href.startsWith('#')) return;
    const url = resolve(href);
    if (!url || seen.has(url)) return;
    const kind: LabelSourceKind = IMAGE_FILE.test(url)
      ? 'image'
      : PDF_FILE.test(url)
        ? 'pdf'
        : 'page';
    if (!inline) {
      const file = url.split('?')[0];
      // FSIS's own label folder, or words that say pictures — in the link or
      // its file name. "The complete list of products and product labels"
      // qualifies; a list that says nothing about pictures never does.
      const labelFolder = LABEL_FOLDER.test(file);
      const saysPictures = PICTURE_WORDS.test(linkText) || PICTURE_FILE.test(file);
      if (!labelFolder && !saysPictures) return;
      // Distribution and store lists never carry pictures, wherever they sit.
      if (!saysPictures && DISTRIBUTION_LIST.test(`${linkText} ${file}`)) return;
      // A bare page link qualifies only on its own words, never its path.
      if (kind === 'page' && !PICTURE_WORDS.test(linkText)) return;
    } else if (kind !== 'image') {
      return;
    }
    seen.add(url);
    out.push({ url, kind, linkText: inline ? 'inline image' : linkText.slice(0, 120) });
  };
  const tags =
    /<a\b[^>]*\bhref\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>|<img\b[^>]*\bsrc\s*=\s*"([^"]+)"[^>]*>/gi;
  for (const match of summaryHtml.matchAll(tags)) {
    if (match[1] !== undefined) {
      const text = decodeEntities(match[2].replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim();
      add(match[1], text, false);
    } else if (match[3] !== undefined) {
      add(match[3], 'inline image', true);
    }
  }
  return out;
}

/**
 * The <img> sources on a linked label PAGE, resolved like the notice's own
 * links. Images inside navigation, headers and footers are page furniture,
 * not product pictures, and are skipped; so are icons and logos by name.
 */
export function pageImageSources(html: string, resolve: (raw: string) => string | null): string[] {
  const body = html
    .replace(/<(nav|header|footer|script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const out: string[] = [];
  for (const match of body.matchAll(/<img\b[^>]*\bsrc\s*=\s*"([^"]+)"[^>]*>/gi)) {
    const url = resolve(decodeEntities(match[1]).trim());
    if (!url || out.includes(url)) continue;
    if (/(?:logo|icon|sprite|seal|banner|social)/i.test(url.split('/').pop() ?? '')) continue;
    out.push(url);
  }
  return out;
}
