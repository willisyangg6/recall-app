/**
 * FSIS record parser: one raw FSIS Recall API record → NormalizedSourceRecord.
 *
 * Every FSIS quirk documented in docs/recall-source-contract.md §4.1 is
 * contained here; nothing downstream may know a Drupal field name:
 * - dirty string recall numbers (whitespace, case, suffix chaos)
 * - expansion records ("005-2026-EXP", " expansion", "(Original)", …)
 * - PHA numbering and PHA retraction notices
 * - `field_recall_type` reliable / `field_active_notice` verified unreliable
 * - ""/[] emptiness normalized to explicit unknowns
 * - HTML entities and HTML summaries
 * - http:// official URLs
 */

import {
  extractChemicalAgent,
  extractForeignMaterialEvidence,
  extractPathogenOrAllergen,
  PATHOGENS,
  statesUndeclaredAllergen,
} from '../../domain/hazard';
import { classifyIllnessReport } from '../../domain/illness';
import type { Geography, HazardCategory } from '../../domain/recall-types';
import type { NormalizedSourceRecord } from '../../domain/source-record';
import {
  CONSUMER_ACTION_PATTERN,
  decodeEntities,
  joinSentences,
  splitSentences,
  stripHtml,
} from '../../domain/text';

// Re-exported for existing consumers; implementations moved to domain/text so
// the FDA adapter can share them without importing FSIS code.
export { decodeEntities, stripHtml };

/** Raw shape of one FSIS API record. All values are strings or string arrays (§4.1). */
export interface FsisRawRecord {
  field_title: string;
  field_recall_number: string;
  field_recall_type: string;
  field_recall_classification: string;
  field_risk_level: string;
  field_recall_reason: string[];
  field_recall_date: string;
  field_last_modified_date: string;
  field_closed_year: string;
  field_states: string[];
  field_product_items: string[];
  field_establishment: string[];
  field_summary: string;
  field_qty_recovered: string;
  field_company_media_contact: string[];
  field_recall_url: string;
  field_archive_recall: string;
  field_related_to_outbreak: string;
  langcode: string;
  [key: string]: unknown;
}

export class FsisParseError extends Error {
  constructor(
    message: string,
    public readonly rawRecordNumber: string | null,
  ) {
    super(message);
    this.name = 'FsisParseError';
  }
}

/** "" and [] mean "not stated", never false/none (§4.1). */
function emptyToNull(value: string): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/** Defensive coercion: the API serves strings and string arrays loosely. */
function asText(value: unknown): string {
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string').join('\n');
  return typeof value === 'string' ? value : '';
}

/**
 * Split a dirty recall number into its base identity and any expansion suffix.
 * Base shapes: "DDD-YYYY" (yearly restart) or "PHA-MMDDYYYY-NN" (with observed
 * historical variance in digit counts). Anything after the base — "-EXP",
 * " expansion-3", "(Original)" — marks a related record in the same family.
 */
export function splitRecallNumber(raw: string): { nativeId: string; baseId: string | null } {
  const nativeId = raw.trim().toUpperCase();
  const baseMatch = nativeId.match(/^(PHA-\d{6,9}(?:-\d{1,2})?|\d{1,3}-\d{4})/);
  if (!baseMatch) return { nativeId, baseId: null };
  const base = baseMatch[1];
  return { nativeId, baseId: base === nativeId ? null : base };
}

/**
 * Deterministic lookup from FSIS's structured 9-value reason enum (§4.1),
 * with canonical evidence deciding the cases the enum leaves ambiguous or
 * gets wrong. Unmappable → 'unknown', never guessed.
 *
 * Two evidence rules sit alongside the enum (P2e-B, both founder-approved and
 * both driven entirely by the shared evidence owners in domain/hazard.ts —
 * this function owns no vocabulary of its own):
 *
 * 1. FSIS UNDER-REPORTS ALLERGENS IN THE ENUM. Measured on the live corpus:
 *    20 notices whose body states the standard "contains X, a known allergen,
 *    which is not declared on the product label" carry only "Misbranding" /
 *    "Mislabeling" — or an empty reason array — because misbranding is how an
 *    undeclared allergen is REPORTED, not a second hazard. Trusting the enum
 *    alone filed them as regulatory/unknown, so nothing could match a user's
 *    allergen preference. A labeling-only (or absent) reason plus affirmative
 *    undeclared-allergen evidence is an allergen recall. A reason naming any
 *    other hazard — import, inspection, insanitary, processing, contamination
 *    — keeps its own category: incidental allergen words never displace a
 *    stated hazard.
 *
 * 2. "Product Contamination" covers pathogens, foreign matter AND, rarely, a
 *    mis-filed allergen recall (verified: 115-2017, an undeclared-anchovy
 *    recall). Supported hazards win in evidence order — pathogen, then
 *    genuine foreign material, then chemical — and only with none of them
 *    stated may affirmative allergen evidence resolve the category.
 */
