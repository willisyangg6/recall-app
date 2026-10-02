/**
 * The Building step (the five-stop watch, 2026-10-02): the founder-approved
 * composition, drawn. What each stop means and when the view changes is
 * lib/building-watch.ts; every measurement is lib/building-presentation.ts;
 * the route owns the data and the navigation.
 *
 * ## Composition
 *
 * The decorative hero (the grocery tote, its three tags and the mascot
 * holding binoculars over both eyes) at the page's full width, with the three
 * tag glyphs drawn back on top natively at their fitted boxes and angles;
 * then the headline; then one native rail of five equal stops whose blue,
 * lime, blue, lime, blue circles are fixed decoration; then ONE changing
 * caption. Active is two lime rays above a stop; complete is a navy badge
 * with a white check on its lower right — shape and position, never colour
 * alone. When results are slow or unavailable a footer offers Try again and
 * Continue to preview.
 *
 * ## Motion (finite, native driver, opacity and transform only)
 *
 * One beat moves everything together: the finished stop's badge settles in,
 * the next stop's rays appear, the caption's new words fade up at most 6pt,
 * and the matching bag-tag glyph (Area, Allergens, Stores) swells once and
 * returns. Nothing loops, springs or bounces; the hero never moves. Under
 * Reduce Motion (or before the setting is known) every change is immediate.
 *
 * ## Accessibility
 *
 * The hero and its glyphs are hidden. The headline is a header. The rail and
 * the caption are ONE element, `Recall check progress`, whose value is the
 * current caption and how many stops are done; stops are never announced one
 * by one. The route makes the start and completion announcements (and the
 * slow or error message), each only when true.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type ImageSourcePropType,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { color, layout, spacing } from '@/constants/design-tokens';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import {
  BADGE_PX,
  BUILDING_COLOURS,
  baselineInLine,
  captionType,
  HEADLINE_MEASURE,
  headlineType,
  HERO_PX,
  heroTopGap,
  ptPerPx,
  RAIL_PX,
  RAYS_PX,
  RHYTHM_PX,
  STOP_FILLS,
  STOP_GLYPH_PX,
  stopCentreX,
  TAG_EMPHASIS_SCALE,
  TAG_GLYPHS,
} from '@/lib/building-presentation';
import {
  BUILDING_STOPS,
  BUILDING_TIMING,
  captionText,
  completedStops,
  stopStates,
  type BuildingCaption,
  type BuildingStopId,
  type BuildingView,
  type StopState,
} from '@/lib/building-watch';
import {
  BUILDING_CONTINUE,
  BUILDING_HEADLINE,
  BUILDING_PROGRESS_LABEL,
  BUILDING_RETRY,
  buildingProgressValue,
} from '@/lib/onboarding-copy';
import { motionAllowed } from '@/lib/onboarding-state';

/** The approved hero: tags blank, every other pixel the reference's own. */
const HERO =
  require('@/assets/brand/production/lotly-building-grocery-search-scene.png') as ImageSourcePropType;

/** The five glyphs (rail and tags), rasterised by scripts/render-onboarding-assets.mjs. */
const GLYPHS: Record<BuildingStopId, ImageSourcePropType> = {
  area: require('@/assets/onboarding/building/building-area.png') as ImageSourcePropType,
  allergens: require('@/assets/onboarding/building/building-allergens.png') as ImageSourcePropType,
  stores: require('@/assets/onboarding/building/building-stores.png') as ImageSourcePropType,
  matches: require('@/assets/onboarding/building/building-matches.png') as ImageSourcePropType,
  feed: require('@/assets/onboarding/building/building-feed.png') as ImageSourcePropType,
};

/** Strong ease-out for anything appearing; ease-in-out for the tag's return. */
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);
/**
 * One beat's timing: the caption fades OUT, the words swap while nothing is
 * visible, the new caption fades IN — and the rail and tags change from that
 * hidden swap point, over the fade-in.
 */
const MOTION = {
  out: BUILDING_TIMING.captionFadeOutMs,
  in: BUILDING_TIMING.captionFadeInMs,
  settle: 260,
} as const;

/**
 * An animation that starts at the hidden swap point: `easing` held at its
 * start through the fade-out, then run over `duration`. The hold is part of
 * the curve, which the native driver receives as frames, so nothing waits on
 * the JS thread at the swap — a second step started from a completion (or a
 * JS-timed delay) arrived ~35ms late on device: a measured blank.
 */
function fromSwap(easing: (t: number) => number, duration: number) {
  const total = MOTION.out + duration;
  const swap = MOTION.out / total;
  return {
    duration: total,
    easing: (t: number) => (t <= swap ? 0 : easing((t - swap) / (1 - swap))),
  };
}

