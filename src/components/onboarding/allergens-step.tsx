/**
 * Screen 3, Allergens (P2B7X.1; the grid P2B7Z), `2 of 4`: the nine
 * allergens as tiles in an adaptive grid — each its approved Lotly
 * pictogram (lib/allergen-assets.ts), its full name and an explicit
 * checkbox — under a permanently allocated count line and a compact
 * `Clear selection`, with `Continue` sticky.
 *
 * ## The grid
 *
 * Two columns where every label still fits a half-width tile at the
 * reader's text size, one full-width column where it would not and at every
 * accessibility size (`allergenGridColumns`, lib/allergen-grid.ts). Decided
 * from the window alone, so the first frame is already the final layout. A
 * short last row keeps its tile at column width. At the largest sizes on a
 * narrow phone, where even a full-width tile's label line is narrower than
 * `Crustacean`, the tile stacks — pictogram and checkbox on its top line,
 * the label beneath at full width (`allergenTileStacked`). Labels wrap
 * between words and are never truncated or capped.
 *
 * ## One tile, one checkbox
 *
 * The whole tile is the target and the one accessibility element — its
 * name, the checkbox role, checked or not. The pictogram and the drawn
 * check are decorative and hidden, so VoiceOver reads `Peanuts, checkbox,
 * checked` and nothing else inside it. A chosen tile turns the soft blue
 * `background/subtle` with a navy `action/primary` edge AND fills its
 * checkbox with a check mark, so colour is never the only channel. The
 * pictogram is the same untinted picture either way, never dimmed or
 * animated: it names the allergen, the surface and checkbox say the state.
 *
 * ## What never moves
 *
 * Optional: Continue is never disabled. An empty selection is a complete
 * answer ("Leave this blank if none"), and the count line says `No allergens
 * selected` rather than nothing. `Clear selection` is in the layout whether
 * or not anything is checked; with nothing checked it is disabled and its
 * handler is a no-op, so pressing it changes nothing and the grid never
 * moves (P2B7V). Selecting changes only colours and opacity: the chosen
 * surface and the filled checkbox are layers laid over the open ones, so a
 * tile's size is the same checked or not.
 *
 * ## Motion
 *
 * The chosen surface and the filled checkbox fade in or out together over
 * `SELECTION_FADE_MS` — no scale, no bounce, no movement. Under Reduce
 * Motion, or while that setting is still unknown, the final state is drawn
 * at once.
 *
 * Presentational: the route saves every toggle progressively.
 */

import { useEffect, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { OnboardingFrame, SelectionCount } from '@/components/onboarding/onboarding-frame';
import { Button } from '@/components/ui/button';
import { CheckIndicator } from '@/components/ui/check-row';
import { Text } from '@/components/ui/text';
import { color, hitTarget, radius, spacing } from '@/constants/design-tokens';
import { CONSUMER_ALLERGENS, type AllergenOption } from '@/domain/preferences';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { allergenPictogram } from '@/lib/allergen-assets';
import {
  allergenGridColumns,
  allergenGridRows,
  allergenTileStacked,
  GRID_GAP,
  TILE,
} from '@/lib/allergen-grid';
import {
  ALLERGENS_BODY,
  ALLERGENS_HEADLINE,
  allergenCountLabel,
  BACK_HINT,
  BACK_LABEL,
  CLEAR_ALLERGENS_HINT,
  CLEAR_SELECTION_LABEL,
  CONTINUE_CTA,
} from '@/lib/onboarding-copy';
import { motionAllowed, stepProgress } from '@/lib/onboarding-state';

/** How long a tile's chosen surface and checkbox take to fade in or out. */
export const SELECTION_FADE_MS = 150;

export function AllergensStep({
  selected,
  onToggle,
  onClear,
  onContinue,
  onBack,
}: {
  selected: readonly string[];
  onToggle: (token: string) => void;
  /** Empties the selection. Called only while something is selected. */
  onClear: () => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const columns = allergenGridColumns(width, fontScale);
  const stacked = allergenTileStacked(width, fontScale);
  const reduceMotion = useReduceMotion();

  // A TRUE no-op with nothing selected, as well as a disabled control.
  const clear = () => {
    if (selected.length === 0) return;
    onClear();
  };

  // The controls slot is one fixed element (P2B7V): no conditional may
  // appear here, so the grid beneath never moves.
  const controls = <ClearAction disabled={selected.length === 0} onPress={clear} />;

  return (
    <OnboardingFrame
      headline={ALLERGENS_HEADLINE}
      body={ALLERGENS_BODY}
      progress={stepProgress('allergens')}
      back={{ label: BACK_LABEL, hint: BACK_HINT, onPress: onBack }}
      footer={<Button label={CONTINUE_CTA} onPress={onContinue} />}>
      <View style={styles.selector}>
        {/* The count beside Clear; stacked from one column, where the row is
            the accessibility sizes' and the words need the width. */}
        <View style={[styles.countRow, columns === 1 && styles.countRowStacked]}>
          {/* One element in the 44pt box, so its frame starts level with
              Clear's and VoiceOver reads the count first. */}
          <View accessible style={styles.count}>
            <SelectionCount text={allergenCountLabel(selected.length)} />
          </View>
          <View style={styles.controls}>{controls}</View>
        </View>
        <View style={styles.grid}>
          {allergenGridRows(CONSUMER_ALLERGENS, columns).map((row) => (
            <View key={row[0].token} style={styles.gridRow}>
              {row.map((option) => (
                <AllergenTile
                  key={option.token}
                  option={option}
                  checked={selected.includes(option.token)}
                  onPress={() => onToggle(option.token)}
                  stacked={stacked}
                  reduceMotion={reduceMotion}
                />
              ))}
              {/* A short last row keeps its tile at column width. */}
              {row.length < columns ? <View style={styles.gridSpacer} /> : null}
            </View>
          ))}
        </View>
      </View>
    </OnboardingFrame>
  );
}

/**
 * `Clear selection` as a compact text action: `body-small-bold`, never
 * underlined, in the interactive `action/secondary` while it can act and
 * `text/secondary` when there is nothing to clear, reported disabled. A full
 * 44pt target, so the row it sits in is 44pt whether or not it can act.
 */
function ClearAction({ disabled, onPress }: { disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={CLEAR_SELECTION_LABEL}
      accessibilityHint={CLEAR_ALLERGENS_HINT}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.clear, pressed && styles.pressed]}>
      <Text variant="body-small-bold" color={disabled ? 'text/secondary' : 'action/secondary'}>
        {CLEAR_SELECTION_LABEL}
      </Text>
    </Pressable>
  );
}

