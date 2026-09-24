/**
 * Screen 1, Welcome (P2B7X.1): the wordmark, the headline and body, three
 * benefit rows, the one illustrative example card, the trust note, and
 * `Get started`. Not a counted step, so the frame shows no progress and no
 * back control.
 *
 * Presentational: the route hands in `onGetStarted`; the Design Preview
 * hands in nothing that navigates. The wordmark is the product name in the
 * display type — no logo or brand mark is invented (DESIGN.md, "Branding
 * status"). The benefit rows carry a small brand-coloured mark drawn from a
 * view, never a shield, siren or check glyph.
 */

import { StyleSheet, View } from 'react-native';

import { OnboardingFrame } from '@/components/onboarding/onboarding-frame';
import { SampleRecallCard } from '@/components/onboarding/sample-recall-card';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { color, radius, spacing } from '@/constants/design-tokens';
import {
  WELCOME_BENEFITS,
  WELCOME_BODY,
  WELCOME_CTA,
  WELCOME_EXAMPLE_LABEL,
  WELCOME_HEADLINE,
  WELCOME_TRUST_NOTE,
  WORDMARK,
} from '@/lib/onboarding-copy';

export function WelcomeContent({ onGetStarted }: { onGetStarted: () => void }) {
  return (
    <OnboardingFrame
      headline={WELCOME_HEADLINE}
      body={WELCOME_BODY}
      lead={<Text variant="display">{WORDMARK}</Text>}
      footer={<Button label={WELCOME_CTA} onPress={onGetStarted} />}>
      <BenefitList items={WELCOME_BENEFITS} />
      <SampleRecallCard label={WELCOME_EXAMPLE_LABEL} />
      <Text variant="caption" color="text/secondary">
        {WELCOME_TRUST_NOTE}
      </Text>
    </OnboardingFrame>
  );
}

/** Three short rows, each a brand-coloured mark beside its sentence. */
export function BenefitList({ items }: { items: readonly string[] }) {
  return (
    <View style={styles.benefits} accessibilityRole="list">
      {items.map((item) => (
        <View key={item} style={styles.benefit}>
          <View style={styles.mark} />
          <Text variant="body" style={styles.benefitText}>
            {item}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  benefits: {
    gap: spacing[8],
  },
  benefit: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[12],
  },
  // A small brand mark, centred on the first line of body text.
  mark: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: color['icon/brand'],
    marginTop: 8,
  },
  benefitText: {
    flex: 1,
  },
});
