/**
 * The one save control (P2A) — used by the feed card, by the Saved list and
 * by Recall Details, so the three can never disagree about what saving does
 * or how it reads aloud. All copy comes from lib/saved-recalls; this file is
 * layout and the tap.
 *
 * ## Appearance (P2B7H): the bookmark alone
 *
 * The design's bookmark glyph in brand navy, outline while the recall is not
 * saved and the SAME bookmark filled once it is — and nothing else. The
 * visible `Save` / `Saved` words are gone, which is the Figma direction
 * (node `81:792`) and closes DESIGN.md conflict 16; a bookmark is a
 * understood affordance, and on a card already carrying a risk badge, a
 * relevance label, a category tag, a date and a location, a word beside it
 * was the least informative thing in the row.
 *
 * Losing the word costs the state one channel, so the remaining ones are
 * load-bearing and none of them is colour:
 *
 *   - SHAPE — outline vs filled. The glyph pair is never conditional: both
 *     states render a bookmark, so the control can never vanish (the P2B7E
 *     regression) or become a different object.
 *   - SPOKEN ACTION — `accessibilityLabel` names what a tap does ("Save
 *     recall" / "Remove from saved recalls"), which is now the only wording
 *     the control has.
 *   - SELECTED STATE — `accessibilityState.selected`, the conventional way
 *     to announce "on", so the saved condition survives without a word.
 *
 * All three come from `saveControlState`, so no state of this control can
 * render one and drop another.
 *
 * ## Touch target
 *
 * The visible control is one 20pt glyph — well under the 44pt minimum, and
 * further under it now that the caption line is gone. `hitSlop` grows the
 * pressable to the minimum on every side without moving anything on screen,
 * so the card's layout is unchanged and the target is honest. When the
 * control sits inside a card, React Native's responder negotiation gives
 * the tap to this innermost pressable, so saving never also opens the
 * recall.
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { hitSlopToMinimum, iconSize } from '@/constants/design-tokens';
import { useSavedRecalls } from '@/hooks/use-saved-recalls';
import { isSavedId, saveControlState, type SaveControlState } from '@/lib/saved-recalls';

const HIT_SLOP = hitSlopToMinimum(iconSize[20]);

/**
 * The control's APPEARANCE for one already-decided state, and the only
 * place it is drawn.
 *
 * Split out so the development gallery can show the saved and unsaved
 * treatments side by side without reading or writing this device's bookmark
 * list — the alternative being a second copy of the glyph in the harness,
 * which is exactly how a preview stops showing the product.
 */
export function SaveControlAppearance({
  state,
  pressed = false,
}: {
  state: SaveControlState;
  pressed?: boolean;
}) {
  // Never conditional: BOTH states carry a bookmark.
  return (
    <View style={[styles.control, pressed && styles.pressed]}>
      <Icon name={state.icon} size={20} color="icon/primary" />
    </View>
  );
}

export function SaveRecallButton({ caseId }: { caseId: string }) {
  const { ids, available, toggle } = useSavedRecalls();

  // Web has no saved-recall storage (saved-recalls-store.web.ts); offering a
  // control that cannot persist would be worse than not offering one.
  if (!available) return null;

  // The ONE decision (P2B7E): glyph, spoken action and announced selection
  // all come from `saveControlState`, so no state of this control can render
  // two of the three and drop the third.
  const state = saveControlState(isSavedId(ids, caseId));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: state.selected }}
      accessibilityLabel={state.accessibilityLabel}
      hitSlop={HIT_SLOP}
      onPress={() => void toggle(caseId)}>
      {({ pressed }) => <SaveControlAppearance state={state} pressed={pressed} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  control: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
