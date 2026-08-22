import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildWhatHappened, normalizedUpdate, type WhatHappenedInput } from './what-happened';

// Inputs use verbatim titles/summary fragments from the recorded real FSIS
// fixtures (src/lib tests stay free of src/server imports; the same records
// run end-to-end in src/server/fsis/benchmark.test.ts).

function input(overrides: Partial<WhatHappenedInput>): WhatHappenedInput {
  return {
    title: 'Acme Foods Recalls Frozen Widget Products Due to Possible Contamination',
    noticeType: 'recall',
    reasonText: null,
    hazardCategory: 'unknown',
    pathogenOrAllergen: null,
    firmDisplayName: 'Acme Foods',
    summaryText: null,
    ...overrides,
  };
}

test('regression A — Gangothri: inspection template, no broken source lead-in', () => {
  const result = buildWhatHappened(
    input({
      title:
        'Indus Foods, LLC DBA Gangothri Foods Recalls Ready-To-Eat Pickled Goat and Chicken Products Produced Without Benefit of Inspection',
      reasonText: 'Produced Without Benefit of Inspection',
      hazardCategory: 'other_regulatory',
      firmDisplayName: 'Indus Foods, LLC DBA Gangothri Foods',
      summaryText:
        'WASHINGTON, Aug. 17, 2026 – Indus Foods, LLC, doing business as Gangothri Foods, an Austin, Tex. firm, is recalling approximately 1,626 pounds of ready-to-eat (RTE) pickled goat and chicken products that were produced without the benefit of inspection, the U.S. Department of Agriculture’s Food Safety and Inspection Service (FSIS) announced today.',
    }),
  );
  assert.equal(
    result.text,
    'Gangothri Foods recalled Ready-To-Eat Pickled Goat and Chicken products because the products were produced without required USDA inspection. The recall covers approximately 1,626 pounds of product.',
  );
  assert.equal(result.source, 'template');
  assert.doesNotMatch(result.text, /firm, is recalling/);
  assert.doesNotMatch(result.text, /announced today|Food Safety and Inspection Service/);
});

test('regression B — City Foods: pathogen template + Editor’s Note becomes a normalized update', () => {
  const result = buildWhatHappened(
    input({
      title:
        'City Foods, Inc. Recalls Ready-To-Eat Pastrami and Corned Beef Products Due To Possible Listeria Contamination',
      reasonText: 'Product Contamination',
      hazardCategory: 'microbial_contamination',
      pathogenOrAllergen: 'Listeria monocytogenes',
      firmDisplayName: "City Foods, Inc./Bea's Best Corned Beef",
      summaryText:
        'Editor’s Note: August 13, 2026 – This release has been revised to reflect the correct Midamar product label, the accurate number of pieces contained in each box, and item number reflected on the label.\nWASHINGTON, Aug. 8, 2026 – City Foods, Inc., a Chicago, Ill., establishment, is recalling approximately 3,215 pounds of ready-to-eat (RTE) pastrami and corned beef products.',
    }),
  );
  assert.match(
    result.text,
    /^City Foods recalled Ready-To-Eat Pastrami and Corned Beef products because the products may be contaminated with Listeria monocytogenes\./,
  );
  // The raw editorial paragraph never becomes the explanation.
  assert.doesNotMatch(result.text, /editor/i);
  assert.doesNotMatch(result.text, /has been revised/i);
  assert.equal(
    result.update,
    'Updated Aug 13, 2026: affected product and label details were corrected.',
  );
});

test('regression C — Corte Argentino: import template with source-stated origin, no boilerplate', () => {
  const result = buildWhatHappened(
    input({
      title:
        'Corte Argentino USA LLC Recalls Raw Beef Products Imported Without The Benefit Of Import Reinspection',
      reasonText: 'Import Violation',
      hazardCategory: 'other_regulatory',
      firmDisplayName: 'Corte Argentino USA LLC',
      summaryText:
        'WASHINGTON, Aug. 7, 2026 – Corte Argentino USA LLC, located in Aventura, Fla., is recalling approximately 29,628 pounds of raw beef products that were imported from Argentina without the benefit of import reinspection into the United States, the U.S. Department of Agriculture’s Food Safety and Inspection Service (FSIS) announced today.\nThe raw beef products were produced between May 15, 2026, and May 20, 2026, and have use or freeze-by dates between September 15, 2026, and September 20, 2026.',
    }),
  );
  assert.equal(
    result.text,
    'Corte Argentino USA recalled Raw Beef products because the products did not meet U.S. import requirements. The products were imported from Argentina.',
  );
  // Production/use-by scope stays in Check your package, not here.
  assert.doesNotMatch(result.text, /produced between|freeze-by|use or freeze/i);
  assert.doesNotMatch(result.text, /announced today|problem was discovered/i);
});

test('allergen template names the allergen only when the source states it', () => {
  const base = input({
    title:
      'FSIS Issues Public Health Alert for Steak Burrito Product Due to Misbranding and Undeclared Allergens',
    noticeType: 'public_health_alert',
    reasonText: 'Misbranding, Unreported Allergens',
    hazardCategory: 'allergen',
    firmDisplayName: "RED'S ALL NATURAL, LLC.",
  });
  const generic = buildWhatHappened(base);
  assert.equal(
    generic.text,
    "A public health alert was issued for Steak Burrito from Red's All Natural because the products may contain an undeclared allergen.",
  );
  const specific = buildWhatHappened({ ...base, pathogenOrAllergen: 'undeclared milk' });
  assert.match(specific.text, /may contain milk, an allergen that is not declared on the label\.$/);
});

