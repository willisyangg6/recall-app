/**
 * Alerts for approved retailer-only notices (docs/recall-push-delivery.md,
 * "Retailer-only notices"). Pure: no I/O, so every rule is provable in Node.
 *
 * One rule set, shared with agency recalls:
 *
 * - **Who:** the push seam's `pushEligible` over `retailerRelevanceInput` —
 *   the same verdict the app's Affects you renders for the notice.
 * - **When:** an `initial` event at approval, exactly once per notice (dedup
 *   `retailer_notice:<id>`); a notice whose letter is older than the agency
 *   backfill horizon (30 days) is ledgered but suppressed `backfill`, so
 *   publishing old intake never alerts anyone.
 * - **Updates:** a re-approved revised letter is diffed by the SAME
 *   `detectChanges` over the same projection shape, so only a genuine
 *   material expansion (products, geography, illness, instructions) becomes
 *   an update — coalesced to one per notice per 24 h, as for agency cases.
 * - **Same recall:** the retailer monitor's own matcher (`agencyCandidates`)
 *   decides whether an agency case is the same recall, so one recall gets
 *   one card and one new-recall alert.
 */

import { detectChanges } from '../../domain/material-change';
import type { AgencyCaseView, RetailerIndexEntry } from './types';
import type { CaseProjection, NotificationSuppression } from '../../domain/recall-types';
import { deriveIllnessStatus } from '../../domain/illness-status';
import type { RetailerNoticeFields } from '../../lib/retailer-notice-fields';
import { geographyOf, retailerRelevanceInput } from '../../lib/retailer-notice-presentation';
import { agencyCandidates } from './decide';

/** The agency backfill horizon (pipeline.ts `backfillHorizonDays`), shared. */
export const RETAILER_BACKFILL_HORIZON_DAYS = 30;
/** One deliverable material update per notice per 24 h, as for agency cases. */
export const RETAILER_UPDATE_COALESCE_HOURS = 24;
/**
 * The first app version that can show a retailer notice and open its alert
 * (lib/push-payload.ts `retailer_notice`). Older installed builds (1.0.0,
 * 1.1.0) cannot, so they never receive one.
 */
export const RETAILER_ALERTS_MIN_APP_VERSION = '1.2.0';

/** What an alert needs to know about an approved notice. */
export interface RetailerNoticeSubject {
  noticeId: string;
  documentUrl: string;
  statedNoticeDate: string;
  fields: RetailerNoticeFields;
}

/**
 * The notice as a `CaseProjection`, so the SAME relevance input, material-
 * change rules and alert copy apply. Nothing here is stored: it is rebuilt
 * from the CURRENT approved fields whenever it is needed. `sourceAgency` is
 * a required field of the shape only; alert copy names the retailer through
 * `retailerAttribution`, never an agency.
 */
export function retailerCaseProjection(subject: RetailerNoticeSubject): CaseProjection {
  const { fields } = subject;
  const relevance = retailerRelevanceInput(subject);
  const identifiers = Object.values(fields.packageChecks).flat();
  const illness = deriveIllnessStatus(fields.whatHappened);
  return {
    sourceAgency: 'FDA',
    noticeType: 'recall',
    state: 'active',
    closedYear: null,
    classification: { value: 'not_yet_classified', sourceText: null },
    title: fields.productName,
    summaryText: fields.whatHappened,
    summaryHtml: null,
    reasonText: relevance.reasonText,
    hazardCategory: relevance.hazardCategory as CaseProjection['hazardCategory'],
    pathogenOrAllergen: relevance.pathogenOrAllergen,
    recallingFirm: { displayName: fields.firmName, rawVariants: [fields.firmName] },
    brands: [],
    productDescription: fields.productName,
    retailerNames: relevance.retailerNames,
    heroImageUrl: null,
    geography: geographyOf(fields),
    // One product line: the approved name, size and every printed identifier,
    // so a revised letter that adds a product or a code is a product-line
    // change to the shared `expansion_products` rule.
    affectedProducts: [
      {
        sourceNativeId: subject.noticeId,
        name: fields.productName,
        rawText: [fields.productName, fields.size, ...identifiers].filter(Boolean).join(' | '),
        extractionConfidence: 'stated',
      },
    ],
    quantityText: null,
    illnessStatement: null,
    reportsIllness: illness.kind === 'reported_count' || illness.kind === 'reported_unspecified',
    consumerAction: fields.instructions.length > 0 ? fields.instructions.join(' ') : null,
    contactText: fields.contact,
    officialUrl: subject.documentUrl,
    otherOfficialUrls: [],
    sourceIdentifiers: [],
    publishedAt: subject.statedNoticeDate,
    lastPublicActivityAt: subject.statedNoticeDate,
  };
}

