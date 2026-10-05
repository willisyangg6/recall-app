/**
 * The shared purchase pieces (P2B7X.1; shared since 2026-09-27), drawn from
 * the tokens and the shared primitives, with every state handed in.
 *
 * ## Pieces, and the one composition
 *
 * Four pieces, all drawn from ONE `PurchaseProps` (the shape `usePurchaseFlow`
 * owns):
 *
 *   PurchaseCta     the last outcome's notice and the one primary action
 *                   that names the selected commitment with the store price
 *   PurchaseTerms   the renewal disclosure and the four footer actions
 *                   (Restore Purchases, Terms, Privacy, Support) as text
 *                   buttons at the 44pt target, always present
 *   usePurchaseFooterSlots
 *                   the paywall's placement rule: the CTA is sticky, and the
 *                   terms join it there at ordinary text sizes or move
 *                   inline from the accessibility sizes
 *   PaywallNotice   an outcome on the surface its tone asks for; also the
 *                   notification education's
 *
 * One composition draws them, `OnboardingPaywallPanel`
 * (onboarding-paywall-panel.tsx): the founder-approved grocery-watch paywall,
 * which since 2026-10-04 is BOTH paywall routes — `/onboarding/paywall`
 * from Ready's `See my plan`, and the standalone `/paywall` a lapsed
 * subscriber meets. The routes differ only in the wiring they hand it
 * (Back, and what the gate does after a success); the panel, the plan
 * cards, the CTA in its `onboarding` appearance and the terms are one
 * implementation. The earlier standalone composition (`PaywallPanel`: the
 * frame, M04 beside the heading, check-row benefits, the corner `BEST
 * VALUE` tab) was retired that day so an expired subscriber meets the same
 * approved design as a first-time one.
 *
 * None holds purchase state, and none duplicates a handler.
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
 * could-not-confirm state when the gate failed closed.
 */

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { color, hitSlopToMinimum, radius, spacing, typography } from '@/constants/design-tokens';
import type { PlanPeriod } from '@/lib/entitlement';
import { CTA_MIN_HEIGHT, PAYWALL_TYPE } from '@/lib/onboarding-paywall-presentation';
import {
  PAYWALL_DISCLOSURE,
  paywallFooterPlacement,
  paywallPresentation,
  type PaywallFooterActionKey,
  type PaywallNoticeTone,
  type PaywallView,
} from '@/lib/paywall-screen';

/** A one-caption-line footer action reaches the 44pt target through hitSlop. */
const FOOTER_HIT_SLOP = hitSlopToMinimum(typography.caption.lineHeight);

/**
 * Everything the shared purchase pieces draw, with their handlers — the
 * shape `usePurchaseFlow` (hooks/use-purchase-flow.tsx) hands out, so both
 * paywall routes draw the SAME state.
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
 * How the shared purchase pieces are drawn. `onboarding` is the grocery-watch
 * paywall's 51pt pill, which both routes use; `standard` keeps the shared
 * Button for any future surface. The state, the words and the handlers are
 * the same in both.
 */
export type PurchaseAppearance = 'standard' | 'onboarding';

/**
 * The last outcome's notice and the one primary action that names the
 * selected commitment with the store's price — the only thing the screen
 * ever pins.
 */
export function PurchaseCta({
  purchase,
  appearance = 'standard',
}: {
  purchase: PurchaseProps;
  appearance?: PurchaseAppearance;
}) {
  const shown = paywallPresentation(purchase.view);
  const action = {
    label: shown.cta.label,
    disabled: !shown.cta.enabled,
    busy: shown.cta.busy,
    busyLabel: shown.cta.busyLabel,
    onPress: purchase.onSubscribe,
  };
  return (
    <>
      {shown.notice ? (
        <PaywallNotice tone={shown.notice.tone} kind={shown.notice.kind}>
          {shown.notice.text}
        </PaywallNotice>
      ) : null}
      {appearance === 'onboarding' ? <OnboardingActionPill {...action} /> : <Button {...action} />}
    </>
  );
}

