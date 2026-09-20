/**
 * The Information Callout (P2B2) — Figma `Information`, in its two
 * established types:
 *
 *   warning      the lime relevance surface, for personal relevance only
 *                ("Warning: This recall affects you." — the sentence is the
 *                presentation contract's, never composed here)
 *   information  the soft-blue `background/subtle` surface, for neutral
 *                guidance and notices
 *
 * Both are `radius/8`, `spacing/12` padding, the design's 16px glyph
 * (`warning` / `info`, exported from the Figma file) beside `body-small`
 * text in `text/primary` — Figma binds the text to `background/brand`, which
 * DESIGN.md corrects to a text token. No shadow: Figma's callout shadow has
 * no token (conflict 15), and the surface colour already separates it from
 * the page.
 *
 * Lime is relevance, never severity and never "safe": a caller cannot put
 * generic information on the warning surface without saying so in code, and
 * the sentence it carries is the only channel — the glyph is decorative.
 *
 * To assistive technology the callout is one element that reads its
 * sentence; nothing animates, and only a caller that says so (the stale-feed
 * notice, which appears after a failed refresh) is a polite live region.
 */

import { StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/icon';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { spacing, typography, type BackgroundToken } from '@/constants/design-tokens';

export type CalloutTone = 'warning' | 'information';

const TONE: Record<CalloutTone, { background: BackgroundToken; icon: IconName }> = {
  warning: { background: 'background/accent', icon: 'warning' },
  information: { background: 'background/subtle', icon: 'info' },
};

export function Callout({
  tone,
  children,
  accessibilityLiveRegion,
}: {
  tone: CalloutTone;
  children: string;
  /** `polite` for a notice that appears after the screen is already up. */
  accessibilityLiveRegion?: 'polite';
}) {
  const treatment = TONE[tone];
  return (
    <Surface
      background={treatment.background}
      radius={8}
      accessible
      accessibilityRole="text"
      accessibilityLiveRegion={accessibilityLiveRegion}
      style={styles.callout}>
      {/* The glyph sits centred on the first line of text, whatever the
          reader's type size, because its box is one body-small line tall. */}
      <View style={styles.glyph}>
        <Icon name={treatment.icon} size={16} color="icon/primary" />
      </View>
      <Text variant="body-small" style={styles.text}>
        {children}
      </Text>
    </Surface>
  );
}

const styles = StyleSheet.create({
  callout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[8],
    padding: spacing[12],
  },
  glyph: {
    height: typography['body-small'].lineHeight,
    justifyContent: 'center',
  },
  text: {
    flex: 1,
  },
});
