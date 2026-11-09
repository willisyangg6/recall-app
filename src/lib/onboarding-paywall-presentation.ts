/**
 * The paywall's presentation (the Fridge Note paywall, 2026-11-06): its
 * approved copy, how the supplied stationery artwork and the native letter
 * are sized and placed, and the type of every native word. Numbers, copy and
 * pure functions only, so all of it is testable under Node; the component
 * (components/paywall/onboarding-paywall-panel.tsx) maps it onto React
 * Native. A leaf.
 *
 * Both paywall routes draw it: `/onboarding/paywall` from Ready, and the
 * standalone `/paywall` a lapsed subscriber meets. The shared state rules
 * (notices, CTA, footer placement, the offer) stay in lib/paywall-screen.ts.
 *
 * ## The approved target
 *
 * Direction #2 of the lifetime-paywall kit (founder-selected 2026-11-06,
 * with only its sign-off replaced by the handwritten signature):
 * `reference/final-direction-02-signature.png`, 851×1848, a 402pt-wide
 * iPhone screen at 2.117 px/pt. Every number below was measured from its
 * pixels and checked against simulator captures of this screen. Where the
 * kit's LAYOUT-SPEC starting measurement and the target disagree, the
 * target wins and the difference is named.
 *
 * ## The stationery
 *
 * One RGBA image (assets/paywall/fridge-note/fridge-note-backdrop.png,
 * 1254×1254) holds the hanging mascot, the lime magnet, the powder-blue
 * wavy backing, the paper with its curl and the shadow — and no words. In
 * the target it is drawn 863px wide on an 851px screen, centred: 1.4% wider
 * than the page, its transparent margins running off both edges. Only its
 * blank middle band (32%–76% of its height) stretches, vertically, when the
 * letter needs more room than the square gives it; the mascot and magnet
 * band above and the curl band below keep the image's own scale, so nothing
 * recognisable is ever distorted. In the target the middle is already
 * stretched by 16pt at 402pt. Since the shorter letter (2026-11-07) it may
 * also COMPRESS, down to `MIN_MIDDLE_FRACTION` of its source height, so the
 * paper ends just below the signature instead of leaving blank paper.
 *
 * ## The letter
 *
 * Native, horizontal and left-aligned: the paper's irregular silhouette
 * makes the tilt, never a rotated container. Public Sans Regular 14pt on
 * the target's measured 17.8pt pitch (the kit's spec said 18.6) with 9pt
 * between paragraphs; the signature follows the last line directly, as in
 * the target, where its box starts 3pt below the last baseline. The text
 * column starts 16.5% of the page width in from the left and stops 8% from
 * the right; from the accessibility sizes it widens to 13% on the left.
 * `people you love.` is underlined by the kit's lime stroke (or the native
 * lime underline when the phrase wraps). The handwritten signature is an image spoken as `Willis`,
 * sized from the target's ink (110pt wide), and is the only sign-off: no
 * printed name, no heart.
 */

import { typography } from '@/constants/design-tokens';

// ── Copy (founder-approved; the shorter letter, revision 2, 2026-11-07) ─────

export const ONBOARDING_PAYWALL_HEADLINE = 'A note from me.';

/** The letter's first paragraph. No greeting precedes it (revision 2). */
export const LETTER_OPENING =
  'Life is busy. Keeping up with food recalls shouldn’t be another thing on your plate.';

/**
 * The second paragraph, split where the underlined emphasis begins so the
 * component can nest it; joined, it is the approved sentence exactly.
 */
export const LETTER_EMPHASIS_PARAGRAPH = {
  lead: 'I built Lotly to make staying informed easier, so you can make safer choices for yourself and the ',
  emphasis: 'people you love.',
} as const;

/** The last paragraph; the handwritten signature follows it, nothing else. */
export const LETTER_CLOSING =
  'Your one-time purchase gives you lifetime access and helps me keep Lotly running as a solo founder.';

