/**
 * Profile (C7) — the trust center, still in the temporary visual language.
 *
 * This screen deliberately owns NO business logic and NO state: it is
 * navigation into things that already function. Personalization and
 * notification controls stay exactly where they live today — the Settings
 * screen (route `/settings`, title "Alerts") — untouched and unduplicated,
 * and every existing `/settings` reference keeps working unchanged.
 *
 * The About & Safety / Privacy & Data / Legal rows come from the trust
 * document registry (src/content): the rows, their order, and their wording
 * are the registry's, so Profile can never invent a destination or leave a
 * finished document unreachable (enforced by the trust-document tests).
 *
 * Deliberately absent, because no functioning destination exists yet: a
 * Privacy Policy (draft blocked on founder/legal inputs — see
 * docs/recall-launch-blockers.md), Terms/EULA, and a Support row (no real
 * contact destination exists). No dead filler rows; a row appears here only
 * once a real screen exists behind it.
 */

import Constants from 'expo-constants';
import { Link, type Href } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radii, Spacing } from '@/constants/theme';
import { documentBySlug, PROFILE_DOCUMENT_GROUPS } from '@/content';

function LinkRow({ label, detail, href }: { label: string; detail: string; href: Href }) {
  return (
    <Link href={href} asChild>
      <Pressable accessibilityRole="button">
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

  return (
    <ThemedView style={styles.container}>
      <ScrollView style={styles.scroll}>
        <View style={styles.content}>
          <SectionLabel>Personal settings</SectionLabel>
          <LinkRow
            label="Personalization"
            detail="Your state, allergens to watch, and stores — powers “Affects me.”"
            href="/settings"
          />
          <LinkRow label="Notifications" detail="Recall alerts for this device." href="/settings" />

          {PROFILE_DOCUMENT_GROUPS.map((group) => (
            <View key={group.title} style={styles.group}>
              <SectionLabel>{group.title}</SectionLabel>
              {group.slugs.map((slug) => {
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
          ))}

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
