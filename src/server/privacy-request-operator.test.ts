/**
 * `npm run privacy:request` (2026-10-13): what the operator flow sends,
 * prints, writes and logs, against a fake service-role RPC. The real
 * database behaviour (single use, expiry, isolation, the count gate) is in
 * push/privacy-requests-live.test.ts.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  appendRequestLog,
  pruneRequestLog,
  REQUEST_LOG_RETENTION_MONTHS,
  requestLogCutoff,
  privacyRequestApply,
  privacyRequestDryRun,
  requestCodeHash,
  type OperatorIo,
  type OperatorRpc,
} from './privacy-request-operator';

const CODE = '7K3M-QX9P-2HTB';
const HASH = createHash('sha256').update('7K3MQX9P2HTB', 'utf8').digest('hex');
const INSTALLATION = 'abcd1234-5678-4abc-9def-0123456789ab';
const ALLERGEN = 'sesame';

function harness(answer: unknown) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const printed: string[] = [];
  const outDir = mkdtempSync(join(tmpdir(), 'privacy-request-'));
  const rpc: OperatorRpc = async (name, args) => {
    calls.push({ name, args });
    return answer;
  };
  const io: OperatorIo = {
    readSecret: async () => CODE,
    print: (line) => printed.push(line),
    outDir,
    now: () => new Date('2026-10-13T12:00:00Z'),
  };
  return { calls, printed, outDir, rpc, io };
}

/** Nothing secret or sensitive in anything the operator sees or keeps. */
function assertClean(text: string) {
  for (const secret of [CODE, CODE.replace(/-/g, ''), HASH, INSTALLATION, ALLERGEN]) {
    assert.ok(!text.includes(secret), `leaked ${secret}`);
  }
}

const EXPORT = {
  exported_at: '2026-10-13T12:00:00Z',
  preferences: { state_codes: ['CA'], allergens: [ALLERGEN], retailer_ids: [] },
  push_registrations: [],
  alert_order: null,
  alerts_sent: [],
  last_opened_on: '2026-10-13',
  shopper_reports: [],
  request_codes: [{ purpose: 'access' }],
};
const COUNTS = {
  preferences: 1,
  push_registrations: 0,
  alerts_sent: 0,
  alert_order: 0,
  last_opened: 1,
  shopper_reports: 0,
  request_codes: 1,
  total: 3,
};

test('the hash is SHA-256 of the canonical code, however the code was written', () => {
  assert.equal(requestCodeHash(CODE), HASH);
  assert.equal(requestCodeHash(' 7k3m qx9p 2htb'), HASH);
  assert.equal(requestCodeHash('not a code'), null);
});

test('a dry run sends only the hash, reads only, and prints counts and a 4-character hint', async () => {
  const h = harness({
    status: 'live',
    purpose: 'access',
    installation_hint: 'abcd',
    created_at: '2026-10-13T10:00:00Z',
    expires_at: '2026-10-27T10:00:00Z',
    used_at: null,
    counts: COUNTS,
  });
  const result = await privacyRequestDryRun(h.rpc, h.io);
  assert.deepEqual(result, { status: 'live', purpose: 'access', total: 3 });
  assert.deepEqual(h.calls, [{ name: 'lookup_privacy_request', args: { p_code_hash: HASH } }]);
  const out = h.printed.join('\n');
  assert.match(out, /abcd… \(first 4 characters\)/);
  assert.match(out, /Total rows:\s+3/);
  assertClean(out.replace(/abcd…/, ''));
  assert.ok(!out.includes(HASH));
});

test('a malformed code is refused before any lookup', async () => {
  const h = harness(null);
  h.io.readSecret = async () => 'ABCD-EFGH';
  assert.equal((await privacyRequestDryRun(h.rpc, h.io)).status, 'malformed');
  assert.equal((await privacyRequestApply(h.rpc, h.io, 3)).outcome, 'malformed');
  assert.equal(h.calls.length, 0);
});

test('used, expired and unknown codes stop at the dry run with no apply total', async () => {
  for (const status of ['used', 'expired'] as const) {
    const h = harness({ status, purpose: 'delete', installation_hint: 'abcd', used_at: null });
    const result = await privacyRequestDryRun(h.rpc, h.io);
    assert.equal(result.status, status);
    assert.equal(result.total, null);
  }
  const unknown = harness({ status: 'unknown' });
  assert.deepEqual(await privacyRequestDryRun(unknown.rpc, unknown.io), {
    status: 'unknown',
    purpose: null,
    total: null,
  });
});

