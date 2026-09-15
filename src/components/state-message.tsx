/**
 * One presentation for a screen's whole-screen states (P2B1 as the Feed's
 * state message; shared with Recall Detail from P2B2 and with Saved from
 * P2B4): loading, a recoverable load failure, a recall that could not be
 * found, and the empty results of a search, a filter, a personalization, or
 * a list nothing has been added to yet. A `heading-3` title over a
 * `body-small` explanation, centred in the content column — the shape the
 * design contract gives every empty and error state. The words are the
 * caller's (lib/feed-copy.ts, lib/detail-copy.ts, lib/saved-recalls.ts);
 * nothing here invents a state or a sentence.
 *
 * An optional glyph from the approved set may sit above the title, for an
 * empty state whose screen has an established symbol — Saved's bookmark,
 * the same glyph its tab and its save control use. It is decorative: the
 * words carry the state, so a state is never signalled by the icon alone.
 *
 * Loading is announced, not just shown: the container is a polite live
 * region and the title is announced once when it appears, so a screen-reader
 * user hears that the screen is loading rather than finding an empty one.
 * A load failure is an alert. Nothing animates, so there is nothing for
 * Reduce Motion to disable.
 */

import { useEffect } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { spacing } from '@/constants/design-tokens';

export type StateTone = 'loading' | 'error' | 'empty';

export function StateMessage({
  title,
  body,
  tone = 'empty',
  icon,
}: {
  title: string;
  body: string;
  tone?: StateTone;
  /** A decorative glyph above the title; the words say the same thing. */
  icon?: IconName;
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
      {icon ? <Icon name={icon} size={24} color="icon/secondary" /> : null}
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
