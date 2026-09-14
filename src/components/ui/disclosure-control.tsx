/**
 * The one in-place disclosure control (P2B0, extracted from Recall Detail):
 * "See all (N)" / "Show less" for the jurisdiction list, the Affected
 * Products rows, and each multi-value cell.
 *
 * It is a real button with a real expanded state, so VoiceOver announces
 * "See all 22 lot codes, button, collapsed" rather than a bare link, and the
 * state is never carried by colour alone: the visible word itself flips. The
 * words come from the shared presentation contract (`disclosureControl` in
 * lib/recall-presentation) — this component invents none.
 *
 * Nothing animates: the list simply grows, which is also the reduced-motion
 * behaviour, so there is no motion to disable.
 *
 * ## Touch target
 *
 * The visible footprint is one caption line, which is far under the 44pt
 * minimum. `hitSlop` grows the target to the minimum on every side without
 * moving anything on screen, so a dense table row keeps its height while the
 * control stays comfortably tappable.
 */

import { Pressable } from 'react-native';

import { Text } from '@/components/ui/text';
import { hitSlopToMinimum, typography } from '@/constants/design-tokens';
import type { DisclosureControl as DisclosureControlModel } from '@/lib/recall-presentation';

const HIT_SLOP = hitSlopToMinimum(typography.caption.lineHeight);

export function DisclosureControl({
  control,
  expanded,
  onPress,
}: {
  control: DisclosureControlModel;
  expanded: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        expanded ? control.collapseAccessibilityLabel : control.expandAccessibilityLabel
      }
      accessibilityState={{ expanded }}
      hitSlop={HIT_SLOP}
      onPress={onPress}>
      {({ pressed }) => (
        <Text variant="caption" color="action/secondary" style={pressed && { opacity: 0.6 }}>
          {expanded ? control.collapseLabel : control.expandLabel}
        </Text>
      )}
    </Pressable>
  );
}
