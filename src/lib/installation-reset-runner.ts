/**
 * Native wiring for "Reset app and delete my data" (C7.1): binds the pure
 * orchestrator (installation-reset.ts, where the ordering/failure proofs
 * live) to the real modules that own each piece of state. Each SecureStore
 * key stays private to its owning module — this file composes their exported
 * clearers and never touches a key directly.
 */

import {
  clearInstallationId,
  getOrCreateInstallationId,
  peekInstallationId,
} from './installation-id';
import { enqueueInstallationMutation } from './installation-lifecycle';
import { resetInstallationData, type InstallationResetResult } from './installation-reset';
import { deleteLocalPreferenceState } from './preferences-store';
import { deleteInstallationData } from './push-api';
import { clearLocalAlertState } from './push-registration';
import { deleteLocalSavedRecalls } from './saved-recalls-store';

/** The reset control renders only where an installation identity exists. */
export function resetAvailable(): boolean {
  return true;
}

export function runInstallationReset(): Promise<InstallationResetResult> {
  return resetInstallationData({
    enqueue: enqueueInstallationMutation,
    peekInstallationId,
    deleteServerData: deleteInstallationData,
    clearLocalPreferences: deleteLocalPreferenceState,
    clearLocalAlertState,
    clearLocalSavedRecalls: deleteLocalSavedRecalls,
    clearInstallationId,
    createFreshInstallationId: getOrCreateInstallationId,
  });
}
