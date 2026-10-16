/**
 * Who sends Apple's appTransactionId to Lotly's server (age assurance,
 * 2026-10-13; docs/recall-privacy-program-proposal.md §2.6). Pure.
 *
 * Only a user whose stored Apple answer is a 13–17 range AND whom Apple
 * reports as regulated (`isEligibleForAgeFeatures`, or the
 * `declaredAgeRangeRequired` feature). Those are the only users a parent's
 * RESCIND_CONSENT can concern. Adults, unregulated users, unknown ages and
 * declines never send it. The server stores only a keyed hash
 * (20261017000000_consent_revocation).
 */

import {
  classifyAgeRange,
  regulatedStatus,
  type AgeDecision,
  type AgeRecord,
} from './age-assurance';

export function revocationKeyEligible(record: AgeRecord | null): boolean {
  if (record === null || record.answer.kind !== 'shared') return false;
  if (classifyAgeRange(record.answer.lowerBound, record.answer.upperBound) !== 'minor') {
    return false;
  }
  return regulatedStatus(record.eligible, record.regulatoryFeatures) === true;
}

/** `undetermined`: neither the stored record nor a fresh check could say. */
export type RegistrationEligibility = boolean | 'undetermined';

/**
 * Whether a registration needs the key (2026-10-16). The stored age record
 * when it is usable, exactly as before. When it is missing or unreadable,
 * a missing record must not silently mean "not eligible" (that registered a
 * regulated 13–17 user without the mapping): the launch age check runs
 * again and ITS decision is used directly, never a re-read of what it saved.
 * A check that does not proceed, or throws, is `undetermined`.
 */
export async function registrationEligibility(deps: {
  loadRecord(): Promise<AgeRecord | null>;
  checkAge(): Promise<AgeDecision>;
}): Promise<RegistrationEligibility> {
  const record = await deps.loadRecord().catch(() => null);
  if (record !== null) return revocationKeyEligible(record);
  let decision: AgeDecision;
  try {
    decision = await deps.checkAge();
  } catch {
    return 'undetermined';
  }
  if (decision.kind !== 'proceed') return 'undetermined';
  return decision.ageClass === 'minor' && decision.regulated === true;
}

/**
 * How this installation registers for alerts (2026-10-13, atomic mapping).
 *
 * - `keyed`: through `register_push_subscription_with_revocation_key`, which
 *   enables the row and stores the keyed hash in ONE transaction.
 *   `clearAfter` asks to clear the key once registered, for a user who is no
 *   longer eligible but whose earlier key may still be held — the keyed path
 *   is the only one that can renew a row a parent's revocation disabled.
 * - `plain`: the ordinary registration (never revives a revoked row).
 * - `blocked`: a regulated 13–17 user without an Apple id to present, or an
 *   installation whose eligibility is `undetermined` — alerts must stay
 *   DISABLED; no registration is sent.
 */
export type RegistrationRoute =
  | { kind: 'keyed'; appTransactionId: string; clearAfter: boolean }
  | { kind: 'plain'; clearAfter: boolean }
  | { kind: 'blocked' };

export function registrationRoute(input: {
  eligible: boolean;
  /** A keyed registration was confirmed on this device before. */
  keyHeld: boolean;
  /** StoreKit's appTransactionId, or null when it could not be read. */
  appTransactionId: string | null;
}): RegistrationRoute {
  const { eligible, keyHeld, appTransactionId } = input;
  if (eligible) {
    return appTransactionId === null
      ? { kind: 'blocked' }
      : { kind: 'keyed', appTransactionId, clearAfter: false };
  }
  if (keyHeld) {
    return appTransactionId === null
      ? { kind: 'plain', clearAfter: true }
      : { kind: 'keyed', appTransactionId, clearAfter: true };
  }
  return { kind: 'plain', clearAfter: false };
}

/** The error a blocked route raises: nothing was sent, and alerts stay disabled. */
export class RevocationKeyUnavailableError extends Error {
  constructor() {
    super('Alerts need Apple’s app identifier for this account, which could not be read.');
    this.name = 'RevocationKeyUnavailableError';
  }
}

/** What a routed registration needs; the native wiring is push-registration.ts. */
export interface RoutedRegistrationDeps {
  resolveRoute(): Promise<RegistrationRoute>;
  registerPlain(sequence: number, signal?: AbortSignal): Promise<WriteResult>;
  registerKeyed(
    sequence: number,
    appTransactionId: string,
    signal?: AbortSignal,
  ): Promise<WriteResult>;
  clearKey(): Promise<void>;
  setKeyHeld(held: boolean): Promise<void>;
}

/** The sequenced answer both registrations give (push-api `SequencedWriteResult`). */
export interface WriteResult {
  applied: boolean;
  lastSequence: number;
}

/**
 * The alert-intent `register` port for one installation: plain, keyed, or
 * refused before anything is sent. A blocked route throws
 * `RevocationKeyUnavailableError`, which is NOT a definite server refusal,
 * so the alert protocol follows it with its outranking cleanup disable:
 * any earlier row is disabled and the local flag stays off — "no key, no
 * alerts".
 */
export function routedRegistration(deps: RoutedRegistrationDeps) {
  return async (sequence: number, signal?: AbortSignal): Promise<WriteResult> => {
    const route = await deps.resolveRoute();
    if (route.kind === 'blocked') throw new RevocationKeyUnavailableError();
    const result =
      route.kind === 'keyed'
        ? await deps.registerKeyed(sequence, route.appTransactionId, signal)
        : await deps.registerPlain(sequence, signal);
    if (!result.applied) return result;
    if (route.kind === 'keyed') await deps.setKeyHeld(true);
    if (route.clearAfter) {
      try {
        await deps.clearKey();
        await deps.setKeyHeld(false);
      } catch {
        // Retried at the next registration: the key is held, not needed.
      }
    }
    return result;
  };
}

/**
 * Resolve the route from its three inputs (push-registration.ts wires them
 * natively). StoreKit is asked only when a key is needed or held, and
 * `readAppTransactionId` must answer within its own time limit
 * (lib/app-transaction-read.ts): null keeps a regulated teen `blocked`.
 */
export async function resolveRegistrationRoute(deps: {
  isEligible(): Promise<RegistrationEligibility>;
  isKeyHeld(): Promise<boolean>;
  readAppTransactionId(): Promise<string | null>;
}): Promise<RegistrationRoute> {
  const eligible = await deps.isEligible();
  if (eligible === 'undetermined') return { kind: 'blocked' };
  const keyHeld = await deps.isKeyHeld();
  if (!eligible && !keyHeld) return { kind: 'plain', clearAfter: false };
  return registrationRoute({
    eligible,
    keyHeld,
    appTransactionId: await deps.readAppTransactionId(),
  });
}
