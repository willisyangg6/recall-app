/**
 * The selector sheet (P2B6A follow-up): the dedicated surface a preference
 * list opens on. A native page sheet from React Native's own `Modal` (no
 * dependency), on the warm page colour: a title that is a header to
 * assistive technology, one dismiss action at the trailing edge (`Done` or
 * `Close`, a 44pt target), an optional status line beneath the title (the
 * selector's count, in words), a pinned control slot for the search field
 * and any selection-wide action, and the scrolling list.
 *
 * Dismissal is honest: the shopper's choices autosave as they are made, so
 * the action, the sheet's swipe-down and Android's back all simply close —
 * none is a second save step and none can lose anything. Every route to
 * closing goes through `onRequestClose`, and `onClosed` fires once the sheet
 * is gone so the opener can hand focus back to the control that opened it.
 *
 * The list keeps taps working while the keyboard is up, dismisses the
 * keyboard on a drag, and grows its bottom inset under the keyboard, so the
 * last rows stay reachable with the software keyboard visible.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { hitTarget, layout, spacing } from '@/constants/design-tokens';

export function SelectorSheet({
  visible,
  title,
  status,
  action,
  onRequestClose,
  onClosed,
  controls,
  children,
}: {
  visible: boolean;
  title: string;
  /** A line under the title: the selection count, in words. */
  status?: string;
  /** The one dismiss action, at the trailing edge of the title row. */
  action: { label: string; hint: string };
  /** Every way the sheet closes: the action, a swipe down, Android back. */
  onRequestClose: () => void;
  /** After the sheet is gone: the opener returns focus to its trigger. */
  onClosed?: () => void;
  /** Pinned above the list: the search field, and any selection-wide action. */
  controls?: ReactNode;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const wasVisible = useRef(visible);
  useEffect(() => {
    // iOS reports the end of the dismissal through onDismiss; elsewhere the
    // sheet is gone as soon as it stops being visible.
    if (Platform.OS !== 'ios' && wasVisible.current && !visible) onClosed?.();
    wasVisible.current = visible;
  }, [visible, onClosed]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      allowSwipeDismissal
      onRequestClose={onRequestClose}
      onDismiss={Platform.OS === 'ios' ? onClosed : undefined}>
      <Surface background="background/page" style={styles.sheet}>
        <View
          style={[
            styles.top,
            // A page sheet sits below the status bar on iOS; a full-screen
            // presentation elsewhere needs the real top inset.
            { paddingTop: Platform.OS === 'ios' ? spacing[16] : insets.top + spacing[16] },
          ]}>
          <View style={styles.titleRow}>
            <Text variant="heading-3" accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={action.label}
              accessibilityHint={action.hint}
              onPress={onRequestClose}
              style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
              <Text variant="body-small-bold" color="action/secondary">
                {action.label}
              </Text>
            </Pressable>
          </View>
          {status ? (
            <Text variant="body-small" color="text/secondary" accessibilityLiveRegion="polite">
              {status}
            </Text>
          ) : null}
          {controls ? <View style={styles.controls}>{controls}</View> : null}
        </View>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.list, { paddingBottom: spacing[24] + insets.bottom }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets>
          {children}
        </ScrollView>
      </Surface>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
  },
  top: {
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: layout.pageMargin,
    gap: spacing[8],
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[12],
  },
  title: {
    flex: 1,
  },
  // The dismiss word is one line, so the target is grown to the minimum
  // height and given room at the sides.
  action: {
    minHeight: hitTarget.minimum,
    justifyContent: 'center',
    paddingHorizontal: spacing[8],
  },
  controls: {
    gap: spacing[12],
    paddingTop: spacing[4],
  },
  scroll: {
    flex: 1,
    width: '100%',
  },
  list: {
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: layout.pageMargin,
    paddingTop: spacing[12],
    gap: spacing[8],
  },
  pressed: {
    opacity: 0.6,
  },
});
