#!/usr/bin/env node
/**
 * Renders the onboarding milestone's bundled rasters (P2B7X.1). Offline and
 * deterministic: every input is in the repository, and re-running it
 * rewrites byte-identical files.
 *
 *   1. The nine allergen glyphs — the vendored Lucide SVG sources in
 *      assets/icon-sources/lucide/ (ISC; provenance in src/lib/allergen-icons.ts)
 *      rasterised black-on-transparent onto the icon set's 24pt box at 1x,
 *      2x and 3x, at the set's documented stroke weight (2.4 grid units:
 *      Lucide's 2 at 20pt scaled to 24, DESIGN.md "Iconography").
 *   2. `chevron-left` — the existing `chevron-down` rasters turned a quarter
 *      turn clockwise, the lossless rotation precedent `chevron-right` set.
 *   3. The Welcome / Preview example product illustration — a flat, clearly
 *      illustrative drawing of gummy candy for the ONE static example card.
 *      Not a product photograph, not from any notice, never on a live card.
 *   5. The States step's six interface glyphs (map, list, x, check, zoom-in,
 *      zoom-out) — the same vendored Lucide family, the same box and stroke
 *      (provenance in src/lib/state-map.ts).
 *   4. Two Design Preview logo FIXTURES (a wide and a tall neutral shape,
 *      labelled FIXTURE) that exercise the retailer-logo container's aspect
 *      handling. They are not retailer marks and are keyed to no retailer.
 *
 * Usage: node scripts/render-onboarding-assets.mjs
 */

import { createCanvas, loadImage } from '@napi-rs/canvas';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ICONS = join(ROOT, 'assets', 'icons');
const LUCIDE = join(ROOT, 'assets', 'icon-sources', 'lucide');
const ONBOARDING = join(ROOT, 'assets', 'onboarding');
const PREVIEW = join(ROOT, 'assets', 'design-preview');

/** The three scales the icon primitive resolves, as React Native names them. */
const SCALES = [
  { suffix: '', factor: 1 },
  { suffix: '@2x', factor: 2 },
  { suffix: '@3x', factor: 3 },
];

const ICON_BOX = 24;
/** The set's stroke weight on the 24-unit grid (DESIGN.md, "Iconography"). */
const ICON_STROKE = 2.4;

/** Allergen icon name → vendored Lucide source. Mirrors src/lib/allergen-icons.ts. */
const ALLERGEN_GLYPHS = {
  'allergen-peanut': 'nut',
  'allergen-tree-nut': 'tree-deciduous',
  'allergen-milk': 'milk',
  'allergen-egg': 'egg',
  'allergen-wheat': 'wheat',
  'allergen-soy': 'bean',
  'allergen-sesame': 'sprout',
  'allergen-fish': 'fish',
  'allergen-shellfish': 'shrimp',
};

/** The States step's glyphs (icon name → vendored Lucide source). Mirrors src/lib/state-map.ts. */
const STATES_GLYPHS = {
  map: 'map',
  list: 'list',
  x: 'x',
  check: 'check',
  'zoom-in': 'zoom-in',
  'zoom-out': 'zoom-out',
};

function write(path, canvas) {
  writeFileSync(path, canvas.toBuffer('image/png'));
}

async function renderLucideGlyphs(glyphs) {
  for (const [icon, lucideName] of Object.entries(glyphs)) {
    const svg = readFileSync(join(LUCIDE, `${lucideName}.svg`), 'utf8')
      .replace(/currentColor/g, '#000000')
      .replace(/stroke-width="2"/, `stroke-width="${ICON_STROKE}"`);
    const image = await loadImage(Buffer.from(svg));
    for (const { suffix, factor } of SCALES) {
      const side = ICON_BOX * factor;
      const canvas = createCanvas(side, side);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0, side, side);
      write(join(ICONS, `${icon}${suffix}.png`), canvas);
    }
  }
}

async function renderChevronLeft() {
  for (const { suffix, factor } of SCALES) {
    const source = await loadImage(readFileSync(join(ICONS, `chevron-down${suffix}.png`)));
    const side = ICON_BOX * factor;
    const canvas = createCanvas(side, side);
    const ctx = canvas.getContext('2d');
    ctx.translate(side / 2, side / 2);
    // A quarter turn clockwise: the downward vertex now points left.
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(source, -side / 2, -side / 2, side, side);
    write(join(ICONS, `chevron-left${suffix}.png`), canvas);
  }
}

