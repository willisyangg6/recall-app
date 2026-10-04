/**
 * DEVELOPMENT stand-ins for the notification education's enable ports
 * (2026-10-04): what `Turn on notifications` meets on the Simulator, so
 * every outcome — granted and registered, denied now, denied before,
 * registration failed, slow, late — can be exercised on purpose with NO
 * system prompt reset, NO Expo push token and NO server registration. The
 * scenarios themselves, and the simulated ports, are the pure
 * notification-enable-scenarios.ts; this module keeps the chosen one.
 *
 * ## Containment
 *
 * Reached only through the `__DEV__` `require` in
 * notification-education-ports.ts and the Design Preview's QA controls,
 * both folded out of a release bundle; `wrapDevelopmentEnablePorts`
 * re-checks the development gate and hands back the real ports when it is
 * not one. The chosen scenario persists under its own development-only
 * key until it is changed; `live` is the real ports, as shipped. Set Live
 * when QA is done.
 */

import * as SecureStore from 'expo-secure-store';

import { isDevelopmentBuild } from './design-preview';
import {
  chooseEnablePorts,
  DEVELOPMENT_ENABLE_SCENARIOS,
  type DevelopmentEnableScenarioId,
} from './notification-enable-scenarios';
import type { EnablePorts } from './push-registration';

export { DEVELOPMENT_ENABLE_SCENARIOS, type DevelopmentEnableScenarioId };

const KEY = 'recall.dev-enable-scenario';

let scenario: DevelopmentEnableScenarioId = 'live';
const restored: Promise<void> = SecureStore.getItemAsync(KEY)
  .then((stored) => {
    if (DEVELOPMENT_ENABLE_SCENARIOS.some((option) => option.id === stored)) {
      scenario = stored as DevelopmentEnableScenarioId;
    }
  })
  .catch(() => {});

export function developmentEnableScenario(): DevelopmentEnableScenarioId {
  return scenario;
}

export function setDevelopmentEnableScenario(next: DevelopmentEnableScenarioId): void {
  scenario = next;
  void SecureStore.setItemAsync(KEY, next).catch(() => {});
}

/**
 * The ports the education route runs in a development build: the real ones
 * under `live` (or outside a development build), the simulated ones
 * otherwise. The scenario is read when the ports are made — once per visit.
 */
export async function wrapDevelopmentEnablePorts(real: EnablePorts): Promise<EnablePorts> {
  if (!isDevelopmentBuild()) return real;
  await restored;
  return chooseEnablePorts(real, scenario, true);
}
