/**
 * The bundled baseline corpus (2026-10-04): recorded by one rule from the
 * public feed, every record whole and renderable, never a hand-picked
 * example set — and its age reported rather than hidden.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { materialActivityAt } from '@/domain/material-activity';
import { RECENT_WINDOW_DAYS } from '@/lib/feed-relevance';
import { buildDetailModel, buildHomeCardModel } from '@/lib/recall-presentation';
import { evaluatePersonalRelevance } from '@/lib/relevance';
import {
  BASELINE_RECALLS,
  BASELINE_RECORDED_AT,
  baselineAgeDays,
  baselineCaseDetail,
  baselineReadinessFailures,
} from './baseline-recalls';

const ROOT = join(__dirname, '..', '..');
const recordedAt = new Date(BASELINE_RECORDED_AT);
const today = BASELINE_RECORDED_AT.slice(0, 10);

test('the baseline is a recorded rule over the live feed: every record active, unmerged-shaped, within the recency window at recording time', () => {
  assert.ok(BASELINE_RECALLS.length > 0);
  const document = JSON.parse(
    readFileSync(join(ROOT, 'src', 'content', 'baseline-recalls.json'), 'utf8'),
  ) as { recentActivityDays: number; rule: string };
  assert.equal(document.recentActivityDays, RECENT_WINDOW_DAYS);
  assert.match(document.rule, /material activity is within the window/);
  const ids = new Set<string>();
  for (const item of BASELINE_RECALLS) {
    assert.ok(!ids.has(item.id), `duplicate ${item.id}`);
    ids.add(item.id);
    assert.equal(item.state, 'active');
    const age =
      recordedAt.getTime() - Date.parse(materialActivityAt(item.publishedAt, item.timeline));
    assert.ok(age >= 0 && age <= RECENT_WINDOW_DAYS * 86_400_000, `${item.id} outside the window`);
    assert.ok(item.officialUrl.startsWith('http'), `${item.id} has no official URL`);
    assert.ok(item.title.length > 0);
  }
});

test('every baseline record has a bundled detail that renders, so a baseline card always opens', () => {
  for (const item of BASELINE_RECALLS) {
    const detail = baselineCaseDetail(item.id);
    assert.ok(detail, `${item.id} has no bundled detail`);
    assert.equal(detail.id, item.id);
    assert.equal(detail.projection.title, item.title);
    assert.equal(detail.projection.summaryHtml, null, 'summaryHtml should be dropped');
    assert.ok(detail.projection.summaryText.length > 0);
    const model = buildDetailModel(detail, { today, affectsYou: false });
    assert.ok(model.productName.length > 0);
    const card = buildHomeCardModel(item, { today, prefs: null });
    assert.equal(card.affectsYou, false, 'a stored verdict leaked');
  }
  assert.equal(baselineCaseDetail('not-a-baseline-id'), null);
});

test('Nationwide baseline records qualify for any chosen state through the real matcher, including non-allergen hazards', () => {
  const nationwide = BASELINE_RECALLS.filter((item) => item.geography.scope === 'nationwide');
  assert.ok(nationwide.length > 0);
  const nonAllergen = nationwide.filter((item) => item.hazardCategory !== 'allergen');
  assert.ok(nonAllergen.length > 0, 'no Nationwide non-allergen hazard in the baseline');
  for (const item of nonAllergen) {
    for (const states of [['AK'], ['FL', 'GA'], ['DC']]) {
      assert.equal(
        evaluatePersonalRelevance(item, { states, allergens: [], retailers: [] }).affectsMe,
        true,
        `${item.id} did not match ${states.join('+')}`,
      );
    }
  }
});

test('an aged-out baseline is a release-readiness FAILURE, not a warning; a current one passes', () => {
  assert.ok(baselineAgeDays(recordedAt) === 0);
  assert.deepEqual(baselineReadinessFailures(recordedAt), []);
  const inside = new Date(recordedAt.getTime() + RECENT_WINDOW_DAYS * 86_400_000);
  assert.deepEqual(baselineReadinessFailures(inside), []);
  const aged = new Date(recordedAt.getTime() + (RECENT_WINDOW_DAYS + 1) * 86_400_000);
  const failures = baselineReadinessFailures(aged);
  assert.equal(failures.length, 1);
  assert.match(failures[0]!, /record:baseline/);
  assert.match(failures[0]!, new RegExp(BASELINE_RECORDED_AT.slice(0, 10)));
  // The launch-readiness script runs this gate (its exit code carries it).
  const script = readFileSync(join(ROOT, 'scripts', 'qa-launch-readiness.ts'), 'utf8');
  assert.ok(script.includes('baselineReadinessFailures()'));
});

test('the baseline can never overwrite newer live data: it is read, never written anywhere, and a session answer always wins', () => {
  const source = readFileSync(join(__dirname, 'baseline-recalls.ts'), 'utf8');
  for (const forbidden of ['feed-sync', 'feed-cache', 'SecureStore', 'setItem', 'write(']) {
    assert.ok(!source.includes(forbidden), `baseline module reaches ${forbidden}`);
  }
  const preview = readFileSync(join(__dirname, 'ready-preview.ts'), 'utf8');
  assert.ok(preview.includes("if (feed.status === 'ready') {\n    baselineActive = false;"));
});
