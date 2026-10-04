/**
 * The one-page Edit preferences' allergen chooser (2026-09-30): the
 * Allergens step's own grid (`AllergenGrid` — the nine canonical allergens,
 * the count line and `Clear selection`) in a sheet over the editor. Both of
 * the editor's allergen actions, `Edit` and `Add allergens`, open it.
 *
 * ## The search sheets' pattern
 *
 * React Native's own transparent `Modal` (no dependency) drawing a backdrop
 * and a sheet, exactly as the States and Stores choosers do
 * (state-search-sheet.tsx, retailer-search-sheet.tsx): the same backdrop at
 * `SHEET_BACKDROP_OPACITY`, the same slide over `SHEET_MOTION`, simply there
 * and simply gone under Reduce Motion or while that setting is unknown, and
 * the same top edge just under the status bar. The editor behind is never
 * moved and, under the modal, takes no touch and is hidden from assistive
 * technology.
 *
 * ## The editor's draft, nothing else
 *
 * The grid is controlled: every tile and `Clear selection` goes straight to
 * the editor's `onToggle` / `onClear`, which change the editor's DRAFT and
 * save nothing. `Close`, `Done`, the backdrop and Android's back all do one
 * thing: close, keeping the draft. When the sheet has gone the editor
 * returns focus to the action that opened it.
 */

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

import { AllergenGrid } from '@/components/onboarding/allergens-step';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { color, hitTarget, layout, radius, spacing } from '@/constants/design-tokens';
import { useSheetMotion } from '@/hooks/use-sheet-motion';
import {
  ALLERGENS_CHOOSER_TITLE,
  SEARCH_CLOSE_LABEL,
  SEARCH_DISMISS_HINT,
  SEARCH_DONE_LABEL,
} from '@/lib/onboarding-copy';
import { SHEET_BACKDROP_OPACITY } from '@/lib/retailer-grid';
import { chooserTop } from '@/lib/states-presentation';

export function AllergenChooserSheet({
  visible,
  selected,
  onToggle,
  onClear,
  onClose,
  onClosed,
}: {
  visible: boolean;
  /** The editor's draft: what is checked. */
  selected: readonly string[];
  onToggle: (token: string) => void;
  onClear: () => void;
  /** Every way out: Close, Done, the backdrop, Android's back. */
  onClose: () => void;
  /** After the sheet is gone: the editor returns focus to the opening action. */
  onClosed?: () => void;
}) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const top = chooserTop(insets.top);

  // The one motion rule the three sheets share (hooks/use-sheet-motion.ts):
  // the opening slide starts when the Modal has presented its view, the
  // closing one at once, and Reduce Motion is immediate both ways.
  const { shown, progress, onShow, onDismiss } = useSheetMotion(visible);

  return (
    <Modal
      visible={shown}
      transparent
      animationType="none"
      onRequestClose={onClose}
      onShow={onShow}
      onDismiss={() => {
        onDismiss();
        onClosed?.();
      }}
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
        {/* A tap on the dimmed editor closes the chooser. Close says the
            same to assistive technology, which never reaches the backdrop. */}
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
              top,
              transform: [
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [height - top, 0],
                  }),
                },
              ],
            },
          ]}>
          {shown ? (
            <View style={styles.contents}>
              <View
                style={styles.handle}
                accessible={false}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              />
              <View style={styles.header}>
                {/* One element in a 44pt box level with Close's, so VoiceOver
                    reads the title first (iOS orders by top edge). */}
                <View accessible accessibilityRole="header" style={styles.title}>
                  <Text variant="heading-3">{ALLERGENS_CHOOSER_TITLE}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={SEARCH_CLOSE_LABEL}
                  accessibilityHint={SEARCH_DISMISS_HINT}
                  onPress={onClose}
                  style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
                  <Icon name="x" size={20} color="icon/primary" />
                </Pressable>
              </View>
              <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
                <AllergenGrid selected={selected} onToggle={onToggle} onClear={onClear} />
              </ScrollView>
              <View style={[styles.footer, { paddingBottom: insets.bottom + spacing[12] }]}>
                <Button
                  label={SEARCH_DONE_LABEL}
                  accessibilityHint={SEARCH_DISMISS_HINT}
                  onPress={onClose}
                />
              </View>
            </View>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: color['text/primary'],
  },
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
    flex: 1,
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
  },
  handle: {
    alignSelf: 'center',
    width: spacing[32] + spacing[4],
    height: spacing[4] + 1,
    marginTop: spacing[8],
    borderRadius: radius.full,
    backgroundColor: color['border/default'],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[8],
    paddingLeft: layout.pageMargin,
    paddingRight: layout.pageMargin - spacing[12],
    minHeight: hitTarget.minimum,
    marginTop: spacing[4],
  },
  title: {
    flex: 1,
    minHeight: hitTarget.minimum,
    justifyContent: 'center',
  },
  close: {
    minWidth: hitTarget.minimum,
    minHeight: hitTarget.minimum,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: layout.pageMargin,
    paddingTop: spacing[8],
    paddingBottom: spacing[16],
  },
  footer: {
    paddingHorizontal: layout.pageMargin,
    paddingTop: spacing[12],
    borderTopWidth: 1,
    borderTopColor: color['border/subtle'],
  },
  pressed: {
    opacity: 0.6,
  },
});
