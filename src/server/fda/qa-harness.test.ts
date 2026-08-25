/**
 * Bounded consumer-projection QA over the recorded 160-announcement corpus.
 *
 * The full grouped report is `npm run qa:fda`; this test is the guard that
 * keeps the numbers from drifting back. It asserts the invariants that must
 * never regress (zero critical violations) and caps the known-remaining
 * clusters, so a new defect anywhere in the sample fails the build even if no
 * one thought to write a fixture for that particular recall.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';

import { projectCase } from '../../domain/projection';
import { buildConsumerCase } from '../../lib/consumer-projection';
import { PACKAGE_FIELD_LABEL } from '../../lib/consumer-schema';
import { auditConsumerCase, summarizeQa, type QaRecordResult } from '../../lib/consumer-qa';
import { parseFdaAnnouncement, slugFromPath, type FdaListingItem } from './parse';

interface QaCorpusEntry {
  path: string;
  listing: FdaListingItem;
  mainHtml: string;
}

const corpus: QaCorpusEntry[] = JSON.parse(
  gunzipSync(readFileSync('src/server/fda/fixtures/qa-corpus.json.gz')).toString('utf8'),
);

const results: QaRecordResult[] = corpus.map((entry) => {
  const normalized = parseFdaAnnouncement({
    listing: entry.listing,
    detailMainHtml: entry.mainHtml,
    path: entry.path,
  });
  const projection = projectCase([normalized]);
  return auditConsumerCase(slugFromPath(entry.path), projection, projection.affectedProducts);
});

const summary = summarizeQa(results);

/** One recorded announcement, projected end to end. */
function corpusCase(fragment: string) {
  const entry = corpus.find((e) => slugFromPath(e.path).includes(fragment));
  assert.ok(entry, `corpus record missing: ${fragment}`);
  const projection = projectCase([
    parseFdaAnnouncement({
      listing: entry!.listing,
      detailMainHtml: entry!.mainHtml,
      path: entry!.path,
    }),
  ]);
  return { projection, consumer: buildConsumerCase(projection, projection.affectedProducts) };
}

test('QA corpus: every recorded announcement projects without throwing', () => {
  assert.equal(results.length, 160);
  assert.equal(
    results.filter((r) => r.violations.some((v) => v.rule === 'record-failed-to-parse')).length,
    0,
  );
});

test('QA corpus: zero critical consumer-projection violations', () => {
  const critical = results.flatMap((r) =>
    r.violations.filter((v) => v.severity === 'critical').map((v) => `${r.id}: ${v.rule}`),
  );
  // Criticals are the invariants the product cannot ship without: no external
  // referrals, no layout artifacts, no raw source headings, no fabricated
  // geography, no illness education counted as reports, no missing action.
  assert.deepEqual(critical, []);
});

test('QA corpus: no consumer copy ever refers the user to the government notice', () => {
  const offenders = results.filter((r) =>
    r.violations.some(
      (v) => v.rule === 'external-notice-instruction' || v.rule === 'layout-artifact-in-ui',
    ),
  );
  assert.deepEqual(
    offenders.map((r) => r.id),
    [],
  );
});

test('QA corpus: package identification is projected wherever the source states it', () => {
  const m = summary.metrics;
  // Structured coverage across the sample, with source-silent records counted
  // honestly rather than as parser failures.
  assert.ok(m.packageStructured >= 130, `structured coverage regressed: ${m.packageStructured}`);
  assert.ok(m.packageParserMissed <= 8, `parser missed ${m.packageParserMissed} records`);
  // Value-bearing dates and barcodes must not be dropped.
  assert.ok(m.dateMissed <= 3, `dates stated in source but missed: ${m.dateMissed}`);
  assert.ok(m.upcMissed <= 3, `barcodes stated in source but missed: ${m.upcMissed}`);
  // Photos are surfaced in-app for every announcement that has them.
  assert.equal(m.photosShown, m.photosSourcePresent);
  assert.ok(m.photosShown >= 140, `photos shown: ${m.photosShown}`);
  // Retailers are extracted wherever a named store is stated. The denominator
  // counts every sentence shape that names one, including the two the parser
  // still cannot read, so this is a real proportion rather than a tautology.
  assert.ok(
    m.retailerExtracted >= m.retailerSourcePresent - 2,
    `retailers ${m.retailerExtracted}/${m.retailerSourcePresent}`,
  );
  // Every record gets a usable consumer action, from the source or from us.
  assert.equal(m.actionFromSource + m.actionAppFallback, results.length);
});

