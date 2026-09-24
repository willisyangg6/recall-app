/**
 * The access gate (P2B7X.1): ONE pure decision that says which part of the
 * app a launch may show, and the route matrix the root layout enforces it
 * with.
 *
 * ## Four phases
 *
 *   onboarding   personalization is not complete (Welcome → Preview), or the
 *                shopper stepped back from the paywall to review the Preview
 *   paywall      personalization is complete and the device is not entitled
 *   education    entitled, and the one-time notification education has not
 *                been shown
 *   app          entitled and educated: Feed, Saved, Profile and everything
 *                pushed over them
 *
 * ## How the root layout enforces it
 *
 * Every route in `src/app/_layout.tsx` sits inside a `Stack.Protected` group
 * whose guard is `phase === <its group>`. A protected screen is not merely
 * hidden: Expo Router removes it from the navigator, so a tab, a deep link,
 * a notification tap, a swipe-back gesture or a relaunch cannot reach it —
 * React Navigation drops unknown routes on rehydration and refuses to
 * navigate to a name it does not have. When a phase changes underneath the
 * current screen, the navigator itself moves to the FIRST declared screen of
 * the new phase; `entryRoute` below is that screen, and the layout's
 * declaration order is pinned to it by test. No imperative navigation ever
 * crosses a phase.
 *
 * The one deliberate exception is the development-only Design Preview hub,
 * which a development build may open in any phase so the founder can inspect
 * onboarding and paywall states; in a release build it is confined to the
 * app phase like every other pushed screen (and is inert there anyway).
 *
 * A leaf: no I/O, no React. The provider that computes the inputs lives in
 * hooks/use-access.tsx.
 */

import { onboardingRoute } from './onboarding-routes';
import { resumeStep, type OnboardingRecord, type OnboardingStep } from './onboarding-state';

export type AccessPhase = 'onboarding' | 'paywall' | 'education' | 'app';

export const ACCESS_PHASES: readonly AccessPhase[] = ['onboarding', 'paywall', 'education', 'app'];

export interface AccessInputs {
  onboarding: OnboardingRecord;
  entitled: boolean;
  /**
   * The shopper pressed Back on the paywall. In-memory only: it re-enters the
   * onboarding phase on the Preview, and a relaunch forgets it, so a device
   * that completed personalization always relaunches on the paywall.
   */
  reviewingPreview: boolean;
}

export function resolveAccessPhase({
  onboarding,
  entitled,
  reviewingPreview,
}: AccessInputs): AccessPhase {
  if (!onboarding.personalizationCompleted) return 'onboarding';
  if (!entitled) return reviewingPreview ? 'onboarding' : 'paywall';
  if (!onboarding.notificationEducationCompleted) return 'education';
  return 'app';
}

/** The onboarding screen the onboarding phase opens on. */
export function onboardingEntryStep(inputs: AccessInputs): OnboardingStep {
  if (inputs.onboarding.personalizationCompleted) return 'preview';
  return resumeStep(inputs.onboarding);
}

// ── The route matrix ────────────────────────────────────────────────────────

/**
 * Which phase each route group belongs to. A route is reachable in exactly
 * one phase; the development hub is the documented exception (see above).
 */
export type RouteGroup = 'onboarding' | 'paywall' | 'education' | 'app' | 'development';

export const ROUTE_GROUPS: Record<RouteGroup, readonly string[]> = {
  paywall: ['paywall'],
  education: ['onboarding/notifications'],
  app: [
    '(tabs)',
    'recall/[id]',
    'settings/index',
    'settings/personalization',
    'settings/notifications',
    'document/[slug]',
    'report/[id]',
  ],
  onboarding: [
    'onboarding/welcome',
    'onboarding/states',
    'onboarding/allergens',
    'onboarding/retailers',
    'onboarding/preview',
  ],
  development: ['design-preview/index'],
};

/**
 * Whether a route group is mounted in a phase. Pure so the matrix can be
 * asserted exhaustively; the layout's guards are written from this function.
 */
export function routeGroupAllowed(
  group: RouteGroup,
  phase: AccessPhase,
  developmentBuild: boolean,
): boolean {
  if (group === 'development') return developmentBuild || phase === 'app';
  return group === phase;
}

/**
 * The screen the navigator lands on when a phase begins — the first declared
 * screen of that phase's group. For onboarding that is the resume step, which
 * the layout achieves by declaring the resume step's screen FIRST.
 */
export function entryRoute(phase: AccessPhase, entryStep: OnboardingStep): string {
  switch (phase) {
    case 'paywall':
      return 'paywall';
    case 'education':
      return 'onboarding/notifications';
    case 'app':
      return '(tabs)';
    case 'onboarding':
      return onboardingRoute(entryStep).slice(1);
  }
}

/**
 * The onboarding screens in the order the layout must DECLARE them: the entry
 * step first, then the rest in flow order. Only the first matters to the
 * navigator (it is where an onboarding phase lands); the rest keep their
 * flow order so the declaration stays readable.
 */
export function onboardingDeclarationOrder(entryStep: OnboardingStep): readonly string[] {
  const entry = onboardingRoute(entryStep).slice(1);
  return [entry, ...ROUTE_GROUPS.onboarding.filter((route) => route !== entry)];
}

/** Push-notification taps may navigate only once the app phase is reached. */
export function pushNavigationAllowed(phase: AccessPhase): boolean {
  return phase === 'app';
}
