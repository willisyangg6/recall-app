/**
 * Web variant: personalization is a mobile-app flow, so there is no consent
 * to keep (same convention as preferences-store.web.ts).
 */

import type { AllergenConsentRecord } from './allergen-consent';

export async function loadAllergenConsent(): Promise<AllergenConsentRecord | null> {
  return null;
}

export async function loadAllergenConsentStrict(): Promise<AllergenConsentRecord | null> {
  return null;
}

export async function saveAllergenConsent(_record: AllergenConsentRecord): Promise<void> {}

export async function deleteLocalAllergenConsent(): Promise<void> {}
