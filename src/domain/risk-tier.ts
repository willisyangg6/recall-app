/**
 * Two layers of risk, kept strictly apart.
 *
 *   OFFICIAL CLASSIFICATION — FDA / USDA FSIS Class I, II, III. Source truth,
 *   preserved exactly as the agency assigned it, per affected product. Never
 *   invented, never averaged, never promoted.
 *
 *   CONSUMER RISK TIER — Recall's own five-level language (Critical, Very
 *   High, High, Moderate, Low) plus two non-scale states (Pending, Unknown).
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
  'critical' | 'very_high' | 'high' | 'moderate' | 'low' | 'pending' | 'unknown';

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
 *   {I}          → Critical      {II}       → High
 *   {I,II}       → Very High     {II,III}   → Moderate
 *   {I,III}      → Very High     {III}      → Low
 *   {I,II,III}   → Very High     {}         → Pending / Unknown
 *
 * Pure Class I means EVERY affected product carries the agency's most serious
 * class. A mixed set containing Class I does not: the agency itself classified
 * those products differently, so the case is Very High — below pure Class I,
 * above a set with no Class I in it — and the official classes stay visible in
 * the detail view. Severity is never "picked" from a set.
 */
export function consumerRiskTier(
  classification: Pick<Classification, 'value' | 'officialClasses'>,
): ConsumerRiskTier {
  const classes = officialClassesOf(classification);
  if (classes.length === 0) return unclassifiedTier(classification.value);
  if (classes.includes('class_I')) return classes.length === 1 ? 'critical' : 'very_high';
  if (classes.includes('class_II')) return classes.includes('class_III') ? 'moderate' : 'high';
  return 'low';
}

/**
 * The two absences, kept strictly apart — and never silently merged.
 *
 *   PENDING — the agency has not assigned a classification YET. Exactly one
 *   value means this (`not_yet_classified`), and FDA recalls routinely sit
 *   here for weeks after announcement. It is a promise that an answer is
 *   coming.
 *
 *   UNKNOWN — this app cannot determine a supported classification. That
 *   covers a public health alert, which never receives one at all; a legacy
 *   `multiple_classes` scalar persisted before `officialClasses` existed, where
 *   the case demonstrably HAS classes but which ones is unrecoverable here;
 *   and any value outside the supported vocabulary. None of these is waiting
 *   for anything, so none of them may read as Pending.
 *
 * A public health alert's absence is explained precisely where it matters —
 * Detail renders "Not assigned · Public health alerts do not receive a formal
 * classification" directly beneath the label (lib/risk-display.ts), so Unknown
 * is never the whole story a shopper gets.
 */
function unclassifiedTier(value: Classification['value']): ConsumerRiskTier {
  return value === 'not_yet_classified' ? 'pending' : 'unknown';
}

/**
 * Internal severity ordering, for future sorting/filtering. Home's ordering is
 * unchanged by this scale — it stays chronological/relevance-based.
 * Non-scale states rank `null`: they are not a low severity, they are no
 * severity, and ranking them 0 would sort Pending below Low.
 */
export const RISK_TIER_RANK: Record<ConsumerRiskTier, number | null> = {
  critical: 5,
  very_high: 4,
  high: 3,
  moderate: 2,
  low: 1,
  pending: null,
  unknown: null,
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
