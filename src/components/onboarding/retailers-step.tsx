/**
 * Screen 5, Stores (the receipt Stores, 2026-09-30), `5 of 5`.
 *
 * The founder-approved composition
 * (assets/brand/reference/lotly-onboarding-stores-receipt-target.png),
 * rebuilt from its three approved layers and native UI. From the top: the
 * back control and progress bar every counted step has; `Your regulars.`
 * and its body, left aligned; the illustration across the full width — the
 * mascot holding a grocery receipt, a produce bag and a towel — with the
 * receipt's contents native: `Popular stores`, the count and `Clear`, six
 * quick choices between dotted rules, and `Search all stores`; then
 * `Continue` pinned above the bottom inset. It replaces the ten Popular
 * store tiles, the `Not listed? Search all stores` field and the M03 aside.
 *
 * ## Its own page, the frame's chrome
 *
 * The illustration bleeds to both screen edges, so Stores draws its own page
 * as Welcome and States do, keeping the frame's top bar (`OnboardingTopBar`)
 * so back and progress are exactly every other step's. The footer is the
 * frame's: the page colour over the real bottom inset, with its hairline
 * drawn only while content actually runs beneath it.
 *
 * ## Three layers, and a receipt that grows upward
 *
 * The scene (backdrop, mascot, table, bag, towel), the blank paper and the
 * overlap (the glove and two rays, with the shadows they cast) are drawn at
 * one scale, the page width over 934 (lib/stores-receipt-presentation.ts).
 * The paper's bottom is anchored to the scene and its native contents lay
 * out at their real size — every row at least 44pt, at the reader's text
 * size — so the paper takes whatever height they need by stretching one
 * slice of quiet paper, never the mascot or the food. The illustration
 * reserves that height in the page's flow: the receipt rises, the scene
 * moves down with it, and nothing ever overlaps the headline. The paper is
 * never drawn shorter than its exported height, because the scene is
 * transparent where the receipt covers it.
 *
 * From the accessibility text sizes the receipt's column is too narrow for
 * a name word, so the step stacks: the illustration drawn whole with its
 * blank receipt (all three layers — the scene cannot render alone), then
 * the interactive receipt as the paper alone at the page's width.
 *
 * The artwork is decorative: hidden from assistive technology and touching
 * nothing. Static: no entrance, no loop.
 *
 * ## One selection, one screen
 *
 * There is no draft and no second mode: `selected` is the saved selection
 * the route hands in, and every row, search result and `Clear` goes straight
 * back through the route's `onToggle` / `onClear`, which save progressively.
 * The six quick choices are canonical catalog ids (`POPULAR_RETAILERS`,
 * lib/retailer-grid.ts); `Search all stores` opens `RetailerSearchSheet`
 * over the step, which searches the whole 77-entry catalog. When the sheet
 * has gone, focus returns to `Search all stores`.
 *
 * ## The rules this step carries
 *
 * - Optional: Continue is never disabled; nothing is chosen by default.
 * - The count row's SLOT is permanently allocated (the P2B7V rule): with
 *   nothing chosen its content is invisible and hidden from assistive
 *   technology, so choosing or clearing the first store never moves the
 *   rows. The count covers stores chosen through the search too, which the
 *   six rows cannot show; `Clear` removes those as well.
 * - Every row and the search action are at least 44pt tall and their
 *   targets never overlap: the target's rows are only 38pt apart, so the
 *   receipt grows instead of the targets shrinking.
 * - No retailer mark, monogram, glyph or colour on any row: the name and the
 *   checkbox only (the logo decision is docs/retailer-logo-source-audit.md).
 * - Type (STORES_TYPE) and the 51pt `Continue` are Stores-local sizes; the
 *   shared type scale and Button are unchanged. Nothing caps Dynamic Type:
 *   the page scrolls above the footer.
 *
 * Presentational: the route owns saving and navigation.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  findNodeHandle,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type ImageSourcePropType,
  type ImageStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OnboardingTopBar } from '@/components/onboarding/onboarding-frame';
import { RetailerSearchSheet } from '@/components/onboarding/retailer-search-sheet';
import { CheckIndicator } from '@/components/ui/check-row';
import { Icon } from '@/components/ui/icon';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { color, hitSlopToMinimum, layout, radius, spacing } from '@/constants/design-tokens';
import type { CanonicalRetailer } from '@/domain/retailer-catalog';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import {
  BACK_HINT,
  BACK_LABEL,
  CLEAR_STORES_HINT,
  CLEAR_STORES_LABEL,
  CONTINUE_CTA,
  POPULAR_STORES_LABEL,
  RETAILERS_BODY,
  RETAILERS_HEADLINE,
  SEARCH_ALL_STORES_HINT,
  SEARCH_ALL_STORES_LABEL,
  storesCountLabel,
  storesCountShort,
} from '@/lib/onboarding-copy';
import { motionAllowed, stepProgress } from '@/lib/onboarding-state';
import { POPULAR_RETAILERS } from '@/lib/retailer-grid';
import {
  bodyMeasure,
  CONTENT_INSET_PX,
  COUNT_GAP,
  CTA_MIN_HEIGHT,
  GAPS,
  headlineType,
  illustrationWidth,
  OVERLAP_PX,
  PAPER_CLEARANCE,
  PAPER_PX,
  PAPER_SLICE_PX,
  type PaperSlice,
  receiptHeadingType,
  receiptLayout,
  ROW_CHROME,
  ROW_MIN_HEIGHT,
  RULE_HEIGHT,
  SCENE_PX,
  sceneScale,
  sliceImagePlacement,
  STACKED_INSET_PX,
  STACKED_SLICE_PX,
  stackedPaperScale,
  STORES_TYPE,
} from '@/lib/stores-receipt-presentation';

/** How long a row's checkbox takes to fade in or out. */
export const SELECTION_FADE_MS = 150;

