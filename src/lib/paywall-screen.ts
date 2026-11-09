/**
 * The hard paywall's copy and its state → presentation mapping (P2B7X.1;
 * one lifetime purchase since 2026-11-06), kept out of the screen so every
 * state is one tested contract.
 *
 * ## What the screen shows
 *
 * The founder's note and two benefits (lib/onboarding-paywall-presentation.ts);
 * the one offer — `Lifetime access`, `Pay once. No subscription.` and the
 * store's own localized price on the lime capsule; one primary action, `Get
 * lifetime access`; and four footer actions
 * that are ALWAYS available before a purchase — Restore Purchases, Terms,
 * Privacy, Support.
 *
 * ## What it never shows
 *
 * No close, skip, dismiss or "continue free" route; no trial, countdown,
 * crossed-out price or scarcity. There is one way past the paywall — a
 * verified purchase or restore — and one way back, to the Preview.
 * `paywall-screen.test.ts` pins the words.
 *
 * ## Prices
 *
 * The one price a shopper reads is the store's own `formatted` string for
 * the lifetime product, passed through verbatim. Nothing derives a figure
 * from it, and no product module holds a literal price. While the store has
 * not answered, or cannot, there is no price and the action is inert: no
 * placeholder price is ever purchasable.
 *
 * A leaf: copy, types and pure functions.
 */

import type { OfferingsResult } from './purchases/purchase-provider';

// ── Copy (founder-approved, 2026-11-06: the Fridge Note kit's copy.json) ────

export const OFFER_TITLE = 'Lifetime access';
export const OFFER_SUBTITLE = 'Pay once. No subscription.';
export const PURCHASE_CTA_LABEL = 'Get lifetime access';

export const PURCHASE_BUSY_LABEL = 'Purchasing…';
export const RESTORE_BUSY_LABEL = 'Restoring…';

/**
 * Where the offer and the four footer actions sit. In the sticky footer
 * while it stays a modest share of the screen; otherwise they move into the
 * scrolling content directly above the primary action, so the letter stays
 * comfortably readable. Two rules, either of which moves them:
 *
 *   - from the accessibility sizes (a text scale of 1.5, the threshold the
 *     settings selector row stacks at), on any screen;
 *   - when the sticky footer would take more than `MAX_STICKY_FOOTER_SHARE`
 *     of the window's height (revision 2, 2026-11-07: on an iPhone SE at
 *     xxxLarge it took over half the screen). Its height is estimated from
 *     `STICKY_FOOTER_POINTS` — measured on the iPhone 17 at the default size
 *     (offer, action, links and closing note, without the bottom inset) —
 *     scaled by the reader's text size, so the rule is pure and cannot
 *     oscillate the way a measured layout would.
 *
 * The notice and the primary action stay pinned (`inline`) — unless even
 * they would take more than `MAX_PINNED_ACTION_SHARE` of the window, as at
 * the largest accessibility sizes, where the three-line 51pt pill took 30%
 * of an iPhone 17 and 42% of an SE (revision 2). Then nothing is pinned
 * (`scrolling`): the notice and the action follow the price in the page,
 * one scroll away, in the same reading order. `PINNED_ACTION_POINTS` is the
 * pinned action's measured share per unit of text scale (264pt at AX5,
 * text scale 3.1, without the bottom inset).
 *
 * (The `One-time payment. No recurring charges.` disclosure was removed in
 * revision 2: `Pay once. No subscription.` already says it.)
 */
export const INLINE_FOOTER_AT_SCALE = 1.5;
export const STICKY_FOOTER_POINTS = 200;
export const MAX_STICKY_FOOTER_SHARE = 0.4;
export const PINNED_ACTION_POINTS = 85;
export const MAX_PINNED_ACTION_SHARE = 0.25;

export type PaywallFooterPlacement = 'sticky' | 'inline' | 'scrolling';

