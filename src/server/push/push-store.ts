/**
 * Postgres-backed PushStore via Supabase (service-role; server-only).
 *
 * Reads tolerate the push_delivery migration not being applied yet — they
 * degrade to "not activated / no subscriptions / no deliveries" with a
 * warning, so `jobs:push --dry-run` and ops:health work before activation.
 * Writes stay loud: nothing may silently pretend to persist delivery state.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { CaseProjection } from '../../domain/recall-types';
import type {
  DeliverableEvent,
  DeliveryPatch,
  DeliveryRow,
  DeliveryStatus,
  PushStore,
  PushSubscription,
} from './types';

const UNIQUE_VIOLATION = '23505';
const MIGRATION_PENDING = /push_delivery_config|push_subscriptions|notification_deliveries/;

const DELIVERY_STATUSES: DeliveryStatus[] = [
  'pending',
  'sending',
  'ticket_accepted',
  'receipt_ok',
  'retryable_failure',
  'permanent_failure',
];

const EVENT_SELECT =
  'id, recall_case_id, kind, trigger_rule_id, payload_summary, created_at, recall_cases (projection)';

interface EventRow {
  id: string;
  recall_case_id: string;
  kind: DeliverableEvent['kind'];
  trigger_rule_id: string;
  payload_summary: string;
  created_at: string;
  recall_cases: { projection: CaseProjection } | null;
}

export class SupabasePushStore implements PushStore {
  constructor(private readonly client: SupabaseClient) {}

  private fail(operation: string, error: { message: string } | null): never {
    throw new Error(`SupabasePushStore.${operation} failed: ${error?.message ?? 'unknown error'}`);
  }

  private migrationPending(operation: string, message: string): boolean {
    if (!MIGRATION_PENDING.test(message)) return false;
    console.warn(
      `  ${operation}: push_delivery migration pending — treating as empty (apply supabase/migrations/20260828000000_push_delivery.sql).`,
    );
    return true;
  }

  async getPushEnabledAt(): Promise<string | null> {
    const { data, error } = await this.client
      .from('push_delivery_config')
      .select('push_enabled_at')
      .maybeSingle();
    if (error) {
      if (this.migrationPending('getPushEnabledAt', error.message)) return null;
      this.fail('getPushEnabledAt', error);
    }
    return (data?.push_enabled_at as string | undefined) ?? null;
  }

  private toSubscription(row: Record<string, unknown>): PushSubscription {
    return {
      id: row.id as string,
      installationId: row.installation_id as string,
      expoPushToken: row.expo_push_token as string,
      platform: row.platform as PushSubscription['platform'],
      enabled: row.enabled as boolean,
      enabledAt: row.enabled_at as string,
    };
  }

  async listEnabledSubscriptions(): Promise<PushSubscription[]> {
    const { data, error } = await this.client
      .from('push_subscriptions')
      .select('id, installation_id, expo_push_token, platform, enabled, enabled_at')
      .eq('enabled', true);
    if (error || !data) {
      if (error && this.migrationPending('listEnabledSubscriptions', error.message)) return [];
      this.fail('listEnabledSubscriptions', error);
    }
    return data.map((row) => this.toSubscription(row));
  }

  async disableSubscription(id: string, reason: string, at: string): Promise<void> {
    const { error } = await this.client
      .from('push_subscriptions')
      .update({ enabled: false, disabled_at: at, disabled_reason: reason })
      .eq('id', id);
    if (error) this.fail('disableSubscription', error);
  }

  private toEvent(row: EventRow): DeliverableEvent {
    if (!row.recall_cases) {
      throw new Error(`notification event ${row.id} has no joined recall case`);
    }
    return {
      id: row.id,
      recallCaseId: row.recall_case_id,
      kind: row.kind,
      triggerRuleId: row.trigger_rule_id,
      payloadSummary: row.payload_summary,
      createdAt: row.created_at,
      projection: row.recall_cases.projection,
    };
  }

  async listDeliverableEventsSince(sinceIso: string, limit: number): Promise<DeliverableEvent[]> {
    const { data, error } = await this.client
      .from('notification_events')
      .select(EVENT_SELECT)
      .is('suppressed', null)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error || !data) this.fail('listDeliverableEventsSince', error);
    return (data as unknown as EventRow[]).map((row) => this.toEvent(row));
  }

  async countDeliverableEventsBefore(beforeIso: string): Promise<number> {
    const { count, error } = await this.client
      .from('notification_events')
      .select('id', { count: 'exact', head: true })
      .is('suppressed', null)
      .lt('created_at', beforeIso);
    if (error) this.fail('countDeliverableEventsBefore', error);
    return count ?? 0;
  }

  async countSuppressedEventsSince(sinceIso: string): Promise<number> {
    const { count, error } = await this.client
      .from('notification_events')
      .select('id', { count: 'exact', head: true })
      .not('suppressed', 'is', null)
      .gte('created_at', sinceIso);
    if (error) this.fail('countSuppressedEventsSince', error);
    return count ?? 0;
  }

  async createDeliveryIfAbsent(
    eventId: string,
    subscriptionId: string,
    createdAt: string,
  ): Promise<boolean> {
    const { error } = await this.client.from('notification_deliveries').insert({
      event_id: eventId,
      subscription_id: subscriptionId,
      created_at: createdAt,
      updated_at: createdAt,
    });
    if (error) {
      if (error.code === UNIQUE_VIOLATION) return false;
      this.fail('createDeliveryIfAbsent', error);
    }
    return true;
  }

  private toDelivery(row: Record<string, unknown>): DeliveryRow {
    return {
      id: row.id as string,
      eventId: row.event_id as string,
      subscriptionId: row.subscription_id as string,
      status: row.status as DeliveryStatus,
      attempts: row.attempts as number,
      ticketId: (row.ticket_id as string | null) ?? null,
      failureCode: (row.failure_code as string | null) ?? null,
      lastError: (row.last_error as string | null) ?? null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      sentAt: (row.sent_at as string | null) ?? null,
      receiptCheckedAt: (row.receipt_checked_at as string | null) ?? null,
    };
  }

  async listDeliveriesByStatus(statuses: DeliveryStatus[], limit: number): Promise<DeliveryRow[]> {
    const { data, error } = await this.client
      .from('notification_deliveries')
      .select('*')
      .in('status', statuses)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error || !data) {
      if (error && this.migrationPending('listDeliveriesByStatus', error.message)) return [];
      this.fail('listDeliveriesByStatus', error);
    }
    return data.map((row) => this.toDelivery(row));
  }

  async updateDelivery(id: string, patch: DeliveryPatch): Promise<void> {
    const update: Record<string, unknown> = { updated_at: patch.updatedAt };
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.attempts !== undefined) update.attempts = patch.attempts;
    if (patch.ticketId !== undefined) update.ticket_id = patch.ticketId;
    if (patch.failureCode !== undefined) update.failure_code = patch.failureCode;
    if (patch.lastError !== undefined) update.last_error = patch.lastError;
    if (patch.sentAt !== undefined) update.sent_at = patch.sentAt;
    if (patch.receiptCheckedAt !== undefined) update.receipt_checked_at = patch.receiptCheckedAt;
    const { error } = await this.client.from('notification_deliveries').update(update).eq('id', id);
    if (error) this.fail('updateDelivery', error);
  }

  async countDeliveriesByStatus(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const status of DELIVERY_STATUSES) {
      const { count, error } = await this.client
        .from('notification_deliveries')
        .select('id', { count: 'exact', head: true })
        .eq('status', status);
      if (error) {
        if (this.migrationPending('countDeliveriesByStatus', error.message)) return {};
        this.fail('countDeliveriesByStatus', error);
      }
      if (count) counts[status] = count;
    }
    return counts;
  }

  async getSubscription(id: string): Promise<PushSubscription | null> {
    const { data, error } = await this.client
      .from('push_subscriptions')
      .select('id, installation_id, expo_push_token, platform, enabled, enabled_at')
      .eq('id', id)
      .maybeSingle();
    if (error) this.fail('getSubscription', error);
    return data ? this.toSubscription(data) : null;
  }

  async getEvent(eventId: string): Promise<DeliverableEvent | null> {
    const { data, error } = await this.client
      .from('notification_events')
      .select(EVENT_SELECT)
      .eq('id', eventId)
      .maybeSingle();
    if (error) this.fail('getEvent', error);
    return data ? this.toEvent(data as unknown as EventRow) : null;
  }
}
