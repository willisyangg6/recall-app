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

/**
 * What the formatter reads of an event: its identity, kind, trigger and the
 * projection it is formatted from. The worker hands over a RESOLVED event
 * (event-eligibility.ts), so for an event on an absorbed duplicate these are
 * already the surviving case's id and projection.
 */
export type FormattableEvent = Pick<
  DeliverableEvent,
  'id' | 'recallCaseId' | 'kind' | 'triggerRuleId' | 'payloadSummary' | 'createdAt' | 'projection'
>;

export interface PushContent {
  title: string;
  body: string;
}

/**
 * Late-alert dating (founder decision D4, 2026-10-14). A NEW recall's alert
 * sent this many New York calendar days or more after the agency's
 * announcement date says when it was announced, instead of reading as news.
 * The age is measured at SEND time, so the overnight hold can never make an
 * alert look fresher than it is. Anything over 30 days old is never sent
 * (`suppressed: backfill`), so the dated body covers 3 to 30 days.
 */
export const LATE_ALERT_DAYS = 3;

const NEW_YORK_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "Oct 9", or "Dec 30, 2025" when the announcement was in another year than
 * the send; null when the alert is not late, or either date is unreadable
 * (then the body is the ordinary one: never a guessed date).
 */
export function lateAnnouncementDate(publishedAt: string, sentAt: string): string | null {
  const published = /^(\d{4})-(\d{2})-(\d{2})/.exec(publishedAt);
  const sentInstant = new Date(sentAt);
  if (!published || Number.isNaN(sentInstant.getTime())) return null;
  const sent = /^(\d{4})-(\d{2})-(\d{2})$/.exec(NEW_YORK_DATE.format(sentInstant));
  if (!sent) return null;
  const [, py, pm, pd] = published.map(Number);
  const [, sy, sm, sd] = sent.map(Number);
  const days = (Date.UTC(sy, sm - 1, sd) - Date.UTC(py, pm - 1, pd)) / 86_400_000;
  if (!(days >= LATE_ALERT_DAYS)) return null;
  return `${MONTHS[pm - 1]} ${pd}${py === sy ? '' : `, ${py}`}`;
}

/**
 * `sentAt` is the moment the delivery worker hands the alert to Expo. Without
 * it (tests, QA scripts, previews), no late-alert dating is applied.
 */
export function formatPushContent(
  event: FormattableEvent,
  options: { sentAt?: string } = {},
): PushContent {
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
    // D4: a late-discovered recall says when the agency announced it.
    const announced = options.sentAt
      ? lateAnnouncementDate(projection.publishedAt, options.sentAt)
      : null;
    if (announced) {
      return {
        title,
        body: reason
          ? `${reason}. ${agency} announced this ${announced}. Check your package.`
          : `${agency} announced this ${announced}. Check your package for details.`,
      };
    }
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
export function buildPushMessage(
  event: FormattableEvent,
  expoPushToken: string,
  /** The send moment, for late-alert dating (D4); the worker always passes it. */
  sentAt?: string,
): PushMessage {
  const content = formatPushContent(event, { sentAt });
  return {
    to: expoPushToken,
    title: content.title,
    body: content.body,
    data: { kind: 'recall', recallCaseId: event.recallCaseId, notificationEventId: event.id },
    sound: 'default',
  };
}
