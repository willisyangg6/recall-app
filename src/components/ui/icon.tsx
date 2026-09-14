/**
 * The icon primitive (P2B1): one glyph from the approved set, at a size from
 * the icon scale, in a semantic icon colour.
 *
 * ## Where the glyphs come from
 *
 * No icon library is installed — adding one is a dependency decision the
 * Feed milestone was told not to make — so the glyphs are the Figma file's
 * own exported vectors: the Lucide-style outlines the design uses (`house`,
 * `bookmark`, `user-round`, `search`, `map-pin`, `flag`, `chevron-down`).
 * Each export was rasterised once, unchanged in shape, into
 * `assets/icons/<name>.png` at 1x/2x/3x on a 24pt box, black on transparent,
 * and is tinted here at render time. `bookmark-filled` is the same bookmark
 * path with its interior filled: the active state of the save control.
 * Nothing was drawn by hand; the exact exports, the normalisation rule and
 * the stroke weight are recorded in DESIGN.md ("Iconography").
 *
 * Every glyph is decorative. The control or label that contains one carries
 * the spoken name, and the image itself is hidden from assistive technology,
 * so an icon can never be announced as a bare "image".
 */

import { Image, type ImageSourcePropType } from 'react-native';

import {
  color,
  iconSize,
  type ColorToken,
  type HexColor,
  type IconSizeStep,
} from '@/constants/design-tokens';

const GLYPHS = {
  home: require('@/assets/icons/home.png') as ImageSourcePropType,
  bookmark: require('@/assets/icons/bookmark.png') as ImageSourcePropType,
  'bookmark-filled': require('@/assets/icons/bookmark-filled.png') as ImageSourcePropType,
  user: require('@/assets/icons/user.png') as ImageSourcePropType,
  search: require('@/assets/icons/search.png') as ImageSourcePropType,
  'map-pin': require('@/assets/icons/map-pin.png') as ImageSourcePropType,
  flag: require('@/assets/icons/flag.png') as ImageSourcePropType,
  'chevron-down': require('@/assets/icons/chevron-down.png') as ImageSourcePropType,
} as const;

export type IconName = keyof typeof GLYPHS;

/** The approved glyph names, for tests and galleries. */
export const ICON_NAMES = Object.keys(GLYPHS) as IconName[];

/** What an icon may be coloured with: the semantic icon tokens. */
export type IconColorToken = Extract<ColorToken, `icon/${string}`>;

export function Icon({
  name,
  size = 20,
  color: colorToken = 'icon/primary',
  tint,
}: {
  name: IconName;
  /** From the icon scale: 12 inside a label, 16 inline with text, 20 utility, 24 tab. */
  size?: IconSizeStep;
  /** The semantic icon colour. */
  color?: IconColorToken;
  /**
   * A label palette's own foreground, when the icon sits inside a risk or
   * relevance label whose colours are looked up rather than semantic.
   * Overrides `color`.
   */
  tint?: HexColor;
}) {
  const side = iconSize[size];
  return (
    <Image
      source={GLYPHS[name]}
      style={{ width: side, height: side, tintColor: tint ?? color[colorToken] }}
      resizeMode="contain"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
