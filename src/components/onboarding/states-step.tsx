/**
 * Screen 2, States (P2B7X.1), `1 of 4`: the shared state selector —
 * search, the permanently allocated `Clear selection`, the count line and
 * the 52 Check Rows — in the onboarding frame, with `Continue` sticky in the
 * footer.
 *
 * ## The rules this step carries
 *
 * - At least one state is required. Continue is disabled with none, and
 *   the reason is SAID beneath it (`Choose at least one state to
 *   continue.`), not only greyed; the note is permanently allocated so the
 *   footer never changes height as the count crosses zero.
 * - The count line, the search and `Clear selection` are fixed elements
 *   above the list, so selecting or clearing never moves a row (P2B7V).
 * - Every change is reported to the route through `onChange`, which saves
 *   progressively; there is no Done and nothing to lose on a kill.
 *
 * Presentational: the route owns saving and navigation.
 */

import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { OnboardingFrame, SelectionCount } from '@/components/onboarding/onboarding-frame';
import { StateSelectorContent } from '@/components/settings/personalization-form';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { spacing } from '@/constants/design-tokens';
import {
  BACK_HINT,
  BACK_LABEL,
  CONTINUE_CTA,
  STATES_BODY,
  STATES_HEADLINE,
  STATES_REQUIRED_NOTE,
} from '@/lib/onboarding-copy';
import { canContinueFromStates, stepProgress } from '@/lib/onboarding-state';
import { stateCountLabel } from '@/lib/personalization-screen';

export function StatesStep({
  selected,
  onChange,
  onContinue,
  onBack,
  initialQuery = '',
}: {
  /** The saved selection this step opens with. */
  selected: readonly string[];
  /** Every change, saved progressively by the route. */
  onChange: (codes: readonly string[]) => void;
  onContinue: () => void;
  onBack: () => void;
  /** A search already typed — for the gallery; the step starts blank. */
  initialQuery?: string;
}) {
  // The count and the Continue rule follow the LIVE draft, reported by the
  // shared selector on every change; the saved value seeds it.
  const [draft, setDraft] = useState<readonly string[]>(selected);
  const onDraftChange = useCallback(
    (codes: readonly string[]) => {
      setDraft(codes);
      onChange(codes);
    },
    [onChange],
  );
  const canContinue = canContinueFromStates(draft);

  return (
    <OnboardingFrame
      headline={STATES_HEADLINE}
      body={STATES_BODY}
      progress={stepProgress('states')}
      back={{ label: BACK_LABEL, hint: BACK_HINT, onPress: onBack }}
      keyboard
      footer={
        <>
          <Button
            label={CONTINUE_CTA}
            disabled={!canContinue}
            onPress={onContinue}
            accessibilityHint={canContinue ? undefined : STATES_REQUIRED_NOTE}
          />
          {/* Permanently allocated: the words change, the footer's height does not. */}
          <Text
            variant="caption"
            color="text/secondary"
            style={styles.note}
            accessibilityLiveRegion="polite">
            {canContinue ? ' ' : STATES_REQUIRED_NOTE}
          </Text>
        </>
      }>
      <StateSelectorContent
        selected={selected}
        onCommit={() => {}}
        onDraftChange={onDraftChange}
        initialQuery={initialQuery}
        frame={({ controls, list }) => (
          <View style={styles.selector}>
            <SelectionCount text={stateCountLabel(draft.length)} />
            <View style={styles.controls}>{controls}</View>
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
  note: {
    textAlign: 'center',
  },
});
