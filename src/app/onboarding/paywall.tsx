/**
 * `/onboarding/paywall` (2026-09-28) — the dedicated onboarding paywall,
 * reached from the Ready step's `See my plan` (and its locked strip and
 * sentinel). Mounted only in the onboarding phase; the standalone
 * `/paywall` a lapsed subscriber meets is a different route in a different
 * phase, composing the SAME panel over the SAME purchase flow.
 *
 * ## What this route does
 *
 * Nothing of its own. The purchase flow (hooks/use-purchase-flow.tsx) owns
 * the offering, the plan, the purchase, the restore, the notices, the legal
 * links and the development controls; this route composes it into
 * `PaywallPanel`. A verified purchase or restore completes personalization
 * WITH the entitlement in one commit (hooks/use-access.tsx), so the gate
 * goes straight to notification education and never through the paywall
 * phase. A cancellation or an error stays here with every choice kept. Back
 * pops to Ready.
 *
 * A shopper who is already entitled (restored elsewhere, or subscribed on
 * another device) is never asked to purchase again: they meet the entitled
 * panel, whose `Continue` completes personalization on its own.
 */

import { useCallback } from 'react';
import { router, useFocusEffect } from 'expo-router';

import { EntitledPaywallPanel, PaywallPanel } from '@/components/paywall/paywall-panel';
import { useAccess } from '@/hooks/use-access';
import { usePurchaseFlow } from '@/hooks/use-purchase-flow';
import { isEntitled } from '@/lib/entitlement';
import { goBackFrom } from '@/lib/onboarding-navigation';

export default function OnboardingPaywallScreen() {
  const access = useAccess();
  useFocusEffect(
    useCallback(() => {
      void access.recordShownStep('paywall');
    }, [access]),
  );
  const onBack = () => goBackFrom('paywall', router);
  if (isEntitled(access.entitlement)) {
    return (
      <EntitledPaywallPanel
        onBack={onBack}
        onContinue={() => void access.completePersonalization()}
      />
    );
  }
  return <PurchasePaywall onBack={onBack} />;
}

/**
 * Its own component so the purchase flow's hooks mount only when there is
 * something to buy; the entitled branch never talks to the store.
 */
function PurchasePaywall({ onBack }: { onBack: () => void }) {
  const { purchase, developmentControls } = usePurchaseFlow();
  return (
    <PaywallPanel purchase={purchase} onBack={onBack}>
      {developmentControls}
    </PaywallPanel>
  );
}
