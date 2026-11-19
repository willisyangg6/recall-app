/**
 * Push delivery substrate (Phase C2): types and ports.
 *
 * The NotificationEvent ledger stays authoritative — Phase A/B decided which
 * events exist and which are suppressed. Delivery decides only which active
 * subscriptions receive an already-created deliverable event, and tracks that
 * per (event, subscription).
 *
 * Two ports, mirroring the C1 pattern (LabelSyncStore):
 *   PushStore     — persistence (Supabase in production, memory in tests)
 *   PushTransport — the Expo Push Service HTTP surface (fake in tests)
 */

import type { RetailerMatchEvidence, RetailerNoticeSubject } from '../retailer/notice-events';
import type { AgencyCaseView } from '../retailer/types';
import type { CaseProjection, LifecycleState, NotificationKind } from '../../domain/recall-types';
import type { SubscriptionEntitlement } from './entitlement';

/** One app installation that opted into recall alerts. */
export interface PushSubscription {
  id: string;
  installationId: string;
  expoPushToken: string;
  platform: 'ios' | 'android';
  enabled: boolean;
  /** Per-subscription horizon: when alerts were (re-)enabled. */
  enabledAt: string;
  /**
   * The cached RevenueCat `premium` entitlement (entitlement.ts). The purchase
   * id it was read under is deliberately NOT on this type: it is bearer-
   * sensitive, and only the refresh step (listEntitlementRefreshRows) sees it.
   */
  entitlement: SubscriptionEntitlement;
  /**
   * The app version the installation registered with ("1.2.0"); null when
   * unknown. Retailer-notice alerts reach only versions that can open them
   * (notice-events.ts `RETAILER_ALERTS_MIN_APP_VERSION`).
   */
  appVersion?: string | null;
}

/** One enabled registration as the entitlement refresh sees it. */
export interface EntitlementRefreshRow {
  subscriptionId: string;
  /** BEARER-SENSITIVE: never logged, never put in a metric or an error. */
  purchaseId: string;
  entitlement: SubscriptionEntitlement;
}

/**
 * One installation's personalization preferences (Phase C3), read by the
 * delivery worker. `updatedAt` is a delivery-safety horizon exactly like the
 * C2 enabled_at horizons: eligibility requires the event to be created on or
 * after it, so preference changes can never make old events newly deliverable.
 */
export interface InstallationPreferences {
  installationId: string;
  /** Two-letter codes (['CA','NY']); empty = no location preference. */
  stateCodes: string[];
  /** Canonical allergen tokens, as stored. */
  allergens: string[];
  /**
   * The allergen consent the row was written under (2026-10-13), or null.
   * Allergens count for delivery ONLY with a consent version: rows written
   * before consent existed, by older clients, or after a withdrawal carry
   * none (worker.ts `toUserPreferences`).
   */
  allergenConsentVersion: string | null;
  /** Canonical retailer catalog ids. */
  retailerIds: string[];
  updatedAt: string;
}

/**
 * One recall case as delivery sees it (2026-10-04): the canonical consumer
 * projection plus the two lifecycle facts the Feed filters on and the
 * ledger does not carry — `state` and the merge tombstone. The Feed shows a
 * case only while `state = 'active' AND merged_into IS NULL`
 * (consumer_feed_manifest); delivery reads the same two columns so an alert
 * can never name a recall the Feed would not list, or open one that RLS
 * hides.
 */
export interface CaseLink {
  id: string;
  state: LifecycleState;
  /** The surviving case this one was reconciled into; null when canonical. */
  mergedInto: string | null;
  projection: CaseProjection;
}

/**
 * A deliverable ledger event joined with its case's CURRENT lifecycle and
 * projection. `recallCaseId` and `projection` are the event's own case as
 * ledgered; `resolveDeliverableEvent` (worker.ts) re-points both at the
 * canonical destination before anything is formatted or sent.
 */
