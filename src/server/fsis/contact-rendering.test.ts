/**
 * FSIS contact-field rendering churn (2026-10-27).
 *
 * From 19:45 UTC the FSIS API alternated between two renderings of
 * `field_company_media_contact`: the historical one with standalone
 * "Company Contact" heading lines, and one without them and with re-flowed
 * whitespace. ~700 records hashed as changed on every fetch and were
 * re-archived and re-applied each run (687 changed cases per run, 13–15 min).
 *
 * The CAPTURED pairs below are verbatim `raw_payload` values from two
 * consecutive production snapshots of the same records (FSIS official data).
 * The pipeline tests derive the heading-free rendering of a recorded fixture
 * with the same template; those derivations are synthetic test inputs only.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { contentHash, runFsisIngest, runSourceIngest } from '../pipeline';
import { MemoryStore } from '../store/memory-store';
import { canonicalContactEntry, fsisPresentationKey } from './contact-rendering';
import { loadFixture } from './fixtures';
import { parseFsisRecord, type FsisRawRecord } from './parse';

const CAPTURED = [
  {
    heading: [
      '\n  Company Contact\n  \n    Shamrock Foods Company\n    Sandy Kelly, Vice President of Corporate Communications \n        (480) 564-6047 \n              Sandy_Kelly@ShamrockFoods.com\n      \n\n',
    ],
    plain: [
      '\n\n\n\n\n  \n  \n  \n  \n      \n\n\n\n\n          Shamrock Foods Company\n    \n\n\n\n\n\n          Sandy Kelly, Vice President of Corporate Communications \n    \n\n\n\n\n\n          (480) 564-6047 \n    \n\n\n\n\n\n          Sandy_Kelly@ShamrockFoods.com\n    \n\n  \n\n  \n  \n',
    ],
  },
  {
    // Two contact entries, each with the heading line twice.
    heading: [
      '\n  Company Contact\n  \n    Company Contact\n    Glen Balch\n        (479) 927-7105\n          \n\n',
      '\n  Company Contact\n  \n    Company Contact\n    Dirk Lemmons\n        (479) 927-7106\n          \n\n',
    ],
    plain: [
      '\n\n\n\n\n  \n  \n  \n  \n      \n\n\n\n\n          Glen Balch\n    \n\n\n\n\n\n          (479) 927-7105\n    \n\n  \n\n  \n  \n',
      '\n\n\n\n\n  \n  \n  \n  \n      \n\n\n\n\n          Dirk Lemmons\n    \n\n\n\n\n\n          (479) 927-7106\n    \n\n  \n\n  \n  \n',
    ],
  },
];

const FIXTURE = 'recall-active-nationwide-017-2026';
const NOW = () => new Date('2026-08-21T12:00:00Z');

/** The heading-free template observed in production, around the given lines. */
function plainEntry(lines: string[]): string {
  return (
    '\n\n\n\n\n  \n  \n  \n  \n      \n\n\n\n\n          ' +
    lines.join(' \n    \n\n\n\n\n\n          ') +
    '\n    \n\n  \n\n  \n  \n'
  );
}

/** The fixture's own contact lines, minus heading lines. */
function contactLines(record: FsisRawRecord): string[] {
  return record.field_company_media_contact[0]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && line !== 'Company Contact');
}

function headingRecord(): FsisRawRecord {
  return loadFixture(FIXTURE);
}

function plainRecord(patch: Partial<FsisRawRecord> = {}, lines?: string[]): FsisRawRecord {
  const base = loadFixture(FIXTURE);
  return {
    ...base,
    field_company_media_contact: [plainEntry(lines ?? contactLines(base))],
    ...patch,
  };
}

function input(records: FsisRawRecord[], fetchedAt: string) {
  return { records, fetchedAt, sourceUrl: 'https://www.fsis.usda.gov/fsis/api/recall/v/1' };
}

let tick = 0;
/** Strictly increasing fetch times, as consecutive production runs have. */
function nextFetch(): string {
  tick += 1;
  return new Date(Date.parse('2026-08-21T12:00:00Z') + tick * 60_000).toISOString();
}

