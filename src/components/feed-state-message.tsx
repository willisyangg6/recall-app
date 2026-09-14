/**
 * One presentation for the Feed's whole-screen states (P2B1): loading, a
 * recoverable load failure, and the empty results of a search, a filter, or
 * a personalization. A `heading-3` title over a `body-small` explanation,
 * centred in the content column — the shape the design contract gives every
 * empty and error state. The words are the caller's (lib/feed-copy.ts);
 * nothing here invents a state or a sentence.
 *
 * Loading is announced, not just shown: the container is a polite live
 * region and the title is announced once when it appears, so a screen-reader
 * user hears that the feed is loading rather than finding an empty screen.
 * A load failure is an alert. Nothing animates, so there is nothing for
 * Reduce Motion to disable.
 */

import { useEffect } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { spacing } from '@/constants/design-tokens';

export type FeedStateTone = 'loading' | 'error' | 'empty';

export function FeedStateMessage({
  title,
  body,
  tone = 'empty',
}: {
  title: string;
  body: string;
  tone?: FeedStateTone;
}) {
  useEffect(() => {
    if (tone === 'loading') AccessibilityInfo.announceForAccessibility(title);
  }, [tone, title]);

  return (
    <View
      accessible
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
      accessibilityLiveRegion={tone === 'loading' ? 'polite' : 'none'}
      style={styles.centered}>
      <Text variant="heading-3" style={styles.text}>
        {title}
      </Text>
      <Text variant="body-small" color="text/secondary" style={styles.text}>
        {body}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing[8],
    padding: spacing[24],
  },
  text: {
    textAlign: 'center',
  },
});
