/**
 * The operator side of an email privacy request (2026-10-13, proposal §3.2):
 * `npm run privacy:request`. Node-only.
 *
 * A request arrives by email with a request code the app created. The
 * operator types the code at a hidden prompt; this module hashes it locally
 * (SHA-256 of the canonical form, exactly what the server stored) and sends
 * ONLY the hash. Then:
 *
 *   dry run (the default)   `lookup_privacy_request`: the code's status, the
 *                           purpose chosen in the app, the installation's
 *                           first four characters, and row counts. Writes
 *                           nothing, consumes nothing.
 *   apply                   `redeem_privacy_request`: one transaction that
 *                           consumes the code (single use) and carries out
 *                           the request: the export, written to a local
 *                           0600 file to attach to the reply, or
 *                           `delete_installation_data`. The server refuses
 *                           when the rows changed since the reviewed dry run
 *                           (the --expect count), consuming nothing.
 *
 * What never reaches a log, the terminal or the shell history: the code (it
 * is read from a hidden prompt, never an argument), its hash, the
 * installation id (the server returns only a four-character hint), and any
 * preference contents (only counts are printed; the export goes to a file).
 * Each run appends one line to the request log: date, purpose, outcome.
 * Each run also removes log lines older than REQUEST_LOG_RETENTION_MONTHS,
 * so the log expires on its own whenever the tool is used.
 */

import { createHash, randomBytes } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  buildExportDocument,
  normalizeRequestCode,
  parseServerDataExport,
  type RequestPurpose,
} from '../lib/privacy-requests';

/** The SHA-256 the server stores, from a code as the requester wrote it. */
export function requestCodeHash(input: string): string | null {
  const code = normalizeRequestCode(input);
  return code === null ? null : createHash('sha256').update(code, 'utf8').digest('hex');
}

/** One service-role RPC call; the CLI passes supabase-js, the tests a fake. */
export type OperatorRpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export interface OperatorIo {
  /** Prompts with echo off and returns the typed line. */
  readSecret(prompt: string): Promise<string>;
  print(line: string): void;
  /** Where exports and the request log go. */
  outDir: string;
  now(): Date;
}

export const PURPOSE_DESCRIPTION: Record<RequestPurpose, string> = {
  access: 'access: email a copy of the data',
  delete: 'delete: delete the data',
};

const COUNT_LABELS: [string, string][] = [
  ['preferences', 'preferences'],
  ['push_registrations', 'push registrations'],
  ['alerts_sent', 'alerts sent'],
  ['alert_order', 'alert order'],
  ['last_opened', 'last opened'],
  ['shopper_reports', 'shopper reports'],
  ['request_codes', 'request codes'],
];

function describeCounts(counts: Record<string, unknown>): string {
  return COUNT_LABELS.map(([key, label]) => `${label} ${Number(counts[key] ?? 0)}`).join(', ');
}

function isPurpose(value: unknown): value is RequestPurpose {
  return value === 'access' || value === 'delete';
}

function day(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 10) : 'unknown';
}

/**
 * How long a request-log line is kept: 24 months (2026-10-13). This is the
 * PROPOSED retention in the privacy program proposal (§8, decision 4), not
 * yet a published policy. The tool enforces it mechanically: every run first
 * removes lines older than this, so nothing older survives the next use. A
 * log that is never opened again is not touched (it lives on the operator's
 * machine, out of reach of any scheduled job).
 */
export const REQUEST_LOG_RETENTION_MONTHS = 24;

const LOG_HEADER = 'date,purpose,outcome';

/** The first day still kept: the same calendar day 24 months before `now`. */
export function requestLogCutoff(now: Date): string {
  const cutoff = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() - REQUEST_LOG_RETENTION_MONTHS,
      now.getUTCDate(),
    ),
  );
  return cutoff.toISOString().slice(0, 10);
}

/**
 * Removes expired lines, keeping the header and every line dated on or after
 * the cutoff. A line that is not a dated log line is dropped too: the log may
 * hold only the three minimal fields. Rewritten through a temporary file and
 * a rename, so an interruption leaves the old or the new log, never half.
 */
export function pruneRequestLog(path: string, now: Date): number {
  if (!existsSync(path)) return 0;
  const cutoff = requestLogCutoff(now);
  const lines = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0);
  const kept = lines.filter(
    (line) =>
      line !== LOG_HEADER &&
      /^\d{4}-\d{2}-\d{2},(access|delete|unknown),[a-z-]+$/.test(line) &&
      line.slice(0, 10) >= cutoff,
  );
  const removed = lines.filter((line) => line !== LOG_HEADER).length - kept.length;
  if (removed > 0) {
    const temp = `${path}.tmp`;
    writeFileSync(temp, [LOG_HEADER, ...kept].join('\n') + '\n', { mode: 0o600 });
    renameSync(temp, path);
  }
  return removed;
}

/**
 * The request log: one line per run, never a code or an installation id.
 * Expired lines are removed first.
 */
export function appendRequestLog(
  io: Pick<OperatorIo, 'outDir' | 'now'> & Partial<Pick<OperatorIo, 'print'>>,
  purpose: RequestPurpose | 'unknown',
  outcome: string,
): string {
  mkdirSync(io.outDir, { recursive: true, mode: 0o700 });
  const path = join(io.outDir, 'request-log.csv');
  const removed = pruneRequestLog(path, io.now());
  if (removed > 0) {
    io.print?.(
      `  Request log:   removed ${removed} line(s) older than ${REQUEST_LOG_RETENTION_MONTHS} months.`,
    );
  }
  if (!existsSync(path)) appendFileSync(path, `${LOG_HEADER}\n`, { mode: 0o600 });
  appendFileSync(path, `${io.now().toISOString().slice(0, 10)},${purpose},${outcome}\n`);
  return path;
}

