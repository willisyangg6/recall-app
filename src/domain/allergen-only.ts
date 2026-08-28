/**
 * Conservative "is this recall ONLY about allergens?" classification (C5.2B).
 *
 * Why it exists: a milk-only recall in your state is not information a person
 * who selected Peanut needs. Before this, geography alone qualified it, so a
 * California peanut user saw every California milk recall — and the noise made
 * the list worth less than the notices in it.
 *
 * Why it is deliberately timid: the moment this returns `identified`, a recall
 * can be REMOVED from Affects Me, so a wrong answer hides a safety notice. It
 * therefore reads only canonical, source-grounded fields the ingestion layer
 * already derived — the agency's own hazard category, its own structured
 * reason vocabulary, and the specific agent it named — and never re-parses
 * announcement prose or guesses from keywords. Three separate things have to
 * be true, and any doubt at all falls through to `unidentified`, which
 * preserves the old location-based eligibility exactly.
 *
 * What it never does: it never makes a recall eligible. It can only withhold
 * one that a personal signal does not support, and only when the source proves
 * the hazard is allergenic and names which allergen. Everything it excludes
 * stays in All Recalls.
 */

import { extractPathogen, normalizedAllergenTokens } from './hazard';
import type { HazardCategory } from './recall-types';

/** The canonical hazard facts a case already carries. No prose is re-read. */
export interface HazardFacts {
  /**
   * `string`, not `HazardCategory`, because the feed reads this straight from
   * a database column and types it honestly as untrusted. It is compared for
   * equality with one value, so an unexpected category simply is not
   * 'allergen' and falls through to the safe answer.
   */
  hazardCategory: HazardCategory | (string & {});
  /** The specific agent the source named ("undeclared milk", "Salmonella"). */
  pathogenOrAllergen: string | null;
  /** The source's own reason text — FSIS's structured labels, FDA's category. */
  reasonText: string | null;
}

export type AllergenOnlyVerdict =
  /**
   * A general or MIXED hazard: a pathogen, foreign material, contamination,
   * spoilage or other non-allergen risk is stated. Location alone still
   * qualifies it — this is the safety-critical majority.
   */
  | { kind: 'not_allergen_only' }
  /**
   * Allergen-only, but the source did not say WHICH allergen ("undeclared
   * allergen"). Nothing can be compared against a preference, so the unnamed
   * allergen could be the user's: eligibility is left exactly as it was.
   */
  | { kind: 'unidentified' }
  /**
   * Allergen-only with named allergens. These tokens — and only these — decide
   * whether the recall matches the user's selection.
   */
  | { kind: 'identified'; tokens: string[] };

/**
 * Structured FSIS recall reasons that describe a NON-allergen consumer hazard.
 *
 * `deriveHazardCategory` (server/fsis/parse.ts) returns 'allergen' as soon as
 * it sees "Unreported Allergens", so a notice whose reasons array ALSO carries
 * "Product Contamination" would arrive here labelled allergen while really
 * being mixed. Measured on the live corpus this fires on 0 of 349 active
 * allergen-category cases — it is a guard against the ordering, not a
 * heuristic, and it uses the agency's own closed label vocabulary rather than
 * free-text keywords.
 *
 * "Misbranding" and "Mislabeling" are deliberately absent: they are how an
 * undeclared allergen is REPORTED, not a second hazard.
 */
const NON_ALLERGEN_REASON_LABELS = [
  'Product Contamination',
  'Insanitary Conditions',
  'Processing Defect',
  'Unfit for Human Consumption',
];

/**
 * Classify one case's hazard. Pure, deterministic, and derivable at any layer
 * from fields already persisted — so Home, the detail screen and push
 * classification cannot reach different answers.
 */
export function classifyAllergenOnly(facts: HazardFacts): AllergenOnlyVerdict {
  // 1. The agency's own category must say allergen. Every other category —
  //    microbial, foreign material, chemical, integrity, regulatory, unknown —
  //    is a general hazard that geography alone still qualifies.
  if (facts.hazardCategory !== 'allergen') return { kind: 'not_allergen_only' };

  // 2. No non-allergen hazard may be stated anywhere in the canonical fields.
  const reason = facts.reasonText ?? '';
  if (NON_ALLERGEN_REASON_LABELS.some((label) => reason.includes(label))) {
    return { kind: 'not_allergen_only' };
  }
  if (extractPathogen(`${reason}\n${facts.pathogenOrAllergen ?? ''}`) !== null) {
    return { kind: 'not_allergen_only' };
  }

  // 3. The allergen has to be identified well enough to compare. "undeclared
  //    allergen" with no name, or a null agent, tells us nothing about whether
  //    it is the user's — so it must never produce a mismatch.
  const tokens = normalizedAllergenTokens(facts.pathogenOrAllergen);
  if (tokens.length === 0) return { kind: 'unidentified' };
  return { kind: 'identified', tokens };
}

/**
 * True when the source proves this recall's allergens are known AND none of
 * them is one the user selected — the one case where a recall is withheld from
 * Affects Me despite matching geography or a retailer.
 *
 * A user who selected no allergens at all has no allergen these can match, so
 * every identified allergen-only recall is withheld. That is the intended
 * product decision: allergen-only notices are for the people who need them,
 * and All Recalls still holds every one of them.
 *
 * It also covers substances outside the supported vocabulary. A sulfites-only
 * recall is confidently identified and cannot match any selectable preference,
 * so it is withheld by exactly the same rule, with no special case.
 */
export function isKnownAllergenMismatch(
  facts: HazardFacts,
  selectedAllergens: readonly string[],
): boolean {
  const verdict = classifyAllergenOnly(facts);
  return (
    verdict.kind === 'identified' && !verdict.tokens.some((t) => selectedAllergens.includes(t))
  );
}
