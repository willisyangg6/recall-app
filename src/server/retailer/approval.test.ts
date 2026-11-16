import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  applyApprovalPlan,
  checkApproval,
  planAgencyMatch,
  planApproval,
  readApprovalRequest,
  type ApprovalRequest,
} from './approval';
import { MemoryApprovalStore, noticeForReview } from './approval-store';
import { planCostcoRun } from './costco-monitor';
import {
  FIXTURE_IDS,
  fixtureAgencyCases,
  fixtureDocument,
  fixtureExtract,
  fixtureSource,
} from './fixtures/costco-fixtures';
import { extractPdfPageTexts, isPdf as isPdfBytes } from './pdf-text';
import { MemoryRetailerNoticeStore } from './store';

const REQUEST_PATH = join(__dirname, 'fixtures', 'approvals', 'kirkland-whipped-cream.json');
const LETTER = fixtureDocument(FIXTURE_IDS.whippedCream);
const LETTER_HASH = createHash('sha256').update(LETTER).digest('hex');
const now = () => new Date('2026-11-15T20:00:00Z');

function request(): ApprovalRequest {
  const parsed = readApprovalRequest(JSON.parse(readFileSync(REQUEST_PATH, 'utf8')));
  assert.ok(!('error' in parsed), JSON.stringify(parsed));
  return parsed;
}

/** The whipped cream notice exactly as the monitor stores it, from the recorded fixtures. */
async function seededStore(): Promise<MemoryApprovalStore> {
  const plan = await planCostcoRun(
    new MemoryRetailerNoticeStore(fixtureAgencyCases()),
    fixtureSource(),
    now,
    fixtureExtract,
  );
  const row = plan.planned.find((item) => item.row.nativeId === FIXTURE_IDS.whippedCream)!.row;
  const store = new MemoryApprovalStore();
  store.seedNotice(noticeForReview('notice-whipped', row), [{ hash: LETTER_HASH, bytes: LETTER }]);
  return store;
}

test('the staging fixture names the archived letter by its exact hash', () => {
  assert.equal(LETTER_HASH, 'df0f1de807300e7c05e523d558d9e19912553e9723f5a63d1eaca421502b8ae9');
  assert.equal(request().documentContentHash, LETTER_HASH);
});

test('the reviewed fixture passes every check and plans exactly one approval', async () => {
  const store = await seededStore();
  const plan = await planApproval(store, request(), now, extractPdfPageTexts);
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(
    plan.writes.map((write) => write.kind),
    ['upload_image', 'insert'],
  );
  assert.equal(await applyApprovalPlan(store, plan), 2);
  // The stored photo is byte-identical to PDF object 11 of the approved letter.
  const [[path, stored]] = [...store.uploads];
  assert.equal(path, request().fields.image!.path);
  assert.equal(
    createHash('sha256').update(stored).digest('hex'),
    '8a1a80cbf85e3eb73d837f371c6272bde0a65e73147bb98ffc45cec4fa6cd1e9',
  );
  const [approval] = store.approvals;
  assert.equal(approval.documentContentHash, LETTER_HASH);
  assert.equal(approval.fieldsVersion, 1);
  // Approving the same thing again writes nothing (and appears once).
  const again = await planApproval(store, request(), now, extractPdfPageTexts);
  assert.deepEqual(again.writes, []);
});

test('the package identifiers stay in their own lists, and no pack size is approved', () => {
  const { fields } = request();
  assert.deepEqual(fields.packageChecks, {
    retailerItemNumbers: ['1777000'],
    supplierCodes: ['AC50'],
    lotCodes: ['04/02/2027'],
    bestByDates: ['APR/02/27'],
    canTimestamps: ['00:35 – 02:45'],
    upcs: [],
  });
  assert.doesNotMatch(JSON.stringify(fields), /8CT|3PK|case pack/i);
});

