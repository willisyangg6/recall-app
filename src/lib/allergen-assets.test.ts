/**
 * The Lotly allergen pictograms: every canonical allergen maps to exactly one
 * approved production PNG through static requires, every file is the
 * approved 1024×1024 sRGB master after the mascots' mechanical alpha repair
 * (clear pixels hold no colour, alpha 240–254 lifted to 255 with RGB
 * untouched, the soft edge unmatted against white), the tile's pictogram
 * geometry rests on the artwork's measured transparent margin, and the
 * pack's review artifacts stay out of the runtime.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';

import { CONSUMER_ALLERGENS } from '@/domain/preferences';
import { TILE } from '@/lib/allergen-grid';
import { ALLERGEN_ICONS } from '@/lib/allergen-icons';

const ROOT = join(__dirname, '..', '..');
const ICONS = join(ROOT, 'assets', 'icons');
const REFERENCE = join(ROOT, 'assets', 'brand', 'reference', 'allergens');
const MODULE = join(__dirname, 'allergen-assets.ts');

/** The approved semantic pairs, by the label a shopper reads. */
const APPROVED: Readonly<Record<string, string>> = {
  Peanuts: 'allergen-peanuts-1024.png',
  'Tree nuts': 'allergen-tree-nuts-1024.png',
  Milk: 'allergen-milk-1024.png',
  Egg: 'allergen-egg-1024.png',
  Wheat: 'allergen-wheat-1024.png',
  Soy: 'allergen-soy-1024.png',
  Sesame: 'allergen-sesame-1024.png',
  Fish: 'allergen-fish-1024.png',
  'Crustacean shellfish': 'allergen-crustacean-shellfish-1024.png',
};

const REVIEW_ARTIFACTS = [
  'production-contact-sheet.png',
  'source-pack-asset-report.json',
  'production-asset-report.json',
] as const;

/**
 * Loads the asset module the way Metro would see it, with each PNG `require`
 * resolving to the absolute file it names — so the test reads the map the
 * app gets, and records every asset the module asks for.
 */
function loadPictograms(): {
  map: Readonly<Record<string, unknown>>;
  lookup: (token: string) => unknown;
  requested: string[];
} {
  const requested: string[] = [];
  const extensions = require.extensions as Record<
    string,
    (module: NodeModule, file: string) => void
  >;
  const prior = extensions['.png'];
  extensions['.png'] = (module, file) => {
    requested.push(file);
    module.exports = file;
  };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require(MODULE) as typeof import('./allergen-assets');
    return { map: loaded.ALLERGEN_PICTOGRAMS, lookup: loaded.allergenPictogram, requested };
  } finally {
    if (prior === undefined) delete extensions['.png'];
    else extensions['.png'] = prior;
  }
}

interface DecodedPng {
  width: number;
  height: number;
  /** Every chunk type, in file order. */
  chunks: string[];
  /** Four bytes per pixel, RGBA, row-major. */
  rgba: Uint8Array;
}

/** A minimal reader for 8-bit RGBA, non-interlaced PNGs. */
function decodeRgba(path: string): DecodedPng {
  const bytes = readFileSync(path);
  assert.ok(
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    `${path} is not a PNG`,
  );
  const idat: Buffer[] = [];
  const chunks: string[] = [];
  let width = 0;
  let height = 0;
  let sawEnd = false;
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    chunks.push(type);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, `${path} bit depth`);
      assert.equal(data[9], 6, `${path} is not RGBA (colour type 6)`);
      assert.equal(data[12], 0, `${path} is interlaced`);
    }
    if (type === 'IDAT') idat.push(data);
    if (type === 'IEND') sawEnd = offset + 12 + length === bytes.length;
    offset += 12 + length;
  }
  assert.ok(width > 0 && sawEnd, `${path} has no IHDR or does not end cleanly at IEND`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rgba = new Uint8Array(stride * height);
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
    rgba.set(line, y * stride);
    previous = line;
  }
  return { width, height, chunks, rgba };
}

/**
 * What each approved file held BEFORE the alpha repair, measured from the
 * originals (their SHA-256s are in source-pack-asset-report.json): how many
 * pixels were clear, soft edge (1–239), near-opaque (240–254) and opaque;
 * the drawing's bounds [left, top, right, bottom]; a digest of where alpha
 * was 0; and a digest of the position and RGB of every pixel at 240 or
 * above. The repair may only lift 240–254 to 255, so each can be re-derived
 * from the repaired file and must match. Tree nuts' `clear` digest leaves
 * out the pixels of its pinhole fill (below), whose alpha-0 pixels the fill
 * deliberately made opaque.
 */
