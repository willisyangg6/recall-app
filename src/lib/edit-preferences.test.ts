/**
 * The one-page Edit preferences' rules (lib/edit-preferences.ts): one
 * isolated draft, what may be saved, how Save behaves through a double tap
 * and a failure, and what the chips show. The route drives exactly these
 * functions (app/onboarding/edit-preferences.tsx); the simulated save below
 * is the route's own sequence — one commit per request, a latch released
 * only by a failure.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { STATE_CODES_IN_ORDER, type UserRecallPreferences } from '@/domain/preferences';
import {
  allergenChips,
  beginEditing,
  canSaveDraft,
  chipsAsRows,
  editorHeadlineType,
  editorReducer,
  EDITOR_TYPE,
  saveRequest,
  stateChips,
  storeChips,
  type EditorAction,
  type EditorState,
} from '@/lib/edit-preferences';

const SAVED: UserRecallPreferences = {
  states: ['AL', 'AZ'],
  allergens: ['peanut', 'milk'],
  retailers: ['aldi'],
};

function run(state: EditorState, ...actions: EditorAction[]): EditorState {
  return actions.reduce(editorReducer, state);
}

/** The route's save: one commit per accepted request; a failure keeps the page. */
async function save(
  state: EditorState,
  commit: (prefs: UserRecallPreferences) => Promise<unknown>,
  latch: { saving: boolean },
): Promise<{ state: EditorState; left: boolean }> {
  const request = saveRequest(state);
  if (request === null || latch.saving) return { state, left: false };
  latch.saving = true;
  let next = editorReducer(state, { type: 'save-started' });
  try {
    await commit(request);
    return { state: next, left: true };
  } catch {
    latch.saving = false;
    next = editorReducer(next, { type: 'save-failed' });
    return { state: next, left: false };
  }
}

test('opening copies the saved preferences: editing the draft never touches the saved value', () => {
  const saved = structuredClone(SAVED);
  const opened = beginEditing(saved);
  assert.deepEqual(opened.draft, SAVED);
  assert.notEqual(opened.draft.states, saved.states);
  const edited = run(
    opened,
    { type: 'toggle-state', code: 'AZ' },
    { type: 'toggle-allergen', token: 'milk' },
    { type: 'toggle-store', id: 'costco' },
  );
  assert.deepEqual(saved, SAVED, 'the saved value changed');
  assert.deepEqual(edited.saved, SAVED, 'what Cancel returns to changed');
  assert.deepEqual(edited.draft, {
    states: ['AL'],
    allergens: ['peanut'],
    retailers: ['aldi', 'costco'],
  });
});

test('edits in each category keep the others: closing one chooser loses nothing', () => {
  const edited = run(
    beginEditing(SAVED),
    { type: 'toggle-store', id: 'costco' },
    { type: 'toggle-state', code: 'CA' },
    { type: 'toggle-allergen', token: 'egg' },
    { type: 'toggle-store', id: 'aldi' },
  );
  assert.deepEqual(edited.draft, {
    states: ['AL', 'AZ', 'CA'],
    allergens: ['peanut', 'milk', 'egg'],
    retailers: ['costco'],
  });
});

test('states stay in canonical order whatever the tap order', () => {
  const edited = run(
    beginEditing({ ...SAVED, states: [] }),
    { type: 'toggle-state', code: 'TX' },
    {
      type: 'toggle-state',
      code: 'AL',
    },
  );
  assert.deepEqual(edited.draft.states, ['AL', 'TX']);
  assert.ok(STATE_CODES_IN_ORDER.indexOf('AL') < STATE_CODES_IN_ORDER.indexOf('TX'));
});

test('Cancel needs nothing: leaving without a save request leaves the saved value as it was', () => {
  const edited = run(
    beginEditing(SAVED),
    { type: 'toggle-state', code: 'AL' },
    { type: 'clear-allergens' },
  );
  assert.deepEqual(edited.saved, SAVED);
  assert.notDeepEqual(edited.draft, SAVED);
});

