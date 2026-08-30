/**
 * Imagery failure auditing (C9) — pure classification, no writes, no
 * network. Consumed by `npm run qa:imagery`.
 *
 * Each product_visual_failures entry is judged against the C9 fixes:
 * a URL the canonical resolver repairs (the duplicated-host defect), a
 * size-cap failure now within the raised bound, or a genuine failure at
 * the source. The labels job itself does the recovering — its candidate
 * URLs come from the fixed extractor, and the raised cap applies on its
 * next fetch — so this audit predicts, and later verifies, that recovery.
 */

import { FSIS_HOSTS, resolveOfficialUrl } from '../lib/official-urls';
import type { LabelFailureState } from './fsis/label-sync';
import { MAX_PDF_BYTES } from './fsis/labels';

/** What normalization says about one failure-ledger URL. */
export interface FailureDisposition {
  sourceUrl: string;
  lastError: string | null;
  disposition:
    /** Normalizes to a different URL — the recorded URL was malformed. */
    | 'repaired-url'
    /** Failed the old size cap; within the C9 cap, so retry will succeed. */
    | 'within-new-size-cap'
    /** Well-formed and within bounds — genuinely failing at the source. */
    | 'still-failing';
  normalizedUrl: string | null;
}

/** Audit one recorded failure URL against C9 normalization and bounds. */
export function auditFailureUrl(failure: LabelFailureState): FailureDisposition {
  const resolved = resolveOfficialUrl(failure.sourceUrl, { approvedHosts: FSIS_HOSTS });
  if (resolved && resolved.url !== failure.sourceUrl) {
    return {
      sourceUrl: failure.sourceUrl,
      lastError: failure.lastError,
      disposition: 'repaired-url',
      normalizedUrl: resolved.url,
    };
  }
  const overCap = failure.lastError?.match(/over size cap \((\d+) bytes\)/);
  if (overCap && Number(overCap[1]) <= MAX_PDF_BYTES) {
    return {
      sourceUrl: failure.sourceUrl,
      lastError: failure.lastError,
      disposition: 'within-new-size-cap',
      normalizedUrl: resolved?.url ?? null,
    };
  }
  return {
    sourceUrl: failure.sourceUrl,
    lastError: failure.lastError,
    disposition: 'still-failing',
    normalizedUrl: resolved?.url ?? null,
  };
}
