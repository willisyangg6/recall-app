/**
 * The historical label backfill's PLANNING and AUTHORIZATION semantics
 * (P2B7T addendum), proved against fixtures — no agency request, no
 * production row, no credential.
 *
 * The question this file answers is the one the P2B7T report could not:
 * `--expect <n>` now names the number of PDFs this run would UPLOAD, and that
 * number is final before the first upload is reachable. Before the addendum it
 * named the number of PDFs the run would WALK, which is an authorization for
 * the wrong quantity — a corpus can be exactly the size you reviewed while the
 * set of documents needing work is completely different.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  executeLabelBackfill,
  planLabelBackfill,
  type LabelBackfillSource,
  type LabelPlanEntry,
} from './label-backfill';
import type { RenderedLabelPdf } from './labels';
import { resolveCountGate } from '../repair-authorization';

const source = (
  n: number,
  url = `https://www.fsis.usda.gov/label-${n}.pdf`,
): LabelBackfillSource => ({
  sourceRecordId: `rec-${n}`,
  recallCaseId: `case-${n}`,
  nativeId: `00${n}-2026`,
  pdfUrl: url,
});

const bytesFor = (text: string) => new TextEncoder().encode(text);
/** A stand-in for sha256: the test cares about identity, not the algorithm. */
const hash = (bytes: Uint8Array) => `sha-${new TextDecoder().decode(bytes)}`;

function page(n: number): RenderedLabelPdf['pages'][number] {
  return {
    page: n,
    width: 100,
    height: 100,
    bytes: bytesFor(`page-${n}`),
    contentHash: `page-hash-${n}`,
  } as RenderedLabelPdf['pages'][number];
}

/** A fake agency: every fetch is served from this map, and counted. */
function agency(contents: Record<string, string>) {
  const fetched: string[] = [];
  return {
    fetched,
    async fetchPdf(url: string) {
      fetched.push(url);
      const body = contents[url];
      return body === undefined ? { error: 'HTTP 404' as const } : { bytes: bytesFor(body) };
    },
  };
}

function store(existing: Record<string, string[]>) {
  const queried: string[][] = [];
  return {
    queried,
    async visualShasByUrl(urls: string[]) {
      queried.push(urls);
      const out = new Map<string, Set<string>>();
      for (const url of urls) {
        if (existing[url]) out.set(url, new Set(existing[url]));
      }
      return out;
    },
  };
}

// ── What --expect counts ─────────────────────────────────────────────────────

test('the planned count is UPLOADS, not the size of the corpus walked', async () => {
  // Four PDFs in the corpus; three are already rendered. The number an
  // operator authorizes must be 1, not 4.
  const sources = [source(1), source(2), source(3), source(4)];
  const shas = store({
    'https://www.fsis.usda.gov/label-1.pdf': ['sha-a'],
    'https://www.fsis.usda.gov/label-2.pdf': ['sha-b'],
    'https://www.fsis.usda.gov/label-3.pdf': ['sha-c'],
  });
  const fsis = agency({});

  const plan = await planLabelBackfill(sources, {
    ...shas,
    ...fsis,
    hash,
    verifyRevisions: false,
  });

  assert.equal(plan.distinctPdfs, 4, 'four PDFs are walked');
  assert.equal(plan.plannedUploads, 1, 'but only one would be written');
  assert.equal(plan.alreadyRendered, 3);
  assert.deepEqual(fsis.fetched, [], 'a fast plan makes NO agency request at all');
});

test('the same source record linked twice is one PDF, planned once', async () => {
  const url = 'https://www.fsis.usda.gov/label-1.pdf';
  const plan = await planLabelBackfill([source(1, url), source(2, url)], {
    ...store({}),
    ...agency({}),
    hash,
    verifyRevisions: false,
  });
  assert.equal(plan.linksExamined, 2);
  assert.equal(plan.distinctPdfs, 1);
  assert.equal(plan.plannedUploads, 1);
});

