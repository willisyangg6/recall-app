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
  // Reworded by the founder in the P2B6A follow-up (DESIGN.md "Consumer
  // copy"); the household intent, "someone you shop for", is kept.
  assert.equal(
    ALLERGEN_SECTION_HELPER,
    'Choose any allergens that matter to you or someone you shop for.',
  );
});

test('Settings renders that copy, and none of the wording it replaced', () => {
  // The Personalization route draws its sections from components/settings
  // (P2B6A); the allergen section is where the copy is rendered.
  const settings =
    readFileSync(path.join(__dirname, '..', 'app', 'settings', 'personalization.tsx'), 'utf8') +
    '\n' +
    readFileSync(
      path.join(__dirname, '..', 'components', 'settings', 'personalization-form.tsx'),
      'utf8',
    );
  assert.match(settings, /\{ALLERGEN_SECTION_LABEL\}/);
  assert.match(settings, /\{ALLERGEN_SECTION_HELPER\}/);
  // The pre-C5.2B wording spoke only to the person holding the phone, and
  // the pre-follow-up wording is not retyped anywhere either.
  assert.doesNotMatch(settings, /Your allergens/);
  assert.doesNotMatch(settings, /shop or cook for/);
});

test('the copy stays copy: no household data model came with it', () => {
  // A single shared allergen list, exactly as before — the preference shape is
  // asserted here so "household-aware" can never quietly become per-person
  // records, names, or a new stored field.
  const preferences = readFileSync(path.join(__dirname, '..', 'domain', 'preferences.ts'), 'utf8');
  assert.doesNotMatch(preferences, /\bhousehold\b|\bmembers?\b|\bprofiles?\b|\bfirstName\b/i);
  assert.match(preferences, /allergens: string\[\];/);
});
