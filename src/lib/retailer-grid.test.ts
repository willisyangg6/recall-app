/**
 * The Retailers step's Popular stores (2026-09-24): the curated ten are
 * exactly the approved canonical ids in the approved order, each the
 * catalog's own record; two columns at the standard sizes on every supported
 * phone and one from the accessibility sizes, before a name word could
 * break; the measured word table matches the bundled font; and the edits the
 * step makes (toggle, chip removal, clear, empty clear, search) keep the
 * saved representation exactly as before; and the search sheet's frame is a
 * function of the window and text size alone.
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import { typography } from '@/constants/design-tokens';
import { EMPTY_PREFERENCES } from '@/domain/preferences';
import { RETAILER_CATALOG, retailerById } from '@/domain/retailer-catalog';
import { storeRows, toggleRetailer } from '@/lib/personalization-screen';
import {
  clearRetailers,
  contentWidthFor,
  nameWidth,
  ONE_COLUMN_AT_SCALE,
  POPULAR_RETAILER_IDS,
  POPULAR_RETAILERS,
  POPULAR_WORD_WIDTHS,
  retailerGridColumns,
  retailerGridRows,
  retailerSearchResults,
  SHEET_BACKDROP_OPACITY,
  SHEET_MIN_CONTEXT,
  SHEET_MOTION,
  searchSheetTop,
  showReadyMascot,
  TILE_CHROME,
  WIDEST_NAME_WORD,
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

/** Window widths of the phones this app supports, smallest first. */
const WIDTHS = { iPhoneSE: 375, iPhone17: 402, iPhone17ProMax: 440 } as const;

/** The approved curation, row by row, left to right, as the founder named it. */
const APPROVED = [
  ['walmart', 'Walmart'],
  ['costco', 'Costco'],
  ['kroger', 'Kroger'],
  ['aldi', 'Aldi'],
  ['target', 'Target'],
  ['trader-joes', "Trader Joe's"],
  ['sams-club', "Sam's Club"],
  ['safeway', 'Safeway'],
  ['publix', 'Publix'],
  ['ralphs', 'Ralphs'],
] as const;

test('Popular stores are exactly the ten approved canonical ids, in the approved curated order', () => {
  assert.deepEqual(
    [...POPULAR_RETAILER_IDS],
    APPROVED.map(([id]) => id),
  );
  assert.equal(POPULAR_RETAILER_IDS.length, 10);
  assert.equal(new Set(POPULAR_RETAILER_IDS).size, 10, 'a popular store is listed twice');
  // Curated, not sorted: the order is deliberately not alphabetical.
  const names = POPULAR_RETAILERS.map((retailer) => retailer.name);
  assert.notDeepEqual(
    names,
    [...names].sort((a, b) => a.localeCompare(b)),
  );
});

test('each popular store is exactly one existing catalog record, shown under its canonical name', () => {
  for (const [index, [id, name]] of APPROVED.entries()) {
    const matches = RETAILER_CATALOG.filter((retailer) => retailer.id === id);
    assert.equal(matches.length, 1, `${id} resolves to ${matches.length} records`);
    // The very record the catalog holds, not a copy with its own name.
    assert.equal(POPULAR_RETAILERS[index], retailerById(id));
    assert.equal(POPULAR_RETAILERS[index].name, name);
  }
});

test('the catalog is unchanged: 77 unique records, the popular ten among them and nothing added', () => {
  assert.equal(RETAILER_CATALOG.length, 77);
  const ids = RETAILER_CATALOG.map((retailer) => retailer.id);
  assert.equal(new Set(ids).size, 77);
  assert.equal(new Set(RETAILER_CATALOG.map((retailer) => retailer.name)).size, 77);
  for (const retailer of POPULAR_RETAILERS) assert.ok(RETAILER_CATALOG.includes(retailer));
});

test('the sheet’s search matches the canonical catalog, ignoring case, punctuation and surrounding spaces', () => {
  const ids = (query: string) => retailerSearchResults(query)?.map((retailer) => retailer.id);
  // One match, beyond the ten, whatever the case or padding.
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
  // A result saves the same id a popular tile does, so one list checks both.
  const aldi = retailerSearchResults('aldi')!;
  assert.deepEqual(
    aldi.map((retailer) => retailer.id),
    ['aldi'],
  );
  assert.ok(prefs.retailers.includes(aldi[0].id));
  assert.ok(POPULAR_RETAILERS.some((retailer) => retailer.id === aldi[0].id));
});

