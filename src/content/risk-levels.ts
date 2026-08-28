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
import { riskTierWord } from '@/lib/risk-display';
import type { ConsumerRiskTier } from '@/domain/risk-tier';
import { bullets, paragraph, type TrustDocument } from './document-model';

/** The five severity levels, canonical order — everything before the non-scale states. */
export const SEVERITY_TIERS: ConsumerRiskTier[] = RISK_FILTER_TIERS.filter(
  (tier) => tier !== 'pending' && tier !== 'unrated',
);
/** The two uncertainty states, canonical order. */
export const UNCERTAINTY_TIERS: ConsumerRiskTier[] = RISK_FILTER_TIERS.filter(
  (tier) => tier === 'pending' || tier === 'unrated',
);

/** One consumer meaning per severity level, restating consumerRiskTier. */
const SEVERITY_MEANING: Record<string, string> = {
  critical: 'every affected product carries the agency’s most serious recall classification.',
  high: 'affected products carry different official classifications, including the most serious one.',
  moderate: 'the agency placed this recall in its middle classification.',
  low: 'the affected products carry the agency’s two lower classifications — this is still an active recall.',
  minimal:
    'the affected products carry only the agency’s least serious classification — this is still an active recall.',
};

const UNCERTAINTY_MEANING: Record<string, string> = {
  pending:
    'the agency has not assigned an official classification yet. FDA recalls are routinely announced weeks before their classification arrives, so Pending is the normal early state of a fresh FDA recall — it says “not decided yet,” never “low risk.”',
  unrated:
    'no official classification is ever expected for this notice. Public health alerts do not receive one, so Recall says so instead of inventing a level — Not rated is not a level of risk, and it does not mean low risk.',
};

export const RISK_LEVELS: TrustDocument = {
  slug: 'risk-levels',
  title: 'Risk Levels Explained',
  summary: 'Recall’s five consumer risk levels, and the two states that are not levels.',
  sections: [
    {
      title: null,
      blocks: [
        paragraph(
          'Every recall carries two layers of risk information. The official layer is the ' +
            'classification the agency itself assigns — Class I, Class II, or Class III — preserved ' +
            'exactly as assigned and shown on each recall’s detail screen. The consumer layer is ' +
            'Recall’s own plain-language risk level, derived from the official classifications and ' +
            'nothing else.',
        ),
      ],
    },
    {
      title: 'The five risk levels',
      blocks: [
        bullets(SEVERITY_TIERS.map((tier) => `${riskTierWord(tier)} — ${SEVERITY_MEANING[tier]}`)),
        paragraph(
          'A single recall can cover products the agency classified differently; the level reflects ' +
            'the whole set of official classifications, and the individual classes stay visible on ' +
            'the detail screen. No level — including the lowest — ever means a recalled product is ' +
            'safe to use.',
        ),
      ],
    },
    {
      title: 'Two states that are not risk levels',
      blocks: [
        paragraph(
          'Recall also shows two states that describe missing classification, not severity. They ' +
            'are not additional severity levels, and neither means low risk.',
        ),
        bullets(
          UNCERTAINTY_TIERS.map((tier) => `${riskTierWord(tier)} — ${UNCERTAINTY_MEANING[tier]}`),
        ),
      ],
    },
    {
      title: 'Where the levels come from',
      blocks: [
        bullets([
          'The FDA and USDA FSIS classify recalls as Class I (reasonable probability of serious health consequences or death), Class II (may cause temporary or medically reversible health consequences), or Class III (not likely to cause health consequences).',
          'Recall’s level is a deterministic translation of the official class set — the same classes always produce the same level. It is never guessed from headlines, hazard wording, or illness counts, and it is never an independent judgment about a recall.',
          'Recall’s consumer level does not replace the official agency classification. The official classification is always preserved and shown on the recall’s detail screen, and the official notice controls in any conflict.',
        ]),
      ],
    },
    {
      title: 'When classifications change',
      blocks: [
        paragraph(
          'Classifications arrive and change on the agency’s schedule. When an official ' +
            'classification is assigned, raised, lowered, or otherwise changed, that is a material ' +
            'change to the notice: the case is updated, the change is recorded on its timeline, and ' +
            'the consumer risk level moves with it.',
        ),
      ],
    },
  ],
};
