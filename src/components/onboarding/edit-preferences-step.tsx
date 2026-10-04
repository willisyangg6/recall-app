/**
 * Edit preferences, one page (2026-09-30), reached from Ready's `Edit
 * preferences`. The founder-approved target
 * (assets/brand/reference/lotly-ready-edit-preferences-target.png, a design
 * reference that is never bundled): `Cancel`; `Edit your preferences` and
 * `Adjust your watch, all in one place.`; three sections between restrained
 * rules — States, Allergens, Stores — all visible together, each with its
 * artwork, its count, its helper (`Choose at least one state.` /
 * `Optional`), a blue `Edit` and its chosen values as removable chips, and
 * `Add allergens` under the allergens; the small mascot beside `Your recall
 * preview updates when you save.`; and `Save changes` pinned at the bottom.
 * It never replays the onboarding steps.
 *
 * ## One draft
 *
 * The page edits ONE working draft (lib/edit-preferences.ts): every `Edit`
 * opens that category's existing chooser — the States search sheet, the
 * Allergens step's grid in its sheet, the Stores search sheet — handed the
 * draft and the draft's toggles, so nothing is saved until `Save changes`.
 * Removing a chip changes the draft too. The allergen artwork follows the
 * draft as it changes. `Cancel` (and every other way out) leaves the saved
 * preferences exactly as they were. Presentational: the route owns loading,
 * saving and navigation.
 *
 * ## Accessibility
 *
 * Every control is at least 44pt with its own target: the chips through
 * vertical hitSlop and a row gap wider than the two slops, the `Edit`
 * actions and `Cancel` by their boxes. From the accessibility text sizes a
 * chip becomes a full-width row with a separate 44pt Remove button, as on
 * States. `Save changes` is disabled with a spoken reason while no state is
 * chosen; a failed save says so above it and keeps every change. The
 * artwork and the mini mascot are decorative. When a chooser closes, focus
 * returns to the action that opened it.
 */

import { useCallback, useRef, useState, type ReactNode } from 'react';
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

import { AllergenChooserSheet } from '@/components/onboarding/allergen-chooser-sheet';
import { RetailerSearchSheet } from '@/components/onboarding/retailer-search-sheet';
import { StateSearchSheet } from '@/components/onboarding/state-search-sheet';
import { PreferencesNotReady } from '@/components/settings/personalization-form';
import { Icon } from '@/components/ui/icon';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { color, hitTarget, layout, radius, spacing } from '@/constants/design-tokens';
import { allergenPictogram } from '@/lib/allergen-assets';
import {
  allergenChips,
  canSaveDraft,
  chipsAsRows,
  editorHeadlineType,
  CHIP_HEIGHT,
  CHIP_ROW_GAP,
  EDITOR_MARGIN,
  EDITOR_PICTOGRAM,
  EDITOR_TYPE,
  type EditorState,
  MINI_MASCOT_PX,
  MINI_MASCOT_WIDTH,
  SAVE_MIN_HEIGHT,
  SECTION_ICON_COLUMN,
  SECTION_ICON_GAP,
  SECTION_PADDING,
  stateChips,
  storeChips,
  type Chip,
} from '@/lib/edit-preferences';
import {
  EDIT_ACTION,
  EDIT_ACTION_LABELS,
  EDIT_ADD_ALLERGENS,
  EDIT_BODY,
  EDIT_CANCEL,
  EDIT_CANCEL_HINT,
  EDIT_CANCEL_LOCKED_HINT,
  EDIT_CAPTION,
  EDIT_CHOOSER_HINT,
  EDIT_HEADLINE,
  EDIT_OPTIONAL,
  EDIT_SAVE,
  EDIT_SAVE_FAILED,
  EDIT_SAVE_HINT,
  EDIT_SAVE_NEEDS_STATE,
  EDIT_SECTION_LABELS,
  EDIT_STATES_HELPER,
  editSelectedCount,
  removeChipLabel,
} from '@/lib/onboarding-copy';
import { allergenArtwork } from '@/lib/ready-presentation';

/** The approved mini mascot, cut from the editor target at its own pixels. */
const MINI_MASCOT =
  require('@/assets/brand/production/lotly-ready-preferences-mini-mascot.png') as ImageSourcePropType;

const DECORATIVE = {
  accessible: false,
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
  pointerEvents: 'none',
} as const;

/** A chip's hitSlop above and below: its drawn height up to 44pt. */
const CHIP_SLOP = (hitTarget.minimum - CHIP_HEIGHT) / 2;

