import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  desiredFdaOngoingAsOf,
  isOngoingStatus,
  planClearOpenEvidence,
  planOpenEvidence,
  validateExportCompleteness,
  type EnforcementLink,
  type OpenEvidenceCase,
} from './open-evidence';
import {
  MemoryOpenEvidenceStore,
  runOpenEvidenceSync,
  unparsedRecallNumbers,
  type OpenEvidenceCorpus,
} from './open-evidence-sync';
import type { OpenFdaEnforcementRaw } from './parse';

const EXPORT = '2026-10-06';
const NONE = new Set<string>();

function raw(recallNumber: string, status: string, eventId = '1'): OpenFdaEnforcementRaw {
  return {
    recall_number: recallNumber,
    event_id: eventId,
    classification: 'Class II',
    status,
    recalling_firm: 'Firm LLC',
    product_description: 'Product',
    code_info: 'Lot 1',
    reason_for_recall: 'Undeclared allergen',
    recall_initiation_date: '20260101',
    center_classification_date: '20260201',
    report_date: '20260210',
  };
}

function corpus(records: OpenFdaEnforcementRaw[], overrides: Partial<OpenEvidenceCorpus> = {}) {
  return { records, exportDate: EXPORT, totalRecords: records.length, ...overrides };
}

function cases(
  ...entries: [string, string | null, (string | null)?][]
): Map<string, OpenEvidenceCase> {
  return new Map(
    entries.map(([id, value, merged]) => [
      id,
      { id, fdaOngoingAsOf: value, mergedInto: merged ?? null },
    ]),
  );
}

// ── statuses ────────────────────────────────────────────────────────────────

test('only Ongoing (and the documented On-Going) confirms open, after trimming', () => {
  for (const status of ['Ongoing', 'On-Going', ' Ongoing '])
    assert.equal(isOngoingStatus(status), true);
  for (const status of ['Completed', 'Terminated', 'Pending', '', 'ongoing', null, undefined]) {
    assert.equal(isOngoingStatus(status), false, String(status));
  }
});

test('a case is open when ANY owned linked record is Ongoing, whatever the others say', () => {
  const statuses = new Map([
    ['F-1', 'Terminated'],
    ['F-2', 'Ongoing'],
    ['F-3', 'Completed'],
  ]);
  assert.equal(desiredFdaOngoingAsOf(['F-1', 'F-2', 'F-3'], statuses, NONE, EXPORT), EXPORT);
  assert.equal(desiredFdaOngoingAsOf(['F-1', 'F-3'], statuses, NONE, EXPORT), null);
  assert.equal(desiredFdaOngoingAsOf([], statuses, NONE, EXPORT), null);
});

test('Pending, empty and unknown statuses never confirm open', () => {
  const statuses = new Map<string, string | null>([
    ['F-1', 'Pending'],
    ['F-2', null],
    ['F-3', 'Under review'],
  ]);
  assert.equal(desiredFdaOngoingAsOf(['F-1', 'F-2', 'F-3'], statuses, NONE, EXPORT), null);
});

test('a linked record absent from a complete export does not confirm open', () => {
  assert.equal(desiredFdaOngoingAsOf(['F-9'], new Map(), NONE, EXPORT), null);
});

test('an owned record present but unparseable skips the case instead of clearing it', () => {
  assert.equal(desiredFdaOngoingAsOf(['F-1'], new Map(), new Set(['F-1']), EXPORT), 'skip');
  // An Ongoing sibling still decides it: the evidence is positive regardless.
  assert.equal(
    desiredFdaOngoingAsOf(['F-1', 'F-2'], new Map([['F-2', 'Ongoing']]), new Set(['F-1']), EXPORT),
    EXPORT,
  );
});

// ── plan ────────────────────────────────────────────────────────────────────

