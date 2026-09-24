/**
 * The hard paywall's copy and its state → presentation mapping (P2B7X.1),
 * kept out of the screen so every state is one tested contract.
 *
 * ## What the screen shows
 *
 * The headline, body and three benefits; two plans (Annual preselected, with
 * the store-derived monthly equivalent, `BEST VALUE`, and the saving against
 * twelve monthly payments computed from the store's prices); one primary
 * action that names the selected commitment with the store's own localized
 * price; the renewal disclosure; and four footer actions that are ALWAYS
 * available before a purchase — Restore Purchases, Terms, Privacy, Support.
 *
 * ## What it never shows
 *
 * No close, skip, dismiss or "continue free" route; no trial, lifetime plan,
 * countdown, crossed-out price or scarcity. There is one way past the
 * paywall — a verified purchase or restore — and one way back, to the
 * Preview. `consumer-copy` and `paywall-screen.test.ts` pin the words.
 *
 * ## Prices
 *
 * Every price a shopper reads is the store's own `formatted` string, passed
 * through verbatim. The only derived figures are the monthly equivalent of
 * the annual price and the percentage saving, both computed from the store's
 * numeric amounts (`purchase-provider.ts`) and formatted in the store's
 * currency. No product module holds a literal price.
 *
 * A leaf: copy, types and pure functions.
 */

import type { PlanPeriod } from './entitlement';
import {
  annualSavingsPercent,
  monthlyEquivalentAmount,
  type Offering,
  type OfferingsResult,
  type PlanPackage,
} from './purchases/purchase-provider';

// ── Copy (founder-approved, P2B7X.1) ────────────────────────────────────────

export const PAYWALL_HEADLINE = 'Recall alerts, personalized for you.';
export const PAYWALL_BODY = 'Get full access to Lotly’s personalized recall monitoring.';

export const PAYWALL_BENEFITS: readonly string[] = [
  'See which recalls affect you',
  'Get matching recall notifications',
  'Search, save, and view full details',
];

export const PLAN_TITLES: Record<PlanPeriod, string> = {
  annual: 'Annual',
  monthly: 'Monthly',
};

/** The per-period suffix after a store price: `$29.99/year`. */
export const PERIOD_SUFFIX: Record<PlanPeriod, string> = {
  annual: '/year',
  monthly: '/month',
};

export const BEST_VALUE_LABEL = 'BEST VALUE';
export const BEST_VALUE_ACCESSIBILITY_LABEL = 'Best value';

/** The spoken name of the plan group. */
export const PLAN_GROUP_LABEL = 'Choose a plan';

export const SUBSCRIBE_BUSY_LABEL = 'Subscribing…';
export const RESTORE_BUSY_LABEL = 'Restoring…';

export const PAYWALL_DISCLOSURE = 'Renews automatically. Cancel anytime in Apple Account settings.';

/**
 * Where the disclosure and the four footer actions sit. In the sticky
 * footer at ordinary text sizes; from the accessibility sizes (a text scale
 * of 1.5, the threshold the settings selector row stacks at) they move into
 * the scrolling content directly above the primary action, because a
 * footer holding a four-line disclosure and four wrapped links would
 * otherwise take the whole screen and leave the plans unreachable. The
 * notice and the primary action stay sticky at every size.
 */
export const INLINE_FOOTER_AT_SCALE = 1.5;

export type PaywallFooterPlacement = 'sticky' | 'inline';

export function paywallFooterPlacement(fontScale: number): PaywallFooterPlacement {
  return fontScale >= INLINE_FOOTER_AT_SCALE ? 'inline' : 'sticky';
}

/** The paywall's one way back. */
export const PAYWALL_BACK_LABEL = 'Back';
export const PAYWALL_BACK_HINT = 'Returns to your recall watch summary.';

export type PaywallFooterActionKey = 'restore' | 'terms' | 'privacy' | 'support';

export interface PaywallFooterAction {
  key: PaywallFooterActionKey;
  label: string;
}

/** Always rendered, in this order, before any purchase. */
export const PAYWALL_FOOTER_ACTIONS: readonly PaywallFooterAction[] = [
  { key: 'restore', label: 'Restore Purchases' },
  { key: 'terms', label: 'Terms' },
  { key: 'privacy', label: 'Privacy' },
  { key: 'support', label: 'Support' },
];

