/**
 * The Lotly design tokens (P2B0) — the one place a semantic design value is
 * defined in code.
 *
 * Every value here is pinned to the design contract in DESIGN.md, whose front
 * matter carries the same names and values; `design-tokens.test.ts` proves the
 * two agree, so a token cannot change on one side without the other noticing.
 *
 * ## Naming
 *
 * Semantic tokens use the exact slash-separated names of their Figma variables
 * (`background/page`, `risk/critical/background`), keyed as strings, so the
 * Figma ↔ code mapping is the identity and needs no lookup table. Typography
 * tokens use DESIGN.md's kebab-case names (`heading-3`), because Figma text
 * styles are not variables and carry display names ("Heading 3") instead; the
 * `figmaStyle` field records that name.
 *
 * ## What consumes these
 *
 * Reusable components (`src/components/ui/`) read tokens and never spell a
 * primitive colour, an off-scale spacing, or a font size of their own. The
 * legacy provisional theme (`Colors`, `Spacing`, `Radii` in theme.ts) still
 * serves the screens that have not been migrated; it is not extended further.
 *
 * ## Boundary
 *
 * A leaf module: no React Native runtime import (the `TextStyle` import is a
 * type and is erased), no CSS, no I/O — so Node tests can load it directly and
 * nothing here can ever pull screen or server code into another bundle.
 */

import type { TextStyle } from 'react-native';

import type { ConsumerRiskTier } from '@/domain/risk-tier';

// ── Colour ──────────────────────────────────────────────────────────────────

/** A six-digit uppercase hex colour, as the contract writes them. */
export type HexColor = `#${string}`;

/**
 * Semantic colour tokens, keyed by their Figma variable names. The light
 * system is the only approved system: there is no dark palette here, and none
 * may be added without an approved design (DESIGN.md, "Dark mode").
 */
export const color = {
  'background/page': '#FDFCF6',
  'background/surface': '#FFFFFF',
  'background/subtle': '#C0D6EB',
  'background/brand': '#2B4A6C',
  'background/accent': '#E2EE57',
  'background/media-placeholder': '#EEF1F1',

  'text/primary': '#001F3E',
  'text/secondary': '#66747A',
  'text/inverse': '#FFFFFF',
  'text/disabled': '#D1D7D9',

  'border/default': '#D1D7D9',
  'border/subtle': '#E1E5E6',
  'border/strong': '#89969B',

  'action/primary': '#2B4A6C',
  'action/secondary': '#3560A9',
  'action/accent': '#E2EE57',
  'action/disabled': '#D1D7D9',

  'icon/primary': '#2B4A6C',
  'icon/secondary': '#66747A',
  'icon/inverse': '#FFFFFF',
  'icon/brand': '#3560A9',
} as const satisfies Record<string, HexColor>;

export type ColorToken = keyof typeof color;
export type BackgroundToken = Extract<ColorToken, `background/${string}`>;
export type BorderToken = Extract<ColorToken, `border/${string}`>;
/** What text may be coloured with: reading colours and action colours. */
export type TextColorToken = Extract<ColorToken, `text/${string}` | `action/${string}`>;

/** One label treatment: the fill, the text/icon on it, and its 1px border. */
export interface LabelPalette {
  background: HexColor;
  foreground: HexColor;
  border: HexColor;
}

/**
 * The seven consumer risk labels — the complete set, keyed by the domain's
 * own tier so a tier without a treatment (or a treatment without a tier) is a
 * compile error. Critical through Low is the severity spectrum; Pending and
 * Unknown deliberately leave it, because they describe classification state,
 * not danger. There is no green anywhere: no level means "safe".
 *
 * The domain mapping from official classes to these tiers lives in
 * `domain/risk-tier.ts` and is untouched by any of this — a treatment is
 * looked up BY the tier, never inferred alongside it.
 */
export const riskPalette: Record<ConsumerRiskTier, LabelPalette> = {
  critical: { background: '#EF4E47', foreground: '#001F3E', border: '#C82728' },
  very_high: { background: '#F28C28', foreground: '#001F3E', border: '#C86700' },
  high: { background: '#F3B63F', foreground: '#001F3E', border: '#C78C00' },
  moderate: { background: '#E8D348', foreground: '#001F3E', border: '#BBA600' },
  low: { background: '#F2E76B', foreground: '#001F3E', border: '#C8BD3E' },
  pending: { background: '#C0D6EB', foreground: '#001F3E', border: '#D1D7D9' },
  unknown: { background: '#EEF1F1', foreground: '#4B585E', border: '#D1D7D9' },
};

