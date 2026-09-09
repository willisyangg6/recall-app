/**
 * Bounded retry for the store's READ-ONLY operations, applied as a decorator
 * so the retry policy lives in exactly one place and cannot drift per call
 * site.
 *
 * ── WHY A DECORATOR, NOT INLINE RETRIES ────────────────────────────────────
 * The safety property that matters is "no mutation is ever retried". Inline
 * retries make that a property of ~50 method bodies, re-checked by hand on
 * every future edit. Here it is a property of one literal set:
 * RETRYABLE_READ_METHODS. Everything else — including any method added to
 * RecallStore later — passes through untouched and is invoked exactly once.
 * The default is "not retried", so forgetting to update this file is safe.
 *
 * store/read-retry.test.ts enforces the rest mechanically: every allowlisted
 * name exists on SupabaseStore, every allowlisted name is `.select()`-only in
 * the source, and the allowlist is disjoint from every mutating method.
 *
 * Transient-read hardening after the 2026-09-08/09 incident; see
 * ../transient-retry.ts for the fault classes and the policy rationale.
 */

import {
  DEFAULT_READ_RETRY_POLICY,
  retryTransientRead,
  type RetryHooks,
  type RetryPolicy,
} from '../transient-retry';

/**
 * Every `RecallStore` operation that is a pure read — verified `.select()`-only
 * against supabase-store.ts by read-retry.test.ts.
 *
 * DO NOT add a name here without confirming the method performs no insert,
 * update, upsert, delete, or RPC, directly or through another store method.
 * Read-modify-write helpers (updateCaseHazard, seedLegacyAppliedMarker, …) read
 * first and are still mutations; they do not belong in this set.
 */
export const RETRYABLE_READ_METHODS: ReadonlySet<string> = new Set([
  'countRecentMaterialUpdates',
  'getCase',
  'getCaseGeneratedColumns',
  'getLatestSnapshotHash',
  'getLatestSnapshotMeta',
  'getLatestSnapshotPayload',
  'getSourceRecordByNativeId',
  'getSourceRecordGateByNativeId',
  'getSourceRecordLinkByNativeId',
  'getSourceRecordsForCase',
  'hasNotificationEvent',
  'listAppliedStateHealthPage',
  'listCaseAuditPage',
  'listCaseProducts',
  'listCaseProductsPage',
  'listCaseTokensPage',
  'listCaseVisuals',
  'listCases',
  'listInitialEventCasePage',
  'listRecentJobRuns',
  'listSnapshotsBySeq',
  'listSourceRecordIdentities',
  'listSourceRecords',
  'listSourceRecordsPage',
  'listSourceRecordsSince',
]);

export interface ReadRetryOptions extends RetryHooks {
  policy?: RetryPolicy;
  /** Prefixes the operation name in diagnostics. */
  label?: string;
}

/**
 * Wrap a store so its read-only operations retry transient infrastructure
 * faults. Mutations are returned as-is and are called exactly once.
 */
export function withReadRetry<T extends object>(store: T, options: ReadRetryOptions = {}): T {
  const { policy = DEFAULT_READ_RETRY_POLICY, label = 'store', ...hooks } = options;
  const cache = new Map<string, unknown>();

  return new Proxy(store, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function' || typeof property !== 'string') return value;

      const cached = cache.get(property);
      if (cached) return cached;

      const method = value as (...args: unknown[]) => unknown;
      // Not an allowlisted read ⇒ bound through untouched, at most one call.
      const wrapped = RETRYABLE_READ_METHODS.has(property)
        ? (...args: unknown[]) =>
            retryTransientRead(
              `${label}.${property}`,
              () => Promise.resolve(method.apply(target, args)),
              policy,
              hooks,
            )
        : method.bind(target);

      cache.set(property, wrapped);
      return wrapped;
    },
  }) as T;
}
