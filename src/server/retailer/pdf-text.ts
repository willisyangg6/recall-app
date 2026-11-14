/**
 * Text extraction for retailer notice PDFs, with the `pdfjs-dist` already used
 * (server-only) by the FSIS label renderer — no new dependency.
 *
 * Text only: no rendering, no canvas, no OCR. A scanned letter (Costco's
 * Punahele notice is a photographed page) yields almost no text and is
 * reported as `image_only`, which the decision step sends to human review.
 * Nothing is ever read off an image by guesswork.
 */

import type { DocumentExtraction } from './types';

/** Retailer letters are 1–2 pages; anything far larger is not a member letter. */
export const MAX_NOTICE_PDF_BYTES = 8 * 1024 * 1024;
const MAX_PAGES = 6;
/** Below this many letters (a-z) of text, the page is a scan, not a letter. */
const MIN_LETTERS_FOR_TEXT = 80;

export interface ExtractedPdfText {
  extraction: DocumentExtraction;
  text: string;
  pages: number;
  error?: string;
}

export function isPdf(bytes: Uint8Array): boolean {
  return (
    bytes.length > 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  );
}

export async function extractPdfText(bytes: Uint8Array): Promise<ExtractedPdfText> {
  if (bytes.byteLength > MAX_NOTICE_PDF_BYTES) {
    return { extraction: 'failed', text: '', pages: 0, error: `PDF is ${bytes.byteLength} bytes` };
  }
  if (!isPdf(bytes)) {
    return { extraction: 'failed', text: '', pages: 0, error: 'not a PDF' };
  }
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    // pdfjs takes ownership of the buffer; copy so callers keep theirs.
    const loadingTask = pdfjs.getDocument({
      data: bytes.slice(),
      useSystemFonts: false,
      // Text extraction needs no glyph data; without this pdfjs warns per
      // font that it cannot render standard fonts, which this never does.
      verbosity: 0,
    });
    const document = await loadingTask.promise;
    let text = '';
    const pages = Math.min(document.numPages, MAX_PAGES);
    for (let pageNumber = 1; pageNumber <= pages; pageNumber++) {
      const content = await (await document.getPage(pageNumber)).getTextContent();
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str;
        if (item.hasEOL) text += '\n';
      }
      text += '\n';
    }
    const totalPages = document.numPages;
    await loadingTask.destroy();
    const letters = (text.match(/[a-z]/gi) ?? []).length;
    return {
      extraction: letters < MIN_LETTERS_FOR_TEXT ? 'image_only' : 'text',
      text: text.replace(/[ \t]+\n/g, '\n').trim(),
      pages: totalPages,
    };
  } catch (error) {
    return {
      extraction: 'failed',
      text: '',
      pages: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
