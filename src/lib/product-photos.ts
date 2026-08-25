/**
 * Consumer Projection V2 — official product photography, classified by role.
 *
 * Product photos are primary recognition information, not decoration: seeing
 * the package is often the fastest way for someone to answer "is this the
 * thing in my cupboard?". They are extracted at display time from the
 * announcement's own preserved HTML, so every already-persisted case gains
 * them without re-ingestion.
 *
 * Only authoritative agency-hosted image URLs are referenced — bytes are never
 * copied or rehosted. Verified across a 160-announcement sample: every product
 * photo lives under `/files/…` on www.fda.gov, all 536 of them carry explicit
 * width/height, with no duplicates and no page chrome mixed in.
 *
 * The system does not sort images into "product" and "not product". It assigns
 * a ROLE, because the same image can be exactly right in one place and wrong
 * in another: a barcode macro is useless for spotting a package on a shelf but
 * ideal when someone is comparing the code in their hand. Crucially, a
 * photograph of a package LABEL that happens to include a barcode is a package
 * image, not a barcode crop — for the Dairyland Produce jalapeños it is the
 * only visual FDA supplies, and demoting it would leave the recall with no
 * recognizable picture at all.
 */

import { decodeEntities } from '@/domain/text';

/**
 * What an image is FOR. Assigned only from deterministic signals the source
 * itself provides: its own alt text, its published dimensions, its filename,
 * and its position among the other images.
 */
export type PhotoRole =
  | 'package_front'
  | 'package_full'
  | 'package_back'
  | 'package_label'
  | 'product_only'
  | 'barcode_closeup'
  | 'code_closeup'
  | 'other_supporting';

export interface ProductPhoto {
  /** Authoritative agency-hosted URL (never rehosted). */
  url: string;
  /** The source's own alt text, when present. */
  alt: string | null;
  /** Source order within the announcement — the agency's own presentation. */
  order: number;
  /** What this image is useful for. */
  role: PhotoRole;
  /** Published pixel dimensions, when the source states them. */
  width: number | null;
  height: number | null;
  /** width ÷ height, when both are known. Drives layout, not classification. */
  aspectRatio: number | null;
}

/** Roles that answer "is this the product?" — the always-visible gallery. */
const RECOGNITION_ROLES: ReadonlySet<PhotoRole> = new Set<PhotoRole>([
  'package_front',
  'package_full',
  'package_label',
  'product_only',
  'package_back',
]);

/** Roles that answer "is this my package?" — the identifier comparison step. */
const COMPARISON_ROLES: ReadonlySet<PhotoRole> = new Set<PhotoRole>([
  'barcode_closeup',
  'code_closeup',
]);

/** Words naming an identifier rather than a product. */
const CODE_WORDS =
  /\b(upc|barcode|bar\s?code|lot|batch|date\s?code|production\s?code|best\s?(?:before|by|if\s+used\s+by)|use\s?by|sell\s?by|expiration|expiry|codes?|numbers?|bottom|top|side|back|front|of|the|and|on|package|packaging|label|labeling|image|photo|picture|closeup|close-up|no|nos?)\b/gi;

/** Page furniture that must never be presented as a product photo. */
const NON_PRODUCT =
  /\b(logo|banner|icon|sprite|spacer|pixel|footer|header|social|twitter|facebook|flickr|seal|feedback)\b/i;

/**
 * How much of the alt text is left once identifier vocabulary, digits, and
 * punctuation are removed. "UPC Bottom of package: 041548610047" leaves
 * nothing — the caption describes a code and only a code. "Dairyland Produce
 * Pepper Jalapeno BX #5 label example" leaves a product, which is why that
 * image stays a package photo even though the label it shows carries a barcode.
 */
