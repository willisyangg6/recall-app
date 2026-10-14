/**
 * The lapsed-subscriber paywall's one link to the privacy controls (B8,
 * 2026-10-14): reset, export, request codes and allergen-consent withdrawal
 * stay reachable without resubscribing. Declarative (`Link`), so the paywall
 * route still holds no router; one style object on the Pressable, never an
 * array (an array inside `Link asChild` throws a Slot render error on device).
 */

import { Link } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { LinkRow } from '@/components/document/document-blocks';

export const PAYWALL_PRIVACY_LINK_LABEL = 'Privacy & Data Controls';
export const PAYWALL_PRIVACY_LINK_HINT =
  'Opens your privacy controls: see or export your data, get a request code, or delete it.';
export const PAYWALL_PRIVACY_ROUTE = '/privacy/controls';

export function PaywallPrivacyLink() {
  return (
    <Link href={PAYWALL_PRIVACY_ROUTE} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={PAYWALL_PRIVACY_LINK_LABEL}
        accessibilityHint={PAYWALL_PRIVACY_LINK_HINT}
        style={({ pressed }) => (pressed ? styles.pressed : styles.idle)}>
        <LinkRow label={PAYWALL_PRIVACY_LINK_LABEL} icon="chevron-right" />
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  idle: {},
  pressed: { opacity: 0.6 },
});
