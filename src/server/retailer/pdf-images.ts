/**
 * The JPEG images embedded in a retailer's letter, byte for byte
 * (docs/recall-retailer-notices.md, "Product image").
 *
 * The approval step uses this to prove that a reviewer-selected product photo
 * is exactly an image printed in the approved letter: the photo is identified
 * by its PDF object number, size and SHA-256, and must match an image read
 * back out of the archived bytes. Nothing is re-encoded, resized or cropped.
 *
 * Scope, deliberately narrow:
 * - only `DCTDecode` image XObjects (a JPEG stored as-is in the PDF), with a
 *   direct `/Length`;
 * - unencrypted letters, and letters protected by the Standard security
 *   handler at V4/R4 with AES-128 (`AESV2`) and an empty user password (how
 *   Costco's Google Docs letters are saved). The derived key is verified
 *   against the document's `/U` entry before any stream is decrypted.
 * Anything else returns null, and an image cannot be approved from it.
 */

import { createDecipheriv, createHash } from 'node:crypto';

export interface PdfEmbeddedJpeg {
  objectNumber: number;
  width: number;
  height: number;
  sha256: string;
  bytes: Uint8Array;
}

/** No product photo needs more than this; a larger stream is not one. */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const PASSWORD_PAD = Buffer.from(
  '28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A',
  'hex',
);

/** A PDF literal string's bytes, starting at its opening parenthesis. */
function literalString(source: string, open: number): Buffer {
  const out: number[] = [];
  const escapes: Record<string, number> = {
    n: 10,
    r: 13,
    t: 9,
    b: 8,
    f: 12,
    '(': 40,
    ')': 41,
    '\\': 92,
  };
  let depth = 1;
  for (let i = open + 1; i < source.length;) {
    const c = source[i];
    if (c === '\\') {
      const next = source[i + 1];
      if (next in escapes) {
        out.push(escapes[next]);
        i += 2;
      } else if (/[0-7]/.test(next)) {
        let digits = '';
        let k = i + 1;
        while (k < i + 4 && /[0-7]/.test(source[k])) digits += source[k++];
        out.push(parseInt(digits, 8) & 255);
        i = k;
      } else if (next === '\r' || next === '\n') {
        i += 2;
        if (next === '\r' && source[i] === '\n') i += 1;
      } else {
        out.push(next.charCodeAt(0));
        i += 2;
      }
      continue;
    }
    if (c === '(') depth += 1;
    if (c === ')' && --depth === 0) break;
    out.push(c.charCodeAt(0));
    i += 1;
  }
  return Buffer.from(out);
}

/** RC4, needed only to verify the derived key (OpenSSL 3 no longer ships it). */
function rc4(key: Buffer, data: Buffer): Buffer {
  const s = [...Array(256).keys()];
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  let i = 0;
  j = 0;
  for (let n = 0; n < data.length; n++) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    out[n] = data[n] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

/** The file key for an empty user password, or null if unsupported or unverified. */
function aesv2FileKey(source: string, encryptObject: number): Buffer | null {
  const start = source.search(new RegExp(`(?:^|[\\r\\n])${encryptObject} 0 obj`));
  if (start < 0) return null;
  const dict = source.slice(start, source.indexOf('endobj', start));
  if (!/\/Filter\s*\/Standard/.test(dict) || !/\/V 4\b/.test(dict) || !/\/R 4\b/.test(dict)) {
    return null;
  }
  if (!/\/CFM\s*\/AESV2/.test(dict) || /\/EncryptMetadata\s+false/.test(dict)) return null;
  const oAt = dict.indexOf('/O(');
  const uAt = dict.indexOf('/U(');
  const p = dict.match(/\/P (-?\d+)/);
  const id = source.match(/\/ID\s*\[\s*<([0-9A-Fa-f]+)>/);
  if (oAt < 0 || uAt < 0 || !p || !id) return null;
  const owner = literalString(source, start + oAt + 2);
  const user = literalString(source, start + uAt + 2);
  const firstId = Buffer.from(id[1], 'hex');
  const permissions = Buffer.alloc(4);
  permissions.writeInt32LE(Number(p[1]));
  let key = createHash('md5')
    .update(Buffer.concat([PASSWORD_PAD, owner, permissions, firstId]))
    .digest();
  for (let round = 0; round < 50; round++) {
    key = createHash('md5').update(key.subarray(0, 16)).digest();
  }
  key = key.subarray(0, 16);
  // Algorithm 5: the key is right only if it reproduces /U's first 16 bytes.
  let check = rc4(
    key,
    createHash('md5')
      .update(Buffer.concat([PASSWORD_PAD, firstId]))
      .digest(),
  );
  for (let round = 1; round <= 19; round++) {
    check = rc4(Buffer.from(key.map((byte) => byte ^ round)), check);
  }
  return check.equals(user.subarray(0, 16)) ? key : null;
}

function decryptStream(fileKey: Buffer, objectNumber: number, cipher: Buffer): Buffer | null {
  if (cipher.length < 32 || cipher.length % 16 !== 0) return null;
  const objectKey = createHash('md5')
    .update(
      Buffer.concat([
        fileKey,
        Buffer.from([objectNumber & 255, (objectNumber >> 8) & 255, (objectNumber >> 16) & 255]),
        Buffer.from([0, 0]),
        Buffer.from('sAlT'),
      ]),
    )
    .digest()
    .subarray(0, 16);
  try {
    const decipher = createDecipheriv('aes-128-cbc', objectKey, cipher.subarray(0, 16));
    return Buffer.concat([decipher.update(cipher.subarray(16)), decipher.final()]);
  } catch {
    return null;
  }
}

/** Every embedded JPEG, in object order, or null when the letter is out of scope. */
export function embeddedJpegImages(pdf: Uint8Array): PdfEmbeddedJpeg[] | null {
  const bytes = Buffer.from(pdf);
  const source = bytes.toString('latin1');
  const encrypt = source.match(/\/Encrypt\s+(\d+)\s+0\s+R/);
  const fileKey = encrypt ? aesv2FileKey(source, Number(encrypt[1])) : null;
  if (encrypt && !fileKey) return null;

  const images: PdfEmbeddedJpeg[] = [];
  const header = /(?:^|[\r\n])(\d+) 0 obj\s*<<([\s\S]*?)>>\s*stream\r?\n/g;
  for (let match = header.exec(source); match; match = header.exec(source)) {
    const [, objectText, dict] = match;
    if (!/\/Subtype\s*\/Image/.test(dict) || !/\/Filter\s*\/DCTDecode\b/.test(dict)) continue;
    const length = dict.match(/\/Length (\d+)(?!\s+\d+\s+R)/);
    const width = dict.match(/\/Width (\d+)/);
    const height = dict.match(/\/Height (\d+)/);
    if (!length || !width || !height) continue;
    const start = match.index + match[0].length;
    const stored = bytes.subarray(start, start + Number(length[1]));
    const objectNumber = Number(objectText);
    const jpeg = fileKey ? decryptStream(fileKey, objectNumber, stored) : Buffer.from(stored);
    if (!jpeg || jpeg.length > MAX_IMAGE_BYTES || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) continue;
    images.push({
      objectNumber,
      width: Number(width[1]),
      height: Number(height[1]),
      sha256: createHash('sha256').update(jpeg).digest('hex'),
      bytes: new Uint8Array(jpeg),
    });
  }
  return images;
}