test('ineligible-country import PHA (Ecuador shape)', () => {
  const result = buildWhatHappened(
    input({
      title: 'FSIS Issues Public Health Alert for Ineligible Pork Products Imported From Ecuador',
      noticeType: 'public_health_alert',
      reasonText: 'Import Violation',
      hazardCategory: 'other_regulatory',
      firmDisplayName: null,
      summaryText:
        'WASHINGTON, Dec. 2, 2024 – The U.S. Department of Agriculture’s Food Safety and Inspection Service (FSIS) is issuing a public health alert for frozen ready-to-eat pork mortadella products that may have been illegally imported from Ecuador, a country ineligible to export meat and poultry products to the United States.',
    }),
  );
  assert.equal(
    result.text,
    'A public health alert was issued for Ineligible Pork products because the products may have been illegally imported from Ecuador. Ecuador is not eligible to export these products to the United States.',
  );
});

test('upstream-ingredient PHA keeps the ingredient and uses the neutral contamination form', () => {
  const result = buildWhatHappened(
    input({
      title:
        'FSIS Issues Public Health Alert for Various Meat and Poultry Products Containing FDA-Regulated Jalapeños That Have Been Recalled Due To Possible Salmonella Contamination',
      noticeType: 'public_health_alert',
      reasonText: 'Product Contamination',
      hazardCategory: 'microbial_contamination',
      pathogenOrAllergen: 'Salmonella',
      firmDisplayName: null,
    }),
  );
  assert.equal(
    result.text,
    'A public health alert was issued for Various Meat and Poultry Products Containing Recalled FDA-Regulated Jalapeños because of possible Salmonella contamination.',
  );
});

test('companyless PHA uses the neutral frame — no company is forced or invented', () => {
  const result = buildWhatHappened(
    input({
      title:
        'FSIS Issues Public Health Alert for Ground Beef Due to Possible E. Coli O103 Contamination',
      noticeType: 'public_health_alert',
      reasonText: 'Product Contamination',
      hazardCategory: 'microbial_contamination',
      pathogenOrAllergen: 'E. coli',
      firmDisplayName: null,
    }),
  );
  assert.match(result.text, /^A public health alert was issued for Ground Beef because /);
});

test('editor-note normalization: classes, housekeeping omission, and unclassifiable omission', () => {
  assert.equal(
    normalizedUpdate(
      'Editor’s Note: Mar. 9, 2026 – The product list in this release has been updated to reflect that products with the listed lot numbers, regardless of best-by date, are subject to the recall.',
    ),
    'Updated Mar 9, 2026: affected product and label details were corrected.',
  );
  assert.equal(
    normalizedUpdate(
      'Editor’s Note: Feb. 9, 2024 – Details of this public health alert were updated to reflect additional products affected by the dairy products that have been recalled.',
    ),
    'Updated Feb 9, 2024: additional affected products were added.',
  );
  assert.equal(
    normalizedUpdate(
      'Editor’s Note : Whole genome sequencing results show that a liverwurst sample tested positive for the outbreak strain of Listeria monocytogenes.',
    ),
    'Update: laboratory testing linked product samples to the outbreak strain.',
  );
  // Contact-info housekeeping is omitted, not surfaced.
  assert.equal(
    normalizedUpdate(
      "EDITOR'S NOTE: Feb. 24, 2025 - Details of this recall release were updated to reflect updated contact information for consumers.",
    ),
    null,
  );
  // Unclassifiable notes are omitted rather than guessed at.
  assert.equal(normalizedUpdate('Editor’s Note: This release was reissued.'), null);
  assert.equal(normalizedUpdate('No note here at all.'), null);
});

test('unknown reason falls back to a generic product frame, then to the cleaned title', () => {
  const generic = buildWhatHappened(
    input({
      title: 'Acme Foods Recalls Frozen Widget Products Due to Possible Contamination',
      reasonText: 'Some Future Reason Value',
    }),
  );
  assert.equal(generic.source, 'generic');
  assert.equal(
    generic.text,
    'Acme Foods recalled Frozen Widget products because of some future reason value.',
  );

  const title = buildWhatHappened(
    input({ title: 'FSIS Announces Updated Labeling Guidance', firmDisplayName: null }),
  );
  assert.equal(title.source, 'title');
  assert.equal(title.text, 'FSIS Announces Updated Labeling Guidance');
});

test('retraction notices explain the retraction', () => {
  const result = buildWhatHappened(
    input({
      title:
        'FSIS Retracts Public Health Alert for Frozen, Ready-to-Eat Chicken Nuggets Due to Updated Laboratory Result',
      noticeType: 'public_health_alert',
      firmDisplayName: 'Dorada Foods',
    }),
  );
  assert.equal(
    result.text,
    'The public health alert for Frozen, Ready-to-Eat Chicken Nuggets was retracted because of an updated laboratory result.',
  );
});

test('summaries end with punctuation and respect the length budget', () => {
  const gangothri = buildWhatHappened(
    input({
      title:
        'Indus Foods, LLC DBA Gangothri Foods Recalls Ready-To-Eat Pickled Goat and Chicken Products Produced Without Benefit of Inspection',
      reasonText: 'Produced Without Benefit of Inspection',
    }),
  );
  assert.match(gangothri.text, /[.!?]$/);
  assert.ok(gangothri.text.split(/\s+/).length <= 70);
});
