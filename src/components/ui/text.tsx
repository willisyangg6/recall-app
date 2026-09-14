/**
 * The design-system text primitive (P2B0).
 *
 * One typography variant and one semantic text colour per element, both
 * resolved from the tokens — this file spells no size, weight, leading, or
 * colour of its own. It replaces `ThemedText` for migrated surfaces; the
 * legacy component stays for the screens that have not moved yet.
 *
 * Dynamic Type is honoured, not capped: no `maxFontSizeMultiplier` here, and
 * no consumer may pass one to defeat it. Text wraps by default; a caller that
 * needs a single line says so with `numberOfLines`, as React Native intends.
 */

import { Text as NativeText, type TextProps as NativeTextProps } from 'react-native';

import {
  color,
  textStyle,
  type TextColorToken,
  type TypographyVariant,
} from '@/constants/design-tokens';

export type TextProps = Omit<NativeTextProps, 'maxFontSizeMultiplier'> & {
  /** The type-scale token. Defaults to body copy. */
  variant?: TypographyVariant;
  /** The semantic colour token. Defaults to primary reading text. */
  color?: TextColorToken;
};

export function Text({
  variant = 'body',
  color: colorToken = 'text/primary',
  style,
  ...rest
}: TextProps) {
  return <NativeText style={[textStyle(variant), { color: color[colorToken] }, style]} {...rest} />;
}
