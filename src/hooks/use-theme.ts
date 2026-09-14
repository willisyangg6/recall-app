/**
 * The LEGACY provisional theme for the active colour scheme — the palette the
 * un-migrated screens still render with (see constants/theme.ts).
 *
 * The design tokens are not scheme-dependent: the approved system is light
 * only, so token consumers import `@/constants/design-tokens` directly and
 * need no hook. The former risk-colour hook went with the provisional palette;
 * risk labels read the seven-label palette through `components/ui/risk-label`.
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function useTheme() {
  const scheme = useColorScheme();
  const theme = scheme === 'unspecified' ? 'light' : scheme;

  return Colors[theme];
}
