import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { relevancePalette } from '@/constants/design-tokens';
import { categoryStyle, feedColor, feedType } from '@/constants/feed-design';
import {
  recallCardFooterStacks,
  recallCardGeometry as geometry,
} from '@/constants/recall-card-design';
import { cardReasonText } from '@/lib/recall-card-reason';
import type { HomeCardModel } from '@/lib/recall-presentation';

/** Informational flag, never a toggle or a second save action. */
export function CardAffectsYouFlag() {
  const palette = relevancePalette['affects-you'];
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel="Affects you"
      pointerEvents="none"
      style={[styles.flag, { backgroundColor: palette.background }]}>
      <Icon name="flag" points={geometry.relevanceIconSide} tint={palette.foreground} />
    </View>
  );
}

/** Same category decision and glyph; no coloured pill competing with risk. */
export function CardCategory({ model }: { model: HomeCardModel }) {
  const category = categoryStyle(model.categoryId ?? null);
  if (!model.categoryLabel || !category) return null;
  return (
    <View style={styles.category}>
      <Icon name={category.icon} points={16} color="icon/primary" />
      <Text style={[feedType.meta, styles.categoryText]}>{model.categoryLabel}</Text>
    </View>
  );
}

/** Whole reason and location; no ellipsis or changed medical wording.
 * The location sizes to its text (at most 132pt) beside the reason, and moves
 * below the reason from 1.15x text or whenever the card stacks. */
export function CardReasonLocation({
  model,
  stacked: cardStacked,
}: {
  model: HomeCardModel;
  stacked: boolean;
}) {
  const { fontScale } = useWindowDimensions();
  const stacked = recallCardFooterStacks(cardStacked, fontScale);
  const hasReason = Boolean(model.reasonLine);
  return (
    <View style={[styles.footer, stacked && styles.footerStacked]}>
      {hasReason ? (
        <View style={[styles.reason, stacked && styles.reasonStacked]}>
          <Icon name="warning" points={geometry.reasonIconSide} tint="#A76400" />
          <Text style={[feedType.body, styles.reasonType, styles.reasonText]}>
            {cardReasonText(model.reasonLine)}
          </Text>
        </View>
      ) : null}
      <View
        style={[
          styles.location,
          hasReason && !stacked && styles.locationBeside,
          (stacked || !hasReason) && styles.locationFull,
        ]}>
        <Icon name="map-pin" points={18} color="icon/primary" />
        <Text
          style={[
            feedType.meta,
            styles.locationText,
            hasReason && !stacked && styles.locationTextBeside,
          ]}>
          {model.locationSummary}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flag: {
    width: geometry.relevanceSide,
    height: geometry.relevanceSide,
    borderRadius: geometry.relevanceRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  category: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  categoryText: { color: feedColor.brand, flexShrink: 1 },
  footer: { flexDirection: 'row', alignItems: 'center' },
  footerStacked: { flexDirection: 'column', alignItems: 'stretch', gap: 12 },
  reason: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  reasonStacked: { flex: 0, width: '100%' },
  reasonType: { fontSize: geometry.reasonFontSize, lineHeight: geometry.reasonLineHeight },
  reasonText: { color: feedColor.text, flex: 1, minWidth: 0 },
  location: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  // Content-sized, capped at 132pt; a longer location wraps by words inside it.
  locationBeside: {
    maxWidth: geometry.locationWidth,
    flexShrink: 0,
    paddingLeft: geometry.locationPaddingLeft,
    paddingRight: geometry.locationPaddingRight,
    marginLeft: 12,
    borderLeftWidth: 1,
    borderLeftColor: feedColor.divider,
    minHeight: 28,
  },
  locationFull: { width: '100%', paddingRight: geometry.locationPaddingRight },
  locationText: { color: feedColor.text, flex: 1, minWidth: 0 },
  // Beside the reason the text keeps its own width (flex: 1 would size it from
  // zero inside the content-sized slot) and wraps only at the 132pt cap.
  locationTextBeside: { flex: 0, flexShrink: 1 },
});
