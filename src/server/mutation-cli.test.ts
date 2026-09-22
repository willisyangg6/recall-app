/**
 * EVERY production mutation CLI in the repository, enumerated from disk and
 * held to one authorization contract (P2B7T).
 *
 * The defect this file exists to prevent already happened twice. `package.json`
 * completed the contract on the operator's behalf — `repair:geography` was
 * `tsx scripts/repair-geography.ts --apply`, so typing `--confirm --expect 61`
 * wrote to production without anyone typing the word "apply" — and the audit
 * that followed found the same injection in seven more families. A contract the
 * package script can complete is not a contract.
 *
 * So this file does not trust a list anyone has to remember to update. It reads
 * `scripts/` and `package.json`, classifies every script that can construct a
 * database client, and FAILS on any script it cannot account for. A new
 * mutation CLI is gated or the suite goes red.
 *
 * What is pinned here is the SHAPE of every command — the per-repair behaviour
 * (what each one writes, its compare-and-set, its ledger and its rollback)
 * stays in that repair's own test file, which is the point: the shared part is
 * shared, and each scope is still auditable in one place.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

const run = promisify(execFile);

const PACKAGE: { scripts: Record<string, string> } = JSON.parse(
  readFileSync('package.json', 'utf8'),
);

/** Anything that can construct a write-capable Supabase client. */
const CONSTRUCTS_A_CLIENT = /createSupabaseServerClient\(|createClient\(/;

const ALL_SCRIPTS = readdirSync('scripts').filter((name) => name.endsWith('.ts'));

const source = (name: string) => readFileSync(`scripts/${name}`, 'utf8');

/**
 * A mutation CLI is one that mentions `--apply` at all: the flag exists in
 * exactly one place in this repository — the authorization contract.
 */
const MUTATION_CLIS = ALL_SCRIPTS.filter(
  (name) => CONSTRUCTS_A_CLIENT.test(source(name)) && source(name).includes('--apply'),
);

/**
 * Scripts that reach the database but are deliberately NOT under the
 * three-flag gate, each with the reason it would be wrong to gate it. Anything
 * not in this map and not a mutation CLI fails the exhaustiveness test below,
 * which is how a newly added writer is forced through a human decision.
 */
const DELIBERATELY_UNGATED: Record<string, string> = {
  'run-job.ts':
    'the scheduled pipeline itself (jobs:*/ingest:*). It runs unattended on a ' +
    'cron and is governed by the job lease and its own --dry-run; requiring a ' +
    'typed --expect would break the scheduler, not protect it.',
  'push-activate.ts':
    'the founder-only push switch. It has its own documented --confirm contract, ' +
    'its package script injects nothing, and with no flags it only reports state.',
  'scheduler-probe.ts':
    'the watchdog probe. It never writes a row; --dispatch starts one ingest ' +
    'workflow, its package script injects nothing, and the default is a dry probe.',
  'ops-health.ts': 'read-only health report.',
  'preflight-preference-states.ts':
    'read-only census for the P2B7U expand migration. It only SELECTs, and ' +
    'the migration it describes is applied with `supabase db push`, which the ' +
    'three-flag contract does not and should not govern.',
  'ops-heartbeat.ts': 'read-only: two SELECTs and one outbound monitor ping.',
  'push-test.ts': 'read-only push diagnostics.',
  'scheduler-status.ts': 'read-only scheduler report.',
};

test('every script that reaches the database is classified', () => {
  const unaccounted = ALL_SCRIPTS.filter(
    (name) =>
      CONSTRUCTS_A_CLIENT.test(source(name)) &&
      !MUTATION_CLIS.includes(name) &&
      !(name in DELIBERATELY_UNGATED) &&
      !name.startsWith('qa-') &&
      !name.startsWith('record-'),
  );
  assert.deepEqual(
    unaccounted,
    [],
    'a script constructs a database client but is neither a gated mutation CLI ' +
      'nor listed in DELIBERATELY_UNGATED with a reason. Decide which it is.',
  );
});

test('the inventory covers every family the P2B7T audit named', () => {
  for (const name of [
    'repair-geography.ts',
    'repair-illness-flags.ts',
    'repair-allergens.ts',
    'repair-hazards.ts',
    'repair-fda-contaminants.ts',
    'backfill-fda-images.ts',
    'backfill-retailers.ts',
    'backfill-product-categories.ts',
    'rederive-historical.ts',
    'reconcile-applied-state.ts',
    'reconcile-duplicate-cases.ts',
    'reconcile-fda-enforcement.ts',
    'render-fsis-labels.ts',
  ]) {
    assert.ok(MUTATION_CLIS.includes(name), `${name} is no longer detected as a mutation CLI`);
  }
});

// ── 1. No package script completes the contract ──────────────────────────────

test('NO package script injects --apply, --confirm or --expect', () => {
  for (const [name, command] of Object.entries(PACKAGE.scripts)) {
    for (const flag of ['--apply', '--confirm', '--expect']) {
      assert.ok(
        !command.includes(flag),
        `package script "${name}" = "${command}" carries ${flag}. A package script ` +
          'may never hand the operator an authorization they did not type.',
      );
    }
  }
});

test('every mutation CLI has a dry-run alias identical to its base command', () => {
  for (const script of MUTATION_CLIS) {
    const entries = Object.entries(PACKAGE.scripts).filter(([, command]) =>
      command.includes(`scripts/${script}`),
    );
    assert.ok(entries.length > 0, `${script} has no package script at all`);
    // Every alias for the same file must be the same command, except a mode
    // selector like --rollback, which carries no authorization of its own.
    for (const [name, command] of entries) {
      const flags = command.replace(`tsx scripts/${script}`, '').trim();
      assert.ok(
        flags === '' || flags === '--rollback',
        `package script "${name}" = "${command}" adds "${flags}". The only flag an ` +
          'alias may add is a mode selector, never an authorization.',
      );
    }
  }
});

// ── 2. Nothing synthesizes the contract internally ───────────────────────────

test('no CLI writes --apply, --confirm or --expect into its own argv', () => {
  for (const script of MUTATION_CLIS) {
    const text = source(script);
    for (const pattern of [
      /push\(\s*'--(apply|confirm|expect)'/,
      /\.concat\(\s*\[?\s*'--(apply|confirm|expect)'/,
      /\[\s*\.\.\.\w+\s*,\s*'--(apply|confirm|expect)'/,
      /argv\s*=\s*\[[^\]]*'--(apply|confirm|expect)'/,
    ]) {
      assert.ok(
        !pattern.test(text),
        `${script} synthesizes an authorization flag into its own argv — a rollback ` +
          'or repair write must be authorized by the operator, never by the program.',
      );
    }
  }
});

test('every mutation CLI resolves the ONE shared contract', () => {
  for (const script of MUTATION_CLIS) {
    assert.match(
      source(script),
      /resolveRepairAuthorization\(/,
      `${script} resolves its own authorization instead of the shared contract. ` +
        'Four hand-rolled contracts is what P2B7Q.2 found; there is now exactly one.',
    );
  }
});

// ── 3. The gate precedes credentials and the client ──────────────────────────

test('the authorization gate is resolved before ANY credential or client', () => {
  for (const script of MUTATION_CLIS) {
    const text = source(script);
    const main = text.slice(text.indexOf('async function main('));
    const gate = main.indexOf('resolveRepairAuthorization(');
    const refusal = main.indexOf('process.exit(1)', gate);

    const firstOf = (pattern: RegExp) => {
      const match = pattern.exec(main);
      return match ? match.index : Infinity;
    };
    const credential = firstOf(/process\.env\.SUPABASE_(URL|SECRET_KEY)/);
    const client = firstOf(/createSupabaseServerClient\(|createClient\(/);

    assert.ok(gate >= 0, `${script}: main() no longer resolves the contract`);
    assert.ok(refusal > gate, `${script}: the contract is resolved but never refused`);
    assert.ok(
      refusal < credential,
      `${script}: a credential is read at ${credential} before the refusal at ${refusal}. ` +
        'A malformed command must fail closed before any secret is touched.',
    );
    assert.ok(
      refusal < client,
      `${script}: a database client is constructed before the refusal. A missing ` +
        '--apply/--confirm/--expect must not reach a write-capable connection.',
    );
  }
});

test('--help is answered before any credential, client or network request', () => {
  for (const script of MUTATION_CLIS) {
    const text = source(script);
    const main = text.slice(text.indexOf('async function main('));
    const help = main.indexOf("argv.includes('--help')");
    assert.ok(help >= 0, `${script} has no --help`);

    const firstOf = (pattern: RegExp) => {
      const match = pattern.exec(main);
      return match ? match.index : Infinity;
    };
    for (const [label, pattern] of [
      ['a credential', /process\.env\.SUPABASE_(URL|SECRET_KEY)/],
      ['a database client', /createSupabaseServerClient\(|createClient\(/],
      ['a network request', /\bfetch\(|downloadEnforcementCorpus\(/],
      ['a store call', /await store\./],
    ] as const) {
      assert.ok(
        help < firstOf(pattern),
        `${script}: --help is handled after ${label}. Help must be readable with no ` +
          'credentials and must touch nothing.',
      );
    }
  }
});

test('no mutation CLI can reach push state or a workflow dispatch, on ANY path', () => {
  // Structural, so it holds for the dry run, the help text and every refusal
  // alike: none of them imports push delivery, push activation or the
  // scheduler watchdog, so none of them can turn delivery on, send a push, or
  // start an ingest workflow whatever flags it is given.
  for (const script of MUTATION_CLIS) {
    const imports = source(script).match(/^import[^;]+;/gms) ?? [];
    for (const line of imports) {
      for (const forbidden of ['push/', 'push-activate', 'watchdog', 'expo-transport']) {
        assert.ok(
          !line.includes(forbidden),
          `${script} imports ${forbidden}: a repair must not be able to reach push ` +
            'delivery, push activation or workflow dispatch.',
        );
      }
    }
    assert.ok(
      !/push_enabled_at|workflow_dispatch/.test(source(script)),
      `${script} names push activation or a workflow dispatch directly`,
    );
  }
});

// ── 4. The zero-result dry run ───────────────────────────────────────────────

test('no CLI can print an apply command for a zero-change dry run', () => {
  for (const script of MUTATION_CLIS) {
    const text = source(script);
    // The closing line is rendered by the shared helper (which refuses to
    // print a command at zero) or guarded by an explicit zero check.
    assert.ok(
      /dryRunClosingLine\(/.test(text) || /No apply needed/.test(text),
      `${script} builds its own dry-run closing line. It must go through ` +
        'dryRunClosingLine so a zero-change run says "No apply needed" instead of ' +
        'handing over "--expect 0".',
    );
    assert.ok(
      !/--expect \$\{[^}]*\}\`?\s*\)?;?\s*$/m.test(text) || /dryRunClosingLine\(/.test(text),
      `${script} interpolates a raw --expect count into a printed command`,
    );
  }
});

// ── 4b. The scheduler never reaches a gated command ──────────────────────────

/**
 * The gated CLIs are for a human at a terminal. The scheduler is not a human:
 * it runs unattended twice an hour and cannot type `--confirm`, and no count it
 * could be given in YAML would still be true by the time it ran. So the two
 * must stay on separate paths — and the way to keep them separate is to prove
 * it from the workflow files rather than to remember it.
 *
 * Scheduled work goes through scripts/run-job.ts (the job runner, with its
 * Postgres lease and run bookkeeping) or scripts/ops-heartbeat.ts. The trap
 * this guards is specific and easy to fall into: the scheduled step named
 * "FSIS label visuals (recent)" runs `npm run jobs:labels`
 * (run-job.ts → src/server/fsis/label-sync.ts), which is a DIFFERENT command
 * and a different code path from the gated `npm run labels:fsis`
 * (scripts/render-fsis-labels.ts). Someone tidying the two together would put
 * a human-only authorization gate in the path of the cron.
 */
const WORKFLOW_DIR = '.github/workflows';
const WORKFLOWS = readdirSync(WORKFLOW_DIR).filter((name) => name.endsWith('.yml'));

/** Every `npm run <script>` a workflow executes, with the workflow it came from. */
function workflowNpmCommands(): { workflow: string; command: string; script: string }[] {
  const out: { workflow: string; command: string; script: string }[] = [];
  for (const workflow of WORKFLOWS) {
    const yaml = readFileSync(`${WORKFLOW_DIR}/${workflow}`, 'utf8');
    for (const match of yaml.matchAll(/^\s*(?:-\s+)?run:\s*(npm run .+)$/gm)) {
      const command = match[1].trim();
      out.push({ workflow, command, script: command.replace('npm run ', '').split(/\s/)[0] });
    }
  }
  return out;
}

test('the workflows are discovered, so this suite cannot pass by finding nothing', () => {
  assert.ok(WORKFLOWS.length >= 2, `only found ${WORKFLOWS.length} workflow files`);
  const commands = workflowNpmCommands();
  assert.ok(commands.length >= 5, `only found ${commands.length} workflow npm commands`);
});

test('NO scheduled workflow invokes a gated manual mutation CLI', () => {
  const gatedScripts = new Set(
    Object.entries(PACKAGE.scripts)
      .filter(([, command]) => MUTATION_CLIS.some((cli) => command.includes(`scripts/${cli}`)))
      .map(([name]) => name),
  );
  // The gated set is real, or this test proves nothing.
  assert.ok(gatedScripts.has('labels:fsis'), 'labels:fsis is no longer recognised as gated');
  assert.ok(gatedScripts.has('repair:geography'));

  for (const { workflow, command, script } of workflowNpmCommands()) {
    assert.ok(
      !gatedScripts.has(script),
      `${workflow} runs "${command}", which is the gated manual CLI "${script}". ` +
        'Scheduled work must go through the job runner (npm run jobs:*), which takes ' +
        'the Postgres lease — never through a command that needs a human to type ' +
        '--apply --confirm --expect.',
    );
  }
});

test('every scheduled command routes through the job runner or the heartbeat', () => {
  for (const { workflow, command, script } of workflowNpmCommands()) {
    const target = PACKAGE.scripts[script];
    assert.ok(target, `${workflow} runs "${command}", which is not a package script`);
    assert.ok(
      /^tsx scripts\/run-job\.ts /.test(target) || target === 'tsx scripts/ops-heartbeat.ts',
      `${workflow}: "${command}" resolves to "${target}", which is neither the job ` +
        'runner nor the heartbeat.',
    );
  }
});

test('no workflow supplies an authorization flag, so no count is hardcoded in YAML', () => {
  for (const workflow of WORKFLOWS) {
    const yaml = readFileSync(`${WORKFLOW_DIR}/${workflow}`, 'utf8');
    for (const match of yaml.matchAll(/^\s*(?:-\s+)?run:\s*(npm run .+)$/gm)) {
      for (const flag of ['--apply', '--confirm', '--expect']) {
        assert.ok(
          !match[1].includes(flag),
          `${workflow} passes ${flag} in "${match[1].trim()}". A scheduled run must not ` +
            'carry a human authorization, and an --expect baked into YAML is stale the ' +
            'moment the corpus moves.',
        );
      }
    }
  }
});

test('no gated CLI is reachable by import from a scheduled entry point', () => {
  // Structural, so it also covers an indirect route: a job module quietly
  // importing a backfill script would show up here.
  const entryPoints = new Set(
    workflowNpmCommands().map(
      ({ script }) => PACKAGE.scripts[script].replace(/^tsx /, '').split(/\s/)[0],
    ),
  );
  const gatedPaths = MUTATION_CLIS.map((name) => `scripts/${name}`);

  const resolve = (from: string, spec: string): string | null => {
    if (!spec.startsWith('.')) return null;
    const base = join(dirname(from), spec);
    for (const candidate of [`${base}.ts`, `${base}/index.ts`]) {
      if (existsSync(candidate)) return candidate;
    }
    return null;
  };

  for (const entry of entryPoints) {
    const seen = new Set<string>();
    const stack = [entry];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (seen.has(current) || !existsSync(current)) continue;
      seen.add(current);
      for (const match of readFileSync(current, 'utf8').matchAll(/from\s+'([^']+)'/g)) {
        const resolved = resolve(current, match[1]);
        if (resolved && !seen.has(resolved)) stack.push(resolved);
      }
    }
    for (const gated of gatedPaths) {
      assert.ok(
        !seen.has(gated),
        `${entry} transitively imports ${gated}: a scheduled entry point must not be ` +
          'able to reach a human-gated command.',
      );
    }
    // And the closure is real, not an empty set that would pass vacuously.
    assert.ok(seen.size > 1, `${entry} resolved no imports at all`);
  }
});

// ── 5. Documented commands are the real commands ─────────────────────────────

const DOCS = ['README.md', 'docs/recall-operations.md'];

test('README and the runbook print the SAME apply command as every CLI', () => {
  for (const file of DOCS) {
    const text = readFileSync(file, 'utf8');
    // No document may print an apply that the CLI would refuse: a command with
    // --confirm but no --apply is exactly the muscle memory the old injected
    // package scripts trained.
    const bad = text.match(/npm run [\w:-]+ -- (?!.*--apply)[^\n]*--confirm[^\n]*/g) ?? [];
    assert.deepEqual(
      bad,
      [],
      `${file} prints an apply command with no --apply in it: ${bad.join(' | ')}`,
    );
  }
});

test('every gated npm script documented as an apply carries all three flags', () => {
  for (const file of DOCS) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/npm run ([\w:-]+) -- ([^\n`]*--apply[^\n`]*)/g)) {
      const flags = match[2];
      assert.ok(
        flags.includes('--confirm') && flags.includes('--expect'),
        `${file}: "npm run ${match[1]} -- ${flags}" prints --apply without the other ` +
          'two acknowledgments; a reader would copy a command the CLI refuses.',
      );
    }
  }
});

// ── 6. The contract at the terminal, for real ────────────────────────────────

/**
 * Executed, not inspected: every mutation CLI is actually run. A `.env` with
 * real credentials may well be present, which is the point — the refusal must
 * still come first, so "Missing SUPABASE_URL" appearing instead would prove the
 * guard ran too late.
 */
async function runCli(script: string, args: string[]): Promise<{ code: number; out: string }> {
  try {
    const { stdout, stderr } = await run('npx', ['tsx', `scripts/${script}`, ...args]);
    return { code: 0, out: stdout + stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, out: (failure.stdout ?? '') + (failure.stderr ?? '') };
  }
}

test('--help exits 0 and needs no credentials', { timeout: 120_000 }, async () => {
  const results = await Promise.all(
    MUTATION_CLIS.map(async (script) => [script, await runCli(script, ['--help'])] as const),
  );
  for (const [script, result] of results) {
    assert.equal(result.code, 0, `${script} --help exited ${result.code}: ${result.out}`);
    assert.doesNotMatch(
      result.out,
      /Missing SUPABASE_URL/,
      `${script} --help asked for credentials`,
    );
    assert.match(
      result.out,
      /--apply --confirm --expect/,
      `${script} --help does not print the three-flag contract`,
    );
  }
});

test(
  'every incomplete authorization fails closed, before credentials',
  { timeout: 180_000 },
  async () => {
    // One representative of each refusal CLASS, actually executed against each
    // CLI. The exhaustive value matrix (every malformed --expect, every
    // reordering, every duplicate) is proved instantly against the shared
    // resolver in repair-authorization.test.ts — spawning 13 processes per
    // permutation would re-prove that at a cost this suite should not carry.
    // What these spawns prove is per-CLI and cannot be unit-tested: that the
    // command is really wired to that resolver, and really refuses before
    // touching a credential.
    //
    // Every entry carries --apply, so none of them can fall through into a
    // dry run that would read production.
    const INCOMPLETE = [
      ['--apply'], // no --confirm
      ['--apply', '--confirm'], // no --expect
      ['--apply', '--confirm', '--expect', '-1'], // malformed count
      ['--apply', '--confirm', '--expect', '3', '--expect', '900'], // ambiguous
    ];
    const results = await Promise.all(
      MUTATION_CLIS.flatMap((script) =>
        INCOMPLETE.map(async (args) => [script, args, await runCli(script, args)] as const),
      ),
    );
    for (const [script, args, result] of results) {
      const command = `${script} ${args.join(' ')}`;
      assert.equal(result.code, 1, `${command} exited ${result.code}, expected 1`);
      assert.doesNotMatch(
        result.out,
        /Missing SUPABASE_URL/,
        `${command} reached the credential lookup before refusing`,
      );
      assert.match(
        result.out,
        /Nothing was written|APPLY REFUSED/,
        `${command} refused without saying nothing was written: ${result.out}`,
      );
    }
  },
);
