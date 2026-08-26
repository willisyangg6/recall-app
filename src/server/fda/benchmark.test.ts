/**
 * FDA consumer-projection extraction benchmark (recorded real announcements,
 * fetched from the official FDA sources on 2026-08-21 — see fixtures/README.md).
 *
 * Same philosophy as the FSIS benchmark: hand-verified expectations for the
 * difficult shapes, plus aggregate coverage floors with fallback telemetry so
 * regressions are visible, not hidden. The set is deliberately modest (~21
 * identities) — FDA announcement grammar is repetitive and these cover the
 * meaningful shapes (pathogen/allergen/foreign-material/chemical hazards,
 * nationwide/state-list/unknown distribution, zero/positive/absent illness,
 * product tables, stated quantity, URL churn, expansion announcements).
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';

import { classifyIllnessReport, type IllnessReportStatus } from '../../domain/illness';
import { projectCase } from '../../domain/projection';
import type { CaseProjection } from '../../domain/recall-types';
import { CONSUMER_ACTION_PATTERN } from '../../domain/text';
import {
  brandLine,
  companyLine,
  parseProductLine,
  productDisplayName,
} from '../../lib/consumer-summary';
import { buildPackageCheck, type PackageCheckModel } from '../../lib/package-check';
import { consumerActionDisplay, healthRiskSummary, reasonLine } from '../../lib/recall-display';
import { riskView } from '../../lib/risk-display';
import { buildWhatHappened, type WhatHappened } from '../../lib/what-happened';
import { loadDetailPage, loadListingItems } from './fixtures';
import { foodScope, parseFdaAnnouncement, slugFromPath, type FdaListingItem } from './parse';

interface BenchRow {
  nativeId: string;
  projection: CaseProjection;
  product: string;
  company: string;
  reason: string | null;
  happened: WhatHappened;
  illness: IllnessReportStatus;
  packageCheck: PackageCheckModel;
}

function run(item: FdaListingItem): BenchRow {
  const slug = slugFromPath(item.path);
  const detail = existsSync(`src/server/fda/fixtures/pages/${slug}.html`)
    ? loadDetailPage(slug)
    : null;
  const normalized = parseFdaAnnouncement({
    listing: item,
    detailMainHtml: detail,
    path: item.path,
  });
  const projection = projectCase([normalized]);
  return {
    nativeId: normalized.nativeId,
    projection,
    product: productDisplayName(projection.productDescription, projection.title),
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
      productDescription: projection.productDescription,
    }),
    illness: classifyIllnessReport(projection.summaryText).status,
    packageCheck: buildPackageCheck(projection.summaryText, projection.affectedProducts),
  };
}

const rows = new Map<string, BenchRow>();

test('benchmark: every recorded food announcement parses (coverage invariant)', () => {
  // Mirror ingest: churn pairs collapse to one identity; the newest edit wins.
  const changedStamp = (item: FdaListingItem) =>
    item.changed?.match(/datetime="([^"]+)"/)?.[1] ?? '';
  const byId = new Map<string, FdaListingItem>();
  let foodRows = 0;
  for (const item of loadListingItems()) {
    if (foodScope(item) !== 'food') continue;
    foodRows += 1;
    const { nativeId } = run(item); // every row must parse — throws = regression
    const existing = byId.get(nativeId);
    if (!existing || changedStamp(item) > changedStamp(existing)) byId.set(nativeId, item);
  }
  for (const item of byId.values()) {
    const row = run(item);
    rows.set(row.nativeId, row);
  }
  assert.equal(foodRows, 27);
  assert.equal(rows.size, 25); // exactly the two verified churn collisions
});

/** Hand-verified against the official announcement text at recording time. */
const EXPECTED: Record<
  string,
  Partial<{
    product: string | RegExp;
    company: string;
    illness: IllnessReportStatus;
    geographyScope: 'states' | 'nationwide' | 'unknown';
    states: string[];
    quantity: string | null;
    explanation: string | RegExp;
  }>
