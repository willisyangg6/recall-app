/**
 * The onboarding (grocery-watch) paywall's presentation contract
 * (2026-10-01): the approved copy, the plan cards drawn from the store's own
 * prices, the chosen plan following through to the action and the
 * disclosure, and the measured rules that place the hero under the headline.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { typography } from '@/constants/design-tokens';

import {
  atAccessibilitySize,
  headlineMeasure,
  headlineType,
  heroHeight,
  heroOverlap,
  HEADLINE_HERO_GAP,
  headlineTopClearance,
  HERO_TOP_ABOVE_LAST_BASELINE_PX,
  ONBOARDING_PAYWALL_BENEFITS,
  ONBOARDING_PAYWALL_HEADLINE,
  onboardingPlanCards,
  PAYWALL_TYPE,
  RENEWAL_DISCLOSURE,
  renewalDisclosure,
} from './onboarding-paywall-presentation';
import {
  initialPaywallView,
  PAYWALL_DISCLOSURE,
  paywallPresentation,
  type PaywallView,
} from './paywall-screen';
import type { Offering } from './purchases/purchase-provider';
import { DEVELOPMENT_OFFERING, LONG_PRICE_OFFERING } from './purchases/development-scenarios';

function ready(offering: Offering, overrides: Partial<PaywallView> = {}): PaywallView {
  return { ...initialPaywallView(), offerings: { kind: 'ready', offering }, ...overrides };
}

test('the approved copy, verbatim', () => {
  assert.equal(ONBOARDING_PAYWALL_HEADLINE, 'Keep a closer watch.');
  assert.deepEqual(
    ONBOARDING_PAYWALL_BENEFITS.map(({ icon, title, body }) => [icon, title, body]),
    [
      ['file-search', 'See recalls that match you', 'Based on your states, allergens and stores.'],
      ['bell', 'Get matching recall alerts', 'Notifications tailored to your preferences.'],
      ['bookmark', 'Know what to check', 'Search, save and view full recall details.'],
    ],
  );
  assert.equal(
    RENEWAL_DISCLOSURE.annual,
    'Renews yearly. Cancel anytime in Apple Account settings.',
  );
  assert.equal(
    RENEWAL_DISCLOSURE.monthly,
    'Renews monthly. Cancel anytime in Apple Account settings.',
  );
});

test('Annual: the store price per year, its monthly equivalent, and Save from the store prices', () => {
  const [annual, monthly] = onboardingPlanCards(ready(DEVELOPMENT_OFFERING), 'en-US')!;
  assert.deepEqual(
    {
      period: annual.period,
      title: annual.title,
      priceText: annual.priceText,
      equivalentLine: annual.equivalentLine,
      savingsBadge: annual.savingsBadge,
      selected: annual.selected,
    },
    {
      period: 'annual',
      title: 'Annual',
      priceText: '$29.99 / year',
      equivalentLine: '$2.50/month equivalent',
      savingsBadge: 'Save 50%',
      selected: true,
    },
  );
  assert.equal(
    annual.accessibilityLabel,
    'Annual, $29.99 per year. $2.50 per month equivalent. Save 50%.',
  );
  // Monthly is a full, plain choice: no equivalent, no badge.
  assert.deepEqual(
    [monthly.priceText, monthly.equivalentLine, monthly.savingsBadge, monthly.selected],
    ['$4.99 / month', null, null, false],
  );
  assert.equal(monthly.accessibilityLabel, 'Monthly, $4.99 per month.');
  // The store's string is shown verbatim: never a second currency symbol or
  // a duplicated period.
  for (const card of [annual, monthly]) {
    assert.equal((card.priceText.match(/\$/g) ?? []).length, 1);
    assert.doesNotMatch(card.priceText, /year.*year|month.*month/);
  }
});

test('choosing Monthly moves the selection, the action and the disclosure together', () => {
  const annualView = ready(DEVELOPMENT_OFFERING);
  const monthlyView = ready(DEVELOPMENT_OFFERING, { selectedPlan: 'monthly' });
  assert.deepEqual(
    onboardingPlanCards(monthlyView)!.map((card) => [card.period, card.selected]),
    [
      ['annual', false],
      ['monthly', true],
    ],
  );
  assert.equal(paywallPresentation(annualView).cta.label, 'Subscribe for $29.99/year');
  assert.equal(paywallPresentation(monthlyView).cta.label, 'Subscribe for $4.99/month');
  assert.doesNotMatch(paywallPresentation(monthlyView).cta.label, /29\.99/);
  assert.equal(renewalDisclosure(annualView), RENEWAL_DISCLOSURE.annual);
  assert.equal(renewalDisclosure(monthlyView), RENEWAL_DISCLOSURE.monthly);
});

test('with no offering there are no cards and the disclosure names no period', () => {
  for (const offerings of [
    { kind: 'loading' },
    { kind: 'unavailable' },
    { kind: 'error' },
  ] as const) {
    const view: PaywallView = { ...initialPaywallView('monthly'), offerings };
    assert.equal(onboardingPlanCards(view), null);
    assert.equal(renewalDisclosure(view), PAYWALL_DISCLOSURE);
    assert.equal(paywallPresentation(view).cta.enabled, false);
  }
});

test('no Save badge unless the store prices show a positive saving in one currency', () => {
  const at = (annual: number, monthly: number, monthlyCurrency = 'USD'): string | null => {
    const offering: Offering = {
      annual: {
        ...DEVELOPMENT_OFFERING.annual,
        price: { amount: annual, currencyCode: 'USD', formatted: `US ${annual}` },
      },
      monthly: {
        ...DEVELOPMENT_OFFERING.monthly,
        price: { amount: monthly, currencyCode: monthlyCurrency, formatted: `M ${monthly}` },
      },
    };
    return onboardingPlanCards(ready(offering))![0].savingsBadge;
  };
  assert.equal(at(29.99, 4.99), 'Save 50%');
  assert.equal(at(59.88, 4.99), null, 'twelve months costs the same');
  assert.equal(at(70, 4.99), null, 'the annual plan costs more');
  assert.equal(at(29.99, 4.99, 'EUR'), null, 'different currencies');
  assert.equal(at(29.99, 0), null, 'a non-positive monthly price');
  // The spoken label drops the saving with the badge.
  const offering: Offering = {
    ...DEVELOPMENT_OFFERING,
    monthly: {
      ...DEVELOPMENT_OFFERING.monthly,
      price: { amount: 4.99, currencyCode: 'EUR', formatted: '4,99 €' },
    },
  };
  assert.doesNotMatch(onboardingPlanCards(ready(offering))![0].accessibilityLabel, /Save/);
});

test('a long localized price pair is passed through whole', () => {
  const [annual, monthly] = onboardingPlanCards(ready(LONG_PRICE_OFFERING), 'id-ID')!;
  assert.equal(annual.priceText, 'Rp 499.000,00 / year');
  assert.equal(monthly.priceText, 'Rp 79.000,00 / month');
  assert.match(annual.equivalentLine ?? '', /\/month equivalent$/);
  assert.equal(
    paywallPresentation(ready(LONG_PRICE_OFFERING, { selectedPlan: 'monthly' })).cta.label,
    'Subscribe for Rp 79.000,00/month',
  );
});

test('the hero spans the page at its own aspect and sits where the target puts it under the headline', () => {
  assert.equal(HERO_TOP_ABOVE_LAST_BASELINE_PX, 122);
  assert.ok(Math.abs(heroHeight(402) - 266.85) < 0.01);
  assert.ok(Math.abs(heroHeight(375) - 248.93) < 0.01);
  // At 402pt and the default text size: the target's 52.5pt from the hero's
  // top edge to the last baseline, plus the font's 9.2pt descent that iOS
  // keeps below that baseline in the tight 38pt lines (measured natively).
  // Less the 7pt added beneath `watch.` (spacing pass).
  assert.equal(HEADLINE_HERO_GAP, 7);
  assert.ok(Math.abs(heroOverlap(402, 1) - (52.51 + 0.225 * 41 - 7)) < 0.01);
  // It scales with the page width; the type part grows with the text.
  assert.ok(heroOverlap(375, 1) < heroOverlap(402, 1));
  assert.ok(heroOverlap(402, 1.3) > heroOverlap(402, 1));
  // From the accessibility sizes the hero follows the headline instead.
  assert.equal(heroOverlap(402, 1.5), 0);
  assert.equal(heroOverlap(402, 3.1), 0);
  // The ascenders get room above the first line box (31pt of Bold `l`
  // against the 28.8pt the line leaves above its baseline), growing with the
  // text; none at the accessibility sizes, whose leading is generous.
  assert.equal(headlineTopClearance(1), 3);
  assert.ok(headlineTopClearance(1.35) >= 3);
  assert.equal(headlineTopClearance(1.5), 0);
});

test('the headline: 41pt Bold on 38pt at ordinary sizes, the display base from the accessibility sizes', () => {
  assert.deepEqual(headlineType(1), { fontSize: 41, lineHeight: 38 });
  assert.deepEqual(headlineType(1.35), { fontSize: 41, lineHeight: 38 });
  assert.deepEqual(headlineType(1.5), {
    fontSize: typography.display.fontSize,
    lineHeight: typography.display.lineHeight,
  });
  assert.equal(atAccessibilitySize(1.49), false);
  assert.equal(atAccessibilitySize(1.5), true);
  // The measure breaks after `closer` and grows with the reader's text; it
  // is never a newline in the copy.
  assert.ok(!ONBOARDING_PAYWALL_HEADLINE.includes('\n'));
  assert.equal(headlineMeasure(1), 300);
  assert.equal(headlineMeasure(2), 600);
});

test('nothing on the screen is smaller than the shared scale’s floor', () => {
  for (const [name, type] of Object.entries(PAYWALL_TYPE)) {
    assert.ok(type.fontSize >= typography['body-small'].fontSize, name);
    assert.ok(type.lineHeight >= type.fontSize || name === 'headline', name);
  }
});
