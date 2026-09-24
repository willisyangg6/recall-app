/**
 * The one illustrative recall card (P2B7X.1), shown on Welcome and on the
 * Personalized Preview.
 *
 * It is the Feed's own `RecallCardSurface` — the same status row, badges,
 * identity column and location footer — over the static example model in
 * lib/onboarding-sample.ts, with a bundled illustration in the media slot
 * and NO trailing control. It is not pressable, opens nothing, cannot be
 * saved, and needs no network: everything it shows ships with the app. The
 * caller labels it (`Example` / `Example match`) above, and the model's own
 * activity and brand slots say `Example` and `Example, not a live recall`,
 * so the card is distinguishable from live data three ways.
 *
 * ## Why the media is not the shared `MediaTile`
 *
 * The shared tile's contract is "the official image URL, or nothing"
 * (P2B7I) — it has exactly one image source and no bundled branch, and the
 * imagery tests pin that so no live card can ever grow a stand-in picture.
 * The example card is the one surface that shows a picture that is NOT an
 * official image, so it draws its own tile of the same geometry here (the
 * placeholder-coloured `radius/8` square at `card-media-size`, `contain`),
 * and the shared tile stays exactly as strict as it is.
 */

import type { ReactNode } from 'react';
import {
  Animated,
  Image,
  StyleSheet,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { RecallCardSurface } from '@/components/recall-card';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { layout, spacing } from '@/constants/design-tokens';
import { SAMPLE_RECALL_MODEL } from '@/lib/onboarding-sample';

/** The bundled illustration: a drawing of gummy candy, not a photograph. */
const SAMPLE_ILLUSTRATION =
  require('@/assets/onboarding/sample-gummy-products.png') as ImageSourcePropType;

/**
 * `peek` (Welcome's mascot) is drawn over the card, anchored to the card's
 * own top edge: a sibling of the card rather than a child, so it is never
 * part of the card's accessibility element and never inherits the card's
 * entrance. `motion` is the label's and the card's entrance. The Preview
 * passes neither.
 */
export function SampleRecallCard({
  label,
  peek = null,
  motion,
}: {
  label: string;
  peek?: ReactNode;
  motion?: Animated.WithAnimatedValue<StyleProp<ViewStyle>>;
}) {
  return (
    <View style={styles.block}>
      <Animated.View style={motion}>
        <Text variant="caption" color="text/secondary" accessibilityRole="header">
          {label}
        </Text>
      </Animated.View>
      <View>
        <Animated.View
          style={motion}
          accessible
          accessibilityLabel={`${label}. ${SAMPLE_ACCESSIBILITY}`}>
          <RecallCardSurface
            model={SAMPLE_RECALL_MODEL}
            media={<SampleMediaTile alt={SAMPLE_RECALL_MODEL.productName} />}
            trailing={null}
          />
        </Animated.View>
        {peek}
      </View>
    </View>
  );
}

/** The example's square: the shared tile's geometry, a bundled drawing inside. */
function SampleMediaTile({ alt }: { alt: string }) {
  return (
    <Surface
      background="background/media-placeholder"
      radius={8}
      style={styles.tile}
      accessible
      accessibilityRole="image"
      accessibilityLabel={alt}>
      <Image
        source={SAMPLE_ILLUSTRATION}
        style={styles.image}
        resizeMode="contain"
        accessible={false}
      />
    </Surface>
  );
}

/** Spoken once for the whole card: what it shows, and that it is an example. */
const SAMPLE_ACCESSIBILITY =
  `${SAMPLE_RECALL_MODEL.risk.accessibilityLabel}. Affects you. ` +
  `${SAMPLE_RECALL_MODEL.productName}. ${SAMPLE_RECALL_MODEL.reasonLine}. ` +
  `${SAMPLE_RECALL_MODEL.locationSummary}. ${SAMPLE_RECALL_MODEL.brand.text}.`;

const styles = StyleSheet.create({
  block: {
    gap: spacing[8],
  },
  tile: {
    width: layout.cardMediaSize,
    height: layout.cardMediaSize,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
