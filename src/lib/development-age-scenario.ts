/**
 * Development only: force the launch age check's outcome, so each age-gate
 * screen can be inspected and captured on a simulator that has no Apple
 * Account (docs/recall-onboarding-and-paywall.md, "Age check").
 *
 * Read from `EXPO_PUBLIC_DEV_AGE_SCENARIO` when Metro starts, and only in a
 * development build: `__DEV__` is false in a release build, so the branch
 * — and the variable — is inert there. Unset means the real check.
 */

import type { AgeDecision } from './age-assurance';

export type DevelopmentAgeScenario = AgeDecision | 'pending' | null;

export function developmentAgeScenario(
  value: string | undefined = process.env.EXPO_PUBLIC_DEV_AGE_SCENARIO,
  development: boolean = __DEV__,
): DevelopmentAgeScenario {
  if (!development) return null;
  switch (value) {
    case 'pending':
      return 'pending';
    case 'under13':
      return { kind: 'under13' };
    case 'retry':
      return { kind: 'retry', reason: 'unavailable' };
    case 'not-signed-in':
      return { kind: 'retry', reason: 'not-signed-in' };
    case 'adult':
      return { kind: 'proceed', basis: 'shared', ageClass: 'adult', regulated: null };
    default:
      return null;
  }
}
