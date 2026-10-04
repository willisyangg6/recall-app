/**
 * The alert registration protocol (2026-10-04) against the server rule's
 * mirror: a registration the client abandoned can never leave the server
 * enabled, and its cleanup can never silence a later retry — whatever order
 * the requests reach the server in. The "network" here is a hand-driven
 * queue, so every ordering is forced rather than hoped for.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { MemoryPushStore, type SequencedWriteResult } from '../server/push/memory-push-store';
import {
  alertIntent,
  INITIAL_ALERT_INTENT,
  parseAlertIntent,
  serializeAlertIntent,
  type AlertIntentState,
} from './alert-intent';
import { educationActions, type EducationView } from './notification-education-actions';
import { createSerialQueue } from './serial-queue';
import { RpcAbortedError, RpcRejectedError, isDefiniteRejection } from './push-api';

const INSTALL = 'i'.repeat(32);
const TOKEN = 'ExponentPushToken[abc]';
const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One in-flight request the test releases by hand. */
interface Flight {
  kind: 'register' | 'disable';
  sequence: number;
  /** Apply the write on the server and answer the client with success. */
  land(): void;
  /** Apply the write on the server, but the client never hears (abort/timeout). */
  landSilently(): void;
  /** Fail the client without the server ever applying the write. */
  drop(error?: unknown): void;
  /** The client fails now; the server applies the write later, when `land` is called. */
  lose(error?: unknown): void;
}

/** A storage + server harness: the memory store IS the server. */
function harness(options: { stored?: AlertIntentState | null } = {}) {
  const server = new MemoryPushStore();
  let stored: string | null = options.stored ? serializeAlertIntent(options.stored) : null;
  const flights: Flight[] = [];
  const saves: AlertIntentState[] = [];
  let clock = 0;
  const now = () => new Date(1_700_000_000_000 + clock++ * 1000).toISOString();

  const flight = (
    kind: Flight['kind'],
    sequence: number,
    apply: () => SequencedWriteResult,
    resolve: (decision: SequencedWriteResult) => void,
    reject: (error: unknown) => void,
  ): Flight => {
    let applied: SequencedWriteResult | null = null;
    const applyOnce = () => {
      applied ??= apply();
      return applied;
    };
    const f: Flight = {
      kind,
      sequence,
      land: () => {
        resolve(applyOnce());
      },
      landSilently: () => {
        applyOnce();
        reject(new RpcAbortedError());
      },
      drop: (error = new RpcRejectedError(400)) => reject(error),
      lose: (error = new TypeError('Network request failed')) => {
        reject(error);
        // `land` later applies it.
        f.land = () => applyOnce();
      },
    };
    flights.push(f);
    return f;
  };

  const intent = () =>
    alertIntent({
      load: async () => parseAlertIntent(stored),
      save: async (state) => {
        stored = serializeAlertIntent(state);
        saves.push(state);
      },
      register: (sequence, signal) =>
        new Promise<SequencedWriteResult>((resolve, reject) => {
          const f = flight(
            'register',
            sequence,
            () => server.register(INSTALL, TOKEN, 'ios', now(), sequence),
            resolve,
            reject,
          );
          signal?.addEventListener('abort', () => f.landSilently(), { once: true });
        }),
      disable: (sequence) =>
        new Promise<SequencedWriteResult>((resolve, reject) => {
          flight(
            'disable',
            sequence,
            () => server.disable(INSTALL, now(), sequence),
            resolve,
            reject,
          );
        }),
      isDefiniteRejection,
    });

  const serverEnabled = () => server.subscriptionOf(INSTALL)?.enabled ?? false;
  const state = () => parseAlertIntent(stored);
  const next = (kind?: Flight['kind']) => {
    const f = flights.find((x) => kind === undefined || x.kind === kind);
    assert.ok(f, `no ${kind ?? ''} flight`);
    flights.splice(flights.indexOf(f), 1);
    return f;
  };
  return { server, intent, flights, next, serverEnabled, state, saves };
}

test('the stored shape round-trips, and a corrupt record reads as nothing', () => {
  const state: AlertIntentState = { sequence: 7, enabled: true, pending: null, inFlight: 3 };
  assert.deepEqual(parseAlertIntent(serializeAlertIntent(state)), state);
  assert.equal(parseAlertIntent(null), null);
  assert.equal(parseAlertIntent('{'), null);
  assert.equal(parseAlertIntent('{"sequence":-1}'), null);
  assert.deepEqual(parseAlertIntent('{"sequence":2,"enabled":"yes"}'), {
    sequence: 2,
    enabled: false,
    pending: null,
    inFlight: null,
  });
  assert.deepEqual(INITIAL_ALERT_INTENT, {
    sequence: 0,
    enabled: false,
    pending: null,
    inFlight: null,
  });
});

