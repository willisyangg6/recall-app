/**
 * The selection sheets' opening and closing motion, as a decision
 * (2026-10-04): what the sheet's progress value should do given what the
 * step asked for, what the native modal has presented, and whether motion
 * is allowed. Pure, so the timing rule that fixes the hard-cut opening is
 * proven in Node; `hooks/use-sheet-motion.ts` applies it with Animated.
 *
 * ## Why the opening never played
 *
 * The three selection sheets (States, Stores, the allergen chooser) are
 * React Native `Modal`s with `animationType="none"` drawing their own
 * 280ms slide and fade. The slide was started the moment `visible` flipped,
 * but the Modal's window is presented by UIKit a few frames later: the
 * native-driver animation ran against a view that did not exist yet, and
 * when the sheet's view finally attached it took the animation's END value.
 * On the device the sheet simply appeared in place (the audit's recording
 * 01 at 69.77→69.79 s) while the close, whose view is already mounted,
 * slid as designed.
 *
 * ## The rule
 *
 * - Opening starts when the Modal reports `onShow` — the first moment its
 *   view exists — unless the Modal is still presented from an interrupted
 *   close, in which case it starts at once from wherever the slide-out got
 *   to (the value is continuous; the timing runs from the current value).
 * - Closing starts at once (the view is on screen) and the Modal stays
 *   presented until the slide-out finishes; a `visible` that flips back
 *   during it cancels the close and opens from the current value.
 * - Under Reduce Motion (or before the setting is known) every change is
 *   immediate: the sheet is simply there, and simply gone.
 * - A stale `onShow` (the step closed the sheet again before the Modal
 *   finished presenting) starts nothing; the close rule has already run.
 */

export interface SheetMotionInput {
  /** What the step asked for. */
  visible: boolean;
  /** A slide-out is running: the Modal is kept presented for it. */
  closing: boolean;
  /** The Modal's view has been presented (`onShow`) and not yet dismissed. */
  presented: boolean;
  /** `motionAllowed(reduceMotion)`. */
  motion: boolean;
}

export type SheetMotionAction =
  /** Set progress to 1 (or 0) with no animation. */
  | { kind: 'set'; to: 0 | 1 }
  /** Animate progress to 1 over the opening duration. */
  | { kind: 'open' }
  /** Animate progress to 0 over the closing duration, then release the Modal. */
  | { kind: 'close' }
  /** The Modal is not presented yet: wait for `onShow` before opening. */
  | { kind: 'wait' };

export function sheetMotionAction(input: SheetMotionInput): SheetMotionAction {
  const { visible, closing, presented, motion } = input;
  if (!visible) {
    // Hidden, or a close in progress where motion is allowed.
    if (closing && motion) return { kind: 'close' };
    return { kind: 'set', to: 0 };
  }
  if (!motion) return { kind: 'set', to: 1 };
  // Opening: only once the view exists; an interrupted close means it does.
  return presented ? { kind: 'open' } : { kind: 'wait' };
}

/**
 * Whether `onShow` should start the opening slide now: the step still
 * wants the sheet, motion is allowed, and the slide was waiting on it.
 */
export function openOnShow(input: Pick<SheetMotionInput, 'visible' | 'motion'>): boolean {
  return input.visible && input.motion;
}

/** The sheet keeps its Modal presented while visible or sliding out. */
export function sheetShown(input: Pick<SheetMotionInput, 'visible' | 'closing'>): boolean {
  return input.visible || input.closing;
}
