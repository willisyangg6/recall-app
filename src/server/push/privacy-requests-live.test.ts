/**
 * Privacy requests (20261016000000), BEHAVIOURAL proof on a real Postgres
 * through real PostgREST: expiry, single use (also under a race), guessing
 * protection, isolation between installations, the operator's count gate,
 * the three-live-codes cap, the spent-code cleanup, and that every deletion
 * path takes the codes with it.
 *
 * ISOLATED STACK ONLY, AND OPT-IN. These tests write, so they never resolve
 * "whatever stack `supabase status` finds": they run only with
 * PRIVACY_REQUESTS_LIVE=1 and a SUPABASE_WORKDIR naming a scratch workdir
 * whose project_id is not the shared `recall-app` stack, and SKIP otherwise,
 * naming what is missing. The recipe is in
 * docs/recall-operations.md ("Privacy requests").
 */

import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { EXPORT_FIELDS, REQUEST_CODE_ALPHABET } from '../../lib/privacy-requests';

interface Stack {
  projectId: string;
  restUrl: string;
  anonKey: string;
  serviceKey: string;
}

function isolatedStack(): Stack | string {
  // Opt-in, so `npm test` never runs it beside preference-states-live.test.ts,
  // which asserts the whole stack's push tables are empty: test files run in
  // parallel, and this suite's rows exist while it runs.
  if (process.env.PRIVACY_REQUESTS_LIVE !== '1') return 'set PRIVACY_REQUESTS_LIVE=1 to run';
  const workdir = process.env.SUPABASE_WORKDIR;
  if (!workdir) return 'SUPABASE_WORKDIR is not set to an isolated scratch stack';
  const config = join(workdir, 'supabase', 'config.toml');
  if (!existsSync(config)) return `no supabase/config.toml under ${workdir}`;
  const projectId = /^project_id = "([^"]+)"/m.exec(readFileSync(config, 'utf8'))?.[1];
  if (!projectId || projectId === 'recall-app') {
    return 'SUPABASE_WORKDIR is the shared recall-app stack; refusing to write to it';
  }
  let env: string;
  try {
    env = execFileSync('supabase', ['status', '-o', 'env'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 30_000,
    });
  } catch {
    return `the isolated stack ${projectId} is not running`;
  }
  const read = (key: string) => env.match(new RegExp(`^${key}="?([^"\n]+)"?$`, 'm'))?.[1] ?? null;
  const restUrl = read('REST_URL');
  const anonKey = read('ANON_KEY');
  const serviceKey = read('SERVICE_ROLE_KEY');
  if (!restUrl || !anonKey || !serviceKey) return `the isolated stack ${projectId} gave no keys`;
  if (/:54321\b/.test(restUrl)) return 'the resolved REST URL is the shared stack port; refusing';
  return { projectId, restUrl, anonKey, serviceKey };
}

const RESOLVED = isolatedStack();
const STACK = typeof RESOLVED === 'string' ? null : RESOLVED;
const SKIP = typeof RESOLVED === 'string' ? RESOLVED : false;

