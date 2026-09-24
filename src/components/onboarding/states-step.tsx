/**
 * Screen 2, States (P2B7X.1; map-first since P2B7Y), `1 of 4`: a Map / List
 * control beside the helper mascot, then either the map (lib/state-map.ts)
 * with the count line, `Clear selection` and every chosen state by name, or
 * the shared searchable state list — in the onboarding frame, with
 * `Continue` sticky in the footer.
 *
 * ## One draft, two ways to edit it
 *
 * The draft lives HERE, seeded from the saved selection. The map toggles it
 * through `toggleStateCode` and clears it through `clearStateDraft` — the
 * shared selector's own rules. The list is the shared `StateSelectorContent`,
 * unchanged: it is mounted when List is chosen, seeded from this draft, and
 * reports every change back through `onDraftChange`, which lands in the same
 * `commit` the map uses. So switching modes never loses, reorders or
 * duplicates a choice, and both modes save through the one route callback.
 *
 * ## The rules this step carries
 *
 * - At least one state is required. Continue is disabled with none, and
 *   the reason is SAID beneath it (`Choose at least one state to
 *   continue.`), not only greyed; the note is permanently allocated so the
 *   footer never changes height as the count crosses zero.
 * - In each mode, the count line and `Clear selection` are always rendered,
 *   and `Clear selection` is inert with nothing chosen: clearing an empty
 *   draft returns the same reference, so nothing is saved or re-rendered
 *   (P2B7V).
 * - Every change is reported to the route through `onChange`, which saves
 *   progressively; there is no Done and nothing to lose on a kill.
 * - No location permission and no inferred state: the shopper chooses.
 *
 * Presentational: the route owns saving and navigation.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { OnboardingFrame, SelectionCount } from '@/components/onboarding/onboarding-frame';
import { StateMap } from '@/components/onboarding/state-map';
import { StateSelectorContent } from '@/components/settings/personalization-form';
import { Button } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { color, hitTarget, radius, spacing } from '@/constants/design-tokens';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import {
  BACK_HINT,
  BACK_LABEL,
  CLEAR_SELECTION_LABEL,
  CLEAR_STATES_HINT,
  CONTINUE_CTA,
  STATES_BODY,
  STATES_HEADLINE,
  STATES_REQUIRED_NOTE,
} from '@/lib/onboarding-copy';
import { canContinueFromStates, motionAllowed, stepProgress } from '@/lib/onboarding-state';
import { clearStateDraft, stateCountLabel, toggleStateCode } from '@/lib/personalization-screen';
import {
  DEFAULT_SELECTION_MODE,
  HELPER_MASCOT_SIZE,
  HIDE_MASCOT_AT_SCALE,
  LIST_MODE_HINT,
  LIST_MODE_LABEL,
  MAP_MODE_HINT,
  MAP_MODE_LABEL,
  MASCOT_ENTRANCE,
  removeStateLabel,
  stateSpokenName,
  type StatesSelectionMode,
} from '@/lib/state-map';

export function StatesStep({
  selected,
  onChange,
  onContinue,
  onBack,
  initialQuery = '',
  initialMode = DEFAULT_SELECTION_MODE,
}: {
  /** The saved selection this step opens with. */
  selected: readonly string[];
  /** Every change, saved progressively by the route. */
  onChange: (codes: readonly string[]) => void;
  onContinue: () => void;
  onBack: () => void;
  /** A search already typed — for the gallery; the step starts blank. */
  initialQuery?: string;
  /** The mode to open in — for the gallery; the step opens on the map. */
  initialMode?: StatesSelectionMode;
}) {
  // The one draft both modes edit; the saved value seeds it.
  const [draft, setDraft] = useState<readonly string[]>(selected);
  const [mode, setMode] = useState<StatesSelectionMode>(initialMode);
  const commit = useCallback(
    (codes: readonly string[]) => {
      setDraft(codes);
      onChange(codes);
    },
    [onChange],
  );
  const toggle = (code: string) => commit(toggleStateCode(draft, code));
  // An empty clear is a TRUE no-op: the same reference comes back, and
  // nothing is set or saved (P2B7V), besides the control being disabled.
  const clear = () => {
    const next = clearStateDraft(draft);
    if (next !== draft) commit(next);
  };
  const canContinue = canContinueFromStates(draft);
  const { fontScale } = useWindowDimensions();

  return (
    <OnboardingFrame
      headline={STATES_HEADLINE}
      body={STATES_BODY}
      progress={stepProgress('states')}
      back={{ label: BACK_LABEL, hint: BACK_HINT, onPress: onBack }}
      keyboard
      footer={
        <>
          <Button
            label={CONTINUE_CTA}
            disabled={!canContinue}
            onPress={onContinue}
            accessibilityHint={canContinue ? undefined : STATES_REQUIRED_NOTE}
          />
          {/* Permanently allocated: the sentence is always laid out, so the
              footer is the same height at every text size whether or not it
              shows; with a state chosen it is invisible and hidden from
              assistive technology. */}
          <Text
            variant="caption"
            color="text/secondary"
            style={[styles.note, canContinue && styles.noteInactive]}
            accessibilityElementsHidden={canContinue}
            importantForAccessibility={canContinue ? 'no-hide-descendants' : 'auto'}
            accessibilityLiveRegion="polite">
            {STATES_REQUIRED_NOTE}
          </Text>
        </>
      }>
      <View style={styles.modeRow}>
        <ModeSwitch mode={mode} onChange={setMode} />
        {fontScale < HIDE_MASCOT_AT_SCALE ? <HelperMascot /> : null}
      </View>
      {mode === 'map' ? (
        <View style={styles.selector}>
          <StateMap selected={draft} onToggle={toggle} />
          <View style={styles.countRow}>
            <View style={styles.count}>
              <SelectionCount text={stateCountLabel(draft.length)} />
            </View>
            <Button
              variant="secondary"
              label={CLEAR_SELECTION_LABEL}
              accessibilityHint={CLEAR_STATES_HINT}
              disabled={draft.length === 0}
              onPress={clear}
            />
          </View>
          <View style={styles.chosen}>
            {draft.map((code) => (
              <ChosenState key={code} code={code} onRemove={toggle} />
            ))}
          </View>
        </View>
      ) : (
        <StateSelectorContent
          selected={draft}
          onCommit={() => {}}
          onDraftChange={commit}
          initialQuery={initialQuery}
          clearHint={CLEAR_STATES_HINT}
          frame={({ controls, list }) => (
            <View style={styles.selector}>
              <SelectionCount text={stateCountLabel(draft.length)} />
              <View style={styles.controls}>{controls}</View>
              <View style={styles.rows}>{list}</View>
            </View>
          )}
        />
      )}
    </OnboardingFrame>
  );
}

