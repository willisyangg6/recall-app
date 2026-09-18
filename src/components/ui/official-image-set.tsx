/**
 * The official image set (P2B7C, as corrected) — the header's official FDA
 * product photography, paged by hand.
 *
 * It takes a finished `DetailImageSet` from the shared presentation contract
 * and renders exactly those images, in exactly that order. It collects
 * nothing, ranks nothing, deduplicates nothing, reads no caption, and looks
 * at no pixel: which official images exist and what each is called was
 * decided once, by the image-role allocation (`src/lib/recall-images.ts`)
 * and the presentation contract on top of it. The first page is the stored
 * hero — the same picture the Feed card showed for this recall.
 *
 * This is the ONLY imagery carousel in the product. FSIS label renders are
 * never rendered as a gallery anywhere (founder decision), and the one other
 * image on Detail is a thumbnail the allocator matched to an exact
 * affected-product row, which that row draws itself.
 *
 * ## What the shopper can reach is what the indicator says
 *
 * There is no presentation cap: every official photo is navigable, and the
 * pager virtualizes rather than dropping images, so a 51-photo notice mounts
 * and fetches a page at a time.
 *
 * A candidate whose image cannot load LEAVES THE SET. That is the P2B7C
 * correction: a failed page used to stay in the pager as a grey placeholder
 * and stay counted, so a recall could show two dots over two blank squares.
 * Now the set shrinks to what actually renders, and the shape follows it:
 *
 *   0 usable → nothing at all (Detail's approved no-image header)
 *   1 usable → the static tile, with no indicator
 *   2–5      → position dots
 *   6+       → the compact `2 / 15` counter, and never dots as well
 *
 * The visible page is tracked by IMAGE IDENTITY, not by index, so a late
 * failure on a page the shopper cannot see never moves the page they are
 * looking at.
 *
 * ## What paging is, and is not
 *
 * Paging is a hand gesture and nothing else. There is no timer, no
 * auto-advance, no animated transition of our own, and no decorative motion,
 * so Reduce Motion needs no special case — there is nothing to reduce. There
 * are no next/previous buttons, and the images themselves are not pressable:
 * this milestone has no full-screen destination to send anyone to, and a
 * control that leads nowhere is worse than no control.
 *
 * Only this row scrolls sideways. The page's own vertical ScrollView owns
 * vertical scrolling; a gesture that starts vertically scrolls the page, and
 * a horizontal one pages the images — the platform's own nested-scroll
 * behaviour, not a gesture recognizer of ours.
 *
 * ## Accessibility
 *
 * Each image keeps its own factual label and announces its position through
 * `accessibilityValue` (`Image 2 of 15`), composed by the presentation
 * contract. The dots and the counter are decoration and are hidden outright,
 * so nothing reads the slash aloud.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { MediaTile } from '@/components/ui/media-tile';
import { Text } from '@/components/ui/text';
import { color, layout, radius, spacing } from '@/constants/design-tokens';
import {
  imageCounterText,
  imagePositionLabel,
  IMAGE_DOTS_MAX,
  type DetailImage,
  type DetailImageSet,
} from '@/lib/recall-presentation';

/** One page is exactly the tile, so paging always lands on a whole image. */
const PAGE = layout.detailMediaSize;

export function OfficialImageSet({ set }: { set: DetailImageSet }) {
  /** URLs whose image reported a load failure. They leave the set. */
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  /**
   * The visible page, as both the IMAGE showing (so an offscreen removal
   * cannot move it) and the position it settled at (the fallback for when
   * that image is the one that failed).
   */
  const [visible, setVisible] = useState<{ url: string | null; at: number }>({
    url: null,
    at: 0,
  });
  const pager = useRef<FlatList<DetailImage> | null>(null);

  const usable = set.images.filter((image) => !failed.has(image.url));
  const found = visible.url === null ? -1 : usable.findIndex((image) => image.url === visible.url);
  // The image that was showing, or — when that is the one that just failed —
  // whatever now sits where it was.
  const current =
    usable.length === 0 ? 0 : found >= 0 ? found : Math.min(visible.at, usable.length - 1);

  // Keep the pager on the current page when the set shrinks under it.
  useEffect(() => {
    if (usable.length < 2) return;
    pager.current?.scrollToOffset({ offset: current * PAGE, animated: false });
  }, [current, usable.length]);

  const onSettled = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const raw = Math.round(event.nativeEvent.contentOffset.x / PAGE);
      const at = Math.min(Math.max(raw, 0), usable.length - 1);
      const image = usable[at];
      if (image) setVisible({ url: image.url, at });
    },
    [usable],
  );

  const onFailed = useCallback((url: string) => {
    setFailed((prior) => (prior.has(url) ? prior : new Set(prior).add(url)));
  }, []);

  // Every candidate failed: this recall has no usable official image, so the
  // header takes its approved no-image shape rather than keeping a blank tile
  // with indicators over it.
  if (usable.length === 0) return null;

  // One usable image is the static tile Detail has always shown: no dots, no
  // counter, nothing to swipe.
  if (usable.length === 1) {
    return (
      <View style={styles.set}>
        <MediaTile
          uri={usable[0].url}
          alt={usable[0].accessibilityLabel}
          size={layout.detailMediaSize}
          onLoadFailed={onFailed}
        />
      </View>
    );
  }

  return (
    <View style={styles.set}>
      <FlatList
        ref={pager}
        data={usable}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(image) => image.url}
        // Virtualized so the corpus outlier (51 official photos) mounts and
        // fetches a page at a time instead of all of them at once.
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        windowSize={3}
        removeClippedSubviews
        getItemLayout={(_, index) => ({ length: PAGE, offset: PAGE * index, index })}
        onMomentumScrollEnd={onSettled}
        onScrollEndDrag={onSettled}
        style={styles.viewport}
        renderItem={({ item, index }) => (
          <MediaTile
            uri={item.url}
            alt={item.accessibilityLabel}
            size={layout.detailMediaSize}
            positionLabel={imagePositionLabel(index, usable.length)}
            onLoadFailed={onFailed}
          />
        )}
      />
      {/* Decoration only — the spoken position rides each image instead, so
          nothing here is announced (the counter's slash is never read aloud)
          and nothing here is tappable. Dots up to the threshold, the compact
          counter beyond it, and never both. */}
      <View
        style={styles.indicator}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        {usable.length <= IMAGE_DOTS_MAX ? (
          usable.map((image, index) => (
            <View key={image.url} style={[styles.dot, index === current && styles.dotCurrent]} />
          ))
        ) : (
          <Text variant="caption" color="text/secondary">
            {imageCounterText(current, usable.length)}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // The set is exactly as wide as the tile it replaces, so the identity
  // column beside it keeps the width it always had.
  set: {
    width: layout.detailMediaSize,
    gap: spacing[8],
  },
  viewport: {
    width: layout.detailMediaSize,
    height: layout.detailMediaSize,
  },
  indicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[8],
  },
  dot: {
    width: layout.pageDotSize,
    height: layout.pageDotSize,
    borderRadius: radius.full,
    backgroundColor: color['border/strong'],
  },
  dotCurrent: {
    backgroundColor: color['background/brand'],
  },
});
