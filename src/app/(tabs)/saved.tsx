/**
 * Saved (P2A) — the recalls this device bookmarked, newest save first.
 *
 * ## Why this screen stores nothing
 *
 * It holds a list of case IDS and resolves them against the SAME complete
 * corpus the Feed already loads (hooks/use-feed owns the one session, so
 * opening this tab joins the feed's in-flight sync rather than starting a
 * second one). A saved snapshot would be a second, silently ageing copy of
 * information whose accuracy is the entire product — so a saved recall shows
 * today's official facts or is honestly reported as gone from the active
 * feed, never a stale reassurance.
 *
 * ## What it deliberately does not do
 *
 * No community-report counts (that block belongs to Recall Details and is
 * gated server-side anyway), no ranking, no personalization, no notification
 * or permission side effects, and no server call of its own. Opening this
 * tab cannot mint an installation identity.
 *
 * Cards are the shared `RecallCard`, so a saved recall reads exactly as it
 * does in the feed.
 */

import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { RecallCard } from '@/components/recall-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useFeed } from '@/hooks/use-feed';
import { useSavedRecalls } from '@/hooks/use-saved-recalls';
import { isFeedConfigured } from '@/lib/recall-feed';
import { buildHomeCardModel, todayIso } from '@/lib/recall-presentation';
import {
  missingSavedCount,
  SAVED_EMPTY_BODY,
  SAVED_EMPTY_TITLE,
  savedMissingNotice,
  selectSavedItems,
} from '@/lib/saved-recalls';

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

export default function SavedScreen() {
  const { state, refreshing, refresh, staleMessage } = useFeed();
  const { ids, loaded, available } = useSavedRecalls();

  if (!available) {
    return (
      <ThemedView style={styles.container}>
        <CenteredMessage
          title="Saving is available in the app"
          body="Saved recalls are stored on your device. Open Recall on your phone to save one."
        />
      </ThemedView>
    );
  }

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

  // Nothing is claimed before BOTH answers are in. Rendering the empty state
  // while storage or the corpus is still loading would tell a user with
  // saved recalls that they have none.
  if (!loaded || state.status === 'loading') {
    return (
      <ThemedView style={styles.container}>
        <CenteredMessage title="Loading saved recalls…" body="Reading what you saved." />
      </ThemedView>
    );
  }

  if (ids.length === 0) {
    return (
      <ThemedView style={styles.container}>
        <CenteredMessage title={SAVED_EMPTY_TITLE} body={SAVED_EMPTY_BODY} />
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

  const items = selectSavedItems(ids, state.items);
  const missing = savedMissingNotice(missingSavedCount(ids, state.items));
  const today = todayIso();

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />
        }>
        {staleMessage ? (
          <ThemedView type="backgroundElement" style={styles.noticeCard}>
            <ThemedText type="small">
              Showing the last complete update — couldn’t refresh just now. Pull down to try again.
            </ThemedText>
          </ThemedView>
        ) : null}
        {items.map((item) => (
          <RecallCard
            key={item.id}
            model={buildHomeCardModel(item, { today, affectsYou: false })}
          />
        ))}
        {/* Said plainly rather than silently showing a shorter list than the
            user saved: these recalls left the active feed, they were not
            dropped by mistake. */}
        {missing ? (
          <ThemedText type="small" themeColor="textSecondary">
            {missing}
          </ThemedText>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
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
  noticeCard: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    marginBottom: Spacing.two,
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
