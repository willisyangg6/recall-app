/**
 * In-memory PushStore for deterministic tests. Behavior mirrors the SQL in
 * the push_delivery migration — the (event, subscription) unique pair, and
 * the register/disable RPC semantics (idempotent re-registration keeps the
 * enabled_at horizon; re-enabling after a disable moves it; a token claimed
 * by a new installation disables the stale one) — so tests prove the same
 * invariants production relies on.
 */

import { randomUUID } from 'node:crypto';

import type {
  CaseLink,
  DeliverableEvent,
  DeliveryPatch,
  DeliveryRow,
  DeliveryStatus,
  InstallationPreferences,
  PushStore,
  PushSubscription,
} from './types';

/** What the sequenced RPCs return: the gate's decision and the sequence now recorded. */
export interface SequencedWriteResult {
  applied: boolean;
  lastSequence: number;
}

interface SubscriptionRow extends PushSubscription {
  disabledAt: string | null;
  disabledReason: string | null;
}

/**
 * An event as the ledger holds it: the case's lifecycle is NOT stored on the
 * event — it is joined from `cases` at read time, exactly as the SQL store
 * joins `recall_cases`, so a test that closes or merges a case after adding
 * an event sees the change on the next read.
 */
interface StoredEvent extends Omit<
  DeliverableEvent,
  'caseState' | 'mergedInto' | 'projection' | 'materialChangeRef'
> {
  suppressed: string | null;
  materialChangeRef: string | null;
}

export class MemoryPushStore implements PushStore {
  pushEnabledAt: string | null = null;
  subscriptions = new Map<string, SubscriptionRow>();
  events: StoredEvent[] = [];
  deliveries = new Map<string, DeliveryRow>();
  preferences = new Map<string, InstallationPreferences>();
  /** The recall_cases rows the events join: lifecycle, tombstone, projection. */
  cases = new Map<string, CaseLink>();

  // ── Test setup helpers ─────────────────────────────────────────────────────

  /** Register (or update) a case row; an event's case defaults to active and unmerged. */
  setCase(link: Omit<CaseLink, 'state' | 'mergedInto'> & Partial<CaseLink>): void {
    this.cases.set(link.id, {
      id: link.id,
      projection: link.projection,
      state: link.state ?? 'active',
      mergedInto: link.mergedInto ?? null,
    });
  }

  /** Mark `absorbedId` as reconciled into `survivorId` (the duplicate-merge write). */
  merge(absorbedId: string, survivorId: string): void {
    const absorbed = this.cases.get(absorbedId);
    if (!absorbed) throw new Error(`unknown case ${absorbedId}`);
    absorbed.mergedInto = survivorId;
  }

  addEvent(
    event: Omit<StoredEvent, 'suppressed' | 'materialChangeRef'> & {
      suppressed?: string | null;
      materialChangeRef?: string | null;
      /** The case's projection; registers the case as active and unmerged unless set already. */
      projection: CaseLink['projection'];
    },
  ): void {
    const { projection, ...rest } = event;
    if (!this.cases.has(event.recallCaseId)) {
      this.setCase({ id: event.recallCaseId, projection });
    }
    this.events.push({
      ...rest,
      suppressed: event.suppressed ?? null,
      materialChangeRef: event.materialChangeRef ?? null,
    });
  }

  private join(event: StoredEvent): DeliverableEvent {
    const link = this.cases.get(event.recallCaseId);
    if (!link) throw new Error(`notification event ${event.id} has no joined recall case`);
    const { suppressed: _suppressed, ...rest } = event;
    return {
      ...rest,
      caseState: link.state,
      mergedInto: link.mergedInto,
      projection: link.projection,
    };
  }

  /**
   * push_installation_sequences, mirrored (2026-10-04): the highest write
   * sequence applied per installation and the operation that carried it. A
   * lower sequence is refused; an equal one applies only for the same
   * operation (the same write retried); none (a legacy client) applies only
   * while the installation has never written with a sequence. Every write
   * reports the decision and the sequence now recorded.
   */
  sequences = new Map<string, { sequence: number; operation: 'register' | 'disable' }>();

