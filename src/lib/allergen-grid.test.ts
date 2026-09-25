/**
 * The Allergens grid (P2B7Z): the canonical order survives the grid, two
 * columns at the standard sizes, one column before a label word would be
 * broken and at every accessibility size, the measured word table matches
 * the bundled font, and the selection edits (toggle, deselect, clear, empty
 * clear) keep the saved representation exactly as before.
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import { CONSUMER_ALLERGENS, EMPTY_PREFERENCES } from '@/domain/preferences';
import { typography } from '@/constants/design-tokens';
import {
  ALLERGEN_WORD_WIDTHS,
  allergenGridColumns,
  allergenGridRows,
  allergenTileStacked,
  clearAllergens,
  contentWidthFor,
  labelWidth,
  ONE_COLUMN_AT_SCALE,
  stackedLabelWidth,
  TILE,
  TILE_CHROME,
  WIDEST_LABEL_WORD,
} from '@/lib/allergen-grid';
import { ALLERGEN_ICONS, allergenIconName } from '@/lib/allergen-icons';
import { allergenCountLabel } from '@/lib/onboarding-copy';
import { toggleAllergen } from '@/lib/personalization-screen';

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

const CANONICAL_LABELS = [
  'Peanuts',
  'Tree nuts',
  'Milk',
  'Egg',
  'Wheat',
  'Soy',
  'Sesame',
  'Fish',
  'Crustacean shellfish',
];

test('every canonical allergen appears exactly once, in the existing order, at either column count', () => {
  assert.deepEqual(
    CONSUMER_ALLERGENS.map((a) => a.label),
    CANONICAL_LABELS,
  );
  for (const columns of [1, 2] as const) {
    const rows = allergenGridRows(CONSUMER_ALLERGENS, columns);
    assert.ok(rows.every((row) => row.length >= 1 && row.length <= columns));
    // Reading order (left to right, then down) is the canonical order.
    assert.deepEqual(rows.flat(), CONSUMER_ALLERGENS);
  }
  // Nine in two columns: four full rows and one short one.
  assert.deepEqual(
    allergenGridRows(CONSUMER_ALLERGENS, 2).map((row) => row.length),
    [2, 2, 2, 2, 1],
  );
});

test('every allergen maps to its approved existing icon', () => {
  for (const option of CONSUMER_ALLERGENS) {
    const name = allergenIconName(option.token);
    assert.ok(name !== null, `${option.label} has no icon`);
    assert.equal(name, ALLERGEN_ICONS[option.token as keyof typeof ALLERGEN_ICONS]);
  }
});

test('the standard text sizes lay the grid out in two columns on every supported phone', () => {
  for (const [phone, width] of Object.entries(WIDTHS)) {
    for (const scale of [TEXT_SIZES.xSmall, TEXT_SIZES.large]) {
      assert.equal(allergenGridColumns(width, scale), 2, `${phone} at ${scale}`);
    }
  }
  assert.equal(allergenGridColumns(WIDTHS.iPhone17, TEXT_SIZES.xLarge), 2);
});

test('the grid reflows to one column before a word would break, and at every accessibility size', () => {
  // The accessibility sizes are one column at any width, even an iPad's.
  for (const width of [...Object.values(WIDTHS), 1024]) {
    for (const scale of [ONE_COLUMN_AT_SCALE, TEXT_SIZES.ax1, TEXT_SIZES.ax5]) {
      assert.equal(allergenGridColumns(width, scale), 1, `${width} at ${scale}`);
    }
  }
  // Before them, the narrowest phone goes to one column first, as soon as
  // `Crustacean` would no longer fit a half-width tile.
  assert.equal(allergenGridColumns(WIDTHS.iPhoneSE, TEXT_SIZES.xLarge), 1);
  assert.equal(allergenGridColumns(WIDTHS.iPhone17, TEXT_SIZES.xxLarge), 1);
  // Two columns never leave a word less room than its measured width, and
  // once a phone has reflowed, a larger size never returns to two columns.
  for (const width of Object.values(WIDTHS)) {
    let reflowed = false;
    for (const scale of Object.values(TEXT_SIZES)) {
      const columns = allergenGridColumns(width, scale);
      if (reflowed) assert.equal(columns, 1, `${width} returned to two columns at ${scale}`);
      if (columns === 1) reflowed = true;
      else {
        assert.ok(
          labelWidth(contentWidthFor(width), 2) >= WIDEST_LABEL_WORD * scale,
          `${width} at ${scale} breaks a word`,
        );
      }
    }
  }
  assert.equal(contentWidthFor(WIDTHS.iPhoneSE), 343);
  assert.equal(TILE_CHROME, 80);
});

test('the 44pt pictogram box leaves the row chrome, and so every breakpoint, where the 20pt glyph had it', () => {
  // The box overhangs the padding and the gap by its transparent margin
  // only (allergen-assets.test.ts measures that margin from the files) …
  assert.equal(TILE.pictogram, 44);
  assert.equal(TILE.pictogramOverhang, 4);
  // … never past the gap, so its edge meets the label's without overlapping,
  // nor past the padding, so it stays inside the tile.
  assert.ok(TILE.gap >= TILE.pictogramOverhang);
  assert.ok(TILE.paddingHorizontal > TILE.pictogramOverhang);
  // 8 + (44 − 8) + 4 + 4 + 20 + 8: the P2B7Z chrome, to the point.
  assert.equal(
    TILE.paddingHorizontal * 2 +
      TILE.pictogram -
      TILE.pictogramOverhang * 2 +
      TILE.gap * 2 +
      TILE.check,
    80,
  );
  assert.equal(TILE_CHROME, 80);
});

test('where even one column cannot hold the widest word, the tile stacks, and its label line can', () => {
  // Every standard size and the first three accessibility sizes keep the
  // row tile on every phone; only AX4 and AX5 on the SE, and AX5 on an
  // iPhone 17, stack.
  for (const width of Object.values(WIDTHS)) {
    for (const scale of [TEXT_SIZES.large, TEXT_SIZES.xxxLarge, TEXT_SIZES.ax1, TEXT_SIZES.ax3]) {
      assert.equal(allergenTileStacked(width, scale), false, `${width} at ${scale}`);
    }
  }
  assert.equal(allergenTileStacked(WIDTHS.iPhoneSE, TEXT_SIZES.ax4), true);
  assert.equal(allergenTileStacked(WIDTHS.iPhoneSE, TEXT_SIZES.ax5), true);
  assert.equal(allergenTileStacked(WIDTHS.iPhone17, TEXT_SIZES.ax4), false);
  assert.equal(allergenTileStacked(WIDTHS.iPhone17, TEXT_SIZES.ax5), true);
  // Whatever the layout, the widest word fits its line on every supported
  // phone at every size: row tile, one-column tile or stacked tile.
  for (const width of Object.values(WIDTHS)) {
    for (const scale of Object.values(TEXT_SIZES)) {
      const content = contentWidthFor(width);
      const line = allergenTileStacked(width, scale)
        ? stackedLabelWidth(content)
        : labelWidth(content, allergenGridColumns(width, scale));
      assert.ok(line >= WIDEST_LABEL_WORD * scale, `${width} at ${scale}: ${line}`);
      // Stacking only ever happens in one column.
      if (allergenTileStacked(width, scale)) assert.equal(allergenGridColumns(width, scale), 1);
    }
  }
});

test('the word widths are measured from the bundled font, and cover every label word', async () => {
  const words = new Set(CONSUMER_ALLERGENS.flatMap((a) => a.label.split(' ')));
  assert.deepEqual([...words].sort(), Object.keys(ALLERGEN_WORD_WIDTHS).sort());
  assert.equal(WIDEST_LABEL_WORD, ALLERGEN_WORD_WIDTHS.Crustacean);

  const { GlobalFonts, createCanvas } = await import('@napi-rs/canvas');
  const font = join(
    __dirname,
    '..',
    '..',
    'node_modules/@expo-google-fonts/public-sans/400Regular/PublicSans_400Regular.ttf',
  );
  assert.ok(GlobalFonts.registerFromPath(font, 'AllergenGridBody'));
  const context = createCanvas(8, 8).getContext('2d');
  const body = typography.body;
  assert.equal(body.face, 'sans-400');
  context.font = `${body.fontSize}px AllergenGridBody`;
  for (const word of words) {
    const measured = Math.ceil(context.measureText(word).width * 10) / 10;
    assert.equal(ALLERGEN_WORD_WIDTHS[word], measured, `${word} was re-measured`);
  }
});

test('Peanuts and Tree nuts can be chosen together, each deselects alone, in the saved representation', () => {
  const peanuts = toggleAllergen(EMPTY_PREFERENCES, 'peanut');
  const both = toggleAllergen(peanuts, 'tree nuts');
  assert.deepEqual(both.allergens, ['peanut', 'tree nuts']);
  // Deselecting one keeps the other.
  assert.deepEqual(toggleAllergen(both, 'peanut').allergens, ['tree nuts']);
  assert.deepEqual(toggleAllergen(both, 'tree nuts').allergens, ['peanut']);
  // The tokens are stored as chosen, never labels.
  assert.ok(both.allergens.every((token) => CONSUMER_ALLERGENS.some((a) => a.token === token)));
});

test('Clear empties every choice; an empty clear hands back the same object', () => {
  const chosen = toggleAllergen(toggleAllergen(EMPTY_PREFERENCES, 'peanut'), 'milk');
  const cleared = clearAllergens(chosen);
  assert.deepEqual(cleared.allergens, []);
  assert.notEqual(cleared, chosen);
  assert.deepEqual(chosen.allergens, ['peanut', 'milk'], 'the input was mutated');
  // Only the allergens change.
  assert.deepEqual({ ...cleared, allergens: chosen.allergens }, chosen);
  assert.equal(clearAllergens(cleared), cleared);
  assert.equal(clearAllergens(EMPTY_PREFERENCES), EMPTY_PREFERENCES);
});

test('the count line speaks zero, one and many correctly', () => {
  assert.equal(allergenCountLabel(0), 'No allergens selected');
  assert.equal(allergenCountLabel(1), '1 allergen selected');
  assert.equal(allergenCountLabel(2), '2 allergens selected');
  assert.equal(allergenCountLabel(9), '9 allergens selected');
});