export interface DeliverableEvent {
  id: string;
  recallCaseId: string;
  kind: NotificationKind;
  triggerRuleId: string;
  /** The material change's fingerprint; null on an `initial`. */
  materialChangeRef: string | null;
  payloadSummary: string;
  createdAt: string;
  /** The ledgered case's lifecycle state at read time. */
  caseState: LifecycleState;
  /** The ledgered case's merge tombstone at read time. */
  mergedInto: string | null;
  projection: CaseProjection;
  /**
   * Set when the event announces an approved retailer-only notice instead of
   * an agency case (migration 20261119000000). `recallCaseId` is then empty,
   * `projection` is the notice's approved fields as a projection
   * (notice-events.ts `retailerCaseProjection`), and the worker decides it by
   * the retailer rule (event-eligibility.ts `decideRetailerDelivery`).
   */
  retailerNoticeId?: string | null;
  /** Who the alert says announced it: the retailer, for a retailer notice. */
  attribution?: string | null;
}

/** An approved retailer notice as the worker reads it, at read time. */
export interface RetailerNoticeLink {
  noticeId: string;
  /**
   * Returned by `consumer_retailer_notices()` right now — approved, the
   * approval's letter still current, no agency match, still a standalone
   * food recall. Exactly what the app shows; anything else never sends.
   */
  visible: boolean;
  /** The CURRENT live approval's subject; null when none is live. */
  subject: RetailerNoticeSubject | null;
  /** The monitor's evidence for the current letter; null when no text is archived. */
  matchEvidence: RetailerMatchEvidence | null;
}

/** Subscriptions already sent (or queued) a retailer notice's alert. */
export interface RetailerAlertRecipients {
  noticeId: string;
  subscriptionIds: string[];
}

export type DeliveryStatus =
  | 'pending'
  | 'sending'
  | 'ticket_accepted'
  | 'receipt_ok'
  | 'retryable_failure'
  | 'permanent_failure';

export interface DeliveryRow {
  id: string;
  eventId: string;
  subscriptionId: string;
  status: DeliveryStatus;
  attempts: number;
  ticketId: string | null;
  failureCode: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  receiptCheckedAt: string | null;
}

export interface DeliveryPatch {
  status?: DeliveryStatus;
  attempts?: number;
  ticketId?: string | null;
  failureCode?: string | null;
  lastError?: string | null;
  updatedAt: string;
  sentAt?: string;
  receiptCheckedAt?: string;
}

export interface PushStore {
  /** null = the founder has not activated push delivery. */
  getPushEnabledAt(): Promise<string | null>;

  listEnabledSubscriptions(): Promise<PushSubscription[]>;
  /** Enabled registrations that carry a purchase id, oldest-checked first. */
  listEntitlementRefreshRows(): Promise<EntitlementRefreshRow[]>;
  /**
   * Store one successful check. Lands only while the row is still enabled and
   * still carries `purchaseId`, so a status read under one purchase id can
   * never be written onto a registration that has since changed it. Returns
   * false when it did not land.
   */
  recordEntitlement(
    subscriptionId: string,
    purchaseId: string,
    entitlement: SubscriptionEntitlement,
  ): Promise<boolean>;
  /** DeviceNotRegistered / operational disable. Historical deliveries stay. */
  disableSubscription(id: string, reason: string, at: string): Promise<void>;

  /** All stored installation preferences (Phase C3 eligibility input). */
  listPreferences(): Promise<InstallationPreferences[]>;

  /**
   * Deliverable (unsuppressed) ledger events created on/after `sinceIso`,
   * oldest first, joined with their case projection. `limit` bounds a run.
   */
  listDeliverableEventsSince(sinceIso: string, limit: number): Promise<DeliverableEvent[]>;
  /** Deliverable events created BEFORE `beforeIso` — the excluded-backlog count. */
  countDeliverableEventsBefore(beforeIso: string): Promise<number>;
  /** Suppressed events created on/after `sinceIso` — reported, never delivered. */
  countSuppressedEventsSince(sinceIso: string): Promise<number>;

