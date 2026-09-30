/**
 * The States step's chooser (the grocery-atlas States, 2026-09-30): the only
 * place the jurisdictions are listed. The step shows one search entry;
 * activating it opens this sheet over the step.
 *
 * ## The Retailers sheet's pattern
 *
 * React Native's own transparent `Modal` (no dependency) drawing a backdrop
 * and a sheet, exactly as the Stores search does (retailer-search-sheet.tsx):
 * the same `text/primary` backdrop at `SHEET_BACKDROP_OPACITY`, the same
 * slide over `SHEET_MOTION`, simply there and simply gone under Reduce
 * Motion or while that setting is unknown. The step behind is never moved or
 * re-laid out and, under a modal, takes no touch and is hidden from
 * assistive technology.
 *
 * It differs in one way: its top edge sits just under the status bar
 * (`chooserTop`), so the chooser owns the viewport while the shopper
 * searches. The scene is covered, not shrunk, and a small SE keeps as many
 * result rows above the keyboard as it can.
 *
 * ## What it holds
 *
 * From top to bottom: a drag indicator, `Choose states` with `Close`, the
 * field (focused on opening, named `Search states` whatever it shows), the
 * results, and `Done` pinned at the bottom. A blank query lists all 52
 * jurisdictions alphabetically by full name; a query narrows them by name,
 * postal code or alias (`searchStateChoices`), and no match says so. What
 * was found is announced once per change. Each row is the shared `CheckRow`,
 * the state selector's own row: a checkbox named by the full name.
 *
 * ## One draft, a query that is forgotten
 *
 * A row toggles the step's own draft through `onToggle`, which the step
 * saves at once, so a chip appears behind the sheet as the row is checked.
 * Choosing never closes the sheet. `Close`, `Done`, the backdrop and
 * Android's back all do one thing: close, keeping every choice. The query
 * lives in the sheet's contents, which unmount on every close, so each
 * opening starts blank. When the sheet has gone the step returns focus to
 * its search entry.
 */

import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { CheckRow } from '@/components/ui/check-row';
import { Icon } from '@/components/ui/icon';
import { SearchBar } from '@/components/ui/search-bar';
import { Text } from '@/components/ui/text';
import { color, hitTarget, layout, radius, spacing } from '@/constants/design-tokens';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import {
  NO_STATES_FOUND,
  SEARCH_CLOSE_LABEL,
  SEARCH_DISMISS_HINT,
  SEARCH_DONE_LABEL,
  STATES_CHOOSER_TITLE,
  STATES_FIELD_HINT,
  STATES_SEARCH_PLACEHOLDER,
  statesFoundAnnouncement,
} from '@/lib/onboarding-copy';
import { motionAllowed } from '@/lib/onboarding-state';
import { SHEET_BACKDROP_OPACITY, SHEET_MOTION } from '@/lib/retailer-grid';
import { chooserTop, searchStateChoices } from '@/lib/states-presentation';

export function StateSearchSheet({
  visible,
  selected,
  onToggle,
  onClose,
  onClosed,
}: {
  visible: boolean;
  /** The step's draft: what is checked. */
  selected: readonly string[];
  onToggle: (code: string) => void;
  /** Every way out: Close, Done, the backdrop, Android's back. */
  onClose: () => void;
  /** After the sheet is gone: the step returns focus to its search entry. */
  onClosed?: () => void;
}) {
  const reduceMotion = useReduceMotion();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const top = chooserTop(insets.top);

  // Closing plays the slide out before the modal goes, where motion is allowed.
  const [closing, setClosing] = useState(false);
  const [wasVisible, setWasVisible] = useState(visible);
  if (wasVisible !== visible) {
    setWasVisible(visible);
    if (!visible && motionAllowed(reduceMotion)) setClosing(true);
  }
  const shown = visible || closing;

  // 0 = off the screen, 1 = in place.
  const [progress] = useState(() => new Animated.Value(visible ? 1 : 0));
  useEffect(() => {
    if (!visible && !closing) {
      progress.setValue(0);
      return;
    }
    const to = visible ? 1 : 0;
    if (!motionAllowed(reduceMotion)) {
      progress.setValue(to);
      return;
    }
    const run = Animated.timing(progress, {
      toValue: to,
      duration: visible ? SHEET_MOTION.in : SHEET_MOTION.out,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    });
    run.start(({ finished }) => {
      if (finished && !visible) setClosing(false);
    });
    return () => run.stop();
  }, [visible, closing, reduceMotion, progress]);

  const close = () => {
    Keyboard.dismiss();
    onClose();
  };

  return (
    <Modal
      visible={shown}
      transparent
      animationType="none"
      onRequestClose={close}
      onDismiss={onClosed}
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
        {/* A tap on the dimmed step closes the chooser. Close says the same
            to assistive technology, which never reaches the backdrop. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={close}
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
            <SheetContents
              selected={selected}
              onToggle={onToggle}
              onClose={close}
              bottomInset={insets.bottom}
            />
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

/**
 * What the sheet holds. Mounted on every opening and gone on every close,
 * so the query starts blank each time and is never carried.
 */
function SheetContents({
  selected,
  onToggle,
  onClose,
  bottomInset,
}: {
  selected: readonly string[];
  onToggle: (code: string) => void;
  onClose: () => void;
  bottomInset: number;
}) {
  const [query, setQuery] = useState('');
  const results = searchStateChoices(query);

  // Said once as the query changes the count, never on a re-render, and not
  // on opening (the full list needs no announcement).
  const found = query.trim() === '' ? null : results.length;
  useEffect(() => {
    if (found !== null) AccessibilityInfo.announceForAccessibility(statesFoundAnnouncement(found));
  }, [found]);

  return (
    <View style={styles.contents}>
      <View
        style={styles.handle}
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <View style={styles.header}>
        {/* One element in a 44pt box level with Close's, so VoiceOver reads
            the title first (iOS orders by top edge). */}
        <View accessible accessibilityRole="header" style={styles.title}>
          <Text variant="heading-3">{STATES_CHOOSER_TITLE}</Text>
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
      <View style={styles.field}>
        <SearchBar
          value={query}
          onChangeText={setQuery}
          placeholder={STATES_SEARCH_PLACEHOLDER}
          accessibilityLabel={STATES_SEARCH_PLACEHOLDER}
          accessibilityHint={STATES_FIELD_HINT}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="search"
          autoFocus
        />
      </View>
      <ScrollView
        style={styles.results}
        contentContainerStyle={styles.resultsContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets>
        {results.length === 0 ? (
          <Text variant="body-small" color="text/secondary">
            {NO_STATES_FOUND}
          </Text>
        ) : (
          results.map((choice) => (
            <CheckRow
              key={choice.code}
              label={choice.name}
              checked={selected.includes(choice.code)}
              onPress={() => onToggle(choice.code)}
            />
          ))
        )}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: bottomInset + spacing[12] }]}>
        <Button
          label={SEARCH_DONE_LABEL}
          accessibilityHint={SEARCH_DISMISS_HINT}
          onPress={onClose}
        />
      </View>
    </View>
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
  // Pinned to the bottom from a fixed top edge: its frame never follows the
  // query, the results or the keyboard.
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
  field: {
    paddingHorizontal: layout.pageMargin,
    paddingTop: spacing[8],
    paddingBottom: spacing[12],
  },
  results: {
    flex: 1,
  },
  resultsContent: {
    gap: spacing[8],
    paddingHorizontal: layout.pageMargin,
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
