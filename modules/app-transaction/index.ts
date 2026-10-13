/**
 * StoreKit's app transaction (docs/recall-privacy-program-proposal.md §2.6).
 * Read by the consent-revocation key sync (src/lib/revocation-key-sync.ts),
 * which sends the id only for a regulated 13–17 user with alerts on, and by
 * the development-only sandbox probe (S1, S5). Looked up optionally, so a
 * binary without the module answers null instead of crashing.
 */

import { requireOptionalNativeModule } from 'expo';

export interface AppTransactionInfo {
  /** `AppTransaction.appTransactionID`: per Apple Account and app. */
  appTransactionId: string;
  /** `Production`, `Sandbox` or `Xcode`. */
  environment: string;
  bundleId: string;
  originalPurchaseDate: string;
  /** Whether StoreKit verified the transaction's signature. */
  verified: boolean;
}

interface AppTransactionModule {
  getAppTransactionAsync(): Promise<AppTransactionInfo>;
}

const native = requireOptionalNativeModule<AppTransactionModule>('LotlyAppTransaction');

export async function getAppTransactionAsync(): Promise<AppTransactionInfo | null> {
  return native ? native.getAppTransactionAsync() : null;
}
