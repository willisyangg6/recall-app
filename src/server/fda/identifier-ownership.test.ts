/**
 * P3C-1: a printed value belongs to the label that published it.
 *
 * The defect these pin is one rule stated the wrong way round. A digit run of
 * eight, twelve, thirteen or fourteen digits inside a sentence that mentions
 * UPC was treated as another barcode — so AquaStar's "Best Before: 10 22 2027"
 * became the barcode `10222027`, and a shopper comparing codes on a bag was
 * given a date to look for. Digit length is not evidence of anything. The
 * label that governs the value is, and the guard now reads that instead.
 *
 * Evidence, in two deliberately distinguished grades
 * (`fixtures/identifier-ownership-notices.json`):
 *
 *  - `excerpts` — bounded verbatim announcement text from archived FDA source
 *    snapshots. These drive the shared extractor end to end. They are NOT
 *    recorded pages and do not extend full-snapshot corpus coverage.
 *  - `auditLedger` — notices the pre-fix production audit measured whose
 *    payload was never archived. Only the values that rendered in the barcode
 *    field and the label the audit found governing each one are recorded; the
 *    source wording is deliberately absent rather than reconstructed, so these
 *    are asserted against the ownership vocabulary, never re-parsed.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import type { CaseProjection } from '../../domain/recall-types';
import {
  aggregateFacts,
  joinFactValues,
  joinValues,
  recallQuantity,
  toPackageFields,
} from '../../lib/consumer-projection';
import { barcodeLabelGoverns, extractProseIdentifiers } from '../../lib/prose-identifiers';
import { detailNarrative, recallQuantitySentence } from '../../lib/recall-presentation';

interface Excerpt {
  key: string;
  nativeTitle: string;
  officialUrl: string;
  provenance: string;
  excerpt: string;
  expect: {
    barcodes: string[];
    rejectedAsBarcode: string[];
    fields: Record<string, string>;
    quantity: { statedInExcerpt: string; narrativeSentence: string };
  };
}

interface LedgerEntry {
  agency: string;
  nativeTitle: string;
  officialUrl: string;
  renderedAsBarcode: string[];
  governingLabel: string;
  evidence: string;
}

const FIXTURE: { excerpts: Excerpt[]; auditLedger: LedgerEntry[] } = JSON.parse(
  readFileSync('src/server/fda/fixtures/identifier-ownership-notices.json', 'utf8'),
);

const digits = (value: string) => value.replace(/\D/g, '');

/** Only `summaryText` is read by the two display-time owners under test. */
function excerptProjection(summaryText: string): CaseProjection {
  return { summaryText, quantityText: null } as unknown as CaseProjection;
}

function rendered(excerpt: string): Map<string, string> {
  const { facts } = extractProseIdentifiers(excerpt);
  const { fields } = toPackageFields(aggregateFacts(facts));
  return new Map(fields.map((field) => [field.key, field.value]));
}

// ── The guard, on the official text that exposed it ─────────────────────────

