import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HAZARD_GUIDES } from '@/content/hazard-guides';

import { SYMPTOM_ICONS, symptomIcon } from './symptom-icons';

test('every reviewed symptom has a deliberate glyph, and no mapping is stale', () => {
  const symptoms = new Set(HAZARD_GUIDES.flatMap((guide) => guide.symptoms ?? []));
  // A new or reworded symptom still renders (with `circle`), but must be
  // mapped on purpose before this passes.
  for (const symptom of symptoms) {
    assert.ok(symptom in SYMPTOM_ICONS, `unmapped symptom: ${symptom}`);
  }
  // Every key is a string some reviewed guide actually states.
  for (const key of Object.keys(SYMPTOM_ICONS)) {
    assert.ok(symptoms.has(key), `mapping for a symptom no guide states: ${key}`);
  }
  assert.equal(symptomIcon('A symptom no guide states'), 'circle');
});
