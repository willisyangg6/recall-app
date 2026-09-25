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
 *
 * ## The leading slot (P2B7X.1)
 *
 * An optional element between the indicator and the label — an allergen's
 * glyph, a store's mark or its fallback — handed in by the caller, already
 * sized. It is decorative: the row's spoken name is still the label alone,
 * so a screen reader hears "Peanuts, checkbox, checked" and never an image.
 * Rows with and without a leading element keep the same height, because
 * the row's minimum is the 44pt target and the slot is never taller.
 */

import type { ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';

import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { color, hitTarget, iconSize, radius, spacing } from '@/constants/design-tokens';

export function CheckRow({
  label,
  checked,
  onPress,
  accessibilityHint,
  leading,
}: {
  /** The option, in the shopper's own words. */
  label: string;
  checked: boolean;
  onPress: () => void;
  accessibilityHint?: string;
  /** A decorative element before the label, sized by the caller. */
  leading?: ReactNode;
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
          <CheckIndicator checked={checked} />
          {leading !== undefined ? (
            <View accessible={false} importantForAccessibility="no-hide-descendants">
              {leading}
            </View>
          ) : null}
          <Text variant="body" style={styles.label}>
            {label}
          </Text>
        </Surface>
      )}
    </Pressable>
  );
}

/**
 * The square indicator itself (P2B7Z): the open box, and over it the filled
 * box with its check mark. Shared so the Allergens tile draws the very same
 * checkbox as this row. The filled layer is shown by `checked`, or — for a
 * caller that fades its selection — by the `fill` value it drives from 0 to
 * 1. Either way the box's size never changes, so nothing moves.
 */
export function CheckIndicator({ checked, fill }: { checked: boolean; fill?: Animated.Value }) {
  return (
    <View style={styles.box}>
      <Animated.View style={[styles.boxChecked, { opacity: fill ?? (checked ? 1 : 0) }]}>
        <View style={styles.mark} />
      </Animated.View>
    </View>
  );
}

const BOX_BORDER = 2;

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
    borderWidth: BOX_BORDER,
    borderColor: color['border/strong'],
  },
  // Laid exactly over the open box, border included.
  boxChecked: {
    position: 'absolute',
    top: -BOX_BORDER,
    left: -BOX_BORDER,
    right: -BOX_BORDER,
    bottom: -BOX_BORDER,
    borderRadius: radius[4],
    backgroundColor: color['action/primary'],
    alignItems: 'center',
    justifyContent: 'center',
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
