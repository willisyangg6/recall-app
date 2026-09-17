import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  View,
} from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { StateMessage } from '@/components/state-message';
import { Callout } from '@/components/ui/callout';
import { RecallCard } from '@/components/recall-card';
import { Chip } from '@/components/ui/chip';
import { SearchBar } from '@/components/ui/search-bar';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import {
  color,
  hitSlopToMinimum,
  hitTarget,
  layout,
  radius,
  spacing,
  typography,
} from '@/constants/design-tokens';
import type { FoodCategoryId } from '@/domain/food-category';
import { LAUNCH_CATEGORY_OPTIONS, sanitizeLaunchCategoryIds } from '@/domain/food-category-launch';
import {
  hasAnyPreference,
  stateNameForCode,
  SUPPORTED_STATE_CODES,
  type UserRecallPreferences,
} from '@/domain/preferences';
import { useFeed } from '@/hooks/use-feed';
import { buildAffectsMeSections } from '@/lib/affects-me-ranking';
import {
  FEED_EMPTY_CORPUS,
  FEED_EMPTY_FILTERS,
  FEED_EMPTY_PERSONALIZED,
  FEED_EMPTY_SEARCH,
  FEED_ERROR_TITLE,
  FEED_LOADING,
  FEED_NOT_CONFIGURED,
  FEED_NOT_CONFIGURED_DEV,
  FEED_STALE_NOTICE,
  OLDER_NOTICES_EXPLANATION,
  PERSONALIZE_CTA,
} from '@/lib/feed-copy';
import {
  activeFilterCount,
  applyFeedFilters,
  EMPTY_FEED_FILTERS,
  hasActiveFilters,
  orderByLocationTiers,
  RISK_FILTER_TIERS,
  sameFeedFilters,
  type FeedFilterState,
} from '@/lib/feed-filters';
import { buildSearchEntry, filterBySearch, type SearchEntry } from '@/lib/feed-search';
import { buildFeedSections } from '@/lib/feed-relevance';
import { loadPreferences, preferencesAvailable } from '@/lib/preferences-store';
import { isFeedConfigured, type FeedItem } from '@/lib/recall-feed';
import { buildHomeCardModel, todayIso } from '@/lib/recall-presentation';
import { evaluatePersonalRelevance, type PersonalRelevance } from '@/lib/relevance';
import { riskTierWord } from '@/lib/risk-display';

/**
 * The Feed (P2B1 appearance; behaviour unchanged since C10B / P2A).
 *
 * Visually this is Figma `home` (81:793) — the warm page, the search bar,
 * the chip row, the section heading and the recall cards, drawn from the
 * design tokens and the shared primitives, laid out against the real device
 * width and safe areas. Everything the screen DOES is exactly what it did
 * before: the one feed session, search over the loaded corpus, the All /
 * Affects me modes, the All-only Location / Risk / Category filters and
 * their sheets, the sectioning and ordering, the personalization verdict,
 * the save control, and the deep link into Recall Details. Figma's
 * notification bell has no product behaviour and is not rendered; its
 * `Urgency` chip is the shipped `Risk` filter.
 *
 * The screen header is the navigator's ("Feed", styled in the tab layout).
 * The development-only Design Preview harness is reachable from Profile
 * alone and has no entry here.
 */

type FeedTab = 'affects_me' | 'all';

/**
 * The user's preferences, reloaded on every focus so edits in Settings
 * recalculate "Affects me" immediately. The default tab is chosen ONCE per
 * app session from whether any personalization exists — after that the tab
 * is the user's own choice.
 */
function usePreferences(onFirstLoad: (prefs: UserRecallPreferences) => void) {
  const [prefs, setPrefs] = useState<UserRecallPreferences | null>(null);
  const initialized = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (!preferencesAvailable()) return;
      void loadPreferences().then((loaded) => {
        setPrefs(loaded);
        if (!initialized.current) {
          initialized.current = true;
          onFirstLoad(loaded);
        }
      });
    }, [onFirstLoad]),
  );

  return prefs;
}

