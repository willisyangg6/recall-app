/**
 * The launch age check (age assurance, 2026-10-13): ONE pure decision that
 * says whether this launch may go on to the app, must stop because the
 * shopper is under 13, or must wait for Apple's age service to answer.
 *
 * ## Why it runs first
 *
 * Texas SB 2420 applies to new Apple Accounts in Texas from 2026-06-04, and
 * Apple's rule for developers is "In those regions, you must check the age
 * of the people using your app" (developer.apple.com/support/age-assurance).
 * Lotly's own Terms set 13 as the minimum age. So the check runs before
 * anything leaves the device: before the preference mirror, the daily
 * check-in, push registration upkeep, and the entitlement read that
 * configures RevenueCat. The root layout mounts all of those beneath the
 * gate (components/age-gate), not beside it.
 *
 * ## The decision (docs/recall-onboarding-and-paywall.md, "Age check")
 *
 *   not iOS                  proceed. Lotly ships on iOS only.
 *   iOS below 26             proceed WITHOUT asking: Apple's API does not
 *                            exist there, and expo-age-range answers
 *                            `lowerBound: 18` (an adult) on those versions,
 *                            so its answer would be a fabricated one. The
 *                            minimum age rests on the Terms (a documented
 *                            residual risk; the deployment target stays 16.4).
 *   range shared             classify: under 13 stops, 13–17 and 18+ proceed
 *   sharing declined         proceed, unless Apple says the account is
 *                            regulated (where "they can't decline sharing",
 *                            so a decline there is an inconsistency, not a
 *                            choice): then wait
 *   the service failed       proceed only if Apple says the account is NOT
 *                            regulated. Any other failure waits on a Try
 *                            again screen — except that an under-13 answer
 *                            stored in the last year keeps the stop screen.
 *                            A failure is never read as "adult" or as "not
 *                            regulated".
 *
 * ## A stored answer may only RESTRICT (review, 2026-10-13)
 *
 * The record is per device, not per Apple Account: Apple's API does not say
 * whose answer it is, and `AppTransaction` identifies the account that
 * downloaded the app, not the one signed in now. So a stored answer never
 * lets a launch proceed — a failure on a device that once held an adult's
 * answer could otherwise admit the next account, or a signed-out child.
 * It can only keep an under-13 stop in place offline. Ages only rise, so a
 * stored range is never LESS restrictive than the person it described; at
 * worst it is stricter (a 17 who turned 18, a 12 who turned 13), and Apple
 * itself answers with its cached range "until the anniversary".
 *
 * ## What is kept, and where
 *
 * The whole answer — bounds, declaration method, parental controls, the
 * regulatory flags, the time — is kept on this iPhone (SecureStore,
 * `recall.age-range`) and NEVER sent to Lotly's server, RevenueCat or Expo.
 * It collapses to a class only at the point of decision. A failure never
 * overwrites a stored answer.
 *
 * A leaf: no I/O, no React. The native adapter is lib/age-range-service.ts;
 * the store is lib/age-record-store.ts.
 */

/** The age gates Lotly asks Apple for: under 13, 13–15, 16–17, 18+ (SB 2420's categories). */
export const AGE_GATES = [13, 16, 18] as const;

/** A stored under-13 answer older than this no longer keeps the stop screen on a failed check. */
export const STORED_ANSWER_MAX_AGE_DAYS = 365;

/** Apple's regulatory feature that makes the age range required. */
export const DECLARED_AGE_RANGE_REQUIRED = 'declaredAgeRangeRequired';

export type AgeClass = 'under13' | 'minor' | 'adult' | 'unknown';

/** What Apple's age-range request answered, normalized by the adapter. */
export type AgeRangeAnswer =
  | {
      kind: 'shared';
      lowerBound: number | null;
      upperBound: number | null;
      /** `selfDeclared`, `guardianDeclared` or `confirmed`, as reported. */
      declaration: string | null;
      parentalControls: string[];
    }
  | { kind: 'declined' }
  | {
      kind: 'failed';
      /** `ERR_AGE_RANGE_NOT_AVAILABLE` (not signed in), a native error code, or null. */
      code: string | null;
    };

/** The age record kept on this iPhone only. */
export interface AgeRecord {
  version: 1;
  checkedAt: string;
  answer: Exclude<AgeRangeAnswer, { kind: 'failed' }>;
  /** `isEligibleForAgeFeatures` (iOS 26.2+); null when unknown. */
  eligible: boolean | null;
  /** `requiredRegulatoryFeatures` (iOS 26.4+); null when unknown. */
  regulatoryFeatures: string[] | null;
}

export type ProceedBasis = 'platform' | 'os-version' | 'shared' | 'declined' | 'not-regulated';

export type AgeDecision =
  | {
      kind: 'proceed';
      basis: ProceedBasis;
      /** The class the decision rests on; `unknown` when no range was shared. */
      ageClass: AgeClass;
      /** Whether Apple says age assurance law applies to this account; null if unknown. */
      regulated: boolean | null;
    }
  | { kind: 'under13' }
  | { kind: 'retry'; reason: 'not-signed-in' | 'unavailable' };

/** Collapse an age range to the class a decision needs. Never stored. */
export function classifyAgeRange(lowerBound: number | null, upperBound: number | null): AgeClass {
  if (upperBound !== null && upperBound <= 12) return 'under13';
  if (lowerBound !== null && lowerBound >= 18) return 'adult';
  // 13 or older, but not certainly 18: a minor (including "16 or older").
  if (lowerBound !== null && lowerBound >= 13) return 'minor';
  // A range that reaches below 13 ("under 18", or no lower bound) cannot
  // show the shopper is 13 or older, so it is never read as a minor.
  return 'unknown';
}