test('QA corpus: remaining major clusters stay bounded and documented', () => {
  // Known remainder at recording, all inspected: source states a label with no
  // value, or names its own product inside a variant list. Any growth here, or
  // any new cluster, fails the build.
  const allowed: Record<string, number> = {
    'package-identifiers-parser-missed': 5,
    'product-name-repeated-in-values': 2,
    'date-in-source-not-projected': 2,
  };
  for (const cluster of summary.violationsByRule) {
    const cap = allowed[cluster.rule];
    assert.ok(
      cap !== undefined,
      `new QA cluster "${cluster.rule}" (${cluster.count}): ${cluster.examples.join(' | ')}`,
    );
    assert.ok(
      cluster.count <= cap,
      `cluster "${cluster.rule}" grew to ${cluster.count} (cap ${cap})`,
    );
  }
  assert.ok(summary.majorCount <= 9, `major violations: ${summary.majorCount}`);
});

test('QA corpus: one semantic fact always looks the same wherever it appears', () => {
  const m = summary.metrics;
  // Every consumer-readable date reaches one format, whatever the source
  // printed — a shopper comparing a package should never have to translate.
  assert.equal(m.dateLeaks, 0, 'dates still in source formatting');
  assert.equal(m.dateFieldsNormalized, m.dateFieldsPresent, 'date fields normalized');
  // A value is never shown under a field whose type it does not satisfy.
  assert.equal(m.typeMismatches, 0, 'semantic type mismatches');
  // A recognized hazard with an approved template always renders one.
  assert.equal(
    m.hazardTemplateRendered,
    m.hazardTemplateRecognized,
    'recognized hazards rendering a health-risk template',
  );
  // Every safely recognizable stated recall quantity is surfaced.
  assert.equal(m.quantityMissed, 0, 'stated recall quantities not surfaced');
});

test('QA corpus: semantic relationships survive into the consumer projection', () => {
  const m = summary.metrics;
  // The defect this pass exists to remove: a value the source printed inside
  // one product row rendered as though it belonged to the whole recall.
  assert.equal(m.orphanIdentifiers, 0, 'orphan identifiers');
  // Versions keep identifiers of their own rather than contributing to
  // parallel global lists nothing can be matched against.
  assert.ok(m.variantBearingRecords >= 45, `variant-bearing records: ${m.variantBearingRecords}`);
  assert.ok(
    m.variantsWithOwnIdentifiers >= 40,
    `versions with own identifiers: ${m.variantsWithOwnIdentifiers}`,
  );
  // A code the source published beside its calendar date keeps that date.
  assert.ok(
    m.codeDatePairsPreserved >= m.codeDatePairsInSource,
    `code/date pairs: ${m.codeDatePairsPreserved} preserved / ${m.codeDatePairsInSource} in source`,
  );
});

test('QA corpus: image roles put the right picture in the right place', () => {
  const m = summary.metrics;
  // Every feed thumbnail is a recognizable product image, never a code crop.
  assert.equal(m.homeThumbnailValid, m.records, 'home thumbnails');
  // Barcode macros are held back from the gallery — but only where a real
  // product photo exists to show instead.
  assert.ok(m.codeImagesExcluded > 0, 'code crops identified');
  assert.equal(m.photosShown, m.photosSourcePresent, 'records showing available photos');
});

test('QA corpus: source facts are accounted for, not silently lost', () => {
  const { total, byDisposition } = summary.inventory;
  const accounted =
    byDisposition.retained +
    byDisposition.normalized +
    byDisposition.aggregated +
    byDisposition.relationship_preserved +
    byDisposition.suppressed +
    byDisposition.projection_dropped;
  assert.equal(accounted, total, 'every source fact has a disposition');
  // Most of what the source states reaches the consumer, and the largest
  // single share does so with its product relationship intact.
  const reaching =
    byDisposition.retained + byDisposition.normalized + byDisposition.relationship_preserved;
  assert.ok(reaching > byDisposition.projection_dropped * 3, 'facts reaching the UI');
  assert.ok(
    byDisposition.relationship_preserved > byDisposition.retained,
    'relationship-preserved facts outnumber unattached ones',
  );
});

