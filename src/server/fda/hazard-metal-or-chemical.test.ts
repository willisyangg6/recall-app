/**
 * P3B: the FDA `Potential Metal or Chemical Contaminant` branch, routed
 * through THE shared foreign-material evidence owner (domain/hazard.ts).
 *
 * The FDA reason category is disjunctive — one taxonomy heading covering a
 * physical fragment hazard AND a chemical/radiological one — so the label
 * itself proves nothing. Only the announcement's own wording decides, and
 * the question "does this notice state a physical foreign-material hazard?"
 * has exactly one owner, the same one the FSIS `Product Contamination`
 * branch and the consumer reason line already ask.
 *
 * Root cause this pins closed: the predecessor scanned the whole
 * announcement for bare material words, so PACKAGING decided the hazard.
 * A read-only production audit of all 721 stored FDA source records
 * (2026-09-03) found exactly three active records misclassified this way —
 * pinned below from `fixtures/hazard-metal-or-chemical-notices.json`, whose
 * bounded official excerpts carry their own provenance. No test here keys on
 * a native id, a title, a product name, or a source id: every case is
 * decided by the evidence rule alone.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { extractForeignMaterialEvidence } from '../../domain/hazard';
import { conciseReasonLine } from '../../lib/recall-presentation';
import { interpretReason } from '../../lib/recall-reason';
import { buildWhatHappened } from '../../lib/what-happened';
import { deriveHazardCategory } from '../fsis/parse';
import { deriveFdaHazard } from './parse';

/** The one disjunctive FDA category this milestone governs. */
const METAL_OR_CHEMICAL = 'Potential Metal or Chemical Contaminant';

interface PinnedNotice {
  product: string;
  nativeId: string;
  officialUrl: string;
  fdaReasonCategory: string;
  storedHazardCategory: string;
  storedPathogenOrAllergen: string | null;
  expectedHazardCategory: string;
  expectedPathogenOrAllergen: string | null;
  packagingExcerpt: string;
  hazardExcerpt: string;
  provenance: string;
}

const PINNED: PinnedNotice[] = JSON.parse(
  readFileSync('src/server/fda/fixtures/hazard-metal-or-chemical-notices.json', 'utf8'),
);

/** The two bounded excerpts as the announcement presents them, in order. */
const noticeText = (notice: PinnedNotice) =>
  `The product is ${notice.packagingExcerpt}. The firm has stated that the product ${notice.hazardExcerpt}.`;

// ── The three verified production cases ──────────────────────────────────────

test('every verified production notice derives the chemical hazard its source states', () => {
  assert.equal(PINNED.length, 3);
  for (const notice of PINNED) {
    assert.equal(notice.fdaReasonCategory, METAL_OR_CHEMICAL, notice.product);
    // What the defect stored, and what the source actually says.
    assert.equal(notice.storedHazardCategory, 'foreign_material', notice.product);
    assert.deepEqual(
      deriveFdaHazard(notice.fdaReasonCategory, noticeText(notice)),
      {
        hazardCategory: notice.expectedHazardCategory,
        pathogenOrAllergen: notice.expectedPathogenOrAllergen,
      },
      notice.product,
    );
  }
});

test('the packaging clause alone never states a foreign-material hazard', () => {
  for (const notice of PINNED) {
    assert.deepEqual(
      extractForeignMaterialEvidence(notice.packagingExcerpt),
      { stated: false, material: null },
      `${notice.product}: packaging is not evidence`,
    );
    // …and the same clause on its own cannot carry the category either.
    assert.equal(
      deriveFdaHazard(METAL_OR_CHEMICAL, `The product is ${notice.packagingExcerpt}.`)
        .hazardCategory,
      'chemical_contamination',
      `${notice.product}: packaging must not decide the hazard`,
    );
  }
});

test('the radiological agent is recovered through the canonical agent extractor', () => {
  const radiological = PINNED.filter((n) => n.expectedPathogenOrAllergen === 'Cesium-137');
  assert.equal(radiological.length, 2);
  for (const notice of radiological) {
    // FDA's taxonomy has no separate radiological category; within the
    // closed schema the honest representation is the chemical category plus
    // the named agent — never a nameless foreign-material line.
    assert.deepEqual(deriveFdaHazard(METAL_OR_CHEMICAL, noticeText(notice)), {
      hazardCategory: 'chemical_contamination',
      pathogenOrAllergen: 'Cesium-137',
    });
  }
});

