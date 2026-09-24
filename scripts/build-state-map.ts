/**
 * Builds the onboarding States map's geometry module
 * (`src/lib/state-map-geometry.ts`) from the vendored Census-derived
 * boundaries in `assets/geography-sources/us-atlas/`. Offline and
 * deterministic: every input is in the repository, and re-running it
 * rewrites a byte-identical file (after Prettier).
 *
 * ## Source
 *
 * us-atlas 3.0.1 (ISC, © Michael Bostock; npm tarball sha1
 * 367d64e4b31d3f945827710f1a43813c38e17d6b, git d6968f52f5418bc71afc64e034cbfdba8d898de4),
 * a TopoJSON redistribution of the US Census Bureau's 2017 cartographic
 * boundary files (cb_2017_us_state_*, public domain):
 *
 * - `states-albers-10m.json` — the 50 states and the District of Columbia,
 *   already projected with d3.geoAlbersUsa (scale 1300, translate
 *   [487.5, 305]), which places Alaska (at 0.35 scale) and Hawaii (at full
 *   scale) as insets. Used as published.
 * - `states-10m.json` — the same boundaries unprojected. Used for Puerto
 *   Rico ONLY, because geoAlbersUsa has no Puerto Rico inset. It is projected
 *   here with the conic equal-area parameters d3-composite-projections uses
 *   for its Puerto Rico inset (rotate [66, 0], centre [0, 18], parallels
 *   [8, 18]) at the same scale, 1300.
 *
 * Nothing is traced, drawn or approximated. Coordinates are rounded to 0.1
 * of a projected unit (about 0.04pt on a phone-width map) and repeated
 * points after rounding are dropped; no other simplification is applied.
 *
 * Usage: npx tsx scripts/build-state-map.ts && npx prettier --write src/lib/state-map-geometry.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { POSTAL_TO_STATE, STATE_TO_POSTAL } from '../src/domain/us-geography';

const ROOT = join(__dirname, '..');
const SOURCES = join(ROOT, 'assets', 'geography-sources', 'us-atlas');
const OUTPUT = join(ROOT, 'src', 'lib', 'state-map-geometry.ts');

type Point = [number, number];
type Ring = Point[];
type Polygon = Ring[];

interface Topology {
  transform: { scale: [number, number]; translate: [number, number] };
  arcs: number[][][];
  objects: {
    states: {
      geometries: {
        id: string;
        type: 'Polygon' | 'MultiPolygon';
        properties: { name: string };
        arcs: number[][] | number[][][];
      }[];
    };
  };
}

// ── TopoJSON decoding (the specification's delta-encoded, quantized arcs) ───

function decodeArcs(topology: Topology): Point[][] {
  const [sx, sy] = topology.transform.scale;
  const [tx, ty] = topology.transform.translate;
  return topology.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * sx + tx, y * sy + ty] as Point;
    });
  });
}

function ringFromArcs(indexes: number[], arcs: Point[][]): Ring {
  const ring: Ring = [];
  for (const index of indexes) {
    const arc = index < 0 ? [...arcs[~index]].reverse() : arcs[index];
    // Consecutive arcs share their joining point; keep it once.
    arc.forEach((point, i) => {
      if (i > 0 || ring.length === 0) ring.push(point);
    });
  }
  return ring;
}

function polygonsOf(
  geometry: Topology['objects']['states']['geometries'][number],
  arcs: Point[][],
): Polygon[] {
  const polygons = (geometry.type === 'Polygon' ? [geometry.arcs] : geometry.arcs) as number[][][];
  return polygons.map((rings) => rings.map((indexes) => ringFromArcs(indexes, arcs)));
}

// ── Puerto Rico's inset projection (conic equal-area, as d3 computes it) ────

const RAD = Math.PI / 180;
const SCALE = 1300;

function conicEqualArea(parallels: [number, number], rotate: number, centre: number) {
  const sy0 = Math.sin(parallels[0] * RAD);
  const n = (sy0 + Math.sin(parallels[1] * RAD)) / 2;
  const c = 1 + sy0 * (2 * n - sy0);
  const r0 = Math.sqrt(c) / n;
  const raw = (lambda: number, phi: number): Point => {
    const r = Math.sqrt(c - 2 * n * Math.sin(phi)) / n;
    return [r * Math.sin(lambda * n), r0 - r * Math.cos(lambda * n)];
  };
  const [cx, cy] = raw(0, centre * RAD);
  return ([lon, lat]: Point): Point => {
    const [x, y] = raw((lon + rotate) * RAD, lat * RAD);
    // Screen space: y grows downward, as geoAlbersUsa's output does.
    return [(x - cx) * SCALE, -(y - cy) * SCALE];
  };
}

const projectPuertoRico = conicEqualArea([8, 18], 66, 18);

// ── Geometry helpers ────────────────────────────────────────────────────────

/** Rounded to tenths, as integers, so relative steps are exact. */
function tenths(point: Point): Point {
  return [Math.round(point[0] * 10), Math.round(point[1] * 10)];
}

