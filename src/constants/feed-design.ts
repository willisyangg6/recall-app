/**
 * The Feed + Filters design (2026-10-06): the approved header, recall card
 * and Filters sheet, from the verified source kit in
 * docs/lotly-feed-filters-source-kit/ (`spec/design-tokens.json` and
 * `spec/COMPONENT-CONTRACT.md` are the authority for every number here).
 *
 * ## Why a scoped module
 *
 * The app-wide scale in design-tokens.ts is pinned to DESIGN.md's front
 * matter and is shared by onboarding, Ready, Detail and Profile — screens
 * this milestone must not change. The kit's sizes (a 32pt screen title, a
 * 20pt card title, 12/16 bold badges, radius 5/6/14/20) are therefore
 * declared here, for the Feed's header, its cards and its Filters sheet
 * only, over the SAME loaded Public Sans faces. Nothing here recolours a
 * global token. The card's white-on-red Critical, once an override here,
 * became the one risk palette with the label kit (2026-10-09), so risk
 * colours are design-tokens.ts's `riskPalette` everywhere.
 */

import type { TextStyle } from 'react-native';

import type { IconName } from '@/components/ui/icon';
import { CUSTOM_FONTS_INSTALLED, fontFace, type HexColor } from '@/constants/design-tokens';
import type { FoodCategoryId } from '@/domain/food-category';

export const feedColor = {
  page: '#FDFCF6',
  surface: '#FFFFFF',
  text: '#001F3E',
  secondary: '#66747A',
  brand: '#2B4A6C',
  border: '#D1D7D9',
  divider: '#E1E5E6',
  /** Text and glyphs on brand navy (the chosen tab, All, Apply). */
  inverse: '#FFFFFF',
  /** The sheet's scrim: black at 32%. */
  scrim: 'rgba(0, 0, 0, 0.32)',
} as const;

export const feedGeometry = {
  pageGutter: 14,
  headerGap: 12,
  searchHeight: 44,
  searchRadius: 12,
  tabHeight: 44,
  tabRadius: 12,
  filtersButtonMinWidth: 88,
  filtersButtonHeight: 44,
  controlRadius: 8,
  cardPadding: 12,
  cardRadius: 14,
  cardGap: 14,
  cardColumnGap: 12,
  /** Below this right-column width the photo stacks above the text. */
  cardStackBelowWidth: 180,
  photoSide: 112,
  photoRadius: 6,
  dividerMarginY: 12,
  badgeRadius: 5,
  badgeMinHeight: 28,
  badgePaddingX: 8,
  badgePaddingY: 6,
  badgeIconSide: 16,
  locationIconSide: 18,
  sheetRadius: 20,
  sheetPadding: 16,
  sheetSectionGap: 16,
  handleWidth: 40,
  handleHeight: 4,
  categoryGridGap: 8,
  categoryControlMinHeight: 48,
  categoryControlPadding: 10,
  locationRowMinHeight: 64,
  applyMinHeight: 48,
  footerPadding: 16,
  touchMin: 44,
} as const;

type Weight = '400' | '700';

function sans(weight: Weight, fontSize: number, lineHeight: number): TextStyle {
  return CUSTOM_FONTS_INSTALLED
    ? {
        fontFamily: weight === '700' ? fontFace['sans-700'] : fontFace['sans-400'],
        fontSize,
        lineHeight,
      }
    : { fontWeight: weight, fontSize, lineHeight };
}

/** From this text scale the card's photo always stacks above the text. */
export const CARD_STACK_SCALE = 1.5;

/**
 * Whether the card's photo stacks above the text: at the accessibility text
 * sizes, or when the measured content row would leave the text column under
 * 180pt beside the photo. A row not yet measured (width 0) keeps the beside
 * layout.
 */
export function cardStacks(rowWidth: number, fontScale: number): boolean {
  if (fontScale >= CARD_STACK_SCALE) return true;
  if (rowWidth <= 0) return false;
  const beside = rowWidth - feedGeometry.photoSide - feedGeometry.cardColumnGap;
  return beside < feedGeometry.cardStackBelowWidth;
}

/**
 * The Feed search field's text: the 16pt body face WITHOUT a line height.
 * iOS offsets a TextInput's text inside a fixed line height, which at the
 * largest Dynamic Type sizes pushed the placeholder below the search glyph.
 */
export const feedInputType: TextStyle = CUSTOM_FONTS_INSTALLED
  ? { fontFamily: fontFace['sans-400'], fontSize: 16 }
  : { fontWeight: '400', fontSize: 16 };

