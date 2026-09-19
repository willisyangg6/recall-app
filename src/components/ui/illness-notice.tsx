/**
 * The compact illness notice (P2B7K) — whether the official notice reported
 * illnesses, shown in Recall Detail's identity area, below the brand and
 * above the official FDA/FSIS report link.
 *
 * ## It is about illnesses, and nothing else
 *
 * It is not a general harm badge. Injuries, adverse reactions, hospitalizations
 * and deaths never appear here: they stay in `What Happened`, in the source's
 * own words (founder decision, P2B7K). The contract that decides what this
 * renders — `domain/illness-status.ts` — cannot express them, so the
 * restriction is structural rather than a rule this file has to remember.
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
 * survives greyscale, colour-vision deficiency, and a screen reader.
 *
 * `unknown` has no copy at all (`illnessNoticeCopy` returns null), so a recall
 * whose notice never established illness status renders nothing here: no row,
 * no placeholder, no spacer, no spoken element.
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
      <Text variant="caption" style={[styles.text, { color: palette.foreground }]}>
        {copy.text}
      </Text>
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
  text: {
    flexShrink: 1,
  },
});
