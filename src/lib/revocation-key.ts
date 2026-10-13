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

import { classifyAgeRange, regulatedStatus, type AgeRecord } from './age-assurance';

export function revocationKeyEligible(record: AgeRecord | null): boolean {
  if (record === null || record.answer.kind !== 'shared') return false;
  if (classifyAgeRange(record.answer.lowerBound, record.answer.upperBound) !== 'minor') {
    return false;
  }
  return regulatedStatus(record.eligible, record.regulatoryFeatures) === true;
}
