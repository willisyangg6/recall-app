/**
 * The Reduce Motion setting, for the onboarding's small motions (P2B7Y):
 * `true` or `false` once read, `null` until then.
 *
 * The answer is kept for the whole process and read once when this module
 * loads, so a screen shown after the first one already knows it on its first
 * render and never has to draw a frame it would then correct. Changes are
 * followed while a screen is mounted. A setting that cannot be read counts
 * as on. Callers treat anything but a known `false` as "no motion"
 * (`motionAllowed`, lib/state-map.ts).
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

let known: boolean | null = null;
let reading: Promise<boolean> | null = null;

function read(): Promise<boolean> {
  reading ??= AccessibilityInfo.isReduceMotionEnabled()
    .catch(() => true)
    .then((value) => {
      known = value;
      return value;
    });
  return reading;
}

void read();

export function useReduceMotion(): boolean | null {
  const [value, setValue] = useState<boolean | null>(known);
  useEffect(() => {
    let live = true;
    void read().then((next) => {
      if (live) setValue(next);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (next) => {
      known = next;
      if (live) setValue(next);
    });
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);
  return value;
}
