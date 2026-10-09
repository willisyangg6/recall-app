/**
 * Regression: Ready failed with React's "Too many re-renders" (2026-10-08).
 *
 * Ready builds its corpus input (`readyCorpus`) and its preference object as
 * NEW objects on every render. The answered preview was memoised on those
 * objects, so every render produced a new answer, and the render-phase
 * update that remembers the shown deck fired again on every render — an
 * infinite loop as soon as the photo session settled.
 *
 * These tests render the real hook through React's server renderer, which
 * runs render-phase updates exactly as the native renderer does and throws
 * the same error, with the real selection (`buildReadyPreview`) over the
 * bundled baseline and inputs rebuilt on every render the way Ready builds
 * them.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createElement, useState, type ReactElement } from 'react';

import type { UserRecallPreferences } from '@/domain/preferences';
import { BASELINE_RECALLS } from '@/lib/baseline-recalls';
import { buildReadyPreview, type ReadyPreviewState } from '@/lib/ready-preview';
import type { FeedItem } from '@/lib/recall-feed';
import type { PhotoSnapshot } from '@/lib/ready-photo-registry';

import { useAnsweredReadyPreview, type ReadyPreviewInputs } from './use-answered-ready-preview';

// React's server renderer, installed with react-dom for the web target. The
// project carries no react-dom type package, so its one function is typed here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { renderToString } = require('react-dom/server') as {
  renderToString: (element: ReactElement) => string;
};

const NOW = new Date('2026-10-08T12:00:00Z');
const TODAY = '2026-10-08';
const SETTLED: PhotoSnapshot = { settled: true, loaded: () => true };
const CANDIDATES: readonly string[] = [];

function answer(inputs: ReadyPreviewInputs): ReadyPreviewState {
  return buildReadyPreview(inputs.feed, inputs.prefs, inputs.today, inputs.now, {
    loaded: inputs.photos.loaded,
  });
}

/** Ready's inputs as Ready builds them: fresh objects on every render. */
function freshInputs(prefs: UserRecallPreferences, items: readonly FeedItem[]): ReadyPreviewInputs {
  return {
    feed: { status: 'ready', items, source: 'baseline' },
    prefs: { ...prefs, states: [...prefs.states] },
    today: TODAY,
    now: NOW,
    photos: SETTLED,
    candidates: CANDIDATES,
  };
}

test('Ready answers once, without a render loop, when its inputs are rebuilt every render', () => {
  let renders = 0;
  let shown: ReadyPreviewState | null = null;
  function Ready() {
    renders += 1;
    shown = useAnsweredReadyPreview(
      freshInputs({ states: ['CA'], allergens: [], retailers: [] }, BASELINE_RECALLS),
      answer,
    );
    return null;
  }
  assert.doesNotThrow(() => renderToString(createElement(Ready)));
  assert.ok(renders <= 3, `Ready rendered ${renders} times for one answer`);
  assert.notEqual((shown as ReadyPreviewState | null)?.kind, 'checking');
});

test('a preference change and a corpus refresh each answer once and settle again', () => {
  const refreshed = [...BASELINE_RECALLS];
  // Each step is a new render with different content: a preference change,
  // then a corpus refresh (a new item array with the same recalls).
  const steps: { prefs: UserRecallPreferences; items: readonly FeedItem[] }[] = [
    { prefs: { states: ['CA'], allergens: [], retailers: [] }, items: BASELINE_RECALLS },
    {
      prefs: { states: ['CA', 'TX'], allergens: ['peanut'], retailers: [] },
      items: BASELINE_RECALLS,
    },
    { prefs: { states: ['CA', 'TX'], allergens: ['peanut'], retailers: [] }, items: refreshed },
  ];
  let renders = 0;
  const answered: string[] = [];
  function Ready() {
    renders += 1;
    const [step, setStep] = useState(0);
    const preview = useAnsweredReadyPreview(
      freshInputs(steps[step].prefs, steps[step].items),
      answer,
    );
    answered.push(`${step}:${preview.kind}`);
    // Advance to the next input once this one has answered.
    if (preview.kind !== 'checking' && step < steps.length - 1) setStep(step + 1);
    return null;
  }
  assert.doesNotThrow(() => renderToString(createElement(Ready)));
  assert.ok(renders <= 3 * steps.length, `Ready rendered ${renders} times for three answers`);
  assert.ok(answered.at(-1)?.startsWith('2:'), 'the last step never answered');
});
