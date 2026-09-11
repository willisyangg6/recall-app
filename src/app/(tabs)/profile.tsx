/**
 * Profile (P2A) — a navigation page, not a settings form.
 *
 * Three primary destinations, and nothing that duplicates them:
 *
 *   1. Personalization        (/settings/personalization)
 *   2. Notifications          (/settings/notifications)
 *   3. Privacy & Data Controls (the registered trust document)
 *
 * Until this milestone the first two rows both opened ONE combined screen;
 * they are now separate pages, and this screen still owns no business logic
 * and no state — it links to things that already function. Preferences,
 * notification permission, and the data-reset control stay exactly where
 * they live; nothing was duplicated here.
 *
 * The remaining trust documents (About & Safety, Legal) keep their existing
 * rows below the primary three, taken from the registry rather than invented
 * here — so a finished document can never become unreachable because the
 * landing page got simpler. The one document promoted into the primary trio
 * is skipped when the groups render, so it appears exactly once.
 *
 * Deliberately absent, because no functioning destination exists yet: a
 * Privacy Policy (draft blocked on founder/legal inputs — see
 * docs/recall-launch-blockers.md), Terms/EULA, onboarding, sign-in, and a
 * Support row (no real contact destination exists). No dead filler rows; a
 * row appears here only once a real screen exists behind it.
 */

import Constants from 'expo-constants';
import { Link, type Href } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radii, Spacing } from '@/constants/theme';
import { documentBySlug, PROFILE_DOCUMENT_GROUPS, PROFILE_PRIMARY_DOCUMENT_SLUG } from '@/content';

function LinkRow({ label, detail, href }: { label: string; detail: string; href: Href }) {
  return (
    <Link href={href} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={label}>
        <ThemedView type="backgroundElement" style={styles.row}>
          <ThemedText>{label}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {detail}
          </ThemedText>
        </ThemedView>
      </Pressable>
    </Link>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
      {children.toUpperCase()}
    </ThemedText>
  );
}

export default function ProfileScreen() {
  // Runtime-truthful version: the installed binary's version when running
  // native, the configured app version in Expo Go / web / dev.
  const version = Constants.nativeApplicationVersion ?? Constants.expoConfig?.version ?? null;
  const build = Constants.nativeBuildVersion ?? null;
  const privacy = documentBySlug(PROFILE_PRIMARY_DOCUMENT_SLUG);

  return (
    <ThemedView style={styles.container}>
      <ScrollView style={styles.scroll}>
        <View style={styles.content}>
          <LinkRow
            label="Personalization"
            detail="Your state, allergens to watch, and stores — powers “Affects me.”"
            href="/settings/personalization"
          />
          <LinkRow
            label="Notifications"
            detail="Recall alerts for this device."
            href="/settings/notifications"
          />
          {/* The third primary destination is the registered document itself,
              so its title and summary can never drift from the registry. */}
          {privacy ? (
            <LinkRow
              label={privacy.title}
              detail={privacy.summary}
              href={{ pathname: '/document/[slug]', params: { slug: privacy.slug } }}
            />
          ) : null}

          {PROFILE_DOCUMENT_GROUPS.map((group) => {
            // The promoted document is already a primary row above; showing
            // it again under its group would be the same destination twice.
            const slugs = group.slugs.filter((slug) => slug !== PROFILE_PRIMARY_DOCUMENT_SLUG);
            if (slugs.length === 0) return null;
            return (
              <View key={group.title} style={styles.group}>
                <SectionLabel>{group.title}</SectionLabel>
                {slugs.map((slug) => {
                  const doc = documentBySlug(slug);
                  if (!doc) return null; // Unreachable: the registry tests pin every slug.
                  return (
                    <LinkRow
                      key={doc.slug}
                      label={doc.title}
                      detail={doc.summary}
                      href={{ pathname: '/document/[slug]', params: { slug: doc.slug } }}
                    />
                  );
                })}
              </View>
            );
          })}

          <SectionLabel>Help</SectionLabel>
          <ThemedView type="backgroundElement" style={styles.row}>
            <ThemedText>App version</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {version ? `${version}${build ? ` (${build})` : ''}` : 'Development build'}
            </ThemedText>
          </ThemedView>
          <ThemedText type="small" themeColor="textSecondary">
            Recall information comes from official FDA and USDA FSIS notices; every recall links to
            its government source.
          </ThemedText>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
    width: '100%',
  },
  content: {
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    padding: Spacing.three,
    gap: Spacing.two,
  },
  group: {
    gap: Spacing.two,
  },
  sectionLabel: {
    marginTop: Spacing.two,
  },
  row: {
    padding: Spacing.three,
    borderRadius: Radii.medium,
    gap: Spacing.half,
  },
});