/** The Figma variable name of each risk-palette entry, for the mapping table. */
export const RISK_TOKEN_NAME: Record<ConsumerRiskTier, string> = {
  critical: 'risk/critical',
  very_high: 'risk/very-high',
  high: 'risk/high',
  moderate: 'risk/moderate',
  low: 'risk/low',
  pending: 'risk/pending',
  unknown: 'risk/unknown',
};

/**
 * Personal relevance is NOT a risk level. `Affects You` answers whether a
 * recall matters to this shopper's saved location, retailers, or allergens;
 * it says nothing about severity, and lime never means "safe" or "low".
 * Kept in its own object so it can never be indexed by a risk tier.
 */
export const relevancePalette = {
  'affects-you': { background: '#E2EE57', foreground: '#001F3E', border: '#ADB600' },
} as const satisfies Record<string, LabelPalette>;

/**
 * The harm notices (P2B7K as `illnessNoticePalette`; re-founded in P2B7V) —
 * the treatments for what the OFFICIAL notice reported about people, shown as
 * separate compact boxes in Recall Detail's identity area.
 *
 * ## Severity is the treatment (founder decision, P2B7V)
 *
 * P2B7K gave the notice a treatment of its own, deliberately built only from
 * foundation colours, so that illness status could never borrow Critical's
 * red. The reasoning was that illness status is not a risk LEVEL — and it is
 * not. What P2B7Q.1 then established is that these three facts are not one
 * status at all: a reported illness, a reported hospitalization and a reported
 * death are three different harms, and they are ordered by how bad they are.
 * The founder's decision is that the ordering should be visible, using the
 * severity vocabulary the app already has rather than a fourth one invented
 * here:
 *
 *   illnesses          the `high` risk treatment
 *   hospitalizations   the `very_high` risk treatment
 *   deaths             the `critical` risk treatment
 *
 * Every one of those is a REFERENCE to the risk palette's own entry, not a
 * copy of its values: there is exactly one definition of Critical's red in
 * this file, and changing it changes the death box with it. A second
 * vocabulary of hand-copied hexes is the thing this shape exists to prevent.
 *
 * These boxes still cannot be confused with the Risk Label, because colour
 * was never what distinguished them: the Risk Label is uppercase IBM Plex
 * Mono at a 24pt minimum height and says a TIER ("CRITICAL"); a harm notice
 * is sentence-case Public Sans at its own line height and says a COUNTED
 * FACT ("1 death reported"). Colour is the redundant channel in both.
 *
 * ## `none` is unchanged
 *
 * "No illnesses reported" is a founder-approved reassurance, not a harm, and
 * it keeps the calm blue informational treatment it has always had — an
 * existing foundation colour (`background/subtle`), never a severity fill.
 */
export const harmNoticePalette = {
  none: { background: '#C0D6EB', foreground: '#001F3E', border: '#C0D6EB' },
  illnesses: riskPalette.high,
  hospitalizations: riskPalette.very_high,
  deaths: riskPalette.critical,
} as const satisfies Record<string, LabelPalette>;

// ── Spacing, radius, size ───────────────────────────────────────────────────

/** The only spacing values: `spacing/4` … `spacing/48` in Figma. */
export const spacing = {
  4: 4,
  8: 8,
  12: 12,
  16: 16,
  24: 24,
  32: 32,
  48: 48,
} as const;

export type SpacingStep = keyof typeof spacing;

/** The only corner radii: `radius/4` … `radius/16` and `radius/full`. */
export const radius = {
  4: 4,
  8: 8,
  12: 12,
  16: 16,
  full: 999,
} as const;

export type RadiusStep = keyof typeof radius;

/** Icon glyph sizes. Utility icons are 20, bottom navigation 24. */
export const iconSize = {
  12: 12,
  16: 16,
  20: 20,
  24: 24,
} as const;

export type IconSizeStep = keyof typeof iconSize;

/**
 * The smallest touch target any interactive primitive may expose, in points.
 * A control whose visible footprint is smaller reaches this through hitSlop
 * (`hitSlopToMinimum`), never by being left short.
 */
export const hitTarget = { minimum: 44 } as const;

/**
 * The hitSlop that grows a control of the given visible size to the minimum
 * target on every side. Zero on an axis that already meets it.
 */
