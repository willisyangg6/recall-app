/**
 * The Feed and Saved recall card's appearance (2026-10-06, the approved
 * Feed + Filters design, docs/lotly-feed-filters-source-kit/). `RecallCard`
 * wraps it in the Link, the save control and the accessibility action, as
 * it wrapped the previous surface; every recall-specific word still comes
 * from the shared presentation model, unchanged.
 *
 * Composition, top to bottom:
 *
 *   1. Metadata — the risk label (or the Public Health Alert notice when the
 *      presentation contract suppresses an Unknown tier), the one activity
 *      date, and AFFECTS YOU at the trailing edge when the personalization
 *      verdict is genuinely positive. The row wraps; no label shrinks.
 *   2. Content — the photo (112pt box, 6pt corners, contained, through the
 *      existing guarded MediaTile, which renders nothing for an absent or
 *      failed image) beside the text column: product name (20/26 bold, the
 *      card's existing three-line bound; whole when stacked), company,
 *      category, reason. With no
 *      photo the text takes the full width. At the accessibility text sizes,
 *      or whenever the column beside the photo would be narrower than 180pt,
 *      the photo stacks above the text.
 *   3. A full-width 1pt divider.
 *   4. Footer — the location (18pt pin, 14/20) and the save control (a 24pt
 *      bookmark in a 44pt target).
 *
 * The onboarding's Welcome example and Ready deck draw `RecallCardSurface`
 * (components/recall-card.tsx), which this milestone deliberately leaves
 * byte-identical: those screens are finalized and out of scope. The two
 * surfaces read the same model, so they cannot disagree about any fact —
 * only about drawing.
 */

import { useState, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import {
  FeedCategoryLabel,
  FeedNoticeLabel,
  FeedRelevanceLabel,
  FeedRiskLabel,
} from '@/components/feed/feed-labels';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import {
  cardStacks,
  categoryStyle,
  feedColor,
  feedGeometry,
  feedType,
} from '@/constants/feed-design';
import type { HomeCardModel } from '@/lib/recall-presentation';

export function FeedCardSurface({
  model,
  media,
  trailing,
}: {
  model: HomeCardModel;
  /** The guarded photo tile, or nothing. */
  media: ReactNode;
  /** The save control at the footer's trailing edge. */
  trailing: ReactNode;
}) {
  const { fontScale } = useWindowDimensions();
  const [rowWidth, setRowWidth] = useState(0);
  const stacked = cardStacks(rowWidth, fontScale);
  const category = categoryStyle(model.categoryId ?? null);

  return (
    <View style={styles.card}>
      <View style={styles.metadata}>
        <View style={styles.metadataGroup}>
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
        {model.affectsYou ? <FeedRelevanceLabel /> : null}
      </View>

      <View
        style={[styles.content, stacked && styles.contentStacked]}
        onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}>
        {media}
        <View style={[styles.text, stacked && styles.textStacked]}>
          {/* The existing bound: at most three lines, the full name still the
              node's content, so VoiceOver reads it whole. Stacked (the
              accessibility sizes) the card shows the WHOLE name, as the
              existing card already does when its media sits above the text —
              three lines of AX5 type would cut the name mid-word. */}
          <Text
            style={[feedType.productTitle, styles.primary]}
            numberOfLines={stacked ? undefined : 3}>
            {model.productName}
          </Text>
          <Text style={[feedType.body, styles.secondary, styles.company]}>{model.brand.text}</Text>
          {/* A launch-visible category with a style; the Feed shows no other. */}
          {model.categoryLabel && category ? (
            <View style={styles.category}>
              <FeedCategoryLabel label={model.categoryLabel} style={category} />
            </View>
          ) : null}
          {model.reasonLine ? (
            <Text style={[feedType.body, styles.secondary, styles.reason]}>{model.reasonLine}</Text>
          ) : null}
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.footer}>
        <View style={styles.location}>
          <Icon name="map-pin" points={feedGeometry.locationIconSide} color="icon/primary" />
          <Text style={[feedType.meta, styles.primary, styles.locationText]}>
            {model.locationSummary}
          </Text>
        </View>
        {trailing}
      </View>
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
  primary: {
    color: feedColor.text,
  },
  secondary: {
    color: feedColor.secondary,
  },
  metadata: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  metadataGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    flexShrink: 1,
    gap: 8,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: feedGeometry.cardColumnGap,
    marginTop: 12,
  },
  contentStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  // In a column, flex: 1 would size the text from a zero basis; let it take
  // its content height at the full width instead.
  textStacked: {
    flex: 0,
    width: '100%',
  },
  company: {
    marginTop: 4,
  },
  category: {
    marginTop: 8,
    flexDirection: 'row',
  },
  reason: {
    marginTop: 8,
  },
  divider: {
    height: 1,
    backgroundColor: feedColor.divider,
    marginVertical: feedGeometry.dividerMarginY,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  location: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  locationText: {
    flexShrink: 1,
  },
});
