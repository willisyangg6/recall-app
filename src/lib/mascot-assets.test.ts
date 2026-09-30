/**
 * The approved Lotly mascot set (M01–M06), pinned as files.
 *
 * Six production poses live in assets/brand/production under their exact
 * approved names. Each must stay a 1024×1024 8-bit RGBA PNG, tagged sRGB, with
 * a genuinely transparent canvas around a fully opaque drawing, because every
 * screen that uses one draws it whole with `contain` on the page colour.
 *
 * The files carry the mechanical alpha repair (the same one the first mascot
 * had): transparent pixels hold no hidden colour, the drawing's 240–254
 * alpha ceiling is lifted to 255, and only the antialiased edge (1–239) stays
 * translucent. So no pixel may sit at 240–254, the drawing has no enclosed
 * translucent hole, and there is no background hint or timestamp chunk.
 *
 * M02 (the helper pose) is beside the States step's
 * Map / List control (P2B7Y), and M03 (the ready pose with the grocery bag)
 * beside the Retailers step's heading (Popular stores, 2026-09-24), and M06
 * (the trust-peek pose with the shield, 2026-09-26) hanging over the Ready
 * step's summary card, and M04 (the watchful pose) on the "building your
 * watch" interstitial (2026-09-28) and beside the paywall's heading (the
 * polish pass); M05 is approved but not yet integrated,
 * and nothing may reference it until its own milestone. M01 (the
 * welcome-peek pose) left Welcome with the receipt composition (2026-09-29)
 * and, like M05, is approved but drawn nowhere.
 *
 * M06's placement on the Ready summary card is computed from measurements of
 * its artwork (lib/ready-presentation.ts), so those measurements are checked
 * against the file itself: replacing the art without re-measuring fails here.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';

import {
  TRUST_PEEK_ART_RIGHT,
  TRUST_PEEK_ART_TOP,
  TRUST_PEEK_EDGE,
  TRUST_PEEK_PAW_BOTTOM,
  TRUST_PEEK_SHIELD_BOTTOM,
  TRUST_PEEK_SHIELD_LEFT,
} from '@/lib/ready-presentation';

const ROOT = join(__dirname, '..', '..');
const DIR = join(ROOT, 'assets', 'brand', 'production');

/** The approved set, by milestone number, under the exact approved names. */
const APPROVED = {
  M01: 'lotly-mascot-welcome-peek-1024.png',
  M02: 'lotly-mascot-helper-1024.png',
  M03: 'lotly-mascot-ready-1024.png',
  M04: 'lotly-mascot-watchful-1024.png',
  M05: 'lotly-mascot-notifications-1024.png',
  M06: 'lotly-mascot-ready-trust-peek-1024.png',
} as const;

interface DecodedPng {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
  /** Every chunk type, in file order. */
  chunks: string[];
  /** One alpha byte per pixel, row-major. */
  alpha: Uint8Array;
}

/** A minimal PNG reader for 8-bit RGBA, non-interlaced: enough to read alpha. */
function decodeRgba(path: string): DecodedPng {
  const bytes = readFileSync(path);
  assert.ok(
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    `${path} is not a PNG`,
  );
  const idat: Buffer[] = [];
  const chunks: string[] = [];
  let header: Omit<DecodedPng, 'alpha' | 'chunks'> | null = null;
  let sawEnd = false;
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    chunks.push(type);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    }
    if (type === 'IDAT') idat.push(data);
    if (type === 'IEND') sawEnd = offset + 12 + length === bytes.length;
    offset += 12 + length;
  }
  assert.ok(header, `${path} has no IHDR`);
  assert.ok(sawEnd, `${path} does not end cleanly at IEND`);
  const { width, height } = header;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const alpha = new Uint8Array(width * height);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? line[x - 4] : 0;
      const b = previous[x];
      const c = x >= 4 ? previous[x - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = (line[x] + predictor) & 255;
    }
    for (let x = 0; x < width; x++) alpha[y * width + x] = line[x * 4 + 3];
    previous = line;
  }
  return { ...header, chunks, alpha };
}

const DECODED = Object.fromEntries(
  Object.entries(APPROVED).map(([id, name]) => [id, decodeRgba(join(DIR, name))]),
) as Record<keyof typeof APPROVED, DecodedPng>;

