/**
 * The paywall's copy and presentation (P2B7X.1): the words the founder
 * fixed, the store-price rendering, the savings and monthly equivalent, the
 * state matrix, and the absence of every route the brief forbids.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  BEST_VALUE_LABEL,
  DESTINATION_UNCONFIGURED,
  formatDerivedPrice,
  initialPaywallView,
  monthlyEquivalentLine,
  OFFERING_LOADING,
  OFFERING_UNAVAILABLE,
  PAYWALL_BENEFITS,
  PAYWALL_BODY,
  PAYWALL_DISCLOSURE,
  PAYWALL_FOOTER_ACTIONS,
  PAYWALL_HEADLINE,
  PAYWALL_NOTICES,
  paywallFooterPlacement,
  paywallPresentation,
  planCard,
  priceLine,
  savingsLine,
  subscribeLabel,
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
  selectedPlan: 'annual',
  operation: 'idle',
  notice: null,
  unconfirmed: false,
  ...overrides,
});

// ── Copy ────────────────────────────────────────────────────────────────────

test('the founder’s paywall copy, verbatim', () => {
  assert.equal(PAYWALL_HEADLINE, 'Recall alerts, personalized for you.');
  assert.equal(PAYWALL_BODY, 'Get full access to Lotly’s personalized recall monitoring.');
  assert.deepEqual(PAYWALL_BENEFITS, [
    'See which recalls affect you',
    'Get matching recall notifications',
    'Search, save, and view full details',
  ]);
  assert.equal(BEST_VALUE_LABEL, 'BEST VALUE');
  assert.equal(
    PAYWALL_DISCLOSURE,
    'Renews automatically. Cancel anytime in Apple Account settings.',
  );
  assert.deepEqual(
    PAYWALL_FOOTER_ACTIONS.map((a) => a.label),
    ['Restore Purchases', 'Terms', 'Privacy', 'Support'],
  );
});

test('no notice, label or action offers a trial, a lifetime plan, a free route, a countdown or fake scarcity', () => {
  const words = [
    ...Object.values(PAYWALL_NOTICES).map((n) => n.text),
    PAYWALL_HEADLINE,
    PAYWALL_BODY,
    ...PAYWALL_BENEFITS,
    PAYWALL_DISCLOSURE,
    OFFERING_LOADING,
    OFFERING_UNAVAILABLE,
    ...PAYWALL_FOOTER_ACTIONS.map((a) => a.label),
  ].join('\n');
  for (const forbidden of [
    /\btrial\b/i,
    /\blifetime\b/i,
    /\bfree\b/i,
    /\bonly \d+ left\b/i,
    /\bexpires in\b/i,
    /\bhurry\b/i,
    /\blimited time\b/i,
    /\bskip\b/i,
    /\bmaybe later\b/i,
    /\bcontinue without\b/i,
  ]) {
    assert.doesNotMatch(words, forbidden);
  }
  for (const text of words.split('\n')) assert.ok(!text.includes('—'), text);
});

// ── Prices ──────────────────────────────────────────────────────────────────

test('the primary action names the selected commitment with the store’s own price string', () => {
  assert.equal(priceLine(DEVELOPMENT_OFFERING.annual), '$29.99/year');
  assert.equal(priceLine(DEVELOPMENT_OFFERING.monthly), '$4.99/month');
  assert.equal(subscribeLabel(DEVELOPMENT_OFFERING.annual), 'Subscribe for $29.99/year');
  assert.equal(subscribeLabel(DEVELOPMENT_OFFERING.monthly), 'Subscribe for $4.99/month');
  // A long localized price passes through untouched.
  assert.equal(subscribeLabel(LONG_PRICE_OFFERING.annual), 'Subscribe for Rp 499.000,00/year');
});

test('the monthly equivalent and the saving are derived from the store prices in the store currency', () => {
  assert.equal(formatDerivedPrice(29.99 / 12, 'USD', 'en-US'), '$2.50');
  assert.equal(monthlyEquivalentLine(DEVELOPMENT_OFFERING.annual, 'en-US'), '$2.50/month');
  assert.equal(savingsLine(DEVELOPMENT_OFFERING), 'Save 50%');
  // Another currency, another saving — nothing here knows "50".
  assert.equal(savingsLine(LONG_PRICE_OFFERING), 'Save 47%');
  assert.equal(
    formatDerivedPrice(1, 'NOT_A_CURRENCY'),
    null,
    'an unformattable currency omits the line',
  );
});

test('the two cards: Annual first with BEST VALUE, the equivalent and the saving; Monthly plain', () => {
  const annual = planCard(DEVELOPMENT_OFFERING, 'annual', true, 'en-US');
  assert.equal(annual.title, 'Annual');
  assert.equal(annual.priceLine, '$29.99/year');
  assert.equal(annual.equivalentLine, '$2.50/month');
  assert.equal(annual.badge, 'BEST VALUE');
  assert.equal(annual.savings, 'Save 50%');
  assert.equal(annual.selected, true);
  assert.equal(
    annual.accessibilityLabel,
    'Annual, $29.99/year. $2.50/month. Best value. Save 50%.',
  );
  const monthly = planCard(DEVELOPMENT_OFFERING, 'monthly', false, 'en-US');
  assert.equal(monthly.title, 'Monthly');
  assert.equal(monthly.priceLine, '$4.99/month');
  assert.equal(monthly.equivalentLine, null);
  assert.equal(monthly.badge, null);
  assert.equal(monthly.savings, null);
  assert.equal(monthly.accessibilityLabel, 'Monthly, $4.99/month.');
});

// ── The state matrix ────────────────────────────────────────────────────────

test('the opening view loads with Annual preselected', () => {
  assert.deepEqual(initialPaywallView(), {
    offerings: { kind: 'loading' },
    selectedPlan: 'annual',
    operation: 'idle',
    notice: null,
    unconfirmed: false,
  });
  const shown = paywallPresentation(initialPaywallView());
  assert.equal(shown.plans, null);
  assert.equal(shown.offeringMessage, OFFERING_LOADING);
  assert.equal(shown.cta.enabled, false);
  assert.equal(shown.cta.label, 'Subscribe');
  // The four footer actions are present before anything is bought, even while loading.
  assert.deepEqual(
    shown.footer.map((a) => a.key),
    ['restore', 'terms', 'privacy', 'support'],
  );
  assert.equal(shown.restore.enabled, true);
});

test('annual and monthly selected: the CTA follows the selection, both cards render, one is checked', () => {
  const annual = paywallPresentation(ready(), 'en-US');
  assert.equal(annual.cta.label, 'Subscribe for $29.99/year');
  assert.equal(annual.cta.enabled, true);
  assert.deepEqual(
    annual.plans?.map((p) => [p.period, p.selected]),
    [
      ['annual', true],
      ['monthly', false],
    ],
  );
  const monthly = paywallPresentation(ready({ selectedPlan: 'monthly' }), 'en-US');
  assert.equal(monthly.cta.label, 'Subscribe for $4.99/month');
  assert.deepEqual(
    monthly.plans?.map((p) => [p.period, p.selected]),
    [
      ['annual', false],
      ['monthly', true],
    ],
  );
});

test('purchase in progress: the CTA is busy with its word and Restore is inert; restoring is the mirror', () => {
  const purchasing = paywallPresentation(ready({ operation: 'purchasing' }));
  assert.equal(purchasing.cta.busy, true);
  assert.equal(purchasing.cta.busyLabel, 'Subscribing…');
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
  assert.equal(
    paywallPresentation(ready({ notice: 'cancelled' })).notice?.text,
    PAYWALL_NOTICES.cancelled.text,
  );
  assert.match(PAYWALL_NOTICES.cancelled.text, /Nothing was charged/);
  assert.match(PAYWALL_NOTICES.purchase_error.text, /try again/);
  // A cancellation leaves the plans selectable and the CTA enabled.
  assert.equal(paywallPresentation(ready({ notice: 'cancelled' })).cta.enabled, true);
});

test('provider temporarily unavailable: one honest line where the plans would be, Subscribe inert, the footer intact', () => {
  const shown = paywallPresentation(ready({ offerings: { kind: 'unavailable' } }));
  assert.equal(shown.plans, null);
  assert.equal(shown.offeringMessage, OFFERING_UNAVAILABLE);
  assert.equal(shown.cta.enabled, false);
  assert.equal(shown.footer.length, 4);
});

test('an unconfirmed entitlement shows the could-not-confirm notice until an outcome replaces it', () => {
  const shown = paywallPresentation(ready({ unconfirmed: true }));
  assert.equal(shown.notice?.kind, 'unconfirmed');
  const after = paywallPresentation(ready({ unconfirmed: true, notice: 'cancelled' }));
  assert.equal(after.notice?.kind, 'cancelled');
});

// ── The screen ──────────────────────────────────────────────────────────────

test('the disclosure and footer actions stay sticky at ordinary text sizes and move inline from the accessibility sizes', () => {
  // iOS text scales: Large (the default) through xxxLarge stay sticky;
  // AX Medium (about 1.6) and above go inline. 1.5 is the shared threshold.
  for (const scale of [0.85, 1, 1.12, 1.23, 1.35, 1.49]) {
    assert.equal(paywallFooterPlacement(scale), 'sticky', `scale ${scale}`);
  }
  for (const scale of [1.5, 1.6, 1.9, 2.35, 2.75, 3.1]) {
    assert.equal(paywallFooterPlacement(scale), 'inline', `scale ${scale}`);
  }
});

test('the paywall panel has no close, skip or dismiss control and renders all four footer actions', () => {
  const panel = codeOnly(read('components', 'paywall', 'paywall-panel.tsx'));
  for (const forbidden of [
    'close',
    'Close',
    'dismiss',
    'Dismiss',
    'skip',
    'Skip',
    'Maybe later',
    'x-icon',
    'onRequestClose',
  ]) {
    assert.ok(!panel.includes(forbidden), `the paywall offers ${forbidden}`);
  }
  assert.ok(panel.includes('shown.footer.map((action) =>'));
  assert.ok(panel.includes('<BenefitList items={PAYWALL_BENEFITS} />'));
  assert.ok(panel.includes('{PAYWALL_DISCLOSURE}'));
  // Back exists, and it is the ONE way back: to the Preview, through the gate.
  assert.ok(
    panel.includes(
      'back={{ label: PAYWALL_BACK_LABEL, hint: PAYWALL_BACK_HINT, onPress: onBack }}',
    ),
  );
  const route = codeOnly(read('app', 'paywall.tsx'));
  assert.ok(route.includes('onBack={access.reviewPreview}'));
  // Terms, Privacy and Support open a configured HTTPS destination or say so.
  assert.ok(route.includes('destinationAction(key)'));
  assert.ok(route.includes('setDestinationNotice(DESTINATION_UNCONFIGURED)'));
  assert.equal(DESTINATION_UNCONFIGURED, 'This link is not available yet.');
  assert.ok(!route.includes('example.com'));
});

test('the paywall draws from the tokens: no raw hex, no capped type, no fixed height around text', () => {
  const panel = codeOnly(read('components', 'paywall', 'paywall-panel.tsx'));
  assert.doesNotMatch(panel, /#[0-9A-Fa-f]{6}\b/);
  assert.ok(!panel.includes('maxFontSizeMultiplier'));
  assert.doesNotMatch(panel, /\n\s+height: \d+,/);
});
