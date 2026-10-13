/**
 * Verifying Apple's signed App Store data (JWS with an x5c chain) using only
 * WebCrypto and a minimal DER reader — no imports, so it runs unchanged in
 * Supabase's Edge Runtime and in Node.
 *
 * ## Why not Apple's own library here
 *
 * `@apple/app-store-server-library` verifies chains with Node's
 * `X509Certificate.verify`, `checkIssued` and `toString`. Supabase's Edge
 * Runtime (edge-runtime 1.74.3, "compatible with Deno v2.1.4") does not
 * implement them: run there, the library refuses every payload, valid or
 * not (2026-10-13, review pack `revocation-evidence/edge-runtime-*.out`).
 * So this module performs the SAME checks the library performs offline,
 * and the Node suite runs both on every case and requires them to agree
 * (src/server/app-store-notifications/apple-jws.test.ts).
 *
 * ## The checks, in order (each failure throws)
 *
 *   1. The JWS header is `alg: ES256` with exactly three x5c certificates.
 *   2. The intermediate (x5c[1]) is signed by a PINNED root (Apple Root CA -
 *      G3), and its issuer name is that root's subject.
 *   3. The leaf (x5c[0]) is signed by the intermediate, and its issuer name
 *      is the intermediate's subject.
 *   4. The leaf carries Apple's marker OID 1.2.840.113635.100.6.11.1 and the
 *      intermediate 1.2.840.113635.100.6.2.1.
 *   5. Every certificate is valid at the payload's own signing date (Apple's
 *      offline rule: `signedDate`, or `receiptCreationDate` for an app
 *      transaction).
 *   6. The ES256 signature over `header.payload` verifies with the leaf key.
 *
 * Not performed: OCSP revocation checks of Apple's certificates (the
 * library's optional "online checks"). Forging a payload would still need
 * Apple's private signing key.
 */

// ── DER ─────────────────────────────────────────────────────────────────────

interface Tlv {
  tag: number;
  /** Offset of the tag byte. */
  start: number;
  /** Offset of the first value byte. */
  value: number;
  /** Offset just past the value. */
  end: number;
}

function readTlv(bytes: Uint8Array, offset: number): Tlv {
  if (offset + 2 > bytes.length) throw new Error('DER: truncated');
  const tag = bytes[offset];
  let length = bytes[offset + 1];
  let value = offset + 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count === 0 || count > 3) throw new Error('DER: unsupported length');
    length = 0;
    for (let i = 0; i < count; i++) length = (length << 8) | bytes[value + i];
    value += count;
  }
  const end = value + length;
  if (end > bytes.length) throw new Error('DER: length past end');
  return { tag, start: offset, value, end };
}

/** The TLVs directly inside a constructed TLV. */
function children(bytes: Uint8Array, parent: Tlv): Tlv[] {
  const out: Tlv[] = [];
  for (let offset = parent.value; offset < parent.end;) {
    const child = readTlv(bytes, offset);
    out.push(child);
    offset = child.end;
  }
  return out;
}

function oid(bytes: Uint8Array, tlv: Tlv): string {
  if (tlv.tag !== 0x06) throw new Error('DER: expected OID');
  const parts: number[] = [];
  let value = 0;
  for (let i = tlv.value; i < tlv.end; i++) {
    value = value * 128 + (bytes[i] & 0x7f);
    if (!(bytes[i] & 0x80)) {
      if (parts.length === 0)
        parts.push(value < 80 ? Math.floor(value / 40) : 2, value < 80 ? value % 40 : value - 80);
      else parts.push(value);
      value = 0;
    }
  }
  return parts.join('.');
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

function time(bytes: Uint8Array, tlv: Tlv): number {
  const text = new TextDecoder().decode(bytes.subarray(tlv.value, tlv.end));
  // UTCTime YYMMDDHHMMSSZ (years 1950–2049) or GeneralizedTime YYYYMMDDHHMMSSZ.
  const match =
    tlv.tag === 0x17
      ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text)
      : tlv.tag === 0x18
        ? /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text)
        : null;
  if (!match) throw new Error('DER: unsupported time');
  let year = Number(match[1]);
  if (tlv.tag === 0x17) year += year < 50 ? 2000 : 1900;
  return Date.UTC(
    year,
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
}

// ── X.509 (only what verification needs) ──────────────────────────────────

const ECDSA_SHA256 = '1.2.840.10045.4.3.2';
const ECDSA_SHA384 = '1.2.840.10045.4.3.3';
const CURVES: Record<string, { name: 'P-256' | 'P-384'; size: number }> = {
  '1.2.840.10045.3.1.7': { name: 'P-256', size: 32 },
  '1.3.132.0.34': { name: 'P-384', size: 48 },
};
export const APPLE_LEAF_OID = '1.2.840.113635.100.6.11.1';
export const APPLE_INTERMEDIATE_OID = '1.2.840.113635.100.6.2.1';

