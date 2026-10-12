/**
 * The daily foreground check-in (2026-10-12) — the activity signal behind
 * the 12-month inactivity retention rule, and how a returning installation
 * repairs its server rows. Pure orchestration; the native wiring is
 * installation-checkin-runner.ts.
 *
 * When the app comes to the FOREGROUND (never in the background, never
 * because a notification was delivered), at most once per UTC day:
 *
 *   1. peek the installation id — never create one: an installation with no
 *      id holds nothing on the server, and a check-in must not mint server
 *      state;
 *   2. record today's date for it (record_installation_activity) — inside
 *      the shared installation mutation queue, so it serializes with "Reset
 *      app and delete my data": a check-in queued before a reset lands first
 *      and is deleted with everything else; one queued after peeks the fresh
 *      id;
 *   3. only after that succeeded, remember the day (a failure retries on the
 *      next foreground), then re-send the preference mirror and refresh the
 *      push registration. Both recreate rows the inactivity purge deleted
 *      and are no-ops server-side when the rows are intact.
 *
 * Steps 3's two calls each enqueue themselves, so they run after the
 * check-in's own queue turn, never nested in it.
 */

export interface CheckinDeps {
  /** Today's UTC date, `YYYY-MM-DD`. */
  today(): string;
  readLastCheckin(): Promise<string | null>;
  writeLastCheckin(day: string): Promise<void>;
  /** The stored installation id, or null. MUST NOT create one. */
  peekInstallationId(): Promise<string | null>;
  /** The shared installation mutation queue. */
  enqueue: <T>(task: () => Promise<T>) => Promise<T>;
  recordActivity(installationId: string): Promise<void>;
  remirrorPreferences(): Promise<void>;
  refreshRegistration(): Promise<void>;
}

export type CheckinResult =
  | 'already-today'
  | 'no-installation'
  | 'recorded'
  /** The server write failed; nothing was remembered, so it retries. */
  | 'failed';

export async function checkIn(deps: CheckinDeps): Promise<CheckinResult> {
  const day = deps.today();
  if ((await deps.readLastCheckin()) === day) return 'already-today';

  const outcome = await deps.enqueue(async (): Promise<CheckinResult> => {
    const installationId = await deps.peekInstallationId();
    if (installationId === null) return 'no-installation';
    try {
      await deps.recordActivity(installationId);
      return 'recorded';
    } catch {
      return 'failed';
    }
  });
  if (outcome !== 'recorded') return outcome;

  await deps.writeLastCheckin(day).catch(() => {});
  // Repairs after a purge; each is best-effort and owns its own retry.
  await deps.remirrorPreferences().catch(() => {});
  await deps.refreshRegistration().catch(() => {});
  return 'recorded';
}

/** `YYYY-MM-DD` in UTC — the same day boundary the server stores. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}
