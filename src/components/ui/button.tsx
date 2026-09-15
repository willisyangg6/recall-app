/**
 * The Button (P2B3): a full 44pt pill in one of two treatments.
 *
 *   primary    brand navy with inverse text — the one action a screen wants
 *              taken (Next, Submit report, Done)
 *   secondary  the white surface with a `border/default` border and primary
 *              text — the way back, or a lesser action beside the primary
 *
 * It is the same composition the Feed's filter sheet already draws for
 * Apply / Cancel / Clear, made shareable: `radius/full`, `spacing/16` at the
 * sides, `spacing/8` above and below, and `body-small-bold` for the label so
 * a form action reads at a glance. The whole pill is the target — never a
 * caption line grown through hitSlop — because a form's primary action
 * should look as tappable as it is.
 *
 * Disabled and busy are announced, not just dimmed: both set
 * `accessibilityState`, and a busy button also swaps its visible label for
 * the caller's progress word so the state has a non-colour channel.
 *
 * ## A disabled label stays readable
 *
 * Disabled is carried by the SURFACE — a primary drops from brand navy to
 * `action/disabled`, a secondary keeps its white surface and mutes its
 * border — never by fading the words past legibility. `text/disabled` is a
 * fill-and-border grey: on either of those surfaces it lands at 1.45:1 and
 * 1.00:1, which is not text. Each disabled label therefore takes the
 * existing semantic text token that clears WCAG AA on the surface it
 * actually sits on (DESIGN.md, "Interaction states → Disabled"):
 *
 *   primary disabled    `text/primary` on `action/disabled`      11.40:1
 *   secondary disabled  `text/secondary` on `background/surface`  4.83:1
 *
 * `design-foundation.test.ts` recomputes both ratios from the tokens, so a
 * palette change that broke either one fails there rather than on a screen.
 * The label is the caller's, from a presentation contract — this component
 * invents no words.
 */

import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from '@/components/ui/text';
import { color, hitTarget, radius, spacing, type TextColorToken } from '@/constants/design-tokens';

export type ButtonVariant = 'primary' | 'secondary';

/**
 * The label colour for each variant and state. Every value is an existing
 * semantic text token, chosen for its contrast on that variant's own
 * surface; the disabled pair is the reason this table exists rather than a
 * chain of inline conditionals.
 */
const LABEL_COLOR: Record<ButtonVariant, { enabled: TextColorToken; disabled: TextColorToken }> = {
  primary: { enabled: 'text/inverse', disabled: 'text/primary' },
  secondary: { enabled: 'text/primary', disabled: 'text/secondary' },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  busy = false,
  busyLabel,
  accessibilityLabel,
  accessibilityHint,
  style,
}: {
  /** The visible word(s). */
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  /** An operation this button started is in flight; the button is inert until it settles. */
  busy?: boolean;
  /** What the button reads while busy (the contract's progress word). */
  busyLabel?: string;
  /** Spoken name when the visible label alone is ambiguous aloud. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Layout only (a caller's flex or margins); never colours. */
  style?: StyleProp<ViewStyle>;
}) {
  const inert = disabled || busy;
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inert, busy }}
      disabled={inert}
      onPress={onPress}
      style={style}>
      {({ pressed }) => (
        <View
          style={[
            styles.pill,
            primary ? styles.primary : styles.secondary,
            inert && (primary ? styles.primaryInert : styles.secondaryInert),
            pressed && styles.pressed,
          ]}>
          <Text
            variant="body-small-bold"
            color={LABEL_COLOR[variant][inert ? 'disabled' : 'enabled']}
            style={styles.label}>
            {busy && busyLabel !== undefined ? busyLabel : label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    minHeight: hitTarget.minimum,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[8],
    borderRadius: radius.full,
  },
  primary: {
    backgroundColor: color['action/primary'],
  },
  primaryInert: {
    backgroundColor: color['action/disabled'],
  },
  secondary: {
    backgroundColor: color['background/surface'],
    borderWidth: 1,
    borderColor: color['border/default'],
  },
  secondaryInert: {
    borderColor: color['border/subtle'],
  },
  label: {
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