async function call(
  role: 'anon' | 'service',
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const stack = STACK as Stack;
  const key = role === 'anon' ? stack.anonKey : stack.serviceKey;
  const response = await fetch(`${stack.restUrl}/${path}`, {
    method: init.method ?? 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  return { ok: response.ok, status: response.status, body: text ? JSON.parse(text) : null };
}

const anon = (fn: string, body: Record<string, unknown>) => call('anon', `rpc/${fn}`, { body });
const service = (fn: string, body: Record<string, unknown>) =>
  call('service', `rpc/${fn}`, { body });

const sha = (code: string) => createHash('sha256').update(code, 'utf8').digest('hex');
const newInstallation = () => randomUUID();

async function seed(installationId: string, states: string[], allergens: string[]) {
  for (const [fn, body] of [
    [
      'set_installation_preferences',
      {
        p_installation_id: installationId,
        p_state_codes: states,
        p_allergens: allergens,
        p_retailer_ids: ['walmart'],
        // Since 20261014 the server stores allergens only with a consent
        // version; without one they would be dropped and the isolation
        // check below could not see them.
        p_allergen_consent: 'allergens-v1',
        p_allergen_consent_decided_at: new Date().toISOString(),
      },
    ],
    [
      'register_push_subscription',
      {
        p_installation_id: installationId,
        p_expo_push_token: `ExponentPushToken[${randomBytes(11).toString('hex')}]`,
        p_platform: 'ios',
        p_app_version: '1.0.0',
        p_sequence: 1,
      },
    ],
    ['record_installation_activity', { p_installation_id: installationId }],
  ] as const) {
    const result = await anon(fn, body);
    assert.ok(result.ok, `${fn}: HTTP ${result.status} ${JSON.stringify(result.body)}`);
  }
}

async function createCode(installationId: string, purpose: 'access' | 'delete') {
  const result = await anon('create_privacy_request_code', {
    p_installation_id: installationId,
    p_purpose: purpose,
  });
  assert.ok(result.ok, `create: HTTP ${result.status} ${JSON.stringify(result.body)}`);
  return result.body as { code: string; purpose: string; expires_at: string };
}

async function lookup(code: string) {
  return (await service('lookup_privacy_request', { p_code_hash: sha(code) })).body as Record<
    string,
    unknown
  >;
}

async function redeem(code: string, expected: number) {
  const result = await service('redeem_privacy_request', {
    p_code_hash: sha(code),
    p_expected_rows: expected,
  });
  assert.ok(result.ok, `redeem: HTTP ${result.status} ${JSON.stringify(result.body)}`);
  return result.body as Record<string, unknown>;
}

async function total(installationId: string): Promise<number> {
  const counts = (
    await service('installation_data_row_counts', { p_installation_id: installationId })
  ).body as Record<string, number>;
  return counts.total;
}

/** Move a code's clock back, as the owner of the table (the service role). */
async function age(code: string, days: number, used: boolean) {
  const created = new Date(Date.now() - days * 86_400_000);
  const expires = new Date(created.getTime() + 14 * 86_400_000);
  const result = await call('service', `installation_request_codes?code_hash=eq.${sha(code)}`, {
    method: 'PATCH',
    body: {
      created_at: created.toISOString(),
      expires_at: expires.toISOString(),
      used_at: used ? new Date(created.getTime() + 60_000).toISOString() : null,
    },
    prefer: 'return=minimal',
  });
  assert.ok(result.ok, `age: HTTP ${result.status} ${JSON.stringify(result.body)}`);
}

test(
  'a code is 12 characters of the alphabet and the server keeps only its SHA-256',
  { skip: SKIP },
  async () => {
    const a = newInstallation();
    await seed(a, ['CA'], ['peanut']);
    const created = await createCode(a, 'access');
    assert.match(created.code, new RegExp(`^[${REQUEST_CODE_ALPHABET}]{12}$`));
    const expires = Date.parse(created.expires_at) - Date.now();
    assert.ok(Math.abs(expires - 14 * 86_400_000) < 60_000, 'expires in 14 days');

    const rows = (
      await call('service', `installation_request_codes?installation_id=eq.${a}`, { method: 'GET' })
    ).body as Record<string, unknown>[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].code_hash, sha(created.code));
    assert.ok(!JSON.stringify(rows).includes(created.code), 'the plain code is stored nowhere');
    await anon('delete_installation_data', { p_installation_id: a });
  },
);

test(
  'guessing: the public key can neither read codes nor test one, and guesses find nothing',
  { skip: SKIP },
  async () => {
    const a = newInstallation();
    await seed(a, ['CA'], []);
    const created = await createCode(a, 'delete');

    const table = await call('anon', 'installation_request_codes?select=*', { method: 'GET' });
    assert.ok(!table.ok, `the table is not readable with the public key (HTTP ${table.status})`);
    for (const [fn, body] of [
      ['lookup_privacy_request', { p_code_hash: sha(created.code) }],
      ['redeem_privacy_request', { p_code_hash: sha(created.code), p_expected_rows: 0 }],
      ['installation_data_row_counts', { p_installation_id: a }],
      ['purge_spent_request_codes', {}],
    ] as const) {
      const result = await anon(fn, body);
      assert.ok(!result.ok, `${fn} refused to the public key (HTTP ${result.status})`);
    }

    // 200 well-formed guesses: none matches, and none consumes anything.
    for (let guess = 0; guess < 200; guess += 1) {
      const bytes = randomBytes(12);
      const code = [...bytes].map((byte) => REQUEST_CODE_ALPHABET[byte & 31]).join('');
      if (code === created.code) continue;
      assert.equal((await lookup(code)).status, 'unknown');
      assert.equal((await redeem(code, 1)).status, 'not_redeemable');
    }
    assert.equal((await lookup(created.code)).status, 'live', 'the real code is untouched');
    const malformed = await service('lookup_privacy_request', { p_code_hash: 'not-a-hash' });
    assert.ok(!malformed.ok);
    await anon('delete_installation_data', { p_installation_id: a });
  },
);

test(
  'isolation: one installation’s export, code and redemption never reach another’s',
  { skip: SKIP },
  async () => {
    const a = newInstallation();
    const b = newInstallation();
    await seed(a, ['CA'], ['peanut']);
    await seed(b, ['NY'], ['sesame']);
    const codeB = await createCode(b, 'delete');

    const exportA = (await anon('export_installation_data', { p_installation_id: a }))
      .body as Record<string, unknown>;
    const text = JSON.stringify(exportA);
    assert.ok(!text.includes(a) && !text.includes(b), 'no installation id in the export');
    assert.ok(text.includes('peanut') && !text.includes('sesame'));
    // The consent record is exported by name from the explicit field list.
    const preferences = exportA.preferences as Record<string, unknown>;
    assert.equal(preferences.allergen_consent_version, 'allergens-v1');
    assert.equal(typeof preferences.allergen_consent_decided_at, 'string');
    const registration = (exportA.push_registrations as Record<string, unknown>[])[0];
    assert.match(String(registration.push_token), /^…[0-9a-f]{4}$/, 'the token is masked');
    assert.ok(!('expo_push_token' in registration));

    // A creates codes up to and past the cap: B's code is never revoked.
    const codesA = [];
    for (let index = 0; index < 4; index += 1) codesA.push(await createCode(a, 'access'));
    assert.equal((await lookup(codeB.code)).status, 'live');

    const hint = await lookup(codesA[3].code);
    assert.equal(hint.installation_hint, a.slice(0, 4));
    assert.ok(!JSON.stringify(hint).includes(a), 'the lookup never returns the whole id');

    const redeemed = await redeem(codesA[3].code, await total(a));
    assert.equal(redeemed.status, 'redeemed');
    const exported = JSON.stringify(redeemed.export);
    assert.ok(exported.includes('"CA"') && !exported.includes('"NY"'));
    assert.ok((await total(b)) > 0, 'B is untouched');

    await anon('delete_installation_data', { p_installation_id: a });
    await anon('delete_installation_data', { p_installation_id: b });
  },
);

test('the cap: a fourth code revokes the oldest live one', { skip: SKIP }, async () => {
  const a = newInstallation();
  await seed(a, ['CA'], []);
  const codes = [];
  for (let index = 0; index < 4; index += 1) codes.push(await createCode(a, 'access'));
  assert.equal((await lookup(codes[0].code)).status, 'unknown', 'the oldest was revoked');
  for (const code of codes.slice(1)) assert.equal((await lookup(code.code)).status, 'live');
  await anon('delete_installation_data', { p_installation_id: a });
});

test(
  'single use: a second redemption, or a racing one, finds nothing',
  { skip: SKIP },
  async () => {
    const a = newInstallation();
    await seed(a, ['CA'], ['milk']);
    const first = await createCode(a, 'access');
    const expected = await total(a);
    assert.equal((await redeem(first.code, expected)).status, 'redeemed');
    assert.equal((await redeem(first.code, expected)).status, 'not_redeemable');
    assert.equal((await lookup(first.code)).status, 'used');

    const racing = await createCode(a, 'access');
    const racingTotal = await total(a);
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () => redeem(racing.code, racingTotal)),
    );
    assert.equal(outcomes.filter((outcome) => outcome.status === 'redeemed').length, 1);
    assert.equal(outcomes.filter((outcome) => outcome.status === 'not_redeemable').length, 5);
    await anon('delete_installation_data', { p_installation_id: a });
  },
);

