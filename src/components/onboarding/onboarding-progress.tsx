/**
 * The onboarding progress (P2B7Y): four segments and the `1 of 4` line, in
 * the frame's top bar on the four counted steps — States, Allergens,
 * Retailers and the Preview. Welcome, the paywall and the notification
 * education pass no progress and draw none.
 *
 * - Completed and current segments fill `onboarding/progress`; the steps
 *   still ahead keep the quiet `background/subtle` track. The words `1 of 4`
 *   stay visible beneath, so colour is never the only channel.
 * - One accessibility element, spoken `Step 1 of 4: States`; the segments
 *   themselves are not announced.
 * - The current segment fills once, briefly, when the step appears, and only
 *   when Reduce Motion is known to be off; otherwise it is drawn full at
 *   once. Nothing loops.
 */

import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { color, radius, spacing } from '@/constants/design-tokens';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import {
  filledSegments,
  motionAllowed,
  progressAccessibilityLabel,
  progressLabel,
  type StepProgress,
} from '@/lib/onboarding-state';

/**
 * The current segment fills once the screen's push has settled (the stack
 * transition takes about 350ms), so the fill is seen rather than spent
 * under the slide.
 */
export const PROGRESS_FILL = { delay: 280, duration: 240 } as const;
/** The bar's thickness: a mark, not text, so it does not scale. */
const THICKNESS = 6;

export function OnboardingProgress({ progress }: { progress: StepProgress }) {
  const reduceMotion = useReduceMotion();
  // Decided once, on the first render: a step that appears while the
  // setting is unknown draws its final state and never animates late.
  const [animate] = useState(() => motionAllowed(reduceMotion));
  const [fill] = useState(() => new Animated.Value(animate ? 0 : 1));
  useEffect(() => {
    if (!animate) return;
    const run = Animated.timing(fill, {
      toValue: 1,
      delay: PROGRESS_FILL.delay,
      duration: PROGRESS_FILL.duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [animate, fill]);

  const segments = filledSegments(progress);
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={progressAccessibilityLabel(progress)}
      style={styles.progress}>
      <View style={styles.bar}>
        {segments.map((filled, i) => (
          <View key={i} style={styles.segment}>
            {filled ? (
              <Animated.View
                style={[
                  styles.fill,
                  i === progress.index - 1 ? { transform: [{ scaleX: fill }] } : null,
                ]}
              />
            ) : null}
          </View>
        ))}
      </View>
      <Text variant="label" color="text/secondary">
        {progressLabel(progress)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  progress: {
    alignItems: 'flex-end',
    gap: spacing[4],
  },
  bar: {
    flexDirection: 'row',
    gap: spacing[4],
  },
  segment: {
    width: spacing[24],
    height: THICKNESS,
    borderRadius: radius.full,
    backgroundColor: color['background/subtle'],
    overflow: 'hidden',
  },
  fill: {
    flex: 1,
    backgroundColor: color['onboarding/progress'],
    transformOrigin: 'left',
  },
});