type Chooser = 'states' | 'allergens' | 'retailers';

export function EditPreferencesStep({
  state,
  onToggleState,
  onToggleAllergen,
  onClearAllergens,
  onToggleStore,
  onSave,
  onCancel,
}: {
  state: EditorState;
  onToggleState: (code: string) => void;
  onToggleAllergen: (token: string) => void;
  onClearAllergens: () => void;
  onToggleStore: (id: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const rows = chipsAsRows(fontScale);
  const draft = state.draft;
  const saving = state.save === 'saving';
  const canSave = canSaveDraft(draft);

  // The open chooser, and the action focus returns to once it has gone.
  const [open, setOpen] = useState<Chooser | null>(null);
  const opener = useRef<View | null>(null);
  const editStates = useRef<View>(null);
  const editAllergens = useRef<View>(null);
  const addAllergens = useRef<View>(null);
  const editStores = useRef<View>(null);
  const openChooser = (which: Chooser, from: React.RefObject<View | null>) => {
    opener.current = from.current;
    setOpen(which);
  };
  const close = useCallback(() => setOpen(null), []);
  const refocus = useCallback(() => {
    const tag = findNodeHandle(opener.current);
    if (tag !== null) AccessibilityInfo.setAccessibilityFocus(tag);
  }, []);

  // The footer's hairline shows only while content runs beneath it.
  const [viewport, setViewport] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const overflowing = viewport > 0 && contentHeight > viewport + 1;

  return (
    <Surface background="background/page" style={styles.page}>
      <View style={[styles.topBar, { paddingTop: insets.top + spacing[8] }]}>
        <CancelAction onPress={onCancel} disabled={saving} />
      </View>
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.content}
        onLayout={(event) => setViewport(event.nativeEvent.layout.height)}
        onContentSizeChange={(_, height) => setContentHeight(height)}>
        <View style={styles.heading}>
          <Text variant="display" accessibilityRole="header" style={editorHeadlineType(fontScale)}>
            {EDIT_HEADLINE}
          </Text>
          <Text variant="body" color="text/secondary" style={EDITOR_TYPE.body}>
            {EDIT_BODY}
          </Text>
        </View>
        <Rule />
        <Section
          title={EDIT_SECTION_LABELS.states}
          count={draft.states.length}
          helper={EDIT_STATES_HELPER}
          artwork={<Icon name="map-pin" size={24} color="icon/primary" />}
          editLabel={EDIT_ACTION_LABELS.states}
          editRef={editStates}
          onEdit={() => openChooser('states', editStates)}
          chips={stateChips(draft)}
          onRemove={onToggleState}
          rows={rows}
        />
        <Rule />
        <Section
          title={EDIT_SECTION_LABELS.allergens}
          count={draft.allergens.length}
          helper={EDIT_OPTIONAL}
          artwork={<AllergenMark tokens={draft.allergens} />}
          editLabel={EDIT_ACTION_LABELS.allergens}
          editRef={editAllergens}
          onEdit={() => openChooser('allergens', editAllergens)}
          chips={allergenChips(draft)}
          onRemove={onToggleAllergen}
          rows={rows}
          after={
            <AddAllergens
              ref={addAllergens}
              onPress={() => openChooser('allergens', addAllergens)}
            />
          }
        />
        <Rule />
        <Section
          title={EDIT_SECTION_LABELS.retailers}
          count={draft.retailers.length}
          helper={EDIT_OPTIONAL}
          artwork={<Icon name="shopping-cart" size={24} color="icon/primary" />}
          editLabel={EDIT_ACTION_LABELS.retailers}
          editRef={editStores}
          onEdit={() => openChooser('retailers', editStores)}
          chips={storeChips(draft)}
          onRemove={onToggleStore}
          rows={rows}
        />
        <View style={styles.captionRow}>
          <View {...DECORATIVE}>
            <Image
              source={MINI_MASCOT}
              accessible={false}
              style={{
                width: MINI_MASCOT_WIDTH,
                height: (MINI_MASCOT_WIDTH * MINI_MASCOT_PX.height) / MINI_MASCOT_PX.width,
              }}
            />
          </View>
          <Text
            variant="body-small"
            color="text/secondary"
            style={[EDITOR_TYPE.caption, styles.caption]}>
            {EDIT_CAPTION}
          </Text>
        </View>
      </ScrollView>
      <View
        style={[
          styles.footer,
          overflowing && styles.footerRule,
          { paddingBottom: insets.bottom + spacing[12] },
        ]}>
        {state.save === 'failed' ? (
          <Text variant="body-small" accessibilityLiveRegion="polite" style={styles.failed}>
            {EDIT_SAVE_FAILED}
          </Text>
        ) : null}
        <SaveButton disabled={!canSave} busy={saving} onPress={onSave} />
      </View>
      <StateSearchSheet
        visible={open === 'states'}
        selected={draft.states}
        onToggle={onToggleState}
        onClose={close}
        onClosed={refocus}
      />
      <AllergenChooserSheet
        visible={open === 'allergens'}
        selected={draft.allergens}
        onToggle={onToggleAllergen}
        onClear={onClearAllergens}
        onClose={close}
        onClosed={refocus}
      />
      <RetailerSearchSheet
        catalog
        visible={open === 'retailers'}
        selected={draft.retailers}
        onToggle={onToggleStore}
        onClose={close}
        onClosed={refocus}
      />
    </Surface>
  );
}

/** The page before the saved preferences have answered: Cancel and the honest message. */
export function EditPreferencesPending({
  status,
  onCancel,
}: {
  status: 'loading' | 'failed' | 'unsupported';
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Surface background="background/page" style={styles.page}>
      <View style={[styles.topBar, { paddingTop: insets.top + spacing[8] }]}>
        <CancelAction onPress={onCancel} />
      </View>
      <View style={styles.pending}>
        <PreferencesNotReady status={status} />
      </View>
    </Surface>
  );
}

/**
 * `Cancel`: back to Ready with nothing saved. Locked while a save is in
 * flight (2026-10-04) — the draft being written must not be abandoned
 * half-way, and the page leaves on its own the moment the write lands.
 */
function CancelAction({ onPress, disabled = false }: { onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={disabled ? EDIT_CANCEL_LOCKED_HINT : EDIT_CANCEL_HINT}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}>
      <Text variant="body" color="action/secondary" style={EDITOR_TYPE.cancel}>
        {EDIT_CANCEL}
      </Text>
    </Pressable>
  );
}

