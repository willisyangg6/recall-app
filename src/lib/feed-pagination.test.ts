/**
 * Complete-feed loading (C5.1).
 *
 * The bug this guards against is invisible by construction: a truncated feed
 * looks exactly like a complete one — same shape, same card design, plausible
 * counts — so every test here asserts against a corpus whose true size is
 * known, never against "it returned something".
 *
 * The fixtures deliberately exceed both real ceilings: the app's old 500-row
 * request limit and the measured 1000-row PostgREST `max_rows` cap.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildAffectsMeSections } from './affects-me-ranking';
import { loadAllPages, FEED_PAGE_SIZE } from './feed-pagination';
import { buildFeedSections } from './feed-relevance';
import type { FeedItem } from './recall-feed';
import { evaluatePersonalRelevance } from './relevance';
import type { UserRecallPreferences } from '@/domain/preferences';

const NOW = new Date('2026-08-27T12:00:00Z');

/** Ids are zero-padded so lexicographic id order is also numeric order. */
function id(n: number): string {
  return `case-${String(n).padStart(5, '0')}`;
}

function item(n: number, overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: id(n),
    sourceAgency: 'FSIS',
    noticeType: 'recall',
    state: 'active',
    title: `Test ${n}`,
    classification: { value: 'class_II', sourceText: 'Class II', officialClasses: ['class_II'] },
    hazardCategory: 'unknown',
    publishedAt: '2026-08-17',
    lastPublicActivityAt: '2026-08-17',
    reasonText: null,
    pathogenOrAllergen: null,
    firmName: null,
    brands: [],
    productDescription: null,
    retailerNames: [],
    heroImageUrl: null,
    geography: { scope: 'unknown', states: [], confidence: 'stated', sourceText: null },
    officialUrl: 'https://example.gov',
    timeline: [],
    ...overrides,
  };
}

/**
 * A fake backend that answers the same keyset question the real one does:
 * active rows ordered by id, strictly after the cursor. Building the corpus
 * once and letting the loader page over it is what makes "no missing ids"
 * meaningful — the test never tells the loader how many rows to expect.
 */
function backend(corpus: FeedItem[], options: { failOnPage?: number[] } = {}) {
  const sorted = [...corpus].sort((a, b) => a.id.localeCompare(b.id));
  const calls: (string | null)[] = [];
  let page = 0;
  return {
    calls,
    get pageCount() {
      return page;
    },
    fetchPage: async (cursor: string | null, pageSize: number): Promise<FeedItem[]> => {
      calls.push(cursor);
      const thisPage = page++;
      if (options.failOnPage?.includes(thisPage)) {
        throw new Error(`network failure on page ${thisPage}`);
      }
      const start = cursor ? sorted.findIndex((r) => r.id > cursor) : 0;
      if (start === -1) return [];
      return sorted.slice(start, start + pageSize);
    },
  };
}

const noDelay = async () => {};

// ── 1–2. Corpora larger than both real ceilings ──────────────────────────────

test('loads every active row when the corpus exceeds the old 500-row request limit', async () => {
  const corpus = Array.from({ length: 882 }, (_, i) => item(i));
  const loaded = await loadAllPages(backend(corpus).fetchPage, { delay: noDelay });

  assert.equal(loaded.length, 882, 'every active case must reach the client');
  assert.deepEqual(loaded.map((r) => r.id).sort(), corpus.map((r) => r.id).sort());
});

test('loads every active row when the corpus exceeds the 1000-row server cap', async () => {
  // The measured PostgREST ceiling: `limit=5000` returns exactly 1000 rows and
  // says nothing about the truncation. Only paging survives this.
  const corpus = Array.from({ length: 2417 }, (_, i) => item(i));
  const fake = backend(corpus);
  const loaded = await loadAllPages(fake.fetchPage, { delay: noDelay });

  assert.equal(loaded.length, 2417);
  assert.ok(fake.pageCount > 1, 'must have paged rather than issued one capped request');
  assert.equal(new Set(loaded.map((r) => r.id)).size, 2417);
});

// ── 3. Final partial page ────────────────────────────────────────────────────

test('a short final page ends the scan; an exact multiple costs one empty page', async () => {
  const partial = backend(Array.from({ length: 1250 }, (_, i) => item(i)));
  assert.equal(
    (await loadAllPages(partial.fetchPage, { pageSize: 500, delay: noDelay })).length,
    1250,
  );
  assert.equal(partial.pageCount, 3, '500 + 500 + 250 — the short page stops it');

  const exact = backend(Array.from({ length: 1000 }, (_, i) => item(i)));
  assert.equal(
    (await loadAllPages(exact.fetchPage, { pageSize: 500, delay: noDelay })).length,
    1000,
  );
  assert.equal(exact.pageCount, 3, 'a full last page cannot be assumed final');
});

