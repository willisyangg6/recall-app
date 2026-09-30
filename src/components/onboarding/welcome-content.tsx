/**
 * Screen 1, Welcome: the Lotly introduction (the receipt Welcome,
 * 2026-09-29).
 *
 * The founder-approved composition
 * (assets/brand/reference/lotly-onboarding-welcome-receipt-target.png),
 * rebuilt from its two approved production images and native text. From the
 * top: the bespoke `lotly` wordmark, centred; the headline and body, left
 * aligned in the target's own narrow column; the grocery scene with the
 * mascot holding the illustrative receipt, across the full width; the native
 * example caption over the scene's quiet counter; the FDA/USDA source note;
 * and `Get started` pinned above the bottom inset. Not a counted step: no
 * progress, no back control, no skip.
 *
 * ## Its own page, the frame's footer
 *
 * The scene bleeds to both screen edges and the wordmark sits directly under
 * the status bar, so Welcome draws its own page instead of the shared frame
 * (whose content is inset to the page margin under a 44pt top bar Welcome
 * would leave empty). The rest is the frame's: the page colour, the real
 * safe areas (nothing is drawn under the status bar), a scroll view, and the
 * frame's sticky footer. Its hairline is always
 * allocated and drawn only while content actually runs beneath the footer,
 * because at the default size on a standard phone nothing does and the
 * approved composition has none.
 *
 * ## The two images
 *
 * Both are crops of the approved target at its own pixels, drawn whole with
 * `contain` at their own aspect ratios and scaled by the page width
 * (lib/welcome-presentation.ts): never re-cropped, tinted, faded or boxed.
 * They are approved for this cream page only. Each is given its size by a
 * box with a width and an aspect ratio, the image filling it (an `Image`
 * sized by `aspectRatio` alone was laid out at its intrinsic size on
 * device).
 *
 * The wordmark is one image named `Lotly`. The scene is one image whose name
 * is its printed notice, word for word; the groceries and the mascot add no
 * elements of their own, and the printed flag, pin and bookmark are drawing,
 * not controls. The example caption follows it, so the two are heard
 * together.
 *
 * ## The example caption
 *
 * Over the scene's quiet counter, centred on the target's own caption row,
 * while one line of it fits there; at a larger text size it moves into the
 * flow directly under the scene. The rule reads only the width and the text
 * scale, so the first frame is the final one. It is drawn in `text/primary`:
 * `text/secondary` measures 3.5–4.2:1 on that counter, below AA for its size.
 *
 * ## Welcome's own type and action (fidelity pass, 2026-09-29)
 *
 * The headline (36pt) and body (18pt) take the target's sizes and leading
 * over the `display` and `body` faces, and `Get started` is the target's
 * taller pill (51pt, 18pt label): founder-approved for Welcome only
 * (`WELCOME_TYPE`, lib/welcome-presentation.ts). The shared Button has no
 * size override, so `GetStarted` draws the shared Button's primary
 * treatment itself: the same pill, fill, label colour and face, pressed
 * opacity, role and state, only taller and with the larger label. The shared
 * type scale and Button are unchanged everywhere else.
 *
 * Static: no entrance, no loop. Route transitions (and their Reduce Motion
 * fade) belong to the root stack. Presentational: the route hands in
 * `onGetStarted`; the Design Preview hands in nothing that navigates.
 */

import { useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type ImageSourcePropType,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { color, radius, spacing, layout } from '@/constants/design-tokens';
import {
  WELCOME_BODY,
  WELCOME_CTA,
  WELCOME_EXAMPLE_CAPTION,
  WELCOME_HEADLINE,
  WELCOME_ILLUSTRATION_LABEL,
  WELCOME_TRUST_NOTE,
  WORDMARK_LABEL,
} from '@/lib/onboarding-copy';
import {
  captionBand,
  captionPlacement,
  CTA_MIN_HEIGHT,
  HERO_PX,
  REFERENCE_WIDTH,
  textFullWidth,
  textMeasure,
  WELCOME_TYPE,
  WORDMARK_PX,
} from '@/lib/welcome-presentation';

/** The approved wordmark, 395×200 RGBA, cut from the target at its own pixels. */
const WORDMARK =
  require('@/assets/brand/production/lotly-wordmark-welcome-receipt.png') as ImageSourcePropType;
/** The approved scene, 852×920 RGBA, with its repaired lower fade. */
const SCENE =
  require('@/assets/brand/production/lotly-welcome-receipt-scene.png') as ImageSourcePropType;

/**
 * The pixels themselves: the named element is the box around each image
 * (the Problem steps' pattern, which the accessibility tree reports as one
 * image), so the image adds nothing and takes no touches.
 */
const DRAWING = {
  accessible: false,
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
  pointerEvents: 'none',
} as const;

export function WelcomeContent({ onGetStarted }: { onGetStarted: () => void }) {
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const placement = captionPlacement(width, fontScale);
  const band = captionBand();
  const [viewport, setViewport] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const overflowing = viewport > 0 && contentHeight > viewport + 1;

  const caption = (
    <Text variant="caption" color="text/primary" style={styles.centred}>
      {WELCOME_EXAMPLE_CAPTION}
    </Text>
  );

  return (
    <Surface background="background/page" style={[styles.page, { paddingTop: insets.top }]}>
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.content}
        onLayout={(event) => setViewport(event.nativeEvent.layout.height)}
        onContentSizeChange={(_, height) => setContentHeight(height)}>
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={WORDMARK_LABEL}
          style={styles.wordmark}>
          <Image {...DRAWING} source={WORDMARK} resizeMode="contain" style={styles.fill} />
        </View>
        <View style={textFullWidth(fontScale) ? styles.pageMargin : styles.inset}>
          <View style={[styles.heading, { maxWidth: textMeasure(fontScale) }]}>
            <Text variant="display" accessibilityRole="header" style={styles.headline}>
              {WELCOME_HEADLINE}
            </Text>
            <Text variant="body" color="text/secondary" style={styles.body}>
              {WELCOME_BODY}
            </Text>
          </View>
        </View>
        <View style={styles.spacer} />
        <View style={styles.scene}>
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={WELCOME_ILLUSTRATION_LABEL}
            style={StyleSheet.absoluteFill}>
            <Image {...DRAWING} source={SCENE} resizeMode="contain" style={styles.fill} />
          </View>
          {placement === 'overlay' ? (
            <View style={[styles.captionBand, { top: `${band.top}%`, height: `${band.height}%` }]}>
              {caption}
            </View>
          ) : null}
        </View>
        {placement === 'below' ? <View style={styles.captionBelow}>{caption}</View> : null}
        <View style={styles.inset}>
          <Text variant="caption" color="text/secondary" style={styles.centred}>
            {WELCOME_TRUST_NOTE}
          </Text>
        </View>
      </ScrollView>
      <View
        style={[
          styles.footer,
          overflowing && styles.footerRule,
          { paddingBottom: insets.bottom + spacing[12] },
        ]}>
        <GetStarted onPress={onGetStarted} />
      </View>
    </Surface>
  );
}

