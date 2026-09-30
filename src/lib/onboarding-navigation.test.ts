/**
 * The onboarding navigation rules, driven through a recording navigator:
 * Back is sequential however a step was reached, Stores' Continue reaches
 * the one-time interstitial only while the watch is unbuilt, the
 * interstitial replaces itself with Ready, and the development reset
 * genuinely returns a device to a state that shows the interstitial again.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  buildingDone,
  continueToPreview,
  goBackFrom,
  type StepNavigator,
} from './onboarding-navigation';
import {
  completeWatchBuild,
  INITIAL_ONBOARDING,
  recordShownStep,
  resumeStep,
} from './onboarding-state';

function recorder(canGoBack = false) {
  const calls: string[] = [];
  const nav: StepNavigator = {
    canGoBack: () => canGoBack,
    back: () => calls.push('back'),
    push: (href) => calls.push(`push ${href}`),
    replace: (href) => calls.push(`replace ${href}`),
    dismissTo: (href) => calls.push(`dismissTo ${href}`),
  };
  return { nav, calls };
}

test('Stores’ Continue plays the interstitial only while the watch is unbuilt', () => {
  const first = recorder();
  continueToPreview(false, false, first.nav);
  assert.deepEqual(first.calls, ['push /onboarding/building']);
  const built = recorder();
  continueToPreview(false, true, built.nav);
  assert.deepEqual(built.calls, ['push /onboarding/preview']);
  // Editing from Ready returns to the Ready beneath, whatever the flag.
  const editing = recorder();
  continueToPreview(true, false, editing.nav);
  assert.deepEqual(editing.calls, ['dismissTo /onboarding/preview']);
});

test('the interstitial replaces itself, and Back from Ready resolves to Stores', () => {
  const done = recorder();
  buildingDone(done.nav);
  assert.deepEqual(done.calls, ['replace /onboarding/preview']);
  // A resumed Ready (nothing beneath) goes back to Stores, never the interstitial.
  const resumed = recorder(false);
  goBackFrom('preview', resumed.nav);
  assert.deepEqual(resumed.calls, ['replace /onboarding/retailers']);
});

test('the development reset clears the one fact that hides the interstitial', () => {
  // A device that completed the interstitial skips it forever…
  const built = completeWatchBuild(recordShownStep(INITIAL_ONBOARDING, 'preview'));
  assert.equal(built.watchBuilt, true);
  // …and the reset writes the INITIAL record, whose watch is unbuilt, so a
  // fresh walk through Stores meets the interstitial again.
  assert.equal(INITIAL_ONBOARDING.watchBuilt, false);
  assert.equal(resumeStep(INITIAL_ONBOARDING), 'welcome');
  const controls = readFileSync(
    join(__dirname, '..', 'components', 'paywall', 'paywall-development-controls.tsx'),
    'utf8',
  );
  // The reset writes the INITIAL record and restarts the flow for real, even
  // from inside the onboarding phase, where no phase change would move it.
  assert.ok(controls.includes('await saveOnboardingRecord(INITIAL_ONBOARDING);'));
  assert.ok(controls.includes('if (router.canDismiss()) router.dismissAll();'));
  assert.ok(controls.includes('setTimeout(() => router.replace(href), 0);'));
  const fresh = recorder();
  continueToPreview(false, INITIAL_ONBOARDING.watchBuilt, fresh.nav);
  assert.deepEqual(fresh.calls, ['push /onboarding/building']);
});
