import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CaseProjection } from '@/domain/recall-types';
import {
  consumerActionDisplay,
  geographyDetail,
  geographyLabel,
  illnessDisplay,
  reasonLine,
  riskPresentation,
} from './recall-display';

test('risk presentation is concise, standardized, and never invents a class', () => {
  assert.deepEqual(riskPresentation('class_I'), {
    label: 'Class I · High risk',
    explanation: 'Serious health effects are possible.',
  });
  assert.deepEqual(riskPresentation('class_II'), {
    label: 'Class II · Lower risk',
    explanation: 'Health effects are possible, but unlikely.',
  });
  assert.deepEqual(riskPresentation('class_III'), {
    label: 'Class III · Low risk',
    explanation: 'Health problems are not expected.',
  });
  assert.equal(riskPresentation('class_I')?.label.includes('FSIS'), false);
  // Unclassified is shown honestly as pending, never blank or guessed.
  assert.equal(riskPresentation('not_yet_classified')?.label, 'Risk level pending');
  // PHAs must never be assigned a class.
  assert.equal(riskPresentation('not_applicable_pha'), null);
  assert.equal(riskPresentation('unexpected_value'), null);
});

test('reason line maps structured FSIS reasons to consumer wording', () => {
  assert.equal(
    reasonLine('Product Contamination', 'microbial_contamination', 'Salmonella'),
    'Possible Salmonella contamination',
  );
  assert.equal(
    reasonLine('Product Contamination', 'foreign_material', null),
    'Possible foreign material contamination',
  );
  assert.equal(reasonLine('Product Contamination', 'unknown', null), 'Possible contamination');
  assert.equal(
    reasonLine('Produced Without Benefit of Inspection', 'other_regulatory', null),
    'Produced without inspection',
  );
  assert.equal(reasonLine('Import Violation', 'other_regulatory', null), 'Import violation');
  // Multi-reason records (real: 006-2025) keep every reason.
  assert.equal(
    reasonLine('Misbranding, Unreported Allergens', 'allergen', 'undeclared milk'),
    'Misbranding · Undeclared milk',
  );
  assert.equal(reasonLine('Unreported Allergens', 'allergen', null), 'Undeclared allergen');
  // Unmapped reasons pass through verbatim — never weakened, never dropped.
  assert.equal(reasonLine('Some Future Reason', 'unknown', null), 'Some Future Reason');
  assert.equal(reasonLine(null, 'unknown', null), null);
});

test('illness display maps the three states to standardized consumer wording', () => {
  assert.deepEqual(
    illnessDisplay({ status: 'none_reported', statements: ['There have been no…'] }),
    {
      headline: 'No illnesses have been reported.',
      detail: null,
    },
  );
  const reported = illnessDisplay({
    status: 'reported',
    statements: ['As of July 25, 2024, 34 sick people have been identified in 13 states.'],
  });
  assert.equal(reported.headline, 'Illnesses have been reported.');
  assert.match(reported.detail ?? '', /34 sick people/);
  // Silence stays unknown — never "0".
  assert.deepEqual(illnessDisplay({ status: 'unknown', statements: [] }), {
    headline: 'No illness count is provided in this notice.',
    detail: null,
  });
});

test('equivalent consumer actions standardize; special actions survive', () => {
  // The dominant FSIS instruction (verbatim from real records).
  const standard = consumerActionDisplay(
    'Consumers who have purchased these products are urged not to consume them. These products should be thrown away or returned to the place of purchase.',
  );
  assert.equal(
    standard?.primary,
    'Do not eat this product. Throw it away or return it to the place of purchase.',
  );
  assert.equal(standard?.standardized, true);

  // Destroy-only instruction keeps its distinct meaning.
  const destroy = consumerActionDisplay(
    'Consumers are urged to destroy the product. Do not open the package.',
  );
  assert.equal(destroy?.primary, 'Do not eat this product. Destroy it.');

  // Retailer guidance is secondary, never the primary consumer action.
  const withRetail = consumerActionDisplay(
    'Consumers are urged not to consume these products and retailers are urged not to sell them. These products should be thrown away or returned to the place of purchase.',
  );
  assert.match(withRetail?.secondary ?? '', /should not sell or serve/);

  // Unrecognized instructions pass through verbatim (cleaned), not dropped.
  const special = consumerActionDisplay(
    'Consumers with weakened immune systems should consult a physician before handling this product.',
  );
  assert.equal(special?.standardized, false);
  assert.match(special?.primary ?? '', /consult a physician/);
  assert.equal(consumerActionDisplay(null), null);
});

test('geography stays honest in both compact and detail forms', () => {
  const states = (list: string[]): CaseProjection['geography'] => ({
    scope: 'states',
    states: list,
    confidence: 'stated',
    sourceText: null,
  });
  assert.equal(geographyLabel(states(['California'])), 'California');
  assert.equal(
    geographyLabel(states(['California', 'Nevada', 'Oregon'])),
    'California, Nevada, Oregon',
  );
  // Large sets compact on the card, full list in detail.
  const many = states(['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID']);
  assert.equal(geographyLabel(many), '12 states');
  assert.equal(geographyDetail(many), many.states.join(', '));
  assert.equal(
    geographyLabel({ scope: 'nationwide', states: [], confidence: 'stated', sourceText: null }),
    'Nationwide',
  );
  // Unknown is never converted to nationwide.
  const unknown: CaseProjection['geography'] = {
    scope: 'unknown',
    states: [],
    confidence: 'stated',
    sourceText: null,
  };
  assert.equal(geographyLabel(unknown), 'Distribution not specified');
  assert.ok(geographyDetail(unknown).startsWith('Distribution not specified'));
});
