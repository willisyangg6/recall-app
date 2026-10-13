/**
 * The consent-revocation endpoint (age assurance, 2026-10-13), with the
 * verifier it deploys with (apple-jws.ts, held equal to Apple's library in
 * apple-jws.test.ts) and a test chain shaped like Apple's, built at run
 * time (test-chain.ts): signature, chain, marker OIDs, bundle, environment,
 * and the endpoint's own rules — only RESCIND_CONSENT acts, nothing
 * identifying is logged, a database failure is retried.
 */

import assert from 'node:assert/strict';
import { createHash, randomUUID, sign, X509Certificate, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { before, test } from 'node:test';

import { createAppleVerifier } from '../../../supabase/functions/app-store-notifications/apple-jws';
import {
  APPLE_ROOT_CA_G3_BASE64,
  APPLE_ROOT_CA_G3_SHA256,
} from '../../../supabase/functions/app-store-notifications/apple-root-certificates';
import {
  claimedEnvironment,
  handleAppStoreNotification,
  type AppStoreNotificationDeps,
  type NotificationVerifier,
} from '../../../supabase/functions/app-store-notifications/core';

import { testChain } from './test-chain';

const BUNDLE = 'com.willisyang.lotly';
let ROOT: Buffer;
let INTERMEDIATE: Buffer;
let LEAF_WITHOUT_MARKER: Buffer;
let LEAF_KEY: KeyObject;
let CHAIN: Buffer[];

before(async () => {
  const chain = await testChain();
  ROOT = chain.root;
  INTERMEDIATE = chain.intermediate;
  LEAF_WITHOUT_MARKER = chain.leafWithoutMarker;
  LEAF_KEY = chain.leafKey;
  CHAIN = [chain.leaf, chain.intermediate, chain.root];
});

const b64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

function jws(payload: object, chain: Buffer[] = CHAIN, key: KeyObject = LEAF_KEY): string {
  const header = { alg: 'ES256', x5c: chain.map((cert) => cert.toString('base64')) };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });
  return `${input}.${b64url(signature)}`;
}

function appTransaction(overrides: object = {}): string {
  return jws({
    appTransactionId: '704289572311859823',
    bundleId: BUNDLE,
    receiptType: 'Sandbox',
    receiptCreationDate: Date.now(),
    originalPlatform: 'iOS',
    ...overrides,
  });
}

function notification(overrides: object = {}, appData: object = {}): string {
  return jws({
    notificationType: 'RESCIND_CONSENT',
    notificationUUID: randomUUID(),
    version: '2.0',
    signedDate: Date.now(),
    appData: {
      bundleId: BUNDLE,
      environment: 'Sandbox',
      signedAppTransactionInfo: appTransaction(),
      ...appData,
    },
    ...overrides,
  });
}

function sandboxVerifier(roots: Buffer[] = [ROOT]): NotificationVerifier {
  return createAppleVerifier({
    roots: roots.map((root) => new Uint8Array(root)),
    environment: 'Sandbox',
    bundleId: BUNDLE,
  });
}

function harness(
  rpcResult: { data: unknown; error: string | null } = {
    data: { duplicate: false, disabled: 1 },
    error: null,
  },
) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const logs: string[] = [];
  const deps: AppStoreNotificationDeps = {
    verifiers: { Sandbox: sandboxVerifier() },
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      return rpcResult;
    },
    log: (line) => logs.push(line),
  };
  return { deps, calls, logs };
}

const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) });

test('the pinned root is Apple Root CA - G3, by fingerprint', () => {
  const root = new X509Certificate(Buffer.from(APPLE_ROOT_CA_G3_BASE64, 'base64'));
  assert.equal(
    createHash('sha256').update(root.raw).digest('hex').toUpperCase(),
    APPLE_ROOT_CA_G3_SHA256,
  );
  assert.match(root.subject, /CN=Apple Root CA - G3/);
  assert.match(root.issuer, /CN=Apple Root CA - G3/);
});

