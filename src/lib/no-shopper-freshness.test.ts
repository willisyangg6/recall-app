/**
 * Ingestion freshness is OPERATIONS-ONLY (founder decision, 2026-09-19).
 *
 * Lotly never shows a shopper when recalls were last checked, never says
 * updates are delayed or stale, never says it could not refresh, and never
 * announces any of it. Whether ingestion is healthy is answered by the
 * dead-man heartbeat that pages the founder — not by the app talking to
 * shoppers about its own plumbing.
 *
 * P2B7S built that surface and then removed it. This file is what stops it
 * coming back by accident: it sweeps the ENTIRE shipped client bundle
 * rather than a named list of screens, so a freshness notice added to a
 * surface nobody thought of fails here too.
 *
 * What it deliberately does NOT forbid: the app's existing no-data error
 * state, and the operational machinery under `src/server/` and `scripts/`,
 * which is where freshness legitimately lives.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

const SRC = join(__dirname, '..');
const ROOT = join(SRC, '..');

/** Everything compiled into the app bundle; `server`/`scripts` are not. */
const CLIENT_DIRS = ['app', 'components', 'hooks', 'lib', 'constants', 'content', 'domain'];

function clientSources(): { path: string; source: string; code: string }[] {
  const files: { path: string; source: string; code: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
      const source = readFileSync(full, 'utf8');
      files.push({
        path: relative(SRC, full),
        source,
        // Statements only: a module may still DOCUMENT that it shows no
        // freshness, which is exactly what several of them now do.
        code: source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''),
      });
    }
  };
  for (const dir of CLIENT_DIRS) walk(join(SRC, dir));
  return files;
}

const CLIENT = clientSources();

test('the client scan is not empty, so it can never pass by scanning nothing', () => {
  assert.ok(CLIENT.length > 100, `only ${CLIENT.length} client sources found`);
});

test('no shipped client module references a freshness component or module', () => {
  for (const { path, code } of CLIENT) {
    for (const forbidden of [
      'FreshnessNotice',
      'freshness-notice',
      'freshnessNoticeCopy',
      'freshness-copy',
      'evaluateFreshness',
      'rendersNotice',
      'FreshnessReading',
      'FreshnessVerdict',
      'ServerFreshness',
      'fetchServerFreshness',
      'consumer_ingest_freshness',
    ]) {
      assert.ok(!code.includes(forbidden), `${path} references ${forbidden}`);
    }
  }
});

test('no freshness-specific sentence survives anywhere a shopper can read it', () => {
  // The exact sentences P2B7S shipped, plus the shapes they took. A new
  // one worded differently would still trip the vocabulary sweep below.
  const retired = [
    'Checked ',
    'last checked',
    'Last checked',
    'can’t confirm when recalls',
    "can't confirm when recalls",
    'Recall updates may be delayed',
    'Recall updates are running late',
    'couldn’t refresh just now',
    "couldn't refresh just now",
    'Showing the last complete update',
  ];
  // Code only. A module may still explain in prose that it deliberately
  // shows no "last checked" surface, and several now do; a comment cannot
  // render, so only statements can put a sentence in front of a shopper.
  for (const { path, code } of CLIENT) {
    for (const sentence of retired) {
      assert.ok(!code.includes(sentence), `${path} still carries "${sentence}"`);
    }
  }
});

test('Feed and Saved render no freshness element, spacer or wrapper', () => {
  // Not a hidden container, not an empty View, not an accessibility node.
  for (const name of ['index.tsx', 'saved.tsx'] as const) {
    const screen = readFileSync(join(SRC, 'app', '(tabs)', name), 'utf8');
    const code = screen.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ['Freshness', 'freshness', 'staleMessage', 'FEED_STALE_NOTICE']) {
      assert.ok(!code.includes(forbidden), `${name} references ${forbidden}`);
    }
  }
});

test('Detail, Profile and the settings screens are freshness-free', () => {
  for (const parts of [
    ['app', 'recall', '[id].tsx'],
    ['app', '(tabs)', 'profile.tsx'],
    ['app', 'settings', 'index.tsx'],
    ['app', 'settings', 'notifications.tsx'],
  ] as const) {
    const source = readFileSync(join(SRC, ...parts), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/freshness/i.test(code), `${parts.join('/')} references freshness`);
  }
});

test('no shipped module owns a freshness live region or an ageing timer', () => {
  // The notice was the only polite live region introduced by P2B7S, and
  // the ageing interval existed only to keep its sentence current.
  for (const { path, code } of CLIENT) {
    if (!/freshness/i.test(code)) continue;
    assert.fail(`${path} still contains freshness logic`);
  }
  // The one surviving interval-free guarantee worth pinning explicitly.
  const hook = readFileSync(join(SRC, 'hooks', 'use-feed.ts'), 'utf8');
  assert.ok(!hook.includes('setInterval'), 'the feed hook regained an ageing timer');
});

test('the Design Preview freshness gallery is gone', () => {
  const hub = readFileSync(join(SRC, 'app', 'design-preview', 'index.tsx'), 'utf8');
  for (const forbidden of [
    'FreshnessGallery',
    'FRESHNESS TREATMENTS',
    'HIDDEN IN PRODUCTION',
    'renders nothing',
  ]) {
    assert.ok(!hub.includes(forbidden), `the hub still has ${forbidden}`);
  }
});

test('the client makes no freshness request and stores no freshness metadata', () => {
  // Nothing on the device reads it, so fetching or caching it would be
  // dead weight on every sync and in every cached document.
  const feed = readFileSync(join(SRC, 'lib', 'recall-feed.ts'), 'utf8');
  assert.ok(!feed.includes('consumer_ingest_freshness'));
  assert.ok(!feed.includes('fetchServerFreshness'));
  const sync = readFileSync(join(SRC, 'lib', 'feed-sync.ts'), 'utf8');
  const syncCode = sync.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!syncCode.includes('fetchFreshness'), 'the sync transport still requests freshness');
  const cache = readFileSync(join(SRC, 'lib', 'feed-cache.ts'), 'utf8');
  const cacheCode = cache.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!cacheCode.includes('freshness'), 'the cache document still stores freshness');
  // The document shape is v2's again, so the version stayed at 2 rather
  // than advancing to a number whose shape would be identical — which
  // would have cost every device a cold reload for nothing.
  assert.match(cacheCode, /FEED_CACHE_SCHEMA_VERSION = 2;/);
});

test('the consumer-facing freshness migration is gone, and nothing references it', () => {
  // The heartbeat reads `ingest_runs` directly with the service role it
  // already holds, so no database projection is needed; an anonymously
  // readable view with no consumer would be a public surface for nothing.
  const migrations = readdirSync(join(ROOT, 'supabase', 'migrations'));
  assert.ok(
    !migrations.some((name) => name.includes('consumer_ingest_freshness')),
    'the unused consumer-facing freshness migration is still present',
  );
});

test('the operational side is untouched: the heartbeat still owns freshness', () => {
  // This file forbids freshness in the CLIENT. Operations is where it
  // belongs, and removing it there would silently disable monitoring.
  const heartbeat = readFileSync(join(SRC, 'server', 'watchdog', 'heartbeat.ts'), 'utf8');
  assert.match(heartbeat, /export const HEARTBEAT_SLO_MINUTES = 90;/);
  assert.match(heartbeat, /export function planHeartbeat/);
  const script = readFileSync(join(ROOT, 'scripts', 'ops-heartbeat.ts'), 'utf8');
  assert.match(script, /\.from\('ingest_runs'\)/);
});