/** The handwritten signature's spoken name. */
export const SIGNATURE_ACCESSIBILITY_LABEL = 'Willis';

export interface PaywallBenefit {
  /** A glyph of the app's icon set (components/ui/icon.tsx). */
  icon: 'file-search' | 'bell';
  title: string;
  body: string;
}

export const ONBOARDING_PAYWALL_BENEFITS: readonly PaywallBenefit[] = [
  {
    icon: 'file-search',
    title: 'Know what may affect you',
    body: 'Official FDA & USDA notices, personalized.',
  },
  {
    icon: 'bell',
    title: 'Let the alerts come to you',
    body: 'Matching recalls and important updates.',
  },
];

// ── The glyphs this screen adds to the icon set ─────────────────────────────

/**
 * The benefit glyphs (2026-10-01, kept for this design): `file-search` is
 * Lucide's `file-search-corner` and `bell` is Lucide's `bell`, both
 * byte-identical to lucide-icons/lucide at the allergen set's pinned commit
 * `f06ac67e…` (release 1.47.0, ISC; lib/allergen-icons.ts), vendored in
 * assets/icon-sources/lucide/ and rasterised natively by
 * scripts/render-onboarding-assets.mjs. The kit's copies of the two rasters
 * are byte-identical to the app's. allergen-icons.test.ts pins the sources.
 */
export const PAYWALL_ICON_SOURCES = [
  { icon: 'file-search', lucideName: 'file-search-corner' },
  { icon: 'bell', lucideName: 'bell' },
] as const;
export const PAYWALL_ICONS_VENDORED_ON = '2026-10-01';

// ── The native type ─────────────────────────────────────────────────────────

/** The screen's own text sizes and leading, in points (measured; see above). */
export const PAYWALL_TYPE = {
  headline: { fontSize: 30, lineHeight: 36 },
  letter: { fontSize: 14, lineHeight: 17.8 },
  benefitTitle: { fontSize: 16, lineHeight: 21 },
  benefitBody: { fontSize: 13, lineHeight: 18 },
  offerTitle: { fontSize: 21, lineHeight: 27 },
  offerSubtitle: { fontSize: 13, lineHeight: 19 },
  price: { fontSize: 24, lineHeight: 29 },
  /** The 51pt pill's label: the target's 17pt semibold. */
  cta: { fontSize: 17, lineHeight: 22 },
} as const;
// The target’s links and independence line (10–12pt) keep the
// shared `caption` (12pt) instead: nothing on the paywall is smaller than
// the rest of the app (the floor the grocery-watch paywall set, 2026-10-01).

/** From this text scale the screen takes its accessibility layout. */
export const ACCESSIBILITY_SCALE = 1.5;

export function atAccessibilitySize(fontScale: number): boolean {
  return fontScale >= ACCESSIBILITY_SCALE;
}

/**
 * The headline's base size and leading. From the accessibility sizes it
 * takes the shared `heading-1` base (still scaled by the reader's setting).
 */
export function headlineType(fontScale: number): { fontSize: number; lineHeight: number } {
  return atAccessibilitySize(fontScale)
    ? {
        fontSize: typography['heading-1'].fontSize,
        lineHeight: typography['heading-1'].lineHeight,
      }
    : PAYWALL_TYPE.headline;
}

/**
 * The font's descent (Public Sans: −450 on a 2000 unit em): iOS keeps it at
 * the bottom of each line box, so a block's last baseline sits this
 * fraction of the size above the block's bottom edge.
 */
export const PUBLIC_SANS_DESCENT = 0.225;

/**
 * How far the stage is drawn up under the headline, in points: the target's
 * artwork top sits 3pt below the headline's baseline, and the headline
 * block ends `PUBLIC_SANS_DESCENT × size` below its baseline.
 */
export function stageOverlap(fontScale: number): number {
  const { fontSize } = headlineType(fontScale);
  return fontScale * PUBLIC_SANS_DESCENT * fontSize - 3;
}

