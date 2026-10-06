/**
 * The Ready step's recall deck (the physical deck, 2026-10-01): real matches
 * drawn with the Feed's own card surface over the Feed's own models — one
 * data layer, one matching layer, one card (lib/ready-preview.ts).
 *
 * ## A physical stack
 *
 * The REAL cards, stacked: the active card on top, upright and full size;
 * the next genuine cards mounted directly beneath it, each uniformly smaller
 * than the one in front and pushed right, so at rest only a narrow clean
 * white strip of each one's right edge shows — inside its own padding, so
 * nothing of a later recall (or the locked one) leaks. At most two show; a
 * single match has nothing behind it. Every pose is one table by depth
 * (lib/ready-presentation `deckPoseRanges`).
 *
 * ## The gesture
 *
 * A horizontal drag moves the deck's one `position`. Forward, the top card
 * follows the finger LEFT and leaves the deck to the left as a rigid
 * rectangle — never scaled, turned, skewed or resized — and the card
 * beneath, uncovered where it already sits, comes forward into the active
 * place by one uniform scale-and-move; the cards behind each rise one
 * place. Backward is the reverse: the previous card returns from the left
 * over the stack. A release commits one card when the drag travelled far
 * enough or was flicked (`deckReleaseTarget`); otherwise the stack settles
 * back exactly as it was. Past either end the deck resists and returns.
 * Under Reduce Motion the cards still follow the finger (direct
 * manipulation), but the settle is immediate.
 *
 * ## One index
 *
 * `active` is the committed card. It changes the moment a release (or an
 * accessibility move) commits — on that frame, before the settle — and it
 * drives the dots, the pointer target and the spoken value together, with
 * no timeout, debounce or second animation. A cancelled drag never changes
 * it. There is one dot per navigable page — the locked final page included
 * — and none for a single card.
 *
 * ## Stable geometry
 *
 * Every card is the height of the tallest one measured (`deckCardHeight`),
 * so the deck is one rectangle that no gesture resizes; geometry is
 * re-measured only when the content or the text size changes (the step
 * remounts the deck then), never from a drag.
 *
 * ## One element for assistive technology
 *
 * The deck is ONE adjustable element named `Your recall preview` whose value
 * is the active card's complete content (`matchAccessibilityLabel`); swiping
 * up or down moves to the next or previous card, with no visual arrows. On
 * the locked final card the value is `More matches are locked` and
 * activating it opens the plan screen; nothing of that recall is exposed.
 *
 * ## The locked final card
 *
 * When a real next image-bearing match exists, the deck's LAST page is that
 * recall's own card under a real blur (`expo-blur`) with one centered lock —
 * no text of its own. Under Reduce Transparency the blur yields to an opaque
 * frost.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  PanResponder,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';

import { RecallCardSurface } from '@/components/recall-card';
import { Icon } from '@/components/ui/icon';
import { MediaTile } from '@/components/ui/media-tile';
import { color, layout, radius, spacing } from '@/constants/design-tokens';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import {
  PREVIEW_LOCKED_CARD_TITLE,
  PREVIEW_LOCKED_HINT,
  PREVIEW_MATCH_HEADING,
} from '@/lib/onboarding-copy';
import { motionAllowed } from '@/lib/onboarding-state';
import type { HomeCardModel } from '@/lib/recall-presentation';
import {
  DECK_SETTLE_MS,
  deckCardHeight,
  deckDotCount,
  deckDragPosition,
  deckExitDistance,
  deckFrontWidth,
  deckPoseRanges,
  deckReleaseTarget,
  deckStatusHeight,
  previewCardLayout,
  previewCardUniform,
  type PreviewCardLayout,
  wholePoints,
} from '@/lib/ready-presentation';
import { matchAccessibilityLabel } from '@/lib/ready-preview';

type DeckItem = { kind: 'match'; model: HomeCardModel } | { kind: 'locked'; model: HomeCardModel };

/** The blur's strength over the locked card: enough that no word survives. */
const FROST_INTENSITY = 60;
/** Under Reduce Transparency: an opaque frost, still illegible underneath. */
const FROST_OPAQUE = 0.96;

