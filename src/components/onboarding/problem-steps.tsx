/**
 * The two problem-framing screens (2026-09-28; the approved statistic
 * compositions), between Welcome and the selectors: why recalls matter
 * before Lotly asks anything. Both use the shared frame, the segmented
 * progress bar (steps 1 and 2 of 5), Back and a pinned Continue, and both
 * cite the CDC quietly — the sources are recorded in lib/onboarding-copy.ts
 * and no URL is bundled. Neither screen has a mascot; the compositions ARE
 * the visual, and every size below comes from lib/problem-presentation.ts.
 *
 * ## Screen 2: the scale
 *
 * `1 in 6` in the `stat` type, the factual headline, the 48-million line,
 * then the authored one-in-six pictograph (2026-09-29): ONE production
 * image (`SCALE_PICTOGRAPH`) whose artwork carries the six full-body
 * figures — one lime with its three emphasis rays, five pale blue — drawn
 * whole with `contain`, never cropped, tinted or assembled from glyphs.
 * The stat and sentence are one spoken thought (`PROBLEM_SCALE_SPOKEN` on
 * the headline; the drawn stat is decorative), and the pictograph is ONE
 * spoken infographic (`PROBLEM_SCALE_FIGURES_LABEL`), never six elements.
 *
 * ## Screen 3: the stakes
 *
 * The CDC's fact said ONCE: the headline, the claim as the body, and the
 * four higher-risk groups as four vertical editorial rows (2026-09-29, the
 * approved risk-row target): the approved household illustration on the
 * left (lib/statistics-assets.ts), the group name as live `heading-3` text
 * on the right, vertically centred, and a `border/subtle` hairline between
 * rows. Each row is ONE spoken element carrying exactly its name; the
 * illustration is decorative and the hairline is a border, never an
 * element. Rows are transparent — the illustrations' own pale-blue ovals
 * are the only backgrounds. Sizes come from `riskRowLayout`; no text is
 * capped, and larger text scrolls.
 */

import { Image, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OnboardingFrame } from '@/components/onboarding/onboarding-frame';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { color, layout, spacing } from '@/constants/design-tokens';
import {
  BACK_HINT,
  BACK_LABEL,
  CONTINUE_CTA,
  PROBLEM_RISK_BODY,
  PROBLEM_RISK_HEADLINE,
  PROBLEM_SCALE_BODY,
  PROBLEM_SCALE_FIGURES_LABEL,
  PROBLEM_SCALE_HEADLINE,
  PROBLEM_SCALE_SPOKEN,
  PROBLEM_SCALE_STAT,
  PROBLEM_SOURCE_NOTE,
} from '@/lib/onboarding-copy';
import { stepProgress } from '@/lib/onboarding-state';
import {
  PROBLEM_RISK_GROUP_ROWS,
  RISK_LABEL_VARIANT,
  RISK_LIST_TOP,
  RISK_ROW_ART_GAP,
  RISK_SEPARATOR,
  riskRowHasSeparator,
  riskRowLayout,
  scalePictographSize,
} from '@/lib/problem-presentation';
import { SCALE_PICTOGRAPH, STATISTIC_ILLUSTRATIONS } from '@/lib/statistics-assets';

/** The decorative-subtree props: never heard, never touched. */
const DECORATIVE = {
  accessible: false,
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
  pointerEvents: 'none',
} as const;

interface ProblemStepProps {
  onContinue: () => void;
  onBack: () => void;
}

