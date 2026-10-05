/**
 * The onboarding paywall's presentation (the grocery-watch paywall,
 * 2026-10-01): its approved copy, how the one approved image and the native
 * text are sized and placed, and what each plan card says. Numbers, copy and
 * pure functions only, so all of it is testable under Node; the component
 * (components/paywall/onboarding-paywall-panel.tsx) maps it onto React
 * Native. A leaf.
 *
 * Since 2026-10-04 the standalone `/paywall` a lapsed subscriber meets draws
 * this same presentation; the shared state rules (notices, CTA, footer
 * placement) stay in lib/paywall-screen.ts. Both routes draw the SAME
 * purchase state from the one purchase flow.
 *
 * ## Measured from the approved target
 *
 * The founder-approved composition
 * (assets/brand/reference/lotly-onboarding-paywall-grocery-watch-target.png,
 * 934×1683, app content without system chrome) scales by `width / 934`: at
 * 402pt (iPhone 17) one target pixel is 0.4304pt. The production hero is a
 * crop of it at its own pixels (0,152 to 934,772), so it spans the page:
 * 402×266.9pt at 402pt. Every number below was measured from the target's
 * pixels (asset report:
 * assets/brand/reference/paywall-grocery-watch/lotly-paywall-grocery-watch-asset-report.json).
 *
 * ## The native text
 *
 * The headline `Keep a closer / watch.` is Public Sans Bold at 41pt: the
 * target's capitals are 69px (29.7pt) tall, and Bold's 0.723 cap height
 * gives 40.7pt; the ink of `Keep a closer` (596px) fits Bold at 40.8pt. Its
 * baselines are 87px (37.4pt) apart, so the leading is 38pt. The break
 * after `closer` is a measure, never a newline: wider than `Keep a closer`
 * (about 262pt at 41pt) and narrower than the whole line (about 413pt), and
 * it grows with the reader's text size.
 *
 * Where the target's type is smaller than the app's shared scale, the shared
 * scale's floor is kept rather than the mock's size, so nothing is less
 * legible than the rest of the app: the benefit explanations, the monthly
 * equivalent and the savings badge are 13pt (the target's ≈11pt, 10.7pt
 * and 12.8pt), and the renewal disclosure and the four footer actions stay
 * the shared `caption` (the target's ≈10pt). The benefit headings are 15pt
 * Bold (the target's 13.3–14.2pt), keeping the target's step above their
 * explanations. The plan prices are Bold 18pt (the target's 16.2–17.7pt).
 * The purchase action is the onboarding's 51pt pill with Ready's 16pt label.
 * All of these are this screen's own sizes: the shared type scale and the
 * shared Button are unchanged.
 *
 * ## The hero and the headline
 *
 * The hero's top band is transparent page above the blue wave, which rises
 * beside the headline on the right. The headline is drawn OVER that band:
 * the hero's top edge sits `HERO_TOP_ABOVE_LAST_BASELINE_PX` target pixels
 * above the headline's last baseline, as in the target, less the
 * `HEADLINE_HERO_GAP` of breathing room beneath `watch.` (spacing pass), so
 * the wave keeps its place beside the words at any width. As the reader's text grows
 * the headline grows upward away from the art. From the accessibility sizes
 * (text scale 1.5, the app's shared threshold) the headline takes the
 * standard `display` base, 33pt (still scaled), and the hero follows it
 * instead of sitting under it: the art is decorative and gives way.
 *
 * ## Glyph provenance
 *
 * The benefit icons are the app's line family: `bookmark` from the set, and
 * two glyphs added for this screen from the same vendored Lucide source
 * (lucide-icons/lucide at the allergen set's pinned commit `f06ac67e…`,
 * release 1.47.0, ISC; lib/allergen-icons.ts): `file-search` is Lucide's
 * `file-search-corner` and `bell` is Lucide's `bell`, both byte-identical to
 * the files at that commit, vendored in assets/icon-sources/lucide/ on
 * 2026-10-01 and rasterised natively by scripts/render-onboarding-assets.mjs
 * on the set's box and stroke. allergen-icons.test.ts pins the sources.
 */

import { typography } from '@/constants/design-tokens';

import type { PlanPeriod } from './entitlement';
import {
  formatDerivedPrice,
  PAYWALL_DISCLOSURE,
  PLAN_TITLES,
  savingsLine,
  type PaywallView,
} from './paywall-screen';
import { monthlyEquivalentAmount, type Offering } from './purchases/purchase-provider';

// ── Copy (founder-approved, 2026-10-01) ─────────────────────────────────────

/** One line in the source; it breaks after `closer` by measure (see above). */
export const ONBOARDING_PAYWALL_HEADLINE = 'Keep a closer watch.';

export interface PaywallBenefit {
  /** A glyph of the app's icon set (components/ui/icon.tsx). */
  icon: 'file-search' | 'bell' | 'bookmark';
  title: string;
  body: string;
}