/** While the offering loads. */
export const OFFERING_LOADING = 'Loading plans…';
/** The store could not be reached, or no store is configured. */
export const OFFERING_UNAVAILABLE =
  'Plans are temporarily unavailable. Check your connection and try again.';
/** The store answered with a retryable error. */
export const OFFERING_ERROR = 'Lotly couldn’t load the plans. Check your connection and try again.';
/** The subscribe action while no package can be bought. */
export const SUBSCRIBE_UNAVAILABLE_LABEL = 'Subscribe';

export type PaywallNoticeKind =
  | 'cancelled'
  | 'purchase_error'
  | 'purchase_unavailable'
  | 'restore_error'
  | 'restore_unavailable'
  | 'restore_nothing'
  | 'restore_success'
  | 'unconfirmed';

export type PaywallNoticeTone = 'calm' | 'alert' | 'success';

export const PAYWALL_NOTICES: Record<PaywallNoticeKind, { text: string; tone: PaywallNoticeTone }> =
  {
    cancelled: {
      text: 'Purchase cancelled. Nothing was charged. Choose a plan whenever you’re ready.',
      tone: 'calm',
    },
    purchase_error: {
      text: 'Lotly couldn’t complete the purchase. Nothing was charged. Check your connection and try again.',
      tone: 'alert',
    },
    purchase_unavailable: {
      text: 'Purchases are temporarily unavailable. Check your connection and try again.',
      tone: 'alert',
    },
    restore_error: {
      text: 'Lotly couldn’t restore purchases. Check your connection and try again.',
      tone: 'alert',
    },
    restore_unavailable: {
      text: 'Restore is temporarily unavailable. Check your connection and try again.',
      tone: 'alert',
    },
    restore_nothing: {
      text: 'No Lotly subscription was found for this Apple Account.',
      tone: 'calm',
    },
    restore_success: {
      text: 'Subscription restored.',
      tone: 'success',
    },
    unconfirmed: {
      text: 'Lotly couldn’t confirm your subscription. Check your connection and try again.',
      tone: 'alert',
    },
  };

/** A footer destination that has no configured URL in this build. */
export const DESTINATION_UNCONFIGURED = 'This link is not available yet.';

// ── Derived price text ──────────────────────────────────────────────────────

/**
 * A derived amount in the store's currency, formatted for the device's
 * locale. Null when the platform cannot format the currency, in which case
 * the equivalent line is simply omitted — never a wrong symbol.
 */
export function formatDerivedPrice(
  amount: number,
  currencyCode: string,
  locale?: string,
): string | null {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode }).format(
      amount,
    );
  } catch {
    return null;
  }
}

/** `$2.50/month` for an annual package, or null when it cannot be derived. */
export function monthlyEquivalentLine(annual: PlanPackage, locale?: string): string | null {
  const amount = monthlyEquivalentAmount(annual);
  if (amount === null) return null;
  const formatted = formatDerivedPrice(amount, annual.price.currencyCode, locale);
  return formatted === null ? null : `${formatted}${PERIOD_SUFFIX.monthly}`;
}

/** `Save 50%`, or null when the store's prices show no saving. */
export function savingsLine(offering: Offering): string | null {
  const percent = annualSavingsPercent(offering);
  return percent === null || percent <= 0 ? null : `Save ${percent}%`;
}

/** `$29.99/year` — the store's string, the contract's suffix. */
export function priceLine(pkg: PlanPackage): string {
  return `${pkg.price.formatted}${PERIOD_SUFFIX[pkg.period]}`;
}

/** The primary action names the selected commitment: `Subscribe for $29.99/year`. */
export function subscribeLabel(pkg: PlanPackage): string {
  return `Subscribe for ${priceLine(pkg)}`;
}

// ── The view and its presentation ───────────────────────────────────────────

export type PaywallOperation = 'idle' | 'purchasing' | 'restoring';

