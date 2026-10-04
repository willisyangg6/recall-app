/**
 * What the notification education's pinned footer shows in each phase
 * (2026-10-04): the notice above the primary, the primary's words, and the
 * secondary's — Expo-free, so the three phases are provable in Node and the
 * component only draws what it is handed.
 *
 *   intro    no notice · `Turn on notifications` (busy `Opening…`) · `Not now`
 *   blocked  the calm information callout, two sentences · `Open settings`
 *            (busy `Checking…`, during the re-check after Settings) ·
 *            `Continue without alerts`
 *   failed   the bordered alert · `Try again` (busy `Trying again…`) ·
 *            `Continue without alerts`
 *
 * The notices reuse the paywall's own two treatments (`PaywallNotice`:
 * `calm` is the information Callout, `alert` the `border/strong` surface
 * with the alert role), so an outcome on this screen reads exactly as a
 * purchase outcome does on the one before it. Nothing in any phase says
 * alerts are on.
 */

import type { EducationPhase, EducationView } from './notification-education-actions';
import {
  EDUCATION_BLOCKED_NOTICE,
  EDUCATION_BUSY,
  EDUCATION_CHECKING,
  EDUCATION_CONTINUE_WITHOUT,
  EDUCATION_CONTINUE_WITHOUT_HINT,
  EDUCATION_CTA,
  EDUCATION_CTA_HINT,
  EDUCATION_FAILED_NOTICE,
  EDUCATION_OPEN_SETTINGS,
  EDUCATION_OPEN_SETTINGS_HINT,
  EDUCATION_SECONDARY,
  EDUCATION_SECONDARY_HINT,
  EDUCATION_TRY_AGAIN,
  EDUCATION_TRY_AGAIN_HINT,
  EDUCATION_TRYING_AGAIN,
} from './onboarding-copy';

export type EducationPrimaryKind = 'enable' | 'settings' | 'retry';

export interface EducationFooter {
  /** The outcome notice above the actions; none on the approved intro. */
  notice: { text: string; tone: 'calm' | 'alert'; kind: EducationPhase } | null;
  primary: {
    kind: EducationPrimaryKind;
    label: string;
    busyLabel: string;
    hint: string;
  };
  secondary: { label: string; hint: string };
  busy: boolean;
}

const FOOTERS: Record<EducationPhase, Omit<EducationFooter, 'busy'>> = {
  intro: {
    notice: null,
    primary: {
      kind: 'enable',
      label: EDUCATION_CTA,
      busyLabel: EDUCATION_BUSY,
      hint: EDUCATION_CTA_HINT,
    },
    secondary: { label: EDUCATION_SECONDARY, hint: EDUCATION_SECONDARY_HINT },
  },
  blocked: {
    notice: { text: EDUCATION_BLOCKED_NOTICE, tone: 'calm', kind: 'blocked' },
    primary: {
      kind: 'settings',
      label: EDUCATION_OPEN_SETTINGS,
      busyLabel: EDUCATION_CHECKING,
      hint: EDUCATION_OPEN_SETTINGS_HINT,
    },
    secondary: { label: EDUCATION_CONTINUE_WITHOUT, hint: EDUCATION_CONTINUE_WITHOUT_HINT },
  },
  failed: {
    notice: { text: EDUCATION_FAILED_NOTICE, tone: 'alert', kind: 'failed' },
    primary: {
      kind: 'retry',
      label: EDUCATION_TRY_AGAIN,
      busyLabel: EDUCATION_TRYING_AGAIN,
      hint: EDUCATION_TRY_AGAIN_HINT,
    },
    secondary: { label: EDUCATION_CONTINUE_WITHOUT, hint: EDUCATION_CONTINUE_WITHOUT_HINT },
  },
};

export function educationFooter(view: EducationView): EducationFooter {
  return { ...FOOTERS[view.phase], busy: view.busy };
}
