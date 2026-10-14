/**
 * A Profile navigation row (P2B5): an optional leading glyph, a label, an
 * optional supporting line and the chevron, and the whole row is the target.
 * The leading glyph (final polish, 2026-10-13) sits in the same 20pt column
 * as the Personalization card's flag, so every Profile row starts on one
 * line: icon, label, chevron. It pushes a real route
 * through the router's own Link — nothing here decides where a row goes.
 *
 * The row is one link to assistive technology: it speaks its label and the
 * caller's hint ("Opens the document.", "Opens recall alert settings for
 * this device."), and the chevron is decorative — the icon primitive hides
 * every glyph, so no row can announce a bare "image". At least the minimum
 * target tall, and it grows with the reader's type size rather than
 * clipping.
 *
 * Padding lives on the inner view: a style handed to the Pressable is not
 * carried through `asChild`, as the recall card already knows.
 */

import { Link, type Href } from 'expo-router';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { hitTarget, spacing } from '@/constants/design-tokens';
import { showsRowGlyph } from '@/lib/profile-hub';

export function NavigationRow({
  label,
  summary,
  href,
  hint,
  icon,
}: {
  label: string;
  /** The supporting line beneath the label, when the destination needs one. */
  summary?: string;
  href: Href;
  /** What the row opens, spoken after its label. */
  hint: string;
  /** The decorative leading glyph, from the approved icon set. */
  icon?: IconName;
}) {
  const { fontScale } = useWindowDimensions();
  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={label}
        accessibilityHint={hint}
        style={({ pressed }) => pressed && styles.pressed}>
        <View style={styles.row}>
          {icon && showsRowGlyph(fontScale) ? (
            <Icon name={icon} size={20} color="icon/primary" />
          ) : null}
          <View style={styles.text}>
            <Text variant="body">{label}</Text>
            {summary ? (
              <Text variant="body-small" color="text/secondary">
                {summary}
              </Text>
            ) : null}
          </View>
          <Icon name="chevron-right" size={20} color="icon/secondary" />
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: hitTarget.minimum,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[12],
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[12],
  },
  text: {
    flex: 1,
    gap: spacing[4],
  },
  pressed: {
    opacity: 0.6,
  },
});
