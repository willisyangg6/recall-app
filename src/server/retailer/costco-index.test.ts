import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseCostcoIndex } from './costco-index';
import { FIXTURE_IDS, fixtureIndexHtml } from './fixtures/costco-fixtures';

const entries = parseCostcoIndex(fixtureIndexHtml());
const byId = new Map(entries.map((entry) => [entry.nativeId, entry]));

test('the recorded index yields its 21 notice documents, one per document', () => {
  assert.equal(entries.length, 21);
  assert.equal(new Set(entries.map((entry) => entry.nativeId)).size, 21);
  // One CMS block (saunas) links two letters: each is its own entry.
  assert.ok(byId.has('bltb8984a192559bb39:1'));
  assert.ok(byId.has('bltb8984a192559bb39:2'));
  assert.match(
    byId.get('bltb8984a192559bb39:1')!.indexTitle,
    /^Tylo and Watkins Saunas.* — Models sold/,
  );
});

test('entries keep the printed label, title and document link exactly', () => {
  const whipped = byId.get(FIXTURE_IDS.whippedCream)!;
  assert.equal(whipped.indexLabel, 'Recall Notice');
  assert.equal(
    whipped.indexTitle,
    'Kirkland Signature Heavy Whipped Cream (Item #1777000) Select Locations in the Midwest and Southeast',
  );
  // Literal spaces in the published link are percent-encoded for HTTP.
  assert.equal(
    whipped.documentUrl,
    'https://gdx-assets.costco.com/adobe/assets/urn:aaid:aem:8dedd165-f61b-475a-b7bb-5f33f77a4675/original/as/FINAL%20KS%20Whipped%20Cream%20Member%20Letter.pdf',
  );
  // Labels are recorded as printed — they are not statuses.
  assert.equal(byId.get(FIXTURE_IDS.turkishDelight)!.indexLabel, 'Member Notice');
  assert.equal(byId.get(FIXTURE_IDS.desertWillow)!.indexLabel, 'Product Information Notice');
  assert.equal(byId.get(FIXTURE_IDS.punahele)!.indexLabel, 'Recall Notice');
});

test('every document link is on the approved document host', () => {
  for (const entry of entries) {
    assert.equal(new URL(entry.documentUrl).hostname, 'gdx-assets.costco.com', entry.nativeId);
  }
});

test('a page with no notice blocks parses to nothing (the monitor then refuses to run)', () => {
  assert.deepEqual(parseCostcoIndex('<html><body>Access Denied</body></html>'), []);
});
