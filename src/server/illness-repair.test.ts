/**
 * Stale illness-flag correction (P2B7L): the safety invariants, proved against
 * the store port rather than the implementation.
 *
 * The correction is one Boolean, and almost everything here exists to prove
 * what it is NOT: not a material change, not a notification, not a timeline
 * entry, not a re-dating, and not a second reader of illness prose. The one
 * field it touches is also the one field `detectChanges` diffs, so "it cannot
 * reach material-change detection" is the property the whole design turns on.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { detectChanges } from '../domain/material-change';
import { deriveIllnessStatus, statusReportsIllness } from '../domain/illness-status';
import type { CaseProjection, TimelineEntry } from '../domain/recall-types';
import {
  auditReprojectionDrift,
  planIllnessFlag,
  repairIllnessFlags,
  resolveIllnessRepairMode,
} from './illness-repair';
import { MemoryStore } from './store/memory-store';
import type { RecallCaseRow } from './store/types';

/** Real FSIS shapes from the P2B7K live audit (docs/recall-illness-status.md §3). */
const DENIES_ILLNESS =
  'King Arthur Flour has not received any confirmed reports of illnesses related to this product.';
const REPORTS_COUNT =
  'There have been 8 illnesses reported in connection with the consumption of these products.';
const DENIES_ADVERSE_REACTIONS_ONLY =
  'There have been no confirmed reports of adverse reactions due to consumption of these products.';

const TIMELINE: TimelineEntry[] = [
  {
    occurredAt: '2026-01-05',
    kind: 'published',
    summary: 'Recall published by FSIS.',
    causedBySnapshotIds: [],
    material: false,
  },
];

function projection(overrides: Partial<CaseProjection> = {}): CaseProjection {
  return {
    sourceAgency: 'FSIS',
    noticeType: 'recall',
    state: 'active',
    closedYear: null,
    classification: {
      value: 'class_I',
      sourceText: 'High - Class I',
      officialClasses: ['class_I'],
    },
    title: 'Firm Recalls Product',
    summaryText: DENIES_ILLNESS,
    summaryHtml: null,
    reasonText: null,
    hazardCategory: 'allergen',
    pathogenOrAllergen: 'undeclared milk',
    recallingFirm: { displayName: 'A Firm', rawVariants: ['A Firm'] },
    brands: [],
    productDescription: null,
    retailerNames: ['Costco'],
    heroImageUrl: 'https://www.fda.gov/photo.jpg',
    geography: { scope: 'unknown', states: [], confidence: 'stated', sourceText: null },
    affectedProducts: [],
    quantityText: null,
    illnessStatement: null,
    // Stale: the pre-P2B7K regex found no standalone "no" in "has not
    // received", so a firm's explicit denial was stored as a report.
    reportsIllness: true,
    consumerAction: null,
    contactText: null,
    officialUrl: 'https://example.gov/001-2026',
    otherOfficialUrls: [],
    sourceIdentifiers: [{ system: 'fsis_api', id: '001-2026' }],
    publishedAt: '2026-01-05',
    lastPublicActivityAt: '2026-01-05',
    ...overrides,
  };
}

async function storeWith(...projections: CaseProjection[]): Promise<MemoryStore> {
  const store = new MemoryStore();
  for (const value of projections) {
    await store.insertCase({
      projection: value,
      timeline: TIMELINE,
      createdAt: '2026-01-05T00:00:00.000Z',
      lastChangedAt: '2026-01-06T00:00:00.000Z',
    });
  }
  return store;
}

/**
 * Source text with comments and string literals removed, so a structural
 * assertion reads the module's CODE and never its prose or its import paths.
 */
function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[^\n]*?\/\/[^\n]*$/gm, ' ')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

const rows = (store: MemoryStore): RecallCaseRow[] => [...store.cases.values()];
const only = (store: MemoryStore): RecallCaseRow => rows(store)[0];

/** The reviewed-count guard, spelled the way the CLI spells it. */
const apply = (expectedUpdates: number) => ({ apply: true, expectedUpdates });
const dryRun = { apply: false, expectedUpdates: null };

// ── Mode resolution: dry run is the default, apply is deliberate ────────────