/**
 * Whether age-assurance law applies to the account: true when Apple names
 * the age range as a required feature or reports the account eligible,
 * false only when Apple says it is not eligible, null otherwise.
 */
export function regulatedStatus(
  eligible: boolean | null,
  regulatoryFeatures: string[] | null,
): boolean | null {
  if (regulatoryFeatures?.includes(DECLARED_AGE_RANGE_REQUIRED)) return true;
  return eligible;
}

/** The major version of `Platform.Version` on iOS ("26.3.1" → 26), or null. */
export function iosMajorVersion(version: string | number): number | null {
  const major = Number.parseInt(String(version), 10);
  return Number.isFinite(major) ? major : null;
}

/** The first iOS with Apple's Declared Age Range API. */
export const AGE_RANGE_MIN_IOS = 26;

export interface AgeCheckPorts {
  os: string;
  osVersion: string | number;
  /** Each port answers rather than throws; the adapter normalizes failures. */
  isEligible(): Promise<boolean | null>;
  requiredRegulatoryFeatures(): Promise<string[] | null>;
  requestAgeRange(gates: readonly number[]): Promise<AgeRangeAnswer>;
  loadRecord(): Promise<AgeRecord | null>;
  saveRecord(record: AgeRecord): Promise<void>;
  now(): Date;
}

function storedAnswerStands(record: AgeRecord | null, now: Date): AgeRecord | null {
  if (record === null || record.answer.kind !== 'shared') return null;
  const age = now.getTime() - Date.parse(record.checkedAt);
  if (!Number.isFinite(age) || age < 0) return null;
  return age <= STORED_ANSWER_MAX_AGE_DAYS * 24 * 60 * 60 * 1000 ? record : null;
}

function fromShared(
  lowerBound: number | null,
  upperBound: number | null,
  regulated: boolean | null,
  basis: ProceedBasis,
): AgeDecision | null {
  const ageClass = classifyAgeRange(lowerBound, upperBound);
  if (ageClass === 'under13') return { kind: 'under13' };
  if (ageClass === 'unknown') return null;
  return { kind: 'proceed', basis, ageClass, regulated };
}

/** The subset of expo-age-range's response the check reads. */
export interface NativeAgeRangeResponse {
  lowerBound?: number | null;
  upperBound?: number | null;
  ageRangeDeclaration?: string | null;
  activeParentalControls?: string[];
}

/** expo-age-range's rejection code for a shopper who chose not to share. */
export const USER_DECLINED_CODE = 'ERR_AGE_RANGE_USER_DECLINED';

/** Normalize a native answer or rejection into an `AgeRangeAnswer`. Never throws. */
export async function answerFromNative(
  request: () => Promise<NativeAgeRangeResponse>,
): Promise<AgeRangeAnswer> {
  try {
    const response = await request();
    return {
      kind: 'shared',
      lowerBound: response.lowerBound ?? null,
      upperBound: response.upperBound ?? null,
      declaration: response.ageRangeDeclaration ?? null,
      parentalControls: response.activeParentalControls ?? [],
    };
  } catch (error) {
    const code =
      typeof error === 'object' &&
      error !== null &&
      typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : null;
    if (code === USER_DECLINED_CODE) return { kind: 'declined' };
    return { kind: 'failed', code };
  }
}

/** Run the launch age check against the ports. Never throws. */
export async function runAgeCheck(ports: AgeCheckPorts): Promise<AgeDecision> {
  if (ports.os !== 'ios') {
    return { kind: 'proceed', basis: 'platform', ageClass: 'unknown', regulated: null };
  }
  const major = iosMajorVersion(ports.osVersion);
  if (major === null || major < AGE_RANGE_MIN_IOS) {
    return { kind: 'proceed', basis: 'os-version', ageClass: 'unknown', regulated: null };
  }

  const [eligible, regulatoryFeatures, stored] = await Promise.all([
    ports.isEligible().catch(() => null),
    ports.requiredRegulatoryFeatures().catch(() => null),
    ports.loadRecord().catch(() => null),
  ]);
  const regulated = regulatedStatus(eligible, regulatoryFeatures);
  const answer = await ports
    .requestAgeRange(AGE_GATES)
    .catch((): AgeRangeAnswer => ({ kind: 'failed', code: null }));

  if (answer.kind !== 'failed') {
    const record: AgeRecord = {
      version: 1,
      checkedAt: ports.now().toISOString(),
      answer,
      eligible,
      regulatoryFeatures,
    };
    // A failed write costs only the offline fallback; the decision stands.
    await ports.saveRecord(record).catch(() => {});
  }

  if (answer.kind === 'shared') {
    const decision = fromShared(answer.lowerBound, answer.upperBound, regulated, 'shared');
    if (decision !== null) return decision;
    // A shared answer without usable bounds is treated as a failure below.
  } else if (answer.kind === 'declined') {
    if (regulated !== true) {
      return { kind: 'proceed', basis: 'declined', ageClass: 'unknown', regulated };
    }
    return { kind: 'retry', reason: 'unavailable' };
  }

  // The service failed (or answered without bounds).
  if (regulated === false) {
    return { kind: 'proceed', basis: 'not-regulated', ageClass: 'unknown', regulated };
  }
  // A stored answer only restricts (see above): it keeps an under-13 stop.
  const standing = storedAnswerStands(stored, ports.now());
  if (
    standing !== null &&
    standing.answer.kind === 'shared' &&
    classifyAgeRange(standing.answer.lowerBound, standing.answer.upperBound) === 'under13'
  ) {
    return { kind: 'under13' };
  }
  const code = answer.kind === 'failed' ? answer.code : null;
  return {
    kind: 'retry',
    reason: code === 'ERR_AGE_RANGE_NOT_AVAILABLE' ? 'not-signed-in' : 'unavailable',
  };
}
