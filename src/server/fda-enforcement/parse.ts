/**
 * openFDA Food Enforcement records → normalized enforcement facts.
 *
 * Source semantics (docs/recall-source-contract.md §3.2, re-verified live
 * 2026-08-25): the endpoint mirrors FDA's Recall Enterprise System weekly;
 * `recall_number` is globally unique per recalled PRODUCT (29,317/29,317
 * unique in the full export) and `event_id` groups the products of one
 * recall event (7,837 events; 35% have several records; max observed 409).
 * Records are effectively always classified (exactly one "Not Yet
 * Classified" record exists and it has an EMPTY recall_number — quarantined
 * here, never ingested). Records mutate in place when FDA corrects them.
 *
 * This is NOT a consumer notice. Nothing here may become consumer prose,
 * titles, or package fields — enforcement records contribute exactly one
 * consumer-visible fact (the official classification) through the projection,
 * and everything else is match evidence and provenance.
 */

import type { Classification } from '../../domain/recall-types';

/** The raw openFDA record shape, as served (all fields optional strings). */
export interface OpenFdaEnforcementRaw {
  recall_number?: string;
  event_id?: string;
  classification?: string;
  status?: string;
  recalling_firm?: string;
  product_description?: string;
  product_quantity?: string;
  code_info?: string;
  more_code_info?: string;
  reason_for_recall?: string;
  distribution_pattern?: string;
  product_type?: string;
  voluntary_mandated?: string;
  recall_initiation_date?: string;
  center_classification_date?: string;
  report_date?: string;
  termination_date?: string;
  initial_firm_notification?: string;
  city?: string;
  state?: string;
  country?: string;
  [key: string]: unknown;
}

/** One enforcement record, normalized for matching and enrichment. */
export interface EnforcementRecord {
  /** FDA tracking number for the recalled product — the stable identity. */
  recallNumber: string;
  /** FDA number for the recall event — groups this event's products. */
  eventId: string;
  classification: Classification;
  /** The official classification exactly as served ("Class I"). */
  classificationText: string;
  status: string | null;
  recallingFirm: string;
  productDescription: string;
  productQuantity: string | null;
  codeInfo: string | null;
  reasonForRecall: string | null;
  distributionPattern: string | null;
  productType: string | null;
  voluntaryMandated: string | null;
  /** ISO dates; openFDA serves YYYYMMDD. */
  recallInitiationDate: string | null;
  centerClassificationDate: string | null;
  reportDate: string | null;
  terminationDate: string | null;
}

export class EnforcementParseError extends Error {
  constructor(
    message: string,
    readonly recallNumber: string | null,
  ) {
    super(message);
    this.name = 'EnforcementParseError';
  }
}

/** "20260819" → "2026-08-19"; anything else → null (never guessed). */
export function isoDate(yyyymmdd: string | undefined | null): string | null {
  if (!yyyymmdd || !/^\d{8}$/.test(yyyymmdd)) return null;
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

/** Official classification string → our closed value. Never inferred. */
export function parseEnforcementClassification(text: string | undefined): Classification {
  const match = (text ?? '').match(/^Class\s+(I{1,3})$/i);
  if (match) {
    const value =
      match[1].length === 1 ? 'class_I' : match[1].length === 2 ? 'class_II' : 'class_III';
    return { value, sourceText: text!.trim() };
  }
  // "Not Yet Classified" (or any unrecognized wording) is honestly unassigned.
  return { value: 'not_yet_classified', sourceText: text?.trim() || null };
}

const trimmed = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
};

/**
 * Normalize one raw openFDA record. Throws for records that cannot carry a
 * stable identity (empty recall_number — observed exactly once in the live
 * dataset, on the lone unclassified record): quarantined, never guessed.
 */
export function parseEnforcementRecord(raw: OpenFdaEnforcementRaw): EnforcementRecord {
  const recallNumber = trimmed(raw.recall_number);
  if (recallNumber === null) {
    throw new EnforcementParseError('enforcement record has no recall_number', null);
  }
  const eventId = trimmed(raw.event_id);
  if (eventId === null) {
    throw new EnforcementParseError('enforcement record has no event_id', recallNumber);
  }
  const recallingFirm = trimmed(raw.recalling_firm);
  if (recallingFirm === null) {
    throw new EnforcementParseError('enforcement record has no recalling_firm', recallNumber);
  }
  const productDescription = trimmed(raw.product_description);
  if (productDescription === null) {
    throw new EnforcementParseError('enforcement record has no product_description', recallNumber);
  }
  return {
    recallNumber,
    eventId,
    classification: parseEnforcementClassification(trimmed(raw.classification) ?? undefined),
    classificationText: trimmed(raw.classification) ?? '',
    status: trimmed(raw.status),
    recallingFirm,
    productDescription,
    productQuantity: trimmed(raw.product_quantity),
    codeInfo: trimmed(raw.code_info),
    reasonForRecall: trimmed(raw.reason_for_recall),
    distributionPattern: trimmed(raw.distribution_pattern),
    productType: trimmed(raw.product_type),
    voluntaryMandated: trimmed(raw.voluntary_mandated),
    recallInitiationDate: isoDate(raw.recall_initiation_date),
    centerClassificationDate: isoDate(raw.center_classification_date),
    reportDate: isoDate(raw.report_date),
    terminationDate: isoDate(raw.termination_date),
  };
}
