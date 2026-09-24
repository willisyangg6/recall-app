/**
 * Screen 1, Welcome: the Lotly introduction.
 *
 * One promise, one short explanation, one real example, one action. From the
 * top: the name `lotly`, the headline and body in the frame's own heading
 * block, then the M01 mascot peeking over the illustrative example card (the
 * Feed's own card surface, labelled `Example`), the source note, and `Get
 * started` in the sticky footer. Not a counted step, so the frame shows no
 * progress and no back control.
 *
 * ## M01 on the card
 *
 * The approved welcome-peek artwork, drawn whole with `contain` on the page
 * colour: never cropped, never on a dark surface, never recoloured. It is
 * seated by lib/welcome-presentation.ts: its flat bottom cut sits on the
 * card's top border and its paws rest on the card, right-aligned so it rises
 * clear of the `Example` label at every text size. It is drawn over the card
 * as the card's sibling, so it is never part of the card's accessibility
 * element; `pointerEvents="none"` lets every touch through to what is under
 * it; and it is hidden from VoiceOver as decoration. Its box is given a width
 * and a height: an `Image` sized by `aspectRatio` alone was laid out at the
 * asset's 1024pt intrinsic size on device.
 *
 * ## The entrance
 *
 * Once, on first appearance: the heading rises in, then the mascot rises from
 * behind the card as it fades in, and the card, its label and the source note
 * follow with a smaller rise, all within a second. Nothing loops. Under
 * Reduce Motion, or if the setting cannot be read, everything is shown in its
 * final state at once. The footer never animates, so `Get started` is there
 * from the first frame.
 *
 * Presentational: the route hands in `onGetStarted`; the Design Preview
 * hands in nothing that navigates.
 */

import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  StyleSheet,
  useWindowDimensions,
  View,
  type ImageSourcePropType,
} from 'react-native';

import { OnboardingFrame } from '@/components/onboarding/onboarding-frame';
import { SampleRecallCard } from '@/components/onboarding/sample-recall-card';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { color, radius, spacing } from '@/constants/design-tokens';
import {
  WELCOME_BODY,
  WELCOME_CTA,
  WELCOME_EXAMPLE_LABEL,
  WELCOME_HEADLINE,
  WELCOME_TRUST_NOTE,
  WORDMARK,
} from '@/lib/onboarding-copy';
import {
  CARD_RISE,
  HEADING_RISE,
  MASCOT_RISE,
  mascotOffset,
  mascotSize,
  peekReserve,
  WELCOME_ENTRANCE,
  welcomeEntrance,
} from '@/lib/welcome-presentation';

/** M01, the approved welcome-peek mascot: a 1024×1024 transparent PNG. */
const MASCOT =
  require('@/assets/brand/production/lotly-mascot-welcome-peek-1024.png') as ImageSourcePropType;

export function WelcomeContent({ onGetStarted }: { onGetStarted: () => void }) {
  const { height } = useWindowDimensions();
  const motion = useWelcomeEntrance();
  const size = mascotSize(height);
  return (
    <OnboardingFrame
      headline={WELCOME_HEADLINE}
      body={WELCOME_BODY}
      headingMotion={motion.heading}
      lead={
        <Text variant="heading-2" color="text/primary">
          {WORDMARK}
        </Text>
      }
      footer={<Button label={WELCOME_CTA} onPress={onGetStarted} />}>
      <View style={[styles.example, { paddingTop: peekReserve(size) }]}>
        <SampleRecallCard
          label={WELCOME_EXAMPLE_LABEL}
          motion={motion.card}
          peek={
            <Animated.View
              pointerEvents="none"
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[
                styles.peek,
                { width: size, height: size, top: -mascotOffset(size) },
                motion.mascot,
              ]}>
              <Image
                source={MASCOT}
                resizeMode="contain"
                style={{ width: size, height: size }}
                accessible={false}
              />
            </Animated.View>
          }
        />
        <Animated.View style={motion.card}>
          <Text variant="caption" color="text/secondary">
            {WELCOME_TRUST_NOTE}
          </Text>
        </Animated.View>
      </View>
    </OnboardingFrame>
  );
}

/**
 * The entrance, played once. Every value starts hidden and is either animated
 * to its final state or, under Reduce Motion, set there at once.
 */
function useWelcomeEntrance() {
  // Created once, by the lazy initializer: stable across renders without a ref.
  const [{ heading, mascotFade, mascotRise, card }] = useState(() => ({
    heading: new Animated.Value(0),
    mascotFade: new Animated.Value(0),
    mascotRise: new Animated.Value(0),
    card: new Animated.Value(0),
  }));

  useEffect(() => {
    const values = [heading, mascotFade, mascotRise, card];
    let cancelled = false;
    let running: Animated.CompositeAnimation | null = null;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => true)
      .then((reduceMotion) => {
        if (cancelled) return;
        if (welcomeEntrance(reduceMotion) === 'show') {
          for (const value of values) value.setValue(1);
          return;
        }
        const step = (
          value: Animated.Value,
          { delay, duration }: { delay: number; duration: number },
          easing: (t: number) => number,
        ) => Animated.timing(value, { toValue: 1, delay, duration, easing, useNativeDriver: true });
        running = Animated.parallel([
          step(heading, WELCOME_ENTRANCE.heading, Easing.out(Easing.cubic)),
          step(mascotFade, WELCOME_ENTRANCE.mascotFade, Easing.out(Easing.quad)),
          step(mascotRise, WELCOME_ENTRANCE.mascotRise, Easing.out(Easing.back(1.2))),
          step(card, WELCOME_ENTRANCE.card, Easing.out(Easing.cubic)),
        ]);
        running.start();
      });
    return () => {
      cancelled = true;
      running?.stop();
    };
  }, [heading, mascotFade, mascotRise, card]);

  const rise = (value: Animated.Value, distance: number) => ({
    transform: [
      { translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) },
    ],
  });
  return {
    heading: { opacity: heading, ...rise(heading, HEADING_RISE) },
    mascot: { opacity: mascotFade, ...rise(mascotRise, MASCOT_RISE) },
    card: { opacity: card, ...rise(card, CARD_RISE) },
  };
}

/**
 * Three short rows, each a brand-coloured mark beside its sentence. Welcome
 * no longer shows these; the paywall's benefit list still does.
 */
export function BenefitList({ items }: { items: readonly string[] }) {
  return (
    <View style={styles.benefits} accessibilityRole="list">
      {items.map((item) => (
        <View key={item} style={styles.benefit}>
          <View style={styles.mark} />
          <Text variant="body" style={styles.benefitText}>
            {item}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // Centred in whatever height the heading leaves, so a tall phone shares its
  // spare room above and below the example instead of pooling it by the footer.
  example: {
    gap: spacing[16],
    marginVertical: 'auto',
  },
  // Right-aligned on the card; `top` (from mascotOffset) seats its cut on the border.
  peek: {
    position: 'absolute',
    right: 0,
  },
  benefits: {
    gap: spacing[8],
  },
  benefit: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[12],
  },
  // A small brand mark, centred on the first line of body text.
  mark: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: color['icon/brand'],
    marginTop: 8,
  },
  benefitText: {
    flex: 1,
  },
});