test(
  'expiry: a code past 14 days cannot be redeemed and deletes nothing',
  { skip: SKIP },
  async () => {
    const a = newInstallation();
    await seed(a, ['CA'], []);
    const created = await createCode(a, 'delete');
    await age(created.code, 15, false);
    const before = await total(a);
    assert.equal((await lookup(created.code)).status, 'expired');
    assert.equal((await redeem(created.code, before)).status, 'not_redeemable');
    assert.equal(await total(a), before, 'nothing was deleted');
    await anon('delete_installation_data', { p_installation_id: a });
  },
);

test(
  'the count gate: changed rows refuse the apply and leave the code live',
  { skip: SKIP },
  async () => {
    const a = newInstallation();
    await seed(a, ['CA'], []);
    const created = await createCode(a, 'delete');
    const reviewed = await total(a);
    const refused = await redeem(created.code, reviewed + 1);
    assert.deepEqual(refused, {
      status: 'count_changed',
      expected: reviewed + 1,
      actual: reviewed,
    });
    assert.equal((await lookup(created.code)).status, 'live');
    assert.equal(await total(a), reviewed);

    // The reviewed count deletes everything, the code included.
    const done = await redeem(created.code, reviewed);
    assert.equal(done.status, 'redeemed');
    assert.equal(done.purpose, 'delete');
    assert.equal(await total(a), 0);
    assert.equal((await lookup(created.code)).status, 'unknown');
  },
);

