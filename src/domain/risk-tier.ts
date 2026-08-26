/**
 * Two layers of risk, kept strictly apart.
 *
 *   OFFICIAL CLASSIFICATION — FDA / USDA FSIS Class I, II, III. Source truth,
 *   preserved exactly as the agency assigned it, per affected product. Never
 *   invented, never averaged, never promoted.
 *
 *   CONSUMER RISK TIER — Recall's own five-level language (Critical, High,
 *   Moderate, Low, Minimal) plus two non-scale states (Pending, Unrated).
 *   Derived product semantics: a deterministic projection OF the official
 *   class set, never an independent judgement about a recall.
 *
 * The tier is not persisted. Given the same class set it is always identical,
 * so storing it could only create a second truth able to drift from the first.
 *
 * Nothing here infers a class or a tier from hazard, pathogen, allergen,
 * illness reports, or our Health Risk copy. Before an authoritative
 * classification exists, an FDA recall is Pending — full stop.
 */

import type { Classification, ClassificationValue, OfficialClass } from './recall-types';

export type ConsumerRiskTier =
  'critical' | 'high' | 'moderate' | 'low' | 'minimal' | 'pending' | 'unrated';

/** Most severe first — the canonical ordering of a class set. */
const CLASS_SEVERITY: OfficialClass[] = ['class_I', 'class_II', 'class_III'];

export function isOfficialClass(value: ClassificationValue | string): value is OfficialClass {
  return (CLASS_SEVERITY as string[]).includes(value);
}

/**
 * The authoritative class set of a classification.
 *
 * Projections persisted before the set existed carry only the scalar, so a
 * legacy single class still reads correctly; nothing is guessed for a legacy
 * value that names no class.
 */
export function officialClassesOf(
  classification: Pick<Classification, 'value' | 'officialClasses'>,
): OfficialClass[] {
  const set = classification.officialClasses;
  if (set !== undefined) {
    return CLASS_SEVERITY.filter((c) => set.includes(c));
  }
  return isOfficialClass(classification.value) ? [classification.value] : [];
}

/** Deterministic identity of a class set — the unit material change compares. */
export function classSetKey(classes: OfficialClass[]): string {
  return CLASS_SEVERITY.filter((c) => classes.includes(c)).join('+');
}

export type ClassificationStatus = 'pending' | 'single' | 'mixed' | 'not_applicable';

export function classificationStatus(
  classification: Pick<Classification, 'value' | 'officialClasses'>,
): ClassificationStatus {
  const classes = officialClassesOf(classification);
  if (classes.length > 1) return 'mixed';
  if (classes.length === 1) return 'single';
  return classification.value === 'not_applicable_pha' ? 'not_applicable' : 'pending';
}

/**
 * Class set → consumer tier. Deliberate interpolation between regulatory
 * classes, NOT arithmetic: FDA Class I/II/III are categorical, and averaging
 * them would let nine Class III products make one Class I product look mild.
 *
 *   {I}          → Critical      {II}       → Moderate
 *   {I,II}       → High          {II,III}   → Low
 *   {I,III}      → High          {III}      → Minimal
 *   {I,II,III}   → High          {}         → Pending / Unrated
 *
 * Pure Class I means EVERY affected product carries the agency's most serious
 * class. A mixed set containing Class I does not: the agency itself classified
 * those products differently, so the case is High and the official classes
 * stay visible in the detail view. Severity is never "picked" from a set.
 */
export function consumerRiskTier(
  classification: Pick<Classification, 'value' | 'officialClasses'>,
): ConsumerRiskTier {
  const classes = officialClassesOf(classification);
  if (classes.length === 0) {
    // Two different absences: a class may still arrive (Pending), or none is
    // ever expected for this notice type (Unrated). Never conflated.
    return classification.value === 'not_applicable_pha' ? 'unrated' : 'pending';
  }
  if (classes.includes('class_I')) return classes.length === 1 ? 'critical' : 'high';
  if (classes.includes('class_II')) return classes.includes('class_III') ? 'low' : 'moderate';
  return 'minimal';
}

/**
 * Internal severity ordering, for future sorting/filtering. Home's ordering is
 * unchanged by this scale — it stays chronological/relevance-based.
 * Non-scale states rank `null`: they are not a low severity, they are no
 * severity, and ranking them 0 would sort Pending below Minimal.
 */
export const RISK_TIER_RANK: Record<ConsumerRiskTier, number | null> = {
  critical: 5,
  high: 4,
  moderate: 3,
  low: 2,
  minimal: 1,
  pending: null,
  unrated: null,
};

/** "Class I" — the agency's own label for one class. */
export function officialClassLabel(value: OfficialClass): string {
  return value.replace('class_', 'Class ');
}

/** "Class I", "Class I and Class II", "Class I, Class II, and Class III". */
export function officialClassListText(classes: OfficialClass[]): string {
  const labels = CLASS_SEVERITY.filter((c) => classes.includes(c)).map(officialClassLabel);
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}
