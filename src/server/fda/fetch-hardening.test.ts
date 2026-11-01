/**
 * The FDA source-fetch response boundary.
 *
 * Before 2026-09-09 only the status check sat inside the retry loop;
 * `response.json()` ran after it. A scheduled run that received an HTML error
 * page under HTTP 200 therefore died on its first attempt with a raw
 * `SyntaxError: Unexpected token '<'` — an edge artifact presented as a code
 * defect, with no retry and no classification.
 *
 * These tests pin the corrected boundary: status, decode, and parse are retried
 * together, decode failures are classified and retryable, contract drift still
 * alarms immediately, and no diagnostic may carry a body.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FDA_FETCH_POLICY,
  FdaSourceContractError,
  FdaSourceUnavailableError,
  fetchFdaDetailPage,
  fetchFdaFoodRss,
  fetchFdaListing,
} from './fetch';

const NO_WAIT = { hooks: { sleep: async () => {}, jitter: () => 0.5 } };

const VALID_LISTING = JSON.stringify([
  { field_recall_title: 'Example', field_recall_date: '09/08/2026' },
]);
const VALID_RSS =
  '<?xml version="1.0"?><rss><channel><item><title>Example Recall</title>' +
  '<link>http://www.fda.gov/x</link><pubDate>Mon, 08 Sep 2026 12:00:00 EST</pubDate></item>' +
  '</channel></rss>';
const GATEWAY_HTML =
  '<html><head><title>502 Bad Gateway</title></head><body><center>cloudflare</center></body></html>';

interface Turn {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
  throws?: string;
}

/** A fetch that plays a fixed script, one turn per attempt, and counts calls. */
function scriptedFetch(turns: Turn[]) {
  const urls: string[] = [];
  const impl = (async (url: string) => {
    const turn = turns[Math.min(urls.length, turns.length - 1)];
    urls.push(String(url));
    if (turn.throws) throw new TypeError(turn.throws);
    return new Response(turn.body ?? '', {
      status: turn.status ?? 200,
      headers: { 'content-type': 'application/json', ...turn.headers },
    });
  }) as unknown as typeof fetch;
  return { impl, calls: () => urls.length };
}

// ── The happy path is untouched ─────────────────────────────────────────────

test('valid JSON on the first attempt is returned unchanged, with one request', async () => {
  const f = scriptedFetch([{ body: VALID_LISTING }]);
  const result = await fetchFdaListing(f.impl, NO_WAIT);
  assert.deepEqual(result.items, JSON.parse(VALID_LISTING));
  assert.equal(f.calls(), 1);
  assert.ok(Date.parse(result.fetchedAt) > 0);
});

test('valid RSS on the first attempt parses exactly as before', async () => {
  const f = scriptedFetch([{ body: VALID_RSS, headers: { 'content-type': 'text/xml' } }]);
  const result = await fetchFdaFoodRss(f.impl, NO_WAIT);
  assert.equal(result.items.length, 1);
  // http:// is still normalized to https:// — parser behaviour unchanged.
  assert.equal(result.items[0].link, 'https://www.fda.gov/x');
  assert.equal(f.calls(), 1);
});

// ── Decode failures retry ───────────────────────────────────────────────────

test('HTML under HTTP 200 is a classified retryable fault, then succeeds', async () => {
  const f = scriptedFetch([{ status: 200, body: GATEWAY_HTML }, { body: VALID_LISTING }]);
  const result = await fetchFdaListing(f.impl, NO_WAIT);
  assert.deepEqual(result.items, JSON.parse(VALID_LISTING));
  assert.equal(f.calls(), 2);
});

test('truncated JSON retries and then succeeds', async () => {
  const f = scriptedFetch([{ body: VALID_LISTING.slice(0, 30) }, { body: VALID_LISTING }]);
  assert.equal((await fetchFdaListing(f.impl, NO_WAIT)).items.length, 1);
  assert.equal(f.calls(), 2);
});