> = {
  // Multi-allergen with product table and regional (unknown-scope) prose.
  'prince-bakery-inc-issues-allergy-alert-undeclared-milk-and-sesame-prince-bakery-breads': {
    product: 'Variety of Breads',
    company: 'Prince Bakery',
    illness: 'none_reported',
    geographyScope: 'states',
    states: ['New York'],
    explanation:
      'Prince Bakery recalled Variety of Breads because the products may contain milk and sesame, allergens that are not declared on the label.',
  },
  // URL-churned update; foreign material; nationwide.
  'dreyers-grand-ice-cream-inc-issues-voluntary-recall-select-outshine-fruit-bars-due-possible': {
    product: 'Outshine Fruit Bars',
    illness: 'none_reported',
    geographyScope: 'nationwide',
    explanation:
      'Dreyer’s Grand Ice Cream recalled Outshine Fruit Bars because the products may contain pieces of glass.',
  },
  // Upstream-ingredient recall tied to a live outbreak: ingredient retained,
  // positive illness data stays positive.
  'naturebest-precut-produce-llc-voluntarily-recalls-products-containing-jalapenos-due-potential': {
    product: /Containing Jalapeno/,
    company: 'NatureBest Precut & Produce',
    illness: 'reported',
    geographyScope: 'states',
  },
  // Chemical contamination (lead); corporate boilerplate is not distribution.
  'publix-voluntarily-recalls-greenwise-pear-kiwi-spinach-pea-baby-food-pouches-due-lead': {
    company: 'Publix',
    illness: 'none_reported',
    geographyScope: 'unknown',
    explanation: /Publix recalled .* because the products may be contaminated with lead\./,
  },
  // Radionuclides → chemical contamination with the named agent.
  'southwind-foods-llc-recalls-frozen-shrimp-because-possible-health-risk': {
    illness: 'none_reported',
    geographyScope: 'states',
    explanation: /contaminated with Cesium-137/,
  },
  // Botulism risk, nationwide, destroy-or-return instructions.
  'snapchill-llc-recalls-canned-coffee-products-due-potential-clostridium-botulinum': {
    illness: 'none_reported',
    geographyScope: 'nationwide',
    explanation: /Clostridium botulinum/,
  },
  // Outbreak-linked cucumbers: 26 explicitly named states, illness reported.
  'sunfed-produce-llc-recalls-whole-fresh-american-cucumbers-because-possible-health-risks-due': {
    illness: 'reported',
    geographyScope: 'states',
  },
  // Stated quantity is preserved and reaches the explanation.
  'hh-fresh-trading-recalls-tw-enoki-mushrooms-150g-because-possible-health-risk': {
    quantity: '120 cases of Enoki Mushroom 150g',
    geographyScope: 'states',
    states: ['Florida', 'Texas'],
    explanation: /The recall covers 120 cases\./,
  },
  // Postal-code-only store list (", TX") still yields the state.
  'hardies-fresh-foods-recalls-jalapenos-because-possible-health-risk': {
    geographyScope: 'states',
    states: ['Texas'],
    illness: 'unknown', // the page reports no count — never converted to zero
  },
  // Expansion published as its own announcement (Phase A: separate case).
  'albertsons-companies-stores-arkansas-louisiana-oklahoma-and-texas-voluntarily-expands-recall-select':
    {
      illness: 'none_reported',
      geographyScope: 'states',
      states: ['Arkansas', 'Louisiana', 'Oklahoma', 'Texas'],
    },
};

test('benchmark: hand-verified expectations for the difficult records', () => {
  for (const [nativeId, expected] of Object.entries(EXPECTED)) {
    const row = rows.get(nativeId);
    assert.ok(row, `benchmark record ${nativeId} missing`);
    if (expected.product !== undefined) {
      if (expected.product instanceof RegExp) assert.match(row.product, expected.product, nativeId);
      else assert.equal(row.product, expected.product, nativeId);
    }
    if (expected.company !== undefined) assert.equal(row.company, expected.company, nativeId);
    if (expected.illness !== undefined) assert.equal(row.illness, expected.illness, nativeId);
    if (expected.geographyScope !== undefined) {
      assert.equal(row.projection.geography.scope, expected.geographyScope, nativeId);
    }
    if (expected.states !== undefined) {
      assert.deepEqual(row.projection.geography.states, expected.states, nativeId);
    }
    if (expected.quantity !== undefined) {
      assert.equal(row.projection.quantityText, expected.quantity, nativeId);
    }
    if (expected.explanation !== undefined) {
      if (expected.explanation instanceof RegExp) {
        assert.match(row.happened.text, expected.explanation, nativeId);
      } else {
        assert.equal(row.happened.text, expected.explanation, nativeId);
      }
    }
  }
});

