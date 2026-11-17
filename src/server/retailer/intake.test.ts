/**
 * Manual intake, on the real saved page used for the 2026-11-16 staging
 * proof: H-E-B's Creamy Creations announcement as FDA republishes it.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { planRetailerRun } from './costco-monitor';
import { decideNotice } from './decide';
import { htmlToText, intakeEntry, intakeExtract, intakeSource } from './intake';
import { parseLetter } from './letter';
import { HEB_SOURCE } from './sources';
import { MemoryRetailerNoticeStore } from './store';
import type { AgencyCaseView } from './types';

const PAGE = new Uint8Array(
  readFileSync(
    join(__dirname, 'fixtures', 'listings', 'heb-creamy-creations-fda-copy-2026-11-16.html'),
  ),
);
const URL_ =
  'https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/h-e-b-issues-voluntary-recall-3-ounce-cups-creamy-creations-ice-cream-select-flavors';
const TITLE =
  'H-E-B Issues Voluntary Recall for 3-Ounce Cups of Creamy Creations Ice Cream in Select Flavors';

const agencyCase = (id: string): AgencyCaseView => ({
  id,
  sourceAgency: 'FDA',
  noticeType: 'recall',
  state: 'active',
  publishedAt: '2024-04-29',
  title: TITLE,
  firm: 'H-E-B',
  brands: ['Creamy Creations'],
  text: '3-ounce cups of Creamy Creations ice cream in select flavors',
  retailerNames: ['H-E-B'],
  geography: { scope: 'states', states: ['Texas'] },
});

test('a saved page is read as text, dated by its labelled date, never by navigation', async () => {
  const extracted = await intakeExtract(PAGE);
  assert.equal(extracted.extraction, 'text');
  const parsed = parseLetter(intakeEntry('heb', URL_, TITLE), 'text', extracted.text);
  assert.equal(parsed.statedNoticeDate, '2024-04-27');
  assert.equal(parsed.statedNoticeDateText, 'Company Announcement Date: April 27, 2024');
  assert.equal(parsed.foodStatus, 'food');
  assert.equal(parsed.noticeKind, 'recall');
  assert.deepEqual(
    parsed.stateClaims.map((claim) => [claim.retailer, claim.state]),
    [['H-E-B', 'Texas']],
  );
});

test('the duplicate check sends an H-E-B notice Lotly already holds to review or link, never a card', async () => {
  const extracted = await intakeExtract(PAGE);
  const entry = intakeEntry('heb', URL_, TITLE);
  const parsed = parseLetter(entry, 'text', extracted.text);
  const one = decideNotice(entry, parsed, extracted.text, [agencyCase('case-a')]).result;
  // Matched: the notice's code dates are not in this minimal agency text, so
  // the consistent-match check sends it to review rather than linking.
  assert.deepEqual(
    [one.decision, one.reasons],
    [
      'review',
      ['single_agency_match', 'codes_not_in_agency_notice', 'retailer_notice_dated_before_agency'],
    ],
  );
  const two = decideNotice(entry, parsed, extracted.text, [
    agencyCase('case-a'),
    agencyCase('case-b'),
  ]).result;
  assert.deepEqual([two.decision, two.reasons], ['review', ['multiple_agency_candidates']]);
});

test('the intake runs through the shared monitor as one entry, archived by its own hash', async () => {
  const entry = intakeEntry('heb', URL_, TITLE);
  const plan = await planRetailerRun(
    HEB_SOURCE,
    new MemoryRetailerNoticeStore([agencyCase('case-a')]),
    intakeSource(entry, PAGE, 'text/html'),
    () => new Date('2026-11-16T23:00:00Z'),
    intakeExtract,
  );
  assert.equal(plan.planned.length, 1);
  const [{ row, document }] = plan.planned;
  assert.equal(row.publisher, 'heb');
  assert.equal(row.nativeId, `www.fda.gov${new URL(URL_).pathname}`);
  assert.equal(row.parserVersion, 'heb-intake/1');
  assert.equal(document?.contentHash, row.documentContentHash);
  assert.equal(plan.plannedWrites, 2);
});

test('intake refuses a non-https source and an empty title', () => {
  assert.throws(() => intakeEntry('heb', 'http://newsroom.heb.com/x', TITLE), /https/);
  assert.throws(() => intakeEntry('heb', URL_, '  '), /title/);
  assert.equal(
    htmlToText('<p>One&nbsp;line</p><script>x()</script><div>Two</div>'),
    'One line\nTwo',
  );
});