export function deriveHazardCategory(reasons: string[], text: string): HazardCategory {
  const undeclaredAllergen = statesUndeclaredAllergen(text);

  if (reasons.includes('Unreported Allergens')) return 'allergen';
  if (reasons.includes('Product Contamination')) {
    if (PATHOGENS.some((p) => new RegExp(`\\b${p.replace(/[.]/g, '\\.')}\\b`, 'i').test(text))) {
      return 'microbial_contamination';
    }
    if (extractForeignMaterialEvidence(text).stated) return 'foreign_material';
    // A chemical agent is a supported hazard this branch does not itself
    // classify (FSIS has no chemical reason value); it only bars the allergen
    // resolution below, so a chemical notice stays 'unknown' as before.
    if (undeclaredAllergen && extractChemicalAgent(text) === null) return 'allergen';
    return 'unknown';
  }
  if (reasons.includes('Insanitary Conditions')) return 'other_regulatory';
  if (reasons.some((r) => ['Processing Defect', 'Unfit for Human Consumption'].includes(r))) {
    return 'product_integrity';
  }
  if (
    reasons.some((r) =>
      [
        'Misbranding',
        'Mislabeling',
        'Import Violation',
        'Produced Without Benefit of Inspection',
      ].includes(r),
    )
  ) {
    return labelingOnly(reasons) && undeclaredAllergen ? 'allergen' : 'other_regulatory';
  }
  // No mappable reason at all — including the empty array FSIS serves on some
  // older records, where the notice text is the only statement of the hazard.
  return reasons.length === 0 && undeclaredAllergen ? 'allergen' : 'unknown';
}

/**
 * Every stated reason is a labeling failure. "Misbranding" and "Mislabeling"
 * are how an undeclared allergen is reported, so they describe no hazard of
 * their own; any other value in the array does, and keeps its category.
 */
function labelingOnly(reasons: string[]): boolean {
  return reasons.length > 0 && reasons.every((r) => r === 'Misbranding' || r === 'Mislabeling');
}

export function extractConsumerAction(summaryText: string): string | null {
  const matches = splitSentences(summaryText).filter((s) => CONSUMER_ACTION_PATTERN.test(s));
  if (matches.length === 0) return null;
  return joinSentences(matches.slice(0, 2));
}

/**
 * Illness statement per the three-way semantics (architecture Part 4):
 * verbatim report-status sentences only — never disease education, healthcare
 * advice, or discovery prose. null = the source is silent (unknown).
 */
export function extractIllnessStatement(summaryText: string): string | null {
  const report = classifyIllnessReport(summaryText);
  if (report.statements.length === 0) return null;
  return joinSentences(report.statements);
}

function parseGeography(states: string[]): Geography {
  const cleaned = states.map((s) => decodeEntities(s).trim()).filter((s) => s !== '');
  if (cleaned.length === 0) {
    return { scope: 'unknown', states: [], confidence: 'stated', sourceText: null };
  }
  const sourceText = cleaned.join(', ');
  if (cleaned.some((s) => s.toLowerCase() === 'nationwide')) {
    return { scope: 'nationwide', states: [], confidence: 'stated', sourceText };
  }
  return { scope: 'states', states: [...cleaned].sort(), confidence: 'stated', sourceText };
}

/** Firm name from structured establishment field, else the title's leading clause. */
function parseFirm(raw: FsisRawRecord): { displayName: string | null; rawVariants: string[] } {
  const variants = [
    ...new Set(
      (raw.field_establishment ?? []).map((e) => decodeEntities(e).trim()).filter((e) => e !== ''),
    ),
  ];
  // Titles carry dirty leading whitespace (verified live: " FSIS Issues…"),
  // so trim BEFORE the agency-prefix guard — the agency is never the firm.
  const title = decodeEntities(raw.field_title ?? '').trim();
  const titleMatch = title.match(/^(.{3,80}?)\s+(?:Recalls|Expands|Issues)\b/);
  const candidate = titleMatch ? titleMatch[1].trim() : null;
  const titleFirm = candidate && !/^(FSIS|USDA)\b/i.test(candidate) ? candidate : null;
  if (titleFirm && !variants.includes(titleFirm)) variants.push(titleFirm);
  return { displayName: variants[0] ?? null, rawVariants: variants };
}

