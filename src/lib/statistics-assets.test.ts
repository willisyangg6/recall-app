/**
 * The statistics household illustrations, pinned as files: the four
 * approved 1254×1254 sources stay byte-identical as reference material,
 * the four 1024×1024 production files carry the mascots' mechanical repair
 * contract exactly, the production report describes the repository's bytes
 * accurately, the typed mapping is complete and one-to-one, and no source,
 * reference target or contact sheet is imported by any app code.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';

import { PROBLEM_RISK_GROUP_IDS, RISK_ART_BOTTOM, RISK_ART_TOP } from '@/lib/problem-presentation';

const ROOT = join(__dirname, '..', '..');
const PRODUCTION = join(ROOT, 'assets', 'brand', 'production');
const REFERENCE = join(ROOT, 'assets', 'brand', 'reference', 'statistics');
const SOURCES = join(REFERENCE, 'source');
const MODULE = join(__dirname, 'statistics-assets.ts');

/**
 * The approved pairs: semantic id → (byte-identical source, production
 * file). The source hashes are the files as approved on 2026-09-28; the
 * production hashes are the repaired, resampled files this milestone
 * installed. Either changing without the other is the failure this pins.
 */
const APPROVED: Readonly<
  Record<string, { source: string; sourceSha256: string; production: string; sha256: string }>
> = {
  'young-children': {
    source: 'statistics-young-children-source-1254.png',
    sourceSha256: '42e35c0b7cc42ba68b7dfe104f9b35e89d24ed8d0aaac1d766f87463322d5799',
    production: 'statistics-young-children-1024.png',
    sha256: 'd414faf0514c0eacad736a87ab6f72d763db998662b2f5d9ff067f3dad6147a9',
  },
  'pregnant-people': {
    source: 'statistics-pregnant-people-source-1254.png',
    sourceSha256: 'c0754fab38fdca9914e04959a1ebec3c254ea4673960bbcea2b749a85934cc27',
    production: 'statistics-pregnant-people-1024.png',
    sha256: '9890aca6dfed3e24eb4af73775105b02ef222f9ad17745536b1e8c6a9f87d625',
  },
  'adults-65-plus': {
    source: 'statistics-adults-65-plus-source-1254.png',
    sourceSha256: 'bc4846711d458b93c8243d5d9a8815fae919789f6f1efbb2f00fc764ef7bb791',
    production: 'statistics-adults-65-plus-1024.png',
    sha256: '08ce90e0b666ea45a8836ae15c56c351c3e460b53f7898377c6485bc592e389f',
  },
  'weakened-immune-systems': {
    source: 'statistics-weakened-immune-systems-source-1254.png',
    sourceSha256: '0792bc8621b682692e61f8f6ad2c7c8617467e3202d646e38351da9c3b8817e8',
    production: 'statistics-weakened-immune-systems-1024.png',
    sha256: '85be2c78ddaa2a082f412520d5193c56d7c0ed609423a5199b60fa51b1dee325',
  },
  // The Problem Scale pictograph (2026-09-29): the authored one-in-six
  // composition, not a risk group — the mapping below still covers exactly
  // the four group ids, and this file feeds `SCALE_PICTOGRAPH` alone.
  'one-in-six-figures': {
    source: 'statistics-one-in-six-figures-source-1254.png',
    sourceSha256: 'e6280fcf99a51d739d2076c4226627756317f983d925eb52956b37694432011f',
    production: 'statistics-one-in-six-figures-1024.png',
    sha256: 'e0fad461ec8cdd1c89096bb66da041b9f010f8f321239add15b0476f6604dc66',
  },
};

/**
 * The pictograph's six between-the-legs gaps are INTENDED translucent
 * artwork — each figure's soft shadow shows through — sealed off from the
 * border when the repair lifts the 240–254 shadow to opaque. Exactly this
 * many pixels, every one still translucent; any other file has none.
 */
const PICTOGRAPH_INTENDED_ENCLOSED = 4213;

const REVIEW_ARTIFACTS = [
  'lotly-onboarding-statistics-target.png',
  'lotly-onboarding-problem-scale-target.png',
  'lotly-onboarding-problem-risk-target.png',
  // The approved risk-row target (2026-09-29), superseding the 2×2 one above.
  'lotly-onboarding-problem-risk-rows-target.png',
  'statistics-household-illustrations-contact-sheet.png',
  'statistics-production-contact-sheet.png',
  'statistics-production-asset-report.json',
] as const;

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

