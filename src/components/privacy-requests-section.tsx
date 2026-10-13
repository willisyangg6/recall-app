/**
 * "Your data" on Privacy & Data Controls (2026-10-13, privacy requests):
 * the two routes for seeing and requesting this installation's server data,
 * set apart from the document above it the same way the reset section is.
 * Neither control changes anything: one reads, the other leads to a screen
 * that creates a request code only when asked.
 */

import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { color, spacing } from '@/constants/design-tokens';
import {
  PRIVACY_REQUESTS_HEADING,
  PRIVACY_REQUESTS_SUPPORTING_COPY,
  REQUEST_CODE_ACTION_LABEL,
  SERVER_DATA_ACTION_LABEL,
} from '@/lib/privacy-requests';

export const SERVER_DATA_ROUTE = '/privacy/server-data';
export const REQUEST_CODE_ROUTE = '/privacy/request-code';

export function PrivacyRequestsSection() {
  return (
    <View style={styles.section}>
      <Text variant="heading-3" accessibilityRole="header">
        {PRIVACY_REQUESTS_HEADING}
      </Text>
      <Surface radius={12} border="border/default" style={styles.panel}>
        <Text variant="body-small">{PRIVACY_REQUESTS_SUPPORTING_COPY}</Text>
        <Button
          variant="secondary"
          label={SERVER_DATA_ACTION_LABEL}
          onPress={() => router.push(SERVER_DATA_ROUTE)}
        />
        <Button
          variant="secondary"
          label={REQUEST_CODE_ACTION_LABEL}
          onPress={() => router.push(REQUEST_CODE_ROUTE)}
        />
      </Surface>
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
