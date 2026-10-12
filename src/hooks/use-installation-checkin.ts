/**
 * Runs the daily check-in (lib/installation-checkin.ts) when the app is
 * opened and whenever it returns to the FOREGROUND. Only the `active`
 * AppState counts: the app has no background modes, and a notification
 * being delivered runs nothing here — a user opening the app from it does.
 */

import { useEffect } from 'react';
import { AppState } from 'react-native';

import { runInstallationCheckin } from '@/lib/installation-checkin-runner';

export function useInstallationCheckin(): void {
  useEffect(() => {
    if (AppState.currentState === 'active') void runInstallationCheckin();
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') void runInstallationCheckin();
    });
    return () => subscription.remove();
  }, []);
}
