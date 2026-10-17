/**
 * The Feed/Saved card's shorter reason wording (founder-approved 2026-10-14;
 * widened to the recurring corpus patterns 2026-10-16).
 *
 * Card-only, at render time: it shortens the finished reason sentence the
 * presentation contract already built (`conciseReasonLine` + `cardSummaryText`)
 * and nothing upstream. Push reads that same contract sentence and Detail
 * builds its own paragraph, so neither changes; the stored source data is
 * untouched.
 *
 * Only recognised shapes change, each by a fixed rule, and an unfamiliar
 * reason is returned as given — there is no blanket word deletion. Every
 * named hazard, allergen and agent survives, and so does the uncertainty: a
 * "potential" line always reads "Possible …", never as a finding.
 *
 * - **Allergens.** The redundant trailing "allergen"/"allergens" goes:
 *   "Undeclared sesame allergen" → "Undeclared sesame". A leading qualifier
 *   stays ("Possible undeclared milk"). The generic "Undeclared allergen",
 *   which names none, keeps its word.
 * - **Pathogens.** "Potential <organisms> contamination" and "Potential to be
 *   contaminated with <organisms>" read "Possible <organisms>" when every
 *   named agent is a known pathogen: "Possible Salmonella", "Possible E. coli
 *   and/or Salmonella" (the connective is kept, so "or" and "and/or" stay
 *   distinct), "Possible Listeria monocytogenes".
 * - **Other potential hazards.** A leading "Potential" reads "Possible" and
 *   the rest is kept: "Possible lead contamination", "Possible foreign
 *   material contamination", "Possible choking hazard for babies and young
 *   children". "Potential presence of X" and "Potential for X" read
 *   "Possible X"; "Potential to be contaminated with X" (not a pathogen)
 *   reads "Possible X contamination".
 * - **"Potential Foodborne Illness – X"** drops the category heading and
 *   applies the rules above to X: "Possible botulism", "Possible Bacillus
 *   cereus", "Possible lead contamination".
 */

const PATHOGEN_SHORT_FORMS: Readonly<Record<string, string>> = {
  'Potential Salmonella contamination': 'Possible Salmonella',
  'Potential Listeria contamination': 'Possible Listeria',
};

/**
 * An allergen line: an optional uncertainty qualifier, "undeclared", at least
 * one named allergen, then the redundant "allergen(s)" at the very end.
 */
const ALLERGEN_LINE = /^((?:(?:possible|potential)\s+)?undeclared\s+)(\S.*?)\s+allergens?$/i;

/** Organisms whose "contamination" the card may leave implicit. */
const PATHOGEN =
  /^(?:Salmonella|Listeria(?: monocytogenes)?|E\. coli(?: O157:H7)?|Clostridium botulinum|Bacillus cereus|Hepatitis A|Cyclospora|Cronobacter(?: sakazakii)?|botulism)$/i;

/** "A", "A and B", "A or B", "A and/or B", "A, B and C": all pathogens. */
function allPathogens(agents: string): boolean {
  const parts = agents.split(/\s*,\s*|\s+and\/or\s+|\s+and\s+|\s+or\s+/i);
  return parts.every((part) => PATHOGEN.test(part.trim()));
}

/** A common noun capitalised only because it followed a heading. */
function afterHeading(text: string): string {
  return /^(?:Botulism|Lead)\b/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
}

/** The "Potential …" family; null when the reason is not one of its shapes. */
function potentialLine(reason: string): string | null {
  const illness = reason.match(/^Potential\s+Foodborne\s+Illness\s*[-–—]\s*(\S.*)$/i);
  if (illness) {
    const rest = afterHeading(illness[1].trim());
    if (allPathogens(rest)) return `Possible ${rest}`;
    return potentialLine(`Potential ${rest}`) ?? `Possible ${rest}`;
  }
  const contaminatedWith = reason.match(/^Potential\s+to\s+be\s+contaminated\s+with\s+(\S.*)$/i);
  if (contaminatedWith) {
    const agents = contaminatedWith[1];
    return allPathogens(agents) ? `Possible ${agents}` : `Possible ${agents} contamination`;
  }
  const contamination = reason.match(/^Potential\s+(\S.*?)\s+contamination$/i);
  if (contamination && allPathogens(contamination[1])) return `Possible ${contamination[1]}`;
  const presence = reason.match(/^(?:The\s+)?Potential\s+presence\s+of\s+(\S.*)$/i);
  if (presence) return `Possible ${presence[1]}`;
  const forLine = reason.match(/^Potential\s+for\s+(\S.*)$/i);
  if (forLine) return `Possible ${forLine[1]}`;
  const potential = reason.match(/^Potential\s+(\S.*)$/i);
  if (potential) return `Possible ${potential[1]}`;
  return null;
}

export function cardReasonText(reason: string | null): string | null {
  if (reason === null) return null;
  const pathogen = PATHOGEN_SHORT_FORMS[reason];
  if (pathogen !== undefined) return pathogen;
  const allergen = reason.match(ALLERGEN_LINE);
  if (allergen) return `${allergen[1]}${allergen[2]}`;
  return potentialLine(reason) ?? reason;
}