/** The approved layers, cut from the target at its own pixels (asset report). */
const SCENE =
  require('@/assets/brand/production/lotly-stores-receipt-scene.png') as ImageSourcePropType;
const PAPER =
  require('@/assets/brand/production/lotly-stores-receipt-paper.png') as ImageSourcePropType;
const OVERLAP =
  require('@/assets/brand/production/lotly-stores-receipt-overlap.png') as ImageSourcePropType;

/** Clear is one text line tall; hitSlop makes it a 44pt target without a 44pt row. */
const CLEAR_HIT_SLOP = hitSlopToMinimum(STORES_TYPE.count.lineHeight);

/** Decorative art: out of the accessibility tree and out of the way of every touch. */
const DECORATIVE = {
  accessible: false,
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
  pointerEvents: 'none',
} as const;

export function RetailersStep({
  selected,
  onToggle,
  onClear,
  onContinue,
  onBack,
}: {
  selected: readonly string[];
  onToggle: (id: string) => void;
  /** Empties the selection. Called only while something is selected. */
  onClear: () => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const stacked = receiptLayout(fontScale) === 'stacked';
  // The page's own width: the window's on the first frame (which is what it
  // is in the app), then whatever the page is actually given, so a narrower
  // host (the Design Preview's frames) never clips the receipt.
  const [pageWidth, setPageWidth] = useState(() => illustrationWidth(width));
  const sceneWidth = illustrationWidth(pageWidth);
  const reduceMotion = useReduceMotion();

  // A TRUE no-op with nothing selected.
  const clear = () => {
    if (selected.length === 0) return;
    onClear();
  };

  // The search sheet, and the action focus returns to once it has gone.
  const [searchOpen, setSearchOpen] = useState(false);
  const searchAction = useRef<View>(null);
  const focusSearch = useCallback(() => {
    const tag = findNodeHandle(searchAction.current);
    if (tag !== null) AccessibilityInfo.setAccessibilityFocus(tag);
  }, []);

  // The footer's hairline shows only while content runs beneath it.
  const [viewport, setViewport] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const overflowing = viewport > 0 && contentHeight > viewport + 1;

  const receipt = (
    <ReceiptContent
      selected={selected}
      onToggle={onToggle}
      onClear={clear}
      onSearch={() => setSearchOpen(true)}
      searchRef={searchAction}
      fontScale={fontScale}
      reduceMotion={reduceMotion}
    />
  );

  return (
    <Surface background="background/page" style={styles.page}>
      <OnboardingTopBar
        back={{ label: BACK_LABEL, hint: BACK_HINT, onPress: onBack }}
        progress={stepProgress('retailers')}
      />
      <ScrollView
        style={styles.page}
        contentContainerStyle={[styles.content, { paddingTop: GAPS.top }]}
        onLayout={(event) => {
          setViewport(event.nativeEvent.layout.height);
          setPageWidth(event.nativeEvent.layout.width);
        }}
        onContentSizeChange={(_, height) => setContentHeight(height)}>
        <View style={[styles.heading, { gap: GAPS.heading }]}>
          <Text variant="display" accessibilityRole="header" style={headlineType(fontScale)}>
            {RETAILERS_HEADLINE}
          </Text>
          <Text
            variant="body"
            color="text/secondary"
            style={[STORES_TYPE.body, { maxWidth: bodyMeasure(fontScale) }]}>
            {RETAILERS_BODY}
          </Text>
        </View>
        {stacked ? (
          <>
            <Illustration width={sceneWidth} />
            <View style={styles.stackedReceipt}>
              <ReceiptPaper
                scale={stackedPaperScale(pageWidth)}
                inset={STACKED_INSET_PX}
                slice={STACKED_SLICE_PX}>
                {receipt}
              </ReceiptPaper>
            </View>
          </>
        ) : (
          <Illustration width={sceneWidth}>{receipt}</Illustration>
        )}
      </ScrollView>
      <View
        style={[
          styles.footer,
          overflowing && styles.footerRule,
          { paddingBottom: insets.bottom + spacing[12] },
        ]}>
        <ContinueButton onPress={onContinue} />
      </View>
      <RetailerSearchSheet
        visible={searchOpen}
        selected={selected}
        onToggle={onToggle}
        onClose={() => setSearchOpen(false)}
        onClosed={focusSearch}
      />
    </Surface>
  );
}

/**
 * The illustration at `width`: the scene pinned to the bottom of a box at
 * least as tall as it, and the paper standing on the scene where the target
 * draws it, with the overlap fixed to the paper's (and so the scene's)
 * bottom. With `children` the paper holds the receipt's contents and grows
 * upward to fit them, and the box grows with it, so the scene moves down;
 * without, the paper is blank at its exported height.
 */
function Illustration({ width, children }: { width: number; children?: React.ReactNode }) {
  const scale = sceneScale(width);
  return (
    <View
      style={{
        width,
        minHeight: SCENE_PX.height * scale,
        marginTop: GAPS.scene,
        paddingTop: PAPER_CLEARANCE,
        paddingLeft: PAPER_PX.left * scale,
        paddingBottom: PAPER_PX.bottomGap * scale,
        justifyContent: 'flex-end',
      }}>
      <View
        {...DECORATIVE}
        style={[styles.anchored, { width, height: SCENE_PX.height * scale, left: 0, bottom: 0 }]}>
        <Image source={SCENE} style={styles.fill} />
      </View>
      <ReceiptPaper scale={scale} inset={CONTENT_INSET_PX} slice={PAPER_SLICE_PX} overlap>
        {children}
      </ReceiptPaper>
    </View>
  );
}

/**
 * The receipt paper at `scale`, in three pieces: its torn top and its foot
 * drawn 1:1, and `slice` between them stretched to whatever height the
 * contents need (never less than the exported height).
 * The slices and the overlap sit under the contents, decorative.
 */
function ReceiptPaper({
  scale,
  inset,
  slice,
  overlap = false,
  children,
}: {
  scale: number;
  inset: { left: number; right: number; top: number; bottom: number };
  /** The rows that stretch; everything above and below is drawn 1:1. */
  slice: PaperSlice;
  overlap?: boolean;
  children?: React.ReactNode;
}) {
  const paperWidth = PAPER_PX.width * scale;
  const paperHeight = PAPER_PX.height * scale;
  const topCap = slice.top * scale;
  const foot = (PAPER_PX.height - slice.bottom) * scale;
  const whole: ImageStyle = {
    position: 'absolute',
    left: 0,
    width: paperWidth,
    height: paperHeight,
  };
  return (
    <View
      style={{
        width: paperWidth,
        minHeight: paperHeight,
        paddingTop: inset.top * scale,
        paddingBottom: inset.bottom * scale,
        paddingLeft: inset.left * scale,
        paddingRight: inset.right * scale,
      }}>
      <View {...DECORATIVE} style={[styles.slice, { top: topCap, bottom: foot }]}>
        <Image
          source={PAPER}
          resizeMode="stretch"
          style={[styles.sliceImage, sliceImagePlacement(slice)]}
        />
      </View>
      <View {...DECORATIVE} style={[styles.slice, { top: 0, height: topCap }]}>
        <Image source={PAPER} style={[whole, { top: 0 }]} />
      </View>
      <View {...DECORATIVE} style={[styles.slice, { bottom: 0, height: foot }]}>
        <Image source={PAPER} style={[whole, { bottom: 0 }]} />
      </View>
      {overlap ? (
        <View
          {...DECORATIVE}
          style={[
            styles.anchored,
            {
              left: OVERLAP_PX.left * scale,
              bottom: OVERLAP_PX.bottom * scale,
              width: OVERLAP_PX.width * scale,
              height: OVERLAP_PX.height * scale,
            },
          ]}>
          <Image source={OVERLAP} style={styles.fill} />
        </View>
      ) : null}
      {children}
    </View>
  );
}

/**
 * What the receipt says and does, top to bottom: `Popular stores`, the
 * count and `Clear`, the six quick choices between dotted rules, and
 * `Search all stores`.
 */
function ReceiptContent({
  selected,
  onToggle,
  onClear,
  onSearch,
  searchRef,
  fontScale,
  reduceMotion,
}: {
  selected: readonly string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  onSearch: () => void;
  searchRef: React.Ref<View>;
  fontScale: number;
  reduceMotion: boolean | null;
}) {
  const none = selected.length === 0;
  return (
    <View>
      <Text variant="display" accessibilityRole="header" style={receiptHeadingType(fontScale)}>
        {POPULAR_STORES_LABEL}
      </Text>
      {/* Permanently allocated: one line whether or not it shows, so the
          rows never move when the first store is chosen or the last is
          cleared. */}
      <View
        style={[styles.countRow, none && styles.countRowIdle]}
        accessibilityElementsHidden={none}
        importantForAccessibility={none ? 'no-hide-descendants' : 'auto'}>
        <Text
          variant="caption"
          color="text/secondary"
          accessibilityLabel={storesCountLabel(selected.length)}
          accessibilityLiveRegion="polite"
          style={[STORES_TYPE.count, styles.countText]}>
          {storesCountShort(selected.length)}
        </Text>
        <ClearAction onPress={onClear} />
      </View>
      <DottedRule />
      {POPULAR_RETAILERS.map((retailer) => (
        <View key={retailer.id}>
          <StoreRow
            retailer={retailer}
            checked={selected.includes(retailer.id)}
            onPress={() => onToggle(retailer.id)}
            reduceMotion={reduceMotion}
          />
          <DottedRule />
        </View>
      ))}
      <SearchAction ref={searchRef} onPress={onSearch} />
    </View>
  );
}

/**
 * One quick choice: its name and a checkbox, one element, the whole row its
 * target. Holding it changes nothing (no dimming or highlight: the name stays
 * navy and the checkbox as it is); a completed tap toggles the checkbox.
 */
function StoreRow({
  retailer,
  checked,
  onPress,
  reduceMotion,
}: {
  retailer: CanonicalRetailer;
  checked: boolean;
  onPress: () => void;
  reduceMotion: boolean | null;
}) {
  // 0 = open, 1 = chosen. Drawn at its final value on the first frame.
  const [fill] = useState(() => new Animated.Value(checked ? 1 : 0));
  useEffect(() => {
    const to = checked ? 1 : 0;
    if (!motionAllowed(reduceMotion)) {
      fill.setValue(to);
      return;
    }
    const run = Animated.timing(fill, {
      toValue: to,
      duration: SELECTION_FADE_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [checked, reduceMotion, fill]);

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={retailer.name}
      accessibilityState={{ checked }}
      onPress={onPress}
      style={styles.row}>
      <Text variant="body" style={[STORES_TYPE.name, styles.rowText]}>
        {retailer.name}
      </Text>
      <View
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        <CheckIndicator checked={checked} fill={fill} />
      </View>
    </Pressable>
  );
}

/**
 * `Search all stores`: blue text and a blue magnifier across the whole row,
 * a button that opens the search sheet — no box, field or chevron.
 */
function SearchAction({ ref, onPress }: { ref: React.Ref<View>; onPress: () => void }) {
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={SEARCH_ALL_STORES_LABEL}
      accessibilityHint={SEARCH_ALL_STORES_HINT}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <Text variant="caption" color="action/secondary" style={[STORES_TYPE.search, styles.rowText]}>
        {SEARCH_ALL_STORES_LABEL}
      </Text>
      <Icon name="search" size={ROW_CHROME.check} color="icon/brand" />
    </Pressable>
  );
}

/**
 * `Clear` as a compact text action beside the count, in the interactive
 * `action/secondary`; its 44pt target comes from hitSlop, which `COUNT_GAP`
 * keeps clear of the first row's.
 */
function ClearAction({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={CLEAR_STORES_LABEL}
      accessibilityHint={CLEAR_STORES_HINT}
      onPress={onPress}
      hitSlop={CLEAR_HIT_SLOP}
      style={({ pressed }) => pressed && styles.pressed}>
      <Text variant="body-small-bold" color="action/secondary" style={STORES_TYPE.count}>
        {CLEAR_STORES_LABEL}
      </Text>
    </Pressable>
  );
}

/** The receipt's dotted rule: a 1pt dashed line, clipped from a dashed box's top edge. */
function DottedRule() {
  return (
    <View {...DECORATIVE} style={styles.rule}>
      <View style={styles.ruleDashes} />
    </View>
  );
}

/**
 * The shared Button's primary treatment at the onboarding's size: the same
 * pill, fill, label colour, face, pressed opacity and role, only 51pt tall
 * with an 18pt label. Never disabled: the step is optional.
 */
function ContinueButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: false, busy: false }}
      onPress={onPress}>
      {({ pressed }) => (
        <View style={[styles.cta, pressed && styles.pressed]}>
          <Text variant="body-small-bold" color="text/inverse" style={styles.ctaLabel}>
            {CONTINUE_CTA}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  content: {
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
    paddingBottom: spacing[16],
  },
  heading: {
    paddingHorizontal: layout.pageMargin,
  },
  anchored: {
    position: 'absolute',
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  // A slice of the paper: a clipped window onto the whole paper image.
  slice: {
    position: 'absolute',
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  sliceImage: {
    position: 'absolute',
    left: 0,
    width: '100%',
  },
  stackedReceipt: {
    marginTop: spacing[16],
    paddingHorizontal: layout.pageMargin,
  },
  // The quiet count row: the count and Clear on one line, no surface. Its
  // slot never comes or goes; only its visibility does.
  countRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: spacing[12],
    marginTop: spacing[4],
    marginBottom: COUNT_GAP,
    paddingHorizontal: ROW_CHROME.padding,
  },
  countRowIdle: {
    opacity: 0,
  },
  countText: {
    flexShrink: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ROW_CHROME.gap,
    minHeight: ROW_MIN_HEIGHT,
    paddingHorizontal: ROW_CHROME.padding,
    paddingVertical: spacing[4],
  },
  rowText: {
    flex: 1,
  },
  rule: {
    height: RULE_HEIGHT,
    overflow: 'hidden',
  },
  ruleDashes: {
    height: RULE_HEIGHT * 3,
    borderWidth: RULE_HEIGHT,
    borderStyle: 'dashed',
    borderColor: color['border/strong'],
  },
  // The frame's footer: the page colour, pinned over the bottom inset.
  footer: {
    width: '100%',
    paddingHorizontal: layout.pageMargin,
    paddingTop: spacing[12],
    borderTopWidth: 1,
    borderTopColor: 'transparent',
    backgroundColor: color['background/page'],
  },
  footerRule: {
    borderTopColor: color['border/subtle'],
  },
  // The shared Button's primary pill (components/ui/button.tsx), 51pt tall.
  cta: {
    minHeight: CTA_MIN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[8],
    borderRadius: radius.full,
    backgroundColor: color['action/primary'],
  },
  ctaLabel: {
    ...STORES_TYPE.cta,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
