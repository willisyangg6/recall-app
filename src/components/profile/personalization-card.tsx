/**
 * The featured Personalization card (P2B5): this device's own state,
 * allergens and stores on one white `radius/16` card at the top of Profile,
 * with the flag glyph the relevance label already uses, the card's name and
 * a visible `Edit`. The whole card is ONE link to the Personalization
 * screen — there is no nested pressable, and `Edit` is a word on the card,
 * not a second control.
 *
 * The card shows what it is handed and reads nothing itself: the screen
 * reads the store on focus and passes one of three answers (loading,
 * unavailable, or the real summary — which may be empty). The lines and
 * their spoken form come from lib/profile-hub, so the compact `+N` rule and
 * the never-abbreviated accessibility description are one tested contract.
 *
 * To a screen reader the card is one element that speaks its name and every
 * choice in full — or that it is still loading (with the busy state set), or
 * that the preferences could not be read — and then the hint. No height is
 * fixed: three short lines at the default size, and Dynamic Type grows the
 * card as it grows the text.
 */

import { Link, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { spacing } from '@/constants/design-tokens';
import {
  EDIT_LABEL,
  PERSONALIZATION_HINT,
  summaryAccessibilityLabel,
  summaryLines,
  type PreferenceSummaryState,
} from '@/lib/profile-hub';

export function PersonalizationCard({
  label,
  href,
  state,
}: {
  label: string;
  href: Href;
  state: PreferenceSummaryState;
}) {
  const lines = summaryLines(state);
  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={summaryAccessibilityLabel(label, state)}
        accessibilityHint={PERSONALIZATION_HINT}
        accessibilityState={{ busy: state.status === 'loading' }}
        style={({ pressed }) => pressed && styles.pressed}>
        <Surface radius={16} border="border/subtle" elevation="card" style={styles.card}>
          <View style={styles.heading}>
            <Icon name="flag" size={20} color="icon/primary" />
            <Text variant="body-small-bold" style={styles.title}>
              {label}
            </Text>
            <Text variant="caption" color="action/secondary">
              {EDIT_LABEL}
            </Text>
          </View>
          <View style={styles.lines}>
            {lines.map((line) => (
              <View key={line.key} style={styles.line}>
                <Text variant="body-small" color="text/secondary">
                  {line.label}
                </Text>
                {/* A real choice reads in the primary colour; an empty answer
                    and a pending one both read quietly — their words differ. */}
                <Text
                  variant="body-small"
                  color={line.kind === 'value' ? 'text/primary' : 'text/secondary'}
                  style={styles.value}>
                  {line.visible}
                </Text>
              </View>
            ))}
          </View>
        </Surface>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing[16],
    gap: spacing[12],
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[8],
  },
  title: {
    flex: 1,
  },
  lines: {
    gap: spacing[4],
  },
  // Label at the leading edge, value at the trailing edge; a long value or a
  // large type size wraps the value beneath its label instead of clipping.
  line: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: spacing[12],
  },
  value: {
    flexShrink: 1,
    textAlign: 'right',
  },
  pressed: {
    opacity: 0.6,
  },
});
