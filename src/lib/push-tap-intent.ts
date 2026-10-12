/**
 * The tapped-notification intent — what a tap asked for, held until the app
 * can honour it. Pure and Expo-free so the cold-launch sequence is provable
 * in Node.
 *
 * Why it exists: on a cold launch the tap that started the app is read at
 * mount (expo-notifications' `useLastNotificationResponse` reads the launch
 * response in a layout effect), while the access gate reads onboarding and
 * entitlement from secure storage asynchronously. Until that read settles the
 * phase is derived from the initial onboarding record, so it is never `app`.
 * The former hook decided the tap on that first answer and marked it handled,
 * so a cold-launch tap opened the Feed instead of the recall.
 *
 * The rule now:
 * - A tap is recorded once per notification identifier; an unknown, test or
 *   malformed payload never names a recall (push-payload.ts is the only gate).
 * - The newest tap replaces an older one still waiting — including a newer
 *   tap that names no recall, which leaves nothing waiting.
 * - It is opened only once the gate has settled, the phase is `app`
 *   (pushNavigationAllowed), and the navigator can accept a route.
 * - Until then it waits, in memory only: never persisted, so it cannot
 *   survive a relaunch. While the paywall, the notification education or
 *   onboarding stands, the tap opens nothing; if that phase ends in `app`
 *   during the same session, the recall opens then. The gates themselves are
 *   untouched — a tap is never the door around them.
 */

import { pushNavigationAllowed, type AccessPhase } from './access-gate';
import { parseRecallPushPayload } from './push-payload';

export interface TapGate {
  /** The access gate has read onboarding and entitlement (`Access.ready`). */
  ready: boolean;
  phase: AccessPhase;
  /** The navigation container can take a route (`isReady()`). */
  navigatorReady: boolean;
}

export interface PushTapIntent {
  /** Record a tap. Idempotent per identifier; invalid payloads are dropped. */
  offer(identifier: string, data: unknown): void;
  /** The recall to open now, or null to keep waiting. Clears what it returns. */
  take(gate: TapGate): string | null;
  /** The recall id still waiting, if any (for tests and diagnostics). */
  pending(): string | null;
}

export function createPushTapIntent(): PushTapIntent {
  let lastIdentifier: string | null = null;
  let waiting: string | null = null;
  return {
    offer(identifier, data) {
      if (identifier === lastIdentifier) return;
      lastIdentifier = identifier;
      // The latest tap is the shopper's latest request: a newer tap on a
      // notification that names no recall cancels an older one still waiting.
      waiting = parseRecallPushPayload(data)?.recallCaseId ?? null;
    },
    take(gate) {
      if (waiting === null) return null;
      if (!gate.ready || !gate.navigatorReady || !pushNavigationAllowed(gate.phase)) return null;
      const recallCaseId = waiting;
      waiting = null;
      return recallCaseId;
    },
    pending() {
      return waiting;
    },
  };
}
