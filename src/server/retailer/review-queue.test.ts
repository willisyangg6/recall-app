import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  formatRetailerReviewQueue,
  summarizeRetailerReviewQueue,
  type QueueApproval,
  type QueueNotice,
} from './review-queue';

const NOW = new Date('2026-11-19T18:00:00Z');
const H = (c: string) => c.repeat(64);

function notice(id: string, overrides: Partial<QueueNotice> = {}): QueueNotice {
  return {
    id,
    publisher: 'costco',
    nativeId: `blt${id}`,
    indexTitle: `Notice ${id}`,
    decision: 'new_candidate',
    noticeKind: 'recall',
    foodStatus: 'food',
    documentExtraction: 'text',
    statedNoticeDate: '2026-11-10',
    documentContentHash: H('a'),
    firstSeenAt: '2026-11-10T12:00:00Z',
    ...overrides,
  };
}
const approval = (noticeId: string, overrides: Partial<QueueApproval> = {}): QueueApproval => ({
  noticeId,
  documentContentHash: H('a'),
  withdrawnAt: null,
  agencyCaseId: null,
  ...overrides,
});

test('collected, published and actionable are three different numbers', () => {
  const queue = summarizeRetailerReviewQueue(
    [
      notice('pub'), // approved and visible
      notice('new'), // standalone, never approved
      notice('old', { statedNoticeDate: '2026-04-07' }), // standalone, outside the horizon
      notice('rev', { documentContentHash: H('b') }), // approved, letter revised
      notice('lnk', { decision: 'link_candidate' }), // approved, agency case appeared
      notice('amb', { decision: 'review' }), // monitor undecided, never approved
      notice('wd'), // withdrawn earlier: a decision already made
      notice('agy'), // agency match confirmed: shown as the agency case
      notice('exc', { decision: 'excluded' }),
      notice('img', { documentExtraction: 'image_only' }), // cannot be published
    ],
    [
      approval('pub'),
      approval('rev'),
      approval('lnk'),
      approval('wd', { withdrawnAt: '2026-11-12T00:00:00Z' }),
      approval('agy', { agencyCaseId: 'c1' }),
    ],
    NOW,
  );
  assert.equal(queue.collected, 10);
  assert.deepEqual(queue.counts, {
    published: 1,
    needs_approval: 2,
    revised_letter: 1,
    agency_match_to_confirm: 1,
    needs_decision: 1,
  });
  const byId = Object.fromEntries(queue.items.map((item) => [item.nativeId, item]));
  assert.equal(byId.bltnew.wouldAlert, true);
  assert.equal(byId.bltold.wouldAlert, false, 'old intake publishes with no alert');
  assert.equal(byId.bltwd, undefined, 'a withdrawn notice is never re-queued');
  assert.equal(byId.bltagy, undefined);
});

test('the report never calls a collected notice published', () => {
  const queue = summarizeRetailerReviewQueue([notice('new')], [], NOW);
  const text = formatRetailerReviewQueue(queue).join('\n');
  assert.match(text, /collected \(stored, private\): +1/);
  assert.match(text, /published \(shoppers see it\): +0/);
  assert.match(text, /not approved \(not published\): 1 \(1 would alert if approved now\)/);
  assert.match(text, /ACTION needed: +1/);
});

test('the 30-day horizon is the alert planner’s, to the day', () => {
  const at = (date: string) =>
    summarizeRetailerReviewQueue([notice('x', { statedNoticeDate: date })], [], NOW).items[0]
      .wouldAlert;
  assert.equal(at('2026-10-21'), true); // 29 d 18 h
  assert.equal(at('2026-10-20'), false); // 30 d 18 h: backfill
});
