/**
 * FSIS consumer-projection extraction benchmark (66 verbatim real records,
 * recorded from the official API on 2026-08-21 — see fixtures/README.md).
 *
 * Purpose: future parser/presentation changes must not silently reduce useful
 * consumer coverage or reintroduce known failure classes. Two layers:
 *
 *   1. Hand-verified expectations for difficult records (labels checked
 *      against the official source text at recording time).
 *   2. Aggregate coverage floors across the whole set, with fallback
 *      frequencies logged so regressions are visible, not hidden.
 *
 * This benchmarks consumer projection outputs — never visual styling.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { classifyIllnessReport, type IllnessReportStatus } from '../../domain/illness';
import { buildConsumerCase } from '../../lib/consumer-projection';
import { PACKAGE_FIELD_LABEL } from '../../lib/consumer-schema';
import { projectCase } from '../../domain/projection';
import type { CaseProjection } from '../../domain/recall-types';
import { CONSUMER_ACTION_PATTERN } from '../../domain/text';
import { companyLine, parseProductLine, productSummaryFromTitle } from '../../lib/consumer-summary';
import { buildPackageCheck } from '../../lib/package-check';
import { reasonLine } from '../../lib/recall-display';
import { buildWhatHappened, type WhatHappened } from '../../lib/what-happened';
import { parseFsisRecord, type FsisRawRecord } from './parse';

const records: FsisRawRecord[] = JSON.parse(
  readFileSync(join(process.cwd(), 'src/server/fsis/fixtures/benchmark-records.json'), 'utf8'),
);

interface BenchRow {
  nativeId: string;
  projection: CaseProjection;
  productSummary: string | null;
  company: string;
  reason: string | null;
  happened: WhatHappened;
  illness: IllnessReportStatus;
}

function run(raw: FsisRawRecord): BenchRow {
  const normalized = parseFsisRecord(raw);
  const projection = projectCase([normalized]);
  return {
    nativeId: normalized.nativeId,
    projection,
    productSummary: productSummaryFromTitle(projection.title),
    company: companyLine(projection.recallingFirm.displayName, projection.title),
    reason: reasonLine(
      projection.reasonText,
      projection.hazardCategory,
      projection.pathogenOrAllergen,
    ),
    happened: buildWhatHappened({
      title: projection.title,
      noticeType: projection.noticeType,
      reasonText: projection.reasonText,
      hazardCategory: projection.hazardCategory,
      pathogenOrAllergen: projection.pathogenOrAllergen,
      firmDisplayName: projection.recallingFirm.displayName,
      summaryText: projection.summaryText,
    }),
    illness: classifyIllnessReport(projection.summaryText).status,
  };
}

const rows = new Map<string, BenchRow>();

test('benchmark: every recorded real record parses (coverage invariant)', () => {
  for (const raw of records) {
    const row = run(raw); // throws = regression
    rows.set(row.nativeId, row);
  }
  assert.equal(rows.size, records.length);
});

/** Hand-verified expectations for the difficult classes. */
const EXPECTED: Record<
  string,
  Partial<{
    productSummary: string | RegExp;
    company: string;
    illness: IllnessReportStatus;
    geographyScope: 'states' | 'nationwide' | 'unknown';
    explanation: RegExp;
  }>
> = {
  // Ordinary recall, explicit zero illnesses, nationwide.
  '017-2026': {
    productSummary: 'Ready-To-Eat Pickled Goat and Chicken',
    company: 'Gangothri Foods',
    illness: 'none_reported',
    geographyScope: 'nationwide',
  },
  // Upstream-ingredient PHA: ingredient retained, multi-brand scope, no fake company.
  'PHA-08082026-01': {
    productSummary: /Containing Recalled FDA-Regulated Jalapeños/,
    company: 'Multiple products and brands',
    illness: 'none_reported',
  },
  'PHA-04302026-01': {
    productSummary: /Containing Recalled/,
    company: 'Multiple products and brands',
  },
  // Import violation with consumer-useful context.
  'PHA-12022024-01': {
    illness: 'none_reported',
    company: 'Company not specified',
    explanation: /illegally imported from Ecuador.*not eligible to export/i,
  },
  // The dirty-title records must never show the agency as the company.
  'PHA-12042024-01': { company: 'Company not specified' },
  'PHA-10132022-01': { company: 'Company not specified' },
  // Real outbreaks: positive illness data stays positive.
  '023-2024': { illness: 'reported' },
  '031-2024': { illness: 'reported' },
  '001-2014': { illness: 'reported' },
  'PHA-091715': { illness: 'reported' },
  'PHA-05242026-01': { illness: 'reported' },
  // Retraction PHA: no illness statement → unknown, never zero.
  'PHA-04012026-01': { illness: 'unknown' },
  // `field_states` is empty, but the summary says the items were distributed
  // "in the state of Washington" — the canonical derivation (C5.2A) reads the
  // notice's own words, so this is `states`, not a blank.
  '006-2025': { geographyScope: 'states', illness: 'none_reported' },
  // Dirty recall numbers still produce full consumer rows.
  '034-2024': { company: 'Impero Foods & Meats', illness: 'none_reported' },
  '008': { productSummary: 'Pork' },
  '36-2021': { company: 'I-65 BBQ' },
  // All-caps establishment name is un-shouted.
  'PHA-07292026-01': { company: "Red's All Natural" },
  // Package-identifier flagship (Molly's Kitchen).
  '009-2026': { company: "Reser's Fine Foods", illness: 'none_reported' },
};

