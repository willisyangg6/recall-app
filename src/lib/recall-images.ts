/**
 * Global image-role allocation (P2c).
 *
 * One pure, deterministic owner for how a recall's official imagery is split
 * into visible roles: exactly one hero, at most one image per affected-product
 * row, and a deduplicated gallery for the future carousel. Screens consume the
 * allocation; they never rank, match, clean, or deduplicate images themselves.
 *
 * What this module does NOT do:
 *  - It never selects a different hero than the stored authoritative one.
 *    `projection.heroImageUrl` is the frozen selection policy (an official FDA
 *    photograph or nothing — docs/recall-imagery.md); this layer only resolves
 *    that URL into the normalized image set and enforces role exclusivity.
 *  - It never guesses a row match. An image reaches an affected-product row
 *    only through source-established association (the projection's own
 *    evidence-gated attachment) or an official caption that identifies that
 *    exact row uniquely. Array position alone is never evidence.
 *  - It never invents imagery. Absence stays absence — a null hero and an
 *    empty map render nothing.
 *
 * An asset cannot occupy multiple visible roles except for ONE deliberate,
 * evidence-proven reuse: in a multi-version table, the hero may also render
 * as the thumbnail of exactly the row it provably depicts (case hero and
 * exact-version thumbnail are two different contexts). Every other pairing
 * stays exclusive: never hero plus gallery entry, never hero plus supporting,
 * never two rows, never two gallery entries — and the hero is never given to
 * a row to fill space, by position, or in a single-row table (where the one
 * row is the product the hero already shows).
 */

import {
  RECOGNITION_ROLES,
  galleryPhotos,
  type PhotoRole,
  type ProductPhoto,
} from './product-photos';
import { captionContradictsPackage, captionSizeKeys, measurementKey } from './variant-identity';

// ── Model ───────────────────────────────────────────────────────────────────

export type RecallImageSource = 'fda_announcement' | 'fsis_label_render';

/** One normalized official image, with enough provenance to explain itself. */
export interface RecallImage {
  /** Authoritative official URL — the stable asset identity (byte-stable by
   * the official-urls contract; never rehosted). */
  url: string;
  source: RecallImageSource;
  /** The source's own caption (alt text). Label renders carry none — their
   * stored alt is our wording, not official text. */
  caption: string | null;
  /** Suitability classification from the source's own signals
   * (product-photos roles). Null only for a stored hero URL that is not among
   * the currently extracted photos (e.g. a merged multi-record case). */
  classification: PhotoRole | null;
  width: number | null;
  height: number | null;
  aspectRatio: number | null;
}

/** Why an image was assigned to an affected-product row. Closed set — every
 * mechanism is official-evidence-based; positional guessing has no value. */
export type RowImageEvidence =
  /** The projection's own source-established association (the source's table
   * deferred its rows to the images, or a caption named the version — the
   * evidence-gated P2b attachment). */
  | 'source_row'
  /** An official caption contains this row's exact product identity, and the
   * pairing is unambiguous across all rows and photos. */
  | 'caption_name'
  /** An official caption contains this row's product identity AND states this
   * row's exact package size — the strongest caption pairing, used when
   * sibling rows share a name and only the size tells them apart. */
  | 'caption_name_size';

export interface RowImageAssignment {
  image: RecallImage;
  evidence: RowImageEvidence;
  /** Conservative factual accessibility text, derived only from the row's own
   * supported identity (its product name, plus its size when stated). Never
   * from the caption, so no unvetted claim can ride in. */
  accessibilityText: string;
}

export interface RecallImageAllocation {
  /** Zero or one official hero — the stored authoritative selection, resolved
   * into the normalized set. Null renders nothing. */
  hero: RecallImage | null;
  /** At most one image per affected-product row, keyed by the stable P2b row
   * identity. A row absent from the map renders no image and no placeholder. */
  rowImages: ReadonlyMap<string, RowImageAssignment>;
  /** Remaining unique suitable official images, in deterministic order
   * (announcement photos in source order, then label renders): the future
   * carousel's candidates. Never contains the hero or a row image. */
  gallery: RecallImage[];
  /** Retained non-visible supporting assets (identifier close-ups and other
   * supplementary images) — preserved for the package-comparison surface,
   * never rendered as product imagery. */
  supporting: RecallImage[];
}

/** What the allocator needs to know about one affected-product row. */
export interface RowImageCandidate {
  /** The stable P2b row identity (the projection's source-row scope). */
  rowId: string;
  /** The row's rendered product identity; a null (demoted) name can never be
   * matched — there is no identity to match against. */
  name: string | null;
  /** The row's own Package Size value when it states exactly one; null
   * otherwise (a merged multi-size cell is not a matchable size). */
  size: string | null;
  /** The row's own Barcode (UPC) value, when the source states one. */
  upc: string | null;
  /** URL of the photo the projection's source-established matching attached
   * to this row, when it did. */
  sourcePhotoUrl: string | null;
}

