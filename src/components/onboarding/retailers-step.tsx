/**
 * Screen 4, Retailers (P2B7X.1; Popular stores and search since 2026-09-24),
 * `3 of 4`: the heading beside M03, the grocery-bag mascot; the
 * selected-store summary, once something is chosen; the ten Popular stores
 * as tiles; then the search trigger, which opens `RetailerSearchSheet` over
 * the step — in the onboarding frame, with `Continue` sticky in the footer.
 *
 * ## One selection, one screen
 *
 * There is no draft and no second mode: `selected` is the saved selection
 * the route hands in, and every tile, chip, search result and `Clear` goes
 * straight back through the route's `onToggle` / `onClear`, which save
 * progressively. The popular ten are canonical catalog ids
 * (`POPULAR_RETAILERS`, lib/retailer-grid.ts), not records of their own; the
 * search looks through the same 77-entry catalog.
 *
 * ## The search
 *
 * Beneath the ten sits the trigger, drawn as the app's Search Bar and reading
 * `Not listed? Search all stores`, but a button: the only text field is the
 * sheet's. The sheet slides up over this step, which stays mounted and
 * exactly where it was, dimmed behind it — nothing here moves, resizes or
 * re-lays out while the shopper searches (retailer-search-sheet.tsx). When
 * the sheet has gone, focus returns to the trigger.
 *
 * ## The rules this step carries
 *
 * - Optional: Continue is never disabled.
 * - The summary exists only while something is chosen: with nothing, no
 *   count, no Clear, no empty sentence and no space held for them.
 * - The chips are one horizontally scrolling row, so the summary never grows
 *   however many stores are chosen through the search, and every chip stays
 *   reachable by swiping or by VoiceOver. No store is hidden behind a count.
 * - No retailer mark, monogram, glyph or colour on any tile: the name and the
 *   checkbox only (the logo decision is docs/retailer-logo-source-audit.md).
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
} from 'react-native';

import { OnboardingFrame } from '@/components/onboarding/onboarding-frame';
import { RetailerSearchSheet } from '@/components/onboarding/retailer-search-sheet';
import { Button } from '@/components/ui/button';
import { CheckIndicator } from '@/components/ui/check-row';
import { Icon } from '@/components/ui/icon';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import {
  color,
  hitSlopToMinimum,
  hitTarget,
  layout,
  radius,
  spacing,
  typography,
} from '@/constants/design-tokens';
import type { CanonicalRetailer } from '@/domain/retailer-catalog';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import {
  BACK_HINT,
  BACK_LABEL,
  CLEAR_STORES_HINT,
  CLEAR_STORES_LABEL,
  CONTINUE_CTA,
  POPULAR_STORES_LABEL,
  removeStoreLabel,
  RETAILERS_BODY,
  RETAILERS_HEADLINE,
  SEARCH_ALL_STORES_HINT,
  SEARCH_ALL_STORES_LABEL,
  SEARCH_ALL_STORES_PLACEHOLDER,
  yourStoresSpoken,
  yourStoresTitle,
} from '@/lib/onboarding-copy';
import { motionAllowed, stepProgress } from '@/lib/onboarding-state';
import { chosenStores } from '@/lib/personalization-screen';
import {
  GRID_GAP,
  POPULAR_RETAILERS,
  READY_MASCOT_SIZE,
  retailerGridColumns,
  retailerGridRows,
  showReadyMascot,
  TILE,
} from '@/lib/retailer-grid';
import { MASCOT_ENTRANCE } from '@/lib/state-map';

/** How long a tile's chosen surface and checkbox take to fade in or out. */
export const SELECTION_FADE_MS = 150;

/** Clear is one text line tall; hitSlop makes it a 44pt target without a 44pt row. */
const CLEAR_HIT_SLOP = hitSlopToMinimum(typography['body-small-bold'].lineHeight);

