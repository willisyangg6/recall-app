/**
 * The Retailers step's search (2026-09-24): a sheet over the step, which
 * stays where it was, dimmed, beneath it.
 *
 * ## Why a sheet of its own
 *
 * The app's `SelectorSheet` (Profile's store and state sheets) is iOS's page
 * sheet: nearly full height, pushing the screen behind it back. This search
 * is a contextual layer over a step that must stay exactly where it was, so
 * it is React Native's own transparent `Modal` — no dependency — drawing a
 * backdrop and a sheet itself: the step behind is dimmed with `text/primary`
 * at `SHEET_BACKDROP_OPACITY`, never moved, resized or re-laid out, and,
 * being under a modal, takes no touch and is hidden from assistive
 * technology.
 *
 * ## A stable frame
 *
 * The sheet's top edge is `searchSheetTop` (lib/retailer-grid.ts): a
 * function of the window and the text size only. Neither the query, the
 * results nor the keyboard moves it. From top to bottom it holds a drag
 * indicator, `Search all stores` with `Close`, the field, the results region
 * — the one part that changes — and `Done`, pinned at the bottom. With the
 * keyboard up, `Done` is under the keyboard and the results region insets
 * itself so every row can still be scrolled above it; dragging the results
 * or the keyboard's search key puts the keyboard away and `Done` is there.
 *
 * ## What it shows
 *
 * Before anything is typed, one line — `Search the complete store list.` —
 * never the whole catalog. A query is matched by `retailerSearchResults`:
 * the catalog's own normalization and aliases, in name order. Matches are
 * `RetailerResultRow`s, one column; no match is `No stores found.` What was
 * found is announced once per change.
 *
 * ## One selection, a query that is forgotten
 *
 * A row toggles the step's own selection through the route, which saves at
 * once, so a store chosen here is checked on the step and in the summary
 * behind the sheet, and one chosen there is checked here. Choosing never
 * closes the sheet. `Close`, `Done`, the backdrop and Android's back all do
 * one thing: close, keeping every choice. The query lives in the sheet's
 * contents, which are unmounted on every close, so each opening starts
 * blank; it is never saved.
 *
 * ## Motion
 *
 * The backdrop fades and the sheet slides up over `SHEET_MOTION.in`, and
 * back over `SHEET_MOTION.out`. Under Reduce Motion, or while that setting
 * is unknown, both are simply there and simply gone.
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
import { CheckIndicator } from '@/components/ui/check-row';
import { Icon } from '@/components/ui/icon';
import { SearchBar } from '@/components/ui/search-bar';
import { Text } from '@/components/ui/text';
import { color, hitTarget, layout, radius, spacing } from '@/constants/design-tokens';
import type { CanonicalRetailer } from '@/domain/retailer-catalog';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import {
  NO_STORES_FOUND,
  SEARCH_ALL_STORES_LABEL,
  SEARCH_CLOSE_LABEL,
  SEARCH_DISMISS_HINT,
  SEARCH_DONE_LABEL,
  SEARCH_INSTRUCTION,
  SEARCH_STORES_HINT,
  SEARCH_STORES_LABEL,
  searchResultsAnnouncement,
} from '@/lib/onboarding-copy';
import { motionAllowed } from '@/lib/onboarding-state';
import {
  retailerSearchResults,
  SHEET_BACKDROP_OPACITY,
  SHEET_MOTION,
  searchSheetTop,
} from '@/lib/retailer-grid';

export function RetailerSearchSheet({
  visible,
  selected,
  onToggle,
  onClose,
  onClosed,
}: {
  visible: boolean;
  selected: readonly string[];
  onToggle: (id: string) => void;
  /** Every way out: Close, Done, the backdrop, Android's back. */
  onClose: () => void;
  /** After the sheet is gone: the step returns focus to its trigger. */
  onClosed?: () => void;
}) {
  const reduceMotion = useReduceMotion();
  const { height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const top = searchSheetTop(height, insets.top, fontScale);

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
    // Gone: rest off the screen, so the next opening slides in from there.
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
        {/* A tap on the dimmed step closes the search. Close says the same to
            assistive technology, which never reaches the backdrop. */}
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
  onToggle: (id: string) => void;
  onClose: () => void;
  bottomInset: number;
}) {
  const [query, setQuery] = useState('');
  const results = retailerSearchResults(query);

  // Said once as it changes — `7 stores found.`, `No stores found.` — never
  // on a re-render.
  const found = results === null ? null : results.length;
  useEffect(() => {
    if (found !== null)
      AccessibilityInfo.announceForAccessibility(searchResultsAnnouncement(found));
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
          <Text variant="heading-3">{SEARCH_ALL_STORES_LABEL}</Text>
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
          placeholder={SEARCH_STORES_LABEL}
          accessibilityLabel={SEARCH_STORES_LABEL}
          accessibilityHint={SEARCH_STORES_HINT}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="search"
          autoFocus
        />
      </View>
      {/* The one region that changes: its frame is fixed by the sheet. */}
      <ScrollView
        style={styles.results}
        contentContainerStyle={styles.resultsContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets>
        {results === null ? (
          <Text variant="body-small" color="text/secondary">
            {SEARCH_INSTRUCTION}
          </Text>
        ) : results.length === 0 ? (
          <Text variant="body-small" color="text/secondary">
            {NO_STORES_FOUND}
          </Text>
        ) : (
          results.map((retailer) => (
            <RetailerResultRow
              key={retailer.id}
              retailer={retailer}
              checked={selected.includes(retailer.id)}
              onPress={() => onToggle(retailer.id)}
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

/**
 * One search result: a full-width row, the store's canonical name and the
 * shared checkbox at the trailing edge — the whole row one checkbox element
 * and one target. Open, the white surface with a `border/default` edge;
 * chosen, the soft blue `background/subtle` with an `action/primary` edge
 * AND a filled checkbox, so colour is never alone. No logo, glyph or mark.
 * Slimmer than a popular tile and one to a line, so a result never reads as
 * one of the curated ten.
 */
export function RetailerResultRow({
  retailer,
  checked,
  onPress,
}: {
  retailer: CanonicalRetailer;
  checked: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={retailer.name}
      accessibilityState={{ checked }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        checked ? styles.rowChosen : styles.rowOpen,
        pressed && styles.pressed,
      ]}>
      <Text variant="body" style={styles.rowName}>
        {retailer.name}
      </Text>
      <View
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        <CheckIndicator checked={checked} />
      </View>
    </Pressable>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[12],
    minHeight: hitTarget.minimum,
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[12],
    borderRadius: radius[12],
    borderWidth: 1,
  },
  rowOpen: {
    backgroundColor: color['background/surface'],
    borderColor: color['border/default'],
  },
  rowChosen: {
    backgroundColor: color['background/subtle'],
    borderColor: color['action/primary'],
  },
  rowName: {
    flex: 1,
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
