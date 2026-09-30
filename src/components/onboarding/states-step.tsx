/**
 * Screen 2, States (the grocery-atlas States, 2026-09-30), `3 of 5`.
 *
 * The founder-approved composition
 * (assets/brand/reference/lotly-onboarding-states-grocery-atlas-target.png),
 * rebuilt from its one approved production image and native UI. From the
 * top: the back control and progress bar every counted step has; the
 * headline and body, left aligned; the grocery-atlas scene across the full
 * width; one search entry; the chosen states as removable chips; the helper;
 * and `Continue` pinned above the bottom inset. It replaces the P2B7Y map,
 * Map / List control, Northeast enlargement and insets, and the M02 aside;
 * the map's code stays in the tree, unreferenced here.
 *
 * ## Its own page, the frame's chrome
 *
 * The scene bleeds to both screen edges, so States draws its own page as
 * Welcome does, keeping the frame's top bar itself (`OnboardingTopBar`) so
 * back and progress are exactly every other step's. The footer is the
 * frame's: the page colour over the real bottom inset, with its hairline
 * drawn only while content actually runs beneath it (the target has none).
 *
 * ## The scene
 *
 * One image, drawn whole with `contain` at its own aspect ratio and scaled by
 * the page width: never cropped, tinted, faded or boxed, and approved for
 * this cream page only. It is decorative: hidden from assistive technology,
 * touching nothing. It is static and the same for every household; its
 * atlas shows no state, and nothing about the selection is drawn on it.
 *
 * ## One draft, one search entry
 *
 * The draft lives HERE, seeded from the saved selection, and every change is
 * reported to the route through `onChange`, which saves progressively: there
 * is no save step and nothing to lose on a kill. The search entry opens the
 * chooser (state-search-sheet.tsx), whose rows toggle this same draft
 * through `toggleStateCode`, the shared selector's rule; a chip removes its
 * state through the same rule. The jurisdictions are listed only in the
 * chooser. When the chooser has gone, focus returns to the search entry.
 *
 * ## The rules this step carries
 *
 * - At least one state is required: `Continue` is disabled with none, with
 *   the shared Button's disabled semantics and the reason as its hint; the
 *   helper beneath the chips says it in words.
 * - No location permission, no inferred state, no default: the chips are
 *   the saved selection and nothing else.
 * - Type (STATES_TYPE) and the 51pt `Continue` are States-local sizes; the
 *   shared type scale and Button are unchanged. Nothing caps Dynamic Type:
 *   the page scrolls above the footer and every chip stays reachable. At
 *   the accessibility sizes the headline takes the `display` base (still
 *   scaled) and each chosen state becomes a full-width row with its own
 *   remove button (lib/states-presentation.ts). On a compact-height screen
 *   the vertical gaps tighten so the search entry is above the footer.
 *
 * Static: no entrance, no loop. Presentational: the route owns saving and
 * navigation.
 */

