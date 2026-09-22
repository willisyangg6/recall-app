/**
 * The Profile hub's display rules (P2B5), driven against the real module:
 * the compact summary for zero, one, two and more-than-two selections, the
 * never-abbreviated spoken form, the three answers (loading, unavailable,
 * ready) that may never pass for one another, canonical ordering and names,
 * and the version line.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CONSUMER_ALLERGENS, EMPTY_PREFERENCES } from '@/domain/preferences';
import { RETAILER_CATALOG } from '@/domain/retailer-catalog';
import {
  compactList,
  LOADING_DESCRIPTION,
  LOADING_VALUE,
  NONE_SELECTED,
  NOT_CHOSEN,
  summarizePreferences,
  summaryAccessibilityLabel,
  summaryLines,
  SUMMARY_LABELS,
  SUMMARY_VISIBLE_NAMES,
  UNAVAILABLE_DESCRIPTION,
  UNAVAILABLE_VALUE,
  VERSION_FALLBACK,
  versionLine,
  type PreferenceSummaryState,
} from './profile-hub';

const ready = (prefs: Parameters<typeof summarizePreferences>[0]): PreferenceSummaryState => ({
  status: 'ready',
  summary: summarizePreferences(prefs),
});

// ── The compact rule ────────────────────────────────────────────────────────

test('zero selections read "None selected", visibly and spoken', () => {
  assert.deepEqual(compactList([]), { visible: NONE_SELECTED, accessible: NONE_SELECTED });
  assert.equal(NONE_SELECTED, 'None selected');
});

test('one and two names show in full; the spoken form joins two with "and"', () => {
  assert.deepEqual(compactList(['Peanuts']), { visible: 'Peanuts', accessible: 'Peanuts' });
  assert.deepEqual(compactList(['Peanuts', 'Milk']), {
    visible: 'Peanuts, Milk',
    accessible: 'Peanuts and Milk',
  });
});

test('beyond two, the first two are shown with +N — and every name is still spoken', () => {
  assert.equal(SUMMARY_VISIBLE_NAMES, 2);
  assert.deepEqual(compactList(['Peanuts', 'Milk', 'Egg']), {
    visible: 'Peanuts, Milk +1',
    accessible: 'Peanuts, Milk and Egg',
  });
  const four = compactList(['Peanuts', 'Tree nuts', 'Milk', 'Egg']);
  assert.equal(four.visible, 'Peanuts, Tree nuts +2');
  assert.equal(four.accessible, 'Peanuts, Tree nuts, Milk and Egg');
  // The visible form never carries the hidden names; the spoken form never
  // carries the count.
  assert.ok(!four.visible.includes('Egg'));
  assert.ok(!four.accessible.includes('+'));
});

// ── The summary from real preferences ───────────────────────────────────────

test('the summary shows names, never tokens or ids, in the canonical allergen order', () => {
  const summary = summarizePreferences({
    // Chosen out of canonical order: the summary reorders states by name.
    states: ['NY', 'CA'],
    // Chosen out of display order: the summary reorders to the catalog's.
    allergens: ['milk', 'peanut'],
    retailers: ['trader-joes', 'costco'],
  });
  assert.deepEqual(summary.states, ['California', 'New York']);
  assert.deepEqual(summary.allergens, ['Peanuts', 'Milk']);
  // Stores keep the order they were chosen in — the order the Personalization
  // screen shows them — under their canonical names.
  assert.deepEqual(summary.retailers, ["Trader Joe's", 'Costco']);
  // The canonical order is the domain's, not a list of this module's own.
  const peanut = CONSUMER_ALLERGENS.findIndex((option) => option.token === 'peanut');
  const milk = CONSUMER_ALLERGENS.findIndex((option) => option.token === 'milk');
  assert.ok(peanut < milk);
  assert.ok(RETAILER_CATALOG.some((retailer) => retailer.id === 'trader-joes'));
});

test('an unknown token or id is dropped, not shown raw', () => {
  assert.deepEqual(
    summarizePreferences({ states: ['ZZ'], allergens: ['not-an-allergen'], retailers: ['nope'] }),
    { states: [], allergens: [], retailers: [] },
  );
});

test('empty preferences are a real answer: "Not chosen" and "None selected"', () => {
  const lines = summaryLines(ready(EMPTY_PREFERENCES));
  assert.deepEqual(
    lines.map((line) => [line.label, line.visible, line.kind]),
    [
      [SUMMARY_LABELS.states, NOT_CHOSEN, 'empty'],
      [SUMMARY_LABELS.allergens, NONE_SELECTED, 'empty'],
      [SUMMARY_LABELS.retailers, NONE_SELECTED, 'empty'],
    ],
  );
  assert.equal(NOT_CHOSEN, 'Not chosen');
  assert.deepEqual(Object.values(SUMMARY_LABELS), ['States', 'Allergens', 'Stores']);
});

test('a populated answer marks real choices as values and the rest as empty', () => {
  const lines = summaryLines(ready({ states: ['DC'], allergens: [], retailers: ['walmart'] }));
  assert.deepEqual(
    lines.map((line) => [line.visible, line.kind]),
    [
      ['District of Columbia', 'value'],
      [NONE_SELECTED, 'empty'],
      ['Walmart', 'value'],
    ],
  );
});

// ── Loading and failure are not empty preferences ───────────────────────────

test('a pending read shows "Loading…" on every line, and never an empty choice', () => {
  const lines = summaryLines({ status: 'loading' });
  assert.equal(lines.length, 3);
  for (const line of lines) {
    assert.equal(line.visible, LOADING_VALUE);
    assert.equal(line.kind, 'pending');
    assert.notEqual(line.visible, NOT_CHOSEN);
    assert.notEqual(line.visible, NONE_SELECTED);
  }
  assert.equal(LOADING_VALUE, 'Loading…');
});

test('a failed read shows "Unavailable" on every line, and never "Not chosen"', () => {
  const lines = summaryLines({ status: 'unavailable' });
  for (const line of lines) {
    assert.equal(line.visible, UNAVAILABLE_VALUE);
    assert.equal(line.kind, 'pending');
  }
  assert.equal(UNAVAILABLE_VALUE, 'Unavailable');
  assert.notEqual(UNAVAILABLE_VALUE, NOT_CHOSEN);
});

// ── The spoken card ─────────────────────────────────────────────────────────

test('the card speaks its name and every choice in full, abbreviated or not', () => {
  const label = summaryAccessibilityLabel(
    'Personalization',
    ready({
      states: ['CA', 'NY', 'MT'],
      allergens: ['peanut', 'tree nuts', 'milk', 'egg'],
      retailers: ['costco', 'trader-joes', 'walmart'],
    }),
  );
  assert.equal(
    label,
    'Personalization. States: California, Montana and New York. ' +
      'Allergens: Peanuts, Tree nuts, Milk and Egg. ' +
      "Stores: Costco, Trader Joe's and Walmart.",
  );
  assert.ok(!label.includes('+'));
  // The empty answer is spoken as the same real answer it shows.
  assert.equal(
    summaryAccessibilityLabel('Personalization', ready(EMPTY_PREFERENCES)),
    'Personalization. States: Not chosen. Allergens: None selected. Stores: None selected.',
  );
});

test('a pending or failed read is spoken as such, not as three repeated words', () => {
  assert.equal(
    summaryAccessibilityLabel('Personalization', { status: 'loading' }),
    `Personalization. ${LOADING_DESCRIPTION}`,
  );
  assert.equal(
    summaryAccessibilityLabel('Personalization', { status: 'unavailable' }),
    `Personalization. ${UNAVAILABLE_DESCRIPTION}`,
  );
  for (const sentence of [LOADING_DESCRIPTION, UNAVAILABLE_DESCRIPTION]) {
    assert.ok(!sentence.includes(NOT_CHOSEN) && !sentence.includes(NONE_SELECTED));
  }
});

// ── The version line ────────────────────────────────────────────────────────

test('the version line is the native version with its build, or the honest fallback', () => {
  assert.equal(versionLine('1.2.0', '34'), '1.2.0 (34)');
  assert.equal(versionLine('1.2.0', null), '1.2.0');
  assert.equal(versionLine(null, '34'), VERSION_FALLBACK);
  assert.equal(VERSION_FALLBACK, 'Development build');
});
