/**
 * The onboarding routes (P2B7X.1): one mapping from a step to its route
 * name, shared by the gate's route matrix, the layout's declaration order
 * and the screens' own navigation, so the three can never spell a path
 * differently.
 *
 * Paths are absolute hrefs (`/onboarding/states`); the navigator's screen
 * name is the same path without the leading slash.
 */

import type { OnboardingStep } from './onboarding-state';

export const ONBOARDING_ROUTES: Record<OnboardingStep, `/onboarding/${OnboardingStep}`> = {
  welcome: '/onboarding/welcome',
  states: '/onboarding/states',
  allergens: '/onboarding/allergens',
  retailers: '/onboarding/retailers',
  preview: '/onboarding/preview',
};

export function onboardingRoute(step: OnboardingStep): `/onboarding/${OnboardingStep}` {
  return ONBOARDING_ROUTES[step];
}

/** The hard paywall. Reachable only in the paywall phase (lib/access-gate.ts). */
export const PAYWALL_ROUTE = '/paywall';

/** The one-time notification education, after entitlement success. */
export const NOTIFICATION_EDUCATION_ROUTE = '/onboarding/notifications';
