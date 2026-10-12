/**
 * Send ONE clearly labelled test notification to ONE explicitly named
 * subscription — the safe path for verifying a device end-to-end:
 *
 *   npm run push:test                                         # list subscription ids
 *   npm run push:test -- --subscription <uuid>                # delivery check (opens nothing)
 *   npm run push:test -- --subscription <uuid> --recall <case-uuid>
 *                                                             # tap check: opens that recall
 *   …add --dry-run to print the message and send nothing
 *
 * Deliberately narrow: it cannot broadcast (one explicit id, no wildcard), and
 * it touches no RecallCase, NotificationEvent or delivery row. The message is
 * built by src/server/push/test-message.ts (pure, tested); this file only
 * reads, builds, and sends. The production broadcast path stays exclusively
 * in jobs:push. Tokens are never printed.
 */

import { createClient } from '@supabase/supabase-js';

import { ExpoPushTransport } from '../src/server/push/expo-transport';
import { SupabasePushStore } from '../src/server/push/push-store';
import {
  buildPlainTestMessage,
  buildRecallTestMessage,
  describeTestMessage,
  parsePushTestArgs,
} from '../src/server/push/test-message';
import type { TestPushMessage } from '../src/server/push/types';

const USAGE =
  'Usage: npm run push:test -- --subscription <subscription-uuid> [--recall <case-uuid>] [--dry-run]\n' +
  'Exactly one explicitly named subscription; this tool cannot broadcast.';

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment may be configured another way.
  }
}

async function main(): Promise<void> {
  const args = parsePushTestArgs(process.argv.slice(2));
  if (args.mode === 'usage') {
    console.error(`${args.problem}.\n${USAGE}`);
    process.exit(1);
  }

  loadDotEnv();
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY.');
    process.exit(1);
  }
  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (args.mode === 'list') {
    console.error(`${USAGE}\n`);
    const recent = await client
      .from('push_subscriptions')
      .select('id, platform, enabled, registered_at, last_seen_at')
      .order('registered_at', { ascending: false })
      .limit(10);
    if (!recent.error && (recent.data?.length ?? 0) > 0) {
      console.error('Registered subscriptions (newest first — tokens are never shown):');
      for (const row of recent.data ?? []) {
        console.error(
          `  ${row.id}  ${row.platform}  ${row.enabled ? 'enabled' : 'DISABLED'}  registered ${row.registered_at}`,
        );
      }
    }
    process.exit(1);
  }

  // ── Read ──────────────────────────────────────────────────────────────────
  const { data, error } = await client
    .from('push_subscriptions')
    .select('id, expo_push_token, platform, enabled')
    .eq('id', args.subscriptionId)
    .maybeSingle();
  if (error) {
    console.error(`Could not read subscription: ${error.message}`);
    process.exit(1);
  }
  if (!data) {
    console.error(`No subscription with id ${args.subscriptionId}.`);
    process.exit(1);
  }
  if (!data.enabled) {
    console.error('That subscription is disabled — re-enable alerts on the device first.');
    process.exit(1);
  }
  const token = data.expo_push_token as string;

  // ── Build ─────────────────────────────────────────────────────────────────
  let message: TestPushMessage;
  if (args.recallCaseId === null) {
    message = buildPlainTestMessage(token);
  } else {
    const recallCase = await new SupabasePushStore(client).getCase(args.recallCaseId);
    const built = buildRecallTestMessage(token, recallCase, new Date());
    if (!built.ok) {
      console.error(`Refusing the recall test: ${built.reason}.`);
      process.exit(1);
    }
    message = built.message;
  }
  console.log(
    `${args.dryRun ? 'Would send' : 'Sending'} to subscription ${args.subscriptionId} (${data.platform}):`,
  );
  console.log(describeTestMessage(message));
  if (args.dryRun) {
    console.log('\nDry run — nothing sent.');
    return;
  }

  // ── Send ──────────────────────────────────────────────────────────────────
  const transport = new ExpoPushTransport({ accessToken: process.env.EXPO_ACCESS_TOKEN });
  const [ticket] = await transport.send([message]);
  if (ticket.status === 'ok') {
    console.log(`\nAccepted by Expo (ticket ${ticket.id}).`);
    console.log('A ticket is acceptance, not delivery — the device should show it shortly.');
  } else {
    console.error(
      `\nExpo rejected the test send: ${ticket.details?.error ?? 'unknown'} — ${ticket.message}`,
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('push:test failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
