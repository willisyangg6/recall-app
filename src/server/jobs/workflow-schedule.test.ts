/**
 * The scheduling contract of the production workflows.
 *
 * These assertions exist because the 2026-08-27 ingestion stall was a
 * scheduling failure, not a code failure: the every-30-minutes cron delivered
 * 24% of its ticks because :00 and :30 are GitHub's most contended slots. The
 * offset is the fix, and it is the kind of one-line value that a later edit
 * could silently revert, so it is pinned here.
 *
 * Asserted against the YAML text rather than a parser: `yaml`/`js-yaml` are
 * only transitively present in node_modules, and a CI-gating test should not
 * depend on another package's dependency tree.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { WATCHDOG_TARGET } from '../../../supabase/functions/ingest-watchdog/core';

const ROOT = join(__dirname, '..', '..', '..');
const workflow = (name: string): string =>
  readFileSync(join(ROOT, '.github', 'workflows', name), 'utf8');

/** Cron expressions declared under `on: schedule:`. Comment lines cannot match. */
function crons(yaml: string): string[] {
  return [...yaml.matchAll(/^\s*-\s*cron:\s*'([^']+)'/gm)].map((match) => match[1]);
}

test('scheduled-ingest fires at :07 and :37, off the congested boundaries', () => {
  const yaml = workflow('scheduled-ingest.yml');
  assert.deepEqual(crons(yaml), ['7,37 * * * *']);

  const [minutes, ...rest] = '7,37 * * * *'.split(' ');
  const fires = minutes.split(',').map(Number);
  // Twice an hour, unchanged — the offset must not become a frequency change.
  assert.equal(fires.length, 2);
  assert.deepEqual(rest, ['*', '*', '*', '*']);
  // The whole point: neither slot may sit on the hour or the half hour.
  for (const minute of fires) {
    assert.ok(minute !== 0 && minute !== 30, `minute ${minute} is a congested slot`);
  }
  assert.equal(fires[1] - fires[0], 30, 'the two fires stay half an hour apart');
});

test('the old congested schedule is gone', () => {
  assert.ok(!crons(workflow('scheduled-ingest.yml')).includes('*/30 * * * *'));
});

test('manual workflow_dispatch remains available on both workflows', () => {
  // The recovery path for a missed tick, and the only way to run CI on demand.
  for (const name of ['scheduled-ingest.yml', 'daily-maintenance.yml']) {
    assert.match(workflow(name), /^\s*workflow_dispatch:/m, `${name} lost workflow_dispatch`);
  }
});

test('daily-maintenance keeps its 09:15 UTC schedule', () => {
  // Already off the hour; deliberately NOT changed for symmetry. Its observed
  // delay is under observation in the same window as the ingest offset.
  assert.deepEqual(crons(workflow('daily-maintenance.yml')), ['15 9 * * *']);
});

test('the native schedule survives as best-effort fallback AND the watchdog target resolves', () => {
  // Two scheduling layers now exist on purpose: GitHub's native cron (kept
  // during the watchdog observation period — free extra chance at a tick) and
  // the Supabase watchdog dispatching the same workflow. The watchdog's
  // target constants must name the real file and the real branch, or every
  // dispatch would 404/422.
  const yaml = workflow(WATCHDOG_TARGET.workflow); // throws if the file is gone
  assert.match(yaml, /^\s*schedule:/m, 'native best-effort schedule removed prematurely');
  assert.match(
    yaml,
    /^\s*workflow_dispatch:/m,
    'the watchdog dispatch target is workflow_dispatch',
  );
  assert.equal(WATCHDOG_TARGET.ref, 'master', 'the watchdog must dispatch the production branch');
  assert.equal(WATCHDOG_TARGET.repository, 'willisyangg6/recall-app');
});

test('official actions are pinned to the current stable majors (node24 runtime)', () => {
  // v4 ran the deprecated node20 action runtime. Verified against the
  // actions' official releases/READMEs on 2026-08-28: v7 is the current
  // stable major for both, and no input this repo uses changed behaviour.
  for (const name of ['scheduled-ingest.yml', 'daily-maintenance.yml']) {
    const yaml = workflow(name);
    const uses = [...yaml.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((match) => match[1]);
    assert.deepEqual(uses, ['actions/checkout@v7', 'actions/setup-node@v7'], name);
  }
});

test('scheduled execution shares the canonical runner with manual execution', () => {
  const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts as Record<
    string,
    string
  >;
  const yaml = workflow('scheduled-ingest.yml');
  const invoked = [...yaml.matchAll(/^\s*run:\s*(npm run [\w:]+)/gm)].map((match) => match[1]);

  assert.deepEqual(invoked, [
    'npm run jobs:fda',
    'npm run jobs:fsis',
    'npm run jobs:labels',
    'npm run jobs:push',
  ]);
  // Every scheduled step is the same npm script a human runs from a laptop,
  // and every one of them lands in run-job.ts — so both paths take the same
  // lease and record the same bookkeeping.
  for (const command of invoked) {
    const script = scripts[command.replace('npm run ', '')];
    assert.ok(script, `${command} is not a package.json script`);
    assert.match(script, /^tsx scripts\/run-job\.ts /);
  }
});
