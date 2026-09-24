/**
 * ONBOARDING AND PAYWALL galleries for the development-only Design Preview
 * hub (P2B7X.1): every first-launch screen and every paywall state, drawn by
 * the production components — imported, never copied — with each sample's
 * state held here in memory, plus the gate scenarios that restart the REAL
 * flow from a chosen state.
 *
 * ## What is real, what is simulated
 *
 * REAL: every component. `WelcomeContent`, the four step components, the
 * `PaywallPanel`, `NotificationEducation`, the shared selectors, the
 * example card and the retailer logo are the ones the routes render.
 *
 * SIMULATED, named on each caption: the selection a sample opens with, the
 * paywall view a sample is handed (which plan is selected, what the store
 * answered, what the last outcome was), and the offering — the development
 * adapter's fixture prices and one deliberately long localized pair. No
 * sample saves a preference, reads or writes the onboarding record, asks
 * the store for anything, or raises the system prompt: every callback is
 * wired to local state or to nothing.
 *
 * The GATE SCENARIOS at the end are different: each one writes the real
 * onboarding record and the simulated store account, pops to the root and
 * reloads the gate, so the app itself moves to the state named — the same
 * way a relaunch would. They exist so "resumed incomplete onboarding",
 * "completed with an inactive entitlement", "active entitlement" and
 * "offline first launch" can be walked natively, not only pictured.
 *
 * Development only. The purchase modules are reached through `__DEV__`
 * requires, so a release bundle folds them away (release-exposure.test.ts).
 */

import { useState } from 'react';
import { router, type Href } from 'expo-router';
import { StyleSheet, View, type ImageSourcePropType } from 'react-native';

import { AllergensStep } from '@/components/onboarding/allergens-step';
import { NotificationEducation } from '@/components/onboarding/notification-education';
import { PreviewStep } from '@/components/onboarding/preview-step';
import { RetailersStep } from '@/components/onboarding/retailers-step';
import { StatesStep } from '@/components/onboarding/states-step';
import { WelcomeContent } from '@/components/onboarding/welcome-content';
import { PaywallPanel } from '@/components/paywall/paywall-panel';
import { Button } from '@/components/ui/button';
import { CheckRow } from '@/components/ui/check-row';
import { RetailerLogoFallback, RetailerLogoMark } from '@/components/ui/retailer-logo';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { spacing } from '@/constants/design-tokens';
import {
  EMPTY_PREFERENCES,
  STATE_CODES_IN_ORDER,
  stateNameForCode,
  type UserRecallPreferences,
} from '@/domain/preferences';
import { RETAILER_CATALOG } from '@/domain/retailer-catalog';
import { useAccess } from '@/hooks/use-access';
import { entryRoute } from '@/lib/access-gate';
import type { PlanPeriod } from '@/lib/entitlement';
import {
  completeNotificationEducation,
  completePersonalization,
  INITIAL_ONBOARDING,
  recordShownStep,
  type OnboardingRecord,
} from '@/lib/onboarding-state';
import { saveOnboardingRecord } from '@/lib/onboarding-store';
import { initialPaywallView, type PaywallView } from '@/lib/paywall-screen';
import { toggleAllergen, toggleRetailer, withStates } from '@/lib/personalization-screen';
import type { Offering } from '@/lib/purchases/purchase-provider';
import { retailerLogoCoverage } from '@/lib/retailer-logos';

type DevelopmentProvider = typeof import('@/lib/purchases/development-provider');
type DevelopmentScenarios = typeof import('@/lib/purchases/development-scenarios');

/** Development only: folded away, together with the modules, in a release bundle. */
const devProvider = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('@/lib/purchases/development-provider') as DevelopmentProvider)
  : null;
const devScenarios = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('@/lib/purchases/development-scenarios') as DevelopmentScenarios)
  : null;

/** The Design Preview's two logo FIXTURES: neutral labelled shapes, not marks. */
const WIDE_FIXTURE =
  require('@/assets/design-preview/logo-fixture-wide.png') as ImageSourcePropType;
const TALL_FIXTURE =
  require('@/assets/design-preview/logo-fixture-tall.png') as ImageSourcePropType;

/** An iPhone SE-class viewport height, to show the sticky footer at its tightest. */
const SMALL_DEVICE_HEIGHT = 568;

