/**
 * Recall Details, under Where It Was Sold: the stores that listed this agency
 * recall on their own recall pages (lib/store-listings.ts). One row per
 * store, as that store stated it, each linking that store's page. It sits
 * beneath the agency's own lines and never replaces or merges into them.
 */

import type { ComponentType } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { hitSlopToMinimum, spacing } from '@/constants/design-tokens';
import { detailColor, detailGeometry, detailType } from '@/constants/detail-design';
import { EXTERNAL_LINK_HINT, STORE_LISTINGS_HEADING } from '@/lib/detail-copy';
import type { StoreListingRow } from '@/lib/store-listings';

export function StoreListingsBlock({
  rows,
  LinkLabel,
}: {
  rows: readonly StoreListingRow[];
  LinkLabel: ComponentType<{ label: string }>;
}) {
  if (rows.length === 0) return null;
  return (
    <View style={styles.block}>
      <Text style={[detailType.metadataStrong, styles.text]}>{STORE_LISTINGS_HEADING}</Text>
      {rows.map((row) => (
        <View key={row.store} style={styles.row}>
          <View style={styles.glyph}>
            <Icon name="store" points={detailGeometry.interfaceGlyph} color="icon/primary" />
          </View>
          <View style={styles.body}>
            <Text style={[detailType.body, styles.text]}>{`${row.store}: ${row.detail}`}</Text>
            <Pressable
              accessibilityRole="link"
              accessibilityHint={EXTERNAL_LINK_HINT}
              hitSlop={LINK_HIT_SLOP}
              style={styles.link}
              onPress={() => Linking.openURL(row.url)}>
              <LinkLabel label={row.sourceLabel} />
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}

/** The same minimum target as Detail's other external links. */
const LINK_HIT_SLOP = hitSlopToMinimum(detailType.action.lineHeight ?? 22);

const styles = StyleSheet.create({
  block: {
    marginTop: spacing[16],
    gap: spacing[12],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: detailGeometry.fieldColumnGap,
  },
  glyph: {
    height: detailType.body.lineHeight,
    justifyContent: 'center',
  },
  body: {
    flex: 1,
  },
  text: {
    color: detailColor.text,
  },
  link: {
    alignSelf: 'flex-start',
  },
});
