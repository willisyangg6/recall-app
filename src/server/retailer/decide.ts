/**
 * Match a parsed retailer notice against agency cases and decide what it is.
 *
 * Pure and deterministic. The decision is a PROPOSAL stored on the private
 * retailer_notices row: in this slice nothing here creates a case, links a
 * source record, changes a projection, or writes a notification event.
 *
 * Precedence (first rule that fires wins; flags never decide):
 *
 *   unreadable / scanned document ............ review
 *   not food ................................. excluded
 *   food status unclear ...................... review
 *   quality notice (letter says safe) ........ excluded
 *   notice kind unclear ...................... review
 *   no stated date ........................... review   (no window can be applied)
 *   0 agency candidates ...................... new_candidate
 *   2+ agency candidates ..................... review
 *   1 candidate, codes/states conflict ....... review
 *   1 candidate, consistent .................. link_candidate
 *
 * Matching is linking-as-enrichment (architecture Part 6.1): a missed match
 * costs a duplicate, never a hidden recall. A candidate needs the agency
 * case's firm or brand named in the notice AND a shared product word, inside
 * ±45 days of the notice's stated date. Retailer-owned names (Costco,
 * Kirkland Signature) appear in every Costco letter, so they need two shared
 * product words.
 */

import { normalizeFirmName } from '../duplicates';

import { codeDatesIn, normalizeSizeToken } from './letter';
import type {
  AgencyCaseView,
  DecisionReason,
  NoticeDecisionResult,
  PackageClaim,
  ParsedNotice,
  RetailerIndexEntry,
} from './types';

export const MATCH_WINDOW_DAYS = 45;

/**
 * The earliest stated date the agency corpus can answer for. FDA keeps
 * company announcements online for three years, and Lotly's corpus holds 56
 * from 2023 against 234 from 2024 (measured 2026-11-16). An older notice with
 * no match may be an agency recall Lotly never ingested, so it is never
 * proposed as standalone.
 */
export const AGENCY_COVERAGE_FROM = '2024-01-01';

const RETAILER_OWNED_NAMES = new Set([
  'costco',
  'costco wholesale',
  'kirkland',
  'kirkland signature',
  'aldi',
  'aldi inc',
  'h e b',
  'heb',
]);

const PRODUCT_STOPWORDS = new Set([
  'item',
  'items',
  'select',
  'locations',
  'location',
  'only',
  'regions',
  'region',
  'states',
  'midwest',
  'southeast',
  'northeast',
  'northwest',
  'southwest',
  'notice',
  'recall',
  'recalls',
  'products',
  'product',
  'multiple',
  'with',
  'from',
  'that',
  'this',
  'their',
  'organic',
  'signature',
  'kirkland',
  'costco',
  'aldi',
  // Headline boilerplate ALDI and agency titles share ("… Because of
  // Possible Health Risk"): never product evidence.
  'because',
  'possible',
  'health',
  'risk',
  'voluntarily',
  'recalling',
  'potential',
  'contamination',
  'undeclared',
  'allergen',
  'allergens',
  'association',
  'hawaii',
  'style',
  'flavor',
  'original',
  'company',
]);

function productTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length >= 4 && !PRODUCT_STOPWORDS.has(token)),
  );
}

function daysBetween(laterIso: string, earlierIso: string): number {
  return Math.round(
    (Date.parse(`${laterIso.slice(0, 10)}T00:00:00Z`) -
      Date.parse(`${earlierIso.slice(0, 10)}T00:00:00Z`)) /
      86_400_000,
  );
}

/** Agency cases whose firm/brand the notice names and whose product it shares. */
export function agencyCandidates(
  entry: RetailerIndexEntry,
  parsed: ParsedNotice,
  noticeText: string,
  cases: readonly AgencyCaseView[],
): AgencyCaseView[] {
  const notice = ` ${normalizeFirmName(`${entry.indexTitle} ${noticeText}`)} `;
  const noticeProducts = productTokens(entry.indexTitle);
  return cases.filter((agencyCase) => {
    if (
      parsed.statedNoticeDate &&
      Math.abs(daysBetween(agencyCase.publishedAt, parsed.statedNoticeDate)) > MATCH_WINDOW_DAYS
    ) {
      return false;
    }
    const names = [agencyCase.firm, ...agencyCase.brands]
      .map((name) => normalizeFirmName(name))
      .filter((name) => name.length >= 4 && notice.includes(` ${name} `));
    if (names.length === 0) return false;
    const caseProducts = productTokens(`${agencyCase.title} ${agencyCase.text}`);
    const shared = [...noticeProducts].filter((token) => caseProducts.has(token)).length;
    const strong = names.some((name) => !RETAILER_OWNED_NAMES.has(name));
    return shared >= (strong ? 1 : 2);
  });
}

