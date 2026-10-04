/**
 * Notification education's choices and their outcomes (2026-10-04), as a
 * leaf with no React, no Expo and no I/O of its own, so every permission and
 * registration outcome — including the slow, the late and the double-tapped
 * — is provable under Node with the real effects replaced.
 *
 * ## The three phases the screen can show
 *
 *   intro    the approved screen: `Turn on notifications` / `Not now`
 *   blocked  the system will not ask again (a denial before today):
 *            "Notifications are turned off for Lotly. Enable them in your
 *            device settings." — `Open settings` / `Continue without alerts`
 *   failed   permission granted, registration did not complete:
 *            "We couldn't finish turning on alerts." — `Try again` /
 *            `Continue without alerts`
 *
 * ## The outcomes of one deliberate enable
 *
 * `enable` (a real tap only) resolves the permission through the ONE enable
 * path (the `EnablePorts` of push-registration.ts, shared with the
 * Notifications screen, which prompt only while the system still can),
 * then:
 *
 * - granted and registered            → complete (the gate opens the Feed)
 * - denied at the prompt shown now    → complete, with no enabled claim
 * - denied before, cannot ask again   → `blocked`; nothing completes
 * - granted, registration failed      → `failed`; nothing completes
 * - granted, registration too slow    → the attempt is ABORTED at the
 *                                        deadline and the screen is `failed`
 *
 * Nothing here ever says alerts are on: completing is the only "success",
 * and it happens only when the registration itself succeeded (or the
 * shopper chose to go on without alerts).
 *
 * ## Settings, and coming back
 *
 * `openSettings` (from `blocked`) opens the system settings and remembers
 * that it did. `resume` — the route calls it whenever the app becomes
 * active — re-runs the enable ONLY if settings were opened from this
 * flow: the permission is re-read, a now-granted permission registers,
 * a still-denied one leaves the screen on `blocked`. Opening settings
 * alone never completes the education, and a foreground for any other
 * reason reads nothing.
 *
 * ## One attempt, no late effects
 *
 * - A second press while an attempt is in flight is ignored: one prompt,
 *   one registration.
 * - Registration is bounded by `registrationTimeoutMs`; the deadline aborts
 *   the attempt's signal (the server write is cancelled; a platform read
 *   that cannot be cancelled finishes and is discarded by the port).
 * - `skip` (`Not now` / `Continue without alerts`) aborts any attempt still
 *   in flight, completes once, and advances a generation counter: whatever
 *   a stale attempt reports afterwards changes no view and completes
 *   nothing a second time.
 * - Completion happens at most once per screen, whichever path reaches it.
 */

import type { EnablePorts } from './push-registration';

export type EducationPhase = 'intro' | 'blocked' | 'failed';

export interface EducationView {
  phase: EducationPhase;
  /** An enable attempt is in flight: both actions are inert. */
  busy: boolean;
}

export const INITIAL_EDUCATION_VIEW: EducationView = { phase: 'intro', busy: false };

/**
 * How long a registration may run after the permission is granted before
 * the screen stops waiting (the prompt itself is never timed: a shopper may
 * read it as long as they like). The server write's own bound is 15 s
 * (`RPC_TIMEOUT_MS`); this is shorter because the shopper is watching.
 */
export const REGISTRATION_TIMEOUT_MS = 10_000;

/**
 * The effects: the two enable ports the app ships (`realEnablePorts`, or
 * their development stand-ins), the completion, the settings link and the
 * view sink.
 */
export interface EducationEffects extends EnablePorts {
  /** Marks the education done, so the gate opens the app. */
  complete: () => Promise<void>;
  /** Opens the system settings for this app. */
  openSettings: () => void;
  /** The screen's current phase and busy state. */
  onView: (view: EducationView) => void;
  /** Development-only report of a failed or aborted registration. */
  onError?: (error: unknown) => void;
  registrationTimeoutMs?: number;
}

export interface EducationActions {
  /** `Turn on notifications` and `Try again`, and the re-check after Settings. */
  enable: () => Promise<void>;
  /** `Not now` and `Continue without alerts`. */
  skip: () => Promise<void>;
  /** `Open settings`, from the blocked phase. */
  openSettings: () => void;
  /** The app became active again. */
  resume: () => void;
  /** The current view, for a caller that mounts after a change. */
  view: () => EducationView;
}

export function educationActions(effects: EducationEffects): EducationActions {
  const timeoutMs = effects.registrationTimeoutMs ?? REGISTRATION_TIMEOUT_MS;
  let view: EducationView = INITIAL_EDUCATION_VIEW;
  let done = false;
  let generation = 0;
  let inFlight: AbortController | null = null;
  let awaitingSettings = false;

  const show = (next: EducationView) => {
    view = next;
    effects.onView(next);
  };

  const finish = async () => {
    if (done) return;
    done = true;
    generation += 1;
    inFlight?.abort();
    inFlight = null;
    await effects.complete();
  };

  const enable = async (): Promise<void> => {
    if (done || inFlight !== null) return;
    generation += 1;
    const mine = generation;
    const stale = () => mine !== generation;
    const controller = new AbortController();
    inFlight = controller;
    awaitingSettings = false;
    show({ phase: view.phase, busy: true });

    // 1. The system permission — the prompt, if the system can still ask.
    //    Not timed: a shopper may read the prompt as long as they like.
    let permission: Awaited<ReturnType<EnablePorts['resolvePermission']>>;
    try {
      permission = await effects.resolvePermission();
    } catch (error) {
      // A permission read that throws is a platform fault, shown as a
      // registration failure: nothing claims alerts are on, and the shopper
      // can try again or go on without.
      effects.onError?.(error);
      if (stale()) return;
      inFlight = null;
      show({ phase: 'failed', busy: false });
      return;
    }
    if (stale()) return;
    if (!permission.granted) {
      inFlight = null;
      if (permission.prompted || permission.canAskAgain) {
        // Refused at the prompt just shown: the shopper's choice, honoured
        // without a word — and without any claim that alerts are on.
        await finish();
        return;
      }
      show({ phase: 'blocked', busy: false });
      return;
    }

    // 2. The server registration, bounded. The deadline aborts the signal:
    //    the server write is cancelled; a platform read that cannot be
    //    cancelled finishes and is discarded by the port.
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let failure: unknown = null;
    try {
      // Raced against the signal itself, so a port that cannot stop (or
      // ignores the abort) never holds the screen past the deadline: its
      // eventual answer arrives to a stale generation and is dropped.
      await Promise.race([effects.register(controller.signal), abortedBy(controller.signal)]);
    } catch (error) {
      failure = error ?? new Error('registration failed');
    } finally {
      clearTimeout(timer);
    }
    if (stale()) return; // skipped while this ran: nothing more happens here
    inFlight = null;
    if (failure === null) {
      await finish();
      return;
    }
    effects.onError?.(failure);
    show({ phase: 'failed', busy: false });
  };

  return {
    enable,
    async skip() {
      if (done) return;
      await finish();
    },
    openSettings() {
      if (done || inFlight !== null) return;
      awaitingSettings = true;
      effects.openSettings();
    },
    resume() {
      if (!awaitingSettings || done || inFlight !== null) return;
      awaitingSettings = false;
      void enable();
    },
    view: () => view,
  };
}

/** Rejects the moment `signal` fires; never resolves. */
function abortedBy(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () => reject(new Error('Registration stopped: the deadline passed.'));
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
}