test('with no flags the command is a dry run', () => {
  const mode = resolveIllnessRepairMode([]);
  assert.equal(mode.apply, false);
  assert.equal(mode.expectedUpdates, null);
  assert.equal(mode.error, null);
});

test('--apply alone is refused: it needs the second acknowledgment', () => {
  const mode = resolveIllnessRepairMode(['--apply']);
  assert.equal(mode.apply, false);
  assert.match(mode.error ?? '', /--confirm/);
  assert.match(mode.error ?? '', /Nothing was written/);
});

test('--apply --confirm without --expect is refused: no authorized count', () => {
  const mode = resolveIllnessRepairMode(['--apply', '--confirm']);
  assert.equal(mode.apply, false);
  assert.match(mode.error ?? '', /--expect/);
});

test('--apply --confirm --expect <n> is the only shape that authorizes a write', () => {
  const mode = resolveIllnessRepairMode(['--apply', '--confirm', '--expect', '58']);
  assert.equal(mode.apply, true);
  assert.equal(mode.expectedUpdates, 58);
  assert.equal(mode.error, null);
});

test('--apply and --dry-run contradict each other and are refused, not resolved', () => {
  const mode = resolveIllnessRepairMode(['--apply', '--confirm', '--expect', '58', '--dry-run']);
  assert.equal(mode.apply, false);
  assert.match(mode.error ?? '', /contradict/);
});

test('a malformed --expect is refused rather than coerced', () => {
  for (const argv of [
    ['--apply', '--confirm', '--expect'],
    ['--apply', '--confirm', '--expect', '--json'],
    ['--apply', '--confirm', '--expect', 'fifty-eight'],
    ['--apply', '--confirm', '--expect', '-3'],
    ['--apply', '--confirm', '--expect', '58.5'],
  ]) {
    const mode = resolveIllnessRepairMode(argv);
    assert.equal(mode.apply, false, argv.join(' '));
    assert.notEqual(mode.error, null, argv.join(' '));
  }
});

test('a dry run may carry --expect, which turns it into a gate', () => {
  const mode = resolveIllnessRepairMode(['--expect', '58']);
  assert.equal(mode.apply, false);
  assert.equal(mode.expectedUpdates, 58);
  assert.equal(mode.error, null);
});

// ── Planning: both directions, and what is refused ──────────────────────────

test('a stale true is planned down to false, with the denial as its evidence', async () => {
  const store = await storeWith(projection());
  const plan = planIllnessFlag(only(store));

  assert.equal(plan.outcome, 'update');
  assert.equal(plan.direction, 'true->false');
  assert.equal(plan.storedValue, true);
  assert.equal(plan.derivedValue, false);
  assert.equal(plan.statusKind, 'explicit_none');
  assert.deepEqual(plan.evidence, [DENIES_ILLNESS]);
});

test('a stale false is planned up to true, carrying the count the source stated', async () => {
  const store = await storeWith(projection({ summaryText: REPORTS_COUNT, reportsIllness: false }));
  const plan = planIllnessFlag(only(store));

  assert.equal(plan.outcome, 'update');
  assert.equal(plan.direction, 'false->true');
  assert.equal(plan.derivedValue, true);
  assert.equal(plan.statusKind, 'reported_count');
  assert.equal(plan.illnesses, 8);
});

test('an adverse-reaction denial is not an illness denial, and the stored true still falls', async () => {
  // The 150-case FSIS boilerplate: it denies adverse reactions and says
  // nothing about illnesses, so the classifier lands on `unknown` — and
  // `unknown` is not a report, so a stored `true` is still stale.
  const store = await storeWith(
    projection({ summaryText: DENIES_ADVERSE_REACTIONS_ONLY, reportsIllness: true }),
  );
  const plan = planIllnessFlag(only(store));

  assert.equal(plan.outcome, 'update');
  assert.equal(plan.direction, 'true->false');
  assert.equal(plan.statusKind, 'unknown');
  assert.deepEqual(plan.evidence, [], 'unknown establishes nothing, so it quotes nothing');
});

