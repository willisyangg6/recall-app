/**
 * "Reset app and delete my data" (C7.1) — client orchestration proofs.
 *
 * The orchestrator is pure (installation-reset.ts); these tests drive it with
 * a fake world — a fake server keyed by installation id, fake local storage,
 * and the REAL serial queue implementation the production wiring shares — and
 * prove the properties the runner relies on:
 *
 *   - server-first ordering: a failed server deletion mutates nothing local,
 *     so the credential needed to retry is never lost;
 *   - queue coordination: a preference autosave or push refresh queued before
 *     the reset completes first (and its rows are deleted); one queued after
 *     runs against the fresh identity and can never recreate the old
 *     installation's rows;
 *   - idempotent retry after an ambiguous outcome (server deleted, response
 *     lost);
 *   - double-tap safety;
 *   - a fresh id through the canonical path, local state fully cleared, and
 *     push staying off.
 *
 * The UI's cancel-mutates-nothing and single-action guarantees are structural
 * facts of the component file and are pinned textually at the end (the same
 * approach as profile-structure.test.ts — RN components cannot render in the
 * plain-Node harness, and the assertions are not weakened for it).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { createSerialQueue } from './serial-queue';
import {
  resetInstallationData,
  RESET_ACTION_LABEL,
  RESET_CONFIRM_BODY,
  RESET_CONFIRM_CANCEL,
  RESET_CONFIRM_DELETE,
  type InstallationResetDeps,
} from './installation-reset';

/** A fake device + server pair sharing one mutation queue, mirroring the runner's wiring. */
function fakeWorld(options: { failServerDeletes?: number; ambiguousDeletes?: number } = {}) {
  let failServerDeletes = options.failServerDeletes ?? 0;
  let ambiguousDeletes = options.ambiguousDeletes ?? 0;
  const world = {
    // Server rows keyed by installation id (the preference mirror and the
    // push registration, modeled separately so scope is visible).
    serverPreferences: new Map<string, string>(),
    serverRegistrations: new Set<string>(),
    // SecureStore-equivalent local state.
    local: {
      prefs: null as string | null,
      dirty: false,
      alertsEnabled: false,
      installationId: null as string | null,
    },
    log: [] as string[],
    idCounter: 0,
    queue: createSerialQueue(),
  };

  const deps: InstallationResetDeps = {
    enqueue: world.queue,
    peekInstallationId: async () => world.local.installationId,
    deleteServerData: async (id) => {
      if (failServerDeletes > 0) {
        failServerDeletes -= 1;
        world.log.push(`server-delete-failed:${id}`);
        throw new Error('network down');
      }
      // Ambiguous: the server transaction commits, the response is lost.
      world.serverPreferences.delete(id);
      world.serverRegistrations.delete(id);
      world.log.push(`server-delete:${id}`);
      if (ambiguousDeletes > 0) {
        ambiguousDeletes -= 1;
        throw new Error('response lost');
      }
    },
    clearLocalPreferences: async () => {
      world.local.prefs = null;
      world.local.dirty = false;
      world.log.push('clear-prefs');
    },
    clearLocalAlertState: async () => {
      world.local.alertsEnabled = false;
      world.log.push('clear-alerts');
    },
    clearInstallationId: async () => {
      world.local.installationId = null;
      world.log.push('clear-id');
    },
    createFreshInstallationId: async () => {
      world.idCounter += 1;
      world.local.installationId = `fresh-${world.idCounter}`;
      world.log.push(`fresh-id:${world.local.installationId}`);
      return world.local.installationId;
    },
  };

  /** The canonical getOrCreate path the save/refresh fakes share. */
  const getOrCreateId = async (): Promise<string> => {
    if (world.local.installationId === null) return deps.createFreshInstallationId();
    return world.local.installationId;
  };

  /** preferences-store.savePreferences, modeled: local write then mirror sync. */
  const savePreferences = (value: string) =>
    world.queue(async () => {
      world.local.prefs = value;
      const id = await getOrCreateId();
      world.serverPreferences.set(id, value);
      world.log.push(`save:${id}:${value}`);
    });

  /** push-registration.refreshRegistrationIfEnabled, modeled: gated on the flag. */
  const refreshRegistration = () =>
    world.queue(async () => {
      if (!world.local.alertsEnabled) {
        world.log.push('refresh:noop');
        return;
      }
      const id = await getOrCreateId();
      world.serverRegistrations.add(id);
      world.log.push(`refresh:${id}`);
    });

  /** Seed: a personalized installation with alerts on, fully synced. */
  const seed = () => {
    world.local.installationId = 'seed-installation-0001';
    world.local.prefs = 'CA+peanut';
    world.local.alertsEnabled = true;
    world.serverPreferences.set('seed-installation-0001', 'CA+peanut');
    world.serverRegistrations.add('seed-installation-0001');
  };

  return { world, deps, savePreferences, refreshRegistration, seed };
}

