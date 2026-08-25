import assert from 'node:assert/strict';
import { test } from 'node:test';

import { caseRelevance, type RelevanceProfile } from './relevance';

const base = {
  sourceAgency: 'FDA' as const,
  pathogenOrAllergen: null as string | null,
  retailerNames: [] as string[],
  geography: {
    scope: 'states' as const,
    states: ['Texas'],
    confidence: 'inferred' as const,
    sourceText: null,
  },
};

const geo = (scope: 'states' | 'nationwide' | 'unknown', states: string[] = []) => ({
  scope,
  states,
  confidence: 'inferred' as const,
  sourceText: null,
});

test('geographic relevance follows architecture Part 5.3 semantics', () => {
  const profile: RelevanceProfile = { state: 'Texas' };
  assert.equal(caseRelevance(base, profile).geographic, 'affects_area');
  assert.equal(
    caseRelevance({ ...base, geography: geo('nationwide') }, profile).geographic,
    'affects_area',
  );
  // Unknown distribution is its own labeled category — never "not matched",
  // never silently excluded (a wrong "doesn't affect you" is dangerous).
  assert.equal(
    caseRelevance({ ...base, geography: geo('unknown') }, profile).geographic,
    'unknown_distribution',
  );
  assert.equal(
    caseRelevance({ ...base, geography: geo('states', ['Ohio']) }, profile).geographic,
    'not_matched',
  );
  // No state preference yet → nothing is claimed either way.
  assert.equal(caseRelevance(base, {}).geographic, 'unknown_distribution');
});

test('allergen and retailer preferences produce explicit signals, never guesses', () => {
  const item = {
    ...base,
    pathogenOrAllergen: 'undeclared eggs',
    retailerNames: ['Publix'],
  };
  const match = caseRelevance(item, { state: 'Texas', allergens: ['egg'], retailers: ['publix'] });
  assert.ok(match.signals.some((s) => /allergen preference: egg/.test(s)));
  assert.ok(match.signals.some((s) => /Sold at Publix/.test(s)));

  const noPrefs = caseRelevance(item, {});
  assert.ok(!noPrefs.signals.some((s) => /allergen|Sold at/.test(s)));

  // A pathogen never matches an allergen preference.
  const pathogen = caseRelevance(
    { ...item, pathogenOrAllergen: 'Salmonella' },
    { allergens: ['egg'] },
  );
  assert.ok(!pathogen.signals.some((s) => /allergen/.test(s)));
});