/** M03, the approved ready pose with the grocery bag: a 1024×1024 transparent PNG. */
const MASCOT =
  require('@/assets/brand/production/lotly-mascot-ready-1024.png') as ImageSourcePropType;

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
  const { width, fontScale } = useWindowDimensions();
  const columns = retailerGridColumns(width, fontScale);
  const reduceMotion = useReduceMotion();

  // A TRUE no-op with nothing selected.
  const clear = () => {
    if (selected.length === 0) return;
    onClear();
  };

  // The search sheet, and the trigger focus returns to once it has gone.
  const [searchOpen, setSearchOpen] = useState(false);
  const trigger = useRef<View>(null);
  const focusTrigger = useCallback(() => {
    const tag = findNodeHandle(trigger.current);
    if (tag !== null) AccessibilityInfo.setAccessibilityFocus(tag);
  }, []);

  return (
    <OnboardingFrame
      headline={RETAILERS_HEADLINE}
      body={RETAILERS_BODY}
      progress={stepProgress('retailers')}
      back={{ label: BACK_LABEL, hint: BACK_HINT, onPress: onBack }}
      aside={showReadyMascot(fontScale) ? <ReadyMascot /> : null}
      footer={<Button label={CONTINUE_CTA} onPress={onContinue} />}>
      {selected.length > 0 ? (
        <SelectedStores
          selected={selected}
          onRemove={onToggle}
          onClear={clear}
          reduceMotion={reduceMotion}
        />
      ) : null}
      <View style={styles.section}>
        <Text variant="heading-3" accessibilityRole="header">
          {POPULAR_STORES_LABEL}
        </Text>
        <RetailerGrid
          retailers={POPULAR_RETAILERS}
          columns={columns}
          selected={selected}
          onToggle={onToggle}
          reduceMotion={reduceMotion}
        />
        <SearchTrigger ref={trigger} onPress={() => setSearchOpen(true)} />
      </View>
      <RetailerSearchSheet
        visible={searchOpen}
        selected={selected}
        onToggle={onToggle}
        onClose={() => setSearchOpen(false)}
        onClosed={focusTrigger}
      />
    </OnboardingFrame>
  );
}

/**
 * Where the search begins: drawn as the app's Search Bar — its surface, lift,
 * glyph and `caption` placeholder — but a button, not a field, so there is
 * only ever one text field: the sheet's. No chevron: it opens a layer over
 * this step, not another screen.
 */
function SearchTrigger({ ref, onPress }: { ref: React.Ref<View>; onPress: () => void }) {
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={SEARCH_ALL_STORES_LABEL}
      accessibilityHint={SEARCH_ALL_STORES_HINT}
      onPress={onPress}>
      {({ pressed }) => (
        <Surface radius={12} elevation="card" style={[styles.trigger, pressed && styles.pressed]}>
          <Icon name="search" size={20} color="icon/secondary" />
          <Text variant="caption" color="text/secondary" style={styles.triggerText}>
            {SEARCH_ALL_STORES_PLACEHOLDER}
          </Text>
        </Surface>
      )}
    </Pressable>
  );
}

/**
 * The popular stores as tiles, read left to right then down, in `columns`
 * columns. A short last row keeps its tile at column width. Search results
 * are never tiles: they are the sheet's own rows (`RetailerResultRow`).
 */
function RetailerGrid({
  retailers,
  columns,
  selected,
  onToggle,
  reduceMotion,
}: {
  retailers: readonly CanonicalRetailer[];
  columns: 1 | 2;
  selected: readonly string[];
  onToggle: (id: string) => void;
  reduceMotion: boolean | null;
}) {
  return (
    <View style={styles.grid}>
      {retailerGridRows(retailers, columns).map((row) => (
        <View key={row[0].id} style={styles.gridRow}>
          {row.map((retailer) => (
            <RetailerTile
              key={retailer.id}
              retailer={retailer}
              checked={selected.includes(retailer.id)}
              onPress={() => onToggle(retailer.id)}
              reduceMotion={reduceMotion}
            />
          ))}
          {row.length < columns ? <View style={styles.gridSpacer} /> : null}
        </View>
      ))}
    </View>
  );
}

/**
 * The selected-store summary: `Your stores · N` with a compact `Clear`, then
 * every chosen store as a chip with its own removal control, in the order
 * chosen, on one horizontally scrolling row. Rendered only while something is
 * chosen: with nothing, there is no summary at all.
 */
