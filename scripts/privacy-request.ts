/**
 * An email privacy request (2026-10-13, proposal §3.2): look up a request
 * code the app created, then carry out the one request it was created for.
 *
 *   npm run privacy:request                                      # dry run: status, purpose, row counts
 *   npm run privacy:request -- --apply --confirm --expect <n>    # APPLY: consume the code and export or delete
 *
 * The code is NEVER an argument: it is asked for at a hidden prompt, so it
 * stays out of the shell history and the process list. Only its SHA-256
 * leaves this machine. The dry run consumes nothing; the apply consumes the
 * code and carries out the request in one server transaction, and refuses
 * (consuming nothing) when the installation's rows changed since the dry run
 * you reviewed. See src/server/privacy-request-operator.ts for what is
 * printed and logged, and docs/recall-operations.md for the procedure.
 *
 * `--out <dir>` sets where the export file and the request log are written
 * (default ~/Lotly-Privacy-Requests). Needs SUPABASE_URL and
 * SUPABASE_SECRET_KEY in .env (server-only secrets).
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  privacyRequestApply,
  privacyRequestDryRun,
  readSecretFromTerminal,
  type OperatorIo,
} from '../src/server/privacy-request-operator';
import {
  applyCommandLine,
  dryRunClosingLine,
  DRY_RUN_DESPITE_ACKNOWLEDGMENTS,
  resolveCountGate,
  resolveFlagValue,
  resolvePositional,
  resolveRepairAuthorization,
  type MutationCommandForm,
} from '../src/server/repair-authorization';
import { createSupabaseServerClient } from '../src/server/store/supabase-store';

const PRIVACY_REQUEST_COMMAND: MutationCommandForm = { script: 'privacy:request' };

const HELP = `
Email privacy request: a copy of the data, or its deletion

  npm run privacy:request                 dry run; asks for the code, consumes nothing
  ${applyCommandLine(PRIVACY_REQUEST_COMMAND)}   APPLY

A request needs every one of:
  --apply          the intent, typed by a human; no package script supplies it
  --confirm        the second acknowledgment
  --expect <n>     the total rows the dry run reported

  --out <dir>      where the export file and request log go (default ~/Lotly-Privacy-Requests)

The request code is asked for at a hidden prompt. Never pass it as an argument.
`;

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment may be configured another way.
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const argv = process.argv.slice(2);

  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    return;
  }

  // ── The authorization contract is resolved FIRST (mutation-cli.test.ts).
  const mode = resolveRepairAuthorization(argv, PRIVACY_REQUEST_COMMAND);
  if (mode.error) {
    console.error(mode.error);
    process.exit(1);
  }
  const out = resolveFlagValue(argv, '--out');
  if (out.error) {
    console.error(out.error);
    process.exit(1);
  }
  // A bare argument is most likely the code itself, typed where it would be
  // kept in the shell history. Refuse before anything else happens.
  if (resolvePositional(argv, ['--out']) !== null) {
    console.error(
      'Unexpected argument. The request code is never passed on the command line ' +
        '(it would stay in your shell history); you will be asked for it.\nNothing was written.',
    );
    process.exit(1);
  }
  if (!mode.apply && (argv.includes('--confirm') || mode.expectedUpdates !== null)) {
    console.log(DRY_RUN_DESPITE_ACKNOWLEDGMENTS);
  }

  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY.');
    process.exit(1);
  }
  const client = createSupabaseServerClient(url, secretKey);
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await client.rpc(name, args);
    // The message only: never the arguments, which carry the code's hash.
    if (error) throw new Error(`${name} failed: ${error.message}`);
    return data as unknown;
  };
  const io: OperatorIo = {
    readSecret: readSecretFromTerminal,
    print: (line) => console.log(line),
    outDir: out.value ?? join(homedir(), 'Lotly-Privacy-Requests'),
    now: () => new Date(),
  };

  console.log(
    `\nPrivacy request: ${mode.apply ? 'APPLY' : 'DRY RUN, nothing will be written or consumed'}\n`,
  );

  if (mode.apply) {
    const result = await privacyRequestApply(rpc, io, mode.expectedUpdates ?? -1);
    process.exit(result.outcome === 'exported' || result.outcome === 'deleted' ? 0 : 1);
  }

  const dry = await privacyRequestDryRun(rpc, io);
  if (dry.status !== 'live' || dry.total === null) process.exit(1);
  const abort = resolveCountGate(mode, dry.total);
  if (abort) {
    console.error(`\n  ${abort.reason}: expected ${abort.expected}, found ${abort.actual}.`);
    process.exit(1);
  }
  console.log(dryRunClosingLine(PRIVACY_REQUEST_COMMAND, dry.total));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Privacy request failed.');
  process.exit(1);
});
