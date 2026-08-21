/**
 * Loader for the recorded real FSIS fixtures (see fixtures/README.md).
 * Test-only helper; npm scripts run from the repo root, so paths are
 * cwd-relative.
 */

import { readFileSync } from 'node:fs';

import type { FsisRawRecord } from './parse';

export function loadFixture(name: string): FsisRawRecord {
  return JSON.parse(readFileSync(`src/server/fsis/fixtures/${name}.json`, 'utf8')) as FsisRawRecord;
}
