/**
 * The hidden team control on Profile's version line (docs/recall-analytics.md):
 * a long press marks this iPhone as the team's own, so its analytics stay out
 * of customer numbers, and shows the anonymous analytics id for the
 * dashboard's exclusion filter. Not destructive, not a navigation row, and
 * not announced; nothing else about the app changes.
 */

import { Alert } from 'react-native';

import {
  currentAnalyticsId,
  isInternalAnalyticsDevice,
  setInternalAnalyticsDevice,
} from '@/lib/analytics/analytics';

export function confirmTeamDevice(): void {
  const id = currentAnalyticsId();
  if (id === null) {
    Alert.alert('Analytics is off', 'This build sends no analytics.');
    return;
  }
  const internal = isInternalAnalyticsDevice();
  Alert.alert(
    internal ? 'Team device' : 'Mark as a team device?',
    `${internal ? 'This iPhone is excluded from customer analytics.' : 'Usage from this iPhone will be excluded from customer analytics.'}\n\nAnalytics ID:\n${id}`,
    [
      { text: 'Cancel', style: 'cancel' },
      internal
        ? { text: 'Unmark', onPress: () => setInternalAnalyticsDevice(false) }
        : { text: 'Mark', onPress: () => setInternalAnalyticsDevice(true) },
    ],
  );
}
