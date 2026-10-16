/**
 * The missing or unreadable age-record fallback (2026-10-16): a regulated
 * 13–17 user must never register without the revocation mapping because the
 * stored age record could not be read. With no usable record, registration
 * uses a fresh age check's own decision; when that cannot say, it is
 * `undetermined` and the route is `blocked` (alerts stay off).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  runAgeCheck,
  type AgeCheckPorts,
  type AgeDecision,
  type AgeRangeAnswer,
  type AgeRecord,
} from './age-assurance';
import {
  registrationEligibility,
  resolveRegistrationRoute,
  routedRegistration,
  RevocationKeyUnavailableError,
} from './revocation-key';

const ACCOUNT = 'app-transaction-for-tests';

function record(answer: AgeRecord['answer'], eligible: boolean | null): AgeRecord {
  return {
    version: 1,
    checkedAt: '2026-10-16T00:00:00.000Z',
    answer,
    eligible,
    regulatoryFeatures: null,
  };
}

const TEEN: AgeRecord['answer'] = {
  kind: 'shared',
  lowerBound: 13,
  upperBound: 15,
  declaration: 'guardianDeclared',
  parentalControls: [],
};
const ADULT: AgeRecord['answer'] = {
  kind: 'shared',
  lowerBound: 18,
  upperBound: null,
  declaration: 'selfDeclared',
  parentalControls: [],
};

const proceed = (
  ageClass: 'minor' | 'adult' | 'unknown',
  regulated: boolean | null,
  basis: 'shared' | 'os-version' | 'declined' | 'not-regulated' = 'shared',
): AgeDecision => ({ kind: 'proceed', basis, ageClass, regulated });

/** A fresh check that records whether it ran. */
function freshCheck(decision: AgeDecision | Error) {
  let calls = 0;
  return {
    checkAge: async () => {
      calls += 1;
      if (decision instanceof Error) throw decision;
      return decision;
    },
    calls: () => calls,
  };
}

test('a usable record decides exactly as before, without a fresh check', async () => {
  for (const [stored, expected] of [
    [record(TEEN, true), true],
    [record(TEEN, false), false],
    [record(ADULT, true), false],
    [record({ kind: 'declined' }, true), false],
  ] as const) {
    const check = freshCheck(proceed('minor', true));
    assert.equal(
      await registrationEligibility({ loadRecord: async () => stored, checkAge: check.checkAge }),
      expected,
    );
    assert.equal(check.calls(), 0, 'no fresh check while the record is usable');
  }
});

test('a missing record uses the fresh check: only a regulated minor is eligible', async () => {
  const cases: [AgeDecision, boolean][] = [
    [proceed('minor', true), true],
    [proceed('adult', true), false],
    [proceed('minor', false), false],
    [proceed('minor', null), false],
    [proceed('unknown', null, 'os-version'), false],
    [proceed('unknown', false, 'not-regulated'), false],
    [proceed('unknown', false, 'declined'), false],
  ];
  for (const [decision, expected] of cases) {
    const check = freshCheck(decision);
    assert.equal(
      await registrationEligibility({ loadRecord: async () => null, checkAge: check.checkAge }),
      expected,
      JSON.stringify(decision),
    );
    assert.equal(check.calls(), 1);
  }
});

test('an unreadable record is treated like a missing one', async () => {
  const check = freshCheck(proceed('minor', true));
  assert.equal(
    await registrationEligibility({
      loadRecord: async () => {
        throw new Error('keychain read failed');
      },
      checkAge: check.checkAge,
    }),
    true,
  );
  assert.equal(check.calls(), 1);
});

test('a fresh check that cannot say is undetermined, never "not eligible"', async () => {
  for (const decision of [
    { kind: 'retry', reason: 'unavailable' } as AgeDecision,
    { kind: 'retry', reason: 'not-signed-in' } as AgeDecision,
    { kind: 'under13' } as AgeDecision,
    new Error('age service threw'),
  ]) {
    const check = freshCheck(decision);
    assert.equal(
      await registrationEligibility({ loadRecord: async () => null, checkAge: check.checkAge }),
      'undetermined',
    );
  }
});

