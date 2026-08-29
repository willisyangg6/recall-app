/**
 * "Reset app and delete my data" (C7.1) — the pure orchestration and the
 * exact user-facing copy, dependency-free so both are provable in Node
 * (SecureStore makes the real wiring, installation-reset-runner.ts,
 * unimportable under the test harness — same split as preferences-store /
 * serial-queue).
 *
 * Order of operations, and why the order is the safety property:
 *
 *   1. peek the installation id (never create one — deletion must not mint
 *      an identity as a side effect; with no id there is nothing on the
 *      server keyed to this installation),
 *   2. delete the server data for that id (one atomic, idempotent RPC),
 *   3. only then clear the local state (preferences, dirty flag, alerts
 *      flag, installation id),
 *   4. mint the fresh installation id through the one canonical path.
 *
 * A failure in step 2 aborts BEFORE any local mutation: the old id — the
 * only credential able to delete or retry deleting its server rows — and
 * every local preference survive intact, so the user retries from exactly
 * the state they started in. A crash between 2 and 3 is equally safe: the
 * retry re-runs the idempotent server delete (zero rows) and proceeds. At
 * no point can server data exist that the device no longer holds the
 * credential to delete.
 *
 * The whole sequence runs as ONE turn of the shared installation mutation
 * queue (installation-lifecycle.ts): an autosave, launch flush, or push
 * refresh queued earlier fully completes first (and whatever it wrote is
 * deleted); anything queued later runs against the fresh identity. Two
 * resets queued back-to-back are safe — the second peeks the NEW id (or
 * null), deletes nothing on the server, and re-clears already-empty local
 * state.
 */

export interface InstallationResetDeps {
  /** Serialize with every other installation mutation (the shared queue). */
  enqueue: <T>(task: () => Promise<T>) => Promise<T>;
  /** The stored installation id, or null. MUST NOT create one. */
  peekInstallationId(): Promise<string | null>;
  /** The atomic, idempotent server-side deletion RPC for one id. */
  deleteServerData(installationId: string): Promise<void>;
  /** Remove locally persisted preferences + retry flag. */
  clearLocalPreferences(): Promise<void>;
  /** Remove the locally persisted alerts-enabled flag. */
  clearLocalAlertState(): Promise<void>;
  /** Discard the old installation id. */
  clearInstallationId(): Promise<void>;
  /** Mint the fresh id through the canonical getOrCreate path. */
  createFreshInstallationId(): Promise<string>;
}

export type InstallationResetResult =
  | { status: 'deleted' }
  /** Server deletion failed — nothing local was touched; retry is safe. */
  | { status: 'failed'; message: string };

export function resetInstallationData(
  deps: InstallationResetDeps,
): Promise<InstallationResetResult> {
  return deps.enqueue(async () => {
    const installationId = await deps.peekInstallationId();
    if (installationId !== null) {
      try {
        await deps.deleteServerData(installationId);
      } catch (error) {
        return {
          status: 'failed',
          message: error instanceof Error ? error.message : 'Deletion failed.',
        };
      }
    }
    // Local clears are idempotent removals; a crash part-way leaves a state
    // every later retry (or ordinary use) handles: the server rows for the
    // old id are already gone, and each clear below is a no-op when re-run.
    await deps.clearLocalPreferences();
    await deps.clearLocalAlertState();
    await deps.clearInstallationId();
    await deps.createFreshInstallationId();
    return { status: 'deleted' };
  });
}

// ── User-facing copy — a tested contract, not incidental strings ────────────
// The action label is frozen by the C7.1 product decision and must match the
// Privacy & Data Controls document (content tests pin both).

export const RESET_ACTION_LABEL = 'Reset app and delete my data';

export const RESET_SUPPORTING_COPY =
  'Deletes this installation’s data from Recall’s server — your personalization choices, ' +
  'notification registration, and alert delivery records — and clears them from this device. ' +
  'Recall information itself is public and is not affected.';

export const RESET_CONFIRM_TITLE = 'Delete your data?';

export const RESET_CONFIRM_BODY =
  'This removes your personalization, your notification registration, and the data associated ' +
  'with this installation from Recall’s server, and clears them from this device. The app ' +
  'returns to its default, unpersonalized state, and recall alerts stay off until you enable ' +
  'them again. This cannot be undone.';

export const RESET_CONFIRM_CANCEL = 'Cancel';

export const RESET_CONFIRM_DELETE = 'Delete data';

export const RESET_SUCCESS_MESSAGE =
  'Your data has been deleted. The app is back to its default state.';

export const RESET_FAILURE_MESSAGE =
  'Could not delete your data — nothing was changed. Check your connection and try again.';
