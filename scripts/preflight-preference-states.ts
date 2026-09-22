/**
 * P2B7U expand migration — READ-ONLY production preflight.
 *
 * Answers, before anyone types `supabase db push`, exactly what the expand
 * migration will do to the live `installation_preferences` table: how many
 * rows exist, how many carry a legacy `state_code`, whether any of those codes
 * is outside the closed 52-jurisdiction set, and therefore the exact number of
 * rows the backfill will touch. It also reports whether the migration has
 * already been applied, so a second run is obviously a no-op rather than a
 * guess.
 *
 * This script only ever SELECTs. It creates no row, updates none, and runs no
 * DDL — it is safe at any time, including while the scheduler is running.
 *
 * Preferences are personal data: this prints COUNTS and code distributions
 * only. No installation id, and nothing that identifies a device, is read into
 * the output.
 *
 *   npm run preflight:preference-states
 */

import { SUPPORTED_STATE_CODES } from '../src/domain/preferences';
import { createSupabaseServerClient } from '../src/server/store/supabase-store';

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment may be configured another way.
  }
}

interface LegacyRow {
  state_code: string | null;
  state_codes?: string[] | null;
}

async function main(): Promise<void> {
  loadDotEnv();
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY.');
    process.exit(1);
  }
  const client = createSupabaseServerClient(url, secretKey);

  console.log('P2B7U expand preflight — READ-ONLY. Nothing below writes.\n');

  // Has the expand already happened? Asking for the column is the honest test:
  // PostgREST answers a missing column with an error naming it.
  const expandedProbe = await client
    .from('installation_preferences')
    .select('state_codes')
    .limit(1);
  const expanded = !expandedProbe.error;
  console.log(
    expanded
      ? 'SCHEMA        state_codes EXISTS — the expand migration is already applied.'
      : 'SCHEMA        state_codes ABSENT — the expand migration has NOT been applied.',
  );
  if (!expanded && expandedProbe.error) {
    console.log(`              (${expandedProbe.error.message})`);
  }

  // Row census. A ranged select rather than a HEAD count: PostgREST answers
  // HEAD on a missing table with 204/no error, which would print a misleading
  // zero if the C3 migration itself were somehow absent.
  const total = await client
    .from('installation_preferences')
    .select('installation_id', { count: 'exact' })
    .limit(0);
  if (total.error) {
    console.error(`installation_preferences unreadable: ${total.error.message}`);
    process.exit(1);
  }
  const rowCount = total.count ?? 0;
  console.log(`ROWS          ${rowCount} installation preference row(s)`);

  // Every legacy code, so invalid or unexpected shapes are named rather than
  // assumed away. Bounded by the row count above, which is tiny pre-launch.
  const legacy = await client
    .from('installation_preferences')
    .select(expanded ? 'state_code, state_codes' : 'state_code');
  if (legacy.error) {
    console.error(`legacy code read failed: ${legacy.error.message}`);
    process.exit(1);
  }
  const rows = (legacy.data ?? []) as unknown as LegacyRow[];

  const withCode = rows.filter((row) => row.state_code !== null && row.state_code !== undefined);
  const supported = new Set(SUPPORTED_STATE_CODES);
  const invalid = withCode.filter((row) => !supported.has(row.state_code as string));
  const shapes = new Map<string, number>();
  for (const row of withCode) {
    const code = row.state_code as string;
    const shape = supported.has(code)
      ? 'valid'
      : /^[A-Z]{2}$/.test(code)
        ? 'two uppercase letters, not a supported jurisdiction'
        : 'unexpected shape';
    shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
  }

  console.log(`              ${withCode.length} with a non-null state_code`);
  console.log(`              ${rowCount - withCode.length} with a null state_code`);
  for (const [shape, n] of [...shapes].sort()) {
    console.log(`                · ${shape}: ${n}`);
  }

  const distribution = new Map<string, number>();
  for (const row of withCode) {
    const code = row.state_code as string;
    distribution.set(code, (distribution.get(code) ?? 0) + 1);
  }
  if (distribution.size > 0) {
    const listed = [...distribution]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([code, n]) => `${code} ${n}`)
      .join(', ');
    console.log(`CODES         ${listed}`);
  }

  if (invalid.length > 0) {
    console.log(
      `\nINVALID       ${invalid.length} row(s) hold a state_code outside the closed 52-code set:`,
    );
    for (const row of invalid) console.log(`                · ${JSON.stringify(row.state_code)}`);
    console.log(
      '              The backfill copies these VERBATIM into state_codes. They are already\n' +
        '              inert to matching (no geography ever equals them), and the RPC will\n' +
        '              refuse to write them back, so the next save cleans the row. Decide\n' +
        '              explicitly whether to leave them or correct them first.',
    );
  } else {
    console.log('INVALID       0 — every stored state_code is a supported jurisdiction.');
  }

  // Duplicates cannot exist: installation_id is the primary key, and a scalar
  // column holds one value. Stated rather than assumed, because the founder's
  // preflight asks for it.
  console.log('DUPLICATES    not possible — installation_id is the primary key and');
  console.log('              state_code is a scalar column, so no row can hold two.');

  const alreadyBackfilled = expanded
    ? rows.filter((row) => (row.state_codes?.length ?? 0) > 0).length
    : 0;
  const willBackfill = expanded
    ? withCode.filter((row) => (row.state_codes?.length ?? 0) === 0).length
    : withCode.length;

  console.log('\nEXPECTED BACKFILL');
  console.log(`  rows the UPDATE will touch:            ${willBackfill}`);
  console.log(
    `  rows left with an empty state_codes:   ${rowCount - willBackfill - alreadyBackfilled}`,
  );
  if (expanded) {
    console.log(`  rows already carrying state_codes:     ${alreadyBackfilled}`);
    console.log(
      '  (the migration is already applied, so a re-run touches 0 rows — the\n' +
        "   backfill's guard excludes every row that no longer holds an empty array)",
    );
  }
  console.log('\nNothing was written. Apply is a separate, explicitly authorized step.');
}

void main();