interface DecodedPng {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
  /** Every chunk type, in file order. */
  chunks: string[];
  /** Full RGBA bytes, row-major. */
  rgba: Uint8Array;
}

/** A minimal PNG reader for 8-bit RGBA, non-interlaced (the mascot tests'). */
function decodeRgba(path: string): DecodedPng {
  const bytes = readFileSync(path);
  assert.ok(
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    `${path} is not a PNG`,
  );
  const idat: Buffer[] = [];
  const chunks: string[] = [];
  let header: Omit<DecodedPng, 'rgba' | 'chunks'> | null = null;
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
    if (type === 'IDAT') idat.push(Buffer.from(data));
    if (type === 'IEND') sawEnd = offset + 12 + length === bytes.length;
    offset += 12 + length;
  }
  assert.ok(header, `${path} has no IHDR`);
  assert.ok(sawEnd, `${path} does not end cleanly at IEND`);
  const { width, height } = header;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rgba = new Uint8Array(width * height * 4);
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
  return { ...header, chunks, rgba };
}

const DECODED = Object.fromEntries(
  Object.entries(APPROVED).map(([id, entry]) => [
    id,
    decodeRgba(join(PRODUCTION, entry.production)),
  ]),
);

/** Strips comments, so a documented path never reads as an import. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

/** Loads the asset module the way Metro would see it (the allergen test's hook). */
function loadIllustrations(): {
  map: Readonly<Record<string, unknown>>;
  pictograph: unknown;
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
    const loaded = require(MODULE) as typeof import('./statistics-assets');
    return { map: loaded.STATISTIC_ILLUSTRATIONS, pictograph: loaded.SCALE_PICTOGRAPH, requested };
  } finally {
    if (prior === undefined) delete extensions['.png'];
    else extensions['.png'] = prior;
  }
}

test('the five approved sources exist and are byte-identical to their approved hashes', () => {
  for (const [id, entry] of Object.entries(APPROVED)) {
    const path = join(SOURCES, entry.source);
    assert.ok(existsSync(path), `${id}: ${entry.source} is missing`);
    assert.equal(sha256(path), entry.sourceSha256, `${id}: the approved source changed`);
  }
});

test('the five production files exist and are byte-identical to their installed hashes', () => {
  for (const [id, entry] of Object.entries(APPROVED)) {
    const path = join(PRODUCTION, entry.production);
    assert.ok(existsSync(path), `${id}: ${entry.production} is missing`);
    assert.equal(sha256(path), entry.sha256, `${id}: the production file changed`);
  }
  // Exactly these four statistics files, no strays.
  const present = readdirSync(PRODUCTION)
    .filter((name) => /^statistics-.+\.png$/.test(name))
    .sort();
  assert.deepEqual(
    present,
    Object.values(APPROVED)
      .map((entry) => entry.production)
      .sort(),
  );
});

test('every production file is a 1024×1024 8-bit RGBA PNG with exactly the repaired chunk order', () => {
  for (const [id, png] of Object.entries(DECODED)) {
    assert.equal(png.width, 1024, `${id} width`);
    assert.equal(png.height, 1024, `${id} height`);
    assert.equal(png.bitDepth, 8, `${id} bit depth`);
    assert.equal(png.colorType, 6, `${id} is not RGBA`);
    assert.equal(png.interlace, 0, `${id} is interlaced`);
    // Explicit sRGB with its standard gAMA and cHRM; no ICC profile, no
    // background hint, no timestamp, no export metadata (the sources' caBX).
    assert.deepEqual(png.chunks, ['IHDR', 'sRGB', 'gAMA', 'cHRM', 'IDAT', 'IEND'], `${id} chunks`);
  }
});

