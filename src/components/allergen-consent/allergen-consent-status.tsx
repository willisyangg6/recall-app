/**
 * Privacy & Data Controls' allergen consent control (2026-10-13): the
 * current state in one sentence and the one action that changes it. Turning
 * it off is a single tap — as easy as consenting — and removes the server
 * copy at once; turning it on opens the full consent question.
 */

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AllergenConsentSheet } from '@/components/allergen-consent/allergen-consent-sheet';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { color, spacing } from '@/constants/design-tokens';
import { useAllergenConsent } from '@/hooks/use-allergen-consent';
import {
  CONSENT_OPT_IN_LABEL,
  CONSENT_STATUS_TITLE,
  CONSENT_WITHDRAW_LABEL,
  consentStatusLine,
  serverAllergenConsent,
} from '@/lib/allergen-consent';
import { preferencesAvailable } from '@/lib/preferences-store';

export function AllergenConsentStatusSection() {
  const { consent, decide } = useAllergenConsent();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  if (!preferencesAvailable() || consent.status !== 'ready') return null;
  const granted = serverAllergenConsent(consent.record) !== null;
  const choose = (decision: 'granted' | 'declined' | 'withdrawn') => {
    setBusy(true);
    setAsking(false);
    void decide(decision).finally(() => setBusy(false));
  };
  return (
    <AllergenConsentStatusPanel
      granted={granted}
      pending={consent.pending}
      busy={busy}
      onWithdraw={() => choose('withdrawn')}
      onOptIn={() => setAsking(true)}
      sheet={
        <AllergenConsentSheet
          visible={asking}
          onlyChoice={false}
          busy={busy}
          onGrant={() => choose('granted')}
          onDecline={() => choose('declined')}
          onClose={() => setAsking(false)}
        />
      }
    />
  );
}

export function AllergenConsentStatusPanel({
  granted,
  pending = false,
  busy,
  onWithdraw,
  onOptIn,
  sheet,
}: {
  granted: boolean;
  /** The server has not yet received this decision (offline): say so. */
  pending?: boolean;
  busy?: boolean;
  onWithdraw: () => void;
  onOptIn: () => void;
  sheet?: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text variant="heading-3" accessibilityRole="header">
        {CONSENT_STATUS_TITLE}
      </Text>
      <Surface radius={12} border="border/strong" style={styles.panel}>
        <Text variant="body-small" accessibilityLiveRegion="polite">
          {consentStatusLine(granted, pending)}
        </Text>
        <Button
          variant="secondary"
          label={granted ? CONSENT_WITHDRAW_LABEL : CONSENT_OPT_IN_LABEL}
          disabled={busy}
          onPress={granted ? onWithdraw : onOptIn}
        />
      </Surface>
      {sheet}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing[32],
    paddingTop: spacing[24],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color['border/default'],
    gap: spacing[12],
  },
  panel: {
    padding: spacing[16],
    gap: spacing[12],
  },
});