test('an already-correct flag is unchanged, in both directions', async () => {
  const store = await storeWith(
    projection({ reportsIllness: false }),
    projection({ summaryText: REPORTS_COUNT, reportsIllness: true }),
  );
  for (const row of rows(store)) assert.equal(planIllnessFlag(row).outcome, 'unchanged');
});

test('a case with no prose is refused, never flipped on silence', async () => {
  const store = await storeWith(
    projection({ summaryText: '', reportsIllness: true }),
    projection({ summaryText: '   \n  ', reportsIllness: true }),
  );
  for (const row of rows(store)) {
    const plan = planIllnessFlag(row);
    assert.equal(plan.outcome, 'no-evidence');
    assert.equal(plan.direction, null);
  }
});

test('a projection carrying no boolean flag is refused, not initialized', async () => {
  const without = projection() as Partial<CaseProjection>;
  delete without.reportsIllness;
  const store = await storeWith(without as CaseProjection);

  const plan = planIllnessFlag(only(store));
  assert.equal(plan.outcome, 'missing-flag');
  assert.equal(plan.storedValue, null);
});

test('refused cases are reported visibly, never silently skipped', async () => {
  const without = projection() as Partial<CaseProjection>;
  delete without.reportsIllness;
  const store = await storeWith(
    projection({ summaryText: '', reportsIllness: true }),
    without as CaseProjection,
  );

  const report = await repairIllnessFlags(store, dryRun);

  assert.equal(report.noEvidence, 1);
  assert.equal(report.missingFlag, 1);
  assert.equal(report.refused.length, 2, 'every refusal is carried in the report');
  assert.equal(report.wouldUpdate, 0);
});

// ── The classifier is shared, not re-implemented ────────────────────────────

