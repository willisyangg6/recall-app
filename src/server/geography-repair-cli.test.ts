/**
 * The geography repair's AUTHORIZATION CONTRACT, proved at the boundary an
 * operator actually types (P2B7Q.2 correction).
 *
 * The defect this file exists to prevent already happened once: the package
 * script `repair:geography` was `tsx scripts/repair-geography.ts --apply`, so
 * typing only `--confirm --expect 61` after it applied to production without
 * anyone typing the word "apply", and the command printed in the docs did not
 * match the three-flag contract printed beside it. A contract the package
 * script can complete on the operator's behalf is not a contract.
 *
 * Four things are pinned here, and all four are about the shape of the command
 * rather than the behaviour of the repair (which `geography-repair.test.ts`
 * covers):
 *
 *   1. no package script supplies `--apply`, for the repair or the rollback;
 *   2. the flag contract is resolved and refused BEFORE a write-capable
 *      database client is constructed;
 *   3. the rollback does not synthesize `--apply` for itself;
 *   4. every command string in the CLI, the README and the operations runbook
 *      is the same command.
 *
 * P2B7T generalized all four to EVERY mutation CLI in `mutation-cli.test.ts`,
 * which enumerates them from disk. What stays here is what is specific to this
 * repair: its rollback, and its ledger path.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { GEOGRAPHY_REPAIR_COMMAND } from './geography-repair';
import {
  resolvePositional,
  resolveRepairAuthorization,
  DRY_RUN_DESPITE_ACKNOWLEDGMENTS,
} from './repair-authorization';

/** This repair, resolved through the one shared contract. */
const resolveGeographyRepairMode = (argv: string[]) =>
  resolveRepairAuthorization(argv, GEOGRAPHY_REPAIR_COMMAND);

const CLI = readFileSync('scripts/repair-geography.ts', 'utf8');
const PACKAGE: { scripts: Record<string, string> } = JSON.parse(
  readFileSync('package.json', 'utf8'),
);

test('no package script supplies --apply for the geography repair', () => {
  for (const name of ['repair:geography', 'repair:geography:dry', 'repair:geography:rollback']) {
    const script = PACKAGE.scripts[name];
    assert.ok(script, `${name} is missing from package.json`);
    assert.ok(
      !script.includes('--apply'),
      `${name} = "${script}" — a package script may never carry --apply: it hands the ` +
        'operator an authorization they did not type',
    );
  }
  // And the base command really is the same entry point as the dry run, so
  // "running it with no apply flag" is a dry run rather than a second mode.
  assert.equal(PACKAGE.scripts['repair:geography'], 'tsx scripts/repair-geography.ts');
  assert.equal(PACKAGE.scripts['repair:geography:dry'], 'tsx scripts/repair-geography.ts');
});

test('the flag contract is refused before a write-capable client is constructed', () => {
  const main = CLI.slice(CLI.indexOf('async function main('));
  const refusal = main.indexOf('if (mode.error)');
  const client = main.indexOf('createSupabaseServerClient(');
  assert.ok(refusal > 0, 'the CLI no longer resolves a mode');
  assert.ok(client > 0, 'the CLI no longer constructs a store');
  assert.ok(
    refusal < client,
    'the authorization refusal must precede the database client, so a missing ' +
      '--apply/--confirm/--expect cannot reach a write-capable connection',
  );
  // The ledger path is resolved in the same pre-connection block.
  assert.ok(main.indexOf('Rollback needs the apply ledger path') < client);
});

test('the rollback does not synthesize its own --apply', () => {
  assert.ok(
    !/resolveGeographyRepairMode\(\[[^)]*'--apply'/.test(CLI),
    'the CLI appends --apply to its own argv somewhere: a rollback write must ' +
      'be authorized by the operator, exactly like an apply',
  );
  const rollbackStart = CLI.indexOf('async function runRollback');
  const rollback = CLI.slice(rollbackStart, CLI.indexOf('async function main(', rollbackStart));
  assert.ok(
    !rollback.includes('resolveGeographyRepairMode'),
    'runRollback resolves its own mode again instead of receiving the one the ' +
      'operator authorized',
  );
});

test('a rollback write needs the same three flags an apply needs', () => {
  // The rollback path shares the resolver, so the contract is one contract.
  assert.equal(resolveGeographyRepairMode(['--confirm', '--expect', '3']).apply, false);
  assert.equal(resolveGeographyRepairMode(['--apply', '--confirm', '--expect', '3']).apply, true);
});

test('two thirds of the contract is a dry run, never a write', () => {
  const mode = resolveGeographyRepairMode(['--confirm', '--expect', '61']);
  assert.equal(mode.apply, false);
  assert.equal(mode.error, null);
  assert.equal(mode.expectedUpdates, 61, 'the count still gates the dry run');
  // And the operator is told, so nobody believes they applied.
  assert.match(CLI, /DRY_RUN_DESPITE_ACKNOWLEDGMENTS/);
  assert.match(DRY_RUN_DESPITE_ACKNOWLEDGMENTS, /--confirm\/--expect were given WITHOUT --apply/);
  assert.match(DRY_RUN_DESPITE_ACKNOWLEDGMENTS, /Nothing was written/);
});

test('a flag value is never mistaken for the rollback ledger path', () => {
  // `--expect 61 ledger.json` must find ledger.json, not "61".
  assert.equal(resolvePositional(['--expect', '61', 'ledger.json'], VALUE_FLAGS), 'ledger.json');
  assert.equal(
    resolvePositional(['--json', 'out.json', '--expect', '61', 'ledger.json'], VALUE_FLAGS),
    'ledger.json',
  );
  // And the CLI really passes its own value flags to that resolver.
  assert.match(CLI, /const VALUE_FLAGS = \['--json', '--expect'\]/);
  assert.match(CLI, /resolvePositional\(argv, VALUE_FLAGS\)/);
});

/** The value flags the geography CLI declares, kept in step with the CLI. */
const VALUE_FLAGS = ['--json', '--expect'];

test('the CLI, the README and the runbook print the SAME apply command', () => {
  const APPLY = 'npm run repair:geography -- --apply --confirm --expect';
  const DRY = 'npm run repair:geography:dry';
  const ROLLBACK = 'npm run repair:geography:rollback -- <ledger.json> --apply --confirm --expect';
  for (const file of ['scripts/repair-geography.ts', 'README.md', 'docs/recall-operations.md']) {
    const source = readFileSync(file, 'utf8');
    assert.ok(source.includes(APPLY), `${file} does not print the apply command`);
    assert.ok(source.includes(DRY), `${file} does not print the dry-run command`);
    // No document may print an apply command that omits --apply.
    assert.ok(
      !/npm run repair:geography -- --confirm/.test(source),
      `${file} prints an apply command with no --apply in it`,
    );
  }
  assert.ok(readFileSync('docs/recall-operations.md', 'utf8').includes(ROLLBACK));
});