test('an empty body retries and then succeeds', async () => {
  const f = scriptedFetch([{ body: '   ' }, { body: VALID_LISTING }]);
  assert.equal((await fetchFdaListing(f.impl, NO_WAIT)).items.length, 1);
  assert.equal(f.calls(), 2);
});

test('HTTP 502 retries and then succeeds', async () => {
  const f = scriptedFetch([{ status: 502, body: GATEWAY_HTML }, { body: VALID_LISTING }]);
  assert.equal((await fetchFdaListing(f.impl, NO_WAIT)).items.length, 1);
  assert.equal(f.calls(), 2);
});

test('a transport failure retries and then succeeds', async () => {
  const f = scriptedFetch([{ throws: 'fetch failed' }, { body: VALID_LISTING }]);
  assert.equal((await fetchFdaListing(f.impl, NO_WAIT)).items.length, 1);
  assert.equal(f.calls(), 2);
});

test('an HTML body under 200 on the RSS feed retries instead of alarming on shape', async () => {
  const f = scriptedFetch([
    { body: GATEWAY_HTML, headers: { 'content-type': 'text/html' } },
    { body: VALID_RSS, headers: { 'content-type': 'text/xml' } },
  ]);
  assert.equal((await fetchFdaFoodRss(f.impl, NO_WAIT)).items.length, 1);
  assert.equal(f.calls(), 2);
});

test('persistent invalid JSON exhausts the bound and fails payload-free', async () => {
  const f = scriptedFetch([{ status: 200, body: GATEWAY_HTML }]);
  await assert.rejects(
    () => fetchFdaListing(f.impl, NO_WAIT),
    (error: unknown) => {
      assert.ok(error instanceof FdaSourceUnavailableError);
      assert.match(error.message, /failed after 3 attempt\(s\)/);
      // Shape only: no markup, no body, no 'Unexpected token'.
      assert.doesNotMatch(error.message, /<html|cloudflare|Unexpected token/);
      return true;
    },
  );
  assert.equal(f.calls(), FDA_FETCH_POLICY.attempts);
});

// ── Source unavailable vs contract drift ────────────────────────────────────

test('a persistent 404 exhausts the existing bound, then reports an unavailable source', async () => {
  const f = scriptedFetch([{ status: 404, body: 'Not Found' }]);
  await assert.rejects(
    () => fetchFdaListing(f.impl, NO_WAIT),
    (error: unknown) =>
      error instanceof FdaSourceUnavailableError && /HTTP 404/.test(error.message),
  );
  // The bot-gate family keeps the documented 3-attempt policy.
  assert.equal(f.calls(), 3);
});

// 2026-10-28 → 31: the listing answered GitHub runners with 404 on ~9 in 10
// runs, and the recorded error said only "HTTP 404". The final error must now
// describe the response well enough to tell an edge deny page from a missing
// resource — without the body, and without changing the retry bound.
const EDGE_DENY_PAGE =
  '<HTML><HEAD>\n<TITLE>Access Denied</TITLE>\n</HEAD><BODY>\n<H1>Access Denied</H1>\n' +
  'You don\'t have permission to access "http://www.fda.gov/datatables-json/recalls-market-withdrawals.json?x=secret" on this server.<P>\n' +
  'Reference #18.6e2c4317.1761969600.1a2b3c4d\n</BODY>\n</HTML>\n';

