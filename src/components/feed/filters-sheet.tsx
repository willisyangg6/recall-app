/**
 * The Feed's Filters sheet (2026-10-06, the approved Feed + Filters design,
 * docs/lotly-feed-filters-source-kit/spec/COMPONENT-CONTRACT.md "Expanded
 * Filters sheet"). One sheet, on both feeds, replacing the three
 * single-dimension pickers: Location, Risk level and Category together.
 *
 * ## Behaviour
 *
 * - It edits a DRAFT of the opening feed's applied filters
 *   (lib/feed-filter-draft.ts). Apply filters commits the draft; Close, a
 *   tap on the dimmed feed and Android's back discard it. Clear all empties
 *   the draft only. Nothing here reads or writes saved preferences.
 * - Every dimension stays multi-select. "All risks" / "All categories" /
 *   "All locations" are the empty selection, so they and a specific option
 *   are never both selected.
 * - Every option the filter supports is offered: the seven consumer risk
 *   tiers and the nine launch categories. The sheet scrolls rather than
 *   shrinking anything.
 * - Location opens the 52-jurisdiction list as a page inside the sheet,
 *   with the Profile state chooser's own search (`filterStateChoices` and its
 *   words): the search narrows what is listed, never what is chosen. Back
 *   and Done return with the draft kept.
 *
 * ## Accessibility
 *
 * The sheet is the modal view (VoiceOver stays inside it); its title and
 * section titles are headers; every option is a button announcing its
 * selected state, and selection is never colour alone (a tick, and for a
 * category a heavier border). Close, Clear all and Apply are at least 44pt.
 * From the accessibility text sizes the categories, the risk options and the
 * footer's two actions each take a single column.
 *
 * ## Motion
 *
 * The shared sheet motion (hooks/use-sheet-motion.ts): the slide begins when
 * the Modal has presented its view, closing slides out first, and Reduce
 * Motion is immediate both ways.
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

import { Icon, type IconName } from '@/components/ui/icon';
import { SearchBar } from '@/components/ui/search-bar';
import { Text } from '@/components/ui/text';
import { riskPalette } from '@/constants/design-tokens';
import {
  CATEGORY_STYLE,
  feedColor,
  feedGeometry,
  feedType,
  type CategoryStyle,
} from '@/constants/feed-design';
import type { FoodCategoryId } from '@/domain/food-category';
import { LAUNCH_CATEGORY_OPTIONS } from '@/domain/food-category-launch';
import { stateNameForCode, SUPPORTED_STATE_CODES } from '@/domain/preferences';
import type { ConsumerRiskTier } from '@/domain/risk-tier';
import { useSheetMotion } from '@/hooks/use-sheet-motion';
import {
  ALL_LOCATIONS,
  clearDraft,
  committedFilters,
  isAllSelected,
  locationNote,
  locationSummary,
  selectAllInDimension,
  toggleDraftOption,
} from '@/lib/feed-filter-draft';
import { RISK_FILTER_TIERS, type FeedFilterState } from '@/lib/feed-filters';
import {
  filterStateChoices,
  STATE_SEARCH_HINT,
  STATE_SEARCH_LABEL,
  STATE_SEARCH_NO_MATCH,
  STATE_SEARCH_PLACEHOLDER,
} from '@/lib/personalization-screen';
import { riskTierWord } from '@/lib/risk-display';

/** From this text scale the grids and the footer take one column. */
export const FILTERS_SINGLE_COLUMN_SCALE = 1.5;

export const FILTERS_TITLE = 'Filters';
export const APPLY_FILTERS_LABEL = 'Apply filters';
export const CLEAR_ALL_LABEL = 'Clear all';
export const ALL_RISKS_LABEL = 'All risks';
export const ALL_CATEGORIES_LABEL = 'All categories';

