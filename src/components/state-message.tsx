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
import { AccessibilityInfo, ScrollView, StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { spacing } from '@/constants/design-tokens';

export type StateTone = 'loading' | 'error' | 'empty';

export function StateMessage({
  title,
  body,
  tone = 'empty',
  icon,
  scrollable = true,
}: {
  title: string;
  body: string;
  tone?: StateTone;
  /** A decorative glyph above the title; the words say the same thing. */
  icon?: IconName;
  /**
   * Whether the message may scroll when it does not fit (P3C1.5).
   *
   * True for a whole-screen state, which is nearly every use: at the
   * accessibility text sizes a two-sentence explanation is taller than the
   * phone, and a centred flex container clips such content at BOTH ends —
   * losing the first line of the title as well as the last of the body.
   * Growing-then-scrolling keeps it centred while it fits and reachable when
   * it does not.
   *
   * False for the two settings panels, which already render inside their
   * screen's own ScrollView; a second one nested in the same direction is
   * what this flag exists to avoid.
   */
  scrollable?: boolean;
}) {
  useEffect(() => {
    if (tone === 'loading') AccessibilityInfo.announceForAccessibility(title);
  }, [tone, title]);

  const content = (
    <View
      accessible
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
      accessibilityLiveRegion={tone === 'loading' ? 'polite' : 'none'}
      style={styles.group}>
      {icon ? <Icon name={icon} size={24} color="icon/secondary" /> : null}
      <Text variant="heading-3" style={styles.text}>
        {title}
      </Text>
      <Text variant="body-small" color="text/secondary" style={styles.text}>
        {body}
      </Text>
    </View>
  );

  if (!scrollable) return <View style={[styles.fill, styles.centered]}>{content}</View>;

  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.centered}
      showsVerticalScrollIndicator={false}>
      {content}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  /** The scroll view, or the plain container, taking the screen. */
  fill: {
    flex: 1,
    width: '100%',
  },
  /**
   * `flexGrow` rather than `flex`, because this is also a
   * `contentContainerStyle`: it centres the message while it fits and lets
   * the content grow past the screen (and scroll) when it does not, instead
   * of centring an overflow and clipping both ends.
   */
  centered: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[24],
  },
  /** Icon, title and explanation as one block, so the gap is theirs. */
  group: {
    width: '100%',
    alignItems: 'center',
    gap: spacing[8],
  },
  text: {
    textAlign: 'center',
    // Stretch to the container's content width so the words WRAP (P3C1.5).
    // `centered` sets `alignItems: 'center'`, which means a child is laid out
    // at its own intrinsic width rather than the parent's — and an unwrapped
    // sentence's intrinsic width is as wide as the sentence. At ordinary text
    // sizes that still fits the screen, so this was invisible; at the
    // accessibility sizes it is wider than the phone, and the state title and
    // its explanation were clipped off both edges instead of wrapping.
    // Verified on the simulator at accessibility-extra-extra-extra-large.
    alignSelf: 'stretch',
  },
});
