/**
 * A settings section (P2B6A): a content section heading, an optional line
 * of helper copy, and whatever controls the section holds — the shape the
 * Personalization screen's State, Allergens and Stores groups take, so the
 * three cannot drift apart and a screen-reader user can move between them
 * by heading.
 *
 * The heading is the CONTENT SECTION HEADING pattern (DESIGN.md, "Section
 * headings"): title case in `heading-3`, Public Sans semibold, primary navy.
 * It is deliberately not the small uppercase caption Profile puts over a
 * navigation group: a group of rows that lead somewhere is labelled; a
 * section the shopper reads and acts in is headed.
 *
 * It is the Profile section's cousin, not the same component: a Profile
 * group is one bordered surface of rows, while a settings group is a set of
 * selection rows and triggers (each its own surface), so it draws no surface
 * of its own. The helper sits between the heading and the controls, where it
 * is read before a choice is made.
 */

import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { spacing } from '@/constants/design-tokens';

export function SettingsSection({
  title,
  description,
  children,
}: {
  /** Title case, as written. */
  title: string;
  /** One or two sentences that make the choice clearer; omitted when the heading is enough. */
  description?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <Text variant="heading-3" accessibilityRole="header">
          {title}
        </Text>
        {description ? (
          <Text variant="body-small" color="text/secondary">
            {description}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing[12],
  },
  heading: {
    gap: spacing[4],
  },
});