/** One category: its artwork, its title and count, its helper, Edit and the chips. */
function Section({
  title,
  count,
  helper,
  artwork,
  editLabel,
  editRef,
  onEdit,
  chips,
  onRemove,
  rows,
  after,
}: {
  title: string;
  count: number;
  helper: string;
  artwork: ReactNode;
  editLabel: string;
  editRef: React.Ref<View>;
  onEdit: () => void;
  chips: Chip[];
  onRemove: (id: string) => void;
  /** At the accessibility sizes: full-width rows with their own Remove. */
  rows: boolean;
  after?: ReactNode;
}) {
  return (
    <View style={[styles.section, rows && styles.sectionStacked]}>
      <View {...DECORATIVE} style={rows ? styles.iconStacked : styles.iconColumn}>
        {artwork}
      </View>
      <View style={styles.sectionBody}>
        <View style={[styles.titleRow, rows && styles.titleRowStacked]}>
          {/* The title and its count, heard as one heading. */}
          <View
            accessible
            accessibilityRole="header"
            accessibilityLabel={`${title}, ${editSelectedCount(count)}`}
            style={styles.titleText}>
            <Text variant="display" style={EDITOR_TYPE.sectionTitle}>
              {title}
            </Text>
            <Text variant="body-small" color="text/secondary" style={EDITOR_TYPE.count}>
              {editSelectedCount(count)}
            </Text>
          </View>
          <Pressable
            ref={editRef}
            accessibilityRole="button"
            accessibilityLabel={editLabel}
            accessibilityHint={EDIT_CHOOSER_HINT}
            onPress={onEdit}
            style={({ pressed }) => [
              styles.edit,
              rows && styles.editStacked,
              pressed && styles.pressed,
            ]}>
            <Text variant="body" color="action/secondary" style={EDITOR_TYPE.edit}>
              {EDIT_ACTION}
            </Text>
            <Icon name="chevron-right" size={20} color="icon/brand" />
          </Pressable>
        </View>
        <Text variant="caption" color="text/secondary" style={[EDITOR_TYPE.helper, styles.helper]}>
          {helper}
        </Text>
        {chips.length > 0 ? (
          <View style={rows ? styles.chipRows : styles.chips}>
            {chips.map((chip) =>
              rows ? (
                <ChipRow key={chip.id} chip={chip} onRemove={onRemove} />
              ) : (
                <ChipPill key={chip.id} chip={chip} onRemove={onRemove} />
              ),
            )}
          </View>
        ) : null}
        {after}
      </View>
    </View>
  );
}

