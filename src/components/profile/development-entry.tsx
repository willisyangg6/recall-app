/**
 * The Profile's development entry (P2B5): the row that opens the dev-only
 * Design Preview harness (docs/recall-design-preview.md), kept visibly and
 * audibly apart from the consumer settings — outlined on the page colour
 * with the strong border rather than filled white, under a heading that
 * says it exists in development builds only, with a hint that says the
 * same.
 *
 * It renders nothing outside a development build. The live Profile also
 * wraps it in the bare `__DEV__` identifier so Metro eliminates the branch
 * from a release bundle outright; this guard is the second lock on the same
 * door, so the component can never render in production even if a future
 * caller forgets the first.
 */

import { type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { NavigationRow } from '@/components/profile/navigation-row';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { spacing } from '@/constants/design-tokens';
import { DEVELOPMENT_HEADING, DEVELOPMENT_HINT } from '@/lib/profile-hub';

export function DevelopmentEntry({
  label,
  summary,
  href,
}: {
  label: string;
  summary: string;
  href: Href;
}) {
  if (!__DEV__) return null;
  return (
    <View style={styles.section}>
      <Text
        variant="caption"
        color="text/secondary"
        accessibilityRole="header"
        style={styles.heading}>
        {DEVELOPMENT_HEADING.toUpperCase()}
      </Text>
      <Surface background="background/page" radius={8} border="border/strong">
        <NavigationRow label={label} summary={summary} href={href} hint={DEVELOPMENT_HINT} />
      </Surface>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing[8],
  },
  heading: {
    paddingHorizontal: spacing[16],
  },
});
