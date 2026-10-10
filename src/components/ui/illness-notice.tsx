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
 * ## Their own palette and glyphs (label kit, 2026-10-09)
 *
 * `harmNoticePalette` gives each harm an explicit colour of its own, separate
 * from the risk tiers: amber for reported illnesses, a deep-red ink on pale
 * red for hospitalizations and deaths, and the calm informational blue for an
 * explicit denial. Each harm also has its own glyph (`HARM_GLYPH`): an
 * info circle for the denial, a warning triangle for illnesses, a medical
 * plus in a rounded square for hospitalizations and an exclamation in a
 * circle for deaths. This file holds no colour of its own and copies no hex:
 * it looks the treatment up by the tone the contract decided.
 *
 * ## Three things it must never be confused with
 *
 *   The Risk Label      uppercase 12/16 bold on a filled tier colour, stating
 *                       a TIER. A harm notice is sentence-case 13/18 semibold
 *                       on its own harm colour with a glyph, stating a COUNTED
 *                       FACT. A Critical recall can report no illnesses and a
 *                       Low one can report many, and the two objects still
 *                       never read as the same thing — the colour, the case,
 *                       the glyph and the words all differ.
 *   Affects You         a lime label and callout about THIS shopper. These
 *                       are about the recall.
 *   A control           they do nothing. No press target, no role, no hint.
 *
 * ## Colour is never the only channel
 *
 * Every box differs in its words ("12 illnesses reported" / "1 death
 * reported" / "No illnesses reported") and in its glyph, so hospitalizations
 * and deaths — which share a colour — are told apart by words and glyph. The
 * notices survive greyscale, colour-vision deficiency, and a screen reader.
 * Each box's glyph is tinted with its own treatment's foreground, so it is
 * exactly as legible as the words.
 *
 * A notice that established none of the three has no copy at all
 * (`illnessNoticeCopy` returns null), so it renders nothing here: no box, no
 * placeholder, no spacer, no spoken element.
 */

import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { harmNoticePalette } from '@/constants/design-tokens';
import { HARM_GLYPH, HARM_LINE_HEIGHT, labelGeometry, labelType } from '@/constants/label-design';
import type { HarmNotice, IllnessNoticeCopy } from '@/domain/illness-status';

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
  // React Native scales the text's line height with the reader's text size,
  // so the glyph box scales with it to stay centred on the first line.
  const { fontScale } = useWindowDimensions();
  return (
    // One accessible element speaking one sentence: the glyph is decorative
    // and merges into the parent, so a reader never hears "warning, image".
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={notice.spoken}
      style={[styles.notice, { backgroundColor: palette.background, borderColor: palette.border }]}>
      {/* The glyph box is one harm line tall, so it stays centred on the
          first line of text when a long sentence wraps. */}
      <View style={[styles.glyph, { minHeight: HARM_LINE_HEIGHT * fontScale }]}>
        <Icon
          name={HARM_GLYPH[notice.tone]}
          points={labelGeometry.iconSide}
          tint={palette.foreground}
        />
      </View>
      <Text style={[labelType.harm, styles.text, { color: palette.foreground }]}>
        {notice.text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Every box on the same left edge, each sized to its own sentence.
  // `alignSelf: flex-start` keeps the STACK auto-width too, so it never
  // becomes a full-width band, and `flexShrink` lets it wrap inside Detail's
  // narrow identity column (about 194pt beside a hero on a 390pt screen)
  // instead of overflowing it.
  stack: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
    flexShrink: 1,
    gap: labelGeometry.rowGap,
  },
  // No height is fixed: the box is at least 28pt and otherwise its own text
  // plus padding, so it grows with Dynamic Type instead of clipping, and it
  // has no leading inset of its own — the glyph is the first thing inside it.
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flexShrink: 1,
    gap: labelGeometry.iconGap,
    minHeight: labelGeometry.minHeight,
    paddingHorizontal: labelGeometry.paddingX,
    paddingVertical: labelGeometry.paddingY,
    borderRadius: labelGeometry.radius,
    borderWidth: labelGeometry.harmBorderWidth,
  },
  glyph: {
    flexShrink: 0,
    justifyContent: 'center',
  },
  text: {
    flexShrink: 1,
  },
});
