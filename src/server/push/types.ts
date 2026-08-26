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

import type { CaseProjection, NotificationKind } from '../../domain/recall-types';

/** One app installation that opted into recall alerts. */
export interface PushSubscription {
  id: string;
  installationId: string;
  expoPushToken: string;
  platform: 'ios' | 'android';
  enabled: boolean;
  /** Per-subscription horizon: when alerts were (re-)enabled. */
  enabledAt: string;
}

/**
 * One installation's personalization preferences (Phase C3), read by the
 * delivery worker. `updatedAt` is a delivery-safety horizon exactly like the
 * C2 enabled_at horizons: eligibility requires the event to be created on or
 * after it, so preference changes can never make old events newly deliverable.
 */
export interface InstallationPreferences {
  installationId: string;
  /** Two-letter code ('CA'); null = no home state chosen. */
  stateCode: string | null;
  /** Canonical allergen tokens. */
  allergens: string[];
  /** Canonical retailer catalog ids. */
  retailerIds: string[];
  updatedAt: string;
}

/** A deliverable ledger event joined with its case's current projection. */
export interface DeliverableEvent {
  id: string;
  recallCaseId: string;
  kind: NotificationKind;
  triggerRuleId: string;
  payloadSummary: string;
  createdAt: string;
  projection: CaseProjection;
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
}

/** One message for the Expo Push Service. */
export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: { kind: 'recall'; recallCaseId: string; notificationEventId: string };
  sound: 'default';
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
}
