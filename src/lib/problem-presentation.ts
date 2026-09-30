/**
 * The problem screens' presentation rules (2026-09-28): the approved
 * statistic compositions — the six-person pictograph on Problem Scale and
 * the four editorial household rows on Problem Risk — as deterministic,
 * React-Native-free rules the components read and the tests pin.
 *
 * ## The two compositions
 *
 * Problem Scale leads with `1 in 6` in the `stat` type, then the factual
 * headline, the 48-million line, and the authored one-in-six pictograph —
 * ONE approved production image of six full-body figures, one lime with
 * three emphasis rays, five pale blue (2026-09-29; the glyph-assembled
 * placeholder it replaced is retired).
 *
 * Problem Risk (2026-09-29, the approved risk-row target, superseding the
 * 2×2 grid) shows the CDC's four higher-risk groups as four vertical
 * editorial rows: the approved production illustration on the left
 * (lib/statistics-assets.ts), the group name as live `heading-3` text on
 * the right, a `border/subtle` hairline between rows — transparent rows,
 * no pill, card, panel or added surface; the illustrations carry their own
 * pale-blue backplates.
 *
 * ## Size classes
 *
 * Standard layouts fit the iPhone SE and taller phones without scrolling at
 * default text size; the SE class (window height under
 * `PROBLEM_COMPACT_BELOW_HEIGHT`) takes the compact sizes. From the first
 * accessibility text-size class (`PROBLEM_ACCESSIBLE_AT_SCALE`, the
 * paywall's and Ready's own threshold) both screens yield to an accessible
 * layout: text is never capped, content scrolls, Problem Scale keeps all
 * six figures at a smaller size, and Problem Risk keeps its rows, moving an
 * illustration above its label only where the label's longest word could
 * not otherwise fit beside it.
 */

import { hitTarget, spacing, typography } from '@/constants/design-tokens';
import { PROBLEM_RISK_GROUPS } from '@/lib/onboarding-copy';

// ── Shared ──────────────────────────────────────────────────────────────────

/**
 * The first accessibility text-size class: iOS's AX1 is ≈1.64, the largest
 * non-AX class ≈1.35, so 1.5 splits them — the same threshold
 * `INLINE_FOOTER_AT_SCALE` and `READY_MASCOT_COMPACT_AT_SCALE` use.
 */
export const PROBLEM_ACCESSIBLE_AT_SCALE = 1.5;

export type ProblemLayout = 'standard' | 'accessible';

export function problemLayout(fontScale: number): ProblemLayout {
  return fontScale >= PROBLEM_ACCESSIBLE_AT_SCALE ? 'accessible' : 'standard';
}

/**
 * The SE class: below this window height the standard compositions take
 * their compact sizes, so both screens fit unscrolled on the smallest
 * supported phone (the SE's 667pt window) at default text size.
 */
export const PROBLEM_COMPACT_BELOW_HEIGHT = 700;

// ── Problem Scale: the authored one-in-six pictograph ───────────────────────

/**
 * The pictograph is ONE authored production image (2026-09-29;
 * `statistics-one-in-six-figures-1024.png`, mapped in
 * lib/statistics-assets.ts): six full-body figures in the approved 3×2
 * arrangement, one lime with its three emphasis rays, five pale blue —
 * drawn by the artwork itself, never assembled from glyphs. The square
 * canvas carries its own transparent margins (the solid artwork spans
 * 765×783 of 1024 — the production report's solid bounds), the screen
 * shows the COMPLETE canvas with `contain`, and the box below is the
 * canvas side, so the visible artwork is about three quarters of it.
 */
export const SCALE_PICTOGRAPH_MAX = 320;
/** The SE's canvas box: the composition fits inside 667pt unscrolled. */
export const SCALE_PICTOGRAPH_COMPACT = 216;
/** The accessible layout's canvas box: all six figures stay visible. */
export const SCALE_PICTOGRAPH_ACCESSIBLE = 220;

/** The pictograph canvas side: square, whole, never wider than the page. */
export function scalePictographSize(
  contentWidth: number,
  windowHeight: number,
  fontScale: number,
): number {
  if (problemLayout(fontScale) === 'accessible') {
    return Math.min(contentWidth, SCALE_PICTOGRAPH_ACCESSIBLE);
  }
  const cap =
    windowHeight < PROBLEM_COMPACT_BELOW_HEIGHT ? SCALE_PICTOGRAPH_COMPACT : SCALE_PICTOGRAPH_MAX;
  return Math.min(contentWidth, cap);
}

