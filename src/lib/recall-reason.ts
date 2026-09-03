/**
 * The one bounded typed-reason interpretation (P2a).
 *
 * Home's concise reason line and Detail's "What happened" clause are two
 * renderings of the SAME interpreted reason: `interpretReason` classifies the
 * canonical reason evidence into a closed family set, and each surface renders
 * its family deterministically. Neither surface re-derives a family of its
 * own, so they can never disagree about what kind of problem a recall is.
 *
 * Grounding rules:
 *  - A family is assigned only from structured canonical fields (hazard
 *    category, pathogen/allergen slot, the FSIS reason enum strings) or a
 *    verified source-text pattern. Nothing is guessed from prose.
 *  - A hazard or allergen is never invented: an unnamed agent renders as the
 *    honest generic form of its family, never as a specific one.
 *  - The free-text fallback is last resort and grammar-gated: a source reason
 *    that is not a noun phrase ("Product did not meet standards") can never be
 *    glued onto "because of", so constructions like "because of contains"
 *    cannot be produced. A gated reason drops the clause rather than
 *    rendering broken grammar — the full source text stays in the projection.
 *
 * ## Home/Detail semantic parity (P3A)
 *
 * The two surfaces call THIS function and differ only in how much canonical
 * evidence they can supply. A Home feed row carries `reasonText`,
 * `hazardCategory`, `pathogenOrAllergen` and `title`; Detail additionally has
 * the announcement body (`summaryText`). The announcement body is
 * deliberately NOT on the feed — it is the largest single field in the
 * corpus (measured: ~2.9 KB/case, +175% on a cold feed load) and the C8
 * egress work plus the standing feed-SELECT contract keep the app receiving
 * derived answers rather than source evidence.
 *
 * So the guarantee is NOT that both surfaces are equally specific — it is
 * that they can never CONTRADICT, because more evidence can only refine:
 *
 *  - `family` is decided by the structured canonical fields both surfaces
 *    carry (the reason enum, the hazard category, the pathogen/allergen
 *    slot), so it is identical on both surfaces for every notice.
 *  - The allergen list comes from `pathogenOrAllergen` alone — identical.
 *  - A named material or agent is extracted from a haystack Detail extends
 *    only by APPENDING the summary, so a material Home names appears at the
 *    same position in Detail's text and still wins there. Home therefore
 *    names either nothing or exactly what Detail names — never a third thing.
 *  - Uncertainty is honest on both: an unnamed agent renders as its family's
 *    generic form, and neither surface invents a hazard.
 *
 * Pinned corpus-wide over every recorded FDA and FSIS notice by
 * `src/lib/recall-reason.test.ts` and the two presentation-regression suites.
 */

import { extractForeignMaterialEvidence } from '@/domain/hazard';

/** Closed set of reason families both surfaces render from. */
export type TypedReason =
  | { family: 'pathogen'; pathogen: string | null }
  | { family: 'allergen'; raw: string | null }
  | { family: 'foreign_material'; material: string | null }
  | { family: 'chemical'; agent: string | null }
  | { family: 'inspection' }
  | { family: 'import'; country: string | null; illegal: boolean; ineligible: boolean }
  | { family: 'unfit' }
  | { family: 'insanitary' }
  | { family: 'processing' }
  | { family: 'mislabeled'; word: 'mislabeled' | 'misbranded' }
  | { family: 'nutrition' }
  | { family: 'unapproved'; ingredient: string; use: string }
  | { family: 'contents'; contents: string }
  | { family: 'verbatim'; noun: string }
  | { family: 'unknown' };

export interface ReasonEvidence {
  reasonText: string | null;
  hazardCategory: string;
  pathogenOrAllergen: string | null;
  /**
   * The announcement body. Detail has it; Home deliberately does not (the
   * feed never carries source evidence — see the parity note above). Absent
   * evidence can only make an answer LESS specific, never different.
   */
  summaryText?: string | null;
  /** The official headline. BOTH surfaces carry this — the feed row has it. */
  title?: string | null;
}

/**
 * "imported from <Country>" as the source states it (title or summary).
 * The lead-in matches any casing; the country itself must be capitalized —
 * no /i flag so the capture never grabs arbitrary lowercase prose.
 */
