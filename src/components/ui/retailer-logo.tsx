/**
 * The Retailer Logo (P2B7X.1): a store's mark beside its name in a
 * selector row, or the shared `home` glyph when no trustworthy mark is
 * bundled — and never anything in between.
 *
 * ## What renders
 *
 * One fixed container, `RETAILER_LOGO_BOX` (40×24pt), for every row. A mark
 * is CONTAINED in it: the official raster's own aspect ratio is preserved,
 * nothing is stretched, cropped, tinted or recoloured, and a wide or tall
 * mark simply has air on the short axis. The fallback is the icon set's
 * `home` glyph, centred in the same box in `icon/secondary`, so a row with a
 * mark and a row without one are the same height and their labels start at
 * the same edge.
 *
 * ## Where marks come from
 *
 * `MARKS` below is the only place a raster is declared, keyed by the
 * canonical retailer id and matched entry-for-entry to the provenance
 * manifest in lib/retailer-logos.ts (pinned by test). Every source is a
 * `require` of a file in assets/retailer-logos/ — there is no `uri`, no
 * remote fetch and no logo service — and a retailer absent from both
 * renders the fallback. Today both are empty: no official asset has been
 * sourced with confidence, so all 77 retailers fall back.
 *
 * ## Accessibility
 *
 * The image is decorative. The row that contains it speaks the retailer's
 * name from its own label, and this component additionally carries the name
 * as its accessibility label so the mark can never be announced as a bare
 * image wherever it is placed. It renders on the selector rows only — never
 * on a recall card and never in Detail's retailer row.
 */

import { Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { RETAILER_LOGO_BOX, retailerLogoEntry } from '@/lib/retailer-logos';

/**
 * Bundled marks by canonical retailer id. Add an entry here AND in
 * `RETAILER_LOGO_MANIFEST`, never one without the other.
 */
const MARKS: Readonly<Record<string, ImageSourcePropType>> = {};

/** Whether a bundled, provenance-recorded mark exists for this retailer. */
export function hasRetailerLogo(retailerId: string): boolean {
  return retailerId in MARKS && retailerLogoEntry(retailerId) !== null;
}

export function RetailerLogo({ retailerId, name }: { retailerId: string; name: string }) {
  if (hasRetailerLogo(retailerId)) {
    return <RetailerLogoMark source={MARKS[retailerId]} name={name} />;
  }
  return <RetailerLogoFallback name={name} />;
}

/** A mark, contained in the shared box. Exported for the development gallery's fixtures. */
export function RetailerLogoMark({
  source,
  name,
}: {
  source: ImageSourcePropType;
  /** The retailer's name: the spoken label, independent of the image. */
  name: string;
}) {
  return (
    <View style={styles.box} accessible accessibilityRole="image" accessibilityLabel={name}>
      <Image source={source} style={styles.mark} resizeMode="contain" accessible={false} />
    </View>
  );
}

/** The shared `home` glyph, centred in the same box. */
export function RetailerLogoFallback({ name }: { name: string }) {
  return (
    <View style={styles.box} accessible accessibilityRole="image" accessibilityLabel={name}>
      <Icon name="home" size={20} color="icon/secondary" />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    width: RETAILER_LOGO_BOX.width,
    height: RETAILER_LOGO_BOX.height,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: {
    width: '100%',
    height: '100%',
  },
});
