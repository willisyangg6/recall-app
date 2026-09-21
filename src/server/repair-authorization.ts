/**
 * The ONE authorization gate every production mutation CLI resolves before it
 * is allowed to construct a write-capable database client (P2B7T).
 *
 * WHY THIS MODULE EXISTS. P2B7Q.2 found that `package.json` completed the
 * geography repair's authorization contract on the operator's behalf: the
 * script was `tsx scripts/repair-geography.ts --apply`, so typing
 * `npm run repair:geography -- --confirm --expect 61` wrote to production
 * without anyone typing the word "apply". The audit that followed found the
 * same injection in seven more command families, and — worse — found four
 * different hand-rolled versions of "the contract" across the repairs, so the
 * families disagreed about what authorization even meant. A contract the
 * package script can complete is not a contract, and four contracts are no
 * contract at all.
 *
 * THE CONTRACT. A production write requires the operator to type, literally,
 * all three of:
 *
 *   --apply            the intent
 *   --confirm          the second acknowledgment (the repair:* house rule)
 *   --expect <n>       the planned-change count from the dry run they read
 *
 * Every mutation command defaults to a read-only dry run. No package script,
 * wrapper or internal argv rewrite may supply any of the three — enforced by
 * mutation-cli.test.ts, which enumerates every write-capable CLI in the
 * repository rather than a list someone remembered to update.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO. It does not know what any repair
 * writes, plan anything, or touch a store. It resolves flags and formats the
 * command forms, so each repair's own scope stays readable and auditable in
 * its own file. The shared part is the part that must never drift; the
 * per-repair part is the part a reviewer must be able to read in one place.
 */

/** The flags that carry authorization. Any of them given twice is refused. */
const AUTHORIZATION_FLAGS = ['--apply', '--confirm', '--expect', '--dry-run'] as const;

/** Flags whose value is the NEXT argument, never `--flag=value`. */
const VALUE_FLAGS = ['--expect'] as const;

export interface RepairAuthorization {
  /** True only when --apply, --confirm and a valid --expect were all typed. */
  apply: boolean;
  /** The reviewed count, available to a dry run too so it can be gated. */
  expectedUpdates: number | null;
  /** Non-null means: print it, exit 1, and construct nothing. */
  error: string | null;
}

export interface MutationCommandForm {
  /** The npm script that applies, e.g. `repair:allergens`. */
  script: string;
  /**
   * A required positional argument printed before the flags — a rollback's
   * ledger path. Rendered as given (a placeholder like `<ledger.json>`, or a
   * real path once one is known).
   */
  positional?: string;
  /** Literal flags this family needs BEYOND the three, e.g. `--plan <file>`. */
  extraApplyFlags?: readonly string[];
}

/** The apply command, rendered identically wherever it is printed. */
export function applyCommandLine(
  form: MutationCommandForm,
  expect: number | string = '<n>',
  extraValues?: readonly string[],
): string {
  const extra = extraValues ?? form.extraApplyFlags ?? [];
  const tail = extra.length > 0 ? ` ${extra.join(' ')}` : '';
  const head = form.positional === undefined ? '' : `${form.positional} `;
  return `npm run ${form.script} -- ${head}--apply --confirm --expect ${expect}${tail}`;
}

/**
 * The closing line of a dry run. A dry run that proposes nothing must say so
 * and must NOT print an apply command: an operator who copies a command out of
 * a zero-result report is authorizing a write that has no work to do, and
 * `--expect 0` is the one count that can never be a reviewed correction.
 */
export function dryRunClosingLine(
  form: MutationCommandForm,
  plannedCount: number,
  extraValues?: readonly string[],
): string {
  if (plannedCount === 0) {
    return (
      '\n  Dry run complete — nothing was written.' +
      '\n  No apply needed: the corpus already matches the contract.\n'
    );
  }
  return (
    '\n  Dry run complete — nothing was written. Apply with:' +
    `\n    ${applyCommandLine(form, plannedCount, extraValues)}\n`
  );
}

/**
 * Printed when an operator types part of the contract but not `--apply` —
 * the muscle memory the old injected package scripts trained. They must never
 * walk away believing they applied.
 */
export const DRY_RUN_DESPITE_ACKNOWLEDGMENTS =
  '\n  NOTE: --confirm/--expect were given WITHOUT --apply.' +
  '\n  This is a dry run. Nothing was written.';

function occurrences(argv: readonly string[], flag: string): number {
  return argv.reduce((count, arg) => (arg === flag ? count + 1 : count), 0);
}

/**
 * Resolve the authorization contract from argv alone — no environment, no
 * credentials, no I/O. Callers run this FIRST and exit 1 on `error`, so a
 * malformed command has provably opened no connection.
 */
