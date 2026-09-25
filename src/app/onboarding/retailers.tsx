/**
 * `/onboarding/retailers` (P2B7X.1) — Screen 4, `3 of 4`. Optional: an
 * empty selection continues. Every check, chip removal and Clear autosaves
 * through the one store, whether it came from a popular tile or the search;
 * an empty Clear saves nothing.
 * Continue returns to the Preview when this edit began there, else pushes
 * a new Preview.
 */

import { useCallback } from 'react';
import { router, useFocusEffect, useNavigation } from 'expo-router';

import { RetailersStep } from '@/components/onboarding/retailers-step';
import { StepPending } from '@/components/onboarding/step-pending';
import { useAccess } from '@/hooks/use-access';
import { useOnboardingPreferences } from '@/hooks/use-onboarding-preferences';
import { continueToPreview, goBackFrom } from '@/lib/onboarding-navigation';
import { toggleRetailer } from '@/lib/personalization-screen';
import { clearRetailers } from '@/lib/retailer-grid';

export default function OnboardingRetailersScreen() {
  const access = useAccess();
  const navigation = useNavigation();
  const { load, update } = useOnboardingPreferences();
  useFocusEffect(
    useCallback(() => {
      void access.recordShownStep('retailers');
    }, [access]),
  );

  if (load.status !== 'ready') return <StepPending step="retailers" status={load.status} />;
  const prefs = load.prefs;
  const previewBeneath = () =>
    (navigation.getState()?.routes ?? []).some((route) => route.name === 'onboarding/preview');
  return (
    <RetailersStep
      selected={prefs.retailers}
      onToggle={(id) => update(toggleRetailer(prefs, id))}
      onClear={() => {
        const next = clearRetailers(prefs);
        if (next !== prefs) update(next);
      }}
      onContinue={() => continueToPreview(previewBeneath(), router)}
      onBack={() => goBackFrom('retailers', router)}
    />
  );
}
