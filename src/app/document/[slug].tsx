/**
 * The one reusable trust-document screen (C7; restyled in P2B6B): renders
 * any document from the content registry (src/content) through the shared
 * document renderer (components/document). All business claims live in the
 * structured content — this file is the page and nothing else, so a claim
 * can never exist in JSX alone.
 *
 * The page is the warm page colour under the navigator's tokenized header,
 * which names the Profile group the document sits in while the page names
 * the document itself (lib/document-screen.ts); 16pt margins, the content
 * column capped at `max-content-width`, the bottom safe-area inset added to
 * the content padding. Text is selectable (people quote safety information),
 * external links open the official source in the system browser, document
 * links push this same route, and an unknown slug renders the shared
 * not-found state rather than crashing — the same convention as Recall
 * Detail. Nothing on the page scrolls sideways.
 */

import { Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DocumentView } from '@/components/document/document-view';
import { InstallationResetSection } from '@/components/installation-reset-section';
import { StateMessage } from '@/components/state-message';
import { Surface } from '@/components/ui/surface';
import { layout, spacing } from '@/constants/design-tokens';
import { documentBySlug } from '@/content';
import { DOCUMENT_NOT_FOUND, navigatorTitle } from '@/lib/document-screen';

export default function DocumentScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const doc = documentBySlug(slug);
  const insets = useSafeAreaInsets();

  if (!doc) {
    return (
      <Surface background="background/page" style={styles.page}>
        <Stack.Screen options={{ title: DOCUMENT_NOT_FOUND.title }} />
        <StateMessage {...DOCUMENT_NOT_FOUND} />
      </Surface>
    );
  }

  return (
    <Surface background="background/page" style={styles.page}>
      <Stack.Screen options={{ title: navigatorTitle(doc) }} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: spacing[24] + insets.bottom }]}>
        <DocumentView doc={doc} />
        {/* C7.1: the one destructive data control lives at the bottom of
            Privacy & Data Controls — and only there (frozen product
            decision; pinned by the trust-center tests). */}
        {doc.slug === 'privacy-data-controls' ? <InstallationResetSection /> : null}
      </ScrollView>
    </Surface>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  scroll: {
    flex: 1,
    width: '100%',
  },
  content: {
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: layout.pageMargin,
    paddingTop: spacing[16],
  },
});