/**
 * The onboarding's 51pt pill: the shared Button's primary treatment — its
 * fill and disabled fill, label colours, face, pressed opacity, role,
 * disabled and busy state, and its busy word — at the States and Stores
 * height with Ready's 16pt purchase-path label. The shared Button itself has
 * no size override and is unchanged. The paywall's purchase action and the
 * entitled `Continue`.
 */
export function OnboardingActionPill({
  label,
  onPress,
  disabled = false,
  busy = false,
  busyLabel,
  accessibilityHint,
  labelType = null,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  busyLabel?: string;
  /** Spoken after the label: what pressing will do, when that needs saying. */
  accessibilityHint?: string;
  /** A screen's adaptive label base at large text sizes; the pill's own type otherwise. */
  labelType?: { fontSize: number; lineHeight: number } | null;
}) {
  const inert = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inert, busy }}
      disabled={inert}
      onPress={onPress}>
      {({ pressed }) => (
        <View style={[styles.pill, inert && styles.pillInert, pressed && styles.pressed]}>
          <Text
            variant="body-small-bold"
            color={inert ? 'text/primary' : 'text/inverse'}
            style={[styles.pillLabel, labelType]}>
            {busy && busyLabel !== undefined ? busyLabel : label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

/**
 * The renewal disclosure, the four footer actions and the
 * unconfigured-destination notice: one block, always present before a
 * purchase, wherever the screen puts it.
 */
export function PurchaseTerms({
  purchase,
  disclosure = PAYWALL_DISCLOSURE,
}: {
  purchase: PurchaseProps;
  /** The renewal sentence; the period-neutral one by default. */
  disclosure?: string;
}) {
  const shown = paywallPresentation(purchase.view);
  const { onFooterAction, destinationNotice } = purchase;
  return (
    <View style={styles.terms}>
      <Text variant="caption" color="text/secondary" style={styles.disclosure}>
        {disclosure}
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
 * The paywall's footer placement. The sticky footer always holds the CTA;
 * the terms join it at ordinary text sizes, and from the accessibility sizes
 * they are handed back as `inlineTerms` for the end of the scrolling
 * content, directly above the primary action (`paywallFooterPlacement`),
 * because pinned they would take the whole screen and leave the plans
 * unreachable. The reader's text scale is read through
 * `useWindowDimensions`, so a change to the setting moves them rather than
 * the next cold launch. The block is drawn in exactly one of the two slots.
 * (The Ready step does not use the slots: its terms are always scroll
 * content and its CTA pins itself by scroll position.)
 */
export function usePurchaseFooterSlots(
  purchase: PurchaseProps,
  options: { appearance?: PurchaseAppearance; disclosure?: string } = {},
): {
  footer: ReactNode;
  inlineTerms: ReactNode;
} {
  const { fontScale } = useWindowDimensions();
  const placement = paywallFooterPlacement(fontScale);
  const terms = <PurchaseTerms purchase={purchase} disclosure={options.disclosure} />;
  return {
    footer: (
      <>
        <PurchaseCta purchase={purchase} appearance={options.appearance} />
        {placement === 'sticky' ? terms : null}
      </>
    ),
    inlineTerms: placement === 'inline' ? terms : null,
  };
}

/** The last outcome, on the surface its tone asks for. */
export function PaywallNotice({
  tone,
  kind,
  children,
  live = true,
}: {
  tone: PaywallNoticeTone;
  kind: string;
  children: string;
  /**
   * False when the screen announces the outcome itself
   * (`AccessibilityInfo.announceForAccessibility`), so a platform that
   * honours live regions does not say it a second time.
   */
  live?: boolean;
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
      accessibilityLiveRegion={live ? 'polite' : undefined}
      testID={`paywall-notice-${kind}`}
      style={styles.alert}>
      <Text variant="body-small">{children}</Text>
    </Surface>
  );
}

const styles = StyleSheet.create({
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
  // The onboarding pill (see OnboardingActionPill): the shared Button's
  // primary pill (components/ui/button.tsx) at 51pt.
  pill: {
    minHeight: CTA_MIN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[8],
    borderRadius: radius.full,
    backgroundColor: color['action/primary'],
  },
  pillInert: {
    backgroundColor: color['action/disabled'],
  },
  pillLabel: {
    ...PAYWALL_TYPE.cta,
    textAlign: 'center',
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
