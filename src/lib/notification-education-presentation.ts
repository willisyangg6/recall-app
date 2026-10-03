/**
 * The notification education step's approved composition (2026-10-03): every
 * number the screen draws, measured on the founder-approved phone-led
 * reference and recorded in
 * assets/brand/reference/notifications-phone/lotly-notifications-phone-asset-report.json.
 * A leaf: no React, no I/O, so the whole layout is provable under Node.
 *
 * ## One scale
 *
 * The reference is 934 px wide (app content, no OS chrome). Everything is
 * drawn at one uniform scale, `ptPerPx(width)` = page width / 934: the hero,
 * the example inside its phone, and the vertical rhythm.
 *
 * ## What is native
 *
 * The hero (lotly-notifications-phone-scene.png) is decorative art whose
 * phone shows a BLANK notification card: the mock's printed icon, app name,
 * title and body were removed. They are drawn back natively in the card's
 * own perspective plane (`cardMatrix`), with the system font iOS uses for
 * notifications and the APPROVED iOS app icon. The example caption, the
 * `Subscription active` mark, the headline, body, reassurance and every
 * action are native page UI in Public Sans.
 *
 * ## Glyph sources
 *
 * `shield-check` is Lucide's `shield-check` (lucide-icons/lucide
 * f06ac67e33d645c40b8ce19a0419c85c5d7dd751, release 1.47.0, ISC), vendored
 * byte-identical under assets/icon-sources/lucide/ on 2026-10-03 and
 * rasterised by scripts/render-onboarding-assets.mjs at the set's box and
 * stroke. It marks the reassurance line the approved mock pairs it with; it
 * is not branding. The example icon (assets/onboarding/notifications/) is the
 * approved iOS icon (assets/brand/production/lotly-icon-ios-1024.png)
 * uniformly downscaled by the same script; no outline is added (founder
 * decision, 2026-10-03).
 */

import { typography } from '@/constants/design-tokens';

/** The approved reference's width, in pixels. */
export const REFERENCE_WIDTH = 934;

/** Points per reference pixel for a page `width` points wide. */
export function ptPerPx(width: number): number {
  return width / REFERENCE_WIDTH;
}

/** The production hero: reference rows 128–896 (end-exclusive), full width. */
export const HERO_PX = { top: 128, width: 934, height: 768 } as const;

export const NOTIFICATIONS_ICON_SOURCES = [
  { icon: 'shield-check', lucideName: 'shield-check' },
] as const;
export const NOTIFICATIONS_ICONS_VENDORED_ON = '2026-10-03';

// ── The page above the hero ─────────────────────────────────────────────────

/** The `Subscription active` mark's top-left corner, in reference px. */
export const BADGE_PX = { left: 45, top: 108 } as const;

/** Below this viewport height (points) the cream above the mark compresses. */
export const COMPACT_BELOW_HEIGHT = 700;
/** How much of that cream a compact screen keeps (Building's rule). */
export const COMPACT_TOP_FACTOR = 0.35;

/**
 * The cream above the mark, in points. On a short screen (an iPhone SE at
 * the default size) it is the nonessential gap that gives way first, never
 * the art.
 */
export function badgeTopGap(width: number, viewportHeight: number): number {
  const full = BADGE_PX.top * ptPerPx(width);
  return viewportHeight < COMPACT_BELOW_HEIGHT ? Math.round(full * COMPACT_TOP_FACTOR) : full;
}

/**
 * The hero is transparent under the mark: for a mark spanning reference x
 * 45…`right`, the first visible hero row (reference px) is `row`. Measured
 * on the production PNG's alpha; beyond the last entry the backdrop's top
 * edge (row 136) governs.
 */
export const BADGE_CLEARANCE: readonly { right: number; row: number }[] = [
  { right: 330, row: 191 },
  { right: 340, row: 189 },
  { right: 350, row: 185 },
  { right: 360, row: 182 },
  { right: 370, row: 179 },
  { right: 380, row: 176 },
  { right: 390, row: 172 },
  { right: 400, row: 169 },
  { right: 410, row: 166 },
  { right: 420, row: 164 },
];
const BACKDROP_TOP_ROW = 136;
/** The least cream kept between the mark and the art, in points. */
export const BADGE_ART_GAP = 2;

