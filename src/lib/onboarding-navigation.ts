/**
 * Onboarding navigation helpers (P2B7X.1): the small rules the step routes
 * share so they cannot disagree.
 *
 * Every move here stays INSIDE the onboarding phase, where every step's
 * route is mounted, so an imperative push, back or replace always has its
 * target. Phase changes are never navigated to — the gate performs them
 * (lib/access-gate.ts).
 */

import type { OnboardingStep } from './onboarding-state';
import { previousStep } from './onboarding-state';
import { onboardingRoute } from './onboarding-routes';

export interface StepNavigator {
  canGoBack: () => boolean;
  back: () => void;
  push: (href: `/onboarding/${OnboardingStep}`) => void;
  replace: (href: `/onboarding/${OnboardingStep}`) => void;
  dismissTo: (href: `/onboarding/${OnboardingStep}`) => void;
}

/**
 * Back from a step: pop when the previous step is beneath (a fresh run, or
 * an edit from the Preview), else replace with it (a resumed launch, whose
 * stack begins on the resumed step). Either way the previous step is what
 * appears, so Back is sequential however the step was reached.
 */
export function goBackFrom(step: OnboardingStep, navigator: StepNavigator): void {
  if (navigator.canGoBack()) {
    navigator.back();
    return;
  }
  const previous = previousStep(step);
  if (previous !== null) navigator.replace(onboardingRoute(previous));
}

/**
 * Continue from the last selector: back to the Preview it came from when
 * one is beneath (Edit preferences), else onward to a new Preview.
 */
export function continueToPreview(previewBeneath: boolean, navigator: StepNavigator): void {
  if (previewBeneath) navigator.dismissTo(onboardingRoute('preview'));
  else navigator.push(onboardingRoute('preview'));
}
