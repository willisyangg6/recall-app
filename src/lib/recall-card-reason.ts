/**
 * The Feed/Saved card's shorter reason wording (founder-approved, 2026-10-14).
 *
 * Card-only, at render time: it shortens the finished reason sentence the
 * presentation contract already built (`conciseReasonLine` + `cardSummaryText`)
 * and nothing upstream. Push reads that same contract sentence and Detail
 * builds its own paragraph, so neither changes; the stored source data is
 * untouched.
 *
 * Only two exact, known shapes change, and an unfamiliar reason is returned
 * as given — there is no blanket word deletion:
 *
 * - An allergen line drops its redundant trailing "allergen"/"allergens":
 *   "Undeclared sesame allergen" → "Undeclared sesame". Every named allergen
 *   stays, and so does a leading uncertainty qualifier ("Possible undeclared
 *   milk allergen" → "Possible undeclared milk"). The generic "Undeclared
 *   allergen", which names none, keeps its word.
 * - The two approved pathogen lines: "Potential Salmonella contamination" →
 *   "Possible Salmonella", and "Potential Listeria contamination" →
 *   "Possible Listeria". Any other pathogen line, and any confirmed
 *   contamination wording, is unchanged.
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

export function cardReasonText(reason: string | null): string | null {
  if (reason === null) return null;
  const pathogen = PATHOGEN_SHORT_FORMS[reason];
  if (pathogen !== undefined) return pathogen;
  const allergen = reason.match(ALLERGEN_LINE);
  if (allergen) return `${allergen[1]}${allergen[2]}`;
  return reason;
}
