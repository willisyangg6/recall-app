import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { HAZARD_GUIDES } from '@/content/hazard-guides';

import { SYMPTOM_ICONS, symptomIcon } from './symptom-icons';

const ROOT = join(__dirname, '..', '..');
const SOURCES = join(ROOT, 'assets', 'icon-sources', 'symptoms');

interface ApprovedGlyph {
  slug: string;
  label: string;
  file: string;
  sha256: string;
}
interface RenderedGlyph {
  label: string;
  slug: string;
  files: { path: string; px: number; sha256: string }[];
}

const approved = JSON.parse(readFileSync(join(SOURCES, 'mapping.json'), 'utf8')) as ApprovedGlyph[];
const rendered = JSON.parse(
  readFileSync(join(SOURCES, 'render-report.json'), 'utf8'),
) as RenderedGlyph[];
const reviewed = new Set(HAZARD_GUIDES.flatMap((guide) => guide.symptoms ?? []));

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

test('every reviewed symptom has a deliberate glyph, and no mapping is stale', () => {
  // A new or reworded symptom still renders (with `circle`), but must be
  // mapped on purpose before this passes.
  for (const symptom of reviewed) {
    assert.ok(symptom in SYMPTOM_ICONS, `unmapped symptom: ${symptom}`);
  }
  // Every key is a string some reviewed guide actually states.
  for (const key of Object.keys(SYMPTOM_ICONS)) {
    assert.ok(reviewed.has(key), `mapping for a symptom no guide states: ${key}`);
  }
  assert.equal(symptomIcon('A symptom no guide states'), 'circle');
});

test('each reviewed string shows the approved glyph made for that exact string', () => {
  // The approval names the same 34 strings the guides state, byte for byte.
  assert.deepEqual(new Set(approved.map((glyph) => glyph.label)), reviewed);
  assert.equal(approved.length, reviewed.size);
  for (const glyph of approved) {
    assert.equal(SYMPTOM_ICONS[glyph.label], `symptom-${glyph.slug}`, glyph.label);
  }
  // One glyph per string: no two strings share one today.
  const glyphs = Object.values(SYMPTOM_ICONS);
  assert.equal(new Set(glyphs).size, glyphs.length);
});

test('the masters are the approved bytes, and each scale is rendered from its master', () => {
  for (const glyph of approved) {
    const master = readFileSync(join(SOURCES, glyph.file));
    assert.equal(sha256(master), glyph.sha256, `${glyph.file} is not the approved master`);
  }
  assert.deepEqual(
    readdirSync(join(SOURCES, 'originals')).sort(),
    approved.map((glyph) => glyph.file.replace('originals/', '')).sort(),
  );
  assert.deepEqual(
    rendered.map((glyph) => glyph.slug).sort(),
    approved.map((glyph) => glyph.slug).sort(),
  );
  for (const glyph of rendered) {
    assert.deepEqual(
      glyph.files.map((file) => file.path),
      ['', '@2x', '@3x'].map((suffix) => `assets/icons/symptom-${glyph.slug}${suffix}.png`),
    );
    for (const file of glyph.files) {
      const bytes = readFileSync(join(ROOT, file.path));
      // The installed bytes are the ones render.py wrote: 8-bit RGBA on the
      // 24-unit box at this scale.
      assert.equal(sha256(bytes), file.sha256, `${file.path} differs from the render`);
      assert.equal(bytes.readUInt32BE(16), file.px, `${file.path} width`);
      assert.equal(bytes.readUInt32BE(20), file.px, `${file.path} height`);
      assert.equal(bytes[24], 8, `${file.path} bit depth`);
      assert.equal(bytes[25], 6, `${file.path} is not RGBA`);
    }
  }
});

test('the symptom glyphs belong to Health Risk alone', () => {
  // Only the mapping names a symptom glyph (the registry in icon.tsx aside),
  // and only Recall Detail's symptom rows ask the mapping for one.
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
      const source = readFileSync(path, 'utf8');
      const mapping = path.endsWith(join('lib', 'symptom-icons.ts'));
      const registry = path.endsWith(join('ui', 'icon.tsx'));
      if (!mapping && !registry && /['"]symptom-[a-z-]+['"]/.test(source)) offenders.push(path);
      if (!mapping && source.includes('symptomIcon(')) {
        if (!path.endsWith(join('app', 'recall', '[id].tsx'))) offenders.push(path);
      }
    }
  };
  walk(join(ROOT, 'src'));
  assert.deepEqual(offenders, []);
});
