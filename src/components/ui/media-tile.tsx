/**
 * The media tile (P2B2, extracted from the Recall Card's P2B1 tile): a
 * square of the caller's size that shows the real product image from the
 * shared image pipeline — and, since P2B7I, NOTHING AT ALL when there is no
 * image to show. `contain` never crops or distorts a label photo; the neutral
 * `background/media-placeholder` shows around a tall or wide one. There is
 * no broken-image glyph and no substitute picture: the only image source is
 * the URL the caller's model supplied.
 *
 * ## The four image states, and what each renders
 *
 *   no image (`uri` null)  → nothing. No footprint, no placeholder, no
 *                            accessibility element. The caller's layout
 *                            closes over the gap (a gapped flex row leaves
 *                            no gap for an absent child).
 *   loading                → the square, on the placeholder colour, with the
 *                            request active inside it. The footprint IS the
 *                            final size, so the image arriving reflows
 *                            nothing; the colour is what shows meanwhile.
 *   loaded                 → the image, contained in that same square.
 *   failed                 → nothing — the same shape as "no image", settled
 *                            once and for the session (`image-failures`):
 *                            a recycled card or a revisited page reads the
 *                            verdict on mount and never re-requests the
 *                            URL, so there is no retry loop and no square
 *                            that reserves space and then collapses.
 *
 * Through P2B7H the card kept the square in every state so its geometry
 * never changed, and the tile drew the bare placeholder for "none" and
 * "failed" alike — the persistent grey rectangle the founder rejected on
 * no-image cards. Now the tile is either an image or absent, everywhere it
 * is used: the card, Detail's pager, and the affected-product rows.
 *
 * To assistive technology the tile is an image, labelled with the caller's
 * text. A caller rendering the tile as one page of a set (P2B7C) may also
 * pass that page's position, which is spoken after the label as the image's
 * value — the label still describes the product, and the position says where
 * in the set it sits.
 *
 * A failure is reported to the caller too (`onLoadFailed`), for a pager that
 * must stop counting the page. The card passes no callback: its own shape
 * already follows the tile's.
 */

import { useState } from 'react';
import { Image, StyleSheet } from 'react-native';

import { Surface } from '@/components/ui/surface';
import type { layout } from '@/constants/design-tokens';
import { hasImageFailed, recordImageFailure } from '@/lib/image-failures';

/** The only footprints a tile may have: the three media-size layout tokens. */
export type MediaSize = (typeof layout)['cardMediaSize' | 'detailMediaSize' | 'rowMediaSize'];

export function MediaTile({
  uri,
  alt,
  size,
  positionLabel = null,
  onLoadFailed,
}: {
  uri: string | null;
  /** The spoken description of the image — the model's product name. */
  alt: string;
  /** The square footprint — `card-media-size`, `detail-media-size` or `row-media-size`. */
  size: MediaSize;
  /**
   * The presentation contract's spoken position for this page, when the
   * tile is one page of a paged set. Spoken as the image's value; null for
   * a tile that stands alone, which has no position to announce.
   */
  positionLabel?: string | null;
  /**
   * Called once with this tile's `uri` when the image reports a load failure,
   * for a caller that must stop counting it.
   */
  onLoadFailed?: (uri: string) => void;
}) {
  // The URL that failed under THIS mount, so the tile re-renders into its
  // absent shape the moment the platform reports the failure. The session
  // memory below answers for every later mount of the same URL.
  const [failedUri, setFailedUri] = useState<string | null>(null);

  // No image, or an image that cannot render: nothing. Not a placeholder,
  // not a footprint, not an accessibility element.
  if (uri === null || failedUri === uri || hasImageFailed(uri)) return null;

  return (
    <Surface
      background="background/media-placeholder"
      radius={8}
      style={[styles.tile, { width: size, height: size }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={alt}
      accessibilityValue={positionLabel !== null ? { text: positionLabel } : undefined}>
      <Image
        source={{ uri }}
        style={styles.image}
        resizeMode="contain"
        accessible={false}
        onError={() => {
          recordImageFailure(uri);
          setFailedUri(uri);
          onLoadFailed?.(uri);
        }}
      />
    </Surface>
  );
}

const styles = StyleSheet.create({
  tile: {
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