test('benchmark: What-happened structural quality across every record', () => {
  const sources = { template: 0, generic: 0, title: 0 };
  for (const row of rows.values()) {
    const text = row.happened.text;
    const id = row.nativeId;
    sources[row.happened.source] += 1;

    assert.ok(text.length > 0, id);
    assert.doesNotMatch(text, /^[a-z]/, id);
    assert.match(text, /[.!?]$/, id);
    assert.ok(text.split(/\s+/).length <= 75, `${id}: ${text}`);

    // No press-release framing, agency boilerplate, or discovery prose.
    assert.doesNotMatch(
      text,
      /company announcement|press release|voluntar(y|ily)\s+recall(s|ing)? of\b/i,
      id,
    );
    assert.doesNotMatch(text, /food and drug administration|announced today|is committed to/i, id);
    assert.doesNotMatch(
      text,
      /problem was discovered|routine (testing|inspection)|was initiated after/i,
      id,
    );
    // No consumer instructions, education, or package codes in the explanation.
    assert.doesNotMatch(text, CONSUMER_ACTION_PATTERN, id);
    assert.doesNotMatch(text, /can cause|symptoms|healthcare provider|immune systems/i, id);
    assert.doesNotMatch(text, /\bUPC\b|best[- ]?before|batch code|\blot (code|number)/i, id);

    // Semantic representation of the structured hazard slots.
    const pathogen = row.projection.pathogenOrAllergen;
    if (row.projection.hazardCategory === 'microbial_contamination' && pathogen) {
      assert.ok(text.includes(pathogen), `${id}: pathogen missing from "${text}"`);
    }
    if (/\bcontaining\b/i.test(row.product)) {
      assert.match(text, /containing/i, `${id}: upstream ingredient lost`);
    }
  }

  console.log(`fda benchmark what-happened sources: ${JSON.stringify(sources)}`);
  assert.ok(sources.template >= 18, `template coverage regressed: ${JSON.stringify(sources)}`);
  assert.equal(sources.template + sources.generic + sources.title, rows.size);
});

test('benchmark: aggregate coverage floors (usefulness must not regress)', () => {
  const all = [...rows.values()];

  const withDescription = all.filter((r) => r.projection.productDescription !== null);
  const withCompany = all.filter((r) => r.company !== 'Company not specified');
  const withReason = all.filter((r) => r.reason !== null);
  const knownGeography = all.filter((r) => r.projection.geography.scope !== 'unknown');
  const withQuantity = all.filter((r) => r.projection.quantityText !== null);

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

  console.log(
    `fda benchmark coverage: ${all.length} records | product descriptions: ${withDescription.length}` +
      ` | company: ${withCompany.length} | reason: ${withReason.length}` +
      ` | known geography: ${knownGeography.length} | quantity: ${withQuantity.length}` +
      ` | structured product lines: ${structuredLines}/${productLines}` +
      ` | illness: ${JSON.stringify(illnessCounts)}`,
  );

  // Floors sit below recorded performance (21/21 descriptions, 21/21 company,
  // 21/21 reason, 15/21 known geography, 96/100 structured lines) to allow
  // benign drift while catching real regressions.
  assert.ok(withDescription.length >= 18, `product descriptions: ${withDescription.length}`);
  assert.ok(withCompany.length >= 18, `company extraction: ${withCompany.length}`);
  assert.ok(withReason.length >= 18, `reason extraction: ${withReason.length}`);
  assert.ok(knownGeography.length >= 12, `known geography: ${knownGeography.length}`);
  assert.ok(withQuantity.length >= 1, 'stated quantity must be preserved');
  assert.ok(
    structuredLines / Math.max(productLines, 1) >= 0.7,
    `structured product lines ${structuredLines}/${productLines}`,
  );
  assert.ok(illnessCounts.none_reported >= 10, `none_reported: ${illnessCounts.none_reported}`);
  assert.ok(illnessCounts.reported >= 3, `reported: ${illnessCounts.reported}`);

  for (const row of all) {
    // Announcements are pre-classification; a class is never invented.
    assert.ok(
      ['not_yet_classified', 'class_I', 'class_II', 'class_III'].includes(
        row.projection.classification.value,
      ),
      row.nativeId,
    );
    // Unknown geography is never silently converted; states are never empty.
    if (row.projection.geography.scope === 'states') {
      assert.ok(row.projection.geography.states.length > 0, row.nativeId);
    }
    if (row.projection.geography.scope === 'nationwide') {
      assert.match(
        row.projection.geography.sourceText ?? '',
        /nationwide|nationally/i,
        row.nativeId,
      );
    }
    // Every case keeps a working official FDA URL.
    assert.match(
      row.projection.officialUrl,
      /^https:\/\/www\.fda\.gov\/safety\/recalls-market-withdrawals-safety-alerts\//,
      row.nativeId,
    );
  }
});