/**
 * A chosen value as a soft blue pill, the whole pill its own removal control
 * named for the value; 32pt drawn, 44pt by hitSlop.
 */
function ChipPill({ chip, onRemove }: { chip: Chip; onRemove: (id: string) => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={removeChipLabel(chip.name)}
      hitSlop={{ top: CHIP_SLOP, bottom: CHIP_SLOP }}
      onPress={() => onRemove(chip.id)}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
      <View style={styles.chipWash} />
      <Text variant="body-small-bold" style={[EDITOR_TYPE.chip, styles.chipText]}>
        {chip.name}
      </Text>
      <Icon name="x" size={16} color="icon/primary" />
    </Pressable>
  );
}

/** A chosen value at the accessibility sizes: a full-width row and its own Remove. */
function ChipRow({ chip, onRemove }: { chip: Chip; onRemove: (id: string) => void }) {
  return (
    <View style={styles.chipRow}>
      <View style={styles.chipWash} />
      <Text variant="body-small-bold" style={[EDITOR_TYPE.chip, styles.chipRowText]}>
        {chip.name}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={removeChipLabel(chip.name)}
        onPress={() => onRemove(chip.id)}
        style={({ pressed }) => [styles.remove, pressed && styles.pressed]}>
        <Icon name="x" size={24} color="icon/primary" />
      </Pressable>
    </View>
  );
}

/** `Add allergens`: a drawn circled plus and the blue words, one 44pt button. */
function AddAllergens({ ref, onPress }: { ref: React.Ref<View>; onPress: () => void }) {
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityHint={EDIT_CHOOSER_HINT}
      onPress={onPress}
      style={({ pressed }) => [styles.add, pressed && styles.pressed]}>
      <View {...DECORATIVE} style={styles.plusCircle}>
        <View style={styles.plusBar} />
        <View style={[styles.plusBar, styles.plusBarVertical]} />
      </View>
      <Text variant="body-small-bold" color="action/secondary" style={EDITOR_TYPE.add}>
        {EDIT_ADD_ALLERGENS}
      </Text>
    </Pressable>
  );
}

/**
 * The allergens section's artwork: the draft's first two pictograms in
 * canonical order, untinted (one for one); the neutral dash for none.
 */
function AllergenMark({ tokens }: { tokens: readonly string[] }) {
  const artwork = allergenArtwork(tokens);
  if (artwork.kind === 'none') return <View style={styles.dash} />;
  const [first, second] = artwork.tokens;
  const picture = (token: string, side: number) => (
    <Image
      source={allergenPictogram(token) ?? undefined}
      resizeMode="contain"
      accessible={false}
      style={{ width: side, height: side }}
    />
  );
  if (second === undefined) return picture(first, EDITOR_PICTOGRAM.single);
  return (
    <View style={styles.pair}>
      <View style={styles.pairFirst}>{picture(first, EDITOR_PICTOGRAM.pair)}</View>
      <View style={styles.pairSecond}>{picture(second, EDITOR_PICTOGRAM.pair)}</View>
    </View>
  );
}

function Rule() {
  return <View {...DECORATIVE} style={styles.rule} />;
}

/**
 * `Save changes`: the shared Button's primary treatment at 46pt, disabled
 * (with its reason spoken) while no state is chosen, busy while saving.
 */