function SelectedStores({
  selected,
  onRemove,
  onClear,
  reduceMotion,
}: {
  selected: readonly string[];
  onRemove: (id: string) => void;
  onClear: () => void;
  reduceMotion: boolean | null;
}) {
  const stores = chosenStores(selected);
  // A store just chosen joins the END of the row: when the row grows, bring
  // its end into view. Removing one never scrolls, and nor does the first
  // layout, so a returning shopper sees their first choices.
  const chips = useRef<ScrollView>(null);
  const chipsWidth = useRef<number | null>(null);
  const follow = (contentWidth: number) => {
    if (chipsWidth.current !== null && contentWidth > chipsWidth.current) {
      chips.current?.scrollToEnd({ animated: motionAllowed(reduceMotion) });
    }
    chipsWidth.current = contentWidth;
  };

  return (
    <View style={styles.summary}>
      <View style={styles.summaryHead}>
        {/* One element, one text line tall like Clear beside it, so their
            frames start level and VoiceOver reads the title first. */}
        <View
          accessible
          accessibilityRole="header"
          accessibilityLabel={yourStoresSpoken(stores.length)}
          style={styles.summaryTitle}>
          <Text variant="body-small-bold">{yourStoresTitle(stores.length)}</Text>
        </View>
        <ClearAction onPress={onClear} />
      </View>
      <ScrollView
        ref={chips}
        horizontal
        showsHorizontalScrollIndicator={false}
        onContentSizeChange={follow}
        style={styles.chipScroll}
        contentContainerStyle={styles.chipRow}>
        {stores.map((store) => (
          <Pressable
            key={store.id}
            accessibilityRole="button"
            accessibilityLabel={removeStoreLabel(store.name)}
            onPress={() => onRemove(store.id)}
            style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
            <Text variant="body-small" color="text/primary">
              {store.name}
            </Text>
            <Icon name="x" size={16} color="icon/primary" />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * `Clear` as a compact text action: `body-small-bold` in the interactive
 * `action/secondary`, never underlined. It exists only inside the summary, so
 * only while there is something to clear; its 44pt target comes from
 * hitSlop, so the summary's head is one text line and the chips sit close
 * beneath it.
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
      <Text variant="body-small-bold" color="action/secondary">
        {CLEAR_STORES_LABEL}
      </Text>
    </Pressable>
  );
}

/** One store: its name and a checkbox, one element, the whole tile its target. */
function RetailerTile({
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
      style={styles.tileSlot}>
      {({ pressed }) => (
        <View style={[styles.tile, pressed && styles.pressed]}>
          <View style={[styles.layer, styles.layerOpen]} />
          <Animated.View style={[styles.layer, styles.layerChosen, { opacity: fill }]} />
          <Text variant="body" style={styles.name}>
            {retailer.name}
          </Text>
          <View
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants">
            <CheckIndicator checked={checked} fill={fill} />
          </View>
        </View>
      )}
    </Pressable>
  );
}

/**
 * M03 beside the heading: drawn whole, decorative, hidden from assistive
 * technology and touching nothing. It fades in with the helper mascot's 8pt
 * settle once, only when Reduce Motion is known to be off; otherwise it is
 * simply there.
 */
function ReadyMascot() {
  const reduceMotion = useReduceMotion();
  const [animate] = useState(() => motionAllowed(reduceMotion));
  const [entrance] = useState(() => new Animated.Value(animate ? 0 : 1));
  useEffect(() => {
    if (!animate) return;
    const run = Animated.timing(entrance, {
      toValue: 1,
      delay: MASCOT_ENTRANCE.delay,
      duration: MASCOT_ENTRANCE.duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [animate, entrance]);
  return (
    <Animated.View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        opacity: entrance,
        transform: [
          {
            translateY: entrance.interpolate({
              inputRange: [0, 1],
              outputRange: [MASCOT_ENTRANCE.rise, 0],
            }),
          },
        ],
      }}>
      <Image
        source={MASCOT}
        accessible={false}
        resizeMode="contain"
        style={{ width: READY_MASCOT_SIZE, height: READY_MASCOT_SIZE }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // The soft-blue summary surface, the selected colour of the tiles below.
  summary: {
    gap: spacing[8],
    paddingHorizontal: spacing[16],
    paddingTop: spacing[16],
    paddingBottom: spacing[8],
    borderRadius: radius[16],
    backgroundColor: color['background/subtle'],
  },
  summaryHead: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: spacing[12],
  },
  // One text line, level with Clear beside it: iOS orders elements by their
  // top edge, so equal tops make VoiceOver read the title first, then Clear.
  summaryTitle: {
    flexShrink: 1,
  },
  // The row scrolls to the surface's edges; its content keeps the padding.
  chipScroll: {
    marginHorizontal: -spacing[16],
  },
  chipRow: {
    gap: spacing[8],
    paddingHorizontal: spacing[16],
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[8],
    minHeight: hitTarget.minimum,
    paddingHorizontal: spacing[12],
    borderRadius: radius[12],
    backgroundColor: color['background/surface'],
  },
  section: {
    gap: spacing[12],
  },
  grid: {
    gap: GRID_GAP,
  },
  gridRow: {
    flexDirection: 'row',
    gap: GRID_GAP,
  },
  gridSpacer: {
    flex: 1,
  },
  tileSlot: {
    flex: 1,
  },
  tile: {
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: TILE.gap,
    minHeight: TILE.minHeight,
    paddingHorizontal: TILE.paddingHorizontal,
    paddingVertical: TILE.paddingVertical,
    borderRadius: radius[12],
  },
  // The open and chosen surfaces, laid under the content. The chosen one only
  // changes opacity, so selecting moves nothing.
  layer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius[12],
    borderWidth: 1,
  },
  layerOpen: {
    backgroundColor: color['background/surface'],
    borderColor: color['border/default'],
  },
  layerChosen: {
    backgroundColor: color['background/subtle'],
    borderColor: color['action/primary'],
  },
  name: {
    flex: 1,
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[12],
    minHeight: layout.searchBarHeight,
    paddingHorizontal: spacing[12],
    paddingVertical: spacing[8],
  },
  triggerText: {
    flex: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});
