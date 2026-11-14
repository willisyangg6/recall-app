/**
 * Offline loaders for the recorded Costco fixtures (fixtures/costco/README.md).
 * Test-only: nothing in the shipped job imports this file.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseCostcoIndex } from '../costco-index';
import type { CostcoSource } from '../costco-monitor';
import { extractPdfText, isPdf } from '../pdf-text';
import { toAgencyCaseView } from '../store';
import type { AgencyCaseView } from '../types';

export const FIXTURE_DIR = join(__dirname, 'costco');
export const FIXTURE_INDEX_FETCHED_AT = '2026-11-13T20:51:00.000Z';

export const FIXTURE_IDS = {
  whippedCream: 'bltdc8f3dbbb7e4b836',
  tractorWheels: 'blte87d0e2282b82829',
  ladders: 'blt810b89e5a5fbde2c',
  punahele: 'blt875c3b1355914d97',
  meatloaf: 'blta2c263db1a92d045',
  motorCity: 'bltbba5a2373d42728b',
  yakitori: 'bltba5856b6ad6c4ba2',
  shoyuRamen: 'blt5adda22184ac0478',
  madeleines: 'blt7638368fd294fc99',
  caesar: 'blt9c542d42e8aaf313',
  turkishDelight: 'bltf675aef08056871e',
  desertWillow: 'blt2e18b236cc83708b',
} as const;

export function fixtureIndexHtml(): string {
  return readFileSync(join(FIXTURE_DIR, 'index.html'), 'utf8');
}

/** The recorded document for an index entry: PDF bytes, or extracted text. */
export function fixtureDocument(nativeId: string): Uint8Array {
  const base = join(FIXTURE_DIR, 'letters', nativeId.replace(':', '_'));
  const path = existsSync(`${base}.pdf`) ? `${base}.pdf` : `${base}.txt`;
  return new Uint8Array(readFileSync(path));
}

/** Real extraction for PDFs; recorded text passes through as already extracted. */
export const fixtureExtract: typeof extractPdfText = async (bytes) =>
  isPdf(bytes)
    ? extractPdfText(bytes)
    : { extraction: 'text', text: new TextDecoder().decode(bytes).trim(), pages: 1 };

export function fixtureAgencyCases(): AgencyCaseView[] {
  const rows = JSON.parse(readFileSync(join(FIXTURE_DIR, 'agency-cases.json'), 'utf8'));
  return rows.map(toAgencyCaseView);
}

/** A source serving the recorded index and letters; `failIds` make their documents fail. */
export function fixtureSource(
  options: { failIds?: string[] } = {},
): CostcoSource & { requests: string[] } {
  const html = fixtureIndexHtml();
  const byUrl = new Map(parseCostcoIndex(html).map((entry) => [entry.documentUrl, entry.nativeId]));
  const requests: string[] = [];
  return {
    requests,
    async fetchIndexHtml() {
      requests.push('index');
      return html;
    },
    async fetchDocument(url: string) {
      const nativeId = byUrl.get(url);
      requests.push(nativeId ?? url);
      if (!nativeId) throw new Error(`no fixture for ${url}`);
      if (options.failIds?.includes(nativeId)) throw new Error('HTTP 503');
      return { bytes: fixtureDocument(nativeId), contentType: 'application/pdf' };
    },
  };
}
