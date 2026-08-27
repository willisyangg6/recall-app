import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PhotoThumbnail } from '@/components/photo-gallery';
import { RiskBadge } from '@/components/risk-badge';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radii, Spacing } from '@/constants/theme';
import { hasAnyPreference, type UserRecallPreferences } from '@/domain/preferences';
import { buildAffectsMeSections, type AffectsMePriority } from '@/lib/affects-me-ranking';
import { brandLine, companyLine, productDisplayName } from '@/lib/consumer-summary';
import { buildFeedSections } from '@/lib/feed-relevance';
import { loadPreferences, preferencesAvailable } from '@/lib/preferences-store';
import { fetchCurrentFeed, isFeedConfigured, type FeedItem } from '@/lib/recall-feed';
import { evaluatePersonalRelevance, type PersonalRelevance } from '@/lib/relevance';
import { riskView } from '@/lib/risk-display';
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

function useFeed() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  /** Set when a refresh failed over a feed we still hold — see below. */
  const [staleMessage, setStaleMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const items = await fetchCurrentFeed();
      setState({ status: 'ready', items });
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
    // Fetch-on-mount: state updates happen after the network await resolves,
    // not synchronously in the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isFeedConfigured()) void load();
  }, [load]);

  // Always safe to repeat: each attempt re-pages from scratch and replaces the
  // feed only on complete success.
  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

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
  key: 'affects' | 'unknown' | 'recent' | 'older';
  title: string;
  data: FeedItem[];
}

export default function HomeScreen() {
  const { state, refreshing, refresh, staleMessage } = useFeed();
  const insets = useSafeAreaInsets();
  const [showOlder, setShowOlder] = useState(false);
  const [showUnknown, setShowUnknown] = useState(false);
  const [tab, setTab] = useState<FeedTab>('all');
  const prefs = usePreferences(
    useCallback((loaded: UserRecallPreferences) => {
      // Default to the personalized view only when personalization exists.
      if (hasAnyPreference(loaded)) setTab('affects_me');
    }, []),
  );

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
  const { recent, olderActive } = buildFeedSections(state.items);

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
          },
          prefs,
        ),
      );
    }
  }

  let sections: HomeSection[];
  let affectsCounts = { affects: 0, unknown: 0, older: 0 };
  // Sort keys, kept only to source the card's "Updated …" date. Nothing here
  // is ever rendered as a score.
  let priorityById = new Map<string, AffectsMePriority>();
  if (personalized) {
    // One deterministic ranking for the whole tab (lib/affects-me-ranking.ts) —
    // eligibility, geography semantics, and section membership rules are
    // exactly as before; only the order and the recency date changed.
    const ranked = buildAffectsMeSections(state.items, (item) => relevanceById.get(item.id)!, {
      stateChosen: prefs.state !== null,
    });
    const { affects, unknown, older } = ranked;
    priorityById = ranked.priorityById;
    affectsCounts = { affects: affects.length, unknown: unknown.length, older: older.length };
    sections = [
      ...(affects.length > 0
        ? [{ key: 'affects' as const, title: 'Affects me', data: affects }]
        : []),
      ...(unknown.length > 0
        ? [
            {
              key: 'unknown' as const,
              title: 'Location not specified',
              data: showUnknown ? unknown : [],
            },
          ]
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

  return (
    <ThemedView style={styles.container}>
      {showTabs ? (
        <View style={styles.tabBar}>
          {(
            [
              { key: 'affects_me', label: 'Affects me' },
              { key: 'all', label: 'All recalls' },
            ] as const
          ).map(({ key, label }) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityState={{ selected: tab === key }}
              onPress={() => setTab(key)}>
              <ThemedView
                type={tab === key ? 'backgroundSelected' : 'backgroundElement'}
                style={styles.tab}>
                <ThemedText style={tab === key ? styles.badgeEmphasized : undefined}>
                  {label}
                </ThemedText>
              </ThemedView>
            </Pressable>
          ))}
        </View>
      ) : null}
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={({ item, section }) => (
          <FeedCard
            item={item}
            personalReasons={
              personalized && section.key !== 'unknown'
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
          ) : section.key === 'unknown' ? (
            <ThemedView style={styles.sectionHeader}>
              <ThemedText type="small" themeColor="textSecondary">
                {section.title.toUpperCase()} ({affectsCounts.unknown})
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                These notices don’t say where products were sold — they may still affect you.
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                onPress={() => setShowUnknown((value) => !value)}>
                <ThemedText type="small" themeColor="link">
                  {showUnknown ? 'Hide these notices' : `Show all ${affectsCounts.unknown}`}
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
          personalized ? (
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
  tabBar: {
    flexDirection: 'row',
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
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
});
