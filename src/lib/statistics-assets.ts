/**
 * The Lotly statistics household illustrations (2026-09-28): the Problem
 * Risk step's four approved production images, one per CDC higher-risk
 * group, keyed by the semantic ids `PROBLEM_RISK_GROUP_IDS` already names.
 * The group vocabulary, labels and order stay in lib/onboarding-copy.ts and
 * lib/problem-presentation.ts; this module only says which picture each
 * group gets.
 *
 * ## The files
 *
 * Four approved production assets in `assets/brand/production/` as
 * `statistics-<group>-1024.png`: 1024×1024 8-bit RGBA, tagged sRGB, each a
 * fully opaque drawing (its own pale-blue backplate and lime emphasis
 * marks included) on a transparent canvas. They carry the same mechanical
 * repair as the mascots — clear pixels hold no colour, alpha 240–254
 * lifted to 255 with RGB untouched, the soft edge unmatted against white —
 * applied at the approved sources' native 1254×1254 and uniformly
 * resampled to 1024, never cropped, shifted or recoloured. The approved
 * sources stay byte-identical in `assets/brand/reference/statistics/
 * source/`; the audit of both is `statistics-production-asset-report.json`
 * beside them, and the contact sheets are review material bundled by
 * nothing.
 *
 * Static `require`s only, one per file, so Metro can see and bundle each
 * asset. `statistics-assets.test.ts` proves the map covers exactly the
 * group ids with four distinct production files and that no reference or
 * source image is imported anywhere in the app.
 */

import type { ImageSourcePropType } from 'react-native';

import type { ProblemRiskGroupId } from '@/lib/problem-presentation';

/**
 * The Problem Scale pictograph (2026-09-29): the authored one-in-six
 * composition as ONE production image — six full-body figures, one lime
 * with its three emphasis rays, five pale blue — repaired and resampled
 * exactly like the household illustrations. Its six between-the-legs gaps
 * are intended translucent artwork (the report records them); nothing was
 * filled or redrawn.
 */
export const SCALE_PICTOGRAPH =
  require('@/assets/brand/production/statistics-one-in-six-figures-1024.png') as ImageSourcePropType;

export const STATISTIC_ILLUSTRATIONS: Readonly<Record<ProblemRiskGroupId, ImageSourcePropType>> = {
  'young-children':
    require('@/assets/brand/production/statistics-young-children-1024.png') as ImageSourcePropType,
  'pregnant-people':
    require('@/assets/brand/production/statistics-pregnant-people-1024.png') as ImageSourcePropType,
  'adults-65-plus':
    require('@/assets/brand/production/statistics-adults-65-plus-1024.png') as ImageSourcePropType,
  'weakened-immune-systems':
    require('@/assets/brand/production/statistics-weakened-immune-systems-1024.png') as ImageSourcePropType,
};
