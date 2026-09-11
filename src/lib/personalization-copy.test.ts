/**
 * The household-aware allergen copy is a product decision with exact wording
 * (C5.2B), so it is asserted character for character.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { ALLERGEN_SECTION_HELPER, ALLERGEN_SECTION_LABEL } from './personalization-copy';

test('the allergen preference copy is exactly the approved household wording', () => {
  assert.equal(ALLERGEN_SECTION_LABEL, 'Allergens to watch');
  assert.equal(
    ALLERGEN_SECTION_HELPER,
    'Select any allergens relevant to you or anyone you shop or cook for.',
  );
});

test('Settings renders that copy, and none of the wording it replaced', () => {
  const settings = readFileSync(
    path.join(__dirname, '..', 'app', 'settings', 'personalization.tsx'),
    'utf8',
  );
  assert.match(settings, /\{ALLERGEN_SECTION_LABEL\}/);
  assert.match(settings, /\{ALLERGEN_SECTION_HELPER\}/);
  // The pre-C5.2B wording spoke only to the person holding the phone.
  assert.doesNotMatch(settings, /Your allergens/);
});

test('the copy stays copy: no household data model came with it', () => {
  // A single shared allergen list, exactly as before — the preference shape is
  // asserted here so "household-aware" can never quietly become per-person
  // records, names, or a new stored field.
  const preferences = readFileSync(path.join(__dirname, '..', 'domain', 'preferences.ts'), 'utf8');
  assert.doesNotMatch(preferences, /\bhousehold\b|\bmembers?\b|\bprofiles?\b|\bfirstName\b/i);
  assert.match(preferences, /allergens: string\[\];/);
});