/** The first visible hero row (reference px) under a mark reaching `rightPx`. */
export function firstVisibleRowUnder(rightPx: number): number {
  for (const step of BADGE_CLEARANCE) if (rightPx <= step.right) return step.row;
  return BACKDROP_TOP_ROW;
}

/**
 * The hero's top, in points below the mark's top. By default the mark sits
 * over the hero's transparent top rows, exactly as in the mock (20 px apart).
 * When the mark is larger (a longer locale, a larger text size) the hero
 * moves down just enough that no art passes behind the mark.
 */
export function heroTopBelowBadge(
  width: number,
  badge: { width: number; height: number } | null,
): number {
  const s = ptPerPx(width);
  const overlapTop = (HERO_PX.top - BADGE_PX.top) * s;
  if (badge === null) return overlapTop;
  const rightPx = BADGE_PX.left + badge.width / s;
  const clearRow = firstVisibleRowUnder(rightPx);
  const needed = badge.height + BADGE_ART_GAP - (clearRow - HERO_PX.top) * s;
  return Math.max(overlapTop, needed);
}

// ── The example notification, in the phone's plane ──────────────────────────

/**
 * The card's own plane, in units (= reference px at the card centre): its
 * size and corner radius. Everything in `EXAMPLE_SLOTS` is in these units.
 */
export const CARD_PLANE = { width: 345.6, height: 168.95, radius: 20 } as const;

/**
 * The measured homography from the card plane (units) to HERO px, row-major
 * 3×3. Fitted to the card's four straight edges (residuals ≤ 0.6 px); the card
 * is in true perspective (its top and bottom edges differ by 1.1°, its sides
 * by 2°), so a rotation cannot place it.
 */
export const CARD_HOMOGRAPHY = [
  1.044830019, 0.08355882586, 130.82, -0.03829088384, 0.9747100688, 222.33, 0.0001155086282,
  -0.0001004711994, 1,
] as const;

/** Maps a card-plane point (units) to hero px. */
export function cardToHero(u: number, v: number): [number, number] {
  const h = CARD_HOMOGRAPHY;
  const w = h[6] * u + h[7] * v + h[8];
  return [(h[0] * u + h[1] * v + h[2]) / w, (h[3] * u + h[4] * v + h[5]) / w];
}

/**
 * The 4×4 transform (column-major, React Native's `matrix`) that places a
 * view laid out in POINTS at `units × s` onto the hero drawn `width` points
 * wide, about its top-left corner: S(s)·H·S(1/s), so translation scales by s
 * and the two perspective terms by 1/s.
 */
export function cardMatrix(width: number): number[] {
  const s = ptPerPx(width);
  const h = CARD_HOMOGRAPHY;
  return [
    h[0],
    h[3],
    0,
    h[6] / s,
    h[1],
    h[4],
    0,
    h[7] / s,
    0,
    0,
    1,
    0,
    h[2] * s,
    h[5] * s,
    0,
    h[8],
  ];
}

/** iOS notification text metrics (SF Pro, hhea, per em). */
const SF_ASCENT = 0.952;
const SF_DESCENT = 0.241;

/**
 * A baseline's distance below the top of a `lineHeight` line box set in SF
 * (the system font): the same rule `baselineInLine` measured for Public Sans
 * on the Simulator, with SF's metrics.
 */
export function systemBaselineInLine(fontSize: number, lineHeight: number): number {
  const natural = fontSize * (SF_ASCENT + SF_DESCENT);
  if (lineHeight < natural) return lineHeight - fontSize * SF_DESCENT;
  return (lineHeight - natural) / 2 + fontSize * SF_ASCENT;
}

/**
 * The example's slots, in card-plane units, measured on the rectified card
 * and fitted with SF (asset report, phonePlane.slots_cardPlaneUnits). Sizes
 * follow the art, never Dynamic Type: at 402pt the title is ≈10pt.
 */
