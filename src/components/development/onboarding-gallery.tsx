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

import { useState, useSyncExternalStore } from 'react';
import { router, type Href } from 'expo-router';
import { StyleSheet, View, type ImageSourcePropType } from 'react-native';

import { AllergensStep } from '@/components/onboarding/allergens-step';
import { BuildingStep } from '@/components/onboarding/building-step';
import { EditPreferencesStep } from '@/components/onboarding/edit-preferences-step';
import { NotificationEducation } from '@/components/onboarding/notification-education';
import { PreviewStep } from '@/components/onboarding/preview-step';
import { ProblemRiskStep, ProblemScaleStep } from '@/components/onboarding/problem-steps';
import { RetailersStep } from '@/components/onboarding/retailers-step';
import { StatesStep } from '@/components/onboarding/states-step';
import { WelcomeContent } from '@/components/onboarding/welcome-content';
import {
  OnboardingEntitledPanel,
  OnboardingPaywallPanel,
} from '@/components/paywall/onboarding-paywall-panel';
import { PaywallPanel, type PurchaseProps } from '@/components/paywall/paywall-panel';
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
import { SAMPLE_RECALL_MODEL } from '@/lib/onboarding-sample';
import { initialPaywallView, type PaywallView } from '@/lib/paywall-screen';
import { beginEditing, editorReducer, type EditorAction } from '@/lib/edit-preferences';
import { toggleAllergen, toggleRetailer, withStates } from '@/lib/personalization-screen';
import type { Offering } from '@/lib/purchases/purchase-provider';
import type { ReadyPreviewState } from '@/lib/ready-preview';
import { clearRetailers } from '@/lib/retailer-grid';
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

