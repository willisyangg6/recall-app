/**
 * The grocery-atlas States' presentation rules (lib/states-presentation.ts):
 * the chooser's search finds every jurisdiction by name, postal code or
 * alias, in alphabetical order and at most once; and the measured geometry
 * holds its own arithmetic.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { stateChoices } from '@/lib/personalization-screen';
import { typography } from '@/constants/design-tokens';
import {
  ACCESSIBILITY_SCALE,
  BODY_MEASURE,
  bodyMeasure,
  CHIP,
  chipLayout,
  COMPACT_HEIGHT,
  headlineType,
  sceneHeight,
  SCENE_PX,
  searchStateChoices,
  STATES_TYPE,
  verticalGaps,
} from '@/lib/states-presentation';

const names = (query: string) => searchStateChoices(query).map((choice) => choice.name);

test('a blank query lists all 50 states, DC and Puerto Rico, alphabetically by full name', () => {
  for (const query of ['', '   ']) {
    const all = searchStateChoices(query);
    assert.equal(all.length, 52);
    assert.deepEqual(all, stateChoices());
    const sorted = [...all].sort((a, b) => a.name.localeCompare(b.name));
    assert.deepEqual(all, sorted);
  }
});

test('a query matches full names, as the shared filter does, in any case', () => {
  assert.deepEqual(names('new'), ['New Hampshire', 'New Jersey', 'New Mexico', 'New York']);
  assert.deepEqual(names('RHODE'), ['Rhode Island']);
  assert.deepEqual(names('mass'), ['Massachusetts']);
  assert.deepEqual(names('puerto'), ['Puerto Rico']);
  assert.deepEqual(names('columbia'), ['District of Columbia']);
});

test('a postal code finds its jurisdiction, including DC and Puerto Rico', () => {
  assert.deepEqual(names('ny'), ['New York']);
  assert.deepEqual(names('NY'), ['New York']);
  assert.deepEqual(names('dc'), ['District of Columbia']);
  assert.deepEqual(names('D.C.'), ['District of Columbia']);
  assert.deepEqual(names('pr'), ['Puerto Rico']);
  // A code is matched whole, alongside the names that contain its letters:
  // Maine has no `me` in its name, and Rhode Island no `ri`.
  assert.deepEqual(names('me'), ['Maine', 'New Mexico']);
  assert.deepEqual(names('ct'), ['Connecticut', 'District of Columbia']);
  assert.deepEqual(names('ri'), [
    'Arizona',
    'District of Columbia',
    'Florida',
    'Missouri',
    'Puerto Rico',
    'Rhode Island',
  ]);
});

test('Washington DC finds the District of Columbia, and Washington still finds both', () => {
  assert.deepEqual(names('Washington DC'), ['District of Columbia']);
  assert.deepEqual(names('Washington, D.C.'), ['District of Columbia']);
  assert.deepEqual(names('wash'), ['District of Columbia', 'Washington']);
});

test('no match is an empty result, and no jurisdiction is ever listed twice', () => {
  assert.deepEqual(searchStateChoices('zz'), []);
  assert.deepEqual(searchStateChoices('Narnia'), []);
  for (const query of ['a', 'n', 'dc', 'wash', 'new', 'pr', 'me']) {
    const codes = searchStateChoices(query).map((choice) => choice.code);
    assert.equal(new Set(codes).size, codes.length, `${query} lists a state twice`);
  }
});

test('the measured geometry: the scene spans the page, the body measure grows with text, chips reach 44pt', () => {
  assert.ok(Math.abs(sceneHeight(393) - 336.8) < 0.1);
  assert.equal(sceneHeight(853), SCENE_PX.height);
  // The body measure sits inside the window that reproduces the target's
  // break after `or` (270.5–312pt by Public Sans Regular 18pt advances).
  assert.ok(BODY_MEASURE > 270.5 + 8 && BODY_MEASURE < 312 - 8);
  assert.equal(bodyMeasure(2), BODY_MEASURE * 2);
  assert.ok(CHIP.minHeight + 2 * CHIP.hitSlop >= 44);
  assert.ok(CHIP.rowGap >= 2 * CHIP.hitSlop);
});

test('at the accessibility sizes the headline takes the display base, still scaled, and chosen states become rows', () => {
  assert.equal(ACCESSIBILITY_SCALE, 1.5);
  // iOS reports XXXL as 23/17 = 1.35 and AX1 as 28/17 = 1.65.
  for (const scale of [0.82, 1, 1.24, 1.35]) {
    assert.deepEqual(headlineType(scale), STATES_TYPE.headline);
    assert.equal(chipLayout(scale), 'pill');
  }
  for (const scale of [1.5, 1.65, 2.35, 3.12]) {
    assert.deepEqual(headlineType(scale), {
      fontSize: typography.display.fontSize,
      lineHeight: typography.display.lineHeight,
    });
    assert.equal(chipLayout(scale), 'row');
  }
  assert.equal(typography.display.fontSize, 33);
  // Why 33: `Make` (130.6pt at 50pt, Public Sans Bold) outgrew a 343pt SE
  // column above text scale 2.63; at 33pt it fits beyond AX5 (3.12).
  const make = (130.6 * typography.display.fontSize) / 50;
  assert.ok(make * 3.12 < 343, 'the longest headline word breaks at AX5 on an SE');
});

test('a compact-height screen tightens only the vertical gaps; the scene keeps its size', () => {
  assert.equal(COMPACT_HEIGHT, 700);
  const standard = verticalGaps(874);
  const compact = verticalGaps(667);
  assert.deepEqual(standard, { top: 8, heading: 12, scene: 16 });
  assert.deepEqual(compact, { top: 4, heading: 8, scene: 4 });
  // The SE measured the search entry's bottom ~7pt under the footer with the
  // standard gaps; the compact gaps give back 20pt.
  const saved =
    standard.top -
    compact.top +
    (standard.heading - compact.heading) +
    (standard.scene - compact.scene);
  assert.equal(saved, 20);
  assert.equal(sceneHeight(375), (SCENE_PX.height * 375) / 853);
});
