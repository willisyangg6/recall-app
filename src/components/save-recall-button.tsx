/**
 * The one save control (P2A) — used by the feed card and by Recall Details,
 * so the two can never disagree about what saving is called or how it reads
 * aloud. All copy comes from lib/saved-recalls; this file is layout and the
 * tap.
 *
 * The visible label states the CONDITION ("Save" / "Saved") because that is
 * what a glance down a feed needs; the accessibility label states the ACTION,
 * which is what a screen reader needs. Both come from the same contract.
 *
 * ## Appearance (P2B1)
 *
 * The design's bookmark glyph — the exported Figma icon, outline while the
 * recall is not saved and filled once it is — beside the visible word, in
 * brand navy. The word stays (a founder copy decision from P2A, and the
 * state's non-colour channel); Figma's card shows the glyph alone, which is
 * recorded as a conflict in DESIGN.md. The saved state therefore changes
 * three things at once: the glyph's fill, the word, and the selected state
 * a screen reader announces.
 *
 * ## Touch target
 *
 * The visible control is one 20pt glyph and a caption line, under the 44pt
 * minimum. `hitSlop` grows the pressable to the minimum without moving
 * anything on screen — and when the control sits inside a card, React
 * Native's responder negotiation gives the tap to this innermost pressable,
 * so saving never also opens the recall.
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { hitSlopToMinimum, iconSize, spacing } from '@/constants/design-tokens';
import { useSavedRecalls } from '@/hooks/use-saved-recalls';
import { isSavedId, saveControlState } from '@/lib/saved-recalls';

const HIT_SLOP = hitSlopToMinimum(iconSize[20]);

export function SaveRecallButton({ caseId }: { caseId: string }) {
  const { ids, available, toggle } = useSavedRecalls();

  // Web has no saved-recall storage (saved-recalls-store.web.ts); offering a
  // control that cannot persist would be worse than not offering one.
  if (!available) return null;

  // The ONE decision (P2B7E): glyph, word, spoken name and announced
  // selection all come from `saveControlState`, so no state of this control
  // can render three of the four and drop the fourth.
  const state = saveControlState(isSavedId(ids, caseId));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: state.selected }}
      accessibilityLabel={state.accessibilityLabel}
      hitSlop={HIT_SLOP}
      onPress={() => void toggle(caseId)}>
      {({ pressed }) => (
        <View style={[styles.control, pressed && styles.pressed]}>
          {/* Never conditional: BOTH states carry a bookmark. */}
          <Icon name={state.icon} size={20} color="icon/primary" />
          <Text variant="caption" color="action/primary">
            {state.label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  control: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[4],
  },
  pressed: {
    opacity: 0.6,
  },
});