const noop = () => {};

/** Postal codes for the named jurisdictions, from the catalog (no code is typed here). */
function codesFor(...names: string[]): string[] {
  return STATE_CODES_IN_ORDER.filter((code) => names.includes(stateNameForCode(code) ?? ''));
}

function GallerySample({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <View style={styles.sample}>
      <Text variant="caption" color="text/secondary">
        {caption}
      </Text>
      {children}
    </View>
  );
}

/** A screen sample at a phone-like height, so the sticky footer and scroll are real. */
function Screen({ height = 720, children }: { height?: number; children: React.ReactNode }) {
  return (
    <Surface radius={16} border="border/strong" style={[styles.screen, { height }]}>
      {children}
    </Surface>
  );
}

// ── Steps with live local state ─────────────────────────────────────────────

function LiveStates({ initial, initialQuery = '' }: { initial: string[]; initialQuery?: string }) {
  const [prefs, setPrefs] = useState<UserRecallPreferences>({
    ...EMPTY_PREFERENCES,
    states: initial,
  });
  return (
    <StatesStep
      selected={prefs.states}
      onChange={(codes) => setPrefs(withStates(prefs, codes))}
      onContinue={noop}
      onBack={noop}
      initialQuery={initialQuery}
      // A typed search lives in List mode; every other sample opens on the map.
      initialMode={initialQuery === '' ? 'map' : 'list'}
    />
  );
}

function LiveAllergens({ initial }: { initial: string[] }) {
  const [prefs, setPrefs] = useState<UserRecallPreferences>({
    ...EMPTY_PREFERENCES,
    allergens: initial,
  });
  return (
    <AllergensStep
      selected={prefs.allergens}
      onToggle={(token) => setPrefs(toggleAllergen(prefs, token))}
      onClear={() => setPrefs({ ...prefs, allergens: [] })}
      onContinue={noop}
      onBack={noop}
    />
  );
}

function LiveRetailers({
  initial,
  initialQuery = '',
}: {
  initial: string[];
  initialQuery?: string;
}) {
  const [prefs, setPrefs] = useState<UserRecallPreferences>({
    ...EMPTY_PREFERENCES,
    retailers: initial,
  });
  return (
    <RetailersStep
      selected={prefs.retailers}
      onToggle={(id) => setPrefs(toggleRetailer(prefs, id))}
      onClear={() => setPrefs({ ...prefs, retailers: [] })}
      onContinue={noop}
      onBack={noop}
      initialQuery={initialQuery}
    />
  );
}

/** The paywall with a view handed in; selecting a plan changes only this sample. */
function LivePaywall({ view, children }: { view: PaywallView; children?: React.ReactNode }) {
  const [current, setCurrent] = useState(view);
  return (
    <PaywallPanel
      view={current}
      onSelectPlan={(period) => setCurrent((prior) => ({ ...prior, selectedPlan: period }))}
      onSubscribe={noop}
      onFooterAction={noop}
      onBack={noop}>
      {children}
    </PaywallPanel>
  );
}

function paywallView(
  offering: Offering | null,
  overrides: Partial<PaywallView> = {},
  selectedPlan: PlanPeriod = 'annual',
): PaywallView {
  return {
    ...initialPaywallView(selectedPlan),
    offerings: offering === null ? { kind: 'loading' } : { kind: 'ready', offering },
    ...overrides,
  };
}

// ── The galleries ───────────────────────────────────────────────────────────

