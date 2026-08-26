/**
 * Send ONE clearly-labeled test notification to ONE explicitly named
 * subscription — the safe path for verifying a development device end-to-end:
 *
 *   npm run push:test -- --subscription <subscription-uuid>
 *
 * Deliberately narrow: it cannot broadcast (one explicit id, no wildcard), it
 * touches no RecallCase, NotificationEvent, or delivery row, and its payload
 * kind is 'test' so the app's tap-navigation validator ignores it. The
 * production broadcast path stays exclusively in jobs:push.
 *
 * Run without --subscription to list registered subscription ids (ids,
 * platforms, and timestamps only — never tokens) and pick your device.
 */

import { createClient } from '@supabase/supabase-js';

import { ExpoPushTransport } from '../src/server/push/expo-transport';

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment may be configured another way.
  }
}

async function main(): Promise<void> {
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

  const flagIndex = process.argv.indexOf('--subscription');
  const subscriptionId = flagIndex >= 0 ? process.argv[flagIndex + 1] : undefined;
  if (!subscriptionId || !/^[0-9a-f-]{36}$/i.test(subscriptionId)) {
    console.error(
      'Usage: npm run push:test -- --subscription <subscription-uuid>\n' +
        'Exactly one explicitly named subscription; this tool cannot broadcast.\n',
    );
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
  const { data, error } = await client
    .from('push_subscriptions')
    .select('id, expo_push_token, platform, enabled')
    .eq('id', subscriptionId)
    .maybeSingle();
  if (error) {
    console.error(`Could not read subscription: ${error.message}`);
    process.exit(1);
  }
  if (!data) {
    console.error(`No subscription with id ${subscriptionId}.`);
    process.exit(1);
  }
  if (!data.enabled) {
    console.error('That subscription is disabled — re-enable alerts on the device first.');
    process.exit(1);
  }

  const transport = new ExpoPushTransport({ accessToken: process.env.EXPO_ACCESS_TOKEN });
  const [ticket] = await transport.send([
    {
      to: data.expo_push_token as string,
      title: 'Recall test notification',
      body: 'This is a test from the Recall delivery setup. No recall is attached.',
      // kind 'test' (not 'recall'): the app's tap validator will not navigate.
      data: { kind: 'test' } as never,
      sound: 'default',
    },
  ]);

  if (ticket.status === 'ok') {
    console.log(`Test notification accepted by Expo (ticket ${ticket.id}).`);
    console.log('A ticket is acceptance, not delivery — the device should show it shortly.');
  } else {
    console.error(
      `Expo rejected the test send: ${ticket.details?.error ?? 'unknown'} — ${ticket.message}`,
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('push:test failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
