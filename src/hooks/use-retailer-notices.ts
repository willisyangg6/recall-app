/**
 * Approved retailer notices for this session (lib/retailer-notices.ts).
 *
 * In memory only, never persisted: there is no stored payload whose shape a
 * later release could misread, and the agency feed cache is untouched. Every
 * screen shares one list, loaded once per session and again on each Feed
 * refresh.
 *
 * Fail closed: each load replaces the list with the server's answer, and a
 * failed load answers []. A withdrawn, revised or agency-matched notice
 * therefore disappears on the next load, and an outage hides retailer notices
 * rather than keep showing ones that may no longer be approved.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { fetchRetailerNotices, type RetailerNotice } from '@/lib/retailer-notices';

let notices: RetailerNotice[] = [];
let loaded = false;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): RetailerNotice[] {
  return notices;
}

/** Reload from the server; the answer (or [] on failure) replaces the list. */
export function reloadRetailerNotices(): Promise<void> {
  inFlight ??= fetchRetailerNotices()
    .then((next) => {
      notices = next;
      loaded = true;
      for (const listener of listeners) listener();
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** One approved notice by id from this session's list, or null. */
export function retailerNoticeById(id: string): RetailerNotice | null {
  return notices.find((notice) => notice.id === id) ?? null;
}

export function useRetailerNotices(): {
  notices: RetailerNotice[];
  reload: () => Promise<void>;
} {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (!loaded) void reloadRetailerNotices();
  }, []);
  const reload = useCallback(() => reloadRetailerNotices(), []);
  return { notices: current, reload };
}