test('the plan writes only changes, classifies each, and skips merged cases', () => {
  const links: EnforcementLink[] = [
    { recallNumber: 'F-gain', caseId: 'a' },
    { recallNumber: 'F-lose', caseId: 'b' },
    { recallNumber: 'F-adv', caseId: 'c' },
    { recallNumber: 'F-same', caseId: 'd' },
    { recallNumber: 'F-merged', caseId: 'm' },
  ];
  const statusByRecallNumber = new Map([
    ['F-gain', 'Ongoing'],
    ['F-lose', 'Terminated'],
    ['F-adv', 'Ongoing'],
    ['F-same', 'Ongoing'],
    ['F-merged', 'Ongoing'],
  ]);
  const plan = planOpenEvidence({
    cases: [
      ...cases(
        ['d', EXPORT],
        ['c', '2026-09-28'],
        ['b', '2026-09-28'],
        ['a', null],
        ['e', null],
        ['m', null, 'a'],
      ).values(),
    ],
    links,
    statusByRecallNumber,
    unparsedRecallNumbers: NONE,
    exportDate: EXPORT,
  });
  assert.deepEqual(plan.writes, [
    { caseId: 'a', before: null, after: EXPORT },
    { caseId: 'b', before: '2026-09-28', after: null },
    { caseId: 'c', before: '2026-09-28', after: EXPORT },
  ]);
  assert.deepEqual(plan.stats, {
    casesExamined: 5,
    gained: 1,
    lost: 1,
    advanced: 1,
    unchanged: 2,
    skippedUnparsed: 0,
    confirmedOpen: 3,
  });
});

test('a recall number owned by another case gives evidence only to its owner', () => {
  // The link table holds ONE owner per recall number; the duplicate case has
  // no link, so it gains nothing even though the matcher accepted the event.
  const plan = planOpenEvidence({
    cases: [...cases(['owner', null], ['duplicate', null]).values()],
    links: [{ recallNumber: 'F-1', caseId: 'owner' }],
    statusByRecallNumber: new Map([['F-1', 'Ongoing']]),
    unparsedRecallNumbers: NONE,
    exportDate: EXPORT,
  });
  assert.deepEqual(plan.writes, [{ caseId: 'owner', before: null, after: EXPORT }]);
});

test('the plan is independent of case and link order', () => {
  const links: EnforcementLink[] = [
    { recallNumber: 'F-1', caseId: 'a' },
    { recallNumber: 'F-2', caseId: 'b' },
    { recallNumber: 'F-3', caseId: 'a' },
  ];
  const input = {
    statusByRecallNumber: new Map([
      ['F-1', 'Terminated'],
      ['F-2', 'Ongoing'],
      ['F-3', 'Ongoing'],
    ]),
    unparsedRecallNumbers: NONE,
    exportDate: EXPORT,
  };
  const forward = planOpenEvidence({
    ...input,
    cases: [...cases(['a', null], ['b', null]).values()],
    links,
  });
  const reversed = planOpenEvidence({
    ...input,
    cases: [...cases(['b', null], ['a', null]).values()],
    links: [...links].reverse(),
  });
  assert.deepEqual(forward, reversed);
});

test('the clear plan nulls every stored value and nothing else', () => {
  assert.deepEqual(
    planClearOpenEvidence([...cases(['b', EXPORT], ['a', null], ['c', '2026-09-28']).values()]),
    [
      { caseId: 'b', before: EXPORT, after: null },
      { caseId: 'c', before: '2026-09-28', after: null },
    ],
  );
});

// ── completeness ────────────────────────────────────────────────────────────

test('only a complete, dated, plausible export passes the gate', () => {
  const ok = { rawCount: 29471, manifestTotal: 29471, previousTotal: 29463, exportDate: EXPORT };
  assert.deepEqual(validateExportCompleteness(ok), { complete: true });
  assert.deepEqual(validateExportCompleteness({ ...ok, previousTotal: null }), { complete: true });
  const failures = [
    { ...ok, rawCount: 29470 },
    { ...ok, rawCount: 0, manifestTotal: 0 },
    { ...ok, manifestTotal: 14000, rawCount: 14000 },
    { ...ok, exportDate: null },
    { ...ok, exportDate: '20261006' },
  ];
  for (const input of failures) {
    assert.equal(validateExportCompleteness(input).complete, false, JSON.stringify(input));
  }
});

