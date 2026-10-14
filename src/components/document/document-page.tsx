/**
 * One trust document as a page: the document, plus the interactive privacy
 * sections when it is Privacy & Data Controls. Shared by the document route
 * (`/document/[slug]`, app phase) and the privacy-controls route
 * (`/privacy/controls`, app and paywall phases; B8), so both render the
 * same claims from the same content and never drift.
 */

import { Stack } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DocumentView } from '@/components/document/document-view';
import { AllergenConsentStatusSection } from '@/components/allergen-consent/allergen-consent-status';
import { InstallationResetSection } from '@/components/installation-reset-section';
import { PrivacyRequestsSection } from '@/components/privacy-requests-section';
import { StateMessage } from '@/components/state-message';
import { Surface } from '@/components/ui/surface';
import { layout, spacing } from '@/constants/design-tokens';
import type { TrustDocument } from '@/content/document-model';
import { DOCUMENT_NOT_FOUND } from '@/lib/document-screen';

export function DocumentPage({ doc, title }: { doc: TrustDocument | undefined; title: string }) {
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
      <Stack.Screen options={{ title }} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: spacing[24] + insets.bottom }]}>
        <DocumentView doc={doc} />
        {doc.slug === 'privacy-data-controls' ? <PrivacyRequestsSection /> : null}
        {/* C7.1: the one destructive data control lives at the bottom of
            Privacy & Data Controls — and only there (frozen product
            decision; pinned by the trust-center tests). */}
        {doc.slug === 'privacy-data-controls' ? <AllergenConsentStatusSection /> : null}
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
