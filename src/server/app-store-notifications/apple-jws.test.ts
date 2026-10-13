/**
 * The WebCrypto verifier for Apple-signed data (apple-jws.ts), held equal,
 * case by case, to Apple's own @apple/app-store-server-library in its OFFLINE
 * mode (enableOnlineChecks = false; there is no OCSP here, see apple-jws.ts). The library
 * cannot run in Supabase's Edge Runtime (it needs X509Certificate methods
 * the runtime lacks), so the deployed function uses apple-jws.ts and this
 * suite is the proof the two decide alike. Plus real Apple data: the pinned
 * Apple Root CA - G3 verifies Apple's real WWDR G6 intermediate. The test
 * chain is built at run time (test-chain.ts); no key is stored anywhere.
 */

import assert from 'node:assert/strict';
import { randomUUID, sign, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { before, test } from 'node:test';

import { Environment, SignedDataVerifier } from '@apple/app-store-server-library';

import {
  APPLE_INTERMEDIATE_OID,
  certificateIssuedBy,
  createAppleVerifier,
  parseCertificate,
} from '../../../supabase/functions/app-store-notifications/apple-jws';
import { APPLE_ROOT_CA_G3_BASE64 } from '../../../supabase/functions/app-store-notifications/apple-root-certificates';

import { testChain, type TestChain } from './test-chain';

const FIXTURES = join(__dirname, 'fixtures');
let C: TestChain;
before(async () => {
  C = await testChain();
});
const APPLE_ROOT = Buffer.from(APPLE_ROOT_CA_G3_BASE64, 'base64');
const APPLE_G6 = readFileSync(join(FIXTURES, 'apple-wwdr-g6.cer'));
const BUNDLE = 'com.willisyang.lotly';
const APP_APPLE_ID = 6700000000;

const b64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

function jws(
  payload: object,
  options: { chain?: Buffer[]; alg?: string; key?: KeyObject } = {},
): string {
  const chain = options.chain ?? [C.leaf, C.intermediate, C.root];
  const header = { alg: options.alg ?? 'ES256', x5c: chain.map((cert) => cert.toString('base64')) };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = sign('sha256', Buffer.from(input), {
    key: options.key ?? C.leafKey,
    dsaEncoding: 'ieee-p1363',
  });
  return `${input}.${b64url(signature)}`;
}

const notification = (appData: object = {}, extra: object = {}) => ({
  notificationType: 'RESCIND_CONSENT',
  notificationUUID: randomUUID(),
  version: '2.0',
  signedDate: Date.now(),
  appData: { bundleId: BUNDLE, environment: 'Sandbox', ...appData },
  ...extra,
});
const appTransaction = (extra: object = {}) => ({
  appTransactionId: '704289572311859823',
  bundleId: BUNDLE,
  receiptType: 'Sandbox',
  receiptCreationDate: Date.now(),
  ...extra,
});

type Kind = 'notification' | 'transaction';

/** Both verifiers' answer for one input: true = accepted. */
async function decide(
  kind: Kind,
  signed: string,
  options: { roots?: Buffer[]; environment?: 'Sandbox' | 'Production'; appAppleId?: number } = {},
): Promise<{ apple: boolean; ours: boolean }> {
  const roots = options.roots ?? [C.root];
  const environment = options.environment ?? 'Sandbox';
  const apple = new SignedDataVerifier(
    roots,
    false,
    environment === 'Sandbox' ? Environment.SANDBOX : Environment.PRODUCTION,
    BUNDLE,
    options.appAppleId,
  );
  const ours = createAppleVerifier({
    roots: roots.map((root) => new Uint8Array(root)),
    environment,
    bundleId: BUNDLE,
    appAppleId: options.appAppleId,
  });
  const run = async (f: () => Promise<unknown>) =>
    f().then(
      () => true,
      () => false,
    );
  return kind === 'notification'
    ? {
        apple: await run(() => apple.verifyAndDecodeNotification(signed)),
        ours: await run(() => ours.verifyAndDecodeNotification(signed)),
      }
    : {
        apple: await run(() => apple.verifyAndDecodeAppTransaction(signed)),
        ours: await run(() => ours.verifyAndDecodeAppTransaction(signed)),
      };
}

/** Flip one byte inside the signature (not the base64 padding bits, which decode to nothing). */
const flipSignatureByte = (signed: string) => {
  const [header, payload, signature] = signed.split('.');
  const bytes = Buffer.from(signature, 'base64url');
  bytes[10] ^= 0x01;
  return `${header}.${payload}.${bytes.toString('base64url')}`;
};

const tamper = (signed: string, payload: object) => {
  const [header, , signature] = signed.split('.');
  return `${header}.${b64url(JSON.stringify(payload))}.${signature}`;
};

test('the WebCrypto verifier decides exactly as Apple’s library, case by case', async () => {
  const { leaf, intermediate, root } = C;
  const cases: [string, Kind, string, Parameters<typeof decide>[2], boolean][] = [
    ['valid notification', 'notification', jws(notification()), {}, true],
    ['valid app transaction', 'transaction', jws(appTransaction()), {}, true],
    ['tampered payload', 'notification', tamper(jws(notification()), notification()), {}, false],
    ['tampered signature', 'notification', flipSignatureByte(jws(notification())), {}, false],
    [
      'pinned to Apple’s real root instead',
      'notification',
      jws(notification()),
      { roots: [APPLE_ROOT] },
      false,
    ],
    [
      'leaf without Apple’s marker',
      'notification',
      jws(notification(), { chain: [C.leafWithoutMarker, intermediate, root] }),
      {},
      false,
    ],
    [
      'intermediate without Apple’s marker (leaf posing as intermediate)',
      'notification',
      jws(notification(), { chain: [leaf, leaf, root] }),
      {},
      false,
    ],
    [
      'expired leaf, signed now',
      'notification',
      jws(notification(), { chain: [C.leafExpired, intermediate, root] }),
      {},
      false,
    ],
    [
      'expired leaf, but signed while it was valid (Apple’s offline rule)',
      'notification',
      jws(notification({}, { signedDate: Date.UTC(2020, 5, 1) }), {
        chain: [C.leafExpired, intermediate, root],
      }),
      {},
      true,
    ],
    [
      'signed before the chain existed',
      'notification',
      jws(notification({}, { signedDate: Date.UTC(2018, 5, 1) })),
      {},
      false,
    ],
    [
      'valid chain, but a signing date after it expires (the payload’s own date is used)',
      'notification',
      jws(notification({}, { signedDate: Date.UTC(2127, 0, 1) })),
      {},
      false,
    ],
    [
      'two-certificate chain',
      'notification',
      jws(notification(), { chain: [leaf, intermediate] }),
      {},
      false,
    ],
    [
      'four-certificate chain',
      'notification',
      jws(notification(), { chain: [leaf, intermediate, root, root] }),
      {},
      false,
    ],
    [
      'another app',
      'notification',
      jws(notification({ bundleId: 'com.example.other' })),
      {},
      false,
    ],
    [
      'production claim to a sandbox verifier',
      'notification',
      jws(notification({ environment: 'Production' })),
      {},
      false,
    ],
    [
      'production with the right app id',
      'notification',
      jws(notification({ environment: 'Production', appAppleId: APP_APPLE_ID })),
      { environment: 'Production', appAppleId: APP_APPLE_ID },
      true,
    ],
    [
      'production with another app id',
      'notification',
      jws(notification({ environment: 'Production', appAppleId: 1 })),
      { environment: 'Production', appAppleId: APP_APPLE_ID },
      false,
    ],
    [
      'app transaction for another app',
      'transaction',
      jws(appTransaction({ bundleId: 'x.y' })),
      {},
      false,
    ],
    [
      'production app transaction to a sandbox verifier',
      'transaction',
      jws(appTransaction({ receiptType: 'Production' })),
      {},
      false,
    ],
    [
      'production app transaction with the right app id',
      'transaction',
      jws(appTransaction({ receiptType: 'Production', appAppleId: APP_APPLE_ID })),
      { environment: 'Production', appAppleId: APP_APPLE_ID },
      true,
    ],
    // Review R1 (2026-10-13): the intermediate must be a CA, as Apple requires.
    [
      'intermediate with basicConstraints cA FALSE (marker present, signed by the pinned root)',
      'notification',
      jws(notification(), { chain: [leaf, C.intermediateNotCa, root] }),
      {},
      false,
    ],
    [
      'intermediate with no basicConstraints (marker present, signed by the pinned root)',
      'notification',
      jws(notification(), { chain: [leaf, C.intermediateWithoutBasicConstraints, root] }),
      {},
      false,
    ],
    // Review R3: the outer algorithm must equal the signed inner one.
    [
      'leaf whose outer algorithm disagrees with its signed algorithm',
      'notification',
      jws(notification(), { chain: [C.leafOuterAlgorithmMismatch, intermediate, root] }),
      {},
      false,
    ],
    [
      'leaf whose signed algorithm field disagrees with the outer one (the signature itself verifies)',
      'notification',
      jws(notification(), { chain: [C.leafInnerAlgorithmMismatch, intermediate, root] }),
      {},
      false,
    ],
    // Review R2: the matched root must be valid at the signing date too.
    [
      'root expired at the signing date (chain otherwise valid)',
      'notification',
      jws(notification(), { chain: [C.shortLeaf, C.shortIntermediate, C.shortRoot] }),
      { roots: [C.shortRoot] },
      false,
    ],
    [
      'the same short-lived root, signed while it was valid',
      'notification',
      jws(notification({}, { signedDate: Date.UTC(2020, 5, 1) }), {
        chain: [C.shortLeaf, C.shortIntermediate, C.shortRoot],
      }),
      { roots: [C.shortRoot] },
      true,
    ],
    ['not a JWS', 'notification', 'garbage', {}, false],
    [
      'garbage certificates',
      'notification',
      `${b64url(JSON.stringify({ alg: 'ES256', x5c: ['AAAA', 'BBBB', 'CCCC'] }))}.${b64url('{}')}.AAAA`,
      {},
      false,
    ],
  ];
  for (const [name, kind, signed, options, expected] of cases) {
    const { apple, ours } = await decide(kind, signed, options);
    assert.equal(apple, expected, `Apple's library on: ${name}`);
    assert.equal(ours, apple, `WebCrypto verifier disagrees with Apple's library on: ${name}`);
  }
});

test('an algorithm other than ES256 is refused (no "none", no RSA)', async () => {
  const ours = createAppleVerifier({
    roots: [new Uint8Array(C.root)],
    environment: 'Sandbox',
    bundleId: BUNDLE,
  });
  for (const alg of ['none', 'RS256', 'ES384', 'HS256']) {
    const signed = jws(notification(), { alg });
    await assert.rejects(ours.verifyAndDecodeNotification(signed), /algorithm/, alg);
  }
});

test('real Apple data: the pinned G3 root verifies Apple’s WWDR G6 intermediate', async () => {
  // Apple's actual chain: G3 (P-384) signs G6 with ecdsa-with-SHA384, and G6
  // carries the intermediate marker the verifier requires.
  assert.equal(
    await certificateIssuedBy(new Uint8Array(APPLE_G6), new Uint8Array(APPLE_ROOT)),
    true,
  );
  assert.equal(
    parseCertificate(new Uint8Array(APPLE_G6)).extensions.has(APPLE_INTERMEDIATE_OID),
    true,
  );
  // Review R1: the CA requirement must hold for Apple's REAL intermediate,
  // or production would refuse every genuine notification; and Apple's own
  // root reads as a CA too.
  assert.equal(parseCertificate(new Uint8Array(APPLE_G6)).ca, true);
  assert.equal(parseCertificate(new Uint8Array(APPLE_ROOT)).ca, true);
  assert.equal(
    parseCertificate(new Uint8Array(APPLE_G6)).innerSignatureAlgorithm,
    parseCertificate(new Uint8Array(APPLE_G6)).signatureAlgorithm,
  );
  // And a test root does not.
  assert.equal(await certificateIssuedBy(new Uint8Array(APPLE_G6), new Uint8Array(C.root)), false);
  // Parsed validity matches OpenSSL's reading of the certificate.
  const g6 = parseCertificate(new Uint8Array(APPLE_G6));
  assert.equal(new Date(g6.notBefore).toISOString(), '2021-03-17T20:37:10.000Z');
  assert.equal(new Date(g6.notAfter).toISOString(), '2036-03-19T00:00:00.000Z');
});

test('the verifier module imports nothing, so it runs unchanged in the Edge Runtime', () => {
  const source = readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      'supabase',
      'functions',
      'app-store-notifications',
      'apple-jws.ts',
    ),
    'utf8',
  );
  assert.doesNotMatch(source, /^import /m);
  assert.doesNotMatch(source, /require\(|node:|npm:/);
});
