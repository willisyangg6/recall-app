/**
 * The shared authorization contract, permutation by permutation (P2B7T).
 *
 * Every production mutation CLI resolves through `resolveRepairAuthorization`,
 * so these cases are the contract for ALL of them at once — the drift that
 * P2B7Q.2 uncovered (four hand-rolled versions of "the contract" disagreeing
 * about what authorization meant) cannot come back while this is the only
 * resolver and mutation-cli.test.ts proves every CLI uses it.
 *
 * The bar throughout: an ambiguous or malformed command is REFUSED, never
 * resolved into a guess. A refusal is `error !== null`, which every CLI turns
 * into exit code 1 before constructing anything.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyCommandLine,
  dryRunClosingLine,
  resolveFlagValue,
  resolvePositional,
  resolveRepairAuthorization,
} from './repair-authorization';

const FORM = { script: 'repair:example' };

const resolve = (...argv: string[]) => resolveRepairAuthorization(argv, FORM);

test('the default — no flags at all — is a read-only dry run', () => {
  const mode = resolve();
  assert.equal(mode.apply, false);
  assert.equal(mode.error, null);
  assert.equal(mode.expectedUpdates, null);
});

test('all three flags, typed, authorize the write', () => {
  const mode = resolve('--apply', '--confirm', '--expect', '61');
  assert.equal(mode.apply, true);
  assert.equal(mode.error, null);
  assert.equal(mode.expectedUpdates, 61);
});

test('every missing-flag permutation fails closed or stays a dry run', () => {
  // --apply present but incomplete: refused outright.
  for (const argv of [['--apply'], ['--apply', '--confirm'], ['--apply', '--expect', '3']]) {
    const mode = resolveRepairAuthorization(argv, FORM);
    assert.equal(mode.apply, false, `${argv.join(' ')} must not apply`);
    assert.ok(mode.error, `${argv.join(' ')} must be refused`);
    assert.match(mode.error, /Nothing was written\./);
  }

  // --apply absent: a dry run, never an error, whatever else was typed.
  for (const argv of [[], ['--confirm'], ['--expect', '3'], ['--confirm', '--expect', '3']]) {
    const mode = resolveRepairAuthorization(argv, FORM);
    assert.equal(mode.apply, false, `${argv.join(' ')} must not apply`);
    assert.equal(mode.error, null, `${argv.join(' ')} is a legitimate dry run`);
  }
});

test('the muscle-memory command — --confirm --expect with no --apply — is a dry run', () => {
  // This is exactly what an operator typed while package.json was supplying
  // --apply for them. It must now write nothing and keep the count.
  const mode = resolve('--confirm', '--expect', '61');
  assert.equal(mode.apply, false);
  assert.equal(mode.error, null);
  assert.equal(mode.expectedUpdates, 61, 'the reviewed count still gates the dry run');
});

test('a refusal names the exact command that would have worked', () => {
  const mode = resolve('--apply', '--expect', '3');
  assert.match(mode.error!, /npm run repair:example -- --apply --confirm --expect <n>/);
});

test('--apply and --dry-run contradict each other and are refused', () => {
  const mode = resolve('--apply', '--confirm', '--expect', '3', '--dry-run');
  assert.equal(mode.apply, false);
  assert.match(mode.error!, /contradict/);
});

test('a duplicated authorization flag is refused, never resolved', () => {
  // `--expect 5 --expect 900` must not silently authorize either count.
  for (const argv of [
    ['--apply', '--apply', '--confirm', '--expect', '5'],
    ['--apply', '--confirm', '--confirm', '--expect', '5'],
    ['--apply', '--confirm', '--expect', '5', '--expect', '900'],
    ['--dry-run', '--dry-run'],
  ]) {
    const mode = resolveRepairAuthorization(argv, FORM);
    assert.equal(mode.apply, false, `${argv.join(' ')} must not apply`);
    assert.match(mode.error!, /more than once/, `${argv.join(' ')} must be refused as ambiguous`);
  }
});

test('reordering the flags never changes the decision', () => {
  const orders = [
    ['--apply', '--confirm', '--expect', '7'],
    ['--confirm', '--apply', '--expect', '7'],
    ['--expect', '7', '--apply', '--confirm'],
    ['--confirm', '--expect', '7', '--apply'],
    ['--expect', '7', '--confirm', '--apply'],
    ['--apply', '--expect', '7', '--confirm'],
  ];
  for (const argv of orders) {
    const mode = resolveRepairAuthorization(argv, FORM);
    assert.equal(mode.apply, true, `${argv.join(' ')} is the same authorization`);
    assert.equal(mode.expectedUpdates, 7);
    assert.equal(mode.error, null);
  }
  // And a reorder that separates --expect from its value is refused, not read
  // as some other flag's argument.
  const broken = resolve('--apply', '--expect', '--confirm', '7');
  assert.equal(broken.apply, false);
  assert.ok(broken.error);
});

test('--expect accepts only a non-negative base-10 integer', () => {
  for (const good of ['0', '1', '7', '61', '1000']) {
    const mode = resolve('--apply', '--confirm', '--expect', good);
    assert.equal(mode.error, null, `${good} is a valid count`);
    assert.equal(mode.expectedUpdates, Number(good));
  }
  for (const bad of [
    '-1', // negative
    '1.5', // decimal
    '1.0', // decimal that coerces to an integer
    '0x10', // hexadecimal
    '1e3', // exponent
    '+5', // signed
    ' 5', // coercible string with whitespace
    '5 ',
    '', // empty
    'seven', // not a number
    '5abc', // trailing junk
    'Infinity',
    'NaN',
    '99999999999999999999', // beyond exact integer range
  ]) {
    const mode = resolve('--apply', '--confirm', '--expect', bad);
    assert.equal(mode.apply, false, `--expect "${bad}" must not authorize a write`);
    assert.ok(mode.error, `--expect "${bad}" must be refused`);
  }
});

test('a flag name used as the --expect value is refused, not consumed', () => {
  for (const argv of [
    ['--apply', '--confirm', '--expect'], // nothing after it
    ['--apply', '--confirm', '--expect', '--confirm'],
    ['--apply', '--expect', '--apply', '--confirm'],
    ['--expect', '--json', '--apply', '--confirm'],
  ]) {
    const mode = resolveRepairAuthorization(argv, FORM);
    assert.equal(mode.apply, false, `${argv.join(' ')} must not apply`);
    assert.ok(mode.error, `${argv.join(' ')} must be refused`);
  }
});

test('the --flag=value form is refused rather than silently ignored', () => {
  // Under index+1 lookup `--expect=5` resolves to NO count, which would have
  // turned a typo into an ungated command.
  for (const arg of ['--expect=5', '--apply=true', '--confirm=yes', '--dry-run=1']) {
    const mode = resolve('--apply', '--confirm', arg);
    assert.equal(mode.apply, false, `${arg} must not apply`);
    assert.match(mode.error!, /does not take an "=" value/);
  }
});

test('unrelated flags do not disturb the contract', () => {
  const mode = resolve(
    '--json',
    'out.json',
    '--drift-audit',
    '--apply',
    '--confirm',
    '--expect',
    '4',
  );
  assert.equal(mode.apply, true);
  assert.equal(mode.expectedUpdates, 4);
});

test('a zero-change dry run says "No apply needed" and prints no apply command', () => {
  const line = dryRunClosingLine(FORM, 0);
  assert.match(line, /No apply needed/);
  assert.ok(!line.includes('--apply'), 'a zero-result dry run must not hand over an apply command');
  assert.ok(!line.includes('--expect 0'), 'an operator must never be told to authorize 0 changes');
});

test('a non-zero dry run prints the exact apply command, count included', () => {
  const line = dryRunClosingLine(FORM, 12);
  assert.match(line, /npm run repair:example -- --apply --confirm --expect 12/);
});

test('extra family flags appear in every rendering of the command', () => {
  const form = { script: 'reconcile:example', extraApplyFlags: ['--plan <file>', '--digest <d>'] };
  assert.equal(
    applyCommandLine(form),
    'npm run reconcile:example -- --apply --confirm --expect <n> --plan <file> --digest <d>',
  );
  assert.match(
    dryRunClosingLine(form, 3, ['--plan p.json', '--digest abc']),
    /--plan p\.json --digest abc/,
  );
});

test('a value flag is refused when missing, empty, duplicated or flag-shaped', () => {
  assert.equal(resolveFlagValue(['--json', 'out.json'], '--json').value, 'out.json');
  assert.equal(resolveFlagValue([], '--json').value, null);
  assert.equal(resolveFlagValue([], '--json').error, null);
  for (const argv of [['--json'], ['--json', '--apply'], ['--json', 'a', '--json', 'b']]) {
    const resolved = resolveFlagValue(argv, '--json');
    assert.equal(resolved.value, null);
    assert.ok(resolved.error, `${argv.join(' ')} must be refused`);
  }
});

test('a positional ledger path is never confused with a flag value', () => {
  assert.equal(resolvePositional(['--expect', '61', 'ledger.json'], ['--json']), 'ledger.json');
  assert.equal(resolvePositional(['--json', 'out.json', 'ledger.json'], ['--json']), 'ledger.json');
  assert.equal(resolvePositional(['--apply', '--confirm', '--expect', '61'], ['--json']), null);
});
