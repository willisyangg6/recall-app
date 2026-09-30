/**
 * Onboarding state (P2B7X.1; restructured 2026-09-28): the VERSIONED record
 * of how far a shopper has come through first launch, kept apart from the
 * preferences it collects.
 *
 * ## Why a record of its own, and not the preferences
 *
 * Whether onboarding is finished cannot be inferred from the preference
 * values. Allergens and stores are optional, so a shopper who chose none has
 * an EMPTY list that is a complete answer — exactly the same bytes as a
 * shopper who has never seen the question. Only an explicit record can tell
 * those apart, so completion is written as a fact here and never derived
 * from `UserRecallPreferences`.
 *
 * ## The sequence (2026-09-28)
 *
 *   Welcome → the two problem screens (the scale of foodborne illness, then
 *   who faces higher stakes) → States → Allergens → Stores → the one-time
 *   "building your watch" interstitial → Ready (the personalized preview)
 *   → the onboarding paywall → purchase or restore → education
 *
 * Five screens carry the segmented progress bar: the two problem screens
 * and the three selectors. Welcome, the interstitial, Ready and the paywall
 * do not.
 *
 * ## What the record holds
 *
 *   step                           the screen to resume on — the last
 *                                  onboarding screen that was shown — while
 *                                  personalization is incomplete
 *   watchBuilt                     sticky: the "building your watch"
 *                                  interstitial has played to completion
 *                                  once; it never replays
 *   personalizationCompleted       sticky: once true it never regresses,
 *                                  however the shopper later moves through
 *                                  the selectors again (editing preferences
 *                                  never restarts onboarding)
 *   notificationEducationCompleted sticky: the education screen is shown
 *                                  once, after the first entitlement success
 *
 * Every transition is a pure function over the record, so the whole state
 * machine is provable under Node; the store (onboarding-store.ts) only reads
 * and writes what these functions return. `sanitizeOnboardingRecord` is the
 * one place a stored blob of any version becomes a current record, following
 * `sanitizePreferences`: a well-formed version-1 record (the four-step flow
 * this restructure replaced) migrates to a version-2 record that keeps the
 * shopper's place, and an unknown or corrupt value degrades to the INITIAL
 * record (onboarding from the start), never to a half-completed one.
 */

// ── The steps ───────────────────────────────────────────────────────────────

export type OnboardingStep =
  | 'welcome'
  | 'problem-scale'
  | 'problem-risk'
  | 'states'
  | 'allergens'
  | 'retailers'
  | 'building'
  | 'preview'
  | 'paywall';

/** The screens in flow order. */
export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  'welcome',
  'problem-scale',
  'problem-risk',
  'states',
  'allergens',
  'retailers',
  'building',
  'preview',
  'paywall',
];

/**
 * The five screens the segmented progress bar counts, in order. Welcome, the
 * building interstitial, Ready and the paywall show no bar.
 */
export const COUNTED_STEPS: readonly OnboardingStep[] = [
  'problem-scale',
  'problem-risk',
  'states',
  'allergens',
  'retailers',
];

export interface StepProgress {
  /** 1-based position among the counted steps. */
  index: number;
  total: number;
}

/** The bar's model for a counted step; null for every screen without a bar. */
export function stepProgress(step: OnboardingStep): StepProgress | null {
  const index = COUNTED_STEPS.indexOf(step);
  return index === -1 ? null : { index: index + 1, total: COUNTED_STEPS.length };
}

/**
 * The progress bar's one spoken sentence. There is no visible numeric
 * progress copy (2026-09-28); the count exists for assistive technology.
 */
export function progressAccessibilityLabel(progress: StepProgress): string {
  return `Onboarding progress, step ${progress.index} of ${progress.total}`;
}

/**
 * Onboarding motion plays only when Reduce Motion is KNOWN to be off; on, or
 * not yet known, means the final state at once (DESIGN.md, "Reduced motion").
 */
export function motionAllowed(reduceMotion: boolean | null): boolean {
  return reduceMotion === false;
}

/**
 * Whether the current segment's one-time fill plays: only when the step was
 * reached forward from the one directly before it. First shown (a fresh
 * process, a resumed launch), reached by Back, or re-entered, the bar draws
 * its final state on the first frame.
 */
export function segmentFillAnimates(lastShownIndex: number | null, index: number): boolean {
  return lastShownIndex !== null && index === lastShownIndex + 1;
}

/** How many of the bar's segments are filled: every completed step and the current one. */
export function filledSegments(progress: StepProgress): boolean[] {
  return Array.from({ length: progress.total }, (_, i) => i < progress.index);
}

export function nextStep(step: OnboardingStep): OnboardingStep | null {
  const at = ONBOARDING_STEPS.indexOf(step);
  return ONBOARDING_STEPS[at + 1] ?? null;
}

/**
 * The screen Back returns to. NOT the flow's inverse everywhere: the
 * building interstitial plays between Stores and Ready but never joins the
 * back chain — Back from Ready goes to Stores, and the interstitial itself
 * (which has no back control) resolves to Stores if it ever needs a
 * predecessor on a resumed launch.
 */
export function previousStep(step: OnboardingStep): OnboardingStep | null {
  switch (step) {
    case 'welcome':
      return null;
    case 'building':
    case 'preview':
      return 'retailers';
    case 'paywall':
      return 'preview';
    default: {
      const at = ONBOARDING_STEPS.indexOf(step);
      return at <= 0 ? null : (ONBOARDING_STEPS[at - 1] ?? null);
    }
  }
}

