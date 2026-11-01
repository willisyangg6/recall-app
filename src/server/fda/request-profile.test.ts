/**
 * The www.fda.gov request profile (2026-11-01).
 *
 * From 2026-10-28 the previous browser profile was answered on GitHub-hosted
 * runners with a 302 to /apology_objects/abuse-detection-apology.html and a
 * 404 (243 of 266 FDA runs failed). Runner probes showed the same Node fetch
 * client sending only a non-browser User-Agent got direct 200s with valid
 * content — `curl/8`, and the application identity
 * `lotly-recall-ingest/1.0` for the listing, RSS, and a detail page. These
 * tests pin that request, check what Node fetch
 * actually puts on the wire, and make sure the apology redirect — whatever
 * its status — can never be ingested or counted as a healthy run, while
 * legitimate redirects keep working. FSIS's own request profile is pinned as
 * unchanged.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';

import { runFdaJob } from '../jobs/fda-job';
import { fetchFsisRecords } from '../fsis/fetch';
import { MemoryStore } from '../store/memory-store';
import {
  FDA_REQUEST_HEADERS,
  FdaSourceUnavailableError,
  fetchFdaDetailPage,
  fetchFdaFoodRss,
  fetchFdaListing,
} from './fetch';
import { loadDetailPage, loadListingItems } from './fixtures';

const NO_WAIT = { hooks: { sleep: async () => {}, jitter: () => 0.5 } };
const DETAIL_SLUG =
  '529-commerce-llc-recalls-rooted-rare-brand-aquafaba-powder-due-undeclared-eggs';
const VALID_RSS =
  '<?xml version="1.0"?><rss><channel><item><title>Example Recall</title>' +
  '<link>http://www.fda.gov/x</link><pubDate>Mon, 08 Sep 2026 12:00:00 EST</pubDate></item>' +
  '</channel></rss>';
const APOLOGY_PATH = '/apology_objects/abuse-detection-apology.html';

/** Records the init each call passes, then answers with `respond`. */
function capturing(respond: () => Response) {
  const inits: RequestInit[] = [];
  const impl = (async (_url: string, init: RequestInit) => {
    inits.push(init);
    return respond();
  }) as unknown as typeof fetch;
  return { impl, inits };
}

/** undici reports `redirected` and the final URL after following; Response() cannot set them. */
function landedOn(url: string, status: number, body: string, type = 'text/html'): Response {
  const response = new Response(body, { status, headers: { 'content-type': type } });
  Object.defineProperty(response, 'redirected', { value: true });
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

async function withServer(
  handler: http.RequestListener,
  run: (origin: string, seen: http.IncomingHttpHeaders[]) => Promise<void>,
): Promise<void> {
  const seen: http.IncomingHttpHeaders[] = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers);
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

// ── The corrected request ──────────────────────────────────────────────────

test('the FDA request profile is exactly the runner-verified one', () => {
  assert.deepEqual({ ...FDA_REQUEST_HEADERS }, { 'User-Agent': 'lotly-recall-ingest/1.0' });
  assert.ok(Object.isFrozen(FDA_REQUEST_HEADERS));
});

test('listing, RSS, and detail reads all send that profile and nothing else', async () => {
  const listing = capturing(() => new Response(JSON.stringify(loadListingItems())));
  await fetchFdaListing(listing.impl, NO_WAIT);
  const rss = capturing(() => new Response(VALID_RSS, { headers: { 'content-type': 'text/xml' } }));
  await fetchFdaFoodRss(rss.impl, NO_WAIT);
  const detail = capturing(() => new Response(loadDetailPage(DETAIL_SLUG)));
  await fetchFdaDetailPage('https://www.fda.gov/x', detail.impl, NO_WAIT);

  for (const { inits } of [listing, rss, detail]) {
    assert.equal(inits.length, 1);
    assert.deepEqual(inits[0].headers, { 'User-Agent': 'lotly-recall-ingest/1.0' });
    assert.equal(inits[0].redirect, undefined, 'redirects are still followed (fetch default)');
  }
});

test('on the wire, Node fetch sends the application identity with its own defaults and no browser profile', async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(loadDetailPage(DETAIL_SLUG));
    },
    async (origin, seen) => {
      await fetchFdaDetailPage(`${origin}/safety/x`, fetch, NO_WAIT);
      assert.equal(seen.length, 1);
      const headers = seen[0];
      assert.equal(headers['user-agent'], 'lotly-recall-ingest/1.0');
      assert.equal(headers['accept'], '*/*');
      assert.equal(headers['accept-language'], '*');
      assert.equal(headers['sec-fetch-mode'], 'cors');
      assert.doesNotMatch(JSON.stringify(headers), /Mozilla|Chrome|en-US|text\/html/);
    },
  );
});

// ── The apology redirect is never content ──────────────────────────────────

