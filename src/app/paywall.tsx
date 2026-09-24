/**
 * `/paywall` (P2B7X.1) — Screen 6, the hard paywall. Mounted ONLY in the
 * paywall phase (personalization complete, not entitled), which is what
 * makes it hard: there is no route past it but a verified purchase or
 * restore, and no route around it, because every other screen is a
 * protected route the navigator does not have while this phase stands.
 *
 * ## What this route does
 *
 * Loads the offering through the purchase boundary, holds the view state
 * (`lib/paywall-screen.ts` maps it to what is drawn), runs a purchase or a
 * restore and applies a verified success to the gate — which then moves the
 * app to notification education or the Feed on its own. A cancellation, a
 * recoverable error and an unreachable store each become their calm or
 * honest notice and nothing else changes. Terms, Privacy and Support open
 * their configured HTTPS destination, or say plainly that none is
 * configured in this build (lib/release-destinations.ts). Back reviews the
 * Preview without losing completion.
 *
 * The development controls beneath the plans exist in a development build
 * only: the branch is the bare `__DEV__` identifier and the module is
 * required inside it, so a release bundle folds both away.
 */

import { useCallback, useEffect, useState } from 'react';
import { Linking } from 'react-native';

import { PaywallPanel } from '@/components/paywall/paywall-panel';
import { useAccess } from '@/hooks/use-access';
import type { PlanPeriod } from '@/lib/entitlement';
import {
  DESTINATION_UNCONFIGURED,
  initialPaywallView,
  type PaywallFooterActionKey,
  type PaywallView,
} from '@/lib/paywall-screen';
import type { PurchaseProvider } from '@/lib/purchases/purchase-provider';
import { destinationAction } from '@/lib/release-destinations';

type ControlsModule = typeof import('@/components/paywall/paywall-development-controls');
type ScenariosModule = typeof import('@/lib/purchases/development-scenarios');

/**
 * Development only. Both `require`s sit INSIDE the `__DEV__` branch on
 * purpose: Metro folds the dead branch of a release bundle and drops the
 * modules with it (release-exposure.test.ts scans the export for their
 * markers), which a static import could never achieve.
 */
const DevelopmentControls = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('@/components/paywall/paywall-development-controls') as ControlsModule)
      .PaywallDevelopmentControls
  : null;

const developmentScenarios = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('@/lib/purchases/development-scenarios') as ScenariosModule)
      .DEVELOPMENT_PURCHASE_SCENARIOS
  : null;

/** The scenario's preselected plan in development; Annual otherwise. */
function initialPlanFor(id: string): PlanPeriod {
  return developmentScenarios?.find((scenario) => scenario.id === id)?.initialPlan ?? 'annual';
}

export default function PaywallScreen() {
  const access = useAccess();
  const unconfirmed =
    access.entitlement.kind === 'inactive' && access.entitlement.reason === 'unconfirmed';
  const [view, setView] = useState<PaywallView>(() => initialPaywallView('annual', unconfirmed));
  const [destinationNotice, setDestinationNotice] = useState<string | null>(null);

  /** Ask the store; the view is already in its loading state when this runs. */
  const loadOfferings = useCallback(async (provider: PurchaseProvider) => {
    const offerings = await provider.loadOfferings();
    setView((prior) => ({ ...prior, offerings }));
  }, []);

  useEffect(() => {
    // The store answers asynchronously; nothing is set inside the effect.
    void Promise.resolve().then(() => loadOfferings(access.provider));
  }, [access.provider, loadOfferings]);

  const subscribe = async () => {
    if (view.offerings.kind !== 'ready' || view.operation !== 'idle') return;
    const pkg = view.offerings.offering[view.selectedPlan];
    setView((prior) => ({ ...prior, operation: 'purchasing', notice: null }));
    const outcome = await access.provider.purchase(pkg);
    if (outcome.kind === 'success') {
      // The gate moves the app on; this screen unmounts with the phase.
      await access.applyEntitlement(outcome.entitlement);
      return;
    }
    setView((prior) => ({
      ...prior,
      operation: 'idle',
      notice:
        outcome.kind === 'cancelled'
          ? 'cancelled'
          : outcome.kind === 'error'
            ? 'purchase_error'
            : 'purchase_unavailable',
    }));
  };

  const restore = async () => {
    if (view.operation !== 'idle') return;
    setView((prior) => ({ ...prior, operation: 'restoring', notice: null }));
    const outcome = await access.provider.restore();
    if (outcome.kind === 'restored') {
      setView((prior) => ({ ...prior, operation: 'idle', notice: 'restore_success' }));
      await access.applyEntitlement(outcome.entitlement);
      return;
    }
    setView((prior) => ({
      ...prior,
      operation: 'idle',
      notice:
        outcome.kind === 'nothing_to_restore'
          ? 'restore_nothing'
          : outcome.kind === 'error'
            ? 'restore_error'
            : 'restore_unavailable',
    }));
  };

  const footerAction = (key: PaywallFooterActionKey) => {
    if (key === 'restore') {
      void restore();
      return;
    }
    const action = destinationAction(key);
    if (action.kind === 'open') {
      setDestinationNotice(null);
      void Linking.openURL(action.url);
      return;
    }
    setDestinationNotice(DESTINATION_UNCONFIGURED);
  };

  return (
    <PaywallPanel
      // The gate's confirmation state is derived at render, never copied.
      view={view.unconfirmed === unconfirmed ? view : { ...view, unconfirmed }}
      onSelectPlan={(period) => setView((prior) => ({ ...prior, selectedPlan: period }))}
      onSubscribe={() => void subscribe()}
      onFooterAction={footerAction}
      onBack={access.reviewPreview}
      destinationNotice={destinationNotice}>
      {DevelopmentControls ? (
        <DevelopmentControls
          onScenarioApplied={(id) => {
            setView((prior) => ({
              ...prior,
              offerings: { kind: 'loading' },
              selectedPlan: initialPlanFor(id),
              notice: null,
              operation: 'idle',
            }));
            void loadOfferings(access.provider);
          }}
        />
      ) : null}
    </PaywallPanel>
  );
}
