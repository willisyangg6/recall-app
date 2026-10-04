/**
 * The access provider (P2B7X.1): the one place the app learns which phase a
 * launch is in — onboarding, paywall, notification education, or the app —
 * and the one place that phase can change.
 *
 * ## What it reads, and when
 *
 * At mount, in parallel with the fonts: the onboarding record (this
 * device's own progress) and the cached verified entitlement, then the
 * purchase provider's reading of the entitlement, bounded by
 * `readWithTimeout` so a silent store never holds the splash. The reading
 * and the cache resolve through `resolveEntitlement` — the pure rule that
 * grants cached access through an outage and fails closed otherwise — and
 * the cache is rewritten with whatever the rule says it should now hold.
 * The entitlement is read again whenever the app returns to the foreground,
 * so an expired subscription meets the paywall on the next return, never a
 * relaunch later.
 *
 * Every read, refresh and apply goes through ONE entitlement session
 * (lib/entitlement-session.ts), which orders them: a refresh that started
 * before a purchase or restore succeeded is discarded whole, a foreground
 * refresh waits for an in-flight store operation, a reading older than the
 * verified fact cannot revoke it, and cache writes are serialized. The
 * StoreKit sheet backgrounds the app, so without that ordering the return
 * to the foreground could overwrite a purchase that had just succeeded
 * (2026-10-04, audit F5).
 *
 * ## What it changes
 *
 * Every transition is a pure function over the record (lib/onboarding-state)
 * written back through the store, or a verified entitlement written to the
 * cache. The phase is DERIVED from the result (lib/access-gate), never set
 * directly, so no screen can move the gate except by producing the fact
 * the gate reads. The root layout renders `Stack.Protected` groups from the
 * phase; the navigator itself moves the shopper when it changes.
 *
 * `reviewingPreview` is the one in-memory input: the standalone paywall's
 * Back. It re-enters the onboarding phase on the Ready step and is
 * forgotten by a relaunch, so a device that completed personalization
 * without an entitlement (a lapsed subscriber) always relaunches on the
 * paywall. A first-time shopper's personalization is completed by the
 * purchase or restore made on the onboarding paywall (2026-09-28), in the
 * same commit as the entitlement.
 *
 * `consumePreferencesSetNotice` hands the Feed its one-time confirmation
 * after either education choice: true exactly once, in the session the
 * education was completed.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { onboardingEntryStep, resolveAccessPhase, type AccessPhase } from '@/lib/access-gate';
import { isEntitled, type ActiveEntitlement, type EntitlementStatus } from '@/lib/entitlement';
import { createEntitlementSession, type EntitlementSession } from '@/lib/entitlement-session';
import { loadCachedEntitlement, saveCachedEntitlement } from '@/lib/entitlement-store';
import {
  completeNotificationEducation as completeEducationRecord,
  completePersonalization as completePersonalizationRecord,
  completeWatchBuild as completeWatchBuildRecord,
  INITIAL_ONBOARDING,
  recordShownStep as recordShownStepRecord,
  type OnboardingRecord,
  type OnboardingStep,
} from '@/lib/onboarding-state';
import { loadOnboardingRecord, saveOnboardingRecord } from '@/lib/onboarding-store';
import { resolvePurchaseProvider } from '@/lib/purchases/provider';
import type { PurchaseProvider } from '@/lib/purchases/purchase-provider';

export interface AccessSnapshot {
  /** Both reads have answered; until then nothing renders under the splash. */
  ready: boolean;
  phase: AccessPhase;
  onboarding: OnboardingRecord;
  entitlement: EntitlementStatus;
  /** The onboarding screen the onboarding phase opens on. */
  entryStep: OnboardingStep;
  reviewingPreview: boolean;
}