export function paywallFooterPlacement(
  fontScale: number,
  windowHeight: number = Number.POSITIVE_INFINITY,
): PaywallFooterPlacement {
  if (PINNED_ACTION_POINTS * fontScale > MAX_PINNED_ACTION_SHARE * windowHeight) {
    return 'scrolling';
  }
  if (fontScale >= INLINE_FOOTER_AT_SCALE) return 'inline';
  return STICKY_FOOTER_POINTS * fontScale > MAX_STICKY_FOOTER_SHARE * windowHeight
    ? 'inline'
    : 'sticky';
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

/** While the offering loads: where the price would be. */
export const OFFERING_LOADING = 'Loading the price…';
/** The store could not be reached, or no lifetime product is configured. */
export const OFFERING_UNAVAILABLE =
  'Lifetime access is temporarily unavailable. Check your connection and try again.';
/** The store answered with a retryable error. */
export const OFFERING_ERROR = 'Lotly couldn’t load the price. Check your connection and try again.';

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
      text: 'Purchase cancelled. Nothing was charged.',
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
      text: 'No Lotly purchase or subscription was found for this Apple Account.',
      tone: 'calm',
    },
    restore_success: {
      text: 'Your Lotly access was restored.',
      tone: 'success',
    },
    unconfirmed: {
      text: 'Lotly couldn’t confirm your access. Check your connection and try again.',
      tone: 'alert',
    },
  };

/** The paywall's closing line (the kit's copy; the app's longer note says the same elsewhere). */
export const PAYWALL_INDEPENDENCE_NOTE = 'Independent of the FDA and USDA.';

/** A footer destination that has no configured URL in this build. */
export const DESTINATION_UNCONFIGURED = 'This link is not available yet.';

// ── The view and its presentation ───────────────────────────────────────────

export type PaywallOperation = 'idle' | 'purchasing' | 'restoring';

export interface PaywallView {
  offerings: OfferingsResult | { kind: 'loading' };
  operation: PaywallOperation;
  notice: PaywallNoticeKind | null;
  /** The gate could not confirm the entitlement (lib/entitlement.ts). */
  unconfirmed: boolean;
}

/** The one offer, once the store has priced it. */
export interface OfferPresentation {
  title: string;
  subtitle: string;
  /** The store's own localized string, verbatim. */
  price: string;
  /** Spoken as one element: the offer, its terms and its price. */
  accessibilityLabel: string;
}

export interface PaywallPresentation {
  /** The offer, or null while there is no price to show. */
  offer: OfferPresentation | null;
  /** The line shown in place of the price while loading, unavailable or errored. */
  offeringMessage: string | null;
  cta: { label: string; enabled: boolean; busy: boolean; busyLabel: string };
  restore: { label: string; enabled: boolean; busy: boolean; busyLabel: string };
  notice: { kind: PaywallNoticeKind; text: string; tone: PaywallNoticeTone } | null;
  footer: readonly PaywallFooterAction[];
}

export function paywallPresentation(view: PaywallView): PaywallPresentation {
  const busy = view.operation !== 'idle';
  const lifetime = view.offerings.kind === 'ready' ? view.offerings.offering.lifetime : null;

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
    offer:
      lifetime === null
        ? null
        : {
            title: OFFER_TITLE,
            subtitle: OFFER_SUBTITLE,
            price: lifetime.price.formatted,
            accessibilityLabel: `${OFFER_TITLE}, ${lifetime.price.formatted}. ${OFFER_SUBTITLE}`,
          },
    offeringMessage,
    cta: {
      label: PURCHASE_CTA_LABEL,
      enabled: lifetime !== null && !busy,
      busy: view.operation === 'purchasing',
      busyLabel: PURCHASE_BUSY_LABEL,
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

/** The opening view: offering loading, nothing in flight. */
export function initialPaywallView(unconfirmed = false): PaywallView {
  return {
    offerings: { kind: 'loading' },
    operation: 'idle',
    notice: null,
    unconfirmed,
  };
}