export interface PaywallView {
  offerings: OfferingsResult | { kind: 'loading' };
  selectedPlan: PlanPeriod;
  operation: PaywallOperation;
  notice: PaywallNoticeKind | null;
  /** The gate could not confirm the entitlement (lib/entitlement.ts). */
  unconfirmed: boolean;
}

export interface PlanCardPresentation {
  period: PlanPeriod;
  title: string;
  priceLine: string;
  /** The monthly equivalent for the annual plan; null for monthly or when underivable. */
  equivalentLine: string | null;
  badge: string | null;
  savings: string | null;
  selected: boolean;
  /** Spoken: everything the card shows, in one sentence. */
  accessibilityLabel: string;
}

export interface PaywallPresentation {
  /** The two cards, or null while there is no offering to show. */
  plans: PlanCardPresentation[] | null;
  /** The line shown in place of the plans while loading, unavailable or errored. */
  offeringMessage: string | null;
  cta: { label: string; enabled: boolean; busy: boolean; busyLabel: string };
  restore: { label: string; enabled: boolean; busy: boolean; busyLabel: string };
  notice: { kind: PaywallNoticeKind; text: string; tone: PaywallNoticeTone } | null;
  footer: readonly PaywallFooterAction[];
}

export function planCard(
  offering: Offering,
  period: PlanPeriod,
  selected: boolean,
  locale?: string,
): PlanCardPresentation {
  const pkg = offering[period];
  const price = priceLine(pkg);
  const equivalentLine = period === 'annual' ? monthlyEquivalentLine(pkg, locale) : null;
  const badge = period === 'annual' ? BEST_VALUE_LABEL : null;
  const savings = period === 'annual' ? savingsLine(offering) : null;
  const spoken = [
    `${PLAN_TITLES[period]}, ${price}`,
    equivalentLine,
    badge === null ? null : BEST_VALUE_ACCESSIBILITY_LABEL,
    savings,
  ]
    .filter((part): part is string => part !== null)
    .join('. ');
  return {
    period,
    title: PLAN_TITLES[period],
    priceLine: price,
    equivalentLine,
    badge,
    savings,
    selected,
    accessibilityLabel: `${spoken}.`,
  };
}

export function paywallPresentation(view: PaywallView, locale?: string): PaywallPresentation {
  const busy = view.operation !== 'idle';
  const offering = view.offerings.kind === 'ready' ? view.offerings.offering : null;
  const selected = offering === null ? null : offering[view.selectedPlan];

  const offeringMessage =
    view.offerings.kind === 'loading'
      ? OFFERING_LOADING
      : view.offerings.kind === 'unavailable'
        ? OFFERING_UNAVAILABLE
        : view.offerings.kind === 'error'
          ? OFFERING_ERROR
          : null;

  // The unconfirmed entitlement is a notice of its own, but an operation's
  // outcome is more recent and takes the slot while it stands.
  const noticeKind: PaywallNoticeKind | null =
    view.notice ?? (view.unconfirmed ? 'unconfirmed' : null);

  return {
    plans:
      offering === null
        ? null
        : (['annual', 'monthly'] as const).map((period) =>
            planCard(offering, period, period === view.selectedPlan, locale),
          ),
    offeringMessage,
    cta: {
      label: selected === null ? SUBSCRIBE_UNAVAILABLE_LABEL : subscribeLabel(selected),
      enabled: selected !== null && !busy,
      busy: view.operation === 'purchasing',
      busyLabel: SUBSCRIBE_BUSY_LABEL,
    },
    restore: {
      label: PAYWALL_FOOTER_ACTIONS[0].label,
      enabled: !busy,
      busy: view.operation === 'restoring',
      busyLabel: RESTORE_BUSY_LABEL,
    },
    notice: noticeKind === null ? null : { kind: noticeKind, ...PAYWALL_NOTICES[noticeKind] },
    footer: PAYWALL_FOOTER_ACTIONS,
  };
}

/** The opening view: offering loading, Annual preselected, nothing in flight. */
export function initialPaywallView(
  selectedPlan: PlanPeriod = 'annual',
  unconfirmed = false,
): PaywallView {
  return {
    offerings: { kind: 'loading' },
    selectedPlan,
    operation: 'idle',
    notice: null,
    unconfirmed,
  };
}
