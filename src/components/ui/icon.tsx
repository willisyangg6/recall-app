/**
 * The icon primitive (P2B1): one glyph from the approved set, at a size from
 * the icon scale, in a semantic icon colour.
 *
 * ## Where the glyphs come from
 *
 * No icon library is installed — adding one is a dependency decision the
 * Feed milestone was told not to make — so the glyphs are the Figma file's
 * own exported vectors: the Lucide-style outlines the design uses (`house`,
 * `bookmark`, `user-round`, `search`, `map-pin`, `flag`, `chevron-down`, and
 * from the Detail frame `external-link`, `triangle-alert` as `warning`, and
 * `info`). Each export was rasterised once, unchanged in shape, into
 * `assets/icons/<name>.png` at 1x/2x/3x on a 24pt box, black on transparent,
 * and is tinted here at render time. `bookmark-filled` is the same bookmark
 * path with its interior filled: the active state of the save control, and
 * `chevron-right` (P2B5) is the `chevron-down` export turned a quarter turn,
 * which on the Lucide grid is exactly its `chevron-right`: the navigation
 * affordance on Profile's rows. Nothing was drawn by hand; the exact
 * exports, the normalisation rule and the stroke weight are recorded in
 * DESIGN.md ("Iconography").
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
  'chevron-right': require('@/assets/icons/chevron-right.png') as ImageSourcePropType,
  'external-link': require('@/assets/icons/external-link.png') as ImageSourcePropType,
  warning: require('@/assets/icons/warning.png') as ImageSourcePropType,
  info: require('@/assets/icons/info.png') as ImageSourcePropType,
  // P2B7X.1: the `chevron-down` rasters turned a quarter turn clockwise —
  // the same lossless rotation `chevron-right` is — for the onboarding
  // screens' back control.
  'chevron-left': require('@/assets/icons/chevron-left.png') as ImageSourcePropType,
  // P2B7X.1: the nine allergen glyphs, one Lucide family (ISC), rasterised
  // from the vendored sources in assets/icon-sources/lucide/ onto the same box at
  // the same stroke weight as the rest of the set. Which glyph stands for
  // which allergen, and why three are concept stand-ins, is recorded in
  // src/lib/allergen-icons.ts.
  'allergen-peanut': require('@/assets/icons/allergen-peanut.png') as ImageSourcePropType,
  'allergen-tree-nut': require('@/assets/icons/allergen-tree-nut.png') as ImageSourcePropType,
  'allergen-milk': require('@/assets/icons/allergen-milk.png') as ImageSourcePropType,
  'allergen-egg': require('@/assets/icons/allergen-egg.png') as ImageSourcePropType,
  'allergen-wheat': require('@/assets/icons/allergen-wheat.png') as ImageSourcePropType,
  'allergen-soy': require('@/assets/icons/allergen-soy.png') as ImageSourcePropType,
  'allergen-sesame': require('@/assets/icons/allergen-sesame.png') as ImageSourcePropType,
  'allergen-fish': require('@/assets/icons/allergen-fish.png') as ImageSourcePropType,
  'allergen-shellfish': require('@/assets/icons/allergen-shellfish.png') as ImageSourcePropType,
  // The States step's interface glyphs: the same vendored Lucide family,
  // box and stroke. Provenance in src/lib/state-map.ts.
  map: require('@/assets/icons/map.png') as ImageSourcePropType,
  list: require('@/assets/icons/list.png') as ImageSourcePropType,
  x: require('@/assets/icons/x.png') as ImageSourcePropType,
  check: require('@/assets/icons/check.png') as ImageSourcePropType,
  'zoom-in': require('@/assets/icons/zoom-in.png') as ImageSourcePropType,
  'zoom-out': require('@/assets/icons/zoom-out.png') as ImageSourcePropType,
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