function SaveButton({
  disabled,
  busy,
  onPress,
}: {
  disabled: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={disabled ? EDIT_SAVE_NEEDS_STATE : EDIT_SAVE_HINT}
      accessibilityState={{ disabled, busy }}
      disabled={disabled || busy}
      onPress={onPress}>
      {({ pressed }) => (
        <View style={[styles.save, disabled && styles.saveInert, pressed && styles.pressed]}>
          <Text
            variant="body-small-bold"
            color={disabled ? 'text/primary' : 'text/inverse'}
            style={styles.saveLabel}>
            {EDIT_SAVE}
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
  pending: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: EDITOR_MARGIN,
  },
  topBar: {
    paddingHorizontal: EDITOR_MARGIN - spacing[8],
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  cancel: {
    alignSelf: 'flex-start',
    minHeight: hitTarget.minimum,
    minWidth: hitTarget.minimum,
    paddingHorizontal: spacing[8],
    justifyContent: 'center',
  },
  content: {
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: EDITOR_MARGIN,
    paddingBottom: spacing[16],
  },
  heading: {
    gap: spacing[8],
    paddingTop: spacing[4],
    paddingBottom: spacing[16],
  },
  rule: {
    height: 1,
    backgroundColor: color['border/subtle'],
  },
  section: {
    flexDirection: 'row',
    gap: SECTION_ICON_GAP,
    paddingVertical: SECTION_PADDING,
  },
  iconColumn: {
    width: SECTION_ICON_COLUMN,
    paddingTop: spacing[4],
  },
  // At the accessibility sizes the artwork, the heading and Edit stack, so
  // the words take the page's whole width and never break inside a word.
  sectionStacked: {
    flexDirection: 'column',
    gap: spacing[8],
  },
  iconStacked: {
    alignSelf: 'flex-start',
  },
  titleRowStacked: {
    flexDirection: 'column',
    gap: 0,
  },
  editStacked: {
    paddingLeft: 0,
    alignItems: 'center',
  },
  sectionBody: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[8],
  },
  titleText: {
    flex: 1,
  },
  // Its 44pt box shares the heading's top edge, so VoiceOver reads the
  // heading first (iOS orders by top edge), and its words sit level with
  // the title at the top of the box.
  edit: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[4],
    minHeight: hitTarget.minimum,
    paddingLeft: spacing[8],
    paddingTop: 1,
  },
  helper: {
    marginTop: spacing[4],
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing[8],
    rowGap: CHIP_ROW_GAP,
    marginTop: spacing[12],
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[12],
    minHeight: CHIP_HEIGHT,
    maxWidth: '100%',
    paddingLeft: spacing[16],
    paddingRight: spacing[12],
    paddingVertical: spacing[4],
    borderRadius: radius.full,
    overflow: 'hidden',
    backgroundColor: color['background/subtle'],
  },
  // The white wash that gives the chips the target's paler blue.
  chipWash: {
    ...StyleSheet.absoluteFill,
    backgroundColor: color['background/surface'],
    opacity: 0.5,
  },
  chipText: {
    flexShrink: 1,
  },
  chipRows: {
    gap: spacing[8],
    marginTop: spacing[12],
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[4],
    minHeight: hitTarget.minimum,
    paddingLeft: spacing[16],
    paddingVertical: spacing[4],
    borderRadius: radius[12],
    overflow: 'hidden',
    backgroundColor: color['background/subtle'],
  },
  chipRowText: {
    flex: 1,
  },
  remove: {
    minWidth: hitTarget.minimum,
    minHeight: hitTarget.minimum,
    alignItems: 'center',
    justifyContent: 'center',
  },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing[8],
    minHeight: hitTarget.minimum,
    marginTop: spacing[4],
    marginBottom: -spacing[8],
  },
  plusCircle: {
    width: 20,
    height: 20,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: color['icon/brand'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusBar: {
    position: 'absolute',
    width: 10,
    height: 1.5,
    borderRadius: radius.full,
    backgroundColor: color['icon/brand'],
  },
  plusBarVertical: {
    width: 1.5,
    height: 10,
  },
  dash: {
    width: 14,
    height: 2,
    marginTop: spacing[12],
    borderRadius: radius.full,
    backgroundColor: color['icon/primary'],
  },
  pair: {
    width: EDITOR_PICTOGRAM.pair + EDITOR_PICTOGRAM.step,
    height: EDITOR_PICTOGRAM.pair + EDITOR_PICTOGRAM.step,
  },
  pairFirst: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  pairSecond: {
    position: 'absolute',
    left: EDITOR_PICTOGRAM.step,
    top: EDITOR_PICTOGRAM.step,
  },
  captionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[12],
    marginTop: spacing[8],
  },
  caption: {
    flex: 1,
  },
  footer: {
    width: '100%',
    paddingHorizontal: EDITOR_MARGIN,
    paddingTop: spacing[12],
    gap: spacing[8],
    borderTopWidth: 1,
    borderTopColor: 'transparent',
    backgroundColor: color['background/page'],
  },
  footerRule: {
    borderTopColor: color['border/subtle'],
  },
  failed: {
    textAlign: 'center',
  },
  save: {
    minHeight: SAVE_MIN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[8],
    borderRadius: radius.full,
    backgroundColor: color['action/primary'],
  },
  saveInert: {
    backgroundColor: color['action/disabled'],
  },
  saveLabel: {
    ...EDITOR_TYPE.save,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