test('choosing, deselecting and removing a chip edit the one saved list, in the order chosen', () => {
  const aldi = toggleRetailer(EMPTY_PREFERENCES, 'aldi');
  assert.deepEqual(aldi.retailers, ['aldi']);
  const several = toggleRetailer(toggleRetailer(aldi, 'costco'), 'wegmans');
  assert.deepEqual(several.retailers, ['aldi', 'costco', 'wegmans']);
  // A tile and a chip remove through the same toggle: only that store goes.
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

test('the ten fill five full rows of two, or ten of one, in the curated reading order', () => {
  assert.deepEqual(
    retailerGridRows(POPULAR_RETAILERS, 2).map((row) => row.length),
    [2, 2, 2, 2, 2],
  );
  assert.equal(retailerGridRows(POPULAR_RETAILERS, 1).length, 10);
  for (const columns of [1, 2] as const) {
    assert.deepEqual(retailerGridRows(POPULAR_RETAILERS, columns).flat(), POPULAR_RETAILERS);
  }
});

test('the standard text sizes lay the ten out in two columns on every supported phone', () => {
  for (const [phone, width] of Object.entries(WIDTHS)) {
    for (const scale of [
      TEXT_SIZES.xSmall,
      TEXT_SIZES.large,
      TEXT_SIZES.xLarge,
      TEXT_SIZES.xxLarge,
      TEXT_SIZES.xxxLarge,
    ]) {
      assert.equal(retailerGridColumns(width, scale), 2, `${phone} at ${scale}`);
    }
  }
  assert.equal(contentWidthFor(WIDTHS.iPhoneSE), 343);
  assert.equal(TILE_CHROME, 64);
});

test('the accessibility sizes are one column, and no name word is ever narrower than its line', () => {
  for (const width of [...Object.values(WIDTHS), 1024]) {
    for (const scale of [ONE_COLUMN_AT_SCALE, TEXT_SIZES.ax1, TEXT_SIZES.ax5]) {
      assert.equal(retailerGridColumns(width, scale), 1, `${width} at ${scale}`);
    }
  }
  for (const width of Object.values(WIDTHS)) {
    let reflowed = false;
    for (const scale of Object.values(TEXT_SIZES)) {
      const columns = retailerGridColumns(width, scale);
      if (reflowed) assert.equal(columns, 1, `${width} returned to two columns at ${scale}`);
      if (columns === 1) reflowed = true;
      // Whatever the layout, the widest word fits its line: names wrap
      // between words, never inside one, up to AX5 on the SE — so, unlike
      // the allergen tile, this one never stacks.
      const line = nameWidth(contentWidthFor(width), columns);
      assert.ok(line >= WIDEST_NAME_WORD * scale, `${width} at ${scale}: ${line}`);
    }
  }
});

test('the mascot yields its room from the accessibility sizes', () => {
  assert.equal(showReadyMascot(TEXT_SIZES.large), true);
  assert.equal(showReadyMascot(TEXT_SIZES.xxxLarge), true);
  assert.equal(showReadyMascot(ONE_COLUMN_AT_SCALE), false);
  assert.equal(showReadyMascot(TEXT_SIZES.ax5), false);
});

test('the word widths are measured from the bundled font, and cover every popular name word', async () => {
  const words = new Set(POPULAR_RETAILERS.flatMap((retailer) => retailer.name.split(' ')));
  assert.deepEqual([...words].sort(), Object.keys(POPULAR_WORD_WIDTHS).sort());
  assert.equal(WIDEST_NAME_WORD, POPULAR_WORD_WIDTHS.Safeway);

  const { GlobalFonts, createCanvas } = await import('@napi-rs/canvas');
  const font = join(
    __dirname,
    '..',
    '..',
    'node_modules/@expo-google-fonts/public-sans/400Regular/PublicSans_400Regular.ttf',
  );
  assert.ok(GlobalFonts.registerFromPath(font, 'RetailerGridBody'));
  const context = createCanvas(8, 8).getContext('2d');
  const body = typography.body;
  assert.equal(body.face, 'sans-400');
  context.font = `${body.fontSize}px RetailerGridBody`;
  for (const word of words) {
    const measured = Math.ceil(context.measureText(word).width * 10) / 10;
    assert.equal(POPULAR_WORD_WIDTHS[word], measured, `${word} was re-measured`);
  }
  // At the default size every WHOLE name fits one line of a half-width tile,
  // even on the SE (`Trader Joe's`, the longest, is 86.7pt of 103.5): no
  // popular tile wraps there.
  const line = nameWidth(contentWidthFor(WIDTHS.iPhoneSE), 2);
  for (const retailer of POPULAR_RETAILERS) {
    const whole = Math.ceil(context.measureText(retailer.name).width * 10) / 10;
    assert.ok(whole + 1 <= line, `${retailer.name} (${whole}pt) wraps on the SE`);
  }
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
    for (const scale of [ONE_COLUMN_AT_SCALE, TEXT_SIZES.ax1, TEXT_SIZES.ax5]) {
      assert.equal(searchSheetTop(height, safeTop, scale), safeTop + 16, `${name} at ${scale}`);
    }
  }
});

test('the backdrop dims the step without hiding it, and the sheet’s motion is short', () => {
  assert.ok(SHEET_BACKDROP_OPACITY > 0 && SHEET_BACKDROP_OPACITY <= 0.5);
  assert.ok(SHEET_MOTION.in <= 300 && SHEET_MOTION.out < SHEET_MOTION.in);
});