test('success clears local state, deletes only this installation server-side, and mints a fresh id', async () => {
  const { world, deps, seed } = fakeWorld();
  seed();
  world.serverPreferences.set('other-installation-9999', 'TX');
  world.serverRegistrations.add('other-installation-9999');

  const result = await resetInstallationData(deps);

  assert.deepEqual(result, { status: 'deleted' });
  // Exact order: server delete strictly before any local mutation.
  assert.deepEqual(world.log, [
    'server-delete:seed-installation-0001',
    'clear-prefs',
    'clear-alerts',
    'clear-id',
    'fresh-id:fresh-1',
  ]);
  assert.deepEqual(world.local, {
    prefs: null,
    dirty: false,
    alertsEnabled: false,
    installationId: 'fresh-1', // canonical path minted it (test 17)
  });
  // The other installation's rows are untouched.
  assert.deepEqual([...world.serverPreferences.entries()], [['other-installation-9999', 'TX']]);
  assert.deepEqual([...world.serverRegistrations], ['other-installation-9999']);
});

test('a failed server deletion mutates NOTHING local — credential and preferences survive for retry', async () => {
  const { world, deps, seed } = fakeWorld({ failServerDeletes: 1 });
  seed();

  const failed = await resetInstallationData(deps);
  assert.equal(failed.status, 'failed');
  assert.deepEqual(world.local, {
    prefs: 'CA+peanut',
    dirty: false,
    alertsEnabled: true,
    installationId: 'seed-installation-0001',
  });
  assert.deepEqual(world.log, ['server-delete-failed:seed-installation-0001']);
  // Server rows still exist and the retained credential can still delete them.
  const retried = await resetInstallationData(deps);
  assert.deepEqual(retried, { status: 'deleted' });
  assert.equal(world.serverPreferences.size, 0);
  assert.equal(world.local.installationId, 'fresh-1');
});

test('an ambiguous outcome (server committed, response lost) is safe to retry', async () => {
  const { world, deps, seed } = fakeWorld({ ambiguousDeletes: 1 });
  seed();

  const first = await resetInstallationData(deps);
  assert.equal(first.status, 'failed');
  // Local state untouched — the old id is retained even though the server
  // already deleted its rows...
  assert.equal(world.local.installationId, 'seed-installation-0001');
  assert.equal(world.local.prefs, 'CA+peanut');
  // ...so the retry re-runs the idempotent deletion (zero rows) and finishes.
  const second = await resetInstallationData(deps);
  assert.deepEqual(second, { status: 'deleted' });
  assert.equal(world.serverPreferences.size, 0);
  assert.equal(world.local.installationId, 'fresh-1');
});

test('with no installation id there is no server call — deletion never mints an identity to delete', async () => {
  const { world, deps } = fakeWorld();
  world.local.prefs = 'orphan';

  const result = await resetInstallationData(deps);
  assert.deepEqual(result, { status: 'deleted' });
  assert.ok(!world.log.some((line) => line.startsWith('server-delete')));
  assert.equal(world.local.prefs, null);
  assert.equal(world.local.installationId, 'fresh-1');
});

test('a preference save queued BEFORE the reset completes first and its row is deleted (never recreated)', async () => {
  const { world, deps, savePreferences, seed } = fakeWorld();
  seed();

  const save = savePreferences('TX+milk'); // in flight when the user confirms
  const reset = resetInstallationData(deps);
  await Promise.all([save, reset]);

  assert.deepEqual(world.log.slice(0, 2), [
    'save:seed-installation-0001:TX+milk',
    'server-delete:seed-installation-0001',
  ]);
  assert.equal(world.serverPreferences.size, 0, 'the queued save could not recreate the row');
  assert.equal(world.local.installationId, 'fresh-1');
});