test('at least one state is required; zero allergens and zero stores are valid saves', () => {
  const noStates = run(
    beginEditing(SAVED),
    { type: 'toggle-state', code: 'AL' },
    { type: 'toggle-state', code: 'AZ' },
  );
  assert.equal(canSaveDraft(noStates.draft), false);
  assert.equal(saveRequest(noStates), null);
  const noOptional = run(
    beginEditing(SAVED),
    { type: 'clear-allergens' },
    { type: 'toggle-store', id: 'aldi' },
  );
  assert.equal(canSaveDraft(noOptional.draft), true);
  assert.deepEqual(saveRequest(noOptional), { states: ['AL', 'AZ'], allergens: [], retailers: [] });
});

test('clearing no allergens is a true no-op', () => {
  const none = beginEditing({ ...SAVED, allergens: [] });
  assert.equal(editorReducer(none, { type: 'clear-allergens' }), none);
});

test('Save commits the whole draft exactly once, however many times it is pressed', async () => {
  const commits: UserRecallPreferences[] = [];
  let release!: () => void;
  const commit = (prefs: UserRecallPreferences) => {
    commits.push(prefs);
    return new Promise<void>((resolve) => {
      release = resolve;
    });
  };
  const latch = { saving: false };
  const edited = run(beginEditing(SAVED), { type: 'toggle-allergen', token: 'egg' });
  const first = save(edited, commit, latch);
  // A second and third tap while the first is in flight do nothing.
  const second = await save(edited, commit, latch);
  const third = await save(editorReducer(edited, { type: 'save-started' }), commit, latch);
  assert.equal(second.left, false);
  assert.equal(third.left, false);
  release();
  assert.equal((await first).left, true);
  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0], {
    states: ['AL', 'AZ'],
    allergens: ['peanut', 'milk', 'egg'],
    retailers: ['aldi'],
  });
});

test('a failed save keeps the page, the draft and a working retry', async () => {
  const latch = { saving: false };
  const edited = run(beginEditing(SAVED), { type: 'toggle-store', id: 'costco' });
  const failed = await save(edited, () => Promise.reject(new Error('disk full')), latch);
  assert.equal(failed.left, false);
  assert.equal(failed.state.save, 'failed');
  assert.deepEqual(failed.state.draft, edited.draft, 'the draft was lost');
  const commits: UserRecallPreferences[] = [];
  const retried = await save(failed.state, async (prefs) => commits.push(prefs), latch);
  assert.equal(retried.left, true);
  assert.deepEqual(commits, [edited.draft]);
});

test('while a save is in flight the draft cannot change; after a failure editing resumes', () => {
  const saving = editorReducer(beginEditing(SAVED), { type: 'save-started' });
  assert.equal(editorReducer(saving, { type: 'toggle-state', code: 'CA' }), saving);
  const failed = editorReducer(saving, { type: 'save-failed' });
  const edited = editorReducer(failed, { type: 'toggle-state', code: 'CA' });
  assert.equal(edited.save, 'idle');
  assert.deepEqual(edited.draft.states, ['AL', 'AZ', 'CA']);
});

test('chips: states by full name in canonical order, allergens in canonical order, stores as chosen', () => {
  const draft: UserRecallPreferences = {
    states: ['AL', 'DC', 'PR'],
    allergens: ['shellfish', 'peanut', 'milk'],
    retailers: ['costco', 'aldi'],
  };
  assert.deepEqual(
    stateChips(draft).map((c) => c.name),
    ['Alabama', 'District of Columbia', 'Puerto Rico'],
  );
  assert.deepEqual(
    allergenChips(draft).map((c) => c.id),
    ['peanut', 'milk', 'shellfish'],
  );
  assert.deepEqual(
    storeChips(draft).map((c) => c.id),
    ['costco', 'aldi'],
  );
  assert.ok(storeChips(draft).every((c) => c.name.length > 0));
});

test('the editor’s measured type, and chip rows and the smaller headline base at the accessibility sizes', () => {
  assert.deepEqual(EDITOR_TYPE.headline, { fontSize: 31, lineHeight: 37 });
  assert.deepEqual(editorHeadlineType(1), EDITOR_TYPE.headline);
  assert.deepEqual(editorHeadlineType(1.5), { fontSize: 23, lineHeight: 30 });
  assert.equal(chipsAsRows(1.353), false);
  assert.equal(chipsAsRows(1.5), true);
  for (const type of Object.values(EDITOR_TYPE)) assert.ok(type.lineHeight >= type.fontSize);
});
