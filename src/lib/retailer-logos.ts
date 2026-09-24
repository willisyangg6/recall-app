/**
 * Retailer logo provenance (P2B7X.1): the manifest every bundled retailer
 * mark must be recorded in, keyed by the canonical retailer id.
 *
 * ## The rule
 *
 * A retailer's mark renders ONLY when this manifest holds an entry for its
 * id and the icon-level component (components/ui/retailer-logo.tsx)
 * declares a bundled raster for the same id; the two are pinned to each
 * other by test. Every entry records where the official asset came from,
 * who owns it, and when it was retrieved. Nothing is fetched at runtime —
 * no hotlinking, no favicon or logo service, no remote URL of any kind — and
 * a retailer without a trustworthy asset falls back to the shared `home`
 * glyph rather than to an approximation.
 *
 * ## Coverage today: none
 *
 * No official retailer asset could be sourced and license-checked with
 * confidence in the milestone that built this pipeline, and whether Lotly
 * may display third-party marks at all is a founder and counsel decision
 * (docs/recall-onboarding-and-paywall.md, "Retailer logos"). So the manifest
 * is complete and EMPTY: all 77 catalog retailers render the fallback. An
 * entry is added per retailer, with its provenance, once an official asset
 * is in hand.
 *
 * A leaf: data only, importable in Node.
 */

import { RETAILER_CATALOG } from '@/domain/retailer-catalog';

export interface RetailerLogoProvenance {
  /** The canonical retailer id the mark belongs to. */
  retailerId: string;
  /** The official page or brand-asset kit the file was taken from. */
  sourceUrl: string;
  /** The mark's owner, as the source names it. */
  owner: string;
  /** ISO date the asset was retrieved. */
  retrievedOn: string;
  /** The license or permission the use rests on, in the founder's words. */
  permission: string;
  /** The raster's own pixel size at 1x, so the container can preserve the ratio. */
  width: number;
  height: number;
}

/** Keyed by canonical retailer id. Empty until official assets are sourced. */
export const RETAILER_LOGO_MANIFEST: Readonly<Record<string, RetailerLogoProvenance>> = {};

export function retailerLogoEntry(retailerId: string): RetailerLogoProvenance | null {
  return RETAILER_LOGO_MANIFEST[retailerId] ?? null;
}

/** The catalog ids with a bundled mark, and those that fall back. */
export function retailerLogoCoverage(): { withLogo: string[]; fallback: string[] } {
  const withLogo: string[] = [];
  const fallback: string[] = [];
  for (const retailer of RETAILER_CATALOG) {
    (retailerLogoEntry(retailer.id) === null ? fallback : withLogo).push(retailer.id);
  }
  return { withLogo, fallback };
}

/**
 * The normalised container every mark and the fallback share: a fixed box,
 * so a row with a logo and a row without one are the same height and the
 * label starts at the same edge. A mark is CONTAINED in it (never stretched,
 * cropped or recoloured); the fallback glyph sits centred in it.
 */
export const RETAILER_LOGO_BOX = { width: 40, height: 24 } as const;
