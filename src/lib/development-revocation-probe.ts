/**
 * DEVELOPMENT revocation sandbox probe (docs/recall-privacy-program-proposal.md
 * §2.6, tests S1 and S5): in a development build whose Metro was started with
 * `EXPO_PUBLIC_DEV_REVOCATION_PROBE=1`, each launch that passes the age gate
 * shows this device's `AppTransaction.appTransactionID` and environment,
 * with Share so the tester can record it.
 *
 * Reached only through a `__DEV__` require in components/age-gate.tsx, so a
 * release bundle never contains it. The id leaves the device only if the
 * tester shares it by hand.
 */

import { Alert, Share } from 'react-native';

import { getAppTransactionAsync } from '../../modules/app-transaction';

export function revocationProbeEnabled(): boolean {
  return process.env.EXPO_PUBLIC_DEV_REVOCATION_PROBE === '1';
}

export function runRevocationProbe(): void {
  if (!revocationProbeEnabled()) return;
  void getAppTransactionAsync()
    .then((info) => {
      const message =
        info === null
          ? 'The app-transaction module is not in this build.'
          : [
              `appTransactionId: ${info.appTransactionId}`,
              `environment: ${info.environment}`,
              `bundleId: ${info.bundleId}`,
              `originalPurchaseDate: ${info.originalPurchaseDate}`,
              `verified: ${info.verified}`,
              `read at: ${new Date().toISOString()}`,
            ].join('\n');
      Alert.alert('Revocation probe (S1)', message, [
        { text: 'Share', onPress: () => void Share.share({ message }) },
        { text: 'OK', style: 'cancel' },
      ]);
    })
    .catch((error: unknown) => {
      Alert.alert('Revocation probe (S1)', `AppTransaction failed: ${String(error)}`);
    });
}
