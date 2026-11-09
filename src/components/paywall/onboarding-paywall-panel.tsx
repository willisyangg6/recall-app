/**
 * The paywall (the Fridge Note paywall, 2026-11-06): the founder-selected
 * direction #2 of the lifetime-paywall kit, rebuilt from its supplied
 * artwork and native UI. From the top: the back control every onboarding
 * screen has; the headline `A note from me.`; the founder's letter, native
 * text on the stationery artwork (the hanging mascot, the lime magnet, the
 * blue backing and the curled paper) and signed with the handwritten
 * `Willis` alone; two benefit rows; then the purchase footer — `Lifetime
 * access` with the store's price on the lime capsule, the navy action, the
 * four legal actions and the independence
 * note.
 *
 * It is BOTH paywall routes: `/onboarding/paywall` from Ready, and the
 * standalone `/paywall` a lapsed or expired subscriber meets. The routes
 * differ only in the Back they hand in and what they add beneath the
 * benefits (the standalone route's Privacy & Data Controls entry, the
 * development controls). Both draw the SAME purchase state from the one
 * purchase flow (hooks/use-purchase-flow.tsx) and hold none of their own.
 *
 * ## The stationery
 *
 * One image, drawn as three clipped instances (lib/onboarding-paywall-
 * presentation.ts `backdropSlices`): the mascot band and the curl band at
 * the image's own scale, the blank paper between them stretched vertically
 * to the letter's natural height. It is decorative: hidden from assistive
 * technology and touching nothing. The letter is laid out first and the
 * artwork is sized from it, so the words are never shrunk, truncated or
 * clipped to fit the art; the art grows instead and the page scrolls.
 *
 * ## The footer
 *
 * The frame's: the page colour over the real bottom inset. At ordinary text
 * sizes it holds the offer under its hairline, the notice, the action and the
 * terms; from the accessibility sizes the offer and terms move to the end of
 * the scrolling content and only the notice and the action stay pinned
 * (`usePurchaseFooterSlots`), so the letter stays reachable.
 *
 * ## Accessibility
 *
 * VoiceOver hears Back, the headline, the letter paragraph by paragraph, the
 * signature as `Willis`, each benefit as one element, the offer as one
 * element (its title, the store's price and its terms), then the footer.
 * Nothing caps Dynamic Type.
 */

