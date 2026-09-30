/**
 * The purchase UI (P2B7X.1; shared since 2026-09-27), drawn from the tokens
 * and the shared primitives, with every state handed in.
 *
 * ## Pieces, and the two compositions
 *
 * Four pieces, all drawn from ONE `PurchaseProps` (the shape `usePurchaseFlow`
 * owns):
 *
 *   PurchasePlans   the two plan cards as a real radio group — Annual first
 *                   and preselected, `BEST VALUE` on the lime value surface,
 *                   the store-derived monthly equivalent and saving on one
 *                   compact line — or the one line that stands in for them
 *   PurchaseCta     the last outcome's notice and the one primary action
 *                   that names the selected commitment with the store price
 *   PurchaseTerms   the renewal disclosure and the four footer actions
 *                   (Restore Purchases, Terms, Privacy, Support) as text
 *                   buttons at the 44pt target, always present
 *   usePurchaseFooterSlots
 *                   the standalone paywall's placement rule: the CTA is
 *                   sticky, and the terms join it there at ordinary text
 *                   sizes or move inline from the accessibility sizes
 *
 * Two screens compose them:
 *
 *   PaywallPanel   the standalone `/paywall` a lapsed subscriber meets: the
 *                  frame without progress, back to the Ready step, the
 *                  headline and body, the benefits and the plans, the CTA
 *                  immediately available
 *   PreviewStep    the Ready step (components/onboarding/preview-step.tsx):
 *                  the plans follow the personalized summary, the terms are
 *                  always scroll content, and the CTA pins itself only once
 *                  the plan choice is on screen (lib/ready-presentation.ts)
 *
 * Neither holds purchase state, and neither duplicates a handler.
 *
 * ## What is not here
 *
 * No close, skip, dismiss or free route. No trial, lifetime, countdown,
 * crossed-out price or scarcity. A price is the store's `formatted` string;
 * nothing here writes one.
 *
 * ## States
 *
 * All from `paywallPresentation` (lib/paywall-screen.ts): the offering
 * loading, unavailable or errored (one line where the plans would be, the
 * primary action inert); a plan selected; a purchase or restore in progress
 * (the action busy with its progress word, the other inert); and the
 * notices — cancelled and restore-found-nothing on the calm information
 * surface, recoverable and unavailable errors on the bordered alert
 * surface, restore success on the lime success surface, and the
 * could-not-confirm state when the gate failed closed. A plan card's
 * selection is carried by the ring and the border as well as by
 * `accessibilityState.checked`, never by colour alone.
 */

import { useEffect, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type ImageSourcePropType,
} from 'react-native';

import { OnboardingFrame } from '@/components/onboarding/onboarding-frame';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Icon } from '@/components/ui/icon';
import { ChoiceGroup } from '@/components/ui/choice-row';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import {
  color,
  hitSlopToMinimum,
  iconSize,
  layout,
  radius,
  spacing,
  typography,
} from '@/constants/design-tokens';
import type { PlanPeriod } from '@/lib/entitlement';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { CONTINUE_CTA, EDUCATION_SUCCESS, INDEPENDENCE_NOTE } from '@/lib/onboarding-copy';
import { motionAllowed } from '@/lib/onboarding-state';
import { HIDE_MASCOT_AT_SCALE, MASCOT_ENTRANCE } from '@/lib/state-map';
import {
  PAYWALL_BACK_HINT,
  PAYWALL_BACK_LABEL,
  PAYWALL_BENEFITS,
  PAYWALL_BODY,
  PAYWALL_DISCLOSURE,
  PAYWALL_HEADLINE,
  paywallFooterPlacement,
  paywallPresentation,
  PLAN_GROUP_LABEL,
  type PaywallFooterActionKey,
  type PaywallNoticeTone,
  type PaywallView,
  type PlanCardPresentation,
} from '@/lib/paywall-screen';

/** A one-caption-line footer action reaches the 44pt target through hitSlop. */
const FOOTER_HIT_SLOP = hitSlopToMinimum(typography.caption.lineHeight);

/**
 * M04, the watchful pose, beside the paywall's heading (polish pass): the
 * onboarding aside standard — the seat and size States and Stores use — so
 * the paywall reads as Lotly without out-shouting the plans.
 */
const MASCOT =
  require('@/assets/brand/production/lotly-mascot-watchful-1024.png') as ImageSourcePropType;
const MASCOT_SIZE = 120;

/**
 * Everything the shared purchase pieces draw, with their handlers — the
 * shape `usePurchaseFlow` (hooks/use-purchase-flow.tsx) hands out, so the
 * Ready step and the standalone paywall draw the SAME state.
 */
