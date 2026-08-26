/**
 * Unit contracts for enforcement parsing and matching: identity quarantine,
 * the date window, code vs name identity, ambiguity preservation, and the
 * firm blocking key's measured drift cases.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { AnnouncementFacts } from './match';
import { blockByFirm, firmBlockingTokens, indexByNormalizedFirm, matchCase } from './match';
import {
  isoDate,
  parseEnforcementClassification,
  parseEnforcementRecord,
  type OpenFdaEnforcementRaw,
} from './parse';

function raw(overrides: Partial<OpenFdaEnforcementRaw>): OpenFdaEnforcementRaw {
  return {
    recall_number: 'F-2000-2026',
    event_id: '90001',
    classification: 'Class I',
    status: 'Ongoing',
    recalling_firm: 'Acme Foods LLC',
    product_description: 'Crunchy Peanut Butter 16 oz jar UPC 011110123456',
    code_info: 'Best by 12/01/2026',
    reason_for_recall: 'Salmonella',
    recall_initiation_date: '20260710',
    report_date: '20260805',
    ...overrides,
  };
}

function facts(overrides: Partial<AnnouncementFacts>): AnnouncementFacts {
  return {
    caseId: 'case-1',
    publishedDates: ['2026-07-14'],
    firmNames: ['Acme Foods'],
    titleText: 'Acme Foods Recalls Crunchy Peanut Butter Due to Salmonella',
    productText: '',
    bodyText:
      'Acme Foods is recalling Crunchy Peanut Butter 16 oz jars with UPC 011110123456 sold nationwide.',
    ...overrides,
  };
}

function run(f: AnnouncementFacts, records: OpenFdaEnforcementRaw[]) {
  const parsed = records.map(parseEnforcementRecord);
  return matchCase(f, blockByFirm(f, indexByNormalizedFirm(parsed)));
}

test('parse: records without identity are quarantined, never guessed', () => {
  assert.throws(() => parseEnforcementRecord(raw({ recall_number: '' })));
  assert.throws(() => parseEnforcementRecord(raw({ recall_number: undefined })));
  assert.throws(() => parseEnforcementRecord(raw({ event_id: '' })));
  assert.equal(isoDate('20260819'), '2026-08-19');
  assert.equal(isoDate('2026-08-19'), null);
  assert.equal(isoDate(undefined), null);
});

test('parse: classification is read verbatim and never inferred', () => {
  assert.equal(parseEnforcementClassification('Class I').value, 'class_I');
  assert.equal(parseEnforcementClassification('Class II').value, 'class_II');
  assert.equal(parseEnforcementClassification('Class III').value, 'class_III');
  assert.equal(parseEnforcementClassification('Not Yet Classified').value, 'not_yet_classified');
  assert.equal(parseEnforcementClassification(undefined).value, 'not_yet_classified');
});

test('code identity accepts inside the window and produces readable evidence', () => {
  const result = run(facts({}), [raw({})]);
  assert.equal(result.state, 'matched_deterministic');
  assert.equal(result.accepted[0].method, 'code-identity');
  assert.ok(result.accepted[0].evidence.some((line) => /UPC overlap: 011110123456/.test(line)));
  assert.ok(result.accepted[0].evidence.some((line) => /recalling firm/.test(line)));
});

test('the same UPC outside the date window never matches (recurring-product trap)', () => {
  // Measured live: Gold Medal flour and Green Sprouts alfalfa keep their
  // UPCs across recalls years apart. The window excludes them.
  const result = run(facts({}), [raw({ recall_initiation_date: '20230710' })]);
  assert.equal(result.state, 'unmatched');
  assert.equal(result.accepted.length, 0);
  // Window edges (inclusive): initiation 91 days before the announcement is
  // out; 90 days before and 44 days after are in.
  assert.equal(run(facts({}), [raw({ recall_initiation_date: '20260414' })]).state, 'unmatched');
  assert.equal(
    run(facts({}), [raw({ recall_initiation_date: '20260415' })]).state,
    'matched_deterministic',
  );
  assert.equal(
    run(facts({}), [raw({ recall_initiation_date: '20260827' })]).state,
    'matched_deterministic',
  );
});

test('a different firm never even blocks, whatever the product says', () => {
  const result = run(facts({}), [raw({ recalling_firm: 'Zenith Snacks Inc' })]);
  assert.equal(result.state, 'unmatched');
});

test('name identity requires a sole qualifying event — two stay ambiguous', () => {
  const noUpcFacts = facts({
    bodyText: 'Acme Foods is recalling Crunchy Peanut Butter jars sold nationwide.',
  });
  const sole = run(noUpcFacts, [raw({ product_description: 'Crunchy Peanut Butter 16 oz jar' })]);
  assert.equal(sole.state, 'matched_deterministic');
  assert.equal(sole.accepted[0].method, 'name-identity');

  const twin = run(noUpcFacts, [
    raw({ product_description: 'Crunchy Peanut Butter 16 oz jar' }),
    raw({
      recall_number: 'F-2001-2026',
      event_id: '90002',
      classification: 'Class II',
      product_description: 'Crunchy Peanut Butter 40 oz jar',
      recall_initiation_date: '20260705',
    }),
  ]);
  assert.equal(twin.state, 'ambiguous');
  assert.equal(twin.accepted.length, 0);
  assert.equal(twin.ambiguous.length, 2);
});

test('several events may each match by their own UPC (multi-event expansion)', () => {
  const body =
    'Acme Foods recalled Crunchy Peanut Butter UPC 011110123456 and later expanded to Smooth Peanut Butter UPC 022220123456.';
  const result = run(facts({ bodyText: body }), [
    raw({}),
    raw({
      recall_number: 'F-2002-2026',
      event_id: '90003',
      product_description: 'Smooth Peanut Butter 16 oz jar UPC 022220123456',
      recall_initiation_date: '20260801',
    }),
  ]);
  assert.equal(result.accepted.length, 2);
  assert.deepEqual(result.accepted.map((m) => m.eventId).sort(), ['90001', '90003']);
});

test('firm blocking keys absorb the measured drift between the two sources', () => {
  const pairs: [string, string][] = [
    ['Danone U.S.', 'DANONE US LLC'],
    ["Jeni's Splendid Ice Cream", 'Jenis Splendid Ice Creams LLC'],
    ['Kroger', 'The Kroger Co'],
    ['Jacks and the Green Sprouts', 'Jack & The Green Sprouts, Inc.'],
  ];
  for (const [a, b] of pairs) {
    assert.deepEqual(firmBlockingTokens(a), firmBlockingTokens(b), `${a} vs ${b}`);
  }
  // Prefix blocking admits facility-suffixed firm strings…
  const index = indexByNormalizedFirm([
    parseEnforcementRecord(raw({ recalling_firm: 'Meijer, Inc #816 - Grand River Packaging' })),
  ]);
  assert.equal(blockByFirm({ firmNames: ['Meijer'] }, index).length, 1);
  // …but unrelated firms still never block.
  assert.equal(blockByFirm({ firmNames: ['Whole Foods Market'] }, index).length, 0);
});
