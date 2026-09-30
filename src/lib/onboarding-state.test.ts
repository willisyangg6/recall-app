/**
 * The onboarding record and its transitions (P2B7X.1; restructured
 * 2026-09-28): the state machine a first launch resumes from, driven as
 * pure functions.
 *
 * What is proven: completion is a written FACT and never inferred from the
 * preference values (an empty optional list is complete); the shown step is
 * the resume point only while incomplete; completion never regresses; the
 * education is shown once and only after completion; the building
 * interstitial is sticky and never joins the back chain; a stored
 * version-1 record keeps the shopper's place while any other foreign blob
 * restarts onboarding rather than skipping it; States is the one step that
 * can refuse Continue.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EMPTY_PREFERENCES } from '@/domain/preferences';
import {
  canContinueFromStates,
  completeNotificationEducation,
  completePersonalization,
  completeWatchBuild,
  COUNTED_STEPS,
  INITIAL_ONBOARDING,
  isOptionalStep,
  nextStep,
  ONBOARDING_STEPS,
  previousStep,
  progressAccessibilityLabel,
  recordShownStep,
  resumeStep,
  sanitizeOnboardingRecord,
  segmentFillAnimates,
  stepProgress,
  type OnboardingRecord,
} from './onboarding-state';

// ── Steps and progress ──────────────────────────────────────────────────────

test('the sequence runs Welcome, the two problem screens, the selectors, the interstitial, Ready, the paywall', () => {
  assert.deepEqual(ONBOARDING_STEPS, [
    'welcome',
    'problem-scale',
    'problem-risk',
    'states',
    'allergens',
    'retailers',
    'building',
    'preview',
    'paywall',
  ]);
  // Five counted screens carry the segmented bar; Welcome, the building
  // interstitial, Ready and the paywall never do.
  assert.deepEqual(COUNTED_STEPS, [
    'problem-scale',
    'problem-risk',
    'states',
    'allergens',
    'retailers',
  ]);
  assert.equal(stepProgress('welcome'), null);
  assert.equal(stepProgress('building'), null);
  assert.equal(stepProgress('preview'), null);
  assert.equal(stepProgress('paywall'), null);
  assert.deepEqual(stepProgress('problem-scale'), { index: 1, total: 5 });
  assert.deepEqual(stepProgress('problem-risk'), { index: 2, total: 5 });
  assert.deepEqual(stepProgress('states'), { index: 3, total: 5 });
  assert.deepEqual(stepProgress('allergens'), { index: 4, total: 5 });
  assert.deepEqual(stepProgress('retailers'), { index: 5, total: 5 });
  // The count is spoken, never shown: there is no visible-label helper.
  assert.equal(
    progressAccessibilityLabel({ index: 3, total: 5 }),
    'Onboarding progress, step 3 of 5',
  );
});

test('next walks the flow; previous walks the BACK chain, which skips the interstitial', () => {
  assert.equal(nextStep('welcome'), 'problem-scale');
  assert.equal(nextStep('problem-risk'), 'states');
  assert.equal(nextStep('retailers'), 'building');
  assert.equal(nextStep('building'), 'preview');
  assert.equal(nextStep('paywall'), null);
  assert.equal(previousStep('welcome'), null);
  assert.equal(previousStep('problem-scale'), 'welcome');
  assert.equal(previousStep('states'), 'problem-risk');
  // Back from Ready goes to Stores — never to the spent interstitial — and
  // the interstitial itself resolves to Stores.
  assert.equal(previousStep('preview'), 'retailers');
  assert.equal(previousStep('building'), 'retailers');
  assert.equal(previousStep('paywall'), 'preview');
});

test('the current segment fills only when reached forward by one; otherwise the first frame is final', () => {
  // Forward, one step at a time: the newly current segment fills once.
  assert.equal(segmentFillAnimates(1, 2), true);
  assert.equal(segmentFillAnimates(4, 5), true);
  // First shown this process (a fresh launch or a resume): final at once.
  assert.equal(segmentFillAnimates(null, 1), false);
  assert.equal(segmentFillAnimates(null, 4), false);
  // Back, a re-entry, or a jump (Edit preferences from Ready): final at once.
  assert.equal(segmentFillAnimates(5, 4), false);
  assert.equal(segmentFillAnimates(3, 3), false);
  assert.equal(segmentFillAnimates(1, 3), false);
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
  record = recordShownStep(record, 'problem-scale');
  assert.equal(resumeStep(record), 'problem-scale');
  record = recordShownStep(record, 'states');
  assert.equal(resumeStep(record), 'states');
  record = recordShownStep(record, 'allergens');
  record = recordShownStep(record, 'retailers');
  assert.equal(resumeStep(record), 'retailers');
  // Back to Allergens: the exact screen showing is what a relaunch resumes.
  record = recordShownStep(record, 'allergens');
  assert.equal(resumeStep(record), 'allergens');
  // The paywall records itself too: a kill there resumes there.
  record = recordShownStep(record, 'paywall');
  assert.equal(resumeStep(record), 'paywall');
});

test('recording the same step returns the same reference, so nothing is rewritten', () => {
  const record = recordShownStep(INITIAL_ONBOARDING, 'states');
  assert.equal(recordShownStep(record, 'states'), record);
});

// ── The building interstitial ───────────────────────────────────────────────

test('the interstitial is sticky: it plays once, finishes a kill mid-play, and never replays', () => {
  // A kill DURING the play resumes on the interstitial, which finishes its
  // one play.
  const during = recordShownStep(INITIAL_ONBOARDING, 'building');
  assert.equal(during.watchBuilt, false);
  assert.equal(resumeStep(during), 'building');
  // Completed: sticky and idempotent, and a stale 'building' step can no
  // longer resume there.
  const built = completeWatchBuild(during);
  assert.equal(built.watchBuilt, true);
  assert.equal(completeWatchBuild(built), built);
  assert.equal(resumeStep(built), 'preview');
  // A shopper who resumed on Ready keeps resuming there.
  const onReady = recordShownStep(built, 'preview');
  assert.equal(resumeStep(onReady), 'preview');
});

test('once complete, a relaunch resumes on the paywall side: the record never regresses', () => {
  const done = completePersonalization(recordShownStep(INITIAL_ONBOARDING, 'preview'));
  // Editing preferences later walks the selectors again; the record is untouched.
  assert.equal(recordShownStep(done, 'states'), done);
  assert.equal(recordShownStep(done, 'welcome'), done);
  assert.equal(done.personalizationCompleted, true);
  // Completion implies the watch was built: nothing can replay the interstitial.
  assert.equal(done.watchBuilt, true);
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

test('a well-formed version-2 record round-trips exactly', () => {
  const record: OnboardingRecord = {
    version: 2,
    step: 'building',
    watchBuilt: false,
    personalizationCompleted: false,
    notificationEducationCompleted: false,
  };
  assert.deepEqual(sanitizeOnboardingRecord(JSON.parse(JSON.stringify(record))), record);
});

test('a well-formed version-1 record migrates and keeps the shopper’s place', () => {
  // Mid-selectors: the same step, and the interstitial still ahead of them.
  assert.deepEqual(
    sanitizeOnboardingRecord({
      version: 1,
      step: 'retailers',
      personalizationCompleted: false,
      notificationEducationCompleted: false,
    }),
    {
      version: 2,
      step: 'retailers',
      watchBuilt: false,
      personalizationCompleted: false,
      notificationEducationCompleted: false,
    },
  );
  // Already on the old Preview: never pulled back through the interstitial.
  assert.equal(
    sanitizeOnboardingRecord({
      version: 1,
      step: 'preview',
      personalizationCompleted: false,
      notificationEducationCompleted: false,
    }).watchBuilt,
    true,
  );
  // Finished: still finished, on either flag.
  assert.deepEqual(
    sanitizeOnboardingRecord({
      version: 1,
      step: 'preview',
      personalizationCompleted: true,
      notificationEducationCompleted: true,
    }),
    {
      version: 2,
      step: 'preview',
      watchBuilt: true,
      personalizationCompleted: true,
      notificationEducationCompleted: true,
    },
  );
});

test('an unknown, corrupt or future blob restarts onboarding — it never skips it', () => {
  for (const raw of [
    null,
    undefined,
    'complete',
    42,
    {},
    // A version-2 shape missing its own field.
    {
      version: 2,
      step: 'preview',
      personalizationCompleted: true,
      notificationEducationCompleted: true,
    },
    // A future version.
    {
      version: 3,
      step: 'preview',
      watchBuilt: true,
      personalizationCompleted: true,
      notificationEducationCompleted: true,
    },
    // A version-1 blob claiming a step version 1 never had.
    {
      version: 1,
      step: 'building',
      personalizationCompleted: false,
      notificationEducationCompleted: false,
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