export function ProblemScaleStep({ onContinue, onBack }: ProblemStepProps) {
  const { width, height, fontScale } = useWindowDimensions();
  const contentWidth = Math.min(width, layout.maxContentWidth) - 2 * layout.pageMargin;
  const pictograph = scalePictographSize(contentWidth, height, fontScale);
  return (
    <OnboardingFrame
      // The stat is drawn above the headline and spoken through it, so the
      // figure and its sentence are one thought.
      lead={
        <View {...DECORATIVE}>
          <Text variant="stat">{PROBLEM_SCALE_STAT}</Text>
        </View>
      }
      headline={PROBLEM_SCALE_HEADLINE}
      headlineAccessibilityLabel={PROBLEM_SCALE_SPOKEN}
      body={PROBLEM_SCALE_BODY}
      progress={stepProgress('problem-scale')}
      back={{ label: BACK_LABEL, hint: BACK_HINT, onPress: onBack }}
      footer={<Button label={CONTINUE_CTA} onPress={onContinue} />}>
      {/* One infographic, one spoken element — never six figures or rays. */}
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={PROBLEM_SCALE_FIGURES_LABEL}
        style={styles.figuresBlock}>
        <Image
          {...DECORATIVE}
          source={SCALE_PICTOGRAPH}
          resizeMode="contain"
          style={[styles.pictograph, { width: pictograph, height: pictograph }]}
        />
      </View>
      <SourceNote />
    </OnboardingFrame>
  );
}

export function ProblemRiskStep({ onContinue, onBack }: ProblemStepProps) {
  const { width, height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const rows = riskRowLayout({
    contentWidth: Math.min(width, layout.maxContentWidth) - 2 * layout.pageMargin,
    windowHeight: height,
    insetTop: insets.top,
    insetBottom: insets.bottom,
    fontScale,
  });
  return (
    <OnboardingFrame
      headline={PROBLEM_RISK_HEADLINE}
      body={PROBLEM_RISK_BODY}
      progress={stepProgress('problem-risk')}
      back={{ label: BACK_LABEL, hint: BACK_HINT, onPress: onBack }}
      footer={<Button label={CONTINUE_CTA} onPress={onContinue} />}>
      {/* The four groups — real content, each ONE spoken element. */}
      <View style={styles.riskList}>
        {PROBLEM_RISK_GROUP_ROWS.map(({ id, label }, index) => (
          <View
            key={id}
            accessible
            accessibilityLabel={label}
            style={[
              rows.arrangement === 'beside' ? styles.riskRow : styles.riskRowAbove,
              { paddingVertical: rows.padding },
              riskRowHasSeparator(index) ? styles.riskSeparator : null,
            ]}>
            <Image
              {...DECORATIVE}
              source={STATISTIC_ILLUSTRATIONS[id]}
              resizeMode="contain"
              style={{
                width: rows.art,
                height: rows.art,
                marginTop: -rows.trimTop,
                marginBottom: -rows.trimBottom,
              }}
            />
            <Text
              variant={RISK_LABEL_VARIANT}
              style={rows.arrangement === 'beside' ? styles.riskLabel : null}>
              {label}
            </Text>
          </View>
        ))}
      </View>
      <SourceNote />
    </OnboardingFrame>
  );
}

/**
 * The quiet citation, readable small text rather than a footnote, anchored
 * to the foot of the content (the frame's content grows to fill the
 * screen). The visualization above it and this note split the leftover
 * space through their `auto` margins, so the composition centres between
 * the body and the source instead of stranding a block above a void.
 */
function SourceNote() {
  return (
    <Text variant="body-small" color="text/secondary" style={styles.source}>
      {PROBLEM_SOURCE_NOTE}
    </Text>
  );
}

const styles = StyleSheet.create({
  source: {
    marginTop: 'auto',
  },
  // The pictograph: an accessible block whose drawn canvas centres itself.
  figuresBlock: {
    marginTop: 'auto',
  },
  pictograph: {
    alignSelf: 'center',
  },
  // The editorial list: it starts just below the body; the leftover space
  // falls between the last row and Source.
  riskList: {
    marginTop: RISK_LIST_TOP,
  },
  // Illustration left, label right, vertically centred; no background.
  riskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: RISK_ROW_ART_GAP,
  },
  // Only where the longest word cannot sit beside the illustration.
  riskRowAbove: {
    alignItems: 'flex-start',
    gap: spacing[8],
  },
  riskSeparator: {
    borderBottomWidth: RISK_SEPARATOR,
    borderBottomColor: color['border/subtle'],
  },
  riskLabel: {
    flex: 1,
  },
});