test('the server rule, mirrored: a lower sequence is a no-op, an equal one is a retry, none is legacy', () => {
  const server = new MemoryPushStore();
  const at = (n: number) => new Date(n * 1000).toISOString();
  server.register(INSTALL, TOKEN, 'ios', at(1), 1);
  assert.equal(server.subscriptionOf(INSTALL)?.enabled, true);
  server.disable(INSTALL, at(2), 2);
  assert.equal(server.subscriptionOf(INSTALL)?.enabled, false);
  // The outranked registration arrives late: refused.
  server.register(INSTALL, TOKEN, 'ios', at(3), 1);
  assert.equal(server.subscriptionOf(INSTALL)?.enabled, false);
  // The disable is retried (same sequence): applies, still disabled.
  server.disable(INSTALL, at(4), 2);
  assert.equal(server.subscriptionOf(INSTALL)?.enabled, false);
  // A newer registration applies; the old disable, retried after it, is refused.
  server.register(INSTALL, TOKEN, 'ios', at(5), 3);
  assert.equal(server.subscriptionOf(INSTALL)?.enabled, true);
  server.disable(INSTALL, at(6), 2);
  assert.equal(server.subscriptionOf(INSTALL)?.enabled, true);
  // A disable can arrive before any row exists and is still remembered.
  const other = 'o'.repeat(32);
  server.disable(other, at(7), 2);
  assert.equal(server.subscriptionOf(other), null);
  server.register(other, 'ExponentPushToken[o]', 'ios', at(8), 1);
  assert.equal(server.subscriptionOf(other), null, 'the delayed registration is refused');
  // The same sequence with a DIFFERENT operation is not a retry: refused.
  assert.deepEqual(server.disable(INSTALL, at(9), 3), { applied: false, lastSequence: 3 });
  assert.equal(server.subscriptionOf(INSTALL)?.enabled, true);
  // The same sequence with the same operation is the retry: applies, same result.
  assert.deepEqual(server.register(INSTALL, TOKEN, 'ios', at(10), 3), {
    applied: true,
    lastSequence: 3,
  });
  // A legacy write (no sequence) is refused once the installation has
  // entered the protocol, so an older build can never undo a sequenced
  // disable; it still applies for an installation that never sequenced.
  assert.deepEqual(server.disable(INSTALL, at(11)), { applied: false, lastSequence: 3 });
  assert.equal(server.subscriptionOf(INSTALL)?.enabled, true);
  const legacy = 'l'.repeat(32);
  assert.deepEqual(server.register(legacy, 'ExponentPushToken[l]', 'ios', at(12)), {
    applied: true,
    lastSequence: 0,
  });
  assert.deepEqual(server.disable(legacy, at(13)), { applied: true, lastSequence: 0 });
  assert.equal(server.subscriptionOf(legacy)?.enabled, false);
  // Every decision reports the sequence the server now holds.
  assert.deepEqual(server.register(INSTALL, TOKEN, 'ios', at(14), 1), {
    applied: false,
    lastSequence: 3,
  });
  assert.throws(() => server.register(INSTALL, TOKEN, 'ios', at(15), 0), /invalid sequence/);
  // The data reset clears the sequence; the fresh id starts at 1.
  server.deleteInstallation(INSTALL);
  assert.equal(server.subscriptionOf(INSTALL), null);
  assert.deepEqual(server.register(INSTALL, TOKEN, 'ios', at(16), 1), {
    applied: true,
    lastSequence: 1,
  });
});

test('a lost client counter recovers: the refusal carries the server count, the retry goes ahead of it', async () => {
  const h = harness(); // nothing stored: the counter starts at 0 …
  h.server.sequences.set(INSTALL, { sequence: 7, operation: 'disable' }); // … the server holds 7
  const done = h.intent().register();
  await tick();
  const first = h.next('register');
  assert.equal(first.sequence, 1);
  first.land(); // refused: outranked by 7
  await tick();
  const second = h.next('register');
  assert.equal(second.sequence, 8, 'adopted the server count and went ahead of it');
  second.land();
  await done;
  assert.equal(h.serverEnabled(), true);
  assert.deepEqual(h.state(), { sequence: 8, enabled: true, pending: null, inFlight: null });
  assert.equal(h.flights.length, 0, 'a refusal is no unknown outcome: nothing to clean up');
});

