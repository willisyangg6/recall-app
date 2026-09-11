/**
 * `/settings` — kept alive purely for compatibility (P2A).
 *
 * Until this milestone, `/settings` was ONE screen titled "Alerts" holding
 * both the notification controls and personalization. Profile now offers
 * those as two destinations, so the combined screen no longer exists. The
 * route does: any existing deep link (`recallapp://settings`) resolves here
 * and is redirected to Notifications — the top of what the old screen showed,
 * and where its title pointed.
 *
 * `Redirect` REPLACES rather than pushes, so no dead entry joins the history
 * and Back from Notifications goes where the user actually came from instead
 * of bouncing through a screen that renders nothing.
 */

import { Redirect } from 'expo-router';

export default function SettingsIndexRedirect() {
  return <Redirect href="/settings/notifications" />;
}
