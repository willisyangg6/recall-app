/**
 * The selector trigger (P2B6A follow-up): the one compact row a preference
 * section keeps on the main screen. It shows the current choice in body type
 * (or the section's placeholder in the secondary colour), an optional
 * leading glyph, and the one action word at the trailing edge (`Select` /
 * `Change`, `Add stores` / `Edit stores`). Pressing it opens that section's
 * selector sheet; the whole row is the 44pt target.
 *
 * The value wraps: a long list of store names grows the row instead of
 * being cut or scrolled sideways. The spoken name is the caller's (the
 * section and its current choice, in full), with a hint saying what opens.
 * The ref is the row itself, so the opener can hand focus back here when
 * the sheet closes.
 */

import { forwardRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/icon';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { hitTarget, spacing } from '@/constants/design-tokens';

export const SelectorTrigger = forwardRef<
  View,
  {
    /** The current choice, or null for the placeholder. */
    value: string | null;
    placeholder: string;
    /** The one action word at the trailing edge. */
    action: string;
    icon?: IconName;
    accessibilityLabel: string;
    accessibilityHint: string;
    onPress: () => void;
  }
>(function SelectorTrigger(
  { value, placeholder, action, icon, accessibilityLabel, accessibilityHint, onPress },
  ref,
) {
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={onPress}>
      {({ pressed }) => (
        <Surface
          radius={12}
          border="border/default"
          style={[styles.row, pressed && styles.pressed]}>
          {icon ? <Icon name={icon} size={20} color="icon/primary" /> : null}
          <Text
            variant="body"
            color={value === null ? 'text/secondary' : 'text/primary'}
            style={styles.value}>
            {value ?? placeholder}
          </Text>
          <Text variant="caption" color="action/secondary">
            {action}
          </Text>
        </Surface>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[12],
    minHeight: hitTarget.minimum,
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[12],
  },
  value: {
    flex: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});
