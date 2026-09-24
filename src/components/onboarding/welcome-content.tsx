/**
 * Screen 1, Welcome (onboarding brand pass 1): the Lotly introduction.
 *
 * One promise, one short explanation, one real example, one action. From the
 * top: the name `lotly` above the approved mascot, the headline and body in
 * the frame's own heading block, the illustrative example card (the Feed's
 * card surface, labelled `Example`), the source note, and `Get started` in
 * the sticky footer. Not a counted step, so the frame shows no progress and
 * no back control.
 *
 * ## The mascot
 *
 * The approved production asset (assets/brand/production), drawn whole with
 * `contain` on the page colour: never cropped, never on a dark surface, never
 * recoloured, sized by `mascotSize` (lib/welcome-presentation.ts). Its box
 * is given a width and a height: an `Image` sized by `aspectRatio` alone was
 * laid out at the asset's 1024pt intrinsic size on device. It is decorative:
 * VoiceOver reads the name beside it, not a description of the drawing.
 *
 * ## The entrance
 *
 * Once, on first appearance (lib/welcome-presentation.ts): the mascot fades
 * in and settles from slightly small, then the heading and the example card
 * rise a short way as they fade in, done in under a second. Nothing loops. Under
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
  MASCOT_CLEAR_MARGIN,
  MASCOT_START_SCALE,
  mascotSize,
  RISE_DISTANCE,
  WELCOME_ENTRANCE,
  welcomeEntrance,
} from '@/lib/welcome-presentation';

/** The approved mascot: a 1024×1024 transparent PNG, drawn whole. */
const MASCOT =
  require('@/assets/brand/production/lotly-mascot-transparent.png') as ImageSourcePropType;

export function WelcomeContent({ onGetStarted }: { onGetStarted: () => void }) {
  const { height } = useWindowDimensions();
  const motion = useWelcomeEntrance();
  const size = mascotSize(height);
  const tuck = Math.round(size * MASCOT_CLEAR_MARGIN);
  return (
    <OnboardingFrame
      headline={WELCOME_HEADLINE}
      body={WELCOME_BODY}
      headingMotion={motion.heading}
      lead={
        <View style={styles.hero}>
          <Text variant="heading-2" color="text/primary" style={styles.wordmark}>
            {WORDMARK}
          </Text>
          <Animated.View style={motion.mascot}>
            <Image
              source={MASCOT}
              resizeMode="contain"
              style={{ width: size, height: size, marginVertical: -tuck }}
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
          </Animated.View>
        </View>
      }
      footer={<Button label={WELCOME_CTA} onPress={onGetStarted} />}>
      <Animated.View style={[styles.example, motion.card]}>
        <SampleRecallCard label={WELCOME_EXAMPLE_LABEL} />
        <Text variant="caption" color="text/secondary">
          {WELCOME_TRUST_NOTE}
        </Text>
      </Animated.View>
    </OnboardingFrame>
  );
}

/**
 * The entrance, played once. Every value starts hidden and is either animated
 * to its final state or, under Reduce Motion, set there at once.
 */
function useWelcomeEntrance() {
  // Created once, by the lazy initializer: stable across renders without a ref.
  const [{ mascotFade, mascotSettle, heading, card }] = useState(() => ({
    mascotFade: new Animated.Value(0),
    mascotSettle: new Animated.Value(0),
    heading: new Animated.Value(0),
    card: new Animated.Value(0),
  }));

  useEffect(() => {
    const values = [mascotFade, mascotSettle, heading, card];
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
          step(mascotFade, WELCOME_ENTRANCE.mascotFade, Easing.out(Easing.quad)),
          step(mascotSettle, WELCOME_ENTRANCE.mascotSettle, Easing.out(Easing.back(1.4))),
          step(heading, WELCOME_ENTRANCE.heading, Easing.out(Easing.cubic)),
          step(card, WELCOME_ENTRANCE.card, Easing.out(Easing.cubic)),
        ]);
        running.start();
      });
    return () => {
      cancelled = true;
      running?.stop();
    };
  }, [mascotFade, mascotSettle, heading, card]);

  const rise = (value: Animated.Value) => ({
    opacity: value,
    transform: [
      {
        translateY: value.interpolate({ inputRange: [0, 1], outputRange: [RISE_DISTANCE, 0] }),
      },
    ],
  });
  return {
    mascot: {
      opacity: mascotFade,
      transform: [
        {
          scale: mascotSettle.interpolate({
            inputRange: [0, 1],
            outputRange: [MASCOT_START_SCALE, 1],
          }),
        },
      ],
    },
    heading: rise(heading),
    card: rise(card),
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
  // The name and the mascot, centred together as the page's one picture.
  hero: {
    alignItems: 'center',
    gap: spacing[4],
  },
  wordmark: {
    textAlign: 'center',
  },
  example: {
    gap: spacing[16],
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
