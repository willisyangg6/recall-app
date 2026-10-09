/**
 * The historical baseline (content/historical/README.md) is frozen real data
 * for tests and development tooling only. These tests pin both promises: it is
 * the 2026-10-04 baseline exactly as committed, and nothing that ships can
 * reach it.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

import { BASELINE_RECORDED_AT } from './baseline-recalls';
import {
  HISTORICAL_BASELINE_RECALLS,
  HISTORICAL_BASELINE_RECORDED_AT,
} from './historical-baseline';

const ROOT = process.cwd();
const FIXTURE = 'src/content/historical/baseline-recalls-2026-10-04.json';

/** Git's blob id for a file's bytes: `git hash-object` without Git. */
function gitBlobId(bytes: Buffer): string {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

test('the historical baseline is the 2026-10-04 baseline, byte for byte as committed', () => {
  // `git rev-parse 1cde325:src/content/baseline-recalls.json`
  assert.equal(
    gitBlobId(readFileSync(join(ROOT, FIXTURE))),
    'e2f1a1136e25a2a4ca6f351cdf83612a5eb0f87a',
  );
  assert.equal(HISTORICAL_BASELINE_RECORDED_AT, '2026-10-04T04:13:16.437Z');
  assert.equal(HISTORICAL_BASELINE_RECALLS.length, 64);
  // Recorded before open evidence: every record reads as carrying none.
  assert.ok(HISTORICAL_BASELINE_RECALLS.every((item) => item.fdaOngoingAsOf === null));
});

test('the historical baseline is never the shipped one', () => {
  assert.notEqual(BASELINE_RECORDED_AT, HISTORICAL_BASELINE_RECORDED_AT);
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|mjs)$/.test(name) ? [path] : [];
  });
}

test('only tests and development-only tooling import the historical baseline', () => {
  const allowed = (file: string) =>
    /\.test\.ts$/.test(file) ||
    file.startsWith('src/components/development/') ||
    file === 'src/lib/historical-baseline.ts';
  const offenders = [...sourceFiles(join(ROOT, 'src')), ...sourceFiles(join(ROOT, 'scripts'))]
    .map((path) => relative(ROOT, path))
    .filter((file) => !allowed(file))
    .filter((file) =>
      /(from|require\()\s*['"][^'"]*(historical-baseline|content\/historical\/)/.test(
        readFileSync(file, 'utf8'),
      ),
    );
  assert.deepEqual(offenders, []);
});