/** The card's media footprint (layout.cardMediaSize) at 1x. */
const SAMPLE_SIDE = 112;

/** One flat gummy bear, drawn from arcs. `u` is the unit (bear height ≈ 10u). */
function gummyBear(ctx, x, y, u, fill, highlight) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = fill;
  const circle = (cx, cy, r) => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  };
  const ellipse = (cx, cy, rx, ry) => {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  // Ears, head, body, arms, legs.
  circle(-1.6 * u, -3.6 * u, 0.9 * u);
  circle(1.6 * u, -3.6 * u, 0.9 * u);
  circle(0, -2.6 * u, 2.1 * u);
  ellipse(0, 1.4 * u, 2.6 * u, 3.2 * u);
  ellipse(-2.7 * u, 0.4 * u, 0.9 * u, 1.7 * u);
  ellipse(2.7 * u, 0.4 * u, 0.9 * u, 1.7 * u);
  ellipse(-1.4 * u, 4.4 * u, 1.1 * u, 1.4 * u);
  ellipse(1.4 * u, 4.4 * u, 1.1 * u, 1.4 * u);
  // A soft highlight, the one cue that this is candy, not a photo.
  ctx.fillStyle = highlight;
  ellipse(-0.8 * u, -3.1 * u, 0.55 * u, 0.85 * u);
  ctx.restore();
}

function renderSampleIllustration() {
  for (const { suffix, factor } of SCALES) {
    const side = SAMPLE_SIDE * factor;
    const canvas = createCanvas(side, side);
    const ctx = canvas.getContext('2d');
    // A warm, quiet backdrop: the illustration is contained in the card's
    // placeholder-coloured tile, so it carries its own field.
    ctx.fillStyle = '#F7F1E4';
    ctx.fillRect(0, 0, side, side);
    const u = side / 34;
    gummyBear(ctx, side * 0.3, side * 0.5, u, '#E9736B', 'rgba(255,255,255,0.55)');
    gummyBear(ctx, side * 0.68, side * 0.42, u * 0.95, '#F0A35E', 'rgba(255,255,255,0.55)');
    gummyBear(ctx, side * 0.52, side * 0.7, u * 0.9, '#6FA8DC', 'rgba(255,255,255,0.55)');
    write(join(ONBOARDING, `sample-gummy-products${suffix}.png`), canvas);
  }
}

/** A neutral labelled shape at an extreme aspect ratio. Not a mark of anything. */
function renderLogoFixture(name, width, height) {
  for (const { suffix, factor } of SCALES) {
    const w = width * factor;
    const h = height * factor;
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#C0D6EB';
    const r = Math.min(w, h) * 0.25;
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, r);
    ctx.fill();
    ctx.strokeStyle = '#2B4A6C';
    ctx.lineWidth = 2 * factor;
    ctx.beginPath();
    ctx.roundRect(factor, factor, w - 2 * factor, h - 2 * factor, r);
    ctx.stroke();
    ctx.fillStyle = '#2B4A6C';
    ctx.font = `bold ${Math.max(8, Math.min(w, h) * 0.5)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (w >= h) ctx.fillText('FIXTURE', w / 2, h / 2);
    else {
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText('FIXTURE', 0, 0);
      ctx.restore();
    }
    write(join(PREVIEW, `${name}${suffix}.png`), canvas);
  }
}

async function main() {
  mkdirSync(ONBOARDING, { recursive: true });
  mkdirSync(PREVIEW, { recursive: true });
  await renderLucideGlyphs(ALLERGEN_GLYPHS);
  await renderLucideGlyphs(STATES_GLYPHS);
  await renderChevronLeft();
  renderSampleIllustration();
  renderLogoFixture('logo-fixture-wide', 160, 24);
  renderLogoFixture('logo-fixture-tall', 24, 120);
  console.log(
    'Rendered allergen glyphs, the States glyphs, chevron-left, the sample illustration and two logo fixtures.',
  );
}

await main();
