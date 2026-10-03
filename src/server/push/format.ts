/**
 * Deterministic push copy — one source-grounded formatter for every
 * notification the delivery worker sends. No LLM, no raw agency headlines:
 * the reason sentence is the card's own (`conciseReasonLine` +
 * `cardSummaryText`), and the product starts from the card's own name
 * (`cleanProductName`, minus the brand-prefix strip a brand-less notification
 * cannot afford), shortened for notifications only by
 * `notificationProductName` (./product-name.ts): deterministic, source-derived,
 * soft-limited to 55 characters. The full name stays on the recall it opens.
 *
 * Titles carry no regulatory jargon; consumer risk speaks the ConsumerRiskTier
 * language (Critical/Very High/High/Moderate/Low), read from the one label
 * record in lib/risk-display.ts so push copy can never spell a level
 * differently from the screen it opens. Official Class I/II/III stays on the
 * Recall Detail screen. A Pending- or Unknown-risk recall is announced from
 * its hazard facts without pretending a tier exists.
 *
 * Every body states only facts present in the case projection or the
 * material-change rule that fired — nothing is invented.
 */

import { cardSummaryText, conciseReasonLine } from '../../lib/recall-presentation';
import { agencyLabel, riskTierWord } from '../../lib/risk-display';
import { consumerRiskTier, classificationStatus } from '../../domain/risk-tier';
import { notificationProductName } from './product-name';
import type { DeliverableEvent, PushMessage } from './types';

export interface PushContent {
  title: string;
  body: string;
}

export function formatPushContent(event: DeliverableEvent): PushContent {
  const projection = event.projection;
  // One short product name for every event kind, rendered at delivery time,
  // never stored in the ledger; delivery stays dormant until push is
  // explicitly activated.
  const product = notificationProductName(projection);
  const agency = agencyLabel(projection.sourceAgency);

  if (event.kind === 'initial') {
    const title =
      projection.noticeType === 'public_health_alert'
        ? `Safety alert: ${product}`
        : `Recall alert: ${product}`;
    // THE shared reason sentence — the one `buildHomeCardModel` puts on the
    // Feed and Saved card, composed once in the presentation contract and
    // stripped of its trailing stop the same way (P2B7Q). Push used to build
    // its own from `recall-display.reasonLine`, which is on the project's
    // retired-formatter list: over the live active feed the two wordings
    // disagreed on 534 of 898 cases, including the certainty word — the card
    // said "Potential Listeria contamination" while the push said "Possible
    // Listeria monocytogenes contamination". A notification and the card it
    // opens now read the same words by construction.
    const reason = cardSummaryText(
      conciseReasonLine({
        reasonText: projection.reasonText,
        hazardCategory: projection.hazardCategory,
        pathogenOrAllergen: projection.pathogenOrAllergen,
        title: projection.title,
      }),
    );
    return {
      title,
      body: reason ? `${reason}. Check your package.` : 'Check your package for details.',
    };
  }

  const tier = consumerRiskTier(projection.classification);
  const tierWord = riskTierWord(tier);
  const rated = tier !== 'pending' && tier !== 'unknown';

  switch (event.triggerRuleId) {
    case 'classification_assigned':
      return {
        title: `Risk update: ${product}`,
        body: !rated
          ? 'The official classification of this recall changed.'
          : classificationStatus(projection.classification) === 'mixed'
            ? `${agency} assigned affected products different classifications. The overall risk level is ${tierWord}.`
            : `${agency} classified this recall as ${tierWord} risk.`,
      };
    case 'classification_upgraded':
      return {
        title: `Risk update: ${product}`,
        body: rated
          ? `${agency} raised this recall’s classification. Its risk level is now ${tierWord}.`
          : 'The official classification of this recall changed.',
      };
    case 'classification_downgraded':
      return {
        title: `Risk update: ${product}`,
        body: rated
          ? `${agency} lowered this recall’s classification. Its risk level is now ${tierWord}.`
          : 'The official classification of this recall changed.',
      };
    case 'classification_changed':
      // The class SET changed without an honest up/down direction (Part 9).
      return {
        title: `Risk update: ${product}`,
        body: rated
          ? `${agency} updated this recall’s classifications. Its risk level is now ${tierWord}.`
          : 'The official classification of this recall changed.',
      };
    case 'expansion_products':
      return {
        title: `Recall updated: ${product}`,
        body: 'More products are now included in this recall.',
      };
    case 'expansion_geography':
      return {
        title: `Recall updated: ${product}`,
        body: 'More areas are now affected by this recall.',
      };
    case 'correction_broadened':
      return {
        title: `Recall updated: ${product}`,
        body: 'This recall now covers more than first announced.',
      };
    case 'health_impact':
      return {
        title: `Recall updated: ${product}`,
        body: 'Illnesses or adverse reactions are now reported for this recall.',
      };
    case 'instructions_changed':
      return {
        title: `Recall updated: ${product}`,
        body: 'What you should do has changed. Check the latest guidance.',
      };
    case 'retraction':
      return {
        title: `Recall retracted: ${product}`,
        body: `${agency} retracted this notice.`,
      };
    default:
      // A future material-change rule must degrade to honest generic copy,
      // never block delivery or leak an internal rule id to a phone.
      return {
        title: `Recall updated: ${product}`,
        body: 'This recall was updated. Check the latest details.',
      };
  }
}

/** The complete Expo message for one delivery. Data stays small and typed. */
export function buildPushMessage(event: DeliverableEvent, expoPushToken: string): PushMessage {
  const content = formatPushContent(event);
  return {
    to: expoPushToken,
    title: content.title,
    body: content.body,
    data: { kind: 'recall', recallCaseId: event.recallCaseId, notificationEventId: event.id },
    sound: 'default',
  };
}
