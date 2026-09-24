/**
 * Release destinations (P2B7X.1): the three public URLs the paywall's
 * footer opens — Terms, Privacy, Support — as TYPED configuration with no
 * value invented.
 *
 * None exists yet. The founder's checklist in docs/recall-launch-blockers.md
 * owns all three (a legal entity, a public domain, a support destination),
 * so every entry below is `null` until a real HTTPS destination is supplied,
 * and `launchReadinessFailures` names each absent one. `npm run
 * qa:launch-readiness` exits non-zero while any is missing, so a release
 * cannot be prepared with a dead footer. The paywall renders the four
 * actions regardless: an unconfigured destination shows one honest sentence
 * on press (`DESTINATION_UNCONFIGURED`), never `example.com` and never a link
 * that goes nowhere.
 *
 * A valid destination is `https://` on a real host — the placeholder hosts
 * below are refused so a stand-in cannot pass as configured.
 */

export type ReleaseDestinationKey = 'terms' | 'privacy' | 'support';

export type ReleaseDestinations = Record<ReleaseDestinationKey, string | null>;

/**
 * Founder-supplied, in a commit, when the destinations exist. Until then
 * null. Never an environment variable: the bundle must not depend on a
 * third `EXPO_PUBLIC_` value that could be absent on one EAS environment and
 * present on another (release-exposure.test.ts freezes that set).
 */
export const RELEASE_DESTINATIONS: ReleaseDestinations = {
  terms: null,
  privacy: null,
  support: null,
};

export const DESTINATION_LABELS: Record<ReleaseDestinationKey, string> = {
  terms: 'Terms',
  privacy: 'Privacy',
  support: 'Support',
};

/** Hosts that mean "not a real destination", whatever the rest of the URL says. */
const PLACEHOLDER_HOSTS = /(^|\.)(example\.(com|org|net)|localhost|invalid|test|local)$/i;

export function isValidHttpsDestination(value: string | null): value is string {
  if (value === null) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.hostname === '' || !url.hostname.includes('.')) return false;
  if (PLACEHOLDER_HOSTS.test(url.hostname)) return false;
  return true;
}

export type DestinationAction =
  | { kind: 'open'; url: string }
  /** No valid destination in this build: the paywall says so on press. */
  | { kind: 'unconfigured' };

export function destinationAction(
  key: ReleaseDestinationKey,
  destinations: ReleaseDestinations = RELEASE_DESTINATIONS,
): DestinationAction {
  const value = destinations[key];
  return isValidHttpsDestination(value) ? { kind: 'open', url: value } : { kind: 'unconfigured' };
}

/** One sentence per absent or invalid destination; empty when a release may ship. */
export function launchReadinessFailures(
  destinations: ReleaseDestinations = RELEASE_DESTINATIONS,
): string[] {
  const failures: string[] = [];
  for (const key of ['terms', 'privacy', 'support'] as const) {
    const value = destinations[key];
    if (value === null) {
      failures.push(
        `${DESTINATION_LABELS[key]} destination is not configured (RELEASE_DESTINATIONS.${key} is null).`,
      );
    } else if (!isValidHttpsDestination(value)) {
      failures.push(
        `${DESTINATION_LABELS[key]} destination is not a valid HTTPS URL on a real host: ${value}`,
      );
    }
  }
  return failures;
}
