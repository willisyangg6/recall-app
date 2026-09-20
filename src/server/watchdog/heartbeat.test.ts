/**
 * The dead-man heartbeat decision (P2B7S).
 *
 * The property that makes the whole mechanism worth having: a heartbeat is
 * sent only when the DATABASE says both required agency channels are fresh.
 * A heartbeat that merely proves a runner reached its last step would keep
 * the monitor green through an outage.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  AGENCY_JOB_NAME,
  HEARTBEAT_AGENCIES,
  HEARTBEAT_MAX_ATTEMPTS,
  HEARTBEAT_SLO_MINUTES,
  HEARTBEAT_TIMEOUT_MS,
  planHeartbeat,
  redactUrls,
  type HeartbeatConfig,
  type HeartbeatFreshness,
} from './heartbeat';

const OBSERVED = '2026-09-19T20:00:00.000Z';
const OBSERVED_MS = Date.parse(OBSERVED);
const URL_OVERALL = 'https://hc-ping.example/00000000-0000-0000-0000-000000000000';
const URL_FDA = 'https://hc-ping.example/11111111-1111-1111-1111-111111111111';
const URL_FSIS = 'https://hc-ping.example/22222222-2222-2222-2222-222222222222';

const NO_CONFIG: HeartbeatConfig = { overall: null, fda: null, fsis: null };
const OVERALL_ONLY: HeartbeatConfig = { overall: URL_OVERALL, fda: null, fsis: null };
const PER_AGENCY: HeartbeatConfig = { overall: URL_OVERALL, fda: URL_FDA, fsis: URL_FSIS };

function freshness(fdaMinutes: number | null, fsisMinutes: number | null): HeartbeatFreshness {
  const at = (m: number | null) =>
    m === null ? null : new Date(OBSERVED_MS - m * 60_000).toISOString();
  return { observedAt: OBSERVED, fdaCheckedAt: at(fdaMinutes), fsisCheckedAt: at(fsisMinutes) };
}

test('the SLO is the measured operational threshold, and it is purely operational', () => {
  // 90 minutes: two nominal ~45-minute cycles, 33% above the highest age
  // observed over 17.8 days of production (max 67.7m). Nothing derived
  // from it is ever shown to a shopper.
  assert.equal(HEARTBEAT_SLO_MINUTES, 90);
});

test('both agency channels are required, and only the fast ones', () => {
  assert.deepEqual([...HEARTBEAT_AGENCIES], ['fda', 'fsis']);
  assert.deepEqual(AGENCY_JOB_NAME, { fda: 'fda_announcements', fsis: 'fsis_ingest' });
  // The slow channels must never gate or satisfy the alarm: neither
  // decides whether a NEW recall can appear.
  for (const slow of ['fda_enforcement', 'fsis_labels', 'push_delivery']) {
    assert.ok(!Object.values(AGENCY_JOB_NAME).includes(slow), slow);
  }
});

test('both channels fresh pings the overall monitor', () => {
  const plan = planHeartbeat(OVERALL_ONLY, freshness(20, 25));
  assert.equal(plan.action, 'send');
  assert.deepEqual(plan.targets, [{ name: 'overall', url: URL_OVERALL }]);
  assert.deepEqual([...plan.breachedChannels], []);
});

test('ONE stale channel withholds the overall heartbeat', () => {
  // The alarm must fire when FDA has stalled even though FSIS is ticking,
  // which is exactly the failure a per-workflow success signal misses.
  const plan = planHeartbeat(OVERALL_ONLY, freshness(200, 5));
  assert.equal(plan.action, 'withhold');
  assert.deepEqual(plan.targets, []);
  assert.deepEqual([...plan.breachedChannels], ['fda']);
  assert.match(plan.summary, /WITHHELD/);
});

test('a channel with no successful run at all is never counted as healthy', () => {
  const plan = planHeartbeat(OVERALL_ONLY, freshness(null, 5));
  assert.equal(plan.action, 'withhold');
  assert.deepEqual([...plan.breachedChannels], ['fda']);
  assert.match(plan.summary, /fda=no-successful-check/);
});

test('an unreadable server clock withholds rather than assuming freshness', () => {
  const plan = planHeartbeat(OVERALL_ONLY, {
    observedAt: 'not a date',
    fdaCheckedAt: OBSERVED,
    fsisCheckedAt: OBSERVED,
  });
  assert.equal(plan.action, 'withhold');
  assert.deepEqual([...plan.breachedChannels], ['fda', 'fsis']);
});

test('the SLO boundary is inclusive at the threshold minute', () => {
  assert.equal(planHeartbeat(OVERALL_ONLY, freshness(89, 89)).action, 'send');
  assert.equal(planHeartbeat(OVERALL_ONLY, freshness(90, 89)).action, 'withhold');
});

test('per-agency monitors ping independently; the overall one needs both', () => {
  const plan = planHeartbeat(PER_AGENCY, freshness(200, 5));
  assert.equal(plan.action, 'send');
  // FSIS alone is healthy, so its own monitor is told. The overall monitor
  // is NOT, so total-silence detection still alarms.
  assert.deepEqual(plan.targets, [{ name: 'fsis', url: URL_FSIS }]);
});

test('every channel stale with per-agency monitors sends nothing at all', () => {
  const plan = planHeartbeat(PER_AGENCY, freshness(200, 300));
  assert.equal(plan.action, 'withhold');
  assert.deepEqual(plan.targets, []);
});

test('an unconfigured repository is NOT_CONFIGURED, never a quiet success', () => {
  // The two states must never be confused: one means a monitor is watching
  // and happy, the other means nothing is watching at all.
  const plan = planHeartbeat(NO_CONFIG, freshness(5, 5));
  assert.equal(plan.action, 'not_configured');
  assert.deepEqual(plan.targets, []);
  assert.match(plan.summary, /NOT CONFIGURED/);
  assert.match(plan.summary, /no external monitor/);
  assert.ok(!/\bOK\b/.test(plan.summary), 'an unconfigured heartbeat reported OK');
});

test('configuration is decided BEFORE freshness, so unconfigured never reads as withheld', () => {
  const plan = planHeartbeat(NO_CONFIG, freshness(9999, 9999));
  assert.equal(plan.action, 'not_configured');
});

test('a secret that is present but empty counts as unconfigured', () => {
  // Read from the script's `readUrl`, pinned here so an empty repository
  // secret can never be treated as a valid endpoint.
  const script = readFileSync(
    join(__dirname, '..', '..', '..', 'scripts', 'ops-heartbeat.ts'),
    'utf8',
  );
  assert.match(script, /value !== undefined && value\.trim\(\) !== ''/);
});

test('no plan summary can contain a URL', () => {
  // A heartbeat URL is a bearer credential: anyone holding it can forge a
  // healthy ping and silence the alarm permanently.
  for (const plan of [
    planHeartbeat(PER_AGENCY, freshness(5, 5)),
    planHeartbeat(PER_AGENCY, freshness(500, 5)),
    planHeartbeat(NO_CONFIG, freshness(5, 5)),
  ]) {
    assert.ok(!/https?:\/\//.test(plan.summary), plan.summary);
    for (const url of [URL_OVERALL, URL_FDA, URL_FSIS]) {
      assert.ok(!plan.summary.includes(url));
      assert.ok(!plan.summary.includes(url.split('/').pop()!));
    }
  }
});

test('redactUrls strips a URL out of anything about to be logged', () => {
  // `fetch` errors routinely embed the request URL.
  assert.equal(redactUrls(`request to ${URL_OVERALL} failed`), 'request to [redacted-url] failed');
  assert.equal(redactUrls('no url here'), 'no url here');
  assert.ok(!redactUrls(`a ${URL_FDA} b ${URL_FSIS}`).includes('hc-ping'));
});

test('retries and timeout are bounded, so a hung monitor cannot hold the workflow open', () => {
  assert.ok(HEARTBEAT_MAX_ATTEMPTS >= 2 && HEARTBEAT_MAX_ATTEMPTS <= 5);
  assert.ok(HEARTBEAT_TIMEOUT_MS > 0 && HEARTBEAT_TIMEOUT_MS <= 30_000);
});

// ── The script's own guarantees ─────────────────────────────────────────────

const SCRIPT = readFileSync(
  join(__dirname, '..', '..', '..', 'scripts', 'ops-heartbeat.ts'),
  'utf8',
);
const SCRIPT_CODE = SCRIPT.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the heartbeat never fails the workflow', () => {
  // Ingestion has already committed by the time this runs, so a red
  // workflow here could not roll anything back — it would only train the
  // founder to ignore red workflows. The withheld ping is the alarm.
  assert.ok(!/process\.exit\(\s*[1-9]/.test(SCRIPT_CODE), 'the heartbeat exits non-zero');
  assert.ok(!/exitCode\s*=\s*[1-9]/.test(SCRIPT_CODE));
  assert.match(SCRIPT_CODE, /main\(\)\.catch\(/, 'an unexpected throw would fail the run');
});

test('the heartbeat never writes: SELECTs and one POST, nothing else', () => {
  for (const forbidden of ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(']) {
    assert.ok(!SCRIPT_CODE.includes(forbidden), `the heartbeat calls ${forbidden}`);
  }
  assert.match(SCRIPT_CODE, /\.from\('ingest_runs'\)/);
  assert.match(SCRIPT_CODE, /method: 'POST'/);
});

test('freshness comes straight from ingest_runs: no view, no migration, no public surface', () => {
  // The service role this step already holds bypasses RLS, so a database
  // projection would only ever be needed to expose these values to an
  // UNPRIVILEGED reader — and there is none, because the app has no
  // freshness surface. Verified against production 2026-09-19: this query
  // returns HTTP 200 for the service role and HTTP 401 for anon.
  assert.ok(
    !SCRIPT_CODE.includes('consumer_ingest_freshness'),
    'the heartbeat depends on a consumer-facing view again',
  );
  assert.match(SCRIPT_CODE, /\.eq\('job_name', AGENCY_JOB_NAME\[agency\]\)/);
});

test('a lease skip can never establish freshness', () => {
  // Lease-skip rows are outcome-less BY DESIGN and still carry a
  // finished_at, so filtering on finished_at alone would let a job that
  // stood down without doing any work send a healthy heartbeat.
  assert.match(SCRIPT_CODE, /\.in\('outcome', \['succeeded', 'partial'\]\)/);
  assert.match(SCRIPT_CODE, /\.select\('finished_at'\)/);
  assert.ok(!/\.select\('started_at'\)/.test(SCRIPT_CODE), 'started_at overstates freshness');
});

test('a read that fails is not evidence of health', () => {
  // Distinct from "no run found", which is a real breach. Both withhold.
  assert.match(SCRIPT_CODE, /const FAILED = Symbol\('freshness-read-failed'\);/);
  assert.match(SCRIPT_CODE, /if \(fda === FAILED \|\| fsis === FAILED\) \{/);
});

test('the heartbeat verifies freshness from the database, not from having been reached', () => {
  // The whole point. Without this read, reaching the last workflow step
  // would be the signal — and a run whose FDA step failed reaches it too.
  assert.match(SCRIPT_CODE, /planHeartbeat\(config, freshness, HEARTBEAT_SLO_MINUTES\)/);
  assert.match(SCRIPT_CODE, /if \(plan\.action !== 'send'\) return;/);
  assert.match(SCRIPT_CODE, /lastCheckedAt\('fda'\), lastCheckedAt\('fsis'\)/);
});

test('every log line the heartbeat emits is redacted', () => {
  // A single un-redacted console.log would be enough to leak the URL into
  // the run log permanently.
  const logs = [...SCRIPT_CODE.matchAll(/console\.(log|warn|error)\(/g)];
  assert.equal(logs.length, 1, 'the heartbeat logs outside its redacting helper');
  assert.match(
    SCRIPT_CODE,
    /function log\(line: string\): void \{\n\s+console\.log\(redactUrls\(line\)\);/,
  );
});

test('a database read failure withholds the ping instead of sending one', () => {
  const branch = SCRIPT.slice(SCRIPT.indexOf('if (fda === FAILED'));
  assert.match(branch.slice(0, 400), /WITHHELD/);
});

test('the URL is read only from HEARTBEAT_URL and its per-agency siblings', () => {
  const names = [...SCRIPT_CODE.matchAll(/readUrl\('([A-Z_]+)'\)/g)].map((m) => m[1]);
  assert.deepEqual(names, ['HEARTBEAT_URL', 'HEARTBEAT_FDA_URL', 'HEARTBEAT_FSIS_URL']);
});

test('the request carries a bounded timeout', () => {
  assert.match(SCRIPT_CODE, /AbortSignal\.timeout\(HEARTBEAT_TIMEOUT_MS\)/);
});
