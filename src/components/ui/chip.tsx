/**
 * The Navigation Chip (P2B1) — Figma `Nav-Chip`: a compact pill that is
 * either selected (brand navy, inverse text) or not (white surface, primary
 * text), with an optional trailing glyph for a chip that opens a picker.
 *
 * It carries no behaviour of its own. The Feed uses it for two different
 * kinds of control that happen to share this look — the mutually exclusive
 * All / Affects me feed modes, and the Location / Risk / Category filters
 * that open a sheet — and what each press does stays entirely with the Feed.
 * Nothing here can turn a row of chips into a multi-select.
 *
 * Selection is never carried by colour alone: the chip reports
 * `accessibilityState.selected`, and its callers make the visible label
 * itself change (the counted `Location · 2`, or the either/or pair).
 *
 * ## Touch target
 *
 * The visible chip is 32pt — one caption line with 8pt above and below,
 * the compact height the design contract settles on — which is under the
 * 44pt minimum. `hitSlop` grows the pressable to the minimum on every side
 * without moving anything on screen. Chips sit beside one another with an
 * 8pt gap, and the slop is vertical only, so no two targets overlap.
 */

import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '@/components/ui/icon';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { hitSlopToMinimum, spacing, typography } from '@/constants/design-tokens';

/** The compact chip: one caption line with `spacing/8` above and below. */
export const CHIP_HEIGHT = spacing[8] * 2 + typography.caption.lineHeight;

const HIT_SLOP = hitSlopToMinimum(CHIP_HEIGHT);

export function Chip({
  label,
  selected,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  trailingIcon,
  style,
}: {
  /** The visible word(s). */
  label: string;
  selected: boolean;
  onPress: () => void;
  /** Spoken name when the visible label alone is ambiguous aloud. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** A glyph after the label — the chevron on a chip that opens a picker. */
  trailingIcon?: IconName;
  /** Layout only (a caller's margins); never colours. */
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      hitSlop={HIT_SLOP}
      onPress={onPress}
      style={style}>
      {({ pressed }) => (
        <Surface
          background={selected ? 'background/brand' : 'background/surface'}
          radius="full"
          style={[styles.chip, pressed && styles.pressed]}>
          <Text variant="caption" color={selected ? 'text/inverse' : 'text/primary'}>
            {label}
          </Text>
          {trailingIcon ? (
            <Icon
              name={trailingIcon}
              size={16}
              color={selected ? 'icon/inverse' : 'icon/primary'}
            />
          ) : null}
        </Surface>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[4],
    minHeight: CHIP_HEIGHT,
    paddingHorizontal: spacing[12],
    paddingVertical: spacing[8],
  },
  pressed: {
    opacity: 0.6,
  },
});
