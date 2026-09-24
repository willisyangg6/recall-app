/**
 * The hard paywall's appearance (P2B7X.1), drawn from the tokens and the
 * shared primitives, with every state handed in.
 *
 * ## Composition
 *
 * The onboarding frame without progress: the back control (to the
 * Preview), the headline and body, the three benefits, the two plan cards
 * as a real radio group (Annual first and preselected, `BEST VALUE` on the
 * lime value surface, the store-derived monthly equivalent and saving), and
 * whatever the route adds beneath (its development controls). The sticky
 * footer holds the notice for the last outcome, the one primary action that
 * names the selected commitment with the store's price, the renewal
 * disclosure, and the four footer actions — Restore Purchases, Terms,
 * Privacy, Support — as text buttons at the 44pt target, always present.
 *
 * At the accessibility text sizes the disclosure and the four actions leave
 * the sticky footer for the end of the scrolling content, directly above
 * the primary action (`paywallFooterPlacement`): pinned, they would take
 * the whole screen and leave the plans unreachable. The reader's text
 * scale is read through `useWindowDimensions`, so a change to the setting
 * moves them rather than the next cold launch.
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

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { OnboardingFrame } from '@/components/onboarding/onboarding-frame';
import { BenefitList } from '@/components/onboarding/welcome-content';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
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
import {
  BEST_VALUE_ACCESSIBILITY_LABEL,
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

export function PaywallPanel({
  view,
  onSelectPlan,
  onSubscribe,
  onFooterAction,
  onBack,
  destinationNotice = null,
  children,
}: {
  view: PaywallView;
  onSelectPlan: (period: PlanPeriod) => void;
  onSubscribe: () => void;
  /** Restore, Terms, Privacy, Support — the route decides what each does. */
  onFooterAction: (key: PaywallFooterActionKey) => void;
  /** The one way back: to the Personalized Preview. */
  onBack: () => void;
  /** A footer destination with no configured URL was pressed. */
  destinationNotice?: string | null;
  /** Rendered beneath the plans (the route's development controls). */
  children?: ReactNode;
}) {
  const shown = paywallPresentation(view);
  const { fontScale } = useWindowDimensions();
  const placement = paywallFooterPlacement(fontScale);
  // The disclosure, the toolbar and the destination notice: one block, in
  // the sticky footer or at the end of the content by the reader's text scale.
  const terms = (
    <>
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
    </>
  );
  return (
    <OnboardingFrame
      headline={PAYWALL_HEADLINE}
      body={PAYWALL_BODY}
      back={{ label: PAYWALL_BACK_LABEL, hint: PAYWALL_BACK_HINT, onPress: onBack }}
      footer={
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
            onPress={onSubscribe}
          />
          {placement === 'sticky' ? terms : null}
        </>
      }>
      <BenefitList items={PAYWALL_BENEFITS} />
      {shown.plans ? (
        <ChoiceGroup label={PLAN_GROUP_LABEL}>
          {shown.plans.map((plan) => (
            <PlanCard key={plan.period} plan={plan} onPress={() => onSelectPlan(plan.period)} />
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
      )}
      {children}
      {placement === 'inline' ? <View style={styles.inlineTerms}>{terms}</View> : null}
    </OnboardingFrame>
  );
}

/**
 * One plan: a Choice Row grown into a card. The ring and the border carry
 * the selection with the announced state; the price is the store's.
 */
export function PlanCard({ plan, onPress }: { plan: PlanCardPresentation; onPress: () => void }) {
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
              {plan.badge ? (
                <View
                  style={styles.badge}
                  accessible
                  accessibilityRole="text"
                  accessibilityLabel={BEST_VALUE_ACCESSIBILITY_LABEL}>
                  <Text variant="label">{plan.badge}</Text>
                </View>
              ) : null}
            </View>
            <Text variant="heading-3">{plan.priceLine}</Text>
            {plan.equivalentLine ? (
              <Text variant="caption" color="text/secondary">
                {plan.equivalentLine}
              </Text>
            ) : null}
            {plan.savings ? (
              <Text variant="caption" color="text/secondary">
                {plan.savings}
              </Text>
            ) : null}
          </View>
        </Surface>
      )}
    </Pressable>
  );
}

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
  plan: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[12],
    padding: spacing[16],
  },
  planSelected: {
    borderColor: color['action/primary'],
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
  offeringMessage: {
    paddingVertical: spacing[16],
    textAlign: 'center',
  },
  disclosure: {
    textAlign: 'center',
  },
  // The terms block at the end of the content keeps the footer's own rhythm.
  inlineTerms: {
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
