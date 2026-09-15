/**
 * A Profile value row (P2B5): a label and its value, not interactive — the
 * App version line. One spoken element ("App version, 1.2.0 (34)"), the
 * same height and padding as a navigation row so the two sit in one grouped
 * surface without a step, and the value wraps beneath the label when the
 * reader's type size asks it to.
 */

import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { hitTarget, spacing } from '@/constants/design-tokens';

export function ValueRow({ label, value }: { label: string; value: string }) {
  return (
    <View accessible accessibilityLabel={`${label}, ${value}`} style={styles.row}>
      <Text variant="body">{label}</Text>
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
  value: {
    flexShrink: 1,
  },
});
