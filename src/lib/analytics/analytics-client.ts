/**
 * The analytics client: queue, local state and delivery to PostHog's HTTP
 * batch API (https://posthog.com/docs/api/capture). No SDK.
 *
 * Rules (docs/recall-analytics.md):
 *
 * - Never in the way. Every public method returns at once and never throws;
 *   storage and network work runs behind a promise chain whose failures are
 *   swallowed. No screen awaits analytics.
 * - Off unless configured. Without a project key, for a person whose age
 *   answer says 13–17, or after `disable()`, nothing is queued or sent.
 * - Anonymous. A random analytics id made on this installation, stored in
 *   the app's documents (removed with the app) — never the installation id,
 *   which is a server credential. "Reset app and delete my data" discards it.
 * - Exactly once. Every event gets a UUID when it is captured and keeps it
 *   through retries; PostHog keeps one event per UUID, so a batch resent
 *   after a lost response does not double count. Opens are counted once per
 *   launch and once per return after `VISIT_GAP_MS` in the background (the
 *   App Store purchase sheet backgrounds the app; that is not a visit).
 *
 * A leaf: no React, no native imports. `analytics.ts` wires the ports.
 */

import {
  distributionOf,
  eventProperties,
  installKind,
  SEND_IMMEDIATELY,
  VISIT_GAP_MS,
  type AnalyticsContext,
  type AnalyticsEvent,
} from './analytics-events';

export const STATE_VERSION = 1;
/** Events kept while offline; the oldest are dropped beyond this. */
export const MAX_QUEUE = 200;
const BATCH_SIZE = 50;
const SEND_AT = 5;
const DEBOUNCE_MS = 20_000;
const REQUEST_TIMEOUT_MS = 10_000;

export interface QueuedEvent {
  uuid: string;
  event: string;
  timestamp: string;
  properties: Record<string, string | number | boolean | null>;
}

export interface AnalyticsState {
  version: typeof STATE_VERSION;
  analyticsId: string;
  firstSeenAt: string;
  lastVersion: string | null;
  lastBuild: string | null;
  internal: boolean;
  feedViewed: boolean;
  queue: QueuedEvent[];
}

export interface AnalyticsPorts {
  apiKey: string | null;
  host: string;
  /** The context minus what the client owns (`internal`, `store_environment`). */
  baseContext: Omit<AnalyticsContext, 'internal' | 'store_environment'>;
  readState(): Promise<string | null>;
  writeState(serialized: string | null): Promise<void>;
  /** Whether onboarding progress already existed (a returning person). */
  priorOnboardingProgress(): Promise<boolean>;
  /** Whether analytics must stay off for this person (13–17). */
  suppressed(): Promise<boolean>;
  /** StoreKit's environment, or null. May be slow; never awaited by capture. */
  storeEnvironment(): Promise<string | null>;
  randomUUID(): string;
  now(): Date;
  fetch(
    url: string,
    init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal },
  ): Promise<{ status: number }>;
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export function parseState(raw: string | null): AnalyticsState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<AnalyticsState>;
    if (value.version !== STATE_VERSION || typeof value.analyticsId !== 'string') return null;
    if (typeof value.firstSeenAt !== 'string') return null;
    return {
      version: STATE_VERSION,
      analyticsId: value.analyticsId,
      firstSeenAt: value.firstSeenAt,
      lastVersion: typeof value.lastVersion === 'string' ? value.lastVersion : null,
      lastBuild: typeof value.lastBuild === 'string' ? value.lastBuild : null,
      internal: value.internal === true,
      feedViewed: value.feedViewed === true,
      queue: Array.isArray(value.queue) ? value.queue.slice(-MAX_QUEUE) : [],
    };
  } catch {
    return null;
  }
}

/** Learned after the event was queued: fill it in (and the distribution), never overwrite. */
function withStoreEnvironment(
  properties: QueuedEvent['properties'],
  env: string | null,
  distinctId: string,
): QueuedEvent['properties'] {
  const storeEnvironment = properties.store_environment ?? env;
  return {
    ...properties,
    store_environment: storeEnvironment,
    distribution: distributionOf(properties.environment, storeEnvironment),
    distinct_id: distinctId,
  };
}

export class AnalyticsClient {
  private state: AnalyticsState | null = null;
  private enabled = false;
  private chain: Promise<void> = Promise.resolve();
  private storeEnvironment: string | null = null;
  private backgroundedAt: number | null = null;
  private sending = false;
  private timer: unknown = null;
  private started = false;

  constructor(private readonly ports: AnalyticsPorts) {}

  /** Serialize work; a failure never breaks the chain or reaches a caller. */
  private run(task: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(task).catch(() => {});
    return this.chain;
  }

  /** Once per launch: load state, record first-seen/update, count the open. */
  start(): Promise<void> {
    if (this.started) return this.chain;
    this.started = true;
    return this.run(async () => {
      if (!this.ports.apiKey || (await this.ports.suppressed())) return;
      // Known before the first event is stamped: customer dashboards require
      // `store_environment = Production`, so a first open sent without it
      // would vanish from them. The port is bounded (5 s) and off the UI path.
      this.storeEnvironment = await this.ports.storeEnvironment().catch(() => null);
      const { app_version, app_build } = this.ports.baseContext;
      let state = parseState(await this.ports.readState());
      const events: AnalyticsEvent[] = [];
      if (!state) {
        const prior = await this.ports.priorOnboardingProgress();
        state = {
          version: STATE_VERSION,
          analyticsId: this.ports.randomUUID(),
          firstSeenAt: this.ports.now().toISOString(),
          lastVersion: app_version,
          lastBuild: app_build,
          internal: false,
          feedViewed: false,
          queue: [],
        };
        events.push({ name: 'app_first_seen', props: { install_kind: installKind(prior) } });
      } else if (state.lastVersion !== app_version || state.lastBuild !== app_build) {
        events.push({
          name: 'app_updated',
          props: { previous_version: state.lastVersion, previous_build: state.lastBuild },
        });
        state = { ...state, lastVersion: app_version, lastBuild: app_build };
      }
      events.push({ name: 'app_opened', props: { trigger: 'launch' } });
      this.state = state;
      this.enabled = true;
      for (const event of events) this.enqueue(event);
      await this.persist();
      await this.send();
    });
  }