export const EXAMPLE_SLOTS = {
  icon: { centre: [50, 63.75], side: 78, radius: 17.45 },
  textLeft: 104,
  textRight: 332,
  /**
   * iOS sets the system font this small (≈10pt at 402) in its Text optical
   * size, tracked looser than the mock's lettering: measured on the
   * Simulator (2026-10-03), `Lotly` drew 50.5 units wide against the mock's
   * 43.75. At −0.09em every line returns to the mock's width (device vs mock,
   * units: `Lotly` 42.8/43.75, `Recall alert: Glutinous` 210.8/210.25,
   * `Undeclared peanut allergen.` 215.5/219.25, `Check your package.`
   * 161.3/163.5), wrapping where the mock does.
   */
  tracking: -0.09,
  label: { fontSize: 22, weight: '500', baseline: 42.0 },
  title: { fontSize: 23.5, weight: '600', lineHeight: 25.3, baseline: 73.6 },
  body: { fontSize: 18.8, weight: '400', lineHeight: 22.1, baseline: 124.8 },
} as const;

// ── The page below the hero ─────────────────────────────────────────────────

/**
 * The example caption: centred under the PHONE (the mock caption's ink centre
 * x 353), not the page, on the hero's ground-shadow rows, baseline at
 * reference row 868. Its box spans x 201–505: up to the first pea.
 */
export const CAPTION_PX = { centreX: 353, baseline: 868, left: 201, right: 505 } as const;

/** The screen's own type: Public Sans 700 (`display`'s face), in points. */
export const HEADLINE_TYPE = { fontSize: 36, lineHeight: 36 } as const;

/** From this text scale (iOS's accessibility sizes, the app's shared threshold). */
export const ACCESSIBILITY_SCALE = 1.5;

/**
 * The headline's base size: 36/36 by default, `heading-2` at the
 * accessibility sizes (an adaptive base, never a cap), as Building, so no
 * word ever breaks across lines.
 */
export function headlineType(fontScale: number): { fontSize: number; lineHeight: number } {
  if (fontScale < ACCESSIBILITY_SCALE) return HEADLINE_TYPE;
  const token = typography['heading-2'];
  return { fontSize: token.fontSize, lineHeight: token.lineHeight };
}

/**
 * The headline column at the default text size, in points: wider than `Let
 * the alerts` (≈232pt in the mock) and narrower than `Let the alerts come`
 * (≈330pt), so it breaks where the mock does. Scales with the text size.
 */
export const HEADLINE_MEASURE = 285;

/**
 * The primary action's widest word, `notifications`, in ems of Public Sans
 * 600 (the 51pt pill's label face).
 */
export const WIDEST_CTA_WORD_EM = 5.866;

/**
 * The primary label's base size at a text scale, for a label `column`
 * points wide: the pill's own 16pt until the widest word would not fit with
 * 5% to spare, then `body-small-bold`'s 13pt — an adaptive base, never a cap
 * (Building's rule). Measured on the Simulator (2026-10-03): at AX5 on an SE
 * `notifications` at 16pt (335pt) broke as `notification|s` in the 311pt
 * label; at 13pt it is 272pt.
 */
export function ctaLabelType(
  fontScale: number,
  column: number,
): { fontSize: number; lineHeight: number } | null {
  if (WIDEST_CTA_WORD_EM * 16 * fontScale <= column * 0.95) return null;
  const token = typography['body-small-bold'];
  return { fontSize: token.fontSize, lineHeight: token.lineHeight };
}

/**
 * The body column at the default text size, in points: wider than `New
 * recalls and important updates,` (≈271pt in the mock) and narrower than
 * that line plus `matched`, so it breaks after `updates,` as the mock does.
 * Scales with the text size.
 */
export const BODY_MEASURE = 300;

/**
 * The vertical rhythm, in reference px, measured on the reference: the
 * headline's baselines (1015, 1100), the body's (1174, 1231), the
 * reassurance row's centre (1305).
 */
export const RHYTHM_PX = {
  headlineBaseline: 1015,
  headlineToBodyBaseline: 1174 - 1100,
  bodyToReassuranceCentre: 1305 - 1231,
} as const;