test(
  'every deletion path takes the codes: the in-app reset and the spent-code cleanup',
  { skip: SKIP },
  async () => {
    const a = newInstallation();
    await seed(a, ['CA'], []);
    const created = await createCode(a, 'access');
    assert.ok((await anon('delete_installation_data', { p_installation_id: a })).ok);
    assert.equal(await total(a), 0);
    assert.equal((await lookup(created.code)).status, 'unknown');

    const b = newInstallation();
    await seed(b, ['CA'], []);
    const spent = await createCode(b, 'access');
    const recent = await createCode(b, 'access');
    await age(spent.code, 50, true); // used 50 days ago: past the 30-day keep
    await age(recent.code, 20, true); // used 20 days ago: kept
    const purged = (await service('purge_spent_request_codes', {})).body as number;
    assert.ok(purged >= 1);
    assert.equal((await lookup(spent.code)).status, 'unknown');
    assert.equal((await lookup(recent.code)).status, 'used');
    await anon('delete_installation_data', { p_installation_id: b });
  },
);

test('invalid input is refused with fixed messages', { skip: SKIP }, async () => {
  const bad = await anon('create_privacy_request_code', {
    p_installation_id: newInstallation(),
    p_purpose: 'correct',
  });
  assert.ok(!bad.ok);
  assert.match(JSON.stringify(bad.body), /invalid request purpose/);
  const badId = await anon('export_installation_data', { p_installation_id: 'short' });
  assert.ok(!badId.ok);
  assert.match(JSON.stringify(badId.body), /invalid installation id/);
});

