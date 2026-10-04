/**
 * Containment of the development enable scenarios (2026-10-04): the
 * simulated permission and registration stand-ins are reached only through
 * a `__DEV__` `require` (folded out of a release bundle) and the Design
 * Preview's QA controls, and the wrapper hands back the real ports outside
 * a development build. Mirrors the pins on the feed scenarios and the
 * preference mirror.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

import {
  chooseEnablePorts,
  DEVELOPMENT_ENABLE_SCENARIOS,
  simulatedEnablePorts,
} from './notification-enable-scenarios';
import type { EnablePorts } from './push-registration';

const SRC = join(__dirname, '..');
const PORTS = readFileSync(join(__dirname, 'notification-education-ports.ts'), 'utf8');

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
  for (const dir of ['app', 'components', 'hooks', 'lib']) walk(join(SRC, dir));
  return files;
}

test('the education reaches the development scenarios only through a __DEV__ require', () => {
  assert.match(
    PORTS,
    /const developmentScenarios = __DEV__\n\s+\? \/\/ eslint-disable-next-line @typescript-eslint\/no-require-imports\n\s+\(require\('\.\/development-notification-scenarios'\)/,
  );
  assert.ok(
    !/^import .*development-notification-scenarios/m.test(PORTS.replace(/import type[^;]+;/g, '')),
    'a static import would reach a release bundle',
  );
  // And nothing else in the client bundle names the module except the hub's
  // own __DEV__ require in the gallery.
  const reachers = clientSources().filter(
    ({ path, source }) =>
      source.includes('development-notification-scenarios') &&
      path !== 'lib/development-notification-scenarios.ts',
  );
  assert.deepEqual(reachers.map((r) => r.path).sort(), [
    'components/development/onboarding-gallery.tsx',
    'lib/notification-education-ports.ts',
  ]);
  for (const { path, source } of reachers) {
    assert.ok(
      !/^import (?!type ).*development-notification-scenarios/m.test(source),
      `${path} imports the development scenarios statically`,
    );
  }
});

test('outside a development build, and under Live, the choice is the real ports untouched', () => {
  const real: EnablePorts = {
    resolvePermission: async () => ({ granted: false, canAskAgain: true, prompted: false }),
    register: async () => {},
  };
  for (const { id } of DEVELOPMENT_ENABLE_SCENARIOS) {
    assert.equal(chooseEnablePorts(real, id, false), real, `${id} outside development`);
  }
  assert.equal(chooseEnablePorts(real, 'live', true), real);
  assert.notEqual(chooseEnablePorts(real, 'granted-success', true), real);
});

test('every simulated scenario answers the permission locally and registers nothing', async () => {
  for (const { id } of DEVELOPMENT_ENABLE_SCENARIOS) {
    if (id === 'live') continue;
    const ports = simulatedEnablePorts(id);
    const permission = await ports.resolvePermission();
    switch (id) {
      case 'denied-now':
        assert.deepEqual(permission, { granted: false, canAskAgain: false, prompted: true }, id);
        break;
      case 'blocked':
      case 'blocked-then-granted':
        assert.deepEqual(permission, { granted: false, canAskAgain: false, prompted: false }, id);
        break;
      default:
        assert.equal(permission.granted, true, id);
        assert.equal(permission.prompted, false, id);
    }
  }
  // The Settings return: blocked once, then granted.
  const settings = simulatedEnablePorts('blocked-then-granted');
  assert.equal((await settings.resolvePermission()).granted, false);
  assert.equal((await settings.resolvePermission()).granted, true);
  // A hung registration ends only by its abort.
  const controller = new AbortController();
  const hung = simulatedEnablePorts('granted-timeout').register(controller.signal);
  controller.abort();
  await assert.rejects(hung);
});
