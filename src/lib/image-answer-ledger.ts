/**
 * The request/answer ledger of one drawn image view
 * (components/ui/guarded-image.tsx, 2026-10-06). Pure, so every ordering
 * React Native can produce is a unit test.
 *
 * ## What the platform actually does (React Native 0.86, iOS, Fabric)
 *
 *   - Every request a view makes is announced by `onLoadStart`, emitted from
 *     the view's `updateState` when its source (or requested size) changes.
 *   - `updateState` subscribes the view to the request BEFORE emitting that
 *     `onLoadStart`. A request that has already completed answers the new
 *     subscriber at once, and on the main thread that answer is synchronous —
 *     so a view's own answer can reach JavaScript just BEFORE its own start.
 *     Nothing can come between the two: both are emitted in one main-thread
 *     call.
 *   - Image views are recycled, and a reused view accepts any answer that
 *     reaches it. An answer dispatched for its previous image before the
 *     reuse arrives afterwards, with nothing to say whose it is: the `onLoad`
 *     payload's `uri` is filled from the view's CURRENT source, and `onError`
 *     carries no source at all.
 *   - A recycled view in the pool has no state and no event emitter, and
 *     drops any answer that reaches it; on reuse it is given props, event
 *     emitter and state in one main-thread call. So an answer meant for
 *     another image can reach JavaScript only AFTER the drawing's own start:
 *     a drawing's first answer, if it comes before any start, is its own.
 *
 * So no event proves which request it answers. What the platform does
 * guarantee is the count: a drawing gets one start per request it makes, and
 * one answer per start. An answer beyond that is not this drawing's — the
 * stale answer's signature. (A reload whose answer also comes before its
 * start — a new layout size, already cached — is indistinguishable by count
 * and costs one redundant redraw, never a wrong picture.) One drawing shows
 * one source (the component
 * starts a new drawing whenever its source changes), so every start and
 * answer in a ledger is about that one source.
 */

export interface AnswerLedger {
  /** `onLoadStart`s this drawing received. */
  readonly starts: number;
  /** Answers (`onLoad` or `onError`) this drawing accepted as its own. */
  readonly answers: number;
}

export const EMPTY_LEDGER: AnswerLedger = { starts: 0, answers: 0 };

export function recordStart(ledger: AnswerLedger): AnswerLedger {
  return { ...ledger, starts: ledger.starts + 1 };
}

/**
 * Whether an answer arriving now can be this drawing's own: at most one
 * answer per start, and the first answer may precede its start (a request
 * already complete when the view subscribed). Any answer beyond that is an
 * answer meant for another image.
 */
export function isOwnAnswer(ledger: AnswerLedger): boolean {
  return ledger.answers + 1 <= Math.max(ledger.starts, 1);
}

export function recordAnswer(ledger: AnswerLedger): AnswerLedger {
  return { ...ledger, answers: ledger.answers + 1 };
}

/**
 * The identity of an image source as the component sees it: a bundled
 * asset's module number, or the serialized URI object(s). A change means a
 * new drawing.
 */
export function imageSourceKey(source: unknown): string {
  return typeof source === 'number' ? `asset:${source}` : JSON.stringify(source ?? null);
}
