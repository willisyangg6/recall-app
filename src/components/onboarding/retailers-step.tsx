/**
 * Screen 4, Retailers (P2B7X.1), `3 of 4`: the shared store selector — the
 * search field and the 77 Check Rows in catalog order, each with its mark
 * or the `home` fallback — under a permanently allocated count line and
 * `Clear selection`, with `Continue` sticky.
 *
 * Optional: Continue is never disabled. `Clear selection` is always in the
 * layout, disabled and inert with nothing selected, so the rows never move
 * (P2B7V). Every check autosaves through the route, as the store sheet
 * under Profile does; the search narrows the same stable list and a checked
 * row stays exactly where the catalog puts it.
 */

import { StyleSheet, View } from 'react-native';

import { OnboardingFrame, SelectionCount } from '@/components/onboarding/onboarding-frame';
import { StoreSelectorContent } from '@/components/settings/personalization-form';
import { Button } from '@/components/ui/button';
import { spacing } from '@/constants/design-tokens';
import {
  BACK_HINT,
  BACK_LABEL,
  CLEAR_SELECTION_LABEL,
  CLEAR_STORES_HINT,
  CONTINUE_CTA,
  RETAILERS_BODY,
  RETAILERS_HEADLINE,
} from '@/lib/onboarding-copy';
import { stepProgress } from '@/lib/onboarding-state';
import { storeCountLabel } from '@/lib/personalization-screen';

export function RetailersStep({
  selected,
  onToggle,
  onClear,
  onContinue,
  onBack,
  initialQuery = '',
}: {
  selected: readonly string[];
  onToggle: (id: string) => void;
  /** Empties the selection. Called only while something is selected. */
  onClear: () => void;
  onContinue: () => void;
  onBack: () => void;
  /** A search already typed — for the gallery; the step starts blank. */
  initialQuery?: string;
}) {
  const clear = () => {
    if (selected.length === 0) return;
    onClear();
  };

  return (
    <OnboardingFrame
      headline={RETAILERS_HEADLINE}
      body={RETAILERS_BODY}
      progress={stepProgress('retailers')}
      back={{ label: BACK_LABEL, hint: BACK_HINT, onPress: onBack }}
      keyboard
      footer={<Button label={CONTINUE_CTA} onPress={onContinue} />}>
      <StoreSelectorContent
        selected={selected}
        onToggle={onToggle}
        initialQuery={initialQuery}
        frame={(controls, list) => (
          <View style={styles.selector}>
            <SelectionCount text={storeCountLabel(selected.length)} />
            {/* A fixed two-element column (P2B7V): the search, then Clear. */}
            <View style={styles.controls}>
              {controls}
              <Button
                variant="secondary"
                label={CLEAR_SELECTION_LABEL}
                accessibilityHint={CLEAR_STORES_HINT}
                disabled={selected.length === 0}
                onPress={clear}
              />
            </View>
            <View style={styles.rows}>{list}</View>
          </View>
        )}
      />
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