export interface PurchaseProps {
  view: PaywallView;
  onSelectPlan: (period: PlanPeriod) => void;
  onSubscribe: () => void;
  /** Restore, Terms, Privacy, Support — the flow decides what each does. */
  onFooterAction: (key: PaywallFooterActionKey) => void;
  /** A footer destination with no configured URL was pressed. */
  destinationNotice: string | null;
}

/**
 * The dedicated paywall: the onboarding frame without progress, its one way
 * back (to the Ready step), the headline and body, the benefits, the plans,
 * whatever the route adds beneath (its development controls), the
 * independence note, and the shared purchase footer. Two routes compose it
 * identically: `/onboarding/paywall` (a first-time shopper, from Ready's
 * `See my plan`) and the standalone `/paywall` (a lapsed subscriber).
 */
export function PaywallPanel({
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
  const slots = usePurchaseFooterSlots(purchase);
  const { fontScale } = useWindowDimensions();
  return (
    <OnboardingFrame
      headline={PAYWALL_HEADLINE}
      body={PAYWALL_BODY}
      back={{ label: PAYWALL_BACK_LABEL, hint: PAYWALL_BACK_HINT, onPress: onBack }}
      aside={fontScale < HIDE_MASCOT_AT_SCALE ? <WatchfulMascot /> : null}
      footer={slots.footer}>
      <BenefitChecks items={PAYWALL_BENEFITS} />
      <PurchasePlans purchase={purchase} />
      {children}
      <Text variant="caption" color="text/secondary">
        {INDEPENDENCE_NOTE}
      </Text>
      {slots.inlineTerms}
    </OnboardingFrame>
  );
}

/**
 * The onboarding paywall for a shopper who is ALREADY entitled (restored
 * elsewhere, or subscribed on another device) with onboarding unfinished:
 * never an actionable purchase — the plans, terms and store are left out,
 * the active subscription is said plainly, and `Continue` completes
 * personalization so the gate opens notification education.
 */
export function EntitledPaywallPanel({
  onBack,
  onContinue,
}: {
  onBack: () => void;
  onContinue: () => void;
}) {
  const { fontScale } = useWindowDimensions();
  return (
    <OnboardingFrame
      headline={PAYWALL_HEADLINE}
      body={PAYWALL_BODY}
      back={{ label: PAYWALL_BACK_LABEL, hint: PAYWALL_BACK_HINT, onPress: onBack }}
      aside={fontScale < HIDE_MASCOT_AT_SCALE ? <WatchfulMascot /> : null}
      footer={<Button label={CONTINUE_CTA} onPress={onContinue} />}>
      <PaywallNotice tone="success" kind="entitled">
        {EDUCATION_SUCCESS}
      </PaywallNotice>
      <BenefitChecks items={PAYWALL_BENEFITS} />
    </OnboardingFrame>
  );
}

/**
 * The three value propositions as check rows — the navy `check` treatment
 * the merged Ready step proved out (polish pass): a decorative 20pt
 * `icon/primary` check beside `body` text, no containing card, no dot
 * marks. The check is drawing; the sentence is what is spoken.
 */
function BenefitChecks({ items }: { items: readonly string[] }) {
  return (
    <View style={styles.benefits} accessibilityRole="list">
      {items.map((item) => (
        <View key={item} style={styles.benefit}>
          <View style={styles.benefitMark}>
            <Icon name="check" size={20} color="icon/primary" />
          </View>
          <Text variant="body" style={styles.benefitText}>
            {item}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * The watchful mascot, decorative and untouchable, with the onboarding
 * mascots' one shared entrance: a short fade and settle, played once, only
 * when Reduce Motion is known to be off; otherwise it is simply there.
 */
function WatchfulMascot() {
  const reduceMotion = useReduceMotion();
  const [animate] = useState(() => motionAllowed(reduceMotion));
  const [entrance] = useState(() => new Animated.Value(animate ? 0 : 1));
  useEffect(() => {
    if (!animate) return;
    const run = Animated.timing(entrance, {
      toValue: 1,
      delay: MASCOT_ENTRANCE.delay,
      duration: MASCOT_ENTRANCE.duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [animate, entrance]);
  return (
    <Animated.View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        opacity: entrance,
        transform: [
          {
            translateY: entrance.interpolate({
              inputRange: [0, 1],
              outputRange: [MASCOT_ENTRANCE.rise, 0],
            }),
          },
        ],
      }}>
      <Image
        source={MASCOT}
        style={{ width: MASCOT_SIZE, height: MASCOT_SIZE }}
        resizeMode="contain"
      />
    </Animated.View>
  );
}

/**
 * The two plans as a real radio group, or the one line that stands where
 * they would while the offering loads, is unavailable or errored.
 */
export function PurchasePlans({ purchase }: { purchase: PurchaseProps }) {
  const shown = paywallPresentation(purchase.view);
  return shown.plans ? (
    <ChoiceGroup label={PLAN_GROUP_LABEL}>
      {shown.plans.map((plan) => (
        <PlanCard
          key={plan.period}
          plan={plan}
          onPress={() => purchase.onSelectPlan(plan.period)}
        />
      ))}
    </ChoiceGroup>
  ) : (
    <Text
      variant="body-small"
      color="text/secondary"
      accessibilityLiveRegion="polite"
      style={styles.offeringMessage}>
      {shown.offeringMessage}
    </Text>
  );
}

/**
 * The last outcome's notice and the one primary action that names the
 * selected commitment with the store's price — the only thing either screen
 * ever pins.
 */
export function PurchaseCta({ purchase }: { purchase: PurchaseProps }) {
  const shown = paywallPresentation(purchase.view);
  return (
    <>
      {shown.notice ? (
        <PaywallNotice tone={shown.notice.tone} kind={shown.notice.kind}>
          {shown.notice.text}
        </PaywallNotice>
      ) : null}
      <Button
        label={shown.cta.label}
        disabled={!shown.cta.enabled}
        busy={shown.cta.busy}
        busyLabel={shown.cta.busyLabel}
        onPress={purchase.onSubscribe}
      />
    </>
  );
}

/**
 * The renewal disclosure, the four footer actions and the
 * unconfigured-destination notice: one block, always present before a
 * purchase, wherever the screen puts it.
 */
export function PurchaseTerms({ purchase }: { purchase: PurchaseProps }) {
  const shown = paywallPresentation(purchase.view);
  const { onFooterAction, destinationNotice } = purchase;
  return (
    <View style={styles.terms}>
      <Text variant="caption" color="text/secondary" style={styles.disclosure}>
        {PAYWALL_DISCLOSURE}
      </Text>
      <View style={styles.footerActions} accessibilityRole="toolbar">
        {shown.footer.map((action) => {
          const restore = action.key === 'restore';
          const busy = restore && shown.restore.busy;
          const inert = restore ? !shown.restore.enabled : false;
          return (
            <Pressable
              key={action.key}
              accessibilityRole="button"
              accessibilityState={{ disabled: inert, busy }}
              disabled={inert}
              hitSlop={FOOTER_HIT_SLOP}
              onPress={() => onFooterAction(action.key)}>
              {({ pressed }) => (
                <Text
                  variant="caption"
                  color={inert ? 'text/secondary' : 'action/secondary'}
                  style={pressed && styles.pressed}>
                  {busy ? shown.restore.busyLabel : action.label}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>
      {destinationNotice ? (
        <Text
          variant="caption"
          color="text/secondary"
          style={styles.disclosure}
          accessibilityLiveRegion="polite">
          {destinationNotice}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The standalone paywall's footer placement. The sticky footer always holds
 * the CTA; the terms join it at ordinary text sizes, and from the
 * accessibility sizes they are handed back as `inlineTerms` for the end of
 * the scrolling content, directly above the primary action
 * (`paywallFooterPlacement`), because pinned they would take the whole
 * screen and leave the plans unreachable. The reader's text scale is read
 * through `useWindowDimensions`, so a change to the setting moves them
 * rather than the next cold launch. The block is drawn in exactly one of
 * the two slots. (The Ready step does not use the slots: its terms are
 * always scroll content and its CTA pins itself by scroll position.)
 */
export function usePurchaseFooterSlots(purchase: PurchaseProps): {
  footer: ReactNode;
  inlineTerms: ReactNode;
} {
  const { fontScale } = useWindowDimensions();
  const placement = paywallFooterPlacement(fontScale);
  const terms = <PurchaseTerms purchase={purchase} />;
  return {
    footer: (
      <>
        <PurchaseCta purchase={purchase} />
        {placement === 'sticky' ? terms : null}
      </>
    ),
    inlineTerms: placement === 'inline' ? terms : null,
  };
}

/**
 * One plan: a Choice Row grown into a card. The ring and the border carry
 * the selection with the announced state; the price is the store's.
 */
export function PlanCard({ plan, onPress }: { plan: PlanCardPresentation; onPress: () => void }) {
  // The value badge sits ON the card's corner at ordinary sizes; from the
  // accessibility sizes it returns to the title row, where wrapping text
  // can never run underneath it.
  const { fontScale } = useWindowDimensions();
  const cornerBadge = plan.badge !== null && fontScale < HIDE_MASCOT_AT_SCALE;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={plan.accessibilityLabel}
      accessibilityState={{ checked: plan.selected, selected: plan.selected }}
      onPress={onPress}>
      {({ pressed }) => (
        <Surface
          radius={12}
          border="border/default"
          style={[styles.plan, plan.selected && styles.planSelected, pressed && styles.pressed]}>
          <View style={[styles.ring, plan.selected && styles.ringSelected]}>
            {plan.selected ? <View style={styles.dot} /> : null}
          </View>
          <View style={styles.planBody}>
            <View style={styles.planTitleRow}>
              <Text variant="body-small-bold" style={styles.planTitle}>
                {plan.title}
              </Text>
              {plan.badge && !cornerBadge ? (
                // The plan's own accessibilityLabel already says Best
                // value; the drawn badge is decoration either way.
                <View style={styles.badge} {...BADGE_DECORATIVE}>
                  <Text variant="label">{plan.badge}</Text>
                </View>
              ) : null}
            </View>
            <Text variant="heading-3">{plan.priceLine}</Text>
            {/* The equivalent and the saving share one compact line, and
                wrap naturally between words at larger text sizes. */}
            {plan.equivalentLine || plan.savings ? (
              <Text variant="caption" color="text/secondary">
                {[plan.equivalentLine, plan.savings]
                  .filter((part): part is string => part !== null)
                  .join(' · ')}
              </Text>
            ) : null}
          </View>
          {cornerBadge ? (
            // Flush with the card's top trailing corner: part of the card,
            // never a chip floating beside the title.
            <View style={[styles.badge, styles.badgeCorner]} {...BADGE_DECORATIVE}>
              <Text variant="label">{plan.badge}</Text>
            </View>
          ) : null}
        </Surface>
      )}
    </Pressable>
  );
}

/**
 * The badge is drawing: the radio's own accessibilityLabel (from
 * `paywallPresentation`) already speaks `Best value`, so a second element
 * would say it twice.
 */
const BADGE_DECORATIVE = {
  accessible: false,
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
} as const;

/** The last outcome, on the surface its tone asks for. */
export function PaywallNotice({
  tone,
  kind,
  children,
}: {
  tone: PaywallNoticeTone;
  kind: string;
  children: string;
}) {
  if (tone === 'calm') return <Callout tone="information">{children}</Callout>;
  if (tone === 'success') {
    return (
      <Surface
        background="background/accent"
        radius={8}
        accessible
        accessibilityRole="text"
        accessibilityLiveRegion="polite"
        style={styles.success}>
        <Text variant="body-small">{children}</Text>
      </Surface>
    );
  }
  return (
    <Surface
      radius={8}
      border="border/strong"
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID={`paywall-notice-${kind}`}
      style={styles.alert}>
      <Text variant="body-small">{children}</Text>
    </Surface>
  );
}

const styles = StyleSheet.create({
  // The check rows sit tight: they bridge the heading to the plans.
  benefits: {
    gap: spacing[8],
  },
  benefit: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[12],
  },
  // Centred on the first line of body text at the default size.
  benefitMark: {
    marginTop: 2,
  },
  benefitText: {
    flex: 1,
  },
  plan: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[12],
    padding: spacing[16],
  },
  // The chosen plan reads chosen at a glance: the primary border grown to
  // 2px, the padding giving the pixel back so nothing reflows.
  planSelected: {
    borderColor: color['action/primary'],
    borderWidth: 2,
    padding: spacing[16] - 1,
  },
  ring: {
    width: iconSize[20],
    height: iconSize[20],
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: color['border/strong'],
    alignItems: 'center',
    justifyContent: 'center',
    // Level with the first line of the card's text at any type size.
    marginTop: 2,
  },
  ringSelected: {
    borderColor: color['action/primary'],
  },
  dot: {
    width: iconSize[12],
    height: iconSize[12],
    borderRadius: radius.full,
    backgroundColor: color['action/primary'],
  },
  planBody: {
    flex: 1,
    gap: spacing[4],
  },
  planTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing[8],
  },
  planTitle: {
    flexShrink: 1,
  },
  // The value badge: the compact-label geometry on the lime value surface.
  badge: {
    minHeight: layout.riskLabelHeight,
    justifyContent: 'center',
    paddingHorizontal: spacing[8],
    paddingVertical: spacing[4],
    borderRadius: radius[4],
    borderWidth: 1,
    backgroundColor: color['background/accent'],
    borderColor: color['action/accent'],
  },
  // On the corner it is a TAB of the card: flush with the top trailing
  // edge, squared where it meets the card's own corner radius, and inset
  // -1 so its border sits on the card's.
  badgeCorner: {
    position: 'absolute',
    top: -1,
    right: -1,
    borderTopLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderTopRightRadius: radius[12],
    borderBottomLeftRadius: radius[12],
  },
  offeringMessage: {
    paddingVertical: spacing[16],
    textAlign: 'center',
  },
  disclosure: {
    textAlign: 'center',
  },
  // The terms keep the footer's own rhythm wherever they sit.
  terms: {
    gap: spacing[8],
  },
  footerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    columnGap: spacing[24],
    rowGap: spacing[12],
    paddingVertical: spacing[8],
  },
  success: {
    padding: spacing[12],
  },
  alert: {
    padding: spacing[12],
  },
  pressed: {
    opacity: 0.6,
  },
});