export const ONBOARDING_PAYWALL_BENEFITS: readonly PaywallBenefit[] = [
  {
    icon: 'file-search',
    title: 'See recalls that match you',
    body: 'Based on your states, allergens and stores.',
  },
  {
    icon: 'bell',
    title: 'Get matching recall alerts',
    body: 'Notifications tailored to your preferences.',
  },
  {
    icon: 'bookmark',
    title: 'Know what to check',
    body: 'Search, save and view full recall details.',
  },
];

/** The renewal disclosure for the plan the shopper has chosen. */
export const RENEWAL_DISCLOSURE: Record<PlanPeriod, string> = {
  annual: 'Renews yearly. Cancel anytime in Apple Account settings.',
  monthly: 'Renews monthly. Cancel anytime in Apple Account settings.',
};

/**
 * The disclosure beneath the purchase action: the chosen plan's renewal
 * period once there is a plan to buy, and the shared period-neutral sentence
 * while the offering loads, is unavailable or errored.
 */
export function renewalDisclosure(view: PaywallView): string {
  return view.offerings.kind === 'ready'
    ? RENEWAL_DISCLOSURE[view.selectedPlan]
    : PAYWALL_DISCLOSURE;
}

// ── The glyphs this screen adds to the icon set ─────────────────────────────

export const PAYWALL_ICON_SOURCES = [
  { icon: 'file-search', lucideName: 'file-search-corner' },
  { icon: 'bell', lucideName: 'bell' },
] as const;
export const PAYWALL_ICONS_VENDORED_ON = '2026-10-01';

// ── The hero (asset report) ─────────────────────────────────────────────────

/** The approved target's width, in pixels: the hero is a crop of it at 1:1. */
export const REFERENCE_WIDTH = 934;

/** lotly-paywall-grocery-watch-scene.png: target rows 152–771, full width. */
export const HERO_PX = { width: 934, height: 620, top: 152 } as const;

/** The target's headline: capitals from row 118; baselines at rows 187 and 274. */
export const HEADLINE_PX = { capTop: 118, baselines: [187, 274] } as const;

/** How far the hero's top edge sits above the headline's last baseline, in target pixels. */
export const HERO_TOP_ABOVE_LAST_BASELINE_PX = HEADLINE_PX.baselines[1] - HERO_PX.top;

/** The hero's height, in points, for a page `width` points wide (it spans the width). */
export function heroHeight(width: number): number {
  return (HERO_PX.height * width) / REFERENCE_WIDTH;
}

// ── The native type ─────────────────────────────────────────────────────────

/** The screen's own text sizes and leading, in points (see "The native text"). */
export const PAYWALL_TYPE = {
  headline: { fontSize: 41, lineHeight: 38 },
  benefitTitle: { fontSize: 15, lineHeight: 20 },
  benefitBody: { fontSize: 13, lineHeight: 18 },
  planTitle: { fontSize: 14, lineHeight: 19 },
  planPrice: { fontSize: 18, lineHeight: 23 },
  planEquivalent: { fontSize: 13, lineHeight: 17 },
  badge: { fontSize: 13, lineHeight: 17 },
  /** Ready's purchase-path label on the 51pt pill. */
  cta: { fontSize: 16, lineHeight: 22 },
} as const;

/**
 * Where iOS puts the headline's glyphs in its tight 38pt lines (shorter than
 * Public Sans' natural 48.2pt at 41pt: hhea ascender 1900, descender −450 on
 * a 2000 unit em). Measured on the iPhone 17 simulator (2026-10-01), it
 * keeps the font's DESCENT at the bottom of every line box and lets the
 * extra height go from the top: the last baseline sits `descent × size`
 * (9.2pt) above the block's bottom, and Bold's ascenders (`l`, `k`, `h`
 * reach 31pt above the baseline at 41pt; capitals 30pt) rise above the first
 * line box. Centring the glyphs instead would put the hero 5pt low, as the
 * first native pass measured.
 */
export const PUBLIC_SANS_METRICS = { descent: 0.225, boldAscender: 31 / 41 } as const;

/** The headline's measure at the default text size, in points (see "The native text"). */
export const HEADLINE_MEASURE = 300;

/** From this text scale the screen takes its accessibility layout. */
export const ACCESSIBILITY_SCALE = 1.5;

export function atAccessibilitySize(fontScale: number): boolean {
  return fontScale >= ACCESSIBILITY_SCALE;
}

/** The headline's base size and leading, before the reader's text scale. */
export function headlineType(fontScale: number): { fontSize: number; lineHeight: number } {
  return atAccessibilitySize(fontScale)
    ? { fontSize: typography.display.fontSize, lineHeight: typography.display.lineHeight }
    : PAYWALL_TYPE.headline;
}

/** The headline's measure, in points, at the reader's text scale. */
export function headlineMeasure(fontScale: number): number {
  return HEADLINE_MEASURE * fontScale;
}

