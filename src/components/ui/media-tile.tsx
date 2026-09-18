/**
 * The media tile (P2B2, extracted from the Recall Card's P2B1 tile): a
 * square of the caller's size that shows the real product image from the
 * shared image pipeline when one exists and loads, and the neutral
 * `background/media-placeholder` — at the same size — when there is none or
 * the load fails. `contain` never crops or distorts a label photo; the
 * placeholder colour shows around a tall or wide one. There is no
 * broken-image glyph and no substitute picture: the only image source is
 * the URL the caller's model supplied.
 *
 * Whether to render a tile at all is the caller's decision: the Recall Card
 * keeps the tile in every state so its geometry never changes, while Recall
 * Detail renders one only when the recall has an image (both are approved
 * no-image treatments — DESIGN.md, "Interaction states").
 *
 * To assistive technology the tile is an image, labelled with the caller's
 * text, only while a real image is showing; the bare placeholder is hidden
 * so nothing announces an image that is not there. A caller rendering the
 * tile as one page of a set (P2B7C) may also pass that page's position, which
 * is spoken after the label as the image's value — the label still describes
 * the product, and the position says where in the set it sits.
 *
 * A failed load is reported to that caller too (`onLoadFailed`), because a
 * pager has to know: a page whose image cannot render must leave the set
 * rather than stay counted as a blank one. The card and the affected-product
 * rows pass no callback and keep the placeholder, which is their contract.
 */

import { useState } from 'react';
import { Image, StyleSheet } from 'react-native';

import { Surface } from '@/components/ui/surface';
import type { layout } from '@/constants/design-tokens';

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
   * The presentation contract's `Image X of N` for this page, when the tile
   * is one page of a paged set. Spoken as the image's value; null for a tile
   * that stands alone, which has no position to announce.
   */
  positionLabel?: string | null;
  /**
   * Called once with this tile's `uri` when the image reports a load failure,
   * for a caller that must stop counting it. Omitted by callers for whom the
   * placeholder IS the answer.
   */
  onLoadFailed?: (uri: string) => void;
}) {
  const [failed, setFailed] = useState(false);
  const image = uri !== null && !failed ? uri : null;

  return (
    <Surface
      background="background/media-placeholder"
      radius={8}
      style={[styles.tile, { width: size, height: size }]}
      accessible={image !== null}
      accessibilityRole={image !== null ? 'image' : undefined}
      accessibilityLabel={image !== null ? alt : undefined}
      accessibilityValue={
        image !== null && positionLabel !== null ? { text: positionLabel } : undefined
      }
      importantForAccessibility={image !== null ? 'auto' : 'no-hide-descendants'}>
      {image !== null ? (
        <Image
          source={{ uri: image }}
          style={styles.image}
          resizeMode="contain"
          accessible={false}
          onError={() => {
            setFailed(true);
            if (uri !== null) onLoadFailed?.(uri);
          }}
        />
      ) : null}
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
