import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sha256, type RenderedLabelPdf } from './labels';
import {
  failureBackoffMs,
  syncFsisLabels,
  type LabelCandidate,
  type LabelFailureState,
  type LabelStoreTarget,
  type LabelSyncStore,
} from './label-sync';

/** In-memory LabelSyncStore mirroring the Supabase implementation's semantics. */
class FakeLabelStore implements LabelSyncStore {
  candidates: LabelCandidate[] = [];
  visuals = new Map<string, Set<string>>();
  failures = new Map<string, LabelFailureState>();
  storeCalls: LabelStoreTarget[] = [];

  async listCandidates(publishedSince: string | null): Promise<LabelCandidate[]> {
    return this.candidates.filter(
      (candidate) => publishedSince === null || candidate.publishedAt >= publishedSince,
    );
  }
  async visualShasByUrl(urls: string[]): Promise<Map<string, Set<string>>> {
    return new Map([...this.visuals].filter(([url]) => urls.includes(url)));
  }
  async listFailures(): Promise<LabelFailureState[]> {
    return [...this.failures.values()];
  }
  async recordFailure(state: LabelFailureState): Promise<void> {
    this.failures.set(state.sourceUrl, state);
  }
  async clearFailure(sourceUrl: string): Promise<void> {
    this.failures.delete(sourceUrl);
  }
  async storePages(target: LabelStoreTarget, pages: RenderedLabelPdf['pages']): Promise<number> {
    this.storeCalls.push(target);
    if (!this.visuals.has(target.pdfUrl)) this.visuals.set(target.pdfUrl, new Set());
    this.visuals.get(target.pdfUrl)!.add(target.pdfSha);
    return pages.length;
  }
}

const NOW = () => new Date('2026-08-26T12:00:00Z');
const PDF_BYTES = new TextEncoder().encode('%PDF-fake-label-bytes');
const PDF_SHA = sha256(PDF_BYTES);

function candidate(url: string, publishedAt = '2026-08-20'): LabelCandidate {
  return {
    sourceRecordId: `record-${url}`,
    recallCaseId: `case-${url}`,
    nativeId: `017-2026`,
    pdfUrl: url,
    publishedAt,
  };
}

const fakeRender = async (): Promise<RenderedLabelPdf> => ({
  numPages: 2,
  pages: [
    { page: 1, bytes: Buffer.from('page1'), width: 1024, height: 768, contentHash: 'h1' },
    { page: 2, bytes: Buffer.from('page2'), width: 1024, height: 768, contentHash: 'h2' },
  ],
});

function sync(store: FakeLabelStore, overrides: Record<string, unknown> = {}) {
  return syncFsisLabels(store, {
    mode: 'recent',
    now: NOW,
    fetchDelayMs: 0,
    fetchPdf: async () => PDF_BYTES,
    render: fakeRender,
    ...overrides,
  });
}

test('a new label PDF is fetched, rendered, and stored; rendered PDFs are never re-fetched', async () => {
  const store = new FakeLabelStore();
  store.candidates = [candidate('https://fsis.example/new-label.pdf')];
  const fetched: string[] = [];

  const first = await sync(store, {
    fetchPdf: async (url: string) => {
      fetched.push(url);
      return PDF_BYTES;
    },
  });
  assert.equal(first.rendered, 1);
  assert.equal(first.pagesStored, 2);
  assert.deepEqual(fetched, ['https://fsis.example/new-label.pdf']);
  assert.equal(store.visuals.get('https://fsis.example/new-label.pdf')!.has(PDF_SHA), true);

  // Idempotent re-run: visuals exist → not in the worklist, zero fetches.
  const second = await sync(store, {
    fetchPdf: async (url: string) => {
      fetched.push(url);
      return PDF_BYTES;
    },
  });
  assert.equal(second.missing, 0);
  assert.equal(second.attempted, 0);
  assert.equal(fetched.length, 1);
  assert.equal(store.storeCalls.length, 1);
});