  private gate(
    installationId: string,
    sequence: number | undefined,
    operation: 'register' | 'disable',
  ): SequencedWriteResult {
    const last = this.sequences.get(installationId);
    if (sequence === undefined) {
      return { applied: last === undefined, lastSequence: last?.sequence ?? 0 };
    }
    if (!Number.isInteger(sequence) || sequence < 1) throw new Error('invalid sequence');
    if (
      last !== undefined &&
      (last.sequence > sequence || (last.sequence === sequence && last.operation !== operation))
    ) {
      return { applied: false, lastSequence: last.sequence };
    }
    this.sequences.set(installationId, { sequence, operation });
    return { applied: true, lastSequence: sequence };
  }

  /** The register_push_subscription RPC's semantics, mirrored. */
  register(
    installationId: string,
    expoPushToken: string,
    platform: 'ios' | 'android',
    nowIso: string,
    sequence?: number,
  ): SequencedWriteResult {
    const decision = this.gate(installationId, sequence, 'register');
    if (!decision.applied) return decision;
    for (const row of this.subscriptions.values()) {
      if (
        row.expoPushToken === expoPushToken &&
        row.installationId !== installationId &&
        row.enabled
      ) {
        row.enabled = false;
        row.disabledAt = nowIso;
        row.disabledReason = 'token_reassigned';
      }
    }
    const existing = [...this.subscriptions.values()].find(
      (row) => row.installationId === installationId,
    );
    if (existing) {
      existing.expoPushToken = expoPushToken;
      existing.platform = platform;
      if (!existing.enabled) existing.enabledAt = nowIso;
      existing.enabled = true;
      existing.disabledAt = null;
      existing.disabledReason = null;
      return decision;
    }
    const id = randomUUID();
    this.subscriptions.set(id, {
      id,
      installationId,
      expoPushToken,
      platform,
      enabled: true,
      enabledAt: nowIso,
      disabledAt: null,
      disabledReason: null,
    });
    return decision;
  }

  /** The disable_push_subscription RPC's semantics, mirrored. */
  disable(installationId: string, nowIso: string, sequence?: number): SequencedWriteResult {
    const decision = this.gate(installationId, sequence, 'disable');
    if (!decision.applied) return decision;
    for (const row of this.subscriptions.values()) {
      if (row.installationId === installationId && row.enabled) {
        row.enabled = false;
        row.disabledAt = nowIso;
        row.disabledReason = 'user_disabled';
      }
    }
    return decision;
  }

  /** The delete_installation_data RPC's semantics, mirrored. */
  deleteInstallation(installationId: string): void {
    for (const [id, row] of this.subscriptions) {
      if (row.installationId === installationId) {
        for (const [deliveryId, delivery] of this.deliveries) {
          if (delivery.subscriptionId === id) this.deliveries.delete(deliveryId);
        }
        this.subscriptions.delete(id);
      }
    }
    this.sequences.delete(installationId);
    this.preferences.delete(installationId);
  }

  /** The row for one installation, as the server holds it; null when none. */
  subscriptionOf(installationId: string): SubscriptionRow | null {
    return (
      [...this.subscriptions.values()].find((r) => r.installationId === installationId) ?? null
    );
  }

  /**
   * The set_installation_preferences RPC's semantics, mirrored: values are
   * normalized to sorted distinct arrays, and writing IDENTICAL values is a
   * strict no-op — updated_at (the delivery-safety horizon) does not move.
   */
  setPreferences(
    installationId: string,
    prefs: { stateCodes: string[]; allergens: string[]; retailerIds: string[] },
    nowIso: string,
  ): void {
    const stateCodes = [...new Set(prefs.stateCodes)].sort();
    const allergens = [...new Set(prefs.allergens)].sort();
    const retailerIds = [...new Set(prefs.retailerIds)].sort();
    const existing = this.preferences.get(installationId);
    if (
      existing &&
      existing.stateCodes.join('|') === stateCodes.join('|') &&
      existing.allergens.join('|') === allergens.join('|') &&
      existing.retailerIds.join('|') === retailerIds.join('|')
    ) {
      return;
    }
    this.preferences.set(installationId, {
      installationId,
      stateCodes,
      allergens,
      retailerIds,
      updatedAt: nowIso,
    });
  }

  /** The disable_push_subscription RPC's semantics, mirrored. */
  userDisable(installationId: string, nowIso: string): void {
    for (const row of this.subscriptions.values()) {
      if (row.installationId === installationId && row.enabled) {
        row.enabled = false;
        row.disabledAt = nowIso;
        row.disabledReason = 'user_disabled';
      }
    }
  }

