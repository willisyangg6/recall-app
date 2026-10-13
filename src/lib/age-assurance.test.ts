/**
 * The launch age check (age assurance, 2026-10-13): the decision table
 * against fakes, the stored record, the development override, and the
 * root layout's ordering — nothing that reaches a server mounts beside the
 * gate.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  AGE_GATES,
  answerFromNative,
  classifyAgeRange,
  regulatedStatus,
  runAgeCheck,
  type AgeCheckPorts,
  type AgeRangeAnswer,
  type AgeRecord,
} from './age-assurance';
import { sanitizeAgeRecord } from './age-record';
import { developmentAgeScenario } from './development-age-scenario';
import { revocationKeyEligible } from './revocation-key';

const NOW = new Date('2026-10-13T12:00:00.000Z');

function shared(lowerBound: number | null, upperBound: number | null): AgeRangeAnswer {
  return {
    kind: 'shared',
    lowerBound,
    upperBound,
    declaration: 'selfDeclared',
    parentalControls: [],
  };
}

function storedRecord(
  answer: AgeRecord['answer'],
  checkedAt = '2026-06-01T00:00:00.000Z',
): AgeRecord {
  return { version: 1, checkedAt, answer, eligible: true, regulatoryFeatures: null };
}

function harness(overrides: Partial<AgeCheckPorts> = {}) {
  const calls: string[] = [];
  const saved: AgeRecord[] = [];
  const ports: AgeCheckPorts = {
    os: 'ios',
    osVersion: '26.3.1',
    isEligible: async () => null,
    requiredRegulatoryFeatures: async () => null,
    requestAgeRange: async (gates) => {
      calls.push(`request ${gates.join(',')}`);
      return shared(18, null);
    },
    loadRecord: async () => null,
    saveRecord: async (record) => {
      saved.push(record);
    },
    now: () => NOW,
    ...overrides,
  };
  return { ports, calls, saved };
}

test('classification follows the statute categories, and missing bounds stay unknown', () => {
  assert.equal(classifyAgeRange(null, 12), 'under13');
  assert.equal(classifyAgeRange(0, 12), 'under13');
  assert.equal(classifyAgeRange(13, 15), 'minor');
  assert.equal(classifyAgeRange(16, 17), 'minor');
  assert.equal(classifyAgeRange(18, null), 'adult');
  assert.equal(classifyAgeRange(null, null), 'unknown');
  // A range Apple widened past Lotly's gates still classifies by its bounds.
  assert.equal(classifyAgeRange(13, 17), 'minor');
  assert.equal(classifyAgeRange(21, null), 'adult');
  // Review 2026-10-13: "16 or older" may be 18 — still a minor for Lotly.
  assert.equal(classifyAgeRange(16, null), 'minor');
  // A range reaching below 13 never shows the shopper is 13 or older.
  assert.equal(classifyAgeRange(null, 17), 'unknown');
  assert.equal(classifyAgeRange(0, 17), 'unknown');
  assert.equal(classifyAgeRange(10, 15), 'unknown');
});

test('Lotly asks for the three SB 2420 gates', async () => {
  const { ports, calls } = harness();
  await runAgeCheck(ports);
  assert.deepEqual([...AGE_GATES], [13, 16, 18]);
  assert.deepEqual(calls, ['request 13,16,18']);
});

test('regulated status: Apple’s required feature or eligibility, never a guess', () => {
  assert.equal(regulatedStatus(null, ['declaredAgeRangeRequired']), true);
  assert.equal(regulatedStatus(false, ['declaredAgeRangeRequired']), true);
  assert.equal(regulatedStatus(true, null), true);
  assert.equal(regulatedStatus(false, []), false);
  assert.equal(regulatedStatus(null, []), null);
  assert.equal(regulatedStatus(null, null), null);
});

test('not iOS, or iOS below 26: proceed WITHOUT calling the fail-open API', async () => {
  for (const [os, osVersion, basis] of [
    ['android', 35, 'platform'],
    ['web', '', 'platform'],
    ['ios', '18.6', 'os-version'],
    ['ios', '25.9', 'os-version'],
    ['ios', 'garbage', 'os-version'],
  ] as const) {
    const { ports, calls, saved } = harness({ os, osVersion });
    const decision = await runAgeCheck(ports);
    assert.deepEqual(decision, { kind: 'proceed', basis, ageClass: 'unknown', regulated: null });
    assert.deepEqual(calls, [], `${os} ${osVersion} must not ask`);
    assert.deepEqual(saved, []);
  }
});

test('a shared range decides: under 13 stops, 13–17 and 18+ proceed', async () => {
  const cases: [AgeRangeAnswer, string, string | null][] = [
    [shared(null, 12), 'under13', null],
    [shared(13, 15), 'proceed', 'minor'],
    [shared(16, 17), 'proceed', 'minor'],
    [shared(18, null), 'proceed', 'adult'],
  ];
  for (const [answer, kind, ageClass] of cases) {
    const { ports, saved } = harness({
      requestAgeRange: async () => answer,
      isEligible: async () => true,
    });
    const decision = await runAgeCheck(ports);
    assert.equal(decision.kind, kind);
    if (decision.kind === 'proceed') {
      assert.equal(decision.ageClass, ageClass);
      assert.equal(decision.basis, 'shared');
      assert.equal(decision.regulated, true);
    }
    // The whole answer is kept on the device, with the regulatory flags.
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0]?.answer, answer);
    assert.equal(saved[0]?.eligible, true);
    assert.equal(saved[0]?.checkedAt, NOW.toISOString());
  }
});

test('a decline proceeds unless Apple says the account is regulated', async () => {
  for (const [eligible, features, expected] of [
    [false, null, 'proceed'],
    [null, null, 'proceed'], // iOS 26.0–26.1: regulated accounts cannot decline
    [true, null, 'retry'],
    [null, ['declaredAgeRangeRequired'], 'retry'],
  ] as const) {
    const { ports, saved } = harness({
      isEligible: async () => eligible,
      requiredRegulatoryFeatures: async () => (features ? [...features] : null),
      requestAgeRange: async () => ({ kind: 'declined' }),
    });
    const decision = await runAgeCheck(ports);
    assert.equal(decision.kind, expected);
    if (decision.kind === 'proceed') assert.equal(decision.basis, 'declined');
    assert.deepEqual(saved[0]?.answer, { kind: 'declined' });
  }
});

test('a failure proceeds only when Apple says NOT regulated; otherwise it waits', async () => {
  const failed = async (): Promise<AgeRangeAnswer> => ({ kind: 'failed', code: 'ERR_X' });

  const notRegulated = harness({ isEligible: async () => false, requestAgeRange: failed });
  assert.deepEqual(await runAgeCheck(notRegulated.ports), {
    kind: 'proceed',
    basis: 'not-regulated',
    ageClass: 'unknown',
    regulated: false,
  });
  assert.deepEqual(notRegulated.saved, [], 'a failure never writes a record');

  for (const eligible of [true, null]) {
    const { ports } = harness({ isEligible: async () => eligible, requestAgeRange: failed });
    assert.deepEqual(await runAgeCheck(ports), { kind: 'retry', reason: 'unavailable' });
  }

  // Throwing ports are failures too, never an answer.
  const throwing = harness({
    isEligible: async () => {
      throw new Error('notAvailable');
    },
    requiredRegulatoryFeatures: async () => {
      throw new Error('notAvailable');
    },
    requestAgeRange: async () => {
      throw new Error('boom');
    },
    loadRecord: async () => {
      throw new Error('keychain');
    },
  });
  assert.deepEqual(await runAgeCheck(throwing.ports), { kind: 'retry', reason: 'unavailable' });
});

test('not signed in to an Apple Account says so', async () => {
  const { ports } = harness({
    requestAgeRange: async () => ({ kind: 'failed', code: 'ERR_AGE_RANGE_NOT_AVAILABLE' }),
  });
  assert.deepEqual(await runAgeCheck(ports), { kind: 'retry', reason: 'not-signed-in' });
});

test('a shared answer without bounds is a failure, not an adult', async () => {
  const { ports } = harness({ requestAgeRange: async () => shared(null, null) });
  assert.deepEqual(await runAgeCheck(ports), { kind: 'retry', reason: 'unavailable' });
});

test('a stored answer only restricts: it never admits a launch the fresh check failed', async () => {
  const failed = async (): Promise<AgeRangeAnswer> => ({ kind: 'failed', code: null });

  // Review 2026-10-13: the record is per device, not per Apple Account. An
  // adult's stored answer must not admit whoever is signed in after a
  // failure — another account, or nobody (a signed-out child).
  for (const code of [null, 'ERR_AGE_RANGE_NOT_AVAILABLE']) {
    for (const stored of [shared(18, null), shared(16, 17), shared(13, 15)]) {
      const { ports } = harness({
        requestAgeRange: async () => ({ kind: 'failed', code }),
        loadRecord: async () => storedRecord(stored as AgeRecord['answer']),
      });
      assert.equal((await runAgeCheck(ports)).kind, 'retry', `${code} ${JSON.stringify(stored)}`);
    }
  }

  // The under-13 stop holds offline, for a year.
  const child = harness({
    requestAgeRange: failed,
    loadRecord: async () => storedRecord(shared(null, 12) as AgeRecord['answer']),
  });
  assert.deepEqual(await runAgeCheck(child.ports), { kind: 'under13' });
  const staleChild = harness({
    requestAgeRange: failed,
    loadRecord: async () =>
      storedRecord(shared(null, 12) as AgeRecord['answer'], '2025-10-01T00:00:00.000Z'),
  });
  assert.equal((await runAgeCheck(staleChild.ports)).kind, 'retry');

  // Apple saying "not regulated" still lets a failed check proceed, whatever is stored.
  const notRegulated = harness({
    requestAgeRange: failed,
    isEligible: async () => false,
    loadRecord: async () => storedRecord(shared(18, null) as AgeRecord['answer']),
  });
  assert.equal((await runAgeCheck(notRegulated.ports)).kind, 'proceed');

  // A fresh answer always wins over the stored one, in both directions.
  const grown = harness({
    requestAgeRange: async () => shared(13, 15),
    loadRecord: async () => storedRecord(shared(null, 12) as AgeRecord['answer']),
  });
  assert.equal((await runAgeCheck(grown.ports)).kind, 'proceed');
  const switched = harness({
    requestAgeRange: async () => shared(null, 12),
    loadRecord: async () => storedRecord(shared(18, null) as AgeRecord['answer']),
  });
  assert.deepEqual(await runAgeCheck(switched.ports), { kind: 'under13' });
});

test('native answers normalize; only the decline code reads as a decline', async () => {
  assert.deepEqual(
    await answerFromNative(async () => ({
      lowerBound: 13,
      upperBound: 15,
      ageRangeDeclaration: 'confirmed',
      activeParentalControls: ['communicationLimits'],
    })),
    {
      kind: 'shared',
      lowerBound: 13,
      upperBound: 15,
      declaration: 'confirmed',
      parentalControls: ['communicationLimits'],
    },
  );
  assert.deepEqual(
    await answerFromNative(async () => {
      throw Object.assign(new Error('declined'), { code: 'ERR_AGE_RANGE_USER_DECLINED' });
    }),
    { kind: 'declined' },
  );
  assert.deepEqual(
    await answerFromNative(async () => {
      throw Object.assign(new Error('n/a'), { code: 'ERR_AGE_RANGE_NOT_AVAILABLE' });
    }),
    { kind: 'failed', code: 'ERR_AGE_RANGE_NOT_AVAILABLE' },
  );
  assert.deepEqual(
    await answerFromNative(async () => {
      throw 'odd';
    }),
    { kind: 'failed', code: null },
  );
});

test('the stored record round-trips, and anything malformed reads as no record', () => {
  const record = storedRecord(shared(16, 17) as AgeRecord['answer']);
  assert.deepEqual(sanitizeAgeRecord(JSON.parse(JSON.stringify(record))), record);
  assert.deepEqual(
    sanitizeAgeRecord(storedRecord({ kind: 'declined' })),
    storedRecord({ kind: 'declined' }),
  );
  for (const bad of [
    null,
    'x',
    { ...record, version: 2 },
    { ...record, checkedAt: 'not a date' },
    { ...record, eligible: 'yes' },
    { ...record, answer: { kind: 'failed', code: null } },
    { ...record, answer: { ...record.answer, lowerBound: '18' } },
    { ...record, answer: { ...record.answer, upperBound: -1 } },
    { ...record, regulatoryFeatures: [1] },
  ]) {
    assert.equal(sanitizeAgeRecord(bad), null, JSON.stringify(bad));
  }
});

test('the development override is inert in a release build', () => {
  assert.equal(developmentAgeScenario('under13', false), null);
  assert.equal(developmentAgeScenario('adult', false), null);
  assert.deepEqual(developmentAgeScenario('under13', true), { kind: 'under13' });
  assert.deepEqual(developmentAgeScenario('not-signed-in', true), {
    kind: 'retry',
    reason: 'not-signed-in',
  });
  assert.equal(developmentAgeScenario('pending', true), 'pending');
  assert.equal(developmentAgeScenario(undefined, true), null);
  assert.equal(developmentAgeScenario('nonsense', true), null);
});

test('the root layout mounts every server-facing launch task beneath the age gate', () => {
  const layout = readFileSync(join(__dirname, '..', 'app', '_layout.tsx'), 'utf8');
  const root = layout.slice(
    layout.indexOf('export default function RootLayout'),
    layout.indexOf('function LaunchedApp'),
  );
  const launched = layout.slice(
    layout.indexOf('function LaunchedApp'),
    layout.indexOf('function RootNavigator'),
  );
  assert.match(root, /<AgeGate fontsSettled=\{[^}]+\}>\s*<LaunchedApp/);
  for (const task of [
    'flushPreferencesSync',
    'useInstallationCheckin',
    'AccessProvider',
    'RootNavigator',
    'usePushNotifications',
  ]) {
    assert.doesNotMatch(root, new RegExp(task), `${task} must not run beside the gate`);
  }
  assert.match(launched, /flushPreferencesSync\(\)/);
  assert.match(launched, /useInstallationCheckin\(\)/);
  assert.match(launched, /<AccessProvider>/);
});

test('the age range never reaches a network client', () => {
  // The record's readers are the check and the revocation-key rule. No
  // module that talks to a server imports the age modules, except
  // push-registration, which reads the record ONLY to choose how to
  // register — the only value it ever sends is Apple's app id (keyed route).
  for (const file of [
    'push-api.ts',
    'installation-checkin-runner.ts',
    'preferences-store.ts',
    'revocation-key-api.ts',
    'age-stop-alerts.ts',
  ]) {
    const source = readFileSync(join(__dirname, file), 'utf8');
    assert.doesNotMatch(source, /age-record|age-assurance|age-range-service/, file);
  }
  const registration = readFileSync(join(__dirname, 'push-registration.ts'), 'utf8');
  assert.equal(registration.match(/loadAgeRecord\(\)/g)?.length, 1);
  assert.match(registration, /revocationKeyEligible\(await loadAgeRecord\(\)\)/);
  assert.doesNotMatch(registration, /lowerBound|upperBound|ageClass|regulatoryFeatures/);
  const api = readFileSync(join(__dirname, 'revocation-key-api.ts'), 'utf8');
  assert.deepEqual([...api.matchAll(/p_[a-z_]+/g)].map((m) => m[0]).sort(), [
    'p_app_transaction_id',
    'p_app_version',
    'p_expo_push_token',
    'p_installation_id',
    'p_installation_id',
    'p_platform',
    'p_sequence',
  ]);
});

test('the under-13 stop sends only the existing disable, carrying the installation id', () => {
  const gate = readFileSync(join(__dirname, '..', 'components', 'age-gate.tsx'), 'utf8');
  assert.match(gate, /void disableAlertsAfterAgeStop\(\)\.catch\(\(\) => \{\}\);/);
  const registration = readFileSync(join(__dirname, 'push-registration.ts'), 'utf8');
  const block = registration.slice(
    registration.indexOf('export function disableAlertsAfterAgeStop'),
  );
  const body = block.slice(0, block.indexOf('\n}\n'));
  // Never mints an id; intents built without a push token can only disable.
  assert.match(body, /peekInstallationId,/);
  assert.match(body, /installationIntent\(installationId, null\)/);
  assert.doesNotMatch(body, /getOrCreateInstallationId|register|Purchases|refresh/);
});

test('only a regulated 13–17 answer is eligible to send the revocation key', () => {
  const record = (
    answer: AgeRecord['answer'],
    eligible: boolean | null,
    features: string[] | null = null,
  ): AgeRecord => ({
    version: 1,
    checkedAt: '2026-10-13T00:00:00.000Z',
    answer,
    eligible,
    regulatoryFeatures: features,
  });
  const teen = shared(13, 15) as AgeRecord['answer'];
  assert.equal(revocationKeyEligible(record(teen, true)), true);
  assert.equal(
    revocationKeyEligible(
      record(shared(16, 17) as AgeRecord['answer'], null, ['declaredAgeRangeRequired']),
    ),
    true,
  );
  assert.equal(revocationKeyEligible(record(shared(16, null) as AgeRecord['answer'], true)), true);
  // Not regulated, or unknown: never.
  assert.equal(revocationKeyEligible(record(teen, false)), false);
  assert.equal(revocationKeyEligible(record(teen, null)), false);
  assert.equal(revocationKeyEligible(record(teen, null, [])), false);
  // Adults, under-13s, ranges reaching below 13, declines, nothing stored: never.
  assert.equal(revocationKeyEligible(record(shared(18, null) as AgeRecord['answer'], true)), false);
  assert.equal(revocationKeyEligible(record(shared(null, 12) as AgeRecord['answer'], true)), false);
  assert.equal(revocationKeyEligible(record(shared(null, 17) as AgeRecord['answer'], true)), false);
  assert.equal(revocationKeyEligible(record({ kind: 'declined' }, true)), false);
  assert.equal(revocationKeyEligible(null), false);
});
