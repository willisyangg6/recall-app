/**
 * The Relevance Label (P2B1): `AFFECTS YOU`, and nothing else.
 *
 * Personal relevance is not a risk level. This label answers whether a recall
 * matters to the shopper's saved state, stores, or allergens; it says nothing
 * about severity, and its lime never means "safe" or "low". It therefore
 * reads `relevancePalette` only — there is no prop by which a risk tier could
 * reach it, and the Risk Label cannot render it — so the two systems stay
 * apart in code exactly as they do in the design contract.
 *
 * Whether to show it is not decided here. The caller renders it only when
 * the existing personalization verdict (lib/relevance.ts, through the card
 * model's `affectsYou`) says the recall affects the user.
 *
 * The same 24pt compact-label geometry as the Risk Label: IBM Plex Mono
 * `label` type, 4pt radius, 8/4 padding, a 1px border in the palette's own
 * border colour, no shadow — plus the 12pt flag glyph the design gives it.
 * The word is the primary channel and the flag the second; a screen reader
 * hears the spoken label, never "AFFECTS YOU" shouted letter by letter.
 */

import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { layout, radius, relevancePalette, spacing } from '@/constants/design-tokens';

/** The one visible label the design defines. */
export const RELEVANCE_LABEL_TEXT = 'AFFECTS YOU';

/** What a screen reader says for it. */
export const RELEVANCE_ACCESSIBILITY_LABEL = 'Affects you';

export function RelevanceLabel() {
  const palette = relevancePalette['affects-you'];

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={RELEVANCE_ACCESSIBILITY_LABEL}
      style={[styles.label, { backgroundColor: palette.background, borderColor: palette.border }]}>
      <Icon name="flag" size={12} tint={palette.foreground} />
      <Text variant="label" style={{ color: palette.foreground }}>
        {RELEVANCE_LABEL_TEXT}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[4],
    // Risk and relevance labels share the contract's one compact-label height.
    minHeight: layout.riskLabelHeight,
    paddingHorizontal: spacing[8],
    paddingVertical: spacing[4],
    borderRadius: radius[4],
    borderWidth: 1,
  },
});
