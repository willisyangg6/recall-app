/**
 * Screen 7, Notification education: shown once, after the first verified
 * purchase or restore, and never before. The founder-approved phone-led
 * composition (2026-10-03,
 * assets/brand/reference/lotly-onboarding-notifications-phone-target.png)
 * rebuilt from its one approved production image and native UI. Every
 * measured number is in lib/notification-education-presentation.ts.
 *
 * From the top: the `Subscription active` mark (as written, on the lime
 * surface — the one place lime means success); the hero, whose phone shows an
 * EXAMPLE notification drawn natively in the card's own perspective plane;
 * the `Example notification` caption under the phone; the headline, body and
 * reassurance; then the pinned footer: `Turn on notifications`, `Not now` and
 * the footnote. No back control and no tabs.
 *
 * ## The permission rule
 *
 * Only the primary action may invoke Apple's prompt, and it does so through
 * the route's `onEnable` — the same `enableRecallAlerts` path the
 * Notifications screen uses, which prompts only when the system can still
 * ask. `Not now` calls `onSkip` and nothing else: no read of the permission,
 * no request, no registration. The route decides what follows; this
 * component only reports the choice. While the enable runs, both actions are
 * inert and the primary shows its progress word.
 *
 * ## The example
 *
 * The phone's text is real native text in the system font (what iOS draws a
 * notification in), placed by the measured homography and clipped to the
 * card, at the art's own scale: decoration, so it never follows Dynamic Type.
 * The scene, the example and the caption are ONE accessibility element that
 * says it is an example and then exactly what the phone shows, once; nothing
 * inside it is heard separately. It has no hit area. Static: no entrance, no
 * loop, so Reduce Motion has nothing to remove and the art and the words
 * arrive together.
 *
 * ## Accessibility
 *
 * VoiceOver hears the mark, the example, the headline (a header), the body,
 * the reassurance, then the footer's two actions and the footnote (at the
 * accessibility sizes the footnote follows the reassurance and the footer
 * keeps only the actions, as the onboarding paywall's terms do). Nothing
 * caps Dynamic Type: the page scrolls above the footer, the headline and the
 * caption take adaptive bases at the accessibility sizes, and the hero moves
 * down when a larger mark would cover its art.
 */

import { useState } from 'react';
import {
  Image,
  Pressable,
  Text as NativeText,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type ImageSourcePropType,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OnboardingActionPill } from '@/components/paywall/paywall-panel';
import { Icon } from '@/components/ui/icon';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { color, layout, radius, spacing, typography } from '@/constants/design-tokens';
import { baselineInLine } from '@/lib/building-presentation';
import {
  ACCESSIBILITY_SCALE,
  BADGE_PX,
  badgeTopGap,
  BODY_MEASURE,
  CAPTION_PX,
  CARD_PLANE,
  cardMatrix,
  ctaLabelType,
  EXAMPLE_SLOTS,
  HEADLINE_MEASURE,
  headlineType,
  HERO_PX,
  heroTopBelowBadge,
  ptPerPx,
  RHYTHM_PX,
  systemBaselineInLine,
} from '@/lib/notification-education-presentation';
import {
  EDUCATION_BODY,
  EDUCATION_BUSY,
  EDUCATION_CTA,
  EDUCATION_CTA_HINT,
  EDUCATION_EXAMPLE_APP,
  EDUCATION_EXAMPLE_BODY,
  EDUCATION_EXAMPLE_LABEL,
  EDUCATION_EXAMPLE_SPOKEN,
  EDUCATION_EXAMPLE_TITLE,
  EDUCATION_FOOTNOTE,
  EDUCATION_HEADLINE,
  EDUCATION_REASSURANCE,
  EDUCATION_SECONDARY,
  EDUCATION_SECONDARY_HINT,
  EDUCATION_SUCCESS,
} from '@/lib/onboarding-copy';

/** The approved hero, 934×768 RGBA: the phone's notification card is blank. */
const HERO =
  require('@/assets/brand/production/lotly-notifications-phone-scene.png') as ImageSourcePropType;
/** The approved iOS app icon, uniformly downscaled for the example. */
const EXAMPLE_ICON =
  require('@/assets/onboarding/notifications/notification-example-icon.png') as ImageSourcePropType;

