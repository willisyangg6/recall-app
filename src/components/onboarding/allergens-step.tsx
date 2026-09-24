/**
 * Screen 3, Allergens (P2B7X.1), `2 of 4`: the nine allergen Check Rows —
 * each with its glyph from the one Lucide family — under a permanently
 * allocated count line and `Clear selection`, with `Continue` sticky.
 *
 * Optional: Continue is never disabled here. An empty selection is a
 * complete answer ("Leave this blank if none"), and the count line says
 * `No allergens selected` rather than nothing. `Clear selection` is in the
 * layout whether or not anything is checked; with nothing checked it is
 * disabled and its handler is a no-op, so pressing it changes nothing and
 * the rows never move (P2B7V).
 *
 * Presentational: the route saves every toggle progressively.
 */

import { StyleSheet, View } from 'react-native';

import { OnboardingFrame, SelectionCount } from '@/components/onboarding/onboarding-frame';
import { AllergenGlyph } from '@/components/settings/personalization-form';
import { Button } from '@/components/ui/button';
import { CheckRow } from '@/components/ui/check-row';
import { spacing } from '@/constants/design-tokens';
import { CONSUMER_ALLERGENS } from '@/domain/preferences';
import {
  ALLERGENS_BODY,
  ALLERGENS_HEADLINE,
  allergenCountLabel,
  BACK_HINT,
  BACK_LABEL,
  CLEAR_ALLERGENS_HINT,
  CLEAR_SELECTION_LABEL,
  CONTINUE_CTA,
} from '@/lib/onboarding-copy';
import { stepProgress } from '@/lib/onboarding-state';

export function AllergensStep({
  selected,
  onToggle,
  onClear,
  onContinue,
  onBack,
}: {
  selected: readonly string[];
  onToggle: (token: string) => void;
  /** Empties the selection. Called only while something is selected. */
  onClear: () => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  // A TRUE no-op with nothing selected, as well as a disabled control.
  const clear = () => {
    if (selected.length === 0) return;
    onClear();
  };

  // The controls slot is a fixed one-element column (P2B7V): no conditional
  // may appear here, so the rows beneath never move.
  const controls = (
    <Button
      variant="secondary"
      label={CLEAR_SELECTION_LABEL}
      accessibilityHint={CLEAR_ALLERGENS_HINT}
      disabled={selected.length === 0}
      onPress={clear}
    />
  );

  return (
    <OnboardingFrame
      headline={ALLERGENS_HEADLINE}
      body={ALLERGENS_BODY}
      progress={stepProgress('allergens')}
      back={{ label: BACK_LABEL, hint: BACK_HINT, onPress: onBack }}
      footer={<Button label={CONTINUE_CTA} onPress={onContinue} />}>
      <View style={styles.selector}>
        <SelectionCount text={allergenCountLabel(selected.length)} />
        <View style={styles.controls}>{controls}</View>
        <View style={styles.rows}>
          {CONSUMER_ALLERGENS.map((option) => (
            <CheckRow
              key={option.token}
              label={option.label}
              checked={selected.includes(option.token)}
              onPress={() => onToggle(option.token)}
              leading={
                <AllergenGlyph token={option.token} checked={selected.includes(option.token)} />
              }
            />
          ))}
        </View>
      </View>
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  selector: {
    gap: spacing[12],
  },
  controls: {
    gap: spacing[12],
  },
  rows: {
    gap: spacing[8],
  },
});
