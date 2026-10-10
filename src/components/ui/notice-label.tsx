/**
 * The notice-type label (P2B2, extracted from the Recall Card's P2B1 label;
 * restyled by the label kit, 2026-10-09): `PUBLIC HEALTH ALERT`, beside the
 * risk label on the Feed, Saved and Ready cards and on Recall Detail. The
 * Risk Label's shape with a 16pt info glyph 6pt before the words, on the
 * informational blue of `noticeTypePalette` with its visible 1pt blue
 * border — it is a notice type, not a severity and not a relevance, so it
 * borrows neither palette and cannot be mistaken for a tier.
 *
 * The visible word is the presentation contract's (`noticeLabel`); this
 * component only cases it for the compact-label style, and a screen reader
 * hears the contract's own words rather than the uppercase rendering. The
 * glyph is decorative and never replaces the words.
 */

import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { noticeTypePalette } from '@/constants/design-tokens';
import { labelGeometry, labelType, NOTICE_GLYPH } from '@/constants/label-design';

export function NoticeLabel({ label }: { label: string }) {
  const palette = noticeTypePalette['public-health-alert'];
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[styles.notice, { backgroundColor: palette.background, borderColor: palette.border }]}>
      <Icon name={NOTICE_GLYPH} points={labelGeometry.iconSide} tint={palette.foreground} />
      <Text style={[labelType.badge, styles.text, { color: palette.foreground }]}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: labelGeometry.iconGap,
    minHeight: labelGeometry.minHeight,
    paddingHorizontal: labelGeometry.paddingX,
    paddingVertical: labelGeometry.paddingY,
    borderRadius: labelGeometry.radius,
    borderWidth: labelGeometry.noticeBorderWidth,
  },
  text: {
    flexShrink: 1,
  },
});
