/**
 * Structural integrity of the C7 trust center: no dead Profile destinations,
 * no unfinished policy exposed in the app, and the "no advertising/tracking"
 * claim proven against the actual dependency graph rather than asserted.
 *
 * Route-source assertions read the route files as text, the same approach as
 * profile-structure.test.ts.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { RESET_ACTION_LABEL } from '@/lib/installation-reset';
import { documentPlainText } from './document-model';
import { documentBySlug, PROFILE_DOCUMENT_GROUPS, TRUST_DOCUMENTS } from './index';

const ROOT = join(__dirname, '..', '..');
const APP = join(ROOT, 'src', 'app');
const read = (...parts: string[]): string => readFileSync(join(APP, ...parts), 'utf8');

test('every Profile group slug resolves to a registered document — no dead destinations', () => {
  for (const group of PROFILE_DOCUMENT_GROUPS) {
    for (const slug of group.slugs) {
      assert.ok(documentBySlug(slug), `Profile group "${group.title}" links unknown slug ${slug}`);
    }
  }
});

test('every registered document is reachable from Profile exactly once', () => {
  const grouped = PROFILE_DOCUMENT_GROUPS.flatMap((group) => [...group.slugs]);
  assert.deepEqual(
    [...grouped].sort(),
    TRUST_DOCUMENTS.map((doc) => doc.slug).sort(),
    'registry and Profile grouping must cover the same documents',
  );
  assert.equal(new Set(grouped).size, grouped.length, 'a document may appear in only one group');
});

test('the document route exists, is registered, and Profile renders the registry grouping', () => {
  assert.ok(existsSync(join(APP, 'document', '[slug].tsx')), 'document screen missing');
  assert.ok(read('_layout.tsx').includes('name="document/[slug]"'), 'route not in the stack');
  const profile = read('profile.tsx');
  assert.ok(profile.includes('PROFILE_DOCUMENT_GROUPS'), 'Profile must render the registry');
  assert.ok(profile.includes("pathname: '/document/[slug]'"), 'Profile must link documents');
  // The settings rows survive untouched alongside the trust center.
  assert.ok(profile.includes('href="/settings"'));
});

test('no unfinished Privacy Policy or Terms is exposed in the app', () => {
  // The registry may not contain them until their blockers are resolved.
  assert.equal(documentBySlug('privacy-policy'), undefined);
  assert.equal(documentBySlug('terms'), undefined);
  for (const doc of TRUST_DOCUMENTS) {
    assert.ok(
      !/^(privacy policy|terms)/i.test(doc.title),
      `"${doc.title}" must not be exposed while its founder/legal inputs are unresolved`,
    );
  }
  const profile = read('profile.tsx');
  assert.ok(!profile.includes('privacy-policy'), 'Profile must not link a Privacy Policy row');
});

test('no document contains unresolved placeholders or invented contact points', () => {
  for (const doc of TRUST_DOCUMENTS) {
    const text = documentPlainText(doc);
    for (const marker of ['TODO', 'TBD', 'PLACEHOLDER', 'FIXME', 'Lorem', 'example.com', '[[']) {
      assert.ok(!text.includes(marker), `${doc.slug} contains placeholder marker "${marker}"`);
    }
    // No invented emails, phone numbers, or domains: no real contact
    // destination exists yet, so none may be claimed.
    assert.doesNotMatch(text, /@[a-z0-9-]+\.[a-z]{2,}/i, `${doc.slug} invents an email address`);
    assert.doesNotMatch(text, /\b\d{3}-\d{3}-\d{4}\b/, `${doc.slug} invents a phone number`);
  }
});

test('external links in documents point only at official government sources', () => {
  for (const doc of TRUST_DOCUMENTS) {
    for (const section of doc.sections) {
      for (const block of section.blocks) {
        if (block.kind !== 'link') continue;
        assert.match(
          block.url,
          /^https:\/\/(www\.)?(fda\.gov|open\.fda\.gov|fsis\.usda\.gov|usda\.gov)\//,
          `${doc.slug} links to a non-official destination: ${block.url}`,
        );
      }
    }
  }
});

test('the no-advertising/no-tracking claim is proven by the dependency graph', () => {
  const privacy = documentBySlug('privacy-data-controls');
  assert.ok(privacy);
  const text = documentPlainText(privacy);
  assert.match(text, /No analytics, advertising, or crash-reporting SDKs/i);
  assert.match(text, /no tracking across apps/i);

  // The claim is only makeable while the FULL dependency lock stays free of
  // analytics/advertising/crash SDKs. Adding one fails this test, forcing the
  // document (and the App Store privacy answers) to change with it.
  const lock = readFileSync(join(ROOT, 'package-lock.json'), 'utf8').toLowerCase();
  for (const banned of [
    'sentry',
    'crashlytics',
    'firebase',
    'amplitude',
    'mixpanel',
    'appsflyer',
    'adjust-sdk',
    'branch-sdk',
    'google-analytics',
    'segment/analytics',
    'facebook-sdk',
    'bugsnag',
    'datadog',
    'posthog',
  ]) {
    assert.ok(!lock.includes(banned), `dependency lock contains "${banned}" — claim now false`);
  }
});

test('the data-reset control the document describes actually ships, under its exact label (C7.1)', () => {
  const privacy = documentBySlug('privacy-data-controls');
  assert.ok(privacy);
  const text = documentPlainText(privacy);
  // The document names the control by its frozen label — imported from the
  // same constant the UI renders, and pinned here to the frozen wording.
  assert.equal(RESET_ACTION_LABEL, 'Reset app and delete my data');
  assert.ok(text.includes(RESET_ACTION_LABEL));
  // Honest scope: what it deletes, what it cannot reach, and that uninstalling
  // alone is not a deletion request.
  assert.match(text, /preference mirror, the push registration, and its alert delivery records/);
  assert.match(text, /outside what the app can delete directly/);
  assert.match(text, /Uninstalling the app alone is not treated as a request to delete/);
  // Failure honesty: a failed deletion changes nothing and is retryable.
  assert.match(text, /nothing is changed on this device either/);
});

test('exactly one deletion action exists — on Privacy & Data Controls, nowhere else (C7.1)', () => {
  // The document screen mounts the destructive section for the privacy slug
  // and only that slug.
  const documentScreen = read('document', '[slug].tsx');
  assert.match(
    documentScreen,
    /doc\.slug === 'privacy-data-controls' \? <InstallationResetSection \/> : null/,
  );
  // Profile gains no extra row and no redundant prominent personalization
  // reset; Home and Settings don't grow one either.
  for (const file of ['profile.tsx', 'index.tsx', 'settings.tsx']) {
    const source = read(file);
    assert.ok(!source.includes('InstallationResetSection'), `${file} must not mount the reset`);
    assert.ok(!source.includes(RESET_ACTION_LABEL), `${file} must not duplicate the action`);
    assert.doesNotMatch(source, /Clear all selections/i, `${file} adds an out-of-scope reset`);
  }
  // The reset introduces no account, household, or authentication concept.
  const resetSources = [
    readFileSync(join(ROOT, 'src', 'lib', 'installation-reset.ts'), 'utf8'),
    readFileSync(join(ROOT, 'src', 'lib', 'installation-reset-runner.ts'), 'utf8'),
    readFileSync(join(ROOT, 'src', 'components', 'installation-reset-section.tsx'), 'utf8'),
  ];
  for (const source of resetSources) {
    for (const forbidden of ['account', 'household', 'email', 'password', 'displayName']) {
      assert.ok(
        !source.toLowerCase().includes(forbidden.toLowerCase()),
        `reset implementation references ${forbidden}`,
      );
    }
  }
});