test('every production file honours the alpha contract: clean transparency, no ceiling, no hidden colour', () => {
  for (const [id, png] of Object.entries(DECODED)) {
    const { rgba, width, height } = png;
    const alphaAt = (i: number) => rgba[i * 4 + 3];
    const corners = [0, width - 1, (height - 1) * width, height * width - 1].map(alphaAt);
    assert.deepEqual(corners, [0, 0, 0, 0], `${id} corners are not transparent`);
    let clear = 0;
    let opaque = 0;
    let ceiling = 0;
    let hidden = 0;
    for (let i = 0; i < width * height; i++) {
      const a = rgba[i * 4 + 3];
      if (a === 0) {
        clear++;
        if (rgba[i * 4] !== 0 || rgba[i * 4 + 1] !== 0 || rgba[i * 4 + 2] !== 0) hidden++;
      } else if (a === 255) opaque++;
      else if (a >= 240) ceiling++;
    }
    const total = width * height;
    assert.ok(clear / total > 0.4, `${id}: only ${clear} fully transparent pixels`);
    // The pictograph's six spaced figures cover less canvas than a portrait.
    const opaqueFloor = id === 'one-in-six-figures' ? 250_000 : 400_000;
    assert.ok(opaque > opaqueFloor, `${id}: only ${opaque} fully opaque pixels`);
    assert.equal(ceiling, 0, `${id}: ${ceiling} pixels still sit at alpha 240–254`);
    assert.equal(hidden, 0, `${id}: ${hidden} transparent pixels hide colour`);
  }
});

test('no production file has an unintended enclosed hole; the pictograph keeps exactly its six authored gaps', () => {
  for (const [id, png] of Object.entries(DECODED)) {
    const { rgba, width, height } = png;
    const reached = new Uint8Array(width * height);
    const queue: number[] = [];
    const visit = (i: number) => {
      if (!reached[i] && rgba[i * 4 + 3] < 255) {
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
    let enclosedOpaqueish = 0;
    for (let i = 0; i < width * height; i++) {
      if (rgba[i * 4 + 3] < 255 && !reached[i]) {
        holes++;
        if (rgba[i * 4 + 3] >= 240) enclosedOpaqueish++;
      }
    }
    // The pictograph's between-the-legs gaps are authored translucency
    // (the report's "intended enclosed translucency"): exactly this many
    // pixels, all still translucent. Every other file has none.
    const intended = id === 'one-in-six-figures' ? PICTOGRAPH_INTENDED_ENCLOSED : 0;
    assert.equal(holes, intended, `${id} has ${holes} enclosed non-opaque pixels`);
    assert.equal(enclosedOpaqueish, 0, `${id}: an enclosed pixel reached the alpha ceiling`);
  }
});

test('the production report describes the repository’s bytes, and the row trims its artwork', () => {
  const report = JSON.parse(
    readFileSync(join(REFERENCE, 'statistics-production-asset-report.json'), 'utf8'),
  ) as {
    description: string;
    files: {
      file: string;
      path: string;
      sha256: string;
      bytes: number;
      dimensions: [number, number];
      alphaCounts: Record<string, number>;
      solidArtworkBounds: { left: number; top: number; right: number; bottom: number };
      enclosedHolePixels: number;
      source: { file: string; sha256: string; bytes: number; dimensions: [number, number] };
    }[];
  };
  assert.match(report.description, /final, repaired production/);
  assert.deepEqual(
    report.files.map((entry) => entry.file).sort(),
    Object.values(APPROVED)
      .map((entry) => entry.production)
      .sort(),
  );
  let lowestSolidBottom = 0;
  let highestSolidTop = 1024;
  for (const entry of report.files) {
    const path = join(ROOT, entry.path);
    const bytes = readFileSync(path);
    assert.equal(bytes.length, entry.bytes, `${entry.file}: reported size`);
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      entry.sha256,
      `${entry.file}: reported hash`,
    );
    assert.deepEqual(entry.dimensions, [1024, 1024]);
    // The reported alpha census and solid bounds match a fresh decode.
    const id = Object.keys(APPROVED).find((key) => APPROVED[key].production === entry.file)!;
    const { rgba, width, height } = DECODED[id];
    let clear = 0;
    let edge = 0;
    let opaque = 0;
    const solid = { left: width, top: height, right: -1, bottom: -1 };
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const a = rgba[(y * width + x) * 4 + 3];
        if (a === 0) clear++;
        else if (a === 255) opaque++;
        else if (a < 240) edge++;
        if (a >= 128) {
          solid.left = Math.min(solid.left, x);
          solid.top = Math.min(solid.top, y);
          solid.right = Math.max(solid.right, x);
          solid.bottom = Math.max(solid.bottom, y);
        }
      }
    }
    assert.deepEqual(
      entry.alphaCounts,
      { clear, edge1to239: edge, nearOpaque240to254: 0, opaque },
      `${entry.file}: reported alpha counts`,
    );
    assert.deepEqual(entry.solidArtworkBounds, solid, `${entry.file}: reported solid bounds`);
    assert.equal(
      entry.enclosedHolePixels,
      id === 'one-in-six-figures' ? PICTOGRAPH_INTENDED_ENCLOSED : 0,
    );
    // The report names the true source, byte for byte.
    const sourcePath = join(SOURCES, entry.source.file);
    assert.equal(sha256(sourcePath), entry.source.sha256, `${entry.file}: source hash drifted`);
    assert.equal(readFileSync(sourcePath).length, entry.source.bytes);
    assert.deepEqual(entry.source.dimensions, [1254, 1254]);
    // The label seat derives from the four RISK illustrations alone; the
    // pictograph has no label band and its bounds stay out of the seat.
    if ((PROBLEM_RISK_GROUP_IDS as readonly string[]).includes(id)) {
      lowestSolidBottom = Math.max(lowestSolidBottom, solid.bottom);
      highestSolidTop = Math.min(highestSolidTop, solid.top);
    }
  }
  // The Problem Risk rows overlap exactly these transparent bands.
  assert.equal(RISK_ART_BOTTOM, lowestSolidBottom / 1024);
  assert.equal(RISK_ART_TOP, highestSolidTop / 1024);
});

