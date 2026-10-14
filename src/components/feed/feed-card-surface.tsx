/** Approved replacement for the live Feed/Saved surface only.
 * Onboarding's RecallCardSurface API and layout remain intact. */
import { useState, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { FeedNoticeLabel, FeedRiskLabel } from '@/components/feed/feed-labels';
import {
  CardAffectsYouFlag,
  CardCategory,
  CardReasonLocation,
} from '@/components/feed/recall-card-parts';
import { Text } from '@/components/ui/text';
import { feedColor, feedGeometry, feedType } from '@/constants/feed-design';
import { recallCardGeometry, recallCardStacks } from '@/constants/recall-card-design';
import type { HomeCardModel } from '@/lib/recall-presentation';

export function FeedCardSurface({
  model,
  media,
  trailing,
}: {
  model: HomeCardModel;
  media: ReactNode;
  /** Existing save control; now in the metadata row. */
  trailing: ReactNode;
}) {
  const { fontScale } = useWindowDimensions();
  const [contentWidth, setContentWidth] = useState(0);
  const stacked = recallCardStacks(contentWidth, fontScale);
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.metadata}>
          {model.risk.badgeLabel ? (
            <FeedRiskLabel
              tier={model.risk.tier}
              label={model.risk.badgeLabel}
              accessibilityLabel={model.risk.accessibilityLabel}
            />
          ) : null}
          {model.noticeLabel ? <FeedNoticeLabel label={model.noticeLabel} /> : null}
          <Text style={[feedType.meta, styles.secondary]}>{model.activity.text}</Text>
        </View>
        {model.affectsYou || trailing ? (
          <View style={styles.actions}>
            {model.affectsYou ? <CardAffectsYouFlag /> : null}
            {trailing ? <View style={styles.saveTarget}>{trailing}</View> : null}
          </View>
        ) : null}
      </View>
      <View
        style={[styles.content, stacked && styles.contentStacked]}
        onLayout={(event) => setContentWidth(event.nativeEvent.layout.width)}>
        {media}
        <View style={[styles.identity, stacked && styles.identityStacked]}>
          <Text
            style={[feedType.productTitle, styles.primary]}
            numberOfLines={stacked ? undefined : 3}
            ellipsizeMode="tail">
            {model.productName}
          </Text>
          <Text style={[feedType.body, styles.secondary, styles.company]}>{model.brand.text}</Text>
          <CardCategory model={model} />
        </View>
      </View>
      <View style={styles.divider} />
      <CardReasonLocation model={model} stacked={stacked} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: feedColor.surface,
    borderWidth: 1,
    borderColor: feedColor.border,
    borderRadius: feedGeometry.cardRadius,
    padding: feedGeometry.cardPadding,
  },
  primary: { color: feedColor.text },
  secondary: { color: feedColor.secondary },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metadata: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  saveTarget: {
    minWidth: recallCardGeometry.saveTargetSide,
    minHeight: recallCardGeometry.saveTargetSide,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: recallCardGeometry.columnGap,
    marginTop: 12,
  },
  contentStacked: { flexDirection: 'column', alignItems: 'stretch' },
  identity: { flex: 1, minWidth: 0 },
  identityStacked: { flex: 0, width: '100%' },
  company: { marginTop: 4 },
  divider: {
    height: 1,
    backgroundColor: feedColor.divider,
    marginVertical: 12,
  },
});
