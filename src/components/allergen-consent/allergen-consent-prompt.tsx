/**
 * The onboarding Allergens step's consent prompt (founder choice,
 * 2026-10-13): a compact bottom sheet after Continue, when allergens are
 * chosen and no decision is recorded. The same transparent-Modal sheet as
 * the consent sheet and the choosers (backdrop, slide, close control,
 * page colour, 16pt top corners), but anchored to the bottom and sized to
 * its content; at large text it stops below the top inset and scrolls.
 *
 * - **Enable allergen alerts** (primary) and **Continue without allergen
 *   alerts** (secondary) each record the decision, under this prompt's own
 *   disclosure version; the route then goes on to Stores.
 * - When allergens are the shopper's only alert choice, the no-alerts
 *   consequence of declining is said on the question itself.
 * - Close, the backdrop or Android back records nothing and returns to the
 *   step.
 * - **How your data is used** swaps the sheet's content for the full
 *   disclosure, with Back to the question. It is one sheet, never a second
 *   modal, so the step underneath — and every selection — stays as it was.
 *
 * No illustration, toggle or checkbox.
 */

import { useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { color, hitTarget, layout, radius, spacing } from '@/constants/design-tokens';
import { useSheetMotion } from '@/hooks/use-sheet-motion';
import {
  CONSENT_ONLY_CHOICE_NOTE,
  PROMPT_BODY,
  PROMPT_DECLINE_LABEL,
  PROMPT_DETAILS_BACK_HINT,
  PROMPT_DETAILS_HINT,
  PROMPT_DETAILS_LINK,
  PROMPT_DETAILS_PARAGRAPHS,
  PROMPT_ENABLE_LABEL,
  PROMPT_TITLE,
} from '@/lib/allergen-consent';
import { BACK_LABEL, SEARCH_CLOSE_LABEL } from '@/lib/onboarding-copy';
import { SHEET_BACKDROP_OPACITY } from '@/lib/retailer-grid';
import { chooserTop } from '@/lib/states-presentation';

export function AllergenConsentPrompt({
  visible,
  onlyChoice,
  busy,
  onEnable,
  onDecline,
  onClose,
}: {
  visible: boolean;
  /** Allergens are the shopper's only alert choice: say, on the question itself, what declining means. */
  onlyChoice: boolean;
  busy: boolean;
  onEnable: () => void;
  onDecline: () => void;
  /** Close, the backdrop or Android back: no decision. */
  onClose: () => void;
}) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { shown, progress, onShow, onDismiss } = useSheetMotion(visible);
  // The details view lasts until the sheet closes; it always reopens on the question.
  const [details, setDetails] = useState(false);
  const [wasShown, setWasShown] = useState(shown);
  if (shown !== wasShown) {
    setWasShown(shown);
    if (!shown) setDetails(false);
  }

  return (
    <Modal
      visible={shown}
      transparent
      animationType="none"
      onRequestClose={details ? () => setDetails(false) : onClose}
      onShow={onShow}
      onDismiss={onDismiss}
      statusBarTranslucent>
      <View style={styles.root}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.backdrop,
            {
              opacity: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0, SHEET_BACKDROP_OPACITY],
              }),
            },
          ]}
        />
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessible={false}
          importantForAccessibility="no"
        />
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              maxHeight: height - chooserTop(insets.top),
              transform: [
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [height, 0],
                  }),
                },
              ],
            },
          ]}>
          {shown ? (
            <View style={styles.contents}>
              <View style={[styles.header, details && styles.headerWithBack]}>
                {details ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={BACK_LABEL}
                    accessibilityHint={PROMPT_DETAILS_BACK_HINT}
                    onPress={() => setDetails(false)}
                    style={({ pressed }) => [styles.control, pressed && styles.pressed]}>
                    <Icon name="chevron-left" size={24} color="icon/primary" />
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={SEARCH_CLOSE_LABEL}
                  onPress={onClose}
                  style={({ pressed }) => [styles.control, pressed && styles.pressed]}>
                  <Icon name="x" size={20} color="icon/primary" />
                </Pressable>
              </View>
              <ScrollView
                style={styles.body}
                contentContainerStyle={[
                  styles.bodyContent,
                  { paddingBottom: insets.bottom + spacing[16] },
                ]}>
                {details ? (
                  <>
                    <Text variant="heading-3" accessibilityRole="header">
                      {PROMPT_DETAILS_LINK}
                    </Text>
                    {PROMPT_DETAILS_PARAGRAPHS.map((paragraph) => (
                      <Text key={paragraph} variant="body-small">
                        {paragraph}
                      </Text>
                    ))}
                    {onlyChoice ? (
                      <Text variant="body-small-bold">{CONSENT_ONLY_CHOICE_NOTE}</Text>
                    ) : null}
                  </>
                ) : (
                  <>
                    <Text variant="heading-3" accessibilityRole="header">
                      {PROMPT_TITLE}
                    </Text>
                    <Text variant="body-small" color="text/secondary">
                      {PROMPT_BODY}
                    </Text>
                    {onlyChoice ? (
                      <Text variant="body-small-bold">{CONSENT_ONLY_CHOICE_NOTE}</Text>
                    ) : null}
                    <View style={styles.actions}>
                      <Button label={PROMPT_ENABLE_LABEL} disabled={busy} onPress={onEnable} />
                      <Button
                        variant="secondary"
                        label={PROMPT_DECLINE_LABEL}
                        disabled={busy}
                        onPress={onDecline}
                      />
                    </View>
                    <Pressable
                      accessibilityRole="link"
                      accessibilityLabel={PROMPT_DETAILS_LINK}
                      accessibilityHint={PROMPT_DETAILS_HINT}
                      onPress={() => setDetails(true)}
                      style={styles.link}>
                      {({ pressed }) => (
                        <Text
                          variant="body-small-bold"
                          color="action/secondary"
                          style={pressed && styles.pressed}>
                          {PROMPT_DETAILS_LINK}
                        </Text>
                      )}
                    </Pressable>
                  </>
                )}
              </ScrollView>
            </View>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: color['text/primary'],
  },
  // Anchored to the bottom and sized to its content, up to the chooser top.
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: color['background/page'],
    borderTopLeftRadius: radius[16],
    borderTopRightRadius: radius[16],
  },
  contents: {
    flexShrink: 1,
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: layout.pageMargin - spacing[8],
    paddingTop: spacing[8],
  },
  headerWithBack: {
    justifyContent: 'space-between',
  },
  control: {
    width: hitTarget.minimum,
    height: hitTarget.minimum,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
  // Grows to its content; shrinks and scrolls only when the sheet is at its cap.
  body: { flexGrow: 0, flexShrink: 1 },
  bodyContent: {
    paddingHorizontal: layout.pageMargin,
    gap: spacing[12],
  },
  actions: {
    gap: spacing[12],
    marginTop: spacing[4],
  },
  link: {
    minHeight: hitTarget.minimum,
    justifyContent: 'center',
    alignSelf: 'center',
  },
});
