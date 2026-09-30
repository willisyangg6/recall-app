/**
 * The Ready step (P2B7X.1; carousel composition 2026-09-28), where the
 * shopper first sees what their watch found. Top to bottom, matching the
 * approved target (assets/brand/reference/lotly-onboarding-ready-carousel-
 * target.png, a composition reference that is never bundled): Back; the
 * heading and body; the soft-blue summary card of the approved Option 2
 * composition, the trust-peek mascot hanging over its edge, and a quiet
 * `Edit preferences` inside the card; the `See what affects you today`
 * heading over the lime count pill; the horizontal recall deck with its
 * dots (`ReadyCarousel`); the locked strip when more real matches exist, or
 * the truthful monitoring line when they do not; and the one pinned action,
 * `See my plan`, which opens the dedicated paywall. No progress bar, no
 * purchase UI of any kind: the plans, benefits, terms and notices live on
 * the paywall (2026-09-28 split).
 *
 * ## The preview
 *
 * `preview` is lib/ready-preview.ts's answer over the REAL feed and the
 * REAL matching layer: up to three current matches as the Feed's own card
 * models, the true total, or the honest checking / none / unavailable
 * state. This screen invents nothing: with no matches there is no deck, no
 * dots, no locked strip — one quiet card says exactly what is known, and
 * the body copy drops the claim that something was found.
 *
 * ## The summary card
 *
 * One `background/subtle` card, headed `Your preferences are set`, with three
 * rows whatever was chosen: an optional group with nothing selected reads
 * `None` rather than disappearing, so the card is an honest account of the
 * profile and never an implication that more was chosen. Each row is the
 * category's artwork in a white well at the leading edge, the category label
 * over its values in the middle, and a completed check in a pale-blue circle
 * at the trailing edge. States show their full names in canonical order,
 * allergens their labels in catalog order, stores their catalog names in
 * chosen order — the same rules the Profile card reads by
 * (lib/profile-hub.ts), so the two summaries cannot disagree. The labels are
 * Profile's too: `States`, `Allergens`, `Stores`.
 *
 * On the soft blue both lines are `text/primary`: `text/secondary` there
 * falls below AA for small text (3.2:1), so the label is set apart by size
 * and weight instead: `caption` (Public Sans medium, 12pt) over the values'
 * `body` (Public Sans regular, 16pt).
 *
 * Each row is ONE accessibility element, `States: California, completed`;
 * the artwork and the check inside it are decoration and never heard. What
 * the Allergens well draws, and why its pictograms are never tinted, is
 * lib/ready-presentation.ts.
 *
 * ## The mascot
 *
 * The trust-peek artwork, drawn whole with `contain` as the card's sibling,
 * after it, so it paints over the card's edge without ever being part of the
 * card or a row: hidden from VoiceOver and `pointerEvents="none"`. Its seat,
 * size and the room it is given are lib/ready-presentation.ts. Its one
 * entrance is the other onboarding mascots' (States, Retailers): a short fade
 * with a small settle after the push, played once; under Reduce Motion, or
 * before the setting is known, it is drawn in place at once.
 *
 * ## Edit preferences
 *
 * A quiet text action INSIDE the summary card, right-aligned on its last
 * row (the card header's trailing edge belongs to the shield), never a
 * second large button: it pushes the States step with every choice kept,
 * and nothing is lost by coming back. Its 44pt target comes from hitSlop;
 * the chevron carries the affordance, and its navy is `action/primary`,
 * because `action/secondary` on the soft blue is 4.1:1 — below AA for its
 * 13pt label.
 */

import { useEffect, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type ImageSourcePropType,
} from 'react-native';

