/**
 * The States step's map (P2B7Y): the contiguous states and the District of
 * Columbia in one panel, Alaska, Hawaii and Puerto Rico in their own inset
 * boxes beneath it, and a control above it that enlarges the Northeast. The
 * geometry is the Census Bureau's, bundled (lib/state-map-geometry.ts); the
 * rules are in lib/state-map.ts. Presentational: the step owns the draft.
 *
 * ## Touch
 *
 * The panel is ONE press target. Where the finger lands is converted to the
 * map's own units and `stateAtPoint` names the jurisdiction — the shape
 * under the finger, the District's marker in the Northeast view, or the
 * nearest shape within a few points of water. Everything drawn over the
 * panel ignores touches. Each inset box is its own target, whole.
 *
 * ## Selection is never colour alone
 *
 * A chosen shape fills `action/primary` with a `background/surface` edge
 * (so two chosen neighbours stay apart) and carries a check at its interior
 * point wherever the check fits; a chosen inset gets a solid border and a
 * checked badge; the District's marker fills and draws a check. The step
 * lists every chosen jurisdiction by name beneath the map as well.
 *
 * ## Assistive technology
 *
 * The drawing is hidden. Each jurisdiction on the panel is an invisible
 * checkbox element at its interior point, named in full (`Rhode Island`,
 * never `RI`), activated by VoiceOver's double-tap (`onAccessibilityTap`)
 * without taking any finger touch; each inset box is a checkbox of its own.
 * iOS orders the elements by position, so VoiceOver reads the map
 * geographically, north to south and west to east; the list is the
 * alphabetical way through. The Northeast control reports whether the
 * enlarged view is showing.
 */

