/**
 * Web variant: onboarding, like personalization and purchases, is a
 * mobile-app flow. The web answers as already onboarded so it renders the
 * app's "available in the app" states rather than a selector it cannot
 * save, and it persists nothing.
 */

import { ONBOARDING_RECORD_VERSION, type OnboardingRecord } from './onboarding-state';

export async function loadOnboardingRecord(): Promise<OnboardingRecord> {
  return {
    version: ONBOARDING_RECORD_VERSION,
    step: 'preview',
    personalizationCompleted: true,
    notificationEducationCompleted: true,
  };
}

export async function saveOnboardingRecord(_record: OnboardingRecord): Promise<void> {}

export async function deleteLocalOnboardingState(): Promise<void> {}