/**
 * Map / List: two segments, each a button that reports whether it is the
 * mode showing, with a glyph and a word. The selected segment is told by its
 * fill and border AND by its word turning bold, and it reports `selected`,
 * so the mode is never carried by colour alone.
 */
function ModeSwitch({
  mode,
  onChange,
}: {
  mode: StatesSelectionMode;
  onChange: (mode: StatesSelectionMode) => void;
}) {
  const segments: { key: StatesSelectionMode; label: string; hint: string; icon: IconName }[] = [
    { key: 'map', label: MAP_MODE_LABEL, hint: MAP_MODE_HINT, icon: 'map' },
    { key: 'list', label: LIST_MODE_LABEL, hint: LIST_MODE_HINT, icon: 'list' },
  ];
  return (
    <View style={styles.switch}>
      {segments.map(({ key, label, hint, icon }) => {
        const active = mode === key;
        return (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityHint={hint}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(key)}
            style={({ pressed }) => [
              styles.segment,
              active && styles.segmentActive,
              pressed && styles.pressed,
            ]}>
            <Icon name={icon} size={20} color="icon/primary" />
            <Text
              variant={active ? 'body-small-bold' : 'body-small'}
              color="text/primary"
              style={styles.segmentText}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A chosen state, by name, with its own removal control. */
function ChosenState({ code, onRemove }: { code: string; onRemove: (code: string) => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={removeStateLabel(code)}
      onPress={() => onRemove(code)}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
      <Text variant="body-small" color="text/primary" style={styles.chipText}>
        {stateSpokenName(code)}
      </Text>
      <Icon name="x" size={16} color="icon/primary" />
    </Pressable>
  );
}

/**
 * M02, the helper pose, beside the Map / List control: decorative, hidden
 * from assistive technology, touching nothing, and never over the map. It
 * fades in with an 8pt settle once, only when Reduce Motion is known to be
 * off; otherwise it is simply there.
 */
function HelperMascot() {
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
        source={require('@/assets/brand/production/lotly-mascot-helper-1024.png')}
        style={{ width: HELPER_MASCOT_SIZE, height: HELPER_MASCOT_SIZE }}
        resizeMode="contain"
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[12],
  },
  switch: {
    flex: 1,
    flexDirection: 'row',
    padding: spacing[4],
    gap: spacing[4],
    borderRadius: radius[12],
    borderWidth: 1,
    borderColor: color['border/default'],
    backgroundColor: color['background/surface'],
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[8],
    minHeight: hitTarget.minimum,
    paddingHorizontal: spacing[8],
    borderRadius: radius[8],
    borderWidth: 1,
    borderColor: color['background/surface'],
  },
  segmentActive: {
    backgroundColor: color['background/subtle'],
    borderColor: color['action/primary'],
  },
  segmentText: {
    flexShrink: 1,
  },
  selector: {
    gap: spacing[12],
  },
  countRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[8],
  },
  count: {
    flexGrow: 1,
    flexShrink: 1,
  },
  chosen: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[8],
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[8],
    minHeight: hitTarget.minimum,
    maxWidth: '100%',
    paddingHorizontal: spacing[12],
    borderRadius: radius[12],
    backgroundColor: color['background/subtle'],
  },
  chipText: {
    flexShrink: 1,
  },
  controls: {
    gap: spacing[12],
  },
  rows: {
    gap: spacing[8],
  },
  note: {
    textAlign: 'center',
  },
  noteInactive: {
    opacity: 0,
  },
  pressed: {
    opacity: 0.6,
  },
});