/** Drawing only: hidden from assistive technology, touching nothing. */
const DECORATIVE = {
  accessible: false,
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
} as const;

/** `Not now`: plain navy words, the mock's ≈15pt bold, a 44pt target. */
const SECONDARY_TYPE = { fontSize: 15, lineHeight: 20 } as const;
/** The reassurance row's shield, on the icon set's 24pt box. */
const SHIELD_SIZE = 24;

export function NotificationEducation({
  busy,
  onEnable,
  onSkip,
}: {
  /** The enable is in flight (the system prompt may be up). */
  busy: boolean;
  /** The ONE path to the system permission prompt on this screen. */
  onEnable: () => void;
  /** Proceeds without asking anything. */
  onSkip: () => void;
}) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const { fontScale } = window;
  const large = fontScale >= ACCESSIBILITY_SCALE;

  // Everything spans the page the scroll view actually has (the Design
  // Preview draws screens narrower than the window).
  const [pageWidth, setPageWidth] = useState(0);
  const width = Math.min(pageWidth > 0 ? pageWidth : window.width, layout.maxContentWidth);
  const s = ptPerPx(width);

  // The footer's hairline shows only while content actually runs beneath it.
  const [viewport, setViewport] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const overflowing = viewport > 0 && contentHeight > viewport + 1;

  // The mark's measured size decides whether it may sit over the hero's
  // transparent top rows (lib: heroTopBelowBadge).
  const [badge, setBadge] = useState<{ width: number; height: number } | null>(null);

  // ── The vertical rhythm, from the reference's measured baselines ─────────
  const heroHeight = HERO_PX.height * s;
  const heroTop = heroTopBelowBadge(width, badge);
  const captionLine = typography.caption.lineHeight;
  const captionBaseline = baselineInLine(
    typography.caption.fontSize * fontScale,
    captionLine * fontScale,
  );
  // Default: on the hero's ground-shadow rows, baseline at reference row 868.
  const captionTop = (CAPTION_PX.baseline - HERO_PX.top) * s - captionBaseline;
  const captionOffset = large ? spacing[8] : captionTop - heroHeight;
  const captionBottom = large ? heroHeight + spacing[8] : captionTop + captionLine * fontScale;
  const headline = headlineType(fontScale);
  const headlineBaseline = baselineInLine(
    headline.fontSize * fontScale,
    headline.lineHeight * fontScale,
  );
  const headlineTop = Math.max(
    spacing[8],
    (RHYTHM_PX.headlineBaseline - HERO_PX.top) * s - headlineBaseline - captionBottom,
  );
  const bodyLine = typography.body.lineHeight;
  const bodyBaseline = baselineInLine(typography.body.fontSize * fontScale, bodyLine * fontScale);
  const bodyTop = Math.max(
    spacing[8],
    RHYTHM_PX.headlineToBodyBaseline * s -
      (headline.lineHeight * fontScale - headlineBaseline) -
      bodyBaseline,
  );
  const reassuranceLine = typography['body-small'].lineHeight;
  const reassuranceRow = Math.max(SHIELD_SIZE, reassuranceLine * fontScale);
  const reassuranceTop = Math.max(
    spacing[8],
    RHYTHM_PX.bodyToReassuranceCentre * s -
      (bodyLine * fontScale - bodyBaseline) -
      reassuranceRow / 2,
  );

  const footnote = (
    <Text variant="caption" color="text/secondary" style={styles.centred}>
      {EDUCATION_FOOTNOTE}
    </Text>
  );

  return (
    <Surface background="background/page" style={styles.page}>
      <ScrollView
        style={styles.page}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + badgeTopGap(width, window.height - insets.top) },
        ]}
        onLayout={(event) => {
          setPageWidth(event.nativeEvent.layout.width);
          setViewport(event.nativeEvent.layout.height);
        }}
        onContentSizeChange={(_, height) => setContentHeight(height)}>
        {/* Above the hero in drawing order, so the art never covers it. */}
        <View
          style={[styles.success, { marginLeft: BADGE_PX.left * s }]}
          accessible
          accessibilityRole="text"
          accessibilityLabel={EDUCATION_SUCCESS}
          onLayout={(event) => {
            const { width: w, height: h } = event.nativeEvent.layout;
            if (badge === null || badge.width !== w || badge.height !== h) {
              setBadge({ width: w, height: h });
            }
          }}>
          <Text variant="body-small-bold" style={styles.successText}>
            {EDUCATION_SUCCESS}
          </Text>
        </View>
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={EDUCATION_EXAMPLE_SPOKEN}
          style={{ marginTop: heroTop - (badge?.height ?? 0) }}>
          <View pointerEvents="none" style={{ width, height: heroHeight }}>
            <Image source={HERO} resizeMode="stretch" style={{ width, height: heroHeight }} />
            <ExampleNotification width={width} />
          </View>
          <View
            {...DECORATIVE}
            pointerEvents="none"
            style={
              large
                ? [styles.captionLarge, { marginTop: captionOffset }]
                : {
                    marginTop: captionOffset,
                    marginLeft: CAPTION_PX.left * s,
                    width: (CAPTION_PX.right - CAPTION_PX.left) * s,
                  }
            }>
            <Text variant="caption" color="text/secondary" style={styles.centred}>
              {EDUCATION_EXAMPLE_LABEL}
            </Text>
          </View>
        </View>
        <View style={styles.column}>
          <Text
            variant="display"
            accessibilityRole="header"
            style={[
              styles.headline,
              headline,
              {
                marginTop: headlineTop,
                maxWidth: Math.min(width - 2 * layout.pageMargin, HEADLINE_MEASURE * fontScale),
              },
            ]}>
            {EDUCATION_HEADLINE}
          </Text>
          <Text
            variant="body"
            color="text/secondary"
            style={[
              styles.centred,
              styles.measured,
              {
                marginTop: bodyTop,
                maxWidth: Math.min(width - 2 * layout.pageMargin, BODY_MEASURE * fontScale),
              },
            ]}>
            {EDUCATION_BODY}
          </Text>
          <View
            accessible
            accessibilityRole="text"
            accessibilityLabel={EDUCATION_REASSURANCE}
            style={[
              styles.reassurance,
              large && styles.reassuranceTop,
              { marginTop: reassuranceTop, minHeight: reassuranceRow },
            ]}>
            <Icon name="shield-check" size={SHIELD_SIZE} color="icon/primary" />
            <Text variant="body-small" color="text/secondary" style={styles.reassuranceText}>
              {EDUCATION_REASSURANCE}
            </Text>
          </View>
          {/* From the accessibility sizes the footnote reads after the
              reassurance instead, so the pinned footer keeps only the two
              actions and the page keeps room to scroll. */}
          {large ? <View style={styles.inlineFootnote}>{footnote}</View> : null}
        </View>
      </ScrollView>
      <View
        style={[
          styles.footer,
          overflowing && styles.footerRule,
          { paddingBottom: insets.bottom + spacing[8] },
        ]}>
        <OnboardingActionPill
          label={EDUCATION_CTA}
          accessibilityHint={EDUCATION_CTA_HINT}
          labelType={ctaLabelType(fontScale, width - 2 * layout.pageMargin - 2 * spacing[16])}
          busy={busy}
          busyLabel={EDUCATION_BUSY}
          onPress={onEnable}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={EDUCATION_SECONDARY}
          accessibilityHint={EDUCATION_SECONDARY_HINT}
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={onSkip}
          style={({ pressed }) => [styles.secondary, (pressed || busy) && styles.dimmed]}>
          <Text variant="display" style={[styles.secondaryText, SECONDARY_TYPE]}>
            {EDUCATION_SECONDARY}
          </Text>
        </Pressable>
        {large ? null : footnote}
      </View>
    </Surface>
  );
}

