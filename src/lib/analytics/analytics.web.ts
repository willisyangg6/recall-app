/** Analytics on the web build: off. Same calls as analytics.ts, all inert. */

import type { AnalyticsEvent } from './analytics-events';

export function startAnalytics(): void {}
export function track(_event: AnalyticsEvent): void {}
export function trackFeedViewed(): void {}
export function analyticsAppState(_active: boolean): void {}
export function setInternalAnalyticsDevice(_internal: boolean): void {}
export function isInternalAnalyticsDevice(): boolean {
  return false;
}
export function currentAnalyticsId(): string | null {
  return null;
}
export function resetAnalytics(): Promise<void> {
  return Promise.resolve();
}