// ── Normalization ───────────────────────────────────────────────────────────

function fromProductPhoto(photo: ProductPhoto, source: RecallImageSource): RecallImage {
  return {
    url: photo.url,
    source,
    // A label render's alt is our own wording; only announcement alt text is
    // an official caption.
    caption: source === 'fda_announcement' ? photo.alt : null,
    classification: photo.role,
    width: photo.width,
    height: photo.height,
    aspectRatio: photo.aspectRatio,
  };
}

// ── Caption matching ────────────────────────────────────────────────────────

/** Minimum identity-key length for caption matching — the same floor the
 * projection's caption matcher uses; shorter keys match too promiscuously. */
const MIN_NAME_KEY = 6;

function captionContainsName(caption: string, nameKey: string): boolean {
  return measurementKey(caption).includes(nameKey);
}

// ── Allocation ──────────────────────────────────────────────────────────────

export function allocateRecallImages(input: {
  /** The stored authoritative hero selection (frozen policy) — or null. */
  heroImageUrl: string | null;
  /** The complete extracted official announcement photo set. */
  photos: ProductPhoto[];
  /** Official FSIS label-PDF renders (detail evidence, never heroes). */
  labelVisuals: ProductPhoto[];
  /** The affected-product rows, in presentation order. */
  rows: RowImageCandidate[];
}): RecallImageAllocation {
  // Deduplicate before assigning any role: one normalized image per URL, in
  // deterministic order (announcement photos first, in source order, then
  // label renders). Within-announcement URL/filename dedup already happened at
  // extraction; this pass guarantees it globally.
  const byUrl = new Map<string, RecallImage>();
  for (const photo of input.photos) {
    if (!byUrl.has(photo.url)) byUrl.set(photo.url, fromProductPhoto(photo, 'fda_announcement'));
  }
  for (const visual of input.labelVisuals) {
    if (!byUrl.has(visual.url))
      byUrl.set(visual.url, fromProductPhoto(visual, 'fsis_label_render'));
  }

  // The hero is the stored authoritative selection, never re-ranked here. A
  // hero URL outside the currently extracted set (a merged multi-record case)
  // still renders — with null classification, honestly stating that this
  // build could not re-derive its provenance from the preserved HTML.
  const hero: RecallImage | null = input.heroImageUrl
    ? (byUrl.get(input.heroImageUrl) ?? {
        url: input.heroImageUrl,
        source: 'fda_announcement',
        caption: null,
        classification: null,
        width: null,
        height: null,
        aspectRatio: null,
      })
    : null;

  // Row-assignable pool: strictly recognizable announcement images. Identifier
  // close-ups, supplementary shots, and label renders are never row imagery.
  // The hero is row-assignable ONLY in a multi-version table — there it may
  // back exactly the row it provably depicts (controlled reuse across two
  // contexts), through the same evidence gates as any other image. In a
  // single-row table it stays hero-only: repeating the same image
  // immediately below the title adds nothing.
  const heroRowEligible = input.rows.length >= 2;
  const pool = input.photos.filter(
    (photo) => RECOGNITION_ROLES.has(photo.role) && (heroRowEligible || photo.url !== hero?.url),
  );
  const used = new Set<string>();
  const rowImages = new Map<string, RowImageAssignment>();

  const assign = (row: RowImageCandidate, photo: ProductPhoto, evidence: RowImageEvidence) => {
    used.add(photo.url);
    rowImages.set(row.rowId, {
      image: byUrl.get(photo.url) ?? fromProductPhoto(photo, 'fda_announcement'),
      evidence,
      // Only the row's own supported identity — never caption prose, so no
      // unvetted product claim can reach assistive technology. A row without
      // a name gets an honest generic label.
      accessibilityText:
        row.name === null
          ? 'Official image of this affected product'
          : row.size
            ? `${row.name}, ${row.size}`
            : row.name,
    });
  };

  // Pass 1 — source-established association: the projection's own
  // evidence-gated attachment (table deferral to images, caption-named
  // versions). One image can back at most one row.
  for (const row of input.rows) {
    if (!row.sourcePhotoUrl || rowImages.has(row.rowId)) continue;
    const photo = pool.find((p) => p.url === row.sourcePhotoUrl && !used.has(p.url));
    if (!photo) continue;
    // Even a source-established match yields to the caption's own testimony:
    // an image whose caption states a different barcode or size than the row
    // depicts a sibling package, and rendering it would misidentify the
    // version (observed: caption-prefix matches between same-named versions
    // that differ only by UPC or size).
    if (photo.alt && captionContradictsPackage(photo.alt, row)) continue;
    assign(row, photo, 'source_row');
  }

  // Caption matching exists to tell VERSIONS apart, so it only runs when
  // there are versions to tell apart. A single-row model's product is already
  // identified by the hero; decorating its one row adds nothing but risk.
  const matchable = input.rows.filter((row) => !rowImages.has(row.rowId));
  if (input.rows.length >= 2) {
    // Pass 2 — caption name + exact size: for sibling rows that share a name
    // and differ by package size (the Crystal Temptations shape), a caption
    // stating both the product identity and this row's exact size identifies
    // the row uniquely. The pairing must be unambiguous in BOTH directions —
    // exactly one photo for the row, exactly one row for the photo — or
    // nothing is assigned.
    const sized = matchable.filter(
      (row) =>
        row.name !== null &&
        measurementKey(row.name).length >= MIN_NAME_KEY &&
        row.size !== null &&
        captionSizeKeys(row.size).size > 0,
    );
    const pairRowsByUrl = new Map<string, RowImageCandidate[]>();
    const pairPhotosByRow = new Map<string, ProductPhoto[]>();
    for (const row of sized) {
      const nameKey = measurementKey(row.name!);
      const rowSizes = captionSizeKeys(row.size!);
      for (const photo of pool) {
        if (used.has(photo.url) || !photo.alt) continue;
        if (!captionContainsName(photo.alt, nameKey)) continue;
        const captionSizes = captionSizeKeys(photo.alt);
        if (![...captionSizes].some((size) => rowSizes.has(size))) continue;
        if (captionContradictsPackage(photo.alt, row)) continue;
        pairRowsByUrl.set(photo.url, [...(pairRowsByUrl.get(photo.url) ?? []), row]);
        pairPhotosByRow.set(row.rowId, [...(pairPhotosByRow.get(row.rowId) ?? []), photo]);
      }
    }
    for (const row of sized) {
      const photos = pairPhotosByRow.get(row.rowId) ?? [];
      if (photos.length !== 1) continue;
      const photo = photos[0];
      if ((pairRowsByUrl.get(photo.url) ?? []).length !== 1) continue;
      if (used.has(photo.url)) continue;
      assign(row, photo, 'caption_name_size');
    }

    // Pass 3 — caption identity: a caption that contains a row's exact
    // product identity ("Label: QQ FISH Mushroom Fish Ball" → the Mushroom
    // Fish Ball row). Only rows whose name is unique among all rows can match
    // — sibling rows sharing a name have nothing here to tell them apart. The
    // most specific version claims first ("Tofu Style Fried Fish Cake" before
    // "Fried Fish Cake" can take its caption), the shortest matching caption
    // wins as the most exact, and a tie between equally short captions is
    // ambiguity — nothing is assigned.
    const nameCounts = new Map<string, number>();
    for (const row of input.rows) {
      if (row.name === null) continue;
      const key = measurementKey(row.name);
      nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    }
    const uniquelyNamed = input.rows
      .filter(
        (row) =>
          !rowImages.has(row.rowId) &&
          row.name !== null &&
          measurementKey(row.name).length >= MIN_NAME_KEY &&
          nameCounts.get(measurementKey(row.name)) === 1,
      )
      .sort((a, b) => measurementKey(b.name!).length - measurementKey(a.name!).length);
    for (const row of uniquelyNamed) {
      const nameKey = measurementKey(row.name!);
      const candidates = pool
        .filter(
          (photo) =>
            !used.has(photo.url) &&
            photo.alt &&
            captionContainsName(photo.alt, nameKey) &&
            !captionContradictsPackage(photo.alt, row),
        )
        .sort((a, b) => measurementKey(a.alt!).length - measurementKey(b.alt!).length);
      if (candidates.length === 0) continue;
      if (
        candidates.length > 1 &&
        measurementKey(candidates[0].alt!).length === measurementKey(candidates[1].alt!).length
      ) {
        continue;
      }
      assign(row, candidates[0], 'caption_name');
    }
  }

  // Gallery: the recognizable announcement images (with the extraction
  // layer's honest only-close-ups fallback), in source order, then label
  // renders — minus every image already holding a visible role. The hero
  // never enters the gallery, whether or not a row reuses it.
  const taken = new Set([...(hero ? [hero.url] : []), ...used]);
  const gallery: RecallImage[] = [
    ...galleryPhotos(input.photos).map((photo) => photo.url),
    ...input.labelVisuals.map((visual) => visual.url),
  ]
    .filter((url, index, urls) => !taken.has(url) && urls.indexOf(url) === index)
    .map((url) => byUrl.get(url)!);

  // Everything else stays retained but non-visible.
  const galleryUrls = new Set(gallery.map((image) => image.url));
  const supporting = [...byUrl.values()].filter(
    (image) => !taken.has(image.url) && !galleryUrls.has(image.url),
  );

  return { hero, rowImages, gallery, supporting };
}