test('a refused cleanup means this installation wrote something newer: nothing is owed', async () => {
  const h = harness({ stored: { sequence: 2, enabled: false, pending: 2, inFlight: null } });
  h.server.sequences.set(INSTALL, { sequence: 3, operation: 'register' });
  h.server.register(INSTALL, TOKEN, 'ios', new Date(0).toISOString(), 3);
  const done = h.intent().reconcile();
  await tick();
  h.next('disable').land(); // refused: 2 < 3
  await done;
  assert.deepEqual(h.state(), { sequence: 3, enabled: false, pending: null, inFlight: null });
  assert.equal(h.serverEnabled(), true, 'the newer registration stands');
});

test('simultaneous enable, disable, retry and refresh on the installation queue: unique, monotonic sequences, last write wins', async () => {
  const h = harness();
  const queue = createSerialQueue();
  const results: string[] = [];
  const run = (name: string, op: () => Promise<unknown>) =>
    queue(async () => {
      await op().then(
        () => results.push(`${name}:ok`),
        () => results.push(`${name}:fail`),
      );
    });
  // Land every flight as it appears, in order, so the queue never stalls.
  const pump = setInterval(() => {
    const f = h.flights.shift();
    if (f) f.land();
  }, 1);
  const all = Promise.all([
    run('enable', () => h.intent().register()),
    run('disable', () => h.intent().disable()),
    run('retry', () => h.intent().register()),
    run('refresh', () => h.intent().refresh()),
    run('disable2', () => h.intent().disable()),
  ]);
  await all;
  clearInterval(pump);
  assert.deepEqual(results, ['enable:ok', 'disable:ok', 'retry:ok', 'refresh:ok', 'disable2:ok']);
  const sequences = h.saves.map((s) => s.sequence);
  assert.deepEqual(
    sequences,
    [...sequences].sort((a, b) => a - b),
    'sequences never go backwards',
  );
  const sent = h.saves.filter((s) => s.inFlight !== null).map((s) => s.inFlight);
  assert.equal(new Set(sent).size, sent.length, 'every write carries its own sequence');
  assert.equal(h.serverEnabled(), false, 'the last operation decides');
  assert.deepEqual(h.state(), { sequence: 5, enabled: false, pending: null, inFlight: null });
});

test('the normal enable: one registration, confirmed, the flag set only after the answer', async () => {
  const h = harness();
  const done = h.intent().register();
  await tick();
  assert.equal(h.state()?.enabled, false, 'nothing is claimed before the server answers');
  assert.equal(h.state()?.inFlight, 1);
  h.next('register').land();
  await done;
  assert.deepEqual(h.state(), { sequence: 1, enabled: true, pending: null, inFlight: null });
  assert.equal(h.serverEnabled(), true);
  assert.equal(h.flights.length, 0, 'no cleanup after a confirmed registration');
});

test('a registration the server refused committed nothing: no cleanup, no flag', async () => {
  const h = harness();
  const done = h.intent().register();
  await tick();
  h.next('register').drop(new RpcRejectedError(400));
  await assert.rejects(done, RpcRejectedError);
  assert.deepEqual(h.state(), { sequence: 1, enabled: false, pending: null, inFlight: null });
  assert.equal(h.flights.length, 0);
});

test('server commit before abort: the row landed, the client aborted — the cleanup disables it', async () => {
  const h = harness();
  const controller = new AbortController();
  const done = h.intent().register(controller.signal);
  await tick();
  controller.abort(); // the harness lands the write silently on abort
  await tick();
  assert.equal(h.serverEnabled(), true, 'the server holds a row the client never confirmed');
  assert.equal(h.state()?.pending, 2, 'a disable with the next sequence is owed');
  assert.equal(h.state()?.enabled, false);
  h.next('disable').land();
  await assert.rejects(done, RpcAbortedError);
  assert.equal(h.serverEnabled(), false);
  assert.deepEqual(h.state(), { sequence: 2, enabled: false, pending: null, inFlight: null });
});

