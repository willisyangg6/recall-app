/** Web variant: no simulated store on the web; the resolver's release path applies. */

import type { PlanPeriod, PurchaseProvider } from './purchase-provider';
import { unconfiguredPurchaseProvider } from './purchase-provider';

export function developmentPurchaseProvider(): PurchaseProvider {
  return unconfiguredPurchaseProvider();
}

export async function clearDevelopmentSubscription(): Promise<void> {}

export async function seedDevelopmentSubscription(_period: PlanPeriod): Promise<void> {}