function roundRing(ring: Ring): Ring {
  const out: Ring = [];
  for (const point of ring.map(tenths)) {
    const last = out[out.length - 1];
    if (last && last[0] === point[0] && last[1] === point[1]) continue;
    out.push(point);
  }
  // The closing point repeats the first; `z` closes the ring instead.
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first[0] === last[0] && first[1] === last[1]) out.pop();
  return out;
}

/**
 * Rounds every ring; an islet whose outline collapses below a triangle at
 * that precision is dropped (with its holes), as is a hole that collapses.
 */
function roundPolygons(polygons: Polygon[]): Polygon[] {
  return polygons
    .map((polygon) => polygon.map(roundRing))
    .filter((polygon) => polygon[0].length >= 3)
    .map((polygon) => polygon.filter((ring) => ring.length >= 3));
}

function ringArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(sum) / 2;
}

function bboxOf(points: Point[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

function inside(point: Point, polygon: Polygon): boolean {
  let hit = false;
  for (const ring of polygon) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > point[1] !== yj > point[1]) {
        const x = ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi;
        if (point[0] < x) hit = !hit;
      }
    }
  }
  return hit;
}

function edgeDistance(point: Point, polygon: Polygon): number {
  let best = Infinity;
  for (const ring of polygon) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j];
      const [bx, by] = ring[i];
      const dx = bx - ax;
      const dy = by - ay;
      const length = dx * dx + dy * dy;
      const t =
        length === 0
          ? 0
          : Math.max(0, Math.min(1, ((point[0] - ax) * dx + (point[1] - ay) * dy) / length));
      best = Math.min(best, Math.hypot(point[0] - (ax + t * dx), point[1] - (ay + t * dy)));
    }
  }
  return best;
}

/**
 * The pole of inaccessibility of the state's largest polygon — the interior
 * point farthest from any edge, where the selection mark sits — found by a
 * grid search and then refined around the best cell (polylabel's idea,
 * without the priority queue). Returns the point and its clearance.
 */
function labelPoint(polygon: Polygon): { point: Point; radius: number } {
  const [x0, y0, x1, y1] = bboxOf(polygon[0]);
  let best: Point = [(x0 + x1) / 2, (y0 + y1) / 2];
  let bestDistance = inside(best, polygon) ? edgeDistance(best, polygon) : -1;
  let step = Math.max(x1 - x0, y1 - y0) / 48;
  let cx = (x0 + x1) / 2;
  let cy = (y0 + y1) / 2;
  let half = Math.max(x1 - x0, y1 - y0) / 2;
  for (let pass = 0; pass < 5; pass += 1) {
    for (let x = cx - half; x <= cx + half; x += step) {
      for (let y = cy - half; y <= cy + half; y += step) {
        const candidate: Point = [x, y];
        if (!inside(candidate, polygon)) continue;
        const distance = edgeDistance(candidate, polygon);
        if (distance > bestDistance) {
          bestDistance = distance;
          best = candidate;
        }
      }
    }
    [cx, cy] = best;
    half = step * 2;
    step /= 8;
  }
  return { point: best, radius: bestDistance };
}

