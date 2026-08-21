/**
 * Display formatting for recall data. One rule dominates: unknown data is
 * communicated honestly ("Not specified"), never rendered as an empty value or
 * a guessed default.
 */

import type { CaseProjection } from '@/domain/recall-types';

export function noticeTypeLabel(noticeType: 'recall' | 'public_health_alert'): string {
  return noticeType === 'public_health_alert' ? 'Public Health Alert' : 'Recall';
}

export interface RiskPresentation {
  /** Concise standardized label, e.g. "Class I · High risk". */
  label: string;
  /** One-sentence consumer explanation; null when there is nothing honest to add. */
  explanation: string | null;
}

/**
 * Consumer presentation of the authoritative FSIS classification. These are
 * display simplifications only — the underlying classification value is never
 * changed, and PHAs are never assigned a class (null = show nothing).
 */
export function riskPresentation(value: string): RiskPresentation | null {
  switch (value) {
    case 'class_I':
      return { label: 'Class I · High risk', explanation: 'Serious health effects are possible.' };
    case 'class_II':
      return {
        label: 'Class II · Lower risk',
        explanation: 'Health effects are possible, but unlikely.',
      };
    case 'class_III':
      return { label: 'Class III · Low risk', explanation: 'Health problems are not expected.' };
    case 'not_yet_classified':
      return {
        label: 'Risk level pending',
        explanation: 'The agency has not yet assigned a risk classification.',
      };
    case 'not_applicable_pha':
      return null; // PHAs are not classified; showing nothing is the honest state.
    default:
      return null;
  }
}

/** Consumer wording for FSIS's structured reason values. Unmapped → verbatim. */
const REASON_DISPLAY: Record<string, string> = {
  'produced without benefit of inspection': 'Produced without inspection',
  'import violation': 'Import violation',
  misbranding: 'Misbranding',
  mislabeling: 'Mislabeling',
  'insanitary conditions': 'Insanitary conditions',
  'processing defect': 'Processing defect',
  'unfit for human consumption': 'Unfit for human consumption',
};

/**
 * Concise consumer reason line, e.g. "Possible Listeria monocytogenes
 * contamination" or "Undeclared milk". Deterministic mapping of the source's
 * structured reason values; anything unmapped is shown verbatim rather than
 * weakened or guessed.
 */
export function reasonLine(
  reasonText: string | null,
  hazardCategory: string,
  pathogenOrAllergen: string | null,
): string | null {
  if (!reasonText) return null;
  const parts = reasonText
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '');
  const out: string[] = [];
  for (const part of parts) {
    const key = part.toLowerCase();
    if (key === 'product contamination') {
      // Specific when the source names the contaminant; generic otherwise.
      if (pathogenOrAllergen && !pathogenOrAllergen.toLowerCase().startsWith('undeclared')) {
        out.push(`Possible ${pathogenOrAllergen} contamination`);
      } else if (hazardCategory === 'foreign_material') {
        out.push('Possible foreign material contamination');
      } else {
        out.push('Possible contamination');
      }
    } else if (key === 'unreported allergens') {
      out.push(
        pathogenOrAllergen?.toLowerCase().startsWith('undeclared')
          ? pathogenOrAllergen.charAt(0).toUpperCase() + pathogenOrAllergen.slice(1)
          : 'Undeclared allergen',
      );
    } else {
      out.push(REASON_DISPLAY[key] ?? part);
    }
  }
  return out.length > 0 ? [...new Set(out)].join(' · ') : null;
}

export function stateLabel(state: 'active' | 'closed' | 'retracted'): string {
  switch (state) {
    case 'active':
      return 'Active';
    case 'closed':
      // "Closed" means the agency concluded its process — never "safe now".
      return 'Closed by agency';
    case 'retracted':
      return 'Retracted';
  }
}

export function hazardLabel(hazardCategory: string): string | null {
  switch (hazardCategory) {
    case 'allergen':
      return 'Undeclared allergen';
    case 'microbial_contamination':
      return 'Possible contamination';
    case 'foreign_material':
      return 'Foreign material';
    case 'product_integrity':
      return 'Product integrity';
    case 'other_regulatory':
      return 'Regulatory issue';
    default:
      return null;
  }
}

/** Compact geography for cards; the full state list lives in the detail view. */
export function geographyLabel(geography: CaseProjection['geography']): string {
  switch (geography.scope) {
    case 'nationwide':
      return 'Nationwide';
    case 'states':
      return geography.states.length > 3
        ? `${geography.states.length} states`
        : geography.states.join(', ');
    case 'unknown':
      // Unknown is never rendered as nationwide or as "none".
      return 'Distribution not specified';
  }
}

/** Full geography for the detail view (complete state list, honest unknowns). */
export function geographyDetail(geography: CaseProjection['geography']): string {
  switch (geography.scope) {
    case 'nationwide':
      return 'Nationwide';
    case 'states':
      return geography.states.join(', ');
    case 'unknown':
      return 'Distribution not specified. Check the official notice for more information.';
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Aug 17, 2026" from an ISO date, without timezone surprises. */
export function formatDate(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return isoDate;
  const [, year, month, day] = match;
  return `${MONTHS[Number(month) - 1]} ${Number(day)}, ${year}`;
}

export function timingLine(publishedAt: string, lastPublicActivityAt: string): string {
  const published = `Announced ${formatDate(publishedAt)}`;
  return lastPublicActivityAt > publishedAt
    ? `${published} · Updated ${formatDate(lastPublicActivityAt)}`
    : published;
}

/** Recency display tiers (architecture Part 2.3). */
export function isRecent(lastPublicActivityAt: string, now: Date = new Date()): boolean {
  const activity = new Date(`${lastPublicActivityAt.slice(0, 10)}T00:00:00Z`).getTime();
  return now.getTime() - activity <= 60 * 24 * 60 * 60 * 1000;
}