function importedFromCountry(title: string | null, summaryText: string | null): string | null {
  const match = `${title ?? ''}\n${summaryText ?? ''}`.match(
    /\b[Ii]mported [Ff]rom (the\s+[A-Z][A-Za-z’' .-]{2,40}?|[A-Z][A-Za-z’' .-]{2,40}?)(?=,|\.|;| without| that| and| into| due|\n)/,
  );
  return match ? match[1].trim() : null;
}

/**
 * A source reason stated as "contains X … not approved for Y" — the
 * unapproved-ingredient family (recorded Kofinas shape: "Contains garlic
 * essential oil not approved for culinary use"). Both the ingredient and the
 * disallowed use come verbatim from the source; nothing is inferred.
 */
const UNAPPROVED_INGREDIENT =
  /^(?:the\s+)?(?:products?\s+)?(?:contains?|made\s+with|use[sd]?\s+of)\s+(?:an?\s+)?(.+?)\s*,?\s*(?:(?:which|that)\s+(?:is|are|was|were)\s+)?not\s+approved\s+for\s+(.+)$/i;

/**
 * A source reason that declares contents outright ("Product contains toxic
 * yellow oleander.", "Cans contain undeclared milk"). Only simple declared
 * subjects qualify; anything else stays in the gated fallback.
 */
const DECLARED_CONTENTS =
  /^(?:the\s+)?(?:products?\s+|cans?\s+|bottles?\s+|jars?\s+|packages?\s+|pouches?\s+)?contains?\s+(.+)$/i;

/**
 * Grammar gate for the free-text fallback: "because of <reason>" is only
 * grammatical when the reason is a noun phrase. A finite verb anywhere in the
 * phrase means it was a clause, and gluing it on would produce exactly the
 * malformed families the corpus showed ("because of contains…", "because of
 * product did not…", "because of glass prone to breakage").
 */
const CLAUSE_NOT_NOUN =
  /^not\b|\b(?:contains?|is|are|was|were|has|have|had|does|do|did|will|would|shall|should|may|might|must|can|could|prone)\b/i;

function cleanedReason(reasonText: string | null): string {
  return (reasonText ?? '')
    .replace(/[.\s]+$/, '')
    .replace(/^due to\s+/i, '')
    .trim();
}

/** The specific pathogen only when the structured slot names one. */
function statedPathogen(pathogenOrAllergen: string | null): string | null {
  return pathogenOrAllergen && !/^undeclared/i.test(pathogenOrAllergen) ? pathogenOrAllergen : null;
}

/**
 * The material to name in the reason line — from THE shared foreign-material
 * evidence owner (domain/hazard.ts), never a keyword scan of its own. A bare
 * material word in packaging prose ("9.75-oz. plastic bowls", "10-oz. plastic
 * bowl package") names no material, so the line degrades to the truthful
 * generic form instead of asserting a contaminant the source never stated.
 */
function sniffMaterial(evidence: ReasonEvidence): string | null {
  // The title joins the haystack because it is where an announcement most
  // often states its contaminant ("Due to Possible Plastic Contaminant").
  const text = [
    evidence.reasonText ?? '',
    evidence.title ?? '',
    evidence.pathogenOrAllergen ?? '',
    evidence.summaryText ?? '',
  ].join('\n');
  return extractForeignMaterialEvidence(text).material;
}

/**
 * Classify the canonical reason evidence into exactly one family. Precedence
 * follows the established template order: the FSIS structured reason strings
 * first (they are exact enum values, not prose), then the source-agnostic
 * hazard slots, then the source-pattern families, then the gated fallback.
 * Mislabeling/misbranding rank below the hazard slots so an FDA reason that
 * merely mentions labeling cannot outrank a structured allergen hazard.
 */
