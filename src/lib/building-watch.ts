/**
 * The "building your watch" interstitial's rules (2026-09-28): what the
 * one-time screen between Stores and Ready says, and when it moves on. A
 * leaf — no React, no I/O — so the whole sequence is provable under Node.
 *
 * ## Truthfulness
 *
 * The captions name real deterministic work: while they play, the route has
 * mounted the recall feed hook, so the feed sync that the Ready preview
 * reads is genuinely running (or already served from cache), and the saved
 * preferences the captions describe are the ones the Ready step will
 * summarize. The allergen and store captions change when nothing was
 * selected (`Keeping allergen matching broad`, `Scanning recalls across all
 * stores`), no caption lists selection names, and none claims a match was
 * found — matches are reported only by the Ready step, once the query has
 * answered.
 *
 * ## Timing
 *
 * Four working captions at `CAPTION_MS` each, then the completion line for
 * `DONE_MS`: 4 × 700 + 400 = 3200ms. The screen never waits on the feed —
 * if the sync has not settled when the sequence ends, Ready renders its own
 * honest checking/fallback state, so a data failure can never trap the
 * shopper here.
 *
 * ## Reduce Motion
 *
 * No sequential build-up: the finished checklist is drawn at once, and the
 * screen advances after `REDUCED_MOTION_MS` — a short readable minimum,
 * not an animation.
 */

import type { UserRecallPreferences } from '@/domain/preferences';
import {
  BUILDING_DONE_CAPTION,
  BUILDING_FEED_CAPTION,
  buildingAllergensCaption,
  buildingStatesCaption,
  buildingStoresCaption,
} from '@/lib/onboarding-copy';

/** Each working caption's dwell. */
export const CAPTION_MS = 700;
/** The completion line's dwell before the screen advances. */
export const DONE_MS = 400;
/** The static checklist's readable minimum under Reduce Motion. */
export const REDUCED_MOTION_MS = 1600;

/**
 * The four working captions, adapted truthfully to what was chosen, in the
 * order the screen steps through them.
 */
export function buildingCaptions(prefs: UserRecallPreferences): readonly string[] {
  return [
    buildingStatesCaption(),
    buildingAllergensCaption(prefs.allergens.length > 0),
    buildingStoresCaption(prefs.retailers.length > 0),
    BUILDING_FEED_CAPTION,
  ];
}

/** The whole sequence: the working captions, then the completion line. */
export function buildingSequence(prefs: UserRecallPreferences): readonly string[] {
  return [...buildingCaptions(prefs), BUILDING_DONE_CAPTION];
}

/** The animated sequence's total dwell: about 3.2 seconds. */
export function buildingDurationMs(prefs: UserRecallPreferences): number {
  return buildingCaptions(prefs).length * CAPTION_MS + DONE_MS;
}