/** The kit's type roles (`spec/design-tokens.json` → `type`). */
export const feedType = {
  heading: sans('700', 32, 38),
  sheetHeading: sans('700', 28, 34),
  section: sans('700', 20, 26),
  productTitle: sans('700', 20, 26),
  /** The Feed's own section heading row beside Filters (16/22 bold). */
  sectionRow: sans('700', 16, 22),
  body: sans('400', 16, 22),
  control: sans('700', 16, 22),
  meta: sans('400', 14, 20),
  metaStrong: sans('700', 14, 20),
  badge: sans('700', 12, 16),
} as const satisfies Record<string, TextStyle>;

export interface CategoryStyle {
  icon: IconName;
  background: HexColor;
  foreground: HexColor;
  border: HexColor;
  /** The lucide-static 0.468.0 source glyph the raster was rendered from. */
  sourceGlyph: string;
  /** Who set the colours: the source kit, or the founder directly (2026-10-06). */
  origin: 'kit' | 'founder';
}

/**
 * Every launch-visible category's label style, keyed by the stable id (the
 * label itself comes from domain/food-category.ts, never from here). The
 * kit specified eight; the app offers nine. Baby Food & Formula keeps its
 * place with a soft peach and the pinned `baby` glyph, both approved by the
 * founder on 2026-10-06 after the native review. Hidden ids
 * (Prepared Foods, Supplements, Other) have no style because no card or
 * filter shows them.
 */
export const CATEGORY_STYLE: Record<
  Exclude<FoodCategoryId, 'prepared_foods' | 'supplements' | 'other'>,
  CategoryStyle
> = {
  produce: {
    icon: 'category-produce',
    background: '#EFF7EC',
    foreground: '#24582D',
    border: '#A7CFA0',
    sourceGlyph: 'leaf',
    origin: 'kit',
  },
  meat_poultry: {
    icon: 'category-meat',
    background: '#FFF0F1',
    foreground: '#8B2532',
    border: '#DAA0A9',
    sourceGlyph: 'drumstick',
    origin: 'kit',
  },
  seafood: {
    icon: 'category-seafood',
    background: '#EBF5FF',
    foreground: '#174F7A',
    border: '#98BEE0',
    sourceGlyph: 'fish',
    origin: 'kit',
  },
  dairy_eggs: {
    icon: 'category-dairy',
    background: '#F2EDFF',
    foreground: '#482B7B',
    border: '#BDA6E3',
    sourceGlyph: 'milk',
    origin: 'kit',
  },
  bakery_grains: {
    icon: 'category-bakery',
    background: '#FFF5DF',
    foreground: '#805000',
    border: '#DDBA6C',
    sourceGlyph: 'sandwich',
    origin: 'kit',
  },
  snacks_sweets: {
    icon: 'category-snacks',
    background: '#FFF0F5',
    foreground: '#902944',
    border: '#DEA4B5',
    sourceGlyph: 'cookie',
    origin: 'kit',
  },
  beverages: {
    icon: 'category-beverages',
    background: '#E9F8F7',
    foreground: '#005E62',
    border: '#8ACCCC',
    sourceGlyph: 'cup-soda',
    origin: 'kit',
  },
  pantry_condiments: {
    icon: 'category-pantry',
    background: '#F7F0E6',
    foreground: '#6C471C',
    border: '#CFB18A',
    sourceGlyph: 'cylinder',
    origin: 'kit',
  },
  baby_food_formula: {
    icon: 'category-baby',
    background: '#FFF1E8',
    foreground: '#8A3A14',
    border: '#E6B092',
    sourceGlyph: 'baby',
    origin: 'founder',
  },
};

/** The style for a category id, or null for an id no card or filter shows. */
export function categoryStyle(id: FoodCategoryId | null): CategoryStyle | null {
  if (id === null) return null;
  return (CATEGORY_STYLE as Partial<Record<FoodCategoryId, CategoryStyle>>)[id] ?? null;
}

/** The interface glyphs' source names, for provenance tests. */
export const FEED_INTERFACE_GLYPHS: Record<'filters' | 'close' | 'tick' | 'categories', string> = {
  filters: 'sliders-horizontal',
  close: 'x',
  tick: 'check',
  categories: 'grid-2x2',
};

export const FEED_ICON_FAMILY = {
  library: 'lucide-static',
  version: '0.468.0',
  license: 'ISC',
  sourceDirectory: 'assets/icon-sources/lucide-static',
} as const;
