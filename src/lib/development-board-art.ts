/**
 * Development-only failure fixtures for the Ready board's artwork
 * (2026-10-05), so the board's recovery from a failed image request can be
 * forced on a simulator without depending on load, memory or a flaky asset
 * server.
 *
 * Chosen when the development server starts, through
 * `EXPO_PUBLIC_QA_BOARD_ART` (it needs no tap, so it also works on a locked
 * QA machine):
 *
 *   fail-first   every board layer's first request goes to an address that
 *                refuses at once (127.0.0.1, port 9); later requests are real
 *   fail-later   every layer loads normally, then once, 3 s later, is asked
 *                for again from that refusing address — the way a loaded
 *                image view is re-requested and cleared by the platform
 *
 * Reached only through a `__DEV__` `require` in
 * components/onboarding/preview-step.tsx, so a release bundle folds it away.
 */

import type { ImageSourcePropType } from 'react-native';

export type DevelopmentBoardArt = 'live' | 'fail-first' | 'fail-later';

/** Connection refused at once: no DNS, no network, no wait. */
const REFUSED: ImageSourcePropType = { uri: 'http://127.0.0.1:9/lotly-board-art-fixture.png' };

/** How long a `fail-later` layer shows before it is asked for again. */
export const FAIL_LATER_MS = 3000;

export function developmentBoardArt(): DevelopmentBoardArt {
  const chosen = process.env.EXPO_PUBLIC_QA_BOARD_ART;
  return chosen === 'fail-first' || chosen === 'fail-later' ? chosen : 'live';
}

/** The source a board layer asks for on this attempt under the chosen fixture. */
export function developmentBoardSource(
  source: ImageSourcePropType,
  attempt: number,
  refusedNow: boolean,
): ImageSourcePropType {
  if (refusedNow) return REFUSED;
  if (developmentBoardArt() === 'fail-first' && attempt === 0) return REFUSED;
  return source;
}
