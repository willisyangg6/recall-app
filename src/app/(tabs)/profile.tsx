/**
 * Profile (P2A structure, P2B5 design) — a navigation page, not a settings
 * form, in the founder's chosen hybrid: personalization first, then grouped
 * boxes.
 *
 *   1. Personalization      the featured card: this device's state, allergens
 *                           and stores, read here and edited THERE
 *   2. Notifications        a boxed row      (/settings/notifications)
 *   3. Privacy & Data       Privacy & Data Controls, with its supporting line
 *   4. About & Safety       the five educational documents, by title, with
 *                           the sources sentence as the group's caption
 *   5. Legal                Attributions
 *   6. App                  the version line
 *   7. Development          the harness row — development builds only
 *
 * ## What Profile reads, and what it never writes
 *
 * The featured card shows this device's real preferences, read on every
 * focus through the SAME store the Personalization screen saves to
 * (`loadPreferences`), so an edit made there is on the card when the user
 * comes back — exactly how the Feed recomputes Affects Me. Profile holds no
 * second copy and no second store: the read lands in local state that only
 * this render uses, and nothing here can save, sync, or reset a preference
 * (the save path and the reset are imported nowhere on this screen; the
 * structure tests pin that). A read that has not resolved shows a loading
 * state, and a read that fails — or a platform with no preferences — shows
 * `Unavailable`; neither is ever rendered as an empty choice. While a
 * re-read is in flight the card keeps the last real answer rather than
 * flashing back to loading.
 *
 * The document groups render from the registry (`PROFILE_DOCUMENT_GROUPS`),
 * in the registry's order, so a finished document can never become
 * unreachable because the hub changed; the one primary document keeps its
 * supporting line and the rest read by title. The reset stays at the bottom
 * of Privacy & Data Controls alone (frozen C7.1 decision) — the hub carries
 * no destructive action.
 *
 * Deliberately absent, because no functioning destination exists yet: a
 * Privacy Policy (draft blocked on founder/legal inputs — see
 * docs/recall-launch-blockers.md), Terms, onboarding, sign-in, and a
 * Support row (no real contact destination exists). No dead filler rows; a
 * row appears here only once a real screen exists behind it. And nothing
 * that would imply an identity: no name, picture, email, subscription,
 * statistic or sync.
 *
 * One row is not a product destination at all: Design Preview, the
 * development-only screenshot harness (docs/recall-design-preview.md). It is
 * written behind the bare `__DEV__` identifier so Metro eliminates it from a
 * release bundle outright — there is no runtime check to get wrong, and no
 * flag a build could set — and `DevelopmentEntry` refuses to render outside a
 * development build besides. It is last on the page, under a heading that
 * says what it is, so it can never be mistaken for a shopper-facing
 * destination.
 *
 * The header is the navigator's own `Profile` title, styled with the Feed's
 * and Saved's `screenHeader`; there is no second heading on the page.
 */

import { useCallback, useState } from 'react';
import Constants from 'expo-constants';
import { useFocusEffect } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DevelopmentEntry } from '@/components/profile/development-entry';
import { NavigationRow } from '@/components/profile/navigation-row';
import { PersonalizationCard } from '@/components/profile/personalization-card';
import { ProfileSection } from '@/components/profile/profile-section';
import { ValueRow } from '@/components/profile/value-row';
import { Surface } from '@/components/ui/surface';
import { layout, spacing } from '@/constants/design-tokens';
import { documentBySlug, PROFILE_DOCUMENT_GROUPS, PROFILE_PRIMARY_DOCUMENT_SLUG } from '@/content';
import { loadPreferences, preferencesAvailable } from '@/lib/preferences-store';
import {
  APP_VERSION_LABEL,
  DOCUMENT_HINT,
  NOTIFICATIONS_HINT,
  NOTIFICATIONS_SUMMARY,
  summarizePreferences,
  versionLine,
  type PreferenceSummaryState,
} from '@/lib/profile-hub';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  // Runtime-truthful version: the installed binary's version when running
  // native, the configured app version in Expo Go / web / dev.
  const version = Constants.nativeApplicationVersion ?? Constants.expoConfig?.version ?? null;
  const build = Constants.nativeBuildVersion ?? null;

  // Loading until the store answers; never an assumed empty set.
  const [summary, setSummary] = useState<PreferenceSummaryState>({ status: 'loading' });

  useFocusEffect(
    useCallback(() => {
      // Read-only, on every focus: coming back from Personalization shows
      // what was just saved there. A platform without preferences (web) is
      // unavailable, honestly, rather than empty.
      if (!preferencesAvailable()) {
        setSummary({ status: 'unavailable' });
        return;
      }
      let current = true;
      loadPreferences().then(
        (prefs) => {
          if (current) setSummary({ status: 'ready', summary: summarizePreferences(prefs) });
        },
        () => {
          if (current) setSummary({ status: 'unavailable' });
        },
      );
      return () => {
        // A read that resolves after the screen lost focus is discarded, so a
        // slower earlier read can never overwrite a newer answer.
        current = false;
      };
    }, []),
  );

  return (
    <Surface background="background/page" style={styles.page}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: spacing[24] + insets.bottom }]}>
        {/* The two preferences a shopper comes back to change, closest to the
            top and closest together; the card is the one navigation target. */}
        <View style={styles.preferences}>
          <PersonalizationCard
            label="Personalization"
            href="/settings/personalization"
            state={summary}
          />
          <Surface radius={16} border="border/subtle" style={styles.box}>
            <NavigationRow
              label="Notifications"
              summary={NOTIFICATIONS_SUMMARY}
              href="/settings/notifications"
              hint={NOTIFICATIONS_HINT}
            />
          </Surface>
        </View>

        {PROFILE_DOCUMENT_GROUPS.map((group) => (
          <ProfileSection key={group.title} title={group.title} footnote={group.footnote}>
            {group.slugs.map((slug) => {
              const doc = documentBySlug(slug);
              if (!doc) return null; // Unreachable: the registry tests pin every slug.
              return (
                <NavigationRow
                  key={doc.slug}
                  label={doc.title}
                  summary={doc.slug === PROFILE_PRIMARY_DOCUMENT_SLUG ? doc.summary : undefined}
                  href={{ pathname: '/document/[slug]', params: { slug: doc.slug } }}
                  hint={DOCUMENT_HINT}
                />
              );
            })}
          </ProfileSection>
        ))}

        <ProfileSection title="App">
          <ValueRow label={APP_VERSION_LABEL} value={versionLine(version, build)} />
        </ProfileSection>

        {/* Development builds only — eliminated from release bundles with
            the branch itself. Never a product destination. */}
        {__DEV__ ? (
          <DevelopmentEntry
            label="Design Preview"
            summary="Local tooling for screenshotting shopper-report states. Not part of the product."
            href="/design-preview"
          />
        ) : null}
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
  // The content column at the page margin, capped at the content width, with
  // one section's breathing room between groups.
  content: {
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: layout.pageMargin,
    paddingTop: spacing[16],
    gap: spacing[24],
  },
  preferences: {
    gap: spacing[8],
  },
  box: {
    overflow: 'hidden',
  },
});