test('delayed commit after cleanup: the disable lands first, the late registration is refused', async () => {
  const h = harness();
  const done = h.intent().register();
  await tick();
  const register = h.next('register');
  register.lose(); // the client gives up; the server has not applied it yet
  await tick();
  h.next('disable').land();
  await assert.rejects(done);
  assert.equal(h.serverEnabled(), false);
  register.land(); // now the delayed registration reaches the server
  assert.equal(h.serverEnabled(), false, 'outranked: refused by sequence');
  assert.equal(h.server.subscriptionOf(INSTALL), null);
  assert.deepEqual(h.state(), { sequence: 2, enabled: false, pending: null, inFlight: null });
});

test('Continue after timeout: the education completes once, the abandoned write is cleaned up', async () => {
  const h = harness();
  const views: EducationView[] = [];
  let completes = 0;
  const actions = educationActions({
    resolvePermission: async () => ({ granted: true, canAskAgain: false, prompted: false }),
    register: (signal) => h.intent().register(signal),
    complete: async () => {
      completes += 1;
    },
    openSettings: () => {},
    onView: (view) => views.push(view),
    registrationTimeoutMs: 20,
  });
  const enable = actions.enable();
  await tick(5);
  const register = h.next('register');
  await tick(30); // the deadline passes: the signal fires, the write lands silently
  await enable;
  assert.equal(views.at(-1)?.phase, 'failed');
  assert.equal(h.serverEnabled(), true, 'the server committed in the abort window');
  assert.equal(h.state()?.pending, 2);
  await actions.skip(); // Continue without alerts
  assert.equal(completes, 1);
  h.next('disable').land();
  await tick();
  assert.equal(h.serverEnabled(), false);
  assert.equal(h.state()?.enabled, false);
  assert.equal(completes, 1, 'the late cleanup completes nothing again');
  assert.equal(register.sequence, 1);
});

test('immediate retry: the new registration outranks the pending cleanup and is confirmed', async () => {
  const h = harness();
  const first = h.intent().register();
  await tick();
  h.next('register').lose(); // unknown outcome
  await tick();
  const cleanup = h.next('disable');
  cleanup.lose(); // the client gives up on the cleanup too; the server may still apply it later
  await assert.rejects(first);
  assert.equal(h.state()?.pending, 2);
  const retry = h.intent().register(); // Try again, immediately
  await tick();
  // The retry first re-sends the owed cleanup (serialized before its own write) …
  const resend = h.next('disable');
  assert.equal(resend.sequence, 2);
  resend.lose(); // … still offline for that one
  await tick();
  const second = h.next('register');
  assert.equal(second.sequence, 3, 'the retry carries a higher sequence than the cleanup');
  second.land();
  await retry;
  assert.equal(h.serverEnabled(), true);
  assert.deepEqual(h.state(), { sequence: 3, enabled: true, pending: null, inFlight: null });
  // The first cleanup finally reaches the server: outranked, refused.
  cleanup.land();
  assert.equal(h.serverEnabled(), true, 'a stale cleanup never silences a confirmed retry');
});

test('stale cleanup after successful retry: delivered last, it changes nothing', async () => {
  const h = harness();
  const first = h.intent().register();
  await tick();
  h.next('register').landSilently(); // committed, client aborted
  await tick();
  const cleanup = h.next('disable');
  cleanup.lose(); // the cleanup cannot be sent now
  await assert.rejects(first);
  assert.equal(h.serverEnabled(), true);
  const retry = h.intent().register();
  await tick();
  h.next('disable').lose(); // the pending cleanup, retried first, still fails
  await tick();
  h.next('register').land();
  await retry;
  assert.equal(h.serverEnabled(), true);
  assert.equal(h.state()?.pending, null, 'a confirmed later registration settles the server state');
  cleanup.land(); // sequence 2 arrives after sequence 3
  assert.equal(h.serverEnabled(), true);
});

test('relaunch with a pending cleanup: reconcile sends it, and only it', async () => {
  const h = harness({
    stored: { sequence: 2, enabled: false, pending: 2, inFlight: null },
  });
  h.server.register(INSTALL, TOKEN, 'ios', new Date(0).toISOString(), 1);
  const done = h.intent().reconcile();
  await tick();
  const f = h.next('disable');
  assert.equal(f.sequence, 2);
  f.land();
  await done;
  assert.equal(h.serverEnabled(), false);
  assert.deepEqual(h.state(), { sequence: 2, enabled: false, pending: null, inFlight: null });
  assert.equal(h.flights.length, 0, 'nothing else is sent at launch');
});