interface Certificate {
  tbs: Uint8Array;
  signatureAlgorithm: string;
  /** DER ECDSA-Sig-Value (SEQUENCE { r, s }). */
  signature: Uint8Array;
  issuer: Uint8Array;
  subject: Uint8Array;
  notBefore: number;
  notAfter: number;
  spki: Uint8Array;
  curve: { name: 'P-256' | 'P-384'; size: number };
  extensions: Set<string>;
}

export function parseCertificate(der: Uint8Array): Certificate {
  const cert = readTlv(der, 0);
  if (cert.tag !== 0x30 || cert.end !== der.length) throw new Error('X.509: not a certificate');
  const [tbs, algorithm, signature] = children(der, cert);
  if (!tbs || !algorithm || !signature || signature.tag !== 0x03) throw new Error('X.509: shape');
  const fields = children(der, tbs);
  let i = fields[0]?.tag === 0xa0 ? 1 : 0; // [0] version
  i += 1; // serialNumber
  i += 1; // signature AlgorithmIdentifier (inner)
  const issuer = fields[i++];
  const validity = fields[i++];
  const subject = fields[i++];
  const spki = fields[i++];
  if (!issuer || !validity || !subject || !spki) throw new Error('X.509: shape');
  const [notBefore, notAfter] = children(der, validity);
  const [spkiAlgorithm] = children(der, spki);
  const [, curveOid] = children(der, spkiAlgorithm);
  const curve = curveOid ? CURVES[oid(der, curveOid)] : undefined;
  if (!notBefore || !notAfter || !curve) throw new Error('X.509: unsupported key');

  const extensions = new Set<string>();
  const explicit = fields.slice(i).find((field) => field.tag === 0xa3);
  if (explicit) {
    const [list] = children(der, explicit);
    for (const extension of list ? children(der, list) : []) {
      const [id] = children(der, extension);
      if (id) extensions.add(oid(der, id));
    }
  }
  const [algorithmOid] = children(der, algorithm);
  // BIT STRING: first value byte is the unused-bit count (0 for signatures).
  if (der[signature.value] !== 0) throw new Error('X.509: signature padding');
  return {
    tbs: der.subarray(tbs.start, tbs.end),
    signatureAlgorithm: oid(der, algorithmOid),
    signature: der.subarray(signature.value + 1, signature.end),
    issuer: der.subarray(issuer.start, issuer.end),
    subject: der.subarray(subject.start, subject.end),
    notBefore: time(der, notBefore),
    notAfter: time(der, notAfter),
    spki: der.subarray(spki.start, spki.end),
    curve,
    extensions,
  };
}

/** DER ECDSA-Sig-Value → the fixed-width r‖s WebCrypto expects. */
function rawSignature(der: Uint8Array, size: number): Uint8Array {
  const sequence = readTlv(der, 0);
  const [r, s] = children(der, sequence);
  if (sequence.tag !== 0x30 || !r || !s || r.tag !== 0x02 || s.tag !== 0x02) {
    throw new Error('ECDSA: signature shape');
  }
  const out = new Uint8Array(size * 2);
  for (const [index, part] of [r, s].entries()) {
    let value = der.subarray(part.value, part.end);
    while (value.length > size && value[0] === 0) value = value.subarray(1);
    if (value.length > size) throw new Error('ECDSA: integer too long');
    out.set(value, index * size + (size - value.length));
  }
  return out;
}

async function importKey(cert: Certificate): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'spki',
    cert.spki.slice(),
    { name: 'ECDSA', namedCurve: cert.curve.name },
    false,
    ['verify'],
  );
}

/** Whether `child` is signed by `issuer` and names it as its issuer. */
async function issuedBy(child: Certificate, issuer: Certificate): Promise<boolean> {
  if (!equalBytes(child.issuer, issuer.subject)) return false;
  const hash =
    child.signatureAlgorithm === ECDSA_SHA256
      ? 'SHA-256'
      : child.signatureAlgorithm === ECDSA_SHA384
        ? 'SHA-384'
        : null;
  if (hash === null) return false;
  return crypto.subtle.verify(
    { name: 'ECDSA', hash },
    await importKey(issuer),
    rawSignature(child.signature, issuer.curve.size).slice(),
    child.tbs.slice(),
  );
}

/** Whether DER certificate `child` is signed by DER certificate `issuer` (exported for tests). */
export async function certificateIssuedBy(child: Uint8Array, issuer: Uint8Array): Promise<boolean> {
  return issuedBy(parseCertificate(child), parseCertificate(issuer));
}

