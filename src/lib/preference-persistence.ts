/**
 * Preference persistence, the pure part (2026-10-04): how a save becomes a
 * durable local write and a server mirror, and why the two no longer share
 * one line.
 *
 * ## Local first, really
 *
 * Until this change every save ran the local write AND the network mirror in
 * one turn of the installation mutation queue. The queue kept saves in
 * order, but a slow network made toggle N's LOCAL write wait behind toggles
 * 1…N−1's server round trips: the screen was right (it holds the value in
 * memory), the disk was behind, and a kill in that window lost the tail —
 * on a flow whose contract is "nothing to lose on a kill". Here the queue
 * carries only the durable write (SecureStore plus the dirty flag, a few
 * milliseconds); `commit` and `save` answer the moment it lands.
 *
 * ## One mirror run at a time, always the newest value
 *
 * The server mirror is a separate, coalescing worker: a local write REQUESTS
 * a mirror; one run is ever in flight; a run reads the newest LOCAL value at
 * its start and syncs that; a request that arrives during a run makes the
 * worker run once more afterwards. So an older value can never overwrite a
 * newer one (runs are serial and each syncs what is newest when it starts),
 * five quick toggles cost one or two requests, and no screen ever waits on
 * the network for its own state. The dirty flag is set by every local write
 * and cleared only when a run has synced exactly the newest written value;
 * `flush` (app launch) requests a run while the flag is set.
 *
 * `save` still answers `{ synced }` for the Personalization screen's status
 * line — after the mirror attempt that covers its value, so the word is
 * truthful — but its local write has long landed by then, and a screen that
 * must not wait (the onboarding steps, the editor) uses `commit`, which
 * answers after the local write alone.
 *
 * ## The reset
 *
 * "Reset app and delete my data" runs as one turn of the same queue and
 * deletes the server row first. A mirror run in flight for the OLD id must
 * not land after that deletion, so the reset calls `settleMirror` inside
 * its turn before the deletion: it drops any pending request and waits for
 * the run in flight. No new request can start during the turn — every local
 * write is queued behind it — and the first save after the reset mirrors
 * under the fresh identity (the sync reads the id when it runs).
 *
 * Dependency-free (no SecureStore, no fetch) so every rule is proven in Node
 * with real delays (`preference-persistence.test.ts`); preferences-store.ts
 * wires it to the device.
 */

import { sanitizePreferences, type UserRecallPreferences } from '@/domain/preferences';

export interface PersistenceDeps {
  /** The installation mutation queue: durable local writes, in order. */
  enqueueLocal: <T>(task: () => Promise<T>) => Promise<T>;
  /** The stored value (sanitized), EMPTY when none was ever saved. */
  readLocal(): Promise<UserRecallPreferences>;
  writeLocal(prefs: UserRecallPreferences): Promise<void>;
  isDirty(): Promise<boolean>;
  setDirty(dirty: boolean): Promise<void>;
  /** The server mirror; may be slow, may throw. */
  syncRemote(prefs: UserRecallPreferences): Promise<void>;
  /**
   * For `remirror` only: the stored record, read strictly — null when none
   * was ever saved, a throw when it cannot be read. `readLocal` degrades both
   * to empty preferences, which is right for screens but must never be
   * re-sent over a good server copy.
   */
  readStoredStrict?(): Promise<UserRecallPreferences | null>;
  /**
   * Anything besides the preferences that decides what a mirror sends
   * (2026-10-13: the allergen consent version). Folded into the "already
   * synced" comparison, so a change to it is mirrored even when the
   * preferences are unchanged. Absent = preferences alone.
   */
  mirrorKey?(): Promise<string>;
}

export interface SaveResult {
  /** False = saved locally but the server mirror did not confirm (retried later). */
  synced: boolean;
}