// ── The stationery (measured from the target and the 1254px artwork) ───────

/** How much wider than the page the artwork is drawn (863px on 851px). */
export const BACKDROP_WIDTH_RATIO = 863 / 851;

/**
 * The artwork's three vertical bands, as fractions of its height: the
 * mascot and magnet above `top`, the curl and shadow below `bottom`. Only
 * the blank paper between them ever stretches.
 */
export const BACKDROP_BANDS = { top: 0.32, bottom: 0.76 } as const;

export interface BackdropSlice {
  /** Where the slice's clip sits in the stage, from its top. */
  offset: number;
  /** The clip's height. */
  height: number;
  /** Where the whole image is drawn inside the clip, from the clip's top. */
  imageTop: number;
  /** The whole image's drawn height (its width is the artwork's). */
  imageHeight: number;
}

/**
 * The shortest the blank middle band is ever drawn, as a fraction of its
 * source height: enough paper that the backing's wavy edges read as the
 * same shapes, squashed no further than half (checked on the simulators).
 */
export const MIN_MIDDLE_FRACTION = 0.5;

/**
 * The three clipped draws of the one image, in points, for artwork `width`
 * wide and the letter's `height`. The middle band is the same band of the
 * source drawn taller or shorter (never below `MIN_MIDDLE_FRACTION`); the
 * others keep the source's own scale, so their seams meet the middle's edges
 * exactly.
 */
export function backdropSlices(
  width: number,
  height: number,
): { height: number; slices: [BackdropSlice, BackdropSlice, BackdropSlice] } {
  const top = width * BACKDROP_BANDS.top;
  const bottom = width * (1 - BACKDROP_BANDS.bottom);
  const minimum = top + bottom + MIN_MIDDLE_FRACTION * (width - top - bottom);
  const drawn = Math.max(minimum, height);
  const middle = drawn - top - bottom;
  const stretch = middle / (width - top - bottom);
  return {
    height: drawn,
    slices: [
      { offset: 0, height: top, imageTop: 0, imageHeight: width },
      {
        offset: top,
        height: middle,
        imageTop: -top * stretch,
        imageHeight: width * stretch,
      },
      { offset: drawn - bottom, height: bottom, imageTop: -(width - bottom), imageHeight: width },
    ],
  };
}

/**
 * Where the letter sits. `top` and `bottom` are fractions of the artwork's
 * drawn width (below the mascot and magnet, clear of the curl); `left` and
 * `right` are fractions of the PAGE width (the kit's spec, which the
 * target's lines bear out).
 */
export const LETTER_INSETS = {
  /**
   * From the artwork's top to the first line box: below the mascot's leg
   * (revision 2 has no indented greeting to step around it; 0.222 before).
   */
  top: 0.255,
  /** From the signature's box to the artwork's bottom edge. */
  bottom: 0.098,
  left: 0.165,
  leftAtAccessibilitySize: 0.13,
  right: 0.08,
} as const;

/** The left inset of the letter column for this text scale, as a fraction of the page width. */
export function letterLeftInset(fontScale: number): number {
  return atAccessibilitySize(fontScale)
    ? LETTER_INSETS.leftAtAccessibilitySize
    : LETTER_INSETS.left;
}

/** Between the letter's paragraphs, in points. */
export const LETTER_PARAGRAPH_GAP = 9;

/**
 * The handwritten signature, 2164×727 RGBA: its ink spans 87.3% of the
 * image's width, so a 126pt image draws the target's 110pt of ink. Its box
 * steps left of the text column by the ink's own margin and the paper's
 * tilt (the target's ink starts 8pt left of the last paragraph).
 */
export const SIGNATURE = {
  aspectRatio: 2164 / 727,
  width: 126,
  marginLeft: -22,
} as const;

