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
 *   relevance evaluation the app renders (src/lib/relevance) — including the
 *   Feed's own answer for a profile with no jurisdiction (2026-10-04): only
 *   an allergen or store signal qualifies, and a profile with nothing chosen
 *   (or no preference row) receives nothing, exactly as Affects You shows
 *   nothing. Delivery is never broader than the Feed.
 * - Event-type eligibility (2026-10-04, event-eligibility.ts): before the
 *   seam, each event is resolved to its canonical case and judged by type —
 *   a new-recall alert only for an active, unmerged case; a retraction only
 *   for a retracted one; any other update only for an active one; an event
 *   on an absorbed duplicate re-pointed at its survivor or dropped as a
 *   double — so an alert never names a recall the Feed would not list and
 *   its tap always has a Detail to open.
 * - Idempotency: the (event, subscription) unique row is created before any
 *   send; reruns and scheduler retries cannot re-enqueue, and a delivery that
 *   already holds a ticket is never re-sent.
 * - Queued rows obey the horizons too (2026-10-10): a pending, retryable or
 *   crash-recovered row whose event predates the CURRENT activation horizon
 *   or its subscription's CURRENT enabled_at fails closed instead of sending
 *   (queuedRowHorizonFailure). Without this, a reactivation after a rollback
 *   — or a disable + re-enable before the next tick — sent rows queued before
 *   it, hours late, and a ticket stranded by a deactivation was re-sent as a
 *   duplicate once its receipt had expired.
 * - Entitlement (2026-10-14, entitlement.ts): alerts stop when a subscription
 *   ends. Each ACTIVATED run first refreshes the cached RevenueCat
 *   entitlement on its fixed schedule (entitlement-refresh.ts). The seam, the
 *   send pool and the send itself then require an active entitlement whose
 *   known expiry is still ahead (the clock gate), whose last check is recent
 *   (the staleness gate, fail closed), and that began before the event (the
 *   no-backlog horizon). An unverified status HOLDS a delivery. A definitive
 *   one fails it, so a lapsed period is never sent later.
 * - Overnight sending hold (D1, 2026-10-14; sending-hold.ts): no send while it
 *   is 22:00–09:59 in America/New_York. Deliveries are still created and
 *   judged as before; due rows wait in the queue for the first run after
 *   10:00, and are judged again at that send. The opt-in scope
 *   `except_new_recalls` (PUSH_OVERNIGHT_HOLD) exempts only fresh new-recall
 *   alerts (sendsDuringHold); the default scope exempts nothing.
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
import { entitlementVerdict } from './entitlement';
import { refreshEntitlements } from './entitlement-refresh';
import type { EntitlementSource } from './revenuecat-entitlement';
import { pushEligible, type RelevanceInput } from '../../lib/relevance';
import type { JobRunOutcome } from '../store/types';
import { decideDelivery, decideRetailerDelivery, type DeliveryDecision } from './event-eligibility';
import {
  appVersionAtLeast,
  RETAILER_ALERTS_MIN_APP_VERSION,
  sameRecallAgencyCases,
} from '../retailer/notice-events';
import type { AgencyCaseView } from '../retailer/types';
import { buildPushMessage } from './format';
import {
  HOLD_TIME_ZONE,
  isSendingHeld,
  sendsDuringHold,
  type SendingHoldScope,
} from './sending-hold';
import {
  ExpoAuthMissingError,
  ExpoRequestError,
  MAX_MESSAGES_PER_REQUEST,
  MAX_RECEIPT_IDS_PER_REQUEST,
  redactPushTokens,
} from './expo-transport';
import type {
  CaseLink,
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

/** A merge chain longer than this is treated as unresolvable, never followed further. */
export const MAX_MERGE_HOPS = 8;

/**
 * Follow an event's case to its canonical destination: the case itself when
 * it is unmerged, else the survivor its tombstone names (and that one's, if
 * it was itself absorbed later). Bounded and cycle-safe; a hop that reads
 * nothing, or a chain that does not settle, resolves to null. Reads are
 * cached per run.
 */
export async function resolveCanonicalCase(
  store: Pick<PushStore, 'getCase'>,
  event: Pick<DeliverableEvent, 'recallCaseId' | 'caseState' | 'mergedInto' | 'projection'>,
  cache: Map<string, CaseLink | null>,
): Promise<CaseLink | null> {
  const read = async (id: string): Promise<CaseLink | null> => {
    if (cache.has(id)) return cache.get(id) ?? null;
    const link = await store.getCase(id);
    cache.set(id, link);
    return link;
  };
  // The event already carries its own case's lifecycle from the join.
  let current: CaseLink | null = {
    id: event.recallCaseId,
    state: event.caseState,
    mergedInto: event.mergedInto,
    projection: event.projection,
  };
  const seen = new Set<string>();
  for (let hop = 0; current !== null && current.mergedInto !== null; hop += 1) {
    if (hop >= MAX_MERGE_HOPS || seen.has(current.id)) return null;
    seen.add(current.id);
    current = await read(current.mergedInto);
  }
  return current;
}

/**
 * The per-event decision (event-eligibility.ts) with its facts read from the
 * store: the canonical destination, and — for an event on an absorbed case —
 * whether the survivor already carries the same change.
 */
/** How far back an agency case can be the same recall as a retailer notice. */
const SAME_RECALL_LOOKBACK_DAYS = 180;

/**
 * Per-run reads the retailer rule needs, cached: each notice's current state
 * and the agency cases it could be the same recall as (the retailer
 * monitor's own view and matcher, notice-events.ts).
 */
export class RetailerRunContext {
  private agencyViews: Promise<AgencyCaseView[]> | null = null;
  private readonly notices = new Map<string, ReturnType<PushStore['getRetailerNotice']>>();

  constructor(
    private readonly store: Pick<PushStore, 'getRetailerNotice' | 'listAgencyCaseViews'>,
    private readonly nowIso: string,
  ) {}

  notice(noticeId: string) {
    if (!this.notices.has(noticeId))
      this.notices.set(noticeId, this.store.getRetailerNotice(noticeId));
    return this.notices.get(noticeId)!;
  }

  agencyCases(): Promise<AgencyCaseView[]> {
    this.agencyViews ??= this.store.listAgencyCaseViews(
      new Date(Date.parse(this.nowIso) - SAME_RECALL_LOOKBACK_DAYS * 86_400_000).toISOString(),
    );
    return this.agencyViews;
  }
}

export async function resolveDeliverableEvent(
  store: Pick<PushStore, 'getCase' | 'hasDeliverableEvent'>,
  event: DeliverableEvent,
  cache: Map<string, CaseLink | null>,
  retailer?: RetailerRunContext,
): Promise<DeliveryDecision> {
  if (event.retailerNoticeId) {
    // A retailer event is never decided by the case rule. Without the
    // context (a caller that predates retailer events) it fails closed.
    if (!retailer) return { kind: 'skip', reason: 'retailer_not_visible' };
    const notice = await retailer.notice(event.retailerNoticeId);
    const sameRecallCaseIds = notice.matchEvidence
      ? sameRecallAgencyCases(notice.matchEvidence, await retailer.agencyCases()).map((c) => c.id)
      : [];
    return decideRetailerDelivery(event, { notice, sameRecallCaseIds });
  }
  const destination = await resolveCanonicalCase(store, event, cache);
  const merged = destination !== null && destination.id !== event.recallCaseId;
  const survivorHasTwin =
    merged && event.kind === 'material_update'
      ? await store.hasDeliverableEvent(
          destination.id,
          event.triggerRuleId,
          event.materialChangeRef,
        )
      : false;
  return decideDelivery(event, { destination, survivorHasTwin });
}

/** The case facts personalization reads, adapted from the joined projection. */
function relevanceInput(event: Pick<DeliverableEvent, 'projection'>): RelevanceInput {
  return {
    geography: event.projection.geography,
    pathogenOrAllergen: event.projection.pathogenOrAllergen ?? null,
    // Projections persisted before the field existed lack the key.
    retailerNames: event.projection.retailerNames ?? [],
    // The allergen-only rule reads these; passing them here is what keeps
    // delivery agreeing with what Home shows for the same recall.
    hazardCategory: event.projection.hazardCategory,
    reasonText: event.projection.reasonText,
  };
}

/**
 * The preferences delivery may use (2026-10-13): allergens count ONLY when
 * the row carries an allergen consent version. Rows written before consent
 * existed, by older clients, or after a withdrawal are matched on states and
 * stores alone. The relevance evaluation itself is unchanged; it is simply
 * not given allergens the shopper has not agreed to use for alerts.
 */
function toUserPreferences(prefs: InstallationPreferences): UserRecallPreferences {
  return {
    states: prefs.stateCodes,
    allergens: prefs.allergenConsentVersion ? prefs.allergens : [],
    retailers: prefs.retailerIds,
  };
}

export interface EventEligibility {
  eligible: PushSubscription[];
  /** Excluded by the C2 horizons (activation / subscription enabled_at). */
  horizonSkipped: number;
  /** Excluded by a definitive entitlement verdict (inactive, expired, before the horizon). */
  entitlementSkipped: number;
  /** Held: the entitlement is unverified (never checked, or stale). Re-examined next run. */
  entitlementUnverified: number;
  /**
   * Excluded because the event predates the installation's last preference
   * change — the no-retroactive-blast guarantee: adding an allergen or
   * moving states can never make an OLD event newly deliverable.
   */
  preferenceHorizonSkipped: number;
  /** Excluded by personalized matching (state / allergen / retailer). */
  preferenceSkipped: number;
  /** A retailer-notice alert, for an app version that cannot open one. */
  clientUnsupportedSkipped: number;
  /** An agency new-recall alert for a recall this subscription was already alerted to. */
  duplicateAlertSkipped: number;
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
 * 2. Entitlement (entitlement.ts `entitlementVerdict`): an active
 *    subscription whose known expiry is still ahead, checked recently, and
 *    entitled since before the event. Nothing is created otherwise; the event
 *    is re-examined next run, when only a passing verdict can create a row.
 * 3. Preference matching (src/lib/relevance `pushEligible` — the Affects
 *    You verdict the app renders): with any jurisdiction chosen, deliver on
 *    geographic match (nationwide always matches, and one chosen jurisdiction
 *    in the source's own state list is enough) or unknown geography with an
 *    allergen/retailer signal; an authoritative geographic exclusion never
 *    delivers. With no jurisdiction chosen, only an allergen or store
 *    signal qualifies; with nothing chosen, or no preference row, nothing
 *    is delivered (2026-10-04 — formerly deliver-all).
 */
export function classifySubscriptionsForEvent(
  event: Pick<DeliverableEvent, 'createdAt' | 'projection' | 'retailerNoticeId'>,
  subscriptions: PushSubscription[],
  pushEnabledAt: string,
  preferences: Map<string, InstallationPreferences>,
  nowIso: string,
  options: {
    /**
     * Subscriptions already alerted to this same recall through a retailer
     * notice: an agency `initial` for it would be a second new-recall alert.
     */
    alreadyAlerted?: ReadonlySet<string>;
  } = {},
): EventEligibility {
  const result: EventEligibility = {
    eligible: [],
    horizonSkipped: 0,
    entitlementSkipped: 0,
    entitlementUnverified: 0,
    preferenceHorizonSkipped: 0,
    preferenceSkipped: 0,
    clientUnsupportedSkipped: 0,
    duplicateAlertSkipped: 0,
  };
  const input = relevanceInput(event);
  for (const subscription of subscriptions) {
    if (!subscription.enabled) continue;
    // A retailer notice opens only in an app that can show it.
    if (
      event.retailerNoticeId &&
      !appVersionAtLeast(subscription.appVersion, RETAILER_ALERTS_MIN_APP_VERSION)
    ) {
      result.clientUnsupportedSkipped += 1;
      continue;
    }
    if (options.alreadyAlerted?.has(subscription.id)) {
      result.duplicateAlertSkipped += 1;
      continue;
    }
    const prefs = preferences.get(subscription.installationId) ?? null;
    const c2Horizon =
      subscription.enabledAt > pushEnabledAt ? subscription.enabledAt : pushEnabledAt;
    const horizon = prefs && prefs.updatedAt > c2Horizon ? prefs.updatedAt : c2Horizon;
    if (event.createdAt < horizon) {
      if (event.createdAt >= c2Horizon) result.preferenceHorizonSkipped += 1;
      else result.horizonSkipped += 1;
      continue;
    }
    const verdict = entitlementVerdict(subscription.entitlement, event.createdAt, nowIso);
    if (verdict === 'unverified') {
      result.entitlementUnverified += 1;
      continue;
    }
    if (verdict !== 'entitled') {
      result.entitlementSkipped += 1;
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
  preferences: Map<string, InstallationPreferences>,
  nowIso: string,
): PushSubscription[] {
  return classifySubscriptionsForEvent(event, subscriptions, pushEnabledAt, preferences, nowIso)
    .eligible;
}

/**
 * The entitlement check for a QUEUED row, at the send pool and again at the
 * send itself: `hold` leaves the row untouched for a later run (the status
 * is unverified), `not_entitled` fails it for good (no backlog), null sends.
 */
export function queuedRowEntitlement(
  subscription: Pick<PushSubscription, 'entitlement'>,
  eventCreatedAt: string,
  nowIso: string,
): 'hold' | 'not_entitled' | null {
  const verdict = entitlementVerdict(subscription.entitlement, eventCreatedAt, nowIso);
  if (verdict === 'entitled') return null;
  return verdict === 'unverified' ? 'hold' : 'not_entitled';
}

/**
 * Why a QUEUED delivery row may no longer be sent, judged against the
 * horizons as they stand now rather than when the row was created:
 * - `before_activation`: the event predates the current activation horizon,
 *   so push was deactivated and reactivated since the row was queued;
 * - `before_subscription`: the event predates the subscription's current
 *   enabled_at, so alerts were turned off and on again since.
 * A row created by a run under the current horizons always passes: creation
 * required the event to postdate both. Preference changes are deliberately
 * NOT re-judged here — matching is decided once, at creation, by the seam.
 */
export function queuedRowHorizonFailure(
  eventCreatedAt: string,
  subscriptionEnabledAt: string,
  pushEnabledAt: string,
): 'before_activation' | 'before_subscription' | null {
  if (eventCreatedAt < pushEnabledAt) return 'before_activation';
  if (eventCreatedAt < subscriptionEnabledAt) return 'before_subscription';
  return null;
}

export interface PushWorkerOptions {
  transport: PushTransport;
  /**
   * RevenueCat's view of the `premium` entitlement. null = not configured:
   * every alert is held (fail closed), and the run reports it.
   */
  entitlements: EntitlementSource | null;
  /**
   * The overnight sending hold. Production never sets it, so it is always
   * the real rule (sending-hold.ts); tests about other behavior pass a clock
   * that is never held.
   */
  sendingHold?: (instant: Date) => boolean;
  /**
   * Which due deliveries the hold covers (sending-hold.ts). Default `all`,
   * the D1 rule. `except_new_recalls` sends fresh new-recall alerts during the
   * hold hours; production reads it from PUSH_OVERNIGHT_HOLD.
   */
  sendingHoldScope?: SendingHoldScope;
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

  // ── Entitlement refresh (fixed schedule, before any matching) ─────────────
  const refresh = await refreshEntitlements(store, options.entitlements, {
    nowIso: nowIso(),
    dryRun,
  });
  for (const subscription of subscriptions) {
    const updated = refresh.updated.get(subscription.id);
    if (updated) subscription.entitlement = updated;
  }

  const preferences = await store.listPreferences();
  const preferencesByInstallation = new Map(preferences.map((p) => [p.installationId, p]));

  const metrics = {
    activation: pushEnabledAt,
    subscriptionsActive: subscriptions.length,
    preferencesStored: preferences.length,
    preferencesWithState: preferences.filter((p) => p.stateCodes.length > 0).length,
    eventsExamined: 0,
    skippedPreActivation: 0,
    suppressedSkipped: 0,
    subscriptionHorizonSkipped: 0,
    preferenceHorizonSkipped: 0,
    preferenceSkipped: 0,
    ...refresh.metrics,
    /** Per (event, subscription) pair, at matching. */
    entitlementSkipped: 0,
    entitlementUnverified: 0,
    /** Queued rows held (unverified) or failed (not entitled) at the pool or the send. */
    queuedEntitlementHeld: 0,
    queuedNotEntitled: 0,
    /** Event-type eligibility (event-eligibility.ts), counted per event. */
    lifecycleSkipped: 0,
    mergedDuplicateSkipped: 0,
    destinationUnresolved: 0,
    /** Retailer-notice events no longer shown by the app (withdrawn, revised, matched). */
    retailerNotVisibleSkipped: 0,
    /** Retailer-notice events an agency case now announces as the same recall. */
    agencyDuplicateSkipped: 0,
    /** Per pair: retailer alerts not created for app versions that cannot open them. */
    clientUnsupportedSkipped: 0,
    /** Per pair: agency new-recall alerts a retailer alert already announced. */
    duplicateAlertSkipped: 0,
    reroutedToSurvivor: 0,
    deliveriesCreated: 0,
    sent: 0,
    ticketsAccepted: 0,
    receiptsQueried: 0,
    receiptsOk: 0,
    receiptsPending: 0,
    retryableFailures: 0,
    permanentFailures: 0,
    tokensDisabled: 0,
    /** Queued rows failed closed by queuedRowHorizonFailure (would-fail in a dry run). */
    queuedBeforeHorizon: 0,
    cappedSends: 0,
    /** The overnight sending hold (sending-hold.ts) was in force for this run's sends. */
    sendingHeld: false,
    /** Due deliveries left queued by the hold (in a dry run: would be left queued). */
    sendingHoldDeferred: 0,
    /**
     * Due deliveries sent despite the hold hours because the hold scope
     * exempts them (sendsDuringHold: a fresh new-recall alert). Always 0
     * under the default scope, `all`.
     */
    sendingHoldExempted: 0,
    /** Messages handed to the provider this run (each one attempt). */
    sendAttempted: 0,
    /** Whole requests the provider rejected or that never completed. */
    requestFailures: 0,
    /**
     * Due deliveries and receipt checks NOT attempted because the transport
     * cannot authenticate (no access token). Their attempts are not spent.
     */
    authBlocked: 0,
  };
  const errors: string[] = [...refresh.errors];
  // A failure no retry of the same request can fix (no credential, an
  // authentication refusal). Any such failure makes the run FAILED, so the
  // workflow fails visibly instead of recording a routine partial.
  let systemicFailure: string | null = null;
  const authProblem = transport.authProblem?.() ?? null;
  // Per-recipient ticket/receipt errors other than DeviceNotRegistered (a
  // normal uninstall outcome). Decides whether a run with sends but no
  // accepted ticket failed.
  let recipientFailures = 0;
  if (options.entitlements === null)
    errors.push('entitlement check not configured: all alerts held');
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
  } else if (authProblem !== null && receiptDue.length > 0) {
    // Receipts wait as ticket_accepted; the run fails below.
    metrics.authBlocked += receiptDue.length;
    systemicFailure = authProblem;
  } else {
    for (let i = 0; i < receiptDue.length; i += MAX_RECEIPT_IDS_PER_REQUEST) {
      const chunk = receiptDue.slice(i, i + MAX_RECEIPT_IDS_PER_REQUEST);
      let receipts: Record<string, PushReceipt>;
      try {
        receipts = await transport.getReceipts(chunk.map((d) => d.ticketId as string));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`receipt fetch failed: ${message}`);
        metrics.requestFailures += 1;
        if (isSystemic(error)) {
          systemicFailure = message;
          break; // the same credential fails every chunk
        }
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
            lastError: redactPushTokens(receipt.message).slice(0, 200),
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
            lastError: redactPushTokens(receipt.message).slice(0, 200),
            receiptCheckedAt: nowIso(),
            updatedAt: nowIso(),
          });
        } else {
          metrics.retryableFailures += 1;
          await store.updateDelivery(delivery.id, {
            status: 'retryable_failure',
            failureCode: code ?? 'unknown',
            lastError: redactPushTokens(receipt.message).slice(0, 200),
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
  const events = [
    ...(await store.listDeliverableEventsSince(sinceIso, maxEvents)),
    ...(await store.listDeliverableRetailerEventsSince(sinceIso, maxEvents)),
  ]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, maxEvents);
  metrics.eventsExamined = events.length;
  const retailerRun = new RetailerRunContext(store, nowIso());
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

  // Resolve each event to its canonical destination and judge it by type
  // BEFORE any subscription is considered (event-eligibility.ts). The map
  // holds the RESOLVED events, so the send pool formats what was decided.
  const caseCache = new Map<string, CaseLink | null>();
  const skipReasons = {
    lifecycle: 'lifecycleSkipped',
    merged_duplicate: 'mergedDuplicateSkipped',
    unresolved: 'destinationUnresolved',
    retailer_not_visible: 'retailerNotVisibleSkipped',
    agency_duplicate: 'agencyDuplicateSkipped',
  } as const;
  const eventById = new Map<string, DeliverableEvent>();
  const deliverable: DeliverableEvent[] = [];
  for (const event of events) {
    const decision = await resolveDeliverableEvent(store, event, caseCache, retailerRun);
    if (decision.kind === 'skip') {
      metrics[skipReasons[decision.reason]] += 1;
      continue;
    }
    if (decision.rerouted) metrics.reroutedToSurvivor += 1;
    eventById.set(decision.event.id, decision.event);
    deliverable.push(decision.event);
  }
  // One recall, one new-recall alert: a subscription already alerted through
  // a retailer notice is not alerted again by the agency case for the same
  // recall (the monitor's own matcher decides "same").
  let retailerRecipients: Awaited<ReturnType<PushStore['listRetailerAlertRecipients']>> | null =
    null;
  const alreadyAlertedFor = async (event: DeliverableEvent): Promise<Set<string>> => {
    if (event.retailerNoticeId || event.kind !== 'initial') return new Set();
    retailerRecipients ??= await store.listRetailerAlertRecipients(
      new Date(now().getTime() - SAME_RECALL_LOOKBACK_DAYS * 86_400_000).toISOString(),
    );
    const view = (await retailerRun.agencyCases()).find((c) => c.id === event.recallCaseId);
    const alerted = new Set<string>();
    if (!view) return alerted;
    for (const { noticeId, subscriptionIds } of retailerRecipients) {
      const notice = await retailerRun.notice(noticeId);
      if (!notice.matchEvidence) continue;
      if (sameRecallAgencyCases(notice.matchEvidence, [view]).length === 0) continue;
      for (const id of subscriptionIds) alerted.add(id);
    }
    return alerted;
  };

  // Dry runs create no rows, so the hold scope reads would-create pairs here.
  const dryRunCreatedByEvent = new Map<string, number>();
  for (const event of deliverable) {
    const classified = classifySubscriptionsForEvent(
      event,
      subscriptions,
      pushEnabledAt,
      preferencesByInstallation,
      nowIso(),
      { alreadyAlerted: await alreadyAlertedFor(event) },
    );
    metrics.clientUnsupportedSkipped += classified.clientUnsupportedSkipped;
    metrics.duplicateAlertSkipped += classified.duplicateAlertSkipped;
    metrics.subscriptionHorizonSkipped += classified.horizonSkipped;
    metrics.entitlementSkipped += classified.entitlementSkipped;
    metrics.entitlementUnverified += classified.entitlementUnverified;
    metrics.preferenceHorizonSkipped += classified.preferenceHorizonSkipped;
    metrics.preferenceSkipped += classified.preferenceSkipped;
    for (const subscription of classified.eligible) {
      if (dryRun) {
        if (!existingPairs.has(`${event.id}:${subscription.id}`)) {
          metrics.deliveriesCreated += 1;
          dryRunCreatedByEvent.set(event.id, (dryRunCreatedByEvent.get(event.id) ?? 0) + 1);
        }
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
  // Ledger reads for rows whose event is not in this run's map, shared with
  // the send loop below.
  const ledgerReads = new Map<string, DeliverableEvent | null>();
  const readLedgered = async (eventId: string): Promise<DeliverableEvent | null> => {
    if (!ledgerReads.has(eventId)) ledgerReads.set(eventId, await store.getEvent(eventId));
    return ledgerReads.get(eventId) ?? null;
  };
  for (const delivery of candidates) {
    // The horizons as they stand NOW, before backoff: a row queued before a
    // deactivation or a re-enable is settled at once, never sent late. A
    // missing event or subscription is left to the send loop's own checks.
    const queuedEvent = eventById.get(delivery.eventId) ?? (await readLedgered(delivery.eventId));
    const queuedSubscription =
      subscriptionById.get(delivery.subscriptionId) ??
      (await store.getSubscription(delivery.subscriptionId));
    if (queuedEvent && queuedSubscription) {
      const reason = queuedRowHorizonFailure(
        queuedEvent.createdAt,
        queuedSubscription.enabledAt,
        pushEnabledAt,
      );
      if (reason !== null) {
        metrics.queuedBeforeHorizon += 1;
        if (!dryRun) {
          metrics.permanentFailures += 1;
          await store.updateDelivery(delivery.id, {
            status: 'permanent_failure',
            failureCode: reason,
            lastError: `event predates the current ${reason === 'before_activation' ? 'activation' : 'subscription'} horizon`,
            updatedAt: nowIso(),
          });
        }
        continue;
      }
      // A disabled subscription is settled by the send loop (subscription_disabled).
      const entitlement = queuedSubscription.enabled
        ? queuedRowEntitlement(queuedSubscription, queuedEvent.createdAt, nowIso())
        : null;
      if (entitlement === 'hold') {
        metrics.queuedEntitlementHeld += 1;
        continue;
      }
      if (entitlement === 'not_entitled') {
        metrics.queuedNotEntitled += 1;
        if (!dryRun) {
          metrics.permanentFailures += 1;
          await store.updateDelivery(delivery.id, {
            status: 'permanent_failure',
            failureCode: 'not_entitled',
            lastError: 'subscription not entitled for this event',
            updatedAt: nowIso(),
          });
        }
        continue;
      }
    }
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
  // ── Overnight sending hold (D1): 22:00–09:59 America/New_York ─────────────
  // Every row above was judged exactly as before; the hold only decides WHEN
  // the due ones are handed to Expo. Held rows stay queued and are judged
  // again at the next run's send, entitlement and clock gates included.
  // The hold scope (sending-hold.ts) may exempt fresh new-recall alerts; under
  // the default scope, `all`, nothing is exempt and this is the D1 rule.
  let dryRunDueCreated = dryRun ? metrics.deliveriesCreated : 0;
  if ((options.sendingHold ?? isSendingHeld)(now())) {
    const scope = options.sendingHoldScope ?? 'all';
    const sendAt = now();
    const exempt = async (eventId: string): Promise<boolean> => {
      const event = eventById.get(eventId) ?? (await readLedgered(eventId));
      return event !== null && sendsDuringHold(scope, event, sendAt);
    };
    const released: DeliveryRow[] = [];
    for (const delivery of sendPool) if (await exempt(delivery.eventId)) released.push(delivery);
    let releasedCreated = 0;
    for (const [eventId, count] of dryRunCreatedByEvent) {
      if (await exempt(eventId)) releasedCreated += count;
    }
    metrics.sendingHeld = true;
    metrics.sendingHoldExempted = released.length + releasedCreated;
    metrics.sendingHoldDeferred =
      sendPool.length - released.length + (dryRunDueCreated - releasedCreated);
    console.log(
      `  overnight hold (22:00–10:00 ${HOLD_TIME_ZONE}, scope ${scope}): ` +
        `${metrics.sendingHoldDeferred} deliveries wait for 10:00` +
        (scope === 'all' ? '.' : `, ${metrics.sendingHoldExempted} new-recall alerts send now.`),
    );
    sendPool.length = 0;
    sendPool.push(...released);
    dryRunDueCreated = releasedCreated;
  }
  if (sendPool.length > maxSends) {
    metrics.cappedSends = sendPool.length - maxSends;
    console.log(`  send cap: deferring ${metrics.cappedSends} deliveries to the next run.`);
    sendPool.length = maxSends;
  }

  // ── Authentication preflight: never spend an attempt on a request the
  //    provider must refuse. The due rows stay exactly as they are. ─────────
  if (authProblem !== null) {
    const due = sendPool.length + dryRunDueCreated;
    if (due > 0) {
      metrics.authBlocked += due;
      systemicFailure = authProblem;
      console.log(`  push transport cannot authenticate: ${due} due deliveries left queued.`);
      if (!dryRun) sendPool.length = 0;
    }
  }

  if (dryRun) {
    // Would-send = new pairs this run would create + the existing pool
    // (pending / elapsed retryable / crashed-sending rows) already due.
    // Held rows are already out of the pool; exempt would-create pairs stay due.
    metrics.sent = dryRunDueCreated + sendPool.length;
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
        let event = eventById.get(delivery.eventId) ?? null;
        if (event === null) {
          // A retry or crash-recovered row from an earlier run: the case may
          // have closed, been retracted or been merged since the row was
          // created, so the same per-event decision is made again now.
          const ledgered = await readLedgered(delivery.eventId);
          const decision = ledgered
            ? await resolveDeliverableEvent(store, ledgered, caseCache, retailerRun)
            : null;
          if (decision?.kind === 'deliver') {
            event = decision.event;
            eventById.set(event.id, event);
          } else {
            metrics.permanentFailures += 1;
            await store.updateDelivery(delivery.id, {
              status: 'permanent_failure',
              failureCode: decision ? `case_${decision.reason}` : 'event_missing',
              lastError: decision
                ? `case no longer eligible before send (${decision.reason})`
                : 'ledger event no longer resolvable',
              updatedAt: nowIso(),
            });
            continue;
          }
        }
        // The clock moves during a run: known expiry is enforced at the send.
        const entitlement = queuedRowEntitlement(subscription, event.createdAt, nowIso());
        if (entitlement === 'hold') {
          metrics.queuedEntitlementHeld += 1;
          continue;
        }
        if (entitlement === 'not_entitled') {
          metrics.queuedNotEntitled += 1;
          metrics.permanentFailures += 1;
          await store.updateDelivery(delivery.id, {
            status: 'permanent_failure',
            failureCode: 'not_entitled',
            lastError: 'subscription not entitled for this event',
            updatedAt: nowIso(),
          });
          continue;
        }
        prepared.push({
          delivery,
          message: buildPushMessage(event, subscription.expoPushToken, nowIso()),
        });
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
      metrics.sendAttempted += prepared.length;
      try {
        tickets = await transport.send(prepared.map((item) => item.message));
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 200);
        errors.push(`push send failed: ${message}`);
        metrics.requestFailures += 1;
        for (const item of prepared) {
          metrics.retryableFailures += 1;
          await store.updateDelivery(item.delivery.id, {
            status: 'retryable_failure',
            failureCode: requestFailureCode(error),
            lastError: message,
            updatedAt: nowIso(),
          });
        }
        if (isSystemic(error)) {
          // Every later chunk carries the same credential: stop here, and
          // leave the remaining due rows queued with their attempts unspent.
          systemicFailure = message;
          break;
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
            lastError: redactPushTokens(ticket.message).slice(0, 200),
            updatedAt: nowIso(),
          });
          const subscription = subscriptionById.get(delivery.subscriptionId);
          if (subscription?.enabled) {
            subscription.enabled = false;
            await store.disableSubscription(subscription.id, 'device_not_registered', nowIso());
          }
        } else if (isPermanentPushError(code)) {
          recipientFailures += 1;
          metrics.permanentFailures += 1;
          await store.updateDelivery(delivery.id, {
            status: 'permanent_failure',
            failureCode: code ?? 'unknown',
            lastError: redactPushTokens(ticket.message).slice(0, 200),
            updatedAt: nowIso(),
          });
        } else {
          recipientFailures += 1;
          metrics.retryableFailures += 1;
          await store.updateDelivery(delivery.id, {
            status: 'retryable_failure',
            failureCode: code ?? 'unknown',
            lastError: redactPushTokens(ticket.message).slice(0, 200),
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
      `${metrics.subscriptionHorizonSkipped} subscription-horizon exclusion(s), ` +
      `${metrics.queuedBeforeHorizon} queued row(s) ${dryRun ? 'would be ' : ''}failed closed by the current horizons.`,
  );
  console.log(
    `  event eligibility: ${metrics.lifecycleSkipped} lifecycle exclusion(s), ` +
      `${metrics.mergedDuplicateSkipped} merged-duplicate exclusion(s), ` +
      `${metrics.destinationUnresolved} unresolved destination(s), ` +
      `${metrics.reroutedToSurvivor} re-pointed at a surviving case.`,
  );
  console.log(
    `  personalization: ${metrics.preferencesStored} preference record(s) ` +
      `(${metrics.preferencesWithState} with a state) — ` +
      `${metrics.preferenceSkipped} preference exclusion(s), ` +
      `${metrics.preferenceHorizonSkipped} preference-horizon exclusion(s).`,
  );

  // FAILED when delivery is broken as a whole: a systemic failure, or this
  // run handed messages to Expo and not one was accepted (DeviceNotRegistered
  // alone is a normal outcome, not a failure). A run with nothing to send
  // stays succeeded; isolated failures beside accepted sends stay partial.
  const nothingAccepted =
    metrics.sendAttempted > 0 &&
    metrics.ticketsAccepted === 0 &&
    (metrics.requestFailures > 0 || recipientFailures > 0);
  if (systemicFailure !== null && !errors.some((e) => e.includes(systemicFailure as string))) {
    errors.unshift(`push delivery blocked: ${systemicFailure}`);
  } else if (nothingAccepted && systemicFailure === null) {
    errors.unshift(`push delivery failed: 0 of ${metrics.sendAttempted} message(s) accepted`);
  }
  const failed = systemicFailure !== null || nothingAccepted;
  return {
    outcome: failed ? 'failed' : errors.length > 0 ? 'partial' : 'succeeded',
    metrics,
    error: errors.length > 0 ? errors.join('; ').slice(0, 400) : undefined,
  };
}

/** A provider failure no retry of the same request can fix (see expo-transport.ts). */
function isSystemic(error: unknown): boolean {
  return (
    (error instanceof ExpoRequestError || error instanceof ExpoAuthMissingError) && error.systemic
  );
}

/** A delivery row's code for a whole-request failure: Expo's sanitized code where known. */
function requestFailureCode(error: unknown): string {
  if (error instanceof ExpoRequestError) return error.failureCode;
  if (error instanceof ExpoAuthMissingError) return 'auth_missing';
  return 'network';
}
