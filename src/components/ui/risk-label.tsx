/**
 * The Risk Label (P2B0; restyled by the label kit, 2026-10-09) — the one
 * rendering of a consumer risk tier, on the Feed and Saved cards, the Ready
 * cards, Recall Detail, the Risk Levels document and the development gallery
 * alike.
 *
 * The kit's compact label: radius 5, at least 28pt tall, 8/6 padding, 12/16
 * bold Public Sans, uppercase text, a flat fill (its 1pt border is the fill
 * colour) and no shadow or glyph. The treatment is looked up from
 * `riskPalette` by the tier the domain derived — this file holds no colour of
 * its own, and the tier itself comes from `domain/risk-tier.ts`, which
 * nothing here touches. The shape is constants/label-design.ts's.
 *
 * Critical on Detail is exactly Critical on the feed: the same seven tokens,
 * one component. There is no separate "critical" treatment anywhere.
 *
 * The visible text label is not optional and not decorative: it is how the
 * risk is communicated. Colour is a second, redundant channel, so the label
 * remains fully readable in greyscale, under any colour-vision deficiency, and
 * to a screen reader (which announces the spoken label instead of "HIGH").
 * Font scaling is left to the platform — no cap here. Only a label wider
 * than its whole row (the accessibility text sizes) shrinks, and then its words
 * wrap inside it rather than overflowing.
 *
 * `Affects You` is not a tier and cannot be rendered here: the prop is typed
 * to `ConsumerRiskTier`, and relevance has its own palette.
 */

import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { riskPalette } from '@/constants/design-tokens';
import { labelGeometry, labelType } from '@/constants/label-design';
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
      <Text style={[labelType.badge, styles.text, { color: palette.foreground }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    flexShrink: 1,
    minHeight: labelGeometry.minHeight,
    paddingHorizontal: labelGeometry.paddingX,
    paddingVertical: labelGeometry.paddingY,
    borderRadius: labelGeometry.radius,
    borderWidth: labelGeometry.riskBorderWidth,
  },
  text: {
    flexShrink: 1,
  },
});
