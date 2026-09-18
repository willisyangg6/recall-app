/**
 * The Category Tag (P2B7D) — the one rendering of a recall's product category
 * on a recall card, in the Feed and in Saved alike.
 *
 * ## What it is, and what it deliberately is not
 *
 * Quiet product metadata: "what kind of thing was recalled". It is not a
 * severity, not a personal-relevance verdict, not a notice type, and not a
 * control — so it borrows nothing from the three treatments that are:
 *
 *   · `riskPalette` / `relevancePalette` — never read here. The tag has no
 *     fill of its own at all, so it cannot be mistaken for a status colour,
 *     and it stays legible in greyscale because colour carries nothing.
 *   · IBM Plex Mono and uppercase — the compact-label signature the Risk and
 *     Notice labels share. This is Public Sans `caption` in the vocabulary's
 *     own sentence-case label, so it does not read as a badge.
 *   · `radius/full` — the Navigation Chip's shape. `radius/4` instead: the
 *     tag is a static mark, never a filter a shopper could try to tap.
 *   · An icon, an accessibility action, a press handler, a button role.
 *
 * ## The word is the frozen vocabulary's
 *
 * The caller passes the label the presentation contract read out of
 * `foodCategoryLabel` (via `cardCategoryLabel`), so the tag on a card and the
 * chip in the Category filter spell the identical string by construction.
 * Nothing here cases, shortens, pluralizes or otherwise rewrites it — and
 * nothing here maps an id to a word, so no display path can invent a label
 * for an id the filter hides.
 *
 * ## Absence
 *
 * There is no empty state. A recall with no displayable category renders no
 * tag at all — the caller omits the element, so there is no container, no
 * reserved height, no spacer, and nothing for a screen reader to land on.
 */

import { StyleSheet } from 'react-native';

import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { spacing } from '@/constants/design-tokens';

/**
 * What a screen reader says for the tag. The bare label is ambiguous aloud
 * mid-card ("Pantry & staples" between a brand and a reason could be either),
 * so it is named once — matching the Risk Label's "Risk level: High" shape.
 * Once per card is not repetition; the card's other elements name themselves.
 */
export function categoryAccessibilityLabel(label: string): string {
  return `Category: ${label}`;
}

export function CategoryTag({ label }: { label: string }) {
  return (
    <Surface
      radius={4}
      border="border/subtle"
      style={styles.tag}
      accessible
      accessibilityRole="text"
      accessibilityLabel={categoryAccessibilityLabel(label)}>
      <Text variant="caption" color="text/secondary">
        {label}
      </Text>
    </Surface>
  );
}

const styles = StyleSheet.create({
  tag: {
    // Shrink-wrapped to the word: a full-width bar would read as a section.
    alignSelf: 'flex-start',
    // The compact-label padding, so the tag sits on the same rhythm as the
    // card's other marks. No minHeight: the box is the caption's own line
    // box, so it grows with Dynamic Type instead of clipping inside a fixed
    // one, and stays a touch shorter than the 24pt status labels above it.
    paddingHorizontal: spacing[8],
    paddingVertical: spacing[4],
  },
});