import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import {
  Image,
  Text as NativeText,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type ImageSourcePropType,
  type TextLayoutLine,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { OnboardingTopBar } from '@/components/onboarding/onboarding-frame';
import {
  OnboardingActionPill,
  PaywallNotice,
  usePurchaseFooterSlots,
  type PurchaseProps,
} from '@/components/paywall/paywall-panel';
import { Icon } from '@/components/ui/icon';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { color, fontFace, layout, radius, spacing } from '@/constants/design-tokens';
import { CONTINUE_CTA, EDUCATION_SUCCESS } from '@/lib/onboarding-copy';
import {
  atAccessibilitySize,
  BACKDROP_WIDTH_RATIO,
  backdropSlices,
  BENEFIT_GLYPH,
  BENEFIT_PLATE,
  BENEFITS_OVERLAP,
  benefitSpacing,
  PAGE_BOTTOM_PADDING,
  headlineType,
  LETTER_CLOSING,
  LETTER_EMPHASIS_PARAGRAPH,
  LETTER_INSETS,
  LETTER_OPENING,
  LETTER_PARAGRAPH_GAP,
  letterLeftInset,
  ONBOARDING_PAYWALL_BENEFITS,
  ONBOARDING_PAYWALL_HEADLINE,
  PAYWALL_TYPE,
  SIGNATURE,
  SIGNATURE_ACCESSIBILITY_LABEL,
  stageOverlap,
  UNDERLINE,
  underlinePath,
} from '@/lib/onboarding-paywall-presentation';
import {
  PAYWALL_BACK_HINT,
  PAYWALL_BACK_LABEL,
  PAYWALL_INDEPENDENCE_NOTE,
  paywallFooterPlacement,
  paywallPresentation,
} from '@/lib/paywall-screen';

/** The stationery, 1254×1254 RGBA, with no words in it (the kit's art, unaltered). */
const BACKDROP =
  require('@/assets/paywall/fridge-note/fridge-note-backdrop.png') as ImageSourcePropType;
/** The handwritten sign-off, 2164×727 RGBA. */
const SIGNATURE_ART =
  require('@/assets/paywall/fridge-note/willis-signature.png') as ImageSourcePropType;

/** The extra gap between the two benefits when the page has room to spare. */
const BenefitGapContext = createContext(0);

/** Drawing only: hidden from assistive technology, touching nothing. */
const DECORATIVE = {
  accessible: false,
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
} as const;

/**
 * The paywall for a shopper with something to buy: the letter, the
 * benefits, whatever the route adds beneath them, and the purchase footer.
 */
export function OnboardingPaywallPanel({
  purchase,
  onBack,
  benefitLift = 0,
  children,
}: {
  purchase: PurchaseProps;
  /** The one way back. */
  onBack: () => void;
  /**
   * Points moved from below the content to above the first benefit when the
   * page fits at the default size (the standalone route's
   * `STANDALONE_BENEFIT_LIFT`); 0 elsewhere.
   */
  benefitLift?: number;
  /** Rendered beneath the benefits (the route's privacy entry and development controls). */
  children?: ReactNode;
}) {
  const slots = usePurchaseFooterSlots(purchase, {
    appearance: 'onboarding',
    offer: <Offer purchase={purchase} />,
    note: (
      <Text variant="caption" color="text/secondary" style={styles.independence}>
        {PAYWALL_INDEPENDENCE_NOTE}
      </Text>
    ),
  });
  const { fontScale, height } = useWindowDimensions();
  return (
    <PaywallPage
      onBack={onBack}
      footer={slots.footer}
      benefitLift={benefitLift}
      footerRuled={paywallFooterPlacement(fontScale, height) === 'sticky'}>
      <BenefitRows />
      {children}
      {slots.inlineTerms}
    </PaywallPage>
  );
}

/**
 * The paywall for a shopper who is ALREADY entitled (restored elsewhere, or
 * bought on another device) with onboarding unfinished: never an actionable
 * purchase. The offer, terms and store are left out, the active access is
 * said plainly, and `Continue` completes personalization so the gate opens
 * notification education.
 */
export function OnboardingEntitledPanel({
  onBack,
  onContinue,
}: {
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <PaywallPage
      onBack={onBack}
      footer={<OnboardingActionPill label={CONTINUE_CTA} onPress={onContinue} />}>
      <PaywallNotice tone="success" kind="entitled">
        {EDUCATION_SUCCESS}
      </PaywallNotice>
      <BenefitRows />
    </PaywallPage>
  );
}

/**
 * The page both panels share: the top bar, the headline, the note, the
 * content column, and the pinned footer.
 */
function PaywallPage({
  onBack,
  footer,
  footerRuled = false,
  benefitLift = 0,
  children,
}: {
  onBack: () => void;
  footer: ReactNode;
  /** The footer opens with the offer's own hairline, so it draws none of its own. */
  footerRuled?: boolean;
  /** See `OnboardingPaywallPanel`. */
  benefitLift?: number;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const { fontScale } = window;

  // The note spans the page the scroll view actually has (the Design
  // Preview draws screens narrower than the window).
  const [pageWidth, setPageWidth] = useState(0);
  const width = Math.min(pageWidth > 0 ? pageWidth : window.width, layout.maxContentWidth);

  // The footer's own hairline shows only while content runs beneath it.
  const [viewport, setViewport] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const overflowing = viewport > 0 && contentHeight > viewport + 1;

  // Spare height, shared out around the benefits (benefitSpacing). Measured
  // WITHOUT the extra already applied, so the extra can never feed back into
  // its own measurement.
  const [extra, setExtra] = useState({ top: 0, between: 0, lift: 0 });
  const applied = useRef({ top: 0, between: 0, lift: 0 });
  // The latest of each measurement, whichever event reports it first (on a
  // fresh mount the content size arrives before the scroll view's layout).
  const measured = useRef({ viewport: 0, content: 0 });
  const settle = () => {
    const { viewport: nextViewport, content: nextContent } = measured.current;
    if (nextViewport <= 0 || nextContent <= 0) return;
    // A lift moves height from the bottom padding to the top: net zero.
    const base = nextContent - applied.current.top - applied.current.between + applied.current.lift;
    const next = benefitSpacing(nextViewport - base, fontScale, benefitLift);
    if (
      next.top !== applied.current.top ||
      next.between !== applied.current.between ||
      next.lift !== applied.current.lift
    ) {
      applied.current = next;
      setExtra(next);
    }
  };

  return (
    <Surface background="background/page" style={styles.page}>
      <OnboardingTopBar
        back={{ label: PAYWALL_BACK_LABEL, hint: PAYWALL_BACK_HINT, onPress: onBack }}
        progress={null}
        compact
      />
      <ScrollView
        style={styles.page}
        contentContainerStyle={[
          styles.content,
          extra.lift > 0 && { paddingBottom: PAGE_BOTTOM_PADDING - extra.lift },
          // Nothing pinned: the page itself clears the home indicator.
          footer === null && { paddingBottom: insets.bottom + spacing[16] },
        ]}
        onLayout={(event) => {
          setPageWidth(event.nativeEvent.layout.width);
          setViewport(event.nativeEvent.layout.height);
          measured.current.viewport = event.nativeEvent.layout.height;
          settle();
        }}
        onContentSizeChange={(_, height) => {
          setContentHeight(height);
          measured.current.content = height;
          settle();
        }}>
        <View style={styles.headline}>
          <Text variant="display" accessibilityRole="header" style={headlineType(fontScale)}>
            {ONBOARDING_PAYWALL_HEADLINE}
          </Text>
        </View>
        <FridgeNote width={width} />
        <View
          style={[
            styles.column,
            { marginTop: extra.top - BENEFITS_OVERLAP * width * BACKDROP_WIDTH_RATIO },
          ]}>
          <BenefitGapContext.Provider value={extra.between}>{children}</BenefitGapContext.Provider>
        </View>
      </ScrollView>
      {footer === null ? null : (
        <View
          style={[
            styles.footer,
            !footerRuled && overflowing && styles.footerRule,
            { paddingBottom: insets.bottom + spacing[8] },
          ]}>
          {footer}
        </View>
      )}
    </Surface>
  );
}

/**
 * The note: the letter laid out at its natural height, and the stationery
 * drawn behind it at the height that needs (its blank middle stretched or
 * shortened, never below `MIN_MIDDLE_FRACTION`).
 */
function FridgeNote({ width }: { width: number }) {
  const { fontScale } = useWindowDimensions();
  const art = width * BACKDROP_WIDTH_RATIO;
  const [letterHeight, setLetterHeight] = useState(0);
  const { height, slices } = backdropSlices(art, letterHeight);
  return (
    <View style={[styles.stage, { height, marginTop: -stageOverlap(fontScale) }]}>
      <View
        {...DECORATIVE}
        pointerEvents="none"
        style={[styles.art, { width: art, left: (width - art) / 2, height }]}>
        {slices.map((slice, index) => (
          <View
            key={index}
            style={[styles.slice, { top: slice.offset, height: slice.height, width: art }]}>
            <Image
              source={BACKDROP}
              resizeMode="stretch"
              style={{
                position: 'absolute',
                top: slice.imageTop,
                width: art,
                height: slice.imageHeight,
              }}
            />
          </View>
        ))}
      </View>
      <View
        onLayout={(event) => {
          const next = Math.ceil(event.nativeEvent.layout.height);
          setLetterHeight((prior) => (prior === next ? prior : next));
        }}
        style={{
          paddingTop: LETTER_INSETS.top * art,
          paddingBottom: LETTER_INSETS.bottom * art,
          paddingLeft: letterLeftInset(fontScale) * width,
          paddingRight: LETTER_INSETS.right * width,
        }}>
        <Text style={[styles.letter, styles.paragraph]}>{LETTER_OPENING}</Text>
        <EmphasisParagraph />
        <Text style={styles.letter}>{LETTER_CLOSING}</Text>
        <Image
          source={SIGNATURE_ART}
          resizeMode="contain"
          accessible
          accessibilityRole="image"
          accessibilityLabel={SIGNATURE_ACCESSIBILITY_LABEL}
          style={styles.signature}
        />
      </View>
    </View>
  );
}

/**
 * The letter's second paragraph, with `people you love.` underlined by the
 * target's hand-drawn lime stroke (the kit's people-you-love-underline.svg
 * path, redrawn at the phrase's measured width). The stroke is placed from
 * the paragraph's own text layout: the phrase ends the paragraph, so when it
 * sits whole on the last line it spans that line's last `phrase width`
 * points. Whenever it does not — a larger text size wrapping the phrase
 * across two lines — the native underline in the same lime is drawn instead,
 * which wraps with the words. Never a fixed screen coordinate.
 */
function EmphasisParagraph() {
  const [phraseWidth, setPhraseWidth] = useState(0);
  const [lastLine, setLastLine] = useState<TextLayoutLine | null>(null);
  const whole =
    phraseWidth > 0 &&
    lastLine !== null &&
    lastLine.text.trimEnd().endsWith(LETTER_EMPHASIS_PARAGRAPH.emphasis) &&
    lastLine.width >= phraseWidth;
  return (
    <View style={styles.paragraph}>
      <Text
        style={styles.letter}
        onTextLayout={(event) => {
          const lines = event.nativeEvent.lines;
          setLastLine(lines.length > 0 ? lines[lines.length - 1] : null);
        }}>
        {LETTER_EMPHASIS_PARAGRAPH.lead}
        {/* A bare native span: it inherits the paragraph's face, size, line
            height and Dynamic Type. The app's Text would re-apply its own
            `body` variant (16/24) and set the phrase larger (fixed
            2026-11-08). Only the underline marks it. */}
        <NativeText style={whole ? null : styles.emphasis}>
          {LETTER_EMPHASIS_PARAGRAPH.emphasis}
        </NativeText>
      </Text>
      {whole ? (
        <Svg
          {...DECORATIVE}
          pointerEvents="none"
          width={phraseWidth}
          height={UNDERLINE.height}
          style={{
            position: 'absolute',
            left: lastLine.x + lastLine.width - phraseWidth,
            top: lastLine.y + lastLine.height - UNDERLINE.rise,
          }}>
          <Path
            d={underlinePath(phraseWidth)}
            fill="none"
            stroke={color['onboarding/letter-emphasis']}
            strokeWidth={UNDERLINE.stroke}
            strokeLinecap="round"
          />
        </Svg>
      ) : null}
      {/* The phrase alone, invisible, to measure its width at this text size. */}
      <Text
        {...DECORATIVE}
        style={[styles.letter, styles.measure]}
        onTextLayout={(event) => setPhraseWidth(event.nativeEvent.lines[0]?.width ?? 0)}>
        {LETTER_EMPHASIS_PARAGRAPH.emphasis}
      </Text>
    </View>
  );
}

/**
 * The two benefits: an app line icon on a powder-blue plate, a bold heading
 * and its explanation. Each row is ONE element to assistive technology,
 * spoken as its heading and explanation; the icon is drawing.
 */
function BenefitRows() {
  const { fontScale } = useWindowDimensions();
  const largeText = atAccessibilitySize(fontScale);
  const extraGap = useContext(BenefitGapContext);
  return (
    <View style={[styles.benefits, { rowGap: spacing[16] + extraGap }]} accessibilityRole="list">
      {ONBOARDING_PAYWALL_BENEFITS.map((benefit) => (
        <View
          key={benefit.title}
          accessible
          accessibilityLabel={`${benefit.title}. ${benefit.body}`}
          style={[styles.benefit, largeText && styles.benefitTop]}>
          <View style={styles.plate}>
            <Icon name={benefit.icon} points={BENEFIT_GLYPH} color="icon/primary" />
          </View>
          <View style={styles.benefitText}>
            <Text variant="display" style={PAYWALL_TYPE.benefitTitle}>
              {benefit.title}
            </Text>
            <Text variant="body-small" color="text/secondary" style={PAYWALL_TYPE.benefitBody}>
              {benefit.body}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * The one offer under its hairline: `Lifetime access` and its terms, and the
 * store's own price on the lime capsule — or, while there is no price, the
 * one line that says why. The price wraps beneath the title when the two
 * cannot share a line; it is never shortened.
 */
function Offer({ purchase }: { purchase: PurchaseProps }) {
  const shown = paywallPresentation(purchase.view);
  return (
    <View style={styles.offerBlock}>
      <View style={styles.divider} {...DECORATIVE} />
      {shown.offer === null ? (
        <Text
          variant="body-small"
          color="text/secondary"
          accessibilityLiveRegion="polite"
          style={styles.offeringMessage}>
          {shown.offeringMessage}
        </Text>
      ) : (
        <View accessible accessibilityLabel={shown.offer.accessibilityLabel} style={styles.offer}>
          <View style={styles.offerText}>
            <Text variant="display" style={PAYWALL_TYPE.offerTitle}>
              {shown.offer.title}
            </Text>
            <Text variant="body-small" color="text/secondary" style={PAYWALL_TYPE.offerSubtitle}>
              {shown.offer.subtitle}
            </Text>
          </View>
          <View style={styles.price}>
            <Text variant="display" style={PAYWALL_TYPE.price}>
              {shown.offer.price}
            </Text>
          </View>
        </View>
      )}
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
    paddingBottom: PAGE_BOTTOM_PADDING,
  },
  // 24pt from the edge, and 4pt closer to Back than the frame's rhythm: the
  // target's chevron-to-heading spacing.
  headline: {
    paddingHorizontal: layout.pageMargin + 8,
    marginTop: -4,
  },
  // The note's stage: its height is the artwork's, which the letter sets.
  stage: {
    width: '100%',
  },
  art: {
    position: 'absolute',
    top: 0,
  },
  slice: {
    position: 'absolute',
    left: 0,
    overflow: 'hidden',
  },
  letter: {
    ...PAYWALL_TYPE.letter,
    fontFamily: fontFace['sans-400'],
    color: color['text/primary'],
  },
  paragraph: {
    marginBottom: LETTER_PARAGRAPH_GAP,
  },
  // Measures the phrase; never seen, never read.
  measure: {
    position: 'absolute',
    opacity: 0,
  },
  // Lime under the words, wrapping with them (when the stroke cannot be placed).
  emphasis: {
    textDecorationLine: 'underline',
    textDecorationStyle: 'solid',
    textDecorationColor: color['onboarding/letter-emphasis'],
  },
  // Both sides explicit: iOS lays an Image with only `width` and
  // `aspectRatio` out at the PNG's own 2164×727 (measured 2026-11-06).
  signature: {
    width: SIGNATURE.width,
    height: SIGNATURE.width / SIGNATURE.aspectRatio,
    marginLeft: SIGNATURE.marginLeft,
  },
  column: {
    paddingHorizontal: layout.pageMargin + 1,
    gap: spacing[12],
  },
  // The target's 55pt from one benefit heading to the next.
  benefits: {
    gap: spacing[16],
  },
  benefit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[16],
  },
  // From the accessibility sizes the plate stays level with the heading
  // while the wrapped text runs on beneath.
  benefitTop: {
    alignItems: 'flex-start',
  },
  plate: {
    width: BENEFIT_PLATE,
    aspectRatio: 1,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color['onboarding/benefit-plate'],
  },
  benefitText: {
    flex: 1,
  },
  // 13pt from the offer to the action (the footer's own gap plus this
  // margin), 2pt under the target's to give its 51pt action the room.
  offerBlock: {
    gap: spacing[12],
    marginBottom: 6,
  },
  // The purchase divider: a hairline 8pt in from the screen's edges.
  divider: {
    marginHorizontal: -(layout.pageMargin - 8),
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    borderTopColor: color['border/subtle'],
  },
  offer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    rowGap: spacing[8],
    columnGap: spacing[12],
  },
  offerText: {
    flexShrink: 1,
  },
  // The lime capsule: the store's price, never shortened.
  price: {
    paddingHorizontal: spacing[12],
    paddingVertical: 3,
    borderRadius: radius.full,
    backgroundColor: color['background/accent'],
  },
  offeringMessage: {
    paddingVertical: spacing[8],
    textAlign: 'center',
  },
  // Tucked under the links' own 8pt padding: the target's spacing.
  independence: {
    textAlign: 'center',
    marginTop: -3,
  },
  // The frame's footer: the page colour, pinned over the bottom inset.
  footer: {
    width: '100%',
    paddingHorizontal: layout.pageMargin,
    paddingTop: spacing[8],
    // The target's 7pt rhythm between the footer's blocks.
    gap: 7,
    borderTopWidth: 1,
    borderTopColor: 'transparent',
    backgroundColor: color['background/page'],
  },
  footerRule: {
    borderTopColor: color['border/subtle'],
  },
});
