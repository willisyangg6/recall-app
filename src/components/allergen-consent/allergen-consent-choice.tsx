/**
 * The allergen consent question (2026-10-13): the full disclosure and the
 * two EQUAL choices — same component, same `secondary` variant, the same
 * width, neither pre-selected (pinned by allergen-consent.test.ts). Used by
 * the sheet (Edit preferences) and the inline card
 * (Personalization). Never bundled with any other action.
 */

import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { spacing } from '@/constants/design-tokens';
import {
  CONSENT_DECLINE_LABEL,
  CONSENT_GRANT_LABEL,
  CONSENT_ONLY_CHOICE_NOTE,
  CONSENT_PARAGRAPHS,
  CONSENT_TITLE,
} from '@/lib/allergen-consent';

export function AllergenConsentChoice({
  onlyChoice,
  busy,
  onGrant,
  onDecline,
}: {
  /** Allergens are the shopper's only alert choice: say what declining means. */
  onlyChoice: boolean;
  busy?: boolean;
  onGrant: () => void;
  onDecline: () => void;
}) {
  return (
    <View style={styles.choice}>
      <Text variant="heading-3" accessibilityRole="header">
        {CONSENT_TITLE}
      </Text>
      {CONSENT_PARAGRAPHS.map((paragraph) => (
        <Text key={paragraph} variant="body-small">
          {paragraph}
        </Text>
      ))}
      {onlyChoice ? <Text variant="body-small-bold">{CONSENT_ONLY_CHOICE_NOTE}</Text> : null}
      <View style={styles.buttons}>
        <Button variant="secondary" label={CONSENT_GRANT_LABEL} disabled={busy} onPress={onGrant} />
        <Button
          variant="secondary"
          label={CONSENT_DECLINE_LABEL}
          disabled={busy}
          onPress={onDecline}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  choice: {
    gap: spacing[12],
  },
  buttons: {
    gap: spacing[12],
    marginTop: spacing[4],
  },
});
