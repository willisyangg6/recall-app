/**
 * Product analytics: the complete event catalog (2026-11-25).
 *
 * Lotly sends a small, fixed set of anonymous events to PostHog so the
 * founder can see real app opens and where people leave the
 * onboarding → paywall → purchase → Feed funnel. Everything that can be sent
 * is declared HERE, with its exact properties; `analytics-client.ts` refuses
 * any other name or key. There is no autocapture, no screen or tap capture,
 * no session replay, and no SDK — events are posted to PostHog's HTTP batch
 * API by `analytics-client.ts`.
 *
 * Never sent (docs/recall-analytics.md): preferences of any kind (states,
 * stores, allergens), recalls viewed or searched, push tokens, the
 * installation id (it is a server credential), RevenueCat ids, receipts,
 * prices, or anything a person typed. RevenueCat stays authoritative for
 * subscription status; these events record only what this screen observed.
 *
 * A leaf: no React, no native imports.
 */

import type { OnboardingStep } from '@/lib/onboarding-state';
import { ONBOARDING_STEPS } from '@/lib/onboarding-state';

/** A purchase counts as converted when it lands within this many days of the first open. */
export const CONVERSION_WINDOW_DAYS = 7;

/** Back in the foreground after at least this long counts as a new visit (`app_opened`). */
export const VISIT_GAP_MS = 30 * 60 * 1000;

export type PaywallPlacement = 'onboarding' | 'standalone';
export type StoreFailure = 'error' | 'unavailable';

/** Every event Lotly can send, with its exact properties. */
export type AnalyticsEvent =
  | { name: 'app_first_seen'; props: { install_kind: 'new' | 'returning' } }
  | {
      name: 'app_updated';
      props: { previous_version: string | null; previous_build: string | null };
    }
  | { name: 'app_opened'; props: { trigger: 'launch' | 'foreground' } }
  | { name: 'onboarding_step_viewed'; props: { step: OnboardingStep; step_index: number } }
  | { name: 'onboarding_completed'; props: Record<string, never> }
  | { name: 'paywall_viewed'; props: { placement: PaywallPlacement } }
  | { name: 'purchase_started'; props: { placement: PaywallPlacement } }
  | { name: 'purchase_completed'; props: { placement: PaywallPlacement } }
  | { name: 'purchase_cancelled'; props: { placement: PaywallPlacement } }
  | { name: 'purchase_failed'; props: { placement: PaywallPlacement; reason: StoreFailure } }
  | { name: 'restore_started'; props: { placement: PaywallPlacement } }
  | { name: 'restore_completed'; props: { placement: PaywallPlacement } }
  | { name: 'restore_nothing_found'; props: { placement: PaywallPlacement } }
  | { name: 'restore_failed'; props: { placement: PaywallPlacement; reason: StoreFailure } }
  | { name: 'feed_viewed'; props: { first_time: boolean } }
  | { name: 'internal_device_marked'; props: { internal: boolean } };

export type AnalyticsEventName = AnalyticsEvent['name'];

/** The keys each event may carry, besides the shared context below. */
export const EVENT_PROPERTIES: Readonly<Record<AnalyticsEventName, readonly string[]>> = {
  app_first_seen: ['install_kind'],
  app_updated: ['previous_version', 'previous_build'],
  app_opened: ['trigger'],
  onboarding_step_viewed: ['step', 'step_index'],
  onboarding_completed: [],
  paywall_viewed: ['placement'],
  purchase_started: ['placement'],
  purchase_completed: ['placement'],
  purchase_cancelled: ['placement'],
  purchase_failed: ['placement', 'reason'],
  restore_started: ['placement'],
  restore_completed: ['placement'],
  restore_nothing_found: ['placement'],
  restore_failed: ['placement', 'reason'],
  feed_viewed: ['first_time'],
  internal_device_marked: ['internal'],
};

/** Outcomes worth sending at once rather than with the next batch. */
export const SEND_IMMEDIATELY: ReadonlySet<AnalyticsEventName> = new Set([
  'purchase_completed',
  'purchase_cancelled',
  'purchase_failed',
  'restore_completed',
  'restore_nothing_found',
  'restore_failed',
  'internal_device_marked',
]);

