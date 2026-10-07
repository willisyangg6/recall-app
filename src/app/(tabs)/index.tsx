import { useCallback, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
  Keyboard,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FiltersSheet } from '@/components/feed/filters-sheet';
import { StateMessage } from '@/components/state-message';
import { RecallCard } from '@/components/recall-card';
import { Callout } from '@/components/ui/callout';
import { Icon } from '@/components/ui/icon';
import { SearchBar } from '@/components/ui/search-bar';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import {
  color,
  hitSlopToMinimum,
  hitTarget,
  layout,
  spacing,
  typography,
} from '@/constants/design-tokens';
import { CARD_STACK_SCALE, feedColor, feedGeometry, feedType } from '@/constants/feed-design';
import { hasAnyPreference, type UserRecallPreferences } from '@/domain/preferences';
import { useAccess } from '@/hooks/use-access';
import { useFeed } from '@/hooks/use-feed';
import { usePreferences } from '@/hooks/use-preferences';
import { buildAffectsMeSections } from '@/lib/affects-me-ranking';
import {
  FEED_EMPTY_CORPUS,
  FEED_EMPTY_FILTERS,
  FEED_EMPTY_FILTERS_AFFECTS,
  FEED_EMPTY_PERSONALIZED,
  FEED_EMPTY_SEARCH,
  FEED_ERROR_TITLE,
  FEED_LOADING,
  FEED_NOT_CONFIGURED,
  FEED_NOT_CONFIGURED_DEV,
  OLDER_NOTICES_EXPLANATION_AFFECTS,
  OLDER_NOTICES_EXPLANATION_ALL,
  OLDER_NOTICES_TITLE,
  PERSONALIZE_CTA,
} from '@/lib/feed-copy';
import { PREFERENCES_SET_CONFIRMATION } from '@/lib/onboarding-copy';
import { filtersButtonAccessibilityLabel, filtersButtonLabel } from '@/lib/feed-filter-draft';
import {
  applyFeedFilters,
  EMPTY_FEED_FILTERS,
  hasActiveFilters,
  sameFeedFilters,
  type FeedFilterState,
} from '@/lib/feed-filters';
import { buildSearchEntry, filterBySearch, type SearchEntry } from '@/lib/feed-search';
import { buildFeedSections } from '@/lib/feed-relevance';
import { knownPreferences, preferencesAvailable } from '@/lib/preferences-store';
import { isFeedConfigured, type FeedItem } from '@/lib/recall-feed';
import { buildHomeCardModel, todayIso } from '@/lib/recall-presentation';
import { useCalendarClock } from '@/hooks/use-calendar-clock';
import { evaluatePersonalRelevance, type PersonalRelevance } from '@/lib/relevance';

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

/** A one-caption-line control reaches the 44pt target through hitSlop. */
const CAPTION_HIT_SLOP = hitSlopToMinimum(typography.caption.lineHeight);

/**
 * The two feeds as one connected control (2026-10-06, the approved Feed
 * header): two equal halves inside a 12pt-radius outline, the chosen one
 * brand navy with white text. Exactly one is selected; each half is a full
 * 44pt tab that announces its selection. From the accessibility text sizes
 * the halves stack, full width, so no label breaks mid-word.
 */