  /**
   * The delete_installation_data RPC's semantics (C7.1 migration), mirrored:
   * shape-validate the id, then — atomically in SQL — delete the
   * installation's delivery rows, its subscription rows, and its preference
   * row, in FK order. Idempotent, void, and scope-exact: rows keyed by any
   * OTHER installation id, and the shared events, are never touched. All
   * mutations here are synchronous, mirroring the single-transaction
   * all-or-nothing property.
   */
  deleteInstallationData(installationId: string): void {
    if (!/^[A-Za-z0-9-]{16,64}$/.test(installationId)) {
      throw new Error('invalid installation id');
    }
    const subscriptionIds = new Set(
      [...this.subscriptions.values()]
        .filter((row) => row.installationId === installationId)
        .map((row) => row.id),
    );
    for (const [id, delivery] of this.deliveries) {
      if (subscriptionIds.has(delivery.subscriptionId)) this.deliveries.delete(id);
    }
    for (const id of subscriptionIds) this.subscriptions.delete(id);
    this.preferences.delete(installationId);
  }

  // ── PushStore ──────────────────────────────────────────────────────────────

  async getPushEnabledAt(): Promise<string | null> {
    return this.pushEnabledAt;
  }

  async listEnabledSubscriptions(): Promise<PushSubscription[]> {
    return [...this.subscriptions.values()].filter((row) => row.enabled);
  }

  async disableSubscription(id: string, reason: string, at: string): Promise<void> {
    const row = this.subscriptions.get(id);
    if (!row) throw new Error(`unknown subscription ${id}`);
    row.enabled = false;
    row.disabledAt = at;
    row.disabledReason = reason;
  }

  async listPreferences(): Promise<InstallationPreferences[]> {
    return [...this.preferences.values()].map((p) => ({ ...p }));
  }

  async listDeliverableEventsSince(sinceIso: string, limit: number): Promise<DeliverableEvent[]> {
    return this.events
      .filter((event) => event.suppressed === null && event.createdAt >= sinceIso)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit)
      .map((event) => this.join(event));
  }

  async countDeliverableEventsBefore(beforeIso: string): Promise<number> {
    return this.events.filter((e) => e.suppressed === null && e.createdAt < beforeIso).length;
  }

  async countSuppressedEventsSince(sinceIso: string): Promise<number> {
    return this.events.filter((e) => e.suppressed !== null && e.createdAt >= sinceIso).length;
  }

  async createDeliveryIfAbsent(
    eventId: string,
    subscriptionId: string,
    createdAt: string,
  ): Promise<boolean> {
    const exists = [...this.deliveries.values()].some(
      (d) => d.eventId === eventId && d.subscriptionId === subscriptionId,
    );
    if (exists) return false;
    const id = randomUUID();
    this.deliveries.set(id, {
      id,
      eventId,
      subscriptionId,
      status: 'pending',
      attempts: 0,
      ticketId: null,
      failureCode: null,
      lastError: null,
      createdAt,
      updatedAt: createdAt,
      sentAt: null,
      receiptCheckedAt: null,
    });
    return true;
  }

  async listDeliveriesByStatus(statuses: DeliveryStatus[], limit: number): Promise<DeliveryRow[]> {
    return [...this.deliveries.values()]
      .filter((d) => statuses.includes(d.status))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit)
      .map((d) => ({ ...d }));
  }

  async updateDelivery(id: string, patch: DeliveryPatch): Promise<void> {
    const row = this.deliveries.get(id);
    if (!row) throw new Error(`unknown delivery ${id}`);
    Object.assign(row, patch);
  }

  async countDeliveriesByStatus(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const d of this.deliveries.values()) counts[d.status] = (counts[d.status] ?? 0) + 1;
    return counts;
  }

  async getSubscription(id: string): Promise<PushSubscription | null> {
    return this.subscriptions.get(id) ?? null;
  }

  async getEvent(eventId: string): Promise<DeliverableEvent | null> {
    const found = this.events.find((e) => e.id === eventId);
    return found ? this.join(found) : null;
  }

  async getCase(caseId: string): Promise<CaseLink | null> {
    const link = this.cases.get(caseId);
    return link ? { ...link } : null;
  }

  async hasDeliverableEvent(
    caseId: string,
    triggerRuleId: string,
    materialChangeRef: string | null,
  ): Promise<boolean> {
    return this.events.some(
      (e) =>
        e.recallCaseId === caseId &&
        e.triggerRuleId === triggerRuleId &&
        e.materialChangeRef === materialChangeRef &&
        e.suppressed === null,
    );
  }
}
