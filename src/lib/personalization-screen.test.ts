/**
 * The Personalization screen's list rules and copy (P2B6A; multi-state in
 * P2B7U), driven against the real module: the complete state catalog and its
 * filter, the store catalog in a stable canonical order that a selection
 * never disturbs, the main screen's compact state summary and full store
 * summary, both selectors' counts in words, the toggles that produce exactly
 * the shape the store saves and the Profile summary reads, the autosave
 * words, the three not-ready answers that may never pass for an empty
 * selection, and the approved copy without an em dash in it.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CONSUMER_ALLERGENS,
  EMPTY_PREFERENCES,
  sanitizePreferences,
  STATE_CODES_IN_ORDER,
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
  ADD_STATES_LABEL,
  ADD_STORES_LABEL,
  chosenStores,
  EDIT_STATES_LABEL,
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
  stateActionLabel,
  stateChoices,
  stateCountLabel,
  STATE_SEARCH_HINT,
  STATE_SEARCH_LABEL,
  STATE_SEARCH_NO_MATCH,
  STATE_SEARCH_PLACEHOLDER,
  STATE_SECTION_HELPER,
  STATE_SECTION_LABEL,
  stateSummary,
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
  clearStateDraft,
  toggleStateCode,
  UNSUPPORTED_STATE,
  withStates,
} from './personalization-screen';

// ── The state list ──────────────────────────────────────────────────────────

test('every supported jurisdiction is offered, by name, in the one canonical order', () => {
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
  // The list's order IS the domain's, not a sort of this module's own — so
  // the first two names the Settings row shows are the first two here.
  assert.deepEqual(
    choices.map((c) => c.code),
    STATE_CODES_IN_ORDER,
  );
  // DC sorts by NAME, between Delaware and Florida — not last, where the
  // postal map's own key order leaves it.
  const codes = choices.map((c) => c.code);
  assert.equal(codes.indexOf('DE') + 1, codes.indexOf('DC'));
  assert.equal(codes.indexOf('DC') + 1, codes.indexOf('FL'));
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
  assert.equal(stateTriggerLabel([]), 'States: none selected');
  assert.equal(stateTriggerLabel(['California']), 'States: California');
  assert.equal(
    stateTriggerLabel(['California', 'Montana', 'New York']),
    'States: California, Montana and New York',
  );
  assert.equal(storeTriggerLabel([]), 'Stores: none selected');
  assert.equal(storeTriggerLabel(['Costco']), 'Stores: Costco');
  assert.equal(storeTriggerLabel(['Costco', 'Walmart']), 'Stores: Costco and Walmart');
  assert.equal(listNames(['A', 'B', 'C']), 'A, B and C');
  assert.equal(listNames([]), '');
});

// ── The edits produce exactly the stored shape ──────────────────────────────

test('toggles add at the end and remove by filtering — the same shape the store saves', () => {
  const peanut = toggleAllergen(EMPTY_PREFERENCES, 'peanut');
  assert.deepEqual(peanut, { states: [], allergens: ['peanut'], retailers: [] });
  const both = toggleAllergen(peanut, 'milk');
  assert.deepEqual(both.allergens, ['peanut', 'milk']);
  assert.deepEqual(toggleAllergen(both, 'peanut').allergens, ['milk']);

  const costco = toggleRetailer(EMPTY_PREFERENCES, 'costco');
  assert.deepEqual(costco.retailers, ['costco']);
  assert.deepEqual(toggleRetailer(toggleRetailer(costco, 'walmart'), 'costco').retailers, [
    'walmart',
  ]);

  assert.deepEqual(withStates(EMPTY_PREFERENCES, ['CA']).states, ['CA']);
  assert.deepEqual(withStates(withStates(EMPTY_PREFERENCES, ['CA']), []).states, []);
  // Inputs are never mutated.
  assert.deepEqual(EMPTY_PREFERENCES, { states: [], allergens: [], retailers: [] });
});

// ── The jurisdiction draft ──────────────────────────────────────────────────

test('Clear selection empties a draft, and clearing nothing is a true no-op (P2B7V)', () => {
  // With something checked it empties the draft and nothing else.
  assert.deepEqual(clearStateDraft(['CA', 'NY']), []);
  assert.deepEqual(clearStateDraft(['CA']), []);

  // With NOTHING checked it is a no-op in the strongest sense available: the
  // SAME REFERENCE comes back, so React's state setter bails out, no render
  // happens, and no dirty-state transition exists for a dismissal to discard.
  // `deepEqual` would pass for a fresh `[]` too, which is exactly the
  // regression this asserts against — hence identity.
  const empty: readonly string[] = [];
  assert.equal(clearStateDraft(empty), empty);
  const frozen = Object.freeze(['CA', 'NY']) as readonly string[];
  assert.notEqual(clearStateDraft(frozen), frozen);

  // It never mutates the draft it was handed, cleared or not.
  const draft = ['CA', 'NY'];
  clearStateDraft(draft);
  assert.deepEqual(draft, ['CA', 'NY']);

  // Idempotent: clearing twice reaches the same answer as clearing once, and
  // the second clear is itself the no-op.
  const once = clearStateDraft(['CA', 'NY']);
  assert.equal(clearStateDraft(once), once);

  // Clearing is a DRAFT edit only: the function's whole signature is draft in,
  // draft out. It cannot reach preferences, a store, or a dismissal, because
  // it is handed none of them.
  assert.equal(clearStateDraft.length, 1);
});

test('toggling a jurisdiction adds and removes it, in canonical order, never by tap order', () => {
  assert.deepEqual(toggleStateCode([], 'NY'), ['NY']);
  // Tapped New York, then California: stored California first, because the
  // order is the list's, not the finger's.
  assert.deepEqual(toggleStateCode(['NY'], 'CA'), ['CA', 'NY']);
  assert.deepEqual(toggleStateCode(['CA', 'NY'], 'MT'), ['CA', 'MT', 'NY']);
  // Removing one leaves the others exactly as they were.
  assert.deepEqual(toggleStateCode(['CA', 'MT', 'NY'], 'MT'), ['CA', 'NY']);
  assert.deepEqual(toggleStateCode(['CA'], 'CA'), []);
  // Tapping the same rows in either order reaches the same stored answer.
  const oneWay = ['DC', 'NY', 'MT'].reduce(toggleStateCode, [] as string[]);
  const other = ['MT', 'DC', 'NY'].reduce(toggleStateCode, [] as string[]);
  assert.deepEqual(oneWay, other);
  assert.deepEqual(oneWay, ['DC', 'MT', 'NY']);
  // A draft is never mutated in place.
  const draft = ['CA'];
  toggleStateCode(draft, 'NY');
  assert.deepEqual(draft, ['CA']);
});

test('committing a draft stores it de-duplicated, in canonical order, dropping unknown codes', () => {
  assert.deepEqual(withStates(EMPTY_PREFERENCES, ['NY', 'CA', 'NY']).states, ['CA', 'NY']);
  assert.deepEqual(withStates(EMPTY_PREFERENCES, ['ZZ', 'CA']).states, ['CA']);
  // Committing touches nothing else.
  const prefs = { states: ['TX'], allergens: ['milk'], retailers: ['costco'] };
  const next = withStates(prefs, ['CA', 'DC']);
  assert.deepEqual(next, { states: ['CA', 'DC'], allergens: ['milk'], retailers: ['costco'] });
  assert.deepEqual(prefs.states, ['TX'], 'the input is not mutated');
});

test('searching narrows what is shown and knows nothing about what is checked', () => {
  const choices = stateChoices();
  // Three checked; a search that hides two of them.
  const draft = ['CA', 'MT', 'NY'];
  const shown = filterStateChoices(choices, 'new');
  assert.deepEqual(
    shown.map((c) => c.code),
    ['NH', 'NJ', 'NM', 'NY'],
  );
  assert.ok(!shown.some((c) => c.code === 'CA'));
  // Checking one more while the search is on touches only the draft.
  const next = toggleStateCode(draft, 'NJ');
  assert.deepEqual(next, ['CA', 'MT', 'NJ', 'NY']);
  // Clearing the search brings the list back with every selection intact.
  const all = filterStateChoices(choices, '');
  assert.equal(all.length, 52);
  for (const code of next) assert.ok(all.some((c) => c.code === code));
  // The filter is a pure function of (choices, query): the selection is not
  // an argument it could remove something from.
  assert.equal(filterStateChoices.length, 2);
});

// ── The main screen's compact state summary ─────────────────────────────────

test('the Settings row names zero, one and two states in full, then counts the rest', () => {
  assert.equal(stateSummary([]), STATE_PLACEHOLDER);
  assert.equal(STATE_PLACEHOLDER, 'No states selected');
  assert.equal(stateSummary(['CA']), 'California');
  assert.equal(stateSummary(['CA', 'NY']), 'California, New York');
  // The founder's example: three chosen reads as two names and a count.
  assert.equal(stateSummary(['CA', 'NY', 'TX']), 'California, New York +1');
  assert.equal(stateSummary(['CA', 'NY', 'TX', 'MT']), 'California, Montana +2');
  // Canonical order, not the order the codes were handed over.
  assert.equal(stateSummary(['TX', 'NY', 'CA']), 'California, New York +1');
  // Never an unbounded list, however many are chosen.
  const everywhere = stateSummary(STATE_CODES_IN_ORDER);
  assert.equal(everywhere, 'Alabama, Alaska +50');
  assert.equal(everywhere.split(', ').length, 2);
  assert.equal(stateActionLabel([]), ADD_STATES_LABEL);
  assert.equal(stateActionLabel(['CA']), EDIT_STATES_LABEL);
  assert.equal(ADD_STATES_LABEL, 'Add states');
  assert.equal(EDIT_STATES_LABEL, 'Edit states');
});

test('the state selector counts in words: none, one, many', () => {
  assert.equal(stateCountLabel(0), 'No states selected');
  assert.equal(stateCountLabel(1), '1 state selected');
  assert.equal(stateCountLabel(3), '3 states selected');
  assert.equal(stateCountLabel(52), '52 states selected');
});

test('edited preferences survive the store’s own sanitizer unchanged and read on Profile', () => {
  let prefs = withStates(EMPTY_PREFERENCES, ['CA', 'NY', 'DC']);
  for (const option of CONSUMER_ALLERGENS.slice(0, 3)) prefs = toggleAllergen(prefs, option.token);
  prefs = toggleRetailer(toggleRetailer(prefs, 'costco'), 'trader-joes');
  // Serialize and reload exactly as the store does: several jurisdictions
  // come back, in the same canonical order, with nothing added or lost.
  const reloaded = sanitizePreferences(JSON.parse(JSON.stringify(prefs)));
  assert.deepEqual(reloaded, prefs);
  assert.deepEqual(reloaded.states, ['CA', 'DC', 'NY']);
  assert.deepEqual(Object.keys(prefs).sort(), ['allergens', 'retailers', 'states']);
  // The Profile card's summary reads exactly these values.
  const summary = summarizePreferences(prefs);
  assert.deepEqual(summary.states, ['California', 'District of Columbia', 'New York']);
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
  assert.equal(STATE_SECTION_LABEL, 'States you shop in');
  assert.equal(
    STATE_SECTION_HELPER,
    'Choose the states you want Lotly to watch. You can choose more than one. Nationwide recalls are always included.',
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

test('the state search shares the questionnaire’s words, except the one that says what a row does', () => {
  assert.equal(STATE_SEARCH_LABEL, QUESTIONNAIRE_STATE_SEARCH_LABEL);
  assert.equal(STATE_SEARCH_PLACEHOLDER, QUESTIONNAIRE_STATE_SEARCH_PLACEHOLDER);
  assert.equal(STATE_SEARCH_NO_MATCH, QUESTIONNAIRE_STATE_SEARCH_NO_MATCH);
  assert.equal(STATE_SEARCH_LABEL, 'Search states');
  // The HINT deliberately differs since P2B7U, because the two lists no
  // longer behave alike: personalization is a checkbox list of any number of
  // jurisdictions, while a shopper report asks for the ONE state a product
  // was found in and stays a radio list. Telling a screen-reader user to
  // "choose a state from the list" on a multi-select would misdescribe it.
  assert.equal(STATE_SEARCH_HINT, 'Filters the list of states below. Check a state to choose it.');
  assert.equal(
    QUESTIONNAIRE_STATE_SEARCH_HINT,
    'Filters the list of states below. Choose a state from the list.',
  );
  assert.notEqual(STATE_SEARCH_HINT, QUESTIONNAIRE_STATE_SEARCH_HINT);
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