export function parseFsisRecord(raw: FsisRawRecord): NormalizedSourceRecord {
  const rawNumber = typeof raw.field_recall_number === 'string' ? raw.field_recall_number : null;
  if (!rawNumber || rawNumber.trim() === '') {
    throw new FsisParseError('record has no field_recall_number', rawNumber);
  }
  const { nativeId, baseId } = splitRecallNumber(rawNumber);

  const publishedAt = emptyToNull(raw.field_recall_date);
  if (!publishedAt || !/^\d{4}-\d{2}-\d{2}$/.test(publishedAt)) {
    throw new FsisParseError(`record ${nativeId} has no parseable field_recall_date`, rawNumber);
  }

  const officialUrlRaw = emptyToNull(raw.field_recall_url);
  if (!officialUrlRaw) {
    throw new FsisParseError(`record ${nativeId} has no field_recall_url`, rawNumber);
  }
  const officialUrl = officialUrlRaw.replace(/^http:\/\//, 'https://');

  const recallType = (raw.field_recall_type ?? '').trim();
  const noticeType =
    recallType === 'Public Health Alert' || nativeId.startsWith('PHA')
      ? 'public_health_alert'
      : 'recall';

  const title = decodeEntities(raw.field_title ?? '').trim();
  const summaryHtml = emptyToNull(raw.field_summary ?? '');
  const summaryText = summaryHtml ? stripHtml(summaryHtml) : '';
  const isRetractionNotice = /\bretract/i.test(title);

  // Lifecycle from field_recall_type only — field_active_notice is verified
  // unreliable (§4.1, §9.6) and must never be consulted.
  const lifecycle = isRetractionNotice
    ? 'retracted'
    : recallType === 'Closed Recall'
      ? 'closed'
      : 'active';

  const retractsNativeIds = isRetractionNotice
    ? [
        ...new Set(
          Array.from((title + ' ' + summaryText).matchAll(/PHA-\d{6,9}(?:-\d{1,2})?/gi))
            .map((m) => m[0].toUpperCase())
            .filter((id) => id !== nativeId),
        ),
      ]
    : [];

  const rawClassification = (raw.field_recall_classification ?? '').trim();
  const classificationValue =
    rawClassification === 'Class I'
      ? 'class_I'
      : rawClassification === 'Class II'
        ? 'class_II'
        : rawClassification === 'Class III'
          ? 'class_III'
          : noticeType === 'public_health_alert'
            ? 'not_applicable_pha'
            : 'not_yet_classified';

  const reasons = (raw.field_recall_reason ?? []).map((r) => r.trim()).filter((r) => r !== '');
  const hazardText = `${title}\n${summaryText}`;

  return {
    sourceSystem: 'fsis_api',
    sourceAgency: 'FSIS',
    nativeId,
    rawNativeId: rawNumber,
    noticeType,
    lifecycle,
    closedYear: emptyToNull(raw.field_closed_year),
    classification: {
      value: classificationValue,
      sourceText: emptyToNull(raw.field_risk_level) ?? emptyToNull(rawClassification),
    },
    expansionOfNativeId: baseId,
    isRetractionNotice,
    retractsNativeIds,
    title,
    summaryText,
    summaryHtml,
    reasonText: reasons.length > 0 ? reasons.join(', ') : null,
    hazardCategory: deriveHazardCategory(reasons, hazardText),
    pathogenOrAllergen: extractPathogenOrAllergen(hazardText),
    firmDisplayName: parseFirm(raw).displayName,
    firmRawVariants: parseFirm(raw).rawVariants,
    geography: parseGeography(raw.field_states ?? []),
    productLines: (raw.field_product_items ?? [])
      .map((line) => decodeEntities(line).trim())
      .filter((line) => line !== ''),
    quantityText: emptyToNull(raw.field_qty_recovered ?? ''),
    illnessStatement: extractIllnessStatement(summaryText),
    consumerAction: extractConsumerAction(summaryText),
    contactText: emptyToNull(asText(raw.field_company_media_contact).replace(/\s+/g, ' ')),
    officialUrl,
    publishedAt,
    lastModifiedAt: emptyToNull(raw.field_last_modified_date ?? ''),
  };
}
