/**
 * The design-system surface primitive (P2B0): a View with a semantic
 * background, an optional radius from the scale, an optional 1px semantic
 * border, and an optional elevation. Nothing else — layout is the caller's.
 *
 * It is what the warm page, white cards, soft-blue callouts and the
 * media placeholder all are underneath, so every one of them resolves the
 * same way: component → semantic token → value.
 */

import { View, type ViewProps } from 'react-native';

import {
  color,
  elevation,
  radius,
  type BackgroundToken,
  type BorderToken,
  type ElevationLevel,
  type RadiusStep,
} from '@/constants/design-tokens';

export type SurfaceProps = ViewProps & {
  /** The semantic background. Defaults to the white card surface. */
  background?: BackgroundToken;
  /** Corner radius from the approved scale; square when omitted. */
  radius?: RadiusStep;
  /** A 1px semantic border; none when omitted. */
  border?: BorderToken;
  /** The lift; flat when omitted. */
  elevation?: ElevationLevel;
};

export function Surface({
  background = 'background/surface',
  radius: radiusStep,
  border,
  elevation: level = 'none',
  style,
  ...rest
}: SurfaceProps) {
  return (
    <View
      style={[
        { backgroundColor: color[background] },
        radiusStep !== undefined && { borderRadius: radius[radiusStep] },
        border !== undefined && { borderWidth: 1, borderColor: color[border] },
        elevation[level],
        style,
      ]}
      {...rest}
    />
  );
}