function FeedTabs({ tab, onChange }: { tab: FeedTab; onChange: (next: FeedTab) => void }) {
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= CARD_STACK_SCALE;
  return (
    <View accessibilityRole="tablist" style={[styles.tabs, stacked && styles.tabsStacked]}>
      {(
        [
          { key: 'all', label: 'All recalls' },
          { key: 'affects_me', label: 'Affects you' },
        ] as const
      ).map(({ key, label }) => {
        const selected = tab === key;
        return (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={label}
            onPress={() => onChange(key)}
            style={({ pressed }) => [
              styles.tab,
              stacked && styles.tabStacked,
              selected && styles.tabSelected,
              pressed && styles.pressed,
            ]}>
            <Text style={[feedType.control, selected ? styles.tabTextSelected : styles.tabText]}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The Filters control: a native outlined button (the kit's raster is a
 * visual reference only), at least 88 × 44pt, growing to fit its count —
 * the number of filter GROUPS narrowing this feed, never a result count.
 */
function FiltersButton({
  filters,
  onPress,
  buttonRef,
}: {
  filters: FeedFilterState;
  onPress: () => void;
  buttonRef: React.RefObject<View | null>;
}) {
  return (
    <Pressable
      ref={buttonRef}
      accessibilityRole="button"
      accessibilityLabel={filtersButtonAccessibilityLabel(filters)}
      accessibilityHint="Opens location, risk and category filters."
      onPress={onPress}
      style={({ pressed }) => [styles.filtersButton, pressed && styles.pressed]}>
      <Icon name="filters" points={18} tint={feedColor.text} />
      <Text style={[feedType.metaStrong, styles.ink]}>{filtersButtonLabel(filters)}</Text>
    </Pressable>
  );
}

/**
 * Affects you with its own filters matching nothing: the plain sentence and
 * one action that clears THIS feed's filters (through the same guarded Apply
 * path), bringing its matching recalls back.
 */
function AffectsFilteredEmpty({ onClear }: { onClear: () => void }) {
  return (
    <View style={styles.filteredEmpty}>
      <Text variant="heading-3" accessibilityRole="header" style={styles.centerText}>
        {FEED_EMPTY_FILTERS_AFFECTS.title}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Shows every recall that matches your choices again."
        onPress={onClear}
        style={({ pressed }) => [styles.clearFilters, pressed && styles.pressed]}>
        <Text style={[feedType.control, styles.ink]}>{FEED_EMPTY_FILTERS_AFFECTS.action}</Text>
      </Pressable>
    </View>
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

/**
 * The title alone, for the whole-screen states (loading, error, not
 * configured) that have no list: the screen still says where it is now that
 * the navigator's bar is hidden.
 */
function TitleOnly() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.titleOnly, { paddingTop: insets.top + feedGeometry.headerGap }]}>
      <Text accessibilityRole="header" style={[feedType.heading, styles.ink]}>
        Feed
      </Text>
    </View>
  );
}

interface HomeSection {
  key: 'affects' | 'recent' | 'older';
  title: string;
  data: FeedItem[];
}

export default function HomeScreen() {
  // After onboarding the session has already served the complete corpus
  // Building and Ready showed; the Feed starts from it rather than from
  // `Loading recalls…`, and revalidates on mount as it always did.
  const { state, refreshing, refresh } = useFeed({ startFromServed: true });
  // The one clock for sections, evidence expiry and card dates: it moves at
  // each calendar boundary and on resume, not only when a sync lands.
  const now = useCalendarClock();
  // The screen draws its own title (the navigator's bar is hidden for Feed).
  const insets = useSafeAreaInsets();
  // From the accessibility text sizes the heading/Filters row stacks.
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale >= CARD_STACK_SCALE;
  const [showOlder, setShowOlder] = useState(false);
  // The intended view before the first visible frame (2026-10-04): a
  // shopper with preferences this process has already read lands on
  // Affects me at once; the first read still decides for a cold launch.
  const [tab, setTab] = useState<FeedTab>(() => {
    const known = knownPreferences();
    return known !== null && hasAnyPreference(known) ? 'affects_me' : 'all';
  });
  // Browsing state (C6): session-only, in memory, never persisted, never part
  // of the personalization profile. Since the Feed + Filters design
  // (2026-10-06) each feed keeps its OWN filters: one Filters sheet works on
  // both, and switching feeds neither carries nor clears the other's
  // selection. In Affects me they only narrow the already-eligible,
  // already-ranked list (see below) — they never change who is eligible.
  const [query, setQuery] = useState('');
  const [filtersByTab, setFiltersByTab] = useState<Record<FeedTab, FeedFilterState>>({
    all: EMPTY_FEED_FILTERS,
    affects_me: EMPTY_FEED_FILTERS,
  });
  const filters = filtersByTab[tab];
  const [sheetOpen, setSheetOpen] = useState(false);
  // Focus returns to the Filters button once the sheet has gone.
  const filtersButton = useRef<View>(null);
  const focusFiltersButton = useCallback(() => {
    const tag = findNodeHandle(filtersButton.current);
    if (tag !== null) AccessibilityInfo.setAccessibilityFocus(tag);
  }, []);
  const openFilters = useCallback(() => {
    Keyboard.dismiss();
    setSheetOpen(true);
  }, []);
  const decidedFromKnown = useRef(knownPreferences() !== null);
  const prefs = usePreferences(
    useCallback((loaded: UserRecallPreferences) => {
      // Default to the personalized view only when personalization exists —
      // and only when the first frame could not already decide, so a tab the
      // shopper chose meanwhile is never overridden by the focus read.
      if (decidedFromKnown.current) return;
      if (hasAnyPreference(loaded)) setTab('affects_me');
    }, []),
  );
  // P2B7X.1: the one-time confirmation after notification education. Taken
  // from the gate exactly once, in the session the education completed, and
  // shown until this screen loses focus — a lightweight acknowledgement, not
  // a persistent banner. Keyed to the STABLE taker, not the whole access
  // value: the entitlement refresh that runs whenever the app returns to the
  // foreground (closing the notification prompt does exactly that) changes
  // the access value, and re-running the effect then cleared the notice it
  // had already taken (2026-10-03).
  const { consumePreferencesSetNotice } = useAccess();
  const [preferencesSet, setPreferencesSet] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (consumePreferencesSetNotice()) setPreferencesSet(true);
      return () => setPreferencesSet(false);
    }, [consumePreferencesSetNotice]),
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

  // Apply filters commits the sheet's draft to THIS feed only. An Apply that
  // selects what was already applied is a COMPLETE no-op, which keeps the
  // reading position safe from everything that is not a real change: Close
  // never reaches here at all, and Apply-without-edits returns before
  // touching state. Only a changed selection scrolls. The categories have
  // already crossed the launch allowlist (`committedFilters`).
  const applyFilters = useCallback(
    (next: FeedFilterState) => {
      if (sameFeedFilters(filters, next)) return;
      setFiltersByTab((prior) => ({ ...prior, [tab]: next }));
      scrollFeedToTop();
    },
    [filters, tab, scrollFeedToTop],
  );
  // ── END SCROLL POSITION ON FILTER CHANGE ────────────────────────────────

  if (!isFeedConfigured()) {
    return (
      <Page>
        <TitleOnly />
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
        <TitleOnly />
        <StateMessage {...FEED_LOADING} tone="loading" />
      </Page>
    );
  }

  if (state.status === 'error') {
    return (
      <Page>
        <TitleOnly />
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
  const allVisible = filterBySearch(
    applyFeedFilters(state.items, filtersByTab.all),
    query,
    entryOf,
  );
  // Filters decide membership only (2026-10-05): a filtered view keeps the one
  // shared newest-first order the sections already carry. The C6.1 re-sort
  // that led a filtered section with explicit selected-state matches is gone,
  // so a newer nationwide recall sits above an older one naming the state.
  const { recent, olderActive } = buildFeedSections(allVisible, now);

  const personalized = tab === 'affects_me' && prefs !== null && hasAnyPreference(prefs);
  // One relevance evaluation per case whenever preferences exist, for Affects
  // me MEMBERSHIP and ranking only. The per-card "Affects you" label is not
  // read from here: the card builder derives it from `prefs` itself
  // (`affectsYouVerdict`), so Saved — which does no ranking — reaches the
  // identical verdict without this screen handing it over. Both come from the
  // same function over the same facts, so membership and the label agree by
  // construction, and the label is available in the All feed exactly as
  // before, never only in the Affects me view.
  const hasPersonalization = prefs !== null && hasAnyPreference(prefs);
  const relevanceById = new Map<string, PersonalRelevance>();
  if (hasPersonalization) {
    // The row is passed WHOLE: a FeedItem already satisfies `RelevanceInput`,
    // so there is no field list here to fall out of step with the one the
    // card builder evaluates against.
    for (const item of state.items) {
      relevanceById.set(item.id, evaluatePersonalRelevance(item, prefs));
    }
  }
  // The injected calendar date every card's activity line is formatted
  // against — one read per render, so all cards agree on what "Today" is.
  const today = todayIso(now);

  let sections: HomeSection[];
  let affectsCounts = { affects: 0, older: 0 };
  if (personalized) {
    // One deterministic ranking for the whole tab (lib/affects-me-ranking.ts).
    // Two sections only (C5.2B): a notice that says nothing about this user
    // appears zero times here and stays in All recalls. Eligibility and
    // ranking run over the COMPLETE corpus exactly as before; search then
    // narrows the already-eligible, already-ranked output (order-preserving),
    // so it can never surface an ineligible notice or reorder an eligible one.
    // This feed's own browsing filters (2026-10-06) narrow the same way:
    // AFTER eligibility and ranking, order-preserving (`applyFeedFilters`
    // only removes), so they can hide a match but never add a non-match,
    // re-rank one, or move one between sections.
    const ranked = buildAffectsMeSections(state.items, (item) => relevanceById.get(item.id)!, {
      now,
    });
    const affects = filterBySearch(applyFeedFilters(ranked.affects, filters), query, entryOf);
    const older = filterBySearch(applyFeedFilters(ranked.older, filters), query, entryOf);
    affectsCounts = { affects: affects.length, older: older.length };
    sections = [
      ...(affects.length > 0
        ? [{ key: 'affects' as const, title: 'Affects you', data: affects }]
        : []),
      ...(older.length > 0
        ? [{ key: 'older' as const, title: OLDER_NOTICES_TITLE, data: showOlder ? older : [] }]
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
              title: OLDER_NOTICES_TITLE,
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
  // Filters serve a list: All always, Affects me once personalization exists
  // (with nothing configured it shows only the invitation, nothing to narrow).
  const filtersAvailable = tab === 'all' || personalized;
  const firstSectionKey = sections[0]?.key ?? null;
  const filtersControl = filtersAvailable ? (
    <FiltersButton filters={filters} onPress={openFilters} buttonRef={filtersButton} />
  ) : null;

  // The approved Feed header (2026-10-06): the screen's own left-aligned
  // title (the navigator's bar is hidden for this tab, (tabs)/_layout), the
  // search field, and the two feeds as one connected control. It is the
  // list's header, so it scrolls with the recalls: at the largest text sizes
  // a fixed header would fill a small screen and leave no room for a card.
  const header = (
    <View style={styles.header}>
      <Text accessibilityRole="header" style={[feedType.heading, styles.ink]}>
        Feed
      </Text>
      {/* Search lives inside the Feed and is never a destination: it filters
          the loaded corpus and navigates nowhere. The bar is the shared
          primitive; what it matches against is `filterBySearch`, unchanged. */}
      <SearchBar
        value={query}
        onChangeText={setQuery}
        placeholder="Search product, company, brand, or code"
        accessibilityLabel="Search recalls"
        accessibilityHint="Narrows the recalls below as you type."
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        appearance="outline"
      />
      {/* ── FEED MODE CONTROL (C6.1) ────────────────────────────────────────
          The top-level choice: WHICH feed you are looking at. All and
          Affects me are mutually exclusive scopes — exactly one selected. */}
      {showTabs ? <FeedTabs tab={tab} onChange={setTab} /> : null}
      {/* ── END FEED MODE CONTROL ─────────────────────────────────────────*/}
      {/* Affects me says what it is scoped by and offers the way to change
          it. Not an instruction, and no preference logic of its own — the
          link opens the one existing personalization screen. The caption
          shrinks and wraps rather than pushing Edit past the screen edge;
          from the card-stacking text scale Edit takes its own row with an
          explicit 44pt target (a hitSlop alone leaves the accessible frame
          caption-sized). The default size is unchanged. */}
      {tab === 'affects_me' && showTabs ? (
        <View style={[styles.contextRow, largeText && styles.contextRowStacked]}>
          <Text variant="caption" color="text/secondary" style={styles.contextText}>
            Based on your personalization
          </Text>
          <Link href="/settings/personalization" asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit personalization"
              hitSlop={largeText ? undefined : CAPTION_HIT_SLOP}
              // One style object, never an array: Link asChild hands its
              // props through expo-router's Slot, which rejects style arrays.
              style={largeText ? styles.contextEditStacked : styles.contextEdit}>
              {({ pressed }) => (
                <Text variant="caption" color="action/secondary" style={pressed && styles.pressed}>
                  Edit
                </Text>
              )}
            </Pressable>
          </Link>
        </View>
      ) : null}
    </View>
  );

  return (
    <Page>
      {/* The safe area stays the page's colour; everything below scrolls. */}
      <View style={{ height: insets.top }} />
      <FiltersSheet
        visible={sheetOpen}
        applied={filters}
        onApply={applyFilters}
        onClose={() => setSheetOpen(false)}
        onClosed={focusFiltersButton}
      />
      <SectionList
        ref={listRef}
        sections={sections}
        // Headings stick at the default sizes; from the accessibility sizes
        // the heading and Filters row scroll with the list instead, because
        // a pinned row of AX5 type would cover a quarter of the screen and
        // the card beneath it (founder review, 2026-10-06). Filters stays
        // reachable at the top of its section; Dynamic Type is not capped.
        stickySectionHeadersEnabled={!largeText}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <RecallCard model={buildHomeCardModel(item, { today, prefs })} />}
        // The heading words are the presentation contract's (Recent activity,
        // Older notices, Affects you). The FIRST section's heading row
        // carries the Filters control (2026-10-06), so it stays at hand while
        // that sticky heading does. The older section keeps its count, its
        // plain explanation, and its reveal — which grows the list in place
        // and never moves the reading position.
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionRow, largeText && styles.sectionRowStacked]}>
              <Text
                accessibilityRole="header"
                style={[feedType.sectionRow, styles.ink, styles.grow]}>
                {section.key === 'older' ? `${section.title} (${olderCount})` : section.title}
              </Text>
              {section.key === firstSectionKey ? filtersControl : null}
            </View>
            {section.key === 'older' ? (
              <>
                <Text variant="body-small" color="text/secondary">
                  {personalized ? OLDER_NOTICES_EXPLANATION_AFFECTS : OLDER_NOTICES_EXPLANATION_ALL}
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
        // No freshness, staleness or "last checked" surface of any kind
        // (P2B7S, founder decision). A refresh that fails over a corpus
        // already on screen changes nothing here: the recalls keep showing,
        // silently. Whether ingestion is healthy is answered by the
        // operational dead-man heartbeat, not by the app.
        ListHeaderComponent={
          <>
            {header}
            {preferencesSet ? (
              <View style={styles.preferencesSet}>
                <Callout tone="information">{PREFERENCES_SET_CONFIRMATION}</Callout>
              </View>
            ) : null}
            {tab === 'affects_me' && prefs !== null ? (
              !hasAnyPreference(prefs) ? (
                <PersonalizeCta />
              ) : prefs.states.length === 0 ? (
                <PersonalizeCta compact />
              ) : null
            ) : null}
            {/* With no section on screen (a filter or search that matches
                nothing) the Filters control keeps its own row, so a filter
                can always be changed or cleared. */}
            {firstSectionKey === null && filtersControl ? (
              <View style={[styles.sectionRow, styles.sectionRowAlone]}>{filtersControl}</View>
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
          personalized && filtersActive && !searchActive ? (
            <AffectsFilteredEmpty onClear={() => applyFilters(EMPTY_FEED_FILTERS)} />
          ) : searchActive || (filtersAvailable && filtersActive) ? (
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
  // The one-time confirmation sits above the list at the list's own margin.
  preferencesSet: {
    paddingBottom: spacing[16],
  },
  // No alignItems here: a centered cross-axis lets children size to intrinsic
  // content width, which broke wrapping/clipping; centering is done by each
  // block's own maxWidth + alignSelf.
  page: {
    flex: 1,
  },
  pressed: {
    opacity: 0.6,
  },
  ink: {
    color: feedColor.text,
  },
  // The section heading takes the row and wraps by words; when it and
  // Filters no longer fit side by side, Filters moves to the next line.
  grow: {
    flexGrow: 1,
    flexShrink: 1,
  },
  // The approved header, inside the list's gutter: 12pt between title,
  // search and tabs; the list's own 14pt gap separates it from the first
  // section's Filters row.
  header: {
    gap: feedGeometry.headerGap,
  },
  // The whole-screen states' title, which sits outside any list.
  titleOnly: {
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: feedGeometry.pageGutter,
  },
  tabs: {
    flexDirection: 'row',
    minHeight: feedGeometry.tabHeight,
    borderWidth: 1,
    borderColor: feedColor.border,
    borderRadius: feedGeometry.tabRadius,
    backgroundColor: feedColor.surface,
    overflow: 'hidden',
  },
  tab: {
    flex: 1,
    minHeight: feedGeometry.tabHeight,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  tabsStacked: {
    flexDirection: 'column',
  },
  // In a column, flex: 1 would size each half from a zero basis.
  tabStacked: {
    flex: 0,
  },
  tabSelected: {
    backgroundColor: feedColor.brand,
  },
  tabText: {
    color: feedColor.text,
    textAlign: 'center',
  },
  tabTextSelected: {
    color: feedColor.inverse,
    textAlign: 'center',
  },
  contextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[8],
  },
  contextRowStacked: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    gap: 0,
  },
  // Wraps instead of claiming the whole row at large sizes.
  contextText: { flexShrink: 1 },
  // Never squeezed: Edit keeps its own width.
  contextEdit: { flexShrink: 0 },
  contextEditStacked: {
    flexShrink: 0,
    minHeight: hitTarget.minimum,
    minWidth: hitTarget.minimum,
    justifyContent: 'center',
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
    paddingHorizontal: feedGeometry.pageGutter,
    paddingTop: feedGeometry.headerGap,
    paddingBottom: spacing[24],
    gap: feedGeometry.cardGap,
  },
  // Section headers stick on iOS, so they carry the page colour and cards
  // scroll under them.
  sectionHeader: {
    backgroundColor: color['background/page'],
    paddingTop: spacing[4],
    paddingBottom: spacing[4],
    gap: spacing[4],
  },
  sectionRow: {
    minHeight: feedGeometry.filtersButtonHeight,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[8],
  },
  sectionRowStacked: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
  },
  sectionRowAlone: {
    justifyContent: 'flex-end',
  },
  filtersButton: {
    minWidth: feedGeometry.filtersButtonMinWidth,
    minHeight: feedGeometry.filtersButtonHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 9,
    borderWidth: 1,
    borderColor: feedColor.text,
    borderRadius: feedGeometry.controlRadius,
    backgroundColor: feedColor.surface,
  },
  filteredEmpty: {
    alignItems: 'center',
    gap: spacing[12],
    paddingVertical: spacing[24],
  },
  centerText: {
    textAlign: 'center',
  },
  clearFilters: {
    minHeight: feedGeometry.touchMin,
    minWidth: feedGeometry.touchMin,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing[16],
    borderWidth: 1,
    borderColor: feedColor.text,
    borderRadius: feedGeometry.controlRadius,
    backgroundColor: feedColor.surface,
  },
  callout: {
    padding: spacing[12],
    gap: spacing[4],
  },
});