export function hitSlopToMinimum(
  visibleHeight: number,
  visibleWidth: number = hitTarget.minimum,
): { top: number; bottom: number; left: number; right: number } {
  const vertical = Math.max(0, Math.ceil((hitTarget.minimum - visibleHeight) / 2));
  const horizontal = Math.max(0, Math.ceil((hitTarget.minimum - visibleWidth) / 2));
  return { top: vertical, bottom: vertical, left: horizontal, right: horizontal };
}

/**
 * The reference geometry the composition was designed at. Reference only:
 * screens size to the real device width and safe areas, never to these
 * numbers, and the page margin is the one value that carries over unchanged.
 */
export const layout = {
  referenceWidth: 393,
  pageMargin: 16,
  contentWidth: 361,
  bottomNavHeight: 72,
  /**
   * The navigator header's bar, excluding the status-bar inset — the
   * platform's own 44pt. It is a FLOOR, not a fixed height: the header grows
   * past it when the reader's text size needs more room (see
   * `(tabs)/_layout.tsx`), because the title honours Dynamic Type and a bar
   * that stayed 44pt would clip it.
   */
  navHeaderHeight: 44,
  searchBarHeight: 44,
  riskLabelHeight: 24,
  /**
   * The recall card's square media footprint — the product image or, when
   * there is none, the neutral placeholder, so both card geometries match.
   */
  cardMediaSize: 112,
  /**
   * The widest a content column grows, on tablets and the web; a phone
   * never reaches it, so it changes nothing about the 393pt composition.
   */
  maxContentWidth: 800,
  /**
   * Recall Detail's square hero tile beside the product identity (Figma's
   * 150 normalized to the 4pt grid). Rendered only when the recall has a
   * usable image: Detail removes the tile rather than reserving its space.
   */
  detailMediaSize: 152,
  /**
   * The version image beside a Product value in the Affected Products table
   * — a recognition aid inside a dense row, so it stays small.
   */
  rowMediaSize: 40,
  /**
   * The diameter of one position dot under a paged image set (P2B7C). Dots
   * are decorative and never interactive, so this is a mark size, not a
   * touch target. There is one per swipeable page, never more than
   * `IMAGE_PAGES_MAX`; a larger official set adds a compact counter beside
   * them (P2B7I) rather than replacing them.
   */
  pageDotSize: 8,
  /**
   * One fixed column width for the Affected Products table, so the header
   * row and every version row stay aligned while the table scrolls sideways
   * as one unit. Wide enough for a paired "Month DD, YYYY" line, which is
   * the one value the contract caps to a single line.
   */
  tableColumnWidth: 144,
} as const;

// ── Elevation ───────────────────────────────────────────────────────────────

export interface ElevationToken {
  shadowColor: HexColor;
  shadowOffset: { width: number; height: number };
  shadowRadius: number;
  shadowOpacity: number;
  /** Android's approximation of the same lift. */
  elevation: number;
}

/**
 * Lotly is mostly flat. `card` is the one canonical lift —
 * `0 2px 8px rgba(0, 0, 0, 0.06)` — for recall cards and similar primary
 * surfaces. Labels never carry a shadow.
 */
export const elevation = {
  none: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 0,
    shadowOpacity: 0,
    elevation: 0,
  },
  card: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    shadowOpacity: 0.06,
    elevation: 2,
  },
} as const satisfies Record<string, ElevationToken>;

export type ElevationLevel = keyof typeof elevation;

// ── Typography ──────────────────────────────────────────────────────────────

/** The two families and their jobs (DESIGN.md, "Typography"). */
export const fontFamily = {
  /** Public Sans — every ordinary interface word. */
  sans: 'Public Sans',
  /** IBM Plex Mono — risk labels and compact structured metadata only. */
  mono: 'IBM Plex Mono',
} as const;

export type FontFamilyRole = keyof typeof fontFamily;
export type FontWeightToken = '400' | '500' | '600' | '700';

/**
 * The npm packages that supply the two families, and the flag that says
 * whether they are installed. `design-tokens.test.ts` pins the flag to
 * package.json so it cannot drift from reality in either direction.
 */
export const FONT_PACKAGES = [
  '@expo-google-fonts/public-sans',
  '@expo-google-fonts/ibm-plex-mono',
  'expo-font',
] as const;

export const CUSTOM_FONTS_INSTALLED = true;

