/**
 * The app theme entry point.
 *
 * Two layers live here, deliberately side by side while screens migrate:
 *
 *   DESIGN TOKENS (P2B0) — the approved Lotly system, defined in
 *   `design-tokens.ts` and re-exported below. Semantic colour, spacing,
 *   radius, typography, elevation, icon size and hit target, pinned to
 *   DESIGN.md. New and migrated components consume these and nothing else.
 *
 *   LEGACY PROVISIONAL THEME — `Colors`, `Spacing`, `Radii`, `Fonts` and
 *   `MaxContentWidth` below: the placeholder values the screens were built on
 *   before the system existed. They stay so that un-migrated screens keep
 *   rendering exactly as they do today, and they are not extended further.
 *   Each screen's design-system milestone moves it onto the tokens and
 *   drops its use of these; when the last use goes, so does this layer.
 *
 * The provisional risk palette that used to live here is gone: the seven
 * consumer risk labels are `riskPalette` in `design-tokens.ts`, and
 * `components/ui/risk-label.tsx` is the one component that renders them.
 */

import '@/global.css';

import { Platform } from 'react-native';

export * from '@/constants/design-tokens';

/** Legacy provisional palette — see the file header. Not the design system. */
export const Colors = {
  light: {
    text: '#000000',
    textSecondary: '#60646C',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    link: '#0a7ea4',
  },
  dark: {
    text: '#ffffff',
    textSecondary: '#B0B4BA',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    link: '#4cc2e9',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/** Legacy system font stacks — superseded by `fontFamily` / `textStyle` in the tokens. */
export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  web: {
    sans: 'var(--font-sans)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
});

/** Legacy provisional spacing — the approved scale is `spacing` in the tokens. */
export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/** Legacy provisional radii — the approved scale is `radius` in the tokens. */
export const Radii = {
  small: 8,
  medium: 16,
  large: 24,
} as const;

export const MaxContentWidth = 800;
