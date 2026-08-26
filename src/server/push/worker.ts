/**
 * Push delivery worker (Phase C2; personalized eligibility Phase C3).
 *
 * Consumes the authoritative NotificationEvent ledger — it never decides
 * whether an event should exist, only which active subscriptions receive an
 * already-created deliverable event, and what happened to each attempt.
 *
 * Safety invariants:
 * - Activation is explicit: no push_enabled_at ⇒ the worker is a no-send
 *   no-op. It never infers a horizon from deploy or run time.
 * - Global horizon: only events created ON/AFTER push_enabled_at are ever
 *   considered — the pre-C2 deliverable backlog is structurally unreachable.
 * - Per-subscription horizon: a device enabled on Sept 5 never receives an
 *   event created Sept 1 (classifySubscriptionsForEvent, the ONE seam).
 * - Preference horizon: an installation's preferences_updated_at joins those
 *   horizons, so changing preferences (new allergen, new state) can never
 *   make an older event newly deliverable — no retroactive blast.
 * - Personalized matching happens only in that same seam, via the SAME pure
 *   relevance evaluation the app renders (src/lib/relevance).
 * - Idempotency: the (event, subscription) unique row is created before any
 *   send; reruns and scheduler retries cannot re-enqueue, and a delivery that
 *   already holds a ticket is never re-sent.
 * - A ticket is Expo ACCEPTING the request; only a receipt marks the handoff
 *   to APNs/FCM successful (receipt_ok). The two are never conflated.
 *
 * At-least-once edges (documented, bounded by MAX_SEND_ATTEMPTS):
 * - A crash between the HTTP send and the ticket write leaves 'sending' rows;
 *   the next run (lease-serialized, so they cannot be live) retries them —
 *   the device may see a duplicate for that one crash window.
 * - A receipt missing after 24h is unknowable (Expo clears receipts); the
 *   delivery goes retryable rather than silently counting as delivered.
 */

import type { UserRecallPreferences } from '../../domain/preferences';
import { pushEligible, type RelevanceInput } from '../../lib/relevance';
import type { JobRunOutcome } from '../store/types';
import { buildPushMessage } from './format';
import { MAX_MESSAGES_PER_REQUEST, MAX_RECEIPT_IDS_PER_REQUEST } from './expo-transport';
import type {
  DeliverableEvent,
  DeliveryRow,
  InstallationPreferences,
  PushReceipt,
  PushStore,
  PushSubscription,
  PushTicket,
  PushTransport,
} from './types';

/** Bounded retries: after this many attempts a delivery fails permanently. */
export const MAX_SEND_ATTEMPTS = 5;
/** Expo recommends checking receipts ~15 minutes after sending. */
export const RECEIPT_DELAY_MINUTES = 15;
/** Expo clears receipts after 24 hours; older tickets are unknowable. */
const RECEIPT_EXPIRY_HOURS = 24;
/** Events older than this never enter delivery — a month-late push is noise. */
const LOOKBACK_DAYS = 30;

/**
 * Exponential retry backoff on the 30-minute scheduler grid, capped so a
 * transient failure never waits more than 6 hours.
 */
export function retryBackoffMs(attempts: number): number {
  return Math.min(30 * 60_000 * 2 ** (attempts - 1), 6 * 3_600_000);
}

/**
 * Expo failure classes (docs.expo.dev/push-notifications/sending-notifications,
 * 2026-08). Anything unknown is treated as retryable — safe under the bounded
 * attempt cap, and a new Expo code never silently drops a delivery.
 */
const PERMANENT_ERROR_CODES = new Set([
  'DeviceNotRegistered',
  'InvalidCredentials',
  'MessageTooBig',
  'MismatchSenderId',
]);

export function isPermanentPushError(code: string | undefined): boolean {
  return code !== undefined && PERMANENT_ERROR_CODES.has(code);
}

/** The case facts personalization reads, adapted from the joined projection. */
function relevanceInput(event: Pick<DeliverableEvent, 'projection'>): RelevanceInput {
  return {
    geography: event.projection.geography,
    pathogenOrAllergen: event.projection.pathogenOrAllergen ?? null,
    // Projections persisted before the field existed lack the key.
    retailerNames: event.projection.retailerNames ?? [],
  };
}

function toUserPreferences(prefs: InstallationPreferences): UserRecallPreferences {
  return { state: prefs.stateCode, allergens: prefs.allergens, retailers: prefs.retailerIds };
}

