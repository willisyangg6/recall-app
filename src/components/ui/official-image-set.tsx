/**
 * The official image set (P2B7C, as corrected; indicators and failure
 * settled in P2B7I) — the header's official FDA product photography, paged
 * by hand.
 *
 * It takes a finished `DetailImageSet` from the shared presentation contract
 * and renders the pages `imagePageView` hands back, in exactly that order. It
 * collects nothing, ranks nothing, deduplicates nothing, reads no caption,
 * and looks at no pixel: which official images exist and what each is called
 * was decided once, by the image-role allocation (`src/lib/recall-images.ts`)
 * and the presentation contract on top of it. The first page is the stored
 * hero — the same picture the Feed card showed for this recall.
 *
 * This is the ONLY imagery carousel in the product. FSIS label renders are
 * never rendered as a gallery anywhere (founder decision), and the one other
 * image on Detail is a thumbnail the allocator matched to an exact
 * affected-product row, which that row draws itself.
 *
 * ## Every usable image is a page; the dots are only a window
 *
 * THERE IS NO PRESENTATION CAP. Every official photo that loads is
 * swipeable — a 74-photo notice pages from `1 / 74` all the way to
 * `74 / 74` — because a total a shopper cannot reach is a lie about what
 * the agency published. The pager virtualizes instead of dropping images,
 * so the long sets cost what a short one costs until they are swiped.
 *
 * What IS bounded is the indicator, and only the indicator. Two marks say
 * two different things, and above the threshold they COEXIST:
 *
 *   - the DOTS are a window of at most `IMAGE_DOTS_WINDOW`, sliding over
 *     the pages — the first pages at the start, the current page through
 *     the middle, the last pages at the end. How many dots there are says
 *     NOTHING about how many images there are.
 *   - the COUNTER (`2 / 74`) is the current page over the pages that can
 *     be shown. It is added beside the dots, never swapped for them.
 *
 *   0 usable → nothing at all (Detail's approved no-image header)
 *   1 usable → the static tile, with no indicator (nothing to swipe)
 *   2–5      → one dot each, no counter: every published photo is there
 *   6+       → a five-dot window, and the counter beside it
 *   (a failure that leaves fewer pages than published also takes the
 *    counter, so the shortfall is visible even in a small set)
 *
 * There is no prose — no `Showing 6 of 74 official images`.
 *
 * ## Failure
 *
 * A candidate whose image cannot load LEAVES THE SET (the P2B7C correction:
 * a failed page used to stay in the pager as a grey placeholder and stay
 * counted). Only that page goes — every healthy image after it stays
 * reachable — and when every candidate fails the header returns to its
 * no-image shape. A verdict is remembered for the session
 * (`image-failures`), so reopening the recall neither re-requests the broken
 * URL nor shows a blank page first.
 *
 * The visible page is tracked by IMAGE IDENTITY, not by index, so a late
 * failure on a page the shopper cannot see never moves the page they are
 * looking at; when the page they ARE looking at is the one that failed, the
 * pager settles on whatever now sits at that position, once, and stays.
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
 * `accessibilityValue`, composed by the presentation contract over the pages
 * that can be reached: `Image 2 of 74`. Every counted page IS reachable, so
 * the count needs no qualifier.
 *
 * The dots are decoration and are hidden outright. The counter is hidden
 * too while nothing has failed — the pages already announce the same two
 * numbers, and a second element would only duplicate them. When something
 * HAS failed the counter becomes the one element that keeps the totals
 * apart (`72 of 74 official images can be shown; the rest could not be
 * loaded`), so a failed image is never implied to be viewable and the slash
 * is still never read aloud.
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
import { hasImageFailed } from '@/lib/image-failures';
import {
  imageCounterText,
  imageDotWindow,
  imagePageView,
  imagePositionLabel,
  imageUnavailableLabel,
  type DetailImage,
  type DetailImageSet,
} from '@/lib/recall-presentation';

/** One page is exactly the tile, so paging always lands on a whole image. */
const PAGE = layout.detailMediaSize;