test('the typed mapping is complete, one-to-one, and reaches only the five production files', () => {
  const { map, pictograph, requested } = loadIllustrations();
  assert.deepEqual(Object.keys(map).sort(), [...PROBLEM_RISK_GROUP_IDS].sort());
  const files = [...(Object.values(map) as string[]), pictograph as string];
  assert.equal(new Set(files).size, 5, 'two exports resolve to the same file');
  for (const [id, file] of Object.entries(map) as [string, string][]) {
    assert.equal(
      file,
      join(PRODUCTION, APPROVED[id].production),
      `${id} resolves to the wrong file`,
    );
  }
  assert.equal(pictograph, join(PRODUCTION, APPROVED['one-in-six-figures'].production));
  assert.equal(requested.length, 5, 'the module requires something besides the five images');
  for (const file of requested) {
    assert.ok(file.startsWith(PRODUCTION), `${file} is not a production asset`);
    assert.ok(!file.includes('reference'), `${file} is reference material`);
    assert.ok(!file.includes('source'), `${file} is a source file`);
  }
});

test('the retired glyph placeholders are gone: no raster, no vendored source, no renderer entry', () => {
  // The authored pictograph replaced the figure-person glyph grid
  // (2026-09-29); nothing may quietly bundle the placeholders again.
  for (const suffix of ['', '@2x', '@3x']) {
    const path = join(ROOT, 'assets', 'onboarding', `figure-person${suffix}.png`);
    assert.ok(!existsSync(path), `figure-person${suffix}.png came back`);
  }
  assert.ok(!existsSync(join(ROOT, 'assets', 'icon-sources', 'lucide', 'user-round.svg')));
  const renderer = readFileSync(join(ROOT, 'scripts', 'render-onboarding-assets.mjs'), 'utf8');
  assert.ok(!renderer.includes('figure-person'), 'the renderer still draws the placeholder');
  assert.ok(!renderer.includes('user-round'), 'the renderer still reads the retired source');
});

test('the targets, contact sheets, report and sources are reference material, never runtime', () => {
  for (const artifact of REVIEW_ARTIFACTS) {
    assert.ok(existsSync(join(REFERENCE, artifact)), `${artifact} is missing`);
  }
  const sources: { path: string; code: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes('.test.')) {
        sources.push({ path, code: codeOnly(readFileSync(path, 'utf8')) });
      }
    }
  };
  walk(join(ROOT, 'src'));
  for (const { path, code } of sources) {
    assert.ok(!code.includes('reference/statistics'), `${path} reaches into the reference pack`);
    assert.ok(!code.includes('-source-1254'), `${path} imports a source file`);
    assert.ok(!code.includes('statistics-target'), `${path} imports a target mockup`);
    assert.ok(!code.includes('contact-sheet'), `${path} imports a contact sheet`);
    assert.ok(!code.includes('asset-report'), `${path} imports an asset report`);
  }
  // The production illustrations are required by the mapping module alone.
  const importers = sources.filter(({ code }) => code.includes('brand/production/statistics-'));
  assert.deepEqual(
    importers.map(({ path }) => path),
    [MODULE],
    'a production illustration is required outside the mapping',
  );
});
