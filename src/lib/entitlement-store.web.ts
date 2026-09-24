/** Web variant: no purchases and no cache on the web. */

import type { ActiveEntitlement } from './entitlement';

export async function loadCachedEntitlement(): Promise<ActiveEntitlement | null> {
  return null;
}

export async function saveCachedEntitlement(
  _entitlement: ActiveEntitlement | null,
): Promise<void> {}
