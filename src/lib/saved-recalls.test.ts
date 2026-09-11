/**
 * Saved recalls (P2A) — the behavioural half, driven against the real pure
 * module, plus the structural pins that keep the feature device-local and
 * keep Saved rendering the same card the feed does.
 *
 * The storage wrapper (saved-recalls-store) imports expo-file-system and so
 * is unimportable here, exactly like the preference store; everything that
 * decides anything lives in saved-recalls.ts and is exercised directly.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  isSavedId,
  missingSavedCount,
  parseSavedRecalls,
  sanitizeSavedIds,
  SAVE_ACCESSIBILITY_LABEL,
  SAVE_ACTION_LABEL,
  SAVED_ACCESSIBILITY_LABEL,
  SAVED_ACTION_LABEL,
  SAVED_EMPTY_BODY,
  SAVED_EMPTY_TITLE,
  SAVED_RECALLS_SCHEMA_VERSION,
  savedMissingNotice,
  selectSavedItems,
  serializeSavedRecalls,
  toggleSavedId,
} from './saved-recalls';

const SRC = join(__dirname, '..');
const read = (...parts: string[]): string => readFileSync(join(SRC, ...parts), 'utf8');

const SAVED_SCREEN = read('app', '(tabs)', 'saved.tsx');
const SAVE_BUTTON = read('components', 'save-recall-button.tsx');
const CARD = read('components', 'recall-card.tsx');
const DETAIL = read('app', 'recall', '[id].tsx');
const STORE = read('lib', 'saved-recalls-store.ts');

// ── Toggling ────────────────────────────────────────────────────────────────

test('saving prepends, so Saved reads newest-first', () => {
  let ids: string[] = [];
  ids = toggleSavedId(ids, 'first');
  ids = toggleSavedId(ids, 'second');
  ids = toggleSavedId(ids, 'third');
  assert.deepEqual(ids, ['third', 'second', 'first']);
});

test('unsaving removes exactly that recall and keeps the rest in order', () => {
  const ids = ['c', 'b', 'a'];
  assert.deepEqual(toggleSavedId(ids, 'b'), ['c', 'a']);
  assert.deepEqual(ids, ['c', 'b', 'a'], 'the input list must not be mutated');
});

test('toggling the same recall twice returns to the starting state', () => {
  const start = ['x', 'y'];
  assert.deepEqual(toggleSavedId(toggleSavedId(start, 'z'), 'z'), start);
});

test('isSavedId answers exactly what the control renders from', () => {
  assert.equal(isSavedId(['a', 'b'], 'b'), true);
  assert.equal(isSavedId(['a', 'b'], 'c'), false);
  assert.equal(isSavedId([], 'a'), false);
});

// ── Persistence round-trip ──────────────────────────────────────────────────

test('a saved list survives a write/read round trip, order intact', () => {
  const ids = ['case-3', 'case-2', 'case-1'];
  assert.deepEqual(parseSavedRecalls(serializeSavedRecalls(ids)), ids);
});

test('a missing, corrupt, or foreign document reads as nothing saved — never throws', () => {
  for (const text of [
    null,
    '',
    'not json',
    '[]',
    '{}',
    'null',
    '{"version":1}',
    '{"version":1,"ids":"nope"}',
    // A document written by a future schema is discarded whole rather than
    // half-read: that is what the version field is for.
    JSON.stringify({ version: SAVED_RECALLS_SCHEMA_VERSION + 1, ids: ['a'] }),
  ]) {
    assert.deepEqual(parseSavedRecalls(text), [], `parse failed for ${JSON.stringify(text)}`);
  }
});

test('stored ids are sanitized: no blanks, no duplicates, first occurrence wins', () => {
  assert.deepEqual(sanitizeSavedIds(['a', '', '  ', 'b', 'a', 42, null, ' c ']), ['a', 'b', 'c']);
});

// ── Resolving against the live corpus ───────────────────────────────────────

const corpus = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

test('Saved lists the live corpus rows in SAVE order, not corpus order', () => {
  assert.deepEqual(
    selectSavedItems(['c', 'a'], corpus).map((item) => item.id),
    ['c', 'a'],
  );
});

test('a saved recall that left the active feed is skipped and counted, never invented', () => {
  const ids = ['a', 'gone', 'c'];
  assert.deepEqual(
    selectSavedItems(ids, corpus).map((item) => item.id),
    ['a', 'c'],
  );
  assert.equal(missingSavedCount(ids, corpus), 1);
  assert.equal(savedMissingNotice(1), '1 saved recall is no longer in the active feed.');
  assert.equal(savedMissingNotice(2), '2 saved recalls are no longer in the active feed.');
  // Nothing is said when nothing is missing.
  assert.equal(savedMissingNotice(0), null);
});

// ── Copy ────────────────────────────────────────────────────────────────────

test('the control states the condition visibly and the action aloud', () => {
  assert.equal(SAVE_ACTION_LABEL, 'Save');
  assert.equal(SAVED_ACTION_LABEL, 'Saved');
  assert.equal(SAVE_ACCESSIBILITY_LABEL, 'Save this recall');
  assert.equal(SAVED_ACCESSIBILITY_LABEL, 'Saved. Remove from Saved');
  // The label is never the only signal: the control also reports selection.
  assert.match(SAVE_BUTTON, /accessibilityState=\{\{ selected: saved \}\}/);
  assert.match(SAVE_BUTTON, /accessibilityLabel=\{saved \? SAVED_ACCESSIBILITY_LABEL/);
});

test('the empty state invites the action and says where saves live', () => {
  assert.equal(SAVED_EMPTY_TITLE, 'Nothing saved yet');
  assert.match(SAVED_EMPTY_BODY, /Save a recall from the feed or its detail page/);
  assert.match(SAVED_EMPTY_BODY, /stay on this device/);
  assert.match(SAVED_SCREEN, /title=\{SAVED_EMPTY_TITLE\} body=\{SAVED_EMPTY_BODY\}/);
});

// ── Structural guarantees ───────────────────────────────────────────────────

test('the empty state cannot be shown before storage and the corpus have answered', () => {
  // Rendering "Nothing saved yet" while either is still loading would tell a
  // user with saved recalls that they have none.
  assert.match(SAVED_SCREEN, /if \(!loaded \|\| state\.status === 'loading'\)/);
  const emptyCheck = SAVED_SCREEN.indexOf('if (ids.length === 0)');
  const loadCheck = SAVED_SCREEN.indexOf("if (!loaded || state.status === 'loading')");
  assert.ok(loadCheck >= 0 && emptyCheck > loadCheck, 'the loading gate must come first');
});

test('a saved item opens the ordinary Recall Details route, through the shared card', () => {
  assert.match(SAVED_SCREEN, /import \{ RecallCard \} from '@\/components\/recall-card'/);
  assert.match(CARD, /pathname: '\/recall\/\[id\]', params: \{ id: model\.id \}/);
  // Saved renders NO card of its own — one implementation, so a saved recall
  // can never word anything differently from the feed.
  assert.ok(!SAVED_SCREEN.includes('StyleSheet') || !SAVED_SCREEN.includes('RiskBadge'));
  assert.ok(!SAVED_SCREEN.includes('buildDetailModel'));
});

test('saving is device-local: no server call, no installation identity, no sync', () => {
  for (const source of [STORE, SAVE_BUTTON, SAVED_SCREEN]) {
    for (const forbidden of [
      'installation-id',
      'getOrCreateInstallationId',
      'push-api',
      'push-registration',
      'supabase',
      'fetch(',
    ]) {
      assert.ok(!source.includes(forbidden), `saved recalls must not reference ${forbidden}`);
    }
  }
});

test('the saved list is cleared by "Reset app and delete my data"', () => {
  // Device-local user data behind a control that promises the app returns to
  // its default state: leaving bookmarks behind would make that copy false.
  const orchestrator = read('lib', 'installation-reset.ts');
  const runner = read('lib', 'installation-reset-runner.ts');
  assert.match(orchestrator, /clearLocalSavedRecalls\(\): Promise<void>;/);
  assert.match(orchestrator, /await deps\.clearLocalSavedRecalls\(\);/);
  assert.match(runner, /clearLocalSavedRecalls: deleteLocalSavedRecalls/);
  assert.match(STORE, /export async function deleteLocalSavedRecalls/);
});

test('the privacy document and the reset dialog both name saved recalls', () => {
  // A new device-local store must appear in the app's own account of what it
  // keeps, and in the confirmation of the control that destroys it —
  // otherwise both claims are quietly incomplete.
  const privacy = read('content', 'privacy-data-controls.ts');
  assert.match(privacy, /The recalls you saved/);
  assert.match(privacy, /never sent to Recall’s server/);
  assert.match(read('lib', 'installation-reset.ts'), /removes your ' \+\n  'saved recalls/);
});

test('Saved never shows community shopper-report data', () => {
  // Community counts belong to Recall Details, behind the server gate. Saved
  // must not grow a second, ungated surface for them.
  for (const forbidden of [
    'CommunityReportsBlock',
    'shopper-report',
    'loadReportSummary',
    'shoppers reported',
  ]) {
    assert.ok(!SAVED_SCREEN.includes(forbidden), `Saved must not reference ${forbidden}`);
  }
  assert.ok(!CARD.includes('shopper'), 'the shared card must not carry community data either');
});

test('the save control is the same component on the card and on Detail', () => {
  assert.match(CARD, /import \{ SaveRecallButton \} from '@\/components\/save-recall-button'/);
  assert.match(DETAIL, /import \{ SaveRecallButton \} from '@\/components\/save-recall-button'/);
  assert.match(DETAIL, /<SaveRecallButton caseId=\{model\.id\} \/>/);
});

test('saving never writes a preference, a ranking signal, or an official field', () => {
  for (const source of [STORE, SAVE_BUTTON, CARD]) {
    for (const forbidden of ['savePreferences', 'evaluatePersonalRelevance', 'affectsMe']) {
      assert.ok(!source.includes(forbidden), `the save path must not reference ${forbidden}`);
    }
  }
});
