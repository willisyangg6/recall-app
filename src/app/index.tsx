import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { Link } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PhotoThumbnail } from '@/components/photo-gallery';
import { RiskBadge } from '@/components/risk-badge';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radii, Spacing } from '@/constants/theme';
import { brandLine, companyLine, productDisplayName } from '@/lib/consumer-summary';
import { buildFeedSections } from '@/lib/feed-relevance';
import { fetchCurrentFeed, isFeedConfigured, type FeedItem } from '@/lib/recall-feed';
import { riskView } from '@/lib/risk-display';
import { geographyLabel, noticeTypeLabel, reasonLine, timingLine } from '@/lib/recall-display';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: FeedItem[] };

function useFeed() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const items = await fetchCurrentFeed();
      setState({ status: 'ready', items });
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Could not load recalls.',
      });
    }
  }, []);

  useEffect(() => {
    // Fetch-on-mount: state updates happen after the network await resolves,
    // not synchronously in the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isFeedConfigured()) void load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return { state, refreshing, refresh };
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
 */
function FeedCard({ item }: { item: FeedItem }) {
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
            {timingLine(item.publishedAt, item.lastPublicActivityAt)} · Source: {sourceLabel}
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

export default function HomeScreen() {
  const { state, refreshing, refresh } = useFeed();
  const insets = useSafeAreaInsets();
  const [showOlder, setShowOlder] = useState(false);

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
  const sections = [
    ...(recent.length > 0 ? [{ key: 'recent', title: 'Recent activity', data: recent }] : []),
    ...(olderActive.length > 0
      ? [{ key: 'older', title: 'Older active notices', data: showOlder ? olderActive : [] }]
      : []),
  ];

  return (
    <ThemedView style={styles.container}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <FeedCard item={item} />}
        renderSectionHeader={({ section }) =>
          section.key === 'older' ? (
            <ThemedView style={styles.sectionHeader}>
              <ThemedText type="small" themeColor="textSecondary">
                {section.title.toUpperCase()} ({olderActive.length})
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Still listed as active by the issuing agency, but announced more than 60 days ago.
              </ThemedText>
              <Pressable accessibilityRole="button" onPress={() => setShowOlder((value) => !value)}>
                <ThemedText type="small" themeColor="link">
                  {showOlder ? 'Hide older notices' : `Show all ${olderActive.length}`}
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
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: Spacing.four + insets.bottom },
        ]}
        style={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        ListEmptyComponent={
          <CenteredMessage
            title="No current recalls loaded"
            body="Run the FSIS or FDA ingest against your backend, then pull to refresh."
          />
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