test('an empty corpus loads cleanly as an empty feed', async () => {
  const fake = backend([]);
  const loaded = await loadAllPages(fake.fetchPage, { delay: noDelay });
  assert.deepEqual(loaded, []);
  assert.equal(fake.pageCount, 1);
});

// ── 4–5. Identical sort dates and stable tie-breaking ────────────────────────

test('rows sharing identical activity and publication dates are all loaded exactly once', async () => {
  // Live: 230 of 882 active cases share their (activity, published) pair with
  // another case; the largest group is 5. Paging on those dates would be
  // ambiguous, so the cursor is the immutable id instead.
  const corpus = Array.from({ length: 1200 }, (_, i) =>
    item(i, { publishedAt: '2026-08-17', lastPublicActivityAt: '2026-08-17' }),
  );
  const loaded = await loadAllPages(backend(corpus).fetchPage, { delay: noDelay });

  assert.equal(loaded.length, 1200);
  assert.equal(new Set(loaded.map((r) => r.id)).size, 1200, 'no id lost to a tie');
});

test('All Recalls order is total and stable when every date is identical', async () => {
  const corpus = Array.from({ length: 600 }, (_, i) =>
    item(i, { publishedAt: '2026-08-17', lastPublicActivityAt: '2026-08-17' }),
  );
  const first = buildFeedSections(
    await loadAllPages(backend(corpus).fetchPage, { delay: noDelay }),
    NOW,
  );
  // Same rows, arbitrary arrival order — the rendered order must not move.
  const shuffled = [...corpus].reverse();
  const second = buildFeedSections(
    await loadAllPages(backend(shuffled).fetchPage, { delay: noDelay }),
    NOW,
  );

  assert.deepEqual(
    first.recent.map((r) => r.id),
    second.recent.map((r) => r.id),
  );
  assert.deepEqual(
    first.recent.map((r) => r.id),
    [...first.recent.map((r) => r.id)].sort(),
    'ties fall back to ascending id',
  );
});

test('All Recalls recent order is newest public activity first, unchanged', async () => {
  const corpus = [
    item(1, { publishedAt: '2026-08-01', lastPublicActivityAt: '2026-08-02' }),
    item(2, { publishedAt: '2026-08-20', lastPublicActivityAt: '2026-08-20' }),
    item(3, { publishedAt: '2026-07-01', lastPublicActivityAt: '2026-08-11' }),
  ];
  const { recent } = buildFeedSections(
    await loadAllPages(backend(corpus).fetchPage, { delay: noDelay }),
    NOW,
  );
  assert.deepEqual(
    recent.map((r) => r.id),
    [id(2), id(3), id(1)],
  );
});

// ── 6–7. No missing, no duplicate ids ────────────────────────────────────────

test('an overlapping or repeated page cannot duplicate a case', async () => {
  const corpus = Array.from({ length: 700 }, (_, i) => item(i));
  const sorted = [...corpus].sort((a, b) => a.id.localeCompare(b.id));
  let page = 0;
  // A server that re-serves rows already delivered — dedup by stable case id
  // is what keeps counts honest.
  const overlapping = async (cursor: string | null, pageSize: number): Promise<FeedItem[]> => {
    page += 1;
    const start = cursor ? Math.max(0, sorted.findIndex((r) => r.id > cursor) - 50) : 0;
    return sorted.slice(start, start + pageSize);
  };

  const loaded = await loadAllPages(overlapping, { pageSize: 300, delay: noDelay });
  assert.equal(new Set(loaded.map((r) => r.id)).size, loaded.length, 'no duplicate ids');
  assert.equal(loaded.length, 700, 'and nothing lost');
  assert.ok(page > 2);
});

test('a stalled cursor throws instead of looping or truncating', async () => {
  const corpus = Array.from({ length: 100 }, (_, i) => item(i));
  const sorted = [...corpus].sort((a, b) => a.id.localeCompare(b.id));
  // A server ignoring the cursor: same page forever.
  const stalled = async (_cursor: string | null, pageSize: number) => sorted.slice(0, pageSize);

  await assert.rejects(
    () => loadAllPages(stalled, { pageSize: 10, delay: noDelay }),
    /stalled|did not advance/i,
  );
});

