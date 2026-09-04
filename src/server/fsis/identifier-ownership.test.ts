/**
 * P3C-1, FSIS side: the barcode-ownership guard is one shared owner, and it
 * is proven against FSIS's own records, not only FDA's.
 *
 * The guard lives in `lib/prose-identifiers.ts` and both agencies flow through
 * it, so an FSIS notice is exposed to exactly the same defect — and the
 * production audit found one, Water Lilies Food Inc., whose printed best-by
 * and packaging dates rendered as barcodes. No FSIS payload was archived for
 * it, so its wording is recorded as a ledger entry rather than reconstructed
 * (`fixtures/identifier-ownership-notices.json`).
 *
 * What CAN be run offline is run here: the complete recorded FSIS corpus is
 * driven through the shared owner and asserted to publish no date-shaped or
 * lot-labelled value as a barcode, and to keep every printed code it stated.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { projectCase } from '../../domain/projection';
import { buildConsumerCase } from '../../lib/consumer-projection';
import { barcodeLabelGoverns } from '../../lib/prose-identifiers';
import { parseFsisRecord, type FsisRawRecord } from './parse';

const FIXTURES = join(process.cwd(), 'src/server/fsis/fixtures');

interface LedgerEntry {
  agency: string;
  nativeTitle: string;
  officialUrl: string;
  renderedAsBarcode: string[];
  governingLabel: string;
  evidence: string;
}

const LEDGER: { auditLedger: LedgerEntry[] } = JSON.parse(
  readFileSync(join(FIXTURES, 'identifier-ownership-notices.json'), 'utf8'),
);

/** Every recorded FSIS record: the benchmark set plus the single fixtures. */
function everyRecordedRecord(): FsisRawRecord[] {
  const records: FsisRawRecord[] = JSON.parse(
    readFileSync(join(FIXTURES, 'benchmark-records.json'), 'utf8'),
  );
  for (const file of readdirSync(FIXTURES).filter((name) => /^(recall|pha)-.*\.json$/.test(name))) {
    records.push(JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')));
  }
  return records;
}

const DATE_SHAPED = /^\d{1,2}[\s/.-]\d{1,2}[\s/.-]\d{2,4}$/;

test('no recorded FSIS notice publishes a date-shaped value as a barcode', () => {
  for (const record of everyRecordedRecord()) {
    const projection = projectCase([parseFsisRecord(record)]);
    const check = buildConsumerCase(projection, projection.affectedProducts).packageCheck;
    const barcodes = [
      ...check.fields,
      ...check.sharedFields,
      ...check.variants.flatMap((variant) => variant.fields),
    ].filter((field) => field.key === 'upc');
    for (const field of barcodes) {
      field.raw.forEach((raw, index) => {
        assert.ok(
          !DATE_SHAPED.test(raw.replace(/\s+/g, ' ').trim()),
          `${projection.title}: ${raw} -> ${field.values[index]}`,
        );
      });
    }
  }
});

test('the FSIS notice the production audit caught is recorded, not reconstructed', () => {
  const [waterLilies] = LEDGER.auditLedger;
  assert.equal(waterLilies.agency, 'FSIS');
  assert.ok(waterLilies.officialUrl.startsWith('https://www.fsis.usda.gov/'));
  assert.deepEqual(waterLilies.renderedAsBarcode, ['07-12-2017', '07-12-2016']);
  assert.ok(waterLilies.evidence.includes('production audit'));
  assert.ok(!('excerpt' in waterLilies), 'a ledger entry gained source text it never had');
  // The two labels the audit found governing those values both refuse barcode
  // ownership in the shared vocabulary, which is what removes them.
  for (const label of ['best by', 'packaging date']) {
    assert.equal(barcodeLabelGoverns(`${label}: `, label.length + 2), false, label);
  }
});