export interface EventEligibility {
  eligible: PushSubscription[];
  /** Excluded by the C2 horizons (activation / subscription enabled_at). */
  horizonSkipped: number;
  /**
   * Excluded because the event predates the installation's last preference
   * change — the no-retroactive-blast guarantee: adding an allergen or
   * moving states can never make an OLD event newly deliverable.
   */
  preferenceHorizonSkipped: number;
  /** Excluded by personalized matching (state / allergen / retailer). */
  preferenceSkipped: number;
}

/**
 * THE eligibility seam — every per-subscription delivery decision happens
 * here and only here (C3: personalization included; nothing else in the
 * worker filters subscriptions).
 *
 * Per subscription, in order:
 * 1. Horizons. The event must be created on/after ALL of: global activation,
 *    the subscription's enabled_at, and — when preferences exist — the
 *    preferences' updated_at. The last one makes preference changes safe:
 *    events older than the change were already decided under the previous
 *    preferences (or never qualified), and never become newly deliverable.
 * 2. Preference matching (src/lib/relevance `pushEligible` — the same
 *    evaluation the app renders): with a chosen state, deliver on geographic
 *    match (nationwide always matches) or unknown geography with an
 *    allergen/retailer signal; an authoritative geographic exclusion never
 *    delivers. Without a chosen state, pre-C3 deliver-all behavior stands.
 */
export function classifySubscriptionsForEvent(
  event: Pick<DeliverableEvent, 'createdAt' | 'projection'>,
  subscriptions: PushSubscription[],
  pushEnabledAt: string,
  preferences: Map<string, InstallationPreferences>,
): EventEligibility {
  const result: EventEligibility = {
    eligible: [],
    horizonSkipped: 0,
    preferenceHorizonSkipped: 0,
    preferenceSkipped: 0,
  };
  const input = relevanceInput(event);
  for (const subscription of subscriptions) {
    if (!subscription.enabled) continue;
    const prefs = preferences.get(subscription.installationId) ?? null;
    const c2Horizon =
      subscription.enabledAt > pushEnabledAt ? subscription.enabledAt : pushEnabledAt;
    const horizon = prefs && prefs.updatedAt > c2Horizon ? prefs.updatedAt : c2Horizon;
    if (event.createdAt < horizon) {
      if (event.createdAt >= c2Horizon) result.preferenceHorizonSkipped += 1;
      else result.horizonSkipped += 1;
      continue;
    }
    if (!pushEligible(input, prefs ? toUserPreferences(prefs) : null)) {
      result.preferenceSkipped += 1;
      continue;
    }
    result.eligible.push(subscription);
  }
  return result;
}

/** The seam's original shape — the eligible list alone. */
export function eligibleSubscriptions(
  event: Pick<DeliverableEvent, 'createdAt' | 'projection'>,
  subscriptions: PushSubscription[],
  pushEnabledAt: string,
  preferences: Map<string, InstallationPreferences> = new Map(),
): PushSubscription[] {
  return classifySubscriptionsForEvent(event, subscriptions, pushEnabledAt, preferences).eligible;
}

export interface PushWorkerOptions {
  transport: PushTransport;
  dryRun: boolean;
  now: () => Date;
  maxEventsPerRun?: number;
  maxSendsPerRun?: number;
}

export interface PushWorkerResult {
  outcome: JobRunOutcome;
  metrics: Record<string, unknown>;
  error?: string;
}