async function promptForHash(io: OperatorIo): Promise<string | null> {
  const typed = await io.readSecret('Request code (hidden): ');
  const hash = requestCodeHash(typed);
  if (hash === null) {
    io.print(
      'That is not a request code: 12 characters from 0-9 and A-Z without I, L, O, U ' +
        '(spaces and hyphens are ignored). Nothing was looked up.',
    );
  }
  return hash;
}

export interface DryRunResult {
  status: 'live' | 'used' | 'expired' | 'unknown' | 'malformed';
  purpose: RequestPurpose | null;
  total: number | null;
}

/** The default. Reads only; consumes nothing. */
export async function privacyRequestDryRun(
  rpc: OperatorRpc,
  io: OperatorIo,
): Promise<DryRunResult> {
  const hash = await promptForHash(io);
  if (hash === null) return { status: 'malformed', purpose: null, total: null };

  const answer = (await rpc('lookup_privacy_request', { p_code_hash: hash })) as Record<
    string,
    unknown
  > | null;
  const status = answer?.status;
  if (status !== 'live' && status !== 'used' && status !== 'expired') {
    io.print('  Code status:   no request code matches. Check it was copied exactly.');
    return { status: 'unknown', purpose: null, total: null };
  }
  const purpose = isPurpose(answer?.purpose) ? answer.purpose : null;
  io.print(`  Code status:   ${status}`);
  io.print(`  Request:       ${purpose ? PURPOSE_DESCRIPTION[purpose] : 'unknown'}`);
  io.print(`  Installation:  ${String(answer?.installation_hint ?? '????')}… (first 4 characters)`);
  io.print(`  Created:       ${day(answer?.created_at)}   Expires: ${day(answer?.expires_at)}`);
  if (status === 'used') {
    io.print(`  Used:          ${day(answer?.used_at)}. A code works once; ask for a new one.`);
    return { status, purpose, total: null };
  }
  if (status === 'expired') {
    io.print('  The code has expired. Reply asking for a new one from the app.');
    return { status, purpose, total: null };
  }
  const counts = (answer?.counts ?? {}) as Record<string, unknown>;
  const total = Number(counts.total ?? 0);
  io.print(`  Rows held:     ${describeCounts(counts)}`);
  io.print(`  Total rows:    ${total}`);
  return { status, purpose, total };
}

export interface ApplyResult {
  outcome: 'exported' | 'deleted' | 'count_changed' | 'not_redeemable' | 'malformed';
  exportPath?: string;
}

/** Consumes the code and carries out the request, or changes nothing. */
export async function privacyRequestApply(
  rpc: OperatorRpc,
  io: OperatorIo,
  expectedRows: number,
): Promise<ApplyResult> {
  const hash = await promptForHash(io);
  if (hash === null) return { outcome: 'malformed' };

  const answer = (await rpc('redeem_privacy_request', {
    p_code_hash: hash,
    p_expected_rows: expectedRows,
  })) as Record<string, unknown> | null;
  const purpose = isPurpose(answer?.purpose) ? answer.purpose : 'unknown';

  if (answer?.status === 'count_changed') {
    io.print(
      `  Refused: the installation now holds ${Number(answer.actual)} rows, not the ` +
        `${Number(answer.expected)} you reviewed. Nothing was consumed or changed. Run the dry run again.`,
    );
    appendRequestLog(io, purpose, 'refused-count-changed');
    return { outcome: 'count_changed' };
  }
  if (answer?.status !== 'redeemed' || purpose === 'unknown') {
    io.print(
      '  Refused: no live request code matches (unknown, used or expired). Nothing changed.',
    );
    appendRequestLog(io, purpose, 'refused-not-redeemable');
    return { outcome: 'not_redeemable' };
  }

  const counts = (answer.counts ?? {}) as Record<string, unknown>;
  if (purpose === 'delete') {
    io.print(`  Deleted:       ${describeCounts(counts)}`);
    io.print('  The code is used. Reply confirming the deletion.');
    appendRequestLog(io, purpose, 'deleted');
    return { outcome: 'deleted' };
  }

  const data = parseServerDataExport(answer.export);
  if (!data) throw new Error('The server returned an export in an unexpected shape.');
  mkdirSync(io.outDir, { recursive: true, mode: 0o700 });
  const exportPath = join(
    io.outDir,
    `lotly-data-${io.now().toISOString().slice(0, 10)}-${randomBytes(3).toString('hex')}.json`,
  );
  writeFileSync(exportPath, `${JSON.stringify(buildExportDocument(data), null, 2)}\n`, {
    mode: 0o600,
  });
  io.print(`  Exported:      ${describeCounts(counts)}`);
  io.print(`  File:          ${exportPath}`);
  io.print('  Attach it to the reply, then delete the file. The code is used.');
  appendRequestLog(io, purpose, 'exported');
  return { outcome: 'exported', exportPath };
}

/**
 * A secret prompt on a terminal: echo off, the line returned. Off a
 * terminal (a pipe, a test), the first line of stdin.
 */
export function readSecretFromTerminal(prompt: string): Promise<string> {
  const stdin = process.stdin;
  process.stdout.write(prompt);
  return new Promise((resolve, reject) => {
    let typed = '';
    const finish = (value: string) => {
      stdin.removeListener('data', onData);
      stdin.removeListener('end', onEnd);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
      resolve(value);
    };
    const onEnd = () => finish(typed);
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') {
          if (stdin.isTTY) stdin.setRawMode(false);
          reject(new Error('Cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish(typed);
          return;
        }
        if (character === '\u007f' || character === '\b') typed = typed.slice(0, -1);
        else typed += character;
      }
    };
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.on('data', onData);
    stdin.on('end', onEnd);
    stdin.resume();
  });
}
