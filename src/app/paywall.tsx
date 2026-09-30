/**
 * `/paywall` (P2B7X.1) — the standalone hard paywall. Mounted ONLY in the
 * paywall phase (personalization complete, not entitled), which is what
 * makes it hard: there is no route past it but a verified purchase or
 * restore, and no route around it, because every other screen is a
 * protected route the navigator does not have while this phase stands.
 *
 * ## Who meets it
 *
 * A first-time shopper subscribes on the onboarding paywall
 * (`/onboarding/paywall`, 2026-09-28) and never lands here: the purchase
 * completes personalization and the entitlement together, and the gate
 * goes straight to education. This screen is for a device whose
 * personalization is complete without an entitlement — a lapsed or expired
 * subscriber on a relaunch or a return to the foreground, and a device
 * that completed an earlier flow without buying.
 *
 * ## What this route does
 *
 * Nothing of its own. The purchase flow (hooks/use-purchase-flow.tsx) owns
 * the offering, the plan, the purchase, the restore, the notices and the
 * legal links, exactly as it does for the onboarding paywall; this route
 * composes it into the same `PaywallPanel`. Back reviews the Ready step
 * without losing completion.
 */

import { PaywallPanel } from '@/components/paywall/paywall-panel';
import { useAccess } from '@/hooks/use-access';
import { usePurchaseFlow } from '@/hooks/use-purchase-flow';

export default function PaywallScreen() {
  const access = useAccess();
  const { purchase, developmentControls } = usePurchaseFlow();
  return (
    <PaywallPanel purchase={purchase} onBack={access.reviewPreview}>
      {developmentControls}
    </PaywallPanel>
  );
}
