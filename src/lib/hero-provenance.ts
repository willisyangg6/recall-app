/**
 * Hero-image provenance classification (C9).
 *
 * `projection.heroImageUrl` may legitimately hold two things: an official
 * agency-hosted photograph, derived by `projectCase` from the announcement's
 * own preserved HTML, or (since 2026-11-22, docs/recall-imagery.md §16) a
 * product PHOTOGRAPH cropped from an FSIS label document by the label-photo
 * sync. A whole rendered label PAGE is still never a card hero: a letter-size
 * sheet shrinks the package to a third of the tile.
 *
 * This module answers the audit question "where did this stored hero URL
 * come from?" — nothing here selects or writes imagery. Host matching
 * delegates to the canonical resolver, so a lookalike host (`notfda.gov`,
 * `fda.gov.evil.net`) is unknown, never an agency photo.
 */

import { FDA_HOSTS, resolveOfficialUrl } from './official-urls';

/** Where a stored hero URL came from. */
export type HeroProvenance =
  /** Official agency-hosted photo (fda.gov files). */
  | 'agency_photo'
  /** A product photograph cropped from an FSIS label document
   *  (`fsis-label-photos/` in the product-visuals bucket) — the label-photo
   *  sync's card image. */
  | 'label_photo'
  /** Any other object in our bucket: a whole rendered label page. Nothing
   *  writes these as heroes; one appearing is a contradiction QA gates on. */
  | 'label_render'
  /** Anything else: not a URL this system ever writes. */
  | 'unknown';

/**
 * Classify a stored hero URL by provenance. `visualUrlPrefix` is the
 * public base of the product-visuals storage bucket for this deployment.
 */
export function classifyHeroUrl(
  url: string | null,
  visualUrlPrefix: string,
): HeroProvenance | null {
  if (url === null) return null;
  if (visualUrlPrefix !== '' && url.startsWith(visualUrlPrefix)) {
    return url.startsWith(`${visualUrlPrefix}fsis-label-photos/`) ? 'label_photo' : 'label_render';
  }
  const resolved = resolveOfficialUrl(url, { approvedHosts: FDA_HOSTS });
  if (resolved !== null && resolved.url === url) return 'agency_photo';
  return 'unknown';
}
