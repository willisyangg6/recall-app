/**
 * The onboarding record and its transitions (P2B7X.1): the state machine a
 * first launch resumes from, driven as pure functions.
 *
 * What is proven: completion is a written FACT and never inferred from the
 * preference values (an empty optional list is complete); the shown step is
 * the resume point only while incomplete; completion never regresses; the
 * education is shown once and only after completion; a stored blob of any
 * other shape restarts onboarding rather than skipping it; States is the one
 * step that can refuse Continue.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EMPTY_PREFERENCES } from '@/domain/preferences';
import {
  canContinueFromStates,
  completeNotificationEducation,
  completePersonalization,
  COUNTED_STEPS,
  INITIAL_ONBOARDING,
  isOptionalStep,
  nextStep,
  ONBOARDING_STEPS,
  previousStep,
  progressLabel,
  recordShownStep,
  resumeStep,
  sanitizeOnboardingRecord,
  stepProgress,
  type OnboardingRecord,
} from './onboarding-state';

// ── Steps and progress ──────────────────────────────────────────────────────

test('the sequence is Welcome, States, Allergens, Retailers, Preview; Welcome is not counted', () => {
  assert.deepEqual(ONBOARDING_STEPS, ['welcome', 'states', 'allergens', 'retailers', 'preview']);
  assert.deepEqual(COUNTED_STEPS, ['states', 'allergens', 'retailers', 'preview']);
  assert.equal(stepProgress('welcome'), null);
  assert.deepEqual(stepProgress('states'), { index: 1, total: 4 });
  assert.deepEqual(stepProgress('allergens'), { index: 2, total: 4 });
  assert.deepEqual(stepProgress('retailers'), { index: 3, total: 4 });
  assert.deepEqual(stepProgress('preview'), { index: 4, total: 4 });
  assert.equal(progressLabel({ index: 1, total: 4 }), '1 of 4');
  assert.equal(progressLabel({ index: 4, total: 4 }), '4 of 4');
});

test('next and previous walk the sequence and stop at its ends', () => {
  assert.equal(nextStep('welcome'), 'states');
  assert.equal(nextStep('retailers'), 'preview');
  assert.equal(nextStep('preview'), null);
  assert.equal(previousStep('welcome'), null);
  assert.equal(previousStep('states'), 'welcome');
  assert.equal(previousStep('preview'), 'retailers');
});

// ── Completion is a fact, never an inference ────────────────────────────────

test('an empty optional preference is NOT an incomplete step: completion lives in the record alone', () => {
  // A shopper with no allergens and no stores has exactly the empty
  // preference bytes a never-onboarded device has. Only the record tells them
  // apart — and nothing in this module reads preferences to decide it.
  const fresh = INITIAL_ONBOARDING;
  const done = completePersonalization(fresh);
  assert.equal(fresh.personalizationCompleted, false);
  assert.equal(done.personalizationCompleted, true);
  assert.deepEqual(EMPTY_PREFERENCES.allergens, []);
  assert.deepEqual(EMPTY_PREFERENCES.retailers, []);
  assert.equal(isOptionalStep('allergens'), true);
  assert.equal(isOptionalStep('retailers'), true);
  assert.equal(isOptionalStep('states'), false);
});

test('States requires at least one selection; nothing else is required', () => {
  assert.equal(canContinueFromStates([]), false);
  assert.equal(canContinueFromStates(['CA']), true);
  assert.equal(canContinueFromStates(['CA', 'NY']), true);
});

// ── The resume point ────────────────────────────────────────────────────────

test('the shown step becomes the resume point while incomplete, forwards AND backwards', () => {
  let record = INITIAL_ONBOARDING;
  record = recordShownStep(record, 'states');
  assert.equal(resumeStep(record), 'states');
  record = recordShownStep(record, 'allergens');
  record = recordShownStep(record, 'retailers');
  assert.equal(resumeStep(record), 'retailers');
  // Back to Allergens: the exact screen showing is what a relaunch resumes.
  record = recordShownStep(record, 'allergens');
  assert.equal(resumeStep(record), 'allergens');
});

test('recording the same step returns the same reference, so nothing is rewritten', () => {
  const record = recordShownStep(INITIAL_ONBOARDING, 'states');
  assert.equal(recordShownStep(record, 'states'), record);
});

test('once complete, a relaunch resumes on the paywall side: the record never regresses', () => {
  const done = completePersonalization(recordShownStep(INITIAL_ONBOARDING, 'preview'));
  // Editing preferences later walks the selectors again; the record is untouched.
  assert.equal(recordShownStep(done, 'states'), done);
  assert.equal(recordShownStep(done, 'welcome'), done);
  assert.equal(done.personalizationCompleted, true);
  assert.equal(resumeStep(done), 'preview');
  // Completing twice is idempotent.
  assert.equal(completePersonalization(done), done);
});

// ── Education, once, after completion ───────────────────────────────────────

test('notification education completes once and only after personalization', () => {
  assert.equal(completeNotificationEducation(INITIAL_ONBOARDING), INITIAL_ONBOARDING);
  const done = completePersonalization(INITIAL_ONBOARDING);
  const educated = completeNotificationEducation(done);
  assert.equal(educated.notificationEducationCompleted, true);
  assert.equal(completeNotificationEducation(educated), educated);
});

// ── The stored shape ────────────────────────────────────────────────────────

test('a well-formed version-1 record round-trips exactly', () => {
  const record: OnboardingRecord = {
    version: 1,
    step: 'retailers',
    personalizationCompleted: false,
    notificationEducationCompleted: false,
  };
  assert.deepEqual(sanitizeOnboardingRecord(JSON.parse(JSON.stringify(record))), record);
});

test('an unknown, corrupt or future blob restarts onboarding — it never skips it', () => {
  for (const raw of [
    null,
    undefined,
    'complete',
    42,
    {},
    {
      version: 2,
      step: 'preview',
      personalizationCompleted: true,
      notificationEducationCompleted: true,
    },
    {
      version: 1,
      step: 'checkout',
      personalizationCompleted: true,
      notificationEducationCompleted: true,
    },
    {
      version: 1,
      step: 'preview',
      personalizationCompleted: 'yes',
      notificationEducationCompleted: true,
    },
    { version: 1, step: 'preview', personalizationCompleted: true },
  ]) {
    assert.deepEqual(sanitizeOnboardingRecord(raw), INITIAL_ONBOARDING, JSON.stringify(raw));
  }
});

test('education cannot be recorded as complete on an incomplete personalization', () => {
  const blob = {
    version: 1,
    step: 'states',
    personalizationCompleted: false,
    notificationEducationCompleted: true,
  };
  assert.equal(sanitizeOnboardingRecord(blob).notificationEducationCompleted, false);
});