test('the repair derives through the shared illness contract, not a second regex', () => {
  const source = readFileSync(join(import.meta.dirname, 'illness-repair.ts'), 'utf8');
  assert.match(source, /from '\.\.\/domain\/illness-status'/);
  assert.match(source, /statusReportsIllness\(deriveIllnessStatus\(/);

  // No illness-prose reader of its own. The defect P2B7K removed was four
  // rival classifiers disagreeing about the same sentences; a repair that
  // added a fifth — even one that happened to agree today — would put the
  // stored flag back out of the shared contract's reach.
  const code = stripCommentsAndStrings(source);
  assert.doesNotMatch(code, /new RegExp/, 'no constructed pattern');
  assert.doesNotMatch(
    code,
    /\/[^/\n]*(?:illness|sick|adverse|reported)[^/\n]*\/[gimsuy]*/i,
    'no regex literal reads illness prose',
  );
});

test('every planned value equals what projectCase would compute for the same prose', async () => {
  const store = await storeWith(
    projection(),
    projection({ summaryText: REPORTS_COUNT, reportsIllness: false }),
    projection({ summaryText: DENIES_ADVERSE_REACTIONS_ONLY, reportsIllness: true }),
  );
  const report = await repairIllnessFlags(store, dryRun);

  for (const plan of report.plans) {
    const row = rows(store).find((r) => r.id === plan.recallCaseId)!;
    assert.equal(
      plan.derivedValue,
      statusReportsIllness(deriveIllnessStatus(row.projection.summaryText)),
      'the repair and the projection must be structurally incapable of disagreeing',
    );
  }
});

// ── Dry run is the default, and it writes nothing ───────────────────────────

test('a dry run writes nothing but reports exactly what an apply would do', async () => {
  const store = await storeWith(
    projection(),
    projection({ summaryText: REPORTS_COUNT, reportsIllness: false }),
  );
  const before = structuredClone(rows(store));

  const report = await repairIllnessFlags(store, dryRun);

  assert.equal(report.wouldUpdate, 2);
  assert.equal(report.trueToFalse, 1);
  assert.equal(report.falseToTrue, 1);
  assert.equal(report.caseWrites, 0);
  assert.deepEqual(rows(store), before, 'the dry run must not mutate the store');
});

// ── The expected-count guard ────────────────────────────────────────────────

test('an apply whose count does not match the authorization writes nothing at all', async () => {
  const store = await storeWith(
    projection(),
    projection({ summaryText: REPORTS_COUNT, reportsIllness: false }),
  );
  const before = structuredClone(rows(store));

  const report = await repairIllnessFlags(store, apply(1));

  assert.notEqual(report.aborted, null);
  assert.equal(report.aborted?.expected, 1);
  assert.equal(report.aborted?.actual, 2);
  assert.equal(report.caseWrites, 0, 'not even the matching case is written');
  assert.deepEqual(rows(store), before, 'an aborted apply is byte-identical to no run at all');
});

test('apply mode without an authorized count is refused inside the repair too', async () => {
  const store = await storeWith(projection());
  const before = structuredClone(rows(store));

  const report = await repairIllnessFlags(store, { apply: true, expectedUpdates: null });

  assert.notEqual(report.aborted, null);
  assert.equal(report.caseWrites, 0);
  assert.deepEqual(rows(store), before);
});

test('a gated dry run reports the mismatch without ever intending a write', async () => {
  const store = await storeWith(projection());

  const report = await repairIllnessFlags(store, { apply: false, expectedUpdates: 99 });

  assert.notEqual(report.aborted, null);
  assert.equal(report.aborted?.actual, 1);
  assert.equal(report.caseWrites, 0);
});

// ── Apply: what changes, and everything that does not ───────────────────────

test('an apply writes the flag and nothing else', async () => {
  const store = await storeWith(projection());
  const before = structuredClone(only(store));

  const report = await repairIllnessFlags(store, apply(1));

  assert.equal(report.caseWrites, 1);
  const after = only(store);
  assert.equal(after.projection.reportsIllness, false);
  assert.deepEqual(
    { ...after.projection, reportsIllness: null },
    { ...before.projection, reportsIllness: null },
    'every sibling projection field is byte-identical',
  );
});

test('identity, lineage, dates and the timeline are untouched by a repair', async () => {
  const store = await storeWith(projection());
  const before = structuredClone(only(store));

  await repairIllnessFlags(store, apply(1));

  const after = only(store);
  assert.equal(after.id, before.id, 'case identity');
  assert.equal(after.projection.illnessStatement, before.projection.illnessStatement);
  assert.equal(after.projection.summaryText, before.projection.summaryText);
  assert.equal(after.projection.publishedAt, before.projection.publishedAt);
  assert.equal(after.projection.lastPublicActivityAt, before.projection.lastPublicActivityAt);
  assert.deepEqual(after.projection.classification, before.projection.classification);
  assert.equal(after.createdAt, before.createdAt);
  assert.equal(after.lastChangedAt, before.lastChangedAt, 'lastChangedAt must not move');
  assert.deepEqual(after.timeline, before.timeline, 'no timeline entry is appended');
});

test('a repair creates no RecallCase, no NotificationEvent and no timeline entry', async () => {
  const store = await storeWith(
    projection(),
    projection({ summaryText: REPORTS_COUNT, reportsIllness: false }),
  );

  const report = await repairIllnessFlags(store, apply(2));

  assert.equal(store.cases.size, 2, 'no case is created, merged, or split');
  assert.equal(store.notifications.size, 0, 'no notification event is ever written');
  for (const row of rows(store)) assert.deepEqual(row.timeline, TIMELINE);
  assert.equal(report.notificationEvents, 0);
  assert.equal(report.timelineEntries, 0);
  assert.equal(report.materialChanges, 0);
  assert.equal(report.newCases, 0);
  assert.equal(report.networkRequests, 0);
});

test('the false -> true correction the pipeline would announce is written silently', async () => {
  // The whole reason this repair exists. Through `detectChanges` the same
  // correction is a `health_impact` material change — a shopper-facing claim
  // that the notice NOW reports illnesses. Through this path it is a stored
  // Boolean catching up with a classifier, and no event exists to deliver.
  const stale = projection({ summaryText: REPORTS_COUNT, reportsIllness: false });
  const corrected = { ...stale, reportsIllness: true };

  const { material } = detectChanges(stale, corrected);
  assert.deepEqual(
    material.map((change) => change.ruleId),
    ['health_impact'],
    'the pipeline path really would raise it — this is not a hypothetical',
  );

  const store = await storeWith(stale);
  const report = await repairIllnessFlags(store, apply(1));

  assert.equal(report.caseWrites, 1);
  assert.equal(only(store).projection.reportsIllness, true);
  assert.equal(store.notifications.size, 0, 'and the repair path raises nothing');
});

test('the repair never calls material-change detection', () => {
  const code = stripCommentsAndStrings(
    readFileSync(join(import.meta.dirname, 'illness-repair.ts'), 'utf8'),
  );
  assert.doesNotMatch(code, /detectChanges/, 'material-change detection is never called');
  assert.doesNotMatch(
    readFileSync(join(import.meta.dirname, 'illness-repair.ts'), 'utf8'),
    /^import .*material-change/m,
    'the module does not even import it',
  );
  assert.doesNotMatch(code, /applyCaseTransition|reprojectCase|runIngest|insertNotification/);
});

// ── Idempotence and concurrency ─────────────────────────────────────────────

test('a second execution is a complete no-op', async () => {
  const store = await storeWith(
    projection(),
    projection({ summaryText: REPORTS_COUNT, reportsIllness: false }),
  );

  const first = await repairIllnessFlags(store, apply(2));
  assert.equal(first.caseWrites, 2);
  const afterFirst = structuredClone(rows(store));

  const second = await repairIllnessFlags(store, { apply: true, expectedUpdates: 0 });
  assert.equal(second.wouldUpdate, 0, 'nothing is left to correct');
  assert.equal(second.caseWrites, 0);
  assert.equal(second.aborted, null);
  assert.deepEqual(rows(store), afterFirst, 'the corpus is byte-identical after a rerun');

  // And the dry run doubles as the verification report.
  const verify = await repairIllnessFlags(store, dryRun);
  assert.equal(verify.wouldUpdate, 0);
});

test('a case ingestion moved mid-run is reported, never overwritten', async () => {
  const store = await storeWith(projection());
  const row = only(store);

  // Scheduled ingestion lands between the plan and the write.
  const moved = { ...row, lastChangedAt: '2026-02-01T00:00:00.000Z' };
  const original = store.updateCaseReportsIllness.bind(store);
  let planned = false;
  store.updateCaseReportsIllness = async (id, value, expected) => {
    if (!planned) {
      planned = true;
      store.cases.set(row.id, moved);
    }
    return original(id, value, expected);
  };

  const report = await repairIllnessFlags(store, apply(1));

  assert.equal(report.caseWrites, 0);
  assert.deepEqual(report.concurrentlyModified, [row.id]);
  assert.equal(only(store).projection.reportsIllness, true, 'the newer row stands, unrolled back');
});

// ── Verification and rollback ───────────────────────────────────────────────

test('every write is verified from live state after it lands', async () => {
  const store = await storeWith(
    projection(),
    projection({ summaryText: REPORTS_COUNT, reportsIllness: false }),
  );

  const report = await repairIllnessFlags(store, apply(2));

  assert.equal(report.caseWrites, 2);
  assert.equal(report.verifiedWrites, 2);
  assert.deepEqual(report.verificationFailures, []);
});

test('the rollback data alone restores the exact previous corpus', async () => {
  const store = await storeWith(
    projection(),
    projection({ summaryText: REPORTS_COUNT, reportsIllness: false }),
    projection({ reportsIllness: false }), // already correct, never written
  );
  const before = structuredClone(rows(store));

  const report = await repairIllnessFlags(store, apply(2));
  assert.equal(report.rollback.length, 2);
  assert.notDeepEqual(rows(store), before);

  // Replay the ledger backwards through the same narrow port.
  for (const entry of report.rollback) {
    const current = store.cases.get(entry.recallCaseId)!;
    assert.equal(current.projection.reportsIllness, entry.writtenValue);
    const restored = await store.updateCaseReportsIllness(
      entry.recallCaseId,
      entry.previousValue,
      current.lastChangedAt,
    );
    assert.equal(restored, true);
  }

  assert.deepEqual(rows(store), before, 'the corpus is byte-identical to before the apply');
});

// ── The re-projection drift audit (read-only) ───────────────────────────────

test('the drift audit reads and reports; it writes nothing', async () => {
  const store = await storeWith(projection());
  const before = structuredClone(rows(store));

  const drift = await auditReprojectionDrift(store, [only(store).id]);

  assert.equal(drift.length, 1);
  // No source records are linked in this fixture, so the honest answer is
  // "unavailable" — never a fabricated "nothing else would change".
  assert.equal(drift[0].unavailable, 'no linked source records');
  assert.deepEqual(rows(store), before);
});

test('the drift audit reports a missing case rather than throwing', async () => {
  const store = await storeWith(projection());
  const drift = await auditReprojectionDrift(store, ['00000000-0000-0000-0000-000000000000']);
  assert.equal(drift[0].unavailable, 'case not found');
});

// ── The disease-name corpus, through the repair port (P2B7L.1) ─────────────

interface DiseaseCorpusCase {
  recallCaseId: string;
  title: string;
  storedReportsIllness: boolean;
  kind: string;
  illnesses: number | null;
  reportsIllness: boolean;
  summaryText: string;
}

const DISEASE_CORPUS: { count: number; cases: DiseaseCorpusCase[] } = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '..', 'domain', 'fixtures', 'illness-disease-corpus.json'),
    'utf8',
  ),
);