export async function runPushDelivery(
  store: PushStore,
  options: PushWorkerOptions,
): Promise<PushWorkerResult> {
  const { transport, dryRun, now } = options;
  const maxEvents = options.maxEventsPerRun ?? 200;
  const maxSends = options.maxSendsPerRun ?? 1000;
  const nowIso = () => now().toISOString();

  const pushEnabledAt = await store.getPushEnabledAt();
  const subscriptions = await store.listEnabledSubscriptions();

  if (pushEnabledAt === null) {
    console.log(
      `Push delivery is NOT ACTIVATED — no-send state (activate with npm run push:activate).`,
    );
    console.log(`  enabled subscriptions waiting: ${subscriptions.length}`);
    return {
      outcome: 'succeeded',
      metrics: {
        activation: 'not_activated',
        subscriptionsActive: subscriptions.length,
        sent: 0,
      },
    };
  }

  const preferences = await store.listPreferences();
  const preferencesByInstallation = new Map(preferences.map((p) => [p.installationId, p]));

  const metrics = {
    activation: pushEnabledAt,
    subscriptionsActive: subscriptions.length,
    preferencesStored: preferences.length,
    preferencesWithState: preferences.filter((p) => p.stateCode !== null).length,
    eventsExamined: 0,
    skippedPreActivation: 0,
    suppressedSkipped: 0,
    subscriptionHorizonSkipped: 0,
    preferenceHorizonSkipped: 0,
    preferenceSkipped: 0,
    deliveriesCreated: 0,
    sent: 0,
    ticketsAccepted: 0,
    receiptsQueried: 0,
    receiptsOk: 0,
    receiptsPending: 0,
    retryableFailures: 0,
    permanentFailures: 0,
    tokensDisabled: 0,
    cappedSends: 0,
  };
  const errors: string[] = [];
  const subscriptionById = new Map(subscriptions.map((s) => [s.id, s]));

  // ── Receipts for earlier sends (before new work: a DeviceNotRegistered
  //    device found here is excluded from this run's sends) ──────────────────
  const receiptDue = (await store.listDeliveriesByStatus(['ticket_accepted'], 2000)).filter(
    (d) =>
      d.ticketId !== null &&
      d.sentAt !== null &&
      now().getTime() - new Date(d.sentAt).getTime() >= RECEIPT_DELAY_MINUTES * 60_000,
  );
  if (dryRun) {
    metrics.receiptsQueried = receiptDue.length;
  } else {
    for (let i = 0; i < receiptDue.length; i += MAX_RECEIPT_IDS_PER_REQUEST) {
      const chunk = receiptDue.slice(i, i + MAX_RECEIPT_IDS_PER_REQUEST);
      let receipts: Record<string, PushReceipt>;
      try {
        receipts = await transport.getReceipts(chunk.map((d) => d.ticketId as string));
      } catch (error) {
        errors.push(
          `receipt fetch failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue; // tickets stay ticket_accepted; retried next run.
      }
      metrics.receiptsQueried += chunk.length;
      for (const delivery of chunk) {
        const receipt = receipts[delivery.ticketId as string];
        if (!receipt) {
          const age = now().getTime() - new Date(delivery.sentAt as string).getTime();
          if (age >= RECEIPT_EXPIRY_HOURS * 3_600_000) {
            // Expo cleared the receipt before we read it — outcome unknowable.
            metrics.retryableFailures += 1;
            await store.updateDelivery(delivery.id, {
              status: 'retryable_failure',
              failureCode: 'ReceiptUnavailable',
              lastError: 'no receipt within 24h — outcome unknown',
              updatedAt: nowIso(),
            });
          } else {
            metrics.receiptsPending += 1;
          }
          continue;
        }
        if (receipt.status === 'ok') {
          metrics.receiptsOk += 1;
          await store.updateDelivery(delivery.id, {
            status: 'receipt_ok',
            receiptCheckedAt: nowIso(),
            updatedAt: nowIso(),
          });
          continue;
        }
        const code = receipt.details?.error;
        if (code === 'DeviceNotRegistered') {
          metrics.permanentFailures += 1;
          metrics.tokensDisabled += 1;
          await store.updateDelivery(delivery.id, {
            status: 'permanent_failure',
            failureCode: code,
            lastError: receipt.message.slice(0, 200),
            receiptCheckedAt: nowIso(),
            updatedAt: nowIso(),
          });
          const subscription = subscriptionById.get(delivery.subscriptionId);
          if (subscription?.enabled) {
            subscription.enabled = false;
            await store.disableSubscription(subscription.id, 'device_not_registered', nowIso());
          }
        } else if (isPermanentPushError(code)) {
          metrics.permanentFailures += 1;
          await store.updateDelivery(delivery.id, {
            status: 'permanent_failure',
            failureCode: code ?? 'unknown',
            lastError: receipt.message.slice(0, 200),
            receiptCheckedAt: nowIso(),
            updatedAt: nowIso(),
          });
        } else {
          metrics.retryableFailures += 1;
          await store.updateDelivery(delivery.id, {
            status: 'retryable_failure',
            failureCode: code ?? 'unknown',
            lastError: receipt.message.slice(0, 200),
            receiptCheckedAt: nowIso(),
            updatedAt: nowIso(),
          });
        }
      }
    }
  }

  // ── New deliveries from the ledger (bounded window, oldest first) ──────────
  const lookbackFloor = new Date(now().getTime() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const sinceIso = pushEnabledAt > lookbackFloor ? pushEnabledAt : lookbackFloor;
  const events = await store.listDeliverableEventsSince(sinceIso, maxEvents);
  metrics.eventsExamined = events.length;
  metrics.skippedPreActivation = await store.countDeliverableEventsBefore(pushEnabledAt);
  metrics.suppressedSkipped = await store.countSuppressedEventsSince(sinceIso);

  // Dry runs must report "would be created" accurately: pairs that already
  // have a delivery row (from a previous real run) are not new.
  const existingPairs = new Set<string>();
  if (dryRun) {
    const existing = await store.listDeliveriesByStatus(
      [
        'pending',
        'sending',
        'ticket_accepted',
        'receipt_ok',
        'retryable_failure',
        'permanent_failure',
      ],
      100_000,
    );
    for (const delivery of existing)
      existingPairs.add(`${delivery.eventId}:${delivery.subscriptionId}`);
  }

  const eventById = new Map(events.map((e) => [e.id, e]));
  for (const event of events) {
    const classified = classifySubscriptionsForEvent(
      event,
      subscriptions,
      pushEnabledAt,
      preferencesByInstallation,
    );
    metrics.subscriptionHorizonSkipped += classified.horizonSkipped;
    metrics.preferenceHorizonSkipped += classified.preferenceHorizonSkipped;
    metrics.preferenceSkipped += classified.preferenceSkipped;
    for (const subscription of classified.eligible) {
      if (dryRun) {
        if (!existingPairs.has(`${event.id}:${subscription.id}`)) metrics.deliveriesCreated += 1;
      } else if (await store.createDeliveryIfAbsent(event.id, subscription.id, nowIso())) {
        metrics.deliveriesCreated += 1;
      }
    }
  }

  // ── Send pool: fresh rows, elapsed retryables, crashed 'sending' rows ─────
  const candidates = await store.listDeliveriesByStatus(
    ['pending', 'retryable_failure', 'sending'],
    maxSends * 2,
  );
  const sendPool: DeliveryRow[] = [];
  for (const delivery of candidates) {
    if (delivery.status === 'retryable_failure') {
      if (delivery.attempts >= MAX_SEND_ATTEMPTS) {
        if (!dryRun) {
          metrics.permanentFailures += 1;
          await store.updateDelivery(delivery.id, {
            status: 'permanent_failure',
            failureCode: delivery.failureCode ?? 'attempts_exhausted',
            lastError: `gave up after ${delivery.attempts} attempts`,
            updatedAt: nowIso(),
          });
        }
        continue;
      }
      const elapsed = now().getTime() - new Date(delivery.updatedAt).getTime();
      if (elapsed < retryBackoffMs(Math.max(delivery.attempts, 1))) continue;
    }
    // 'sending' rows can only come from a crashed prior run (the job lease
    // serializes workers) — retry them under the same bounded attempt cap.
    if (delivery.status === 'sending' && delivery.attempts >= MAX_SEND_ATTEMPTS) {
      if (!dryRun) {
        metrics.permanentFailures += 1;
        await store.updateDelivery(delivery.id, {
          status: 'permanent_failure',
          failureCode: 'attempts_exhausted',
          lastError: `gave up after ${delivery.attempts} attempts`,
          updatedAt: nowIso(),
        });
      }
      continue;
    }
    sendPool.push(delivery);
  }
  if (sendPool.length > maxSends) {
    metrics.cappedSends = sendPool.length - maxSends;
    console.log(`  send cap: deferring ${metrics.cappedSends} deliveries to the next run.`);
    sendPool.length = maxSends;
  }

  if (dryRun) {
    // Would-send = new pairs this run would create + the existing pool
    // (pending / elapsed retryable / crashed-sending rows) already due.
    metrics.sent = metrics.deliveriesCreated + sendPool.length;
  }

  if (!dryRun) {
    for (let i = 0; i < sendPool.length; i += MAX_MESSAGES_PER_REQUEST) {
      const chunk = sendPool.slice(i, i + MAX_MESSAGES_PER_REQUEST);
      const prepared: { delivery: DeliveryRow; message: ReturnType<typeof buildPushMessage> }[] =
        [];
      for (const delivery of chunk) {
        const subscription =
          subscriptionById.get(delivery.subscriptionId) ??
          (await store.getSubscription(delivery.subscriptionId));
        if (!subscription || !subscription.enabled) {
          // Disabled since the row was created (user opt-out, dead token):
          // the moment has passed; never deliver on a later re-enable.
          metrics.permanentFailures += 1;
          await store.updateDelivery(delivery.id, {
            status: 'permanent_failure',
            failureCode: 'subscription_disabled',
            lastError: 'subscription disabled before send',
            updatedAt: nowIso(),
          });
          continue;
        }
        const event = eventById.get(delivery.eventId) ?? (await store.getEvent(delivery.eventId));
        if (!event) {
          metrics.permanentFailures += 1;
          await store.updateDelivery(delivery.id, {
            status: 'permanent_failure',
            failureCode: 'event_missing',
            lastError: 'ledger event no longer resolvable',
            updatedAt: nowIso(),
          });
          continue;
        }
        eventById.set(event.id, event);
        prepared.push({ delivery, message: buildPushMessage(event, subscription.expoPushToken) });
      }
      if (prepared.length === 0) continue;

      // Claim BEFORE the HTTP call: a crash mid-send leaves auditable
      // 'sending' rows with the attempt counted, never an untracked send.
      for (const item of prepared) {
        item.delivery.attempts += 1;
        await store.updateDelivery(item.delivery.id, {
          status: 'sending',
          attempts: item.delivery.attempts,
          updatedAt: nowIso(),
        });
      }

      let tickets: PushTicket[];
      try {
        tickets = await transport.send(prepared.map((item) => item.message));
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 200);
        errors.push(`push send failed: ${message}`);
        for (const item of prepared) {
          metrics.retryableFailures += 1;
          await store.updateDelivery(item.delivery.id, {
            status: 'retryable_failure',
            failureCode: 'network',
            lastError: message,
            updatedAt: nowIso(),
          });
        }
        continue;
      }

      metrics.sent += prepared.length;
      for (let j = 0; j < prepared.length; j += 1) {
        const { delivery } = prepared[j];
        const ticket = tickets[j];
        if (ticket.status === 'ok') {
          metrics.ticketsAccepted += 1;
          await store.updateDelivery(delivery.id, {
            status: 'ticket_accepted',
            ticketId: ticket.id,
            failureCode: null,
            lastError: null,
            sentAt: nowIso(),
            updatedAt: nowIso(),
          });
          continue;
        }
        const code = ticket.details?.error;
        if (code === 'DeviceNotRegistered') {
          metrics.permanentFailures += 1;
          metrics.tokensDisabled += 1;
          await store.updateDelivery(delivery.id, {
            status: 'permanent_failure',
            failureCode: code,
            lastError: ticket.message.slice(0, 200),
            updatedAt: nowIso(),
          });
          const subscription = subscriptionById.get(delivery.subscriptionId);
          if (subscription?.enabled) {
            subscription.enabled = false;
            await store.disableSubscription(subscription.id, 'device_not_registered', nowIso());
          }
        } else if (isPermanentPushError(code)) {
          metrics.permanentFailures += 1;
          await store.updateDelivery(delivery.id, {
            status: 'permanent_failure',
            failureCode: code ?? 'unknown',
            lastError: ticket.message.slice(0, 200),
            updatedAt: nowIso(),
          });
        } else {
          metrics.retryableFailures += 1;
          await store.updateDelivery(delivery.id, {
            status: 'retryable_failure',
            failureCode: code ?? 'unknown',
            lastError: ticket.message.slice(0, 200),
            updatedAt: nowIso(),
          });
        }
      }
    }
  }

  console.log(
    `  push delivery${dryRun ? ' (dry run — nothing written, nothing sent)' : ''}: ` +
      `${metrics.eventsExamined} event(s) examined, ${metrics.deliveriesCreated} deliver${dryRun ? 'ies would be created' : 'ies created'}, ` +
      `${metrics.sent} ${dryRun ? 'would be sent' : 'sent'}, ${metrics.ticketsAccepted} ticket(s), ` +
      `${metrics.receiptsQueried} receipt(s) ${dryRun ? 'would be queried' : 'queried'} (${metrics.receiptsOk} ok), ` +
      `${metrics.retryableFailures} retryable / ${metrics.permanentFailures} permanent failure(s), ` +
      `${metrics.tokensDisabled} token(s) disabled.`,
  );
  console.log(
    `  horizons: activation ${pushEnabledAt} — ${metrics.skippedPreActivation} pre-activation ` +
      `deliverable event(s) excluded, ${metrics.suppressedSkipped} suppressed excluded, ` +
      `${metrics.subscriptionHorizonSkipped} subscription-horizon exclusion(s).`,
  );
  console.log(
    `  personalization: ${metrics.preferencesStored} preference record(s) ` +
      `(${metrics.preferencesWithState} with a state) — ` +
      `${metrics.preferenceSkipped} preference exclusion(s), ` +
      `${metrics.preferenceHorizonSkipped} preference-horizon exclusion(s).`,
  );

  return {
    outcome: errors.length > 0 ? 'partial' : 'succeeded',
    metrics,
    error: errors.length > 0 ? errors.join('; ').slice(0, 400) : undefined,
  };
}