// ── Problem Risk: the four groups ───────────────────────────────────────────

/** The four groups' semantic ids, in the approved reading order. */
export const PROBLEM_RISK_GROUP_IDS = [
  'young-children',
  'pregnant-people',
  'adults-65-plus',
  'weakened-immune-systems',
] as const;

export type ProblemRiskGroupId = (typeof PROBLEM_RISK_GROUP_IDS)[number];

/**
 * Each group's id paired with its exact founder-approved label — the same
 * strings `PROBLEM_RISK_GROUPS` holds, in the same order, so the rendered
 * labels can never drift from the copy contract.
 */
export const PROBLEM_RISK_GROUP_ROWS: readonly { id: ProblemRiskGroupId; label: string }[] =
  PROBLEM_RISK_GROUP_IDS.map((id, index) => ({ id, label: PROBLEM_RISK_GROUPS[index] }));

// ── Problem Risk: the editorial rows ────────────────────────────────────────

/**
 * The lowest and highest solid artwork rows across the four production
 * illustrations, as fractions of the canvas: 176 (adults 65+) and 869
 * (pregnant people) of 1024 — statistics-production-asset-report.json,
 * solidArtworkBounds, pinned against the files by statistics-assets.test.ts.
 * The transparent bands outside them are dead space `contain` would keep.
 */
export const RISK_ART_TOP = 176 / 1024;
export const RISK_ART_BOTTOM = 869 / 1024;

/**
 * How far an illustration's box overlaps its own transparent top and bottom
 * margins, so a row is as tall as the visible artwork rather than the square
 * canvas. Floors, so no solid pixel is ever cut; nothing is cropped — the
 * whole canvas still draws, and only transparent pixels overhang the row.
 */
export function riskArtTrim(size: number): { top: number; bottom: number } {
  return { top: Math.floor(size * RISK_ART_TOP), bottom: Math.floor(size * (1 - RISK_ART_BOTTOM)) };
}

/** The illustration's height in the row once its transparent bands overlap. */
export function riskArtVisibleHeight(size: number): number {
  const trim = riskArtTrim(size);
  return size - trim.top - trim.bottom;
}

/** The label type: the closest bold reading-size token to the target's labels. */
export const RISK_LABEL_VARIANT = 'heading-3' as const;
/**
 * `Weakened immune systems`, the widest label, and `Weakened`, the widest
 * word, measured in `heading-3` (Public Sans SemiBold 19) with the vendored
 * font itself. The target sets the labels on ONE line at default size.
 */
export const RISK_LABEL_WIDEST = 248.4;
export const RISK_LABEL_WIDEST_WORD = 93.4;
/** Room kept beyond a measured width, for the device's own text layout. */
export const RISK_LABEL_FIT_MARGIN = 4;

/** From the illustration's box to its label. */
export const RISK_ROW_ART_GAP = spacing[12];
/** Added above the list: the frame's 16pt gap plus this is the body-to-list space. */
export const RISK_LIST_TOP = spacing[8];
/** Row padding, the roomier first, where the height allows it. */
export const RISK_ROW_PADDINGS = [spacing[12], spacing[8]] as const;
/** The hairline between rows (`border/subtle`), never after the last. */
export const RISK_SEPARATOR = 1;

/** The illustration box's bounds at ordinary text sizes. */
export const RISK_ROW_ART_MAX = 112;
export const RISK_ROW_ART_MIN = 64;
/**
 * At accessibility text sizes an illustration beside its label never drops
 * below this; where the label's longest word would need more room than that
 * leaves, the illustration moves above the label inside the same row.
 */
export const RISK_ROW_ART_ACCESSIBLE_MIN = 56;

/**
 * The frame's fixed chrome around the scroll content (onboarding-frame.tsx):
 * the top bar (8 + a 44pt back control) and the 6pt progress mark with its
 * 8pt row; the footer's hairline, 12pt padding, the 44pt action and 12pt
 * padding; the content's 8pt top and 24pt bottom padding. Safe-area insets
 * are added by the caller.
 */
export const RISK_FRAME_CHROME =
  spacing[8] +
  hitTarget.minimum +
  6 +
  spacing[8] +
  (1 + spacing[12] + hitTarget.minimum + spacing[12]) +
  (spacing[8] + spacing[24]);
/**
 * The heading and body at default text size: two 34pt `heading-1` lines,
 * the 8pt heading gap and two 24pt `body` lines — measured on both the
 * iPhone 17 and the SE, whose content widths set both in two lines.
 */