export interface PreferencePersistence {
  /**
   * Durable local write first; answers once the mirror attempt covering this
   * value has finished (true) or failed (false). The local write never waits
   * on it.
   */
  save(prefs: UserRecallPreferences): Promise<SaveResult>;
  /** The same write, answered with the stored value as soon as the device holds it. */
  commit(prefs: UserRecallPreferences): Promise<UserRecallPreferences>;
  /** The stored value, read after every write requested before this call has landed. */
  readSettled(): Promise<UserRecallPreferences>;
  /** Every value this device commits, as soon as it is written locally. */
  onSaved(listener: (prefs: UserRecallPreferences) => void): () => void;
  /** App launch: mirror again while a previous sync is still owed. */
  flush(): Promise<void>;
  /** Before the reset's server deletion: no mirror run pending or in flight. */
  settleMirror(): Promise<void>;
  /** Resolves when no mirror run is pending or in flight (QA and tests). */
  mirrorIdle(): Promise<void>;
  /**
   * Something `mirrorKey` reads changed (the allergen consent): mark the
   * mirror owed — the dirty flag, so a failure is retried by the next save
   * or launch flush exactly like a preference change — and request a run.
   */
  touch(): Promise<SaveResult>;
  /** The mirror still owes the server the newest value (the dirty flag). */
  mirrorOwed(): Promise<boolean>;
  /**
   * Send the newest local value to the server again, even if this process
   * already mirrored it (2026-10-12). The daily foreground check-in calls it
   * so an installation whose server row was deleted for inactivity gets the
   * row back; on an intact row the RPC is a strict no-op. Skipped when no
   * record was ever saved (nothing to restore — a fresh install mid-setup
   * gets no server row) or when the record cannot be read (never re-send
   * empty preferences over a good server copy).
   */
  remirror(): Promise<void>;
}

const key = (prefs: UserRecallPreferences): string => JSON.stringify(prefs);

export function createPreferencePersistence(deps: PersistenceDeps): PreferencePersistence {
  const listeners = new Set<(prefs: UserRecallPreferences) => void>();
  /** The newest value written locally, or null before any write this process. */
  let latest: string | null = null;
  /** The value the mirror last confirmed. */
  let synced: string | null = null;
  let running: Promise<void> | null = null;
  let pending = false;
  let waiters: ((synced: boolean) => void)[] = [];

  const settleWaiters = (ok: boolean) => {
    const resolved = waiters;
    waiters = [];
    for (const resolve of resolved) resolve(ok);
  };

  const runMirror = async (): Promise<void> => {
    while (pending) {
      pending = false;
      const prefs = await deps.readLocal();
      const value = key(prefs) + (deps.mirrorKey ? `|${await deps.mirrorKey()}` : '');
      latest ??= value;
      if (value === synced) {
        // Already mirrored (a request that found nothing new to send).
        if (value === latest) settleWaiters(true);
        continue;
      }
      try {
        await deps.syncRemote(prefs);
        synced = value;
        if (synced === latest) {
          await deps.setDirty(false);
          settleWaiters(true);
        }
        // Newer than what was just sent: `pending` is already set by the
        // write that moved `latest`, so the loop sends it next.
      } catch {
        // Still owed: the dirty flag stays set for the next save or launch.
        settleWaiters(false);
      }
    }
  };

  const requestMirror = () => {
    pending = true;
    if (running === null) {
      running = runMirror().finally(() => {
        running = null;
      });
    }
  };

  const writeLocal = (prefs: UserRecallPreferences) =>
    deps.enqueueLocal(async () => {
      const cleaned = sanitizePreferences(prefs);
      await deps.writeLocal(cleaned);
      await deps.setDirty(true);
      latest = key(cleaned) + (deps.mirrorKey ? `|${await deps.mirrorKey()}` : '');
      for (const listener of listeners) listener(cleaned);
      requestMirror();
      return cleaned;
    });

  return {
    async save(prefs) {
      const confirmed = new Promise<boolean>((resolve) => waiters.push(resolve));
      await writeLocal(prefs);
      return { synced: await confirmed };
    },
    commit: writeLocal,
    readSettled: () => deps.enqueueLocal(() => deps.readLocal()),
    onSaved(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    flush: () =>
      deps.enqueueLocal(async () => {
        if (await deps.isDirty()) requestMirror();
      }),
    async settleMirror() {
      pending = false;
      if (running !== null) await running;
    },
    async mirrorIdle() {
      while (running !== null) await running;
    },
    // Answers `{ synced }` once the mirror attempt covering this change has
    // finished — false while offline — exactly like `save`.
    async touch() {
      const confirmed = new Promise<boolean>((resolve) => waiters.push(resolve));
      await deps.enqueueLocal(async () => {
        await deps.setDirty(true);
        latest = key(await deps.readLocal()) + (deps.mirrorKey ? `|${await deps.mirrorKey()}` : '');
        requestMirror();
      });
      return { synced: await confirmed };
    },
    mirrorOwed: () => deps.isDirty(),
    remirror: () =>
      deps.enqueueLocal(async () => {
        if (deps.readStoredStrict) {
          let stored: UserRecallPreferences | null;
          try {
            stored = await deps.readStoredStrict();
          } catch {
            return; // unreadable: keep the server copy as it is
          }
          if (stored === null) return; // never saved: nothing to restore
        }
        // Forget what was confirmed, so the next run sends the local value.
        synced = null;
        requestMirror();
      }),
  };
}