export function OnboardingGallery() {
  const populated: UserRecallPreferences = {
    states: codesFor('California', 'New York', 'Texas'),
    allergens: ['peanut', 'milk'],
    retailers: ['costco', 'trader-joes'],
  };
  const longest = [...RETAILER_CATALOG].sort((a, b) => b.name.length - a.name.length)[0];
  const coverage = retailerLogoCoverage();
  return (
    <Surface background="background/page" radius={16} border="border/subtle" style={styles.gallery}>
      <Text variant="caption" color="text/secondary">
        The first-launch screens (components/onboarding), imported from production. Every sample
        below is simulated in this gallery’s memory: nothing reads or writes this device’s
        preferences or onboarding record, Continue and Back are wired to nothing, and no sample
        contacts a store or asks for a permission. Dynamic Type and device height are the
        simulator’s: set the text size under Settings › Accessibility and reopen, or use the
        small-height sample at the end.
      </Text>
      <GallerySample caption="Welcome — real: the wordmark, headline, benefits, the example card and the trust note; simulated: Get started does nothing">
        <Screen>
          <WelcomeContent onGetStarted={noop} />
        </Screen>
      </GallerySample>
      <GallerySample caption="States, empty — simulated: nothing chosen; Continue is disabled and the reason reads beneath it; Clear selection is present and inert">
        <Screen>
          <LiveStates initial={[]} />
        </Screen>
      </GallerySample>
      <GallerySample caption="States, selected — simulated: California and New York; the count reads 2 states selected and Continue is enabled">
        <Screen>
          <LiveStates initial={codesFor('California', 'New York')} />
        </Screen>
      </GallerySample>
      <GallerySample caption="States, search — simulated: “new” typed with California chosen; the hidden selection stays chosen">
        <Screen>
          <LiveStates initial={codesFor('California')} initialQuery="new" />
        </Screen>
      </GallerySample>
      <GallerySample caption="Allergens, empty — simulated: nothing chosen; Continue stays enabled (optional), Clear selection inert">
        <Screen>
          <LiveAllergens initial={[]} />
        </Screen>
      </GallerySample>
      <GallerySample caption="Allergens, several selected — simulated: Peanuts, Milk and Sesame; every row carries its glyph from one family">
        <Screen>
          <LiveAllergens initial={['peanut', 'milk', 'sesame']} />
        </Screen>
      </GallerySample>
      <GallerySample caption="Retailers, empty — simulated: nothing chosen; every row shows the house fallback because no official mark is bundled">
        <Screen>
          <LiveRetailers initial={[]} />
        </Screen>
      </GallerySample>
      <GallerySample caption="Retailers, selected — simulated: Costco and Trader Joe’s checked; a checked row never moves">
        <Screen>
          <LiveRetailers initial={['costco', 'trader-joes']} />
        </Screen>
      </GallerySample>
      <GallerySample caption="Retailers, search — simulated: “co” typed">
        <Screen>
          <LiveRetailers initial={[]} initialQuery="co" />
        </Screen>
      </GallerySample>
      <GallerySample
        caption={`Retailer rows — real: the fallback for every catalog retailer (${coverage.fallback.length} of ${RETAILER_CATALOG.length} fall back today), the longest catalog name (${longest.name}); simulated: two neutral FIXTURE shapes at extreme ratios standing where a wide or tall mark would, contained in the same box`}>
        <View style={styles.rows}>
          <CheckRow
            label={longest.name}
            checked={false}
            onPress={noop}
            leading={<RetailerLogoFallback name={longest.name} />}
          />
          <CheckRow
            label="Wide fixture (160×24)"
            checked
            onPress={noop}
            leading={<RetailerLogoMark source={WIDE_FIXTURE} name="Wide fixture" />}
          />
          <CheckRow
            label="Tall fixture (24×120)"
            checked={false}
            onPress={noop}
            leading={<RetailerLogoMark source={TALL_FIXTURE} name="Tall fixture" />}
          />
        </View>
      </GallerySample>
      <GallerySample caption="Preview with selections — simulated: California, New York and Texas; Peanuts and Milk; Costco and Trader Joe’s; then the example match">
        <Screen>
          <PreviewStep prefs={populated} onViewPlans={noop} onEdit={noop} onBack={noop} />
        </Screen>
      </GallerySample>
      <GallerySample caption="Preview with no optional selections — simulated: one state and nothing else; Allergens and Retailers keep their rows and read None">
        <Screen>
          <PreviewStep
            prefs={{ ...EMPTY_PREFERENCES, states: codesFor('Oregon') }}
            onViewPlans={noop}
            onEdit={noop}
            onBack={noop}
          />
        </Screen>
      </GallerySample>
      <GallerySample caption="Notification education — real: the success mark, the alert preview and both actions; simulated: neither action asks the system for anything">
        <Screen>
          <NotificationEducation busy={false} onEnable={noop} onSkip={noop} />
        </Screen>
      </GallerySample>
      <GallerySample caption="Notification education, enabling — simulated: the primary action busy while the system prompt would be up">
        <Screen>
          <NotificationEducation busy onEnable={noop} onSkip={noop} />
        </Screen>
      </GallerySample>
      <GallerySample caption="Small device height — simulated: a 568pt viewport; the footer stays pinned and the content scrolls beneath it">
        <Screen height={SMALL_DEVICE_HEIGHT}>
          <LiveStates initial={codesFor('California')} />
        </Screen>
      </GallerySample>
    </Surface>
  );
}