export function resolveRepairAuthorization(
  argv: readonly string[],
  form: MutationCommandForm,
): RepairAuthorization {
  const refuse = (error: string): RepairAuthorization => ({
    apply: false,
    expectedUpdates: null,
    error: `${error}\nNothing was written.`,
  });

  // `--expect=5` silently resolves to no count at all under index+1 lookup,
  // which would turn a typo into an ungated dry run. Refuse the form outright.
  for (const arg of argv) {
    const equals = /^(--apply|--confirm|--expect|--dry-run)=/.exec(arg);
    if (equals) {
      return refuse(
        `${equals[1]} does not take an "=" value. Write the flags with spaces:\n  ${applyCommandLine(form)}`,
      );
    }
  }

  for (const flag of AUTHORIZATION_FLAGS) {
    if (occurrences(argv, flag) > 1) {
      return refuse(
        `${flag} was given more than once. An ambiguous authorization is refused rather than resolved:\n  ${applyCommandLine(form)}`,
      );
    }
  }

  const wantsApply = argv.includes('--apply');
  const wantsDryRun = argv.includes('--dry-run');
  const confirmed = argv.includes('--confirm');

  if (wantsApply && wantsDryRun) {
    return refuse('--apply and --dry-run contradict each other.');
  }

  let expectedUpdates: number | null = null;
  const expectIndex = argv.indexOf('--expect');
  if (expectIndex >= 0) {
    const raw = argv[expectIndex + 1];
    // Only a flag-shaped value means "missing"; "-1" falls through to the
    // integer check so the operator is told what is actually wrong with it.
    if (raw === undefined || raw.startsWith('--')) {
      return refuse('--expect requires the planned-change count from the dry run you read.');
    }
    // Base-10, non-negative, integral, exact. This rejects "-1", "1.5",
    // "0x10", "1e3", " 7", "7 ", "seven", "" and anything JavaScript would
    // otherwise coerce into a number that the operator did not mean.
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
      return refuse(`--expect must be a non-negative base-10 integer, got "${raw}".`);
    }
    expectedUpdates = Number(raw);
  }

  if (wantsApply && !confirmed) {
    return refuse(
      `--apply requires the explicit second acknowledgment --confirm:\n  ${applyCommandLine(form)}`,
    );
  }
  if (wantsApply && expectedUpdates === null) {
    return refuse(
      `--apply requires --expect <n>, the planned-change count from the reviewed dry run:\n  ${applyCommandLine(form)}`,
    );
  }

  return { apply: wantsApply && confirmed, expectedUpdates, error: null };
}

/**
 * A value-taking flag's argument, refused rather than guessed when missing.
 * Returns an error string instead of exiting so the caller keeps every refusal
 * in the same pre-connection block.
 */
export function resolveFlagValue(
  argv: readonly string[],
  flag: string,
): { value: string | null; error: string | null } {
  if (occurrences(argv, flag) > 1) {
    return { value: null, error: `${flag} was given more than once.\nNothing was written.` };
  }
  const index = argv.indexOf(flag);
  if (index < 0) return { value: null, error: null };
  const value = argv[index + 1];
  if (value === undefined || value === '' || value.startsWith('-')) {
    return { value: null, error: `${flag} requires a value.\nNothing was written.` };
  }
  return { value, error: null };
}

/**
 * The first bare argument — a rollback's ledger path — skipping any argument
 * that belongs to a value flag. Without this, `--expect 61 ledger.json` reads
 * "61" as the ledger and fails with a confusing file error.
 */
export function resolvePositional(
  argv: readonly string[],
  valueFlags: readonly string[],
): string | null {
  const consumesValue = new Set<string>([...VALUE_FLAGS, ...valueFlags]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (consumesValue.has(arg)) {
      index += 1;
      continue;
    }
    if (!arg.startsWith('-')) return arg;
  }
  return null;
}

/** A refused run: the corpus is not what the operator authorized. */
export interface CountGateAbort {
  reason: string;
  expected: number;
  actual: number;
}

/**
 * The count gate, applied AFTER the complete corpus is planned and BEFORE the
 * first write. A mismatch returns an abort, and every caller returns on it
 * having written nothing — so a corpus that moved between the reviewed dry run
 * and the apply costs zero writes rather than a partial, unreviewed one.
 *
 * A dry run is gated too: it reports the same mismatch (and the CLI exits
 * nonzero on it) so `--expect` can be rehearsed before it is used to write.
 */
export function resolveCountGate(
  options: { apply: boolean; expectedUpdates: number | null },
  plannedChanges: number,
): CountGateAbort | null {
  if (!options.apply) {
    if (options.expectedUpdates !== null && options.expectedUpdates !== plannedChanges) {
      return {
        reason: 'planned changes do not match the authorized count',
        expected: options.expectedUpdates,
        actual: plannedChanges,
      };
    }
    return null;
  }
  if (options.expectedUpdates === null) {
    return {
      reason: 'apply requires an authorized change count',
      expected: -1,
      actual: plannedChanges,
    };
  }
  if (options.expectedUpdates !== plannedChanges) {
    return {
      reason: 'the live corpus drifted from the reviewed dry run',
      expected: options.expectedUpdates,
      actual: plannedChanges,
    };
  }
  return null;
}
