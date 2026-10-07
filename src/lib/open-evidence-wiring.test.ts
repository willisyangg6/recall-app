/**
 * Every screen that decides Affects-me membership reads ONE calendar clock
 * (2026-10-06): the Feed tab, the Building count and the Ready preview. The
 * 60-day window and the 21-day FDA evidence expiry are functions of the clock,
 * so a call that fell back to its own `new Date()` default would only move
 * when that screen happened to re-render — and a foreground sync inside its
 * reuse threshold re-renders nothing. Static, like recall-presentation-wiring:
 * the screens are React Native and are not rendered under node.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const read = (...parts: string[]) => readFileSync(join(__dirname, '..', ...parts), 'utf8');
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const FEED = code(read('app', '(tabs)', 'index.tsx'));
const BUILDING = code(read('app', 'onboarding', 'building.tsx'));
const READY_SCREEN = code(read('app', 'onboarding', 'preview.tsx'));
const READY_HOOK = code(read('hooks', 'use-ready-preview.ts'));

test('the Feed tab, Building and Ready each read the calendar clock', () => {
  for (const [name, text] of [
    ['Feed tab', FEED],
    ['Building', BUILDING],
    ['Ready screen', READY_SCREEN],
  ] as const) {
    assert.match(text, /useCalendarClock\(\)/, `${name} does not read the calendar clock`);
  }
});

test('no eligibility call falls back to its own clock', () => {
  assert.match(FEED, /buildFeedSections\(allVisible, now\)/);
  assert.match(FEED, /buildAffectsMeSections\([\s\S]*?\{\s*now,?\s*\}\s*\)/);
  assert.match(FEED, /todayIso\(now\)/);
  assert.match(BUILDING, /buildingData\([^)]*, now\)/);
  assert.match(BUILDING, /warmReadyPhotos\([^;]*, now\)/);
  assert.match(READY_HOOK, /photoCandidates\([^;]*, now\)/);
  assert.match(READY_HOOK, /buildReadyPreview\(feed, prefs, today, now,/);
  for (const [name, text] of [
    ['Feed tab', FEED],
    ['Building', BUILDING],
    ['Ready screen', READY_SCREEN],
    ['Ready hook', READY_HOOK],
  ] as const) {
    assert.doesNotMatch(text, /todayIso\(\)/, `${name} reads its own date`);
    assert.doesNotMatch(text, /new Date\(\)/, `${name} reads its own clock`);
  }
});
