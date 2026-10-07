import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  confirmedOpen,
  fdaEvidenceCurrent,
  OPEN_EVIDENCE_MAX_AGE_DAYS,
  readFdaOngoingAsOf,
  type OpenEvidenceInput,
} from './open-evidence';
import { tierForActivityDate } from './feed-relevance';

const fda = (fdaOngoingAsOf: string | null): OpenEvidenceInput => ({
  sourceAgency: 'FDA',
  noticeType: 'recall',
  state: 'active',
  fdaOngoingAsOf,
});

test('the stored column is read strictly: a real calendar date or nothing', () => {
  assert.equal(readFdaOngoingAsOf('2026-09-28'), '2026-09-28');
  for (const bad of [
    '2026-9-28',
    '2026-02-30',
    '',
    '2026-09-28T00:00:00Z',
    20260928,
    null,
    undefined,
    {},
  ]) {
    assert.equal(readFdaOngoingAsOf(bad), null, String(bad));
  }
});

test('FDA evidence counts through day 21 and stops the instant after, on the window’s own convention', () => {
  assert.equal(OPEN_EVIDENCE_MAX_AGE_DAYS, 21);
  const asOf = '2026-09-28';
  const boundary = new Date('2026-10-19T00:00:00.000Z'); // exactly 21 days
  assert.equal(confirmedOpen(fda(asOf), new Date('2026-09-28T09:00:00.000Z')), true);
  assert.equal(confirmedOpen(fda(asOf), boundary), true);
  assert.equal(confirmedOpen(fda(asOf), new Date(boundary.getTime() + 1)), false);
  // Same arithmetic as the 60-day window: midnight UTC, milliseconds.
  const windowEdge = new Date(Date.parse('2026-09-28T00:00:00Z') + 60 * 86_400_000);
  assert.equal(tierForActivityDate(asOf, windowEdge), 'recent');
  assert.equal(tierForActivityDate(asOf, new Date(windowEdge.getTime() + 1)), 'older_active');
});

test('a future evidence date (a device clock behind) counts', () => {
  assert.equal(fdaEvidenceCurrent('2026-10-10', new Date('2026-10-01T00:00:00Z')), true);
});

test('no FDA evidence, no confirmation — whatever the lifecycle says', () => {
  assert.equal(confirmedOpen(fda(null), new Date('2026-10-06T00:00:00Z')), false);
});

test('FSIS: an active recall is confirmed by lifecycle; an alert never is, and nor is a closed one', () => {
  const now = new Date('2030-01-01T00:00:00Z'); // no expiry for FSIS lifecycle
  const fsis = (
    noticeType: 'recall' | 'public_health_alert',
    state: 'active' | 'closed' | 'retracted',
  ) => confirmedOpen({ sourceAgency: 'FSIS', noticeType, state, fdaOngoingAsOf: null }, now);
  assert.equal(fsis('recall', 'active'), true);
  assert.equal(fsis('public_health_alert', 'active'), false);
  assert.equal(fsis('recall', 'closed'), false);
  assert.equal(fsis('recall', 'retracted'), false);
  // An FSIS row never borrows FDA evidence semantics.
  assert.equal(
    confirmedOpen(
      {
        sourceAgency: 'FSIS',
        noticeType: 'public_health_alert',
        state: 'active',
        fdaOngoingAsOf: '2029-12-31',
      },
      now,
    ),
    false,
  );
});
