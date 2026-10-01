/**
 * The Stores step's quick choices (the receipt, 2026-09-30): the six are
 * exactly the approved canonical ids in the approved order, each the
 * catalog's own record; the four stores the old grid also offered stay one
 * search away; the edits the step makes (toggle, clear, empty clear,
 * search) keep the saved representation exactly as before; and the search
 * sheet's frame is a function of the window and text size alone.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EMPTY_PREFERENCES } from '@/domain/preferences';
import { RETAILER_CATALOG, retailerById } from '@/domain/retailer-catalog';
import { storeRows, toggleRetailer } from '@/lib/personalization-screen';
import {
  clearRetailers,
  POPULAR_RETAILER_IDS,
  POPULAR_RETAILERS,
  RAISED_SHEET_AT_SCALE,
  retailerSearchResults,
  SHEET_BACKDROP_OPACITY,
  SHEET_MIN_CONTEXT,
  SHEET_MOTION,
  searchSheetTop,
} from '@/lib/retailer-grid';

/** iOS's text-size multipliers, as React Native reports them in `fontScale`. */
const TEXT_SIZES = {
  xSmall: 0.823,
  large: 1,
  xLarge: 1.118,
  xxLarge: 1.235,
  xxxLarge: 1.353,
  ax1: 1.786,
  ax2: 2.143,
  ax3: 2.643,
  ax4: 3.143,
  ax5: 3.571,
} as const;

/** The approved receipt's six, top to bottom, as the founder named them. */
const APPROVED = [
  ['walmart', 'Walmart'],
  ['costco', 'Costco'],
  ['kroger', 'Kroger'],
  ['aldi', 'Aldi'],
  ['target', 'Target'],
  ['trader-joes', "Trader Joe's"],
] as const;

/** The old grid's other four: no longer quick choices, never less reachable. */
const FORMER_POPULAR = [
  ['sams-club', 'sam'],
  ['safeway', 'safeway'],
  ['publix', 'publix'],
  ['ralphs', 'ralphs'],
] as const;

test('the quick choices are exactly the six approved canonical ids, in the approved curated order', () => {
  assert.deepEqual(
    [...POPULAR_RETAILER_IDS],
    APPROVED.map(([id]) => id),
  );
  assert.equal(POPULAR_RETAILER_IDS.length, 6);
  assert.equal(new Set(POPULAR_RETAILER_IDS).size, 6, 'a quick choice is listed twice');
  // Curated, not sorted: the order is deliberately not alphabetical.
  const names = POPULAR_RETAILERS.map((retailer) => retailer.name);
  assert.notDeepEqual(
    names,
    [...names].sort((a, b) => a.localeCompare(b)),
  );
});

test('each quick choice is exactly one existing catalog record, shown under its canonical name', () => {
  for (const [index, [id, name]] of APPROVED.entries()) {
    const matches = RETAILER_CATALOG.filter((retailer) => retailer.id === id);
    assert.equal(matches.length, 1, `${id} resolves to ${matches.length} records`);
    // The very record the catalog holds, not a copy with its own name.
    assert.equal(POPULAR_RETAILERS[index], retailerById(id));
    assert.equal(POPULAR_RETAILERS[index].name, name);
  }
});

test('the catalog is unchanged: 77 unique records, the six among them and nothing added', () => {
  assert.equal(RETAILER_CATALOG.length, 77);
  const ids = RETAILER_CATALOG.map((retailer) => retailer.id);
  assert.equal(new Set(ids).size, 77);
  assert.equal(new Set(RETAILER_CATALOG.map((retailer) => retailer.name)).size, 77);
  for (const retailer of POPULAR_RETAILERS) assert.ok(RETAILER_CATALOG.includes(retailer));
});

test('the old grid’s other four are one search away: fewer quick choices, not less coverage', () => {
  for (const [id, query] of FORMER_POPULAR) {
    assert.ok(!(POPULAR_RETAILER_IDS as readonly string[]).includes(id), `${id} is a quick choice`);
    assert.ok(retailerById(id), `${id} left the catalog`);
    assert.ok(
      retailerSearchResults(query)?.some((retailer) => retailer.id === id),
      `${query} does not find ${id}`,
    );
  }
  // Every catalog record is findable by its own name.
  for (const retailer of RETAILER_CATALOG) {
    assert.ok(
      retailerSearchResults(retailer.name)?.some((found) => found.id === retailer.id),
      `${retailer.name} cannot be found`,
    );
  }
});

test('the sheet’s search matches the canonical catalog, ignoring case, punctuation and surrounding spaces', () => {
  const ids = (query: string) => retailerSearchResults(query)?.map((retailer) => retailer.id);
  // One match, beyond the six, whatever the case or padding.
  assert.deepEqual(ids('wegm'), ['wegmans']);
  assert.deepEqual(ids('WEGM'), ['wegmans']);
  assert.deepEqual(ids('  Wegmans  '), ['wegmans']);
  assert.ok(!(POPULAR_RETAILER_IDS as readonly string[]).includes('wegmans'));
  // Several matches, name order, the catalog's own records and only those
  // that match (name or alias — "costco wholesale" is Costco's).
  const co = retailerSearchResults('co')!;
  assert.ok(co.length > 1);
  assert.deepEqual(
    co.map((retailer) => retailer.name),
    [...co.map((retailer) => retailer.name)].sort((a, b) => a.localeCompare(b)),
  );
  for (const retailer of co) {
    assert.equal(retailer, retailerById(retailer.id), `${retailer.id} is a copy`);
    assert.ok(
      [retailer.name, ...(retailer.aliases ?? [])].some((form) =>
        form.toLowerCase().includes('co'),
      ),
      `${retailer.name} does not match`,
    );
  }
  // The catalog's own punctuation rule is kept: `joes` finds Trader Joe's.
  assert.deepEqual(ids('joes'), ['trader-joes']);
  assert.deepEqual(ids('Joe’s'), ['trader-joes']);
  // Aliases find the canonical record: `hyvee` is Hy-Vee's, `heb` H-E-B's.
  assert.deepEqual(ids('hyvee'), ['hy-vee']);
  assert.deepEqual(ids('heb'), ['heb']);
  assert.deepEqual(ids('wal-mart'), ['walmart']);
});

