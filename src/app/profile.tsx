/**
 * Minimal Profile (C6) — structural preparation in the temporary visual
 * language, NOT the final Profile design.
 *
 * This screen deliberately owns NO business logic and NO state: it is a set
 * of links into the areas that already function. Personalization and
 * notification controls stay exactly where they live today — the Settings
 * screen (route `/settings`, title "Alerts"), with its preference store,
 * serial save queue, local-first persistence, and server mirror untouched and
 * unduplicated. Push deep links and every existing `/settings` reference keep
 * working unchanged.
 *
 * Restyling/moving later: because this file is only navigation + an About
 * block, the final design can restyle it, move its rows into tabs, or split
 * Settings into separate Personalization/Notifications screens without
 * touching any preference or push logic — none of it lives here. The only
 * coupling is the `/settings` href and the header entry in `_layout.tsx`.
 *
 * Deliberately absent (functioning destinations do not exist yet): privacy/
 * data controls, methodology, legal, help/contact. No dead filler pages; rows
 * appear here only once a real screen exists behind them.
 */

import Constants from 'expo-constants';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radii, Spacing } from '@/constants/theme';

function LinkRow({ label, detail, href }: { label: string; detail: string; href: '/settings' }) {
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

export default function ProfileScreen() {
  // Runtime-truthful version: the installed binary's version when running
  // native, the configured app version in Expo Go / web / dev.
  const version = Constants.nativeApplicationVersion ?? Constants.expoConfig?.version ?? null;
  const build = Constants.nativeBuildVersion ?? null;

  return (
    <ThemedView style={styles.container}>
      <View style={styles.content}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          SETTINGS
        </ThemedText>
        <LinkRow
          label="Personalization"
          detail="Your state, allergens to watch, and stores — powers “Affects me.”"
          href="/settings"
        />
        <LinkRow label="Notifications" detail="Recall alerts for this device." href="/settings" />

        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          ABOUT
        </ThemedText>
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
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    padding: Spacing.three,
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
