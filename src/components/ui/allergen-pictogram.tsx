/**
 * The Allergen Pictogram (2026-10-13): an allergen's approved Lotly
 * pictogram in a selector row's leading slot. It is the same file the
 * onboarding Allergens tiles draw (lib/allergen-assets.ts), untinted, and the
 * same whether or not the row is checked; the checkbox carries the state.
 *
 * ## Geometry
 *
 * The row keeps its 20pt leading slot (`PROFILE_PICTOGRAM.slot`), so no row,
 * gap or height moves. The picture is drawn at `PROFILE_PICTOGRAM.side`
 * (28pt) and overhangs the slot by 4pt on every side, the tiles' overhang.
 * Its artwork is then about 18pt, the visible size of the outline glyph it
 * replaced.
 *
 * Both boxes have an explicit width AND height. An `Image` sized any other
 * way, by `aspectRatio` or by absolute insets, rendered at the asset's
 * 1024pt intrinsic size on the iOS simulator: a giant outline behind the
 * page and an empty slot. It's drawn through `GuardedImage`, like every icon
 * these rows drew before, because a recycled iOS image view can otherwise
 * show another image's answer.
 *
 * ## Accessibility
 *
 * Decorative and hidden: the row that contains it speaks the allergen's name
 * and its checkbox state, and nothing else.
 */

import { StyleSheet, View } from 'react-native';

import { GuardedImage } from '@/components/ui/guarded-image';
import { allergenPictogram, PROFILE_PICTOGRAM } from '@/lib/allergen-assets';

/** The overhang on every side of the slot. */
const OVERHANG = (PROFILE_PICTOGRAM.side - PROFILE_PICTOGRAM.slot) / 2;

export function AllergenPictogram({ token }: { token: string }) {
  const source = allergenPictogram(token);
  if (source === null) return null;
  return (
    <View
      style={styles.slot}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <GuardedImage
        source={source}
        resizeMode="contain"
        accessible={false}
        style={styles.picture}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    width: PROFILE_PICTOGRAM.slot,
    height: PROFILE_PICTOGRAM.slot,
  },
  picture: {
    width: PROFILE_PICTOGRAM.side,
    height: PROFILE_PICTOGRAM.side,
    margin: -OVERHANG,
  },
});