/**
 * Breathing room added beneath `watch.` (spacing pass, 2026-10-01), in
 * points. At the target's placement the wave came within 7pt of the
 * headline's last baseline on iPhone 17 (where it rises at the left edge)
 * and 5.5pt on an SE, measured on the simulators; the hero now sits this
 * much lower, so the closest approach is about 14pt and 12.5pt. The wave
 * still rises beside the headline on the right.
 */
export const HEADLINE_HERO_GAP = 7;

/**
 * How far the hero is drawn UP under the headline block, in points: the
 * distance from the block's last baseline to its bottom (the font's descent,
 * see `PUBLIC_SANS_METRICS`) plus the target's hero-top-to-baseline distance
 * at this page width, less the added `HEADLINE_HERO_GAP`. Zero from the
 * accessibility sizes, where the hero follows the headline.
 */
export function heroOverlap(width: number, fontScale: number): number {
  if (atAccessibilitySize(fontScale)) return 0;
  const belowBaseline = fontScale * PUBLIC_SANS_METRICS.descent * PAYWALL_TYPE.headline.fontSize;
  const targetPlacement = (HERO_TOP_ABOVE_LAST_BASELINE_PX * width) / REFERENCE_WIDTH;
  return belowBaseline + targetPlacement - HEADLINE_HERO_GAP;
}

/**
 * The room above the headline's first line box, in points, that its
 * ascenders rise into (`PUBLIC_SANS_METRICS`), applied as the Text's own top
 * padding: without it the Text's bounds shaved 1–2pt off `K` and `l`
 * (measured on the first native pass; padding outside the Text did not help).
 * It grows with the reader's text. From the accessibility sizes the `display`
 * leading (40pt on 33pt) is taller than the font's natural height, the
 * glyphs sit inside their line boxes, and no room is needed.
 */
export function headlineTopClearance(fontScale: number): number {
  if (atAccessibilitySize(fontScale)) return 0;
  const { fontSize, lineHeight } = PAYWALL_TYPE.headline;
  const aboveFirstBaseline = lineHeight - PUBLIC_SANS_METRICS.descent * fontSize;
  return Math.ceil(fontScale * (PUBLIC_SANS_METRICS.boldAscender * fontSize - aboveFirstBaseline));
}

// ── Geometry (points; measured at 402pt) ────────────────────────────────────

/** The benefit icon's plate: the target's 35.3pt powder-blue circle. */
export const BENEFIT_PLATE = 36;

/** The purchase action's minimum height, in points: the onboarding's 51pt pill. */
export const CTA_MIN_HEIGHT = 51;

/** A plan card's radio: the target's 20pt ring. */
export const RADIO_SIZE = 20;

// ── The plan cards ──────────────────────────────────────────────────────────

const PERIOD_UNIT: Record<PlanPeriod, string> = { annual: 'year', monthly: 'month' };

export interface OnboardingPlanCard {
  period: PlanPeriod;
  title: string;
  /** `$29.99 / year`: the store's own string, then the period. */
  priceText: string;
  /** `$2.50/month equivalent` for the annual plan; null for monthly or when underivable. */
  equivalentLine: string | null;
  /** `Save 50%` on the annual plan when the store's prices show a saving; otherwise null. */
  savingsBadge: string | null;
  selected: boolean;
  /**
   * Spoken: the plan, its full charge and billing period, then the
   * explanatory equivalent and the saving. The radio's state carries the
   * selection, and the badge is drawing, so nothing is said twice.
   */
  accessibilityLabel: string;
}

export function onboardingPlanCard(
  offering: Offering,
  period: PlanPeriod,
  selected: boolean,
  locale?: string,
): OnboardingPlanCard {
  const pkg = offering[period];
  const unit = PERIOD_UNIT[period];
  const equivalentAmount = period === 'annual' ? monthlyEquivalentAmount(pkg) : null;
  const equivalent =
    equivalentAmount === null
      ? null
      : formatDerivedPrice(equivalentAmount, pkg.price.currencyCode, locale);
  const savingsBadge = period === 'annual' ? savingsLine(offering) : null;
  const spoken = [
    `${PLAN_TITLES[period]}, ${pkg.price.formatted} per ${unit}`,
    equivalent === null ? null : `${equivalent} per month equivalent`,
    savingsBadge,
  ]
    .filter((part): part is string => part !== null)
    .join('. ');
  return {
    period,
    title: PLAN_TITLES[period],
    priceText: `${pkg.price.formatted} / ${unit}`,
    equivalentLine: equivalent === null ? null : `${equivalent}/month equivalent`,
    savingsBadge,
    selected,
    accessibilityLabel: `${spoken}.`,
  };
}

/** Both cards, Annual first, or null while there is no offering to show. */
export function onboardingPlanCards(
  view: PaywallView,
  locale?: string,
): OnboardingPlanCard[] | null {
  if (view.offerings.kind !== 'ready') return null;
  const { offering } = view.offerings;
  return (['annual', 'monthly'] as const).map((period) =>
    onboardingPlanCard(offering, period, period === view.selectedPlan, locale),
  );
}
