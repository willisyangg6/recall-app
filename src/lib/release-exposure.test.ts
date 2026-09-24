/**
 * What a RELEASE build is allowed to contain (P3C1).
 *
 * Two boundaries the app bundle must never cross, pinned structurally over
 * the real source tree rather than over a list someone remembered to update:
 *
 *   1. **Configuration.** Metro inlines `process.env.EXPO_PUBLIC_*` into the
 *      shipped bundle and nothing else, so a server secret can only reach a
 *      shopper's phone by being read under an `EXPO_PUBLIC_` name or by
 *      being imported from server code. Both are refused here, and the set
 *      of public variables the app actually depends on is frozen and checked
 *      against `.env.example`.
 *
 *   2. **Development surfaces.** The Design Preview harness, its simulated
 *      shopper-report states, and the developer wordings of the
 *      not-configured screens are development tooling. They must be
 *      unREACHABLE in a release build while staying fully usable in
 *      development. Unreachable is the claim, not absent: Metro does not
 *      tree-shake, so a guarded string may still sit in the bundle, and the
 *      assertions below are written about what can RUN, not about what a
 *      `strings` dump would find.
 *
 * Scope note: the Design Preview gate itself (entry refusal, session
 * inertness, the `__DEV__` branch on the Profile row, the absence of a
 * feature flag that could enable shopper reporting) is already proven in
 * `design-preview.test.ts` and is deliberately NOT re-asserted here. What
 * this file adds is the part no existing test covers: the env boundary, the
 * client/server import boundary, and a frozen route inventory, so a NEW
 * development surface cannot be added without a decision being recorded.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');

/**
 * The directories that are compiled into the app bundle. `src/server` and
 * `scripts/` are deliberately absent: they are Node-only and may hold
 * secrets (AGENTS.md, "Conventions").
 */
const CLIENT_DIRS = ['app', 'components', 'hooks', 'lib', 'constants', 'content', 'domain'];

/** Every non-test client source file, as `{ path, source }`. */
function clientSources(): { path: string; source: string }[] {
  const files: { path: string; source: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
      files.push({ path: relative(SRC, full), source: readFileSync(full, 'utf8') });
    }
  };
  for (const dir of CLIENT_DIRS) walk(join(SRC, dir));
  return files;
}

const CLIENT = clientSources();

test('the client bundle is not empty, so an empty scan can never pass silently', () => {
  assert.ok(CLIENT.length > 100, `only ${CLIENT.length} client sources found`);
});

// ── 1. Configuration boundary ───────────────────────────────────────────────

/**
 * The public configuration the app genuinely depends on. Frozen: adding a
 * third public variable is a release-configuration decision (it has to be
 * set on EAS for every profile before a build can work), so it should fail
 * here and be recorded in `docs/recall-release-readiness.md`.
 */
const REQUIRED_PUBLIC_ENV = [
  'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'EXPO_PUBLIC_SUPABASE_URL',
] as const;

test('every environment variable the client reads is an EXPO_PUBLIC_ one', () => {
  const found = new Set<string>();
  for (const { path, source } of CLIENT) {
    for (const match of source.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
      const name = match[1];
      assert.ok(
        name.startsWith('EXPO_PUBLIC_'),
        `${path} reads process.env.${name}, which Metro would not inline and which may be a secret`,
      );
      found.add(name);
    }
    // Bracket and destructured reads would slip past the pattern above.
    assert.doesNotMatch(source, /process\.env\[/, `${path} reads process.env by computed key`);
    assert.doesNotMatch(
      source,
      /(const|let|var)\s*\{[^}]*\}\s*=\s*process\.env/,
      `${path} destructures process.env`,
    );
  }
  assert.deepEqual([...found].sort(), [...REQUIRED_PUBLIC_ENV]);
});

test('no server-only secret name appears anywhere in client source', () => {
  // `SUPABASE_URL` is matched only when it is NOT the EXPO_PUBLIC_ variable,
  // which legitimately ends in the same characters.
  const forbidden: [string, RegExp][] = [
    ['SUPABASE_SECRET_KEY', /\bSUPABASE_SECRET_KEY\b/],
    ['SUPABASE_URL (server)', /(?<!EXPO_PUBLIC_)\bSUPABASE_URL\b/],
    ['EXPO_ACCESS_TOKEN', /\bEXPO_ACCESS_TOKEN\b/],
    ['WATCHDOG_SHARED_SECRET', /\bWATCHDOG_SHARED_SECRET\b/],
    ['GITHUB_ACTIONS_TOKEN', /\bGITHUB_ACTIONS_TOKEN\b/],
    ['service_role', /\bservice_role\b/],
    ['sb_secret_', /\bsb_secret_/],
  ];
  for (const { path, source } of CLIENT) {
    for (const [name, pattern] of forbidden) {
      assert.doesNotMatch(source, pattern, `${path} names the server-only value ${name}`);
    }
  }
});

