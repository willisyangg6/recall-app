/**
 * The onboarding paywall (the grocery-watch paywall, 2026-10-01): the
 * founder-approved composition
 * (assets/brand/reference/lotly-onboarding-paywall-grocery-watch-target.png)
 * rebuilt from its one approved production image and native UI. From the
 * top: the back control every onboarding screen has; the headline `Keep a
 * closer watch.` over the hero's open band, with the blue wave rising beside
 * it; the grocery scene across the full width; three benefit rows; the
 * Annual and Monthly plan cards; then the shared purchase footer.
 *
 * Since 2026-10-04 this is BOTH paywall routes: `/onboarding/paywall` from
 * Ready, and the standalone `/paywall` a lapsed or expired subscriber meets,
 * so a returning shopper sees the same approved design as a first-time one.
 * The routes differ only in the Back they hand in. Both draw the SAME
 * purchase state from the one purchase flow (hooks/use-purchase-flow.tsx)
 * and hold none of their own: plan selection, the purchase, the restore,
 * every notice, the legal links and the entitled path are the flow's.
 *
 * ## Its own page, the frame's chrome
 *
 * The hero bleeds to both screen edges, so this screen draws its own page as
 * States does, keeping the frame's top bar itself (`OnboardingTopBar`) so
 * Back is exactly every other step's. The footer is the frame's: the page
 * colour over the real bottom inset, its hairline drawn only while content
 * actually runs beneath it. It holds the shared `PurchaseCta` and
 * `PurchaseTerms` in their explicit `onboarding` appearance: the 51pt pill,
 * and the renewal disclosure for the chosen plan. The sticky/inline terms
 * rule is the shared one.
 *
 * ## The hero
 *
 * One image, drawn whole with `contain` at its own aspect ratio and scaled by
 * the page width: never cropped, tinted or boxed, and approved for this
 * cream page only. It is decorative: hidden from assistive technology and
 * touching nothing. The notification in it is fixed example artwork labelled
 * as such in the art itself; it has no hit area and says nothing about
 * notification permission or delivery. Static: no entrance, no loop. The
 * headline is drawn above it (lib/onboarding-paywall-presentation.ts, "The
 * hero and the headline"), so the art can never cover the words.
 *
 * ## Accessibility
 *
 * VoiceOver hears Back, the headline, each benefit as one element (its
 * heading and explanation; the icon is drawing), the plan group with each
 * plan as a radio that speaks its full charge and billing period, the
 * independence note, then the footer. The savings badge is drawing: the
 * Annual radio already says the saving. Nothing caps Dynamic Type; the page
 * scrolls above the footer.
 */

import { useState, type ReactNode } from 'react';
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

import { OnboardingTopBar } from '@/components/onboarding/onboarding-frame';
import {
  OnboardingActionPill,
  PaywallNotice,
  usePurchaseFooterSlots,
  type PurchaseProps,
} from '@/components/paywall/paywall-panel';
import { ChoiceGroup } from '@/components/ui/choice-row';
import { Icon } from '@/components/ui/icon';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { color, layout, radius, spacing } from '@/constants/design-tokens';
import { CONTINUE_CTA, EDUCATION_SUCCESS, INDEPENDENCE_NOTE } from '@/lib/onboarding-copy';
import {
  atAccessibilitySize,
  BENEFIT_PLATE,
  HERO_PX,
  headlineMeasure,
  headlineTopClearance,
  headlineType,
  heroOverlap,
  ONBOARDING_PAYWALL_BENEFITS,
  ONBOARDING_PAYWALL_HEADLINE,
  onboardingPlanCards,
  PAYWALL_TYPE,
  RADIO_SIZE,
  renewalDisclosure,
  type OnboardingPlanCard,
} from '@/lib/onboarding-paywall-presentation';
import {
  PAYWALL_BACK_HINT,
  PAYWALL_BACK_LABEL,
  paywallPresentation,
  PLAN_GROUP_LABEL,
} from '@/lib/paywall-screen';

/** The approved hero, 934×620 RGBA, cut from the target at its own pixels. */
const HERO =
  require('@/assets/brand/production/lotly-paywall-grocery-watch-scene.png') as ImageSourcePropType;

/** Drawing only: hidden from assistive technology, touching nothing. */
const DECORATIVE = {
  accessible: false,
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
} as const;

/**
 * The onboarding paywall for a shopper with something to buy: the benefits,
 * the plans, whatever the route adds beneath them (its development
 * controls), the independence note, and the shared purchase footer.
 */
