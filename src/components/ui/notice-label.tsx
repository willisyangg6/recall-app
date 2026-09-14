/**
 * The notice-type label (P2B2, extracted from the Recall Card's P2B1 label):
 * `PUBLIC HEALTH ALERT`, beside the risk label on the card and on Recall
 * Detail. The same compact-label geometry as the Risk Label, on the neutral
 * informational surface with a `border/default` border — it is a notice
 * type, not a severity and not a relevance, so it borrows neither palette
 * and cannot be mistaken for a tier.
 *
 * The visible word is the presentation contract's (`noticeLabel`); this
 * component only cases it for the compact-label style, and a screen reader
 * hears the contract's own words rather than the uppercase rendering.
 */

import { StyleSheet } from 'react-native';

import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { layout, spacing } from '@/constants/design-tokens';

export function NoticeLabel({ label }: { label: string }) {
  return (
    <Surface
      background="background/subtle"
      radius={4}
      border="border/default"
      style={styles.notice}
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}>
      <Text variant="label">{label.toUpperCase()}</Text>
    </Surface>
  );
}

const styles = StyleSheet.create({
  notice: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    minHeight: layout.riskLabelHeight,
    paddingHorizontal: spacing[8],
    paddingVertical: spacing[4],
  },
});