test('QA corpus: the consumer package vocabulary is exactly the approved allowlist', () => {
  // The acceptance artifact for the closed schema. Before this pass the same
  // corpus produced nineteen different labels, including `Details`, `Item
  // number`, `Case code`, and `Product code`. A parser change that invents a
  // twentieth now fails the build here rather than reaching a screen.
  const rendered = new Set(results.flatMap((r) => r.signals.packageFieldLabels));
  const approved = new Set(Object.values(PACKAGE_FIELD_LABEL));
  for (const label of rendered) {
    assert.ok(approved.has(label), `unapproved consumer field label rendered: ${label}`);
  }
  assert.equal(summary.metrics.unapprovedFieldLabels, 0);
  // Nine approved fields, and no more; the count is allowed to shrink when a
  // corpus has no sell-by dates, never to grow.
  assert.ok(rendered.size <= approved.size, `${rendered.size} labels rendered`);
});

test('QA corpus: every fact reaches exactly one section', () => {
  const m = summary.metrics;
  // A date, a lot code, or a barcode inside "Where it was sold"; a state, a
  // retailer, or a recall total inside a package card. The structured schema
  // makes each unrepresentable — this is the proof, across 160 records.
  assert.equal(m.crossDestinationLeaks, 0, 'cross-destination leaks');
  // An instruction that tells the reader nothing is worse than our own clear
  // recommendation, because they believe they have been told something.
  assert.equal(m.actionFragments, 0, 'incomplete consumer-action sentences');
});

test('QA corpus: the package checker hides itself rather than showing residue', () => {
  const m = summary.metrics;
  assert.equal(m.checkersRendered + m.checkersHidden, results.length);
  // Most records still have something worth checking…
  assert.ok(m.checkersRendered >= 120, `checkers rendered: ${m.checkersRendered}`);
  // …and where nothing approved survived, the section is gone rather than
  // filled with a residual blob.
  assert.ok(m.checkersHidden > 0, 'kill switch never fires');
});

test('golden: Sun Noodle shows only approved fields and a structured Hawaii distribution', () => {
  const { consumer } = corpusCase('sun-noodle');

  // Two package versions, each with the same finite vocabulary. `Item number`,
  // `Details`, and the extra `Product code` are gone. The lot both packs
  // share is proven shared and renders once above the cards.
  assert.equal(consumer.packageCheck.variants.length, 2);
  for (const variant of consumer.packageCheck.variants) {
    assert.deepEqual(
      variant.fields.map((f) => f.label),
      ['Size', 'Barcode (UPC)'],
    );
  }
  assert.equal(consumer.packageCheck.variants[0].fields[1].value, '085315054108');
  assert.equal(consumer.packageCheck.variants[1].fields[1].value, '085315054105');
  assert.deepEqual(
    consumer.packageCheck.sharedFields.map((f) => f.label),
    ['Lot code'],
  );
  // The lot number reaches the checker and nowhere else — not as a case-level
  // "Barcode (UPC)", and not inside the distribution statement. Nothing
  // renders loosely after the version cards.
  assert.deepEqual(consumer.packageCheck.fields, []);

  // Where it was sold holds places and stores. The source sentence carrying
  // "lot #1226183" and "between July 9 and July 29" cannot reach it.
  assert.equal(consumer.distribution.areaText, 'Hawaii.');
  assert.ok(
    consumer.distribution.retailers.length >= 10,
    `${consumer.distribution.retailers.length}`,
  );
  assert.ok(consumer.distribution.retailers.includes('Don Quijote Kaheka Store'));
  const copy = [
    consumer.distribution.areaText,
    ...consumer.distribution.retailers,
    ...consumer.distribution.channels,
  ].join(' ');
  assert.doesNotMatch(copy, /1226183|July|lot/i);

  // The instruction is complete, not the fragment the old strip left behind.
  assert.equal(consumer.action.origin, 'source');
  assert.match(consumer.action.text, /Return it to the place of purchase for a refund\./);
});

test('golden: Tomato Bisque moves its recall total out of the package card', () => {
  const { consumer } = corpusCase('marketside-tomato-bisque');
  const variant = consumer.packageCheck.variants[0];
  assert.deepEqual(
    variant.fields.map((f) => f.label),
    ['Best by', 'Size', 'Barcode (UPC)'],
  );
  assert.equal(variant.fields.find((f) => f.key === 'bestBy')?.value, 'August 22, 2026');
  assert.equal(variant.fields.find((f) => f.key === 'size')?.value, '14 oz (397 g)');
  assert.equal(variant.fields.find((f) => f.key === 'upc')?.value, '194346474004');
  // "Details: 3240 packs" is gone; the total is What happened's, and readable.
  assert.equal(consumer.quantityText, '3,240 packs');
  assert.ok(!variant.fields.some((f) => /3,?240/.test(f.value)));
});
