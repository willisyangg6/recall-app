/**
 * Store listings for this session (lib/store-listings.ts). In memory only,
 * loaded once per session, failing closed to []: a listing that is no longer
 * linked disappears on the next load. No cache, so no schema version.
 */

import { useEffect, useSyncExternalStore } from 'react';

import { fetchStoreListings, type StoreListing } from '@/lib/store-listings';

let listings: StoreListing[] = [];
let loaded = false;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): StoreListing[] {
  return listings;
}

export function reloadStoreListings(): Promise<void> {
  inFlight ??= fetchStoreListings()
    .then((next) => {
      listings = next;
      loaded = true;
      for (const listener of listeners) listener();
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function useStoreListings(): StoreListing[] {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (!loaded) void reloadStoreListings();
  }, []);
  return current;
}