export function OfficialImageSet({ set }: { set: DetailImageSet }) {
  /**
   * URLs whose image reported a load failure. Seeded from the session's
   * memory, so a candidate that already failed elsewhere is out before the
   * first render rather than after a blank page.
   */
  const [failed, setFailed] = useState<ReadonlySet<string>>(
    () =>
      new Set(set.images.filter((image) => hasImageFailed(image.url)).map((image) => image.url)),
  );
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

  const { pages, officialCount, usableCount, indicator } = imagePageView(set, failed);
  /** The one sentence about images that could not be loaded, or null. */
  const unavailable = imageUnavailableLabel(usableCount, officialCount);
  const found = visible.url === null ? -1 : pages.findIndex((image) => image.url === visible.url);
  // The image that was showing, or — when that is the one that just failed —
  // whatever now sits where it was.
  const current =
    pages.length === 0 ? 0 : found >= 0 ? found : Math.min(visible.at, pages.length - 1);

  // Keep the pager on the current page when the set changes under it.
  useEffect(() => {
    if (pages.length < 2) return;
    pager.current?.scrollToOffset({ offset: current * PAGE, animated: false });
  }, [current, pages.length]);

  const onSettled = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const raw = Math.round(event.nativeEvent.contentOffset.x / PAGE);
      const at = Math.min(Math.max(raw, 0), pages.length - 1);
      const image = pages[at];
      if (image) setVisible({ url: image.url, at });
    },
    [pages],
  );

  const onFailed = useCallback((url: string) => {
    setFailed((prior) => (prior.has(url) ? prior : new Set(prior).add(url)));
  }, []);

  // Every candidate failed: this recall has no usable official image, so the
  // header takes its approved no-image shape rather than keeping a blank tile
  // with indicators over it.
  if (pages.length === 0) return null;

  // One usable image is the static tile Detail has always shown: no dots, no
  // counter, nothing to swipe.
  if (pages.length === 1) {
    return (
      <View style={styles.set}>
        <MediaTile
          uri={pages[0].url}
          alt={pages[0].accessibilityLabel}
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
        data={pages}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(image) => image.url}
        // Virtualized, which is what makes an UNCAPPED set affordable: only
        // the visible page and its immediate neighbours are mounted, and a
        // page's image is requested when its page mounts — so the 74- and
        // 87-photo notices in the corpus cost the same as a two-photo one
        // until the shopper swipes.
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
            positionLabel={imagePositionLabel(index, usableCount)}
            onLoadFailed={onFailed}
          />
        )}
      />
      <View style={styles.indicator}>
        {/* The dots: a window of at most `IMAGE_DOTS_WINDOW`, sliding over
            the pages, decoration only — the spoken position rides each
            image instead, so nothing here is announced and nothing here is
            tappable. How many dots there are says nothing about how many
            images there are; the counter says that. */}
        <View
          style={styles.dots}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants">
          {imageDotWindow(current, usableCount).map((page) => (
            <View
              key={pages[page].url}
              style={[styles.dot, page === current && styles.dotCurrent]}
            />
          ))}
        </View>
        {/* The counter, BESIDE the dots — never instead of them — once the
            set outgrows one dot each, or once a failure means fewer pages
            than the agency published. It reads current over REACHABLE, so
            every denominator can be swiped to.

            Assistive technology hears the slash from neither: with nothing
            failing, each image already announces `Image 2 of 74` and a
            second element would only repeat it, so the counter is hidden;
            when something failed it carries the one sentence that keeps the
            two totals apart. */}
        {indicator === 'dots-and-counter' ? (
          <Text
            variant="caption"
            color="text/secondary"
            accessible={unavailable !== null}
            accessibilityLabel={unavailable ?? undefined}
            importantForAccessibility={unavailable === null ? 'no-hide-descendants' : 'auto'}>
            {imageCounterText(current, usableCount)}
          </Text>
        ) : null}
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
  // A ScrollView's base style grows (`flexGrow: 1`); pinned to 0 so the
  // pager stays exactly the tile and the indicator sits directly beneath it
  // even when a long product name makes the identity column taller (P2B7I).
  viewport: {
    width: layout.detailMediaSize,
    height: layout.detailMediaSize,
    flexGrow: 0,
  },
  // Dots and counter share one centred row; at a large text size the
  // counter wraps beneath the dots rather than pushing them off the tile.
  indicator: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[8],
  },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
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