test('an approval for any other letter than the current one is refused', async () => {
  const store = await seededStore();
  const stale = { ...request(), documentContentHash: 'a'.repeat(64) };
  const plan = await planApproval(store, stale, now, extractPdfPageTexts);
  assert.equal(plan.writes.length, 0);
  assert.ok(plan.problems.some((problem) => /not the notice's current letter/.test(problem)));
});

test('a revised letter needs a new approval, which supersedes the old one', async () => {
  const store = await seededStore();
  await applyApprovalPlan(store, await planApproval(store, request(), now, extractPdfPageTexts));
  // The monitor archives a revised letter: same text, new bytes, new hash.
  const revised = new Uint8Array([...LETTER, 0x0a]);
  const revisedHash = createHash('sha256').update(revised).digest('hex');
  const notice = store.notices.get(`costco:${FIXTURE_IDS.whippedCream}`)!;
  store.seedNotice({ ...notice, documentContentHash: revisedHash }, [
    { hash: revisedHash, bytes: revised },
  ]);

  // The old approval no longer matches the current letter: re-approving the
  // old hash is refused, approving the revised letter supersedes it.
  const old = await planApproval(store, request(), now, extractPdfPageTexts);
  assert.ok(old.problems.length > 0);
  // The old photo path names the old letter: it cannot carry over.
  const carried = await planApproval(
    store,
    { ...request(), documentContentHash: revisedHash },
    now,
    extractPdfPageTexts,
  );
  assert.ok(carried.problems.some((problem) => /photo path must be/.test(problem)));
  // Reviewed again for the revised letter, its photo gets the revised path.
  const reviewed = structuredClone(request());
  reviewed.documentContentHash = revisedHash;
  reviewed.fields.image!.path = reviewed.fields.image!.path.replace(LETTER_HASH, revisedHash);
  const plan = await planApproval(store, reviewed, now, extractPdfPageTexts);
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(
    plan.writes.map((write) => write.kind),
    ['withdraw', 'upload_image', 'insert'],
  );
  await applyApprovalPlan(store, plan);
  assert.equal(store.approvals.filter((approval) => approval.withdrawnAt === null).length, 1);
});

test('a photo must be exactly an image embedded in the approved letter', async () => {
  const store = await seededStore();
  const cases: [string, (r: ApprovalRequest) => void, RegExp][] = [
    ['another object', (r) => (r.fields.image!.pdfObject = 99), /no JPEG in PDF object 99/],
    ['a different size', (r) => (r.fields.image!.width = 800), /is 763×2046, not 800×2046/],
    [
      'a path naming another image',
      (r) =>
        (r.fields.image!.path = r.fields.image!.path.replace(
          /[0-9a-f]{64}\.jpg$/,
          `${'0'.repeat(64)}.jpg`,
        )),
      /photo path must be/,
    ],
  ];
  for (const [label, mutate, expected] of cases) {
    const bad = structuredClone(request());
    mutate(bad);
    const plan = await planApproval(store, bad, now, extractPdfPageTexts);
    assert.equal(plan.writes.length, 0, label);
    assert.ok(
      plan.problems.some((problem) => expected.test(problem)),
      `${label}: ${plan.problems.join(' | ')}`,
    );
  }
  // No photo is a valid approval too: nothing is uploaded.
  const without = structuredClone(request());
  without.fields.image = null;
  const plan = await planApproval(store, without, now, extractPdfPageTexts);
  assert.deepEqual(
    plan.writes.map((write) => write.kind),
    ['insert'],
  );
});

test('nothing can be approved that the letter does not print', async () => {
  const store = await seededStore();
  const base = request();
  const cases: [string, (r: ApprovalRequest) => void, RegExp][] = [
    ['an invented lot', (r) => (r.fields.packageChecks.lotCodes = ['04/03/2027']), /lotCodes/],
    [
      'an item number the letter does not state',
      (r) => (r.fields.packageChecks.retailerItemNumbers = ['1777001']),
      /retailer item number 1777001/,
    ],
    ['a UPC the letter never labels', (r) => (r.fields.packageChecks.upcs = ['1777000']), /UPC/],
    ['a state the letter does not list', (r) => r.fields.whereSold.states.push('Texas'), /Texas/],
    [
      'a number introduced in prose',
      (r) => (r.fields.whyRecalled = 'One batch of 4,000 cans may contain a cleaning chemical.'),
      /introduces "4,000"/,
    ],
    [
      'an excerpt cited on a page that does not exist',
      (r) => (r.evidence.whyRecalled = [{ excerpt: r.evidence.whyRecalled![0].excerpt, page: 2 }]),
      /page 2/,
    ],
    [
      'an excerpt that is not in the letter',
      (r) => (r.evidence.whyRecalled = [{ excerpt: 'may contain undeclared peanuts', page: 1 }]),
      /not printed on page 1/,
    ],
    ['a field with no evidence', (r) => delete r.evidence.contact, /contact has no supporting/],
  ];
  for (const [label, mutate, expected] of cases) {
    const bad = structuredClone(base);
    mutate(bad);
    const plan = await planApproval(store, bad, now, extractPdfPageTexts);
    assert.equal(plan.writes.length, 0, label);
    assert.ok(
      plan.problems.some((problem) => expected.test(problem)),
      `${label}: ${plan.problems.join(' | ')}`,
    );
  }
});

test('a warehouse list proves a state by its postal code, and nothing looser', () => {
  const warehouses = 'at the following Costco warehouses: Missoula, MT Burlington, WA Bayamon, PR';
  const base = structuredClone(request());
  base.fields.whereSold.states = ['Montana', 'Washington', 'Puerto Rico'];
  base.evidence['whereSold.states'] = [{ excerpt: warehouses, page: 1 }];
  const notice = {
    id: 'n',
    publisher: 'costco' as const,
    nativeId: 'x',
    documentContentHash: base.documentContentHash,
    decision: 'new_candidate',
    noticeKind: 'recall',
    foodStatus: 'food',
    documentExtraction: 'text',
    statedNoticeDate: '2026-04-07',
    retailerItemNumbers: ['1777000'],
    upcs: [],
    statedStates: ['Montana', 'Washington', 'Puerto Rico', 'Maine'],
  };
  // Only the states field is checked here: the rest of the request is the whipped cream fixture.
  const statesProblems = (states: string[]) => {
    const r = structuredClone(base);
    r.fields.whereSold.states = states;
    return checkApproval(r, notice, [warehouses]).filter((p) => p.startsWith('whereSold.states'));
  };
  assert.deepEqual(statesProblems(['Montana', 'Washington', 'Puerto Rico']), []);
  // "ME" appears nowhere as a ", ME" pair.
  assert.ok(statesProblems(['Maine']).some((p) => /Maine/.test(p)));
});

test('only a standalone new candidate can be approved', async () => {
  const store = await seededStore();
  const notice = store.notices.get(`costco:${FIXTURE_IDS.whippedCream}`)!;
  store.seedNotice({ ...notice, decision: 'link_candidate' }, []);
  const plan = await planApproval(store, request(), now, extractPdfPageTexts);
  assert.ok(plan.problems.some((problem) => /link_candidate/.test(problem)));
});

test('confirming an agency match needs a real case and hides the live approval', async () => {
  const store = await seededStore();
  await applyApprovalPlan(store, await planApproval(store, request(), now, extractPdfPageTexts));
  const caseId = '38c00154-9077-4bf9-b0d3-a4d46a5e8f2b';
  const unknown = await planAgencyMatch(store, 'costco', FIXTURE_IDS.whippedCream, caseId, now);
  assert.ok(unknown.problems.some((problem) => /no agency case/.test(problem)));
  store.agencyCases.add(caseId);
  const plan = await planAgencyMatch(store, 'costco', FIXTURE_IDS.whippedCream, caseId, now);
  assert.deepEqual(
    plan.writes.map((write) => write.kind),
    ['confirm_agency_match'],
  );
  await applyApprovalPlan(store, plan);
  assert.equal(store.approvals[0].agencyCaseId, caseId);
});

test('the approval modules write only the approval table', () => {
  for (const file of ['approval.ts', 'approval-store.ts']) {
    const source = readFileSync(join(__dirname, file), 'utf8').replace(
      /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
      '',
    );
    const written = [...source.matchAll(/from\('([a-z_]+)'\)\s*\.(insert|update|upsert|delete)/g)];
    for (const [, table] of written) assert.equal(table, 'retailer_notice_approvals', file);
    assert.doesNotMatch(source, /\.rpc\(|notification_events|source_records/, file);
  }
});

/**
 * The initial launch batch: each request checked against the monitor's own
 * row for its letter and the letter's recorded text. The production letters'
 * hashes were read on 2026-11-16 (the text fixtures carry no PDF hash).
 */
test('the launch batch passes every check, including a letter that states no state', async () => {
  const plan = await planCostcoRun(
    new MemoryRetailerNoticeStore(fixtureAgencyCases()),
    fixtureSource(),
    now,
    fixtureExtract,
  );
  const batch: [string, string][] = [
    [FIXTURE_IDS.whippedCream, 'kirkland-whipped-cream.json'],
    [FIXTURE_IDS.madeleines, 'traditional-madeleines.json'],
    [FIXTURE_IDS.caesar, 'caesar-salad.json'],
  ];
  for (const [nativeId, file] of batch) {
    const parsed = readApprovalRequest(
      JSON.parse(readFileSync(join(__dirname, 'fixtures', 'approvals', file), 'utf8')),
    );
    assert.ok(!('error' in parsed), `${file}: ${JSON.stringify(parsed)}`);
    const row = plan.planned.find((item) => item.row.nativeId === nativeId)!.row;
    const notice = {
      ...noticeForReview(`notice-${nativeId}`, row),
      documentContentHash: parsed.documentContentHash,
    };
    const text = (await fixtureExtract(fixtureDocument(nativeId))).text;
    const pages = isPdfBytes(fixtureDocument(nativeId))
      ? await extractPdfPageTexts(fixtureDocument(nativeId))
      : [text];
    assert.deepEqual(checkApproval(parsed, notice, pages), [], file);
  }
  // Caesar Salad states no state, and none is approved or inferred for it.
  const caesar = plan.planned.find((item) => item.row.nativeId === FIXTURE_IDS.caesar)!.row;
  assert.deepEqual(caesar.stateClaims, []);
});

test('an empty state list is approved with no evidence, but a stated state still needs it', async () => {
  const base = readApprovalRequest(
    JSON.parse(readFileSync(join(__dirname, 'fixtures', 'approvals', 'caesar-salad.json'), 'utf8')),
  );
  assert.ok(!('error' in base));
  assert.deepEqual(base.fields.whereSold.states, []);
  assert.equal(base.evidence['whereSold.states'], undefined);
  const text = (await fixtureExtract(fixtureDocument(FIXTURE_IDS.caesar))).text;
  const notice = {
    id: 'n',
    publisher: 'costco' as const,
    nativeId: FIXTURE_IDS.caesar,
    documentContentHash: base.documentContentHash,
    decision: 'new_candidate',
    noticeKind: 'recall',
    foodStatus: 'food',
    documentExtraction: 'text',
    statedNoticeDate: '2025-11-07',
    retailerItemNumbers: ['19927', '11444'],
    upcs: [],
    statedStates: [],
  };
  // A region name from Costco's index is never a state.
  const invented = structuredClone(base);
  invented.fields.whereSold.states = ['Ohio'];
  assert.ok(
    checkApproval(invented, notice, [text]).some((p) => /"Ohio" is not one the letter/.test(p)),
  );
});