// ── JWS ─────────────────────────────────────────────────────────────────────

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function decodeJson(part: string): Record<string, unknown> {
  const value = JSON.parse(new TextDecoder().decode(base64ToBytes(part))) as unknown;
  if (typeof value !== 'object' || value === null) throw new Error('JWS: not an object');
  return value as Record<string, unknown>;
}

/**
 * Verify an Apple-signed JWS against pinned roots (DER) and return its
 * payload. `effectiveDate` picks the payload's own signing time.
 */
export async function verifyAppleJws(
  jws: string,
  roots: Uint8Array[],
  effectiveDate: (payload: Record<string, unknown>) => number,
): Promise<Record<string, unknown>> {
  const parts = jws.split('.');
  if (parts.length !== 3) throw new Error('JWS: shape');
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = decodeJson(headerPart);
  if (header.alg !== 'ES256') throw new Error('JWS: algorithm');
  const x5c = header.x5c;
  if (!Array.isArray(x5c) || x5c.length !== 3 || !x5c.every((c) => typeof c === 'string')) {
    throw new Error('JWS: chain length');
  }
  const payload = decodeJson(payloadPart);
  const leaf = parseCertificate(base64ToBytes(x5c[0]));
  const intermediate = parseCertificate(base64ToBytes(x5c[1]));

  let anchored = false;
  for (const der of roots) {
    if (await issuedBy(intermediate, parseCertificate(der))) {
      anchored = true;
      break;
    }
  }
  if (!anchored) throw new Error('chain: intermediate not issued by a pinned root');
  if (!(await issuedBy(leaf, intermediate)))
    throw new Error('chain: leaf not issued by intermediate');
  if (!leaf.extensions.has(APPLE_LEAF_OID)) throw new Error('chain: leaf marker missing');
  if (!intermediate.extensions.has(APPLE_INTERMEDIATE_OID)) {
    throw new Error('chain: intermediate marker missing');
  }
  const at = effectiveDate(payload);
  if (!Number.isFinite(at)) throw new Error('chain: no signing date');
  for (const cert of [leaf, intermediate]) {
    if (at < cert.notBefore || at > cert.notAfter) throw new Error('chain: certificate not valid');
  }
  if (leaf.curve.name !== 'P-256') throw new Error('JWS: ES256 needs a P-256 leaf');
  const signature = base64ToBytes(signaturePart).slice();
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    await importKey(leaf),
    signature,
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  );
  if (!valid) throw new Error('JWS: signature');
  return payload;
}

// ── The verifier the endpoint uses (same contract as Apple's SignedDataVerifier) ─

export type AppleEnvironment = 'Sandbox' | 'Production';

export function createAppleVerifier(options: {
  roots: Uint8Array[];
  environment: AppleEnvironment;
  bundleId: string;
  /** Required in Production, as in Apple's library. */
  appAppleId?: number;
}) {
  const { roots, environment, bundleId, appAppleId } = options;
  const identify = (bundle: unknown, appleId: unknown, env: unknown) => {
    if (bundle !== bundleId || (environment === 'Production' && appleId !== appAppleId)) {
      throw new Error('verifier: app identifier');
    }
    if (env !== environment) throw new Error('verifier: environment');
  };
  return {
    async verifyAndDecodeNotification(signedPayload: string) {
      const payload = await verifyAppleJws(signedPayload, roots, (p) => Number(p.signedDate));
      const token = payload.externalPurchaseToken as Record<string, unknown> | undefined;
      if (!payload.data && !payload.summary && token) {
        // Apple's rule: the environment is implied by the purchase id.
        const id = token.externalPurchaseId;
        identify(
          token.bundleId,
          token.appAppleId,
          typeof id === 'string' && id.startsWith('SANDBOX') ? 'Sandbox' : 'Production',
        );
      } else {
        const source = (payload.data ?? payload.summary ?? payload.appData) as
          Record<string, unknown> | undefined;
        identify(source?.bundleId, source?.appAppleId, source?.environment);
      }
      return payload as {
        notificationType?: string;
        notificationUUID?: string;
        signedDate?: number;
        appData?: { environment?: string; signedAppTransactionInfo?: string };
      };
    },
    async verifyAndDecodeAppTransaction(signedAppTransaction: string) {
      const payload = await verifyAppleJws(signedAppTransaction, roots, (p) =>
        p.receiptCreationDate === undefined ? Date.now() : Number(p.receiptCreationDate),
      );
      identify(payload.bundleId, payload.appAppleId, payload.receiptType);
      return payload as { appTransactionId?: string };
    },
  };
}