const BEFORE_REPAIR: Readonly<
  Record<
    string,
    { alpha: readonly number[]; bounds: readonly number[]; clear: string; solidRgb: string }
  >
> = {
  'allergen-peanuts-1024.png': {
    alpha: [824779, 4574, 218041, 1182],
    bounds: [152, 182, 871, 841],
    clear: '27a97634cb229e551f3db47a669a0784cb0155075abb11eb9fa42272110bf1b9',
    solidRgb: 'b14cc0d18b5ffa880d65ecdf5e2a2be7cb7015dbae0314dfe2648dcae13ac3df',
  },
  'allergen-tree-nuts-1024.png': {
    alpha: [811155, 5146, 230949, 1326],
    bounds: [152, 191, 871, 832],
    clear: '6f89d275db3be43df6d03c11e9f74543c45e2d702665c1b0de438b5931775e43',
    solidRgb: '45578250c55a2622367f5fadac086754fdff012fe8c3f4b062ad505f9522f593',
  },
  'allergen-milk-1024.png': {
    alpha: [814207, 5044, 227934, 1391],
    bounds: [206, 152, 816, 871],
    clear: '15396783a0e222cba1210030c73aa63f6330f8d4761fe901955bf9b04bd51975',
    solidRgb: 'db518fb6b288f3027ace9e660579b78c6901066ab2a00cbf16075c2ce79d56c7',
  },
  'allergen-egg-1024.png': {
    alpha: [790474, 4919, 251988, 1195],
    bounds: [198, 152, 825, 871],
    clear: 'f10a6e1ab35e0ef945945b6a668cc855c8d4a75762725930cb2f1af210fc6294',
    solidRgb: 'a09e90a5c73284b43daca7777f180a89242f639db73335bb345466180b206969',
  },
  'allergen-wheat-1024.png': {
    alpha: [916661, 4445, 126353, 1117],
    bounds: [229, 152, 794, 871],
    clear: 'a47b59393a2a65359cd06f530be2629675a32dfa7d4de4317aac1d77a71f2e47',
    solidRgb: '9e87928b6e7935d13f055203e096c0c63299ab56d4e5f4da594ebd2516770f40',
  },
  'allergen-soy-1024.png': {
    alpha: [865210, 4719, 177443, 1204],
    bounds: [152, 162, 871, 860],
    clear: 'e616948857dd44f91c6eb4ed81c58ad42e34bf72af8441426f0b8f5962797938',
    solidRgb: 'eab28d899da2a5d343126d31025d033148958d7995e9dac52a962ed2df9256c4',
  },
  'allergen-sesame-1024.png': {
    alpha: [886034, 5309, 155798, 1435],
    bounds: [178, 152, 844, 871],
    clear: '843190a1ffbec3f842dd92b5b14bc2300b8a4244a0023d7c4c29a8a56533b71d',
    solidRgb: '9692ac998ffa6d48cb08741fab4fa4b30681fe4477ae8d262129d2bf62758185',
  },
  'allergen-fish-1024.png': {
    alpha: [850758, 5128, 191398, 1292],
    bounds: [152, 195, 871, 828],
    clear: 'b15e7bfe4c7a7641da024e3f40d6ca4d103b31823a74bcc4f4326d5658b276ad',
    solidRgb: 'd7943abdc0ec2b307ad75c14840f17b8e4eaca48e761510b44f364912c6906df',
  },
  'allergen-crustacean-shellfish-1024.png': {
    alpha: [876408, 7779, 162254, 2135],
    bounds: [159, 152, 864, 833],
    clear: '373d00a0af97fca430466baf1b1ae9fbe023b7f9050354e321ea58724da65ddd',
    solidRgb: 'c68edc7e8b9f95411ac4cb70dd47f0f32bf1905c13ad1fde478cea4019994194',
  },
};

/**
 * The founder-approved pinhole fill in tree nuts: where the almond, cashew
 * and walnut outlines meet, the pack had keyed a small triangle out as
 * background — one enclosed non-opaque component, 36 clear pixels and 130
 * translucent ones. Exactly those pixels (this mask, `#`, from `left`/`top`;
 * not their bounding box) were set to the surrounding outline's dominant
 * navy, sampled from the solid pixels around it, at alpha 255. Nothing else
 * in the file changed.
 */
const PINHOLE_FILL = {
  file: 'allergen-tree-nuts-1024.png',
  left: 497,
  top: 456,
  rows: [
    '##...............',
    '###..............',
    '####.............',
    '#####............',
    '######...........',
    '#######..........',
    '########.........',
    '#########........',
    '###########......',
    '############.....',
    '.############....',
    '.##############..',
    '.###############.',
    '.################',
    '.################',
    '.################',
    '.########........',
    '.##..............',
  ],
  rgba: [1, 37, 71, 255],
  /** What those pixels were before the fill: alpha 0, and 1–239. */
  wasClear: 36,
  wasEdge: 130,
} as const;