  /**
   * Insert a pending delivery; false when (event, subscription) already
   * exists. THE idempotency primitive: reruns cannot re-enqueue.
   */
  createDeliveryIfAbsent(
    eventId: string,
    subscriptionId: string,
    createdAt: string,
  ): Promise<boolean>;
  listDeliveriesByStatus(statuses: DeliveryStatus[], limit: number): Promise<DeliveryRow[]>;
  updateDelivery(id: string, patch: DeliveryPatch): Promise<void>;
  /** Status → count, for ops:health and dry-run reporting. */
  countDeliveriesByStatus(): Promise<Record<string, number>>;

  getSubscription(id: string): Promise<PushSubscription | null>;
  getEvent(eventId: string): Promise<DeliverableEvent | null>;
  /** Deliverable (unsuppressed) retailer-notice events created on/after `sinceIso`, oldest first. */
  listDeliverableRetailerEventsSince(sinceIso: string, limit: number): Promise<DeliverableEvent[]>;
  /** One retailer notice's visibility, current approval and match evidence. */
  getRetailerNotice(noticeId: string): Promise<RetailerNoticeLink>;
  /** Agency cases published on/after `fromIso`, in the retailer monitor's own view. */
  listAgencyCaseViews(fromIso: string): Promise<AgencyCaseView[]>;
  /**
   * Per retailer notice with an event created on/after `sinceIso`: the
   * subscriptions whose delivery was sent or is still queued (not failed).
   */
  listRetailerAlertRecipients(sinceIso: string): Promise<RetailerAlertRecipients[]>;

  /** One case's current lifecycle, merge tombstone and projection; null when unknown. */
  getCase(caseId: string): Promise<CaseLink | null>;
  /**
   * Whether `caseId` carries its own deliverable (unsuppressed) event for
   * the same material change — the twin check that keeps an update ledgered
   * on an absorbed duplicate from alerting twice once it is re-pointed at
   * the surviving case.
   */
  hasDeliverableEvent(
    caseId: string,
    triggerRuleId: string,
    materialChangeRef: string | null,
  ): Promise<boolean>;
}

/** One message for the Expo Push Service. */
export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data:
    | { kind: 'recall'; recallCaseId: string; notificationEventId: string }
    | { kind: 'retailer_notice'; retailerNoticeId: string; notificationEventId: string };
  sound: 'default';
}

/**
 * What `npm run push:test` sends (test-message.ts) — to one named
 * subscription, never through the worker or the ledger. `kind: 'test'` opens
 * nothing; the recall form carries the app's real payload kind so a tap
 * opens that case, marked `test` and with no ledger event id.
 */
export interface TestPushMessage extends Omit<PushMessage, 'data'> {
  data: { kind: 'test' } | { kind: 'recall'; recallCaseId: string; test: true };
}

/** Per-message ticket: Expo ACCEPTED the request — not device delivery. */
export type PushTicket =
  { status: 'ok'; id: string } | { status: 'error'; message: string; details?: { error?: string } };

export type PushReceipt =
  { status: 'ok' } | { status: 'error'; message: string; details?: { error?: string } };

export interface PushTransport {
  /** Send one chunk (≤100 messages); tickets in message order. */
  send(messages: PushMessage[]): Promise<PushTicket[]>;
  /** Fetch receipts for ticket ids (≤1000); missing ids are still in flight. */
  getReceipts(ticketIds: string[]): Promise<Record<string, PushReceipt>>;
  /**
   * Why this transport cannot authenticate to its provider, or null when it
   * can. The worker asks BEFORE contacting the provider, so a missing
   * credential fails the run without spending any delivery's attempts.
   * Optional: transports without credentials (tests) omit it.
   */
  authProblem?(): string | null;
}