test('a corpus of exactly the reviewed SIZE can still hold a different plan', async () => {
  // This is the defect the addendum closes. Both corpora have four PDFs; the
  // old contract authorized "4" for either one. The upload plans differ.
  const sources = [source(1), source(2), source(3), source(4)];
  const settled = await planLabelBackfill(sources, {
    ...store({
      'https://www.fsis.usda.gov/label-1.pdf': ['sha-a'],
      'https://www.fsis.usda.gov/label-2.pdf': ['sha-b'],
      'https://www.fsis.usda.gov/label-3.pdf': ['sha-c'],
      'https://www.fsis.usda.gov/label-4.pdf': ['sha-d'],
    }),
    ...agency({}),
    hash,
    verifyRevisions: false,
  });
  const fresh = await planLabelBackfill(sources, {
    ...store({}),
    ...agency({}),
    hash,
    verifyRevisions: false,
  });

  assert.equal(settled.distinctPdfs, fresh.distinctPdfs, 'identical corpus size');
  assert.equal(settled.plannedUploads, 0);
  assert.equal(fresh.plannedUploads, 4);
  // An --expect reviewed against one is refused against the other.
  assert.ok(resolveCountGate({ apply: true, expectedUpdates: 0 }, fresh.plannedUploads));
  assert.equal(resolveCountGate({ apply: true, expectedUpdates: 4 }, fresh.plannedUploads), null);
});

// ── When PDFs are fetched ────────────────────────────────────────────────────

test('an unrendered PDF is planned as an upload without being fetched', async () => {
  const fsis = agency({ 'https://www.fsis.usda.gov/label-1.pdf': 'v1' });
  const plan = await planLabelBackfill([source(1)], {
    ...store({}),
    ...fsis,
    hash,
    verifyRevisions: true, // even when verifying: there is nothing to compare against
  });
  assert.equal(plan.plannedUploads, 1);
  assert.equal(plan.entries[0].pdfSha, null);
  assert.deepEqual(fsis.fetched, [], 'the database already answered this one');
});

test('the revision audit fetches ONLY the already-rendered URLs', async () => {
  const fsis = agency({
    'https://www.fsis.usda.gov/label-1.pdf': 'v1',
    'https://www.fsis.usda.gov/label-2.pdf': 'v2',
  });
  const plan = await planLabelBackfill([source(1), source(2)], {
    ...store({ 'https://www.fsis.usda.gov/label-2.pdf': ['sha-v1-old'] }),
    ...fsis,
    hash,
    verifyRevisions: true,
  });
  assert.deepEqual(fsis.fetched, ['https://www.fsis.usda.gov/label-2.pdf']);
  assert.equal(plan.inspected, 1);
  // label-2's bytes are NOT the rendered revision, so it is a planned upload.
  assert.equal(plan.plannedUploads, 2);
  assert.equal(plan.entries.find((e) => e.nativeId === '002-2026')!.pdfSha, 'sha-v2');
});

test('an in-place revision is only discovered when the audit is asked for', async () => {
  const sources = [source(1)];
  const existing = { 'https://www.fsis.usda.gov/label-1.pdf': ['sha-old'] };
  const contents = { 'https://www.fsis.usda.gov/label-1.pdf': 'new' };

  const fast = await planLabelBackfill(sources, {
    ...store(existing),
    ...agency(contents),
    hash,
    verifyRevisions: false,
  });
  assert.equal(fast.plannedUploads, 0, 'the fast plan does not claim to have checked');
  assert.match(fast.entries[0].reason!, /not checked in this plan/);

  const deep = await planLabelBackfill(sources, {
    ...store(existing),
    ...agency(contents),
    hash,
    verifyRevisions: true,
  });
  assert.equal(deep.plannedUploads, 1);
  assert.match(deep.entries[0].reason!, /revised in place/);
});

test('a PDF that cannot be fetched during the audit is never planned as an upload', async () => {
  const plan = await planLabelBackfill([source(1)], {
    ...store({ 'https://www.fsis.usda.gov/label-1.pdf': ['sha-old'] }),
    ...agency({}), // 404
    hash,
    verifyRevisions: true,
  });
  assert.equal(plan.plannedUploads, 0);
  assert.equal(plan.entries[0].outcome, 'fetch-failed');
  assert.equal(plan.fetchFailures.length, 1);
});

