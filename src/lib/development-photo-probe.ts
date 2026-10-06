/**
 * Development-only stand-ins for the Ready deck's photos (2026-10-05), so QA
 * can force each photo outcome and a mid-settle change on a simulator with a
 * healthy network.
 *
 * Reached only through `__DEV__` `require`s (hooks/use-ready-preview.ts, the
 * Ready route and the Design Preview gallery), so a release bundle folds this
 * module away and the probe is always the platform's. In memory only: every
 * choice resets at launch.
 */

import { resetImageFailures } from './image-failures';
import { resetPhotoMemory, type PhotoPrefetch } from './photo-probe';
import type { ReadyPreviewState } from './ready-preview';

export type DevelopmentPhotoProbe = 'live' | 'fail' | 'hang' | 'render-fail';

export const DEVELOPMENT_PHOTO_PROBES: readonly {
  id: DevelopmentPhotoProbe;
  title: string;
  expectation: string;
}[] = [
  { id: 'live', title: 'Photos: live', expectation: 'The platform prefetch, as shipped.' },
  {
    id: 'fail',
    title: 'Photos: every photo fails',
    expectation:
      'Every probe answers failed at once: each recall moves to its no-photo group and the deck fills with text-led cards. The count is unchanged.',
  },
  {
    id: 'hang',
    title: 'Photos: every photo hangs',
    expectation:
      'No probe ever answers: each times out at the probe deadline, the deck is shown at the photo deadline with text-led cards, and no photo is asked for again this session.',
  },
  {
    id: 'render-fail',
    title: 'Photos: first photo passes prefetch, fails to render',
    expectation:
      'Every probe is the real prefetch, so the first candidate photo passes; its card is then drawn from an address that cannot load. The tile disappears at once, the recall moves to its no-photo group when the deck is next at rest, the count is unchanged and the photo is never asked for again.',
  },
];

/**
 * Local photo fixtures (2026-10-05): with `EXPO_PUBLIC_QA_PHOTOS=local` when
 * the development server starts, every deck photo — probed and drawn — comes
 * from a QA fixture server on this machine (127.0.0.1:8099, a disk copy of
 * each real recall photo), so failure testing never depends on, or adds load
 * to, the agencies' image hosts. `local-render-fail` also starts in
 * `render-fail`, with the broken address on that server (an instant 404).
 * Both work without a tap, so a locked QA machine can still run them.
 */
const QA_PHOTOS = process.env.EXPO_PUBLIC_QA_PHOTOS;
const LOCAL = QA_PHOTOS === 'local' || QA_PHOTOS === 'local-render-fail';
const FIXTURES = 'http://127.0.0.1:8099';
const SERVED_PREFIX = `${FIXTURES}/photo?u=`;

/** Where a photo is fetched from in development: the fixture copy, or the real address. */
function served(url: string): string {
  return LOCAL ? SERVED_PREFIX + encodeURIComponent(url) : url;
}

let mode: DevelopmentPhotoProbe = QA_PHOTOS === 'local-render-fail' ? 'render-fail' : 'live';
const resetListeners = new Set<() => void>();

export function developmentPhotoProbe(): DevelopmentPhotoProbe {
  return mode;
}

/** The photo registry registers here, so a new stand-in starts from no sessions. */
export function onDevelopmentPhotoReset(listener: () => void): void {
  resetListeners.add(listener);
}

/**
 * Choosing a stand-in also forgets this session's photo verdicts — loaded
 * and failed alike — and every running photo session, so the next Building
 * and Ready probe afresh under the new answer instead of reading what the
 * live probe already learned.
 */
export function setDevelopmentPhotoProbe(next: DevelopmentPhotoProbe): void {
  mode = next;
  resetPhotoMemory();
  resetImageFailures();
  for (const listener of resetListeners) listener();
}

/** The prefetch the hook uses in development: the real one unless a stand-in is chosen. */
export function wrapDevelopmentPrefetch(real: PhotoPrefetch): PhotoPrefetch {
  return (url) => {
    if (mode === 'fail') return Promise.resolve(false);
    if (mode === 'hang') return new Promise<boolean>(() => {});
    return real(served(url));
  };
}

/**
 * An address that cannot load and still names the real photo: the fixture
 * server's 404, or a reserved, never-resolving domain (RFC 2606).
 */
const BROKEN_PREFIX = LOCAL ? `${FIXTURES}/missing?u=` : 'https://render-failure.invalid/?photo=';

/** The real photo a development address stands for (any other URL unchanged). */
export function originalPhotoUrl(url: string): string {
  for (const prefix of [BROKEN_PREFIX, SERVED_PREFIX]) {
    if (url.startsWith(prefix)) return decodeURIComponent(url.slice(prefix.length));
  }
  return url;
}

/**
 * The preview as development draws it: every photo from the local fixtures
 * when they are on, and under `render-fail` the card showing the first
 * candidate photo from a broken address — the probe passed on the real one,
 * the render fails. With neither, the preview is returned untouched (the
 * same object, so nothing re-renders for it).
 */
export function developmentPreview(
  preview: ReadyPreviewState,
  firstCandidate: string | undefined,
): ReadyPreviewState {
  const breaking = mode === 'render-fail' && firstCandidate !== undefined;
  if ((!breaking && !LOCAL) || preview.kind !== 'matches') return preview;
  const swap = <T extends { heroImageUrl: string | null }>(model: T): T => {
    const url = model.heroImageUrl;
    if (url === null) return model;
    if (breaking && url === firstCandidate) {
      return { ...model, heroImageUrl: BROKEN_PREFIX + encodeURIComponent(url) };
    }
    return LOCAL ? { ...model, heroImageUrl: served(url) } : model;
  };
  return {
    ...preview,
    models: preview.models.map(swap),
    locked: preview.locked && swap(preview.locked),
  };
}

/**
 * A one-shot development control: the next time the deck starts settling, the
 * front-most readable photo is reported failed — a real reclassification, so
 * the card set changes while the deck is moving and must wait for rest.
 */
let changeOnSettle = false;

export function armDeckChangeOnSettle(armed: boolean): void {
  changeOnSettle = armed;
}

export function deckChangeOnSettleArmed(): boolean {
  return changeOnSettle;
}

/** Called by the Ready route as a settle begins; fires once when armed. */
export function developmentDeckSettling(
  preview: ReadyPreviewState,
  reportFailure: (url: string) => void,
): void {
  if (!changeOnSettle || preview.kind !== 'matches') return;
  const url = preview.models.find((model) => model.heroImageUrl !== null)?.heroImageUrl;
  if (!url) return;
  changeOnSettle = false;
  console.info('[Ready photos] development: changing the card set during a settle');
  reportFailure(url);
}
