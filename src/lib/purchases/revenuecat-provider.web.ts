/** Web variant: no store on the web, and no SDK imported. */

import {
  unconfiguredPurchaseProvider,
  type PurchaseIdentity,
  type PurchaseProvider,
} from './purchase-provider';

export function revenueCatPurchaseProvider(_identity: PurchaseIdentity): PurchaseProvider {
  return unconfiguredPurchaseProvider();
}