test('an empty, blank or punctuation-only query is no search; a query that matches nothing is an empty list', () => {
  // Before a meaningful query the sheet shows its instruction, never the
  // whole catalog: no search at all, not all 77.
  for (const query of ['', ' ', '   ', '\t', "'", '.']) {
    assert.equal(retailerSearchResults(query), null, JSON.stringify(query));
  }
  assert.deepEqual(retailerSearchResults('zzzz'), []);
  assert.deepEqual(retailerSearchResults(' qqq '), []);
});

test('the full catalog is still every record, and a search never touches the selection', () => {
  assert.equal(storeRows('').length, RETAILER_CATALOG.length);
  const prefs = toggleRetailer(toggleRetailer(EMPTY_PREFERENCES, 'aldi'), 'wegmans');
  const frozen = JSON.stringify(prefs);
  // Searching, narrowing to nothing, and clearing the query are reads only.
  retailerSearchResults('wegm');
  retailerSearchResults('zzzz');
  retailerSearchResults('');
  assert.equal(JSON.stringify(prefs), frozen);
  // A result saves the same id a quick choice does, so one list checks both.
  const aldi = retailerSearchResults('aldi')!;
  assert.deepEqual(
    aldi.map((retailer) => retailer.id),
    ['aldi'],
  );
  assert.ok(prefs.retailers.includes(aldi[0].id));
  assert.ok(POPULAR_RETAILERS.some((retailer) => retailer.id === aldi[0].id));
});

test('choosing and deselecting, on the receipt or in the search, edit the one saved list, in the order chosen', () => {
  const aldi = toggleRetailer(EMPTY_PREFERENCES, 'aldi');
  assert.deepEqual(aldi.retailers, ['aldi']);
  const several = toggleRetailer(toggleRetailer(aldi, 'costco'), 'wegmans');
  assert.deepEqual(several.retailers, ['aldi', 'costco', 'wegmans']);
  // A row and a search result remove through the same toggle: only that store goes.
  assert.deepEqual(toggleRetailer(several, 'costco').retailers, ['aldi', 'wegmans']);
  // Canonical ids are stored, never names, and nothing else changes.
  assert.deepEqual({ ...several, retailers: [] }, { ...EMPTY_PREFERENCES, retailers: [] });
});

test('Clear empties every store; an empty clear hands back the same object, so nothing saves', () => {
  const chosen = toggleRetailer(toggleRetailer(EMPTY_PREFERENCES, 'walmart'), 'wegmans');
  const cleared = clearRetailers(chosen);
  assert.deepEqual(cleared.retailers, []);
  assert.notEqual(cleared, chosen);
  assert.deepEqual(chosen.retailers, ['walmart', 'wegmans'], 'the input was mutated');
  assert.deepEqual({ ...cleared, retailers: chosen.retailers }, chosen);
  assert.equal(clearRetailers(cleared), cleared);
  assert.equal(clearRetailers(EMPTY_PREFERENCES), EMPTY_PREFERENCES);
});

test('the search sheet’s top edge depends only on the window and text size, never on the query', () => {
  // Every input the sheet's frame takes: no query, result count or keyboard.
  assert.equal(searchSheetTop.length, 3);
  const phones = [
    { name: 'iPhone SE', height: 667, safeTop: 20 },
    { name: 'iPhone 17', height: 874, safeTop: 62 },
    { name: 'iPhone 17 Pro Max', height: 956, safeTop: 62 },
  ];
  for (const { name, height, safeTop } of phones) {
    for (const scale of [TEXT_SIZES.xSmall, TEXT_SIZES.large, TEXT_SIZES.xxxLarge]) {
      const top = searchSheetTop(height, safeTop, scale);
      // The top bar and heading stay visible, dimmed, above the sheet.
      assert.ok(top >= safeTop + SHEET_MIN_CONTEXT, `${name} at ${scale}: ${top}`);
      assert.equal(top, Math.max(safeTop + SHEET_MIN_CONTEXT, Math.round(height * 0.2)));
      // And the sheet keeps most of the window for its field and results.
      assert.ok(height - top >= height * 0.75, `${name} at ${scale}: the sheet is short`);
    }
    // The accessibility sizes give the larger title and field the height.
    for (const scale of [RAISED_SHEET_AT_SCALE, TEXT_SIZES.ax1, TEXT_SIZES.ax5]) {
      assert.equal(searchSheetTop(height, safeTop, scale), safeTop + 16, `${name} at ${scale}`);
    }
  }
});

test('the backdrop dims the step without hiding it, and the sheet’s motion is short', () => {
  assert.ok(SHEET_BACKDROP_OPACITY > 0 && SHEET_BACKDROP_OPACITY <= 0.5);
  assert.ok(SHEET_MOTION.in <= 300 && SHEET_MOTION.out < SHEET_MOTION.in);
});
