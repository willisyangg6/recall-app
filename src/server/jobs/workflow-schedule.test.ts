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

/**
 * The exact commits the production workflows run, and the release each one
 * is. Resolved from the GitHub API on 2026-09-19; both were byte-identical
 * to what the floating `v7` tags pointed at, so SHA-pinning changed nothing
 * about what executes.
 *
 * To update: read the action's release notes, resolve the new tag
 * (`gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`), change both the
 * SHA and the version comment in BOTH workflows and here, and name the
 * release in the commit message.
 */
const PINNED_ACTIONS: readonly { uses: string; release: string }[] = [
  { uses: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', release: 'v7.0.1' },
  { uses: 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020', release: 'v7.0.0' },
];

test('third-party actions are SHA-pinned, never floating tags', () => {
  // A tag is a mutable pointer the action's owner can move at any time;
  // a commit SHA is not. This is GitHub's own documented hardening
  // guidance and the documented supply-chain vector.
  for (const name of ['scheduled-ingest.yml', 'daily-maintenance.yml']) {
    const yaml = workflow(name);
    const uses = [...yaml.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((match) => match[1]);
    assert.deepEqual(
      uses,
      PINNED_ACTIONS.map((action) => action.uses),
      name,
    );
    for (const reference of uses) {
      assert.match(
        reference,
        /@[0-9a-f]{40}$/,
        `${name}: ${reference} is not pinned to a full commit SHA`,
      );
    }
  }
});

test('every pinned action carries the human-readable release beside its SHA', () => {
  // A bare 40-character hex string is unreviewable. The trailing comment is
  // what lets a reader tell v7.0.1 from an attacker's commit at a glance,
  // and what makes the update procedure auditable.
  for (const name of ['scheduled-ingest.yml', 'daily-maintenance.yml']) {
    const yaml = workflow(name);
    for (const { uses, release } of PINNED_ACTIONS) {
      assert.ok(
        yaml.includes(`uses: ${uses} # ${release}`),
        `${name}: ${uses} is missing its "# ${release}" version comment`,
      );
    }
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
    // P2B7S: the dead-man heartbeat, LAST so it observes the freshness this
    // run actually produced.
    'npm run ops:heartbeat',
  ]);
  // Not a job script, so it is exempt from the run-job.ts assertion below.
  assert.equal(scripts['ops:heartbeat'], 'tsx scripts/ops-heartbeat.ts');
  // Every scheduled step is the same npm script a human runs from a laptop,
  // and every one of them lands in run-job.ts — so both paths take the same
  // lease and record the same bookkeeping.
  for (const command of invoked) {
    const name = command.replace('npm run ', '');
    const script = scripts[name];
    assert.ok(script, `${command} is not a package.json script`);
    if (name === 'ops:heartbeat') continue;
    assert.match(script, /^tsx scripts\/run-job\.ts /);
  }
});

// ── Secret scope (P2B7S) ────────────────────────────────────────────────────

const PRODUCTION_WORKFLOWS = ['scheduled-ingest.yml', 'daily-maintenance.yml'] as const;

/**
 * Every production secret this repository holds, by NAME (runbook §4). A new
 * secret added to a workflow must be classified here deliberately rather
 * than inheriting job scope by accident.
 *
 * `SUPABASE_SECRET_KEY` is the service role: it bypasses RLS entirely and
 * can read and write every production table. `HEARTBEAT_*` are dead-man
 * ping URLs, which are bearer credentials in their own right — anyone
 * holding one can forge a healthy ping and silence the alarm.
 */
const SENSITIVE_SECRETS = [
  'SUPABASE_SECRET_KEY',
  'HEARTBEAT_URL',
  'HEARTBEAT_FDA_URL',
  'HEARTBEAT_FSIS_URL',
] as const;

interface WorkflowStep {
  /** `uses:` target or `run:` command, for the assertion message. */
  label: string;
  run: string | null;
  uses: string | null;
  /** Secret names this step's own `env:` block exposes. */
  secrets: string[];
}

/**
 * Split a workflow's `steps:` block into steps and read each one's OWN
 * `env:`, by indentation.
 *
 * Text, not a YAML parser, for the reason in this file's header: `yaml` and
 * `js-yaml` are only transitively present in node_modules and a CI-gating
 * test must not depend on another package's dependency tree. The structure
 * here is two fixed indentation levels deep and fully under our control.
 */
function parseSteps(yaml: string): WorkflowStep[] {
  const lines = yaml.split('\n');
  const start = lines.findIndex((line) => /^\s{4}steps:\s*$/.test(line));
  assert.ok(start >= 0, 'no steps: block found');
  const steps: WorkflowStep[] = [];
  let current: WorkflowStep | null = null;
  let inEnv = false;
  for (const line of lines.slice(start + 1)) {
    if (/^\s{0,4}\S/.test(line) && line.trim() !== '') break; // left the job
    const stepStart = line.match(/^\s{6}-\s+(\S+):\s*(.*)$/);
    if (stepStart) {
      if (current) steps.push(current);
      const [, key, value] = stepStart;
      current = {
        label: value || key,
        run: key === 'run' ? value : null,
        uses: key === 'uses' ? value : null,
        secrets: [],
      };
      inEnv = false;
      continue;
    }
    if (current === null) continue;
    const property = line.match(/^\s{8}(\S+):\s*(.*)$/);
    if (property) {
      const [, key, value] = property;
      if (key === 'run') current.run = value;
      if (key === 'uses') current.uses = value;
      if (key === 'run' || key === 'uses') current.label = value;
      inEnv = key === 'env';
      continue;
    }
    if (inEnv) {
      const entry = line.match(/^\s{10}\S+:\s*\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/);
      if (entry) current.secrets.push(entry[1]);
    }
  }
  if (current) steps.push(current);
  return steps;
}

test('no production secret is set at job scope', () => {
  // A job-level `env:` puts the service-role key into EVERY step's
  // environment, `npm ci` included. That is the exfiltration path this
  // milestone closed; the assertion is what stops it reopening.
  for (const name of PRODUCTION_WORKFLOWS) {
    const yaml = workflow(name);
    const jobBlock = yaml.slice(yaml.indexOf('jobs:'), yaml.indexOf('\n    steps:'));
    assert.doesNotMatch(
      jobBlock,
      /^\s{4}env:\s*$/m,
      `${name} declares a job-level env: block, which would leak secrets into npm ci`,
    );
  }
});

test('npm ci, checkout and setup-node receive no production secret at all', () => {
  // `npm ci` is the step that executes third-party lifecycle scripts, so it
  // is the one step that must never hold a credential.
  for (const name of PRODUCTION_WORKFLOWS) {
    const steps = parseSteps(workflow(name));
    const unprivileged = steps.filter(
      (step) => step.uses !== null || /^npm ci\b/.test(step.run ?? ''),
    );
    assert.ok(unprivileged.length >= 3, `${name}: expected checkout, setup-node and npm ci`);
    for (const step of unprivileged) {
      assert.deepEqual(step.secrets, [], `${name}: "${step.label}" must receive no secret`);
    }
  }
});

test('every step that reaches production declares its own secrets, and only what it needs', () => {
  for (const name of PRODUCTION_WORKFLOWS) {
    for (const step of parseSteps(workflow(name))) {
      const command = step.run ?? '';
      if (/^npm run jobs:/.test(command)) {
        assert.deepEqual(
          [...step.secrets].sort(),
          ['SUPABASE_SECRET_KEY', 'SUPABASE_URL'],
          `${name}: "${step.label}" needs exactly the Supabase pair`,
        );
      }
      if (/^npm run ops:heartbeat/.test(command)) {
        // The only step that may see a heartbeat URL.
        assert.ok(step.secrets.includes('HEARTBEAT_URL'), `${name}: heartbeat step lost its URL`);
        assert.ok(step.secrets.includes('SUPABASE_SECRET_KEY'), 'it must verify freshness itself');
      }
    }
  }
});

test('the heartbeat URLs reach the heartbeat step and nothing else', () => {
  for (const name of PRODUCTION_WORKFLOWS) {
    for (const step of parseSteps(workflow(name))) {
      const heartbeatSecrets = step.secrets.filter((secret) => secret.startsWith('HEARTBEAT_'));
      if (heartbeatSecrets.length === 0) continue;
      assert.match(
        step.run ?? '',
        /^npm run ops:heartbeat/,
        `${name}: "${step.label}" holds a heartbeat URL but is not the heartbeat step`,
      );
    }
  }
});

test('no workflow step can print a secret', () => {
  // Secrets are masked in GitHub's log viewer, but masking is a UI
  // behaviour and not a boundary: anything echoed is also written to the
  // raw log artifact. Nothing may interpolate a secret into a command.
  for (const name of PRODUCTION_WORKFLOWS) {
    const yaml = workflow(name);
    for (const line of yaml.split('\n')) {
      if (!/^\s*(run:|\s+)/.test(line)) continue;
      if (/^\s*#/.test(line.trim())) continue;
      for (const secret of SENSITIVE_SECRETS) {
        const printed = new RegExp(`(echo|printenv|cat|curl)[^\\n]*${secret}`);
        assert.doesNotMatch(line, printed, `${name}: a command prints ${secret}`);
      }
    }
    assert.doesNotMatch(
      yaml,
      /^\s*run:.*\$\{\{\s*secrets\./m,
      `${name}: a run: interpolates a secret`,
    );
  }
});

test('scheduled ingestion cannot be cancelled by an unrelated run', () => {
  // Cancel-in-progress would let any later trigger — a watchdog dispatch
  // arriving while a scheduled run is mid-ingest — kill work already in
  // flight. Both workflows queue instead, and each has its OWN group so
  // they can never cancel each other.
  const groups = new Set<string>();
  for (const name of PRODUCTION_WORKFLOWS) {
    const yaml = workflow(name);
    const group = yaml.match(/^concurrency:\n\s+group:\s*(\S+)\n\s+cancel-in-progress:\s*(\S+)/m);
    assert.ok(group, `${name} has no concurrency block`);
    assert.equal(group[2], 'false', `${name} allows cancellation of a running ingest`);
    assert.ok(!groups.has(group[1]), `${name} shares a concurrency group with another workflow`);
    groups.add(group[1]);
  }
});

test('GITHUB_TOKEN permissions stay at the minimum both workflows actually need', () => {
  // Neither workflow writes to the repository, opens a PR, publishes a
  // package, or requests an OIDC token. `contents: read` is narrower than
  // the repository default and is all a checkout requires.
  for (const name of PRODUCTION_WORKFLOWS) {
    const yaml = workflow(name);
    const block = yaml.match(/^permissions:\n((?:\s{2}\S+:.*\n)+)/m);
    assert.ok(block, `${name} does not declare permissions, so it inherits the default`);
    assert.deepEqual(
      block[1]
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => line.trim()),
      ['contents: read'],
      name,
    );
  }
});

test('neither workflow runs on push or pull_request, so no fork can reach a secret', () => {
  for (const name of PRODUCTION_WORKFLOWS) {
    const yaml = workflow(name);
    const triggers = yaml.slice(yaml.indexOf('\non:'), yaml.indexOf('\nconcurrency:'));
    for (const forbidden of ['push:', 'pull_request:', 'pull_request_target:', 'issue_comment:']) {
      assert.ok(!triggers.includes(forbidden), `${name} gained a ${forbidden} trigger`);
    }
  }
});

test('no workflow uploads an artifact, so nothing can carry state out of a run', () => {
  for (const name of PRODUCTION_WORKFLOWS) {
    assert.doesNotMatch(workflow(name), /upload-artifact|actions\/cache@/, name);
  }
});
