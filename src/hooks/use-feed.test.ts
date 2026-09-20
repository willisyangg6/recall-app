/**
 * The feed hook's wiring, and the absence of everything P2B7S briefly put
 * on top of it.
 *
 * The BEHAVIOUR — coalescing, the threshold, joining an in-flight sync,
 * measuring from the last success, clock jumps — is tested directly against
 * the session in lib/feed-sync.test.ts, where it is pure and every case is
 * a plain unit test. What can only be checked here is that the hook
 * delegates to that session rather than reimplementing any of it, that its
 * subscriptions are torn down, and that it exposes no freshness surface.
 *
 * Asserted against the source for the same reason the workflow and screen
 * contracts are: this repository has no React renderer in its test
 * dependencies, and adding one to assert "the effect calls remove()" would
 * be new verification infrastructure for a nine-line effect.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { FOREGROUND_REVALIDATE_AFTER_MINUTES } from '@/lib/feed-sync';

const HOOK = readFileSync(join(__dirname, 'use-feed.ts'), 'utf8');
const CODE = HOOK.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the app has exactly one feed session, created once per process', () => {
  // Two sessions would mean two caches, two reconciliations and duplicate
  // request storms on every tab switch.
  assert.match(CODE, /let feedSession: FeedSession \| null = null;/);
  assert.equal([...CODE.matchAll(/createFeedSession\(/g)].length, 1);
});

test('foreground revalidation is subscribed to AppState and unsubscribed on teardown', () => {
  // A listener that outlives its effect accumulates on every hot reload in
  // development and on every remount in production.
  assert.match(CODE, /AppState\.addEventListener\('change', onChange\)/);
  assert.match(CODE, /return \(\) => subscription\.remove\(\);/);
  assert.equal([...CODE.matchAll(/addEventListener\(/g)].length, 1);
});

test('only a transition INTO active is considered a foreground return', () => {
  assert.match(CODE, /if \(next !== 'active'\) return;/);
});

test('the hook delegates the threshold decision, and uses the centralized value', () => {
  // No second threshold, no second debounce, no second coalescing rule.
  assert.match(CODE, /syncIfOlderThan\(maxAgeMs\)/);
  assert.match(CODE, /FOREGROUND_REVALIDATE_AFTER_MINUTES \* 60_000/);
  assert.equal(FOREGROUND_REVALIDATE_AFTER_MINUTES, 15);
  assert.ok(!/setTimeout|debounce|lastForeground/.test(CODE), 'the hook re-implements debouncing');
});

test('a skipped foreground changes no state at all', () => {
  assert.match(CODE, /if \(outcome === null\) return;/);
});

test('cold launch renders the cache first and then revalidates', () => {
  // The cached corpus fills a not-yet-ready state, so the list never
  // flashes empty while a revalidation is in flight.
  assert.match(CODE, /\.getCached\(\)/);
  assert.match(
    CODE,
    /current\.status === 'ready' \? current : \{ status: 'ready', items: cachedItems \}/,
  );
  assert.match(CODE, /void revalidate\(\);/);
});

test('pull-to-refresh runs a real reconciliation through the same session', () => {
  assert.match(CODE, /const refresh = useCallback\(async \(\) => \{\n\s+setRefreshing\(true\);/);
  assert.match(CODE, /await revalidate\(\);/);
});

// ── A failed refresh over a usable corpus is SILENT ────────────────────────

test('a failed refresh keeps the cached corpus and says nothing', () => {
  // Founder decision: shoppers are never told about ingestion state. The
  // catch keeps the corpus and sets no message, banner or flag of any kind.
  const failure = CODE.slice(CODE.indexOf('} catch (error) {'));
  const body = failure.slice(0, failure.indexOf('}, []);'));
  assert.match(body, /current\.status === 'ready' \? current :/);
  assert.ok(!/setStaleMessage|setRefreshFailed|staleMessage/.test(body), 'a stale flag survived');
});

test('a failed FOREGROUND refresh changes nothing on screen at all', () => {
  const branch = CODE.slice(CODE.indexOf('.catch((error: unknown)'));
  const body = branch.slice(0, branch.indexOf('};'));
  assert.ok(!body.includes('setState('), 'a failed foreground touched the corpus');
  assert.ok(!/status: 'error'/.test(body), 'a failed foreground blanked the feed');
  // Only the developer console learns about it.
  assert.match(body, /console\.warn/);
});

test('a sync failure with NOTHING loaded still becomes the honest error state', () => {
  // The one surviving failure surface. An empty list would otherwise read
  // as "there are no current recalls", which is false.
  assert.match(CODE, /\{ status: 'error', message: FEED_LOAD_FAILURE \}/);
});

// ── No freshness surface survives ──────────────────────────────────────────

test('the hook exposes no freshness, staleness or last-checked value', () => {
  assert.match(CODE, /return \{ state, refreshing, refresh \};/);
  assert.match(
    CODE,
    /export interface Feed \{\n\s+state: FeedLoadState;\n\s+refreshing: boolean;\n\s+refresh: \(\) => Promise<void>;\n\}/,
  );
});

test('the hook holds no freshness state, no clock and no ageing timer', () => {
  for (const forbidden of [
    'freshness',
    'Freshness',
    'snapshot',
    'settled',
    'refreshFailed',
    'staleMessage',
    'nowMs',
    'setInterval',
    'Date.now()',
  ]) {
    assert.ok(!CODE.includes(forbidden), `the hook still carries ${forbidden}`);
  }
});

test('the hook reads no environment directly', () => {
  assert.ok(!/process\.env/.test(CODE), 'the hook reads the environment directly');
});
