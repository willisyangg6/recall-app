/**
 * Screen 5, Personalized Preview (P2B7X.1), `4 of 4`: the summary card of
 * what was chosen, the one example match, the independence note, and the
 * two actions — `View plans` (primary, sticky) and `Edit preferences`.
 *
 * The summary keeps all three rows whatever was chosen: an optional group
 * with nothing selected reads `None` rather than disappearing, so the card
 * is an honest account of the profile and never an implication that more
 * was chosen. States show their full names in canonical order, allergens
 * their labels in catalog order, stores their catalog names in chosen
 * order — the same rules the Profile card reads by (lib/profile-hub.ts),
 * so the two summaries cannot disagree.
 *
 * The example card is the shared surface over the static example model,
 * labelled `Example match`: it illustrates what a match looks like and is
 * explicitly not a live recall.
 */

import { StyleSheet, View } from 'react-native';

import { OnboardingFrame } from '@/components/onboarding/onboarding-frame';
import { SampleRecallCard } from '@/components/onboarding/sample-recall-card';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { spacing } from '@/constants/design-tokens';
import type { UserRecallPreferences } from '@/domain/preferences';
import {
  BACK_HINT,
  BACK_LABEL,
  INDEPENDENCE_NOTE,
  PREVIEW_BODY,
  PREVIEW_CTA,
  PREVIEW_EDIT,
  PREVIEW_EDIT_HINT,
  PREVIEW_EXAMPLE_LABEL,
  PREVIEW_HEADLINE,
  PREVIEW_NONE,
  PREVIEW_SUMMARY_LABELS,
} from '@/lib/onboarding-copy';
import { stepProgress } from '@/lib/onboarding-state';
import { listNames } from '@/lib/personalization-screen';
import { summarizePreferences } from '@/lib/profile-hub';

export function PreviewStep({
  prefs,
  onViewPlans,
  onEdit,
  onBack,
}: {
  prefs: UserRecallPreferences;
  onViewPlans: () => void;
  onEdit: () => void;
  onBack: () => void;
}) {
  const summary = summarizePreferences(prefs);
  const rows: { key: keyof typeof PREVIEW_SUMMARY_LABELS; names: readonly string[] }[] = [
    { key: 'states', names: summary.states },
    { key: 'allergens', names: summary.allergens },
    { key: 'retailers', names: summary.retailers },
  ];

  return (
    <OnboardingFrame
      headline={PREVIEW_HEADLINE}
      body={PREVIEW_BODY}
      progress={stepProgress('preview')}
      back={{ label: BACK_LABEL, hint: BACK_HINT, onPress: onBack }}
      footer={
        <>
          <Button label={PREVIEW_CTA} onPress={onViewPlans} />
          <Button
            variant="secondary"
            label={PREVIEW_EDIT}
            accessibilityHint={PREVIEW_EDIT_HINT}
            onPress={onEdit}
          />
        </>
      }>
      <Surface radius={16} border="border/subtle" elevation="card" style={styles.summary}>
        {rows.map((row) => (
          <View
            key={row.key}
            style={styles.row}
            accessible
            accessibilityLabel={`${PREVIEW_SUMMARY_LABELS[row.key]}: ${
              row.names.length === 0 ? PREVIEW_NONE : listNames(row.names)
            }.`}>
            <Text variant="body-small" color="text/secondary" style={styles.rowLabel}>
              {PREVIEW_SUMMARY_LABELS[row.key]}
            </Text>
            {/* Nothing chosen reads `None` in the quiet colour: a real answer, kept. */}
            <Text
              variant="body-small"
              color={row.names.length === 0 ? 'text/secondary' : 'text/primary'}
              style={styles.rowValue}>
              {row.names.length === 0 ? PREVIEW_NONE : row.names.join(', ')}
            </Text>
          </View>
        ))}
      </Surface>
      <SampleRecallCard label={PREVIEW_EXAMPLE_LABEL} />
      <Text variant="caption" color="text/secondary">
        {INDEPENDENCE_NOTE}
      </Text>
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  summary: {
    padding: spacing[16],
    gap: spacing[12],
  },
  // Label at the leading edge, value taking the rest and wrapping beneath
  // when a long list or a large type size asks; nothing is truncated.
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[12],
  },
  rowLabel: {
    minWidth: 72,
  },
  rowValue: {
    flex: 1,
    minWidth: 120,
  },
});