test('a preference save queued AFTER the reset runs against the fresh identity only', async () => {
  const { world, deps, savePreferences, seed } = fakeWorld();
  seed();

  const reset = resetInstallationData(deps);
  const save = savePreferences('WA+sesame'); // the user's own post-reset choice
  await Promise.all([reset, save]);

  assert.deepEqual([...world.serverPreferences.entries()], [['fresh-1', 'WA+sesame']]);
  assert.ok(!world.serverPreferences.has('seed-installation-0001'));
});

test('push registration cannot race the reset and recreate the old subscription', async () => {
  const { world, deps, refreshRegistration, seed } = fakeWorld();
  seed();

  // Refresh in flight when the reset is confirmed: it completes first, its
  // row is deleted; a refresh after the reset finds the flag cleared and
  // no-ops. Either order ends with zero registrations for the old id.
  const before = refreshRegistration();
  const reset = resetInstallationData(deps);
  const after = refreshRegistration();
  await Promise.all([before, reset, after]);

  assert.deepEqual(world.log, [
    'refresh:seed-installation-0001',
    'server-delete:seed-installation-0001',
    'clear-prefs',
    'clear-alerts',
    'clear-id',
    'fresh-id:fresh-1',
    'refresh:noop', // push stays OFF after reset until explicitly re-enabled
  ]);
  assert.equal(world.serverRegistrations.size, 0);
  assert.equal(world.local.alertsEnabled, false);
});

test('two rapid deletion requests are both safe and end in one consistent fresh state', async () => {
  const { world, deps, seed } = fakeWorld();
  seed();

  const [first, second] = await Promise.all([
    resetInstallationData(deps),
    resetInstallationData(deps),
  ]);
  assert.deepEqual(first, { status: 'deleted' });
  assert.deepEqual(second, { status: 'deleted' });
  // The second run saw the first's fresh id, deleted its (nonexistent) rows
  // idempotently, and minted the final identity. No old-id row anywhere.
  assert.equal(world.serverPreferences.size, 0);
  assert.equal(world.serverRegistrations.size, 0);
  assert.equal(world.local.installationId, 'fresh-2');
  assert.ok(!world.log.includes('server-delete-failed:seed-installation-0001'));
});

// ── Structural pins: the UI contract the Node harness cannot render ─────────

const SECTION = readFileSync(
  join(__dirname, '..', 'components', 'installation-reset-section.tsx'),
  'utf8',
);

test('cancel performs no mutation: only the destructive button starts the run', () => {
  // The cancel button is exactly { text, style } — NO onPress, no handler, so
  // cancelling can only dismiss the dialog.
  assert.match(SECTION, /\{ text: RESET_CONFIRM_CANCEL, style: 'cancel' \}/);
  // The run starts in exactly one place: the destructive confirm button.
  const runCalls = SECTION.match(/void run\(\)/g) ?? [];
  assert.equal(runCalls.length, 1);
  assert.match(SECTION, /style: 'destructive', onPress: \(\) => void run\(\)/);
  assert.equal(RESET_CONFIRM_CANCEL, 'Cancel');
  assert.equal(RESET_CONFIRM_DELETE, 'Delete data');
});

test('the action label is exact, the button disables while running, and duplicates are blocked', () => {
  assert.equal(RESET_ACTION_LABEL, 'Reset app and delete my data');
  assert.match(SECTION, /disabled=\{state === 'running'\}/);
  assert.match(SECTION, /if \(state === 'running'\) return;/);
  assert.ok(SECTION.includes("prior === 'running' ? prior : 'running'"));
});

test('the confirmation copy explains scope and the return to the default state', () => {
  assert.match(RESET_CONFIRM_BODY, /personalization/);
  assert.match(RESET_CONFIRM_BODY, /notification registration/);
  assert.match(RESET_CONFIRM_BODY, /data associated\s?with this installation/);
  assert.match(RESET_CONFIRM_BODY, /default, unpersonalized state/);
});