export function PaywallGallery() {
  const offering = devScenarios?.DEVELOPMENT_OFFERING ?? null;
  const long = devScenarios?.LONG_PRICE_OFFERING ?? null;
  const views: [caption: string, view: PaywallView][] = [
    [
      'Annual selected — simulated: the fixture offering; Annual preselected with the value badge, the monthly equivalent and the saving',
      paywallView(offering),
    ],
    [
      'Monthly selected — simulated: the same offering with Monthly chosen; the action names the monthly commitment',
      paywallView(offering, {}, 'monthly'),
    ],
    [
      'Offering loading — simulated: the store has not answered; plans absent, Subscribe inert, the footer intact',
      paywallView(null),
    ],
    [
      'Purchase in progress — simulated: Subscribing…, Restore inert',
      paywallView(offering, { operation: 'purchasing' }),
    ],
    [
      'User cancelled — simulated: the calm sentence; plans still selectable',
      paywallView(offering, { notice: 'cancelled' }),
    ],
    [
      'Recoverable purchase error — simulated: the alert surface beneath the action',
      paywallView(offering, { notice: 'purchase_error' }),
    ],
    [
      'Restore in progress — simulated: Restoring… in the footer, Subscribe inert',
      paywallView(offering, { operation: 'restoring' }),
    ],
    [
      'Restore success — simulated: the success surface (the gate would move on)',
      paywallView(offering, { notice: 'restore_success' }),
    ],
    [
      'Restore finds no purchase — simulated: the honest sentence',
      paywallView(offering, { notice: 'restore_nothing' }),
    ],
    [
      'Provider temporarily unavailable — simulated: plans unavailable; Subscribe inert; Restore still offered',
      paywallView(offering, { offerings: { kind: 'unavailable' } }),
    ],
    [
      'Unavailable with no verified entitlement — simulated: the could-not-confirm notice; the gate failed closed',
      paywallView(offering, { offerings: { kind: 'unavailable' }, unconfirmed: true }),
    ],
    [
      'Long localized prices — simulated: a wide currency pair (not a real price); nothing truncates',
      paywallView(long),
    ],
  ];
  return (
    <Surface background="background/page" radius={16} border="border/subtle" style={styles.gallery}>
      <Text variant="caption" color="text/secondary">
        The hard paywall (components/paywall), imported from production. Every view below is
        simulated: the offering is the development adapter’s fixture (the expected US prices) or a
        deliberately long localized pair, and Subscribe, Restore, Terms, Privacy, Support and Back
        are wired to nothing. Cached active entitlement is a gate state, not a paywall state: with a
        verified cache the paywall is never shown, which the gate scenarios below demonstrate.
      </Text>
      {views.map(([caption, view]) => (
        <GallerySample key={caption} caption={caption}>
          <Screen>
            <LivePaywall view={view} />
          </Screen>
        </GallerySample>
      ))}
      <GallerySample caption="Small device height — simulated: the paywall in a 568pt viewport">
        <Screen height={SMALL_DEVICE_HEIGHT}>
          <LivePaywall view={paywallView(offering)} />
        </Screen>
      </GallerySample>
    </Surface>
  );
}

// ── Gate scenarios: restart the REAL flow from a chosen state ───────────────

interface GateScenario {
  title: string;
  expectation: string;
  record: OnboardingRecord;
  /** The simulated store account: a subscription, or none. */
  subscription: 'annual' | null;
  scenario: 'inactive' | 'unavailable_unverified' | 'unavailable_cached_active';
}

/**
 * Development only, like the modules above: folded away in a release bundle
 * so not even a scenario id's string survives in the inert hub.
 */
