/**
 * FSIS label PDFs → product visuals.
 *
 * FSIS notices carry no inline product photography; the official "view
 * labels" PDF is the primary visual source (verified across the benchmark
 * corpus). This module turns those PDFs into web-ready page images once,
 * server-side, so the consumer sees the label in the ordinary Product Photos
 * gallery instead of being sent to open a PDF.
 *
 * Deterministic by construction:
 *  - page rendering is a pure function of the PDF bytes (pdfjs + a raster
 *    canvas — no OCR, no models, no network),
 *  - the storage key embeds the PDF's content hash and page number, so
 *    re-processing an unchanged PDF reproduces the same objects and a changed
 *    PDF produces new ones (idempotent, stale assets identifiable by key),
 *  - identical rendered pages (duplicate label pages inside one PDF) are
 *    dropped by rendered-content hash, preserving page order.
 *
 * The original PDF URL remains the provenance link; nothing here replaces it.
 */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { FSIS_HOSTS, resolveOfficialUrl } from '../../lib/official-urls';

export interface RenderedLabelPage {
  /** 1-based page number in the source PDF (source order preserved). */
  page: number;
  /** Encoded WebP bytes. */
  bytes: Buffer;
  width: number;
  height: number;
  /** sha256 of the rendered bytes — duplicate pages collapse on this. */
  contentHash: string;
}

/**
 * Operational bounds. A label PDF is a handful of pages — but those pages
 * are frequently raw scans, and the C9 failure audit measured five real
 * FSIS label documents between 21 MB and 52 MB rejected by the previous
 * 15 MB cap. The cap bounds a single download, not the output: rendering
 * stays capped at MAX_PAGES_RENDERED whatever the document size, each PDF
 * is fetched once per content revision, and anything past 64 MB is not a
 * label sheet.
 */
export const MAX_PDF_BYTES = 64 * 1024 * 1024;
export const MAX_PAGES_RENDERED = 6;
/** Rendered page width target, px. Labels stay readable; files stay small. */
const TARGET_WIDTH = 1024;
/** An encoded page smaller than this is blank (observed blank pages ≈ 1KB). */
const MIN_ENCODED_BYTES = 2048;

/**
 * Official FSIS label PDF URLs from a notice's own summary HTML. Only
 * fsis.usda.gov-hosted label PDFs qualify (`food_label_pdf` path or a
 * label-named file) — the distribution-list PDFs are tabular documents, not
 * visuals.
 *
 * Resolution goes through the one canonical resolver (lib/official-urls),
 * which classifies absolute, protocol-relative, root-relative, and ordinary
 * relative hrefs per WHATWG semantics and repairs the historical
 * duplicated-host defect (`https://www.fsis.usda.gov//www.fsis.usda.gov/…`)
 * that a protocol-relative href used to produce here.
 */
export function extractLabelPdfUrls(summaryHtml: string | null): string[] {
  if (!summaryHtml) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of summaryHtml.matchAll(/href="([^"]+\.pdf(?:[?#][^"]*)?)"/gi)) {
    const raw = match[1].replace(/&amp;/g, '&').trim();
    const resolved = resolveOfficialUrl(raw, { approvedHosts: FSIS_HOSTS });
    if (!resolved) continue;
    const url = resolved.url;
    if (!/food_label_pdf|labels?[^/]*\.pdf$/i.test(url)) continue;
    if (/distro_list|distribution/i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

/** Deterministic storage key: content-addressed, so re-runs cannot duplicate. */
export function labelAssetKey(pdfSha256: string, page: number): string {
  return `fsis-labels/${pdfSha256.slice(0, 20)}/p${page}.webp`;
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export interface RenderedLabelPdf {
  pages: RenderedLabelPage[];
  /** Total pages in the source document (before caps and dedup). */
  numPages: number;
}

/**
 * Rasterize a label PDF's pages to WebP. Pages are rendered in order up to
 * `maxPages`; blank pages and exact duplicates are dropped. Throws on
 * oversized or unparseable input — the caller reports and moves on, and the
 * consumer keeps the PDF link either way.
 */
export async function renderLabelPdf(
  pdfBytes: Uint8Array,
  maxPages: number = MAX_PAGES_RENDERED,
): Promise<RenderedLabelPdf> {
  if (pdfBytes.byteLength > MAX_PDF_BYTES) {
    throw new Error(`label PDF is ${pdfBytes.byteLength} bytes (cap ${MAX_PDF_BYTES})`);
  }
  // pdfjs expects a browser-ish global surface; @napi-rs/canvas supplies it.
  const canvasModule = await import('@napi-rs/canvas');
  const g = globalThis as Record<string, unknown>;
  g.DOMMatrix ??= canvasModule.DOMMatrix;
  g.ImageData ??= canvasModule.ImageData;
  g.Path2D ??= canvasModule.Path2D;
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Scanned label PDFs embed JPEG2000/JBIG2 images, which pdfjs decodes via
  // packaged WASM modules; without these URLs those pages render blank.
  const pdfjsRoot = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  const assetUrl = (part: string) => `${pathToFileURL(join(pdfjsRoot, part)).href}/`;

  // pdfjs takes ownership of the buffer; copy so callers keep theirs.
  const loadingTask = pdfjs.getDocument({
    data: pdfBytes.slice(),
    useSystemFonts: true,
    wasmUrl: assetUrl('wasm'),
    standardFontDataUrl: assetUrl('standard_fonts'),
    cMapUrl: assetUrl('cmaps'),
  });
  const document = await loadingTask.promise;

  const out: RenderedLabelPage[] = [];
  const seenHashes = new Set<string>();
  const numPages = document.numPages;
  const pages = Math.min(numPages, maxPages);
  for (let pageNumber = 1; pageNumber <= pages; pageNumber++) {
    const page = await document.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2.5, Math.max(0.5, TARGET_WIDTH / base.width));
    const viewport = page.getViewport({ scale });
    const canvas = canvasModule.createCanvas(
      Math.round(viewport.width),
      Math.round(viewport.height),
    );
    const context = canvas.getContext('2d');
    // A white ground: label PDFs assume paper, and transparent WebP renders
    // black in some viewers.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    const bytes = await canvas.encode('webp', 82);
    if (bytes.byteLength < MIN_ENCODED_BYTES) continue; // blank page
    const contentHash = sha256(bytes);
    if (seenHashes.has(contentHash)) continue; // duplicate page
    seenHashes.add(contentHash);
    out.push({
      page: pageNumber,
      bytes,
      width: canvas.width,
      height: canvas.height,
      contentHash,
    });
  }
  await loadingTask.destroy();
  return { pages: out, numPages };
}