/** The context stamped on every event. Nothing else is ever added. */
export interface AnalyticsContext {
  app_version: string | null;
  app_build: string | null;
  /** Which build: `development` (Metro), `preview` (internal), `production` (store). */
  environment: 'development' | 'preview' | 'production';
  /** StoreKit's app-transaction environment: `Production`, `Sandbox` (TestFlight), `Xcode`, or null. */
  store_environment: string | null;
  /** Marked internal on this device (Profile → long-press the version line). */
  internal: boolean;
  os: string;
  os_version: string | null;
}

/**
 * Where this copy of the app came from, in one explicit property — the one
 * customer dashboards filter on (`distribution = app_store`, `internal ≠
 * true`). Derived from `environment` and `store_environment`; `unknown`
 * when StoreKit did not answer, which dashboards also exclude.
 */
export type Distribution =
  'app_store' | 'testflight' | 'xcode' | 'preview' | 'development' | 'unknown';

export function distributionOf(
  environment: string | number | boolean | null | undefined,
  storeEnvironment: string | number | boolean | null | undefined,
): Distribution {
  if (environment === 'development') return 'development';
  if (environment === 'preview') return 'preview';
  if (storeEnvironment === 'Production') return 'app_store';
  if (storeEnvironment === 'Sandbox') return 'testflight';
  if (storeEnvironment === 'Xcode') return 'xcode';
  return 'unknown';
}

export const CONTEXT_KEYS: readonly (keyof AnalyticsContext)[] = [
  'app_version',
  'app_build',
  'environment',
  'store_environment',
  'internal',
  'os',
  'os_version',
];

/** Position of an onboarding step in flow order (1-based). */
export function stepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step) + 1;
}

/**
 * New installation or a person who already used Lotly. Decided once, the
 * first time analytics runs on this installation: onboarding progress kept
 * from before (it lives in the keychain, which outlives an app update and a
 * reinstall) means a returning person, including everyone updating from a
 * build without analytics.
 */
export function installKind(priorOnboardingProgress: boolean): 'new' | 'returning' {
  return priorOnboardingProgress ? 'returning' : 'new';
}

/** Whether a stored age answer says this person is 13–17. Analytics stays off for them. */
export function isMinorAgeAnswer(
  answer: { kind: string; lowerBound?: number | null; upperBound?: number | null } | null,
): boolean {
  if (!answer || answer.kind !== 'shared') return false;
  const lower = answer.lowerBound ?? null;
  const upper = answer.upperBound ?? null;
  if (upper !== null && upper <= 12) return false; // under 13 never reaches the app
  if (lower !== null && lower >= 18) return false;
  return lower !== null && lower >= 13;
}

/**
 * Whether analytics must stay off for this launch: before the launch age
 * gate has decided (null), when this launch's decision says 13–17, or when
 * the stored answer does. Nothing is queued or sent while this is true.
 */
export function analyticsSuppressedForAge(
  decision: { kind: string; ageClass?: string } | null,
  storedAnswer: Parameters<typeof isMinorAgeAnswer>[0],
): boolean {
  if (decision === null || decision.kind !== 'proceed') return true;
  if (decision.ageClass === 'minor') return true;
  return isMinorAgeAnswer(storedAnswer);
}

/**
 * The properties sent for one event: its declared keys and the shared
 * context, nothing else. Values must be primitives. Returns null for an
 * event that is not in the catalog (it is dropped, never sent).
 */
export function eventProperties(
  event: AnalyticsEvent,
  context: AnalyticsContext,
): Record<string, string | number | boolean | null> | null {
  const allowed = EVENT_PROPERTIES[event.name];
  if (!allowed) return null;
  const out: Record<string, string | number | boolean | null> = {};
  for (const key of allowed) {
    const value = (event.props as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) return null;
    out[key] = value as string | number | boolean | null;
  }
  for (const key of CONTEXT_KEYS) out[key] = context[key];
  out.distribution = distributionOf(context.environment, context.store_environment);
  // PostHog: no person profile for anonymous events, no GeoIP lookup.
  out.$process_person_profile = false;
  out.$geoip_disable = true;
  out.$lib = 'lotly-app';
  out.$app_version = context.app_version;
  out.$app_build = context.app_build;
  out.$os = context.os;
  return out;
}