test('undetermined eligibility blocks the route before StoreKit or the held key is read', async () => {
  let reads = 0;
  const route = await resolveRegistrationRoute({
    isEligible: async () => 'undetermined',
    isKeyHeld: async () => {
      reads += 1;
      return true;
    },
    readAppTransactionId: async () => {
      reads += 1;
      return ACCOUNT;
    },
  });
  assert.deepEqual(route, { kind: 'blocked' });
  assert.equal(reads, 0);
});

test('a blocked registration sends nothing and raises the existing blocked error', async () => {
  const sent: string[] = [];
  const register = routedRegistration({
    resolveRoute: () =>
      resolveRegistrationRoute({
        isEligible: () =>
          registrationEligibility({
            loadRecord: async () => null,
            checkAge: async () => ({ kind: 'retry', reason: 'unavailable' }),
          }),
        isKeyHeld: async () => false,
        readAppTransactionId: async () => ACCOUNT,
      }),
    registerPlain: async (sequence) => {
      sent.push(`plain#${sequence}`);
      return { applied: true, lastSequence: sequence };
    },
    registerKeyed: async (sequence) => {
      sent.push(`keyed#${sequence}`);
      return { applied: true, lastSequence: sequence };
    },
    clearKey: async () => {},
    setKeyHeld: async () => {},
  });
  await assert.rejects(register(1), RevocationKeyUnavailableError);
  assert.deepEqual(sent, []);
});

/** The real launch check over fake native ports, with no stored record. */
function ports(over: Partial<AgeCheckPorts> & { answer?: AgeRangeAnswer }): AgeCheckPorts {
  return {
    os: 'ios',
    osVersion: '26.5.2',
    isEligible: async () => true,
    requiredRegulatoryFeatures: async () => ['declaredAgeRangeRequired'],
    requestAgeRange: async () => over.answer ?? { ...TEEN },
    loadRecord: async () => null,
    saveRecord: async () => {},
    now: () => new Date('2026-10-16T00:00:00.000Z'),
    ...over,
  };
}

test('with the real check: a regulated teen is keyed even when saving the record fails', async () => {
  let reads = 0;
  const eligibility = await registrationEligibility({
    loadRecord: async () => {
      reads += 1;
      return null;
    },
    checkAge: () =>
      runAgeCheck(
        ports({
          saveRecord: async () => {
            throw new Error('keychain write failed');
          },
        }),
      ),
  });
  assert.equal(eligibility, true, 'the decision itself is used, not a re-read of the record');
  assert.equal(reads, 1, 'the record is read once, before the check');

  const route = await resolveRegistrationRoute({
    isEligible: async () => eligibility,
    isKeyHeld: async () => false,
    readAppTransactionId: async () => ACCOUNT,
  });
  assert.deepEqual(route, { kind: 'keyed', appTransactionId: ACCOUNT, clearAfter: false });
});

test('with the real check: adults and unregulated users stay on the plain route', async () => {
  for (const over of [
    { answer: { ...ADULT } },
    { isEligible: async () => false, requiredRegulatoryFeatures: async () => [] },
    { osVersion: '18.6' },
  ] as Partial<AgeCheckPorts>[]) {
    const eligibility = await registrationEligibility({
      loadRecord: async () => null,
      checkAge: () => runAgeCheck(ports(over)),
    });
    assert.equal(eligibility, false, JSON.stringify(over));
    assert.deepEqual(
      await resolveRegistrationRoute({
        isEligible: async () => eligibility,
        isKeyHeld: async () => false,
        readAppTransactionId: async () => ACCOUNT,
      }),
      { kind: 'plain', clearAfter: false },
    );
  }
});

test('with the real check: a regulated user Apple cannot answer for is blocked', async () => {
  const eligibility = await registrationEligibility({
    loadRecord: async () => null,
    checkAge: () =>
      runAgeCheck(ports({ requestAgeRange: async () => ({ kind: 'failed', code: null }) })),
  });
  assert.equal(eligibility, 'undetermined');
});