const diseaseLabel = (c: DiseaseCorpusCase) =>
  `${c.recallCaseId.slice(0, 8)} ${c.title.slice(0, 56)}`;

test('PARITY: the repair plans exactly what the shared contract derives, case by case', async () => {
  // The repair must never become a second reader of illness prose. Every case
  // in the live disease-name population is planned here through the real port
  // and checked against the contract Recall Detail renders from.
  assert.equal(DISEASE_CORPUS.cases.length, DISEASE_CORPUS.count);
  for (const c of DISEASE_CORPUS.cases) {
    const store = await storeWith(
      projection({ summaryText: c.summaryText, reportsIllness: c.storedReportsIllness }),
    );
    const plan = planIllnessFlag(only(store));
    const status = deriveIllnessStatus(c.summaryText);

    assert.equal(plan.statusKind, status.kind, `${diseaseLabel(c)} kind`);
    assert.equal(plan.statusKind, c.kind, `${diseaseLabel(c)} kind matches the record`);
    assert.equal(plan.illnesses, c.illnesses, `${diseaseLabel(c)} count`);
    assert.equal(plan.derivedValue, statusReportsIllness(status), `${diseaseLabel(c)} flag`);
    assert.equal(plan.derivedValue, c.reportsIllness, `${diseaseLabel(c)} flag matches the record`);
    assert.equal(plan.storedValue, c.storedReportsIllness, `${diseaseLabel(c)} stored`);
    // Never refused: every case in this population has prose and a boolean.
    assert.ok(
      ['update', 'unchanged'].includes(plan.outcome),
      `${diseaseLabel(c)} is decided, not refused (${plan.outcome})`,
    );
    assert.equal(
      plan.outcome,
      c.storedReportsIllness === c.reportsIllness ? 'unchanged' : 'update',
      `${diseaseLabel(c)} outcome`,
    );
  }
});

test('PUSH ELIGIBILITY: health_impact fires on exactly the corrected flag, never on the prose', async () => {
  // `health_impact` is the notification the flag will eventually drive. It
  // must key off the corrected value and nothing else — a notice naming a
  // disease, or a supplier's outbreak, may not raise one by itself.
  for (const c of DISEASE_CORPUS.cases) {
    const derived = statusReportsIllness(deriveIllnessStatus(c.summaryText));
    const before = projection({ summaryText: c.summaryText, reportsIllness: false });
    const after = projection({ summaryText: c.summaryText, reportsIllness: derived });

    const raised = detectChanges(before, after).material.some((m) => m.ruleId === 'health_impact');
    assert.equal(raised, derived, `${diseaseLabel(c)} raises health_impact iff it reports`);

    // And a case already carrying the corrected value raises nothing at all.
    assert.equal(
      detectChanges(after, after).material.some((m) => m.ruleId === 'health_impact'),
      false,
      `${diseaseLabel(c)} is quiet once correct`,
    );
  }
});