function LiveStates({ initial }: { initial: string[] }) {
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

function LiveRetailers({ initial }: { initial: string[] }) {
  const [prefs, setPrefs] = useState<UserRecallPreferences>({
    ...EMPTY_PREFERENCES,
    retailers: initial,
  });
  return (
    <RetailersStep
      selected={prefs.retailers}
      onToggle={(id) => setPrefs(toggleRetailer(prefs, id))}
      onClear={() => setPrefs(clearRetailers(prefs))}
      onContinue={noop}
      onBack={noop}
    />
  );
}

/**
 * A simulated purchase: the view held in this sample's memory, so choosing a
 * plan changes only the sample; subscribing, restoring and the links do
 * nothing.
 */
function useSamplePurchase(view: PaywallView): PurchaseProps {
  const [current, setCurrent] = useState(view);
  return {
    view: current,
    onSelectPlan: (period) => setCurrent((prior) => ({ ...prior, selectedPlan: period })),
    onSubscribe: noop,
    onFooterAction: noop,
    destinationNotice: null,
  };
}

/** The onboarding (grocery-watch) paywall with a view handed in. */
function LiveOnboardingPaywall({ view }: { view: PaywallView }) {
  const purchase = useSamplePurchase(view);
  return <OnboardingPaywallPanel purchase={purchase} onBack={noop} />;
}

/**
 * Whether the paywall development controls are hidden for a clean capture
 * (development-scenarios.ts). Behind the bare `__DEV__` identifier, so a
 * release bundle folds the whole branch: no controls to hide, nothing to
 * subscribe to, and none of the development store's names.
 */
const controlsHiddenStore =
  __DEV__ && devScenarios
    ? {
        subscribe: devScenarios.subscribeDevelopmentControlsHidden,
        get: devScenarios.developmentControlsHidden,
      }
    : { subscribe: () => () => {}, get: () => false };

/**
 * The supported way to take a clean capture of a paywall in a development
 * build: hide the simulated store's controls the purchase flow hands both
 * routes. In memory only (development-scenarios.ts); they return on the next
 * launch, and nothing about the simulated store changes.
 */
function CaptureControlsToggle() {
  const hidden = useSyncExternalStore(controlsHiddenStore.subscribe, controlsHiddenStore.get);
  if (!devScenarios) return null;
  return (
    <GallerySample
      caption={`Clean captures — the paywall development controls are ${hidden ? 'hidden until the next launch, so a paywall can be compared with its target' : 'shown'}. The simulated store keeps its scenario either way.`}>
      <Button
        label={hidden ? 'Show paywall development controls' : 'Hide paywall development controls'}
        variant="secondary"
        onPress={() => devScenarios.setDevelopmentControlsHidden(!hidden)}
      />
    </GallerySample>
  );
}

/** The standalone paywall with a view handed in. */
function LivePaywall({ view, children }: { view: PaywallView; children?: React.ReactNode }) {
  const purchase = useSamplePurchase(view);
  return (
    <PaywallPanel purchase={purchase} onBack={noop}>
      {children}
    </PaywallPanel>
  );
}

/**
 * The Ready step with a preview handed in. The gallery's deck is built from
 * clones of the approved static example model (clearly marked `Example, not
 * a live recall` on the card itself), so no sample fabricates a recall and
 * none depends on the live corpus.
 */
function LiveReady({
  prefs,
  preview,
}: {
  prefs: UserRecallPreferences;
  preview: ReadyPreviewState;
}) {
  return (
    <PreviewStep prefs={prefs} preview={preview} onSeePlan={noop} onEdit={noop} onBack={noop} />
  );
}

/**
 * The one-page editor over its own draft, as the route would hold it: every
 * edit changes the gallery's state and nothing else; Save and Cancel do
 * nothing here.
 */
function LiveEditor({ saved }: { saved: UserRecallPreferences }) {
  const [state, setState] = useState(() => beginEditing(saved));
  const dispatch = (action: EditorAction) => setState((prior) => editorReducer(prior, action));
  return (
    <EditPreferencesStep
      state={state}
      onToggleState={(code) => dispatch({ type: 'toggle-state', code })}
      onToggleAllergen={(token) => dispatch({ type: 'toggle-allergen', token })}
      onClearAllergens={() => dispatch({ type: 'clear-allergens' })}
      onToggleStore={(id) => dispatch({ type: 'toggle-store', id })}
      onSave={noop}
      onCancel={noop}
    />
  );
}

/**
 * A deck of N example cards and the true total the sample claims. A total
 * past the count also stands a frosted locked clone at the deck's end, as
 * the real next image-bearing match would. The example model carries no
 * image (live media never leaves the corpus), so these samples exercise
 * the deck's text slots, depth and frost, not the media region.
 */
function samplePreview(count: number, total: number): ReadyPreviewState {
  if (count === 0) return { kind: 'none' };
  return {
    kind: 'matches',
    models: Array.from({ length: count }, (_, i) => ({
      ...SAMPLE_RECALL_MODEL,
      id: `${SAMPLE_RECALL_MODEL.id}-${i + 1}`,
    })),
    locked:
      total > count ? { ...SAMPLE_RECALL_MODEL, id: `${SAMPLE_RECALL_MODEL.id}-locked` } : null,
    total,
  };
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
      <GallerySample caption="Welcome — real: the receipt composition (wordmark, headline, body, the grocery scene, the example caption and the source note); simulated: Get started does nothing">
        <Screen>
          <WelcomeContent onGetStarted={noop} />
        </Screen>
      </GallerySample>
      <GallerySample caption="States, empty — simulated: nothing chosen; no chips, and Continue is disabled with its reason as the hint">
        <Screen>
          <LiveStates initial={[]} />
        </Screen>
      </GallerySample>
      <GallerySample caption="States, selected — simulated: California and New York as removable chips; Continue is enabled">
        <Screen>
          <LiveStates initial={codesFor('California', 'New York')} />
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
      <GallerySample caption="Stores, empty — simulated: nothing chosen; the receipt’s count row keeps its slot invisibly, so the rows sit exactly where they will with stores chosen">
        <Screen>
          <LiveRetailers initial={[]} />
        </Screen>
      </GallerySample>
      <GallerySample caption="Stores, selected — simulated: Costco and Trader Joe’s checked; the receipt’s quiet 2 selected row with Clear, no surface and no chips">
        <Screen>
          <LiveRetailers initial={['costco', 'trader-joes']} />
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
      <GallerySample caption="Problem: the scale — real: the 1 in 6 stat, the six-figure pictograph with one in lime, its sentence and the CDC source note; simulated: Continue and Back do nothing">
        <Screen>
          <ProblemScaleStep onContinue={noop} onBack={noop} />
        </Screen>
      </GallerySample>
      <GallerySample caption="Problem: higher stakes — real: the headline, the claim once, and the CDC's four groups as white tiles; simulated: Continue and Back do nothing">
        <Screen>
          <ProblemRiskStep onContinue={noop} onBack={noop} />
        </Screen>
      </GallerySample>
      <GallerySample caption="Building your watch — real: the M04 mascot, the truthful captions for a full selection and the one-time play (it holds its finished state here); simulated: finishing routes nowhere">
        <Screen>
          <BuildingStep prefs={populated} onDone={noop} />
        </Screen>
      </GallerySample>
      <GallerySample caption="Ready, three matches of five — simulated: California, New York and Texas on the board (the first two and +1, every state spoken); Peanuts and Milk (both pictograms on the plate); Costco and Trader Joe’s; We found 5 recalls for you; three example cards stacked, the next two peeking as clean white right edges, the frosted locked clone as the final page, four dots (one per page) and the locked strip">
        <Screen>
          <LiveReady prefs={populated} preview={samplePreview(3, 5)} />
        </Screen>
      </GallerySample>
      <GallerySample caption="Ready, two matches — simulated: the second card peeking behind the front one, two dots, We found 2 recalls for you, and the truthful monitoring line where the locked strip would be">
        <Screen>
          <LiveReady
            prefs={{ states: codesFor('California'), allergens: ['sesame'], retailers: ['aldi'] }}
            preview={samplePreview(2, 2)}
          />
        </Screen>
      </GallerySample>
      <GallerySample caption="Ready, one match and a long selection — simulated: four allergens chosen out of order (the first two canonical pictograms; the text names two and +2); six stores as two and +4; We found 1 recall for you; one card, nothing behind it and no dots">
        <Screen>
          <LiveReady
            prefs={{
              states: codesFor('Massachusetts', 'New Hampshire'),
              allergens: ['shellfish', 'sesame', 'tree nuts', 'peanut'],
              retailers: [
                'bjs-wholesale-club',
                'whole-foods',
                'stop-and-shop',
                'trader-joes',
                'sams-club',
                'wegmans',
              ],
            }}
            preview={samplePreview(1, 1)}
          />
        </Screen>
      </GallerySample>
      <GallerySample caption="Ready, nothing matches — simulated: one state; Allergens (the neutral dash) and Stores read None; no count, no deck, and the honest empty card">
        <Screen>
          <LiveReady
            prefs={{ ...EMPTY_PREFERENCES, states: codesFor('Oregon') }}
            preview={{ kind: 'none' }}
          />
        </Screen>
      </GallerySample>
      <GallerySample caption="Edit preferences — simulated: the one-page editor over a draft of California, New York and Texas; Peanuts and Milk; Costco and Trader Joe’s. Every chooser, chip and Save works on the gallery’s own draft and saves nothing">
        <Screen>
          <LiveEditor saved={populated} />
        </Screen>
      </GallerySample>
      <GallerySample caption="Edit preferences, nothing optional chosen — simulated: one state, zero allergens (the neutral dash) and zero stores, all valid">
        <Screen>
          <LiveEditor saved={{ ...EMPTY_PREFERENCES, states: codesFor('Oregon') }} />
        </Screen>
      </GallerySample>
      <GallerySample caption="Edit preferences, no state left — simulated: Save changes disabled, its reason spoken; the helper says at least one state is needed">
        <Screen>
          <LiveEditor saved={{ ...EMPTY_PREFERENCES, allergens: ['egg'] }} />
        </Screen>
      </GallerySample>
      <GallerySample caption="Onboarding paywall, already entitled — real: the entitled panel; simulated: Continue and Back do nothing">
        <Screen>
          <OnboardingEntitledPanel onBack={noop} onContinue={noop} />
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
  const onboardingViews: [caption: string, view: PaywallView][] = [
    [
      'Onboarding paywall, Annual selected — simulated: the fixture offering; Save from the store prices, the monthly equivalent, Renews yearly',
      paywallView(offering),
    ],
    [
      'Onboarding paywall, Monthly selected — simulated: the action and the disclosure name the monthly commitment',
      paywallView(offering, {}, 'monthly'),
    ],
    [
      'Onboarding paywall, offering loading — simulated: one line where the plans would be, Subscribe inert, the period-neutral disclosure',
      paywallView(null),
    ],
    [
      'Onboarding paywall, purchase in progress — simulated: Subscribing…, Restore inert',
      paywallView(offering, { operation: 'purchasing' }),
    ],
    [
      'Onboarding paywall, user cancelled — simulated: the calm sentence; plans still selectable',
      paywallView(offering, { notice: 'cancelled' }),
    ],
    [
      'Onboarding paywall, recoverable purchase error — simulated: the alert surface above the action',
      paywallView(offering, { notice: 'purchase_error' }),
    ],
    [
      'Onboarding paywall, long localized prices — simulated: a wide currency pair (not a real price); nothing truncates',
      paywallView(long),
    ],
  ];
  return (
    <Surface background="background/page" radius={16} border="border/subtle" style={styles.gallery}>
      <CaptureControlsToggle />
      <Text variant="caption" color="text/secondary">
        The onboarding paywall (components/paywall/onboarding-paywall-panel.tsx, the grocery-watch
        composition), imported from production, over the same simulated views as the standalone
        paywall below.
      </Text>
      {onboardingViews.map(([caption, view]) => (
        <GallerySample key={caption} caption={caption}>
          <Screen>
            <LiveOnboardingPaywall view={view} />
          </Screen>
        </GallerySample>
      ))}
      <GallerySample caption="Onboarding paywall, small device height — simulated: a 568pt viewport; the content scrolls above the pinned footer">
        <Screen height={SMALL_DEVICE_HEIGHT}>
          <LiveOnboardingPaywall view={paywallView(offering)} />
        </Screen>
      </GallerySample>
      <Text variant="caption" color="text/secondary">
        The standalone hard paywall a lapsed subscriber meets (components/paywall), imported from
        production. Every view below is simulated: the offering is the development adapter’s fixture
        (the expected US prices) or a deliberately long localized pair, and Subscribe, Restore,
        Terms, Privacy, Support and Back are wired to nothing. Cached active entitlement is a gate
        state, not a paywall state: with a verified cache the paywall is never shown, which the gate
        scenarios below demonstrate.
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
          'Onboarding from Welcome with the store unreachable. Every screen works; the ' +
          'onboarding paywall shows the could-not-confirm state and fails closed, and Ready ' +
          'shows its honest could-not-check preview if the feed is unreachable too.',
        record: INITIAL_ONBOARDING,
        subscription: null,
        scenario: 'unavailable_unverified',
      },
      {
        title: 'Resumed incomplete onboarding',
        expectation:
          'The app opens on the Stores step (segment 5 of 5 filled); Back walks to Allergens.',
        record: recordShownStep(INITIAL_ONBOARDING, 'retailers'),
        subscription: null,
        scenario: 'inactive',
      },
      {
        title: 'Completed onboarding, inactive entitlement',
        expectation:
          'A lapsed subscriber: the app opens on the standalone paywall, never Welcome. Back ' +
          'reviews the Ready step, whose See my plan reaches the same shared plans.',
        record: completePersonalization(INITIAL_ONBOARDING),
        subscription: null,
        scenario: 'inactive',
      },
      {
        title: 'Active entitlement, onboarding unfinished',
        expectation:
          'Subscribed elsewhere, then onboarding again: the app opens on the Ready step; See my ' +
          'plan meets the entitled panel, whose Continue opens notification education.',
        record: recordShownStep(INITIAL_ONBOARDING, 'preview'),
        subscription: 'annual',
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
    const priorPhase = access.phase;
    const next = await access.reload();
    if (!dismissable || next.phase === priorPhase) {
      // Two cases the gate alone cannot move: the hub IS the root (nothing
      // beneath it, and the development group stays mounted in every
      // phase), or the phase did not change — a scenario applied from over
      // an onboarding screen lands in the onboarding phase again, so the
      // navigator keeps the popped-to screen. Either way, replace it with
      // the entry screen once the navigator has settled.
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