import { OnboardingFrame } from '@/components/onboarding/onboarding-frame';
import { ReadyCarousel } from '@/components/onboarding/ready-carousel';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import {
  color,
  hitSlopToMinimum,
  layout,
  radius,
  relevancePalette,
  spacing,
  typography,
} from '@/constants/design-tokens';
import type { UserRecallPreferences } from '@/domain/preferences';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { allergenPictogram } from '@/lib/allergen-assets';
import {
  BACK_HINT,
  BACK_LABEL,
  matchCountLabel,
  PREVIEW_BODY,
  PREVIEW_BODY_EMPTY,
  PREVIEW_CHECKING_TITLE,
  PREVIEW_CTA,
  PREVIEW_CTA_HINT,
  PREVIEW_EDIT,
  PREVIEW_EDIT_HINT,
  PREVIEW_EMPTY_TITLE,
  PREVIEW_HEADLINE,
  PREVIEW_LOCKED_HINT,
  PREVIEW_LOCKED_STRIP,
  PREVIEW_MATCH_HEADING,
  PREVIEW_MONITORING_NOTE,
  PREVIEW_NONE,
  PREVIEW_ROW_COMPLETED,
  PREVIEW_SUMMARY_LABELS,
  PREVIEW_SUMMARY_TITLE,
  PREVIEW_UNAVAILABLE_TITLE,
} from '@/lib/onboarding-copy';
import { motionAllowed, stepProgress } from '@/lib/onboarding-state';
import { summarizePreferences } from '@/lib/profile-hub';
import {
  allergenArtwork,
  CHECK_CIRCLE_SIZE,
  moreLabel,
  readyBodyAside,
  PICTOGRAM_PAIR,
  PICTOGRAM_PAIR_STEP,
  PICTOGRAM_SINGLE,
  readyMascotOffset,
  readyMascotReserve,
  readyMascotRight,
  readyMascotSize,
  ROW_WELL_SIZE,
  storeSummaryText,
  SUMMARY_PADDING,
  SUMMARY_ROW_GAP,
  summaryHeadingLayout,
  summaryRowLabel,
  summaryStacked,
  type AllergenArtwork,
} from '@/lib/ready-presentation';
import { hasLockedMatches, type ReadyPreviewState } from '@/lib/ready-preview';
import { MASCOT_ENTRANCE } from '@/lib/state-map';

/** The approved trust-peek mascot: a 1024×1024 transparent PNG. */
const MASCOT =
  require('@/assets/brand/production/lotly-mascot-ready-trust-peek-1024.png') as ImageSourcePropType;

/** The white surface over the soft blue at this strength reads as a pale blue. */
const CHECK_WASH_OPACITY = 0.55;

/** `Edit preferences` is one `body-small-bold` line; hitSlop makes it 44pt. */
const EDIT_HIT_SLOP = hitSlopToMinimum(typography['body-small-bold'].lineHeight);

/** The decorative-subtree props: never heard, never touched. */
const DECORATIVE = {
  accessible: false,
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
  pointerEvents: 'none',
} as const;