/**
 * The lime stroke under `people you love.` (the kit's
 * people-you-love-underline.svg, `M3 6 Q84 -1 173 5` on a 176×9 box, stroke
 * 3): redrawn at the phrase's measured width, in points. Its box starts
 * `rise` points above the bottom of the phrase's line box, which is where
 * the target's stroke begins, just under the descenders.
 */
export const UNDERLINE = { height: 7, rise: 1, stroke: 2.4 } as const;

/** The stroke's path for a phrase `width` points wide: the kit's curve, scaled. */
export function underlinePath(width: number): string {
  const h = UNDERLINE.height / 9;
  const r = (n: number) => Math.round(n * 100) / 100;
  return `M${r(width * (3 / 176))} ${r(6 * h)} Q${r(width * (84 / 176))} ${r(-1 * h)} ${r(width * (173 / 176))} ${r(5 * h)}`;
}

/**
 * How far the benefits are drawn up into the artwork's transparent bottom
 * margin, as a fraction of its drawn width (the target's first plate starts
 * 16pt above the square's bottom edge at 408pt).
 */
export const BENEFITS_OVERLAP = 0.039;

// ── Geometry (points; measured at 402pt) ────────────────────────────────────

/** The benefit icon's plate: the target's 43pt powder-blue circle. */
export const BENEFIT_PLATE = 43;

/** The plate's glyph (the target's 23pt line glyph). */
export const BENEFIT_GLYPH = 23;

/** The purchase action's minimum height, in points. */
export const CTA_MIN_HEIGHT = 51;

// ── Spare height (2026-11-08) ───────────────────────────────────────────────

/**
 * How the page's spare height is shared when everything already fits with
 * room left over (a 402pt iPhone at the default text size had 83pt of blank
 * page under the benefits, while the first benefit touched the note). The
 * spare beyond `below` is shared out: a quarter between the two benefits (up
 * to `maxBetween`, the brief's +8–12pt) and the rest above the first (up to
 * `maxTop`), so the benefits sit about evenly between the note and the
 * purchase section. `below` plus the page's 16pt bottom padding is what
 * stays under the last benefit — or the standalone route's Privacy & Data
 * Controls, whose height the measurement includes: about 24pt, the low end
 * of the brief's 24–32pt, which leaves the standalone route (where the
 * link takes most of the room) a few points to give the first benefit.
 *
 * Only at the default text size or smaller (`fontScale <= 1`) and only when
 * there is spare: an iPhone SE, whose page scrolls, and every larger text
 * size keep the compact spacing.
 */
export const SPARE_SPACING = { below: 8, betweenShare: 0.25, maxTop: 44, maxBetween: 12 } as const;

export function benefitSpacing(
  spare: number,
  fontScale: number,
  lift = 0,
): { top: number; between: number; lift: number } {
  if (fontScale > 1 || !(spare >= 0)) return { top: 0, between: 0, lift: 0 };
  const extra = spare - SPARE_SPACING.below;
  const between =
    extra > 0
      ? Math.round(Math.min(SPARE_SPACING.maxBetween, extra * SPARE_SPACING.betweenShare))
      : 0;
  const top = extra > 0 ? Math.round(Math.min(SPARE_SPACING.maxTop, extra - between)) : 0;
  const lent = Math.min(lift, PAGE_BOTTOM_PADDING);
  return { top: top + lent, between, lift: lent };
}

/** The page's own bottom padding, in points: what a `lift` may borrow from. */
export const PAGE_BOTTOM_PADDING = 16;

/**
 * The standalone `/paywall` (2026-11-08): its Privacy & Data Controls entry
 * takes the spare the onboarding route gives the benefits, which left the
 * first benefit against the note. When the page fits at the default text
 * size, it moves this much from below that entry to above the first benefit
 * (`benefitSpacing`'s `lift`): the page's total height, the fit and the
 * footer's position are unchanged, and the entry keeps its 44pt target.
 */
export const STANDALONE_BENEFIT_LIFT = 14;
