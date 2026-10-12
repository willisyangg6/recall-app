/**
 * Native wiring for the daily foreground check-in (installation-checkin.ts,
 * where the ordering and its proofs live). The last-check-in day is a local
 * convenience key; losing it only means one extra check-in.
 */

import * as SecureStore from 'expo-secure-store';

import { peekInstallationId } from './installation-id';
import { checkIn, utcDay, type CheckinResult } from './installation-checkin';
import { enqueueInstallationMutation } from './installation-lifecycle';
import { remirrorPreferences } from './preferences-store';
import { recordInstallationActivity } from './push-api';
import { refreshRegistrationIfEnabled } from './push-registration';

const LAST_CHECKIN_KEY = 'recall.activity-checkin-day';

type DevelopmentMirrorModule = typeof import('./development-preference-mirror');

/** In development, QA's "keep saves on this device" switch also holds check-ins. */
const developmentMirror = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('./development-preference-mirror') as DevelopmentMirrorModule)
  : null;

export async function runInstallationCheckin(): Promise<CheckinResult | 'held-in-development'> {
  if (__DEV__ && developmentMirror && (await developmentMirror.localOnlySavesSettled())) {
    return 'held-in-development';
  }
  return checkIn({
    today: () => utcDay(new Date()),
    readLastCheckin: () => SecureStore.getItemAsync(LAST_CHECKIN_KEY),
    writeLastCheckin: (day) => SecureStore.setItemAsync(LAST_CHECKIN_KEY, day),
    peekInstallationId,
    enqueue: enqueueInstallationMutation,
    recordActivity: recordInstallationActivity,
    remirrorPreferences,
    refreshRegistration: refreshRegistrationIfEnabled,
  });
}
