/**
 * The building interstitial's rules (2026-09-28): truthful captions, the
 * approved order, and the ~3.2-second sequence, proven as pure functions.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EMPTY_PREFERENCES } from '@/domain/preferences';
import {
  buildingCaptions,
  buildingDurationMs,
  buildingSequence,
  CAPTION_MS,
  DONE_MS,
  REDUCED_MOTION_MS,
} from './building-watch';

const FULL = { states: ['CA'], allergens: ['peanut'], retailers: ['aldi'] };

test('the captions run states, allergens, stores, feed, done — and never name a selection', () => {
  assert.deepEqual(buildingSequence(FULL), [
    'Checking recalls in your selected states',
    'Matching the allergens you watch',
    'Watching the stores you chose',
    'Building your Affects You feed',
    'Your recall watch is ready',
  ]);
  for (const caption of buildingSequence(FULL)) {
    assert.ok(!caption.includes('CA') && !caption.includes('peanut') && !caption.includes('Aldi'));
    // No caption claims a match was found: matches are Ready's to report.
    assert.ok(!/match(es)? found|found \d/i.test(caption));
  }
});

test('the zero-allergen and zero-store captions tell the truth', () => {
  const none = buildingCaptions({ ...EMPTY_PREFERENCES, states: ['CA'] });
  assert.equal(none[1], 'Keeping allergen matching broad');
  assert.equal(none[2], 'Scanning recalls across all stores');
  const stores = buildingCaptions({ ...EMPTY_PREFERENCES, states: ['CA'], retailers: ['aldi'] });
  assert.equal(stores[2], 'Watching the stores you chose');
});

test('the animated sequence lands at about 3.2 seconds, whatever was chosen', () => {
  assert.equal(CAPTION_MS, 700);
  assert.equal(DONE_MS, 400);
  assert.equal(buildingDurationMs(FULL), 3200);
  assert.equal(buildingDurationMs({ ...EMPTY_PREFERENCES, states: ['CA'] }), 3200);
  // Inside the approved 3–4 second window.
  assert.ok(buildingDurationMs(FULL) >= 3000 && buildingDurationMs(FULL) <= 4000);
  // The Reduce Motion minimum is a readable pause, not the whole animation.
  assert.ok(REDUCED_MOTION_MS >= 1000 && REDUCED_MOTION_MS < buildingDurationMs(FULL));
});
