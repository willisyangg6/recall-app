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
 */

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
  /** Fuller source text when the caller has it (Detail); Home has none. */
  summaryText?: string | null;
  title?: string | null;
}

const FOREIGN_MATERIALS = ['metal', 'plastic', 'glass', 'wood', 'rubber', 'bone fragments'];

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

function sniffMaterial(evidence: ReasonEvidence): string | null {
  const text = `${evidence.reasonText ?? ''}\n${evidence.pathogenOrAllergen ?? ''}\n${evidence.summaryText ?? ''}`;
  return FOREIGN_MATERIALS.find((m) => new RegExp(`\\b${m}\\b`, 'i').test(text)) ?? null;
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