export interface AccessActions {
  /** A shown onboarding screen records itself as the resume point. */
  recordShownStep: (step: OnboardingStep) => Promise<void>;
  /** The building interstitial finished its one play: sticky, never replays. */
  completeWatchBuild: () => Promise<void>;
  /**
   * An entitled shopper's Continue on the onboarding paywall: personalization
   * is complete, and the gate opens education (or the app).
   */
  completePersonalization: () => Promise<void>;
  /** The paywall's Back: review the Preview without losing completion. */
  reviewPreview: () => void;
  /** Either education choice: shown once. */
  completeNotificationEducation: () => Promise<void>;
  /**
   * A verified purchase or restore: cache it, complete personalization in the
   * same commit, and open the gate.
   */
  applyEntitlement: (entitlement: ActiveEntitlement) => Promise<void>;
  /** Re-read the entitlement through the provider (foreground, development). */
  refreshEntitlement: () => Promise<void>;
  /**
   * Run a purchase or restore — and, on success, its `applyEntitlement` —
   * under the store guard: a foreground refresh waits until it settles,
   * whatever the outcome.
   */
  runStoreOperation: <T>(operation: () => Promise<T>) => Promise<T>;
  /**
   * Development: re-read everything from disk, as a relaunch would, and
   * answer with the phase that read resolves to and its entry step.
   */
  reload: () => Promise<{ phase: AccessPhase; entryStep: OnboardingStep }>;
  /** True exactly once, after education completes: the Feed's confirmation. */
  consumePreferencesSetNotice: () => boolean;
  provider: PurchaseProvider;
}

export type Access = AccessSnapshot & AccessActions;

const AccessContext = createContext<Access | null>(null);

interface Loaded {
  onboarding: OnboardingRecord;
  entitlement: EntitlementStatus;
}

