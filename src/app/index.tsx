import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PhotoThumbnail } from '@/components/photo-gallery';
import { RiskBadge } from '@/components/risk-badge';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radii, Spacing } from '@/constants/theme';
import type { FoodCategoryId } from '@/domain/food-category';
import { LAUNCH_CATEGORY_OPTIONS, sanitizeLaunchCategoryIds } from '@/domain/food-category-launch';
import {
  hasAnyPreference,
  stateNameForCode,
  SUPPORTED_STATE_CODES,
  type UserRecallPreferences,
} from '@/domain/preferences';
import { useTheme } from '@/hooks/use-theme';
import { buildAffectsMeSections } from '@/lib/affects-me-ranking';
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
import { createFeedCacheStore } from '@/lib/feed-cache-store';
import { createFeedSession, type FeedSession } from '@/lib/feed-sync';
import { loadPreferences, preferencesAvailable } from '@/lib/preferences-store';
import {
  fetchCurrentFeed,
  fetchCurrentManifest,
  fetchFeedItemsByIds,
  isFeedConfigured,
  type FeedItem,
} from '@/lib/recall-feed';
import { buildHomeCardModel, todayIso, type HomeCardModel } from '@/lib/recall-presentation';
import { evaluatePersonalRelevance, type PersonalRelevance } from '@/lib/relevance';
import { riskTierWord } from '@/lib/risk-display';

/**
 * `ready` always means COMPLETE: `fetchCurrentFeed` pages to exhaustion and
 * throws rather than resolving with part of the corpus, so nothing downstream
 * has to reason about a feed that might be missing its tail.
 */
type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: FeedItem[] };

type FeedTab = 'affects_me' | 'all';

/**
 * One feed session for the app process (C8): it owns the persistent cache
 * and coalesces concurrent reconciliations, so a remount, the launch
 * revalidation, and a pull-to-refresh share one in-flight sync instead of
 * issuing duplicate request storms. Created lazily because the module loads
 * before env configuration is checked.
 */
let feedSession: FeedSession | null = null;
function getFeedSession(): FeedSession {
  if (feedSession === null) {
    feedSession = createFeedSession({
      store: createFeedCacheStore(),
      transport: {
        fetchManifest: fetchCurrentManifest,
        fetchAll: fetchCurrentFeed,
        fetchByIds: fetchFeedItemsByIds,
      },
    });
  }
  return feedSession;
}

function useFeed() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  /** Set when a refresh failed over a feed we still hold — see below. */
  const [staleMessage, setStaleMessage] = useState<string | null>(null);

  // A sync resolves with a COMPLETE corpus or throws — the reconciliation
  // never hands back part of a feed, so `ready` keeps meaning complete.
  const revalidate = useCallback(async () => {
    try {
      const outcome = await getFeedSession().sync();
      setState({ status: 'ready', items: outcome.items });
      setStaleMessage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load recalls.';
      // A failed refresh must never cost the user a complete feed they already
      // have: keep showing it, and say plainly that it may be out of date.
      // Only a failure with nothing loaded becomes the full error screen.
      setState((current) => (current.status === 'ready' ? current : { status: 'error', message }));
      setStaleMessage(message);
    }
  }, []);

  useEffect(() => {
    // Cached-first render: the last complete corpus appears without waiting
    // on the network, then the background reconciliation replaces it. The
    // cache only ever fills a not-yet-ready state, so a sync that resolves
    // first is never overwritten by older cached items.
    if (!isFeedConfigured()) return;
    let cancelled = false;
    void getFeedSession()
      .getCached()
      .then((cachedItems) => {
        if (cancelled || cachedItems === null) return;
        setState((current) =>
          current.status === 'ready' ? current : { status: 'ready', items: cachedItems },
        );
      });
    // State updates happen after the network await resolves, not
    // synchronously in the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void revalidate();
    return () => {
      cancelled = true;
    };
  }, [revalidate]);

  // Pull-to-refresh runs a real reconciliation (or joins the one in flight);
  // the feed is replaced only on complete success.
  const refresh = useCallback(async () => {
    setRefreshing(true);
    await revalidate();
    setRefreshing(false);
  }, [revalidate]);

  return { state, refreshing, refresh, staleMessage };
}

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

