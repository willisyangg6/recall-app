/**
 * The selection sheets' one motion controller (2026-10-04): applies
 * `lib/sheet-motion.ts` with core Animated on the native driver, so the
 * three sheets (States, Stores, the allergen chooser) share one timing rule
 * and the opening slide actually plays — it starts when the Modal reports
 * `onShow`, the first frame its view exists, rather than racing the native
 * presentation and finishing before it (the audit's hard cut).
 *
 * `progress` is 0 off the screen and 1 in place; the sheets interpolate
 * their backdrop opacity and translateY from it exactly as before. `shown`
 * is what the Modal's `visible` takes: true while visible or sliding out.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';

import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { motionAllowed } from '@/lib/onboarding-state';
import { SHEET_MOTION } from '@/lib/retailer-grid';
import { openOnShow, sheetMotionAction, sheetShown } from '@/lib/sheet-motion';

/** The opening's ease-out and the closing's ease-in, unchanged from the sheets. */
const OPEN_EASING = Easing.out(Easing.cubic);
const CLOSE_EASING = Easing.in(Easing.cubic);

export function useSheetMotion(visible: boolean): {
  /** The Modal's `visible`: kept while sliding out. */
  shown: boolean;
  /** 0 = off the screen, 1 = in place. */
  progress: Animated.Value;
  /** The Modal's `onShow`: the opening slide starts here. */
  onShow: () => void;
  /** The Modal's `onDismiss`. */
  onDismiss: () => void;
} {
  const reduceMotion = useReduceMotion();
  const motion = motionAllowed(reduceMotion);
  // Closing plays the slide out before the modal goes, where motion is allowed.
  const [closing, setClosing] = useState(false);
  const [wasVisible, setWasVisible] = useState(visible);
  if (wasVisible !== visible) {
    setWasVisible(visible);
    if (!visible && motion) setClosing(true);
  }
  // Whether the Modal's view is on screen: set by onShow, cleared by onDismiss.
  const presented = useRef(false);
  const [progress] = useState(() => new Animated.Value(visible ? 1 : 0));
  const running = useRef<Animated.CompositeAnimation | null>(null);

  const stop = useCallback(() => {
    running.current?.stop();
    running.current = null;
  }, []);

  const open = useCallback(() => {
    stop();
    const run = Animated.timing(progress, {
      toValue: 1,
      duration: SHEET_MOTION.in,
      easing: OPEN_EASING,
      useNativeDriver: true,
    });
    running.current = run;
    run.start(() => {
      if (running.current === run) running.current = null;
    });
  }, [progress, stop]);

  useEffect(() => {
    const action = sheetMotionAction({
      visible,
      closing,
      presented: presented.current,
      motion,
    });
    if (action.kind === 'set') {
      stop();
      progress.setValue(action.to);
      return;
    }
    if (action.kind === 'open') {
      open();
      return;
    }
    if (action.kind === 'close') {
      stop();
      const run = Animated.timing(progress, {
        toValue: 0,
        duration: SHEET_MOTION.out,
        easing: CLOSE_EASING,
        useNativeDriver: true,
      });
      running.current = run;
      run.start(({ finished }) => {
        if (running.current === run) running.current = null;
        if (finished) setClosing(false);
      });
      return;
    }
    // 'wait': the Modal is presenting; onShow starts the opening.
    return stop;
  }, [visible, closing, motion, progress, open, stop]);

  // A `visible` that flips back during a slide-out cancels the close.
  if (closing && visible) setClosing(false);

  // What onShow should read when it fires (after this render's effects).
  const latest = useRef({ visible, motion });
  useEffect(() => {
    latest.current = { visible, motion };
  }, [visible, motion]);
  const onShow = useCallback(() => {
    presented.current = true;
    if (openOnShow(latest.current)) open();
  }, [open]);
  const onDismiss = useCallback(() => {
    presented.current = false;
  }, []);

  return { shown: sheetShown({ visible, closing }), progress, onShow, onDismiss };
}