test('the client imports neither server code, a job script, nor a Node built-in', () => {
  const forbidden: [string, RegExp][] = [
    ['@/server', /from\s+'@\/server/],
    ['a relative server path', /from\s+'[./]+\/server\//],
    ['scripts/', /from\s+'[^']*\bscripts\//],
    ['a node: built-in', /(from\s+'node:|require\('node:)/],
    ['@supabase/supabase-js', /from\s+'@supabase\/supabase-js'/],
  ];
  for (const { path, source } of CLIENT) {
    for (const [name, pattern] of forbidden) {
      assert.doesNotMatch(source, pattern, `${path} imports ${name}`);
    }
  }
});

test('every public variable is documented in .env.example, on its client-safe side', () => {
  const example = readFileSync(join(ROOT, '.env.example'), 'utf8');
  const clientSection = example.slice(
    example.indexOf('Client-safe'),
    example.indexOf('Server-only'),
  );
  assert.ok(clientSection.length > 0, '.env.example must keep its two labelled sections');
  for (const name of REQUIRED_PUBLIC_ENV) {
    assert.ok(clientSection.includes(name), `${name} is missing from the client-safe section`);
  }
  // The secret names stay on the server-only side of the same file.
  assert.ok(!clientSection.includes('SUPABASE_SECRET_KEY'));
});

test('each module reading the public config refuses to call out without it', () => {
  // A missing variable must produce the app's "not configured" state, never
  // a request to `undefined/rest/v1/...` carrying an `undefined` key.
  const feed = readFileSync(join(SRC, 'lib', 'recall-feed.ts'), 'utf8');
  assert.match(feed, /export function isFeedConfigured\(\): boolean \{\s*\n\s*return Boolean\(/);
  for (const name of ['push-api.ts', 'report-api.ts']) {
    const source = readFileSync(join(SRC, 'lib', name), 'utf8');
    assert.match(
      source,
      /if \(!supabaseUrl \|\| !publishableKey\) \{\s*\n\s*throw new Error\(/,
      `${name} must refuse before fetching`,
    );
  }
});

// ── 2. Development surfaces ─────────────────────────────────────────────────

/**
 * Every route the app registers. `design-preview/index.tsx` is the only
 * development surface, and it is inert in a release build
 * (`design-preview.test.ts`). Freezing the list means a new route — product
 * or development — has to be acknowledged here.
 */
const ROUTES = [
  '(tabs)/_layout.tsx',
  '(tabs)/index.tsx',
  '(tabs)/profile.tsx',
  '(tabs)/saved.tsx',
  '_layout.tsx',
  'design-preview/index.tsx',
  'document/[slug].tsx',
  // P2B7X.1: the first-launch flow, the hard paywall and the one-time
  // notification education. Product screens, each inside a protected group
  // of the root layout (access-gate.test.ts pins the guards).
  'onboarding/allergens.tsx',
  'onboarding/notifications.tsx',
  'onboarding/preview.tsx',
  'onboarding/retailers.tsx',
  'onboarding/states.tsx',
  'onboarding/welcome.tsx',
  'paywall.tsx',
  'recall/[id].tsx',
  'report/[id].tsx',
  'settings/index.tsx',
  'settings/notifications.tsx',
  'settings/personalization.tsx',
];

test('the route inventory is exactly the product screens plus the one dev harness', () => {
  const routes = CLIENT.filter(({ path }) => path.startsWith('app/'))
    .map(({ path }) => path.slice('app/'.length))
    .sort();
  assert.deepEqual(routes, [...ROUTES].sort());
  const development = routes.filter((r) => r.startsWith('design-preview/'));
  assert.deepEqual(development, ['design-preview/index.tsx'], 'exactly one development route');
});

test('the developer wording of the not-configured screens is behind __DEV__', () => {
  // React Native sets `__DEV__` to false in a release build, so the branch
  // resolves to the shopper's wording and no shopper is ever shown
  // environment-variable names. (Both strings are still COMPILED into the
  // bundle: Metro does not tree-shake an unused module export. That is not a
  // leak — the names in question are the two EXPO_PUBLIC_ variables, whose
  // values Metro inlines into the same bundle by design.)
  const screens: [string, string, string][] = [
    ['feed', join(SRC, 'app', '(tabs)', 'index.tsx'), 'FEED_NOT_CONFIGURED'],
    ['saved', join(SRC, 'app', '(tabs)', 'saved.tsx'), 'SAVED_NOT_CONFIGURED'],
  ];
  for (const [name, path, base] of screens) {
    const source = readFileSync(path, 'utf8');
    assert.ok(
      source.includes(`{...(__DEV__ ? ${base}_DEV : ${base})}`),
      `${name} must choose its not-configured wording behind __DEV__`,
    );
    // The development constant is never spread unconditionally anywhere.
    assert.ok(
      !source.includes(`{...${base}_DEV}`),
      `${name} spreads the developer wording unguarded`,
    );
  }
  // And the release constants themselves name no variable and no tooling.
  const copy = readFileSync(join(SRC, 'lib', 'feed-copy.ts'), 'utf8');
  const saved = readFileSync(join(SRC, 'lib', 'saved-recalls.ts'), 'utf8');
  for (const [name, source, symbol] of [
    ['feed-copy', copy, 'FEED_NOT_CONFIGURED'],
    ['saved-recalls', saved, 'SAVED_NOT_CONFIGURED'],
  ] as const) {
    const release = source.slice(
      source.indexOf(`export const ${symbol}:`),
      source.indexOf(`export const ${symbol}_DEV:`),
    );
    assert.ok(release.length > 0, `${name} must keep both wordings`);
    assert.doesNotMatch(release, /EXPO_PUBLIC|\.env|README|dev server/, name);
  }
});
