/**
 * Recall-alerts control state — the pure mapping the settings screen renders.
 * Expo-free so the permission UX rules are provable in Node:
 *
 *   not_enabled — user has not opted in (or turned alerts off). The screen
 *                 offers "Enable recall alerts"; the system permission prompt
 *                 fires only from that explicit tap, never on app launch.
 *   enabled     — permission granted and this installation is registered.
 *   denied      — the system permission is denied and cannot be re-asked;
 *                 the screen points to system settings instead of re-prompting.
 */

export type AlertStatus = 'not_enabled' | 'enabled' | 'denied';

export interface PermissionSnapshot {
  granted: boolean;
  canAskAgain: boolean;
}

export function alertStatus(permission: PermissionSnapshot, registeredHere: boolean): AlertStatus {
  if (permission.granted && registeredHere) return 'enabled';
  if (!permission.granted && !permission.canAskAgain) return 'denied';
  return 'not_enabled';
}