/**
 * The six faces the design contract uses, and the only six the app loads —
 * keyed by family role and weight, valued by the name each
 * @expo-google-fonts package registers. React Native selects a custom face by
 * this full name, not by `fontWeight`, which is why `textStyle` sets exactly
 * one of the two. A typography token can only name a face that exists here,
 * so an unapproved weight is a compile error, not a silent platform fallback.
 *
 * The root layout (`app/_layout.tsx`) loads exactly `REQUIRED_FONT_FACES`
 * before the first screen renders; `design-tokens.test.ts` pins that.
 */
export const fontFace = {
  'sans-400': 'PublicSans_400Regular',
  'sans-500': 'PublicSans_500Medium',
  'sans-600': 'PublicSans_600SemiBold',
  'sans-700': 'PublicSans_700Bold',
  'mono-500': 'IBMPlexMono_500Medium',
  'mono-600': 'IBMPlexMono_600SemiBold',
} as const satisfies Partial<Record<`${FontFamilyRole}-${FontWeightToken}`, string>>;

export type FontFace = keyof typeof fontFace;

/** The registered face names, in the order the root layout loads them. */
export const REQUIRED_FONT_FACES: readonly string[] = Object.values(fontFace);

export interface TypographyToken {
  /** Which loaded face renders this token; family and weight derive from it. */
  face: FontFace;
  family: FontFamilyRole;
  fontSize: number;
  fontWeight: FontWeightToken;
  /** The contract's unitless ratio; `lineHeight` is its rounded product. */
  lineHeightRatio: number;
  /** Points. React Native takes absolute line heights, so the ratio is resolved here. */
  lineHeight: number;
  /** Points — the contract's em value multiplied out at this size. */
  letterSpacing: number;
  /** The Figma text style this token is, when Figma has one. */
  figmaStyle: string | null;
}

function type(
  face: FontFace,
  fontSize: number,
  lineHeightRatio: number,
  figmaStyle: string | null,
  letterSpacingEm = 0,
): TypographyToken {
  const [family, fontWeight] = face.split('-') as [FontFamilyRole, FontWeightToken];
  return {
    face,
    family,
    fontSize,
    fontWeight,
    lineHeightRatio,
    lineHeight: Math.round(fontSize * lineHeightRatio),
    letterSpacing: Math.round(letterSpacingEm * fontSize * 100) / 100,
    figmaStyle,
  };
}

/**
 * The canonical type scale. Line heights are the contract's ratios resolved to
 * whole points, which is what Figma renders too (a 19px Heading 3 measures 26
 * high on the canvas). No other size, weight, or leading is approved.
 */
export const typography = {
  display: type('sans-700', 33, 1.2, null),
  'heading-1': type('sans-700', 28, 1.2, null),
  'heading-2': type('sans-700', 23, 1.3, 'Heading 2'),
  'heading-3': type('sans-600', 19, 1.35, 'Heading 3'),
  body: type('sans-400', 16, 1.5, null),
  'body-small': type('sans-400', 13, 1.4, 'Body Small'),
  'body-small-bold': type('sans-600', 13, 1.4, 'Body Small Bold'),
  caption: type('sans-500', 12, 1.35, 'Caption'),
  'micro-caption': type('sans-500', 10, 1.35, 'Micro-caption'),
  label: type('mono-500', 12, 1.35, 'Label', 0.02),
  'label-strong': type('mono-600', 12, 1.35, null, 0.02),
} as const satisfies Record<string, TypographyToken>;

export type TypographyVariant = keyof typeof typography;

/**
 * A typography token as a React Native text style.
 *
 * With the custom fonts installed the registered face carries the weight, so
 * `fontWeight` is omitted (a weight on a single-weight face makes iOS
 * synthesise one). The flag's `false` branch exists for one reason only: an
 * installation where the packages are absent must still typecheck and render
 * — it is never the shipped state, and `design-tokens.test.ts` pins the flag
 * to package.json.
 */
export function textStyle(variant: TypographyVariant): TextStyle {
  const token = typography[variant];
  const base: TextStyle = {
    fontSize: token.fontSize,
    lineHeight: token.lineHeight,
    letterSpacing: token.letterSpacing,
  };
  return CUSTOM_FONTS_INSTALLED
    ? { ...base, fontFamily: fontFace[token.face] }
    : { ...base, fontWeight: token.fontWeight };
}
