import { StyleSheet, Text, View } from 'react-native';

import { Radii, Spacing, type RiskColorToken } from '@/constants/theme';
import type { ConsumerRiskTier } from '@/domain/risk-tier';
import { useRiskColors } from '@/hooks/use-theme';

/**
 * The consumer risk tier, as a chip.
 *
 * The visible text label is not optional and not decorative: it is how the
 * risk is communicated. Color is a second, redundant channel, so the chip
 * remains fully readable in grayscale, under any color-vision deficiency, and
 * to a screen reader (which announces the spoken label instead of "HIGH").
 * Font scaling is left to the platform — no maxFontSizeMultiplier caps here.
 */
export function RiskBadge({
  tier,
  label,
  accessibilityLabel,
  size = 'small',
}: {
  tier: ConsumerRiskTier;
  label: string;
  accessibilityLabel: string;
  size?: 'small' | 'large';
}) {
  const palette = useRiskColors();
  // Pending and Unrated share the one neutral token: neither is a severity.
  const token: RiskColorToken = tier === 'unrated' ? 'pending' : tier;
  const colors = palette[token];

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.badge,
        size === 'large' && styles.badgeLarge,
        { backgroundColor: colors.background },
      ]}>
      <Text style={[styles.label, size === 'large' && styles.labelLarge, { color: colors.text }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Radii.small,
  },
  badgeLarge: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  label: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  labelLarge: {
    fontSize: 16,
    lineHeight: 22,
  },
});