/** Who "announced this" in alert copy: the publishing retailer, never an agency. */
export function retailerAttribution(fields: Pick<RetailerNoticeFields, 'retailer'>): string {
  return fields.retailer;
}

/** A ledger row to write for a notice (the retailer half of NotificationEventInput). */
export interface RetailerNoticeEventInput {
  retailerNoticeId: string;
  kind: 'initial' | 'material_update';
  triggerRuleId: string;
  dedupKey: string;
  materialChangeRef: string | null;
  payloadSummary: string;
  suppressed: NotificationSuppression | null;
  createdAt: string;
}

/** A ledgered event, as the plan reads its history. */
export interface LedgeredNoticeEvent {
  kind: 'initial' | 'material_update';
  suppressed: NotificationSuppression | null;
  createdAt: string;
}

function daysOld(dateIso: string, now: Date): number {
  return (now.getTime() - Date.parse(`${dateIso.slice(0, 10)}T00:00:00Z`)) / 86_400_000;
}

/**
 * The events an approval writes. `previous` is the fields of the approval it
 * supersedes (a revised letter), or null for a first approval. Nothing is
 * written for a re-approval that changes nothing material.
 */
export function planRetailerNoticeEvents(input: {
  subject: RetailerNoticeSubject;
  previous: RetailerNoticeSubject | null;
  history: LedgeredNoticeEvent[];
  now: Date;
}): RetailerNoticeEventInput[] {
  const { subject, previous, history, now } = input;
  const createdAt = now.toISOString();
  const backfill = daysOld(subject.statedNoticeDate, now) > RETAILER_BACKFILL_HORIZON_DAYS;
  const id = subject.noticeId;

  // Exactly one initial per notice, ever: a withdrawal and re-approval is the
  // same recall, never a second "new recall" alert.
  if (!history.some((event) => event.kind === 'initial')) {
    return [
      {
        retailerNoticeId: id,
        kind: 'initial',
        triggerRuleId: 'new_retailer_notice',
        dedupKey: `retailer_notice:${id}`,
        materialChangeRef: null,
        payloadSummary: subject.fields.productName,
        suppressed: backfill ? 'backfill' : null,
        createdAt,
      },
    ];
  }
  if (previous === null) return [];

  const { material } = detectChanges(
    retailerCaseProjection(previous),
    retailerCaseProjection(subject),
  );
  const since = now.getTime() - RETAILER_UPDATE_COALESCE_HOURS * 3_600_000;
  let recentDeliverable = history.filter(
    (event) =>
      event.kind === 'material_update' &&
      event.suppressed === null &&
      Date.parse(event.createdAt) >= since,
  ).length;
  return material.map((change) => {
    const coalesce = !backfill && change.ruleId !== 'retraction' && recentDeliverable > 0;
    const suppressed: NotificationSuppression | null = backfill
      ? 'backfill'
      : coalesce
        ? 'coalesced'
        : null;
    if (suppressed === null) recentDeliverable += 1;
    return {
      retailerNoticeId: id,
      kind: 'material_update' as const,
      triggerRuleId: change.ruleId,
      dedupKey: `retailer_notice:${id}:${change.ruleId}:${change.fingerprint}`,
      materialChangeRef: change.fingerprint,
      payloadSummary: change.summary,
      suppressed,
      createdAt,
    };
  });
}

/** What the retailer monitor matched the notice on, as archived with its letter. */
export interface RetailerMatchEvidence {
  indexEntry: RetailerIndexEntry;
  statedNoticeDate: string;
  /** The letter's extracted text. */
  text: string;
}

/**
 * The agency cases that are the SAME recall as this notice, by the retailer
 * monitor's own matcher (`agencyCandidates`, decide.ts) — never a second rule.
 */
export function sameRecallAgencyCases(
  evidence: RetailerMatchEvidence,
  cases: readonly AgencyCaseView[],
): AgencyCaseView[] {
  return agencyCandidates(
    evidence.indexEntry,
    { statedNoticeDate: evidence.statedNoticeDate } as Parameters<typeof agencyCandidates>[1],
    evidence.text,
    cases,
  );
}

/** Semantic-version order on "major.minor.patch"; malformed sorts lowest. */
export function appVersionAtLeast(version: string | null | undefined, minimum: string): boolean {
  const parse = (value: string) => {
    const parts = /^(\d+)\.(\d+)\.(\d+)/.exec(value);
    return parts ? parts.slice(1, 4).map(Number) : null;
  };
  const have = version ? parse(version) : null;
  const need = parse(minimum);
  if (!have || !need) return false;
  for (let i = 0; i < 3; i++) {
    if (have[i] !== need[i]) return have[i] > need[i];
  }
  return true;
}