test('the mineral agent (asbestos) is recovered through the same canonical extractor', () => {
  // Dynarex Dynacare Baby Powder: the source directly states the product has
  // the potential to be contaminated with asbestos. FDA's taxonomy has no
  // separate mineral category either, so this is the same honest chemical
  // mapping as Cesium-137 above — not a claim that asbestos is chemically a
  // "chemical" in the strict sense.
  const dynarex = PINNED.find((n) => n.expectedPathogenOrAllergen === 'asbestos');
  assert.ok(dynarex);
  assert.deepEqual(deriveFdaHazard(METAL_OR_CHEMICAL, noticeText(dynarex!)), {
    hazardCategory: 'chemical_contamination',
    pathogenOrAllergen: 'asbestos',
  });
  // The official wording, verbatim from the source excerpt: extracted from
  // the fixture's own hazard clause, independent of the packaging clause.
  assert.match(dynarex!.hazardExcerpt, /potential to be contaminated with asbestos/);
});

test('plastic bottles remain packaging, never the Dynarex hazard', () => {
  const dynarex = PINNED.find((n) => n.expectedPathogenOrAllergen === 'asbestos')!;
  assert.match(dynarex.packagingExcerpt, /plastic bottles/);
  assert.deepEqual(extractForeignMaterialEvidence(dynarex.packagingExcerpt), {
    stated: false,
    material: null,
  });
  // The packaging clause alone, inside the governed category, must still
  // resolve to the chemical fallback with no invented agent — asbestos is
  // recovered only from the hazard clause, never from "plastic bottles".
  assert.deepEqual(
    deriveFdaHazard(METAL_OR_CHEMICAL, `The product is ${dynarex.packagingExcerpt}.`),
    { hazardCategory: 'chemical_contamination', pathogenOrAllergen: null },
  );
});

// ── Packaging plus a real chemical hazard ────────────────────────────────────

test('plastic packaging alongside chemical contamination resolves to the chemical hazard', () => {
  assert.deepEqual(
    deriveFdaHazard(
      METAL_OR_CHEMICAL,
      'The juice is packaged in 12-oz. plastic bottles. Testing found elevated levels of lead.',
    ),
    { hazardCategory: 'chemical_contamination', pathogenOrAllergen: 'lead' },
  );
});

test('plastic packaging alongside Cesium-137 resolves to the radiological agent', () => {
  assert.deepEqual(
    deriveFdaHazard(
      METAL_OR_CHEMICAL,
      'The shrimp is packaged in a clear plastic tray and may have become contaminated with Cesium-137.',
    ),
    { hazardCategory: 'chemical_contamination', pathogenOrAllergen: 'Cesium-137' },
  );
});

// ── Genuine foreign material is untouched ────────────────────────────────────

const GENUINE_FOREIGN_MATERIAL = [
  'The salad dressing may contain hard plastic fragments.',
  'Consumers may find pieces of hard plastic in the product.',
  'The product may be contaminated with glass shards.',
  'The recall was initiated after metal fragments were discovered in the product.',
  'The product may contain wood splinters.',
  'The product may contain rubber pieces.',
  'The product may contain bone fragments.',
  'The product is being recalled due to possible foreign material contamination.',
  'The recall is due to the presence of extraneous material in the product.',
];

test('genuine foreign-material evidence still derives foreign_material', () => {
  for (const text of GENUINE_FOREIGN_MATERIAL) {
    assert.deepEqual(
      deriveFdaHazard(METAL_OR_CHEMICAL, text),
      { hazardCategory: 'foreign_material', pathogenOrAllergen: null },
      text,
    );
  }
});

test('generic foreign-material wording needs no named material', () => {
  // The agency's own generic form is a complete statement of the hazard; the
  // parser must not demand a material word, nor invent one.
  assert.deepEqual(
    deriveFdaHazard(METAL_OR_CHEMICAL, 'Recalled due to possible foreign matter contamination.'),
    { hazardCategory: 'foreign_material', pathogenOrAllergen: null },
  );
  assert.equal(
    extractForeignMaterialEvidence('Recalled due to possible foreign matter contamination.')
      .material,
    null,
  );
});

// ── The same materials, as packaging ─────────────────────────────────────────

const PACKAGING_ONLY = [
  'The sauce is packaged in 16-oz. glass jars.',
  'The soup is packaged in metal cans, 12 cans to a case.',
  'The apples are shipped in wood crates.',
  'The container lid is fitted with a rubber gasket.',
  'The tray is sealed with a plastic overwrap and packed in a plastic pouch.',
  'Sold in a 10-oz. plastic bowl package.',
  'The powder is packaged in plastic bottles, 24 bottles to a case.',
];

