/**
 * The enable ports the notification education runs (2026-10-04): the real
 * ones (`realEnablePorts`, shared with the Notifications screen) — or, in a
 * development build only, the Design Preview's simulated stand-ins, so the
 * outcomes can be exercised on the Simulator without a prompt reset, a push
 * token or a server registration.
 *
 * The `require` sits inside the `__DEV__` branch, so a release bundle folds
 * the development module away and the ports here are always the real ones
 * (release-exposure.test.ts pins the pattern, as it does for the feed
 * scenarios and the preference mirror).
 */

import { realEnablePorts, type EnablePorts } from './push-registration';

type DevelopmentScenarios = typeof import('./development-notification-scenarios');

const developmentScenarios = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('./development-notification-scenarios') as DevelopmentScenarios)
  : null;

/** The ports for one education visit, resolved once the scenario (if any) is known. */
export function educationEnablePorts(): Promise<EnablePorts> {
  const real = realEnablePorts();
  return developmentScenarios
    ? developmentScenarios.wrapDevelopmentEnablePorts(real)
    : Promise.resolve(real);
}