test('the runaway guard throws rather than returning a truncated feed', async () => {
  const corpus = Array.from({ length: 5000 }, (_, i) => item(i));
  await assert.rejects(
    () => loadAllPages(backend(corpus).fetchPage, { pageSize: 100, maxPages: 5, delay: noDelay }),
    /partial feed/i,
  );
});

// ── 9–11. Partial failure is never presented as complete ─────────────────────

test('a failure on a later page rejects — it never returns page 1 as the whole feed', async () => {
  const corpus = Array.from({ length: 1400 }, (_, i) => item(i));
  const fake = backend(corpus, { failOnPage: [1, 2, 3] });

  await assert.rejects(
    () => loadAllPages(fake.fetchPage, { pageSize: 500, attemptsPerPage: 3, delay: noDelay }),
    /network failure/,
  );
});

test('a transient page failure is retried and the complete feed still arrives', async () => {
  const corpus = Array.from({ length: 1400 }, (_, i) => item(i));
  // Page index 1 fails once; the retry of that same cursor succeeds.
  const fake = backend(corpus, { failOnPage: [1] });

  const loaded = await loadAllPages(fake.fetchPage, {
    pageSize: 500,
    attemptsPerPage: 3,
    delay: noDelay,
  });
  assert.equal(loaded.length, 1400, 'retry recovered the full corpus');
  assert.equal(new Set(loaded.map((r) => r.id)).size, 1400);
});

test('retrying a page asks the identical cursor, so a retry cannot skip rows', async () => {
  const corpus = Array.from({ length: 900 }, (_, i) => item(i));
  const fake = backend(corpus, { failOnPage: [1] });
  await loadAllPages(fake.fetchPage, { pageSize: 500, attemptsPerPage: 3, delay: noDelay });

  // calls: [null, cursorA (fails), cursorA (retry)] — the cursor is repeated,
  // never advanced past the page that failed.
  assert.equal(fake.calls[1], fake.calls[2]);
  assert.notEqual(fake.calls[1], null);
});

test('a failed refresh cannot replace a complete feed with a partial one', async () => {
  const corpus = Array.from({ length: 1400 }, (_, i) => item(i));
  const complete = await loadAllPages(backend(corpus).fetchPage, { pageSize: 500, delay: noDelay });
  assert.equal(complete.length, 1400);

  // The refresh dies mid-scan. Because the loader throws instead of resolving,
  // the screen keeps `complete` — there is no partial value it could adopt.
  let replacement: FeedItem[] | null = null;
  try {
    replacement = await loadAllPages(backend(corpus, { failOnPage: [2] }).fetchPage, {
      pageSize: 500,
      attemptsPerPage: 1,
      delay: noDelay,
    });
  } catch {
    // retained
  }
  assert.equal(replacement, null);
  assert.equal(complete.length, 1400, 'the held feed is untouched and still complete');
});

// ── 12, 14. Sections cover the complete corpus ───────────────────────────────

test('All Recalls sections account for every case in the complete corpus', async () => {
  const corpus = [
    ...Array.from({ length: 700 }, (_, i) =>
      item(i, { publishedAt: '2026-08-20', lastPublicActivityAt: '2026-08-20' }),
    ),
    ...Array.from({ length: 600 }, (_, i) =>
      item(1000 + i, { publishedAt: '2019-01-04', lastPublicActivityAt: '2019-01-04' }),
    ),
  ];
  const loaded = await loadAllPages(backend(corpus).fetchPage, { delay: noDelay });
  const { recent, olderActive } = buildFeedSections(loaded, NOW);

  assert.equal(recent.length, 700);
  assert.equal(olderActive.length, 600);
  assert.equal(recent.length + olderActive.length, corpus.length, 'no case omitted');
  assert.equal(new Set([...recent, ...olderActive].map((r) => r.id)).size, corpus.length);
});

// ── 8, 13. Affects Me over the complete corpus ───────────────────────────────

const CA_PROFILE: UserRecallPreferences = {
  state: 'CA',
  allergens: ['peanuts'],
  retailers: ['costco'],
};

function relevanceFor(i: FeedItem) {
  return evaluatePersonalRelevance(
    {
      geography: i.geography,
      pathogenOrAllergen: i.pathogenOrAllergen,
      retailerNames: i.retailerNames,
      hazardCategory: i.hazardCategory,
      reasonText: i.reasonText,
    },
    CA_PROFILE,
  );
}

