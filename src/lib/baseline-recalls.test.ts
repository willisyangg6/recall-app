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
  baselineIncludes,
  baselineRecordingRefusal,
  BASELINE_MAX_EVIDENCE_AGE_DAYS,
  newestEvidenceDate,
} from '@/lib/baseline-selection';
import { makeFeedItem } from '@/lib/feed-fixtures';
import { affectsYouMatches } from '@/lib/ready-preview';
import type { FeedItem } from '@/lib/recall-feed';
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
    assert.ok(age >= 0, `${item.id} dated after the recording`);
    // In the window at recording, or confirmed open then — the one shared rule.
    assert.ok(
      age <= RECENT_WINDOW_DAYS * 86_400_000 || baselineIncludes(item, recordedAt),
      `${item.id} is neither in the window nor confirmed open at recording`,
    );
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

// ── Open evidence in the baseline (2026-10-06) ──────────────────────────────

function aged(
  id: string,
  recordedAtIso: string,
  daysAgo: number,
  overrides: Partial<FeedItem>,
): FeedItem {
  const when = new Date(Date.parse(recordedAtIso) - daysAgo * 86_400_000).toISOString();
  return makeFeedItem(1, {
    id,
    noticeType: 'recall',
    publishedAt: when,
    lastPublicActivityAt: when,
    timeline: [
      {
        occurredAt: when,
        kind: 'published',
        summary: 'x',
        causedBySnapshotIds: [],
        material: false,
      },
    ],
    geography: { scope: 'nationwide', states: [], confidence: 'stated', sourceText: 'Nationwide' },
    hazardCategory: 'microbial_contamination',
    pathogenOrAllergen: 'Salmonella',
    reasonText: 'Potential Salmonella contamination',
    ...overrides,
  });
}

test('every shipped baseline row carries an evidence value through the strict reader', () => {
  for (const item of BASELINE_RECALLS) {
    assert.ok(
      item.fdaOngoingAsOf === null || /^\d{4}-\d{2}-\d{2}$/.test(item.fdaOngoingAsOf),
      `${item.id} evidence ${String(item.fdaOngoingAsOf)}`,
    );
  }
});

test('the recorder carries exactly what the app would count at recording: window, FSIS active, current FDA evidence', () => {
  const at = '2026-10-06T12:00:00.000Z';
  const recorded = new Date(at);
  const corpus = [
    aged('window', at, 5, { sourceAgency: 'FDA' }),
    aged('fda-open', at, 400, { sourceAgency: 'FDA', fdaOngoingAsOf: '2026-10-06' }),
    aged('fsis-active', at, 90, { sourceAgency: 'FSIS' }),
    aged('fda-resolved', at, 400, { sourceAgency: 'FDA', fdaOngoingAsOf: null }),
    aged('fda-stale-evidence', at, 400, { sourceAgency: 'FDA', fdaOngoingAsOf: '2026-09-01' }),
    aged('fsis-alert', at, 400, { sourceAgency: 'FSIS', noticeType: 'public_health_alert' }),
  ];
  assert.deepEqual(
    corpus.filter((item) => baselineIncludes(item, recorded)).map((item) => item.id),
    ['window', 'fda-open', 'fsis-active'],
  );
  // And offline, the carried rows count by the same function as live rows.
  const carried = corpus.filter((item) => baselineIncludes(item, recorded));
  const ca = { states: ['CA'], allergens: [], retailers: [] };
  assert.deepEqual(
    affectsYouMatches(carried, ca, recorded)
      .map((item) => item.id)
      .sort(),
    ['fda-open', 'fsis-active', 'window'],
  );
  // 22 days later the carried FDA evidence has expired on the device clock,
  // exactly as live evidence does; FSIS lifecycle does not expire.
  const later = new Date(Date.parse(at) + 22 * 86_400_000);
  assert.deepEqual(
    affectsYouMatches(carried, ca, later)
      .map((item) => item.id)
      .sort(),
    ['fsis-active', 'window'],
  );
});

test('the recorder refuses a feed with no FDA evidence, or only stale evidence', () => {
  const at = new Date('2026-10-06T12:00:00.000Z');
  const none = [aged('a', at.toISOString(), 1, { fdaOngoingAsOf: null })];
  assert.match(baselineRecordingRefusal(none, at) ?? '', /not populated/);
  const fresh = [aged('a', at.toISOString(), 1, { fdaOngoingAsOf: '2026-09-28' })];
  assert.equal(baselineRecordingRefusal(fresh, at), null);
  assert.equal(newestEvidenceDate(fresh), '2026-09-28');
  const stale = [aged('a', at.toISOString(), 1, { fdaOngoingAsOf: '2026-09-20' })];
  assert.match(
    baselineRecordingRefusal(stale, at) ?? '',
    new RegExp(`limit ${BASELINE_MAX_EVIDENCE_AGE_DAYS}`),
  );
});
