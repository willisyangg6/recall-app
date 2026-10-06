/**
 * The Ready photo sessions, shared between the screen that starts them early
 * and the screen that shows them (2026-10-05).
 *
 * The Building step knows the corpus and the preferences long before Ready
 * mounts, so it starts Ready's photo session then (`warm`) and Ready adopts
 * it: the photos are usually answered by the time the deck is drawn, and the
 * shopper sees no second wait. Building never awaits the session and never
 * reads it, so its timing, gates and count are untouched.
 *
 * ## The key is the work, not an object
 *
 * A session's only input is its ordered candidate URLs
 * (`photoCandidates`), so that list IS the key. Two screens that derive the
 * same candidates from the same corpus and preferences share one session,
 * whatever array objects they hold; a corpus update or a preference change
 * that changes the candidates gets a new session; one that does not keeps
 * the session it has. Nothing is keyed by identity.
 *
 * ## Bounded
 *
 *   - At most `PHOTO_SESSION_LIMIT` sessions are kept. A new one evicts the
 *     least recently used session that no screen is watching, cancelling it.
 *     A watched session is never evicted, so the bound can be exceeded only
 *     by screens that are mounted at once.
 *   - A session no screen watches is cancelled `PHOTO_SESSION_IDLE_MS` after
 *     its last watcher left (or after a warm-up nobody adopted), so a
 *     Building step whose Ready never came, or a Ready that was left, costs
 *     nothing for long. Coming back inside that time reuses the session.
 *   - A cancelled session never notifies again (lib/ready-photo-session.ts).
 *
 * Direct entry onto Ready (a cold resume, a deep link) has no warm session:
 * the first watcher starts one, bounded by the session's own deadline,
 * exactly as before.
 */

import type { PhotoSession } from './ready-photo-session';

/** Sessions kept at once (one warming, one shown, one being left). */
export const PHOTO_SESSION_LIMIT = 3;
/** How long an unwatched session is kept for a screen that may still adopt it. */
export const PHOTO_SESSION_IDLE_MS = 60_000;

/** The session's verdicts, frozen at each change: what a render may read. */
export interface PhotoSnapshot {
  settled: boolean;
  loaded: (url: string) => boolean;
}

export const NOT_STARTED: PhotoSnapshot = { settled: false, loaded: () => false };

/** What happened to a session, for development logging and tests. */
export type PhotoRegistryEvent =
  | { kind: 'started'; key: string; candidates: number; by: 'warm' | 'watch' }
  | { kind: 'adopted'; key: string; settled: boolean }
  | { kind: 'expired' | 'evicted'; key: string }
  | { kind: 'failed'; key: string; url: string };

export interface PhotoRegistryDeps {
  start: (candidates: readonly string[], onChange: () => void) => PhotoSession;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  limit?: number;
  idleMs?: number;
  onEvent?: (event: PhotoRegistryEvent) => void;
}

export interface PhotoRegistry {
  /** Start this session now if it is not running; nothing watches it yet. */
  warm(candidates: readonly string[]): void;
  /** The session's current snapshot, or `NOT_STARTED` when it is not running. Never starts one. */
  snapshot(key: string): PhotoSnapshot;
  /** Watch a session, starting it if needed. The returned function stops watching. */
  subscribe(candidates: readonly string[], listener: () => void): () => void;
  /** A shown photo failed to render: that session treats it as absent. */
  fail(key: string, url: string): void;
  /** Keys currently held, least recently used first. */
  keys(): string[];
  /** Cancel and forget every session (development reset, tests). */
  clear(): void;
}

export function photoSessionKey(candidates: readonly string[]): string {
  return candidates.join('\n');
}

interface Entry {
  key: string;
  session: PhotoSession | null;
  snapshot: PhotoSnapshot;
  listeners: Set<() => void>;
  idle: unknown;
  used: number;
  adopted: boolean;
}

export function createPhotoRegistry(deps: PhotoRegistryDeps): PhotoRegistry {
  const schedule = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const unschedule = deps.clearTimeout ?? ((handle) => clearTimeout(handle as never));
  const limit = Math.max(1, deps.limit ?? PHOTO_SESSION_LIMIT);
  const idleMs = deps.idleMs ?? PHOTO_SESSION_IDLE_MS;
  const entries = new Map<string, Entry>();
  let clock = 0;

  const drop = (entry: Entry, kind: 'expired' | 'evicted') => {
    if (entries.get(entry.key) !== entry) return;
    if (entry.idle !== null) unschedule(entry.idle);
    entry.idle = null;
    entry.session?.cancel();
    entries.delete(entry.key);
    deps.onEvent?.({ kind, key: entry.key });
  };

  const idleLater = (entry: Entry) => {
    if (entry.idle !== null) unschedule(entry.idle);
    entry.idle = schedule(() => {
      entry.idle = null;
      if (entry.listeners.size === 0) drop(entry, 'expired');
    }, idleMs);
  };

  const refresh = (entry: Entry) => {
    if (entry.session === null) return; // a synchronous answer during start
    entry.snapshot = { settled: entry.session.settled(), loaded: entry.session.isLoaded };
    for (const listener of [...entry.listeners]) listener();
  };

  const ensure = (candidates: readonly string[], by: 'warm' | 'watch'): Entry => {
    const key = photoSessionKey(candidates);
    clock += 1;
    const existing = entries.get(key);
    if (existing) {
      existing.used = clock;
      return existing;
    }
    const entry: Entry = {
      key,
      session: null,
      snapshot: NOT_STARTED,
      listeners: new Set(),
      idle: null,
      used: clock,
      adopted: by === 'watch',
    };
    entries.set(key, entry);
    entry.session = deps.start(candidates, () => refresh(entry));
    entry.snapshot = { settled: entry.session.settled(), loaded: entry.session.isLoaded };
    deps.onEvent?.({ kind: 'started', key, candidates: candidates.length, by });
    idleLater(entry);
    // Over the bound: the least recently used unwatched sessions go first.
    if (entries.size > limit) {
      const idle = [...entries.values()]
        .filter((other) => other !== entry && other.listeners.size === 0)
        .sort((a, b) => a.used - b.used);
      for (const other of idle) {
        if (entries.size <= limit) break;
        drop(other, 'evicted');
      }
    }
    return entry;
  };

  return {
    warm(candidates) {
      ensure(candidates, 'warm');
    },
    snapshot(key) {
      return entries.get(key)?.snapshot ?? NOT_STARTED;
    },
    subscribe(candidates, listener) {
      const entry = ensure(candidates, 'watch');
      if (!entry.adopted) {
        entry.adopted = true;
        deps.onEvent?.({ kind: 'adopted', key: entry.key, settled: entry.snapshot.settled });
      }
      entry.listeners.add(listener);
      if (entry.idle !== null) unschedule(entry.idle);
      entry.idle = null;
      return () => {
        entry.listeners.delete(listener);
        if (entry.listeners.size === 0 && entries.get(entry.key) === entry) idleLater(entry);
      };
    },
    fail(key, url) {
      const entry = entries.get(key);
      if (!entry?.session) return;
      deps.onEvent?.({ kind: 'failed', key, url });
      entry.session.fail(url);
    },
    keys() {
      return [...entries.values()].sort((a, b) => a.used - b.used).map((entry) => entry.key);
    },
    clear() {
      for (const entry of [...entries.values()]) drop(entry, 'evicted');
    },
  };
}