for (const notice of FIXTURE.excerpts) {
  test(`${notice.key}: only the source's own barcodes reach Barcode (UPC)`, () => {
    // The excerpt has to still state the shape being guarded against.
    assert.ok(notice.excerpt.length > 0 && notice.officialUrl.startsWith('https://'));
    const { facts } = extractProseIdentifiers(notice.excerpt);
    const barcodes = facts.filter((fact) => fact.concept === 'upc').map((fact) => fact.value);
    assert.deepEqual(barcodes, notice.expect.barcodes, notice.nativeTitle);

    // Each value the source published under a DATE label is still extracted —
    // as that date. It is removed from the barcode field, never from the app.
    const dated = facts.filter((fact) => fact.concept === 'best_by').map((fact) => fact.value);
    for (const value of notice.expect.rejectedAsBarcode) {
      assert.ok(dated.includes(value), `${value} lost its date fact`);
      assert.ok(
        !barcodes.some((code) => digits(code) === digits(value)),
        `${value} still renders as a barcode`,
      );
    }
  });

  test(`${notice.key}: the rendered package fields, verbatim`, () => {
    const fields = rendered(notice.excerpt);
    for (const [key, value] of Object.entries(notice.expect.fields)) {
      assert.equal(fields.get(key), value, key);
    }
    // Structured cells separate with commas only — never a final conjunction.
    for (const key of [
      'bestBy',
      'useBy',
      'sellBy',
      'expiration',
      'upc',
      'lotCodes',
      'batchCodes',
    ]) {
      const value = fields.get(key);
      if (value !== undefined) assert.ok(!/\sand\s/.test(value), `${key}: ${value}`);
    }
    // No date-shaped value survives anywhere in the barcode cell.
    const upc = fields.get('upc');
    if (upc !== undefined) {
      for (const code of upc.split(', ')) {
        assert.ok(!/^\d{1,2}[\s/.-]\d{1,2}[\s/.-]\d{2,4}$/.test(code), code);
      }
    }
  });

  test(`${notice.key}: the recall quantity is one sentence of the narrative`, () => {
    const stated = recallQuantity(excerptProjection(notice.excerpt));
    assert.equal(stated, notice.expect.quantity.statedInExcerpt);
    const reason = 'A recall was issued.';
    const narrative = detailNarrative(reason, recallQuantitySentence('FDA', stated, reason));
    assert.equal(narrative, `${reason} ${notice.expect.quantity.narrativeSentence}`);
    // And exactly once: a reason that already states the figure suppresses it,
    // so the paragraph can never say the same number twice.
    const already = `A recall was issued covering ${stated}.`;
    assert.equal(detailNarrative(already, recallQuantitySentence('FDA', stated, already)), already);
  });
}

// ── Structured dates render complete, and once ──────────────────────────────