/** The Location page's 52 canonical jurisdictions, alphabetical by name. */
const LOCATION_CHOICES = SUPPORTED_STATE_CODES.map((code) => ({
  code,
  name: stateNameForCode(code) as string,
})).sort((a, b) => a.name.localeCompare(b.name));

const RISK_OPTIONS = RISK_FILTER_TIERS.map((tier) => ({ tier, label: riskTierWord(tier) }));

const CATEGORY_OPTIONS = LAUNCH_CATEGORY_OPTIONS.map((option) => ({
  ...option,
  style: (CATEGORY_STYLE as Partial<Record<string, CategoryStyle>>)[option.value] ?? null,
}));

export function FiltersSheet({
  visible,
  applied,
  onApply,
  onClose,
  onClosed,
}: {
  visible: boolean;
  /** The opening feed's applied filters: the draft starts from these. */
  applied: FeedFilterState;
  /** Apply filters: the committed draft (categories through the allowlist). */
  onApply: (next: FeedFilterState) => void;
  /**
   * Leaving the sheet: Close, the backdrop and Android's back (which discard
   * the draft), and the close that follows Apply.
   */
  onClose: () => void;
  /** After the sheet is gone: focus returns to the Filters button. */
  onClosed?: () => void;
}) {
  const { height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const single = fontScale >= FILTERS_SINGLE_COLUMN_SCALE;
  const { shown, progress, onShow, onDismiss } = useSheetMotion(visible);

  // The draft restarts from the applied filters each time the sheet opens.
  const [draft, setDraft] = useState<FeedFilterState>(applied);
  const [page, setPage] = useState<'main' | 'location'>('main');
  // The Location page's search, the Profile state chooser's own matcher and
  // words; it narrows what is listed and never what is chosen.
  const [locationQuery, setLocationQuery] = useState('');
  const shownLocations = filterStateChoices(LOCATION_CHOICES, locationQuery);
  const [wasVisible, setWasVisible] = useState(visible);
  if (wasVisible !== visible) {
    setWasVisible(visible);
    if (visible) {
      setDraft(applied);
      setPage('main');
    }
  }
  const [contentWidth, setContentWidth] = useState(0);

  const maxHeight = height - insets.top - 12;
  const columnWidth =
    contentWidth > 0 && !single ? (contentWidth - feedGeometry.categoryGridGap) / 2 : undefined;

  // Apply hands the draft over, then leaves the sheet the ordinary way.
  const apply = () => {
    onApply(committedFilters(draft));
    onClose();
  };

  return (
    <Modal
      visible={shown}
      transparent
      animationType="none"
      onRequestClose={page === 'location' ? () => setPage('main') : onClose}
      onShow={onShow}
      onDismiss={() => {
        onDismiss();
        onClosed?.();
      }}
      statusBarTranslucent>
      <View style={styles.root}>
        <Animated.View pointerEvents="none" style={[styles.scrim, { opacity: progress }]} />
        {/* A tap on the dimmed feed discards, as Close does; VoiceOver uses Close. */}
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
            // The Location page takes the full height, so its search results
            // start under the field and stay above the keyboard; a sheet
            // sized to a short filtered list sat wholly behind it.
            page === 'location' ? { height: maxHeight } : { maxHeight },
            {
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
          <View
            style={styles.handle}
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
          {page === 'main' ? (
            <>
              {/* From the accessibility text sizes the title scrolls with the
                  options, so the fixed chrome is only Close and the footer and
                  a small screen keeps room for the choices themselves. */}
              <View style={[styles.header, single && styles.headerCloseOnly]}>
                {single ? null : <SheetTitle />}
                <IconButton
                  icon="close"
                  label="Close filters"
                  hint="Discards changes you haven’t applied."
                  onPress={onClose}
                />
              </View>
              <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                onLayout={(event) =>
                  setContentWidth(event.nativeEvent.layout.width - 2 * feedGeometry.sheetPadding)
                }>
                {single ? <SheetTitle /> : null}
                <SectionTitle icon="map-pin" title="Location" />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Location, ${locationSummary(draft.stateCodes)}`}
                  accessibilityHint="Opens the list of states."
                  onPress={() => {
                    setLocationQuery('');
                    setPage('location');
                  }}
                  style={({ pressed }) => [styles.locationRow, pressed && styles.pressed]}>
                  <View style={styles.locationText}>
                    <Text style={[feedType.control, styles.ink]}>
                      {locationSummary(draft.stateCodes)}
                    </Text>
                    {locationNote(draft.stateCodes) ? (
                      <Text style={[feedType.meta, styles.secondary]}>
                        {locationNote(draft.stateCodes)}
                      </Text>
                    ) : null}
                  </View>
                  <Icon name="chevron-right" size={20} color="icon/primary" />
                </Pressable>

                <View style={styles.separator} />

                <SectionTitle icon="warning" title="Risk level" />
                <View style={[styles.flow, single && styles.column]}>
                  <Choice
                    label={ALL_RISKS_LABEL}
                    selected={isAllSelected(draft, 'riskTiers')}
                    palette="all"
                    onPress={() => setDraft(selectAllInDimension(draft, 'riskTiers'))}
                  />
                  {RISK_OPTIONS.map(({ tier, label }) => (
                    <Choice
                      key={tier}
                      label={label}
                      selected={draft.riskTiers.includes(tier)}
                      palette={tier}
                      onPress={() => setDraft(toggleDraftOption(draft, 'riskTiers', tier))}
                    />
                  ))}
                </View>

                <View style={styles.separator} />

                <SectionTitle icon="categories" title="Category" />
                <Choice
                  label={ALL_CATEGORIES_LABEL}
                  selected={isAllSelected(draft, 'categoryIds')}
                  palette="all"
                  full
                  onPress={() => setDraft(selectAllInDimension(draft, 'categoryIds'))}
                />
                <View style={[styles.grid, single && styles.column]}>
                  {CATEGORY_OPTIONS.map((option) =>
                    option.style ? (
                      <CategoryChoice
                        key={option.value}
                        label={option.label}
                        style={option.style}
                        width={columnWidth}
                        selected={draft.categoryIds.includes(option.value as FoodCategoryId)}
                        onPress={() =>
                          setDraft(toggleDraftOption(draft, 'categoryIds', option.value))
                        }
                      />
                    ) : null,
                  )}
                </View>
              </ScrollView>
              <View
                style={[
                  styles.footer,
                  single && styles.footerStacked,
                  { paddingBottom: feedGeometry.footerPadding + insets.bottom },
                ]}>
                {single ? <ApplyButton onPress={apply} stacked /> : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityHint="Clears every filter here. Apply filters to show all recalls."
                  onPress={() => setDraft(clearDraft())}
                  style={({ pressed }) => [styles.clearAll, pressed && styles.pressed]}>
                  <Text style={[feedType.control, styles.ink]}>{CLEAR_ALL_LABEL}</Text>
                </Pressable>
                {single ? null : <ApplyButton onPress={apply} />}
              </View>
            </>
          ) : (
            <>
              <View style={styles.header}>
                <IconButton
                  icon="chevron-left"
                  label="Back to filters"
                  onPress={() => setPage('main')}
                />
                <Text
                  accessibilityRole="header"
                  style={[feedType.section, styles.ink, styles.pageTitle]}>
                  Location
                </Text>
              </View>
              <View style={styles.locationSearch}>
                <SearchBar
                  value={locationQuery}
                  onChangeText={setLocationQuery}
                  placeholder={STATE_SEARCH_PLACEHOLDER}
                  accessibilityLabel={STATE_SEARCH_LABEL}
                  accessibilityHint={STATE_SEARCH_HINT}
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="search"
                  appearance="outline"
                />
              </View>
              <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
                automaticallyAdjustKeyboardInsets>
                {locationQuery.trim() === '' ? (
                  <ListRow
                    label={ALL_LOCATIONS}
                    selected={isAllSelected(draft, 'stateCodes')}
                    onPress={() => setDraft(selectAllInDimension(draft, 'stateCodes'))}
                  />
                ) : null}
                {shownLocations.length === 0 ? (
                  <Text accessibilityLiveRegion="polite" style={[feedType.meta, styles.secondary]}>
                    {STATE_SEARCH_NO_MATCH}
                  </Text>
                ) : (
                  shownLocations.map((choice) => (
                    <ListRow
                      key={choice.code}
                      label={choice.name}
                      selected={draft.stateCodes.includes(choice.code)}
                      onPress={() => setDraft(toggleDraftOption(draft, 'stateCodes', choice.code))}
                    />
                  ))
                )}
              </ScrollView>
              <View
                style={[
                  styles.footer,
                  { paddingBottom: feedGeometry.footerPadding + insets.bottom },
                ]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityHint="Returns to filters. Nothing is applied yet."
                  onPress={() => setPage('main')}
                  style={({ pressed }) => [styles.apply, pressed && styles.pressed]}>
                  <Text style={[feedType.control, styles.inverse]}>Done</Text>
                </Pressable>
              </View>
            </>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

function SheetTitle() {
  return (
    <Text accessibilityRole="header" style={[feedType.sheetHeading, styles.ink]}>
      {FILTERS_TITLE}
    </Text>
  );
}

function SectionTitle({ icon, title }: { icon: IconName; title: string }) {
  return (
    <View style={styles.sectionTitle}>
      <Icon name={icon} size={24} color="icon/primary" />
      <Text accessibilityRole="header" style={[feedType.section, styles.ink, styles.shrink]}>
        {title}
      </Text>
    </View>
  );
}

function IconButton({
  icon,
  label,
  hint,
  onPress,
}: {
  icon: IconName;
  label: string;
  hint?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
      <Icon name={icon} size={24} color="icon/primary" />
    </Pressable>
  );
}

function ApplyButton({ onPress, stacked }: { onPress: () => void; stacked?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.apply,
        stacked && styles.applyStacked,
        pressed && styles.pressed,
      ]}>
      <Text style={[feedType.control, styles.inverse, styles.center]}>{APPLY_FILTERS_LABEL}</Text>
    </Pressable>
  );
}

/** A risk option or an "All" control: neutral until chosen, then its own colours + a tick. */
function Choice({
  label,
  selected,
  palette,
  full,
  onPress,
}: {
  label: string;
  selected: boolean;
  palette: ConsumerRiskTier | 'all';
  full?: boolean;
  onPress: () => void;
}) {
  const chosen =
    palette === 'all'
      ? ({
          background: feedColor.brand,
          foreground: feedColor.inverse,
          border: feedColor.brand,
        } as const)
      : riskPalette[palette];
  const colours = selected
    ? chosen
    : ({
        background: feedColor.surface,
        foreground: feedColor.text,
        border: feedColor.border,
      } as const);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        full && styles.choiceFull,
        { backgroundColor: colours.background, borderColor: colours.border },
        pressed && styles.pressed,
      ]}>
      {selected ? <Icon name="tick" size={20} tint={colours.foreground} /> : null}
      <Text style={[feedType.control, styles.shrink, { color: colours.foreground }]}>{label}</Text>
    </Pressable>
  );
}

function CategoryChoice({
  label,
  style,
  width,
  selected,
  onPress,
}: {
  label: string;
  style: CategoryStyle;
  width: number | undefined;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.category,
        width !== undefined ? { width } : styles.categoryFull,
        {
          backgroundColor: style.background,
          borderColor: selected ? style.foreground : style.border,
          borderWidth: selected ? 2 : 1,
          // Keep the content still when the border thickens.
          padding: selected
            ? feedGeometry.categoryControlPadding - 1
            : feedGeometry.categoryControlPadding,
        },
        pressed && styles.pressed,
      ]}>
      <Icon name={style.icon} size={20} tint={style.foreground} />
      <Text style={[feedType.metaStrong, styles.categoryText, { color: style.foreground }]}>
        {label}
      </Text>
      {selected ? <Icon name="tick" size={20} tint={style.foreground} /> : null}
    </Pressable>
  );
}

/** One Location page row: the name, and a tick when chosen. */
function ListRow({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}>
      <Text style={[selected ? feedType.control : feedType.body, styles.ink, styles.shrink]}>
        {label}
      </Text>
      {selected ? <Icon name="tick" size={20} color="icon/primary" /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: feedColor.scrim,
  },
  sheet: {
    backgroundColor: feedColor.page,
    borderTopLeftRadius: feedGeometry.sheetRadius,
    borderTopRightRadius: feedGeometry.sheetRadius,
    width: '100%',
    maxWidth: 800,
    alignSelf: 'center',
  },
  handle: {
    alignSelf: 'center',
    width: feedGeometry.handleWidth,
    height: feedGeometry.handleHeight,
    borderRadius: 2,
    backgroundColor: feedColor.border,
    marginTop: 10,
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: feedGeometry.sheetPadding,
  },
  headerCloseOnly: {
    justifyContent: 'flex-end',
  },
  pageTitle: {
    flex: 1,
  },
  ink: {
    color: feedColor.text,
  },
  secondary: {
    color: feedColor.secondary,
  },
  inverse: {
    color: feedColor.inverse,
  },
  center: {
    textAlign: 'center',
  },
  shrink: {
    flexShrink: 1,
  },
  pressed: {
    opacity: 0.6,
  },
  iconButton: {
    minWidth: feedGeometry.touchMin,
    minHeight: feedGeometry.touchMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  scrollContent: {
    paddingHorizontal: feedGeometry.sheetPadding,
    paddingTop: feedGeometry.sheetSectionGap,
    paddingBottom: feedGeometry.sheetSectionGap,
    gap: 12,
  },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  locationSearch: {
    paddingHorizontal: feedGeometry.sheetPadding,
    paddingTop: 12,
  },
  locationRow: {
    minHeight: feedGeometry.locationRowMinHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: feedColor.border,
    borderRadius: feedGeometry.controlRadius,
    backgroundColor: feedColor.surface,
  },
  locationText: {
    flex: 1,
    minWidth: 0,
  },
  separator: {
    height: 1,
    backgroundColor: feedColor.divider,
    marginVertical: 4,
  },
  flow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: feedGeometry.categoryGridGap,
  },
  column: {
    flexDirection: 'column',
  },
  choice: {
    minHeight: feedGeometry.touchMin,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: feedGeometry.badgeRadius,
    maxWidth: '100%',
  },
  choiceFull: {
    justifyContent: 'flex-start',
  },
  category: {
    minHeight: feedGeometry.categoryControlMinHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: feedGeometry.badgeRadius,
  },
  categoryFull: {
    width: '100%',
  },
  categoryText: {
    flex: 1,
    minWidth: 0,
  },
  listRow: {
    minHeight: feedGeometry.touchMin,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: feedColor.divider,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: feedGeometry.footerPadding,
    paddingTop: feedGeometry.footerPadding,
    borderTopWidth: 1,
    borderTopColor: feedColor.divider,
    backgroundColor: feedColor.page,
  },
  footerStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  clearAll: {
    minHeight: feedGeometry.touchMin,
    minWidth: feedGeometry.touchMin,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  // In the stacked footer the button takes its content height, full width.
  applyStacked: {
    flex: 0,
  },
  apply: {
    flex: 1,
    minHeight: feedGeometry.applyMinHeight,
    borderRadius: feedGeometry.controlRadius,
    backgroundColor: feedColor.brand,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
});
