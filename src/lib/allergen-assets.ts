/**
 * The Lotly allergen pictograms: the onboarding Allergens tiles' art, one
 * approved production PNG per consumer allergen, keyed by the canonical
 * token `CONSUMER_ALLERGENS` already holds. The vocabulary, labels and order
 * stay in domain/preferences; this module only says which picture each
 * token gets.
 *
 * ## The files
 *
 * Nine approved production pictogram assets, directly in `assets/icons/` as
 * `allergen-<name>-1024.png`: 1024×1024 8-bit RGBA, tagged sRGB, on a
 * transparent canvas normalized so every drawing sits inside the same
 * 720px optical bound. They carry the same mechanical alpha repair as the
 * mascots (clear pixels hold no colour, alpha 240–254 lifted to 255 with RGB
 * untouched, the soft edge unmatted against white) and are otherwise as
 * approved — never tinted, recoloured or cropped, apart from one
 * founder-approved pinhole fill in tree nuts' outline — so a tile draws them
 * whole with `contain` in a 44pt box, where the art is about 31pt. The
 * pack's contact sheet, its source-pack asset report and the production
 * asset report of these final files are review material only, kept in
 * `assets/brand/reference/allergens/` and bundled by nothing.
 *
 * The Lucide allergen glyphs (lib/allergen-icons.ts) are unchanged and
 * still draw Profile's allergen rows; this family replaces them on the
 * onboarding grid alone.
 *
 * Static `require`s only, one per file, so Metro can see and bundle each
 * asset. `allergen-assets.test.ts` loads this module and proves the map
 * covers exactly the canonical tokens with nine distinct files.
 */

import type { ImageSourcePropType } from 'react-native';

export const ALLERGEN_PICTOGRAMS: Readonly<Record<string, ImageSourcePropType>> = {
  peanut: require('@/assets/icons/allergen-peanuts-1024.png') as ImageSourcePropType,
  'tree nuts': require('@/assets/icons/allergen-tree-nuts-1024.png') as ImageSourcePropType,
  milk: require('@/assets/icons/allergen-milk-1024.png') as ImageSourcePropType,
  egg: require('@/assets/icons/allergen-egg-1024.png') as ImageSourcePropType,
  wheat: require('@/assets/icons/allergen-wheat-1024.png') as ImageSourcePropType,
  soy: require('@/assets/icons/allergen-soy-1024.png') as ImageSourcePropType,
  sesame: require('@/assets/icons/allergen-sesame-1024.png') as ImageSourcePropType,
  fish: require('@/assets/icons/allergen-fish-1024.png') as ImageSourcePropType,
  shellfish:
    require('@/assets/icons/allergen-crustacean-shellfish-1024.png') as ImageSourcePropType,
};

/** The pictogram for a canonical allergen token, or null for any other token. */
export function allergenPictogram(token: string): ImageSourcePropType | null {
  return ALLERGEN_PICTOGRAMS[token] ?? null;
}