/** The pixel indices a file's pinhole fill covers (none outside tree nuts). */
function filledPixels(file: string, width: number): Set<number> {
  const filled = new Set<number>();
  if (file !== PINHOLE_FILL.file) return filled;
  PINHOLE_FILL.rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      if (row[dx] === '#') filled.add((PINHOLE_FILL.top + dy) * width + PINHOLE_FILL.left + dx);
    }
  });
  return filled;
}

const PICTOGRAMS = loadPictograms();

const DECODED = Object.fromEntries(
  Object.values(APPROVED).map((file) => [file, decodeRgba(join(ICONS, file))]),
) as Record<string, DecodedPng>;

/** Source with its comments removed, so a documented path is not a reference. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

/** The drawing's bounding box: the extent of every pixel that is not fully transparent. */
function artBounds({ rgba, width, height }: DecodedPng) {
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return { left, right, top, bottom, width: right - left + 1, height: bottom - top + 1 };
}

// ── The mapping ─────────────────────────────────────────────────────────────

test('every canonical allergen maps to exactly one production pictogram, and only they do', () => {
  const { map, lookup } = PICTOGRAMS;
  // Keyed by the existing canonical tokens, in the catalog's order: the
  // vocabulary is not restated, and adding or removing an allergen fails here.
  assert.deepEqual(
    Object.keys(map),
    CONSUMER_ALLERGENS.map((option) => option.token),
  );
  for (const option of CONSUMER_ALLERGENS) {
    assert.equal(lookup(option.token), map[option.token], option.token);
  }
  // Nine distinct files: no two allergens share a picture.
  assert.equal(new Set(Object.values(map)).size, 9);
  assert.equal(lookup('gluten'), null, 'a non-selectable token has a pictogram');
});

test('the mapping is the nine approved semantic pairs, each at its exact path', () => {
  const { map } = PICTOGRAMS;
  assert.deepEqual(
    CONSUMER_ALLERGENS.map((option) => option.label),
    Object.keys(APPROVED),
  );
  for (const option of CONSUMER_ALLERGENS) {
    const expected = join(ICONS, APPROVED[option.label]);
    assert.equal(map[option.token], expected, `${option.label} draws the wrong pictogram`);
    assert.ok(existsSync(expected), `missing ${APPROVED[option.label]}`);
  }
});

test('the pictograms are static requires only: nine literal paths, nothing built at runtime', () => {
  const { requested } = PICTOGRAMS;
  // Metro bundles exactly what the module asks for: the nine files, once each.
  assert.deepEqual(
    [...requested].sort(),
    Object.values(APPROVED)
      .map((file) => join(ICONS, file))
      .sort(),
  );
  // Every require takes one string literal — no template, concatenation or
  // variable a bundler could not follow.
  const source = readFileSync(MODULE, 'utf8');
  const calls = [...source.matchAll(/require\(([^)]*)\)/g)].map((m) => m[1]);
  assert.equal(calls.length, 9);
  for (const argument of calls) {
    assert.match(argument, /^'@\/assets\/icons\/allergen-[a-z-]+-1024\.png'$/, argument);
  }
});

// ── The files ───────────────────────────────────────────────────────────────

test('the production pictograms in assets/icons are exactly the nine approved files', () => {
  const present = readdirSync(ICONS)
    .filter((name) => /-1024\.png$/.test(name))
    .sort();
  assert.deepEqual(present, Object.values(APPROVED).sort());
});

test('every pictogram is a 1024×1024 8-bit RGBA PNG, tagged sRGB, with no background hint or timestamp', () => {
  for (const [file, png] of Object.entries(DECODED)) {
    assert.equal(png.width, 1024, `${file} width`);
    assert.equal(png.height, 1024, `${file} height`);
    // decodeRgba has already required 8-bit RGBA, non-interlaced.
    const { chunks } = png;
    assert.ok(chunks.includes('sRGB'), `${file} has no sRGB chunk`);
    assert.ok(
      chunks.indexOf('sRGB') < chunks.indexOf('IDAT'),
      `${file}: sRGB after the image data`,
    );
    for (const forbidden of ['bKGD', 'tIME', 'iCCP']) {
      assert.ok(!chunks.includes(forbidden), `${file} carries ${forbidden}`);
    }
  }
});

