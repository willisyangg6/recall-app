/**
 * The Risk Label (P2B0) — the one rendering of a consumer risk tier, on the
 * feed card, on Recall Detail, and in the development gallery alike.
 *
 * A 24pt compact label: IBM Plex Mono label type, uppercase text, 4pt radius,
 * a 1px border in the tier's own colour, and no shadow. The treatment is
 * looked up from `riskPalette` by the tier the domain derived — this file
 * holds no colour of its own, and the tier itself comes from
 * `domain/risk-tier.ts`, which nothing here touches.
 *
 * Critical on Detail is exactly Critical on the feed: the same seven tokens,
 * one component. There is no separate "critical" treatment anywhere.
 *
 * The visible text label is not optional and not decorative: it is how the
 * risk is communicated. Colour is a second, redundant channel, so the label
 * remains fully readable in greyscale, under any colour-vision deficiency, and
 * to a screen reader (which announces the spoken label instead of "HIGH").
 * Font scaling is left to the platform — no cap here.
 *
 * `Affects You` is not a tier and cannot be rendered here: the prop is typed
 * to `ConsumerRiskTier`, and relevance has its own palette.
 */

import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { layout, radius, riskPalette, spacing } from '@/constants/design-tokens';
import type { ConsumerRiskTier } from '@/domain/risk-tier';

export function RiskLabel({
  tier,
  label,
  accessibilityLabel,
}: {
  tier: ConsumerRiskTier;
  /** The visible word(s), already cased by the presentation contract. */
  label: string;
  /** The spoken label ("Risk level: High") — never the bare badge text. */
  accessibilityLabel: string;
}) {
  const palette = riskPalette[tier];

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
      style={[styles.label, { backgroundColor: palette.background, borderColor: palette.border }]}>
      <Text variant="label" style={{ color: palette.foreground }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    minHeight: layout.riskLabelHeight,
    paddingHorizontal: spacing[8],
    paddingVertical: spacing[4],
    borderRadius: radius[4],
    borderWidth: 1,
  },
});
