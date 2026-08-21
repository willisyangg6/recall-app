import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { Link } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radii, Spacing } from '@/constants/theme';
import { companyDisplayName, productSummaryFromTitle } from '@/lib/consumer-summary';
import { fetchCurrentFeed, isFeedConfigured, type FeedItem } from '@/lib/recall-feed';
import {
  geographyLabel,
  isRecent,
  noticeTypeLabel,
  reasonLine,
  riskPresentation,
  timingLine,
} from '@/lib/recall-display';

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
  const risk = riskPresentation(item.classificationValue);
  const product = productSummaryFromTitle(item.title) ?? item.title;
  const company = companyDisplayName(item.firmName);
  const reason = reasonLine(item.reasonText, item.hazardCategory, item.pathogenOrAllergen);
  return (
    <Link href={{ pathname: '/recall/[id]', params: { id: item.id } }} asChild>
      <Pressable accessibilityRole="button">
        <ThemedView type="backgroundElement" style={styles.card}>
          <View style={styles.badgeRow}>
            <Badge
              label={noticeTypeLabel(item.noticeType)}
              emphasized={item.noticeType === 'public_health_alert'}
            />
            {risk ? <Badge label={risk.label} /> : null}
          </View>
          <ThemedText type="subtitle">{product}</ThemedText>
          {company ? (
            <ThemedText type="small" themeColor="textSecondary">
              {company}
            </ThemedText>
          ) : null}
          {reason ? <ThemedText type="small">{reason}</ThemedText> : null}
          <ThemedText type="small">{geographyLabel(item.geography)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {timingLine(item.publishedAt, item.lastPublicActivityAt)} · Source: USDA FSIS
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

  const recent = state.items.filter((item) => isRecent(item.lastPublicActivityAt));
  const older = state.items.filter((item) => !isRecent(item.lastPublicActivityAt));
  const sections = [
    ...(recent.length > 0 ? [{ title: 'Recent', data: recent }] : []),
    ...(older.length > 0 ? [{ title: 'Ongoing, older', data: older }] : []),
  ];

  return (
    <ThemedView style={styles.container}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <FeedCard item={item} />}
        renderSectionHeader={({ section }) => (
          <ThemedView style={styles.sectionHeader}>
            <ThemedText type="small" themeColor="textSecondary">
              {section.title.toUpperCase()}
            </ThemedText>
          </ThemedView>
        )}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: Spacing.four + insets.bottom },
        ]}
        style={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        ListEmptyComponent={
          <CenteredMessage
            title="No current recalls loaded"
            body="Run the FSIS ingest against your backend, then pull to refresh."
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
  },
  card: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Radii.medium,
    marginBottom: Spacing.two,
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