export function OnboardingPaywallPanel({
  purchase,
  onBack,
  children,
}: {
  purchase: PurchaseProps;
  /** The one way back: to the Ready step. */
  onBack: () => void;
  /** Rendered beneath the plans (the route's development controls). */
  children?: ReactNode;
}) {
  const slots = usePurchaseFooterSlots(purchase, {
    appearance: 'onboarding',
    disclosure: renewalDisclosure(purchase.view),
  });
  return (
    <PaywallPage onBack={onBack} footer={slots.footer}>
      <BenefitRows />
      <OnboardingPlans purchase={purchase} />
      {children}
      <Text variant="caption" color="text/secondary">
        {INDEPENDENCE_NOTE}
      </Text>
      {slots.inlineTerms}
    </PaywallPage>
  );
}

/**
 * The onboarding paywall for a shopper who is ALREADY entitled (restored
 * elsewhere, or subscribed on another device) with onboarding unfinished:
 * never an actionable purchase. The plans, terms and store are left out, the
 * active subscription is said plainly, and `Continue` completes
 * personalization so the gate opens notification education.
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
 * The page both panels share: the top bar, the headline over the hero, the
 * content column, and the pinned footer.
 */
function PaywallPage({
  onBack,
  footer,
  children,
}: {
  onBack: () => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const { fontScale } = window;

  // The hero spans the page the scroll view actually has (the Design
  // Preview draws screens narrower than the window).
  const [pageWidth, setPageWidth] = useState(0);
  const width = Math.min(pageWidth > 0 ? pageWidth : window.width, layout.maxContentWidth);

  // The footer's hairline shows only while content runs beneath it.
  const [viewport, setViewport] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const overflowing = viewport > 0 && contentHeight > viewport + 1;

  return (
    <Surface background="background/page" style={styles.page}>
      <OnboardingTopBar
        back={{ label: PAYWALL_BACK_LABEL, hint: PAYWALL_BACK_HINT, onPress: onBack }}
        progress={null}
      />
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.content}
        onLayout={(event) => {
          setPageWidth(event.nativeEvent.layout.width);
          setViewport(event.nativeEvent.layout.height);
        }}
        onContentSizeChange={(_, height) => setContentHeight(height)}>
        {/* Above the hero in drawing order, so the art never covers it. */}
        <View style={styles.headline}>
          <Text
            variant="display"
            accessibilityRole="header"
            style={[
              headlineType(fontScale),
              {
                maxWidth: headlineMeasure(fontScale),
                // Inside the Text, whose own bounds would clip the ascenders.
                paddingTop: headlineTopClearance(fontScale),
              },
            ]}>
            {ONBOARDING_PAYWALL_HEADLINE}
          </Text>
        </View>
        <View
          {...DECORATIVE}
          pointerEvents="none"
          style={[styles.hero, { marginTop: -heroOverlap(width, fontScale) }]}>
          <Image source={HERO} resizeMode="contain" style={styles.fill} />
        </View>
        <View style={styles.column}>{children}</View>
      </ScrollView>
      <View
        style={[
          styles.footer,
          overflowing && styles.footerRule,
          { paddingBottom: insets.bottom + spacing[8] },
        ]}>
        {footer}
      </View>
    </Surface>
  );
}

/**
 * The three benefits: an app line icon on a powder-blue plate, a bold
 * heading and its explanation. Each row is ONE element to assistive
 * technology, spoken as its heading and explanation; the icon is drawing.
 */
