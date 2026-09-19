/**
 * Saved (P2A behaviour; P2B4 appearance) — the recalls this device
 * bookmarked, newest save first.
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
 * No folders, categories, notes, sorting, search or filters: Saved is one
 * personal list, and the Feed is where recalls are found. No community-report
 * counts (that block belongs to Recall Details and is gated server-side
 * anyway), no ranking, no notification or permission side effects, and no
 * server call of its own. Opening this tab cannot mint an installation
 * identity.
 *
 * It does read PREFERENCES, and the distinction matters (P2B7N.1). What
 * Saved does not do is PERSONALIZE — it never ranks, filters or selects by
 * relevance; the list is save order, the whole list, always. But a card that
 * says AFFECTS YOU in the Feed and stays silent here is not restraint, it is
 * the same recall making two different claims about the same shopper. So the
 * preferences are read through the shared hook and handed to the shared card
 * builder, which derives the verdict; this screen still decides nothing.
 *
 * ## Appearance (P2B4)
 *
 * The warm page under the navigator's own `Saved` title — no second in-page
 * heading — with the Feed's list rhythm: the shared `RecallCard` at the
 * content width, 16px apart, 16pt page margins. Every whole-screen state is
 * the shared `StateMessage`; the empty one carries the bookmark glyph the
 * tab and the save control already use, and the two notices (a refresh that
 * failed over a feed we still hold, and saved recalls the active feed no
 * longer carries) are the shared soft-blue information callout.
 *
 * Cards are the shared `RecallCard`, so a saved recall reads exactly as it
 * does in the feed — one implementation, never a copy that could drift.
 */

import { FlatList, RefreshControl, StyleSheet } from 'react-native';

import { RecallCard } from '@/components/recall-card';
import { StateMessage } from '@/components/state-message';
import { Callout } from '@/components/ui/callout';
import { Surface } from '@/components/ui/surface';
import { color, layout, spacing } from '@/constants/design-tokens';
import { useFeed } from '@/hooks/use-feed';
import { usePreferences } from '@/hooks/use-preferences';
import { useSavedRecalls } from '@/hooks/use-saved-recalls';
import { FEED_STALE_NOTICE } from '@/lib/feed-copy';
import { isFeedConfigured } from '@/lib/recall-feed';
import { buildHomeCardModel, todayIso } from '@/lib/recall-presentation';
import {
  missingSavedCount,
  SAVED_EMPTY,
  SAVED_ERROR_TITLE,
  SAVED_LOADING,
  SAVED_NOT_CONFIGURED,
  SAVED_NOT_CONFIGURED_DEV,
  SAVED_UNAVAILABLE,
  savedMissingNotice,
  selectSavedItems,
} from '@/lib/saved-recalls';

/** The warm page every Saved state sits on. */
function Page({ children }: { children: React.ReactNode }) {
  return (
    <Surface background="background/page" style={styles.page}>
      {children}
    </Surface>
  );
}

export default function SavedScreen() {
  const { state, refreshing, refresh, staleMessage } = useFeed();
  const { ids, loaded, available } = useSavedRecalls();
  // Read for the SAME reason the Feed reads them, through the same hook:
  // "Affects you" is a claim about the current user, so a saved card has to
  // be built against the profile that exists right now. Hooks run before any
  // early return, so every state below this line is reached identically.
  const prefs = usePreferences();

  if (!available) {
    return (
      <Page>
        <StateMessage {...SAVED_UNAVAILABLE} />
      </Page>
    );
  }

  if (!isFeedConfigured()) {
    return (
      <Page>
        {/* Developer wording only when `__DEV__`, as on the Feed. */}
        <StateMessage
          {...(__DEV__ ? SAVED_NOT_CONFIGURED_DEV : SAVED_NOT_CONFIGURED)}
          tone="error"
        />
      </Page>
    );
  }

  // Nothing is claimed before BOTH answers are in. Rendering the empty state
  // while storage or the corpus is still loading would tell a user with
  // saved recalls that they have none.
  if (!loaded || state.status === 'loading') {
    return (
      <Page>
        <StateMessage {...SAVED_LOADING} tone="loading" />
      </Page>
    );
  }

  if (ids.length === 0) {
    return (
      <Page>
        <StateMessage {...SAVED_EMPTY} icon="bookmark" />
      </Page>
    );
  }

  // A feed read that failed says so and nothing more: the saved ids are
  // untouched on this device, and no copy here may suggest otherwise.
  if (state.status === 'error') {
    return (
      <Page>
        <StateMessage title={SAVED_ERROR_TITLE} body={state.message} tone="error" />
      </Page>
    );
  }

  const items = selectSavedItems(ids, state.items);
  const missing = savedMissingNotice(missingSavedCount(ids, state.items));
  const today = todayIso();

  return (
    <Page>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <RecallCard model={buildHomeCardModel(item, { today, prefs })} />}
        // The feed on screen is complete but possibly out of date — said
        // plainly, in the same words the Feed uses, because silently showing
        // stale facts as current is the failure the sentence exists for.
        ListHeaderComponent={
          staleMessage ? (
            <Callout tone="information" accessibilityLiveRegion="polite">
              {FEED_STALE_NOTICE}
            </Callout>
          ) : null
        }
        // Said plainly rather than silently showing a shorter list than the
        // user saved: these recalls left the active feed, they were not
        // dropped by mistake, and their ids stay on the device.
        ListFooterComponent={missing ? <Callout tone="information">{missing}</Callout> : null}
        contentContainerStyle={styles.listContent}
        style={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={color['action/primary']}
          />
        }
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  // flex: 1 so the list gets the screen height and can actually scroll —
  // without it the list sizes to its content and the parent just clips it.
  list: {
    flex: 1,
    width: '100%',
  },
  // The Feed's rhythm exactly: the page margin, the same gap between cards,
  // and the same breathing room below the last one — the bottom navigation
  // already sits above the home indicator.
  listContent: {
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: layout.pageMargin,
    paddingTop: spacing[8],
    paddingBottom: spacing[24],
    gap: spacing[16],
  },
});