test('a failed PDF is recorded, deferred by backoff, retried later, and cleared on success', async () => {
  const store = new FakeLabelStore();
  store.candidates = [candidate('https://fsis.example/broken.pdf')];

  const failing = await sync(store, {
    fetchPdf: async () => {
      throw new Error('HTTP 404');
    },
  });
  assert.equal(failing.failures, 1);
  assert.equal(store.failures.get('https://fsis.example/broken.pdf')!.attempts, 1);

  // Immediately after: inside the 6h backoff window → deferred, not fetched.
  const deferred = await sync(store);
  assert.equal(deferred.deferredByBackoff, 1);
  assert.equal(deferred.attempted, 0);

  // 7 hours later the retry window is open; success clears the failure row.
  const later = () => new Date('2026-08-26T19:30:00Z');
  const retried = await sync(store, { now: later });
  assert.equal(retried.rendered, 1);
  assert.equal(store.failures.size, 0);
});

test('backoff doubles per attempt and caps at 7 days (never parked forever)', () => {
  assert.equal(failureBackoffMs(1), 6 * 3600 * 1000);
  assert.equal(failureBackoffMs(2), 12 * 3600 * 1000);
  assert.equal(failureBackoffMs(10), 7 * 24 * 3600 * 1000);
});

test('recent mode bounds discovery to the window; full mode sweeps everything missing', async () => {
  const store = new FakeLabelStore();
  store.candidates = [
    candidate('https://fsis.example/new.pdf', '2026-08-20'),
    candidate('https://fsis.example/ancient.pdf', '2014-01-01'),
  ];
  const recent = await sync(store, { dryRun: true });
  assert.equal(recent.candidateUrls, 1);

  const full = await sync(store, { mode: 'full', dryRun: true });
  assert.equal(full.candidateUrls, 2);
  assert.equal(full.missing, 2);
});

test('full-mode re-verification: unchanged bytes store nothing, changed bytes replace', async () => {
  const store = new FakeLabelStore();
  store.candidates = [candidate('https://fsis.example/label.pdf', '2026-08-20')];
  store.visuals.set('https://fsis.example/label.pdf', new Set([PDF_SHA]));

  // Same bytes on the wire → recognized by sha, nothing rendered or written.
  const unchanged = await sync(store, { mode: 'full' });
  assert.equal(unchanged.reverify, 1);
  assert.equal(unchanged.unchanged, 1);
  assert.equal(store.storeCalls.length, 0);

  // Revised bytes → re-rendered under the new content address.
  const changed = await sync(store, {
    mode: 'full',
    fetchPdf: async () => new TextEncoder().encode('%PDF-revised-bytes'),
  });
  assert.equal(changed.rendered, 1);
  assert.equal(store.storeCalls.length, 1);

  // An OLD rendered PDF (outside the window) is not re-verified at all.
  const old = new FakeLabelStore();
  old.candidates = [candidate('https://fsis.example/old.pdf', '2020-01-01')];
  old.visuals.set('https://fsis.example/old.pdf', new Set(['somesha']));
  const swept = await sync(old, { mode: 'full' });
  assert.equal(swept.reverify, 0);
  assert.equal(swept.attempted, 0);
});

test('a sync run reports label metrics only — no hero bookkeeping exists to report', async () => {
  const store = new FakeLabelStore();
  store.candidates = [candidate('https://fsis.example/one.pdf')];
  const metrics = await sync(store);
  assert.equal(metrics.rendered, 1);
  // C9 frozen policy: the sync stores detail evidence; card heroes are not
  // its business. A heroesSet-style metric reappearing means a promotion
  // path was reintroduced.
  assert.ok(!('heroesSet' in metrics), 'no hero metric may exist on a label sync');
});

test('the per-run cap defers overflow with an explicit count, and dry runs fetch nothing', async () => {
  const store = new FakeLabelStore();
  store.candidates = [
    candidate('https://fsis.example/a.pdf'),
    candidate('https://fsis.example/b.pdf'),
    candidate('https://fsis.example/c.pdf'),
  ];
  const capped = await sync(store, { maxPdfs: 1 });
  assert.equal(capped.capped, 2);
  assert.equal(capped.attempted, 1);

  const fetched: string[] = [];
  const dry = await sync(store, {
    dryRun: true,
    fetchPdf: async (url: string) => {
      fetched.push(url);
      return PDF_BYTES;
    },
  });
  assert.equal(fetched.length, 0);
  assert.equal(dry.missing, 2);
});
