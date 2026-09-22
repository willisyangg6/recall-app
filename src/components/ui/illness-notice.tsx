/**
 * The harm notices (P2B7K; three separate boxes from P2B7V) — what the
 * official notice REPORTED about people, shown in Recall Detail's identity
 * area, below the brand and above the official FDA/FSIS report link.
 *
 * ## One fact, one box (P2B7V)
 *
 * It renders what the notice reported about people — illnesses,
 * hospitalizations, deaths — each in ITS OWN compact box, stacked vertically,
 * every box aligned to the same left edge, in that fixed order.
 *
 * P2B7K shipped illnesses only, on the understanding that a hospitalization or
 * a death survived in `What Happened`. P2B7Q measured that and found the
 * narrative never carries a source sentence at all, so those facts reached no
 * surface: 8 of 898 active cases affirmed one and not one of them showed it.
 * P2B7Q.1 gave them lines of their own — but inside ONE outlined box, under
 * ONE glyph, which left the second and third facts visually indented with no
 * icon of their own, reading as a continuation of the first rather than as
 * the separate things they are. It also meant one treatment had to carry
 * three different severities at once. Each fact now gets its own box, its own
 * glyph, and its own treatment.
 *
 * Injuries and adverse reactions are still NOT here. The contract that decides
 * what this renders — `domain/illness-status.ts` — cannot express them, so the
 * restriction stays structural rather than a rule this file has to remember.
 *
 * ## Severity is the treatment, and the tokens are shared
 *
 * `harmNoticePalette` maps each harm to an EXISTING treatment — illnesses to
 * `risk/high`, hospitalizations to `risk/very-high`, deaths to
 * `risk/critical`, and an explicit denial to the calm blue it has always had.
 * This file holds no colour of its own and copies no hex: it looks the
 * treatment up by the tone the contract decided, exactly as the Risk Label
 * looks its treatment up by tier.
 *
 * ## Three things it must never be confused with
 *
 *   The Risk Label      uppercase IBM Plex Mono on a filled severity colour,
 *                       24pt minimum height, stating a TIER. A harm notice is
 *                       sentence-case Public Sans stating a COUNTED FACT, at
 *                       its own line height. A Critical recall can report no
 *                       illnesses and a Low one can report many, and the two
 *                       objects still never read as the same thing — the type,
 *                       the case, the glyph and the words all differ.
 *   Affects You         a full-width lime Callout about THIS shopper. These
 *                       are compact, auto-width, and about the recall.
 *   A control           they do nothing. No press target, no role, no hint.
 *
 * ## Colour is never the only channel
 *
 * Every box differs in its words ("12 illnesses reported" / "1 death
 * reported" / "No illnesses reported") and a denial differs in its glyph
 * (`info` rather than `warning`). The words carry the distinction alone, so
 * the notices survive greyscale, colour-vision deficiency, and a screen
 * reader. Each box's icon is tinted with its own treatment's foreground — the
 * same navy the Risk Label's text uses on the same fills — so it stays
 * legible at every severity.
 *
 * A notice that established none of the three has no copy at all
 * (`illnessNoticeCopy` returns null), so it renders nothing here: no box, no
 * placeholder, no spacer, no spoken element.
 */

import { StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { harmNoticePalette, radius, spacing, typography } from '@/constants/design-tokens';
import type { HarmNotice, HarmNoticeTone, IllnessNoticeCopy } from '@/domain/illness-status';

/**
 * The warning glyph on every reported harm — the same one the positive
 * illness notice has always used. Only an explicit denial differs, because it
 * is not a warning.
 */
const GLYPH: Record<HarmNoticeTone, IconName> = {
  none: 'info',
  illnesses: 'warning',
  hospitalizations: 'warning',
  deaths: 'warning',
};

export function IllnessNotice({ copy }: { copy: IllnessNoticeCopy }) {
  return (
    // The stack. `alignItems: flex-start` is what puts every box on the same
    // left edge while each stays as wide as its own sentence — no box is
    // stretched to the width of the longest, and none is indented under
    // another.
    <View style={styles.stack}>
      {copy.notices.map((notice) => (
        <HarmNoticeBox key={`${notice.tone}:${notice.text}`} notice={notice} />
      ))}
    </View>
  );
}

function HarmNoticeBox({ notice }: { notice: HarmNotice }) {
  const palette = harmNoticePalette[notice.tone];
  return (
    // One accessible element speaking one sentence: the glyph is decorative
    // and merges into the parent, so a reader never hears "warning, image".
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={notice.spoken}
      style={[styles.notice, { backgroundColor: palette.background, borderColor: palette.border }]}>
      {/* The glyph box is one caption line tall, so it stays centred on the
          first line of text at any reader type size. */}
      <View style={styles.glyph}>
        <Icon name={GLYPH[notice.tone]} size={12} tint={palette.foreground} />
      </View>
      <Text variant="caption" style={[styles.text, { color: palette.foreground }]}>
        {notice.text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Every box on the same left edge, each sized to its own sentence.
  // `alignSelf: flex-start` keeps the STACK auto-width too, so it never
  // becomes a full-width band competing with the Affects You callout, and
  // `flexShrink` lets it wrap inside Detail's narrow identity column (about
  // 194pt beside a hero on a 390pt screen) instead of overflowing it.
  stack: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
    flexShrink: 1,
    gap: spacing[4],
  },
  // No height is fixed: the box is its own caption line box plus padding, so
  // it grows with Dynamic Type instead of clipping, and it has no leading
  // inset of its own — the glyph is the first thing inside it.
  notice: {
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
