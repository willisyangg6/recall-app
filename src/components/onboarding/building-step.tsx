/**
 * The one-time "building your watch" interstitial (2026-09-28), between
 * Stores and Ready. The timing and captions are lib/building-watch.ts; the
 * route owns when it plays (once) and where it goes (Ready, by replacing
 * itself, so it never sits in the back chain).
 *
 * ## Composition
 *
 * The warm page; the approved M04 watchful mascot (its first integration),
 * decorative and untouchable; then the caption checklist. With motion
 * allowed the rows appear one at a time, each with a single short fade —
 * no rings, no loops, no springs — and rows already done carry the check.
 * Under Reduce Motion (or before the setting is known) the finished
 * checklist is drawn at once and the screen advances after a readable
 * minimum.
 *
 * ## Accessibility
 *
 * The checklist is ONE element, named `Building your recall watch`; the
 * rows are never announced one by one, and only the completion line is
 * announced when it arrives. The mascot is hidden. The route then replaces
 * this screen with Ready, whose own heading takes focus.
 */

import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  StyleSheet,
  View,
  type ImageSourcePropType,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/icon';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { layout, spacing } from '@/constants/design-tokens';
import type { UserRecallPreferences } from '@/domain/preferences';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { buildingSequence, CAPTION_MS, DONE_MS, REDUCED_MOTION_MS } from '@/lib/building-watch';
import { BUILDING_ACCESSIBILITY_LABEL, BUILDING_DONE_CAPTION } from '@/lib/onboarding-copy';
import { motionAllowed } from '@/lib/onboarding-state';

/** M04, the watchful pose: approved in the mascot set, first used here. */
const MASCOT =
  require('@/assets/brand/production/lotly-mascot-watchful-1024.png') as ImageSourcePropType;

/** The drawing's box: fixed, so appearing captions never move it. */
const MASCOT_SIZE = 160;
/** A row's one entrance, when motion is allowed. */
const ROW_FADE_MS = 200;

/** The decorative-subtree props: never heard, never touched. */
const DECORATIVE = {
  accessible: false,
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
  pointerEvents: 'none',
} as const;

export function BuildingStep({
  prefs,
  onDone,
}: {
  prefs: UserRecallPreferences;
  onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  // Decided once, on the first render: a screen that appears while the
  // setting is unknown draws the finished checklist and never animates late.
  const [animate] = useState(() => motionAllowed(reduceMotion));
  const [sequence] = useState(() => buildingSequence(prefs));
  const doneAt = sequence.length - 1;
  const [index, setIndex] = useState(() => (animate ? 0 : doneAt));
  const finished = useRef(false);
  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    onDone();
  };

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(BUILDING_ACCESSIBILITY_LABEL);
  }, []);

  useEffect(() => {
    if (index < doneAt) {
      const timer = setTimeout(() => setIndex((prior) => prior + 1), CAPTION_MS);
      return () => clearTimeout(timer);
    }
    // The completion line: announced, held briefly (longer under Reduce
    // Motion, where it is also the first thing seen), then Ready.
    AccessibilityInfo.announceForAccessibility(BUILDING_DONE_CAPTION);
    const timer = setTimeout(finish, animate ? DONE_MS : REDUCED_MOTION_MS);
    return () => clearTimeout(timer);
    // `finish` is a stable ref-guarded closure; the sequence never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, doneAt, animate]);

  return (
    <Surface background="background/page" style={styles.page}>
      <View
        style={[
          styles.content,
          { paddingTop: insets.top + spacing[48], paddingBottom: insets.bottom + spacing[24] },
        ]}>
        <View {...DECORATIVE} style={styles.mascotBox}>
          <Image source={MASCOT} style={styles.mascot} resizeMode="contain" />
        </View>
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={BUILDING_ACCESSIBILITY_LABEL}
          style={styles.captions}>
          {sequence.map((caption, i) =>
            i <= index ? (
              <CaptionRow
                key={caption}
                caption={caption}
                done={i < index || index === doneAt}
                emphatic={i === doneAt}
                animate={animate}
              />
            ) : null,
          )}
        </View>
      </View>
    </Surface>
  );
}

/** One caption row: a fixed check slot, then the words. */
function CaptionRow({
  caption,
  done,
  emphatic,
  animate,
}: {
  caption: string;
  done: boolean;
  /** The completion line reads a step up from the working captions. */
  emphatic: boolean;
  animate: boolean;
}) {
  const [fade] = useState(() => new Animated.Value(animate ? 0 : 1));
  useEffect(() => {
    if (!animate) return;
    const run = Animated.timing(fade, {
      toValue: 1,
      duration: ROW_FADE_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [animate, fade]);
  return (
    <Animated.View style={[styles.row, { opacity: fade }]}>
      <View style={styles.checkSlot}>
        {done ? <Icon name="check" size={20} color="icon/primary" /> : null}
      </View>
      <Text variant={emphatic ? 'heading-3' : 'body'} style={styles.rowText}>
        {caption}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  content: {
    flex: 1,
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: layout.pageMargin,
    gap: spacing[32],
  },
  mascotBox: {
    alignSelf: 'center',
  },
  mascot: {
    width: MASCOT_SIZE,
    height: MASCOT_SIZE,
  },
  // Rows are appended beneath, so nothing above them ever moves.
  captions: {
    gap: spacing[16],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[12],
  },
  checkSlot: {
    width: 20,
    marginTop: 2,
  },
  rowText: {
    flex: 1,
  },
});
