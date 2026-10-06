/**
 * `Image`, guarded against an answer meant for another image (2026-10-05).
 *
 * React Native (0.86, iOS, new architecture) recycles image views: when an
 * image unmounts, its native view goes back to a pool and the next image to
 * mount may reuse it. The view's image arrives asynchronously, and a reused
 * view accepts whatever arrives, without checking that it answers the image
 * it now shows — so an answer still in flight for the view's PREVIOUS image
 * can land after the reuse and replace the right picture with the wrong one,
 * with no error and no reload. Seen on Ready in a release build: the board's
 * scene drawn as the peanut pictogram, the row icons as tinted rectangles,
 * the allergen plate as tiny copies of the scene. On a recall card it would
 * mean another recall's product photo.
 *
 * The tell is the count, not any payload (lib/image-answer-ledger.ts): a
 * drawing gets one `onLoadStart` per request and one answer per start, and
 * its first answer may arrive just before its start (a request already
 * complete when the view subscribed answers synchronously). An answer — load
 * or error — beyond that count is not this drawing's. It is never passed on;
 * the image is drawn again as a new view (a new key) instead, at most
 * `STALE_REDRAW_LIMIT` times per source. A source change always starts a new
 * drawing, so a ledger only ever counts one source. A legitimate reload (a
 * new layout size asks again) announces itself and is left alone. Everything
 * else is plain `Image`: same props, same pixels.
 *
 * What is proven and what is inferred: the wrong pictures were seen on
 * device in a release build; that the platform's recycling delivers them is
 * read from React Native's source (`RCTImageComponentView`,
 * `RCTImageResponseObserverProxy`, `ImageResponseObserverCoordinator`), not
 * observed inside it.
 */

import { useRef, useState, type RefObject } from 'react';
import { Image, type ImageProps } from 'react-native';

import {
  EMPTY_LEDGER,
  imageSourceKey,
  isOwnAnswer,
  recordAnswer,
  recordStart,
  type AnswerLedger,
} from '@/lib/image-answer-ledger';

/** How many times one source may be redrawn after answers meant for other images. */
export const STALE_REDRAW_LIMIT = 3;

type Ledger = { drawing: string; value: AnswerLedger };
type Redraws = { source: string; count: number };

/** This drawing's ledger: a new drawing starts an empty one. */
function ledgerOf(ref: RefObject<Ledger>, drawing: string): Ledger {
  if (ref.current.drawing !== drawing) ref.current = { drawing, value: EMPTY_LEDGER };
  return ref.current;
}

/** Spend one redraw for this source; false once the source has none left. */
function spendRedraw(ref: RefObject<Redraws>, source: string): boolean {
  if (ref.current.source !== source) ref.current = { source, count: 0 };
  if (ref.current.count >= STALE_REDRAW_LIMIT) return false;
  ref.current.count += 1;
  return true;
}

export function GuardedImage({ onLoadStart, onLoad, onError, ...props }: ImageProps) {
  const source = imageSourceKey(props.source);
  const [drawing, setDrawing] = useState(0);
  const key = `${drawing}|${source}`;
  const ledger = useRef<Ledger>({ drawing: '', value: EMPTY_LEDGER });
  const redraws = useRef<Redraws>({ source: '', count: 0 });
  // An answer meant for another image: never passed on; drawn again.
  const redraw = () => {
    if (__DEV__) console.info('[GuardedImage] answer meant for another image: redrawing');
    if (spendRedraw(redraws, source)) setDrawing(drawing + 1);
  };
  return (
    <Image
      // A new key is a new view, and with it a new request: a new drawing
      // for every redraw and for every source.
      key={key}
      {...props}
      onLoadStart={() => {
        const own = ledgerOf(ledger, key);
        own.value = recordStart(own.value);
        onLoadStart?.();
      }}
      onLoad={(event) => {
        const own = ledgerOf(ledger, key);
        if (!isOwnAnswer(own.value)) return redraw();
        own.value = recordAnswer(own.value);
        onLoad?.(event);
      }}
      onError={(event) => {
        const own = ledgerOf(ledger, key);
        if (!isOwnAnswer(own.value)) return redraw();
        own.value = recordAnswer(own.value);
        onError?.(event);
      }}
    />
  );
}
