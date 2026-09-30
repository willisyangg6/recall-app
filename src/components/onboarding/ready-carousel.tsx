/**
 * The Ready step's personalized recall deck (2026-09-28; deck depth and the
 * frosted locked card in the polish pass): a swipeable, overlapping deck of
 * real matches, drawn with the Feed's own card surface over the Feed's own
 * models — one data layer, one matching layer, one card
 * (lib/ready-preview.ts).
 *
 * ## Depth, not a list
 *
 * One card per page. The next card waits partly BEHIND the active card's
 * trailing edge: scaled to `DECK_NEXT_SCALE` and tucked `DECK_TUCK` toward
 * it, under a descending static z-order, so the active card always covers
 * the one behind. Both transforms interpolate on the scroll position alone
 * — direct manipulation that follows the finger, never an autonomous
 * animation — and settle as the snap settles. No arrows, no instruction
 * copy, no auto-advance, no loop, and restrained depth: the cards keep
 * their own `card` elevation and nothing else.
 *
 * ## Uniform cards
 *
 * Every deck card takes the SAME outer size at a given width and text-size
 * class: the shared surface's uniform variant reserves every slot and
 * line-limits the wrapping ones (lib/ready-presentation
 * `previewCardLayout`). Every deck card has an image by construction — the
 * preview keeps only image-bearing matches — so the media region is
 * identical too. From the accessibility text sizes the layout is null and
 * the cards wrap freely: an accessible responsive deck, never capped type.
 *
 * ## The locked final card
 *
 * When a real next image-bearing match exists, the deck's LAST page is that
 * recall's own card, frosted: the full uniform card beneath a real blur
 * (`expo-blur`'s BlurView — React Native's own `Image.blurRadius` blurs
 * only images, not the card's words, and the installed glass effect is
 * exactly what the design forbids) with one centered lock — no
 * explanatory text, nothing scrollable after it. Under Reduce
 * Transparency the blur yields to an opaque frost, as iOS materials do.
 * Either way the recall underneath is illegible. To assistive technology
 * it is ONE concise button (the plan screen); the frosted content is
 * hidden entirely, so VoiceOver never traverses illegible content and
 * nothing of the recall is exposed. The persistent explanation stays where
 * it was: the locked STRIP below the deck, unchanged.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
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
import { PREVIEW_LOCKED_CARD_TITLE, PREVIEW_LOCKED_HINT } from '@/lib/onboarding-copy';
import type { HomeCardModel } from '@/lib/recall-presentation';
import {
  CAROUSEL_GAP,
  carouselActiveIndex,
  carouselCardWidth,
  carouselSnapInterval,
  DECK_NEXT_SCALE,
  deckStatusHeight,
  DECK_TUCK,
  previewCardLayout,
  type PreviewCardLayout,
} from '@/lib/ready-presentation';
import { matchAccessibilityLabel } from '@/lib/ready-preview';

type DeckItem = { kind: 'match'; model: HomeCardModel } | { kind: 'locked'; model: HomeCardModel };

/** The blur's strength over the locked card: enough that no word survives. */
const FROST_INTENSITY = 60;
/** Under Reduce Transparency: an opaque frost, still illegible underneath. */
const FROST_OPAQUE = 0.96;

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

