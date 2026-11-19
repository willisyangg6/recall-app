/**
 * Retailer notice review — the private approval step
 * (docs/recall-retailer-notices.md, "Approval and the client read path").
 *
 *   npm run retailer:review -- approve <request.json>              # dry run
 *   npm run retailer:review -- withdraw <native-id> --reason <text>
 *   npm run retailer:review -- confirm-agency-match <native-id> --case <uuid>
 *   ... withdraw and confirm-agency-match take --publisher aldi for an ALDI
 *   notice (default costco); an approval file names its own publisher.
 *   ... add --apply --confirm --expect <n> to write, with <n> from the dry run.
 *
 * Writes (apply only): retailer_notice_approvals, and the notice's alert row in
 * notification_events (retailer_notice_id, never a case; notice-events.ts).
 * An approval never touches recall_cases or source records, so it cannot
 * change the agency feed. A notice reaches shoppers only through
 * consumer_retailer_notices(), and only while its approval's document hash
 * equals the notice's current letter — the alert is held to the same rule.
 */

import { readFileSync } from 'node:fs';

import {
  DRY_RUN_DESPITE_ACKNOWLEDGMENTS,
  applyCommandLine,
  dryRunClosingLine,
  resolveCountGate,
  resolveFlagValue,
  resolveRepairAuthorization,
  type MutationCommandForm,
} from '../src/server/repair-authorization';
import {
  applyApprovalPlan,
  planAgencyMatch,
  planApproval,
  planWithdrawal,
  readApprovalRequest,
  type ApprovalPlan,
} from '../src/server/retailer/approval';
import { SupabaseApprovalStore } from '../src/server/retailer/approval-store';
import { isRetailerPublisher, RETAILER_SOURCES } from '../src/server/retailer/sources';
import { extractPdfPageTexts } from '../src/server/retailer/pdf-text';
import { createSupabaseServerClient } from '../src/server/store/supabase-store';

const FORM: MutationCommandForm = { script: 'retailer:review', positional: '<command> <target>' };

const HELP = `Retailer notice review (writes only retailer_notice_approvals).

  npm run retailer:review -- approve <request.json>
  npm run retailer:review -- withdraw <native-id> --reason <text>
  npm run retailer:review -- confirm-agency-match <native-id> --case <agency-case-uuid>

withdraw and confirm-agency-match act on Costco notices unless given
--publisher aldi. An approval request names its own publisher.

Each is a dry run that prints its plan. To write, add the three flags:
  ${applyCommandLine(FORM)}

approve              Approve one archived letter's shopper-facing fields. The
                     request names the letter's SHA-256; every field needs a
                     verbatim excerpt and its PDF page. A revised letter must be
                     approved again before it can appear.
withdraw             Hide a notice by withdrawing its live approval.
confirm-agency-match Record that an FDA/FSIS case is the same recall, which hides
                     the retailer notice so the recall is shown once.`;

const COMMANDS = ['approve', 'withdraw', 'confirm-agency-match'] as const;
type Command = (typeof COMMANDS)[number];

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    return;
  }
  // Authorization resolves from argv alone, before any credential or network.
  const auth = resolveRepairAuthorization(argv, FORM);
  const reason = resolveFlagValue(argv, '--reason');
  const caseFlag = resolveFlagValue(argv, '--case');
  const publisherFlag = resolveFlagValue(argv, '--publisher');
  const publisher = publisherFlag.value ?? 'costco';
  const publisherError =
    publisherFlag.error ??
    (isRetailerPublisher(publisher)
      ? null
      : `--publisher must be one of ${Object.keys(RETAILER_SOURCES).join(', ')}.\nNothing was written.`);
  const refusal = auth.error ?? reason.error ?? caseFlag.error ?? publisherError;
  if (refusal) {
    console.error(refusal);
    process.exit(1);
  }
  const bare = argv.filter(
    (arg, index) =>
      !arg.startsWith('-') &&
      !['--reason', '--case', '--expect', '--publisher'].includes(argv[index - 1] ?? ''),
  );
  const [commandArg, target] = bare;
  if (!COMMANDS.includes(commandArg as Command) || !target) {
    console.error(`Usage: see npm run retailer:review -- --help\nNothing was written.`);
    process.exit(1);
  }
  const command = commandArg as Command;
  let request: ReturnType<typeof readApprovalRequest> | null = null;
  if (command === 'approve') {
    try {
      request = readApprovalRequest(JSON.parse(readFileSync(target, 'utf8')));
    } catch (error) {
      console.error(
        `Could not read ${target}: ${error instanceof Error ? error.message : error}\nNothing was written.`,
      );
      process.exit(1);
    }
    if ('error' in request) {
      console.error(`Invalid approval request: ${request.error}\nNothing was written.`);
      process.exit(1);
    }
  }
  if (command === 'withdraw' && !reason.value) {
    console.error('withdraw requires --reason <text>.\nNothing was written.');
    process.exit(1);
  }
  if (command === 'confirm-agency-match' && !caseFlag.value) {
    console.error('confirm-agency-match requires --case <agency-case-uuid>.\nNothing was written.');
    process.exit(1);
  }

  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment may come from elsewhere.
  }
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY. Nothing was written.');
    process.exit(1);
  }
  const store = new SupabaseApprovalStore(createSupabaseServerClient(url, secretKey));
  const now = () => new Date();

  let plan: ApprovalPlan;
  if (command === 'approve' && request && !('error' in request)) {
    plan = await planApproval(store, request, now, extractPdfPageTexts);
  } else if (command === 'withdraw') {
    plan = await planWithdrawal(
      store,
      publisher as keyof typeof RETAILER_SOURCES,
      target,
      reason.value ?? '',
      now,
    );
  } else {
    plan = await planAgencyMatch(
      store,
      publisher as keyof typeof RETAILER_SOURCES,
      target,
      caseFlag.value ?? '',
      now,
    );
  }

  console.log(`\nRetailer notice review — ${command} — ${auth.apply ? 'APPLY' : 'dry run'}`);
  if (plan.problems.length > 0) {
    console.error('\n  REFUSED:');
    for (const problem of plan.problems) console.error(`  - ${problem}`);
    console.error('\n  Nothing was written.');
    process.exit(1);
  }
  for (const line of plan.summary) console.log(`  ${line}`);

  const extra = [
    ...(reason.value ? ['--reason', JSON.stringify(reason.value)] : []),
    ...(caseFlag.value ? ['--case', caseFlag.value] : []),
  ];
  const form: MutationCommandForm = { ...FORM, positional: `${command} ${target}` };
  const gate = resolveCountGate(auth, plan.writes.length);
  if (gate) {
    console.error(
      `\n  APPLY REFUSED: ${gate.reason} (expected ${gate.expected}, planned ${gate.actual}). ` +
        'Nothing was written.',
    );
    process.exit(1);
  }
  if (!auth.apply) {
    if (argv.includes('--confirm') || argv.includes('--expect')) {
      console.log(DRY_RUN_DESPITE_ACKNOWLEDGMENTS);
    }
    console.log(dryRunClosingLine(form, plan.writes.length, extra));
    return;
  }
  const written = await applyApprovalPlan(store, plan);
  console.log(`\n  Applied: ${written} writes to retailer_notice_approvals.`);
}

main().catch((error) => {
  console.error('Retailer review failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