/**
 * The shared Button's primary treatment at Welcome's size (see "Welcome's
 * own type and action"): the whole pill is the target, announced as an
 * enabled button with its visible label as its name.
 */
function GetStarted({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: false, busy: false }}
      onPress={onPress}>
      {({ pressed }) => (
        <View style={[styles.cta, pressed && styles.ctaPressed]}>
          <Text variant="body-small-bold" color="text/inverse" style={styles.ctaLabel}>
            {WELCOME_CTA}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

/**
 * Three short rows, each a brand-coloured mark beside its sentence. Welcome
 * no longer shows these; the paywall's benefit list still does.
 */
export function BenefitList({ items }: { items: readonly string[] }) {
  return (
    <View style={styles.benefits} accessibilityRole="list">
      {items.map((item) => (
        <View key={item} style={styles.benefit}>
          <View style={styles.mark} />
          <Text variant="body" style={styles.benefitText}>
            {item}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  // At least the viewport's height, so the spacer can take what is left.
  content: {
    flexGrow: 1,
  },
  // The target's wordmark box: 395 of its 852px, centred, under the status bar.
  wordmark: {
    width: `${(WORDMARK_PX.width / REFERENCE_WIDTH) * 100}%`,
    aspectRatio: WORDMARK_PX.width / WORDMARK_PX.height,
    alignSelf: 'center',
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  // The target's text inset, wider than the page margin (glyphs at ~23–26pt).
  inset: {
    paddingHorizontal: spacing[24],
  },
  // At accessibility sizes the headline and body take the whole page width.
  pageMargin: {
    paddingHorizontal: layout.pageMargin,
  },
  heading: {
    marginTop: spacing[16],
    gap: spacing[12],
  },
  headline: WELCOME_TYPE.headline,
  body: WELCOME_TYPE.body,
  // A tall phone's spare height goes between the text and the scene.
  spacer: {
    flexGrow: 1,
    minHeight: spacing[4],
  },
  scene: {
    width: '100%',
    aspectRatio: HERO_PX.width / HERO_PX.height,
  },
  captionBand: {
    position: 'absolute',
    left: spacing[24],
    right: spacing[24],
    justifyContent: 'center',
  },
  captionBelow: {
    paddingHorizontal: spacing[24],
    paddingBottom: spacing[8],
  },
  centred: {
    textAlign: 'center',
  },
  // The frame's footer: the page colour, pinned over the bottom inset.
  footer: {
    width: '100%',
    paddingHorizontal: layout.pageMargin,
    paddingTop: spacing[12],
    borderTopWidth: 1,
    borderTopColor: 'transparent',
    backgroundColor: color['background/page'],
  },
  footerRule: {
    borderTopColor: color['border/subtle'],
  },
  // The shared Button's primary pill (components/ui/button.tsx), 51pt tall.
  cta: {
    minHeight: CTA_MIN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[8],
    borderRadius: radius.full,
    backgroundColor: color['action/primary'],
  },
  ctaPressed: {
    opacity: 0.6,
  },
  ctaLabel: {
    ...WELCOME_TYPE.cta,
    textAlign: 'center',
  },
  benefits: {
    gap: spacing[8],
  },
  benefit: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[12],
  },
  // A small brand mark, centred on the first line of body text.
  mark: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: color['icon/brand'],
    marginTop: 8,
  },
  benefitText: {
    flex: 1,
  },
});
