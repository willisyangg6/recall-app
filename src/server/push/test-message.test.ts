/**
 * `push:test` construction (test-message.ts): what the tool may send, decided
 * before anything reaches Expo. The recall message is proven against the
 * app's own tap validator and the real formatter.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import type { CaseProjection } from '../../domain/recall-types';
import { parseRecallPushPayload } from '../../lib/push-payload';
import { formatPushContent } from './format';
import {
  buildPlainTestMessage,
  buildRecallTestMessage,
  describeTestMessage,
  parsePushTestArgs,
  RECALL_TEST_TITLE_PREFIX,
  TEST_BODY,
  TEST_TITLE,
} from './test-message';
import type { CaseLink } from './types';

const TOKEN = 'ExponentPushToken[secret-device-token]';
const SUB = '3b241101-e2bb-4255-8caf-4136c566a962';
const CASE = '0f8fad5b-d9cb-469f-a165-70867728950e';
const NOW = new Date('2026-10-10T12:00:00Z');

function projection(overrides: Partial<CaseProjection> = {}): CaseProjection {
  return {
    sourceAgency: 'FDA',
    noticeType: 'recall',
    state: 'active',
    closedYear: null,
    classification: { value: 'not_yet_classified', sourceText: null },
    title: 'Acme Foods Issues Allergy Alert on Undeclared Peanut in Trail Mix',
    summaryText: 'Acme Foods recalled trail mix.',
    summaryHtml: null,
    reasonText: null,
    hazardCategory: 'allergen',
    pathogenOrAllergen: 'Undeclared Peanut',
    recallingFirm: { displayName: 'Acme Foods', rawVariants: ['Acme Foods'] },
    brands: [],
    productDescription: 'Crunchy Trail Mix',
    retailerNames: [],
    heroImageUrl: null,
    geography: { scope: 'unknown', states: [], confidence: 'inferred', sourceText: null },
    affectedProducts: [],
    quantityText: null,
    illnessStatement: null,
    reportsIllness: false,
    consumerAction: null,
    contactText: null,
    officialUrl: 'https://www.fda.gov/example',
    otherOfficialUrls: [],
    sourceIdentifiers: [],
    publishedAt: '2026-09-01',
    lastPublicActivityAt: '2026-09-01',
    ...overrides,
  };
}

function activeCase(overrides: Partial<CaseLink> = {}): CaseLink {
  return { id: CASE, state: 'active', mergedInto: null, projection: projection(), ...overrides };
}

// ── Arguments ────────────────────────────────────────────────────────────────

test('arguments: no subscription lists; one subscription sends; recall and dry-run are optional', () => {
  assert.deepEqual(parsePushTestArgs([]), { mode: 'list' });
  assert.deepEqual(parsePushTestArgs(['--subscription', SUB]), {
    mode: 'send',
    subscriptionId: SUB,
    recallCaseId: null,
    dryRun: false,
  });
  assert.deepEqual(parsePushTestArgs(['--subscription', SUB, '--recall', CASE, '--dry-run']), {
    mode: 'send',
    subscriptionId: SUB,
    recallCaseId: CASE,
    dryRun: true,
  });
});

test('arguments: anything that is not one explicit subscription uuid is refused', () => {
  for (const argv of [
    ['--subscription'],
    ['--subscription', '--recall', CASE],
    ['--subscription', 'all'],
    ['--subscription', '*'],
    ['--recall', CASE],
    ['--dry-run'],
    ['--subscription', SUB, '--recall'],
    ['--subscription', SUB, '--recall', 'https://example.com'],
  ]) {
    assert.equal(parsePushTestArgs(argv).mode, 'usage', argv.join(' '));
  }
});

// ── Messages ─────────────────────────────────────────────────────────────────

test('plain test: Lotly-branded, opens nothing when tapped', () => {
  const message = buildPlainTestMessage(TOKEN);
  assert.equal(message.title, TEST_TITLE);
  assert.equal(message.body, TEST_BODY);
  assert.match(message.title, /Lotly/);
  assert.doesNotMatch(`${message.title} ${message.body}`, /\bRecall\b/);
  assert.equal(parseRecallPushPayload(message.data), null);
});

test('recall test: the app would open exactly this case, with the real copy marked Test', () => {
  const built = buildRecallTestMessage(TOKEN, activeCase(), NOW);
  assert.ok(built.ok);
  const { message } = built;
  assert.deepEqual(parseRecallPushPayload(message.data), {
    recallCaseId: CASE,
    notificationEventId: null,
  });
  const real = formatPushContent({
    id: 'x',
    recallCaseId: CASE,
    kind: 'initial',
    triggerRuleId: 'new_case',
    payloadSummary: '',
    createdAt: NOW.toISOString(),
    projection: projection(),
  });
  assert.equal(message.title, `${RECALL_TEST_TITLE_PREFIX}${real.title}`);
  assert.equal(message.body, real.body);
  assert.ok(message.title.startsWith('Test: Recall alert: '));
  assert.deepEqual(message.data, { kind: 'recall', recallCaseId: CASE, test: true });
});

test('recall test: a missing, merged, closed or retracted case is refused', () => {
  assert.equal(buildRecallTestMessage(TOKEN, null, NOW).ok, false);
  const merged = buildRecallTestMessage(
    TOKEN,
    activeCase({ mergedInto: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }),
    NOW,
  );
  assert.equal(merged.ok, false);
  for (const state of ['closed', 'retracted'] as const) {
    assert.equal(buildRecallTestMessage(TOKEN, activeCase({ state }), NOW).ok, false, state);
  }
});

test('the operator view never contains the device token', () => {
  const built = buildRecallTestMessage(TOKEN, activeCase(), NOW);
  assert.ok(built.ok);
  for (const message of [buildPlainTestMessage(TOKEN), built.message]) {
    assert.ok(!describeTestMessage(message).includes(TOKEN));
    assert.ok(!describeTestMessage(message).includes('secret-device-token'));
  }
});

test('the script builds through this module and prints no token', () => {
  const script = readFileSync(join(__dirname, '..', '..', '..', 'scripts', 'push-test.ts'), 'utf8');
  assert.ok(script.includes('buildPlainTestMessage(token)'));
  assert.ok(script.includes('buildRecallTestMessage(token, recallCase, new Date())'));
  // No console call interpolates the token value or reads it off a message.
  assert.ok(!/console\.\w+\([^;]*\$\{token\}/.test(script));
  assert.ok(!/console\.\w+\([^;]*expo_push_token/.test(script));
  assert.ok(!script.includes('message.to'));
  assert.ok(!script.includes("from('notification_events')"), 'it never touches the ledger');
  assert.ok(!script.includes("from('notification_deliveries')"), 'or delivery rows');
  assert.ok(!/\bRecall test notification\b/.test(script), 'the old branding is gone');
  // Dry run returns before the transport exists.
  assert.ok(script.indexOf("console.log('\\nDry run") < script.indexOf('new ExpoPushTransport'));
});