test('relaunch after a crash mid-registration: the interrupted write is treated as unknown', async () => {
  const h = harness({
    stored: { sequence: 1, enabled: false, pending: null, inFlight: 1 },
  });
  const done = h.intent().reconcile();
  await tick();
  const f = h.next('disable');
  assert.equal(f.sequence, 2, 'the cleanup outranks the interrupted registration');
  f.land();
  await done;
  // The interrupted registration lands later: refused.
  h.server.register(INSTALL, TOKEN, 'ios', new Date(0).toISOString(), 1);
  assert.equal(h.serverEnabled(), false);
  assert.deepEqual(h.state(), { sequence: 2, enabled: false, pending: null, inFlight: null });
});

test('relaunch offline keeps the cleanup pending; it is not reported as settled', async () => {
  const h = harness({ stored: { sequence: 2, enabled: false, pending: 2, inFlight: null } });
  const done = h.intent().reconcile();
  await tick();
  h.next('disable').lose();
  await done;
  assert.equal(h.state()?.pending, 2);
  assert.equal(h.state()?.enabled, false);
});

test('the deliberate disable: the flag is cleared before the server is asked, and offline stays pending', async () => {
  const h = harness({ stored: { sequence: 3, enabled: true, pending: null, inFlight: null } });
  h.server.register(INSTALL, TOKEN, 'ios', new Date(0).toISOString(), 3);
  const done = h.intent().disable();
  await tick();
  assert.equal(h.state()?.enabled, false, 'cleared before the answer');
  assert.equal(h.state()?.pending, 4);
  h.next('disable').lose();
  await done;
  assert.equal(h.state()?.pending, 4, 'owed until confirmed');
  assert.equal(h.serverEnabled(), true, 'the server has not heard yet');
  const again = h.intent().reconcile();
  await tick();
  h.next('disable').land();
  await again;
  assert.equal(h.serverEnabled(), false);
  assert.equal(h.state()?.pending, null);
});

test('the silent refresh never cleans up: an unknown outcome re-asserts a state already wanted', async () => {
  const h = harness({ stored: { sequence: 1, enabled: true, pending: null, inFlight: null } });
  h.server.register(INSTALL, TOKEN, 'ios', new Date(0).toISOString(), 1);
  const done = h.intent().refresh();
  await tick();
  const f = h.next('register');
  assert.equal(f.sequence, 2);
  f.lose();
  await done; // swallowed
  assert.deepEqual(h.state(), { sequence: 2, enabled: true, pending: null, inFlight: null });
  assert.equal(h.flights.length, 0, 'no disable follows a refresh');
  f.land();
  assert.equal(h.serverEnabled(), true);
  // A user disable issued after the refresh still outranks its late landing.
  const off = h.intent().disable();
  await tick();
  h.next('disable').land();
  await off;
  assert.equal(h.serverEnabled(), false);
  // Not enabled, or a cleanup owed: the refresh sends nothing.
  await h.intent().refresh();
  assert.equal(h.flights.length, 0);
});

test('the migration carries the sequence rule for both RPCs and the reset', () => {
  const sql = readFileSync(
    join(
      __dirname,
      '..',
      '..',
      'supabase',
      'migrations',
      '20261004000000_push_subscription_sequence.sql',
    ),
    'utf8',
  );
  assert.ok(sql.includes('create table public.push_installation_sequences'));
  assert.ok(
    sql.includes('(v_last > p_sequence or (v_last = p_sequence and v_operation <> p_operation))'),
  );
  assert.ok(sql.includes('return query select (v_last is null), coalesce(v_last, 0::bigint);'));
  assert.ok(sql.includes('pg_advisory_xact_lock'));
  assert.equal((sql.match(/p_sequence bigint default null/g) ?? []).length, 2);
  for (const operation of ['register', 'disable']) {
    assert.ok(
      sql.includes(
        `from public.push_sequence_gate(p_installation_id, p_sequence, '${operation}') g;`,
      ),
    );
  }
  assert.equal(
    (sql.match(/jsonb_build_object\('applied', (true|false), 'last_sequence', v_last\)/g) ?? [])
      .length,
    4,
  );
  assert.ok(
    sql.includes(
      'drop function if exists public.register_push_subscription(text, text, text, text);',
    ),
  );
  assert.ok(sql.includes('drop function if exists public.disable_push_subscription(text);'));
  assert.ok(sql.includes('delete from public.push_installation_sequences'));
  assert.ok(
    !sql.includes('alter table public.push_subscriptions'),
    'expand only: no column change',
  );
});
