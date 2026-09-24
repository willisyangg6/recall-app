/**
 * The onboarding frame (P2B7X.1): the page every first-launch screen and
 * the paywall sit in, so the seven screens share one chrome.
 *
 * ## Composition
 *
 * The warm page, safe-area correct. A top bar with the back control (the
 * `chevron-left` glyph, a full 44pt target, absent on Welcome) and, for a
 * counted step, the four-segment progress over its `1 of 4` line in the mono
 * `label` type (`OnboardingProgress`; P2B7Y). Then the
 * scrolling content: the headline in `heading-1`, the body in `body`
 * secondary, and whatever the screen adds — at the page margin, capped at
 * the content width, with the bottom padding the sticky footer needs so the
 * last row is never hidden under it. The footer holds the screen's actions
 * on the page colour above a hairline, pinned to the bottom over the bottom
 * inset, and lifts with the keyboard on iOS so a search field never buries
 * the Continue action.
 *
 * ## What never moves
 *
 * The frame allocates no space conditionally around the content: the top
 * bar keeps its height whether or not a back control renders, and the
 * footer is a fixed element. Selecting or clearing rows changes what a row
 * shows and nothing above the list; the count line each step renders is
 * always present (words, not colour, carry the count), so the list cannot
 * shift under a finger (the P2B7V rule, carried into onboarding).
 *
 * No height is fixed around scaled text; no `maxFontSizeMultiplier`; the
 * back control and every action are 44pt or taller.
 */

import type { ReactNode } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OnboardingProgress } from '@/components/onboarding/onboarding-progress';
import { Icon } from '@/components/ui/icon';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { color, hitTarget, layout, spacing } from '@/constants/design-tokens';
import type { StepProgress } from '@/lib/onboarding-state';

export function OnboardingFrame({
  headline,
  body,
  lead,
  progress = null,
  back = null,
  children,
  footer,
  scrollRef,
  keyboard = false,
  headlineAccessibilityLabel,
  headingMotion,
}: {
  headline: string;
  body: string;
  /** Rendered above the headline: Welcome's wordmark. */
  lead?: ReactNode;
  /** The counted step this is; null for Welcome and the paywall. */
  progress?: StepProgress | null;
  /** The back control, or null when there is no way back. */
  back?: { label: string; hint: string; onPress: () => void } | null;
  children: ReactNode;
  /** The sticky actions. */
  footer: ReactNode;
  scrollRef?: React.Ref<ScrollView>;
  /** The screen holds a text field: lift the footer over the keyboard. */
  keyboard?: boolean;
  headlineAccessibilityLabel?: string;
  /** Welcome's entrance: an animated opacity/offset for the headline block. */
  headingMotion?: Animated.WithAnimatedValue<StyleProp<ViewStyle>>;
}) {
  const insets = useSafeAreaInsets();
  const content = (
    <>
      <View style={[styles.topBar, { paddingTop: insets.top + spacing[8] }]}>
        <View style={styles.backSlot}>
          {back ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={back.label}
              accessibilityHint={back.hint}
              onPress={back.onPress}
              style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
              <Icon name="chevron-left" size={24} color="icon/primary" />
            </Pressable>
          ) : null}
        </View>
        {progress ? (
          <View style={styles.progress}>
            <OnboardingProgress progress={progress} />
          </View>
        ) : null}
      </View>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={keyboard ? 'on-drag' : 'none'}>
        {lead}
        <Animated.View style={[styles.heading, headingMotion]}>
          <Text
            variant="heading-1"
            accessibilityRole="header"
            accessibilityLabel={headlineAccessibilityLabel}>
            {headline}
          </Text>
          <Text variant="body" color="text/secondary">
            {body}
          </Text>
        </Animated.View>
        {children}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing[12] }]}>{footer}</View>
    </>
  );

  return (
    <Surface background="background/page" style={styles.page}>
      {keyboard && Platform.OS === 'ios' ? (
        <KeyboardAvoidingView behavior="padding" style={styles.page}>
          {content}
        </KeyboardAvoidingView>
      ) : (
        content
      )}
    </Surface>
  );
}

/**
 * The permanently allocated count line above a selector (P2B7V): always
 * rendered, so choosing or clearing never moves the rows beneath it.
 */
export function SelectionCount({ text }: { text: string }) {
  return (
    <Text variant="body-small" color="text/secondary" accessibilityLiveRegion="polite">
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  // The bar keeps the back slot's height whether or not a control renders.
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[8],
    minHeight: hitTarget.minimum,
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  backSlot: {
    minWidth: hitTarget.minimum,
    minHeight: hitTarget.minimum,
    justifyContent: 'center',
  },
  // The bar's own padding plus this lands the progress on the page margin.
  progress: {
    paddingRight: layout.pageMargin - spacing[8],
  },
  back: {
    minWidth: hitTarget.minimum,
    minHeight: hitTarget.minimum,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
    width: '100%',
  },
  content: {
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: layout.pageMargin,
    paddingTop: spacing[8],
    paddingBottom: spacing[24],
    gap: spacing[16],
    // At least the scroll view's height, so a screen can place a block in the
    // leftover space (Welcome centres its example there); children still stack
    // from the top, so a screen that does not ask looks exactly as before.
    flexGrow: 1,
  },
  heading: {
    gap: spacing[8],
  },
  footer: {
    width: '100%',
    paddingHorizontal: layout.pageMargin,
    paddingTop: spacing[12],
    gap: spacing[8],
    borderTopWidth: 1,
    borderTopColor: color['border/subtle'],
    backgroundColor: color['background/page'],
  },
  pressed: {
    opacity: 0.6,
  },
});