test('an access apply writes a private export file and logs date, purpose and outcome only', async () => {
  const h = harness({ status: 'redeemed', purpose: 'access', counts: COUNTS, export: EXPORT });
  const result = await privacyRequestApply(h.rpc, h.io, 3);
  assert.equal(result.outcome, 'exported');
  assert.deepEqual(h.calls, [
    { name: 'redeem_privacy_request', args: { p_code_hash: HASH, p_expected_rows: 3 } },
  ]);
  const file = result.exportPath as string;
  assert.equal(statSync(file).mode & 0o777, 0o600, 'the export is readable by the operator only');
  const written = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(written.format, 'lotly-server-data/2');
  assert.deepEqual(written.server_data.preferences.allergens, [ALLERGEN]);
  // The data is in the file for the requester, and nowhere else.
  assertClean(h.printed.join('\n'));
  const log = readFileSync(join(h.outDir, 'request-log.csv'), 'utf8');
  assert.equal(log, 'date,purpose,outcome\n2026-10-13,access,exported\n');
});

test('a delete apply reports counts and logs the deletion', async () => {
  const h = harness({ status: 'redeemed', purpose: 'delete', counts: COUNTS });
  assert.equal((await privacyRequestApply(h.rpc, h.io, 3)).outcome, 'deleted');
  assert.match(h.printed.join('\n'), /Deleted:\s+preferences 1/);
  assertClean(h.printed.join('\n'));
  assert.match(
    readFileSync(join(h.outDir, 'request-log.csv'), 'utf8'),
    /2026-10-13,delete,deleted\n$/,
  );
});

test('a refused apply says nothing was consumed, and the log records the refusal', async () => {
  const changed = harness({ status: 'count_changed', expected: 3, actual: 4 });
  assert.equal((await privacyRequestApply(changed.rpc, changed.io, 3)).outcome, 'count_changed');
  assert.match(changed.printed.join('\n'), /Nothing was consumed or changed/);
  assert.match(
    readFileSync(join(changed.outDir, 'request-log.csv'), 'utf8'),
    /,unknown,refused-count-changed\n$/,
  );

  const gone = harness({ status: 'not_redeemable' });
  assert.equal((await privacyRequestApply(gone.rpc, gone.io, 3)).outcome, 'not_redeemable');
  assertClean(readFileSync(join(gone.outDir, 'request-log.csv'), 'utf8'));
});

test('the CLI never takes the code as an argument and never logs RPC arguments', () => {
  const script = readFileSync('scripts/privacy-request.ts', 'utf8');
  assert.match(script, /resolvePositional\(argv, \['--out'\]\) !== null/);
  assert.ok(!/--code/.test(script), 'no --code flag exists');
  assert.ok(!/console\.\w+\([^)]*args/.test(script), 'RPC arguments are never printed');
  const operator = readFileSync('src/server/privacy-request-operator.ts', 'utf8');
  assert.ok(!/console\./.test(operator), 'the operator module prints only through io.print');
});

test('the request log expires: every run removes lines older than 24 months', () => {
  assert.equal(REQUEST_LOG_RETENTION_MONTHS, 24);
  assert.equal(requestLogCutoff(new Date('2026-10-13T12:00:00Z')), '2024-10-13');
  const outDir = mkdtempSync(join(tmpdir(), 'privacy-log-'));
  const path = join(outDir, 'request-log.csv');
  writeFileSync(
    path,
    'date,purpose,outcome\n' +
      '2024-10-12,access,exported\n' + // one day past 24 months: removed
      '2024-10-13,delete,deleted\n' + // exactly 24 months: kept
      '2026-01-02,access,refused-not-redeemable\n' +
      'not a log line with a code 7K3MQX9P2HTB\n', // only the three fields may stay
  );
  const printed: string[] = [];
  appendRequestLog(
    { outDir, now: () => new Date('2026-10-13T12:00:00Z'), print: (line) => printed.push(line) },
    'delete',
    'deleted',
  );
  assert.equal(
    readFileSync(path, 'utf8'),
    'date,purpose,outcome\n2024-10-13,delete,deleted\n2026-01-02,access,refused-not-redeemable\n' +
      '2026-10-13,delete,deleted\n',
  );
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.match(printed.join('\n'), /removed 2 line\(s\) older than 24 months/);
  // A log with nothing expired is left byte-identical.
  const before = readFileSync(path, 'utf8');
  assert.equal(pruneRequestLog(path, new Date('2026-10-13T23:59:00Z')), 0);
  assert.equal(readFileSync(path, 'utf8'), before);
});