test('the apology redirect (302 → 404) fails with a redacted redirect diagnostic', async () => {
  await withServer(
    (req, res) => {
      if (req.url!.startsWith('/safety/')) {
        res.writeHead(302, { location: `${APOLOGY_PATH}?ref=abc123&ip=1.2.3.4` });
        res.end();
      } else {
        res.writeHead(404, { 'content-type': 'text/plain', server: 'AkamaiNetStorage' });
        res.end('Not found.');
      }
    },
    async (origin, seen) => {
      await assert.rejects(
        () => fetchFdaDetailPage(`${origin}/safety/x`, fetch, NO_WAIT),
        (error: unknown) => {
          assert.ok(error instanceof FdaSourceUnavailableError);
          assert.match(
            error.message,
            new RegExp(
              `HTTP 404 \\(redirected to http://127\\.0\\.0\\.1:\\d+${APOLOGY_PATH.replace(/[./]/g, '\\$&')}, text/plain, 10 B, server AkamaiNetStorage\\)`,
            ),
          );
          assert.doesNotMatch(error.message, /ref=|abc123|1\.2\.3\.4|Not found\./);
          return true;
        },
      );
      assert.equal(seen.length, 6, '3 bounded attempts, each a redirect plus its target');
    },
  );
});

test('an apology page served with 200 is rejected even though detail pages are HTML', async () => {
  // A plausible apology page that even carries a <main> region: without the
  // redirect check, the detail parser would have accepted it.
  const apology =
    '<!doctype html><html><head><title>Apology</title></head><body>' +
    '<main><h1>We are sorry</h1><p>Your request was flagged.</p></main></body></html>';
  const f = capturing(() => landedOn(`https://www.fda.gov${APOLOGY_PATH}`, 200, apology));
  await assert.rejects(
    () => fetchFdaDetailPage('https://www.fda.gov/safety/x', f.impl, NO_WAIT),
    (error: unknown) =>
      error instanceof FdaSourceUnavailableError &&
      /HTTP 200 \(redirected to https:\/\/www\.fda\.gov\/apology_objects\//.test(error.message),
  );
  assert.equal(f.inits.length, 3, 'retry bound unchanged');
});

test('a legitimate redirect is still followed and its page accepted', async () => {
  await withServer(
    (req, res) => {
      if (req.url === '/safety/old-slug') {
        res.writeHead(301, { location: '/safety/new-slug' });
        res.end();
      } else {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(loadDetailPage(DETAIL_SLUG));
      }
    },
    async (origin) => {
      const main = await fetchFdaDetailPage(`${origin}/safety/old-slug`, fetch, NO_WAIT);
      assert.match(main, /^<main\b/);
    },
  );
});

test('a valid listing is accepted with every record intact', async () => {
  const items = loadListingItems();
  const f = capturing(() => new Response(JSON.stringify(items)));
  const result = await fetchFdaListing(f.impl, NO_WAIT);
  assert.deepEqual(result.items, items);
});

for (const [label, body, type] of [
  ['an HTML page', '<html><head><title>Apology</title></head><body>x</body></html>', 'text/html'],
  ['an empty body', '', 'application/json'],
  ['malformed JSON', '[{"path": "/x",', 'application/json'],
] as const) {
  test(`a listing redirect that lands on ${label} under 200 is never accepted`, async () => {
    const f = capturing(() => landedOn('https://www.fda.gov/elsewhere', 200, body, type));
    await assert.rejects(
      () => fetchFdaListing(f.impl, NO_WAIT),
      (error: unknown) => error instanceof FdaSourceUnavailableError,
    );
    assert.equal(f.inits.length, 3);
  });
}

test('an apology-redirected listing fails the FDA run and ingests nothing', async () => {
  const store = new MemoryStore();
  const f = capturing(() => landedOn(`https://www.fda.gov${APOLOGY_PATH}`, 404, 'Not found.'));
  const report = await runFdaJob(
    { store, now: () => new Date('2026-08-21T12:00:00Z'), version: 't', holder: 't:1:t' },
    {
      fetchListing: () => fetchFdaListing(f.impl, NO_WAIT),
      fetchRss: async () => ({ items: [], fetchedAt: '2026-08-21T00:00:00Z', sourceUrl: 'x' }),
      fetchDetail: async () => assert.fail('no detail fetch after a failed listing'),
      detailDelayMs: 0,
    },
  );
  assert.equal(report.outcome, 'failed');
  assert.match(report.error ?? '', /apology_objects/);
  assert.equal(store.cases.size, 0);
  assert.equal(store.notifications.size, 0);
  const [run] = await store.listRecentJobRuns('fda_announcements', 1);
  assert.equal(run.outcome, 'failed');
  assert.equal(run.metrics?.completedFeedHash ?? null, null, 'no skip gate armed');
});

// ── FSIS is untouched ──────────────────────────────────────────────────────

test('FSIS keeps its own browser fingerprint profile', async () => {
  const f = capturing(
    () => new Response('[]', { headers: { 'content-type': 'application/json' } }),
  );
  await fetchFsisRecords(f.impl, { sleep: async () => {} });
  const headers = f.inits[0].headers as Record<string, string>;
  assert.match(headers['User-Agent'], /Chrome\/139/);
  assert.equal(headers['Sec-Fetch-Mode'], 'navigate');
  assert.notEqual(headers['User-Agent'], FDA_REQUEST_HEADERS['User-Agent']);
});