test('every pictogram is an opaque drawing on a clear canvas, with only its edge translucent', () => {
  for (const [file, png] of Object.entries(DECODED)) {
    const { rgba, width, height } = png;
    const alphaAt = (i: number) => rgba[i * 4 + 3];
    const corners = [0, width - 1, (height - 1) * width, height * width - 1].map(alphaAt);
    assert.deepEqual(corners, [0, 0, 0, 0], `${file} corners are not transparent`);
    const counts = [0, 0, 0, 0];
    let hiddenColour = 0;
    for (let i = 0; i < width * height; i++) {
      const a = alphaAt(i);
      counts[a === 0 ? 0 : a < 240 ? 1 : a < 255 ? 2 : 3]++;
      if (a === 0 && (rgba[i * 4] || rgba[i * 4 + 1] || rgba[i * 4 + 2])) hiddenColour++;
    }
    const [clear, edge, ceiling, opaque] = counts;
    assert.equal(hiddenColour, 0, `${file}: ${hiddenColour} clear pixels hold a colour`);
    assert.ok(clear / (width * height) > 0.6, `${file}: only ${clear} fully transparent pixels`);
    assert.ok(opaque > 100_000, `${file}: only ${opaque} fully opaque pixels`);
    assert.equal(ceiling, 0, `${file}: ${ceiling} pixels still sit at alpha 240–254`);
    // Exactly the repair: clear and soft-edge counts as they were; every
    // near-opaque pixel is now opaque — and in tree nuts, the pinhole fill's
    // clear and soft pixels are opaque too.
    const before = BEFORE_REPAIR[file].alpha;
    const [wasClear, wasEdge, filled] =
      file === PINHOLE_FILL.file ? [PINHOLE_FILL.wasClear, PINHOLE_FILL.wasEdge, 166] : [0, 0, 0];
    assert.deepEqual(
      [clear, edge, opaque],
      [before[0] - wasClear, before[1] - wasEdge, before[2] + before[3] + filled],
      file,
    );
  }
});

