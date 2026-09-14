/**
 * How the two risk layers are worded for consumers.
 *
 * One pure function builds everything both screens show, so Home and Recall
 * Detail can never disagree about a recall's risk, and the wording is testable
 * as a golden without a renderer.
 *
 *   PRIMARY   — the consumer tier (Critical / Very High / High / Moderate /
 *               Low, plus Pending and Unknown). Leads the card and the detail
 *               screen.
 *   SECONDARY — the official agency classification (Class I / II / III),
 *               preserved exactly, shown deeper in the detail screen.
 *
 * "Class I · High risk" is gone on purpose: it presented a regulatory class as
 * if it were the consumer tier, which is exactly the conflation this split
 * exists to end.
 *
 * Nothing here exposes matcher confidence, scores, event ids, recall numbers,
 * or match evidence — that provenance is internal.
 */

import type { Classification, SourceAgency } from '@/domain/recall-types';
import {
  classificationStatus,
  consumerRiskTier,
  officialClassesOf,
  officialClassListText,
  type ConsumerRiskTier,
} from '@/domain/risk-tier';

export interface OfficialClassificationView {
  /** "Official FDA classification" / "…classifications" when the set is mixed. */
  heading: string;
  /** "Class I", "Class I and Class II", "Not yet assigned". */
  text: string;
  /** Why a case carries several classes, or why it carries none yet. */
  note: string | null;
}

export interface RiskView {
  tier: ConsumerRiskTier;
  /** Home card badge ("HIGH"); null when there is no rated tier to badge. */
  badgeLabel: string | null;
  /** Detail headline ("HIGH RISK"); null only when no rating is ever expected. */
  headlineLabel: string | null;
  /** Spoken label — risk is never communicated by color alone. */
  accessibilityLabel: string;
  /** One consumer sentence about what the tier means. */
  note: string | null;
  official: OfficialClassificationView | null;
}

/**
 * THE seven consumer risk labels, in their canonical casing. This record is
 * the single source of the words: every surface — badges, the detail
 * headline, spoken labels, the Risk sheet, the trust documents, push copy —
 * reads them from here, so no screen can invent an eighth label or a second
 * spelling of one. Screens may restyle the casing (the badge shouts, as it
 * always has); they never rewrite the word.
 */
const TIER_WORD: Record<ConsumerRiskTier, string> = {
  critical: 'Critical',
  very_high: 'Very High',
  high: 'High',
  moderate: 'Moderate',
  low: 'Low',
  pending: 'Pending',
  unknown: 'Unknown',
};

/**
 * Consumer explanation per tier. The lowest level never implies safe — this is
 * still an active recall, and the copy says so.
 */
const TIER_NOTE: Record<ConsumerRiskTier, string | null> = {
  critical: 'Every affected product carries the agency’s most serious recall classification.',
  very_high:
    'Affected products carry different official classifications, including the most serious one.',
  high: 'The agency placed this recall in its middle classification.',
  moderate:
    'The affected products carry the agency’s two lower classifications — this is still an active recall.',
  low: 'The affected products carry only the agency’s least serious classification — this is still an active recall.',
  pending: 'The agency assigns a formal recall classification later in its process.',
  unknown: null,
};

export function agencyLabel(sourceAgency: SourceAgency): string {
  return sourceAgency === 'FSIS' ? 'USDA FSIS' : 'FDA';
}

export function riskTierWord(tier: ConsumerRiskTier): string {
  return TIER_WORD[tier];
}

export function riskView(classification: Classification, sourceAgency: SourceAgency): RiskView {
  const tier = consumerRiskTier(classification);
  const classes = officialClassesOf(classification);
  const status = classificationStatus(classification);
  const agency = agencyLabel(sourceAgency);
  const rated = tier !== 'pending' && tier !== 'unknown';

  const official: OfficialClassificationView | null =
    status === 'not_applicable'
      ? {
          // A public health alert genuinely has no class. Saying so is honest;
          // "Pending" would promise a classification that never arrives.
          heading: `Official ${agency} classification`,
          text: 'Not assigned',
          note: 'Public health alerts do not receive a formal classification.',
        }
      : status === 'pending'
        ? // The top risk state already says "PENDING" and carries its one
          // explanation; a second "Not yet assigned" block restated the same
          // fact near the bottom and is deliberately gone (P2a).
          null
        : {
            heading: `Official ${agency} classification${status === 'mixed' ? 's' : ''}`,
            text: officialClassListText(classes),
            note:
              status === 'mixed'
                ? `${agency} assigned different classifications to different affected products.`
                : null,
          };

  // The two non-scale states carry ONE shared consumer label on both surfaces
  // (the P2a rule, kept): they read as their own word alone — never with a
  // " RISK" suffix, which would present an absent classification as a level of
  // risk, and never labeled on one screen while silently unbadged on the
  // other.
  //
  // The retired wording ("Risk pending" / "Not rated") is gone: Pending and
  // Unknown are first-class members of the one label set now, so they are
  // spelled and styled exactly like the five severities.
  const word = TIER_WORD[tier];
  return {
    tier,
    badgeLabel: word.toUpperCase(),
    headlineLabel: rated ? `${word.toUpperCase()} RISK` : word.toUpperCase(),
    accessibilityLabel: `Risk level: ${word}`,
    note: TIER_NOTE[tier],
    official,
  };
}
