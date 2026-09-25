/**
 * The approved Lotly mascot set (M01–M05), pinned as files.
 *
 * Five production poses live in assets/brand/production under their exact
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
 * M01 is on Welcome, M02 (the helper pose) beside the States step's
 * Map / List control (P2B7Y), and M03 (the ready pose with the grocery bag)
 * beside the Retailers step's heading (Popular stores, 2026-09-24); M04 and
 * M05 are approved but not yet integrated, and nothing may reference them
 * until their own milestone.
 *
 * M01's placement on the Welcome card is computed from measurements of its
 * artwork (lib/welcome-presentation.ts), so those measurements are checked
 * against the file itself: replacing the art without re-measuring fails here.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';

import {
  CARD_PADDING,
  MASCOT_ART_TOP,
  MASCOT_EDGE,
  MASCOT_MAX,
  MASCOT_MIN,
  mascotLift,
  mascotOffset,
  PAW_DEPTH,
} from '@/lib/welcome-presentation';

const ROOT = join(__dirname, '..', '..');
const DIR = join(ROOT, 'assets', 'brand', 'production');

/** The approved set, by milestone number, under the exact approved names. */
const APPROVED = {
  M01: 'lotly-mascot-welcome-peek-1024.png',
  M02: 'lotly-mascot-helper-1024.png',
  M03: 'lotly-mascot-ready-1024.png',
  M04: 'lotly-mascot-watchful-1024.png',
  M05: 'lotly-mascot-notifications-1024.png',
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

test('the production mascot set is exactly the five approved files, by name', () => {
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

test('M01’s seat on the Welcome card matches its artwork', () => {
  const { alpha, width } = DECODED.M01;
  const solid = (x: number, y: number) => alpha[y * width + x] >= 128;
  const rowIsSolidAt = (y: number, xs: number[]) => xs.some((x) => solid(x, y));
  // The flat cut: the last row where the body is solid across its middle.
  const middle = [400, 500, 600];
  let cut = 0;
  for (let y = 0; y < width; y++) if (middle.every((x) => solid(x, y))) cut = y;
  // The paws: the last solid row anywhere; the art: the first.
  const everyX = Array.from({ length: width }, (_, x) => x);
  let lowest = 0;
  let highest = width;
  for (let y = 0; y < width; y++) {
    if (rowIsSolidAt(y, everyX)) {
      lowest = y;
      highest = Math.min(highest, y);
    }
  }
  // The artwork's own coordinates, unchanged by the repair…
  assert.equal(cut, 807, 'the flat cut moved');
  assert.equal(lowest, 860, 'the paws moved');
  assert.equal(highest, 185, 'the top of the art moved');
  // …and the seat the screen computes from them.
  assert.equal(MASCOT_EDGE * 1024, 808);
  assert.equal((MASCOT_EDGE + PAW_DEPTH) * 1024, 860);
  assert.equal(MASCOT_ART_TOP * 1024, 185);
});

test('M01’s card-overlap geometry is unchanged at both size bounds', () => {
  assert.equal(MASCOT_MIN, 176);
  assert.equal(MASCOT_MAX, 208);
  // The box starts this far above the card's top border…
  assert.equal(mascotOffset(MASCOT_MIN), 139);
  assert.equal(mascotOffset(MASCOT_MAX), 164);
  // …the drawing stands this tall above it…
  assert.equal(mascotLift(MASCOT_MIN), 108);
  assert.equal(mascotLift(MASCOT_MAX), 127);
  // …and the paws reach this far into the card, inside its 12pt padding.
  assert.equal(CARD_PADDING, 12);
  assert.ok(MASCOT_MAX * PAW_DEPTH < CARD_PADDING - 1);
  assert.equal(MASCOT_MAX * PAW_DEPTH, 10.5625);
});

test('M01 is on Welcome, M02 on States and M03 on Retailers, each once; M04–M05 are referenced nowhere yet', () => {
  const welcome = readFileSync(
    join(ROOT, 'src', 'components', 'onboarding', 'welcome-content.tsx'),
    'utf8',
  );
  assert.ok(welcome.includes(`require('@/assets/brand/production/${APPROVED.M01}')`));
  const states = readFileSync(
    join(ROOT, 'src', 'components', 'onboarding', 'states-step.tsx'),
    'utf8',
  );
  assert.ok(states.includes(`require('@/assets/brand/production/${APPROVED.M02}')`));
  const retailers = readFileSync(
    join(ROOT, 'src', 'components', 'onboarding', 'retailers-step.tsx'),
    'utf8',
  );
  assert.ok(retailers.includes(`require('@/assets/brand/production/${APPROVED.M03}')`));
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
  for (const id of ['M04', 'M05'] as const) {
    const name = APPROVED[id];
    assert.ok(!sources.some((source) => source.includes(name)), `${id} (${name}) is integrated`);
  }
  assert.equal(
    sources.filter((source) => source.includes(`/${APPROVED.M01}')`)).length,
    1,
    'M01 is drawn somewhere other than Welcome',
  );
  assert.equal(
    sources.filter((source) => source.includes(APPROVED.M02)).length,
    1,
    'M02 is drawn somewhere other than States',
  );
  assert.equal(
    sources.filter((source) => source.includes(APPROVED.M03)).length,
    1,
    'M03 is drawn somewhere other than Retailers',
  );
});
