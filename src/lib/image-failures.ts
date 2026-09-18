/**
 * The session's memory of official image URLs that failed to render (P2B7I).
 *
 * A failed image must never leave a blank rectangle behind, and it must not
 * be re-requested every time a list recycles the card that showed it. The
 * media tile records a failure here the moment the platform reports one, and
 * every later mount of that same URL — a Feed card scrolled back into view,
 * a Saved card, the Detail pager's page for it — reads the verdict and takes
 * the no-image shape immediately, with no second request and no layout that
 * first reserves a footprint and then collapses.
 *
 * The memory is deliberately SESSION-scoped and URL-keyed: one URL, one
 * verdict, until the next cold launch. It records nothing about the recall
 * (the stored imagery is untouched and still traceable to its official
 * source), never persists, and is not a cache of successes — an image that
 * loaded is simply an image that loaded. A network outage therefore hides a
 * photo for the rest of the session rather than retrying it on every scroll,
 * which is the honest trade: a rectangle that flickers between grey and
 * empty as the list recycles is worse than a card that stays text-led until
 * the app is next opened.
 *
 * This is a leaf module with no imports, so the client read path stays light
 * and the rule is testable under Node.
 */

const failedImageUris = new Set<string>();

/** Whether this URL has already failed to render in this session. */
export function hasImageFailed(uri: string): boolean {
  return failedImageUris.has(uri);
}

/** Record a render failure. Idempotent: a second report changes nothing. */
export function recordImageFailure(uri: string): void {
  failedImageUris.add(uri);
}