test('packaging language using the same materials is never evidence', () => {
  for (const text of PACKAGING_ONLY) {
    assert.deepEqual(
      extractForeignMaterialEvidence(text),
      { stated: false, material: null },
      `evidence owner: ${text}`,
    );
    assert.deepEqual(
      deriveFdaHazard(METAL_OR_CHEMICAL, text),
      { hazardCategory: 'chemical_contamination', pathogenOrAllergen: null },
      `FDA category: ${text}`,
    );
  }
});

test('the disjunctive category label never invents metal', () => {
  // The heading names two possibilities and therefore states neither — not
  // as a category, not as an agent, and not as a material on either surface.
  const bare = 'The firm is recalling the product out of an abundance of caution.';
  assert.deepEqual(deriveFdaHazard(METAL_OR_CHEMICAL, bare), {
    hazardCategory: 'chemical_contamination',
    pathogenOrAllergen: null,
  });
  assert.deepEqual(extractForeignMaterialEvidence(METAL_OR_CHEMICAL), {
    stated: false,
    material: null,
  });
  assert.equal(
    conciseReasonLine({
      reasonText: METAL_OR_CHEMICAL,
      hazardCategory: 'chemical_contamination',
      pathogenOrAllergen: null,
      title: 'Firm Recalls Product Because of Possible Health Risk',
    }),
    'Potential chemical contamination.',
  );
});

// ── Precedence and the untouched neighbours ──────────────────────────────────

test('pathogen and allergen evidence keep their existing precedence', () => {
  // Both branches sit ahead of this one and are decided by the FDA category
  // tokens, so a packaging word can neither reach nor displace them.
  assert.deepEqual(
    deriveFdaHazard(
      'Salmonella',
      'The product is packaged in a clear plastic tray and may be contaminated with Salmonella.',
    ),
    { hazardCategory: 'microbial_contamination', pathogenOrAllergen: 'Salmonella' },
  );
  assert.deepEqual(
    deriveFdaHazard(
      'Milk',
      'The cookies are packaged in plastic trays and contain undeclared milk.',
    ),
    { hazardCategory: 'allergen', pathogenOrAllergen: 'undeclared milk' },
  );
  // Genuine foreign-material evidence inside this branch still loses to a
  // category that names a pathogen — the ordering is unchanged.
  assert.equal(
    deriveFdaHazard('Listeria', 'The product may contain pieces of glass.').hazardCategory,
    'microbial_contamination',
  );
});

test('FDA category paths outside this branch are unchanged', () => {
  const packaged = 'The product is packaged in a clear plastic tray.';
  assert.deepEqual(deriveFdaHazard('Potential Foreign Material', packaged), {
    hazardCategory: 'foreign_material',
    pathogenOrAllergen: null,
  });
  assert.deepEqual(deriveFdaHazard('Elevated Levels of Lead', packaged), {
    hazardCategory: 'chemical_contamination',
    pathogenOrAllergen: null,
  });
  assert.deepEqual(deriveFdaHazard('Packaging Defect', packaged), {
    hazardCategory: 'product_integrity',
    pathogenOrAllergen: null,
  });
  assert.deepEqual(deriveFdaHazard('Mislabeling', packaged), {
    hazardCategory: 'other_regulatory',
    pathogenOrAllergen: null,
  });
  assert.deepEqual(deriveFdaHazard('Undeclared Sulfites', packaged), {
    hazardCategory: 'unknown',
    pathogenOrAllergen: null,
  });
});

test('FSIS derivation is unchanged by this FDA correction', () => {
  // Both agencies now ask the same owner the same question; neither branch
  // reaches into the other. These are the P2e-B shapes, re-pinned here.
  assert.equal(
    deriveHazardCategory(['Product Contamination'], 'Sold in 9.75-oz. plastic bowls.'),
    'unknown',
  );
  assert.equal(
    deriveHazardCategory(
      ['Product Contamination'],
      'contaminated with foreign material, specifically glass',
    ),
    'foreign_material',
  );
  assert.equal(
    deriveHazardCategory(['Product Contamination'], 'may be contaminated with Listeria'),
    'microbial_contamination',
  );
  assert.equal(deriveHazardCategory(['Unreported Allergens'], 'undeclared milk'), 'allergen');
});