test('two spellings of one day deduplicate, and every day renders in full', () => {
  // Kroger Mercado states its two best-before days twice: "Best Before
  // 11/19/2027" in the prose and "Best Before 11  19  2027" in the alt text of
  // an official product photo. They are one calendar day each.
  const mercado = FIXTURE.excerpts.find((notice) => notice.key === 'krogerMercado')!;
  const bestBy = rendered(mercado.excerpt).get('bestBy')!;
  assert.equal(bestBy, 'November 19, 2027, November 20, 2027');
  for (const day of ['November 19, 2027', 'November 20, 2027']) {
    assert.equal(bestBy.split(day).length - 1, 1, `${day} appears more than once`);
  }
  // No raw spelling survives anywhere in the cell.
  for (const raw of ['11 19 2027', '11 20 2027', '11/19/2027', '11/20/2027']) {
    assert.ok(!bestBy.includes(raw), raw);
  }
  // P3C-1 final contract: no same-month collapse — each date keeps its own
  // month, day and year, so a shared month and a bare day can never render.
  assert.ok(!/November \d{1,2}, \d{1,2},/.test(bestBy), bestBy);

  // AquaStar Skewers, the same shape in two same-month days.
  const skewers = FIXTURE.excerpts.find((notice) => notice.key === 'aquastarSkewers')!;
  assert.equal(rendered(skewers.excerpt).get('bestBy'), 'November 7, 2027, November 8, 2027');

  // AquaStar combined: fourteen supported days across three months, each
  // rendered complete, none omitted, none repeated.
  const combined = FIXTURE.excerpts.find((notice) => notice.key === 'aquastarCombined')!;
  const dates = rendered(combined.excerpt).get('bestBy')!.split(', ');
  const days = [];
  for (let index = 0; index < dates.length; index += 2) {
    days.push(`${dates[index]}, ${dates[index + 1]}`);
  }
  assert.equal(days.length, 14);
  assert.equal(new Set(days).size, 14, 'a calendar day rendered twice');
  for (const day of days) {
    assert.match(day, /^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
  }
});

test('removing the collapse changed dates only — prose grammar is untouched', () => {
  // The joiner is field-aware by CONCEPT, so ordinary phrases are unreachable
  // from the structured path. Geography, allergen lists and the two approved
  // phrase fields keep their conjunction.
  assert.equal(joinValues(['California', 'Texas', 'Ohio']), 'California, Texas, and Ohio');
  assert.equal(joinValues(['milk', 'soy']), 'milk and soy');
  assert.equal(joinFactValues('package_size', ['20 oz', '12 oz']), '20 oz and 12 oz');
  assert.equal(
    joinFactValues('packaging', ['Plastic bags', 'Cardboard boxes']),
    'Plastic bags and Cardboard boxes',
  );
  // A range stays one value — its endpoints are never split into two days.
  assert.equal(
    joinFactValues('best_by', ['July 20\u2013August 17, 2026']),
    'July 20\u2013August 17, 2026',
  );
  // An unsupported marking is preserved beside the parsed dates, byte for byte.
  assert.equal(
    joinFactValues('best_by', ['November 19, 2027', 'C 08 05 23']),
    'November 19, 2027, C 08 05 23',
  );
});

// ── Digit length is not evidence ────────────────────────────────────────────

test('a barcode is kept or dropped by its label, never by how many digits it has', () => {
  const combined = FIXTURE.excerpts.find((notice) => notice.key === 'aquastarCombined')!;
  const cocktail = FIXTURE.excerpts.find((notice) => notice.key === 'aquastarCocktail')!;
  const kept = rendered(combined.excerpt).get('upc')!.split(', ');
  // Fourteen digits and twelve digits are kept because a UPC label governs
  // them; eight-digit values under a Best Before label are gone. The rule
  // cannot be a length rule in either direction.
  assert.ok(kept.includes('20011110643906'));
  assert.ok(kept.includes('011110626196'), 'a significant leading zero was lost');
  assert.ok(!kept.some((code) => code.length === 8), kept.join(', '));
  // And the source's own ELEVEN-digit UPC — not a valid barcode length at all —
  // is preserved exactly as printed. No leading zero is invented to make it fit
  // and it is not dropped for failing to.
  assert.equal(rendered(cocktail.excerpt).get('upc'), '19434612191');
});

// ── The ownership vocabulary ────────────────────────────────────────────────

test('every label the audit found governing a false barcode is a competing label', () => {
  const competing = [
    'Best By',
    'Best Before',
    'Best If Used By',
    'BBD',
    'Use By',
    'Sell By',
    'Exp.',
    'expiration date',
    'packaging date',
    'lot code',
    'lot number',
    'lot #',
    'batch code',
  ];
  for (const label of competing) {
    assert.equal(barcodeLabelGoverns(`${label}: `, label.length + 2), false, label);
  }
  for (const label of ['UPC', 'U.P.C.', 'UPC code', 'barcode', 'bar code']) {
    assert.equal(barcodeLabelGoverns(`${label} `, label.length + 1), true, label);
  }
  // Ordinary words are not labels: the abbreviations are closed to a following
  // letter, so "expands" holds no "exp" and "Bubba" holds no "BB".
  for (const word of ['expands', 'Bubba', 'Bar Harbor']) {
    assert.equal(barcodeLabelGoverns(`${word} `, word.length + 1), true, word);
  }
  // The NEAREST label to the left wins, in both directions.
  assert.equal(barcodeLabelGoverns('Best By: 1/1/26, UPC ', 21), true);
  assert.equal(barcodeLabelGoverns('UPC 012345678905, Best Before: ', 31), false);
});

test('the audit ledger records each unreproducible notice honestly', () => {
  // These notices were measured in production and never archived. The ledger
  // must carry the identity, the exact values, and the governing label — and
  // must NOT carry invented source prose standing in for what was not kept.
  assert.ok(FIXTURE.auditLedger.length > 0);
  for (const entry of FIXTURE.auditLedger) {
    assert.ok(entry.officialUrl.startsWith('https://www.fda.gov/'), entry.nativeTitle);
    assert.ok(entry.renderedAsBarcode.length > 0);
    assert.ok(entry.governingLabel.length > 0);
    assert.ok(entry.evidence.includes('production audit'));
    assert.ok(!('excerpt' in entry), 'a ledger entry gained source text it never had');
    // The label the audit named refuses barcode ownership.
    const label = entry.governingLabel;
    assert.equal(barcodeLabelGoverns(`${label} `, label.length + 1), false, label);
  }
});