test('a persistent 404 records what the response was, not just its status', async () => {
  const f = scriptedFetch([
    {
      status: 404,
      body: EDGE_DENY_PAGE,
      headers: { 'content-type': 'text/html; charset=utf-8', server: 'AkamaiGHost' },
    },
  ]);
  await assert.rejects(
    () => fetchFdaListing(f.impl, NO_WAIT),
    (error: unknown) => {
      assert.ok(error instanceof FdaSourceUnavailableError);
      assert.match(error.message, /failed after 3 attempt\(s\) \[gateway\]: HTTP 404 \(/);
      assert.match(error.message, /text\/html/);
      assert.match(error.message, new RegExp(`${EDGE_DENY_PAGE.length} B`));
      assert.match(error.message, /server AkamaiGHost/);
      assert.match(error.message, /title "Access Denied"/);
      assert.match(error.message, /ref #18\.6e2c4317\.1761969600\.1a2b3c4d/);
      // Payload-free: no body text beyond the title, no query string.
      assert.doesNotMatch(error.message, /permission|secret|<\/?[a-z]/i);
      // The URL is named once, at the front; the detail is not truncated.
      assert.equal(error.message.split('recalls-market-withdrawals.json').length, 2);
      assert.doesNotMatch(error.message, /…/);
      return true;
    },
  );
  assert.equal(f.calls(), 3, 'retry bound unchanged');
});

test('a bodiless 404 still reports its status and what little it had', async () => {
  const f = scriptedFetch([{ status: 404, body: '' }]);
  await assert.rejects(
    () => fetchFdaListing(f.impl, NO_WAIT),
    (error: unknown) =>
      error instanceof FdaSourceUnavailableError &&
      /HTTP 404 \(application\/json, 0 B\)/.test(error.message),
  );
  assert.equal(f.calls(), 3);
});

/**
 * A fetch that, like undici after following redirects, reports `redirected`
 * and the final URL. Response's own constructor cannot set either.
 */
function redirectedFetch(status: number, body: string, finalUrl: string, server: string) {
  let calls = 0;
  const impl = (async () => {
    calls += 1;
    const response = new Response(body, { status, headers: { server } });
    Object.defineProperty(response, 'redirected', { value: true });
    Object.defineProperty(response, 'url', { value: finalUrl });
    return response;
  }) as unknown as typeof fetch;
  return { impl, calls: () => calls };
}

// 2026-11-01 runner probe: fetch followed a redirect and the 10-byte 404 came
// from AkamaiNetStorage, not www.fda.gov.
test('a 404 reached through a redirect names where the request ended up', async () => {
  const f = redirectedFetch(
    404,
    'Not found.',
    'https://netstorage.example.akamaized.net/errors/denied.html?token=SECRET&x=1',
    'AkamaiNetStorage',
  );
  await assert.rejects(
    () => fetchFdaListing(f.impl, NO_WAIT),
    (error: unknown) => {
      assert.ok(error instanceof FdaSourceUnavailableError);
      assert.match(
        error.message,
        /HTTP 404 \(redirected to https:\/\/netstorage\.example\.akamaized\.net\/errors\/denied\.html, text\/plain, 10 B, server AkamaiNetStorage\)/,
      );
      assert.doesNotMatch(error.message, /SECRET|token|Not found\./);
      return true;
    },
  );
  assert.equal(f.calls(), 3, 'retry bound unchanged');
});

test('a legitimate redirect to the listing is still followed and accepted', async () => {
  const f = redirectedFetch(
    200,
    VALID_LISTING,
    'https://www.fda.gov/datatables-json/recalls-market-withdrawals.json',
    'nginx',
  );
  const result = await fetchFdaListing(f.impl, NO_WAIT);
  assert.deepEqual(result.items, JSON.parse(VALID_LISTING));
  assert.equal(f.calls(), 1);
});

test('a redirect that ends on an HTML page under 200 is rejected, not ingested', async () => {
  const f = redirectedFetch(
    200,
    '<!doctype html><html><head><title>Access</title></head><body>x</body></html>',
    'https://netstorage.example.akamaized.net/errors/denied.html',
    'AkamaiNetStorage',
  );
  await assert.rejects(
    () => fetchFdaListing(f.impl, NO_WAIT),
    (error: unknown) =>
      error instanceof FdaSourceUnavailableError && /HTML page where JSON/.test(error.message),
  );
  assert.equal(f.calls(), 3);
});

test('a 404 that clears within the bound still succeeds', async () => {
  const f = scriptedFetch([
    { status: 404, body: EDGE_DENY_PAGE, headers: { 'content-type': 'text/html' } },
    { body: VALID_LISTING },
  ]);
  const result = await fetchFdaListing(f.impl, NO_WAIT);
  assert.deepEqual(result.items, JSON.parse(VALID_LISTING));
  assert.equal(f.calls(), 2);
});

test('an ordinary non-transient 4xx fails promptly, without retrying', async () => {
  for (const status of [400, 401, 422]) {
    const f = scriptedFetch([{ status, body: 'nope' }]);
    await assert.rejects(
      () => fetchFdaListing(f.impl, NO_WAIT),
      (error: unknown) => error instanceof FdaSourceUnavailableError,
    );
    assert.equal(f.calls(), 1, `HTTP ${status} must not retry`);
  }
});

test('parseable JSON of the wrong shape is contract drift: one attempt, alarm kept', async () => {
  const f = scriptedFetch([{ body: '{"results":[]}' }]);
  await assert.rejects(
    () => fetchFdaListing(f.impl, NO_WAIT),
    (error: unknown) =>
      error instanceof FdaSourceContractError && /non-array JSON \(object\)/.test(error.message),
  );
  // Not loosened to accept it, and not retried into a slower alarm.
  assert.equal(f.calls(), 1);
});

test('valid XML carrying no items is contract drift, not a transient fault', async () => {
  const f = scriptedFetch([
    {
      body: '<?xml version="1.0"?><rss><channel></channel></rss>',
      headers: { 'content-type': 'text/xml' },
    },
  ]);
  await assert.rejects(
    () => fetchFdaFoodRss(f.impl, NO_WAIT),
    (error: unknown) =>
      error instanceof FdaSourceContractError && /feed shape may have changed/.test(error.message),
  );
  assert.equal(f.calls(), 1);
});

// ── Retry-After ─────────────────────────────────────────────────────────────

test('Retry-After on a 429 is honored and bounded', async () => {
  const waits: number[] = [];
  const f = scriptedFetch([
    { status: 429, body: 'slow down', headers: { 'retry-after': '4' } },
    { body: VALID_LISTING },
  ]);
  await fetchFdaListing(f.impl, {
    hooks: { sleep: async (ms) => void waits.push(ms), jitter: () => 0.5 },
  });
  assert.deepEqual(waits, [4000]);

  // A wildly large Retry-After cannot stall the job past the policy cap.
  const long: number[] = [];
  const g = scriptedFetch([
    { status: 503, body: 'down', headers: { 'retry-after': '3600' } },
    { body: VALID_LISTING },
  ]);
  await fetchFdaListing(g.impl, {
    hooks: { sleep: async (ms) => void long.push(ms), jitter: () => 0.5 },
  });
  assert.deepEqual(long, [FDA_FETCH_POLICY.maxDelayMs]);
});

// ── Detail pages ────────────────────────────────────────────────────────────

test('a detail page error page under 200 retries; a real page with no <main> alarms', async () => {
  const page = `<html><body><main><h1>Recall</h1>${'content '.repeat(800)}</main></body></html>`;
  const f = scriptedFetch([{ status: 200, body: GATEWAY_HTML }, { body: page }]);
  assert.match(await fetchFdaDetailPage('https://www.fda.gov/x', f.impl, NO_WAIT), /<main>/);
  assert.equal(f.calls(), 2);

  const shapeChanged = `<html><body><article>${'x'.repeat(9000)}</article></body></html>`;
  const g = scriptedFetch([{ body: shapeChanged }]);
  await assert.rejects(
    () => fetchFdaDetailPage('https://www.fda.gov/y', g.impl, NO_WAIT),
    (error: unknown) =>
      error instanceof FdaSourceContractError && /no <main> region/.test(error.message),
  );
  assert.equal(g.calls(), 1);
});

// ── Diagnostics ─────────────────────────────────────────────────────────────

test('retry diagnostics never carry the response body', async () => {
  const lines: string[] = [];
  const secretish = `<html><body>SHOULD_NEVER_APPEAR ${'y'.repeat(3000)}</body></html>`;
  const f = scriptedFetch([{ status: 200, body: secretish }, { body: VALID_LISTING }]);
  await fetchFdaListing(f.impl, {
    hooks: { sleep: async () => {}, jitter: () => 0.5, warn: (line) => lines.push(line) },
  });
  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0], /SHOULD_NEVER_APPEAR|yyyy/);
  assert.ok(lines[0].length < 400);
});