// ── The plan is complete before the first upload ─────────────────────────────

test('planning finishes entirely before any upload can happen', async () => {
  // executeLabelBackfill cannot even be called without a finished plan: it
  // takes entries, and `plannedUploads` is computed when the plan is built.
  const order: string[] = [];
  const sources = [source(1), source(2)];
  const plan = await planLabelBackfill(sources, {
    async visualShasByUrl() {
      order.push('plan:read');
      return new Map<string, Set<string>>();
    },
    ...agency({}),
    hash,
    verifyRevisions: false,
    onProgress: () => order.push('plan:step'),
  });
  assert.equal(plan.plannedUploads, 2);

  await executeLabelBackfill(plan.entries, {
    async visualShasByUrl() {
      order.push('write:read');
      return new Map();
    },
    ...agency({
      'https://www.fsis.usda.gov/label-1.pdf': 'v1',
      'https://www.fsis.usda.gov/label-2.pdf': 'v2',
    }),
    hash,
    async render() {
      order.push('render');
      return { numPages: 1, pages: [page(1)] } as RenderedLabelPdf;
    },
    async storePages() {
      order.push('upload');
      return 1;
    },
  });

  // Every planning step precedes every render and upload.
  const firstWrite = order.findIndex((step) => step === 'render' || step === 'upload');
  const lastPlan = order.map((s) => s.startsWith('plan:')).lastIndexOf(true);
  assert.ok(lastPlan < firstWrite, `planning leaked past the first write: ${order.join(' ')}`);
});

test('a count mismatch causes ZERO uploads', async () => {
  const sources = [source(1), source(2), source(3)];
  const plan = await planLabelBackfill(sources, {
    ...store({}),
    ...agency({}),
    hash,
    verifyRevisions: false,
  });
  assert.equal(plan.plannedUploads, 3);

  // The operator authorized two. The CLI refuses and never calls execute —
  // the gate is the same shared one every mutation CLI uses.
  const aborted = resolveCountGate({ apply: true, expectedUpdates: 2 }, plan.plannedUploads);
  assert.ok(aborted);
  assert.equal(aborted!.expected, 2);
  assert.equal(aborted!.actual, 3);
});

// ── Uploads can never exceed the authorization ───────────────────────────────

test('a PDF revised between the plan and the write is skipped, not written', async () => {
  const url = 'https://www.fsis.usda.gov/label-1.pdf';
  const planned: LabelPlanEntry[] = [
    { ...source(1), pdfSha: 'sha-reviewed', outcome: 'upload', reason: null },
  ];
  const uploads: string[] = [];
  const report = await executeLabelBackfill(planned, {
    async visualShasByUrl() {
      return new Map();
    },
    ...agency({ [url]: 'something-else' }), // hashes to sha-something-else
    hash,
    async render() {
      return { numPages: 1, pages: [page(1)] } as RenderedLabelPdf;
    },
    async storePages(target) {
      uploads.push(target.pdfSha);
      return 1;
    },
  });
  assert.equal(report.uploaded, 0);
  assert.deepEqual(uploads, [], 'no revision nobody reviewed may be written');
  assert.equal(report.results[0].outcome, 'changed-since-plan');
});

test('a revision rendered by something else after the plan is skipped', async () => {
  const url = 'https://www.fsis.usda.gov/label-1.pdf';
  const planned: LabelPlanEntry[] = [
    { ...source(1), pdfSha: null, outcome: 'upload', reason: null },
  ];
  const report = await executeLabelBackfill(planned, {
    // The scheduled sync got there first between the plan and this write.
    async visualShasByUrl() {
      return new Map([[url, new Set(['sha-v1'])]]);
    },
    ...agency({ [url]: 'v1' }),
    hash,
    async render() {
      throw new Error('must not render an already-stored revision');
    },
    async storePages() {
      throw new Error('must not upload an already-stored revision');
    },
  });
  assert.equal(report.uploaded, 0);
  assert.equal(report.skipped, 1);
  assert.equal(report.results[0].outcome, 'already-rendered-since-plan');
});

