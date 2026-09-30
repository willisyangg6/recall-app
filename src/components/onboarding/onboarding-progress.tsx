/**
 * The onboarding progress (P2B7Y; full-width, 2026-09-28): five equal
 * segments across the usable content width, in the frame's chrome on the
 * five counted screens — the two problem screens, States, Allergens and
 * Stores. Welcome, the building interstitial, Ready and the paywall pass no
 * progress and draw none.
 *
 * - Completed and current segments fill `onboarding/progress` (the
 *   personalization lime); the steps still ahead keep the pale
 *   `background/subtle` track. There is NO visible numeric copy — the count
 *   lives in the spoken label.
 * - One accessibility element, spoken `Onboarding progress, step 3 of 5`;
 *   the segments themselves are never separate elements.
 * - The bar's height is fixed (a 6pt mark, not text), so progress changes
 *   never move it vertically.
 * - The current segment fills once, briefly, only when it was JUST reached
 *   — the step directly after the last one shown (`segmentFillAnimates`) —
 *   and only when Reduce Motion is known to be off. Going back, resuming
 *   after a relaunch, or re-entering a step draws every segment in its
 *   final state on the first frame, so a segment that was already complete
 *   never empties and refills (polish pass). Nothing loops.
 */

import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { color, radius, spacing } from '@/constants/design-tokens';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import {
  filledSegments,
  motionAllowed,
  progressAccessibilityLabel,
  segmentFillAnimates,
  type StepProgress,
} from '@/lib/onboarding-state';

/**
 * The last progress index a bar was drawn at, this process. Module state on
 * purpose: each step mounts its own bar, and only a bar can know what the
 * one before it showed. A relaunch starts it empty, so a resumed step draws
 * its final state.
 */
let lastShownIndex: number | null = null;

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
  // setting is unknown draws its final state and never animates late, and
  // only a step reached FORWARD, by exactly one, fills its segment.
  const [animate] = useState(
    () => motionAllowed(reduceMotion) && segmentFillAnimates(lastShownIndex, progress.index),
  );
  useEffect(() => {
    lastShownIndex = progress.index;
  }, [progress.index]);
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
      accessibilityRole="progressbar"
      accessibilityLabel={progressAccessibilityLabel(progress)}
      style={styles.bar}>
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
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    gap: spacing[4],
    width: '100%',
  },
  // Equal segments share the row; the bar's height never changes.
  segment: {
    flex: 1,
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