/** The Location sheet's 52 canonical jurisdictions, alphabetical by name. */
const LOCATION_OPTIONS = SUPPORTED_STATE_CODES.map((code) => ({
  value: code,
  label: stateNameForCode(code) as string,
})).sort((a, b) => a.label.localeCompare(b.label));

/** The Risk sheet's canonical tiers, existing labels only. */
const RISK_OPTIONS = RISK_FILTER_TIERS.map((tier) => ({
  value: tier as string,
  label: riskTierWord(tier),
}));

/**
 * The Category sheet's nine launch-visible aisles, in canonical display order.
 * Imported whole from the one place the allowlist is defined — Prepared foods,
 * Supplements and Other are absent because that module hides them, never
 * because this screen filters them out (see domain/food-category-launch.ts).
 */
const CATEGORY_OPTIONS = LAUNCH_CATEGORY_OPTIONS.map((option) => ({ ...option }));

/** A one-caption-line control reaches the 44pt target through hitSlop. */
const CAPTION_HIT_SLOP = hitSlopToMinimum(typography.caption.lineHeight);

/**
 * A sheet action: the primary Apply as a brand-navy pill, Cancel and Clear
 * as bordered white pills — each a full 44pt target on its own.
 */
function SheetButton({
  label,
  primary,
  onPress,
}: {
  label: string;
  primary?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}>
      <Surface
        background={primary ? 'background/brand' : 'background/surface'}
        border={primary ? undefined : 'border/default'}
        radius="full"
        style={styles.sheetButton}>
        <Text variant="caption" color={primary ? 'text/inverse' : 'text/primary'}>
          {label}
        </Text>
      </Surface>
    </Pressable>
  );
}

/**
 * Modal multi-select for one filter dimension. Selections are a DRAFT until
 * Apply — Cancel discards, Clear empties the dimension. This is browsing
 * state for the current session, never a saved preference.
 */
