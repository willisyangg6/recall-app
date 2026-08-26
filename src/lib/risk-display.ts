/**
 * How the two risk layers are worded for consumers.
 *
 * One pure function builds everything both screens show, so Home and Recall
 * Detail can never disagree about a recall's risk, and the wording is testable
 * as a golden without a renderer.
 *
 *   PRIMARY   — the consumer tier (Critical / High / Moderate / Low / Minimal,
 *               plus Pending). Leads the card and the detail screen.
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

const TIER_WORD: Record<ConsumerRiskTier, string> = {
  critical: 'Critical',
  high: 'High',
  moderate: 'Moderate',
  low: 'Low',
  minimal: 'Minimal',
  pending: 'Pending',
  unrated: 'Not rated',
};

/**
 * Consumer explanation per tier. "Minimal" never implies safe — this is still
 * an active recall, and the copy says so.
 */
const TIER_NOTE: Record<ConsumerRiskTier, string | null> = {
  critical: 'Every affected product carries the agency’s most serious recall classification.',
  high: 'Affected products carry different official classifications, including the most serious one.',
  moderate: 'The agency placed this recall in its middle classification.',
  low: 'The affected products carry the agency’s two lower classifications — this is still an active recall.',
  minimal: 'Lower relative risk within recalled products — this is still an active recall.',
  pending: 'The agency assigns a formal recall classification later in its process.',
  unrated: null,
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
  const rated = tier !== 'pending' && tier !== 'unrated';

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
        ? {
            heading: `Official ${agency} classification`,
            text: 'Not yet assigned',
            note: TIER_NOTE.pending,
          }
        : {
            heading: `Official ${agency} classification${status === 'mixed' ? 's' : ''}`,
            text: officialClassListText(classes),
            note:
              status === 'mixed'
                ? `${agency} assigned different classifications to different affected products.`
                : null,
          };

  return {
    tier,
    // A fresh FDA recall is Pending for weeks by design; badging every such
    // card reads as unfinished data rather than as information. The pending
    // state stays truthful and visible on the detail screen.
    badgeLabel: rated ? TIER_WORD[tier].toUpperCase() : null,
    headlineLabel:
      tier === 'unrated' ? null : rated ? `${TIER_WORD[tier].toUpperCase()} RISK` : 'RISK PENDING',
    accessibilityLabel: rated
      ? `Risk level: ${TIER_WORD[tier]}`
      : tier === 'pending'
        ? 'Risk level: pending'
        : 'Risk level: not rated',
    note: TIER_NOTE[tier],
    official,
  };
}
