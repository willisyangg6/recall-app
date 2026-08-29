/**
 * The one reusable trust-document screen (C7): renders any document from the
 * content registry (src/content) in the temporary visual language. All
 * business claims live in the structured content — this file is layout only,
 * so a claim can never exist in JSX alone.
 *
 * Text is selectable (people quote safety information), external links open
 * the official source in the system browser, and an unknown slug renders an
 * honest not-found state rather than crashing — the same convention as the
 * recall detail screen.
 */

import { Stack, useLocalSearchParams } from 'expo-router';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { InstallationResetSection } from '@/components/installation-reset-section';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { documentBySlug } from '@/content';
import type { DocumentBlock } from '@/content/document-model';

function Block({ block }: { block: DocumentBlock }) {
  if (block.kind === 'paragraph') {
    return <ThemedText selectable>{block.text}</ThemedText>;
  }
  if (block.kind === 'bullets') {
    return (
      <View style={styles.bullets}>
        {block.items.map((item) => (
          <View key={item} style={styles.bulletRow}>
            <ThemedText themeColor="textSecondary" style={styles.bulletMark}>
              ·
            </ThemedText>
            <ThemedText selectable style={styles.bulletText}>
              {item}
            </ThemedText>
          </View>
        ))}
      </View>
    );
  }
  return (
    <ThemedText
      themeColor="link"
      accessibilityRole="link"
      onPress={() => void Linking.openURL(block.url)}>
      {block.label}
    </ThemedText>
  );
}

export default function DocumentScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const doc = documentBySlug(slug);
  const insets = useSafeAreaInsets();

  if (!doc) {
    return (
      <ThemedView style={styles.messageContainer}>
        <Stack.Screen options={{ title: 'Not found' }} />
        <ThemedText themeColor="textSecondary" style={styles.centeredText}>
          This page could not be found.
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: doc.title }} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: Spacing.four + insets.bottom }]}>
        <ThemedText type="title" accessibilityRole="header">
          {doc.title}
        </ThemedText>
        {doc.sections.map((section, index) => (
          <View key={section.title ?? `lead-${index}`} style={styles.section}>
            {section.title ? (
              <ThemedText type="small" themeColor="textSecondary" accessibilityRole="header">
                {section.title.toUpperCase()}
              </ThemedText>
            ) : null}
            {section.blocks.map((block, blockIndex) => (
              <Block key={blockIndex} block={block} />
            ))}
          </View>
        ))}
        {/* C7.1: the one destructive data control lives at the bottom of
            Privacy & Data Controls — and only there (frozen product
            decision; pinned by the trust-center tests). */}
        {doc.slug === 'privacy-data-controls' ? <InstallationResetSection /> : null}
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
  section: {
    gap: Spacing.one,
    marginTop: Spacing.two,
  },
  bullets: {
    gap: Spacing.one,
  },
  bulletRow: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  bulletMark: {
    lineHeight: 24,
  },
  bulletText: {
    flex: 1,
    flexShrink: 1,
  },
  messageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
  },
  centeredText: {
    textAlign: 'center',
  },
});