import { memo, useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { color, hitTarget, radius, spacing } from '@/constants/design-tokens';
import {
  elementFrame,
  fitView,
  insetLayout,
  INSET_PADDING,
  MARKER_SIZE,
  NORTHEAST_ZOOM_IN_HINT,
  NORTHEAST_ZOOM_IN_LABEL,
  NORTHEAST_ZOOM_OUT_HINT,
  NORTHEAST_ZOOM_OUT_LABEL,
  stateAtPoint,
  stateMarks,
  stateSpokenName,
  viewAspect,
  type InsetBox,
  type StateMapView,
} from '@/lib/state-map';
import { STATE_MAP_SHAPES, type StateMapViewBox } from '@/lib/state-map-geometry';

/** A boundary's width, in points, whatever the view's scale. */
const EDGE = 0.75;
const CHOSEN_EDGE = 1;

const viewBoxOf = (box: StateMapViewBox) => `${box.x} ${box.y} ${box.width} ${box.height}`;

export function StateMap({
  selected,
  onToggle,
}: {
  /** The step's draft: the one selection Map and List both edit. */
  selected: readonly string[];
  onToggle: (code: string) => void;
}) {
  const [width, setWidth] = useState(0);
  const [view, setView] = useState<StateMapView>('contiguous');
  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
  const enlarged = view === 'northeast';

  return (
    <View style={styles.map} onLayout={onLayout}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={enlarged ? NORTHEAST_ZOOM_OUT_LABEL : NORTHEAST_ZOOM_IN_LABEL}
        accessibilityHint={enlarged ? NORTHEAST_ZOOM_OUT_HINT : NORTHEAST_ZOOM_IN_HINT}
        accessibilityState={{ expanded: enlarged }}
        onPress={() => setView(enlarged ? 'contiguous' : 'northeast')}
        style={({ pressed }) => [styles.zoom, pressed && styles.pressed]}>
        <Icon name={enlarged ? 'zoom-out' : 'zoom-in'} size={20} color="icon/brand" />
        <Text variant="body-small-bold" color="action/secondary" style={styles.zoomText}>
          {enlarged ? NORTHEAST_ZOOM_OUT_LABEL : NORTHEAST_ZOOM_IN_LABEL}
        </Text>
      </Pressable>
      {width > 0 ? (
        <ContiguousPanel view={view} width={width} selected={selected} onToggle={onToggle} />
      ) : (
        <View style={{ aspectRatio: viewAspect(view) }} />
      )}
      {width > 0 ? (
        <View style={styles.insets}>
          {insetLayout(width).map((inset) => (
            <InsetTarget
              key={inset.inset}
              inset={inset}
              checked={selected.includes(inset.code)}
              onToggle={onToggle}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ContiguousPanel({
  view,
  width,
  selected,
  onToggle,
}: {
  view: StateMapView;
  width: number;
  selected: readonly string[];
  onToggle: (code: string) => void;
}) {
  const fitted = fitView(view, width);
  const shapes = STATE_MAP_SHAPES.filter((shape) => shape.region === 'contiguous');
  const chosen = shapes.filter((shape) => selected.includes(shape.code));
  const open = shapes.filter((shape) => !selected.includes(shape.code));
  return (
    <Pressable
      accessible={false}
      onPress={(event) => {
        const code = stateAtPoint(
          view,
          width,
          event.nativeEvent.locationX,
          event.nativeEvent.locationY,
        );
        if (code !== null) onToggle(code);
      }}
      style={[
        { width: fitted.width, height: fitted.height },
        view === 'northeast' && styles.enlarged,
      ]}>
      <Svg
        width={fitted.width}
        height={fitted.height}
        viewBox={viewBoxOf(fitted.box)}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        {/* Open shapes first, chosen shapes over them, so a chosen edge is never under a neighbour's. */}
        <G>
          {open.map((shape) => (
            <ShapePath key={shape.code} d={shape.d} chosen={false} scale={fitted.scale} />
          ))}
        </G>
        <G>
          {chosen.map((shape) => (
            <ShapePath key={shape.code} d={shape.d} chosen scale={fitted.scale} />
          ))}
        </G>
      </Svg>
      {/* The enlarged view is a crop: framed, so its cut edges read as a frame. */}
      {view === 'northeast' ? <View pointerEvents="none" style={styles.frame} /> : null}
      {stateMarks(view, width).map((mark) => {
        const checked = selected.includes(mark.code);
        return (
          <View
            key={mark.code}
            pointerEvents="none"
            accessible
            accessibilityRole="checkbox"
            accessibilityLabel={stateSpokenName(mark.code)}
            accessibilityState={{ checked }}
            onAccessibilityTap={() => onToggle(mark.code)}
            style={[styles.element, elementFrame(mark, fitted)]}>
            {mark.marker ? (
              <View style={[styles.marker, checked && styles.markerChecked]}>
                {checked ? <Icon name="check" size={12} color="icon/inverse" /> : null}
              </View>
            ) : checked && mark.checkFits ? (
              <Icon name="check" size={mark.checkSize} color="icon/inverse" />
            ) : null}
          </View>
        );
      })}
    </Pressable>
  );
}

const ShapePath = memo(function ShapePath({
  d,
  chosen,
  scale,
  alone = false,
}: {
  d: string;
  chosen: boolean;
  scale: number;
  /** Alone in its box (an inset): a chosen edge matches the fill, so islets are not eroded. */
  alone?: boolean;
}) {
  const chosenEdge = alone ? color['action/primary'] : color['background/surface'];
  return (
    <Path
      d={d}
      fill={chosen ? color['action/primary'] : color['background/surface']}
      stroke={chosen ? chosenEdge : color['border/strong']}
      strokeWidth={(chosen ? CHOSEN_EDGE : EDGE) / scale}
      strokeLinejoin="round"
    />
  );
});

function InsetTarget({
  inset,
  checked,
  onToggle,
}: {
  inset: InsetBox;
  checked: boolean;
  onToggle: (code: string) => void;
}) {
  const shape = STATE_MAP_SHAPES.find((candidate) => candidate.code === inset.code);
  const innerWidth = inset.width - INSET_PADDING * 2;
  const innerHeight = inset.height - INSET_PADDING * 2;
  const scale = innerWidth / inset.box.width;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={stateSpokenName(inset.code)}
      accessibilityState={{ checked }}
      onPress={() => onToggle(inset.code)}
      style={({ pressed }) => [
        styles.inset,
        { width: inset.width, height: inset.height },
        checked && styles.insetChecked,
        pressed && styles.pressed,
      ]}>
      <Svg
        width={innerWidth}
        height={innerHeight}
        viewBox={viewBoxOf(inset.box)}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        {shape ? <ShapePath d={shape.d} chosen={checked} scale={scale} alone /> : null}
      </Svg>
      {checked ? (
        <View pointerEvents="none" style={styles.insetBadge}>
          <Icon name="check" size={12} color="icon/inverse" />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  map: {
    gap: spacing[8],
  },
  zoom: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[4],
    minHeight: hitTarget.minimum,
    maxWidth: '100%',
  },
  zoomText: {
    flexShrink: 1,
  },
  enlarged: {
    borderRadius: radius[12],
    overflow: 'hidden',
  },
  frame: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius[12],
    borderWidth: 1,
    borderColor: color['border/default'],
  },
  element: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  marker: {
    width: MARKER_SIZE,
    height: MARKER_SIZE,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: color['action/primary'],
    backgroundColor: color['background/surface'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerChecked: {
    backgroundColor: color['action/primary'],
    borderColor: color['background/surface'],
  },
  insets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[8],
  },
  inset: {
    padding: INSET_PADDING,
    borderRadius: radius[12],
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color['border/strong'],
  },
  insetChecked: {
    borderStyle: 'solid',
    borderColor: color['action/primary'],
  },
  insetBadge: {
    position: 'absolute',
    top: spacing[4],
    right: spacing[4],
    width: spacing[16] + spacing[4],
    height: spacing[16] + spacing[4],
    borderRadius: radius.full,
    backgroundColor: color['action/primary'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