/**
 * The example notification, in the phone's own plane: a view the card's size
 * (card-plane units × s), clipped to the card's rounded rectangle, carried
 * onto the art by the measured homography about its top-left corner. The
 * approved app icon, `Lotly`, the title and the body, in the system font at
 * the art's scale (never Dynamic Type), each placed by its measured baseline.
 * The example is fixed copy that fits the card whole: the title on one or
 * two lines, the body on its two measured lines. Nothing is truncated; the
 * card's clip is only a bound.
 */
function ExampleNotification({ width }: { width: number }) {
  const s = ptPerPx(width);
  const { icon, textLeft, textRight, label, title, body } = EXAMPLE_SLOTS;
  const iconSide = icon.side * s;
  const column = (textRight - textLeft) * s;
  const line = (fontSize: number, lineHeight: number, baseline: number) => ({
    fontSize: fontSize * s,
    letterSpacing: EXAMPLE_SLOTS.tracking * fontSize * s,
    lineHeight: lineHeight * s,
    top: baseline * s - systemBaselineInLine(fontSize * s, lineHeight * s),
  });
  const labelLine = label.fontSize * 1.2;
  return (
    <View
      style={[
        styles.plane,
        {
          width: CARD_PLANE.width * s,
          height: CARD_PLANE.height * s,
          borderRadius: CARD_PLANE.radius * s,
          transform: [{ matrix: cardMatrix(width) }],
        },
      ]}>
      <Image
        source={EXAMPLE_ICON}
        style={[
          styles.planeItem,
          {
            left: icon.centre[0] * s - iconSide / 2,
            top: icon.centre[1] * s - iconSide / 2,
            width: iconSide,
            height: iconSide,
            borderRadius: icon.radius * s,
          },
        ]}
      />
      <NativeText
        allowFontScaling={false}
        style={[
          styles.planeItem,
          styles.exampleLabel,
          { left: textLeft * s, width: column, fontWeight: label.weight },
          line(label.fontSize, labelLine, label.baseline),
        ]}>
        {EDUCATION_EXAMPLE_APP}
      </NativeText>
      <NativeText
        allowFontScaling={false}
        style={[
          styles.planeItem,
          styles.exampleTitle,
          { left: textLeft * s, width: column, fontWeight: title.weight },
          line(title.fontSize, title.lineHeight, title.baseline),
        ]}>
        {EDUCATION_EXAMPLE_TITLE}
      </NativeText>
      <NativeText
        allowFontScaling={false}
        style={[
          styles.planeItem,
          styles.exampleBody,
          { left: textLeft * s, width: column, fontWeight: body.weight },
          line(body.fontSize, body.lineHeight, body.baseline),
        ]}>
        {EDUCATION_EXAMPLE_BODY}
      </NativeText>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  content: {
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
    paddingBottom: spacing[16],
  },
  // The success mark: the relevance/success lime, the compact-label geometry.
  success: {
    alignSelf: 'flex-start',
    minHeight: layout.riskLabelHeight,
    justifyContent: 'center',
    paddingHorizontal: spacing[8],
    paddingVertical: spacing[4],
    borderRadius: radius[4],
    borderWidth: 1,
    backgroundColor: color['background/accent'],
    borderColor: color['action/accent'],
    zIndex: 1,
  },
  successText: {
    color: color['text/primary'],
  },
  // The card plane: placed by its transform alone, clipped to the card.
  plane: {
    position: 'absolute',
    left: 0,
    top: 0,
    overflow: 'hidden',
    transformOrigin: 'top left',
  },
  planeItem: {
    position: 'absolute',
  },
  exampleLabel: {
    color: color['text/secondary'],
  },
  exampleTitle: {
    color: color['text/primary'],
  },
  exampleBody: {
    color: color['text/secondary'],
  },
  captionLarge: {
    paddingHorizontal: layout.pageMargin,
  },
  centred: {
    textAlign: 'center',
  },
  measured: {
    alignSelf: 'center',
  },
  inlineFootnote: {
    marginTop: spacing[16],
  },
  column: {
    paddingHorizontal: layout.pageMargin,
  },
  headline: {
    alignSelf: 'center',
    textAlign: 'center',
    color: color['text/primary'],
  },
  reassurance: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[8],
  },
  // From the accessibility sizes the shield stays level with the first line
  // while the wrapped words run on beneath (the paywall benefits' rule).
  reassuranceTop: {
    alignItems: 'flex-start',
  },
  reassuranceText: {
    flexShrink: 1,
  },
  // The frame's footer: the page colour, pinned over the bottom inset.
  footer: {
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: layout.pageMargin,
    paddingTop: spacing[8] + 2,
    gap: spacing[4],
    borderTopWidth: 1,
    borderTopColor: 'transparent',
    backgroundColor: color['background/page'],
  },
  footerRule: {
    borderTopColor: color['border/subtle'],
  },
  secondary: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    color: color['text/primary'],
    textAlign: 'center',
  },
  dimmed: {
    opacity: 0.6,
  },
});