test('no pictogram has an enclosed transparent or translucent hole', () => {
  for (const [file, png] of Object.entries(DECODED)) {
    const { rgba, width, height } = png;
    const open = (i: number) => rgba[i * 4 + 3] < 255;
    // Flood the non-opaque pixels from the canvas edge; any left unreached
    // is enclosed by the opaque drawing.
    const reached = new Uint8Array(width * height);
    const queue: number[] = [];
    const visit = (i: number) => {
      if (!reached[i] && open(i)) {
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
    let enclosed = 0;
    for (let i = 0; i < width * height; i++) if (open(i) && !reached[i]) enclosed++;
    assert.equal(enclosed, 0, `${file} has ${enclosed} enclosed non-opaque pixels`);
  }
});

test('tree nuts’ pinhole fill is exactly its 166 pixels, in the outline’s navy, and nothing else', () => {
  const png = DECODED[PINHOLE_FILL.file];
  const filled = filledPixels(PINHOLE_FILL.file, png.width);
  assert.equal(filled.size, 166);
  const xs = [...filled].map((i) => i % png.width);
  const ys = [...filled].map((i) => Math.floor(i / png.width));
  assert.deepEqual(
    [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    [497, 456, 513, 473],
  );
  for (const i of filled) {
    assert.deepEqual([...png.rgba.subarray(i * 4, i * 4 + 4)], [...PINHOLE_FILL.rgba], `@${i}`);
  }
  // Every other pixel is pinned by the fingerprints below, so the fill can
  // neither grow (a changed neighbour) nor move (an unfilled mask pixel).
});

test('the repair kept every clear pixel, the drawing’s bounds, and the RGB of every solid pixel', () => {
  for (const [file, png] of Object.entries(DECODED)) {
    const { rgba, width, height } = png;
    const before = BEFORE_REPAIR[file];
    const filled = filledPixels(file, width);
    const art = artBounds(png);
    assert.deepEqual([art.left, art.top, art.right, art.bottom], before.bounds, `${file} bounds`);
    // Where alpha is 0: one byte per pixel, as the originals were digested.
    const clear = Buffer.alloc(width * height);
    for (let i = 0; i < width * height; i++) {
      clear[i] = rgba[i * 4 + 3] === 0 && !filled.has(i) ? 1 : 0;
    }
    assert.equal(createHash('sha256').update(clear).digest('hex'), before.clear, `${file} clear`);
    // The originals' 240–255 pixels are exactly today's 255s: position and
    // RGB, byte for byte.
    const solid: number[] = [];
    for (let i = 0; i < width * height; i++) {
      if (rgba[i * 4 + 3] !== 255 || filled.has(i)) continue;
      const [x, y] = [i % width, Math.floor(i / width)];
      solid.push(y >> 8, y & 255, x >> 8, x & 255, rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    }
    const digest = createHash('sha256').update(Buffer.from(solid)).digest('hex');
    assert.equal(digest, before.solidRgb, `${file}: a solid pixel's RGB or position changed`);
  }
});

test('every drawing sits in the pack’s 720px bound, so the 44pt box shows about 31pt of art', () => {
  let narrowestSide = Infinity;
  for (const [file, png] of Object.entries(DECODED)) {
    const art = artBounds(png);
    // Normalized to one optical bound: the longer side is 720px, or just
    // under it for the shrimp, whose curl the pack sized by eye (706px).
    const longer = Math.max(art.width, art.height);
    assert.ok(longer >= 700 && longer <= 720, `${file}: ${art.width}×${art.height}`);
    narrowestSide = Math.min(narrowestSide, art.left, 1023 - art.right);
  }
  const scale = TILE.pictogram / 1024;
  assert.equal(TILE.pictogram, 44);
  assert.equal(Math.round(720 * scale), 31);
  // The box's sides overhang the tile's padding and gap by less than the
  // thinnest transparent margin any file has, so the art never does.
  assert.equal(narrowestSide, 152);
  assert.ok(TILE.pictogramOverhang < narrowestSide * scale, `${narrowestSide * scale}pt margin`);
});

// ── What stays as it was ────────────────────────────────────────────────────

test('the production report describes the files in the repository, byte for byte', () => {
  const report = JSON.parse(readFileSync(join(REFERENCE, 'production-asset-report.json'), 'utf8'));
  assert.match(report.description, /final, repaired production/);
  assert.deepEqual(
    report.files.map((entry: { file: string }) => entry.file),
    Object.values(APPROVED),
  );
  for (const entry of report.files) {
    const bytes = readFileSync(join(ICONS, entry.file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, entry.file);
    assert.deepEqual(entry.dimensions, [1024, 1024]);
    assert.equal(entry.srgb.chunk, 'sRGB');
    assert.equal(entry.alphaCounts.nearOpaque240to254, 0);
    assert.equal(entry.enclosedHolePixels, 0);
  }
  // The source pack's report still names the unrepaired files it measured.
  const source = JSON.parse(
    readFileSync(join(REFERENCE, 'source-pack-asset-report.json'), 'utf8'),
  ) as { file: string; sha256: string }[];
  assert.deepEqual(source.map((entry) => entry.file).sort(), Object.values(APPROVED).sort());
  for (const entry of report.files) {
    const pack = source.find((s) => s.file === entry.file)!;
    assert.equal(entry.sourcePackSha256, pack.sha256, entry.file);
    assert.notEqual(entry.sha256, pack.sha256, `${entry.file} is still the unrepaired file`);
  }
});

test('the Lucide allergen glyphs are untouched and still serve Profile', () => {
  const icon = readFileSync(join(ROOT, 'src', 'components', 'ui', 'icon.tsx'), 'utf8');
  for (const name of Object.values(ALLERGEN_ICONS)) {
    assert.ok(icon.includes(`'${name}': require('@/assets/icons/${name}.png')`), name);
    for (const suffix of ['', '@2x', '@3x']) {
      assert.ok(existsSync(join(ICONS, `${name}${suffix}.png`)), `${name}${suffix}.png is gone`);
    }
  }
  const form = readFileSync(
    join(ROOT, 'src', 'components', 'settings', 'personalization-form.tsx'),
    'utf8',
  );
  assert.ok(form.includes('<AllergenGlyph token={option.token}'));
  assert.ok(!form.includes('allergen-assets'), 'Profile switched to the pictograms');
});

test('the contact sheet and both asset reports are reference material, never runtime', () => {
  for (const name of REVIEW_ARTIFACTS) {
    assert.ok(existsSync(join(REFERENCE, name)), `${name} is not in the reference folder`);
    assert.ok(!existsSync(join(ICONS, name)), `${name} is among the runtime icons`);
  }
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx|js|jsx|json)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
        const source = codeOnly(readFileSync(path, 'utf8'));
        if (source.includes('reference/allergens')) hits.push(path);
        for (const name of REVIEW_ARTIFACTS) if (source.includes(name)) hits.push(path);
      }
    }
  };
  walk(join(ROOT, 'src'));
  assert.deepEqual(hits, []);
  const app = readFileSync(join(ROOT, 'app.json'), 'utf8');
  for (const name of REVIEW_ARTIFACTS) assert.ok(!app.includes(name), `app.json names ${name}`);
});
