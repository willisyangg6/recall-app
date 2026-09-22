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
 *
 * ## The row stacks before the value is squeezed (P2B7U)
 *
 * The value and the action share a line only while both fit. At the
 * accessibility text sizes they cannot: `Edit states` alone takes most of a
 * phone's width, and the value was left a column a few characters wide, so
 * `California` came down the screen one syllable per line. Nothing was
 * clipped — the row simply grew absurdly tall, and unreadable with it.
 *
 * Above a text scale of 1.5 the row becomes a column: the glyph and the
 * value on one line with the full width to wrap in, the action beneath them
 * at the leading edge. At ordinary sizes nothing moves.
 *
 * `flexWrap` cannot do this. Yoga measures a `Text` by calling its measure
 * function with the space available, so a wrapping value reports a
 * hypothetical width no larger than the line it is already on; it never
 * overflows, the line always "fits", and the action never wraps. The
 * reader's own text scale is the honest input, read through
 * `useWindowDimensions` so the row restacks when they change the setting
 * rather than at the next cold launch — the same technique, for the same
 * reason, as the tab navigator's header height (app/(tabs)/_layout.tsx).
 */

import { forwardRef } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

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
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= STACK_AT_SCALE;
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
          style={[styles.row, stacked && styles.rowStacked, pressed && styles.pressed]}>
          <View style={[styles.main, stacked && styles.mainStacked]}>
            {icon ? <Icon name={icon} size={20} color="icon/primary" /> : null}
            <Text
              variant="body"
              color={value === null ? 'text/secondary' : 'text/primary'}
              style={styles.value}>
              {value ?? placeholder}
            </Text>
          </View>
          <Text variant="caption" color="action/secondary">
            {action}
          </Text>
        </Surface>
      )}
    </Pressable>
  );
});

/**
 * The text scale at which the value and the action stop sharing a line.
 * iOS's accessibility sizes start around here, and it is where the action
 * word begins taking more width than the value it sits beside.
 */
const STACK_AT_SCALE = 1.5;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[12],
    minHeight: hitTarget.minimum,
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[12],
  },
  // Stacked: the value's line, then the action's, both at the leading edge.
  rowStacked: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacing[8],
  },
  // The glyph and the value stay together on their own line either way.
  main: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[12],
    flex: 1,
  },
  mainStacked: {
    // In a column, `flex: 1` would stretch this vertically instead of
    // horizontally; the row's full width comes from stretching across it.
    flex: 0,
    alignSelf: 'stretch',
  },
  value: {
    flex: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});