test('unparsed records are named by recall number; the known blank-number record names nothing', () => {
  // A real parse failure: the parser refuses a record with no event_id.
  const broken = { ...raw('F-bad', 'Ongoing'), event_id: '' } as OpenFdaEnforcementRaw;
  const blank = { ...raw('', 'Ongoing') };
  const { statusByRecallNumber, unparsed } = unparsedRecallNumbers([
    raw('F-ok', 'Ongoing'),
    broken,
    blank,
  ]);
  assert.equal(statusByRecallNumber.get('F-ok'), 'Ongoing');
  assert.equal(statusByRecallNumber.has('F-bad'), false);
  assert.deepEqual([...unparsed], ['F-bad']);
});

// ── runner ──────────────────────────────────────────────────────────────────

test('dry run plans and writes nothing; apply writes exactly the plan; a second apply is a no-op', async () => {
  const store = new MemoryOpenEvidenceStore(cases(['a', null], ['b', '2026-09-28']), [
    { recallNumber: 'F-1', caseId: 'a' },
    { recallNumber: 'F-2', caseId: 'b' },
  ]);
  const input = corpus([raw('F-1', 'Ongoing'), raw('F-2', 'Terminated')]);

  const dry = await runOpenEvidenceSync(store, input, { apply: false, previousTotal: null });
  assert.equal(dry.status, 'planned');
  assert.equal(dry.status === 'planned' && dry.writes.length, 2);
  assert.deepEqual(store.writeLog, []);

  const applied = await runOpenEvidenceSync(store, input, { apply: true, previousTotal: null });
  assert.equal(applied.status === 'applied' && applied.applied, 2);
  assert.equal(store.value('a'), EXPORT);
  assert.equal(store.value('b'), null);

  const again = await runOpenEvidenceSync(store, input, { apply: true, previousTotal: null });
  assert.equal(again.status === 'applied' && again.writes.length, 0);
  assert.equal(store.writeLog.length, 2);
});

test('an incomplete export writes nothing and leaves valid evidence in place', async () => {
  const store = new MemoryOpenEvidenceStore(cases(['a', '2026-09-28']), [
    { recallNumber: 'F-1', caseId: 'a' },
  ]);
  // F-1 is missing from this truncated export: a naive plan would null it.
  const truncated = corpus([raw('F-2', 'Terminated')], { totalRecords: 2 });
  const result = await runOpenEvidenceSync(store, truncated, { apply: true, previousTotal: null });
  assert.equal(result.status, 'skipped');
  assert.equal(store.value('a'), '2026-09-28');
  assert.deepEqual(store.writeLog, []);

  const implausible = corpus([raw('F-2', 'Terminated')]);
  const small = await runOpenEvidenceSync(store, implausible, {
    apply: true,
    previousTotal: 29471,
  });
  assert.equal(small.status, 'skipped');
  assert.equal(store.value('a'), '2026-09-28');

  const undated = corpus([raw('F-2', 'Terminated')], { exportDate: null });
  assert.equal(
    (await runOpenEvidenceSync(store, undated, { apply: true, previousTotal: null })).status,
    'skipped',
  );
  assert.equal(store.value('a'), '2026-09-28');
});

test('a crash part-way through leaves each case old-or-new, and the next run converges', async () => {
  const links = ['a', 'b', 'c'].map((id) => ({ recallNumber: `F-${id}`, caseId: id }));
  const records = ['a', 'b', 'c'].map((id) => raw(`F-${id}`, 'Ongoing'));
  const state = cases(['a', null], ['b', null], ['c', null]);
  const failing = new MemoryOpenEvidenceStore(state, links, { failOnWrite: 1 });
  await assert.rejects(
    runOpenEvidenceSync(failing, corpus(records), { apply: true, previousTotal: null }),
  );
  assert.deepEqual(
    ['a', 'b', 'c'].map((id) => failing.value(id)),
    [EXPORT, null, null],
  );
  const healthy = new MemoryOpenEvidenceStore(state, links);
  const result = await runOpenEvidenceSync(healthy, corpus(records), {
    apply: true,
    previousTotal: null,
  });
  assert.equal(result.status === 'applied' && result.applied, 2);
  assert.deepEqual(
    ['a', 'b', 'c'].map((id) => healthy.value(id)),
    [EXPORT, EXPORT, EXPORT],
  );
});