/**
 * The stack draws its cards unclipped, so their faint shadow (the `card`
 * elevation: 8pt blur at 6%, 2pt down) needs no room above them; below,
 * the dots sit 4pt under the card.
 */
const DECK_ROOM = { top: 0, bottom: spacing[4] } as const;

/** A drag claims the deck once it is clearly horizontal. */
const DRAG_SLOP = 6;

const HIDDEN = {
  accessible: false,
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
} as const;

/** The reader's Reduce Transparency setting; unknown counts as off. */
function useReduceTransparency(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceTransparencyEnabled().then(
      (value) => live && setReduce(value),
      () => {},
    );
    const subscription = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReduce);
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);
  return reduce;
}

export function ReadyDeck({
  models,
  locked,
  width,
  onLockedPress,
  onBusyChange,
  initialCardHeight,
  onCardHeight,
  onPhotoFailed,
}: {
  /** The readable cards, at most the limit, in selection order. */
  models: readonly HomeCardModel[];
  /** The REAL next match, frosted as the final card; or null. */
  locked: HomeCardModel | null;
  /** The deck's width: the content width between the page margins. */
  width: number;
  /** The locked card's one action: the plan screen, never a hidden recall. */
  onLockedPress: () => void;
  /**
   * The deck is busy from the moment a drag takes the responder (or a move
   * is committed) until its cards have settled. A holder uses this to apply
   * new content only at rest, so a deck is never replaced mid-gesture
   * (2026-10-05). A settle starting reports `(true, 'settle')`.
   */
  onBusyChange?: (busy: boolean, phase?: 'settle') => void;
  /** A readable card's photo failed to render after all: the holder may reclassify it. */
  onPhotoFailed?: (url: string) => void;
  /**
   * The card height the deck this one replaces had measured. A rebuilt deck
   * keeps that room until its own cards have measured, so the dots and the
   * strip below never ride up over its first frame (2026-10-05).
   */
  initialCardHeight?: number;
  /** This deck's measured card height, for the deck that replaces it. */
  onCardHeight?: (height: number) => void;
}) {
  const { fontScale } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const [active, setActive] = useState(0);
  // The deck's one continuous progress: `active` at rest.
  const [position] = useState(() => new Animated.Value(0));
  // Every card's height, raised to the tallest (a brand line can wrap), so
  // one deck is one size of rigid rectangle.
  const [cardRows, setCardRows] = useState<readonly number[]>([]);
  const onCardLayout = useCallback((height: number) => {
    setCardRows((prior) =>
      prior.some((h) => wholePoints(h) >= wholePoints(height)) ? prior : [...prior, height],
    );
  }, []);
  const cardHeight = deckCardHeight(cardRows);
  // Every card is raised to it at every text size — from the accessibility
  // sizes too, where the line limits come off — so a taller card can never
  // show beneath the front one.
  const shared = cardHeight > 0 ? cardHeight : undefined;
  // The stack's room: its own measurement, or until then the deck it replaced.
  const room = cardHeight > 0 ? cardHeight : (initialCardHeight ?? 0);
  useEffect(() => {
    if (cardHeight > 0) onCardHeight?.(cardHeight);
  }, [cardHeight, onCardHeight]);
  // Every card reserves the tallest status row the deck measured, so all
  // titles start on one line (lib/ready-presentation `deckStatusHeight`).
  const [statusRows, setStatusRows] = useState<readonly number[]>([]);
  const onStatusLayout = useCallback((height: number) => {
    setStatusRows((prior) =>
      prior.some((h) => wholePoints(h) >= wholePoints(height)) ? prior : [...prior, height],
    );
  }, []);
  const rule = previewCardLayout(fontScale);
  const uniform = rule
    ? {
        ...rule,
        statusMinHeight: deckStatusHeight(rule.statusMinHeight, statusRows),
        onStatusLayout,
      }
    : null;
  const frontWidth = deckFrontWidth(width);
  const exit = deckExitDistance(frontWidth, layout.pageMargin);
  const items: DeckItem[] = [
    ...models.map((model) => ({ kind: 'match', model }) as DeckItem),
    ...(locked ? [{ kind: 'locked', model: locked } as DeckItem] : []),
  ];
  const count = items.length;
  const dots = deckDotCount(count);
  const current = items[Math.min(active, count - 1)];

  // Each card's pose, from its depth below the deck's position.
  const poses = useMemo(() => {
    const ranges = deckPoseRanges(frontWidth, exit);
    return Array.from({ length: count }, (_, index) => {
      const depth = Animated.subtract(index, position);
      const pose = (outputRange: number[]) =>
        depth.interpolate({ inputRange: ranges.inputRange, outputRange, extrapolate: 'clamp' });
      return {
        style: {
          opacity: pose(ranges.opacity),
          transform: [{ translateX: pose(ranges.translateX) }, { scale: pose(ranges.scale) }],
        },
        // The locked card's blur would spread its colours into the visible
        // strip, so behind the front it wears a plain white face, lifted as
        // it comes forward.
        veil: depth.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
      };
    });
  }, [count, frontWidth, exit, position]);

  // Commit a card: the index (dots, value, pointer target) changes now; the
  // cards settle after it, or at once under Reduce Motion.
  const settle = useCallback(
    (target: number) => {
      setActive(target);
      if (!motionAllowed(reduceMotion)) {
        position.setValue(target);
        onBusyChange?.(false);
        return;
      }
      onBusyChange?.(true, 'settle');
      Animated.timing(position, {
        toValue: target,
        duration: DECK_SETTLE_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        // A settle interrupted by a new drag is still busy: that drag's own
        // release settles again and reports rest itself.
        if (finished) onBusyChange?.(false);
      });
    },
    [position, reduceMotion, onBusyChange],
  );

  // The drag. Its inputs change only on a commit or a new layout — never
  // during a drag — so a gesture always keeps the responder it began with.
  const pan = useMemo(() => {
    const drag = { from: active };
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, g) =>
        count > 1 && Math.abs(g.dx) > DRAG_SLOP && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderGrant: () => {
        onBusyChange?.(true);
        // A drag during a settle carries on from wherever the cards are.
        drag.from = active;
        position.stopAnimation((value) => {
          drag.from = value;
        });
      },
      onPanResponderMove: (_, g) => {
        position.setValue(deckDragPosition(drag.from, count, g.dx, exit));
      },
      onPanResponderRelease: (_, g) => {
        settle(deckReleaseTarget(active, count, g.dx, g.vx, exit));
      },
      // Interrupted (a system gesture): the stack goes back as it was.
      onPanResponderTerminate: () => settle(active),
      onPanResponderTerminationRequest: () => false,
    });
  }, [active, count, exit, position, settle, onBusyChange]);

  const goTo = (index: number) => {
    const target = Math.min(Math.max(index, 0), count - 1);
    if (target !== active) settle(target);
  };

  const spoken =
    current.kind === 'match'
      ? matchAccessibilityLabel(current.model, active, models.length)
      : PREVIEW_LOCKED_CARD_TITLE;
  // From the accessibility sizes the tile moves above the text, so a title
  // is never squeezed beside it (2026-10-04); the Feed's own rule otherwise.
  const mediaPlacement = previewCardUniform(fontScale) ? 'beside' : 'above';

  return (
    <View style={styles.deck}>
      <View
        accessible
        accessibilityRole={
          count > 1 ? 'adjustable' : current.kind === 'locked' ? 'button' : undefined
        }
        // Adjustable: the deck is named once and its value is the active
        // card, which VoiceOver reads again after every move.
        accessibilityLabel={count > 1 ? PREVIEW_MATCH_HEADING : spoken}
        accessibilityValue={count > 1 ? { text: spoken } : undefined}
        accessibilityHint={current.kind === 'locked' ? PREVIEW_LOCKED_HINT : undefined}
        accessibilityActions={[
          { name: 'increment' },
          { name: 'decrement' },
          ...(current.kind === 'locked' ? [{ name: 'activate' as const }] : []),
        ]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'increment') goTo(active + 1);
          else if (event.nativeEvent.actionName === 'decrement') goTo(active - 1);
          else if (event.nativeEvent.actionName === 'activate') onLockedPress();
        }}
        style={[styles.stack, room > 0 && { height: DECK_ROOM.top + room + DECK_ROOM.bottom }]}
        {...pan.panHandlers}>
        {/* Painted last-first, so each card lies over the ones after it. */}
        {items
          .map((item, index) => ({ item, index }))
          .reverse()
          .map(({ item, index }) => (
            <Animated.View
              key={`${item.kind}-${item.model.id}`}
              // Only the front card takes a touch (the locked card's press).
              pointerEvents={index === active ? 'auto' : 'none'}
              onLayout={(event) => onCardLayout(event.nativeEvent.layout.height)}
              style={[styles.card, { width: frontWidth }, poses[index].style]}>
              {item.kind === 'match' ? (
                <DeckCard
                  item={item}
                  uniform={uniform}
                  height={shared}
                  mediaPlacement={mediaPlacement}
                  onPhotoFailed={onPhotoFailed}
                />
              ) : (
                <Pressable
                  accessible={false}
                  onPress={onLockedPress}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <DeckCard
                    item={item}
                    uniform={uniform}
                    height={shared}
                    mediaPlacement={mediaPlacement}
                    veil={poses[index].veil}
                  />
                </Pressable>
              )}
            </Animated.View>
          ))}
      </View>
      {dots > 0 ? (
        <View style={styles.dots} {...HIDDEN}>
          {Array.from({ length: dots }, (_, i) => (
            <View key={i} style={[styles.dot, i === active && styles.dotActive]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** A card's face: the real recall, or the real next recall frosted under a lock. */
function DeckCard({
  item,
  uniform,
  height,
  mediaPlacement,
  veil,
  onPhotoFailed,
}: {
  item: DeckItem;
  uniform: PreviewCardLayout | null;
  /** The deck's shared card height, at every text size; absent until measured. */
  height: number | undefined;
  /** A readable card's photo failed to render; the locked card reports nothing. */
  onPhotoFailed?: (url: string) => void;
  mediaPlacement: 'beside' | 'above';
  /** The locked card's plain face while it is behind the front card. */
  veil?: Animated.AnimatedInterpolation<number>;
}) {
  const reduceTransparency = useReduceTransparency();
  const card = (
    <RecallCardSurface
      model={item.model}
      media={
        <MediaTile
          uri={item.model.heroImageUrl}
          alt={item.kind === 'match' ? item.model.productName : ''}
          size={layout.cardMediaSize}
          onLoadFailed={item.kind === 'match' ? onPhotoFailed : undefined}
        />
      }
      trailing={null}
      uniform={uniform}
      deckHeight={height}
      mediaPlacement={mediaPlacement}
    />
  );
  if (item.kind === 'match') return card;
  return (
    <View {...HIDDEN} pointerEvents="none">
      {card}
      {reduceTransparency ? (
        <View style={[styles.frost, styles.frostOpaque]} />
      ) : (
        <BlurView intensity={FROST_INTENSITY} tint="light" style={styles.frost} />
      )}
      <View style={styles.lockSeat}>
        <View style={styles.lockWell}>
          <Icon name="lock" size={24} color="icon/primary" />
        </View>
      </View>
      {veil ? <Animated.View style={[styles.veil, { opacity: veil }]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // The stack's own bottom room is the gap before the dots.
  deck: {
    gap: 0,
  },
  stack: {
    width: '100%',
  },
  card: {
    position: 'absolute',
    left: 0,
    top: DECK_ROOM.top,
  },
  // The wash matches the card's own radius, so the frosted edge is the
  // card's edge; the card's shadow stays outside it, untouched.
  frost: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius[16],
    overflow: 'hidden',
  },
  veil: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius[16],
    borderWidth: 1,
    borderColor: color['border/subtle'],
    backgroundColor: color['background/surface'],
  },
  frostOpaque: {
    backgroundColor: color['background/surface'],
    opacity: FROST_OPAQUE,
  },
  lockSeat: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockWell: {
    width: 48,
    height: 48,
    borderRadius: radius[12],
    backgroundColor: color['background/surface'],
    borderWidth: 1,
    borderColor: color['border/subtle'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing[8],
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: color['background/subtle'],
  },
  dotActive: {
    backgroundColor: color['background/brand'],
  },
  pressed: {
    opacity: 0.6,
  },
});
