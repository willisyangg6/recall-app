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
 * ## What it changes
 *
 * Every transition is a pure function over the record (lib/onboarding-state)
 * written back through the store, or a verified entitlement written to the
 * cache. The phase is DERIVED from the result (lib/access-gate), never set
 * directly, so no screen can move the gate except by producing the fact
 * the gate reads. The root layout renders `Stack.Protected` groups from the
 * phase; the navigator itself moves the shopper when it changes.
 *
 * `reviewingPreview` is the one in-memory input: the paywall's Back. It
 * re-enters the onboarding phase on the Preview and is forgotten by a
 * relaunch, so a device that completed personalization always relaunches on
 * the paywall.
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
import {
  isEntitled,
  readWithTimeout,
  resolveEntitlement,
  type ActiveEntitlement,
  type EntitlementStatus,
} from '@/lib/entitlement';
import { loadCachedEntitlement, saveCachedEntitlement } from '@/lib/entitlement-store';
import {
  completeNotificationEducation as completeEducationRecord,
  completePersonalization as completePersonalizationRecord,
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
  /** "View plans": personalization is complete; the paywall follows. */
  completePersonalization: () => Promise<void>;
  /** The paywall's Back: review the Preview without losing completion. */
  reviewPreview: () => void;
  /** Either education choice: shown once. */
  completeNotificationEducation: () => Promise<void>;
  /** A verified purchase or restore: cache it and open the gate. */
  applyEntitlement: (entitlement: ActiveEntitlement) => Promise<void>;
  /** Re-read the entitlement through the provider (foreground, development). */
  refreshEntitlement: () => Promise<void>;
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
  const refreshing = useRef(false);

  /** Read the provider, resolve against the cache, persist the cache. */
  const readEntitlement = useCallback(async (): Promise<EntitlementStatus> => {
    const cache = await loadCachedEntitlement();
    const reading = await readWithTimeout(provider.readEntitlement());
    const resolution = resolveEntitlement(reading, cache, new Date().toISOString());
    if (resolution.cache !== cache) await saveCachedEntitlement(resolution.cache);
    return resolution.status;
  }, [provider]);

  const load = useCallback(async () => {
    const [onboarding, entitlement] = await Promise.all([
      loadOnboardingRecord().catch(() => ({ ...INITIAL_ONBOARDING })),
      readEntitlement().catch<EntitlementStatus>(() => ({
        kind: 'inactive',
        reason: 'unconfirmed',
      })),
    ]);
    commit({ onboarding, entitlement });
    return { onboarding, entitlement };
  }, [readEntitlement, commit]);

  useEffect(() => {
    // Deferred a tick so the effect body itself sets no state (the reads are
    // asynchronous anyway; this keeps the intent legible to the lint rule).
    void Promise.resolve().then(load);
  }, [load]);

  const refreshEntitlement = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const entitlement = await readEntitlement();
      const prior = loadedRef.current;
      if (prior !== null) commit({ ...prior, entitlement });
    } catch {
      // A failed refresh keeps the last resolved status; the next one settles it.
    } finally {
      refreshing.current = false;
    }
  }, [readEntitlement, commit]);

  // Foreground re-check: an expired subscription meets the paywall on return.
  useEffect(() => {
    const onChange = (status: AppStateStatus) => {
      if (status === 'active' && loaded !== null) void refreshEntitlement();
    };
    const subscription = AppState.addEventListener('change', onChange);
    return () => subscription.remove();
  }, [loaded, refreshEntitlement]);

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

  const completePersonalization = useCallback(async () => {
    setReviewingPreview(false);
    await writeOnboarding(completePersonalizationRecord);
  }, [writeOnboarding]);

  const reviewPreview = useCallback(() => setReviewingPreview(true), []);

  const completeNotificationEducation = useCallback(async () => {
    noticePending.current = true;
    await writeOnboarding(completeEducationRecord);
  }, [writeOnboarding]);

  const applyEntitlement = useCallback(
    async (entitlement: ActiveEntitlement) => {
      await saveCachedEntitlement(entitlement).catch(() => {});
      setReviewingPreview(false);
      const prior = loadedRef.current;
      if (prior !== null) {
        commit({
          ...prior,
          entitlement: { kind: 'active', entitlement, confirmation: 'verified' },
        });
      }
    },
    [commit],
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
      completePersonalization,
      reviewPreview,
      completeNotificationEducation,
      applyEntitlement,
      refreshEntitlement,
      reload,
      consumePreferencesSetNotice,
      provider,
    };
  }, [
    loaded,
    reviewingPreview,
    recordShownStep,
    completePersonalization,
    reviewPreview,
    completeNotificationEducation,
    applyEntitlement,
    refreshEntitlement,
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
