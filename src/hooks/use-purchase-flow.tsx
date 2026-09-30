/**
 * The purchase flow (2026-09-27): the ONE owner of everything a plan choice
 * needs, shared by the two places a shopper can subscribe — the Ready step,
 * where the plans follow the personalized summary, and the standalone
 * `/paywall`, which a lapsed subscriber meets. Neither route holds purchase
 * state of its own.
 *
 * ## What it owns
 *
 * The view (`lib/paywall-screen.ts` maps it to what is drawn): the offering,
 * loaded through the purchase boundary when the screen mounts; the selected
 * plan; the operation in flight; and the last outcome's notice. It runs a
 * purchase or a restore and hands a verified success to the gate
 * (`applyEntitlement`), which completes personalization in the same commit
 * and moves the app to notification education or the Feed on its own — no
 * route navigates. A cancellation, a recoverable error and an unreachable
 * store each become their calm or honest notice and nothing else changes, so
 * the shopper stays where they were with every choice kept. Terms, Privacy
 * and Support open their configured HTTPS destination, or say plainly that
 * none is configured in this build (lib/release-destinations.ts).
 *
 * Each outcome's notice, and an offering that failed to load, is also
 * announced: iOS does not speak `accessibilityLiveRegion`, so without the
 * announcement VoiceOver would say nothing when a purchase is cancelled.
 *
 * ## Development
 *
 * The simulated store's controls exist in a development build only: the
 * branch is the bare `__DEV__` identifier and both modules are required
 * inside it, so a release bundle folds them away (Metro drops a dead
 * branch's `require`, which a static import could never achieve).
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Linking } from 'react-native';

import type { PurchaseProps } from '@/components/paywall/paywall-panel';
import { useAccess } from '@/hooks/use-access';
import type { PlanPeriod } from '@/lib/entitlement';
import {
  DESTINATION_UNCONFIGURED,
  initialPaywallView,
  OFFERING_ERROR,
  OFFERING_UNAVAILABLE,
  PAYWALL_NOTICES,
  type PaywallFooterActionKey,
  type PaywallNoticeKind,
  type PaywallView,
} from '@/lib/paywall-screen';
import type { PurchaseProvider } from '@/lib/purchases/purchase-provider';
import { destinationAction } from '@/lib/release-destinations';

type ControlsModule = typeof import('@/components/paywall/paywall-development-controls');
type ScenariosModule = typeof import('@/lib/purchases/development-scenarios');

/**
 * Development only. Both `require`s sit INSIDE the `__DEV__` branch on
 * purpose: Metro folds the dead branch of a release bundle and drops the
 * modules with it, which a static import could never achieve.
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

/** Speak an outcome the shopper did not otherwise hear. */
function announce(notice: PaywallNoticeKind) {
  AccessibilityInfo.announceForAccessibility(PAYWALL_NOTICES[notice].text);
}

export interface PurchaseFlow {
  /** Everything the shared plan and footer pieces draw, and their handlers. */
  purchase: PurchaseProps;
  /** The simulated store's controls in a development build; null in a release. */
  developmentControls: ReactNode;
}

export function usePurchaseFlow(): PurchaseFlow {
  const access = useAccess();
  const unconfirmed =
    access.entitlement.kind === 'inactive' && access.entitlement.reason === 'unconfirmed';
  const [view, setView] = useState<PaywallView>(() => initialPaywallView('annual', unconfirmed));
  const [destinationNotice, setDestinationNotice] = useState<string | null>(null);

  /** Ask the store; the view is already in its loading state when this runs. */
  const loadOfferings = useCallback(async (provider: PurchaseProvider) => {
    const offerings = await provider.loadOfferings();
    setView((prior) => ({ ...prior, offerings }));
    if (offerings.kind === 'unavailable') {
      AccessibilityInfo.announceForAccessibility(OFFERING_UNAVAILABLE);
    } else if (offerings.kind === 'error') {
      AccessibilityInfo.announceForAccessibility(OFFERING_ERROR);
    }
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
    const notice: PaywallNoticeKind =
      outcome.kind === 'cancelled'
        ? 'cancelled'
        : outcome.kind === 'error'
          ? 'purchase_error'
          : 'purchase_unavailable';
    setView((prior) => ({ ...prior, operation: 'idle', notice }));
    announce(notice);
  };

  const restore = async () => {
    if (view.operation !== 'idle') return;
    setView((prior) => ({ ...prior, operation: 'restoring', notice: null }));
    const outcome = await access.provider.restore();
    if (outcome.kind === 'restored') {
      setView((prior) => ({ ...prior, operation: 'idle', notice: 'restore_success' }));
      announce('restore_success');
      await access.applyEntitlement(outcome.entitlement);
      return;
    }
    const notice: PaywallNoticeKind =
      outcome.kind === 'nothing_to_restore'
        ? 'restore_nothing'
        : outcome.kind === 'error'
          ? 'restore_error'
          : 'restore_unavailable';
    setView((prior) => ({ ...prior, operation: 'idle', notice }));
    announce(notice);
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

  return {
    purchase: {
      // The gate's confirmation state is derived at render, never copied.
      view: view.unconfirmed === unconfirmed ? view : { ...view, unconfirmed },
      onSelectPlan: (period) => setView((prior) => ({ ...prior, selectedPlan: period })),
      onSubscribe: () => void subscribe(),
      onFooterAction: footerAction,
      destinationNotice,
    },
    developmentControls: DevelopmentControls ? (
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
    ) : null,
  };
}