function residualWords(altText: string): string[] {
  return altText
    .replace(CODE_WORDS, ' ')
    .replace(/[\d#:;,.\-–—()[\]"'’“”/&]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 2);
}

/**
 * A code crop is small AND captioned as nothing but a code. Both conditions
 * are required: real label photographs are frequently wide and short too
 * (480×170 is a common FDA label shot), so dimensions alone would throw away
 * exactly the images consumers most need.
 */
function isCodeCrop(altText: string, width: number | null, height: number | null): boolean {
  const captionIsCodeOnly = altText !== '' && residualWords(altText).length === 0;
  if (!captionIsCodeOnly) return false;
  if (width === null || height === null) return true;
  const area = width * height;
  // Observed barcode crops run ~172×80 to ~266×145 (13k–39k px²); package and
  // label photographs in the same corpus start around 50k px².
  return area <= 45_000 || (width <= 320 && height <= 200);
}

function classify(
  altText: string,
  fileName: string,
  width: number | null,
  height: number | null,
): PhotoRole {
  const alt = altText.toLowerCase();
  const file = fileName.toLowerCase();

  // A caption that describes nothing but an identifier means the photograph is
  // of that identifier — whatever its size. The size test only decides how
  // confidently a *small* image qualifies.
  const codeOnlyCaption = altText !== '' && residualWords(altText).length === 0;
  if (
    codeOnlyCaption &&
    (isCodeCrop(altText, width, height) || /\b(lot|batch|date|code|upc)\b/.test(alt))
  ) {
    return /\b(upc|barcode|bar\s?code)\b/.test(alt) || /\bupc\b/.test(file)
      ? 'barcode_closeup'
      : 'code_closeup';
  }

  if (/\bunpackaged\b|\bproduct only\b|\bunwrapped\b|\bloose\b/.test(alt)) return 'product_only';
  if (/\bback\b|\breverse\b|\brear\b/.test(alt)) return 'package_back';
  if (/\blabel(?:ing|ling)?\b|\btag\b|\bsticker\b/.test(alt)) return 'package_label';
  if (/\bfront\b/.test(alt)) return 'package_front';
  if (alt !== '') return 'package_full';
  return 'other_supporting';
}

/**
 * Extract product photos from an announcement's preserved body HTML.
 * Non-agency-hosted assets, inline `data:` images, page furniture, and
 * duplicate images (by URL and by underlying filename) are excluded.
 */
export function extractProductPhotos(summaryHtml: string | null): ProductPhoto[] {
  if (!summaryHtml) return [];
  const photos: ProductPhoto[] = [];
  const seenUrls = new Set<string>();
  const seenFiles = new Set<string>();

  for (const tag of summaryHtml.matchAll(/<img\b[^>]*>/gi)) {
    const html = tag[0];
    const src = html.match(/\bsrc\s*=\s*"([^"]+)"/i)?.[1];
    if (!src) continue;
    const raw = decodeEntities(src).trim();
    if (raw.startsWith('data:')) continue; // tracking pixels / inline spacers
    // Agency-hosted assets only; a relative /files/ path is the observed form.
    if (!/^\/files\//.test(raw) && !/^https?:\/\/[^/]*\.fda\.gov\/files\//i.test(raw)) continue;

    const url = raw.startsWith('http') ? raw : `https://www.fda.gov${raw}`;
    const alt = html.match(/\balt\s*=\s*"([^"]*)"/i)?.[1];
    const altText = alt ? decodeEntities(alt).replace(/\s+/g, ' ').trim() : '';
    const fileName = decodeURIComponent(url.replace(/\?.*$/, '').replace(/^.*\//, ''));

    if (NON_PRODUCT.test(altText) || NON_PRODUCT.test(fileName)) continue;
    if (seenUrls.has(url) || seenFiles.has(fileName)) continue;
    seenUrls.add(url);
    seenFiles.add(fileName);

    const width = Number(html.match(/\bwidth\s*=\s*"?(\d+)"?/i)?.[1] ?? '') || null;
    const height = Number(html.match(/\bheight\s*=\s*"?(\d+)"?/i)?.[1] ?? '') || null;

    photos.push({
      url,
      alt: altText === '' ? null : altText,
      order: photos.length,
      role: classify(altText, fileName, width, height),
      width,
      height,
      aspectRatio: width !== null && height !== null && height > 0 ? width / height : null,
    });
  }
  return photos;
}

/**
 * The always-visible gallery: images that help a person recognize the product,
 * in the agency's own order. Barcode and date-code crops are deliberately
 * excluded — between two package photos they read as noise, and they belong in
 * the package checker where the consumer is actually comparing codes.
 */
export function galleryPhotos(photos: ProductPhoto[]): ProductPhoto[] {
  const recognizable = photos.filter((photo) => RECOGNITION_ROLES.has(photo.role));
  // Never leave a recall with no picture: if the only images are close-ups,
  // the close-up is still better than nothing.
  return recognizable.length > 0 ? recognizable : photos;
}

/**
 * The photo to lead with: the first recognizable package shot in the agency's
 * own order, which is also the only kind of image a feed thumbnail may use.
 */
export function primaryPhoto(photos: ProductPhoto[]): ProductPhoto | null {
  return galleryPhotos(photos)[0] ?? null;
}

/**
 * Photos most useful for verifying a package in hand: code and date close-ups
 * first — here they are exactly what the consumer needs — then the package
 * shot for orientation. Capped so the checker stays scannable and never
 * re-dumps the whole gallery.
 */
export function packageCheckPhotos(photos: ProductPhoto[], limit = 3): ProductPhoto[] {
  const closeUps = photos.filter((photo) => COMPARISON_ROLES.has(photo.role));
  const primary = primaryPhoto(photos);
  const ordered = [...closeUps];
  if (primary && !ordered.includes(primary)) ordered.unshift(primary);
  return ordered.slice(0, limit);
}

export { RECOGNITION_ROLES, COMPARISON_ROLES };