// ── Package-identification coverage (founder Part 12) ────────────────────────

test('benchmark: package-identification coverage with source-missing vs parser-missed telemetry', () => {
  const coverage = { structured: 0, partial: 0, source_silent: 0, parser_missed: 0 };
  const missed: string[] = [];
  for (const row of rows.values()) {
    coverage[row.packageCheck.coverage] += 1;
    if (row.packageCheck.coverage === 'parser_missed') missed.push(row.nativeId);
  }
  console.log(
    `fda benchmark package coverage: ${JSON.stringify(coverage)}` +
      (missed.length > 0 ? ` | parser-missed: ${missed.join(', ')}` : ''),
  );
  // At recording: 22 structured, 1 partial, 1 source-silent, 1 keyword
  // false-positive (Snapchill recalls ALL its products "within expiration
  // date" — the keyword scan cannot know no specific codes exist; the
  // consumer fallback copy is still truthful for it). A rise in
  // parser-missed means the source stated identifiers our parser dropped.
  assert.ok(coverage.structured >= 20, `structured package info regressed: ${coverage.structured}`);
  assert.ok(coverage.parser_missed <= 1, `parser missed identifiers on: ${missed.join(', ')}`);
});

test('benchmark: reason labels are standardized, consistently cased, and never raw source styling', () => {
  for (const row of rows.values()) {
    const reason = row.reason;
    assert.ok(reason, row.nativeId);
    assert.match(reason!, /^[A-Z]/, row.nativeId);
    // FDA source styling like "Possible E. Coli Contamination" or
    // "May Contain Undeclared Soy" must never surface.
    assert.doesNotMatch(
      reason!,
      /Contamination|May Contain|E\. Coli/,
      `${row.nativeId}: ${reason}`,
    );
    const hazard = row.projection.hazardCategory;
    if (hazard === 'microbial_contamination' || hazard === 'chemical_contamination') {
      assert.match(reason!, /^Possible /, `${row.nativeId}: ${reason}`);
    }
    if (hazard === 'allergen') {
      assert.match(reason!, /^Undeclared /, `${row.nativeId}: ${reason}`);
    }
    // Health risk, when shown, is a concise clean template.
    const health = healthRiskSummary(
      hazard,
      row.projection.pathogenOrAllergen,
      row.projection.reasonText,
    );
    if (health) {
      assert.match(health, /^[A-Z]/, row.nativeId);
      assert.match(health, /\.$/, row.nativeId);
      assert.ok(health.split(/\s+/).length <= 50, `${row.nativeId}: ${health}`);
      assert.doesNotMatch(health, /FSIS|announced|recall/i, row.nativeId);
    }
  }
});

// ── Founder-review regression cases (Part 16) ────────────────────────────────

test('benchmark: Bakr cookie dough — lot only in the package checker, action stays clean', () => {
  const row = rows.get(
    'bear-stewart-llc-issues-allergy-alert-undeclared-soy-bakr-brown-butter-chocolate-chunk-ready-bake',
  )!;
  assert.ok(row);
  assert.equal(row.company, 'Bear Stewart');
  assert.equal(
    brandLine(row.projection.brands, row.projection.recallingFirm.displayName, row.product),
    'Bakr',
  );
  assert.equal(row.reason, 'Undeclared soy allergen');
  // Lot 2606022 lives exclusively in the expandable package checker…
  assert.deepEqual(row.packageCheck.identifiers, [{ label: 'Lot', value: '2606022' }]);
  assert.match(
    row.packageCheck.locationHints[0],
    /bottom left corner on the rear side of the pouch/,
  );
  assert.equal(row.packageCheck.packageText, '8-ounce blue package');
  // …and never clutters the always-visible consumer action.
  const action = consumerActionDisplay(row.projection.consumerAction);
  assert.equal(action?.standardized, true);
  assert.equal(
    action?.primary,
    'Do not eat this product. Return it to the place of purchase for a refund.',
  );
  assert.doesNotMatch(action?.primary ?? '', /2606022|lot/i);
  // …and stays out of the What-happened explanation.
  assert.doesNotMatch(row.happened.text, /2606022/);
});

