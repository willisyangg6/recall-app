/**
 * A Profile section (P2B5): a caption heading over one white `radius/16`
 * surface with a subtle border, whose rows are parted by hairlines, and an
 * optional quiet caption beneath — the shape every grouped block on the
 * hub takes (Privacy & Data, About & Safety, Legal, App), so the groups can
 * never drift apart from one another.
 *
 * The heading is a header to assistive technology, so a screen-reader user
 * can move between groups; the rows inside are whatever the caller renders
 * (navigation rows, a value row) and keep their own semantics.
 */

import { Children, isValidElement, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { color, spacing } from '@/constants/design-tokens';

export function ProfileSection({
  title,
  footnote,
  children,
}: {
  title: string;
  /** A quiet caption associated with the group, beneath its surface. */
  footnote?: string;
  children: ReactNode;
}) {
  const rows = Children.toArray(children);
  return (
    <View style={styles.section}>
      <Text
        variant="caption"
        color="text/secondary"
        accessibilityRole="header"
        style={styles.heading}>
        {title.toUpperCase()}
      </Text>
      <Surface radius={16} border="border/subtle" style={styles.surface}>
        {rows.map((row, index) => (
          <View
            key={isValidElement(row) && row.key !== null ? row.key : index}
            style={index > 0 && styles.hairline}>
            {row}
          </View>
        ))}
      </Surface>
      {footnote ? (
        <Text variant="caption" color="text/secondary" style={styles.footnote}>
          {footnote}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing[8],
  },
  // The heading and the footnote align with the rows' text, not the surface's edge.
  heading: {
    paddingHorizontal: spacing[16],
  },
  footnote: {
    paddingHorizontal: spacing[16],
  },
  // Rows clip to the surface's corners, so a pressed row cannot square them.
  surface: {
    overflow: 'hidden',
  },
  hairline: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color['border/subtle'],
  },
});
