/**
 * Canonical FSIS hazard-category precedence (P2e-B).
 *
 * The audited notices are pinned in
 * `fixtures/hazard-precedence-notices.json` — recorded from the archived
 * production `source_snapshots` during the P2e-A audit, with each notice's
 * verbatim reason enum and title beside the bounded official excerpt that
 * states its hazard. Each expectation was source-reviewed against that
 * excerpt; nothing here is inferred from the record's identity, and no test
 * may key on a native id.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { extractPathogenOrAllergen } from '../../domain/hazard';
import { deriveHazardCategory } from './parse';

interface PinnedNotice {
  nativeId: string;
  caseState: string;
  recallReason: string[];
  title: string;
  summaryExcerpt: string;
  storedHazardCategory: string;
  storedPathogenOrAllergen: string | null;
  expectedHazardCategory: string;
  expectedPathogenOrAllergen: string | null;
}

const NOTICES: PinnedNotice[] = JSON.parse(
  readFileSync('src/server/fsis/fixtures/hazard-precedence-notices.json', 'utf8'),
);

const hazardText = (notice: PinnedNotice) => `${notice.title}\n${notice.summaryExcerpt}`;

test('every audited notice derives its source-reviewed category and agent', () => {
  assert.equal(NOTICES.length, 23);
  for (const notice of NOTICES) {
    assert.equal(
      deriveHazardCategory(notice.recallReason, hazardText(notice)),
      notice.expectedHazardCategory,
      `${notice.nativeId} category`,
    );
    assert.equal(
      extractPathogenOrAllergen(hazardText(notice)),
      notice.expectedPathogenOrAllergen,
      `${notice.nativeId} agent`,
    );
  }
});

test('the audited population is exactly what P2e-A approved', () => {
  const byOutcome = (from: string, to: string) =>
    NOTICES.filter((n) => n.storedHazardCategory === from && n.expectedHazardCategory === to)
      .length;

  // 20 notices FSIS filed as labeling-only or with no reason at all.
  assert.equal(byOutcome('other_regulatory', 'allergen'), 15);
  assert.equal(byOutcome('unknown', 'allergen'), 5);
  // The contamination-filed allergen recall, and the pre-Cyclospora record.
  assert.equal(byOutcome('foreign_material', 'allergen'), 1);
  assert.equal(byOutcome('unknown', 'microbial_contamination'), 1);
  // Exactly one notice keeps its stored category: the mixed-hazard exclusion.
  const unchanged = NOTICES.filter((n) => n.storedHazardCategory === n.expectedHazardCategory);
  assert.equal(unchanged.length, 1);
  assert.equal(unchanged[0].storedHazardCategory, 'other_regulatory');
});

test('a produced-without-inspection notice keeps its category despite allergen prose', () => {
  // 083-2016: the primary hazard is the missing inspection. Its editor's note
  // adds SECONDARY cross-contamination allergens, which the canonical
  // extractor correctly declines as affirmative evidence — so neither the
  // reason enum nor the evidence can move this notice to allergen.
  const notice = NOTICES.find((n) => n.storedHazardCategory === n.expectedHazardCategory)!;
  assert.deepEqual(notice.recallReason, ['Produced Without Benefit of Inspection']);
  assert.equal(deriveHazardCategory(notice.recallReason, hazardText(notice)), 'other_regulatory');
  assert.equal(extractPathogenOrAllergen(hazardText(notice)), null);
  // Its stored value is a truthful, incomplete pre-P2d artifact; the repair
  // preserves it rather than replacing real information with null.
  assert.equal(notice.storedPathogenOrAllergen, 'undeclared wheat');
});

// ── The precedence rules themselves, on synthetic official wording ───────────

const ALLERGEN_SENTENCE =
  'The product contains soy, a known allergen, which is not declared on the product label.';

test('the structured allergen reason is unchanged', () => {
  assert.equal(deriveHazardCategory(['Unreported Allergens'], 'anything at all'), 'allergen');
  assert.equal(
    deriveHazardCategory(['Misbranding', 'Unreported Allergens'], ALLERGEN_SENTENCE),
    'allergen',
  );
});

test('labeling-only reasons need affirmative allergen evidence to become allergen', () => {
  for (const reasons of [['Misbranding'], ['Mislabeling'], ['Misbranding', 'Mislabeling'], []]) {
    assert.equal(deriveHazardCategory(reasons, ALLERGEN_SENTENCE), 'allergen', String(reasons));
  }
  // Without evidence they stay exactly where they were.
  assert.equal(
    deriveHazardCategory(['Misbranding'], 'Net weight was overstated.'),
    'other_regulatory',
  );
  assert.equal(
    deriveHazardCategory(['Mislabeling'], 'The label shows the wrong establishment number.'),
    'other_regulatory',
  );
  assert.equal(
    deriveHazardCategory([], 'The label shows the wrong establishment number.'),
    'unknown',
  );
});

test('a reason naming another hazard is never displaced by allergen words', () => {
  for (const reasons of [
    ['Import Violation'],
    ['Produced Without Benefit of Inspection'],
    ['Misbranding', 'Import Violation'],
    ['Mislabeling', 'Produced Without Benefit of Inspection'],
  ]) {
    assert.equal(
      deriveHazardCategory(reasons, ALLERGEN_SENTENCE),
      'other_regulatory',
      String(reasons),
    );
  }
  assert.equal(
    deriveHazardCategory(['Insanitary Conditions'], ALLERGEN_SENTENCE),
    'other_regulatory',
  );
  assert.equal(deriveHazardCategory(['Processing Defect'], ALLERGEN_SENTENCE), 'product_integrity');
  assert.equal(
    deriveHazardCategory(['Unfit for Human Consumption'], ALLERGEN_SENTENCE),
    'product_integrity',
  );
});

test('Product Contamination resolves supported hazards before allergen evidence', () => {
  const pc = ['Product Contamination'];
  // A stated pathogen wins outright.
  assert.equal(
    deriveHazardCategory(pc, `Possible Listeria monocytogenes contamination. ${ALLERGEN_SENTENCE}`),
    'microbial_contamination',
  );
  // Genuine foreign-material evidence wins.
  assert.equal(
    deriveHazardCategory(
      pc,
      `The products may be contaminated with foreign material, specifically glass. ${ALLERGEN_SENTENCE}`,
    ),
    'foreign_material',
  );
  // A supported chemical hazard bars the allergen resolution (stays unknown,
  // exactly as before — this branch never classified chemicals).
  assert.equal(
    deriveHazardCategory(
      pc,
      `The product may contain elevated levels of lead. ${ALLERGEN_SENTENCE}`,
    ),
    'unknown',
  );
  // Only with no other supported hazard stated does the allergen resolve it.
  assert.equal(deriveHazardCategory(pc, ALLERGEN_SENTENCE), 'allergen');
  // And with neither, the honest answer is still unknown.
  assert.equal(
    deriveHazardCategory(pc, 'The products were held without refrigeration.'),
    'unknown',
  );
});

test('every named material — glass, plastic, metal, bone, rubber, wood — still classifies foreign_material at the category level', () => {
  const pc = ['Product Contamination'];
  const cases: [string, string][] = [
    ['glass', 'discovered pieces of glass in product during production'],
    ['plastic', 'may be contaminated with foreign material, specifically hard plastic'],
    ['metal', 'may be contaminated with metal fragments'],
    ['bone', 'consumer reported bone fragments in the product'],
    ['rubber', 'the product may contain rubber pieces'],
    ['wood', 'a consumer found wood splinters in the product'],
  ];
  for (const [material, sentence] of cases) {
    assert.equal(deriveHazardCategory(pc, sentence), 'foreign_material', material);
  }
});

test('the same six materials named only as packaging never classify foreign_material', () => {
  const pc = ['Product Contamination'];
  const packaging =
    '10-oz. glass jars, plastic trays, wooden crates, metal-lidded tins, and rubber-sealed ' +
    'bags containing bone-in chicken breast.';
  assert.equal(deriveHazardCategory(pc, packaging), 'unknown');
});

test('packaging prose alone never makes a contamination notice foreign material', () => {
  const pc = ['Product Contamination'];
  const packaging =
    '9.75-oz. plastic bowls containing pasta salad, and 12-oz. plastic tray packages.';
  // Packaging plus an allergen statement is an allergen recall (115-2017).
  assert.equal(deriveHazardCategory(pc, `${packaging} ${ALLERGEN_SENTENCE}`), 'allergen');
  // Packaging with no hazard evidence at all is unknown, never foreign material.
  assert.equal(deriveHazardCategory(pc, packaging), 'unknown');
});

test('incidental and hypothetical allergen language is not evidence', () => {
  for (const text of [
    'Consumers allergic to milk should read labels carefully.',
    'The product was made in a facility that also processes peanuts.',
    'The product contains no milk, a known allergen.',
    'Undeclared ingredients, including maltodextrin, were found.',
    'The recall was expanded to additional lot codes.',
  ]) {
    assert.equal(deriveHazardCategory(['Misbranding'], text), 'other_regulatory', text);
    assert.equal(deriveHazardCategory([], text), 'unknown', text);
  }
});
