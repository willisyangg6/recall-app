/**
 * The notification education's simulated enable outcomes (2026-10-04), as
 * data and pure ports: the catalogue the Design Preview lists, and the
 * permission/registration stand-ins each entry means. Expo-free, so the
 * matrix is provable in Node; the development module that persists the
 * choice is the only thing that reaches these from the app.
 *
 * The permission side replaces the system read/prompt with a fixed answer;
 * the registration side replaces the token + server write with a timer.
 * The real ports' CONTRACT is kept exactly: `register` honours its abort
 * signal (rejects with the same aborted error once the signal fires) —
 * except `granted-late-success`, which deliberately ignores it, to prove
 * that a result arriving after the deadline or after `Continue without
 * alerts` changes nothing on the screen.
 */

import { RpcAbortedError } from './push-api';
import type { EnablePorts, PermissionResolution } from './push-registration';

export type DevelopmentEnableScenarioId =
  | 'live'
  | 'granted-success'
  | 'granted-failure'
  | 'granted-timeout'
  | 'granted-late-success'
  | 'denied-now'
  | 'blocked-then-granted'
  | 'blocked';

export const DEVELOPMENT_ENABLE_SCENARIOS: readonly {
  id: DevelopmentEnableScenarioId;
  title: string;
  expectation: string;
}[] = [
  {
    id: 'live',
    title: 'Live',
    expectation:
      'The real system permission and the real registration, as shipped. A granted permission ' +
      'registers this simulator with the production server: choose a simulated scenario first.',
  },
  {
    id: 'granted-success',
    title: 'Granted, registration succeeds (simulated)',
    expectation:
      'No prompt; Turn on shows Opening… for about a second, then the Feed with Your ' +
      'preferences are set. Nothing is registered.',
  },
  {
    id: 'granted-failure',
    title: 'Granted, registration fails (simulated)',
    expectation:
      'No prompt; after about a second the failed notice: We couldn’t finish turning on alerts. ' +
      'Try again fails the same way; Continue without alerts opens the Feed.',
  },
  {
    id: 'granted-timeout',
    title: 'Granted, registration never answers (simulated)',
    expectation:
      'No prompt; Opening… for 10 s, then the failed notice (the attempt is aborted at the ' +
      'deadline). Try again waits 10 s again; Continue without alerts opens the Feed.',
  },
  {
    id: 'granted-late-success',
    title: 'Granted, registration answers late (simulated)',
    expectation:
      'No prompt; Opening… for 10 s, then the failed notice. The registration then "succeeds" ' +
      '4 s later, ignoring the abort: the screen must not change and nothing completes. ' +
      'Continue without alerts opens the Feed once.',
  },
  {
    id: 'denied-now',
    title: 'Denied at the prompt (simulated)',
    expectation: 'No real prompt; Turn on completes to the Feed, with no enabled claim.',
  },
  {
    id: 'blocked-then-granted',
    title: 'Denied before; Settings grants (simulated)',
    expectation:
      'Turn on shows the blocked notice: Notifications are turned off for Lotly. Open settings ' +
      'opens the real Settings; coming back re-checks, finds the permission granted, registers ' +
      '(simulated) and opens the Feed.',
  },
  {
    id: 'blocked',
    title: 'Denied before; stays denied (simulated)',
    expectation:
      'The blocked notice; Open settings opens the real Settings; coming back re-checks and ' +
      'stays on the notice. Continue without alerts opens the Feed.',
  },
];

/** How long a simulated registration takes to answer. */
export const SIMULATED_REGISTRATION_MS = 900;
/** How long after the 10 s deadline the late scenario answers. */
export const SIMULATED_LATE_ANSWER_MS = 14_000;

const GRANTED: PermissionResolution = { granted: true, canAskAgain: false, prompted: false };
const BLOCKED: PermissionResolution = { granted: false, canAskAgain: false, prompted: false };
const DENIED_NOW: PermissionResolution = { granted: false, canAskAgain: false, prompted: true };

function after(ms: number, signal?: AbortSignal, honourAbort = true): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (honourAbort && signal) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new RpcAbortedError());
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * The simulated ports for one scenario. Pure apart from timers; the
 * `blocked-then-granted` scenario answers blocked once per instance, then
 * granted — one instance per education visit, so the visit's first Turn on
 * is blocked and the re-check after Settings is granted.
 */
export function simulatedEnablePorts(
  id: Exclude<DevelopmentEnableScenarioId, 'live'>,
): EnablePorts {
  let permissionReads = 0;
  return {
    async resolvePermission() {
      permissionReads += 1;
      switch (id) {
        case 'denied-now':
          return DENIED_NOW;
        case 'blocked':
          return BLOCKED;
        case 'blocked-then-granted':
          return permissionReads === 1 ? BLOCKED : GRANTED;
        default:
          return GRANTED;
      }
    },
    async register(signal) {
      switch (id) {
        case 'granted-failure':
          await after(SIMULATED_REGISTRATION_MS, signal);
          throw new Error('Simulated registration failure (development scenario).');
        case 'granted-timeout':
          // Answers only by abort: the deadline is what ends it.
          await after(2 ** 31 - 1, signal);
          return;
        case 'granted-late-success':
          // Ignores the abort on purpose: a success that lands after the
          // deadline, or after Continue without alerts, must change nothing.
          await after(SIMULATED_LATE_ANSWER_MS, signal, false);
          return;
        default:
          await after(SIMULATED_REGISTRATION_MS, signal);
      }
    },
  };
}

/** The ports for a chosen scenario: the real ones under `live` or outside a development build. */
export function chooseEnablePorts(
  real: EnablePorts,
  scenario: DevelopmentEnableScenarioId,
  isDevelopment: boolean,
): EnablePorts {
  if (!isDevelopment || scenario === 'live') return real;
  return simulatedEnablePorts(scenario);
}
