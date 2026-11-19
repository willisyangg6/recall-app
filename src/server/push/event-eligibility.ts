/**
 * Per-event delivery eligibility by event type (2026-10-04) — the rule that
 * decides, BEFORE any subscription is considered, whether a ledgered event
 * may send at all today, and which recall case the alert names and opens.
 * A leaf: no I/O, so every row of the policy table is provable in Node.
 *
 * ## Why this exists
 *
 * The ledger records an event when a change happens and never rewrites it.
 * The Feed, meanwhile, shows a case only while it is active and unmerged
 * (`state = 'active' AND merged_into IS NULL`, the consumer manifest and the
 * client's RLS policy). Between the moment an event is ledgered and the tick
 * that delivers it, the case can close, be retracted, or be reconciled into a
 * surviving duplicate — and before this leaf the worker delivered the event
 * regardless, so a push could announce a recall the Feed does not list, or
 * open a tombstoned case whose Detail reads "not found" (audit K3, 2026-10-03).
 *
 * ## The policy, by event type
 *
 * The event's case is first resolved to its canonical destination: the case
 * itself when it is unmerged, else the surviving case its tombstone points
 * to (the worker follows the chain). Then:
 *
 * | Event                           | Destination           | Decision                      |
 * | ------------------------------- | --------------------- | ----------------------------- |
 * | `initial` (new recall)          | the case, active      | deliver                       |
 * | `initial`                       | closed or retracted   | skip — not an active recall   |
 * | `initial`                       | a merged duplicate    | skip — the survivor's own     |
 * |                                 |                       | `initial` is THE new-recall   |
 * |                                 |                       | alert; this one would double  |
 * | `material_update` · `retraction`| retracted             | deliver — a retraction is     |
 * |                                 |                       | news precisely because the    |
 * |                                 |                       | Feed no longer lists it       |
 * | `material_update` · `retraction`| not retracted         | skip — the alert would say    |
 * |                                 |                       | retracted of a notice that    |
 * |                                 |                       | is not                        |
 * | `material_update` · other       | active                | deliver (the important        |
 * |                                 |                       | updates: expansion,           |
 * |                                 |                       | correction, classification,   |
 * |                                 |                       | health impact, instructions)  |
 * | `material_update` · other       | closed or retracted   | skip — not an active recall   |
 * | any, on a merged case           | survivor has its own  | skip — a duplicate alert      |
 * |                                 | event for the same    |                               |
 * |                                 | change                |                               |
 * | any                             | chain unresolvable    | skip — no valid destination   |
 *
 * A delivered event on a merged case is RE-POINTED: its payload names the
 * survivor and the copy is formatted from the survivor's projection, so the
 * alert reads as the card it opens. The ledger row itself is untouched.
 *
 * Nothing here decides whether an event should exist (Phase A/B does), and
 * nothing here is a blanket active-only filter: retractions are the one
 * event type whose destination is, by definition, not active.
 */

import { retailerAttribution, retailerCaseProjection } from '../retailer/notice-events';
import type { CaseLink, DeliverableEvent, RetailerNoticeLink } from './types';

/** The material-change rule that announces a retraction (domain/material-change). */
export const RETRACTION_RULE_ID = 'retraction';

export type DeliverySkipReason =
  /** The destination's lifecycle does not fit the event type. */
  | 'lifecycle'
  /** The event sits on an absorbed duplicate and the survivor already carries it. */
  | 'merged_duplicate'
  /** The merge chain could not be followed to a canonical case. */
  | 'unresolved'
  /**
   * A retailer notice the app no longer shows: withdrawn, its letter revised
   * since approval, matched to an agency case, or no longer a standalone
   * food recall (consumer_retailer_notices() does not return it).
   */
  | 'retailer_not_visible'
  /** A current agency case is the same recall: its own alert is the one alert. */
  | 'agency_duplicate';

export type DeliveryDecision =
  | {
      kind: 'deliver';
      /** The event as it will be formatted and sent: destination id and projection. */
      event: DeliverableEvent;
      /** True when the event was re-pointed from an absorbed case to its survivor. */
      rerouted: boolean;
    }
  | { kind: 'skip'; reason: DeliverySkipReason };

export interface DestinationFacts {
  /** The canonical case the event's case resolves to; null when unresolvable. */
  destination: CaseLink | null;
  /**
   * When the event's case is merged: whether the destination carries its own
   * deliverable event for the same change (`hasDeliverableEvent`). Ignored
   * for an unmerged case.
   */
  survivorHasTwin: boolean;
}

export function isRetraction(event: Pick<DeliverableEvent, 'kind' | 'triggerRuleId'>): boolean {
  return event.kind === 'material_update' && event.triggerRuleId === RETRACTION_RULE_ID;
}

/** The lifecycle state the destination must be in for this event type to send. */
export function requiredDestinationState(
  event: Pick<DeliverableEvent, 'kind' | 'triggerRuleId'>,
): 'active' | 'retracted' {
  return isRetraction(event) ? 'retracted' : 'active';
}

export function decideDelivery(event: DeliverableEvent, facts: DestinationFacts): DeliveryDecision {
  const { destination } = facts;
  if (destination === null || destination.mergedInto !== null) {
    return { kind: 'skip', reason: 'unresolved' };
  }
  const merged = destination.id !== event.recallCaseId;
  if (merged) {
    // The survivor was founded on its own and carries its own `initial`
    // (exactly-one-initial per case); the absorbed card's is a duplicate.
    if (event.kind === 'initial') return { kind: 'skip', reason: 'merged_duplicate' };
    if (facts.survivorHasTwin) return { kind: 'skip', reason: 'merged_duplicate' };
  }
  if (destination.state !== requiredDestinationState(event)) {
    return { kind: 'skip', reason: 'lifecycle' };
  }
  return {
    kind: 'deliver',
    rerouted: merged,
    event: merged
      ? { ...event, recallCaseId: destination.id, projection: destination.projection }
      : event,
  };
}

/**
 * The retailer-notice rule (docs/recall-push-delivery.md, "Retailer-only
 * notices"), judged at ledger read AND again for every queued row at send:
 *
 * | Notice now                                                | Decision                       |
 * | --------------------------------------------------------- | ------------------------------ |
 * | returned by `consumer_retailer_notices()`, no agency twin | deliver, from the CURRENT      |
 * |                                                           | approval's fields              |
 * | withdrawn, letter revised, agency match confirmed, or no  | skip `retailer_not_visible`:   |
 * | longer a standalone food recall                           | unapproved content never sends |
 * | an agency case the monitor's matcher calls the same       | skip `agency_duplicate`: the   |
 * | recall (even before the monitor re-decides the notice)    | agency's alert is THE alert    |
 *
 * Every event type follows the same rule: a retailer notice has no
 * retraction or merge lifecycle of its own — withdrawal is how it ends.
 */
export function decideRetailerDelivery(
  event: DeliverableEvent,
  facts: { notice: RetailerNoticeLink; sameRecallCaseIds: string[] },
): DeliveryDecision {
  const { notice } = facts;
  if (!notice.visible || notice.subject === null) {
    return { kind: 'skip', reason: 'retailer_not_visible' };
  }
  if (facts.sameRecallCaseIds.length > 0) return { kind: 'skip', reason: 'agency_duplicate' };
  return {
    kind: 'deliver',
    rerouted: false,
    event: {
      ...event,
      attribution: retailerAttribution(notice.subject.fields),
      projection: retailerCaseProjection(notice.subject),
    },
  };
}
