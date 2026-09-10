/**
 * P1C request/response pins for the shopper-report client path, driven
 * through the real module against a recording fetch (same harness as
 * recall-feed-requests.test.ts): each call hits exactly its RPC with the
 * publishable key, sends only the authorized fields, passes every response
 * through the domain sanitizers, and surfaces failures as errors — a
 * malformed echo can degrade what the app sees but never fabricate it.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

// The module reads EXPO_PUBLIC_* at import time, and static imports hoist
// above any assignment — so the env is pinned first and the module loaded
// dynamically, exactly the way the QA scripts do it.
const loaded = (async () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example-test.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
  return import('./report-api');
})();

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const INSTALLATION = 'installation-aaaa-0001';

const SERVER_REPORT = {
  stateCode: 'CA',
  retailerName: 'Costco Wholesale',
  purchaseWindow: 'past_week',
  version: 1,
  createdAt: '2026-09-10T12:00:00.000Z',
  updatedAt: '2026-09-10T12:00:00.000Z',
};

function recordingFetch(handler: (url: string, body: unknown) => unknown) {
  const calls: { url: string; body: unknown; headers: Record<string, string> }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body, headers: (init?.headers ?? {}) as Record<string, string> });
    const result = handler(url, body);
    if (result instanceof Error) throw result;
    if (typeof result === 'number') return new Response('', { status: result });
    return new Response(JSON.stringify(result), { status: 200 });
  }) as typeof fetch;
  return calls;
}

test('submit posts the five authorized fields to its RPC and returns the sanitized report', async () => {
  const { submitShopperReport } = await loaded;
  const calls = recordingFetch(() => SERVER_REPORT);
  const report = await submitShopperReport({
    installationId: INSTALLATION,
    caseId: CASE_ID,
    stateCode: 'CA',
    retailerName: 'Costco Wholesale',
    purchaseWindow: 'past_week',
  });
  assert.deepEqual(report, SERVER_REPORT);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/submit_shopper_report$/);
  assert.equal(calls[0].headers.apikey, 'test-publishable-key');
  // Exactly the authorized fields — no field exists to carry anything else.
  assert.deepEqual(calls[0].body, {
    p_installation_id: INSTALLATION,
    p_case_id: CASE_ID,
    p_state_code: 'CA',
    p_retailer_name: 'Costco Wholesale',
    p_purchase_window: 'past_week',
  });
});

test('a malformed submit echo is an error, never a fabricated report', async () => {
  const { submitShopperReport } = await loaded;
  recordingFetch(() => ({ status: 'weird' }));
  await assert.rejects(
    submitShopperReport({
      installationId: INSTALLATION,
      caseId: CASE_ID,
      stateCode: 'CA',
      retailerName: null,
      purchaseWindow: 'past_week',
    }),
    /not understood/,
  );
});

test('a server refusal surfaces as an error with the HTTP status', async () => {
  const { submitShopperReport } = await loaded;
  recordingFetch(() => 400);
  await assert.rejects(
    submitShopperReport({
      installationId: INSTALLATION,
      caseId: CASE_ID,
      stateCode: 'TX',
      retailerName: null,
      purchaseWindow: 'past_week',
    }),
    /HTTP 400/,
  );
});

test('get-my-report hits its RPC and null (no report) passes through as null', async () => {
  const { fetchMyShopperReport } = await loaded;
  const calls = recordingFetch(() => null);
  assert.equal(await fetchMyShopperReport(INSTALLATION, CASE_ID), null);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/get_my_shopper_report$/);
  assert.deepEqual(calls[0].body, { p_installation_id: INSTALLATION, p_case_id: CASE_ID });

  recordingFetch(() => SERVER_REPORT);
  assert.deepEqual(await fetchMyShopperReport(INSTALLATION, CASE_ID), SERVER_REPORT);
});

test('withdraw posts only the identity pair and resolves on success', async () => {
  const { withdrawShopperReport } = await loaded;
  const calls = recordingFetch(() => null);
  await withdrawShopperReport(INSTALLATION, CASE_ID);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/withdraw_shopper_report$/);
  assert.deepEqual(calls[0].body, { p_installation_id: INSTALLATION, p_case_id: CASE_ID });
});

test('the summary call carries only the case id and sanitizes every shape', async () => {
  const { fetchShopperReportSummary } = await loaded;
  const calls = recordingFetch(() => ({ status: 'below_threshold' }));
  assert.deepEqual(await fetchShopperReportSummary(CASE_ID), { status: 'below_threshold' });
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/get_shopper_report_summary$/);
  // No installation id on the public read: the summary is not per-caller.
  assert.deepEqual(calls[0].body, { p_case_id: CASE_ID });

  recordingFetch(() => ({ status: 'reported', count: 7 }));
  assert.deepEqual(await fetchShopperReportSummary(CASE_ID), { status: 'reported', count: 7 });

  // A sub-threshold "reported" echo degrades to unavailable (never shown).
  recordingFetch(() => ({ status: 'reported', count: 1 }));
  assert.deepEqual(await fetchShopperReportSummary(CASE_ID), { status: 'unavailable' });
});
