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

/**
 * The disease NAMES this module recognises, shared with the status contract
 * (`illness-status.ts`) so that one list governs education, eligibility and
 * assertion rather than three drifting copies.
 *
 * The ORGANISM is deliberately absent. `Clostridium botulinum`, `Listeria
 * monocytogenes` and `Salmonella` name a bacterium, and "has the potential to
 * be contaminated with Clostridium botulinum" is a statement about the product
 * — a contamination risk, not a person's illness. Twenty live botulism cases
 * rest on exactly that wording and none of them reports an illness.
 */
export const DISEASE_NAME = String.raw`(?:salmonellosis|listeriosis|(?:infant\s+)?botulism)`;

/** A disease name as the subject of a general statement — the education frame. */
const DISEASE_AS_SUBJECT =
  String.raw`\b` +
  DISEASE_NAME +
  String.raw`\b\s+(?:is|are|can|may|usually|typically|often|generally)\b`;

/**
 * Hazard education about what the pathogen can do — not a report.
 *
 * A DISEASE NAME ALONE IS NOT EDUCATION (P2B7L.1). `salmonellosis` and
 * `listeriosis` were bare alternations here, so every sentence naming either
 * disease was inert — including the sentences in which FSIS and FDA actually
 * report the outbreak:
 *
 *   "The epidemiologic investigation identified a total of four listeriosis
 *    confirmed illnesses, including one death…"
 *   "The recalled peaches have been linked to an outbreak of Listeriosis that
 *    has resulted in eleven illnesses."
 *
 * Measured read-only on the live corpus, 5 cases were suppressed that way, 4 of
 * them carrying an exact count. What makes a sentence education is its
 * EXPLANATORY STRUCTURE — the disease as the subject of a general statement
 * ("Listeriosis is treated with antibiotics", "Salmonellosis usually lasts…")
 * — not the mere presence of the word, so the names are matched only in that
 * frame. The other education alternations already carry the rest: "can cause
 * listeriosis" is held by `can cause`, "Symptoms of salmonellosis" by
 * `symptoms`.
 *
 * Over the whole 1,931-case table this keeps 122 education sentences filtered
 * and releases 23, every one of them reviewed.
 *
 * BOTULISM JOINS THEM (P2B7L.2). It was the last bare disease name here, and
 * it had exactly the same defect: 22 sentences across 10 live cases were held
 * back by the word alone, including the two sentences in which the FDA states
 * the infant-formula outbreak's linked cases. Reading the whole botulism
 * population (docs/recall-illness-status.md §4.5) showed the word was doing two
 * different jobs — silencing genuine education ("Infant botulism IS a rare but
 * potentially fatal illness…") and silencing genuine reports ("…3 cases of
 * infant botulism in infants who CDC reported had consumed Nara formula") — so
 * it is matched in the explanatory frame like the other two, and the reports
 * are held back, where they should be, by attribution (`illness-status.ts`).
 *
 * `botulinum` is deliberately NOT a disease name. `Clostridium botulinum` is
 * the ORGANISM, and "has the potential to be contaminated with Clostridium
 * botulinum" is the standard uneviscerated-fish and low-acid-canning hazard
 * sentence — a statement about the product, not about anyone's health. Twenty
 * live cases rest on that wording and none of them reports an illness.
 */
const EDUCATION = new RegExp(
  String.raw`\bcan cause\b|\bmay cause\b|symptoms?\b|incubation|\binfection (can|may|is)\b|` +
    DISEASE_AS_SUBJECT +
    String.raw`|(older adults|pregnant|weakened immune|young children)|` +
    String.raw`serious (and sometimes )?(illness|infection)|invasive infection|wound infection|` +
    // Hazard education about what does NOT make the food safe — "Thoroughly
    // cooking product does not prevent illness" (a heat-stable staphylococcal
    // toxin). It denies that a PRECAUTION works, not that anyone fell ill, and
    // reading it as a denial prints "No illnesses reported" over a notice that
    // reports none either way (P2B7L.2).
    String.raw`\b(?:does|do|will|would|can|cannot|can't)\s+not\s+(?:\w+\s+){0,2}?(?:prevent|kill|destroy|eliminate|cure|treat|inactivate)\b|\bwill not (?:prevent|kill|destroy|eliminate)\b`,
  'i',
);

/** How the problem was found — not a report. */
const DISCOVERY =
  /\b(problem|issue) was (discovered|identified|found)\b|\bdiscovered (during|by|when|through)\b|surveillance activit/i;

/** Words that make a sentence about human harm at all. */
const HARM =
  /\b(illness(es)?|ill|sick(ened)?|adverse (reactions?|events?)|allergic reactions?|injur(y|ies)|hospitaliz\w*|deaths?|case-patients?|infections? (have|has) been|infected)\b/i;

/** Explicit-zero statements. "No OTHER/additional reports" is a none-shaped
 * qualifier that implies a prior report stated elsewhere on the page — it is
 * excluded from report sentences here, and the primary report sentence (which
 * the REPORTED patterns catch) decides the record's status. */
const EXPLICIT_NONE =
  /\b(there (have|has) been no|no (other |additional |further )?(confirmed )?(reports?|illness(es)?|adverse reactions?|injuries)|not (received any|aware of any))\b[^.]*\b(report|confirm|illness|adverse|injur|associat|received|aware)/i;

/** Positive-report statements (counts or explicit reports). The last two
 * alternations cover FDA announcement wording verified in recorded fixtures:
 * "a total of 345 people infected with the outbreak strain … have been
 * reported from 27 states" and "were associated with reported salmonellosis
 * illnesses", plus "The FDA continues to receive adverse event reports". */
const REPORTED =
  /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|several|multiple)\b[^.]{0,120}\b(sick (people|persons?)|ill(ness(es)?)?|hospitaliz\w*|deaths?|case-patients?)\b[^.]{0,120}\b(identified|reported|confirmed|linked|occurred)|\b(illness(es)?|adverse reactions?|injur(y|ies)|hospitalizations?|deaths?)\b[^.]{0,80}\b(have|has) been (reported|confirmed|received|identified)|\b(received|there (are|have been)) (reports? of|confirmed)\b[^.]{0,60}\b(illness|adverse|injur|sick)|\b\d+\b[^.]{0,60}\b(people|persons?|individuals)\b[^.]{0,80}\b(infected|sickened)\b[^.]{0,120}\b(reported|confirmed)|\bassociated with\b[^.]{0,40}\breported\b[^.]{0,60}\b(illness|salmonellosis|listeriosis|infections?)|\b(receives?|continues to receive)\b[^.]{0,50}\b(adverse event|illness|injury) reports?|\b(a |one |an? )?(consumer|customer|person|individual)s?\b[^.]{0,60}\breported\b[^.]{0,60}\b(allergic reaction|illness|injur|adverse)/i;

/**
 * Prose that mentions harm but reports none: healthcare advice, hazard
 * education, and how the problem was found.
 *
 * Exported so a second reader of the same sentences cannot drift from this
 * one — the P2B7J status contract (`illness-status.ts`) needs exactly this
 * exclusion before it looks for denials, and duplicating the three patterns
 * there would let "Salmonella can cause serious illness" become a report in
 * one module and education in the other. Behaviour here is unchanged: the
 * predicate is the same test `isReportSentence` already applied inline.
 */
export function isNonReportProse(sentence: string): boolean {
  return ADVICE.test(sentence) || EDUCATION.test(sentence) || DISCOVERY.test(sentence);
}

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
