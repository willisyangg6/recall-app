/**
 * Hero-image provenance classification (C9).
 *
 * `projection.heroImageUrl` may legitimately hold exactly one thing today:
 * an official agency-hosted photograph, derived by `projectCase` from the
 * announcement's own preserved HTML. FSIS label renders live in
 * product_visuals as detail-screen evidence and are deliberately NOT card
 * heroes (C9 frozen policy: an ordinary regulatory label sheet is not
 * card imagery; professional-quality hero sourcing is C9.1's milestone).
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
  /** Our rendered label page (product-visuals storage bucket) — under the
   *  frozen policy nothing writes these as heroes; one appearing is a
   *  contradiction the QA gates on. */
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
  if (visualUrlPrefix !== '' && url.startsWith(visualUrlPrefix)) return 'label_render';
  const resolved = resolveOfficialUrl(url, { approvedHosts: FDA_HOSTS });
  if (resolved !== null && resolved.url === url) return 'agency_photo';
  return 'unknown';
}
