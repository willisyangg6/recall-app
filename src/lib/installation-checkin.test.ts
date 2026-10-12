/**
 * The daily foreground check-in (2026-10-12): the activity signal for the
 * 12-month inactivity rule, and the repair path for a returning
 * installation. Pure orchestration against fakes, plus the real serial
 * queue for the ordering against "Reset app and delete my data".
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { checkIn, utcDay, type CheckinDeps } from './installation-checkin';
import { resetInstallationData } from './installation-reset';
import { createSerialQueue } from './serial-queue';

function harness(overrides: Partial<CheckinDeps> = {}) {
  const calls: string[] = [];
  let last: string | null = null;
  const deps: CheckinDeps = {
    today: () => '2026-10-12',
    readLastCheckin: async () => last,
    writeLastCheckin: async (day) => {
      last = day;
      calls.push(`remember ${day}`);
    },
    peekInstallationId: async () => 'install-000000000001',
    enqueue: (task) => task(),
    recordActivity: async (id) => {
      calls.push(`record ${id}`);
    },
    remirrorPreferences: async () => {
      calls.push('remirror');
    },
    refreshRegistration: async () => {
      calls.push('refresh');
    },
    ...overrides,
  };
  return { deps, calls, last: () => last };
}

test('a first foreground of the day records activity, remembers the day, then repairs', async () => {
  const { deps, calls } = harness();
  assert.equal(await checkIn(deps), 'recorded');
  assert.deepEqual(calls, [
    'record install-000000000001',
    'remember 2026-10-12',
    'remirror',
    'refresh',
  ]);
});

test('later foregrounds the same UTC day send nothing', async () => {
  const { deps, calls } = harness();
  await checkIn(deps);
  calls.length = 0;
  assert.equal(await checkIn(deps), 'already-today');
  assert.deepEqual(calls, []);
});

test('an installation with no id records nothing and never mints one', async () => {
  const { deps, calls, last } = harness({ peekInstallationId: async () => null });
  assert.equal(await checkIn(deps), 'no-installation');
  assert.deepEqual(calls, []);
  assert.equal(last(), null, 'the next foreground checks again');
});

test('a failed server write remembers nothing, so the next foreground retries', async () => {
  let online = false;
  const { deps, calls } = harness({
    recordActivity: async () => {
      if (!online) throw new Error('offline');
      calls.push('record');
    },
  });
  assert.equal(await checkIn(deps), 'failed');
  assert.deepEqual(calls, [], 'no repair calls after a failed check-in');
  online = true;
  assert.equal(await checkIn(deps), 'recorded');
});

test('a repair failure never undoes the recorded check-in', async () => {
  const { deps, last } = harness({
    remirrorPreferences: async () => {
      throw new Error('mirror down');
    },
    refreshRegistration: async () => {
      throw new Error('push down');
    },
  });
  assert.equal(await checkIn(deps), 'recorded');
  assert.equal(last(), '2026-10-12');
});

test('serialized with the reset: queued before, it lands first; queued after, it uses the fresh id', async () => {
  const enqueue = createSerialQueue();
  let installationId: string | null = 'old-install-0000000001';
  const server = new Set<string>();
  const events: string[] = [];
  const common = harness({
    enqueue,
    peekInstallationId: async () => installationId,
    recordActivity: async (id) => {
      server.add(id);
      events.push(`activity ${id}`);
    },
  });
  const resetDeps = {
    enqueue,
    peekInstallationId: async () => installationId,
    deleteServerData: async (id: string) => {
      server.delete(id);
      events.push(`delete ${id}`);
    },
    clearLocalPreferences: async () => {},
    clearLocalSavedRecalls: async () => {},
    clearLocalAlertState: async () => {},
    clearLocalOnboardingState: async () => {},
    clearInstallationId: async () => {
      installationId = null;
    },
    createFreshInstallationId: async () => {
      installationId = 'new-install-0000000002';
      return installationId;
    },
  };
  const before = checkIn(common.deps);
  // Let the first check-in reach the queue (it reads its day key first).
  await new Promise((resolve) => setImmediate(resolve));
  const reset = resetInstallationData(resetDeps);
  const after = checkIn({ ...common.deps, readLastCheckin: async () => null });
  await Promise.all([before, reset, after]);
  assert.deepEqual(events, [
    'activity old-install-0000000001',
    'delete old-install-0000000001',
    'activity new-install-0000000002',
  ]);
  assert.deepEqual([...server], ['new-install-0000000002'], 'nothing survives for the old id');
});

test('whatever the interleaving, no activity for a reset installation survives the reset', async () => {
  for (let delayTicks = 0; delayTicks < 4; delayTicks += 1) {
    const enqueue = createSerialQueue();
    let installationId: string | null = 'old-install-0000000001';
    const server = new Set<string>();
    const { deps } = harness({
      enqueue,
      peekInstallationId: async () => installationId,
      recordActivity: async (id) => {
        server.add(id);
      },
    });
    const pending = checkIn(deps);
    for (let i = 0; i < delayTicks; i += 1) await new Promise((r) => setImmediate(r));
    await Promise.all([
      pending,
      resetInstallationData({
        enqueue,
        peekInstallationId: async () => installationId,
        deleteServerData: async (id) => {
          server.delete(id);
        },
        clearLocalPreferences: async () => {},
        clearLocalSavedRecalls: async () => {},
        clearLocalAlertState: async () => {},
        clearLocalOnboardingState: async () => {},
        clearInstallationId: async () => {
          installationId = null;
        },
        createFreshInstallationId: async () => {
          installationId = 'new-install-0000000002';
          return installationId;
        },
      }),
    ]);
    assert.ok(!server.has('old-install-0000000001'), `interleaving ${delayTicks}`);
  }
});

test('the day boundary is UTC, matching the server column', () => {
  assert.equal(utcDay(new Date('2026-10-12T23:30:00-07:00')), '2026-10-13');
  assert.equal(utcDay(new Date('2026-10-12T00:00:00Z')), '2026-10-12');
});

test('the check-in runs only on the foreground, and only through the runner', () => {
  const hook = readFileSync(join(__dirname, '..', 'hooks', 'use-installation-checkin.ts'), 'utf8');
  assert.match(hook, /status === 'active'/);
  // A delivered notification is never activity: the hook does not listen to them.
  assert.doesNotMatch(hook, /expo-notifications|addNotification/);
  const runner = readFileSync(join(__dirname, 'installation-checkin-runner.ts'), 'utf8');
  assert.match(runner, /peekInstallationId,/, 'peek, never getOrCreate');
  assert.doesNotMatch(runner, /getOrCreateInstallationId/);
  const layout = readFileSync(join(__dirname, '..', 'app', '_layout.tsx'), 'utf8');
  assert.match(layout, /useInstallationCheckin\(\);/);
});