test('a value moved under the run is a reported conflict, never overwritten', async () => {
  const state = cases(['a', null]);
  const store = new MemoryOpenEvidenceStore(state, [{ recallNumber: 'F-1', caseId: 'a' }]);
  const original = store.listFdaCases.bind(store);
  store.listFdaCases = async () => {
    const read = await original();
    state.set('a', { id: 'a', mergedInto: null, fdaOngoingAsOf: '2026-01-01' }); // a concurrent writer
    return read;
  };
  const result = await runOpenEvidenceSync(store, corpus([raw('F-1', 'Ongoing')]), {
    apply: true,
    previousTotal: null,
  });
  assert.equal(result.status === 'applied' && result.conflicts, 1);
  assert.equal(store.value('a'), '2026-01-01');
});

test('apply is refused before the migration; a dry run still plans with values read as null', async () => {
  const store = new MemoryOpenEvidenceStore(
    cases(['a', null]),
    [{ recallNumber: 'F-1', caseId: 'a' }],
    {
      columnPresent: false,
    },
  );
  const input = corpus([raw('F-1', 'Ongoing')]);
  const dry = await runOpenEvidenceSync(store, input, { apply: false, previousTotal: null });
  assert.equal(dry.status === 'planned' && dry.columnPresent, false);
  assert.equal(dry.status === 'planned' && dry.stats?.gained, 1);
  await assert.rejects(
    runOpenEvidenceSync(store, input, { apply: true, previousTotal: null }),
    /migration/,
  );
});

test('clear mode nulls stored values without needing an export', async () => {
  const store = new MemoryOpenEvidenceStore(cases(['a', EXPORT], ['b', null]), []);
  const result = await runOpenEvidenceSync(
    store,
    corpus([], { exportDate: null, totalRecords: 0 }),
    {
      apply: true,
      previousTotal: null,
      clear: true,
    },
  );
  assert.equal(result.status === 'applied' && result.applied, 1);
  assert.equal(store.value('a'), null);
});

// ── ops:health ──────────────────────────────────────────────────────────────

test('evidence age: healthy, STALE after 14 days, and the device expiry counted separately', async () => {
  const { summarizeOpenEvidenceAge, OPEN_EVIDENCE_WARN_DAYS } = await import('./open-evidence');
  const { OPEN_EVIDENCE_MAX_AGE_DAYS } = await import('../../lib/open-evidence');
  const now = Date.parse('2026-10-20T12:00:00Z');
  assert.equal(OPEN_EVIDENCE_WARN_DAYS < OPEN_EVIDENCE_MAX_AGE_DAYS, true);
  const healthy = summarizeOpenEvidenceAge(
    ['2026-10-13', '2026-10-13', null],
    now,
    OPEN_EVIDENCE_MAX_AGE_DAYS,
  );
  assert.equal(healthy.status, 'healthy');
  assert.equal(healthy.count, 2);
  const stale = summarizeOpenEvidenceAge(['2026-10-05'], now, OPEN_EVIDENCE_MAX_AGE_DAYS);
  assert.equal(stale.status, 'STALE EVIDENCE');
  assert.equal(stale.expiredOnDevices, 0);
  const expired = summarizeOpenEvidenceAge(['2026-09-28'], now, OPEN_EVIDENCE_MAX_AGE_DAYS);
  assert.equal(expired.expiredOnDevices, 1);
  assert.equal(
    summarizeOpenEvidenceAge([null], now, OPEN_EVIDENCE_MAX_AGE_DAYS).status,
    'no evidence',
  );
});
