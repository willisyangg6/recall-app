/**
 * Bounded allowlisted fetch (C9): every network-safety rule is enforced
 * in code, so every rule is provable with a scripted fetch — no sockets.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { safeFetchBinary, sanitizeUrlForLog } from './safe-fetch';

const PDF_BYTES = new TextEncoder().encode('%PDF-1.7 minimal');
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

type Scripted = Record<string, () => Response>;

function scriptedFetch(script: Scripted): { impl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const handler = script[url];
    if (!handler) throw new Error(`unscripted fetch: ${url}`);
    return handler();
  }) as typeof fetch;
  return { impl, calls };
}

const APPROVED = ['www.fsis.usda.gov'];
const base = { approvedHosts: APPROVED, kind: 'pdf' as const, maxBytes: 1024 * 1024 };

test('a well-formed PDF fetch returns the bytes and the serving URL', async () => {
  const { impl } = scriptedFetch({
    'https://www.fsis.usda.gov/sites/labels.pdf': () =>
      new Response(PDF_BYTES, { status: 200, headers: { 'content-type': 'application/pdf' } }),
  });
  const result = await safeFetchBinary('https://www.fsis.usda.gov/sites/labels.pdf', {
    ...base,
    fetchImpl: impl,
  });
  assert.deepEqual(result.bytes, PDF_BYTES);
  assert.equal(result.finalUrl, 'https://www.fsis.usda.gov/sites/labels.pdf');
});

test('unapproved, private-network, and unsafe targets never produce a request', async () => {
  const { impl, calls } = scriptedFetch({});
  for (const url of [
    'https://example.com/labels.pdf',
    'https://127.0.0.1/labels.pdf',
    'https://10.0.0.8/labels.pdf',
    'https://169.254.169.254/latest/meta-data',
    'https://localhost/labels.pdf',
    'http://www.fsis.usda.gov/labels.pdf', // https required
    'file:///etc/passwd',
    'https://user:pass@www.fsis.usda.gov/labels.pdf',
  ]) {
    await assert.rejects(
      () => safeFetchBinary(url, { ...base, fetchImpl: impl }),
      /not https|not approved|carries credentials|Invalid URL/,
      `${url} must be rejected`,
    );
  }
  assert.deepEqual(calls, [], 'no network request may ever be issued');
});

test('every redirect target is revalidated — an approved host cannot bounce elsewhere', async () => {
  const { impl, calls } = scriptedFetch({
    'https://www.fsis.usda.gov/old.pdf': () =>
      new Response(null, { status: 302, headers: { location: 'https://evil.example.com/x.pdf' } }),
  });
  await assert.rejects(
    () => safeFetchBinary('https://www.fsis.usda.gov/old.pdf', { ...base, fetchImpl: impl }),
    /redirect target host not approved/,
  );
  assert.equal(calls.length, 1, 'the disallowed target is never fetched');

  // A same-host redirect (including a relative Location) is followed.
  const ok = scriptedFetch({
    'https://www.fsis.usda.gov/old.pdf': () =>
      new Response(null, { status: 301, headers: { location: '/sites/new.pdf' } }),
    'https://www.fsis.usda.gov/sites/new.pdf': () =>
      new Response(PDF_BYTES, { status: 200, headers: { 'content-type': 'application/pdf' } }),
  });
  const result = await safeFetchBinary('https://www.fsis.usda.gov/old.pdf', {
    ...base,
    fetchImpl: ok.impl,
  });
  assert.equal(result.finalUrl, 'https://www.fsis.usda.gov/sites/new.pdf');

  // An http downgrade on redirect is refused even on the approved host.
  const downgrade = scriptedFetch({
    'https://www.fsis.usda.gov/old.pdf': () =>
      new Response(null, {
        status: 302,
        headers: { location: 'http://www.fsis.usda.gov/sites/new.pdf' },
      }),
  });
  await assert.rejects(
    () =>
      safeFetchBinary('https://www.fsis.usda.gov/old.pdf', { ...base, fetchImpl: downgrade.impl }),
    /redirect target is not https/,
  );
});

test('redirect loops are bounded', async () => {
  const { impl } = scriptedFetch({
    'https://www.fsis.usda.gov/a.pdf': () =>
      new Response(null, { status: 302, headers: { location: '/a.pdf' } }),
  });
  await assert.rejects(
    () => safeFetchBinary('https://www.fsis.usda.gov/a.pdf', { ...base, fetchImpl: impl }),
    /too many redirects/,
  );
});

test('an HTML error page can never masquerade as a PDF or image', async () => {
  // Honest content type: rejected on the header.
  const html = scriptedFetch({
    'https://www.fsis.usda.gov/sites/labels.pdf': () =>
      new Response('<html>Not found</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
  });
  await assert.rejects(
    () =>
      safeFetchBinary('https://www.fsis.usda.gov/sites/labels.pdf', {
        ...base,
        fetchImpl: html.impl,
      }),
    /unexpected content-type/,
  );
  // Lying content type: rejected on the magic bytes.
  const lying = scriptedFetch({
    'https://www.fsis.usda.gov/sites/labels.pdf': () =>
      new Response('<html>Service unavailable</html>', {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      }),
  });
  await assert.rejects(
    () =>
      safeFetchBinary('https://www.fsis.usda.gov/sites/labels.pdf', {
        ...base,
        fetchImpl: lying.impl,
      }),
    /magic bytes mismatch/,
  );
});

test('image fetches accept real images and reject everything else', async () => {
  const { impl } = scriptedFetch({
    'https://www.fsis.usda.gov/photo.png': () =>
      new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'image/png' } }),
  });
  const result = await safeFetchBinary('https://www.fsis.usda.gov/photo.png', {
    ...base,
    kind: 'image',
    fetchImpl: impl,
  });
  assert.deepEqual(result.bytes, PNG_BYTES);
});

test('oversized responses are rejected — by header when declared, while streaming when not', async () => {
  const declared = scriptedFetch({
    'https://www.fsis.usda.gov/big.pdf': () =>
      new Response(PDF_BYTES, {
        status: 200,
        headers: { 'content-type': 'application/pdf', 'content-length': '99999999' },
      }),
  });
  await assert.rejects(
    () =>
      safeFetchBinary('https://www.fsis.usda.gov/big.pdf', { ...base, fetchImpl: declared.impl }),
    /over size cap/,
  );

  const sneaky = scriptedFetch({
    'https://www.fsis.usda.gov/big.pdf': () => {
      const chunk = new Uint8Array(64 * 1024).fill(0x41);
      chunk.set([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF- so only size can reject
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(chunk); // endless body, no content-length
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      });
    },
  });
  await assert.rejects(
    () =>
      safeFetchBinary('https://www.fsis.usda.gov/big.pdf', {
        ...base,
        maxBytes: 256 * 1024,
        fetchImpl: sneaky.impl,
      }),
    /over size cap/,
  );
});

test('timeouts abort the exchange', async () => {
  const impl = ((input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
    })) as typeof fetch;
  await assert.rejects(
    () =>
      safeFetchBinary('https://www.fsis.usda.gov/slow.pdf', {
        ...base,
        timeoutMs: 30,
        fetchImpl: impl,
      }),
    /timeout after 30ms/,
  );
});

test('error text never carries query strings — signed values stay out of logs', () => {
  assert.equal(
    sanitizeUrlForLog('https://www.fsis.usda.gov/sites/labels.pdf?token=SECRET&sig=abc'),
    'https://www.fsis.usda.gov/sites/labels.pdf',
  );
  assert.equal(sanitizeUrlForLog('::: not a url :::'), '<unparseable url>');
});