function Badge({ label, emphasized }: { label: string; emphasized?: boolean }) {
  return (
    <ThemedView type={emphasized ? 'backgroundSelected' : 'backgroundElement'} style={styles.badge}>
      <ThemedText type="small" style={emphasized ? styles.badgeEmphasized : undefined}>
        {label}
      </ThemedText>
    </ThemedView>
  );
}

/** One chip in the horizontally scrollable filter bar (temporary UI). */
function FilterChip({
  label,
  active,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  /**
   * Spoken name when the visible label is a compact badge. The chip reads
   * "Category · 2", which is right on screen and ambiguous aloud; the sheet's
   * own name plus the count is not.
   */
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={accessibilityLabel}
      // The chip's own padding leaves it under the 44pt minimum on a compact
      // row; hitSlop restores the touch target without changing the layout.
      hitSlop={{ top: Spacing.two, bottom: Spacing.two, left: Spacing.one, right: Spacing.one }}
      onPress={onPress}>
      <ThemedView type={active ? 'backgroundSelected' : 'backgroundElement'} style={styles.tab}>
        <ThemedText style={active ? styles.badgeEmphasized : undefined}>{label}</ThemedText>
      </ThemedView>
    </Pressable>
  );
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

/**
 * Temporary modal multi-select for one filter dimension. Selections are a
 * DRAFT until Apply — Cancel discards, Clear empties the dimension. This is
 * browsing state for the current session, never a saved preference.
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
  const [draft, setDraft] = useState<string[]>(selected);
  const toggle = (value: string) =>
    setDraft((prior) =>
      prior.includes(value) ? prior.filter((v) => v !== value) : [...prior, value],
    );
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <ThemedView style={styles.sheet}>
          <ThemedText type="subtitle">{title}</ThemedText>
          <ScrollView style={styles.sheetList} keyboardShouldPersistTaps="handled">
            {options.map((option) => {
              const isSelected = draft.includes(option.value);
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isSelected }}
                  accessibilityLabel={option.label}
                  onPress={() => toggle(option.value)}>
                  <ThemedText style={styles.sheetItem}>
                    {isSelected ? `✓ ${option.label}` : option.label}
                  </ThemedText>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.sheetActions}>
            <Pressable accessibilityRole="button" onPress={onClose}>
              <ThemedView type="backgroundElement" style={styles.sheetButton}>
                <ThemedText>Cancel</ThemedText>
              </ThemedView>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setDraft([])}>
              <ThemedView type="backgroundElement" style={styles.sheetButton}>
                <ThemedText>Clear</ThemedText>
              </ThemedView>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                onApply(draft);
                onClose();
              }}>
              <ThemedView type="backgroundSelected" style={styles.sheetButton}>
                <ThemedText style={styles.badgeEmphasized}>Apply</ThemedText>
              </ThemedView>
            </Pressable>
          </View>
        </ThemedView>
      </View>
    </Modal>
  );
}

/**
 * Standardized consumer card, rendered entirely from the shared presentation
 * contract (lib/recall-presentation.ts) — this component derives no recall
 * wording of its own, so Home and Detail can never disagree. Hierarchy (P1):
 * notice/risk + the one activity date, the Affects-you flag, the hero image,
 * product name, brand, concise reason, compact location. The raw government
 * headline never appears here, and cards carry no per-card agency label —
 * source attribution lives on the detail screen.
 */
function FeedCard({ model }: { model: HomeCardModel }) {
  return (
    <Link href={{ pathname: '/recall/[id]', params: { id: model.id } }} asChild>
      <Pressable accessibilityRole="button">
        <ThemedView type="backgroundElement" style={styles.card}>
          <View style={styles.badgeRow}>
            {/* Consumer risk first — it is the primary risk language. Home
                and Detail render the same risk state from the shared model
                (P2a): rated tiers badge their tier, an unclassified FDA
                recall reads "Risk pending", a PHA's absent class reads
                "Not rated" — the two screens can never disagree. */}
            {model.risk.badgeLabel ? (
              <RiskBadge
                tier={model.risk.tier}
                label={model.risk.badgeLabel}
                accessibilityLabel={model.risk.accessibilityLabel}
              />
            ) : null}
            {/* Public Health Alerts are always explicitly labeled. */}
            {model.noticeLabel ? <Badge label={model.noticeLabel} emphasized /> : null}
            <ThemedText type="small" themeColor="textSecondary">
              {model.activity.text}
            </ThemedText>
            {/* Available in every feed mode whenever saved preferences
                establish a match — not restricted to the Affects me view.
                Exactly ONE generic flag (P2a): the legacy match-explanation
                chips ("Your allergen · Peanuts", "Affects California") are
                retired — matching logic is unchanged, only its rendering. */}
            {model.affectsYou ? <Badge label="Affects you" emphasized /> : null}
          </View>
          {/* Product identity stays dominant; the photo is a recognition aid
              beside it, and the row collapses cleanly when there is none. */}
          <View style={styles.cardBody}>
            <PhotoThumbnail uri={model.heroImageUrl} alt={model.productName} />
            <View style={styles.cardText}>
              <ThemedText type="subtitle">{model.productName}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {model.brand.text}
              </ThemedText>
              {model.reasonLine ? <ThemedText type="small">{model.reasonLine}</ThemedText> : null}
            </View>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {model.locationSummary}
          </ThemedText>
        </ThemedView>
      </Pressable>
    </Link>
  );
}

function CenteredMessage({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.centered}>
      <ThemedText type="subtitle" style={styles.centeredText}>
        {title}
      </ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.centeredText}>
        {body}
      </ThemedText>
    </View>
  );
}