export function AccessProvider({ children }: { children: ReactNode }) {
  const provider = useMemo(() => resolvePurchaseProvider(), []);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // The same value as `loaded`, readable synchronously: two transitions in
  // one tick (complete personalization, then a purchase) must each see the
  // other's result, and a functional `setState` updater runs at render
  // time, not at call time.
  const loadedRef = useRef<Loaded | null>(null);
  const commit = useCallback((next: Loaded) => {
    loadedRef.current = next;
    setLoaded(next);
  }, []);
  const [reviewingPreview, setReviewingPreview] = useState(false);
  const noticePending = useRef(false);

  /** A status that survived the session's guards lands on the current record. */
  const commitEntitlement = useCallback(
    (entitlement: EntitlementStatus) => {
      const prior = loadedRef.current;
      if (prior !== null) commit({ ...prior, entitlement });
    },
    [commit],
  );

  // The one orderer of launch read, foreground refresh and apply. Its
  // committed statuses land on the current record; the launch read commits
  // through `load` instead, together with the record. Created lazily, on
  // first use from an effect or a handler, never during render.
  const sessionRef = useRef<EntitlementSession | null>(null);
  const session = useCallback((): EntitlementSession => {
    if (sessionRef.current === null) {
      sessionRef.current = createEntitlementSession({
        readEntitlement: () => provider.readEntitlement(),
        loadCache: loadCachedEntitlement,
        saveCache: saveCachedEntitlement,
        now: () => new Date().toISOString(),
        onStatus: commitEntitlement,
      });
    }
    return sessionRef.current;
  }, [provider, commitEntitlement]);

  const load = useCallback(async () => {
    const [onboarding, read] = await Promise.all([
      loadOnboardingRecord().catch(() => ({ ...INITIAL_ONBOARDING })),
      session().read(),
    ]);
    // A read the session declined (one already running, or a store operation
    // in flight — the development reload only) keeps the last status.
    const entitlement: EntitlementStatus = read ??
      loadedRef.current?.entitlement ?? { kind: 'inactive', reason: 'unconfirmed' };
    commit({ onboarding, entitlement });
    return { onboarding, entitlement };
  }, [session, commit]);

  useEffect(() => {
    // Deferred a tick so the effect body itself sets no state (the reads are
    // asynchronous anyway; this keeps the intent legible to the lint rule).
    void Promise.resolve().then(load);
  }, [load]);

  const refreshEntitlement = useCallback(async () => {
    await session().read();
  }, [session]);

  const runStoreOperation = useCallback(
    <T,>(operation: () => Promise<T>) => session().runStoreOperation(operation),
    [session],
  );

  // Foreground re-check: an expired subscription meets the paywall on return.
  // The session defers it while a purchase or restore is in flight.
  useEffect(() => {
    const onChange = (status: AppStateStatus) => {
      if (status === 'active' && loaded !== null) session().onForeground();
    };
    const subscription = AppState.addEventListener('change', onChange);
    return () => subscription.remove();
  }, [loaded, session]);

  const writeOnboarding = useCallback(
    async (next: (record: OnboardingRecord) => OnboardingRecord) => {
      const prior = loadedRef.current;
      if (prior === null) return;
      const record = next(prior.onboarding);
      if (record === prior.onboarding) return;
      // The in-memory record is the truth for this session the moment it is
      // committed; the write is what a relaunch resumes from.
      commit({ ...prior, onboarding: record });
      await saveOnboardingRecord(record).catch(() => {});
    },
    [commit],
  );

  const recordShownStep = useCallback(
    (step: OnboardingStep) => writeOnboarding((record) => recordShownStepRecord(record, step)),
    [writeOnboarding],
  );

  const completeWatchBuild = useCallback(
    () => writeOnboarding(completeWatchBuildRecord),
    [writeOnboarding],
  );

  const completePersonalization = useCallback(async () => {
    setReviewingPreview(false);
    await writeOnboarding(completePersonalizationRecord);
  }, [writeOnboarding]);

  const reviewPreview = useCallback(() => setReviewingPreview(true), []);

  const completeNotificationEducation = useCallback(async () => {
    noticePending.current = true;
    await writeOnboarding(completeEducationRecord);
  }, [writeOnboarding]);

  // A verified purchase or restore is made on the onboarding paywall or the
  // standalone paywall, and either way the shopper has finished
  // personalizing. So the
  // record is completed in the SAME commit as the entitlement: the gate goes
  // from the Ready step straight to education, never through the paywall
  // phase in between. On the paywall the record is already complete and
  // `completePersonalization` hands back the same record.
  //
  // `session().apply` advances the sequence synchronously, so a refresh in
  // flight is already stale before this commit, and queues the cache write
  // behind any pending one.
  const applyEntitlement = useCallback(
    async (entitlement: ActiveEntitlement) => {
      const written = session().apply(entitlement);
      setReviewingPreview(false);
      const prior = loadedRef.current;
      if (prior === null) {
        await written;
        return;
      }
      const onboarding = completePersonalizationRecord(prior.onboarding);
      commit({
        onboarding,
        entitlement: { kind: 'active', entitlement, confirmation: 'verified' },
      });
      if (onboarding !== prior.onboarding) {
        await saveOnboardingRecord(onboarding).catch(() => {});
      }
      await written;
    },
    [session, commit],
  );

  const reload = useCallback(async () => {
    setReviewingPreview(false);
    const { onboarding, entitlement } = await load();
    const inputs = { onboarding, entitled: isEntitled(entitlement), reviewingPreview: false };
    return { phase: resolveAccessPhase(inputs), entryStep: onboardingEntryStep(inputs) };
  }, [load]);

  const consumePreferencesSetNotice = useCallback(() => {
    const pending = noticePending.current;
    noticePending.current = false;
    return pending;
  }, []);

  const value = useMemo<Access>(() => {
    const onboarding = loaded?.onboarding ?? INITIAL_ONBOARDING;
    const entitlement: EntitlementStatus = loaded?.entitlement ?? { kind: 'loading' };
    const inputs = { onboarding, entitled: isEntitled(entitlement), reviewingPreview };
    return {
      ready: loaded !== null,
      phase: resolveAccessPhase(inputs),
      onboarding,
      entitlement,
      entryStep: onboardingEntryStep(inputs),
      reviewingPreview,
      recordShownStep,
      completeWatchBuild,
      completePersonalization,
      reviewPreview,
      completeNotificationEducation,
      applyEntitlement,
      refreshEntitlement,
      runStoreOperation,
      reload,
      consumePreferencesSetNotice,
      provider,
    };
  }, [
    loaded,
    reviewingPreview,
    recordShownStep,
    completeWatchBuild,
    completePersonalization,
    reviewPreview,
    completeNotificationEducation,
    applyEntitlement,
    refreshEntitlement,
    runStoreOperation,
    reload,
    consumePreferencesSetNotice,
    provider,
  ]);

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

/** The access state and actions. Every route renders beneath the provider. */
export function useAccess(): Access {
  const access = useContext(AccessContext);
  if (access === null) throw new Error('useAccess must be used beneath AccessProvider');
  return access;
}
