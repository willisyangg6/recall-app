/**
 * The Feed card's labels (2026-10-06, the approved Feed + Filters design):
 * risk, the Public Health Alert notice, Affects You and the product
 * category, all on ONE shape — radius 5, at least 28pt tall, 8/6 padding,
 * 12/16 bold (the category's 14/20) — so no label reads as a capsule
 * button. They are informational text, never controls.
 *
 * The words and spoken labels are the presentation contract's own, passed
 * in unchanged; only the drawing is new. Colours come from
 * constants/feed-design.ts: the documented risk palette with the card's own
 * white-on-red Critical, the existing lime relevance palette, and the
 * category map. Detail, the illness notices and every other surface keep
 * `RiskLabel` and the global palette.
 *
 * A label is never squeezed to fit beside its neighbours: in the wrapping
 * metadata row it moves to the next line whole first. Only a label wider
 * than the whole line (the largest text sizes) shrinks, and then its words
 * wrap inside it rather than overflowing the card.
 */

import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { categoryAccessibilityLabel } from '@/components/ui/category-tag';
import {
  RELEVANCE_ACCESSIBILITY_LABEL,
  RELEVANCE_LABEL_TEXT,
} from '@/components/ui/relevance-label';
import { Text } from '@/components/ui/text';
import { color, relevancePalette, type LabelPalette } from '@/constants/design-tokens';
import {
  feedGeometry,
  feedRiskPalette,
  feedType,
  type CategoryStyle,
} from '@/constants/feed-design';
import type { ConsumerRiskTier } from '@/domain/risk-tier';

function LabelShape({
  palette,
  accessibilityLabel,
  children,
}: {
  palette: LabelPalette;
  accessibilityLabel: string;
  children: React.ReactNode;
}) {
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
      style={[styles.badge, { backgroundColor: palette.background, borderColor: palette.border }]}>
      {children}
    </View>
  );
}

export function FeedRiskLabel({
  tier,
  label,
  accessibilityLabel,
}: {
  tier: ConsumerRiskTier;
  /** The visible word(s), already cased by the presentation contract. */
  label: string;
  /** The spoken label ("Risk level: Critical"). */
  accessibilityLabel: string;
}) {
  const palette = feedRiskPalette[tier];
  return (
    <LabelShape palette={palette} accessibilityLabel={accessibilityLabel}>
      <Text style={[feedType.badge, styles.text, { color: palette.foreground }]}>{label}</Text>
    </LabelShape>
  );
}

/**
 * "PUBLIC HEALTH ALERT": the notice type, in the neutral blue it always had.
 * Cased for the badge exactly as NoticeLabel cases it; VoiceOver hears the
 * contract's own words.
 */
export function FeedNoticeLabel({ label }: { label: string }) {
  const palette: LabelPalette = {
    background: color['background/subtle'],
    foreground: color['text/primary'],
    border: color['border/default'],
  };
  return (
    <LabelShape palette={palette} accessibilityLabel={label}>
      <Text style={[feedType.badge, styles.text, { color: palette.foreground }]}>
        {label.toUpperCase()}
      </Text>
    </LabelShape>
  );
}

/** "AFFECTS YOU": the existing lime label, on the shared badge shape. */
export function FeedRelevanceLabel() {
  const palette = relevancePalette['affects-you'];
  return (
    <LabelShape palette={palette} accessibilityLabel={RELEVANCE_ACCESSIBILITY_LABEL}>
      <Icon name="flag" points={feedGeometry.badgeIconSide} tint={palette.foreground} />
      <Text style={[feedType.badge, styles.text, { color: palette.foreground }]}>
        {RELEVANCE_LABEL_TEXT}
      </Text>
    </LabelShape>
  );
}

/** The product category: its own tint, border, ink and glyph. */
export function FeedCategoryLabel({ label, style }: { label: string; style: CategoryStyle }) {
  return (
    <LabelShape palette={style} accessibilityLabel={categoryAccessibilityLabel(label)}>
      <Icon name={style.icon} points={feedGeometry.badgeIconSide} tint={style.foreground} />
      <Text style={[feedType.meta, styles.text, { color: style.foreground }]}>{label}</Text>
    </LabelShape>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    minHeight: feedGeometry.badgeMinHeight,
    paddingHorizontal: feedGeometry.badgePaddingX,
    paddingVertical: feedGeometry.badgePaddingY,
    borderRadius: feedGeometry.badgeRadius,
    borderWidth: 1,
  },
  // Wraps inside the badge rather than overflowing the card at AX sizes.
  text: {
    flexShrink: 1,
  },
});