async function seed(): Promise<MemoryStore> {
  const store = new MemoryStore();
  const first = await runFsisIngest(store, input([headingRecord()], nextFetch()), { now: NOW });
  assert.equal(first.newCases, 1);
  return store;
}

const materialUpdates = (store: MemoryStore) =>
  [...store.notifications.values()].filter((n) => n.kind === 'material_update');

test('the captured presentation variants are semantically equivalent', () => {
  for (const pair of CAPTURED) {
    assert.notEqual(contentHash(pair.heading), contentHash(pair.plain), 'raw bytes differ');
    const record = { field_title: 'x', field_company_media_contact: pair.heading };
    const other = { field_title: 'x', field_company_media_contact: pair.plain };
    assert.equal(contentHash(fsisPresentationKey(record)), contentHash(fsisPresentationKey(other)));
  }
  assert.equal(
    canonicalContactEntry(CAPTURED[0].heading[0]),
    'Shamrock Foods Company Sandy Kelly, Vice President of Corporate Communications (480) 564-6047 Sandy_Kelly@ShamrockFoods.com',
  );
});

test('only exact heading lines are dropped: other headings and inline text stay significant', () => {
  assert.equal(
    canonicalContactEntry('\n  Consumer Contact\n  Ann Lee\n'),
    'Consumer Contact Ann Lee',
  );
  assert.equal(
    canonicalContactEntry('Company Contact: Ann Lee'),
    'Company Contact: Ann Lee',
    'a heading sharing a line with content is content',
  );
  // Every field other than the contact field compares exactly.
  const a = { field_title: 'Beef  Jerky', field_company_media_contact: ['x'] };
  const b = { field_title: 'Beef Jerky', field_company_media_contact: ['x'] };
  assert.notEqual(contentHash(fsisPresentationKey(a)), contentHash(fsisPresentationKey(b)));
  // Entry count and order are significant.
  const one = { field_company_media_contact: ['Ann Lee', 'Bo Chu'] };
  const swapped = { field_company_media_contact: ['Bo Chu', 'Ann Lee'] };
  assert.notEqual(contentHash(fsisPresentationKey(one)), contentHash(fsisPresentationKey(swapped)));
});

test('alternating renderings never re-archive, re-apply, or notify', async () => {
  const store = await seed();
  const recordId = [...store.sourceRecords.keys()][0];
  const caseBefore = structuredClone([...store.cases.values()][0]);
  const normalizedBefore = structuredClone(store.sourceRecords.get(recordId)!.normalized);
  const eventsBefore = store.notifications.size;

  for (const raw of [plainRecord(), headingRecord(), plainRecord(), headingRecord()]) {
    const summary = await runFsisIngest(store, input([raw], nextFetch()), { now: NOW });
    assert.equal(summary.changedCases, 0);
    assert.equal(summary.newCases, 0);
    assert.equal(summary.staleSkipped, 0);
    assert.equal(summary.unchanged, 1);
  }

  assert.equal(store.snapshots.length, 1, 'the original raw payload remains the only snapshot');
  assert.equal(store.notifications.size, eventsBefore);
  const caseAfter = [...store.cases.values()][0];
  assert.equal(caseAfter.lastChangedAt, caseBefore.lastChangedAt);
  assert.deepEqual(caseAfter.timeline, caseBefore.timeline);
  assert.deepEqual(store.sourceRecords.get(recordId)!.normalized, normalizedBefore);
  assert.equal(store.sourceRecords.get(recordId)!.applyState, 'applied');
});

test('the presentation-only path is counted separately from byte-identical unchanged', async () => {
  const store = await seed();
  const plain = await runFsisIngest(store, input([plainRecord()], nextFetch()), { now: NOW });
  assert.equal(plain.presentationOnly, 1);
  const same = await runFsisIngest(store, input([headingRecord()], nextFetch()), { now: NOW });
  assert.equal(same.unchanged, 1);
  assert.equal(same.presentationOnly, 0, 'byte-identical takes the ordinary hash gate');
});