test('uploads come in AT or UNDER the authorized count, never over', async () => {
  const urls = [1, 2, 3].map((n) => `https://www.fsis.usda.gov/label-${n}.pdf`);
  const planned: LabelPlanEntry[] = [1, 2, 3].map((n) => ({
    ...source(n),
    pdfSha: null,
    outcome: 'upload' as const,
    reason: null,
  }));
  const report = await executeLabelBackfill(planned, {
    async visualShasByUrl() {
      return new Map([[urls[1], new Set(['sha-v2'])]]); // #2 landed meanwhile
    },
    ...agency({ [urls[0]]: 'v1', [urls[1]]: 'v2' }), // #3 is a 404
    hash,
    async render() {
      return { numPages: 1, pages: [page(1)] } as RenderedLabelPdf;
    },
    async storePages() {
      return 1;
    },
  });
  assert.equal(report.uploaded, 1, 'one of three authorized uploads actually happened');
  assert.ok(report.uploaded <= planned.length);
  assert.equal(report.skipped, 1);
  assert.equal(report.failures, 1);
  // Every shortfall is named, never absorbed.
  assert.deepEqual(report.results.map((r) => r.outcome).sort(), [
    'already-rendered-since-plan',
    'fetch-failed',
    'uploaded',
  ]);
});

test('a plan with nothing to upload touches nothing at all', async () => {
  const report = await executeLabelBackfill(
    [{ ...source(1), pdfSha: null, outcome: 'already-rendered', reason: null }],
    {
      async visualShasByUrl() {
        throw new Error('must not even read: there is nothing authorized');
      },
      async fetchPdf() {
        throw new Error('must not fetch');
      },
      hash,
      async render() {
        throw new Error('must not render');
      },
      async storePages() {
        throw new Error('must not upload');
      },
    },
  );
  assert.equal(report.uploaded, 0);
  assert.deepEqual(report.results, []);
});

// ── The CLI wires the three phases in the only safe order ────────────────────

const CLI = readFileSync('scripts/render-fsis-labels.ts', 'utf8');

test('the CLI plans, THEN gates, THEN uploads — in that order', () => {
  const main = CLI.slice(CLI.indexOf('async function main('));
  const plan = main.indexOf('planLabelBackfill(');
  const gate = main.indexOf('resolveCountGate(');
  const execute = main.indexOf('executeLabelBackfill(');

  assert.ok(plan > 0, 'the CLI no longer builds a plan');
  assert.ok(gate > 0, 'the CLI no longer applies the count gate');
  assert.ok(execute > 0, 'the CLI no longer executes a plan');
  assert.ok(
    plan < gate,
    'the count gate runs before the plan is complete, so it would compare --expect ' +
      'against a number that is not yet the plan',
  );
  assert.ok(
    gate < execute,
    'an upload is reachable before the count gate. The whole point of the addendum ' +
      'is that a mismatch costs zero uploads.',
  );
  // And the refusal really exits rather than falling through to the upload.
  const refusal = main.indexOf('process.exit(1)', gate);
  assert.ok(refusal > gate && refusal < execute, 'the gate does not exit before uploading');
});

test('--limit bounds only the local render sample, never the plan', () => {
  // A plan bounded by --limit would report a count that does not describe the
  // apply, which is exactly the defect the addendum closes.
  assert.match(CLI, /const renderSample =/);
  assert.ok(
    !/planLabelBackfill\([^)]*limit/s.test(CLI),
    'the plan is bounded by --limit; it must always cover the whole corpus',
  );
  assert.match(CLI, /renderLocalSample\(plan, renderSample\)/);
});

test('the dry run and the apply are planned by the same call', () => {
  // One planLabelBackfill call site, so a dry run cannot report a plan the
  // apply would not execute.
  const calls = CLI.match(/planLabelBackfill\(/g) ?? [];
  assert.equal(calls.length, 1, `expected one plan call site, found ${calls.length}`);
});
