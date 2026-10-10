/**
 * The risk and harm label design (2026-10-09): the founder-approved source
 * kit in docs/lotly-risk-illness-labels-source-kit/ (`spec/design-tokens.json`
 * and `spec/COMPONENT-CONTRACT.md` are the authority for every number here).
 *
 * ## Why a scoped module
 *
 * The kit's label shape — radius 5, at least 28pt tall, 8/6 padding, a 16pt
 * glyph 6pt from its words, 12/16 bold and 13/18 semibold Public Sans — sits
 * off the app-wide scale that design-tokens.ts pins to DESIGN.md's front
 * matter, exactly as the Feed kit's did. So, like constants/feed-design.ts,
 * it is declared here, over the SAME loaded Public Sans faces, for the risk
 * label, the Public Health Alert label and the harm notices only. The
 * colours are semantic tokens and stay in design-tokens.ts.
 *
 * The risk label's shape is the Feed card's badge shape (`feedGeometry`), so
 * a risk label, the Affects You flag and a category label beside it line up;
 * `label-design.test.ts` pins the two equal.
 */

import type { TextStyle } from 'react-native';

import type { IconName } from '@/components/ui/icon';
import { CUSTOM_FONTS_INSTALLED, fontFace } from '@/constants/design-tokens';
import type { HarmNoticeTone } from '@/domain/illness-status';

export const labelGeometry = {
  radius: 5,
  minHeight: 28,
  paddingX: 8,
  paddingY: 6,
  iconSide: 16,
  iconGap: 6,
  /** Between stacked harm notices. */
  rowGap: 8,
  /**
   * Risk labels draw a 1pt border in their own fill colour — invisible, and
   * it keeps them the same height as the bordered Affects You and category
   * labels sharing their row. The harm notices draw none.
   */
  riskBorderWidth: 1,
  harmBorderWidth: 0,
  /** The Public Health Alert's visible 1pt blue border. */
  noticeBorderWidth: 1,
} as const;

function sans(face: 'sans-600' | 'sans-700', fontSize: number, lineHeight: number): TextStyle {
  return CUSTOM_FONTS_INSTALLED
    ? { fontFamily: fontFace[face], fontSize, lineHeight }
    : { fontWeight: face === 'sans-700' ? '700' : '600', fontSize, lineHeight };
}

/** The harm notice's line height, which its glyph box matches. */
export const HARM_LINE_HEIGHT = 18;

/** The kit's type roles (`spec/design-tokens.json` → `type`). */
export const labelType = {
  /** Risk tiers and the Public Health Alert: 12/16 bold, shown uppercase. */
  badge: sans('sans-700', 12, 16),
  /** Harm notices: 13/18 semibold, sentence case. */
  harm: sans('sans-600', 13, HARM_LINE_HEIGHT),
} as const satisfies Record<string, TextStyle>;

/**
 * One glyph per harm, each the kit's pinned lucide-static 0.468.0 source at
 * stroke 2: an explicit denial is information, a reported illness a warning,
 * a hospitalization a medical plus, a death an exclamation in a circle.
 */
export const HARM_GLYPH: Record<HarmNoticeTone, IconName> = {
  none: 'label-info',
  illnesses: 'label-triangle-alert',
  hospitalizations: 'label-square-plus',
  deaths: 'label-circle-alert',
};

/** The Public Health Alert label's glyph. */
export const NOTICE_GLYPH: IconName = 'label-info';

/** Each label glyph's lucide-static 0.468.0 source name, for provenance tests. */
export const LABEL_GLYPH_SOURCE: Record<
  'label-info' | 'label-triangle-alert' | 'label-square-plus' | 'label-circle-alert',
  string
> = {
  'label-info': 'info',
  'label-triangle-alert': 'triangle-alert',
  'label-square-plus': 'square-plus',
  'label-circle-alert': 'circle-alert',
};