test('benchmark: Rooted in RARE aquafaba — roles, quantity, and illness semantics', () => {
  const row = rows.get(
    '529-commerce-llc-recalls-rooted-rare-brand-aquafaba-powder-due-undeclared-eggs',
  )!;
  assert.ok(row);
  assert.equal(row.company, '529 Commerce');
  assert.equal(
    brandLine(row.projection.brands, row.projection.recallingFirm.displayName, row.product),
    'Rooted in RARE',
  );
  // Founder decision: authoritative quantity stays visible.
  assert.equal(row.projection.quantityText, '3,860 units');
  assert.match(row.happened.text, /The recall covers 3,860 units\.$/);
  // A consumer-reported allergic reaction is a report — never explicit zero.
  assert.equal(row.illness, 'reported');
  // Usable package checker: both UPCs and both best-by dates.
  const values = row.packageCheck.identifiers.map((i) => `${i.label}:${i.value}`);
  assert.ok(values.includes('UPC:199284530959'), values.join(', '));
  assert.ok(values.includes('Best by:12/14/2026'), values.join(', '));
});

test('benchmark: GreenWise blueberries / Publix — roles distinct, casing standardized, health risk clean', () => {
  const row = rows.get(
    'publix-recalls-all-lots-greenwise-organic-frozen-blueberries-and-whole-mixed-berries-due-potential-e',
  )!;
  assert.ok(row);
  // Company, brand, and sold-at are three distinct roles.
  assert.equal(row.company, 'Publix');
  assert.equal(
    brandLine(row.projection.brands, row.projection.recallingFirm.displayName, row.product),
    'GreenWise',
  );
  assert.deepEqual(row.projection.retailerNames, ['Publix']);
  // Product stays recognizable; states stay correct.
  assert.match(row.product, /Organic IQF Frozen Blueberries/);
  assert.deepEqual(row.projection.geography.states, [
    'Alabama',
    'Florida',
    'Georgia',
    'Kentucky',
    'North Carolina',
    'South Carolina',
    'Tennessee',
    'Virginia',
  ]);
  // "Possible E. Coli Contamination" (source styling) → standardized casing.
  assert.equal(row.reason, 'Possible E. coli contamination');
  // Health risk is the concise deterministic template and starts cleanly…
  const health = healthRiskSummary(
    row.projection.hazardCategory,
    row.projection.pathogenOrAllergen,
    row.projection.reasonText,
  );
  assert.match(health ?? '', /^E\. coli can cause severe stomach cramps/);
  // …while the illness status stays separate and honest (source is silent).
  assert.equal(row.illness, 'unknown');
  // Classification pending is intentional, not missing data.
  assert.equal(
    riskView(row.projection.classification, row.projection.sourceAgency).official?.text,
    'Not yet assigned',
  );
  // UPCs are inside the app — no reading the FDA notice required.
  assert.ok(
    row.packageCheck.identifiers.some((i) => i.label === 'UPC' && i.value === '41415-06453'),
  );
});

test('benchmark: Momchipz — formatting, roles, and no required external reading', () => {
  const row = rows.get(
    'exotique-foods-inc-recalls-momchipz-veggie-chips-broccoli-florets-cauliflower-due-undeclared-gluten',
  )!;
  assert.ok(row);
  assert.equal(row.reason, 'Undeclared gluten');
  assert.equal(row.company, 'Exotique Foods');
  assert.equal(
    brandLine(row.projection.brands, row.projection.recallingFirm.displayName, row.product),
    'Momchipz',
  );
  assert.equal(
    riskView(row.projection.classification, row.projection.sourceAgency).official?.text,
    'Not yet assigned',
  );
  // The UPC is extracted from prose — the in-app checker works and the user
  // is never told to go read the FDA page.
  assert.deepEqual(row.packageCheck.identifiers, [{ label: 'UPC', value: '6 28634 44216 6' }]);
  assert.equal(row.packageCheck.coverage, 'structured');
});

test('benchmark: source-stated retailers are extracted, never invented', () => {
  const withRetailers = [...rows.values()].filter(
    (r) => (r.projection.retailerNames ?? []).length > 0,
  );
  console.log(
    `fda benchmark retailers: ${withRetailers.length} record(s) — ` +
      withRetailers.map((r) => r.projection.retailerNames.join('/')).join(', '),
  );
  // At recording: Costco, Publix ×3, BJ's Wholesale Club, Walmart.
  assert.ok(withRetailers.length >= 5, `retailer extraction regressed: ${withRetailers.length}`);
  for (const row of rows.values()) {
    for (const name of row.projection.retailerNames ?? []) {
      // Every claimed retailer appears verbatim in the case's own source text.
      assert.ok(
        `${row.projection.title}\n${row.projection.summaryText}`.includes(name),
        `${row.nativeId}: retailer "${name}" not source-stated`,
      );
    }
  }
});