/** Compact invitation to personalize — never a permission prompt. */
function PersonalizeCta({ compact }: { compact?: boolean }) {
  return (
    <Link href="/settings" asChild>
      <Pressable accessibilityRole="button">
        <ThemedView type="backgroundSelected" style={styles.ctaCard}>
          <ThemedText type="subtitle">Personalize Recall</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {compact
              ? 'Choose your state to see which recalls affect your area.'
              : 'Choose your state, allergens, and stores — Home will show what affects you.'}
          </ThemedText>
        </ThemedView>
      </Pressable>
    </Link>
  );
}

interface HomeSection {
  key: 'affects' | 'recent' | 'older';
  title: string;
  data: FeedItem[];
}

export default function HomeScreen() {
  const { state, refreshing, refresh, staleMessage } = useFeed();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
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
      <ThemedView style={styles.container}>
        <CenteredMessage
          title="Backend not configured"
          body="Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env (see README), then restart the dev server."
        />
      </ThemedView>
    );
  }

  if (state.status === 'loading') {
    return (
      <ThemedView style={styles.container}>
        <CenteredMessage title="Loading recalls…" body="Fetching current safety notices." />
      </ThemedView>
    );
  }

  if (state.status === 'error') {
    return (
      <ThemedView style={styles.container}>
        <CenteredMessage title="Could not load recalls" body={state.message} />
      </ThemedView>
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

  return (
    <ThemedView style={styles.container}>
      {/* ── FEED MODE CONTROL (C6.1) ──────────────────────────────────────
          The top-level choice: WHICH feed you are looking at. All and
          Affects me are mutually exclusive scopes, so they get their own
          segmented control rather than sitting among the filter chips that
          merely refine All. */}
      {showTabs ? (
        <View style={styles.modeControl}>
          {(
            [
              { key: 'all', label: 'All' },
              { key: 'affects_me', label: 'Affects me' },
            ] as const
          ).map(({ key, label }) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityState={{ selected: tab === key }}
              style={styles.modeSegment}
              onPress={() => setTab(key)}>
              <ThemedView
                type={tab === key ? 'backgroundSelected' : 'backgroundElement'}
                style={styles.modeSegmentInner}>
                <ThemedText style={tab === key ? styles.badgeEmphasized : undefined}>
                  {label}
                </ThemedText>
              </ThemedView>
            </Pressable>
          ))}
        </View>
      ) : null}
      {/* ── END FEED MODE CONTROL ─────────────────────────────────────────*/}
      <View style={styles.searchRow}>
        <TextInput
          style={[styles.searchInput, { color: theme.text }]}
          placeholder="Search product, company, brand, or code"
          placeholderTextColor={theme.textSecondary}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          accessibilityLabel="Search recalls"
        />
      </View>
      {/* ── ALL-ONLY FILTER ROW (C6.1) ────────────────────────────────────
          Location and Risk refine the All Recalls feed and NOTHING else, so
          they live at their own level, below the feed-mode control, and are
          rendered only while All is the active mode. In Affects me they —
          and their counts and Clear all — are absent entirely: they cannot
          be opened, read, or cleared from there, while the selections stay
          untouched in session state for the return to All.

          Category (C10B) is a third peer in this row, deliberately last: it is
          the only dimension whose values are DERIVED rather than stated by the
          agency, so it sits after the two the source vouches for. It is an
          optional discovery aid — every recall stays reachable with it
          cleared — and it never applies to Affects me. */}
      {tab === 'all' ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterBar}
          contentContainerStyle={styles.filterBarContent}>
          <FilterChip
            label={
              filters.stateCodes.length > 0 ? `Location · ${filters.stateCodes.length}` : 'Location'
            }
            active={filters.stateCodes.length > 0}
            onPress={() => setOpenSheet('location')}
          />
          <FilterChip
            label={filters.riskTiers.length > 0 ? `Risk · ${filters.riskTiers.length}` : 'Risk'}
            active={filters.riskTiers.length > 0}
            onPress={() => setOpenSheet('risk')}
          />
          <FilterChip
            label={
              filters.categoryIds.length > 0
                ? `Category · ${filters.categoryIds.length}`
                : 'Category'
            }
            active={filters.categoryIds.length > 0}
            accessibilityLabel={
              filters.categoryIds.length > 0
                ? `Category filter, ${filters.categoryIds.length} selected`
                : 'Category filter'
            }
            onPress={() => setOpenSheet('category')}
          />
          {filtersActive ? (
            <FilterChip label="Clear all" active={false} onPress={clearAllFilters} />
          ) : null}
        </ScrollView>
      ) : null}
      {tab === 'all' && filtersActive ? (
        <View style={styles.searchRow}>
          <ThemedText type="small" themeColor="textSecondary">
            Filtering All recalls · {activeFilterCount(filters)} selection
            {activeFilterCount(filters) === 1 ? '' : 's'}
          </ThemedText>
        </View>
      ) : null}
      {/* ── END ALL-ONLY FILTER ROW ───────────────────────────────────────*/}
      {/* Affects me says what it is scoped by and offers the way to change
          it. Not an instruction, and no preference logic of its own — the
          link opens the one existing personalization screen. */}
      {tab === 'affects_me' && showTabs ? (
        <View style={[styles.searchRow, styles.contextRow]}>
          <ThemedText type="small" themeColor="textSecondary">
            Based on your personalization
          </ThemedText>
          <Link href="/settings" asChild>
            <Pressable accessibilityRole="button" hitSlop={8}>
              <ThemedText type="small" themeColor="link">
                Edit
              </ThemedText>
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
          <FeedCard
            model={buildHomeCardModel(item, {
              today,
              affectsYou: relevanceById.get(item.id)?.affectsMe ?? false,
            })}
          />
        )}
        renderSectionHeader={({ section }) =>
          section.key === 'older' ? (
            <ThemedView style={styles.sectionHeader}>
              <ThemedText type="small" themeColor="textSecondary">
                {section.title.toUpperCase()} (
                {personalized ? affectsCounts.older : olderActive.length})
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Still listed as active by the issuing agency, but announced more than 60 days ago.
              </ThemedText>
              <Pressable accessibilityRole="button" onPress={() => setShowOlder((value) => !value)}>
                <ThemedText type="small" themeColor="link">
                  {showOlder
                    ? 'Hide older notices'
                    : `Show all ${personalized ? affectsCounts.older : olderActive.length}`}
                </ThemedText>
              </Pressable>
            </ThemedView>
          ) : (
            <ThemedView style={styles.sectionHeader}>
              <ThemedText type="small" themeColor="textSecondary">
                {section.title.toUpperCase()}
              </ThemedText>
            </ThemedView>
          )
        }
        ListHeaderComponent={
          <>
            {/* The feed on screen is complete but possibly out of date — said
                plainly, because silently showing stale counts as current is
                the failure this milestone exists to prevent. */}
            {staleMessage ? (
              <ThemedView type="backgroundElement" style={styles.noticeCard}>
                <ThemedText type="small">
                  Showing the last complete update — couldn’t refresh just now. Pull down to try
                  again.
                </ThemedText>
              </ThemedView>
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
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: Spacing.four + insets.bottom },
        ]}
        style={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        ListEmptyComponent={
          searchActive || (tab === 'all' && filtersActive) ? (
            <CenteredMessage
              title="No matching recalls"
              body={
                searchActive
                  ? 'Nothing matches this search. Check the spelling, or clear the search and filters to see everything.'
                  : 'No current recalls match these filters. Clear all to see the complete feed.'
              }
            />
          ) : personalized ? (
            <CenteredMessage
              title="No current recalls match your preferences"
              body="Nothing right now affects your state or matches your allergens and stores. Check All recalls for the national picture."
            />
          ) : tab === 'affects_me' ? null : (
            <CenteredMessage
              title="No current recalls loaded"
              body="Run the FSIS or FDA ingest against your backend, then pull to refresh."
            />
          )
        }
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  // No alignItems here: a centered cross-axis lets children size to intrinsic
  // content width, which broke wrapping/clipping; centering is done by the
  // content container's own maxWidth + alignSelf.
  container: {
    flex: 1,
  },
  // flex: 1 so the list gets the screen height and can actually scroll —
  // without it the list sizes to its content and the parent just clips it.
  list: {
    flex: 1,
    width: '100%',
  },
  listContent: {
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    padding: Spacing.three,
    gap: Spacing.two,
  },
  searchRow: {
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  // The two scope segments share the row equally, so the control reads as one
  // either/or choice rather than as two chips among many.
  modeControl: {
    flexDirection: 'row',
    gap: Spacing.one,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  modeSegment: {
    flex: 1,
  },
  modeSegmentInner: {
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Radii.medium,
  },
  contextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  searchInput: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Radii.small,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#8884',
  },
  // Horizontally scrollable so all chips stay reachable on small viewports;
  // flexGrow: 0 keeps the bar its content height instead of stealing the list's.
  filterBar: {
    flexGrow: 0,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  filterBarContent: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  tab: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Radii.medium,
  },
  ctaCard: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Radii.medium,
    marginBottom: Spacing.two,
  },
  noticeCard: {
    padding: Spacing.three,
    borderRadius: Radii.medium,
    marginBottom: Spacing.two,
  },
  sectionHeader: {
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
    gap: Spacing.one,
  },
  card: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Radii.medium,
    marginBottom: Spacing.two,
  },
  cardBody: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  // flexShrink lets long product names wrap instead of pushing the thumbnail
  // off the card.
  cardText: {
    flex: 1,
    flexShrink: 1,
    gap: Spacing.one,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
  badge: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Radii.small,
  },
  badgeEmphasized: {
    fontWeight: '600',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  centeredText: {
    textAlign: 'center',
  },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: '#0006',
  },
  sheet: {
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    borderTopLeftRadius: Radii.medium,
    borderTopRightRadius: Radii.medium,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  sheetList: {
    maxHeight: 340,
  },
  // 44pt is the platform minimum touch target. The row previously sized to its
  // text (~28pt), which is a real miss on every sheet, not just Category's —
  // fixed here rather than duplicated per dimension. Layout is otherwise
  // unchanged: the text still sits left, the type scale is untouched.
  sheetItem: {
    paddingVertical: Spacing.one,
    minHeight: 44,
    lineHeight: 44,
  },
  sheetActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.two,
  },
  sheetButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Radii.medium,
  },
});
