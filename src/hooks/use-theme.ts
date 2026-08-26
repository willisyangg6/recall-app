/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors, RiskColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function useTheme() {
  const scheme = useColorScheme();
  const theme = scheme === 'unspecified' ? 'light' : scheme;

  return Colors[theme];
}

/** The risk-tier palette for the active scheme (see RiskColors). */
export function useRiskColors() {
  const scheme = useColorScheme();

  return RiskColors[scheme === 'unspecified' ? 'light' : scheme];
}