/** One allergen: one checkbox element, the whole tile its target. */
function AllergenTile({
  option,
  checked,
  onPress,
  stacked,
  reduceMotion,
}: {
  option: AllergenOption;
  checked: boolean;
  onPress: () => void;
  /** Pictogram and checkbox on a top line, the label beneath (the largest sizes). */
  stacked: boolean;
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

  // Decorative: hidden and untouchable, so the tile is heard as its name and
  // state alone and the whole tile stays the one target. The same picture,
  // untinted, whether or not the tile is chosen.
  const pictogram = (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={styles.pictogram}>
      <Image
        source={allergenPictogram(option.token) ?? undefined}
        resizeMode="contain"
        accessible={false}
        style={styles.pictogramImage}
      />
    </View>
  );
  const check = (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <CheckIndicator checked={checked} fill={fill} />
    </View>
  );
  const label = (
    <Text variant="body" style={stacked ? undefined : styles.label}>
      {option.label}
    </Text>
  );

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={option.label}
      accessibilityState={{ checked }}
      onPress={onPress}
      style={styles.tileSlot}>
      {({ pressed }) => (
        <View style={[styles.tile, stacked && styles.tileStacked, pressed && styles.pressed]}>
          <View style={[styles.layer, styles.layerOpen]} />
          <Animated.View style={[styles.layer, styles.layerChosen, { opacity: fill }]} />
          {stacked ? (
            <>
              <View style={styles.marksStacked}>
                {pictogram}
                {check}
              </View>
              {label}
            </>
          ) : (
            <>
              {pictogram}
              {label}
              {check}
            </>
          )}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  selector: {
    gap: spacing[8],
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[12],
  },
  countRowStacked: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 0,
  },
  // The same 44pt box as Clear beside it: iOS orders elements by their top
  // edge, so equal tops make VoiceOver read the count first, then Clear.
  // The box itself is the accessibility element (its frame is the box's).
  count: {
    flexShrink: 1,
    minHeight: hitTarget.minimum,
    justifyContent: 'center',
  },
  controls: {
    flexShrink: 0,
  },
  clear: {
    minHeight: hitTarget.minimum,
    justifyContent: 'center',
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
  // The pictogram and check on a stacked tile's top line, the label beneath.
  tileStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  marksStacked: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  // A fixed box, so every label starts at one x. Its transparent sides
  // overhang the padding and the gap (lib/allergen-grid.ts, `TILE`).
  pictogram: {
    width: TILE.pictogram,
    height: TILE.pictogram,
    marginHorizontal: -TILE.pictogramOverhang,
  },
  pictogramImage: {
    width: TILE.pictogram,
    height: TILE.pictogram,
  },
  label: {
    flex: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});
