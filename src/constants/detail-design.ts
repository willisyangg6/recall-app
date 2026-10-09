/**
 * The Recall Detail design (2026-10-07): the approved header, sections,
 * Health Risk symptoms and affected-product cards, from the source kit in
 * docs/lotly-recall-detail-source-kit/ (`spec/design-tokens.json` and
 * `spec/COMPONENT-CONTRACT.md` are the authority for every number here).
 *
 * ## Why a scoped module
 *
 * The same reason as `feed-design.ts`: the app-wide scale in
 * design-tokens.ts is pinned to DESIGN.md's front matter and shared with
 * screens this milestone must not change. The kit's Detail sizes (a 28/34
 * title, 24/30 section headings, 18/24 subheadings and card titles, 16/23
 * body, 14/20 metadata) are declared here, for Recall Detail only, over the
 * SAME loaded Public Sans faces. Nothing here recolours a global token: every
 * colour below is an existing token's value except the symptom bubble, which
 * is this screen's own mark. Risk and illness labels keep the integrated
 * palette (the kit's Critical white-on-red is not approved globally).
 */

import type { TextStyle } from 'react-native';

import { color, CUSTOM_FONTS_INSTALLED, fontFace } from '@/constants/design-tokens';

export const detailColor = {
  page: color['background/page'],
  surface: color['background/surface'],
  text: color['text/primary'],
  secondary: color['text/secondary'],
  /** The app's own link colour; the kit's slightly brighter blue is not
   * adopted, so Detail's links match every other link in the app. */
  link: color['action/secondary'],
  border: color['border/default'],
  divider: color['border/subtle'],
  /** The neutral pale-blue disc behind each symptom glyph — decoration, never
   * a severity or a surface for text (14.95:1 against the navy glyph). */
  symptomBubble: '#EDF4FA',
  mediaSurface: color['background/media-placeholder'],
} as const;

export const detailGeometry = {
  pageGutter: 20,
  sectionGap: 24,
  sectionDividerMargin: 20,
  bodyGap: 12,
  fieldGap: 10,
  inlineGap: 8,
  touchMin: 44,
  headerPhotoWidth: 112,
  headerPhotoHeight: 144,
  headerPhotoRadius: 10,
  productCardRadius: 12,
  productCardPadding: 14,
  productThumbnail: 64,
  symptomBubble: 36,
  symptomGlyph: 22,
  interfaceGlyph: 24,
  fieldLabelWidth: 104,
  fieldColumnGap: 12,
  dividerWidth: 1,
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

/** The kit's type roles (`spec/design-tokens.json` → `type`). */
export const detailType = {
  productTitle: sans('700', 28, 34),
  section: sans('700', 24, 30),
  symptomSubheading: sans('700', 18, 24),
  productCardTitle: sans('700', 18, 24),
  body: sans('400', 16, 23),
  metadata: sans('400', 14, 20),
  /** The small organism label in a multi-hazard Health Risk (decision E). */
  metadataStrong: sans('700', 14, 20),
  action: sans('400', 16, 22),
} as const satisfies Record<string, TextStyle>;

/**
 * From this text scale — the accessibility sizes, the same threshold as the
 * Feed card's `CARD_STACK_SCALE` — the header photo sits beneath the identity,
 * the title is shown complete, a card's image sits above its name, and every
 * card field stacks its label above its values, so no word is ever broken to
 * fit a side-by-side column. Below it, a narrow measured column stacks too.
 */
export const DETAIL_STACK_SCALE = 1.5;

/** Below this value-column width (pt) a field label stacks above its values. */
export const FIELD_VALUE_MIN_WIDTH = 140;

/** Whether one card field stacks its label above its values. */
export function fieldStacks(cardContentWidth: number, fontScale: number): boolean {
  if (fontScale >= DETAIL_STACK_SCALE) return true;
  if (cardContentWidth <= 0) return false;
  const valueWidth =
    cardContentWidth - detailGeometry.fieldLabelWidth - detailGeometry.fieldColumnGap;
  return valueWidth < FIELD_VALUE_MIN_WIDTH;
}
