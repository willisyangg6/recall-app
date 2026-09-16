/**
 * The Search Bar (P2B1) — Figma `Search-Bar`: a 44pt white surface with a
 * 12pt radius, the card elevation, a leading search glyph, and the field.
 *
 * Behaviour is the caller's. This component holds no query of its own,
 * matches nothing, and navigates nowhere: it is a control inside a screen,
 * never a destination. What the text is matched against, and how, is
 * decided by the caller (the Feed's `filterBySearch`), so restyling the bar
 * changed nothing about what a search finds.
 *
 * The clear affordance is an explicit, labelled control ("Clear") rather
 * than iOS's native in-field glyph: it exists on every platform, it reads
 * aloud as "Clear search", and it hands focus back to the field so the next
 * search starts immediately. The field's own keyboard behaviour is left to
 * the platform and the caller, exactly as before — including whether it
 * takes focus as it appears (`autoFocus`, which a picker that opens on a
 * press passes so the keyboard is up when the list is).
 */

import { useRef } from 'react';
import { Pressable, StyleSheet, TextInput, type TextInputProps } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import {
  color,
  hitSlopToMinimum,
  layout,
  spacing,
  textStyle,
  typography,
} from '@/constants/design-tokens';

/** The clear control is one caption line tall; hitSlop makes it 44pt. */
const CLEAR_HIT_SLOP = hitSlopToMinimum(typography.caption.lineHeight);

export const CLEAR_SEARCH_LABEL = 'Clear';
export const CLEAR_SEARCH_ACCESSIBILITY_LABEL = 'Clear search';

export function SearchBar({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
  accessibilityHint,
  ...input
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  accessibilityLabel: string;
  accessibilityHint?: string;
} & Pick<TextInputProps, 'autoCapitalize' | 'autoCorrect' | 'returnKeyType' | 'autoFocus'>) {
  const field = useRef<TextInput>(null);

  return (
    <Surface radius={12} elevation="card" style={styles.bar}>
      <Icon name="search" size={20} color="icon/secondary" />
      <TextInput
        ref={field}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={color['text/secondary']}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        style={[textStyle('caption'), styles.field]}
        {...input}
      />
      {value !== '' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={CLEAR_SEARCH_ACCESSIBILITY_LABEL}
          hitSlop={CLEAR_HIT_SLOP}
          onPress={() => {
            onChangeText('');
            field.current?.focus();
          }}>
          {({ pressed }) => (
            <Text variant="caption" color="action/secondary" style={pressed && styles.pressed}>
              {CLEAR_SEARCH_LABEL}
            </Text>
          )}
        </Pressable>
      ) : null}
    </Surface>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[12],
    minHeight: layout.searchBarHeight,
    paddingHorizontal: spacing[12],
    paddingVertical: spacing[8],
  },
  field: {
    flex: 1,
    color: color['text/primary'],
  },
  pressed: {
    opacity: 0.6,
  },
});
