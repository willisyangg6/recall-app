/**
 * Onboarding state (P2B7X.1): the VERSIONED record of how far a shopper has
 * come through first launch, kept apart from the preferences it collects.
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
 * ## What the record holds
 *
 *   step                           the screen to resume on — the last
 *                                  onboarding screen that was shown — while
 *                                  personalization is incomplete
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
 * `sanitizePreferences`: an unknown or corrupt value degrades to the INITIAL
 * record (onboarding from the start), never to a half-completed one.
 */

// ── The steps ───────────────────────────────────────────────────────────────

export type OnboardingStep = 'welcome' | 'states' | 'allergens' | 'retailers' | 'preview';

/** The screens in order. Welcome is a screen but not a counted step. */
export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  'welcome',
  'states',
  'allergens',
  'retailers',
  'preview',
];

/** The four counted steps, in order: States 1, Allergens 2, Retailers 3, Preview 4. */
export const COUNTED_STEPS: readonly OnboardingStep[] = [
  'states',
  'allergens',
  'retailers',
  'preview',
];

export interface StepProgress {
  /** 1-based position among the counted steps. */
  index: number;
  total: number;
}

/** "1 of 4" for a counted step; null for Welcome, which is not counted. */
export function stepProgress(step: OnboardingStep): StepProgress | null {
  const index = COUNTED_STEPS.indexOf(step);
  return index === -1 ? null : { index: index + 1, total: COUNTED_STEPS.length };
}

/** The visible progress line for a counted step: "1 of 4". */
export function progressLabel(progress: StepProgress): string {
  return `${progress.index} of ${progress.total}`;
}

export function nextStep(step: OnboardingStep): OnboardingStep | null {
  const at = ONBOARDING_STEPS.indexOf(step);
  return ONBOARDING_STEPS[at + 1] ?? null;
}

export function previousStep(step: OnboardingStep): OnboardingStep | null {
  const at = ONBOARDING_STEPS.indexOf(step);
  return at <= 0 ? null : (ONBOARDING_STEPS[at - 1] ?? null);
}

export function isOnboardingStep(value: unknown): value is OnboardingStep {
  return typeof value === 'string' && (ONBOARDING_STEPS as readonly string[]).includes(value);
}

// ── The record ──────────────────────────────────────────────────────────────

export const ONBOARDING_RECORD_VERSION = 1;

export interface OnboardingRecord {
  version: typeof ONBOARDING_RECORD_VERSION;
  step: OnboardingStep;
  personalizationCompleted: boolean;
  notificationEducationCompleted: boolean;
}

/** A device that has never onboarded: Welcome, nothing completed. */
export const INITIAL_ONBOARDING: OnboardingRecord = {
  version: ONBOARDING_RECORD_VERSION,
  step: 'welcome',
  personalizationCompleted: false,
  notificationEducationCompleted: false,
};

/**
 * Validate an untrusted stored value into a current record. Any value that is
 * not a well-formed version-1 record is the INITIAL record — a corrupt or
 * future blob restarts onboarding rather than skipping it, which is the safe
 * direction for a gate.
 */
export function sanitizeOnboardingRecord(raw: unknown): OnboardingRecord {
  if (typeof raw !== 'object' || raw === null) return { ...INITIAL_ONBOARDING };
  const value = raw as Record<string, unknown>;
  if (value.version !== ONBOARDING_RECORD_VERSION) return { ...INITIAL_ONBOARDING };
  if (!isOnboardingStep(value.step)) return { ...INITIAL_ONBOARDING };
  if (typeof value.personalizationCompleted !== 'boolean') return { ...INITIAL_ONBOARDING };
  if (typeof value.notificationEducationCompleted !== 'boolean') {
    return { ...INITIAL_ONBOARDING };
  }
  return {
    version: ONBOARDING_RECORD_VERSION,
    step: value.step,
    personalizationCompleted: value.personalizationCompleted,
    // Education can only have been completed after personalization was.
    notificationEducationCompleted:
      value.personalizationCompleted && value.notificationEducationCompleted,
  };
}

// ── Transitions ─────────────────────────────────────────────────────────────

/**
 * The shown screen becomes the resume point — ONLY while personalization is
 * incomplete. Once complete, moving through the selectors again (Edit
 * preferences from the Preview, or the paywall's Back) records nothing, so a
 * relaunch still lands on the paywall. Returns the same reference when
 * nothing changes, so a caller can skip a write.
 */
export function recordShownStep(record: OnboardingRecord, step: OnboardingStep): OnboardingRecord {
  if (record.personalizationCompleted || record.step === step) return record;
  return { ...record, step };
}

/** "View plans" on the Preview: personalization is complete, for good. */
export function completePersonalization(record: OnboardingRecord): OnboardingRecord {
  if (record.personalizationCompleted) return record;
  return { ...record, step: 'preview', personalizationCompleted: true };
}

/**
 * Either education choice ("Turn on notifications" or "Not now"): shown once.
 * Meaningless before personalization is complete, so it is refused then.
 */
export function completeNotificationEducation(record: OnboardingRecord): OnboardingRecord {
  if (!record.personalizationCompleted || record.notificationEducationCompleted) return record;
  return { ...record, notificationEducationCompleted: true };
}

/** The screen an incomplete onboarding resumes on after a relaunch. */
export function resumeStep(record: OnboardingRecord): OnboardingStep {
  return record.personalizationCompleted ? 'preview' : record.step;
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
