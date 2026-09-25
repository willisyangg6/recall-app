/**
 * The allergen icons (P2B7X.1): one glyph per consumer allergen, all from
 * ONE family, so Profile's nine allergen rows read as a set. The onboarding
 * Allergens grid draws the Lotly pictograms instead (lib/allergen-assets.ts).
 *
 * ## The family: Lucide (ISC)
 *
 * The app's icon set is already Lucide's outline language (DESIGN.md,
 * "Iconography"), so the nine glyphs come from the Lucide repository itself
 * — `lucide-icons/lucide`, main branch at commit
 * `f06ac67e33d645c40b8ce19a0419c85c5d7dd751` (release 1.47.0), retrieved
 * 2026-09-23 under the ISC license (assets/icon-sources/lucide/LICENSE). The SVG
 * sources are vendored beside the license and rasterised offline by
 * scripts/render-onboarding-assets.mjs onto the same 24pt box, at the same
 * three scales and the same stroke weight as the existing set, so every
 * allergen glyph shares one visual box and one stroke logic.
 *
 * ## The mapping, and its three stand-ins
 *
 * No permissively licensed outline family publishes a peanut, a tree-nut
 * or a sesame glyph (Lucide, Phosphor, Tabler, Iconoir and Font Awesome
 * were checked). Rather than mix families or draw food symbols, those
 * three rows use the family's nearest honest concept, and the LABEL carries
 * the meaning — every icon is decorative and hidden from assistive
 * technology, exactly like the rest of the set:
 *
 *   Peanuts               `nut`             a nut glyph; peanuts are the nut a
 *                                           shopper pictures first
 *   Tree nuts             `tree-deciduous`  the tree of "tree nuts"
 *   Sesame                `sprout`          a seed, sprouting
 *
 * The other six are literal: Milk `milk`, Egg `egg`, Wheat `wheat`, Soy
 * `bean`, Fish `fish`, Crustacean shellfish `shrimp`.
 *
 * A leaf: data only. The rasters are declared by the icon primitive under
 * the `allergen-*` names, and `allergen-icons.test.ts` proves the mapping
 * covers every consumer allergen with nine distinct glyphs whose assets
 * exist at all three scales with one box size.
 */

import { CONSUMER_ALLERGENS } from '@/domain/preferences';

/** The icon-primitive names, one per allergen token. */
export const ALLERGEN_ICONS = {
  peanut: 'allergen-peanut',
  'tree nuts': 'allergen-tree-nut',
  milk: 'allergen-milk',
  egg: 'allergen-egg',
  wheat: 'allergen-wheat',
  soy: 'allergen-soy',
  sesame: 'allergen-sesame',
  fish: 'allergen-fish',
  shellfish: 'allergen-shellfish',
} as const;

export type AllergenIconName = (typeof ALLERGEN_ICONS)[keyof typeof ALLERGEN_ICONS];

export function allergenIconName(token: string): AllergenIconName | null {
  return (ALLERGEN_ICONS as Record<string, AllergenIconName>)[token] ?? null;
}

/** Provenance for one glyph. */
export interface AllergenIconSource {
  icon: AllergenIconName;
  /** The Lucide icon the raster was made from. */
  lucideName: string;
  /** Whether the glyph depicts the allergen itself or its nearest concept. */
  depiction: 'literal' | 'concept';
}

export const ALLERGEN_ICON_FAMILY = {
  name: 'Lucide',
  license: 'ISC',
  repository: 'https://github.com/lucide-icons/lucide',
  commit: 'f06ac67e33d645c40b8ce19a0419c85c5d7dd751',
  release: '1.47.0',
  retrievedOn: '2026-09-23',
  /** Where the vendored SVG sources and the license text live. */
  sourceDirectory: 'assets/icon-sources/lucide',
} as const;

export const ALLERGEN_ICON_SOURCES: readonly AllergenIconSource[] = [
  { icon: 'allergen-peanut', lucideName: 'nut', depiction: 'concept' },
  { icon: 'allergen-tree-nut', lucideName: 'tree-deciduous', depiction: 'concept' },
  { icon: 'allergen-milk', lucideName: 'milk', depiction: 'literal' },
  { icon: 'allergen-egg', lucideName: 'egg', depiction: 'literal' },
  { icon: 'allergen-wheat', lucideName: 'wheat', depiction: 'literal' },
  { icon: 'allergen-soy', lucideName: 'bean', depiction: 'literal' },
  { icon: 'allergen-sesame', lucideName: 'sprout', depiction: 'concept' },
  { icon: 'allergen-fish', lucideName: 'fish', depiction: 'literal' },
  { icon: 'allergen-shellfish', lucideName: 'shrimp', depiction: 'literal' },
];

/** Every consumer allergen has an icon, in catalog order. */
export function allergenIconRows(): { token: string; label: string; icon: AllergenIconName }[] {
  return CONSUMER_ALLERGENS.map((option) => ({
    token: option.token,
    label: option.label,
    icon: allergenIconName(option.token) as AllergenIconName,
  }));
}
