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
import {
  hasAnyPreference,
  stateNameForCode,
  SUPPORTED_STATE_CODES,
  type UserRecallPreferences,
} from '@/domain/preferences';
import { useTheme } from '@/hooks/use-theme';
import { buildAffectsMeSections, type AffectsMePriority } from '@/lib/affects-me-ranking';
import {
  activeFilterCount,
  applyFeedFilters,
  EMPTY_FEED_FILTERS,
  hasActiveFilters,
  orderByLocationTiers,
  RISK_FILTER_TIERS,
  type FeedFilterState,
} from '@/lib/feed-filters';
import { buildSearchEntry, filterBySearch, type SearchEntry } from '@/lib/feed-search';
import { brandLine, companyLine, productDisplayName } from '@/lib/consumer-summary';
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
import { evaluatePersonalRelevance, type PersonalRelevance } from '@/lib/relevance';
import { riskTierWord, riskView } from '@/lib/risk-display';
import { geographyLabel, noticeTypeLabel, reasonLine, timingLine } from '@/lib/recall-display';

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
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
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
 * Standardized consumer card: product identity leads; the raw government
 * headline never appears here (it stays available on the detail screen).
 * In "Affects me", up to two personalization reasons render as chips —
 * strongest first (allergen, retailer, then geography) — and risk stays in
 * its own badge, visually separate.
 */
function FeedCard({
  item,
  personalReasons,
  activityDate,
}: {
  item: FeedItem;
  personalReasons?: string[];
  /**
   * The date the card's "Updated …" half should report. "Affects me" passes
   * the MATERIAL activity date, so a card can only claim an update when an
   * authoritative event actually happened; All Recalls omits it and keeps
   * `lastPublicActivityAt`. Neither ever implies the recall was announced
   * today — the announcement date is always stated separately.
   */
  activityDate?: string;
}) {
  // Consumer risk tier leads the card; the regulatory class it was derived
  // from lives on the detail screen, never here.
  const risk = riskView(item.classification, item.sourceAgency);
  const product = productDisplayName(item.productDescription, item.title);
  const company = companyLine(item.firmName, item.title);
  const brands = brandLine(item.brands, item.firmName, product);
  const reason = reasonLine(item.reasonText, item.hazardCategory, item.pathogenOrAllergen);
  const sourceLabel = item.sourceAgency === 'FDA' ? 'FDA' : 'USDA FSIS';
  return (
    <Link href={{ pathname: '/recall/[id]', params: { id: item.id } }} asChild>
      <Pressable accessibilityRole="button">
        <ThemedView type="backgroundElement" style={styles.card}>
          <View style={styles.badgeRow}>
            {/* Consumer risk first — it is the primary risk language. A badge
                only for a rated tier: "pending" on every fresh FDA card reads
                as unfinished, and the hazard line below is the prominent risk
                information until a class arrives. The truthful pending state
                stays on the detail screen. */}
            {risk.badgeLabel ? (
              <RiskBadge
                tier={risk.tier}
                label={risk.badgeLabel}
                accessibilityLabel={risk.accessibilityLabel}
              />
            ) : null}
            <Badge
              label={noticeTypeLabel(item.noticeType)}
              emphasized={item.noticeType === 'public_health_alert'}
            />
          </View>
          {personalReasons && personalReasons.length > 0 ? (
            <View style={styles.badgeRow}>
              {personalReasons.slice(0, 2).map((label) => (
                <Badge key={label} label={label} emphasized />
              ))}
            </View>
          ) : null}
          {/* Product identity stays dominant; the photo is a recognition aid
              beside it, and the row collapses cleanly when there is none. */}
          <View style={styles.cardBody}>
            <View style={styles.cardText}>
              <ThemedText type="subtitle">{product}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {brands ? `${company} · Brand: ${brands}` : company}
              </ThemedText>
              {reason ? <ThemedText type="small">{reason}</ThemedText> : null}
              <ThemedText type="small">{geographyLabel(item.geography)}</ThemedText>
            </View>
            <PhotoThumbnail uri={item.heroImageUrl} alt={product} />
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {timingLine(item.publishedAt, activityDate ?? item.lastPublicActivityAt)} · Source:{' '}
            {sourceLabel}
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
  const [openSheet, setOpenSheet] = useState<'location' | 'risk' | null>(null);
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

  // Applying a browsing filter while viewing Affects me switches to All —
  // the filters describe the complete feed, never the personal one. The
  // selection itself survives mode switches in `filters` untouched.
  const applyDimension = useCallback((dimension: 'stateCodes' | 'riskTiers', next: string[]) => {
    setFilters((prior) => ({ ...prior, [dimension]: next }) as FeedFilterState);
    if (next.length > 0) setTab('all');
  }, []);

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
  const relevanceById = new Map<string, PersonalRelevance>();
  if (personalized) {
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

  let sections: HomeSection[];
  let affectsCounts = { affects: 0, older: 0 };
  // Sort keys, kept only to source the card's "Updated …" date. Nothing here
  // is ever rendered as a score.
  let priorityById = new Map<string, AffectsMePriority>();
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
    priorityById = ranked.priorityById;
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

          Category is deliberately absent from this row: the deterministic
          product-category matcher failed its frozen generalization gates
          (docs/recall-food-categories.md), and a filter that miscategorizes
          one recall in ten HIDES recalls. */}
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
          {filtersActive ? (
            <FilterChip
              label="Clear all"
              active={false}
              onPress={() => setFilters(EMPTY_FEED_FILTERS)}
            />
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
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={({ item, section }) => (
          <FeedCard
            item={item}
            personalReasons={
              personalized
                ? relevanceById.get(item.id)?.reasons.map((reason) => reason.label)
                : undefined
            }
            activityDate={personalized ? priorityById.get(item.id)?.materialActivityAt : undefined}
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
  sheetItem: {
    paddingVertical: Spacing.one,
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
