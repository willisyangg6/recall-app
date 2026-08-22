/**
 * Illness-report semantics (architecture Part 4 `illness`, three-way rule):
 *
 *   - `none_reported` — the source explicitly states no illnesses/reactions.
 *   - `reported`      — the source explicitly reports illnesses, cases,
 *                        hospitalizations, or deaths (statements kept verbatim
 *                        so counts are the source's own words).
 *   - `unknown`       — the source is silent or unclear. Silence is NEVER
 *                        converted into zero.
 *
 * General disease education ("Consumption of food contaminated with
 * Salmonella can cause salmonellosis…"), healthcare advice ("Anyone concerned
 * about illness should contact a healthcare provider"), and discovery prose
 * ("The problem was discovered during FSIS surveillance activities") are NOT
 * illness-report data and are excluded here. Education is exposed separately
 * for an optional "Health risk" display.
 */

import { joinSentences, splitSentences } from './text';

export type IllnessReportStatus = 'none_reported' | 'reported' | 'unknown';

export interface IllnessReport {
  status: IllnessReportStatus;
  /** Verbatim source sentences backing the status (empty when unknown). */
  statements: string[];
}

/** "Anyone concerned about illness/injury should contact a healthcare provider." */
const ADVICE =
  /concerned about (an? )?(illness|injury|reaction)|contact a (healthcare|health care) provider|seek (medical|emergency)/i;

/** Hazard education about what the pathogen can do — not a report. */
const EDUCATION =
  /\bcan cause\b|\bmay cause\b|symptoms?\b|incubation|\binfection (can|may|is)\b|salmonellosis|listeriosis|botulism|(older adults|pregnant|weakened immune|young children)|serious (and sometimes )?(illness|infection)|invasive infection|wound infection/i;

/** How the problem was found — not a report. */
const DISCOVERY =
  /\b(problem|issue) was (discovered|identified|found)\b|\bdiscovered (during|by|when|through)\b|surveillance activit/i;

/** Words that make a sentence about human harm at all. */
const HARM =
  /\b(illness(es)?|ill|sick(ened)?|adverse reactions?|injur(y|ies)|hospitaliz\w*|deaths?|case-patients?|infections? (have|has) been)\b/i;

/** Explicit-zero statements. */
const EXPLICIT_NONE =
  /\b(there (have|has) been no|no (confirmed )?(reports?|illness(es)?|adverse reactions?|injuries)|not (received any|aware of any))\b[^.]*\b(report|confirm|illness|adverse|injur|associat|received|aware)/i;

/** Positive-report statements (counts or explicit reports). */
const REPORTED =
  /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|several|multiple)\b[^.]{0,120}\b(sick (people|persons?)|ill(ness(es)?)?|hospitaliz\w*|deaths?|case-patients?)\b[^.]{0,120}\b(identified|reported|confirmed|linked|occurred)|\b(illness(es)?|adverse reactions?|injur(y|ies)|hospitalizations?|deaths?)\b[^.]{0,80}\b(have|has) been (reported|confirmed|received|identified)|\b(received|there (are|have been)) (reports? of|confirmed)\b[^.]{0,60}\b(illness|adverse|injur|sick)/i;

function isReportSentence(sentence: string): boolean {
  if (ADVICE.test(sentence) || DISCOVERY.test(sentence)) return false;
  if (!HARM.test(sentence)) return false;
  if (/\bno\b/i.test(sentence) && EXPLICIT_NONE.test(sentence)) return false;
  if (REPORTED.test(sentence)) return true;
  // Education sentences mention illness generically but report nothing.
  return false;
}

function isExplicitNoneSentence(sentence: string): boolean {
  if (ADVICE.test(sentence) || DISCOVERY.test(sentence)) return false;
  return EXPLICIT_NONE.test(sentence);
}

/** Classify the illness-report status of a notice from its summary text. */
export function classifyIllnessReport(summaryText: string | null): IllnessReport {
  if (!summaryText) return { status: 'unknown', statements: [] };
  const sentences = splitSentences(summaryText);
  const reported = sentences.filter(isReportSentence);
  if (reported.length > 0) return { status: 'reported', statements: reported.slice(0, 3) };
  const none = sentences.filter(isExplicitNoneSentence);
  if (none.length > 0) return { status: 'none_reported', statements: none.slice(0, 1) };
  return { status: 'unknown', statements: [] };
}

/**
 * Source-stated hazard education (what the contaminant can do), for an
 * optional "Health risk" section. Never mixed into illness reporting.
 */
export function healthEducationText(summaryText: string | null): string | null {
  if (!summaryText) return null;
  const sentences = splitSentences(summaryText).filter(
    (s) => EDUCATION.test(s) && !ADVICE.test(s) && !DISCOVERY.test(s) && !isReportSentence(s),
  );
  if (sentences.length === 0) return null;
  return joinSentences(sentences.slice(0, 2));
}
