/**
 * DEVELOPMENT-ONLY paywall controls (P2B7X.1): the fake store's ten
 * scenarios and the gate's resets, so the founder can walk every paywall
 * state in the Simulator without a store account.
 *
 * Reachable only from the paywall route's `__DEV__` branch, which
 * lazy-requires this module so a release bundle folds it — and the fake
 * store it imports — away entirely. It also returns null outside a
 * development build, the second lock on the same door.
 *
 * Applying a scenario re-reads the entitlement through the provider; the
 * gate then moves the app exactly as it would for a real store: a simulated
 * subscription opens notification education (or the Feed), clearing it
 * returns to the paywall, resetting onboarding returns to Welcome.
 */

import { useState } from 'react';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { spacing } from '@/constants/design-tokens';
import { useAccess } from '@/hooks/use-access';
import { INITIAL_ONBOARDING } from '@/lib/onboarding-state';
import { saveOnboardingRecord } from '@/lib/onboarding-store';
import { DEVELOPMENT_HEADING } from '@/lib/profile-hub';
import {
  clearDevelopmentSubscription,
  seedDevelopmentSubscription,
} from '@/lib/purchases/development-provider';
import {
  DEVELOPMENT_PURCHASE_SCENARIOS,
  developmentPurchaseScenario,
  setDevelopmentPurchaseScenario,
  type DevelopmentPurchaseScenarioId,
} from '@/lib/purchases/development-scenarios';

export function PaywallDevelopmentControls({
  onScenarioApplied,
}: {
  /** The route reloads its offering and preselects the scenario's plan. */
  onScenarioApplied: (id: DevelopmentPurchaseScenarioId) => void;
}) {
  const access = useAccess();
  const [scenario, setScenario] = useState<DevelopmentPurchaseScenarioId>(
    developmentPurchaseScenario(),
  );
  if (!__DEV__) return null;
  const current = DEVELOPMENT_PURCHASE_SCENARIOS.find((s) => s.id === scenario);

  const apply = async () => {
    setDevelopmentPurchaseScenario(scenario);
    onScenarioApplied(scenario);
    await access.refreshEntitlement();
  };

  return (
    <View style={styles.section}>
      <Text variant="caption" color="text/secondary" accessibilityRole="header">
        {DEVELOPMENT_HEADING}
      </Text>
      <Surface background="background/page" radius={8} border="border/strong" style={styles.box}>
        <Text variant="body-small" color="text/secondary">
          Simulated store. Choose a scenario, then Apply: the paywall and the gate respond as they
          would to a real store answering this way.
        </Text>
        <View style={styles.chips}>
          {DEVELOPMENT_PURCHASE_SCENARIOS.map((option) => (
            <Chip
              key={option.id}
              label={option.title}
              selected={option.id === scenario}
              onPress={() => setScenario(option.id)}
            />
          ))}
        </View>
        {current ? (
          <Text variant="caption" color="text/secondary">
            {current.expectation}
          </Text>
        ) : null}
        <Button label="Apply scenario" variant="secondary" onPress={() => void apply()} />
        <Button
          label="Simulate an active subscription"
          variant="secondary"
          onPress={() => {
            void seedDevelopmentSubscription('annual').then(() => access.refreshEntitlement());
          }}
        />
        <Button
          label="Clear simulated subscription"
          variant="secondary"
          onPress={() => {
            void clearDevelopmentSubscription().then(() => access.refreshEntitlement());
          }}
        />
        <Button
          label="Reset onboarding to Welcome"
          variant="secondary"
          onPress={() => {
            void saveOnboardingRecord(INITIAL_ONBOARDING).then(() => access.reload());
          }}
        />
        <Button
          label="Open Design Preview"
          variant="secondary"
          onPress={() => router.push('/design-preview')}
        />
      </Surface>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing[8],
    paddingTop: spacing[16],
  },
  box: {
    padding: spacing[12],
    gap: spacing[12],
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[8],
  },
});