export function ReadyCarousel({
  models,
  locked,
  usableWidth,
  onLockedPress,
}: {
  /** The readable image-bearing matches, at most the limit, in rank order. */
  models: readonly HomeCardModel[];
  /** The REAL next image-bearing match, frosted as the final card; or null. */
  locked: HomeCardModel | null;
  /** The deck's width: the content width between the page margins. */
  usableWidth: number;
  /** The locked card's one action: the plan screen, never a hidden recall. */
  onLockedPress: () => void;
}) {
  const [active, setActive] = useState(0);
  const [scrollX] = useState(() => new Animated.Value(0));
  const { fontScale } = useWindowDimensions();
  // Every card reserves the tallest status row the deck measured, so all
  // titles start on one line (lib/ready-presentation `deckStatusHeight`).
  const [statusRows, setStatusRows] = useState<readonly number[]>([]);
  const onStatusLayout = useCallback((height: number) => {
    setStatusRows((prior) =>
      prior.some((h) => Math.ceil(h) >= Math.ceil(height)) ? prior : [...prior, height],
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
  const cardWidth = carouselCardWidth(usableWidth);
  const stride = carouselSnapInterval(usableWidth);
  const items: DeckItem[] = [
    ...models.map((model) => ({ kind: 'match', model }) as DeckItem),
    ...(locked ? [{ kind: 'locked', model: locked } as DeckItem] : []),
  ];
  const dots = models.length >= 2 ? models.length : 0;

  /** The waiting card's depth: scaled and tucked until the snap brings it out. */
  const depth = (index: number) => {
    const inputRange = [(index - 1) * stride, index * stride];
    return {
      transform: [
        {
          translateX: scrollX.interpolate({
            inputRange,
            outputRange: [-DECK_TUCK, 0],
            extrapolate: 'clamp',
          }),
        },
        {
          scale: scrollX.interpolate({
            inputRange,
            outputRange: [DECK_NEXT_SCALE, 1],
            extrapolate: 'clamp',
          }),
        },
      ],
    };
  };

  return (
    <View style={styles.deck}>
      <Animated.FlatList
        data={items}
        keyExtractor={(item: DeckItem) => `${item.kind}-${item.model.id}`}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={stride}
        decelerationRate="fast"
        disableIntervalMomentum
        ItemSeparatorComponent={Separator}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
          useNativeDriver: true,
          listener: (event) =>
            setActive(
              carouselActiveIndex(
                (event as { nativeEvent: { contentOffset: { x: number } } }).nativeEvent
                  .contentOffset.x,
                usableWidth,
                items.length,
              ),
            ),
        })}
        scrollEventThrottle={16}
        renderItem={({ item, index }: { item: DeckItem; index: number }) => (
          // The active card must COVER the one waiting behind it, so the
          // z-order descends with the index; the transforms change no layout.
          <Animated.View style={[{ width: cardWidth, zIndex: items.length - index }, depth(index)]}>
            {item.kind === 'match' ? (
              <View
                accessible
                accessibilityLabel={matchAccessibilityLabel(item.model, index, models.length)}>
                <RecallCardSurface
                  model={item.model}
                  media={
                    <MediaTile
                      uri={item.model.heroImageUrl}
                      alt={item.model.productName}
                      size={layout.cardMediaSize}
                    />
                  }
                  trailing={null}
                  uniform={uniform}
                />
              </View>
            ) : (
              <LockedCard model={item.model} uniform={uniform} onPress={onLockedPress} />
            )}
          </Animated.View>
        )}
      />
      {dots > 0 ? (
        <View
          style={styles.dots}
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants">
          {Array.from({ length: dots }, (_, i) => (
            <View
              key={i}
              style={[styles.dot, i === Math.min(active, dots - 1) && styles.dotActive]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The final page: the REAL next image-bearing match's own card — the same
 * uniform surface and dimensions as the readable cards — under the frost
 * and one centered lock. No text of its own; the recall underneath is
 * hidden from assistive technology entirely, and the whole card is one
 * button to the plan screen.
 */
function LockedCard({
  model,
  uniform,
  onPress,
}: {
  model: HomeCardModel;
  uniform: PreviewCardLayout | null;
  onPress: () => void;
}) {
  const reduceTransparency = useReduceTransparency();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={PREVIEW_LOCKED_CARD_TITLE}
      accessibilityHint={PREVIEW_LOCKED_HINT}
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}>
      <View
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none">
        <RecallCardSurface
          model={model}
          media={<MediaTile uri={model.heroImageUrl} alt="" size={layout.cardMediaSize} />}
          trailing={null}
          uniform={uniform}
        />
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
      </View>
    </Pressable>
  );
}

function Separator() {
  return <View style={styles.gap} />;
}

const styles = StyleSheet.create({
  deck: {
    gap: spacing[12],
  },
  gap: {
    width: CAROUSEL_GAP,
  },
  // The wash matches the card's own radius, so the frosted edge is the
  // card's edge; the card's shadow stays outside it, untouched.
  frost: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius[16],
    overflow: 'hidden',
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