const GATE_SCENARIOS: readonly GateScenario[] = __DEV__
  ? [
      {
        title: 'Offline first launch',
        expectation:
          'Onboarding from Welcome with the store unreachable. Every screen works; the paywall, when ' +
          'reached, shows the could-not-confirm state and fails closed.',
        record: INITIAL_ONBOARDING,
        subscription: null,
        scenario: 'unavailable_unverified',
      },
      {
        title: 'Resumed incomplete onboarding',
        expectation: 'The app opens on the Retailers step (3 of 4); Back walks to Allergens.',
        record: recordShownStep(INITIAL_ONBOARDING, 'retailers'),
        subscription: null,
        scenario: 'inactive',
      },
      {
        title: 'Completed onboarding, inactive entitlement',
        expectation: 'The app opens on the paywall, never Welcome. Back reviews the Preview.',
        record: completePersonalization(INITIAL_ONBOARDING),
        subscription: null,
        scenario: 'inactive',
      },
      {
        title: 'Active entitlement, education pending',
        expectation: 'The app opens on notification education, once.',
        record: completePersonalization(INITIAL_ONBOARDING),
        subscription: 'annual',
        scenario: 'inactive',
      },
      {
        title: 'Active entitlement',
        expectation: 'The app opens on the Feed.',
        record: completeNotificationEducation(completePersonalization(INITIAL_ONBOARDING)),
        subscription: 'annual',
        scenario: 'inactive',
      },
      {
        title: 'Cached active entitlement through an outage',
        expectation:
          'A verified subscription is cached, then the store goes unreachable: the app still opens ' +
          'on the Feed (cached access), not the paywall.',
        record: completeNotificationEducation(completePersonalization(INITIAL_ONBOARDING)),
        subscription: 'annual',
        scenario: 'unavailable_cached_active',
      },
    ]
  : [];

export function GateScenarios() {
  const access = useAccess();
  if (devProvider === null || devScenarios === null) return null;
  const provider = devProvider;
  const scenarios = devScenarios;

  const apply = async (scenario: GateScenario) => {
    await saveOnboardingRecord(scenario.record);
    if (scenario.subscription === null) await provider.clearDevelopmentSubscription();
    else await provider.seedDevelopmentSubscription(scenario.subscription);
    // Pop to the root BEFORE anything can move the gate: the gate then
    // replaces whatever phase that root belongs to, exactly as a relaunch
    // into the new state would. (An entitlement refresh can flip the phase
    // on its own, which removes the screen beneath the hub — after that
    // there is nothing left to pop to.)
    const dismissable = router.canDismiss();
    if (dismissable) router.dismissAll();
    if (scenario.scenario === 'unavailable_cached_active') {
      // Verify once while reachable so the cache holds it, then go dark.
      scenarios.setDevelopmentPurchaseScenario('inactive');
      await access.refreshEntitlement();
    }
    scenarios.setDevelopmentPurchaseScenario(scenario.scenario);
    const next = await access.reload();
    if (!dismissable) {
      // The hub IS the root here (nothing beneath it), and the development
      // group stays mounted in every phase, so the gate alone would leave it
      // showing: replace it with the new phase's entry screen once the
      // navigator has taken the phase change.
      const href = `/${entryRoute(next.phase, next.entryStep)}` as Href;
      setTimeout(() => router.replace(href), 0);
    }
  };

  return (
    <Surface background="background/page" radius={16} border="border/subtle" style={styles.gallery}>
      <Text variant="caption" color="text/secondary">
        Gate scenarios — real: each control writes this device’s onboarding record and the simulated
        store account, then reloads the gate, so the app itself moves to the state named, as a
        relaunch would. The current phase is {access.phase}. Nothing here touches preferences or
        saved recalls.
      </Text>
      {GATE_SCENARIOS.map((scenario) => (
        <View key={scenario.title} style={styles.sample}>
          <Text variant="body-small-bold">{scenario.title}</Text>
          <Text variant="caption" color="text/secondary">
            {scenario.expectation}
          </Text>
          <Button
            label={`Apply: ${scenario.title}`}
            variant="secondary"
            onPress={() => void apply(scenario)}
          />
        </View>
      ))}
    </Surface>
  );
}

const styles = StyleSheet.create({
  gallery: {
    padding: spacing[16],
    gap: spacing[16],
  },
  sample: {
    gap: spacing[8],
    padding: spacing[12],
  },
  screen: {
    overflow: 'hidden',
  },
  rows: {
    gap: spacing[8],
  },
});
