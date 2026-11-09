/**
 * The paywall's copy and presentation (P2B7X.1; one lifetime purchase since
 * 2026-11-06): the words the founder fixed, the store's own price passed
 * through verbatim, the state matrix, and the absence of every route the
 * brief forbids.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  DESTINATION_UNCONFIGURED,
  initialPaywallView,
  OFFER_SUBTITLE,
  OFFER_TITLE,
  OFFERING_ERROR,
  OFFERING_LOADING,
  OFFERING_UNAVAILABLE,
  PAYWALL_FOOTER_ACTIONS,
  PAYWALL_INDEPENDENCE_NOTE,
  PAYWALL_NOTICES,
  paywallFooterPlacement,
  paywallPresentation,
  PURCHASE_CTA_LABEL,
  type PaywallView,
} from './paywall-screen';
import { DEVELOPMENT_OFFERING, LONG_PRICE_OFFERING } from './purchases/development-scenarios';

const SRC = join(__dirname, '..');
const read = (...parts: string[]) => readFileSync(join(SRC, ...parts), 'utf8');

function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

const ready = (overrides: Partial<PaywallView> = {}): PaywallView => ({
  offerings: { kind: 'ready', offering: DEVELOPMENT_OFFERING },
  operation: 'idle',
  notice: null,
  unconfirmed: false,
  ...overrides,
});

// ── Copy ────────────────────────────────────────────────────────────────────

test('the founder’s purchase copy, verbatim from the kit', () => {
  assert.equal(OFFER_TITLE, 'Lifetime access');
  assert.equal(OFFER_SUBTITLE, 'Pay once. No subscription.');
  assert.equal(PURCHASE_CTA_LABEL, 'Get lifetime access');
  assert.equal(PAYWALL_INDEPENDENCE_NOTE, 'Independent of the FDA and USDA.');
  assert.deepEqual(
    PAYWALL_FOOTER_ACTIONS.map((a) => a.label),
    ['Restore Purchases', 'Terms', 'Privacy', 'Support'],
  );
});

test('no notice, label or action offers a trial, a free route, a countdown, fake scarcity or a renewal', () => {
  const words = [
    ...Object.values(PAYWALL_NOTICES).map((n) => n.text),
    OFFERING_LOADING,
    OFFERING_UNAVAILABLE,
    OFFERING_ERROR,
    OFFER_TITLE,
    OFFER_SUBTITLE,
    PURCHASE_CTA_LABEL,
    ...PAYWALL_FOOTER_ACTIONS.map((a) => a.label),
  ].join('\n');
  for (const forbidden of [
    /\btrial\b/i,
    /\bfree\b/i,
    /\bonly \d+ left\b/i,
    /\bexpires in\b/i,
    /\bhurry\b/i,
    /\blimited time\b/i,
    /\bskip\b/i,
    /\bmaybe later\b/i,
    /\bcontinue without\b/i,
    // A one-time purchase: nothing renews, and nothing is cancelled in settings.
    /\brenews?\b/i,
    /\bcancel anytime\b/i,
    /\bper (year|month)\b/i,
    /\/(year|month)\b/i,
  ]) {
    assert.doesNotMatch(words, forbidden);
  }
  for (const text of words.split('\n')) assert.ok(!text.includes('—'), text);
});

// ── The price ───────────────────────────────────────────────────────────────

test('the offer shows the store’s own localized price, verbatim, and speaks it with its terms', () => {
  const shown = paywallPresentation(ready());
  assert.deepEqual(shown.offer, {
    title: 'Lifetime access',
    subtitle: 'Pay once. No subscription.',
    price: '$19.99',
    accessibilityLabel: 'Lifetime access, $19.99. Pay once. No subscription.',
  });
  // A long localized price passes through untouched.
  assert.equal(
    paywallPresentation(ready({ offerings: { kind: 'ready', offering: LONG_PRICE_OFFERING } }))
      .offer?.price,
    'Rp 329.000,00',
  );
  // The action never carries a price of its own.
  assert.equal(shown.cta.label, 'Get lifetime access');
});

test('no placeholder price is ever purchasable: without the store’s answer there is no price and the action is inert', () => {
  for (const offerings of [
    { kind: 'loading' as const },
    { kind: 'unavailable' as const },
    { kind: 'error' as const },
  ]) {
    const shown = paywallPresentation(ready({ offerings }));
    assert.equal(shown.offer, null, offerings.kind);
    assert.equal(shown.cta.enabled, false, offerings.kind);
    assert.equal(shown.footer.length, 4, offerings.kind);
  }
  assert.equal(
    paywallPresentation(ready({ offerings: { kind: 'loading' } })).offeringMessage,
    OFFERING_LOADING,
  );
  assert.equal(
    paywallPresentation(ready({ offerings: { kind: 'unavailable' } })).offeringMessage,
    OFFERING_UNAVAILABLE,
  );
  assert.equal(
    paywallPresentation(ready({ offerings: { kind: 'error' } })).offeringMessage,
    OFFERING_ERROR,
  );
});

// ── The state matrix ────────────────────────────────────────────────────────

test('the opening view loads with nothing in flight and the footer present', () => {
  assert.deepEqual(initialPaywallView(), {
    offerings: { kind: 'loading' },
    operation: 'idle',
    notice: null,
    unconfirmed: false,
  });
  const shown = paywallPresentation(initialPaywallView());
  assert.equal(shown.offer, null);
  assert.equal(shown.cta.enabled, false);
  assert.equal(shown.cta.label, 'Get lifetime access');
  assert.deepEqual(
    shown.footer.map((a) => a.key),
    ['restore', 'terms', 'privacy', 'support'],
  );
  assert.equal(shown.restore.enabled, true);
  assert.equal(initialPaywallView(true).unconfirmed, true);
});

test('purchase in progress: the CTA is busy with its word and Restore is inert; restoring is the mirror', () => {
  const purchasing = paywallPresentation(ready({ operation: 'purchasing' }));
  assert.equal(purchasing.cta.busy, true);
  assert.equal(purchasing.cta.busyLabel, 'Purchasing…');
  assert.equal(purchasing.cta.enabled, false);
  assert.equal(purchasing.restore.enabled, false);
  const restoring = paywallPresentation(ready({ operation: 'restoring' }));
  assert.equal(restoring.restore.busy, true);
  assert.equal(restoring.restore.busyLabel, 'Restoring…');
  assert.equal(restoring.cta.enabled, false);
});

test('every outcome has its notice and tone: calm for a cancellation and an empty restore, alert for errors, success for a restore', () => {
  const tones = Object.fromEntries(
    (Object.keys(PAYWALL_NOTICES) as (keyof typeof PAYWALL_NOTICES)[]).map((kind) => [
      kind,
      paywallPresentation(ready({ notice: kind })).notice?.tone,
    ]),
  );
  assert.deepEqual(tones, {
    cancelled: 'calm',
    purchase_error: 'alert',
    purchase_unavailable: 'alert',
    restore_error: 'alert',
    restore_unavailable: 'alert',
    restore_nothing: 'calm',
    restore_success: 'success',
    unconfirmed: 'alert',
  });
  assert.match(PAYWALL_NOTICES.cancelled.text, /Nothing was charged/);
  assert.match(PAYWALL_NOTICES.purchase_error.text, /try again/);
  // Restore finds a lifetime purchase OR an earlier subscription.
  assert.equal(
    PAYWALL_NOTICES.restore_nothing.text,
    'No Lotly purchase or subscription was found for this Apple Account.',
  );
  // A cancellation leaves the action enabled.
  assert.equal(paywallPresentation(ready({ notice: 'cancelled' })).cta.enabled, true);
});

test('an unconfirmed entitlement shows the could-not-confirm notice until an outcome replaces it', () => {
  const shown = paywallPresentation(ready({ unconfirmed: true }));
  assert.equal(shown.notice?.kind, 'unconfirmed');
  const after = paywallPresentation(ready({ unconfirmed: true, notice: 'cancelled' }));
  assert.equal(after.notice?.kind, 'cancelled');
});

// ── The screen ──────────────────────────────────────────────────────────────

test('the footer: sticky while it stays a modest share of the screen, then inline, then nothing pinned', () => {
  // iOS text scales: Large (the default) 1, xxxLarge about 1.35, AX Medium
  // about 1.6, AX5 about 3.1. 402×874 is an iPhone 17, 375×667 an SE.
  const IPHONE_17 = 874;
  const SE = 667;
  // iPhone 17: sticky through xxxLarge; the offer and terms go inline from
  // the accessibility sizes; at AX4–AX5 the action follows them.
  for (const scale of [0.85, 1, 1.12, 1.23, 1.35, 1.49]) {
    assert.equal(paywallFooterPlacement(scale, IPHONE_17), 'sticky', `17 at ${scale}`);
  }
  for (const scale of [1.5, 1.6, 1.9, 2.35]) {
    assert.equal(paywallFooterPlacement(scale, IPHONE_17), 'inline', `17 at ${scale}`);
  }
  for (const scale of [2.75, 3.1]) {
    assert.equal(paywallFooterPlacement(scale, IPHONE_17), 'scrolling', `17 at ${scale}`);
  }
  // SE: the sticky footer would take over 40% of the screen at xxxLarge, so
  // the offer and terms go inline already there (it took over half before);
  // from AX3 even the pinned action would crowd it.
  for (const scale of [1, 1.12, 1.23]) {
    assert.equal(paywallFooterPlacement(scale, SE), 'sticky', `SE at ${scale}`);
  }
  for (const scale of [1.35, 1.6, 1.9]) {
    assert.equal(paywallFooterPlacement(scale, SE), 'inline', `SE at ${scale}`);
  }
  for (const scale of [2.35, 3.1]) {
    assert.equal(paywallFooterPlacement(scale, SE), 'scrolling', `SE at ${scale}`);
  }
  // With no height known, the text-scale threshold alone decides.
  assert.equal(paywallFooterPlacement(1.49), 'sticky');
  assert.equal(paywallFooterPlacement(1.5), 'inline');
});

test('the paywall panel has no close, skip or dismiss control and renders all four footer actions', () => {
  const panel = codeOnly(read('components', 'paywall', 'paywall-panel.tsx'));
  const onboarding = codeOnly(read('components', 'paywall', 'onboarding-paywall-panel.tsx'));
  for (const forbidden of [
    'Close',
    'dismiss',
    'Dismiss',
    'skip',
    'Skip',
    'Maybe later',
    'x-icon',
    'onRequestClose',
  ]) {
    assert.ok(!onboarding.includes(forbidden), `the paywall offers ${forbidden}`);
    assert.ok(!panel.includes(forbidden), `the purchase pieces offer ${forbidden}`);
  }
  assert.ok(!panel.includes('close'));
  assert.ok(onboarding.includes('usePurchaseFooterSlots(purchase, {'));
  assert.ok(
    onboarding.includes(
      'back={{ label: PAYWALL_BACK_LABEL, hint: PAYWALL_BACK_HINT, onPress: onBack }}',
    ),
  );
  assert.ok(panel.includes('shown.footer.map((action) =>'));
  // The one-time-payment line was removed beneath the action (revision 2):
  // `Pay once. No subscription.` says it once, in the offer.
  assert.ok(!panel.includes('PAYWALL_DISCLOSURE'));
  assert.ok(!panel.includes('No recurring charges'));
  // The standalone route composes the SAME panel; Back exists, and it is the
  // ONE way back: to the Preview, through the gate.
  const route = codeOnly(read('app', 'paywall.tsx'));
  assert.ok(
    /<OnboardingPaywallPanel\s+purchase={purchase}\s+onBack={access.reviewPreview}\s+benefitLift={STANDALONE_BENEFIT_LIFT}>/.test(
      route,
    ),
  );
  assert.ok(!/<PaywallPanel\b/.test(route), 'the retired standalone panel is back');
  // Terms, Privacy and Support open a configured HTTPS destination or say so,
  // in the one purchase flow both paywall routes use.
  const flow = codeOnly(read('hooks', 'use-purchase-flow.tsx'));
  assert.ok(flow.includes('destinationAction(key)'));
  assert.ok(flow.includes('setDestinationNotice(DESTINATION_UNCONFIGURED)'));
  assert.equal(DESTINATION_UNCONFIGURED, 'This link is not available yet.');
  assert.ok(!flow.includes('example.com'));
  // The flow buys the one lifetime package the store priced, nothing else.
  assert.ok(flow.includes('const pkg = view.offerings.offering.lifetime;'));
});

test('the paywall draws from the tokens: no raw hex, no capped type, no fixed height around text', () => {
  for (const file of ['paywall-panel.tsx', 'onboarding-paywall-panel.tsx']) {
    const panel = codeOnly(read('components', 'paywall', file));
    assert.doesNotMatch(panel, /#[0-9A-Fa-f]{6}\b/, file);
    assert.ok(!panel.includes('maxFontSizeMultiplier'), file);
    assert.ok(!panel.includes('numberOfLines'), file);
    assert.ok(!panel.includes('adjustsFontSizeToFit'), file);
    assert.doesNotMatch(panel, /\n\s+height: \d+,/, file);
  }
});
