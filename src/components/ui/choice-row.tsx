/**
 * The Choice Row (P2B3): one answer in a single-choice question, and the
 * group that holds a question's answers.
 *
 * A row is a white `radius/12` selection surface with a `border/default`
 * border, a radio indicator, and the answer in body type — at least 44pt
 * tall, growing with the reader's type size. Choosing it fills the
 * indicator and turns the border brand navy, so the chosen answer is carried
 * by the indicator's dot as well as by colour, and the row reports
 * `accessibilityState.checked` so the choice is announced.
 *
 * The group is a real radio group: it carries the question as its spoken
 * name, so a screen reader hears what the answers answer. Behaviour stays
 * with the caller — which answer is chosen, and what choosing does, are the
 * questionnaire's; this component holds no state and invents no words.
 *
 * Nothing animates when a choice changes, which is also the reduced-motion
 * behaviour: the indicator simply fills.
 */

import { Pressable, StyleSheet, View, type ViewProps } from 'react-native';

import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { color, hitTarget, iconSize, radius, spacing } from '@/constants/design-tokens';

export function ChoiceGroup({
  label,
  children,
  style,
}: {
  /** The question these choices answer — the group's spoken name. */
  label: string;
  children: React.ReactNode;
  style?: ViewProps['style'];
}) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.group, style]}>
      {children}
    </View>
  );
}

export function ChoiceRow({
  label,
  checked,
  onPress,
}: {
  /** The answer, in the shopper's own words (the contract's option label). */
  label: string;
  checked: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked, selected: checked }}
      onPress={onPress}>
      {({ pressed }) => (
        <Surface
          radius={12}
          border="border/default"
          style={[styles.row, checked && styles.rowChecked, pressed && styles.pressed]}>
          {/* The indicator is centred on the row, so it sits level with a
              one-line answer at any type size and mid-way beside one that
              wraps — never pinned to an unscaled line box. */}
          <View style={[styles.ring, checked && styles.ringChecked]}>
            {checked ? <View style={styles.dot} /> : null}
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
  group: {
    gap: spacing[8],
  },
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
  ring: {
    width: iconSize[20],
    height: iconSize[20],
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: color['border/strong'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringChecked: {
    borderColor: color['action/primary'],
  },
  dot: {
    width: iconSize[12],
    height: iconSize[12],
    borderRadius: radius.full,
    backgroundColor: color['action/primary'],
  },
  label: {
    flex: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});
