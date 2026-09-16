/**
 * The Personalization screen's list rules and copy (P2B6A), driven against
 * the real module: the complete state catalog and its filter, the store
 * catalog in a stable canonical order that a selection never disturbs, the
 * main screen's store summary and the selector's count in words, the
 * toggles that produce exactly the shape the store saves and the Profile
 * summary reads, the autosave words, the three not-ready answers that may
 * never pass for an empty selection, and the approved copy without an em
 * dash in it.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CONSUMER_ALLERGENS,
  EMPTY_PREFERENCES,
  sanitizePreferences,
  SUPPORTED_STATE_CODES,
} from '@/domain/preferences';
import { RETAILER_CATALOG, searchRetailers } from '@/domain/retailer-catalog';
import { ALLERGEN_SECTION_HELPER, ALLERGEN_SECTION_LABEL } from '@/lib/personalization-copy';
import { NONE_SELECTED, NOT_CHOSEN, summarizePreferences } from '@/lib/profile-hub';
import {
  STATE_SEARCH_HINT as QUESTIONNAIRE_STATE_SEARCH_HINT,
  STATE_SEARCH_LABEL as QUESTIONNAIRE_STATE_SEARCH_LABEL,
  STATE_SEARCH_NO_MATCH as QUESTIONNAIRE_STATE_SEARCH_NO_MATCH,
  STATE_SEARCH_PLACEHOLDER as QUESTIONNAIRE_STATE_SEARCH_PLACEHOLDER,
} from '@/lib/shopper-report-presentation';
import * as screen from './personalization-screen';
import {
  ADD_STORES_LABEL,
  chosenStores,
  EDIT_STORES_LABEL,
  FAILED_STATE,
  filterStateChoices,
  listNames,
  LOADING_STATE,
  NO_STORES_SELECTED,
  PERSONALIZATION_INTRO,
  SAVE_STATUS,
  saveStatusText,
  STATE_PLACEHOLDER,
  stateChoices,
  STATE_SEARCH_HINT,
  STATE_SEARCH_LABEL,
  STATE_SEARCH_NO_MATCH,
  STATE_SEARCH_PLACEHOLDER,
  STATE_SECTION_HELPER,
  STATE_SECTION_LABEL,
  stateTriggerLabel,
  storeActionLabel,
  storeCountLabel,
  storeRows,
  STORE_SEARCH_PLACEHOLDER,
  STORE_SECTION_HELPER,
  STORE_SECTION_LABEL,
  storeSummary,
  storeTriggerLabel,
  toggleAllergen,
  toggleRetailer,
  UNSUPPORTED_STATE,
  withState,
} from './personalization-screen';

// ── The state list ──────────────────────────────────────────────────────────

test('every supported jurisdiction is offered, by name, in alphabetical order', () => {
  const choices = stateChoices();
  assert.equal(choices.length, SUPPORTED_STATE_CODES.length);
  assert.equal(choices.length, 52);
  assert.deepEqual(choices.map((c) => c.code).sort(), [...SUPPORTED_STATE_CODES].sort());
  assert.deepEqual(
    choices.map((c) => c.name),
    [...choices.map((c) => c.name)].sort((a, b) => a.localeCompare(b)),
  );
  assert.ok(choices.every((c) => c.name.length > 0));
  assert.ok(choices.some((c) => c.code === 'DC'));
  assert.ok(choices.some((c) => c.code === 'PR'));
});

test('the state filter is a case-insensitive substring on the name; blank shows all', () => {
  const choices = stateChoices();
  assert.equal(filterStateChoices(choices, '').length, 52);
  assert.equal(filterStateChoices(choices, '   ').length, 52);
  assert.deepEqual(
    filterStateChoices(choices, 'CAL').map((c) => c.code),
    ['CA'],
  );
  assert.deepEqual(
    filterStateChoices(choices, ' new ').map((c) => c.name),
    ['New Hampshire', 'New Jersey', 'New Mexico', 'New York'],
  );
  assert.deepEqual(filterStateChoices(choices, 'zzz'), []);
});

// ── The store list: stable, canonical, never moved by a selection ───────────

test('the selector shows the whole catalog in its canonical order, and a selection is not an input', () => {
  const rows = storeRows('');
  assert.equal(rows.length, RETAILER_CATALOG.length);
  assert.deepEqual(
    rows.map((r) => r.id),
    searchRetailers('').map((r) => r.id),
  );
  assert.deepEqual(
    rows.map((r) => r.name),
    [...rows.map((r) => r.name)].sort((a, b) => a.localeCompare(b)),
  );
  // The rows are a pure function of the query: checking Costco cannot move
  // it, because the selection is not passed in at all.
  assert.equal(storeRows.length, 1);
  const costcoAt = rows.findIndex((r) => r.id === 'costco');
  assert.ok(costcoAt > 0);
  assert.equal(
    storeRows('').findIndex((r) => r.id === 'costco'),
    costcoAt,
  );
});

test('the store search keeps the catalog’s own matching (names and aliases) and its order', () => {
  const typed = storeRows('co');
  assert.deepEqual(
    typed.map((r) => r.id),
    searchRetailers('co').map((r) => r.id),
  );
  assert.ok(typed.some((r) => r.id === 'costco'));
  assert.ok(storeRows('Costco Wholesale').some((r) => r.id === 'costco'));
  assert.ok(
    storeRows('whole foods').some((r) => r.id === 'whole-foods'),
    'an alias matches',
  );
  assert.deepEqual(storeRows('zzzz'), []);
  // Clearing the search restores the whole list.
  assert.equal(storeRows('').length, RETAILER_CATALOG.length);
});

test('the chosen stores keep their order under catalog names; an unknown id shows as itself', () => {
  assert.deepEqual(chosenStores(['trader-joes', 'costco']), [
    { id: 'trader-joes', name: "Trader Joe's" },
    { id: 'costco', name: 'Costco' },
  ]);
  assert.deepEqual(chosenStores(['nope']), [{ id: 'nope', name: 'nope' }]);
});

// ── The main screen's summary and the selector's count ──────────────────────

test('the main screen names zero, one and many stores truthfully, with one action', () => {
  assert.equal(storeSummary([]), NO_STORES_SELECTED);
  assert.equal(NO_STORES_SELECTED, 'No stores selected');
  assert.equal(storeSummary(['costco']), 'Costco');
  assert.equal(storeSummary(['costco', 'trader-joes', 'walmart']), "Costco, Trader Joe's, Walmart");
  // Every name, in the order chosen — never abbreviated on the main screen.
  const many = ['whole-foods', 'sprouts', 'giant-food', 'tops', 'pcc', 'costco'];
  assert.equal(storeSummary(many).split(', ').length, 6);
  assert.equal(storeActionLabel([]), ADD_STORES_LABEL);
  assert.equal(storeActionLabel(['costco']), EDIT_STORES_LABEL);
  assert.equal(ADD_STORES_LABEL, 'Add stores');
  assert.equal(EDIT_STORES_LABEL, 'Edit stores');
});

test('the selector counts in words: none, one, many', () => {
  assert.equal(storeCountLabel(0), 'No stores selected');
  assert.equal(storeCountLabel(1), '1 store selected');
  assert.equal(storeCountLabel(2), '2 stores selected');
  assert.equal(storeCountLabel(12), '12 stores selected');
});

test('the triggers speak their section and every current choice', () => {
  assert.equal(stateTriggerLabel('California'), 'State: California');
  assert.equal(stateTriggerLabel(null), 'State: not chosen');
  assert.equal(storeTriggerLabel([]), 'Stores: none selected');
  assert.equal(storeTriggerLabel(['Costco']), 'Stores: Costco');
  assert.equal(storeTriggerLabel(['Costco', 'Walmart']), 'Stores: Costco and Walmart');
  assert.equal(listNames(['A', 'B', 'C']), 'A, B and C');
  assert.equal(listNames([]), '');
});

// ── The edits produce exactly the stored shape ──────────────────────────────

test('toggles add at the end and remove by filtering — the same shape the store saves', () => {
  const peanut = toggleAllergen(EMPTY_PREFERENCES, 'peanut');
  assert.deepEqual(peanut, { state: null, allergens: ['peanut'], retailers: [] });
  const both = toggleAllergen(peanut, 'milk');
  assert.deepEqual(both.allergens, ['peanut', 'milk']);
  assert.deepEqual(toggleAllergen(both, 'peanut').allergens, ['milk']);

  const costco = toggleRetailer(EMPTY_PREFERENCES, 'costco');
  assert.deepEqual(costco.retailers, ['costco']);
  assert.deepEqual(toggleRetailer(toggleRetailer(costco, 'walmart'), 'costco').retailers, [
    'walmart',
  ]);

  assert.equal(withState(EMPTY_PREFERENCES, 'CA').state, 'CA');
  assert.equal(withState(withState(EMPTY_PREFERENCES, 'CA'), null).state, null);
  // Inputs are never mutated.
  assert.deepEqual(EMPTY_PREFERENCES, { state: null, allergens: [], retailers: [] });
});

test('edited preferences survive the store’s own sanitizer unchanged and read on Profile', () => {
  let prefs = withState(EMPTY_PREFERENCES, 'CA');
  for (const option of CONSUMER_ALLERGENS.slice(0, 3)) prefs = toggleAllergen(prefs, option.token);
  prefs = toggleRetailer(toggleRetailer(prefs, 'costco'), 'trader-joes');
  assert.deepEqual(sanitizePreferences(prefs), prefs);
  assert.deepEqual(Object.keys(prefs).sort(), ['allergens', 'retailers', 'state']);
  // The Profile card's summary reads exactly these values.
  const summary = summarizePreferences(prefs);
  assert.equal(summary.state, 'California');
  assert.deepEqual(summary.allergens, ['Peanuts', 'Tree nuts', 'Milk']);
  assert.deepEqual(summary.retailers, ['Costco', "Trader Joe's"]);
});

// ── Autosave words ──────────────────────────────────────────────────────────

test('the autosave line is silent when idle and honest about an offline save', () => {
  assert.equal(saveStatusText('idle'), null);
  assert.equal(saveStatusText('saving'), 'Saving…');
  assert.equal(saveStatusText('saved'), 'Saved.');
  assert.equal(
    saveStatusText('local_only'),
    'Saved on this device. It will sync the next time you open Lotly online.',
  );
  assert.deepEqual(Object.keys(SAVE_STATUS).sort(), ['local_only', 'saved', 'saving']);
});

// ── Copy ────────────────────────────────────────────────────────────────────

test('the approved Personalization copy appears exactly', () => {
  assert.equal(
    PERSONALIZATION_INTRO,
    'Choose what Lotly should watch for. These preferences shape Affects me and your recall alerts. You can still browse every recall.',
  );
  assert.equal(STATE_SECTION_LABEL, 'Your state');
  assert.equal(
    STATE_SECTION_HELPER,
    'Choose the state you want Lotly to watch. Nationwide recalls are always included.',
  );
  assert.equal(ALLERGEN_SECTION_LABEL, 'Allergens to watch');
  assert.equal(
    ALLERGEN_SECTION_HELPER,
    'Choose any allergens that matter to you or someone you shop for.',
  );
  assert.equal(STORE_SECTION_LABEL, 'Stores you shop at');
  assert.equal(
    STORE_SECTION_HELPER,
    'Choose stores you shop at. Lotly flags recalls that name them. Some notices do not list every store, so an unflagged recall may still apply.',
  );
  assert.equal(STORE_SEARCH_PLACEHOLDER, 'Search stores');
});

test('no authored Personalization sentence carries an em dash', () => {
  for (const [name, value] of Object.entries(screen)) {
    const strings =
      typeof value === 'string'
        ? [value]
        : typeof value === 'object' && value !== null
          ? Object.values(value as Record<string, unknown>).filter(
              (v): v is string => typeof v === 'string',
            )
          : [];
    for (const text of strings) assert.ok(!text.includes('—'), `${name}: ${text}`);
  }
  assert.ok(!ALLERGEN_SECTION_HELPER.includes('—'));
  assert.ok(!ALLERGEN_SECTION_LABEL.includes('—'));
});

test('the state search speaks the same words as the questionnaire’s searchable list', () => {
  assert.equal(STATE_SEARCH_LABEL, QUESTIONNAIRE_STATE_SEARCH_LABEL);
  assert.equal(STATE_SEARCH_PLACEHOLDER, QUESTIONNAIRE_STATE_SEARCH_PLACEHOLDER);
  assert.equal(STATE_SEARCH_HINT, QUESTIONNAIRE_STATE_SEARCH_HINT);
  assert.equal(STATE_SEARCH_NO_MATCH, QUESTIONNAIRE_STATE_SEARCH_NO_MATCH);
  assert.equal(STATE_SEARCH_LABEL, 'Search states');
});

test('loading, failure and the web each have their own words — never an empty selection’s', () => {
  const empties = [NOT_CHOSEN, NONE_SELECTED, STATE_PLACEHOLDER, NO_STORES_SELECTED];
  for (const state of [LOADING_STATE, FAILED_STATE, UNSUPPORTED_STATE]) {
    for (const word of empties) {
      assert.ok(!state.title.includes(word) && !state.body.includes(word), `${state.title}`);
    }
  }
  assert.notEqual(LOADING_STATE.title, FAILED_STATE.title);
  assert.notEqual(FAILED_STATE.title, UNSUPPORTED_STATE.title);
  assert.match(FAILED_STATE.title, /could not be read/);
  assert.match(FAILED_STATE.body, /Nothing was changed/);
  assert.equal(UNSUPPORTED_STATE.body, 'Personalization is available in the Lotly mobile app.');
});
