/**
 * The saved choices as the Building step and Ready present them. In a
 * release build this is the identity. In a development build the Design
 * Preview's QA profile may present them with no allergens and no stores
 * (display only, never saved: development-feed-scenarios.ts). The `require`
 * sits inside the `__DEV__` branch, so a release bundle folds the module away.
 */

import type { UserRecallPreferences } from '@/domain/preferences';

type DevelopmentFeedModule = typeof import('@/lib/development-feed-scenarios');

const developmentQa = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('@/lib/development-feed-scenarios') as DevelopmentFeedModule)
  : null;

export function presentedPreferences(prefs: UserRecallPreferences): UserRecallPreferences {
  return __DEV__ && developmentQa ? developmentQa.developmentPreferencesView(prefs) : prefs;
}
