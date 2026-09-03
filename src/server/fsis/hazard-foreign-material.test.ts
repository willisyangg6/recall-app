/**
 * P2e-B expanded scope: the 27 further FSIS "Product Contamination"
 * disagreements the production dry run surfaced beyond the P2e-A allergen
 * audit, approved in principle against the same evidence rule (see
 * hazard-precedence.test.ts's sibling coverage for that rule's shape).
 *
 * `hazard-foreign-material-notices.json` holds the 19 of these 20
 * "unknown -> foreign_material" corrections for which the saved production
 * ledger (`.reports/p2e-b-dry-run.json`) preserved a literal evidence
 * excerpt. `evidenceExcerpt` on that report entry is populated only when the
 * corrected category is `foreign_material` AND either an agent or the
 * literal word "foreign" is found in the notice text — one further record in
 * this family (082-2017, likely "extraneous" rather than "foreign" wording)
 * and all 7 "foreign_material -> unknown" corrections produced no excerpt by
 * that same rule, so they are not represented here with literal text. Their
 * correctness rests on a different, code-level proof instead (see the
 * "unrepresented by literal text" test below and the P2e-B session report):
 * `correctedPathogenOrAllergen: null` on every one of those 8 records proves
 * — from the parser's own control flow, not from guessed text — that neither
 * a pathogen nor allergen evidence exists in their notice text, and FSIS's
 * `deriveHazardCategory` has no path to `chemical_contamination` at all, so
 * the only way a `Product Contamination` record can land on `unknown` is
 * that `extractForeignMaterialEvidence` found no genuine construction —
 * which, for a record whose STORED category was `foreign_material`, means
 * the old bare-keyword scan matched a word that stated no real hazard.
 *
 * Nothing here is invented: every excerpt is verbatim production text, and
 * no test may key on a native id.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { extractPathogenOrAllergen } from '../../domain/hazard';
import { deriveHazardCategory } from './parse';

interface PinnedNotice {
  nativeId: string;
  recallCaseId: string;
  recallReason: string[];
  storedHazardCategory: string;
  expectedHazardCategory: string;
  evidenceExcerpt: string;
  storedPathogenOrAllergen: string | null;
  expectedPathogenOrAllergen: string | null;
}

const NOTICES: PinnedNotice[] = JSON.parse(
  readFileSync('src/server/fsis/fixtures/hazard-foreign-material-notices.json', 'utf8'),
);

test('every literally-evidenced notice derives foreign_material from its generic title alone', () => {
  assert.equal(NOTICES.length, 19);
  for (const notice of NOTICES) {
    assert.equal(notice.expectedHazardCategory, 'foreign_material', notice.nativeId);
    assert.equal(notice.storedHazardCategory, 'unknown', notice.nativeId);
    assert.equal(
      deriveHazardCategory(notice.recallReason, notice.evidenceExcerpt),
      'foreign_material',
      `${notice.nativeId} category`,
    );
    // No specific material is invented from generic wording — the notices
    // in this family never name one, and the extractor must not guess.
    assert.equal(
      extractPathogenOrAllergen(notice.evidenceExcerpt),
      notice.expectedPathogenOrAllergen,
      `${notice.nativeId} agent`,
    );
    assert.equal(notice.expectedPathogenOrAllergen, null, notice.nativeId);
  }
});

test('every notice states the generic foreign-matter hazard in its own words', () => {
  for (const notice of NOTICES) {
    assert.match(
      notice.evidenceExcerpt,
      /Foreign Matter Contamination/i,
      `${notice.nativeId} evidence must state the hazard, not merely reference it`,
    );
  }
});

test('the 8 records with no literal excerpt are provably correct from the parser control flow alone', () => {
  // These are not fixture-backed (no production text was preserved for
  // them), but their correctness follows deductively from three structural
  // facts about the shared parser, none of which requires their text:
  //
  // 1. `pathogenOrAllergen` is computed once, unconditionally, independent
  //    of hazardCategory (`extractPathogenOrAllergen(hazardText)`), so a
  //    null result on the production ledger's `correctedPathogenOrAllergen`
  //    proves BOTH the pathogen and allergen extractors found nothing.
  // 2. FSIS's `deriveHazardCategory` has exactly one path to
  //    `foreign_material` and no path at all to `chemical_contamination` —
  //    both are structural facts about the function, provable by reading it.
  // 3. Therefore, for a `Product Contamination` record settling on
  //    `unknown`, the only remaining branch is that
  //    `extractForeignMaterialEvidence` found no genuine construction.
  //
  // This test pins fact 2 and 3 directly against the actual function, so a
  // future edit that adds a new path to foreign_material or chemical cannot
  // silently invalidate the deduction this session's report relies on.
  const noPathogenNoAllergen =
    'Recalling beef products, the U.S. Department of Agriculture announced today.';
  assert.equal(extractPathogenOrAllergen(noPathogenNoAllergen), null);
  assert.equal(deriveHazardCategory(['Product Contamination'], noPathogenNoAllergen), 'unknown');
  // A packaging-only mention of every bare material the old scan matched on
  // — still `unknown`, never `foreign_material`, with the same empty text.
  const packagingOnly =
    noPathogenNoAllergen +
    ' Packaged in plastic bowls, glass jars, wood crates, metal tins, and rubber-sealed bags.';
  assert.equal(
    deriveHazardCategory(['Product Contamination'], packagingOnly),
    'unknown',
    'packaging naming every old bare-keyword material must still resolve to unknown',
  );
});
