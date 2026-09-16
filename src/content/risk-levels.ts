/**
 * Risk Levels Explained — the consumer explanation of the two risk layers in
 * src/domain/risk-tier.ts and src/lib/risk-display.ts.
 *
 * The vocabulary is IMPORTED from the canonical implementation, never
 * retyped: the five severity words and the two non-scale states come from
 * riskTierWord over the canonical tier ordering, so this document cannot
 * drift into a second taxonomy. The per-level meanings restate the
 * deterministic class-set derivation in consumerRiskTier.
 */

import { RISK_FILTER_TIERS } from '@/lib/feed-filters';
import type { ConsumerRiskTier } from '@/domain/risk-tier';
import {
  bullets,
  note,
  paragraph,
  riskLevels,
  type RiskLevelItem,
  type TrustDocument,
} from './document-model';

/** The five severity levels, canonical order — everything before the non-scale states. */
export const SEVERITY_TIERS: ConsumerRiskTier[] = RISK_FILTER_TIERS.filter(
  (tier) => tier !== 'pending' && tier !== 'unknown',
);
/** The two uncertainty states, canonical order. */
export const UNCERTAINTY_TIERS: ConsumerRiskTier[] = RISK_FILTER_TIERS.filter(
  (tier) => tier === 'pending' || tier === 'unknown',
);

/**
 * One consumer meaning per severity level, restating consumerRiskTier. Each
 * is rendered beside the production Risk Label for its tier (P2B6B), so it
 * reads as a sentence of its own.
 */
const SEVERITY_MEANING: Record<string, string> = {
  critical: 'Every affected product carries the agency’s most serious recall classification.',
  very_high:
    'Affected products carry different official classifications, including the most serious one.',
  high: 'The agency placed this recall in its middle classification.',
  moderate:
    'The affected products carry the agency’s two lower classifications. This is still an active recall.',
  low: 'The affected products carry only the agency’s least serious classification. This is still an active recall.',
};

const UNCERTAINTY_MEANING: Record<string, string> = {
  pending:
    'The agency has not assigned an official classification yet. FDA recalls are routinely announced weeks before their classification arrives, so Pending is the normal early state of a fresh FDA recall. It means “not decided yet,” never “low risk.”',
  unknown:
    'Lotly cannot determine a supported official classification for this notice. Most often that is a Public Health Alert, which never receives a classification at all. Unknown describes missing classification information, not severity: it is not a level of risk, and it does not mean low risk. It is also never used for a recall whose classification is still on its way; that one is Pending.',
};

const rows = (tiers: ConsumerRiskTier[], meaning: Record<string, string>): RiskLevelItem[] =>
  tiers.map((tier) => ({ tier, meaning: meaning[tier] }));

export const RISK_LEVELS: TrustDocument = {
  slug: 'risk-levels',
  title: 'Risk Levels Explained',
  summary: 'Lotly’s five consumer risk levels, and the two states that are not levels.',
  sections: [
    {
      title: null,
      blocks: [
        paragraph(
          'Every recall carries two layers of risk information. The official layer is the ' +
            'classification the agency itself assigns (Class I, Class II, or Class III), preserved ' +
            'exactly as assigned and available through each recall’s official notice link. The consumer layer is ' +
            'Lotly’s own plain-language risk level, derived from the official classifications and ' +
            'nothing else.',
        ),
      ],
    },
    {
      title: 'The five risk levels',
      blocks: [
        riskLevels(rows(SEVERITY_TIERS, SEVERITY_MEANING)),
        note(
          'A single recall can cover products the agency classified differently; the level reflects ' +
            'the whole set of official classifications, and the individual classes stay preserved in ' +
            'the official notice. No level, including the lowest, ever means a recalled product is ' +
            'safe to use.',
        ),
      ],
    },
    {
      title: 'Two states that are not risk levels',
      blocks: [
        paragraph(
          'Lotly also shows two states that describe missing classification, not severity. They ' +
            'are not additional severity levels, and neither means low risk.',
        ),
        riskLevels(rows(UNCERTAINTY_TIERS, UNCERTAINTY_MEANING)),
      ],
    },
    {
      title: 'Where the levels come from',
      blocks: [
        bullets([
          'The FDA and USDA FSIS classify recalls as Class I (reasonable probability of serious health consequences or death), Class II (may cause temporary or medically reversible health consequences), or Class III (not likely to cause health consequences).',
          'Lotly’s level is a deterministic translation of the official class set: the same classes always produce the same level. It is never guessed from headlines, hazard wording, or illness counts, and it is never an independent judgment about a recall.',
          'Lotly’s consumer level does not replace the official agency classification. The official classification is always preserved, the official notice link on each recall leads to it, and the official notice controls in any conflict.',
        ]),
      ],
    },
    {
      title: 'When classifications change',
      blocks: [
        paragraph(
          'Classifications arrive and change on the agency’s schedule. When an official ' +
            'classification is assigned, raised, lowered, or otherwise changed, that is a material ' +
            'change to the notice: the case is updated, its Updated date reflects the change, and ' +
            'the consumer risk level moves with it.',
        ),
      ],
    },
  ],
};