function pathOf(polygons: Polygon[]): string {
  const parts: string[] = [];
  for (const polygon of polygons) {
    for (const ring of polygon) {
      const [start, ...rest] = ring;
      let [px, py] = start;
      let d = `M${start[0] / 10} ${start[1] / 10}l`;
      const steps: string[] = [];
      for (const [x, y] of rest) {
        steps.push(`${(x - px) / 10} ${(y - py) / 10}`);
        px = x;
        py = y;
      }
      d += steps.join(' ') + 'z';
      parts.push(d);
    }
  }
  return parts.join('');
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

// ── Build ───────────────────────────────────────────────────────────────────

type Region = 'contiguous' | 'alaska' | 'hawaii' | 'puerto-rico';

interface Shape {
  code: string;
  region: Region;
  polygons: Polygon[]; // in tenths
}

const albers = JSON.parse(
  readFileSync(join(SOURCES, 'states-albers-10m.json'), 'utf8'),
) as Topology;
const unprojected = JSON.parse(readFileSync(join(SOURCES, 'states-10m.json'), 'utf8')) as Topology;

const shapes: Shape[] = [];
const albersArcs = decodeArcs(albers);
for (const geometry of albers.objects.states.geometries) {
  const code = STATE_TO_POSTAL[geometry.properties.name];
  if (!code) throw new Error(`No postal code for ${geometry.properties.name}`);
  const region: Region = code === 'AK' ? 'alaska' : code === 'HI' ? 'hawaii' : 'contiguous';
  shapes.push({ code, region, polygons: roundPolygons(polygonsOf(geometry, albersArcs)) });
}
const lonLatArcs = decodeArcs(unprojected);
const puertoRico = unprojected.objects.states.geometries.find(
  (geometry) => geometry.properties.name === 'Puerto Rico',
);
if (!puertoRico) throw new Error('Puerto Rico is missing from states-10m.json');
shapes.push({
  code: 'PR',
  region: 'puerto-rico',
  polygons: roundPolygons(
    polygonsOf(puertoRico, lonLatArcs).map((polygon) =>
      polygon.map((ring) => ring.map(projectPuertoRico)),
    ),
  ),
});

shapes.sort((a, b) => POSTAL_TO_STATE[a.code].localeCompare(POSTAL_TO_STATE[b.code]));

const NORTHEAST = ['CT', 'DC', 'DE', 'MA', 'MD', 'ME', 'NH', 'NJ', 'NY', 'PA', 'RI', 'VT'];

function viewOf(codes: (shape: Shape) => boolean, padding: number) {
  const points = shapes.filter(codes).flatMap((shape) => shape.polygons.flat(2));
  const [x0, y0, x1, y1] = bboxOf(points).map((v) => v / 10);
  return {
    x: round1(x0 - padding),
    y: round1(y0 - padding),
    width: round1(x1 - x0 + padding * 2),
    height: round1(y1 - y0 + padding * 2),
  };
}

const views = {
  contiguous: viewOf((shape) => shape.region === 'contiguous', 4),
  northeast: viewOf((shape) => NORTHEAST.includes(shape.code) && shape.code !== 'PA', 6),
};
const insets = {
  alaska: viewOf((shape) => shape.region === 'alaska', 6),
  hawaii: viewOf((shape) => shape.region === 'hawaii', 6),
  'puerto-rico': viewOf((shape) => shape.region === 'puerto-rico', 6),
};

const entries = shapes.map((shape) => {
  const largest = [...shape.polygons].sort((a, b) => ringArea(b[0]) - ringArea(a[0]))[0];
  const { point, radius } = labelPoint(largest);
  const bbox = bboxOf(shape.polygons.flat(2)).map((v) => round1(v / 10));
  return [
    `  {`,
    `    code: '${shape.code}',`,
    `    region: '${shape.region}',`,
    `    bbox: [${bbox.join(', ')}],`,
    `    label: [${round1(point[0] / 10)}, ${round1(point[1] / 10)}],`,
    `    clearance: ${round1(radius / 10)},`,
    `    d: '${pathOf(shape.polygons)}',`,
    `  },`,
  ].join('\n');
});

const view = (v: { x: number; y: number; width: number; height: number }) =>
  `{ x: ${v.x}, y: ${v.y}, width: ${v.width}, height: ${v.height} }`;

const source = `/**
 * GENERATED by scripts/build-state-map.ts — do not edit by hand.
 *
 * The onboarding States map's geometry: every jurisdiction in the shared
 * vocabulary (50 states, the District of Columbia and Puerto Rico), as SVG
 * path data in projected units, from the US Census Bureau's 2017
 * cartographic boundary files via us-atlas 3.0.1 (ISC). The source, the
 * projection and the licence are recorded in the generator and in
 * docs/recall-onboarding-and-paywall.md; the vendored inputs are in
 * assets/geography-sources/us-atlas/. Local data only: nothing here is ever
 * fetched.
 *
 * A leaf module: no imports, so the app and Node tests read the same bytes.
 */

/** Where a shape is drawn: the contiguous map, or its own inset box. */
export type StateMapRegion = 'contiguous' | 'alaska' | 'hawaii' | 'puerto-rico';

export interface StateMapShape {
  /** The postal code, as the preference vocabulary stores it. */
  code: string;
  region: StateMapRegion;
  /** [minX, minY, maxX, maxY] in projected units. */
  bbox: readonly [number, number, number, number];
  /** The interior point farthest from every edge: where the check mark sits. */
  label: readonly [number, number];
  /** How far that point is from the nearest edge, in projected units. */
  clearance: number;
  /** Absolute move, relative lines, closed rings. */
  d: string;
}

export interface StateMapViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** In the canonical order, by full name. */
export const STATE_MAP_SHAPES: readonly StateMapShape[] = [
${entries.join('\n')}
];

/** The two views of the contiguous map: the whole country, and the Northeast enlarged. */
export const STATE_MAP_VIEWS = {
  contiguous: ${view(views.contiguous)},
  northeast: ${view(views.northeast)},
} as const satisfies Record<string, StateMapViewBox>;

/** Each inset's own frame. */
export const STATE_MAP_INSET_VIEWS = {
  alaska: ${view(insets.alaska)},
  hawaii: ${view(insets.hawaii)},
  'puerto-rico': ${view(insets['puerto-rico'])},
} as const satisfies Record<Exclude<StateMapRegion, 'contiguous'>, StateMapViewBox>;
`;

writeFileSync(OUTPUT, source);
console.log(`Wrote ${shapes.length} shapes, ${(source.length / 1024).toFixed(1)} KB, to ${OUTPUT}`);
console.log(JSON.stringify({ views, insets }, null, 1));
