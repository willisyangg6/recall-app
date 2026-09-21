/**
 * Deterministic push copy — one source-grounded formatter for every
 * notification the delivery worker sends. No LLM, no raw agency headlines:
 * the product identity and the reason sentence come from the SAME shared
 * contracts the app's cards build from (`consumer-summary` for the title,
 * `conciseReasonLine` + `cardSummaryText` for the reason), so a push and the
 * card it opens can never disagree.
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

import { displayProductTitle, productDisplayName } from '../../lib/consumer-summary';
import { cardSummaryText, conciseReasonLine } from '../../lib/recall-presentation';
import { agencyLabel, riskTierWord } from '../../lib/risk-display';
import { consumerRiskTier, classificationStatus } from '../../domain/risk-tier';
import type { DeliverableEvent, PushMessage } from './types';

/** Notification titles stay glanceable; long product names truncate cleanly. */
const MAX_PRODUCT_CHARS = 60;

export function truncateForPush(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= MAX_PRODUCT_CHARS) return trimmed;
  const cut = trimmed.slice(0, MAX_PRODUCT_CHARS - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export interface PushContent {
  title: string;
  body: string;
}

export function formatPushContent(event: DeliverableEvent): PushContent {
  const projection = event.projection;
  // The same shared shopper-title pipeline the app's cards use (P3D, extended
  // by P2B7G): a jammed quantity+unit boundary is spaced, ALL-CAPS is
  // un-shouted and a defectively lowercase name is headline-cased before
  // truncation, so a push and the card it opens can never disagree about a
  // name. Formatting only — rendered at delivery time, never stored in the
  // ledger, and delivery stays dormant until push is explicitly activated.
  const product = truncateForPush(
    displayProductTitle(
      productDisplayName(projection.productDescription ?? null, projection.title),
    ),
  );
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
