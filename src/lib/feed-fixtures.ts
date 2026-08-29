/**
 * Deterministic feed fixtures for the C8 cache/sync tests. Synthetic test
 * inputs only — never displayed or persisted as recall data outside tests
 * (AGENTS.md: recall data is never fabricated for consumers; these items
 * exist so tests can prove invariants over corpora larger than the real
 * one, including the >500-case sizes that broke the pre-C5.1 loader).
 */

import type { FeedItem, FeedManifestEntry } from './recall-feed';
import type { FeedCacheStore } from './feed-cache-store';

const STATES = [['CA'], ['CA', 'TX'], ['NY'], ['WA', 'OR'], ['FL']];
const ALLERGENS = ['sesame', 'peanut', 'milk', null, null];
const RETAILERS = [['Costco'], ['Trader Joe’s'], ['Walmart'], [], []];
const HAZARDS = [
  'allergen',
  'microbial_contamination',
  'foreign_material',
  'product_integrity',
] as const;

/**
 * One deterministic synthetic case. Ids are zero-padded so id ordering (the
 * pagination cursor order) is stable; seeds spread publication dates across
 * ~10 months so both Recent and Older Active sections populate, and vary
 * geography/allergen/retailer so "affects me" and every filter see hits and
 * misses alike.
 */
export function makeFeedItem(seed: number, overrides: Partial<FeedItem> = {}): FeedItem {
  const day = (seed * 7) % 300;
  const published = new Date(Date.UTC(2026, 7, 28) - day * 86_400_000).toISOString();
  const geographyKind = seed % 4;
  const classification =
    seed % 3 === 0
      ? { value: 'class_i' as const, sourceText: 'High - Class I', officialClasses: ['class_i'] }
      : seed % 3 === 1
        ? {
            value: 'class_ii' as const,
            sourceText: 'Low - Class II',
            officialClasses: ['class_ii'],
          }
        : { value: 'not_yet_classified' as const, sourceText: null };
  return {
    id: `case-${String(seed).padStart(5, '0')}`,
    sourceAgency: seed % 2 === 0 ? 'FDA' : 'FSIS',
    noticeType: seed % 11 === 0 ? 'public_health_alert' : 'recall',
    state: 'active',
    title: `Test Firm ${seed} Recalls Product ${seed} Because of Possible Health Risk`,
    classification: classification as FeedItem['classification'],
    hazardCategory: HAZARDS[seed % HAZARDS.length],
    publishedAt: published,
    lastPublicActivityAt: published,
    reasonText: `undeclared ${ALLERGENS[seed % ALLERGENS.length] ?? 'contamination'}`,
    pathogenOrAllergen: ALLERGENS[seed % ALLERGENS.length],
    firmName: `Test Firm ${seed} LLC`,
    brands: [`Brand${seed}`],
    productDescription: `Product ${seed} (${(seed % 9) + 8} oz)`,
    retailerNames: RETAILERS[seed % RETAILERS.length],
    heroImageUrl: seed % 5 === 0 ? `https://example.test/hero-${seed}.webp` : null,
    productNames: [`Product ${seed} Original`, `UPC 0 12345 ${String(seed).padStart(5, '0')} 1`],
    geography:
      geographyKind === 0
        ? { scope: 'nationwide', states: [], confidence: 'stated', sourceText: 'Nationwide' }
        : geographyKind === 3
          ? { scope: 'unknown', states: [], confidence: 'inferred', sourceText: null }
          : {
              scope: 'states',
              states: STATES[seed % STATES.length],
              confidence: 'stated',
              sourceText: STATES[seed % STATES.length].join(', '),
            },
    officialUrl: `https://example.test/notice-${seed}`,
    timeline: [
      {
        occurredAt: published,
        kind: 'published',
        summary: 'Recall published.',
        causedBySnapshotIds: [],
        material: false,
      },
      ...(seed % 6 === 0
        ? [
            {
              occurredAt: new Date(Date.parse(published) + 3 * 86_400_000).toISOString(),
              kind: 'expanded' as const,
              summary: 'The agency expanded this recall.',
              causedBySnapshotIds: [],
              material: true,
              ruleId: 'expansion_products' as const,
            },
          ]
        : []),
    ],
    ...overrides,
  };
}

export function makeCorpus(size: number): FeedItem[] {
  return Array.from({ length: size }, (_, index) => makeFeedItem(index + 1));
}

/** Manifest for a corpus; tokens are opaque — tests derive them from content. */
export function manifestFor(items: FeedItem[], tokenOf?: (item: FeedItem) => string) {
  const token = tokenOf ?? ((item: FeedItem) => `v:${JSON.stringify(item).length}:${item.id}`);
  return items.map((item): FeedManifestEntry => ({ id: item.id, version: token(item) }));
}

/** In-memory FeedCacheStore with observable writes, for engine tests. */
export function memoryCacheStore(initial: string | null = null) {
  let stored = initial;
  const writes: string[] = [];
  let failWrites = false;
  const store: FeedCacheStore = {
    read: async () => stored,
    write: async (text: string) => {
      if (failWrites) return false;
      stored = text;
      writes.push(text);
      return true;
    },
    clear: async () => {
      stored = null;
    },
  };
  return {
    store,
    writes,
    current: () => stored,
    setStored: (text: string | null) => {
      stored = text;
    },
    setFailWrites: (value: boolean) => {
      failWrites = value;
    },
  };
}

export interface ScriptedTransport {
  transport: {
    fetchManifest(): Promise<FeedManifestEntry[]>;
    fetchAll(): Promise<FeedItem[]>;
    fetchByIds(ids: string[]): Promise<FeedItem[]>;
  };
  calls: { manifest: number; all: number; byIds: string[][] };
  setManifest(entries: FeedManifestEntry[] | Error): void;
  setAll(items: FeedItem[] | Error): void;
  setByIds(handler: ((ids: string[]) => FeedItem[]) | Error): void;
}

/**
 * A scripted transport: serves configured responses, records every call, and
 * throws where a test injects an Error — the network in miniature.
 */
export function scriptedTransport(initialItems: FeedItem[]): ScriptedTransport {
  let manifest: FeedManifestEntry[] | Error = manifestFor(initialItems);
  let all: FeedItem[] | Error = initialItems;
  let byIds: ((ids: string[]) => FeedItem[]) | Error = (ids) => {
    const byId = new Map((all as FeedItem[]).map((item) => [item.id, item]));
    return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  };
  const calls = { manifest: 0, all: 0, byIds: [] as string[][] };
  return {
    transport: {
      async fetchManifest() {
        calls.manifest += 1;
        if (manifest instanceof Error) throw manifest;
        return manifest;
      },
      async fetchAll() {
        calls.all += 1;
        if (all instanceof Error) throw all;
        return all;
      },
      async fetchByIds(ids: string[]) {
        calls.byIds.push([...ids]);
        if (byIds instanceof Error) throw byIds;
        return byIds(ids);
      },
    },
    calls,
    setManifest: (entries) => {
      manifest = entries;
    },
    setAll: (items) => {
      all = items;
    },
    setByIds: (handler) => {
      byIds = handler;
    },
  };
}