for (const [label, mutate] of [
  [
    'phone number',
    (lines: string[]) => lines.map((l) => l.replace('512-284-7790', '512-284-7791')),
  ],
  ['email', (lines: string[]) => lines.map((l) => l.replace('Gangothripickles@', 'recalls@'))],
  ['contact name', (lines: string[]) => lines.map((l) => l.replace('Jyothi', 'Jyoti'))],
  ['an added contact line', (lines: string[]) => [...lines, '(800) 555-0100']],
] as const) {
  test(`a real contact change in the new rendering is detected and persisted: ${label}`, async () => {
    const store = await seed();
    const base = loadFixture(FIXTURE);
    const changedLines = mutate(contactLines(base));
    const changed = plainRecord({}, changedLines);

    const summary = await runFsisIngest(store, input([changed], nextFetch()), { now: NOW });
    assert.equal(summary.changedCases, 1);
    assert.equal(summary.presentationOnly, 0);
    assert.equal(store.snapshots.length, 2, 'the new raw payload is archived as received');
    assert.deepEqual(store.snapshots[1].rawPayload, changed);
    const record = [...store.sourceRecords.values()][0];
    assert.equal(record.normalized.contactText, parseFsisRecord(changed).contactText);
    assert.equal(record.applyState, 'applied');

    // Contact details are not a material rule: auditable, never an alert.
    assert.equal(materialUpdates(store).length, 0);

    // The changed version then gates like any other: re-rendering it with the
    // heading lines is presentation-only, and replaying it is a no-op.
    const reheaded = {
      ...changed,
      field_company_media_contact: [
        `\n  Company Contact\n  \n    ${changedLines.join('\n    ')}\n      \n\n`,
      ],
    };
    for (const raw of [reheaded, changed]) {
      const replay = await runFsisIngest(store, input([raw], nextFetch()), { now: NOW });
      assert.equal(replay.changedCases, 0);
    }
    assert.equal(store.snapshots.length, 2);
  });
}

test('a substantive recall change arriving with the new rendering is still detected and notified', async () => {
  const store = await seed();
  const eventsBefore = store.notifications.size;
  // Class I → Class II is material (pipeline.test.ts) — combined here with the
  // contact re-rendering, which must not mask it.
  const downgraded = plainRecord({ field_recall_classification: 'Class II' });

  const summary = await runFsisIngest(store, input([downgraded], nextFetch()), { now: NOW });
  assert.equal(summary.changedCases, 1);
  assert.equal(summary.presentationOnly, 0);
  assert.equal(store.snapshots.length, 2);
  const updates = materialUpdates(store);
  assert.equal(updates.length, 1);
  assert.equal(store.notifications.size, eventsBefore + 1);

  // Dedup holds: the same downgrade in either rendering adds no event.
  for (const raw of [downgraded, { ...headingRecord(), field_recall_classification: 'Class II' }]) {
    const replay = await runFsisIngest(store, input([raw], nextFetch()), { now: NOW });
    assert.equal(replay.changedCases, 0);
  }
  assert.equal(store.notifications.size, eventsBefore + 1);
});

test('a non-material field change with the new rendering is archived and applied', async () => {
  const store = await seed();
  const summary = await runFsisIngest(
    store,
    input([plainRecord({ field_qty_recovered: '1,626 lbs' })], nextFetch()),
    { now: NOW },
  );
  assert.equal(summary.changedCases, 1);
  assert.equal(store.snapshots.length, 2);
  assert.equal(materialUpdates(store).length, 0);
});

test('a source that declares no presentation key keeps exact raw comparison', async () => {
  const store = new MemoryStore();
  const run = (raw: FsisRawRecord) =>
    runSourceIngest(
      store,
      {
        sourceSystem: 'fsis_api',
        items: [{ raw, normalized: parseFsisRecord(raw) }],
        quarantined: [],
        itemsSeen: 1,
        fetchedAt: nextFetch(),
      },
      { now: NOW },
    );
  await run(headingRecord());
  const summary = await run(plainRecord());
  assert.equal(summary.changedCases, 1);
  assert.equal(summary.presentationOnly, 0);
  assert.equal(store.snapshots.length, 2);
});
