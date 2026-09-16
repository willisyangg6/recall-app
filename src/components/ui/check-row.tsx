/**
 * The Check Row (P2B6A): one option in a multi-choice list — the Choice
 * Row's sibling. Where the Choice Row's round indicator says "one of these",
 * this row's square one says "any of these": the platform's own radio /
 * checkbox distinction, so a list reads as single- or multi-select before a
 * word is read.
 *
 * The same white `radius/12` selection surface with a `border/default`
 * border and the option in body type, at least 44pt tall and growing with
 * the reader's type size. Checking it fills the square and draws the check
 * mark, and turns the border brand navy, so the state is carried by the mark
 * as well as by colour; the row reports `accessibilityState.checked` under
 * the `checkbox` role so it is announced as one.
 *
 * Behaviour stays with the caller — which options are checked, and what
 * checking does, are the screen's; this component holds no state and
 * invents no words. Nothing animates, which is also the reduced-motion
 * behaviour.
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { color, hitTarget, iconSize, radius, spacing } from '@/constants/design-tokens';

export function CheckRow({
  label,
  checked,
  onPress,
  accessibilityHint,
}: {
  /** The option, in the shopper's own words. */
  label: string;
  checked: boolean;
  onPress: () => void;
  accessibilityHint?: string;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ checked }}
      onPress={onPress}>
      {({ pressed }) => (
        <Surface
          radius={12}
          border="border/default"
          style={[styles.row, checked && styles.rowChecked, pressed && styles.pressed]}>
          {/* Centred on the row like the Choice Row's ring, so it sits level
              with a one-line option at any type size. */}
          <View style={[styles.box, checked && styles.boxChecked]}>
            {checked ? <View style={styles.mark} /> : null}
          </View>
          <Text variant="body" style={styles.label}>
            {label}
          </Text>
        </Surface>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[12],
    minHeight: hitTarget.minimum,
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[12],
  },
  rowChecked: {
    borderColor: color['action/primary'],
  },
  box: {
    width: iconSize[20],
    height: iconSize[20],
    borderRadius: radius[4],
    borderWidth: 2,
    borderColor: color['border/strong'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: {
    borderColor: color['action/primary'],
    backgroundColor: color['action/primary'],
  },
  // The check mark: the corner of a small rectangle, turned a half right
  // angle, in the inverse colour — the same construction as the Choice
  // Row's dot, drawn from views rather than a glyph so it needs no asset
  // and no font, and cannot scale out of its box.
  mark: {
    width: 6,
    height: 11,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderColor: color['icon/inverse'],
    transform: [{ translateY: -1 }, { rotate: '45deg' }],
  },
  label: {
    flex: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});
