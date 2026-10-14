/**
 * A Profile value row (P2B5): a label and its value, not interactive — the
 * App version line. One spoken element ("App version, 1.2.0 (34)"), the
 * same height and padding as a navigation row so the two sit in one grouped
 * surface without a step, and the value wraps beneath the label when the
 * reader's type size asks it to. It takes the same optional leading glyph as
 * a navigation row, so the version line keeps the hub's icon column.
 */

import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { hitTarget, spacing } from '@/constants/design-tokens';
import { showsRowGlyph } from '@/lib/profile-hub';

export function ValueRow({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  /** The decorative leading glyph, from the approved icon set. */
  icon?: IconName;
}) {
  const { fontScale } = useWindowDimensions();
  return (
    <View accessible accessibilityLabel={`${label}, ${value}`} style={styles.row}>
      <View style={styles.label}>
        {icon && showsRowGlyph(fontScale) ? (
          <Icon name={icon} size={20} color="icon/primary" />
        ) : null}
        <Text variant="body">{label}</Text>
      </View>
      <Text variant="body-small" color="text/secondary" style={styles.value}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: hitTarget.minimum,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing[12],
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[12],
  },
  // The glyph and label stay together when the value wraps beneath them.
  label: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[12],
    flexShrink: 1,
  },
  value: {
    flexShrink: 1,
  },
});