export function PreviewStep({
  prefs,
  preview,
  onSeePlan,
  onEdit,
  onBack,
}: {
  prefs: UserRecallPreferences;
  /** What the watch found (lib/ready-preview.ts): real matches or the truth. */
  preview: ReadyPreviewState;
  /** The one primary action, and the locked strip and sentinel: the paywall. */
  onSeePlan: () => void;
  onEdit: () => void;
  onBack: () => void;
}) {
  const { height, width, fontScale } = useWindowDimensions();
  const size = readyMascotSize(height, fontScale);
  const reserve = readyMascotReserve(size, fontScale);
  const stacked = summaryStacked(fontScale);
  const summary = summarizePreferences(prefs);
  const allergens = allergenArtwork(prefs.allergens);
  // The deck's width: the content width between the page margins.
  const usableWidth = Math.min(width, layout.maxContentWidth) - 2 * layout.pageMargin;
  const found = preview.kind === 'matches';
  // The approved "cliff": while the crest rises beside the paragraph, the
  // body alone gives up the mascot's width and wraps LEFT of it; the
  // headline keeps the full width above.
  const bodyInset = readyBodyAside(size, fontScale);
  const rows: {
    key: keyof typeof PREVIEW_SUMMARY_LABELS;
    names: readonly string[];
    /** What the row shows, when it is not every name (the compacted Stores row). */
    shown?: string;
    artwork: ReactNode;
    more?: number;
  }[] = [
    {
      key: 'states',
      names: summary.states,
      artwork: <Icon name="map-pin" size={24} color="icon/primary" />,
    },
    {
      key: 'allergens',
      names: summary.allergens,
      artwork: <AllergenArtworkMark artwork={allergens} />,
      more: allergens.kind === 'pictograms' ? allergens.more : 0,
    },
    {
      key: 'retailers',
      names: summary.retailers,
      shown: storeSummaryText(summary.retailers),
      artwork: <Icon name="shopping-cart" size={24} color="icon/primary" />,
    },
  ];

  return (
    <OnboardingFrame
      headline={PREVIEW_HEADLINE}
      // The claim that something was found stands only when something was.
      body={found ? PREVIEW_BODY : PREVIEW_BODY_EMPTY}
      progress={stepProgress('preview')}
      back={{ label: BACK_LABEL, hint: BACK_HINT, onPress: onBack }}
      bodyInset={bodyInset}
      footer={
        <Button label={PREVIEW_CTA} accessibilityHint={PREVIEW_CTA_HINT} onPress={onSeePlan} />
      }>
      {/* The room above the card: the drawing's height, less the crest's
          allowed rise beside the body paragraph (lib/ready-presentation). */}
      <View style={{ paddingTop: reserve }}>
        <Surface background="background/subtle" radius={16} style={styles.summary}>
          <View style={summaryHeadingLayout(size, fontScale)}>
            <Text variant="heading-3" accessibilityRole="header">
              {PREVIEW_SUMMARY_TITLE}
            </Text>
          </View>
          {rows.map((row) => (
            <SummaryRow
              key={row.key}
              label={PREVIEW_SUMMARY_LABELS[row.key]}
              names={row.names}
              shown={row.shown}
              artwork={row.artwork}
              more={row.more ?? 0}
              stacked={stacked}
            />
          ))}
          {/* Inside the card, on its own last row: editing belongs to the
              summary it edits, and the trailing edge mirrors the checks. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={PREVIEW_EDIT}
            accessibilityHint={PREVIEW_EDIT_HINT}
            hitSlop={EDIT_HIT_SLOP}
            onPress={onEdit}
            style={styles.edit}>
            {({ pressed }) => (
              <View style={[styles.editInner, pressed && styles.pressed]}>
                <Text variant="body-small-bold" color="action/primary">
                  {PREVIEW_EDIT}
                </Text>
                <Icon name="chevron-right" size={16} color="icon/primary" />
              </View>
            )}
          </Pressable>
        </Surface>
        <TrustPeek
          size={size}
          top={reserve - readyMascotOffset(size)}
          right={readyMascotRight(size)}
        />
      </View>
      {/* The preview: the heading, the lime count pill, then the deck — or
          the one honest card for checking, none and unavailable. */}
      <View style={styles.previewSection}>
        <Text variant="heading-2" accessibilityRole="header">
          {PREVIEW_MATCH_HEADING}
        </Text>
        {found ? (
          <>
            <View style={styles.pill}>
              {/* The deck can only SHOW image-bearing matches; when none of
                  the real matches carries an image the pill counts them
                  all, because they exist whether or not they can preview. */}
              <Text variant="body-small-bold">
                {matchCountLabel(preview.models.length > 0 ? preview.models.length : preview.total)}
              </Text>
            </View>
            <ReadyCarousel
              models={preview.models}
              locked={preview.locked}
              usableWidth={usableWidth}
              onLockedPress={onSeePlan}
            />
            {hasLockedMatches(preview) ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={PREVIEW_LOCKED_STRIP}
                accessibilityHint={PREVIEW_LOCKED_HINT}
                onPress={onSeePlan}
                style={({ pressed }) => [pressed && styles.pressed]}>
                <Surface background="background/subtle" radius={12} style={styles.lockedStrip}>
                  <View {...DECORATIVE}>
                    <Icon name="lock" size={20} color="icon/primary" />
                  </View>
                  <Text variant="body-small-bold" style={styles.lockedText}>
                    {PREVIEW_LOCKED_STRIP}
                  </Text>
                </Surface>
              </Pressable>
            ) : (
              // No more matches are known, so nothing is claimed locked.
              <Text variant="caption" color="text/secondary">
                {PREVIEW_MONITORING_NOTE}
              </Text>
            )}
          </>
        ) : (
          <Surface background="background/subtle" radius={16} style={styles.emptyCard}>
            <Text variant="body">
              {preview.kind === 'checking'
                ? PREVIEW_CHECKING_TITLE
                : preview.kind === 'unavailable'
                  ? PREVIEW_UNAVAILABLE_TITLE
                  : PREVIEW_EMPTY_TITLE}
            </Text>
            <Text variant="body-small" color="text/secondary">
              {PREVIEW_MONITORING_NOTE}
            </Text>
          </Surface>
        )}
      </View>
    </OnboardingFrame>
  );
}

