/**
 * Explicit, durable push-delivery activation — the ONLY way delivery turns on:
 *
 *   npm run push:activate                    # show state + what would happen
 *   npm run push:activate -- --confirm       # record push_enabled_at = now()
 *   npm run push:activate -- --deactivate --confirm   # emergency off switch
 *
 * The activation horizon is always "now" at the moment of confirmation — a
 * past date cannot be chosen, so activation can never make the pre-activation
 * deliverable backlog eligible. Re-running while active changes nothing
 * (idempotent); reactivating after a deactivation records a NEW horizon, so
 * events from the dark period are never blasted as catch-up.
 *
 * Requires SUPABASE_URL / SUPABASE_SECRET_KEY (server-only). Prints no secrets.
 */

import { hostname } from 'node:os';

import { createClient } from '@supabase/supabase-js';

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
  const confirm = process.argv.includes('--confirm');
  const deactivate = process.argv.includes('--deactivate');
  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const config = await client.from('push_delivery_config').select('push_enabled_at, activated_by');
  if (config.error) {
    console.error(
      `Could not read push_delivery_config: ${config.error.message}\n` +
        'Has the push_delivery migration been applied? (supabase db push, after review)',
    );
    process.exit(1);
  }
  const current = (config.data?.[0]?.push_enabled_at as string | undefined) ?? null;

  const backlog = await client
    .from('notification_events')
    .select('id', { count: 'exact', head: true })
    .is('suppressed', null);
  const subscriptions = await client
    .from('push_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('enabled', true);

  console.log('\nPush delivery activation');
  console.log(
    `  current state:            ${current ? `ACTIVE since ${current}` : 'NOT ACTIVATED'}`,
  );
  console.log(
    `  deliverable ledger events: ${backlog.count ?? 0} (all created before a new horizon stay excluded)`,
  );
  console.log(`  enabled subscriptions:     ${subscriptions.count ?? 0}\n`);

  if (deactivate) {
    if (!current) {
      console.log('Already deactivated — nothing to do.');
      return;
    }
    if (!confirm) {
      console.log('Would DEACTIVATE push delivery (worker returns to no-send state).');
      console.log('Run with --deactivate --confirm to apply.');
      return;
    }
    const { error } = await client
      .from('push_delivery_config')
      .update({ push_enabled_at: null, updated_at: new Date().toISOString() })
      .eq('id', true);
    if (error) {
      console.error(`Deactivation failed: ${error.message}`);
      process.exit(1);
    }
    console.log('Push delivery DEACTIVATED. Reactivating later records a new horizon —');
    console.log('events created while deactivated will not be sent as catch-up.');
    return;
  }

  if (current) {
    console.log('Already activated — idempotent, nothing changed.');
    console.log('(Emergency off switch: npm run push:activate -- --deactivate --confirm)');
    return;
  }
  if (!confirm) {
    console.log('Would ACTIVATE push delivery with horizon = the moment of confirmation.');
    console.log(`All ${backlog.count ?? 0} existing deliverable events stay permanently excluded;`);
    console.log('only events created AFTER activation can ever be delivered.');
    console.log('\nRun with --confirm to activate.');
    return;
  }

  const nowIso = new Date().toISOString();
  const { error } = await client
    .from('push_delivery_config')
    .upsert({ id: true, push_enabled_at: nowIso, activated_by: hostname(), updated_at: nowIso });
  if (error) {
    console.error(`Activation failed: ${error.message}`);
    process.exit(1);
  }
  console.log(`Push delivery ACTIVATED — horizon ${nowIso}.`);
  console.log(`The ${backlog.count ?? 0} pre-activation deliverable events are excluded forever.`);
  console.log('Delivery happens on the next scheduled jobs:push run (or run it now).');
}

main().catch((error) => {
  console.error('push:activate failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
