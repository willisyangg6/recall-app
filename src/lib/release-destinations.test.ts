/**
 * Release destinations (P2B7X.1): typed, a launch-readiness failure while
 * any is absent or invalid, and (2026-10-14) supplied as Lotly's website.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  POLICY_LINKS,
  destinationAction,
  isValidHttpsDestination,
  launchReadinessFailures,
  RELEASE_DESTINATIONS,
  type ReleaseDestinations,
} from './release-destinations';

const ROOT = join(__dirname, '..', '..');

test('every destination is a real HTTPS URL on the published website, never invented', () => {
  assert.deepEqual(Object.keys(RELEASE_DESTINATIONS).sort(), ['privacy', 'support', 'terms']);
  for (const [key, value] of Object.entries(RELEASE_DESTINATIONS)) {
    assert.ok(value === null || isValidHttpsDestination(value), `${key} is set to an invalid URL`);
  }
});

test('a valid destination is HTTPS on a real host; placeholders and plain HTTP are refused', () => {
  assert.equal(isValidHttpsDestination('https://lotly.app/privacy'), true);
  assert.equal(isValidHttpsDestination('https://support.lotly.app/'), true);
  for (const bad of [
    null,
    '',
    'lotly.app/privacy',
    'http://lotly.app/privacy',
    'https://example.com/privacy',
    'https://www.example.org/terms',
    'https://localhost/terms',
    'https://lotly.test/terms',
    'https://lotly/terms',
    'mailto:support@lotly.app',
  ]) {
    assert.equal(isValidHttpsDestination(bad), false, String(bad));
  }
});

test('the supplied destinations are the website pages, and launch readiness passes', () => {
  assert.deepEqual(RELEASE_DESTINATIONS, {
    terms: 'https://lotly.pages.dev/terms/',
    privacy: 'https://lotly.pages.dev/privacy/',
    support: 'https://lotly.pages.dev/support/',
  });
  assert.deepEqual(POLICY_LINKS, {
    privacy: 'https://lotly.pages.dev/privacy/',
    consumerHealthData: 'https://lotly.pages.dev/consumer-health-data/',
    terms: 'https://lotly.pages.dev/terms/',
  });
  for (const url of Object.values(POLICY_LINKS)) assert.equal(isValidHttpsDestination(url), true);
  assert.deepEqual(launchReadinessFailures(), []);
});

test('launch readiness fails while any destination is absent, and names each one', () => {
  const failures = launchReadinessFailures({ terms: null, privacy: null, support: null });
  assert.equal(failures.length, 3);
  assert.match(failures[0], /^Terms destination is not configured/);
  assert.match(failures[1], /^Privacy destination is not configured/);
  assert.match(failures[2], /^Support destination is not configured/);
  const partial: ReleaseDestinations = {
    terms: 'https://lotly.app/terms',
    privacy: 'https://example.com/privacy',
    support: null,
  };
  const partialFailures = launchReadinessFailures(partial);
  assert.equal(partialFailures.length, 2);
  assert.match(partialFailures[0], /^Privacy destination is not a valid HTTPS URL/);
  assert.match(partialFailures[1], /^Support destination is not configured/);
  assert.deepEqual(
    launchReadinessFailures({
      terms: 'https://lotly.app/terms',
      privacy: 'https://lotly.app/privacy',
      support: 'https://lotly.app/support',
    }),
    [],
  );
});

test('the paywall opens a configured destination and reports an unconfigured one — never a dead link', () => {
  assert.deepEqual(destinationAction('terms'), {
    kind: 'open',
    url: 'https://lotly.pages.dev/terms/',
  });
  assert.deepEqual(destinationAction('terms', { terms: null, privacy: null, support: null }), {
    kind: 'unconfigured',
  });
  assert.deepEqual(
    destinationAction('terms', { terms: 'https://lotly.app/terms', privacy: null, support: null }),
    { kind: 'open', url: 'https://lotly.app/terms' },
  );
  assert.deepEqual(
    destinationAction('terms', {
      terms: 'https://example.com/terms',
      privacy: null,
      support: null,
    }),
    { kind: 'unconfigured' },
  );
});

test('the launch-readiness command exists, is offline, and exits non-zero on a failure', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  assert.equal(pkg.scripts['qa:launch-readiness'], 'tsx scripts/qa-launch-readiness.ts');
  const script = readFileSync(join(ROOT, 'scripts', 'qa-launch-readiness.ts'), 'utf8');
  assert.ok(script.includes('launchReadinessFailures'));
  assert.ok(script.includes('process.exitCode = 1'));
  for (const forbidden of ['fetch(', 'supabase', 'SUPABASE', 'process.env']) {
    assert.ok(!script.includes(forbidden), `the readiness check reaches ${forbidden}`);
  }
});

test('the destinations are not environment variables: the client’s public variable set is unchanged', () => {
  const source = readFileSync(join(__dirname, 'release-destinations.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  assert.ok(!source.includes('process.env'));
  assert.ok(!source.includes('EXPO_PUBLIC_'));
});
