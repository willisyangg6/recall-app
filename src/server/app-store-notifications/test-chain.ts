/**
 * TEST ONLY: builds, at run time, a certificate chain shaped like the one
 * Apple signs App Store data with — a P-384 root and intermediate signing
 * with ECDSA-SHA384, a P-256 leaf for ES256, and Apple's marker OIDs — with
 * fresh keys on every run. Nothing here is trusted anywhere, and no private
 * key is ever written to disk or to git (the repository ignores *.pem and
 * *.key on purpose).
 *
 * A minimal DER ENCODER, the mirror of the reader in apple-jws.ts, so the
 * chain is independent of OpenSSL and of the code under test: Node's own
 * X509Certificate and Apple's library parse what it produces.
 */

import { createPrivateKey, type KeyObject } from 'node:crypto';

const subtle = globalThis.crypto.subtle;

// ── DER encoding ────────────────────────────────────────────────────────────

function length(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

const tlv = (tag: number, ...content: Buffer[]) => {
  const body = Buffer.concat(content);
  return Buffer.concat([Buffer.from([tag]), length(body.length), body]);
};
const sequence = (...items: Buffer[]) => tlv(0x30, ...items);
const set = (...items: Buffer[]) => tlv(0x31, ...items);
const explicit = (n: number, item: Buffer) => tlv(0xa0 + n, item);
const octets = (value: Buffer) => tlv(0x04, value);
const bits = (value: Buffer) => tlv(0x03, Buffer.from([0]), value);
const utf8 = (value: string) => tlv(0x0c, Buffer.from(value, 'utf8'));
const NULL = Buffer.from([0x05, 0x00]);
const TRUE = Buffer.from([0x01, 0x01, 0xff]);

function integer(value: Buffer): Buffer {
  let v = value;
  while (v.length > 1 && v[0] === 0 && !(v[1] & 0x80)) v = v.subarray(1);
  return tlv(0x02, v[0] & 0x80 ? Buffer.concat([Buffer.from([0]), v]) : v);
}

function oid(dotted: string): Buffer {
  const [a, b, ...rest] = dotted.split('.').map(Number);
  const out = [40 * a + b];
  for (const part of rest) {
    const chunk = [part & 0x7f];
    for (let v = part >> 7; v > 0; v >>= 7) chunk.unshift((v & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}

function time(date: Date): Buffer {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const rest = `${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
  const year = date.getUTCFullYear();
  return year >= 1950 && year < 2050
    ? tlv(0x17, Buffer.from(`${pad(year % 100)}${rest}`))
    : tlv(0x18, Buffer.from(`${pad(year, 4)}${rest}`));
}

const name = (cn: string) => sequence(set(sequence(oid('2.5.4.3'), utf8(cn))));

/** WebCrypto's raw r‖s → DER Ecdsa-Sig-Value. */
function derSignature(raw: Buffer): Buffer {
  const half = raw.length / 2;
  return sequence(integer(raw.subarray(0, half)), integer(raw.subarray(half)));
}

// ── Certificates ───────────────────────────────────────────────────────────

const ECDSA_SHA384 = '1.2.840.10045.4.3.3';
export const LEAF_MARKER = '1.2.840.113635.100.6.11.1';
export const INTERMEDIATE_MARKER = '1.2.840.113635.100.6.2.1';

interface Party {
  name: string;
  keys: CryptoKeyPair;
}

async function party(cn: string, curve: 'P-256' | 'P-384'): Promise<Party> {
  const keys = await subtle.generateKey({ name: 'ECDSA', namedCurve: curve }, true, [
    'sign',
    'verify',
  ]);
  return { name: cn, keys };
}

let serial = 1;

async function certificate(options: {
  subject: Party;
  issuer: Party;
  ca: boolean;
  markers: string[];
  notBefore: Date;
  notAfter: Date;
}): Promise<Buffer> {
  const spki = Buffer.from(await subtle.exportKey('spki', options.subject.keys.publicKey));
  const extensions = [
    sequence(oid('2.5.29.19'), TRUE, octets(options.ca ? sequence(TRUE) : sequence())),
    ...options.markers.map((marker) => sequence(oid(marker), octets(NULL))),
  ];
  const tbs = sequence(
    explicit(0, integer(Buffer.from([2]))),
    integer(Buffer.from([serial++])),
    sequence(oid(ECDSA_SHA384)),
    name(options.issuer.name),
    sequence(time(options.notBefore), time(options.notAfter)),
    name(options.subject.name),
    spki,
    explicit(3, sequence(...extensions)),
  );
  const raw = Buffer.from(
    await subtle.sign({ name: 'ECDSA', hash: 'SHA-384' }, options.issuer.keys.privateKey, tbs),
  );
  return sequence(tbs, sequence(oid(ECDSA_SHA384)), bits(derSignature(raw)));
}

export interface TestChain {
  root: Buffer;
  intermediate: Buffer;
  leaf: Buffer;
  /** Same key as `leaf`, without Apple's leaf marker. */
  leafWithoutMarker: Buffer;
  /** Same key as `leaf`, valid only during 2020. */
  leafExpired: Buffer;
  /** The leaf's private key, for signing JWS payloads. */
  leafKey: KeyObject;
}

let cached: Promise<TestChain> | null = null;

/** One chain per test process (generation takes a few milliseconds). */
export function testChain(): Promise<TestChain> {
  cached ??= (async () => {
    const root = await party('Lotly TEST Root (not trusted anywhere)', 'P-384');
    const intermediate = await party('Lotly TEST Intermediate', 'P-384');
    const leaf = await party('Lotly TEST Leaf', 'P-256');
    const from = new Date(Date.UTC(2019, 0, 1));
    const until = new Date(Date.UTC(2126, 0, 1));
    const issue = (
      subject: Party,
      issuer: Party,
      ca: boolean,
      markers: string[],
      notBefore = from,
      notAfter = until,
    ) => certificate({ subject, issuer, ca, markers, notBefore, notAfter });
    return {
      root: await issue(root, root, true, []),
      intermediate: await issue(intermediate, root, true, [INTERMEDIATE_MARKER]),
      leaf: await issue(leaf, intermediate, false, [LEAF_MARKER]),
      leafWithoutMarker: await issue(leaf, intermediate, false, []),
      leafExpired: await issue(
        leaf,
        intermediate,
        false,
        [LEAF_MARKER],
        new Date(Date.UTC(2020, 0, 1)),
        new Date(Date.UTC(2021, 0, 1)),
      ),
      leafKey: createPrivateKey({
        key: Buffer.from(await subtle.exportKey('pkcs8', leaf.keys.privateKey)),
        format: 'der',
        type: 'pkcs8',
      }),
    };
  })();
  return cached;
}
