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
 * Continue from the last selector: back to the Ready step it came from when
 * one is beneath (Edit preferences); else through the one-time "building
 * your watch" interstitial when it has not played yet, or straight onward to
 * a new Ready step when it has. The interstitial REPLACES itself with Ready
 * (`buildingDone`), so it never sits in the back chain — Back from Ready
 * pops to Stores.
 */
export function continueToPreview(
  previewBeneath: boolean,
  watchBuilt: boolean,
  navigator: StepNavigator,
): void {
  if (previewBeneath) navigator.dismissTo(onboardingRoute('preview'));
  else if (watchBuilt) navigator.push(onboardingRoute('preview'));
  else navigator.push(onboardingRoute('building'));
}

/**
 * The interstitial finished (or was skipped because its work was already
 * done): Ready takes its place on the stack, so Back from Ready never
 * returns to a spent interstitial.
 */
export function buildingDone(navigator: StepNavigator): void {
  navigator.replace(onboardingRoute('preview'));
}