export const RISK_TEXT_BLOCK =
  2 * typography['heading-1'].lineHeight + spacing[8] + 2 * typography.body.lineHeight;
/** The source line and the frame gaps around the list. */
const RISK_LIST_SURROUND =
  spacing[16] + RISK_LIST_TOP + spacing[16] + typography['body-small'].lineHeight;

export interface RiskWindow {
  contentWidth: number;
  windowHeight: number;
  insetTop: number;
  insetBottom: number;
  fontScale: number;
}

/**
 * The height the four rows may take at DEFAULT text size before Source would
 * be pushed under the footer. Larger text keeps the default-size artwork and
 * scrolls; the illustration never shrinks because the reader's text grew.
 */
export function riskListBudget({ windowHeight, insetTop, insetBottom }: RiskWindow): number {
  return (
    windowHeight - insetTop - insetBottom - RISK_FRAME_CHROME - RISK_TEXT_BLOCK - RISK_LIST_SURROUND
  );
}

/** Four rows, their padding and the three separators, at default text size. */
export function riskListHeight(art: number, padding: number): number {
  const content = Math.max(riskArtVisibleHeight(art), typography[RISK_LABEL_VARIANT].lineHeight);
  return (
    PROBLEM_RISK_GROUP_IDS.length * (content + 2 * padding) +
    (PROBLEM_RISK_GROUP_IDS.length - 1) * RISK_SEPARATOR
  );
}

export interface RiskRowLayout {
  /** The illustration box side; every row shares it. */
  art: number;
  trimTop: number;
  trimBottom: number;
  padding: number;
  /** `beside`: illustration left, label right. `above`: see RISK_ROW_ART_ACCESSIBLE_MIN. */
  arrangement: 'beside' | 'above';
}

/** The largest box that keeps the widest label on one line at default size. */
function defaultArtCap(contentWidth: number): number {
  const widthFit = Math.floor(
    contentWidth - RISK_ROW_ART_GAP - Math.ceil(RISK_LABEL_WIDEST) - RISK_LABEL_FIT_MARGIN,
  );
  return Math.min(RISK_ROW_ART_MAX, widthFit);
}

/**
 * The rows' geometry, from the measured width, height and insets — never a
 * device name. At ordinary text sizes: the largest illustration that keeps
 * every label on one line, then the roomiest padding the height allows,
 * shrinking the illustration toward RISK_ROW_ART_MIN only if even the
 * tighter padding cannot fit; the leftover falls between the last row and
 * Source. At accessibility sizes: the same illustration while the longest
 * word fits beside it, less (to RISK_ROW_ART_ACCESSIBLE_MIN) where it
 * does not, and above the label only past that.
 */
export function riskRowLayout(window: RiskWindow): RiskRowLayout {
  const cap = Math.max(RISK_ROW_ART_MIN, defaultArtCap(window.contentWidth));
  const shape = (art: number, padding: number, arrangement: RiskRowLayout['arrangement']) => {
    const trim = riskArtTrim(art);
    return { art, trimTop: trim.top, trimBottom: trim.bottom, padding, arrangement };
  };
  if (problemLayout(window.fontScale) === 'accessible') {
    const wordRoom =
      window.contentWidth -
      RISK_ROW_ART_GAP -
      Math.ceil(RISK_LABEL_WIDEST_WORD * window.fontScale) -
      RISK_LABEL_FIT_MARGIN;
    const beside = Math.min(cap, Math.floor(wordRoom));
    return beside >= RISK_ROW_ART_ACCESSIBLE_MIN
      ? shape(beside, spacing[8], 'beside')
      : shape(cap, spacing[8], 'above');
  }
  const budget = riskListBudget(window);
  for (const padding of RISK_ROW_PADDINGS) {
    if (riskListHeight(cap, padding) <= budget) return shape(cap, padding, 'beside');
  }
  const tight = RISK_ROW_PADDINGS[RISK_ROW_PADDINGS.length - 1];
  for (let art = cap - 1; art > RISK_ROW_ART_MIN; art--) {
    if (riskListHeight(art, tight) <= budget) return shape(art, tight, 'beside');
  }
  return shape(RISK_ROW_ART_MIN, tight, 'beside');
}

/** Hairlines only BETWEEN rows. */
export function riskRowHasSeparator(index: number): boolean {
  return index < PROBLEM_RISK_GROUP_IDS.length - 1;
}