test('the production mascot set is exactly the six approved files, by name', () => {
  const present = readdirSync(DIR)
    .filter((name) => /^lotly-mascot-.+-1024\.png$/.test(name))
    .sort();
  assert.deepEqual(present, Object.values(APPROVED).sort());
});

test('every mascot is a 1024×1024 8-bit RGBA PNG', () => {
  for (const [id, png] of Object.entries(DECODED)) {
    assert.equal(png.width, 1024, `${id} width`);
    assert.equal(png.height, 1024, `${id} height`);
    assert.equal(png.bitDepth, 8, `${id} bit depth`);
    assert.equal(png.colorType, 6, `${id} is not RGBA (colour type 6)`);
    assert.equal(png.interlace, 0, `${id} is interlaced`);
  }
});

test('every mascot is tagged sRGB and carries no background hint or timestamp', () => {
  for (const [id, png] of Object.entries(DECODED)) {
    const { chunks } = png;
    assert.ok(chunks.includes('sRGB'), `${id} has no sRGB chunk`);
    assert.ok(chunks.indexOf('sRGB') < chunks.indexOf('IDAT'), `${id}: sRGB after the image data`);
    for (const forbidden of ['bKGD', 'tIME', 'iCCP']) {
      assert.ok(!chunks.includes(forbidden), `${id} carries ${forbidden}`);
    }
  }
});

test('every mascot is a fully opaque drawing on a transparent canvas, with only its edge translucent', () => {
  for (const [id, png] of Object.entries(DECODED)) {
    const { alpha, width, height } = png;
    const corners = [0, width - 1, (height - 1) * width, height * width - 1].map((i) => alpha[i]);
    assert.deepEqual(corners, [0, 0, 0, 0], `${id} corners are not transparent`);
    let clear = 0;
    let opaque = 0;
    let ceiling = 0;
    for (const value of alpha) {
      if (value === 0) clear++;
      else if (value === 255) opaque++;
      else if (value >= 240) ceiling++;
    }
    const total = width * height;
    assert.ok(clear / total > 0.4, `${id}: only ${clear} fully transparent pixels`);
    assert.ok(opaque > 300_000, `${id}: only ${opaque} fully opaque pixels`);
    assert.equal(ceiling, 0, `${id}: ${ceiling} pixels still sit at alpha 240–254`);
  }
});

test('no mascot has a translucent hole inside the drawing', () => {
  for (const [id, png] of Object.entries(DECODED)) {
    const { alpha, width, height } = png;
    // Flood the non-opaque pixels from the canvas edge; anything non-opaque
    // left unreached is enclosed by the opaque drawing: a hole.
    const reached = new Uint8Array(width * height);
    const queue: number[] = [];
    const visit = (i: number) => {
      if (!reached[i] && alpha[i] < 255) {
        reached[i] = 1;
        queue.push(i);
      }
    };
    for (let x = 0; x < width; x++) {
      visit(x);
      visit((height - 1) * width + x);
    }
    for (let y = 0; y < height; y++) {
      visit(y * width);
      visit(y * width + width - 1);
    }
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head];
      const x = i % width;
      if (x > 0) visit(i - 1);
      if (x < width - 1) visit(i + 1);
      if (i >= width) visit(i - width);
      if (i < (height - 1) * width) visit(i + width);
    }
    let holes = 0;
    for (let i = 0; i < alpha.length; i++) if (alpha[i] < 255 && !reached[i]) holes++;
    assert.equal(holes, 0, `${id} has ${holes} enclosed translucent pixels`);
  }
});