function FilterSheet({
  title,
  options,
  selected,
  onApply,
  onClose,
}: {
  title: string;
  options: { value: string; label: string }[];
  selected: string[];
  onApply: (next: string[]) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<string[]>(selected);
  const toggle = (value: string) =>
    setDraft((prior) =>
      prior.includes(value) ? prior.filter((v) => v !== value) : [...prior, value],
    );
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Surface style={[styles.sheet, { paddingBottom: spacing[16] + insets.bottom }]}>
          <Text variant="heading-3" accessibilityRole="header">
            {title}
          </Text>
          <ScrollView style={styles.sheetList} keyboardShouldPersistTaps="handled">
            {options.map((option) => {
              const isSelected = draft.includes(option.value);
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isSelected }}
                  accessibilityLabel={option.label}
                  onPress={() => toggle(option.value)}
                  style={({ pressed }) => [styles.sheetItem, pressed && styles.pressed]}>
                  <Text variant="body">{isSelected ? `✓ ${option.label}` : option.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.sheetActions}>
            <SheetButton label="Cancel" onPress={onClose} />
            <SheetButton label="Clear selection" onPress={() => setDraft([])} />
            <SheetButton
              label="Apply"
              primary
              onPress={() => {
                onApply(draft);
                onClose();
              }}
            />
          </View>
        </Surface>
      </View>
    </Modal>
  );
}

/** Compact invitation to personalize — never a permission prompt. */
function PersonalizeCta({ compact }: { compact?: boolean }) {
  return (
    <Link href="/settings/personalization" asChild>
      <Pressable accessibilityRole="button" style={({ pressed }) => pressed && styles.pressed}>
        <Surface background="background/subtle" radius={12} style={styles.callout}>
          <Text variant="heading-3">{PERSONALIZE_CTA.title}</Text>
          <Text variant="body-small">
            {compact ? PERSONALIZE_CTA.compactBody : PERSONALIZE_CTA.body}
          </Text>
        </Surface>
      </Pressable>
    </Link>
  );
}

/** The warm page every Feed state sits on. */
function Page({ children }: { children: React.ReactNode }) {
  return (
    <Surface background="background/page" style={styles.page}>
      {children}
    </Surface>
  );
}

interface HomeSection {
  key: 'affects' | 'recent' | 'older';
  title: string;
  data: FeedItem[];
}

export default function HomeScreen() {
  const { state, refreshing, refresh, staleMessage } = useFeed();
  const [showOlder, setShowOlder] = useState(false);
  const [tab, setTab] = useState<FeedTab>('all');
  // Browsing state (C6): session-only, in memory, never persisted, never part
  // of the personalization profile. Filters apply to All Recalls; switching to
  // Affects me ignores them TEMPORARILY while preserving the selections.
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<FeedFilterState>(EMPTY_FEED_FILTERS);
  const [openSheet, setOpenSheet] = useState<'location' | 'risk' | 'category' | null>(null);
  const prefs = usePreferences(
    useCallback((loaded: UserRecallPreferences) => {
      // Default to the personalized view only when personalization exists.
      if (hasAnyPreference(loaded)) setTab('affects_me');
    }, []),
  );

  // Search index: built once per loaded corpus, matched per keystroke.
  const readyItems = state.status === 'ready' ? state.items : null;
  const searchEntries = useMemo(() => {
    const entries = new Map<string, SearchEntry>();
    for (const item of readyItems ?? []) entries.set(item.id, buildSearchEntry(item));
    return entries;
  }, [readyItems]);
  const entryOf = useCallback(
    (item: FeedItem) => searchEntries.get(item.id) ?? buildSearchEntry(item),
    [searchEntries],
  );

  // ── SCROLL POSITION ON FILTER CHANGE ────────────────────────────────────
  //
  // A filter change swaps the result set underneath a scroll offset that was
  // measured against the OLD one. Scrolled to the bottom of Fruits &
  // vegetables and then switching to Meat & poultry left the reader deep
  // inside a different, usually shorter list — looking at the tail of results
  // they never asked for, with the top of the new set above them.
  //
  // `getScrollResponder()` hands back the underlying ScrollView
  // (react-native 0.86, Libraries/Lists/SectionList.d.ts). It is the smallest
  // mechanism that fits: offset 0 resolves no index, so it is safe when the
  // new result set is empty and it cannot hit `scrollToLocation`'s
  // render-window caveat from far down an 800-row feed.
  const listRef = useRef<SectionList<FeedItem, HomeSection>>(null);
  const scrollFeedToTop = useCallback(() => {
    listRef.current?.getScrollResponder()?.scrollTo({ y: 0, animated: false });
  }, []);

  // Applying a browsing filter while viewing Affects me switches to All —
  // the filters describe the complete feed, never the personal one. The
  // selection itself survives mode switches in `filters` untouched.
  //
  // An Apply that selects what was already applied is a COMPLETE no-op. That
  // is what keeps the reading position safe from everything that is not a
  // real change: Cancel never reaches here at all, and Apply-without-edits
  // returns before touching state. Only a changed selection scrolls.
  const applyDimension = useCallback(
    (dimension: 'stateCodes' | 'riskTiers' | 'categoryIds', next: string[]) => {
      // Category is the one dimension whose vocabulary is wider than what the
      // UI offers, so every incoming selection crosses the launch allowlist
      // before it becomes state. A hidden or unknown id therefore cannot enter
      // the filter through the sheet, through a restored draft, or through any
      // future path that reaches this callback.
      const value =
        dimension === 'categoryIds' ? (sanitizeLaunchCategoryIds(next) as FoodCategoryId[]) : next;
      const updated = { ...filters, [dimension]: value } as FeedFilterState;
      if (sameFeedFilters(filters, updated)) return;
      setFilters(updated);
      if (value.length > 0) setTab('all');
      scrollFeedToTop();
    },
    [filters, scrollFeedToTop],
  );

  /** Clear all: the same rule — only a real change moves the reader. */
  const clearAllFilters = useCallback(() => {
    if (!hasActiveFilters(filters)) return;
    setFilters(EMPTY_FEED_FILTERS);
    scrollFeedToTop();
  }, [filters, scrollFeedToTop]);
  // ── END SCROLL POSITION ON FILTER CHANGE ────────────────────────────────

  if (!isFeedConfigured()) {
    return (
      <Page>
        {/* `__DEV__` is false in a release build, so a shopper reads the
            shopper sentence and never the one naming environment
            variables. See lib/feed-copy.ts. */}
        <StateMessage {...(__DEV__ ? FEED_NOT_CONFIGURED_DEV : FEED_NOT_CONFIGURED)} tone="error" />
      </Page>
    );
  }

  if (state.status === 'loading') {
    return (
      <Page>
        <StateMessage {...FEED_LOADING} tone="loading" />
      </Page>
    );
  }

  if (state.status === 'error') {
    return (
      <Page>
        <StateMessage title={FEED_ERROR_TITLE} body={state.message} tone="error" />
      </Page>
    );
  }

  // Consumer relevance is a display tier, never a lifecycle change: old
  // agency-active PHAs stay truthful and accessible, but collapsed so they
  // cannot visually compete with newly announced notices.
  //
  // All Recalls view = complete corpus → browsing filters → search. Both
  // stages are strict no-ops when inactive (they return the same array), so
  // with nothing active buildFeedSections receives exactly what
  // fetchCurrentFeed produced — sectioning and ordering byte-for-byte. The
  // loaded corpus itself is never mutated or truncated by any of this.
  const allVisible = filterBySearch(applyFeedFilters(state.items, filters), query, entryOf);
  const sectioned = buildFeedSections(allVisible);
  // C6.1: with a jurisdiction selected, order WITHIN each existing section so
  // notices that explicitly name a selected state lead the nationwide ones
  // that merely also reach it. Section membership is untouched — an old
  // notice is never promoted into Recent activity by matching the location —
  // and with no jurisdiction selected these return the same array instances,
  // so All Recalls is byte-for-byte its pre-C6 self.
  const recent = orderByLocationTiers(sectioned.recent, filters.stateCodes);
  const olderActive = orderByLocationTiers(sectioned.olderActive, filters.stateCodes);

  const personalized = tab === 'affects_me' && prefs !== null && hasAnyPreference(prefs);
  // One relevance evaluation per case whenever preferences exist — the same
  // deterministic verdict (lib/relevance.ts) powers Affects me membership AND
  // the per-card "Affects you" flag, which is available in the normal All
  // feed too, never only in the Affects me view.
  const hasPersonalization = prefs !== null && hasAnyPreference(prefs);
  const relevanceById = new Map<string, PersonalRelevance>();
  if (hasPersonalization) {
    for (const item of state.items) {
      relevanceById.set(
        item.id,
        evaluatePersonalRelevance(
          {
            geography: item.geography,
            pathogenOrAllergen: item.pathogenOrAllergen,
            retailerNames: item.retailerNames,
            hazardCategory: item.hazardCategory,
            reasonText: item.reasonText,
          },
          prefs,
        ),
      );
    }
  }
  // The injected calendar date every card's activity line is formatted
  // against — one read per render, so all cards agree on what "Today" is.
  const today = todayIso();

  let sections: HomeSection[];
  let affectsCounts = { affects: 0, older: 0 };
  if (personalized) {
    // One deterministic ranking for the whole tab (lib/affects-me-ranking.ts).
    // Two sections only (C5.2B): a notice that says nothing about this user
    // appears zero times here and stays in All recalls. Eligibility and
    // ranking run over the COMPLETE corpus exactly as before; search then
    // narrows the already-eligible, already-ranked output (order-preserving),
    // so it can never surface an ineligible notice or reorder an eligible one.
    // Location/Risk browsing filters are deliberately NOT applied here.
    const ranked = buildAffectsMeSections(state.items, (item) => relevanceById.get(item.id)!);
    const affects = filterBySearch(ranked.affects, query, entryOf);
    const older = filterBySearch(ranked.older, query, entryOf);
    affectsCounts = { affects: affects.length, older: older.length };
    sections = [
      ...(affects.length > 0
        ? [{ key: 'affects' as const, title: 'Affects me', data: affects }]
        : []),
      ...(older.length > 0
        ? [{ key: 'older' as const, title: 'Older active notices', data: showOlder ? older : [] }]
        : []),
    ];
  } else if (tab === 'affects_me') {
    // Affects me with nothing configured: only the personalize CTA — the
    // national feed under an "Affects me" heading would misstate relevance.
    sections = [];
  } else {
    sections = [
      ...(recent.length > 0
        ? [{ key: 'recent' as const, title: 'Recent activity', data: recent }]
        : []),
      ...(olderActive.length > 0
        ? [
            {
              key: 'older' as const,
              title: 'Older active notices',
              data: showOlder ? olderActive : [],
            },
          ]
        : []),
    ];
  }

  const showTabs = preferencesAvailable() && prefs !== null;
  const filtersActive = hasActiveFilters(filters);
  const searchActive = query.trim() !== '';
  const olderCount = personalized ? affectsCounts.older : olderActive.length;

  return (
    <Page>
      {/* Search lives inside the Feed and is never a destination: it filters
          the loaded corpus and navigates nowhere. The bar is the shared
          primitive; what it matches against is `filterBySearch`, unchanged. */}
      <View style={styles.searchRow}>
        <SearchBar
          value={query}
          onChangeText={setQuery}
          placeholder="Search product, company, brand, or code"
          accessibilityLabel="Search recalls"
          accessibilityHint="Narrows the recalls below as you type."
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      {/* One horizontally scrolling chip row (the approved composition), two
          conceptual levels (the shipped behaviour): the feed-mode pair first,
          then — only while All is active — the filters that refine it, kept
          visually apart by a hairline. The row may overflow sideways; the
          page never does. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        style={styles.chipBar}
        contentContainerStyle={styles.chipBarContent}>
        {/* ── FEED MODE CONTROL (C6.1) ──────────────────────────────────────
            The top-level choice: WHICH feed you are looking at. All and
            Affects me are mutually exclusive scopes, so they are a pair of
            either/or chips — exactly one selected — rather than toggles
            among the filters that merely refine All. */}
        {showTabs
          ? (
              [
                { key: 'all', label: 'All' },
                { key: 'affects_me', label: 'Affects me' },
              ] as const
            ).map(({ key, label }) => (
              <Chip key={key} label={label} selected={tab === key} onPress={() => setTab(key)} />
            ))
          : null}
        {/* ── END FEED MODE CONTROL ─────────────────────────────────────────*/}
        {/* ── ALL-ONLY FILTER ROW (C6.1) ────────────────────────────────────
            Location and Risk refine the All Recalls feed and NOTHING else, so
            they render only while All is the active mode. In Affects me they —
            and their counts and Clear all — are absent entirely: they cannot
            be opened, read, or cleared from there, while the selections stay
            untouched in session state for the return to All.

            Category (C10B) is a third peer in this row, deliberately last: it is
            the only dimension whose values are DERIVED rather than stated by the
            agency, so it sits after the two the source vouches for. It is an
            optional discovery aid — every recall stays reachable with it
            cleared — and it never applies to Affects me.

            Each of these opens a picker sheet, which is what the chevron says. */}
        {tab === 'all' && showTabs ? <View style={styles.chipDivider} /> : null}
        {tab === 'all' ? (
          <Chip
            label={
              filters.stateCodes.length > 0 ? `Location · ${filters.stateCodes.length}` : 'Location'
            }
            selected={filters.stateCodes.length > 0}
            trailingIcon="chevron-down"
            accessibilityLabel={
              filters.stateCodes.length > 0
                ? `Location filter, ${filters.stateCodes.length} selected`
                : 'Location filter'
            }
            onPress={() => setOpenSheet('location')}
          />
        ) : null}
        {tab === 'all' ? (
          <Chip
            label={filters.riskTiers.length > 0 ? `Risk · ${filters.riskTiers.length}` : 'Risk'}
            selected={filters.riskTiers.length > 0}
            trailingIcon="chevron-down"
            accessibilityLabel={
              filters.riskTiers.length > 0
                ? `Risk filter, ${filters.riskTiers.length} selected`
                : 'Risk filter'
            }
            onPress={() => setOpenSheet('risk')}
          />
        ) : null}
        {tab === 'all' ? (
          <Chip
            label={
              filters.categoryIds.length > 0
                ? `Category · ${filters.categoryIds.length}`
                : 'Category'
            }
            selected={filters.categoryIds.length > 0}
            trailingIcon="chevron-down"
            accessibilityLabel={
              filters.categoryIds.length > 0
                ? `Category filter, ${filters.categoryIds.length} selected`
                : 'Category filter'
            }
            onPress={() => setOpenSheet('category')}
          />
        ) : null}
        {tab === 'all' && filtersActive ? (
          <Chip label="Clear all" selected={false} onPress={clearAllFilters} />
        ) : null}
      </ScrollView>
      {tab === 'all' && filtersActive ? (
        <View style={styles.contextRow}>
          <Text variant="caption" color="text/secondary">
            Filtering All recalls · {activeFilterCount(filters)} selected
          </Text>
        </View>
      ) : null}
      {/* ── END ALL-ONLY FILTER ROW ───────────────────────────────────────*/}
      {/* Affects me says what it is scoped by and offers the way to change
          it. Not an instruction, and no preference logic of its own — the
          link opens the one existing personalization screen. */}
      {tab === 'affects_me' && showTabs ? (
        <View style={styles.contextRow}>
          <Text variant="caption" color="text/secondary">
            Based on your personalization
          </Text>
          <Link href="/settings/personalization" asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit personalization"
              hitSlop={CAPTION_HIT_SLOP}>
              {({ pressed }) => (
                <Text variant="caption" color="action/secondary" style={pressed && styles.pressed}>
                  Edit
                </Text>
              )}
            </Pressable>
          </Link>
        </View>
      ) : null}
      {openSheet === 'location' ? (
        <FilterSheet
          title="Location"
          options={LOCATION_OPTIONS}
          selected={filters.stateCodes}
          onApply={(next) => applyDimension('stateCodes', next)}
          onClose={() => setOpenSheet(null)}
        />
      ) : null}
      {openSheet === 'risk' ? (
        <FilterSheet
          title="Risk level"
          options={RISK_OPTIONS}
          selected={filters.riskTiers}
          onApply={(next) => applyDimension('riskTiers', next)}
          onClose={() => setOpenSheet(null)}
        />
      ) : null}
      {openSheet === 'category' ? (
        <FilterSheet
          title="Category"
          options={CATEGORY_OPTIONS}
          selected={filters.categoryIds}
          onApply={(next) => applyDimension('categoryIds', next)}
          onClose={() => setOpenSheet(null)}
        />
      ) : null}
      <SectionList
        ref={listRef}
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <RecallCard
            model={buildHomeCardModel(item, {
              today,
              affectsYou: relevanceById.get(item.id)?.affectsMe ?? false,
            })}
          />
        )}
        // The heading words are the presentation contract's (Recent activity,
        // Older active notices, Affects me); the composition gives them the
        // design's section-heading type. The older section keeps its count,
        // its plain explanation, and its reveal — which grows the list in
        // place and never moves the reading position.
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text variant="heading-3" accessibilityRole="header">
              {section.key === 'older' ? `${section.title} (${olderCount})` : section.title}
            </Text>
            {section.key === 'older' ? (
              <>
                <Text variant="body-small" color="text/secondary">
                  {OLDER_NOTICES_EXPLANATION}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showOlder }}
                  hitSlop={CAPTION_HIT_SLOP}
                  onPress={() => setShowOlder((value) => !value)}>
                  {({ pressed }) => (
                    <Text
                      variant="caption"
                      color="action/secondary"
                      style={pressed && styles.pressed}>
                      {showOlder ? 'Hide older notices' : 'Show older notices'}
                    </Text>
                  )}
                </Pressable>
              </>
            ) : null}
          </View>
        )}
        ListHeaderComponent={
          <>
            {/* The feed on screen is complete but possibly out of date — said
                plainly, because silently showing stale counts as current is
                the failure this milestone exists to prevent. The neutral
                informational callout, not the lime relevance one. */}
            {staleMessage ? (
              <Callout tone="information" accessibilityLiveRegion="polite">
                {FEED_STALE_NOTICE}
              </Callout>
            ) : null}
            {tab === 'affects_me' && prefs !== null ? (
              !hasAnyPreference(prefs) ? (
                <PersonalizeCta />
              ) : prefs.state === null ? (
                <PersonalizeCta compact />
              ) : null
            ) : null}
          </>
        }
        contentContainerStyle={styles.listContent}
        style={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={color['action/primary']}
          />
        }
        ListEmptyComponent={
          searchActive || (tab === 'all' && filtersActive) ? (
            <StateMessage {...(searchActive ? FEED_EMPTY_SEARCH : FEED_EMPTY_FILTERS)} />
          ) : personalized ? (
            <StateMessage {...FEED_EMPTY_PERSONALIZED} />
          ) : tab === 'affects_me' ? null : (
            <StateMessage {...FEED_EMPTY_CORPUS} />
          )
        }
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  // No alignItems here: a centered cross-axis lets children size to intrinsic
  // content width, which broke wrapping/clipping; centering is done by each
  // block's own maxWidth + alignSelf.
  page: {
    flex: 1,
  },
  pressed: {
    opacity: 0.6,
  },
  // The page margin is the one reference value that carries over to every
  // device; the content column is whatever remains, capped only on tablets.
  searchRow: {
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
    paddingTop: spacing[8],
    paddingHorizontal: layout.pageMargin,
  },
  // Horizontally scrollable so every chip stays reachable on small viewports;
  // flexGrow: 0 keeps the bar its content height instead of stealing the
  // list's. The vertical padding is what lets each chip's 44pt hit area sit
  // inside the scroll view's own bounds.
  chipBar: {
    flexGrow: 0,
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  chipBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[8],
    paddingHorizontal: layout.pageMargin,
    paddingVertical: spacing[8],
  },
  // The two conceptual levels of the row, kept visually distinct.
  chipDivider: {
    width: 1,
    height: spacing[16],
    backgroundColor: color['border/default'],
  },
  contextRow: {
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[8],
    paddingHorizontal: layout.pageMargin,
    paddingBottom: spacing[8],
  },
  // flex: 1 so the list gets the screen height and can actually scroll —
  // without it the list sizes to its content and the parent just clips it.
  list: {
    flex: 1,
    width: '100%',
  },
  // The bottom navigation sits above the home indicator itself, so the list
  // needs only its own breathing room below the last card.
  listContent: {
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: layout.pageMargin,
    paddingTop: spacing[8],
    paddingBottom: spacing[24],
    gap: spacing[16],
  },
  // Section headers stick on iOS, so they carry the page colour and cards
  // scroll under them.
  sectionHeader: {
    backgroundColor: color['background/page'],
    paddingTop: spacing[8],
    gap: spacing[4],
  },
  callout: {
    padding: spacing[12],
    gap: spacing[4],
  },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: '#0006',
  },
  sheet: {
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
    borderTopLeftRadius: radius[16],
    borderTopRightRadius: radius[16],
    padding: spacing[16],
    gap: spacing[12],
  },
  sheetList: {
    maxHeight: 340,
  },
  // 44pt is the platform minimum touch target: every option row is at least
  // that tall, with its text sitting left as before.
  sheetItem: {
    minHeight: hitTarget.minimum,
    justifyContent: 'center',
    paddingVertical: spacing[4],
  },
  sheetActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing[8],
  },
  sheetButton: {
    minHeight: hitTarget.minimum,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing[16],
  },
});