test('a verified RESCIND_CONSENT applies once, with the Apple id from the signed app transaction', async () => {
  const { deps, calls, logs } = harness();
  const signedPayload = notification();
  const response = await handleAppStoreNotification(post({ signedPayload }), deps);
  assert.deepEqual(response, { status: 200, body: { ok: true } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.fn, 'apply_consent_revocation');
  const args = calls[0]?.args ?? {};
  assert.equal(args.p_notification_type, 'RESCIND_CONSENT');
  assert.equal(args.p_environment, 'Sandbox');
  assert.equal(args.p_app_transaction_id, '704289572311859823');
  assert.match(String(args.p_notification_uuid), /^[0-9a-f-]{36}$/);
  assert.ok(!Number.isNaN(Date.parse(String(args.p_signed_at))));
  // Nothing identifying in the log.
  assert.deepEqual(logs, ['applied: RESCIND_CONSENT (Sandbox) duplicate=false disabled=1']);
  assert.doesNotMatch(logs.join('\n'), /704289572311859823|[0-9a-f]{8}-[0-9a-f]{4}/);
});

test('a duplicate is a 200 that the database already refused to re-apply', async () => {
  const { deps, logs } = harness({ data: { duplicate: true, disabled: 0 }, error: null });
  const response = await handleAppStoreNotification(post({ signedPayload: notification() }), deps);
  assert.equal(response.status, 200);
  assert.match(logs[0] ?? '', /duplicate=true disabled=0/);
});

test('a database failure is a 500, so the sender retries', async () => {
  const { deps } = harness({ data: null, error: 'rpc apply_consent_revocation: http 500' });
  const response = await handleAppStoreNotification(post({ signedPayload: notification() }), deps);
  assert.deepEqual(response, { status: 500, body: { ok: false, reason: 'apply' } });
});

test('every other notification type is acknowledged and never stored', async () => {
  for (const notificationType of ['DID_RENEW', 'TEST', 'CONSUMPTION_REQUEST']) {
    const { deps, calls } = harness();
    const signedPayload = notification({ notificationType });
    const response = await handleAppStoreNotification(post({ signedPayload }), deps);
    assert.equal(response.status, 200, notificationType);
    assert.equal(calls.length, 0, notificationType);
  }
});

test('anything Apple did not sign is refused and changes nothing', async () => {
  const cases: [string, () => string, number][] = [
    [
      'tampered payload',
      () => {
        const [h, , s] = notification().split('.');
        const forged = b64url(
          JSON.stringify({
            notificationType: 'RESCIND_CONSENT',
            notificationUUID: randomUUID(),
            signedDate: Date.now(),
            appData: {
              bundleId: BUNDLE,
              environment: 'Sandbox',
              signedAppTransactionInfo: appTransaction(),
            },
          }),
        );
        return `${h}.${forged}.${s}`;
      },
      401,
    ],
    ['chain to an untrusted root', () => notification(), 401],
    [
      'leaf without Apple’s marker OID',
      () =>
        jws(
          {
            notificationType: 'RESCIND_CONSENT',
            notificationUUID: randomUUID(),
            signedDate: Date.now(),
            appData: {
              bundleId: BUNDLE,
              environment: 'Sandbox',
              signedAppTransactionInfo: appTransaction(),
            },
          },
          [LEAF_WITHOUT_MARKER, INTERMEDIATE, ROOT],
        ),
      401,
    ],
    [
      'two-certificate chain',
      () =>
        jws(
          {
            notificationType: 'RESCIND_CONSENT',
            notificationUUID: randomUUID(),
            signedDate: Date.now(),
            appData: {
              bundleId: BUNDLE,
              environment: 'Sandbox',
              signedAppTransactionInfo: appTransaction(),
            },
          },
          CHAIN.slice(0, 2),
        ),
      401,
    ],
    ['another app’s bundle', () => notification({}, { bundleId: 'com.example.other' }), 401],
    ['an unaccepted environment claim', () => notification({}, { environment: 'Production' }), 400],
    [
      'Xcode environment (never verified by Apple)',
      () => notification({}, { environment: 'Xcode' }),
      400,
    ],
    [
      'app transaction from another app',
      () =>
        notification(
          {},
          { signedAppTransactionInfo: appTransaction({ bundleId: 'com.example.other' }) },
        ),
      401,
    ],
    [
      'app transaction from production inside a sandbox notification',
      () =>
        notification(
          {},
          { signedAppTransactionInfo: appTransaction({ receiptType: 'Production' }) },
        ),
      401,
    ],
  ];
  for (const [name, build, status] of cases) {
    const { deps, calls } = harness();
    if (name === 'chain to an untrusted root') {
      deps.verifiers = {
        Sandbox: sandboxVerifier([Buffer.from(APPLE_ROOT_CA_G3_BASE64, 'base64')]),
      };
    }
    const response = await handleAppStoreNotification(post({ signedPayload: build() }), deps);
    assert.equal(response.status, status, name);
    assert.equal(calls.length, 0, `${name} must not reach the database`);
  }
});

test('malformed requests are refused before verification', async () => {
  const { deps, calls } = harness();
  assert.equal((await handleAppStoreNotification({ method: 'GET', body: '' }, deps)).status, 405);
  assert.equal(
    (await handleAppStoreNotification({ method: 'POST', body: 'not json' }, deps)).status,
    400,
  );
  assert.equal((await handleAppStoreNotification(post({}), deps)).status, 400);
  assert.equal((await handleAppStoreNotification(post({ signedPayload: 42 }), deps)).status, 400);
  assert.equal(
    (await handleAppStoreNotification({ method: 'POST', body: 'x'.repeat(70_000) }, deps)).status,
    413,
  );
  assert.equal(calls.length, 0);
});

test('a RESCIND_CONSENT without its app transaction is refused', async () => {
  const { deps, calls } = harness();
  const signedPayload = notification({}, { signedAppTransactionInfo: undefined });
  assert.equal((await handleAppStoreNotification(post({ signedPayload }), deps)).status, 400);
  assert.equal(calls.length, 0);
});

test('the environment claim is read from data, summary or appData, and nothing else', () => {
  const claim = (payload: object) => claimedEnvironment(`h.${b64url(JSON.stringify(payload))}.s`);
  assert.equal(claim({ appData: { environment: 'Sandbox' } }), 'Sandbox');
  assert.equal(claim({ data: { environment: 'Production' } }), 'Production');
  assert.equal(claim({ summary: { environment: 'Sandbox' } }), 'Sandbox');
  assert.equal(claim({ appData: { environment: 'Xcode' } }), null);
  assert.equal(claim({}), null);
  assert.equal(claimedEnvironment('garbage'), null);
});

test('the Deno adapter uses the import-free verifier and never builds an unverified environment', () => {
  const adapter = readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      'supabase',
      'functions',
      'app-store-notifications',
      'index.ts',
    ),
    'utf8',
  );
  assert.match(adapter, /from '\.\/apple-jws\.ts'/);
  assert.doesNotMatch(adapter, /npm:|SignedDataVerifier/);
  assert.doesNotMatch(adapter, /Xcode|LocalTesting|LOCAL_TESTING/);
  // Apple's library stays a pinned devDependency: the test oracle, never deployed.
  const pkg = JSON.parse(
    readFileSync(join(__dirname, '..', '..', '..', 'package.json'), 'utf8'),
  ) as {
    devDependencies: Record<string, string>;
  };
  assert.equal(pkg.devDependencies['@apple/app-store-server-library'], '3.1.0');
});