test('M06’s seat on the Ready summary card matches its artwork', () => {
  const { alpha, width } = DECODED.M06;
  const solid = (x: number, y: number) => alpha[y * width + x] >= 128;
  const lowest = (xs: number[]) => {
    let found = -1;
    for (let y = 0; y < width; y++) if (xs.some((x) => solid(x, y))) found = y;
    return found;
  };
  const span = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);
  // The flat cut: the last row solid across the body's middle.
  let cut = 0;
  for (let y = 0; y < width; y++) if ([400, 448, 512].every((x) => solid(x, y))) cut = y;
  // The paw, left of the shield; the shield; the drawing's top and trailing edge.
  const paw = lowest(span(0, 280));
  const shield = lowest(span(280, width));
  let top = width;
  let right = 0;
  let shieldLeft = width;
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      if (!solid(x, y)) continue;
      top = Math.min(top, y);
      right = Math.max(right, x);
      if (y > cut + 6 && x >= 280) shieldLeft = Math.min(shieldLeft, x);
    }
  }
  // The artwork's own coordinates…
  assert.equal(cut, 703, 'the flat cut moved');
  assert.equal(paw, 742, 'the paw moved');
  assert.equal(shield, 972, 'the shield moved');
  assert.equal(top, 129, 'the top of the art moved');
  assert.equal(right, 968, 'the trailing edge moved');
  assert.equal(shieldLeft, 580, 'the shield’s leading edge moved');
  // …and the seat the screen computes from them (each the first clear row or column).
  assert.equal(TRUST_PEEK_EDGE * 1024, cut + 1);
  assert.equal(TRUST_PEEK_PAW_BOTTOM * 1024, paw + 1);
  assert.equal(TRUST_PEEK_SHIELD_BOTTOM * 1024, shield + 1);
  assert.equal(TRUST_PEEK_ART_TOP * 1024, top);
  assert.equal(TRUST_PEEK_ART_RIGHT * 1024, right + 1);
  assert.equal(TRUST_PEEK_SHIELD_LEFT * 1024, shieldLeft);
});

test('M06 carries the mechanical repair of the supplied 1254px export, uniformly scaled to 1024', () => {
  // The supplied file (sha256 1b27932a…) was 1254×1254 with 625,268 pixels at
  // alpha 240–254 and a caBX chunk. It was repaired at its own size, scaled
  // uniformly to 1024 (never cropped or shifted), and re-normalized; the
  // drawing's proportions on the canvas are the original's.
  const bytes = readFileSync(join(DIR, APPROVED.M06));
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    'dd279dc1a805ff113c1e07b246244ced1d006be36a07198a10cf5bb4780a71d7',
  );
  assert.ok(!DECODED.M06.chunks.includes('caBX'), 'the export metadata came back');
});

test('M03 on Retailers, M04 on the building interstitial and the paywall, M06 on Ready; M01, M02 and M05 are referenced nowhere', () => {
  const retailers = readFileSync(
    join(ROOT, 'src', 'components', 'onboarding', 'retailers-step.tsx'),
    'utf8',
  );
  assert.ok(retailers.includes(`require('@/assets/brand/production/${APPROVED.M03}')`));
  const ready = readFileSync(
    join(ROOT, 'src', 'components', 'onboarding', 'preview-step.tsx'),
    'utf8',
  );
  assert.ok(ready.includes(`require('@/assets/brand/production/${APPROVED.M06}')`));
  assert.ok(!ready.includes(APPROVED.M03), 'Ready draws the grocery-bag pose');
  const building = readFileSync(
    join(ROOT, 'src', 'components', 'onboarding', 'building-step.tsx'),
    'utf8',
  );
  assert.ok(building.includes(`require('@/assets/brand/production/${APPROVED.M04}')`));
  const sources: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
        sources.push(readFileSync(path, 'utf8'));
      }
    }
  };
  walk(join(ROOT, 'src'));
  // M01 left Welcome with the receipt composition (2026-09-29); M02 left
  // States with the grocery-atlas composition (2026-09-30), whose seated
  // mascot is part of the approved scene; M05 awaits its milestone.
  for (const id of ['M01', 'M02', 'M05'] as const) {
    const name = APPROVED[id];
    assert.ok(!sources.some((source) => source.includes(name)), `${id} (${name}) is integrated`);
  }
  // M04, the watchful pose, is the interstitial's and (polish pass) the
  // paywall's heading aside — exactly those two sources.
  assert.equal(
    sources.filter((source) => source.includes(APPROVED.M04)).length,
    2,
    'M04 is drawn somewhere other than the interstitial and the paywall',
  );
  const panel = readFileSync(
    join(ROOT, 'src', 'components', 'paywall', 'paywall-panel.tsx'),
    'utf8',
  );
  assert.ok(panel.includes(`require('@/assets/brand/production/${APPROVED.M04}')`));
  assert.equal(
    sources.filter((source) => source.includes(APPROVED.M03)).length,
    1,
    'M03 is drawn somewhere other than Retailers',
  );
  assert.equal(
    sources.filter((source) => source.includes(`/${APPROVED.M06}')`)).length,
    1,
    'M06 is drawn somewhere other than Ready',
  );
});
