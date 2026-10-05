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
 * composes it into the SAME `OnboardingPaywallPanel` — the founder-approved
 * grocery-watch composition (2026-10-04: one paywall design for both
 * routes). What differs is wiring, handed in as props: Back here is
 * `reviewPreview` (re-enter the Ready step without losing completion),
 * where the onboarding route pops its stack. A verified purchase or restore
 * is applied by the flow and the gate moves on — to education if it is
 * still pending, else the app — so this route never navigates and never
 * sends an expired subscriber back through onboarding.
 */

import { OnboardingPaywallPanel } from '@/components/paywall/onboarding-paywall-panel';
import { useAccess } from '@/hooks/use-access';
import { usePurchaseFlow } from '@/hooks/use-purchase-flow';

export default function PaywallScreen() {
  const access = useAccess();
  const { purchase, developmentControls } = usePurchaseFlow();
  return (
    <OnboardingPaywallPanel purchase={purchase} onBack={access.reviewPreview}>
      {developmentControls}
    </OnboardingPaywallPanel>
  );
}