/**
 * One summary row: one accessibility element carrying the whole selection.
 * At the accessibility sizes the artwork and check share a top line and the
 * text takes the full width beneath them.
 */
function SummaryRow({
  label,
  names,
  shown,
  artwork,
  more,
  stacked,
}: {
  label: string;
  /** Every name: what the row speaks. */
  names: readonly string[];
  /** What the row shows instead, when it is compacted; every name otherwise. */
  shown?: string;
  artwork: ReactNode;
  /** The allergens beyond the two pictograms, drawn as `+N`; 0 for none. */
  more: number;
  stacked: boolean;
}) {
  const leading = (
    <View {...DECORATIVE} style={stacked ? styles.leadingStacked : null}>
      <View style={styles.well}>{artwork}</View>
      {more > 0 ? (
        <View style={stacked ? styles.moreInline : styles.more}>
          <Text variant="micro-caption" color="text/inverse">
            {moreLabel(more)}
          </Text>
        </View>
      ) : null}
    </View>
  );
  const check = (
    <View {...DECORATIVE} style={styles.checkSlot}>
      <View style={styles.checkCircle}>
        <View style={styles.checkWash} />
        <Icon name="check" size={20} color="icon/primary" />
      </View>
    </View>
  );
  // Values wrap beneath one another; nothing is truncated.
  const text = (
    <View style={stacked ? null : styles.rowText}>
      <Text variant="caption">{label}</Text>
      <Text variant="body">{names.length === 0 ? PREVIEW_NONE : (shown ?? names.join(', '))}</Text>
    </View>
  );
  return (
    <View
      style={stacked ? styles.rowStacked : styles.row}
      accessible
      accessibilityLabel={summaryRowLabel(label, names, PREVIEW_NONE, PREVIEW_ROW_COMPLETED)}>
      {stacked ? (
        <>
          <View style={styles.marksStacked}>
            {leading}
            {check}
          </View>
          {text}
        </>
      ) : (
        <>
          {leading}
          {text}
          {check}
        </>
      )}
    </View>
  );
}

/**
 * The Allergens well: the approved pictograms untinted, never a pictogram
 * for a choice that was not made.
 */
function AllergenArtworkMark({ artwork }: { artwork: AllergenArtwork }) {
  if (artwork.kind === 'none') return <View style={styles.dash} />;
  const [first, second] = artwork.tokens;
  if (second === undefined) return <Pictogram token={first} side={PICTOGRAM_SINGLE} />;
  return (
    <View style={styles.pair}>
      <View style={styles.pairFirst}>
        <Pictogram token={first} side={PICTOGRAM_PAIR} />
      </View>
      <View style={styles.pairSecond}>
        <Pictogram token={second} side={PICTOGRAM_PAIR} />
      </View>
    </View>
  );
}

function Pictogram({ token, side }: { token: string; side: number }) {
  return (
    <Image
      source={allergenPictogram(token) ?? undefined}
      resizeMode="contain"
      accessible={false}
      style={{ width: side, height: side }}
    />
  );
}

/**
 * The trust-peek mascot over the card's top edge: whole, decorative, and
 * entering once as the other onboarding mascots do.
 */