test('benchmark: hand-verified expectations for difficult records', () => {
  for (const [nativeId, expected] of Object.entries(EXPECTED)) {
    const row = rows.get(nativeId);
    assert.ok(row, `benchmark record ${nativeId} missing`);
    if (expected.productSummary !== undefined) {
      if (expected.productSummary instanceof RegExp) {
        assert.match(row.productSummary ?? '', expected.productSummary, nativeId);
      } else {
        assert.equal(row.productSummary, expected.productSummary, nativeId);
      }
    }
    if (expected.company !== undefined) assert.equal(row.company, expected.company, nativeId);
    if (expected.illness !== undefined) assert.equal(row.illness, expected.illness, nativeId);
    if (expected.geographyScope !== undefined) {
      assert.equal(row.projection.geography.scope, expected.geographyScope, nativeId);
    }
    if (expected.explanation !== undefined) {
      assert.match(row.happened.text, expected.explanation, nativeId);
    }
  }
});

test('benchmark: What-happened structural quality across every record', () => {
  const sources = { template: 0, generic: 0, title: 0 };
  for (const row of rows.values()) {
    const text = row.happened.text;
    const id = row.nativeId;
    sources[row.happened.source] += 1;

    // Never empty, never a fragment, always properly terminated.
    assert.ok(text.length > 0, id);
    assert.doesNotMatch(text, /^[a-z]|^firm\b/, id);
    assert.match(text, /[.!?]$/, id);
    assert.ok(text.split(/\s+/).length <= 75, `${id}: ${text}`);

    // No editorial, agency-announcement, or discovery boilerplate.
    assert.doesNotMatch(text, /editor[’']?s?\s+note/i, id);
    assert.doesNotMatch(text, /food safety and inspection service|announced today/i, id);
    assert.doesNotMatch(
      text,
      /problem was discovered|surveillance activit|routine inspection/i,
      id,
    );
    // No consumer/retailer instructions or disease education.
    assert.doesNotMatch(text, CONSUMER_ACTION_PATTERN, id);
    assert.doesNotMatch(text, /can cause|symptoms|healthcare provider/i, id);
    // Package-identification data stays in Check your package.
    assert.doesNotMatch(
      text,
      /best[- ]?(if used )?by|use[- ]by date|sell[- ]by|freeze[- ]by|lot code|case code|establishment number|est\.\s*\d/i,
      id,
    );

    // Semantic representation: pathogen, upstream ingredient, import context.
    const pathogen = row.projection.pathogenOrAllergen;
    const reasons = (row.projection.reasonText ?? '').toLowerCase();
    if (pathogen && !/^undeclared/i.test(pathogen) && reasons.includes('product contamination')) {
      assert.ok(text.includes(pathogen), `${id}: pathogen missing from "${text}"`);
    }
    if (/\bcontaining\b/i.test(row.productSummary ?? '')) {
      assert.match(text, /containing/i, `${id}: upstream ingredient lost`);
    }
    if (reasons.includes('import violation')) {
      assert.match(text, /import/i, `${id}: import context lost`);
    }

    // Updates, when present, are normalized — never raw editorial text.
    if (row.happened.update) {
      assert.match(row.happened.update, /^(Updated [A-Z][a-z]{2} \d{1,2}, \d{4}:|Update:) /, id);
      assert.doesNotMatch(row.happened.update, /editor|revised to reflect|reissued/i, id);
    }
  }

  // Fallback telemetry + floor: templates must dominate (66/66 at recording).
  console.log(`benchmark what-happened sources: ${JSON.stringify(sources)}`);
  assert.ok(sources.template >= 55, `template coverage regressed: ${JSON.stringify(sources)}`);
  assert.equal(sources.template + sources.generic + sources.title, rows.size);
});

test('benchmark: package-identifier extraction on the flagship shapes', () => {
  const molly = rows.get('009-2026')!.projection.affectedProducts[0];
  const parsed = parseProductLine(molly.rawText);
  assert.ok(parsed);
  assert.match(parsed.name, /Molly.s Kitchen California Style Pasta Salad/);
  assert.deepEqual(parsed.identifiers, [{ label: 'Use by', value: 'USE BY JUL/16/26 430' }]);
  assert.match(parsed.locationText ?? '', /side of the plastic tub/);
});

test('benchmark: aggregate coverage floors (usefulness must not regress)', () => {
  const all = [...rows.values()];
  const summaryFallbacks = all.filter((r) => r.productSummary === null);
  const explanationFallbacks = all.filter((r) => r.happened.source === 'title');
  const reasonFallbacks = all.filter((r) => r.reason === null);

  let productLines = 0;
  let structuredLines = 0;
  for (const row of all) {
    for (const product of row.projection.affectedProducts) {
      productLines += 1;
      if (parseProductLine(product.rawText)) structuredLines += 1;
    }
  }

  const illnessCounts = { none_reported: 0, reported: 0, unknown: 0 };
  for (const row of all) illnessCounts[row.illness] += 1;

  // Fallback frequency is tracked, not hidden (Part 14).
  console.log(
    `benchmark coverage: ${all.length} records | product-summary fallbacks: ${summaryFallbacks.length}` +
      ` | explanation fallbacks: ${explanationFallbacks.length}` +
      ` | reason fallbacks: ${reasonFallbacks.length}` +
      ` | structured product lines: ${structuredLines}/${productLines}` +
      ` | illness: ${JSON.stringify(illnessCounts)}`,
  );

  // Package-identification coverage over preserved source text (shared
  // display extractor; 43 structured / 12 partial / 10 source-silent /
  // 1 keyword false-positive at recording).
  const packageCoverage = { structured: 0, partial: 0, source_silent: 0, parser_missed: 0 };
  for (const row of all) {
    packageCoverage[
      buildPackageCheck(row.projection.summaryText, row.projection.affectedProducts).coverage
    ] += 1;
  }
  console.log(`benchmark package coverage: ${JSON.stringify(packageCoverage)}`);
  assert.ok(packageCoverage.structured >= 38, `package coverage: ${packageCoverage.structured}`);
  assert.ok(packageCoverage.parser_missed <= 3, `parser missed: ${packageCoverage.parser_missed}`);

  // Floors set below current performance (66/66, 66/66, 93/107 at recording)
  // to allow benign drift while catching real regressions.
  assert.ok(summaryFallbacks.length <= 6, `product-summary fallbacks: ${summaryFallbacks.length}`);
  assert.ok(
    explanationFallbacks.length <= 6,
    `explanation fallbacks: ${explanationFallbacks.length}`,
  );
  assert.ok(
    structuredLines / Math.max(productLines, 1) >= 0.8,
    `structured product lines ${structuredLines}/${productLines}`,
  );
  // The corpus-dominant explicit-zero boilerplate must classify as such.
  assert.ok(illnessCounts.none_reported >= 45, `none_reported: ${illnessCounts.none_reported}`);
  assert.ok(illnessCounts.reported >= 5, `reported: ${illnessCounts.reported}`);

  for (const row of all) {
    // The agency must never appear as the recalling company…
    assert.doesNotMatch(row.company, /^(FSIS|USDA)$/i, row.nativeId);
    // …and a multi-brand claim requires source support in the title.
    if (row.company === 'Multiple products and brands') {
      assert.match(row.projection.title, /various|multiple|several/i, row.nativeId);
    }
    // Unknown geography is never silently converted.
    if (row.projection.geography.scope === 'states') {
      assert.ok(row.projection.geography.states.length > 0, row.nativeId);
    }
  }
});

test('FSIS: the closed consumer schema holds, and City Foods case codes stay hidden', () => {
  const approved = new Set(Object.values(PACKAGE_FIELD_LABEL));
  let hidden = 0;
  for (const raw of records) {
    const projection = projectCase([parseFsisRecord(raw)]);
    const consumer = buildConsumerCase(projection, projection.affectedProducts);
    if (!consumer.packageCheck.render) hidden += 1;
    const labels = [
      ...consumer.packageCheck.fields,
      ...consumer.packageCheck.variants.flatMap((v) => v.fields),
    ].map((field) => field.label);
    for (const label of labels) {
      assert.ok(approved.has(label), `${projection.title}: unapproved field ${label}`);
    }

    // City Foods' only package identifier is a case code — a warehouse
    // reference no shopper reads off a package. It is preserved internally and
    // the section is hidden rather than filled with it.
    if (/City Foods/i.test(projection.title)) {
      assert.equal(consumer.packageCheck.render, false);
      assert.ok(
        consumer.packageCheck.rejected.some((r) => r.concept === 'case_code'),
        'case code should be recorded as held back',
      );
      assert.ok(!labels.includes('Case code'));
    }
  }
  // FSIS notices rarely publish consumer package identifiers, so the section
  // is absent far more often than on FDA — which is the honest outcome, not a
  // gap to fill with establishment numbers.
  assert.ok(hidden > 20, `FSIS checkers hidden: ${hidden}`);
});
