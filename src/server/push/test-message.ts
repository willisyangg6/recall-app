/**
 * `npm run push:test` construction — pure, so every message the tool can send
 * is proven in Node before anything reaches Expo. The script
 * (scripts/push-test.ts) only reads, calls these, and sends.
 *
 * Two messages, both to ONE explicitly named subscription and never through
 * the delivery worker, the ledger or a delivery row:
 *
 * - **Plain** (`kind: 'test'`): proves the device receives a push. The app's
 *   tap validator ignores `kind: 'test'`, so tapping it opens nothing.
 * - **Recall** (`--recall <case-id>`): proves tap navigation. It carries the
 *   app's real payload kind (`recall`) for an ACTIVE, canonical case, so a
 *   tap opens that case's Detail exactly as a delivered alert would. Its
 *   title and body are the real formatter's new-recall copy for that case,
 *   with the title marked `Test:` so it can never be mistaken for an alert.
 *   It carries no notification event id, because no ledger event exists.
 */

import { parseRecallPushPayload } from '../../lib/push-payload';
import { formatPushContent } from './format';
import type { CaseLink, TestPushMessage } from './types';

export const TEST_TITLE = 'Lotly test notification';
export const TEST_BODY = 'This is a test from Lotly’s alert setup. No recall is attached.';
export const RECALL_TEST_TITLE_PREFIX = 'Test: ';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PushTestArgs =
  | { mode: 'list' }
  | { mode: 'send'; subscriptionId: string; recallCaseId: string | null; dryRun: boolean }
  | { mode: 'usage'; problem: string };

function flagValue(argv: readonly string[], flag: string): string | null | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  return value === undefined || value.startsWith('--') ? null : value;
}

/** The command line, decided before any read: what to do, or why not. */
export function parsePushTestArgs(argv: readonly string[]): PushTestArgs {
  const subscription = flagValue(argv, '--subscription');
  const recall = flagValue(argv, '--recall');
  const dryRun = argv.includes('--dry-run');
  if (subscription === undefined) {
    if (recall !== undefined || dryRun) {
      return { mode: 'usage', problem: 'name exactly one --subscription <uuid>' };
    }
    return { mode: 'list' };
  }
  if (subscription === null || !UUID.test(subscription)) {
    return { mode: 'usage', problem: '--subscription needs one subscription uuid' };
  }
  if (recall === null || (recall !== undefined && !UUID.test(recall))) {
    return { mode: 'usage', problem: '--recall needs one recall case uuid' };
  }
  return { mode: 'send', subscriptionId: subscription, recallCaseId: recall ?? null, dryRun };
}

/** The plain delivery check: lands on the device, opens nothing when tapped. */
export function buildPlainTestMessage(expoPushToken: string): TestPushMessage {
  return {
    to: expoPushToken,
    title: TEST_TITLE,
    body: TEST_BODY,
    data: { kind: 'test' },
    sound: 'default',
  };
}

export type RecallTestBuild =
  { ok: true; message: TestPushMessage } | { ok: false; reason: string };

/**
 * The tap-navigation check for one case. Refused unless the case is the
 * canonical, active record — the only kind a new-recall alert is ever sent
 * for (event-eligibility.ts) — so the tap always has a Detail to open.
 */
export function buildRecallTestMessage(
  expoPushToken: string,
  recallCase: CaseLink | null,
  now: Date,
): RecallTestBuild {
  if (recallCase === null) return { ok: false, reason: 'no recall case with that id' };
  if (recallCase.mergedInto !== null) {
    return {
      ok: false,
      reason: `that case was merged into ${recallCase.mergedInto}; use the surviving case`,
    };
  }
  if (recallCase.state !== 'active') {
    return { ok: false, reason: `that case is ${recallCase.state}; pick an active recall` };
  }
  const content = formatPushContent(
    {
      id: 'push-test',
      recallCaseId: recallCase.id,
      kind: 'initial',
      triggerRuleId: 'new_case',
      payloadSummary: recallCase.projection.title,
      createdAt: now.toISOString(),
      projection: recallCase.projection,
      // The worker's own wording at this moment, late-alert dating (D4) included.
    },
    { sentAt: now.toISOString() },
  );
  const data = { kind: 'recall' as const, recallCaseId: recallCase.id, test: true as const };
  // The same validator the app runs on a tap must accept it, for this case.
  if (parseRecallPushPayload(data)?.recallCaseId !== recallCase.id) {
    return { ok: false, reason: 'the case id is not a payload the app would open' };
  }
  return {
    ok: true,
    message: {
      to: expoPushToken,
      title: `${RECALL_TEST_TITLE_PREFIX}${content.title}`,
      body: content.body,
      data,
      sound: 'default',
    },
  };
}

/** What the operator sees: everything but the token. */
export function describeTestMessage(message: TestPushMessage): string {
  return [
    `  title: ${message.title}`,
    `  body:  ${message.body}`,
    `  data:  ${JSON.stringify(message.data)}`,
  ].join('\n');
}