  /** Record one event. Returns at once; never throws. */
  capture(event: AnalyticsEvent): void {
    void this.run(async () => {
      if (!this.enabled || !this.state) return;
      this.enqueue(event);
      await this.persist();
      if (SEND_IMMEDIATELY.has(event.name) || this.state.queue.length >= SEND_AT) {
        await this.send();
      } else {
        this.schedule();
      }
    });
  }

  /** The Feed was shown; the first time on this installation is marked. */
  feedViewed(): void {
    void this.run(async () => {
      if (!this.enabled || !this.state) return;
      const firstTime = !this.state.feedViewed;
      this.state = { ...this.state, feedViewed: true };
      this.enqueue({ name: 'feed_viewed', props: { first_time: firstTime } });
      await this.persist();
      if (firstTime) await this.send();
      else this.schedule();
    });
  }

  /** The app went to the background: remember when, and send what is queued. */
  background(): void {
    this.backgroundedAt = this.ports.now().getTime();
    void this.run(() => this.send());
  }

  /** Back in the foreground: a new visit only after a real absence. */
  foreground(): void {
    const since = this.backgroundedAt;
    this.backgroundedAt = null;
    if (since === null || this.ports.now().getTime() - since < VISIT_GAP_MS) return;
    this.capture({ name: 'app_opened', props: { trigger: 'foreground' } });
  }

  /** Mark (or unmark) this device as the team's own; every later event says so. */
  setInternal(internal: boolean): void {
    void this.run(async () => {
      if (!this.enabled || !this.state) return;
      this.state = { ...this.state, internal };
      this.enqueue({ name: 'internal_device_marked', props: { internal } });
      await this.persist();
      await this.send();
    });
  }

  /** The analytics id, for the founder's own exclusion filter. Null when off. */
  analyticsId(): string | null {
    return this.enabled ? (this.state?.analyticsId ?? null) : null;
  }

  isInternal(): boolean {
    return this.state?.internal === true;
  }

  /**
   * "Reset app and delete my data": drop the id and every unsent event. The
   * next launch is a new analytics installation. Nothing is sent about it.
   */
  reset(): Promise<void> {
    return this.run(async () => {
      this.enabled = false;
      this.state = null;
      if (this.timer !== null) this.ports.clearTimer(this.timer);
      this.timer = null;
      await this.ports.writeState(null);
    });
  }

  /** Wait for queued work (tests, and the reset flow). */
  settled(): Promise<void> {
    return this.chain;
  }

  private context(): AnalyticsContext {
    return {
      ...this.ports.baseContext,
      internal: this.state?.internal === true,
      store_environment: this.storeEnvironment,
    };
  }

  private enqueue(event: AnalyticsEvent): void {
    if (!this.state) return;
    const properties = eventProperties(event, this.context());
    if (!properties) return;
    const queued: QueuedEvent = {
      uuid: this.ports.randomUUID(),
      event: event.name,
      timestamp: this.ports.now().toISOString(),
      properties,
    };
    this.state = { ...this.state, queue: [...this.state.queue, queued].slice(-MAX_QUEUE) };
  }

  private async persist(): Promise<void> {
    if (!this.state) return;
    await this.ports.writeState(JSON.stringify(this.state));
  }

  private schedule(): void {
    if (this.timer !== null) return;
    this.timer = this.ports.setTimer(() => {
      this.timer = null;
      void this.run(() => this.send());
    }, DEBOUNCE_MS);
  }

  /** One batch at a time; kept on failure, dropped only when PostHog rejects it as invalid. */
  private async send(): Promise<void> {
    if (this.sending || !this.state || !this.ports.apiKey) return;
    if (this.state.queue.length === 0) return;
    this.sending = true;
    try {
      const batch = this.state.queue.slice(0, BATCH_SIZE);
      const distinctId = this.state.analyticsId;
      const env = this.storeEnvironment;
      const body = JSON.stringify({
        api_key: this.ports.apiKey,
        batch: batch.map((item) => ({
          event: item.event,
          uuid: item.uuid,
          timestamp: item.timestamp,
          distinct_id: distinctId,
          properties: withStoreEnvironment(item.properties, env, distinctId),
        })),
      });
      const controller = typeof AbortController === 'undefined' ? null : new AbortController();
      const abort = controller
        ? this.ports.setTimer(() => controller.abort(), REQUEST_TIMEOUT_MS)
        : null;
      let status = 0;
      try {
        const response = await this.ports.fetch(`${this.ports.host.replace(/\/$/, '')}/batch/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: controller?.signal,
        });
        status = response.status;
      } catch {
        status = 0; // offline or timed out: keep the batch
      } finally {
        if (abort !== null) this.ports.clearTimer(abort);
      }
      const delivered = status >= 200 && status < 300;
      const rejected = status === 400 || status === 413;
      if ((delivered || rejected) && this.state) {
        const sent = new Set(batch.map((item) => item.uuid));
        this.state = {
          ...this.state,
          queue: this.state.queue.filter((item) => !sent.has(item.uuid)),
        };
        await this.persist();
      }
    } finally {
      this.sending = false;
    }
  }
}