import { useCallback, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
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
import { StateSearchSheet } from '@/components/onboarding/state-search-sheet';
import { Icon } from '@/components/ui/icon';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { color, hitTarget, layout, radius, spacing } from '@/constants/design-tokens';
import {
  BACK_HINT,
  BACK_LABEL,
  CONTINUE_CTA,
  STATES_BODY,
  STATES_HEADLINE,
  STATES_HELPER,
  STATES_REQUIRED_NOTE,
  STATES_SEARCH_HINT,
  STATES_SEARCH_PLACEHOLDER,
} from '@/lib/onboarding-copy';
import { canContinueFromStates, stepProgress } from '@/lib/onboarding-state';
import { toggleStateCode } from '@/lib/personalization-screen';
import { removeStateLabel, stateSpokenName } from '@/lib/state-map';
import {
  bodyMeasure,
  CHIP,
  chipLayout,
  CONTROL_MIN_HEIGHT,
  headlineType,
  SCENE_PX,
  STATES_TYPE,
  verticalGaps,
} from '@/lib/states-presentation';

/** The approved scene, 853×731 RGBA, cut from the target at its own pixels. */
const SCENE =
  require('@/assets/brand/production/lotly-states-grocery-atlas-scene.png') as ImageSourcePropType;

export function StatesStep({
  selected,
  onChange,
  onContinue,
  onBack,
}: {
  /** The saved selection this step opens with. */
  selected: readonly string[];
  /** Every change, saved progressively by the route. */
  onChange: (codes: readonly string[]) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { fontScale, height } = useWindowDimensions();
  const gaps = verticalGaps(height);
  const chips = chipLayout(fontScale);

  // The one draft the chooser and the chips edit; the saved value seeds it.
  const [draft, setDraft] = useState<readonly string[]>(selected);
  const commit = useCallback(
    (codes: readonly string[]) => {
      setDraft(codes);
      onChange(codes);
    },
    [onChange],
  );
  const toggle = (code: string) => commit(toggleStateCode(draft, code));
  const canContinue = canContinueFromStates(draft);

  // The chooser, and the search entry focus returns to once it has gone.
  const [searchOpen, setSearchOpen] = useState(false);
  const entry = useRef<View>(null);
  const focusEntry = useCallback(() => {
    const tag = findNodeHandle(entry.current);
    if (tag !== null) AccessibilityInfo.setAccessibilityFocus(tag);
  }, []);

  // The footer's hairline shows only while content runs beneath it.
  const [viewport, setViewport] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const overflowing = viewport > 0 && contentHeight > viewport + 1;

  return (
    <Surface background="background/page" style={styles.page}>
      <OnboardingTopBar
        back={{ label: BACK_LABEL, hint: BACK_HINT, onPress: onBack }}
        progress={stepProgress('states')}
      />
      <ScrollView
        style={styles.page}
        contentContainerStyle={[styles.content, { paddingTop: gaps.top }]}
        onLayout={(event) => setViewport(event.nativeEvent.layout.height)}
        onContentSizeChange={(_, height) => setContentHeight(height)}>
        <View style={[styles.heading, { gap: gaps.heading }]}>
          <Text variant="display" accessibilityRole="header" style={headlineType(fontScale)}>
            {STATES_HEADLINE}
          </Text>
          <Text
            variant="body"
            color="text/secondary"
            style={[styles.body, { maxWidth: bodyMeasure(fontScale) }]}>
            {STATES_BODY}
          </Text>
        </View>
        <View
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={[styles.scene, { marginTop: gaps.scene }]}>
          <Image source={SCENE} resizeMode="contain" style={styles.fill} />
        </View>
        <View style={styles.controls}>
          <SearchEntry ref={entry} onPress={() => setSearchOpen(true)} />
          {draft.length > 0 ? (
            <View style={chips === 'pill' ? styles.chips : styles.chipRows}>
              {draft.map((code) =>
                chips === 'pill' ? (
                  <ChosenState key={code} code={code} onRemove={toggle} />
                ) : (
                  <ChosenStateRow key={code} code={code} onRemove={toggle} />
                ),
              )}
            </View>
          ) : null}
          <Text variant="body-small" color="text/secondary" style={styles.helper}>
            {STATES_HELPER}
          </Text>
        </View>
      </ScrollView>
      <View
        style={[
          styles.footer,
          overflowing && styles.footerRule,
          { paddingBottom: insets.bottom + spacing[12] },
        ]}>
        <ContinueButton disabled={!canContinue} onPress={onContinue} />
      </View>
      <StateSearchSheet
        visible={searchOpen}
        selected={draft}
        onToggle={toggle}
        onClose={() => setSearchOpen(false)}
        onClosed={focusEntry}
      />
    </Surface>
  );
}

/**
 * The one search entry: drawn as the target's outlined field, but a button,
 * not a field, so there is only ever one text field: the chooser's. It is
 * named by its words, `Search states`, and says what it opens.
 */
function SearchEntry({ ref, onPress }: { ref: React.Ref<View>; onPress: () => void }) {
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={STATES_SEARCH_PLACEHOLDER}
      accessibilityHint={STATES_SEARCH_HINT}
      onPress={onPress}
      style={({ pressed }) => [styles.entry, pressed && styles.pressed]}>
      <Icon name="search" size={24} color="icon/primary" />
      <Text variant="body" color="text/secondary" style={styles.placeholder}>
        {STATES_SEARCH_PLACEHOLDER}
      </Text>
    </Pressable>
  );
}

/**
 * A chosen state as a soft blue pill, by full name, the whole pill its own
 * removal control named for the state. The pill is 34pt; hitSlop takes the
 * target to 44pt without overlapping a neighbouring row's.
 */
function ChosenState({ code, onRemove }: { code: string; onRemove: (code: string) => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={removeStateLabel(code)}
      hitSlop={{ top: CHIP.hitSlop, bottom: CHIP.hitSlop }}
      onPress={() => onRemove(code)}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
      <Text variant="body-small-bold" color="text/primary" style={styles.chipText}>
        {stateSpokenName(code)}
      </Text>
      <Icon name="x" size={16} color="icon/primary" />
    </Pressable>
  );
}

/**
 * A chosen state at the accessibility text sizes: a full-width row, its name
 * wrapping in all the width the remove button leaves, and the remove button
 * its own 44pt control named for the state, so a long name never squeezes
 * the target and the target never squeezes the name.
 */
function ChosenStateRow({ code, onRemove }: { code: string; onRemove: (code: string) => void }) {
  return (
    <View style={styles.chipRow}>
      <Text variant="body-small-bold" color="text/primary" style={styles.chipRowText}>
        {stateSpokenName(code)}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={removeStateLabel(code)}
        onPress={() => onRemove(code)}
        style={({ pressed }) => [styles.remove, pressed && styles.pressed]}>
        <Icon name="x" size={24} color="icon/primary" />
      </Pressable>
    </View>
  );
}

/**
 * The shared Button's primary treatment at the target's size: the same
 * pill, fill, disabled fill and label colours, face, pressed opacity, role
 * and state, only 51pt tall with an 18pt label. With nothing chosen it is
 * disabled and its hint says why.
 */
function ContinueButton({ disabled, onPress }: { disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={disabled ? STATES_REQUIRED_NOTE : undefined}
      accessibilityState={{ disabled, busy: false }}
      disabled={disabled}
      onPress={onPress}>
      {({ pressed }) => (
        <View style={[styles.cta, disabled && styles.ctaInert, pressed && styles.pressed]}>
          <Text
            variant="body-small-bold"
            color={disabled ? 'text/primary' : 'text/inverse'}
            style={styles.ctaLabel}>
            {CONTINUE_CTA}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  // The top padding and the heading and scene gaps come from verticalGaps.
  content: {
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
    paddingBottom: spacing[16],
  },
  heading: {
    paddingHorizontal: layout.pageMargin,
  },
  body: STATES_TYPE.body,
  // The whole page width, at the image's own aspect ratio.
  scene: {
    width: '100%',
    aspectRatio: SCENE_PX.width / SCENE_PX.height,
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  // The field meets the scene's faded counter, as in the target.
  controls: {
    paddingHorizontal: layout.pageMargin,
    gap: spacing[12],
  },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[16],
    minHeight: CONTROL_MIN_HEIGHT,
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[8],
    borderRadius: radius[12],
    borderWidth: 1,
    borderColor: color['action/primary'],
    backgroundColor: color['background/surface'],
  },
  placeholder: {
    ...STATES_TYPE.placeholder,
    flexShrink: 1,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing[8],
    rowGap: CHIP.rowGap,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[12],
    minHeight: CHIP.minHeight,
    maxWidth: '100%',
    paddingLeft: spacing[16],
    paddingRight: spacing[12],
    paddingVertical: spacing[4],
    borderRadius: radius.full,
    backgroundColor: color['background/subtle'],
  },
  chipText: {
    ...STATES_TYPE.chip,
    flexShrink: 1,
  },
  chipRows: {
    gap: spacing[8],
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[4],
    minHeight: hitTarget.minimum,
    paddingLeft: spacing[16],
    paddingVertical: spacing[4],
    borderRadius: radius[12],
    backgroundColor: color['background/subtle'],
  },
  chipRowText: {
    ...STATES_TYPE.chip,
    flex: 1,
  },
  remove: {
    minWidth: hitTarget.minimum,
    minHeight: hitTarget.minimum,
    alignItems: 'center',
    justifyContent: 'center',
  },
  helper: STATES_TYPE.helper,
  // The frame's footer: the page colour, pinned over the bottom inset.
  footer: {
    width: '100%',
    paddingHorizontal: layout.pageMargin,
    paddingTop: spacing[12],
    borderTopWidth: 1,
    borderTopColor: 'transparent',
    backgroundColor: color['background/page'],
  },
  footerRule: {
    borderTopColor: color['border/subtle'],
  },
  // The shared Button's primary pill (components/ui/button.tsx), 51pt tall.
  cta: {
    minHeight: CONTROL_MIN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[8],
    borderRadius: radius.full,
    backgroundColor: color['action/primary'],
  },
  ctaInert: {
    backgroundColor: color['action/disabled'],
  },
  ctaLabel: {
    ...STATES_TYPE.cta,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
