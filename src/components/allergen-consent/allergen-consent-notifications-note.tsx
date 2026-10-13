/**
 * One line on the Notifications screen (2026-10-13): shown when allergens
 * are chosen but stay on this iPhone, so the shopper knows allergen-only
 * recalls send no alerts.
 */

import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { Text } from '@/components/ui/text';
import { CONSENT_NOTIFICATIONS_NOTE, serverAllergenConsent } from '@/lib/allergen-consent';
import { loadAllergenConsent } from '@/lib/allergen-consent-store';
import { loadPreferences, preferencesAvailable } from '@/lib/preferences-store';

export function AllergenConsentNotificationsNote() {
  const [show, setShow] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (!preferencesAvailable()) return;
      let current = true;
      void Promise.all([loadPreferences(), loadAllergenConsent()]).then(([prefs, record]) => {
        if (current) setShow(prefs.allergens.length > 0 && serverAllergenConsent(record) === null);
      });
      return () => {
        current = false;
      };
    }, []),
  );
  if (!show) return null;
  return (
    <Text variant="caption" color="text/secondary">
      {CONSENT_NOTIFICATIONS_NOTE}
    </Text>
  );
}