/** The decorative-subtree props: never heard, never touched. */
const DECORATIVE = {
  accessible: false,
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
  pointerEvents: 'none',
} as const;

const NAVY = color['text/primary'];

export function BuildingStep({
  view,
  caption,
  captionCandidates,
  onCaptionSettled,
  onRetry,
  onContinue,
}: {
  view: BuildingView;
  caption: BuildingCaption;
  /** Every caption this screen can show: the caption box is sized to the tallest. */
  captionCandidates: readonly BuildingCaption[];
  /** The caption's fade-in finished on screen: the reading hold starts. */
  onCaptionSettled?: () => void;
  onRetry: () => void;
  onContinue: () => void;
}) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const { fontScale } = window;
  // Sized from the screen's own measured frame, not the window: the Design
  // Preview draws steps in narrow frames.
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(null);
  const width = frame?.width ?? window.width;
  const height = frame?.height ?? window.height;
  const reduceMotion = useReduceMotion();
  // Decided once: a screen that appears while the setting is unknown never
  // starts animating late.
  const [animate] = useState(() => motionAllowed(reduceMotion));
  const s = ptPerPx(width);
  const states = stopStates(view);
  const text = captionText(caption);
  const escape = view.phase === 'slow' || view.phase === 'error';
  // When the footer arrives, the message it answers must be in view, from its
  // first line: the rail and the message when both fit, else the message's
  // top; never past the end. Positions are the screen's own measured layout.
  const scroll = useRef<ScrollView>(null);
  const geometry = useRef({ content: 0, footer: 0, group: 0, groupHeight: 0, caption: 0 });
  const revealMessage = useCallback(() => {
    const g = geometry.current;
    // What the scroll view shows: the screen above the footer, both measured.
    if (g.footer === 0) return;
    const viewport = height - g.footer;
    const end = Math.max(0, g.content - viewport);
    // The scroll view runs under the status bar: keep the first line below it.
    const clear = insets.top + spacing[8];
    const target =
      g.groupHeight + clear <= viewport ? g.group - clear : g.group + g.caption - clear;
    scroll.current?.scrollTo({ y: Math.max(0, Math.min(end, target)), animated: animate });
  }, [animate, insets.top, height]);
  useEffect(() => {
    if (!escape) return;
    // One frame later, once the footer has taken its height.
    const frame = requestAnimationFrame(revealMessage);
    return () => cancelAnimationFrame(frame);
  }, [escape, revealMessage]);

  // ── Motion values (created once) ─────────────────────────────────────────
  const [rays] = useState(() => BUILDING_STOPS.map(() => new Animated.Value(0)));
  const [badges] = useState(() => BUILDING_STOPS.map(() => new Animated.Value(0)));
  const [swell] = useState(() => TAG_GLYPHS.map(() => new Animated.Value(0)));
  // The previous beat's stop states, read and written only inside the beat effect.
  const shown = useRef<StopState[]>(states);

  // One beat: everything that changed moves together, in one frame.
  const statesKey = states.join(',');
  useEffect(() => {
    const before = shown.current;
    const runs: Animated.CompositeAnimation[] = [];
    // From the caption's hidden swap point, over its fade-in.
    const atSwap = (value: Animated.Value, target: number) =>
      Animated.timing(value, {
        toValue: target,
        ...fromSwap(EASE_OUT, MOTION.in),
        useNativeDriver: true,
      });
    states.forEach((state, i) => {
      const rayTarget = state === 'active' ? 1 : 0;
      const badgeTarget = state === 'complete' ? 1 : 0;
      if (!animate) {
        rays[i].setValue(rayTarget);
        badges[i].setValue(badgeTarget);
        return;
      }
      // The rail changes at the caption's hidden swap point, over its fade-in.
      runs.push(atSwap(rays[i], rayTarget));
      runs.push(atSwap(badges[i], badgeTarget));
      const tag = TAG_GLYPHS.findIndex((t) => t.stop === BUILDING_STOPS[i]);
      if (tag >= 0 && state === 'active' && before[i] !== 'active') {
        runs.push(
          Animated.sequence([
            atSwap(swell[tag], 1),
            Animated.timing(swell[tag], {
              toValue: 0,
              duration: MOTION.settle,
              easing: EASE_IN_OUT,
              useNativeDriver: true,
            }),
          ]),
        );
      }
    });
    shown.current = states;
    const all = Animated.parallel(runs);
    all.start();
    return () => all.stop();
    // The values are created once; the beat is keyed by what is shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statesKey]);

  // ── Layout ────────────────────────────────────────────────────────────────
  const heroHeight = HERO_PX.height * s;
  const headlineSize = headlineType(fontScale);
  const captionSize = captionType(fontScale, width - 2 * layout.pageMargin);
  const headlineBaseline = baselineInLine(
    headlineSize.fontSize * fontScale,
    headlineSize.lineHeight * fontScale,
  );
  const captionBaseline = baselineInLine(
    captionSize.fontSize * fontScale,
    captionSize.lineHeight * fontScale,
  );
  const railHeight = (RAIL_PX.raysAboveCircle + RAIL_PX.diameter) * s;
  const circleCentreY = (RAIL_PX.raysAboveCircle + RAIL_PX.diameter / 2) * s;
  const pageWidth = width - layout.pageMargin * 2;
  const headlineMeasure = Math.min(pageWidth, HEADLINE_MEASURE * fontScale);
  const viewport = height - insets.top - insets.bottom;
  const metrics = useMemo(
    () => ({
      topGap: heroTopGap(width, viewport),
      headlineTop: Math.max(0, RHYTHM_PX.heroToHeadlineBaseline * s - headlineBaseline),
      railTop: Math.max(
        spacing[8],
        RHYTHM_PX.headlineBaselineToRail * s -
          (headlineSize.lineHeight * fontScale - headlineBaseline),
      ),
      captionTop: Math.max(
        spacing[8],
        RHYTHM_PX.circleBottomToCaptionBaseline * s - captionBaseline,
      ),
    }),
    [width, viewport, s, headlineBaseline, captionBaseline, fontScale, headlineSize.lineHeight],
  );

  return (
    <Surface
      background="background/page"
      style={styles.page}
      onLayout={(event) => {
        const { width: w, height: h } = event.nativeEvent.layout;
        if (frame === null || frame.width !== w || frame.height !== h)
          setFrame({ width: w, height: h });
      }}>
      <ScrollView
        ref={scroll}
        style={styles.page}
        onContentSizeChange={(_, contentHeight) => {
          geometry.current.content = contentHeight;
        }}
        contentContainerStyle={{
          paddingTop: insets.top + metrics.topGap,
          paddingBottom: (escape ? spacing[16] : insets.bottom) + spacing[24],
        }}
        showsVerticalScrollIndicator={false}>
        <View {...DECORATIVE} style={{ width, height: heroHeight }}>
          <Image source={HERO} style={{ width, height: heroHeight }} resizeMode="stretch" />
          {TAG_GLYPHS.map((tag, i) => {
            const box = tag.box * s;
            return (
              <Animated.Image
                key={tag.stop}
                source={GLYPHS[tag.stop]}
                style={[
                  styles.glyph,
                  {
                    left: tag.centre[0] * s - box / 2,
                    top: tag.centre[1] * s - box / 2,
                    width: box,
                    height: box,
                    tintColor: NAVY,
                    transform: [
                      { rotate: `${tag.rotate}deg` },
                      {
                        scale: swell[i].interpolate({
                          inputRange: [0, 1],
                          outputRange: [1, TAG_EMPHASIS_SCALE],
                        }),
                      },
                    ],
                  },
                ]}
              />
            );
          })}
        </View>
        <Text
          variant="display"
          accessibilityRole="header"
          style={[
            styles.headline,
            headlineSize,
            { marginTop: metrics.headlineTop, maxWidth: headlineMeasure },
          ]}>
          {BUILDING_HEADLINE}
        </Text>
        <View
          onLayout={(event) => {
            geometry.current.group = event.nativeEvent.layout.y;
            geometry.current.groupHeight = event.nativeEvent.layout.height;
          }}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={BUILDING_PROGRESS_LABEL}
          accessibilityValue={{
            min: 0,
            max: BUILDING_STOPS.length,
            now: completedStops(view),
            text: buildingProgressValue(text, completedStops(view), BUILDING_STOPS.length),
          }}>
          <View {...DECORATIVE} style={{ width, height: railHeight, marginTop: metrics.railTop }}>
            {BUILDING_STOPS.slice(0, -1).map((stop, i) => {
              const length = RAIL_PX.connector.length * s;
              const thickness = Math.max(1.5, RAIL_PX.connector.thickness * s);
              const x = (stopCentreX(width, i) + stopCentreX(width, i + 1)) / 2;
              return (
                <View
                  key={`connector-${stop}`}
                  style={[
                    styles.connector,
                    {
                      left: x - length / 2,
                      top: circleCentreY - thickness / 2,
                      width: length,
                      height: thickness,
                      borderRadius: thickness / 2,
                    },
                  ]}
                />
              );
            })}
            {BUILDING_STOPS.map((stop, i) => (
              <Stop
                key={stop}
                stop={stop}
                index={i}
                cx={stopCentreX(width, i)}
                cy={circleCentreY}
                s={s}
                ray={rays[i]}
                badge={badges[i]}
              />
            ))}
          </View>
          <View
            onLayout={(event) => {
              geometry.current.caption = event.nativeEvent.layout.y;
            }}
            style={{ marginTop: metrics.captionTop }}>
            <CaptionFadeThrough
              caption={caption}
              candidates={captionCandidates}
              animate={animate}
              onSettled={onCaptionSettled}
              textStyle={captionSize}
              lineHeight={captionSize.lineHeight * fontScale}
            />
          </View>
        </View>
      </ScrollView>
      {escape ? (
        <View
          style={[styles.footer, { paddingBottom: insets.bottom + spacing[12] }]}
          onLayout={(event) => {
            geometry.current.footer = event.nativeEvent.layout.height;
            revealMessage();
          }}>
          <Button label={BUILDING_RETRY} onPress={onRetry} />
          <Button label={BUILDING_CONTINUE} variant="secondary" onPress={onContinue} />
        </View>
      ) : null}
    </Surface>
  );
}

/** One caption: a single Public Sans 700 sentence (the count line too). */
function CaptionWords({
  caption,
  textStyle,
}: {
  caption: BuildingCaption;
  textStyle: { fontSize: number; lineHeight: number };
}) {
  return (
    <Text variant="display" style={[styles.caption, textStyle]}>
      {captionText(caption)}
    </Text>
  );
}

interface CaptionLayer {
  id: number;
  key: string;
  caption: BuildingCaption;
  opacity: Animated.Value;
}

/**
 * The one changing caption, faded THROUGH in a box of stable height (the
 * tallest caption this screen can show, measured at the current width and
 * text size, wrapping naturally). A new caption is rendered on its own
 * layer, created transparent; one native timeline then fades the outgoing
 * caption to nothing (`captionFadeOutMs`) and, with no pause, the incoming
 * one to full (`captionFadeInMs`) — so the visible words change only while
 * nothing is visible, and two sentences are never on screen together. No
 * movement, no scale, no flash. An interruption stops the running timeline;
 * only the current one reports that its caption is fully visible (the stop's
 * reading hold starts then). Under Reduce Motion the words swap at once. The
 * layers are decorative: the progress element above speaks the caption once.
 */
function CaptionFadeThrough({
  caption,
  candidates,
  animate,
  onSettled,
  textStyle,
  lineHeight,
}: {
  caption: BuildingCaption;
  candidates: readonly BuildingCaption[];
  animate: boolean;
  onSettled?: () => void;
  textStyle: { fontSize: number; lineHeight: number };
  lineHeight: number;
}) {
  const key = captionText(caption);
  const [state, setState] = useState<{ next: number; layers: CaptionLayer[] }>(() => ({
    next: 1,
    layers: [{ id: 0, key, caption, opacity: new Animated.Value(1) }],
  }));
  const front = state.layers[state.layers.length - 1];
  if (front.key !== key) {
    // New words: adjusting state while rendering (React's pattern for a
    // changed prop), so they are never drawn on the visible layer.
    const incoming: CaptionLayer = {
      id: state.next,
      key,
      caption,
      opacity: new Animated.Value(animate ? 0 : 1),
    };
    setState({ next: state.next + 1, layers: animate ? [front, incoming] : [incoming] });
  }

  const incoming = state.layers[state.layers.length - 1];
  const outgoing = state.layers.length > 1 ? state.layers[0] : null;
  const current = useRef(incoming.id);
  useEffect(() => {
    current.current = incoming.id;
    if (outgoing === null) return;
    const fade = (
      value: Animated.Value,
      toValue: number,
      timing: { duration: number; easing: (t: number) => number },
    ) => Animated.timing(value, { toValue, ...timing, useNativeDriver: true });
    // Out, then in, as one native timeline: the incoming layer (created at
    // nothing) holds at nothing until the outgoing one has reached nothing,
    // then fades in with no pause between. The fade-out is linear: under the
    // strong ease-out the old words were gone within ~25ms, leaving most of
    // its 80ms blank on device.
    const run = Animated.parallel([
      fade(outgoing.opacity, 0, { duration: MOTION.out, easing: Easing.linear }),
      fade(incoming.opacity, 1, fromSwap(EASE_OUT, MOTION.in)),
    ]);
    run.start(({ finished }) => {
      // A stale or interrupted fade changes nothing.
      if (!finished || current.current !== incoming.id) return;
      // The transparent layer stays mounted until the next change drops it
      // (under that fade-out): removing it now re-composited the visible
      // text mid-hold, a measurable re-rasterization of its glyph edges.
      onSettled?.();
    });
    return () => run.stop();
    // Keyed by the arriving layer: each one fades in exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming.id]);

  // The stable box: the tallest candidate, measured invisibly.
  const heights = useRef<number[]>([]);
  const [boxHeight, setBoxHeight] = useState(0);
  const measure = (index: number, height: number) => {
    heights.current[index] = height;
    const tallest = Math.max(...heights.current.filter((h) => h > 0));
    if (Math.abs(tallest - boxHeight) > 0.5) setBoxHeight(tallest);
  };

  return (
    <View {...DECORATIVE} style={{ height: Math.max(boxHeight, lineHeight) }}>
      {candidates.map((candidate, index) => (
        <View
          key={`measure-${index}`}
          style={styles.captionMeasure}
          onLayout={(event) => measure(index, event.nativeEvent.layout.height)}>
          <CaptionWords caption={candidate} textStyle={textStyle} />
        </View>
      ))}
      {state.layers.map((layer) => (
        <Animated.View key={layer.id} style={[styles.captionLayer, { opacity: layer.opacity }]}>
          <CaptionWords caption={layer.caption} textStyle={textStyle} />
        </Animated.View>
      ))}
    </View>
  );
}

/** One stop: its fixed-colour circle and glyph, the active rays and the done badge. */
function Stop({
  stop,
  index,
  cx,
  cy,
  s,
  ray,
  badge,
}: {
  stop: BuildingStopId;
  index: number;
  cx: number;
  cy: number;
  s: number;
  ray: Animated.Value;
  badge: Animated.Value;
}) {
  const d = RAIL_PX.diameter * s;
  const glyph = STOP_GLYPH_PX[stop] * s;
  const badgeD = BADGE_PX.diameter * s;
  const fill =
    STOP_FILLS[index] === 'lime' ? color['background/accent'] : BUILDING_COLOURS.stopBlue;
  const appear = (value: Animated.Value, from: number) => ({
    opacity: value,
    transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [from, 1] }) }],
  });
  return (
    <>
      {RAYS_PX.map((r, i) => {
        const length = r.length * s;
        const thickness = r.thickness * s;
        return (
          <Animated.View
            key={`ray-${i}`}
            style={[
              styles.ray,
              {
                left: cx + r.offset[0] * s - length / 2,
                top: cy + r.offset[1] * s - thickness / 2,
                width: length,
                height: thickness,
                borderRadius: thickness / 2,
                opacity: ray,
                transform: [
                  { rotate: `${r.angle}deg` },
                  { scale: ray.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) },
                ],
              },
            ]}
          />
        );
      })}
      <View
        style={[
          styles.circle,
          {
            left: cx - d / 2,
            top: cy - d / 2,
            width: d,
            height: d,
            borderRadius: d / 2,
            backgroundColor: fill,
          },
        ]}>
        <Image
          source={GLYPHS[stop]}
          style={{ width: glyph, height: glyph, tintColor: NAVY }}
          resizeMode="contain"
        />
      </View>
      <Animated.View
        style={[
          styles.badge,
          {
            left: cx + BADGE_PX.offset[0] * s - badgeD / 2,
            top: cy + BADGE_PX.offset[1] * s - badgeD / 2,
            width: badgeD,
            height: badgeD,
            borderRadius: badgeD / 2,
          },
          appear(badge, 0.85),
        ]}>
        <Icon name="check" size={12} color="icon/inverse" />
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  glyph: {
    position: 'absolute',
  },
  headline: {
    alignSelf: 'center',
    textAlign: 'center',
    color: NAVY,
  },
  connector: {
    position: 'absolute',
    backgroundColor: BUILDING_COLOURS.connector,
  },
  ray: {
    position: 'absolute',
    backgroundColor: color['background/accent'],
  },
  circle: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: NAVY,
  },
  caption: {
    textAlign: 'center',
    color: NAVY,
    paddingHorizontal: layout.pageMargin,
  },
  // The caption layers and their invisible measures share the box's top edge.
  captionLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  captionMeasure: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    opacity: 0,
  },
  footer: {
    paddingHorizontal: layout.pageMargin,
    paddingTop: spacing[12],
    gap: spacing[8],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color['border/subtle'],
    backgroundColor: color['background/page'],
  },
});