export function isOnboardingStep(value: unknown): value is OnboardingStep {
  return typeof value === 'string' && (ONBOARDING_STEPS as readonly string[]).includes(value);
}

// ── The record ──────────────────────────────────────────────────────────────

export const ONBOARDING_RECORD_VERSION = 2;

export interface OnboardingRecord {
  version: typeof ONBOARDING_RECORD_VERSION;
  step: OnboardingStep;
  watchBuilt: boolean;
  personalizationCompleted: boolean;
  notificationEducationCompleted: boolean;
}

/** A device that has never onboarded: Welcome, nothing completed. */
export const INITIAL_ONBOARDING: OnboardingRecord = {
  version: ONBOARDING_RECORD_VERSION,
  step: 'welcome',
  watchBuilt: false,
  personalizationCompleted: false,
  notificationEducationCompleted: false,
};

/** The version-1 steps (the four-step flow), all of which still exist. */
const V1_STEPS: readonly string[] = ['welcome', 'states', 'allergens', 'retailers', 'preview'];

/**
 * Validate an untrusted stored value into a current record.
 *
 * A well-formed version-1 record — the flow before the problem screens, the
 * interstitial and the onboarding paywall existed — keeps the shopper's
 * place: its steps all still exist, and `watchBuilt` is derived so a shopper
 * who had already reached Ready (or finished) is never pulled back through
 * the interstitial, while one still in the selectors meets it once, when
 * they get there. Anything else is the INITIAL record — a corrupt or future
 * blob restarts onboarding rather than skipping it, which is the safe
 * direction for a gate.
 */
export function sanitizeOnboardingRecord(raw: unknown): OnboardingRecord {
  if (typeof raw !== 'object' || raw === null) return { ...INITIAL_ONBOARDING };
  const value = raw as Record<string, unknown>;
  if (
    !isOnboardingStep(value.step) ||
    typeof value.personalizationCompleted !== 'boolean' ||
    typeof value.notificationEducationCompleted !== 'boolean'
  ) {
    return { ...INITIAL_ONBOARDING };
  }
  const base = {
    step: value.step,
    personalizationCompleted: value.personalizationCompleted,
    // Education can only have been completed after personalization was.
    notificationEducationCompleted:
      value.personalizationCompleted && value.notificationEducationCompleted,
  };
  if (value.version === ONBOARDING_RECORD_VERSION && typeof value.watchBuilt === 'boolean') {
    return { version: ONBOARDING_RECORD_VERSION, watchBuilt: value.watchBuilt, ...base };
  }
  if (value.version === 1 && V1_STEPS.includes(value.step)) {
    return {
      version: ONBOARDING_RECORD_VERSION,
      watchBuilt: value.personalizationCompleted || value.step === 'preview',
      ...base,
    };
  }
  return { ...INITIAL_ONBOARDING };
}

// ── Transitions ─────────────────────────────────────────────────────────────

/**
 * The shown screen becomes the resume point — ONLY while personalization is
 * incomplete. Once complete, moving through the selectors again (Edit
 * preferences from Ready, or the paywall's Back) records nothing, so a
 * relaunch still lands on the paywall. Returns the same reference when
 * nothing changes, so a caller can skip a write.
 */
export function recordShownStep(record: OnboardingRecord, step: OnboardingStep): OnboardingRecord {
  if (record.personalizationCompleted || record.step === step) return record;
  return { ...record, step };
}

/** The building interstitial finished: sticky, so it never replays. */
export function completeWatchBuild(record: OnboardingRecord): OnboardingRecord {
  if (record.watchBuilt) return record;
  return { ...record, watchBuilt: true };
}

/**
 * Personalization is complete, for good: set with the entitlement by a
 * purchase or restore, or by an already-entitled shopper's Continue.
 */
export function completePersonalization(record: OnboardingRecord): OnboardingRecord {
  if (record.personalizationCompleted) return record;
  return { ...record, step: 'preview', watchBuilt: true, personalizationCompleted: true };
}

/**
 * Either education choice ("Turn on notifications" or "Not now"): shown once.
 * Meaningless before personalization is complete, so it is refused then.
 */
export function completeNotificationEducation(record: OnboardingRecord): OnboardingRecord {
  if (!record.personalizationCompleted || record.notificationEducationCompleted) return record;
  return { ...record, notificationEducationCompleted: true };
}

/**
 * The screen an incomplete onboarding resumes on after a relaunch. A kill
 * during the interstitial resumes there, so it finishes its one play and
 * routes to Ready — unless it had already completed, in which case Ready
 * itself is the resume point.
 */
export function resumeStep(record: OnboardingRecord): OnboardingStep {
  if (record.personalizationCompleted) return 'preview';
  if (record.step === 'building' && record.watchBuilt) return 'preview';
  return record.step;
}

// ── Step rules ──────────────────────────────────────────────────────────────

/**
 * States is the one required step: at least one jurisdiction. Allergens and
 * retailers are optional, so their empty lists never block Continue — an
 * empty optional answer is complete, not missing.
 */
export function canContinueFromStates(stateCodes: readonly string[]): boolean {
  return stateCodes.length > 0;
}

export function isOptionalStep(step: OnboardingStep): boolean {
  return step === 'allergens' || step === 'retailers';
}