function sizeTokensIn(text: string): Set<string> {
  const pattern =
    /\b\d+(?:\.\d+)?\s?-?\s?(?:fl\.?\s?oz|oz|lbs?|kg|g|ml|l|ct|count|pk|pack)\b(?!\w)/gi;
  return new Set((text.match(pattern) ?? []).map(normalizeSizeToken));
}

/** Check each package claim against the agency notice. Evidence, never identity. */
export function verifyPackageClaims(
  claims: readonly PackageClaim[],
  agencyText: string,
): PackageClaim[] {
  const printed = sizeTokensIn(agencyText);
  return claims.map((claim) => {
    const unverified = claim.sizeTokens.filter((token) => !printed.has(normalizeSizeToken(token)));
    return {
      ...claim,
      verifiedInAgencyNotice: unverified.length === 0,
      unverifiedSizeTokens: unverified,
    };
  });
}

export interface DecisionOutput {
  result: NoticeDecisionResult;
  packageClaims: PackageClaim[];
}

export function decideNotice(
  entry: RetailerIndexEntry,
  parsed: ParsedNotice,
  noticeText: string,
  cases: readonly AgencyCaseView[],
): DecisionOutput {
  const decided = (
    decision: NoticeDecisionResult['decision'],
    reasons: DecisionReason[],
    extra: Partial<NoticeDecisionResult> = {},
    packageClaims: PackageClaim[] = parsed.packageClaims,
  ): DecisionOutput => ({
    result: {
      decision,
      reasons,
      linkCaseId: null,
      candidateCaseIds: [],
      agencyLagDays: null,
      ...extra,
    },
    packageClaims,
  });

  if (parsed.extraction === 'failed') return decided('review', ['document_unreadable']);
  const candidates = agencyCandidates(entry, parsed, noticeText, cases);
  const candidateCaseIds = candidates.map((agencyCase) => agencyCase.id);
  if (parsed.extraction === 'image_only') {
    return decided('review', ['scanned_document'], { candidateCaseIds });
  }
  if (parsed.foodStatus === 'non_food') return decided('excluded', ['non_food']);
  if (parsed.foodStatus === 'unclear')
    return decided('review', ['food_status_unclear'], { candidateCaseIds });
  if (parsed.noticeKind === 'quality_notice')
    return decided('excluded', ['quality_notice_not_recall']);
  if (parsed.noticeKind === 'unclear')
    return decided('review', ['notice_kind_unclear'], { candidateCaseIds });
  if (!parsed.statedNoticeDate) return decided('review', ['undated'], { candidateCaseIds });

  if (candidates.length === 0) {
    return parsed.statedNoticeDate < AGENCY_COVERAGE_FROM
      ? decided('review', ['predates_agency_coverage'])
      : decided('new_candidate', ['no_agency_match']);
  }
  if (candidates.length > 1) {
    return decided('review', ['multiple_agency_candidates'], { candidateCaseIds });
  }

  const [agencyCase] = candidates;
  const agencyLagDays = daysBetween(agencyCase.publishedAt, parsed.statedNoticeDate);
  const packageClaims = verifyPackageClaims(parsed.packageClaims, agencyCase.text);
  const conflicts: DecisionReason[] = [];

  const retailerDates = codeDatesIn(parsed.codeEvidence.join(' '));
  const agencyDates = new Set(codeDatesIn(agencyCase.text));
  if (retailerDates.length > 0 && !retailerDates.some((date) => agencyDates.has(date))) {
    conflicts.push('codes_not_in_agency_notice');
  }
  if (
    agencyCase.geography.scope === 'states' &&
    parsed.stateClaims.some((claim) => !agencyCase.geography.states.includes(claim.state))
  ) {
    conflicts.push('retailer_states_outside_agency_scope');
  }

  const flags: DecisionReason[] = [];
  if (agencyLagDays > 0) flags.push('retailer_notice_dated_before_agency');
  if (packageClaims.some((claim) => claim.verifiedInAgencyNotice === false)) {
    flags.push('package_claim_unverified');
  }
  if (
    agencyCase.noticeType === 'public_health_alert' &&
    (parsed.noticeKind === 'recall' || /\brecall\b/i.test(entry.indexLabel ?? ''))
  ) {
    flags.push('retailer_label_differs_from_agency_status');
  }

  if (conflicts.length > 0) {
    return decided(
      'review',
      ['single_agency_match', ...conflicts, ...flags],
      { candidateCaseIds, agencyLagDays },
      packageClaims,
    );
  }
  return decided(
    'link_candidate',
    ['single_agency_match', ...flags],
    { linkCaseId: agencyCase.id, candidateCaseIds, agencyLagDays },
    packageClaims,
  );
}
