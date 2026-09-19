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

import type { Classification, NoticeType, SourceAgency } from '@/domain/recall-types';
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
  /**
   * Home/Saved card badge ("HIGH"), or null when this notice carries no risk
   * label at all — see `riskLabelSuppressed`. A surface renders the badge iff
   * this is non-null and renders NOTHING otherwise: no wrapper, no spacer, no
   * accessibility node.
   */
  badgeLabel: string | null;
  /**
   * Detail label ("HIGH") — the same canonical word as `badgeLabel` (founder
   * decision, 2026-09-14: the visible label is exactly the tier word on every
   * surface; the former " RISK" suffix is retired). Kept as its own field so
   * the two surfaces stay independently addressable. Null in exactly the same
   * cases as `badgeLabel`, from the same one rule, so Detail cannot show a
   * label the cards hide.
   */
  headlineLabel: string | null;
  /**
   * Spoken label — risk is never communicated by color alone. Rendered ONLY
   * as the label's own accessibility label, so a suppressed label speaks
   * nothing: with no `badgeLabel`/`headlineLabel` there is no node to carry
   * it, and the tier is never announced from anywhere else.
   */
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
    'The affected products carry the agency’s two lower classifications. This is still an active recall.',
  low: 'The affected products carry only the agency’s least serious classification. This is still an active recall.',
  pending: 'The agency assigns a formal recall classification later in its process.',
  unknown: null,
};

export function agencyLabel(sourceAgency: SourceAgency): string {
  return sourceAgency === 'FSIS' ? 'USDA FSIS' : 'FDA';
}

export function riskTierWord(tier: ConsumerRiskTier): string {
  return TIER_WORD[tier];
}

/**
 * The one consumer label for a tier as the Risk Label renders and speaks it
 * (P2B6B): the canonical word uppercased, and the spoken `Risk level: …`.
 * `riskView` reads it for the badge and the headline, and the Risk Levels
 * document reads it for its label rows, so a surface that shows a tier
 * without a classification in hand still shows exactly the product's label.
 */
export function riskTierLabel(tier: ConsumerRiskTier): {
  text: string;
  accessibilityLabel: string;
} {
  const word = TIER_WORD[tier];
  return { text: word.toUpperCase(), accessibilityLabel: `Risk level: ${word}` };
}

/**
 * THE one rule for whether a notice shows a risk label at all (P2B7N).
 *
 * An FSIS Public Health Alert never receives a recall classification — not
 * yet, not ever. `consumerRiskTier` therefore lands it on `unknown`, which is
 * the honest DOMAIN answer and stays exactly as it is in storage, in search,
 * in filtering and in sorting. As a BADGE, though, `UNKNOWN` beside
 * `PUBLIC HEALTH ALERT` reads as a missing value — as though the app had
 * failed to parse something — when in truth the alert is complete and
 * correctly processed. The notice label already states what the notice is, so
 * the risk label beside it carries no information and costs credibility.
 *
 * Suppression is deliberately narrow, and needs BOTH halves:
 *
 *  - the notice type is a public health alert, and
 *  - the derived tier is `unknown`.
 *
 * So a genuinely unclassifiable RECALL still reads `UNKNOWN` — that absence is
 * real information about a recall that should have had a class — and a PHA
 * that ever arrives carrying an official class would badge that class rather
 * than have it silently discarded. Nothing here is a data rewrite: this
 * function decides visibility and nothing else.
 *
 * It is called from exactly one place (`riskView`), so Feed, Saved and Detail
 * all inherit it through the shared presentation contract and no surface
 * re-decides it. `server/risk-label-visibility.test.ts` pins that: the rule
 * has exactly one caller in the shipped app, and no screen may spell the
 * notice-type check itself.
 */
export function riskLabelSuppressed(noticeType: NoticeType, tier: ConsumerRiskTier): boolean {
  return noticeType === 'public_health_alert' && tier === 'unknown';
}

export function riskView(
  classification: Classification,
  sourceAgency: SourceAgency,
  noticeType: NoticeType,
): RiskView {
  const tier = consumerRiskTier(classification);
  const classes = officialClassesOf(classification);
  const status = classificationStatus(classification);
  const agency = agencyLabel(sourceAgency);

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

  // Every tier carries ONE consumer label, identical on both surfaces: the
  // canonical word, uppercased, and nothing else. The " RISK" suffix the five
  // severities used to take on Detail is retired (founder decision,
  // 2026-09-14) so the label set is exactly the seven words everywhere — a
  // label can never be spelled one way on the feed and another on Detail.
  //
  // Pending and Unknown were never suffixed (the P2a rule): a suffix would
  // present an absent classification as a level of risk. They remain
  // first-class members of the one label set, spelled and styled exactly like
  // the five severities.
  //
  // A Public Health Alert's `unknown` is the one absence that is not worth
  // badging (P2B7N): `riskLabelSuppressed` drops the label — on both surfaces
  // at once, from this one decision — and the notice label speaks for the
  // notice. The tier, the note and the official block below are untouched, so
  // Detail still states "Not assigned · Public health alerts do not receive a
  // formal classification" exactly where that belongs.
  const label = riskTierLabel(tier);
  const suppressed = riskLabelSuppressed(noticeType, tier);
  return {
    tier,
    badgeLabel: suppressed ? null : label.text,
    headlineLabel: suppressed ? null : label.text,
    accessibilityLabel: label.accessibilityLabel,
    note: TIER_NOTE[tier],
    official,
  };
}
