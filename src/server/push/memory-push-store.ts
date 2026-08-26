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
  DeliverableEvent,
  DeliveryPatch,
  DeliveryRow,
  DeliveryStatus,
  PushStore,
  PushSubscription,
} from './types';

interface SubscriptionRow extends PushSubscription {
  disabledAt: string | null;
  disabledReason: string | null;
}

interface StoredEvent extends DeliverableEvent {
  suppressed: string | null;
}

export class MemoryPushStore implements PushStore {
  pushEnabledAt: string | null = null;
  subscriptions = new Map<string, SubscriptionRow>();
  events: StoredEvent[] = [];
  deliveries = new Map<string, DeliveryRow>();

  // ── Test setup helpers ─────────────────────────────────────────────────────

  addEvent(event: Omit<StoredEvent, 'suppressed'> & { suppressed?: string | null }): void {
    this.events.push({ ...event, suppressed: event.suppressed ?? null });
  }

  /** The register_push_subscription RPC's semantics, mirrored. */
  register(
    installationId: string,
    expoPushToken: string,
    platform: 'ios' | 'android',
    nowIso: string,
  ): void {
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
      return;
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

  async listDeliverableEventsSince(sinceIso: string, limit: number): Promise<DeliverableEvent[]> {
    return this.events
      .filter((event) => event.suppressed === null && event.createdAt >= sinceIso)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit)
      .map(({ suppressed: _suppressed, ...event }) => event);
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
    if (!found) return null;
    const { suppressed: _suppressed, ...event } = found;
    return event;
  }
}