test('P2d/P2e corrected records keep the values those milestones settled', () => {
  // 115-2017: an undeclared-anchovy recall whose only material word is its
  // packaging. Its category is allergen, and no packaging word may reclaim it.
  assert.equal(
    deriveHazardCategory(
      ['Product Contamination'],
      'The product contains fish, a known allergen, which is not declared on the product label. ' +
        'The salad is packaged in 9.75-oz. plastic bowls.',
    ),
    'allergen',
  );
  // PHA-10092020-01: a glass contamination sold in plastic bowls — the
  // contaminant is glass, and it stays glass.
  const glassInPlastic =
    'contaminated with foreign material, specifically glass. Sold in 10-oz. plastic bowl packages.';
  assert.equal(deriveHazardCategory(['Product Contamination'], glassInPlastic), 'foreign_material');
  assert.equal(extractForeignMaterialEvidence(glassInPlastic).material, 'glass');
  // The FSIS allergen under-reporting rule (P2e-A) is untouched.
  assert.equal(
    deriveHazardCategory(
      ['Misbranding'],
      'The product contains milk, a known allergen, which is not declared on the product label.',
    ),
    'allergen',
  );
});

// ── Presentation, once the corrected canonical data reaches the surfaces ─────

test('Home and Detail name Cesium-137 consistently on the corrected data', () => {
  const corrected = {
    reasonText: METAL_OR_CHEMICAL,
    hazardCategory: 'chemical_contamination',
    pathogenOrAllergen: 'Cesium-137',
    title: 'AquaStar (USA) Corp. Recalls Cocktail Shrimp Because of Possible Health Risk',
  };
  // One typed reason, two renderings — the P3A parity contract. Home carries
  // no announcement body; Detail additionally has it, and cannot diverge.
  assert.deepEqual(interpretReason(corrected), { family: 'chemical', agent: 'Cesium-137' });
  assert.deepEqual(
    interpretReason({
      ...corrected,
      summaryText: 'The product is packaged in a clear plastic tray.',
    }),
    { family: 'chemical', agent: 'Cesium-137' },
  );
  assert.equal(conciseReasonLine(corrected), 'Potential Cesium-137 contamination.');
  const happened = buildWhatHappened({
    ...corrected,
    noticeType: 'recall',
    firmDisplayName: 'AquaStar (USA) Corp.',
    summaryText: 'The product is packaged in a clear plastic tray.',
  });
  assert.match(happened.text, /contaminated with Cesium-137/);
  // No packaging material is ever named as the hazard, on either surface.
  for (const rendered of [conciseReasonLine(corrected) ?? '', happened.text]) {
    assert.doesNotMatch(rendered, /plastic|foreign material/i, rendered);
  }
});

test('Home and Detail name asbestos consistently on the corrected Dynarex data', () => {
  const corrected = {
    reasonText: METAL_OR_CHEMICAL,
    hazardCategory: 'chemical_contamination',
    pathogenOrAllergen: 'asbestos',
    title:
      'Dynarex Corporation Expands Recall to Include Additional Products Due to Possible Health Risk',
  };
  // One typed reason, two renderings — the P3A parity contract. Home carries
  // no announcement body; Detail additionally has it, and cannot diverge.
  assert.deepEqual(interpretReason(corrected), { family: 'chemical', agent: 'asbestos' });
  assert.deepEqual(
    interpretReason({
      ...corrected,
      summaryText: 'The product is packaged in plastic bottles, 24 bottles to a case.',
    }),
    { family: 'chemical', agent: 'asbestos' },
  );
  assert.equal(conciseReasonLine(corrected), 'Potential asbestos contamination.');
  const happened = buildWhatHappened({
    ...corrected,
    noticeType: 'recall',
    firmDisplayName: 'Dynarex Corporation',
    summaryText: 'The product is packaged in plastic bottles, 24 bottles to a case.',
  });
  assert.match(happened.text, /contaminated with asbestos/);
  // Neither surface ever says foreign material or names plastic as the hazard.
  for (const rendered of [conciseReasonLine(corrected) ?? '', happened.text]) {
    assert.doesNotMatch(rendered, /plastic|foreign material/i, rendered);
  }
});

test('the stored (defective) values are exactly what the corrected ones replace', () => {
  // The consumer harm this milestone removes: a nameless foreign-material
  // line standing in for a named radiological contaminant.
  const stored = {
    reasonText: METAL_OR_CHEMICAL,
    hazardCategory: 'foreign_material',
    pathogenOrAllergen: null,
    title: 'AquaStar (USA) Corp. Recalls Cocktail Shrimp Because of Possible Health Risk',
  };
  assert.equal(conciseReasonLine(stored), 'Potential foreign material contamination.');
  assert.notEqual(
    conciseReasonLine(stored),
    conciseReasonLine({
      ...stored,
      hazardCategory: 'chemical_contamination',
      pathogenOrAllergen: 'Cesium-137',
    }),
  );
});