test('the highest-ranked Affects Me case is found even when it lives on a later page', async () => {
  // 1,300 unremarkable Moderate cases, plus one Critical peanut recall placed
  // last in id order — i.e. on the final page, invisible before C5.1.
  const filler = Array.from({ length: 1300 }, (_, i) =>
    item(i, {
      geography: { scope: 'nationwide', states: [], confidence: 'stated', sourceText: null },
    }),
  );
  const buried = item(99999, {
    title: 'Buried Critical Peanut Recall',
    classification: { value: 'class_I', sourceText: 'Class I', officialClasses: ['class_I'] },
    pathogenOrAllergen: 'peanuts',
    retailerNames: ['Costco'],
    geography: { scope: 'nationwide', states: [], confidence: 'stated', sourceText: null },
  });
  const corpus = [...filler, buried];

  const loaded = await loadAllPages(backend(corpus).fetchPage, { pageSize: 500, delay: noDelay });
  const { affects } = buildAffectsMeSections(loaded, relevanceFor, { now: NOW });

  assert.equal(affects.length, 1301);
  assert.equal(affects[0].id, buried.id, 'ranking must see the whole corpus, not page 1');
});

test('Affects Me eligibility and order are identical whether the corpus arrives paged or whole', async () => {
  const corpus = [
    ...Array.from({ length: 900 }, (_, i) =>
      item(i, {
        geography:
          i % 3 === 0
            ? { scope: 'nationwide', states: [], confidence: 'stated', sourceText: null }
            : i % 3 === 1
              ? { scope: 'states', states: ['CA'], confidence: 'stated', sourceText: null }
              : { scope: 'states', states: ['TX'], confidence: 'stated', sourceText: null },
        pathogenOrAllergen: i % 5 === 0 ? 'peanuts' : null,
        retailerNames: i % 7 === 0 ? ['Costco'] : [],
        classification:
          i % 4 === 0
            ? { value: 'class_I', sourceText: 'Class I', officialClasses: ['class_I'] }
            : { value: 'class_II', sourceText: 'Class II', officialClasses: ['class_II'] },
      }),
    ),
  ];

  const direct = buildAffectsMeSections(corpus, relevanceFor, { now: NOW });
  const paged = buildAffectsMeSections(
    await loadAllPages(backend(corpus).fetchPage, { pageSize: 250, delay: noDelay }),
    relevanceFor,
    { now: NOW },
  );

  assert.deepEqual(
    paged.affects.map((r) => r.id),
    direct.affects.map((r) => r.id),
    'ranking is unchanged by how the rows arrived',
  );
  assert.deepEqual(
    paged.older.map((r) => r.id),
    direct.older.map((r) => r.id),
  );

  // Eligibility is decided by relevance alone — paging cannot move that line.
  const qualifying = corpus.filter((i) => relevanceFor(i).affectsMe).length;
  assert.equal(paged.affects.length + paged.older.length, qualifying);
});

test('section counts equal the complete input set, with every case placed at most once', async () => {
  const corpus = Array.from({ length: 1100 }, (_, i) =>
    item(i, {
      publishedAt: i % 2 === 0 ? '2026-08-20' : '2019-03-03',
      lastPublicActivityAt: i % 2 === 0 ? '2026-08-20' : '2019-03-03',
      geography:
        i % 3 === 0
          ? { scope: 'unknown', states: [], confidence: 'stated', sourceText: null }
          : { scope: 'states', states: ['CA'], confidence: 'stated', sourceText: null },
    }),
  );
  const loaded = await loadAllPages(backend(corpus).fetchPage, { delay: noDelay });
  const { affects, older } = buildAffectsMeSections(loaded, relevanceFor, { now: NOW });

  const placed = [...affects, ...older].map((r) => r.id);
  assert.equal(new Set(placed).size, placed.length, 'no case in two sections');

  const qualifying = loaded.filter((i) => relevanceFor(i).affectsMe);
  assert.equal(affects.length + older.length, qualifying.length);
});

// ── Page-size contract ───────────────────────────────────────────────────────

test('the default page size is a transfer bound under the server cap, not a total', async () => {
  assert.ok(FEED_PAGE_SIZE < 1000, 'must stay under the measured PostgREST max_rows ceiling');
  const corpus = Array.from({ length: FEED_PAGE_SIZE * 3 + 7 }, (_, i) => item(i));
  const loaded = await loadAllPages(backend(corpus).fetchPage, { delay: noDelay });
  assert.equal(loaded.length, FEED_PAGE_SIZE * 3 + 7, 'total is bounded only by the corpus');
});
