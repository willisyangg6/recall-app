/**
 * The sandbox test identity (2026-11-09): a TESTING-ONLY switch so the
 * founder can exercise real Apple sandbox purchases of lifetime access on a
 * phone whose own RevenueCat customer is already entitled.
 *
 * Set only by the `sandbox-test` EAS build profile
 * (`EXPO_PUBLIC_SANDBOX_TEST_IDENTITY=1`, eas.json). Metro inlines the
 * variable at build time, so every other build — `production` included —
 * compiles `SANDBOX_TEST_IDENTITY` to `false` and folds the branch away
 * (release-exposure.test.ts pins both).
 *
 * When on, it changes exactly two things, and nothing about the store:
 *
 *   - the purchase identity (the RevenueCat app user id) is read from and
 *     minted into its own file in the app's documents, never the keychain
 *     entry the real identity lives in, and no earlier identity is adopted;
 *   - the verified-entitlement cache lives in its own file too.
 *
 * The bundle id, the Apple-app RevenueCat key, the `lifetime` offering and
 * Apple's sandbox are the release build's own. There is no simulated
 * purchase and no entitlement bypass: access still comes only from a
 * verified RevenueCat entitlement.
 *
 * Both files live in the app's sandbox, which iOS removes with the app (the
 * keychain survives). So deleting and reinstalling the test build starts a
 * NEW test customer — exactly a new device — and Restore Purchases then has
 * something real to prove. The real identity and cache in the keychain are
 * never read, written or cleared while the flag is on.
 */

import { File, Paths } from 'expo-file-system';

export const SANDBOX_TEST_IDENTITY = process.env.EXPO_PUBLIC_SANDBOX_TEST_IDENTITY === '1';

/** A small text value kept in its own file in the app's documents. */
export function sandboxTestFile(name: string) {
  const file = () => new File(Paths.document, name);
  return {
    read: async (): Promise<string | null> => {
      try {
        const target = file();
        return target.exists ? await target.text() : null;
      } catch {
        return null;
      }
    },
    write: async (value: string): Promise<void> => {
      file().write(value);
    },
    remove: async (): Promise<void> => {
      const target = file();
      if (target.exists) target.delete();
    },
  };
}

export const SANDBOX_TEST_PURCHASE_ID_FILE = 'sandbox-test-purchase-id.txt';
export const SANDBOX_TEST_ENTITLEMENT_FILE = 'sandbox-test-entitlement.json';
