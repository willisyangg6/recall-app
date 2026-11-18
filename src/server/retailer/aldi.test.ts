/**
 * The ALDI source, read through the same pipeline as Costco, against the real
 * index and recall notice recorded on 2026-11-16 (fixtures/aldi/README.md).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { aldiIndexDate, aldiNativeId, parseAldiIndex } from './aldi-index';
import { planRetailerRun, type RetailerSource } from './costco-monitor';
import { decideNotice } from './decide';
import { parseLetter } from './letter';
import { extractPdfText } from './pdf-text';
import { ALDI_SOURCE, COSTCO_SOURCE } from './sources';
import { MemoryRetailerNoticeStore } from './store';
import type { AgencyCaseView, RetailerIndexEntry } from './types';

const DIR = join(__dirname, 'fixtures', 'aldi');
const indexHtml = () => readFileSync(join(DIR, 'index-2026-11-16.html'), 'utf8');
const prianoPdf = () => new Uint8Array(readFileSync(join(DIR, 'priano-tortelloni-2026-11-16.pdf')));
const PRIANO_ID =
  'prod1amer/ALDI Recalls Priano Protein Carbonara Tortelloni and Priano Protein Herb Cheese Tortelloni Because Of Possible Health Riskpdf';

function priano(entries = parseAldiIndex(indexHtml())): RetailerIndexEntry {
  const entry = entries.find((item) => item.nativeId === PRIANO_ID);
  assert.ok(entry, 'the Priano entry is on the recorded index');
  return entry;
}

test('the index yields only ALDI-hosted documents, each dated by ALDI', () => {
  const entries = parseAldiIndex(indexHtml());
  // 80 linked paragraphs: 75 ALDI documents, 4 CPSC pages, 1 FSIS page.
  assert.equal(entries.length, 75);
  assert.ok(entries.every((entry) => entry.publisher === 'aldi'));
  assert.ok(entries.every((entry) => new URL(entry.documentUrl).hostname === 'dm.cms.aldi.cx'));
  assert.ok(entries.every((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.indexDate ?? '')));
  assert.equal(new Set(entries.map((entry) => entry.nativeId)).size, entries.length);

  const first = entries[0];
  assert.equal(first.nativeId, PRIANO_ID);
  assert.equal(first.indexDate, '2026-11-16');
  assert.equal(first.indexDateText, 'November 16, 2026:');
  assert.equal(first.indexLabel, null);
  assert.equal(
    first.indexTitle,
    'ALDI Recalls Priano Protein Carbonara Tortelloni and Priano Protein Herb & Cheese Tortelloni Because Of Possible Health Risk',
  );
});

test('index dates and ids are read strictly', () => {
  assert.equal(aldiIndexDate('February 23, 2026'), '2026-02-23');
  assert.equal(aldiIndexDate('February 30, 2026'), null);
  assert.equal(aldiIndexDate('Sometime 2026'), null);
  assert.equal(aldiNativeId('https://www.fsis.usda.gov/recalls-alerts/x'), null);
  assert.equal(aldiNativeId('http://dm.cms.aldi.cx/is/content/prod1amer/x'), null);
  assert.equal(
    aldiNativeId('https://dm.cms.aldi.cx/is/content/prod1amer/A%20Bpdf'),
    'prod1amer/A Bpdf',
  );
});

test('the Priano notice reads as a dated food recall in four stated states', async () => {
  const extracted = await extractPdfText(prianoPdf());
  assert.equal(extracted.extraction, 'text');
  const parsed = parseLetter(priano(), extracted.extraction, extracted.text);

  // The letter prints no date: the date is ALDI's own, from its index.
  assert.equal(parsed.statedNoticeDate, '2026-11-16');
  assert.equal(parsed.statedNoticeDateText, 'November 16, 2026:');
  // The headline has no closing period and runs into "ALDI of Batavia, IL,
  // is recalling …", so no firm is read: null, never the bare "IL". The
  // reviewer supplies the firm with its own excerpt.
  assert.equal(parsed.recallingFirmText, null);
  assert.ok(parsed.recallingFirmEvidence?.includes('ALDI of Batavia, IL, is recalling'));
  assert.equal(parsed.noticeKind, 'recall');
  assert.equal(parsed.foodStatus, 'food');
  assert.deepEqual(
    parsed.stateClaims.map((claim) => [claim.retailer, claim.state, claim.basis]),
    [
      ['ALDI', 'Alabama', 'stated_state_list'],
      ['ALDI', 'Georgia', 'stated_state_list'],
      ['ALDI', 'North Carolina', 'stated_state_list'],
      ['ALDI', 'South Carolina', 'stated_state_list'],
    ],
  );
  // ALDI prints lots and dates, not a store SKU; nothing becomes a UPC.
  assert.deepEqual(parsed.retailerItemNumbers, []);
  assert.deepEqual(parsed.upcs, []);
  assert.ok(parsed.codeEvidence.some((line) => line.includes('T9101926')));
});

test('an index that dates its entries dates the notice, never a code-date line', () => {
  // The recorded Rosina notice's only whole-line date is its Best By date,
  // "10/30/26"; ALDI's index dates it February 23, 2026, as the notice's own
  // "Effective: February 23, 2026" says.
  const entry = { ...priano(), indexDate: '2026-02-23', indexDateText: 'February 23, 2026:' };
  const parsed = parseLetter(
    entry,
    'text',
    'Recall Notice:\nEffective: February 23, 2026\nBremer Italian Style\nMeatballs 32-oz. bag\n10/30/26\nALDI is recalling Example Soup because of undeclared milk. Do not consume it.',
  );
  assert.equal(parsed.statedNoticeDate, '2026-02-23');
  assert.equal(parsed.statedNoticeDateText, 'Effective: February 23, 2026');
  // A press dateline is the notice's own, more specific statement: ALDI's
  // Happy Farms notice is dated "(May 9, 2024)" while the index says May 7.
  const datelined = parseLetter(
    { ...entry, indexDate: '2024-05-07', indexDateText: 'May 7, 2024:' },
    'text',
    'For Immediate Release\nBatavia, Ill. (May 9, 2024) – In cooperation with Schreiber Foods, Inc., ALDI recalls its Happy Farms Cream Cheese Spread. Do not eat it.',
  );
  assert.equal(datelined.statedNoticeDate, '2024-05-09');
  assert.equal(datelined.statedNoticeDateText, '(May 9, 2024) –');
  // Neither shape: the index date.
  const plainNotice = parseLetter(
    entry,
    'text',
    'Recall Notice:\n10/30/26\nALDI is recalling soup. Do not eat it.',
  );
  assert.equal(plainNotice.statedNoticeDate, '2026-02-23');
  assert.equal(plainNotice.statedNoticeDateText, 'February 23, 2026:');
  // Without an index date (Costco), the letterhead line dates it.
  const undatedIndex = { ...entry, indexDate: null, indexDateText: null };
  const letter = parseLetter(
    undatedIndex,
    'text',
    'March 3, 2026\nDear Customer,\nALDI is recalling Example Soup because of undeclared milk. Do not consume it.',
  );
  assert.equal(letter.statedNoticeDate, '2026-03-03');
  const parsedFirm = letter;
  // A trailing state code or corporate suffix stays with its clause.
  assert.equal(parsedFirm.recallingFirmText, 'ALDI');
  const located = parseLetter(
    undatedIndex,
    'text',
    'ALDI of Batavia, IL, is recalling Example Soup because of undeclared milk. Do not consume it.',
  );
  assert.equal(located.recallingFirmText, 'ALDI of Batavia, IL');
  const suffixed = parseLetter(
    undatedIndex,
    'text',
    'Rosina Food Products, Inc. is voluntarily recalling Bremer Italian Style Meatballs due to metal. Do not eat them.',
  );
  assert.equal(suffixed.recallingFirmText, 'Rosina Food Products, Inc.');
});

const agencyCase = (overrides: Partial<AgencyCaseView>): AgencyCaseView => ({
  id: '00000000-0000-4000-8000-000000000001',
  sourceAgency: 'FDA',
  noticeType: 'recall',
  state: 'active',
  publishedAt: '2026-11-17',
  title: 'ALDI Recalls Priano Protein Carbonara Tortelloni Because of Possible Health Risk',
  firm: 'ALDI',
  brands: ['Priano'],
  text: 'Priano Protein Carbonara Tortelloni and Priano Protein Herb & Cheese Tortelloni, lot T9101926, Best if Used By 12/18/2026.',
  retailerNames: ['ALDI'],
  geography: {
    scope: 'states',
    states: ['Alabama', 'Georgia', 'North Carolina', 'South Carolina'],
  },
  ...overrides,
});

test('Priano is a new candidate today, and links once an agency posts it', async () => {
  const extracted = await extractPdfText(prianoPdf());
  const parsed = parseLetter(priano(), extracted.extraction, extracted.text);

  const alone = decideNotice(priano(), parsed, extracted.text, []).result;
  assert.equal(alone.decision, 'new_candidate');
  assert.deepEqual(alone.reasons, ['no_agency_match']);

  const linked = decideNotice(priano(), parsed, extracted.text, [agencyCase({})]).result;
  assert.equal(linked.decision, 'link_candidate');
  assert.equal(linked.agencyLagDays, 1);

  // Shared boilerplate is not a product match: "Possible Health Risk" alone
  // never links an ALDI notice to someone else's recall.
  const unrelated = agencyCase({
    title: 'ALDI Recalls Garlic Bread Because of Possible Health Risk',
    brands: [],
    text: 'Garlic bread, lot 1234.',
  });
  assert.equal(
    decideNotice(priano(), parsed, extracted.text, [unrelated]).result.decision,
    'new_candidate',
  );
});

test('a notice older than the agency corpus is never proposed as standalone', () => {
  const old = parseAldiIndex(indexHtml()).find((entry) => entry.indexDate === '2018-10-29');
  assert.ok(old);
  const parsed = parseLetter(
    old,
    'text',
    'ALDI is voluntarily recalling Fit & Active Southwest Veggie Stuffed Sandwich due to undeclared milk. Do not eat it.',
  );
  const result = decideNotice(old, parsed, '', []).result;
  assert.equal(result.decision, 'review');
  assert.deepEqual(result.reasons, ['predates_agency_coverage']);
});

test('the shared monitor plans an ALDI run from the ALDI spec', async () => {
  const requests: string[] = [];
  const source: RetailerSource = {
    fetchIndexHtml: async () => indexHtml(),
    async fetchDocument(url) {
      requests.push(url);
      if (url !== priano().documentUrl) throw new Error('not recorded');
      return { bytes: prianoPdf(), contentType: 'application/pdf' };
    },
  };
  const plan = await planRetailerRun(
    ALDI_SOURCE,
    new MemoryRetailerNoticeStore([]),
    source,
    () => new Date('2026-11-16T22:00:00Z'),
  );
  assert.equal(plan.publisher, 'aldi');
  assert.equal(plan.indexEntries, 75);
  assert.equal(requests.length, 75, 'one request per document, sequentially');
  assert.equal(plan.failures.length, 74);
  assert.equal(plan.planned.length, 1);

  const [{ row, change, document }] = plan.planned;
  assert.equal(change, 'insert');
  assert.equal(row.publisher, 'aldi');
  assert.equal(row.indexUrl, 'https://corporate.aldi.us/newsroom/product-recalls');
  assert.equal(row.parserVersion, 'aldi-notice/1');
  assert.equal(row.decision, 'new_candidate');
  assert.equal(row.statedNoticeDate, '2026-11-16');
  assert.equal(document?.publisher, 'aldi');
  assert.equal(plan.plannedWrites, 2);
});

test('Costco keeps its own spec: no dates on its index, its own hosts and version', () => {
  assert.equal(COSTCO_SOURCE.parserVersion, 'costco-letter/1');
  assert.deepEqual(COSTCO_SOURCE.documentHosts, ['gdx-assets.costco.com']);
  assert.deepEqual(ALDI_SOURCE.documentHosts, ['dm.cms.aldi.cx']);
});

test('UPCs are read from a labelled UPC column, and never without the label', () => {
  const entry = { ...priano(), indexDate: '2024-05-07', indexDateText: 'May 7, 2024:' };
  const table =
    'ALDI recalls its Happy Farms Cream Cheese Spread products. Do not eat them.\nProduct Name Package Description/Size UPC Code Sell By Date\nWhipped Cream Cheese Spread 8 oz. cup 4099100101881\n08/30/2024\nCall 1-800-644-5473.';
  assert.deepEqual(parseLetter(entry, 'text', table).upcs, ['4099100101881']);
  const unlabelled = table.replace('UPC Code', 'Code');
  assert.deepEqual(parseLetter(entry, 'text', unlabelled).upcs, []);
});
