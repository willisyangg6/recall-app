/**
 * The safety contract of the read-retry decorator.
 *
 * The central property is negative and must be proved, not asserted in prose:
 * NO MUTATION IS EVER RETRIED. Three independent checks establish it —
 *
 *   1. structurally, by parsing supabase-store.ts and confirming every
 *      allowlisted method issues `.select()` and nothing else;
 *   2. by set algebra, confirming the allowlist is disjoint from every method
 *      that issues an insert/update/upsert/delete/rpc;
 *   3. behaviourally, by driving every mutating method through the wrapper with
 *      a transient-looking failure and counting exactly one call.
 *
 * Structural checks 1 and 2 read the real source, so a future edit that turns
 * an allowlisted read into a write fails this suite instead of silently
 * enabling duplicate writes.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { RETRYABLE_READ_METHODS, withReadRetry } from './read-retry';
import { SupabaseStore } from './supabase-store';

const SOURCE = readFileSync(path.join(import.meta.dirname, 'supabase-store.ts'), 'utf8');

/** Supabase verbs each SupabaseStore method issues, parsed from the source. */
function verbsByMethod(): Map<string, Set<string>> {
  const verbs = new Map<string, Set<string>>();
  let current: string | null = null;
  for (const line of SOURCE.split('\n')) {
    const signature = /^ {2}(?:async )?([a-zA-Z_][a-zA-Z0-9_]*)\(/.exec(line);
    if (signature && signature[1] !== 'constructor') {
      current = signature[1];
      verbs.set(current, new Set());
      continue;
    }
    if (!current) continue;
    for (const match of line.matchAll(/\.(insert|update|upsert|delete|rpc|select)\(/g)) {
      verbs.get(current)?.add(match[1]);
    }
  }
  return verbs;
}

const MUTATING_VERBS = ['insert', 'update', 'upsert', 'delete', 'rpc'];

test('the source parser actually found the store methods it is asked to police', () => {
  const verbs = verbsByMethod();
  // A broken parser would vacuously pass every check below.
  assert.ok(verbs.size > 40, `expected >40 parsed methods, got ${verbs.size}`);
  assert.ok(verbs.get('applyCaseTransition')?.has('rpc'));
  assert.ok(verbs.get('getCase')?.has('select'));
  assert.ok(verbs.get('replaceProducts')?.has('delete'));
});

test('every allowlisted method exists on SupabaseStore — no typo can silently disable retry', () => {
  const prototype = SupabaseStore.prototype as unknown as Record<string, unknown>;
  for (const name of RETRYABLE_READ_METHODS) {
    assert.equal(typeof prototype[name], 'function', `${name} is not a SupabaseStore method`);
  }
});

test('STRUCTURAL: every allowlisted method is .select()-only in the real source', () => {
  const verbs = verbsByMethod();
  for (const name of RETRYABLE_READ_METHODS) {
    const issued = verbs.get(name);
    assert.ok(issued, `${name} not found in supabase-store.ts`);
    assert.ok(issued.has('select'), `${name} issues no select — is it really a read?`);
    for (const verb of MUTATING_VERBS) {
      assert.ok(!issued.has(verb), `allowlisted read ${name} issues .${verb}() — MUST NOT RETRY`);
    }
  }
});

test('STRUCTURAL: the allowlist is disjoint from every mutating store method', () => {
  const mutators = [...verbsByMethod()]
    .filter(([, issued]) => MUTATING_VERBS.some((verb) => issued.has(verb)))
    .map(([name]) => name);
  // Sanity: the read-modify-write helpers must be on the mutator side.
  for (const expected of [
    'applyCaseTransition',
    'archiveSnapshot',
    'insertNotificationIfAbsent',
    'insertSourceRecord',
    'markSourceRecordApplied',
    'replaceProducts',
    'seedLegacyAppliedMarker',
    'updateCaseHazard',
    'updateSourceRecordNormalized',
  ]) {
    assert.ok(mutators.includes(expected), `${expected} should be classified as a mutator`);
  }
  const overlap = mutators.filter((name) => RETRYABLE_READ_METHODS.has(name));
  assert.deepEqual(overlap, [], `mutating methods found in the read allowlist: ${overlap}`);
});

// ── Behavioural proof ───────────────────────────────────────────────────────

interface Probe {
  calls: string[];
  store: Record<string, (...args: unknown[]) => Promise<unknown>>;
}

/** A fake store whose every method fails with the most transient error there is. */
function alwaysTransient(names: string[]): Probe {
  const calls: string[] = [];
  const store: Probe['store'] = {};
  for (const name of names) {
    store[name] = async () => {
      calls.push(name);
      throw new Error('TypeError: fetch failed');
    };
  }
  return { calls, store };
}

const NO_WAIT = { sleep: async () => {}, jitter: () => 0.5 };

test('BEHAVIOURAL: mutating methods are called exactly once, even on a transient failure', async () => {
  const mutators = [...verbsByMethod()]
    .filter(([, issued]) => MUTATING_VERBS.some((verb) => issued.has(verb)))
    .map(([name]) => name);
  assert.ok(mutators.length > 15, `expected a substantial mutator set, got ${mutators.length}`);

  const probe = alwaysTransient(mutators);
  const wrapped = withReadRetry(probe.store, NO_WAIT);
  for (const name of mutators) {
    await assert.rejects(() => wrapped[name]());
  }
  // One call per mutator: no retry, no skip.
  assert.equal(probe.calls.length, mutators.length);
  assert.deepEqual([...new Set(probe.calls)].sort(), [...mutators].sort());
});

test('BEHAVIOURAL: an allowlisted read retries to the policy bound and then exhausts', async () => {
  const probe = alwaysTransient(['getLatestSnapshotMeta']);
  const wrapped = withReadRetry(probe.store, NO_WAIT);
  await assert.rejects(
    () => wrapped.getLatestSnapshotMeta(),
    (error: unknown) =>
      error instanceof Error && /still failing after 4 attempt\(s\)/.test(error.message),
  );
  assert.equal(probe.calls.length, 4);
});

test('a method absent from the allowlist is passed through untouched', async () => {
  const probe = alwaysTransient(['someFutureMethod']);
  const wrapped = withReadRetry(probe.store, NO_WAIT);
  await assert.rejects(() => wrapped.someFutureMethod());
  // Default is NOT retried: forgetting to update the allowlist stays safe.
  assert.equal(probe.calls.length, 1);
});

test('the wrapper preserves `this`, arguments, and the resolved value', async () => {
  class Fake {
    seen: unknown[] = [];
    async getCase(id: string) {
      this.seen.push(id);
      return { id, via: 'this-is-bound' };
    }
    async updateCase(id: string) {
      this.seen.push(`mutate:${id}`);
      return undefined;
    }
  }
  const fake = new Fake();
  const wrapped = withReadRetry(fake, NO_WAIT);
  assert.deepEqual(await wrapped.getCase('c-1'), { id: 'c-1', via: 'this-is-bound' });
  await wrapped.updateCase('c-2');
  assert.deepEqual(fake.seen, ['c-1', 'mutate:c-2']);
});

test('a read that succeeds on the first attempt is called exactly once', async () => {
  let calls = 0;
  const wrapped = withReadRetry(
    {
      listCases: async () => {
        calls += 1;
        return ['a'];
      },
    },
    NO_WAIT,
  );
  assert.deepEqual(await wrapped.listCases(), ['a']);
  assert.equal(calls, 1);
});
