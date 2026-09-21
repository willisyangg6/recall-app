/**
 * The compact illness notice (P2B7K) — whether the official notice reported
 * illnesses, shown in Recall Detail's identity area, below the brand and
 * above the official FDA/FSIS report link.
 *
 * ## Three harms, one fact per line (P2B7Q.1)
 *
 * It renders what the notice REPORTED about people — illnesses,
 * hospitalizations, deaths — each on its own line, in that fixed order.
 *
 * P2B7K shipped illnesses only, on the understanding that a hospitalization or
 * a death survived in `What Happened`. P2B7Q measured that and found the
 * narrative never carries a source sentence at all, so those facts reached no
 * surface: 8 of 898 active cases affirmed one and not one of them showed it.
 *
 * Injuries and adverse reactions are still NOT here. The contract that decides
 * what this renders — `domain/illness-status.ts` — cannot express them, so the
 * restriction stays structural rather than a rule this file has to remember.
 *
 * ## Three things it must never be confused with
 *
 *   The Risk Label      uppercase IBM Plex Mono on a filled severity colour,
 *                       24pt minimum height. Illness status is NOT a risk
 *                       level: a Critical recall can report no illnesses and a
 *                       Low one can report many. This notice is sentence-case
 *                       sans on a foundation surface, so the two never read as
 *                       the same object.
 *   Affects You         a full-width lime Callout about THIS shopper. This
 *                       notice is compact, auto-width, and about the recall.
 *   A control           it does nothing. No press target, no role, no hint.
 *
 * ## Colour is never the only channel
 *
 * The two states differ in their words ("12 illnesses reported" / "No
 * illnesses reported"), in their glyph (`warning` / `info`), and in their
 * surface. Any one of the three carries the distinction alone, so the notice
 * survives greyscale, colour-vision deficiency, and a screen reader. A
 * reported hospitalization or death always takes the `reported` treatment,
 * whatever the illness line says.
 *
 * A notice that established none of the three has no copy at all
 * (`illnessNoticeCopy` returns null), so it renders nothing here: no row, no
 * placeholder, no spacer, no spoken element.
 */

import { StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { illnessNoticePalette, radius, spacing, typography } from '@/constants/design-tokens';
import type { IllnessNoticeCopy } from '@/domain/illness-status';

const GLYPH: Record<IllnessNoticeCopy['tone'], IconName> = {
  reported: 'warning',
  none: 'info',
};

export function IllnessNotice({ copy }: { copy: IllnessNoticeCopy }) {
  const palette = illnessNoticePalette[copy.tone];
  return (
    // One accessible element speaking one sentence: the glyph is decorative
    // and merges into the parent, so a reader never hears "warning, image".
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={copy.spoken}
      style={[styles.notice, { backgroundColor: palette.background, borderColor: palette.border }]}>
      {/* The glyph box is one caption line tall, so it stays centred on the
          first line of text at any reader type size. */}
      <View style={styles.glyph}>
        <Icon name={GLYPH[copy.tone]} size={12} color="icon/primary" />
      </View>
      {/* One Text per fact. They stack because the notice is a row whose
          second child is a column: the glyph stays on the first line and each
          fact keeps its own line at every reader type size. The parent is the
          single accessible element, so a reader hears one utterance and the
          lines are never announced as separate items. */}
      <View style={styles.facts}>
        {copy.lines.map((line) => (
          <Text key={line} variant="caption" style={[styles.text, { color: palette.foreground }]}>
            {line}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // `alignSelf: flex-start` keeps it auto-width: the notice is as wide as its
  // sentence, never a full-width band competing with the Affects You callout.
  // `flexShrink` lets it wrap inside Detail's narrow identity column (about
  // 194pt beside a hero on a 390pt screen) instead of overflowing it.
  notice: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'flex-start',
    flexShrink: 1,
    gap: spacing[4],
    paddingHorizontal: spacing[8],
    paddingVertical: spacing[4],
    borderRadius: radius[4],
    borderWidth: 1,
  },
  glyph: {
    height: typography.caption.lineHeight,
    justifyContent: 'center',
  },
  // The facts column. No gap: consecutive caption lines already read as a
  // list at their own line height, and a gap would make two facts look like
  // two notices.
  facts: {
    flexShrink: 1,
  },
  text: {
    flexShrink: 1,
  },
});
