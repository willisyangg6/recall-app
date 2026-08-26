/**
 * Placeholder design tokens. Final branding is intentionally undecided —
 * these values exist so screens share one source of truth and can be
 * restyled in one place later.
 */

import '@/global.css';

import { Platform } from 'react-native';

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

/**
 * Consumer risk-tier tokens — the one place a risk color is defined.
 *
 * Deep red → red-orange → dark orange → dark yellow → light yellow, with a
 * neutral gray for the non-scale states. No green appears in the scale: no
 * recall level means "fine". Every pair is a background plus the foreground
 * that stays legible on it, because the label text is mandatory — color alone
 * must never carry the risk (see src/components/risk-badge.tsx).
 *
 * Provisional, like the rest of these tokens: the brand has no final risk
 * palette yet, and swapping one lives here.
 */
export const RiskColors = {
  light: {
    critical: { background: '#8E1519', text: '#FFFFFF' },
    high: { background: '#B4400C', text: '#FFFFFF' },
    moderate: { background: '#A85E06', text: '#FFFFFF' },
    low: { background: '#8A6A00', text: '#FFFFFF' },
    minimal: { background: '#F5DE8A', text: '#3D3200' },
    pending: { background: '#E0E1E6', text: '#3C3F45' },
  },
  dark: {
    critical: { background: '#B3261E', text: '#FFFFFF' },
    high: { background: '#C2450F', text: '#FFFFFF' },
    moderate: { background: '#B06806', text: '#FFFFFF' },
    low: { background: '#8F7000', text: '#FFFFFF' },
    minimal: { background: '#E8D488', text: '#332A00' },
    pending: { background: '#2E3135', text: '#B0B4BA' },
  },
} as const;

export type RiskColorToken = keyof typeof RiskColors.light;

/** System font stacks per platform — no custom fonts yet. */
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

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radii = {
  small: 8,
  medium: 16,
  large: 24,
} as const;

export const MaxContentWidth = 800;
