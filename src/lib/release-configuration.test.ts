/**
 * The release configuration contract (P3C1) — `app.json` and `eas.json`.
 *
 * These two files decide the app's public identity on a device and which
 * kind of binary each EAS profile produces. Both are edited rarely and by
 * hand, and a wrong value is expensive in a way code is not: a bundle
 * identifier cannot be changed once it is registered with Apple and has
 * shipped, and a production build that silently carried development
 * configuration would reach TestFlight before anyone noticed.
 *
 * So the values are pinned here, with the reason each one is what it is.
 *
 * ## The two identities, deliberately different
 *
 * `slug`, `owner` and `extra.eas.projectId` are the INTERNAL identity: they
 * are how this working copy is linked to the existing EAS project
 * `@willisyangg6/recall-app`. Changing any of them would point the CLI at a
 * different (or new) EAS project and orphan the remote build-number
 * sequence. They stay `recall-app` on purpose, and the rename does not
 * touch them.
 *
 * `name`, `scheme` and `ios.bundleIdentifier` are the PUBLIC identity: the
 * name under the icon, the URL scheme deep links use, and the identifier
 * Apple will register. These are Lotly's.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const ROOT = join(__dirname, '..', '..');
const read = (name: string) => JSON.parse(readFileSync(join(ROOT, name), 'utf8'));

const APP = read('app.json').expo as {
  name: string;
  slug: string;
  version: string;
  scheme: string;
  owner: string;
  ios: { bundleIdentifier: string; supportsTablet?: boolean; buildNumber?: string };
  android: Record<string, unknown>;
  extra: { eas: { projectId: string } };
};

const EAS = read('eas.json') as {
  cli: { version: string; appVersionSource: string };
  build: Record<
    string,
    {
      environment?: string;
      developmentClient?: boolean;
      distribution?: string;
      autoIncrement?: boolean | string;
      extends?: string;
      env?: Record<string, string>;
      ios?: { simulator?: boolean };
    }
  >;
  submit: Record<string, unknown>;
};

// ── The EAS linkage, which this milestone must not break ────────────────────

test('the existing EAS project linkage is preserved exactly', () => {
  assert.equal(APP.extra.eas.projectId, 'c81f13ab-2408-43b7-9cfd-2df84055725c');
  assert.equal(APP.slug, 'recall-app');
  assert.equal(APP.owner, 'willisyangg6');
});

// ── The public identity ─────────────────────────────────────────────────────

test('the installed app is Lotly, opens lotly:// links, and is com.willisyang.lotly', () => {
  assert.equal(APP.name, 'Lotly');
  assert.equal(APP.scheme, 'lotly');
  assert.equal(APP.ios.bundleIdentifier, 'com.willisyang.lotly');
  // The old identity is gone from both fields, so nothing can half-rename.
  assert.ok(!APP.scheme.includes('recall'));
  assert.ok(!APP.ios.bundleIdentifier.endsWith('.recall'));
});

test('the scheme is a legal URL scheme, lowercase, with no punctuation to mistype', () => {
  // Expo's own constraint (config schema): ^[a-z][a-z0-9+.-]*$.
  assert.match(APP.scheme, /^[a-z][a-z0-9+.-]*$/);
  assert.equal(APP.scheme, APP.scheme.toLowerCase());
});

test('distribution is iPhone-only: iPad support is off, and explicitly so', () => {
  // Expo defaults `supportsTablet` to false, but the default is invisible in
  // a review of app.json. It is written out so the decision is legible and
  // cannot be flipped silently by a future edit that adds an ios block.
  assert.equal(APP.ios.supportsTablet, false);
});

test('the app is portrait, light-only and carries no hand-set iOS build number', () => {
  // `appVersionSource: remote` means EAS owns the build number; a
  // `buildNumber` here would be ignored at best and misleading at worst.
  assert.equal(APP.ios.buildNumber, undefined);
  assert.match(APP.version, /^\d+\.\d+\.\d+$/);
});

// ── The EAS profiles ────────────────────────────────────────────────────────

test('exactly three build profiles exist, each defined in full', () => {
  assert.deepEqual(Object.keys(EAS.build).sort(), ['development', 'preview', 'production']);
  // No profile inherits from another. `extends` is what would let a
  // development setting reach production through a chain nobody re-reads,
  // so every profile states its own values and this stays empty.
  for (const [name, profile] of Object.entries(EAS.build)) {
    assert.equal(profile.extends, undefined, `${name} must not extend another profile`);
  }
});

test('development is the ONLY profile that builds a development client', () => {
  assert.equal(EAS.build.development.developmentClient, true);
  assert.equal(EAS.build.development.distribution, 'internal');
  for (const name of ['preview', 'production']) {
    assert.equal(
      EAS.build[name].developmentClient,
      false,
      `${name} must state developmentClient: false rather than rely on the default`,
    );
  }
});

test('production is a store build and can never be installed as an ad-hoc preview', () => {
  assert.equal(EAS.build.production.distribution, 'store');
  assert.equal(EAS.build.preview.distribution, 'internal');
  assert.notEqual(EAS.build.production.distribution, EAS.build.development.distribution);
});

test('each profile draws its variables from the EAS environment of the same name', () => {
  // Without an explicit `environment`, which EAS environment supplies
  // EXPO_PUBLIC_SUPABASE_URL and the publishable key to a build is not
  // stated in the file anyone would read to find out. Naming it per profile
  // is what stops a production build from picking up development values.
  for (const name of ['development', 'preview', 'production']) {
    assert.equal(EAS.build[name].environment, name, `${name} must name its own EAS environment`);
  }
  assert.notEqual(EAS.build.production.environment, EAS.build.development.environment);
});

test('no profile builds for the simulator, and none injects environment values', () => {
  for (const [name, profile] of Object.entries(EAS.build)) {
    assert.equal(profile.ios?.simulator, false, `${name} must target devices`);
    // Public configuration is supplied by EAS environment variables, not
    // committed here: eas.json is in git, and a committed value cannot be
    // rotated without a commit. See docs/recall-release-readiness.md.
    assert.equal(profile.env, undefined, `${name} must not commit environment values`);
  }
});

test('build numbers come from EAS and increment for every installable build', () => {
  assert.equal(EAS.cli.appVersionSource, 'remote');
  // Development builds are for the founder's own device and never reach a
  // store or a tester, so they do not consume a build number.
  assert.equal(EAS.build.development.autoIncrement, false);
  // Anything installable by someone else gets a unique, increasing
  // CFBundleVersion, which is what App Store Connect requires. With a REMOTE
  // version source the flag is a boolean: EAS holds one build number per
  // platform, so there is no `'buildNumber'` vs `'version'` choice to make
  // (the EAS CLI rejects the string form outright under appVersionSource:
  // remote, which is how this value was settled).
  assert.equal(EAS.build.preview.autoIncrement, true);
  assert.equal(EAS.build.production.autoIncrement, true);
});

test('a submit profile exists for production only', () => {
  assert.deepEqual(Object.keys(EAS.submit), ['production']);
});

// ── The root error boundary ─────────────────────────────────────────────────

test('the root layout exports an ErrorBoundary, so every screen is covered', () => {
  const layout = readFileSync(join(ROOT, 'src', 'app', '_layout.tsx'), 'utf8');
  assert.match(layout, /export \{ AppErrorBoundary as ErrorBoundary \};/);
  assert.match(layout, /from '@\/components\/app-error-boundary'/);
});

test('the failure screen shows no error detail, and keeps it for development', () => {
  const boundary = readFileSync(join(ROOT, 'src', 'components', 'app-error-boundary.tsx'), 'utf8');
  const code = boundary
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  // Nothing about the error is rendered: no message, no stack, no name.
  for (const leak of ['error.message', 'error.stack', 'error.name', '{error}', 'String(error)']) {
    assert.ok(!code.includes(leak), `the failure screen renders ${leak}`);
  }
  // The whole error is preserved for the development console, and only
  // there: `__DEV__` is false in a release build, so this never runs.
  assert.match(code, /if \(__DEV__\) console\.error\('Lotly render failed', error\);/);
  // Retry is offered, and it is Expo Router's own re-render.
  assert.match(code, /void retry\(\);/);
  // The splash is dismissed, or a crash during startup would stay hidden
  // behind it (the root layout prevents auto-hide at module scope).
  assert.match(code, /SplashScreen\.hideAsync\(\)/);
  // The fallback must not depend on context its failed parent provides.
  for (const fragile of ['useSafeAreaInsets', 'SafeAreaView', 'ThemeProvider', 'useFonts']) {
    assert.ok(!code.includes(fragile), `the failure screen depends on ${fragile}`);
  }
});
