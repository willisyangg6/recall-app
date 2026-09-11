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
 * Provisional styling: an existing themed chip, the same primitive the filter
 * chips use. No icon — the app installs no icon set, and text alone is
 * unambiguous. The design-system pass replaces the appearance here without
 * touching the behavior.
 */

import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radii, Spacing } from '@/constants/theme';
import { useSavedRecalls } from '@/hooks/use-saved-recalls';
import {
  isSavedId,
  SAVE_ACCESSIBILITY_LABEL,
  SAVE_ACTION_LABEL,
  SAVED_ACCESSIBILITY_LABEL,
  SAVED_ACTION_LABEL,
} from '@/lib/saved-recalls';

export function SaveRecallButton({ caseId }: { caseId: string }) {
  const { ids, available, toggle } = useSavedRecalls();

  // Web has no saved-recall storage (saved-recalls-store.web.ts); offering a
  // control that cannot persist would be worse than not offering one.
  if (!available) return null;

  const saved = isSavedId(ids, caseId);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: saved }}
      accessibilityLabel={saved ? SAVED_ACCESSIBILITY_LABEL : SAVE_ACCESSIBILITY_LABEL}
      // The chip's own padding leaves it under the 44pt minimum on a compact
      // row; hitSlop restores the touch target without changing the layout —
      // the same treatment the feed's filter chips get.
      hitSlop={{ top: Spacing.two, bottom: Spacing.two, left: Spacing.two, right: Spacing.two }}
      onPress={() => void toggle(caseId)}>
      <ThemedView type={saved ? 'backgroundSelected' : 'backgroundElement'} style={styles.chip}>
        <ThemedText type="small" style={saved ? styles.savedLabel : undefined}>
          {saved ? `✓ ${SAVED_ACTION_LABEL}` : SAVE_ACTION_LABEL}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Radii.small,
  },
  savedLabel: {
    fontWeight: '600',
  },
});
