/**
 * Analytics wiring (native): the one client, its ports, and the calls the
 * app makes. See analytics-client.ts for the rules and analytics-events.ts
 * for everything that can be sent.
 *
 * Configuration (EAS environment variables, per environment):
 *   EXPO_PUBLIC_POSTHOG_KEY   the PostHog project key for THAT environment;
 *                             absent = analytics off (nothing queued or sent)
 *   EXPO_PUBLIC_POSTHOG_HOST  default https://us.i.posthog.com
 *   EXPO_PUBLIC_ANALYTICS_ENV `production` in the production environment
 *                             only; any other value or none reads `preview`.
 *                             A Metro (`__DEV__`) bundle is always `development`.
 */

import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { getAppTransactionAsync } from '../../../modules/app-transaction';
import { loadAgeRecord } from '@/lib/age-record-store';
import { launchAgeDecision } from '@/lib/launch-age-decision';
import { loadOnboardingRecord } from '@/lib/onboarding-store';

import { AnalyticsClient } from './analytics-client';
import { analyticsSuppressedForAge, type AnalyticsEvent } from './analytics-events';

const STATE_FILE = 'lotly-analytics.json';
const STORE_ENVIRONMENT_TIMEOUT_MS = 5_000;

function analyticsEnvironment(): 'development' | 'preview' | 'production' {
  if (__DEV__) return 'development';
  return process.env.EXPO_PUBLIC_ANALYTICS_ENV === 'production' ? 'production' : 'preview';
}

function stateFile(): File {
  return new File(Paths.document, STATE_FILE);
}

const client = new AnalyticsClient({
  apiKey: process.env.EXPO_PUBLIC_POSTHOG_KEY?.trim() || null,
  host: process.env.EXPO_PUBLIC_POSTHOG_HOST?.trim() || 'https://us.i.posthog.com',
  baseContext: {
    app_version: Constants.nativeApplicationVersion ?? Constants.expoConfig?.version ?? null,
    app_build: Constants.nativeBuildVersion ?? null,
    environment: analyticsEnvironment(),
    os: Platform.OS,
    os_version: Platform.Version === undefined ? null : String(Platform.Version),
  },
  async readState() {
    const file = stateFile();
    return file.exists ? file.text() : null;
  },
  async writeState(serialized) {
    const file = stateFile();
    if (serialized === null) {
      if (file.exists) file.delete();
      return;
    }
    // Whole-document swap (as saved-recalls-store.ts): a torn write never
    // leaves half a state that would read as a new installation.
    const temp = new File(Paths.document, `${STATE_FILE}.tmp`);
    if (temp.exists) temp.delete();
    temp.write(serialized);
    if (file.exists) file.delete();
    temp.move(file);
  },
  async priorOnboardingProgress() {
    const record = await loadOnboardingRecord();
    return record.step !== 'welcome' || record.watchBuilt || record.personalizationCompleted;
  },
  async suppressed() {
    // Off until this launch's age decision exists, and for a minor by
    // either this launch's answer or the stored one.
    return analyticsSuppressedForAge(launchAgeDecision(), (await loadAgeRecord())?.answer ?? null);
  },
  storeEnvironment() {
    if (Platform.OS !== 'ios') return Promise.resolve(null);
    return Promise.race([
      getAppTransactionAsync().then((info) => info?.environment ?? null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), STORE_ENVIRONMENT_TIMEOUT_MS)),
    ]).catch(() => null);
  },
  randomUUID: () => Crypto.randomUUID(),
  now: () => new Date(),
  fetch: (url, init) => fetch(url, init),
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
});

export function startAnalytics(): void {
  void client.start();
}

export function track(event: AnalyticsEvent): void {
  client.capture(event);
}

export function trackFeedViewed(): void {
  client.feedViewed();
}

export function analyticsAppState(active: boolean): void {
  if (active) client.foreground();
  else client.background();
}

export function setInternalAnalyticsDevice(internal: boolean): void {
  client.setInternal(internal);
}

export function isInternalAnalyticsDevice(): boolean {
  return client.isInternal();
}

export function currentAnalyticsId(): string | null {
  return client.analyticsId();
}

export function resetAnalytics(): Promise<void> {
  return client.reset();
}
