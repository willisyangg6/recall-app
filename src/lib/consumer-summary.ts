/**
 * Deterministic consumer-facing presentation helpers derived from source data.
 *
 * These are display transformations only (architecture Part 4: the canonical
 * projection stays authoritative and untouched). Every function degrades
 * gracefully: when a clean summary cannot be derived, it returns null and the
 * caller falls back to the authoritative source text — an imperfect summary
 * must never hide or alter recall information.
 */

/**
 * FSIS headline grammar, verified across the recorded fixtures:
 *   "<Firm> Recalls <products> Due to <reason>"
 *   "<Firm> Expands Recall for <products> Due to …"
 *   "FSIS Issues Public Health Alert for <products> Due To …"
 *   "FSIS Retracts Public Health Alert for <products> Due to …"
 * The PHA patterns must match first: PHA titles can contain the word
 * "Recalled" in their tail.
 */
const TITLE_PRODUCT_PATTERNS = [
  /\bpublic health alert for\s+(.+)$/i,
  /\bexpands? (?:its )?recall for\s+(.+)$/i,
  /\brecalls?\s+(.+)$/i,
];

/** Reason/qualifier tails that follow the product phrase in FSIS headlines. */
const TITLE_TAIL =
  /\s+(?:due to\b|because\b|that (?:have|has|may|were|was|contain)\b|containing\b|imported from\b|produced without\b|for possible\b|after\b|linked to\b).*$/i;

/**
 * Short consumer product phrase from an official headline, e.g.
 * "Indus Foods, LLC DBA Gangothri Foods Recalls Ready-To-Eat Pickled Goat and
 * Chicken Products Produced Without Benefit of Inspection"
 * → "Ready-To-Eat Pickled Goat and Chicken".
 * Returns null when the headline doesn't follow the known grammar.
 */
export function productSummaryFromTitle(title: string): string | null {
  for (const pattern of TITLE_PRODUCT_PATTERNS) {
    const match = title.match(pattern);
    if (!match) continue;
    const summary = match[1]
      .replace(TITLE_TAIL, '')
      .replace(/(^|\s+)products?$/i, '')
      .replace(/[\s,.;:]+$/, '')
      .trim();
    return summary.length >= 3 ? summary : null;
  }
  return null;
}

/**
 * Mechanical legal suffixes that can be dropped for display without changing
 * identity. Deliberately conservative: ambiguous words like "Company"/"Foods"
 * are never stripped.
 */
const LEGAL_SUFFIX =
  /(?:[,.]?\s+(?:LLC|L\.L\.C\.|Inc\.?|Incorporated|Corp\.?|Corporation|Ltd\.?|LLP|L\.P\.|LP|PLC|Co\.))+$/i;

/**
 * Most consumer-recognizable company name for display. Prefers a DBA/trade
 * name when the source states one ("Indus Foods, LLC DBA Gangothri Foods" →
 * "Gangothri Foods") and strips mechanical legal suffixes. The authoritative
 * raw/legal name stays in the underlying data untouched.
 */
export function companyDisplayName(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const dba = trimmed.match(/\b(?:dba|d\/b\/a|doing business as)\s+(.+)$/i);
  const base = (dba?.[1] ?? trimmed).trim();
  const stripped = base
    .replace(LEGAL_SUFFIX, '')
    .replace(/[\s,]+$/, '')
    .trim();
  return stripped.length >= 3 ? stripped : base;
}

export interface ProductLineDisplay {
  /** The label name as printed on the product, from the quoted source text. */
  name: string;
  /** Package description preceding the name (e.g. "8-oz. glass jars"). */
  packageText: string | null;
  /** Identifying details after the name (dates, lot codes, est. numbers). */
  detailText: string | null;
}

/**
 * Structure an FSIS product line for display. FSIS lines follow
 * `<package> containing "<NAME>" <identifying details>`; the quoted segment is
 * the product's label name. Returns null when no quoted name exists — the
 * caller must then show the original line verbatim (graceful improvement,
 * never destructive parsing; identifying details are safety-critical).
 */
export function parseProductLine(rawText: string): ProductLineDisplay | null {
  const match = rawText.match(/[“"]([^“”"]+)[”"]/);
  if (!match || match.index === undefined) return null;
  const name = match[1].replace(/[\s.,]+$/, '').trim();
  if (name.length < 2) return null;

  const before = rawText
    .slice(0, match.index)
    .replace(/^[\s•\-*]+/, '')
    .replace(/\s+containing a plastic bag of\s*$/i, '')
    .replace(/\s+(?:containing|holding|of|labeled)\s*$/i, '')
    .trim();
  const after = rawText
    .slice(match.index + match[0].length)
    .replace(/^[\s,.;-]+/, '')
    .trim();

  return {
    name,
    packageText: before === '' ? null : before,
    detailText: after === '' ? null : after,
  };
}