export function interpretReason(evidence: ReasonEvidence): TypedReason {
  const reasons = (evidence.reasonText ?? '').toLowerCase();
  const pathogen = statedPathogen(evidence.pathogenOrAllergen);
  const allergenRaw = evidence.pathogenOrAllergen?.match(/^undeclared\s+(.+)$/i)?.[1] ?? null;

  if (reasons.includes('product contamination')) {
    if (pathogen) return { family: 'pathogen', pathogen };
    // The canonical category already weighed this notice's evidence under the
    // shared contract — including the rare contamination-filed allergen recall
    // (115-2017). Honour its answer rather than re-deciding from the enum
    // string, which is exactly how the two layers stay unable to disagree.
    if (evidence.hazardCategory === 'allergen') return { family: 'allergen', raw: allergenRaw };
    if (evidence.hazardCategory === 'foreign_material') {
      return { family: 'foreign_material', material: sniffMaterial(evidence) };
    }
    return { family: 'pathogen', pathogen: null };
  }
  if (reasons.includes('unreported allergens')) {
    return { family: 'allergen', raw: allergenRaw };
  }
  if (reasons.includes('produced without benefit of inspection')) return { family: 'inspection' };
  if (reasons.includes('import violation')) {
    const summary = evidence.summaryText ?? '';
    return {
      family: 'import',
      country: importedFromCountry(evidence.title ?? null, evidence.summaryText ?? null),
      illegal: /illegally imported/i.test(summary),
      ineligible: /ineligible to export/i.test(summary),
    };
  }
  if (reasons.includes('unfit for human consumption')) return { family: 'unfit' };
  if (reasons.includes('insanitary conditions')) return { family: 'insanitary' };
  if (reasons.includes('processing defect')) return { family: 'processing' };

  // A microbial hazard WITH a stated organism is fully structured. Without
  // one, the source's own reason text (below) is often more specific than
  // "may be contaminated" ("potential mold growth contamination", "potential
  // cronobacter sakazakii contamination") — so an organism-less microbial
  // hazard only becomes the generic pathogen family when no safe source
  // wording survives the fallback gates.
  const microbial = evidence.hazardCategory === 'microbial_contamination';
  if (microbial && pathogen) {
    return { family: 'pathogen', pathogen };
  }
  if (evidence.hazardCategory === 'allergen') {
    return { family: 'allergen', raw: allergenRaw };
  }
  if (evidence.hazardCategory === 'foreign_material') {
    return { family: 'foreign_material', material: sniffMaterial(evidence) };
  }
  if (evidence.hazardCategory === 'chemical_contamination') {
    return { family: 'chemical', agent: evidence.pathogenOrAllergen };
  }

  if (reasons.includes('mislabeling')) return { family: 'mislabeled', word: 'mislabeled' };
  if (reasons.includes('misbranding')) return { family: 'mislabeled', word: 'misbranded' };

  // Infant-formula nutrition failures, matched against the source's wording.
  if (
    /infant formula/.test(reasons) &&
    /nutrition[^.]*requirements?|sufficient nutrition/.test(reasons)
  ) {
    return { family: 'nutrition' };
  }

  const reason = cleanedReason(evidence.reasonText);
  if (reason.length >= 3) {
    const unapproved = reason.match(UNAPPROVED_INGREDIENT);
    if (unapproved) {
      return { family: 'unapproved', ingredient: unapproved[1].trim(), use: unapproved[2].trim() };
    }
    const contents = reason.match(DECLARED_CONTENTS);
    if (contents) return { family: 'contents', contents: contents[1].trim() };
    if (!CLAUSE_NOT_NOUN.test(reason)) return { family: 'verbatim', noun: reason };
  }
  if (microbial) return { family: 'pathogen', pathogen: null };
  return { family: 'unknown' };
}

/**
 * A product phrase that reads plural mid-sentence, for singular/plural clause
 * grammar. Deliberately narrow: only a phrase actually ENDING in a plural
 * word counts, so "Hummus" and "Olive Oil" stay singular and only genuine
 * plurals ("Chocolatey Eyeballs", "…Products") take plural agreement.
 */
export function pluralProductPhrase(product: string): boolean {
  const lastWord = product
    .trim()
    .replace(/[).,;:'"”’]+$/, '')
    .split(/\s+/)
    .pop()
    ?.toLowerCase();
  if (!lastWord) return false;
  if (!/[a-z]s$/.test(lastWord)) return false;
  return !/(?:ss|us|is)$/.test(lastWord);
}