/** SQL as the database owner, inside the isolated stack's own container. */
function ownerSql(sql: string): string {
  const stack = STACK as Stack;
  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      `supabase_db_${stack.projectId}`,
      'psql',
      '-U',
      'postgres',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: sql, encoding: 'utf8' },
  );
}

test(
  'a column a later migration adds is NOT exported: only the approved fields leave',
  { skip: SKIP },
  async () => {
    const a = newInstallation();
    await seed(a, ['CA'], ['milk']);
    await createCode(a, 'access');
    // 64 hex characters, so it also satisfies the real app_transaction_hmac
    // check (20261017 added that column; it is never exported).
    const SECRET = randomBytes(32).toString('hex');
    // The alert entitlement gate's purchase id (20261018): only its last 4 leave.
    const PURCHASE = `${randomBytes(8).toString('hex')}-${randomBytes(4).toString('hex')}`;
    // The shape of what later branches add: new columns on every exported table.
    ownerSql(`
    alter table public.push_subscriptions add column future_internal text;
    alter table public.installation_preferences add column future_internal text;
    alter table public.shopper_reports add column future_internal text;
    alter table public.push_installation_sequences add column future_internal text;
    alter table public.installation_request_codes add column future_internal text;
    insert into public.recall_cases (id, projection, last_changed_at)
      values ('cccccccc-a110-4000-8000-cccccccccccc', '{}'::jsonb, now()) on conflict do nothing;
    insert into public.shopper_reports (recall_case_id, installation_id, state_code, purchase_window)
      values ('cccccccc-a110-4000-8000-cccccccccccc', '${a}', 'CA', 'past_week');
    update public.push_subscriptions
       set app_transaction_hmac = '${SECRET}', future_internal = '${SECRET}', purchase_id = '${PURCHASE}'
     where installation_id = '${a}';
    update public.installation_preferences set future_internal = '${SECRET}' where installation_id = '${a}';
    update public.shopper_reports set future_internal = '${SECRET}' where installation_id = '${a}';
    update public.push_installation_sequences set future_internal = '${SECRET}' where installation_id = '${a}';
    update public.installation_request_codes set future_internal = '${SECRET}' where installation_id = '${a}';
  `);
    try {
      const exported = (await anon('export_installation_data', { p_installation_id: a }))
        .body as Record<string, unknown>;
      const text = JSON.stringify(exported);
      assert.ok(!text.includes(SECRET), 'no value from an unapproved column is exported');
      assert.ok(!text.includes('app_transaction_hmac') && !text.includes('future_internal'));
      assert.ok(!text.includes(PURCHASE), 'the full purchase id is never exported');
      const registration = (exported.push_registrations as Record<string, unknown>[])[0];
      assert.equal(registration.purchase_id_last4, PURCHASE.slice(-4));
      assert.equal(registration.entitlement_status, 'unknown');
      const keys = (value: unknown) => Object.keys(value as Record<string, unknown>).sort();
      assert.deepEqual(keys(exported.preferences), [...EXPORT_FIELDS.preferences].sort());
      assert.deepEqual(keys(exported.alert_order), [...EXPORT_FIELDS.alert_order].sort());
      for (const group of ['push_registrations', 'shopper_reports', 'request_codes'] as const) {
        const rows = exported[group] as unknown[];
        assert.ok(rows.length > 0, `${group} has a row`);
        for (const row of rows)
          assert.deepEqual(keys(row), [...EXPORT_FIELDS[group]].sort(), group);
      }
    } finally {
      ownerSql(`
      delete from public.shopper_reports where installation_id = '${a}';
      delete from public.recall_cases where id = 'cccccccc-a110-4000-8000-cccccccccccc';
      alter table public.push_subscriptions drop column future_internal;
      alter table public.installation_preferences drop column future_internal;
      alter table public.shopper_reports drop column future_internal;
      alter table public.push_installation_sequences drop column future_internal;
      alter table public.installation_request_codes drop column future_internal;
    `);
      await anon('delete_installation_data', { p_installation_id: a });
    }
  },
);
