/**
 * The words the root error boundary shows when a render throws (P3C1).
 *
 * This is the app's last consumer surface: whatever failed, the shopper reads
 * one sentence that says what did not happen and what to try. It follows the
 * same rule as the Feed, Detail, Saved and Notifications failures
 * (`consumer-copy.test.ts`): the sentence starts "Lotly couldn’t", and the
 * cause — the error, its message, its stack — is a developer fact that goes
 * to the development console alone and never onto the screen.
 *
 * Pure data, no logic and no imports, so a crash screen's copy can never be
 * the thing that crashes.
 */

/** The heading. Names the situation without blaming the shopper or the device. */
export const CRASH_TITLE = 'Something went wrong';

/**
 * The explanation. One sentence, the house failure form, with the two things
 * worth trying in the order they are worth trying.
 */
export const CRASH_BODY =
  'Lotly couldn’t finish loading this screen. Try again, and reopen the app if it keeps happening.';

/** The retry control's visible label. */
export const CRASH_RETRY_ACTION = 'Try again';

/** What the retry control does, for a screen reader. */
export const CRASH_RETRY_HINT = 'Loads the screen again.';

/**
 * The spoken name of the whole screen. The title alone ("Something went
 * wrong") does not say what went wrong with, so the accessible name of the
 * alert region names the app.
 */
export const CRASH_ACCESSIBILITY_LABEL = 'Something went wrong in Lotly';
