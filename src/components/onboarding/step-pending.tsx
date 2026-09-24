/**
 * A step whose preferences have not answered yet (P2B7X.1): the step's own
 * frame, headline and body, with the shared not-ready message where the
 * selector will be — never an empty selector the store did not give. The
 * footer is the same Continue, inert, so the frame does not change shape
 * when the read lands.
 */

import { PreferencesNotReady } from '@/components/settings/personalization-form';
import { Button } from '@/components/ui/button';
import {
  ALLERGENS_BODY,
  ALLERGENS_HEADLINE,
  CONTINUE_CTA,
  PREVIEW_BODY,
  PREVIEW_CTA,
  PREVIEW_HEADLINE,
  RETAILERS_BODY,
  RETAILERS_HEADLINE,
  STATES_BODY,
  STATES_HEADLINE,
} from '@/lib/onboarding-copy';
import { stepProgress, type OnboardingStep } from '@/lib/onboarding-state';
import type { PreferencesLoadState } from '@/lib/personalization-screen';
import { OnboardingFrame } from './onboarding-frame';

const COPY: Record<
  Exclude<OnboardingStep, 'welcome'>,
  { headline: string; body: string; cta: string }
> = {
  states: { headline: STATES_HEADLINE, body: STATES_BODY, cta: CONTINUE_CTA },
  allergens: { headline: ALLERGENS_HEADLINE, body: ALLERGENS_BODY, cta: CONTINUE_CTA },
  retailers: { headline: RETAILERS_HEADLINE, body: RETAILERS_BODY, cta: CONTINUE_CTA },
  preview: { headline: PREVIEW_HEADLINE, body: PREVIEW_BODY, cta: PREVIEW_CTA },
};

export function StepPending({
  step,
  status,
}: {
  step: Exclude<OnboardingStep, 'welcome'>;
  status: Exclude<PreferencesLoadState['status'], 'ready'>;
}) {
  const copy = COPY[step];
  return (
    <OnboardingFrame
      headline={copy.headline}
      body={copy.body}
      progress={stepProgress(step)}
      footer={<Button label={copy.cta} disabled onPress={() => {}} />}>
      <PreferencesNotReady status={status} />
    </OnboardingFrame>
  );
}
