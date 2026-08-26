/**
 * Deterministic push copy — one source-grounded formatter for every
 * notification the delivery worker sends. No LLM, no raw agency headlines:
 * the same display helpers the app's cards use build the product identity and
 * reason, so a push and the screen it opens can never disagree.
 *
 * Titles carry no regulatory jargon; consumer risk speaks the ConsumerRiskTier
 * language (Critical/High/Moderate/Low/Minimal). Official Class I/II/III stays
 * on the Recall Detail screen. A Pending-risk recall is announced from its
 * hazard facts without pretending a tier exists.
 *
 * Every body states only facts present in the case projection or the
 * material-change rule that fired — nothing is invented.
 */

import { productDisplayName } from '../../lib/consumer-summary';
import { reasonLine } from '../../lib/recall-display';
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
  const product = truncateForPush(
    productDisplayName(projection.productDescription ?? null, projection.title),
  );
  const agency = agencyLabel(projection.sourceAgency);

  if (event.kind === 'initial') {
    const title =
      projection.noticeType === 'public_health_alert'
        ? `Safety alert: ${product}`
        : `Recall alert: ${product}`;
    const reason = reasonLine(
      projection.reasonText,
      projection.hazardCategory,
      projection.pathogenOrAllergen,
    );
    return {
      title,
      body: reason ? `${reason}. Check your package.` : 'Check your package for details.',
    };
  }

  const tier = consumerRiskTier(projection.classification);
  const tierWord = riskTierWord(tier);
  const rated = tier !== 'pending' && tier !== 'unrated';

  switch (event.triggerRuleId) {
    case 'classification_assigned':
      return {
        title: `Risk update: ${product}`,
        body: !rated
          ? 'The official classification of this recall changed.'
          : classificationStatus(projection.classification) === 'mixed'
            ? `${agency} gave affected products different classifications — overall ${tierWord} risk.`
            : `${agency} classified this recall as ${tierWord} risk.`,
      };
    case 'classification_upgraded':
      return {
        title: `Risk update: ${product}`,
        body: rated
          ? `${agency} raised this recall's classification — now ${tierWord} risk.`
          : 'The official classification of this recall changed.',
      };
    case 'classification_downgraded':
      return {
        title: `Risk update: ${product}`,
        body: rated
          ? `${agency} lowered this recall's classification — now ${tierWord} risk.`
          : 'The official classification of this recall changed.',
      };
    case 'classification_changed':
      // The class SET changed without an honest up/down direction (Part 9).
      return {
        title: `Risk update: ${product}`,
        body: rated
          ? `${agency} updated this recall's classifications — now ${tierWord} risk.`
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