function TrustPeek({ size, top, right }: { size: number; top: number; right: number }) {
  const reduceMotion = useReduceMotion();
  const [animate] = useState(() => motionAllowed(reduceMotion));
  const [entrance] = useState(() => new Animated.Value(animate ? 0 : 1));
  useEffect(() => {
    if (!animate) return;
    const run = Animated.timing(entrance, {
      toValue: 1,
      delay: MASCOT_ENTRANCE.delay,
      duration: MASCOT_ENTRANCE.duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [animate, entrance]);
  return (
    <Animated.View
      {...DECORATIVE}
      style={[
        styles.peek,
        {
          top,
          right,
          width: size,
          height: size,
          opacity: entrance,
          transform: [
            {
              translateY: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [MASCOT_ENTRANCE.rise, 0],
              }),
            },
          ],
        },
      ]}>
      {/* Given a width and a height: an Image sized by aspectRatio alone was laid out at 1024pt. */}
      <Image
        source={MASCOT}
        resizeMode="contain"
        accessible={false}
        style={{ width: size, height: size }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  summary: {
    padding: SUMMARY_PADDING,
    gap: SUMMARY_ROW_GAP,
  },
  // Artwork, text and check share a top line: at larger text sizes the
  // values grow downward and the well and check stay level with the label.
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[12],
  },
  rowStacked: {
    gap: spacing[8],
  },
  // The artwork at the leading edge and the check at the trailing edge.
  marksStacked: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  leadingStacked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[8],
  },
  well: {
    width: ROW_WELL_SIZE,
    height: ROW_WELL_SIZE,
    borderRadius: radius[12],
    backgroundColor: color['background/surface'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
  },
  // As tall as the well, so the check sits level with the artwork.
  checkSlot: {
    height: ROW_WELL_SIZE,
    justifyContent: 'center',
  },
  checkCircle: {
    width: CHECK_CIRCLE_SIZE,
    height: CHECK_CIRCLE_SIZE,
    borderRadius: radius.full,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkWash: {
    ...StyleSheet.absoluteFill,
    backgroundColor: color['background/surface'],
    opacity: CHECK_WASH_OPACITY,
  },
  dash: {
    width: 14,
    height: 2,
    borderRadius: radius.full,
    backgroundColor: color['icon/primary'],
  },
  // The well's own square: the two pictograms on its diagonal.
  pair: {
    width: PICTOGRAM_PAIR + PICTOGRAM_PAIR_STEP,
    height: PICTOGRAM_PAIR + PICTOGRAM_PAIR_STEP,
  },
  pairFirst: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  // Drawn after the first, so it sits over the one shared corner.
  pairSecond: {
    position: 'absolute',
    left: PICTOGRAM_PAIR_STEP,
    top: PICTOGRAM_PAIR_STEP,
  },
  // Over the well's top trailing corner, which the diagonal pair leaves
  // empty, reaching into the gap before the label; at the accessibility
  // sizes it moves beside the well instead (`moreInline`).
  more: {
    position: 'absolute',
    top: -spacing[4],
    right: -spacing[8],
    minWidth: 20,
    paddingHorizontal: spacing[4],
    borderRadius: radius.full,
    backgroundColor: color['background/brand'],
    alignItems: 'center',
  },
  moreInline: {
    minWidth: 20,
    paddingHorizontal: spacing[4],
    borderRadius: radius.full,
    backgroundColor: color['background/brand'],
    alignItems: 'center',
  },
  peek: {
    position: 'absolute',
  },
  // The card's own last row, trailing like the checks above it.
  edit: {
    alignSelf: 'flex-end',
  },
  editInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[4],
  },
  pressed: {
    opacity: 0.6,
  },
  previewSection: {
    gap: spacing[12],
  },
  // The lime count pill: the Affects You treatment, a personalization
  // signal and never a safety claim.
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing[12],
    paddingVertical: spacing[4],
    borderRadius: radius.full,
    borderWidth: 1,
    backgroundColor: relevancePalette['affects-you'].background,
    borderColor: relevancePalette['affects-you'].border,
  },
  lockedStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[12],
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[12],
  },
  lockedText: {
    flex: 1,
  },
  emptyCard: {
    padding: spacing[16],
    gap: spacing[8],
  },
});