function BenefitRows() {
  const { fontScale } = useWindowDimensions();
  const largeText = atAccessibilitySize(fontScale);
  return (
    <View style={styles.benefits} accessibilityRole="list">
      {ONBOARDING_PAYWALL_BENEFITS.map((benefit) => (
        <View
          key={benefit.title}
          accessible
          accessibilityLabel={`${benefit.title}. ${benefit.body}`}
          style={[styles.benefit, largeText && styles.benefitTop]}>
          <View style={styles.plate}>
            <Icon name={benefit.icon} size={20} color="icon/primary" />
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
 * The two plans as a real radio group, or the one line that stands where
 * they would while the offering loads, is unavailable or errored.
 */
function OnboardingPlans({ purchase }: { purchase: PurchaseProps }) {
  const plans = onboardingPlanCards(purchase.view);
  if (plans === null) {
    return (
      <Text
        variant="body-small"
        color="text/secondary"
        accessibilityLiveRegion="polite"
        style={styles.offeringMessage}>
        {paywallPresentation(purchase.view).offeringMessage}
      </Text>
    );
  }
  return (
    <ChoiceGroup label={PLAN_GROUP_LABEL} style={styles.plans}>
      {plans.map((plan) => (
        <PlanCard
          key={plan.period}
          plan={plan}
          onPress={() => purchase.onSelectPlan(plan.period)}
        />
      ))}
    </ChoiceGroup>
  );
}

/**
 * One plan, stacked: the radio, the title (and the savings badge on its
 * trailing edge), the store's price for the period, and the annual plan's
 * monthly equivalent. The ring, the dot and the border carry the selection
 * with the announced state, never colour alone; the whole card is the
 * target.
 */
function PlanCard({ plan, onPress }: { plan: OnboardingPlanCard; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={plan.accessibilityLabel}
      accessibilityState={{ checked: plan.selected, selected: plan.selected }}
      onPress={onPress}>
      {({ pressed }) => (
        <View
          style={[styles.plan, plan.selected && styles.planSelected, pressed && styles.pressed]}>
          <View style={[styles.ring, plan.selected && styles.ringSelected]}>
            {plan.selected ? <View style={styles.dot} /> : null}
          </View>
          <View style={styles.planBody}>
            <View style={styles.planTitleRow}>
              <Text variant="body-small-bold" style={[PAYWALL_TYPE.planTitle, styles.planTitle]}>
                {plan.title}
              </Text>
              {plan.savingsBadge ? (
                <View style={styles.badge} {...DECORATIVE}>
                  <Text variant="display" style={PAYWALL_TYPE.badge}>
                    {plan.savingsBadge}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text variant="display" style={PAYWALL_TYPE.planPrice}>
              {plan.priceText}
            </Text>
            {plan.equivalentLine ? (
              <Text variant="body-small" color="text/secondary" style={PAYWALL_TYPE.planEquivalent}>
                {plan.equivalentLine}
              </Text>
            ) : null}
          </View>
        </View>
      )}
    </Pressable>
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
  // Drawn above the hero that follows it (see the file comment).
  headline: {
    paddingHorizontal: layout.pageMargin,
    zIndex: 1,
  },
  // The whole page width, at the image's own aspect ratio.
  hero: {
    width: '100%',
    aspectRatio: HERO_PX.width / HERO_PX.height,
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  column: {
    paddingHorizontal: layout.pageMargin,
    paddingTop: spacing[4],
    gap: spacing[12],
  },
  // The plates' left edge is the plan cards' (the page inset); the text
  // takes the rest of the width, 12pt from the plate.
  benefits: {
    gap: spacing[8] - 2,
  },
  benefit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[12],
  },
  // From the accessibility sizes the plate stays level with the heading
  // while the wrapped text runs on beneath.
  benefitTop: {
    alignItems: 'flex-start',
  },
  plate: {
    width: BENEFIT_PLATE,
    height: BENEFIT_PLATE,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color['onboarding/benefit-plate'],
  },
  benefitText: {
    flex: 1,
  },
  plans: {
    gap: spacing[8] - 2,
  },
  plan: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[16],
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[8],
    borderRadius: radius[12],
    borderWidth: 1,
    borderColor: color['border/default'],
    backgroundColor: color['background/surface'],
  },
  // The chosen plan reads chosen at a glance: the navy border grown to 2px,
  // the padding giving the pixel back so nothing reflows.
  planSelected: {
    borderWidth: 2,
    borderColor: color['text/primary'],
    paddingHorizontal: spacing[16] - 1,
    paddingVertical: spacing[8] - 1,
  },
  // Level with the boundary between the title and the price, as in the target.
  ring: {
    width: RADIO_SIZE,
    height: RADIO_SIZE,
    marginTop: PAYWALL_TYPE.planTitle.lineHeight - RADIO_SIZE / 2,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: color['border/strong'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringSelected: {
    borderColor: color['text/primary'],
  },
  dot: {
    width: RADIO_SIZE / 2,
    height: RADIO_SIZE / 2,
    borderRadius: radius.full,
    backgroundColor: color['text/primary'],
  },
  planBody: {
    flex: 1,
    gap: spacing[4] - 2,
  },
  // The badge on the title row's trailing edge; it wraps beneath the title
  // when the reader's text is large.
  planTitleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[8],
  },
  planTitle: {
    flexShrink: 1,
  },
  // The savings pill: lime, fully rounded, on the target's top trailing corner.
  badge: {
    paddingHorizontal: spacing[12],
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: color['background/accent'],
  },
  offeringMessage: {
    paddingVertical: spacing[16],
    textAlign: 'center',
  },
  // The frame's footer: the page colour, pinned over the bottom inset.
  footer: {
    width: '100%',
    paddingHorizontal: layout.pageMargin,
    paddingTop: spacing[8] + 2,
    gap: spacing[8],
    borderTopWidth: 1,
    borderTopColor: 'transparent',
    backgroundColor: color['background/page'],
  },
  footerRule: {
    borderTopColor: color['border/subtle'],
  },
  pressed: {
    opacity: 0.6,
  },
});
