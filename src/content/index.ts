/**
 * The trust-document registry (C7): every document the app can render, plus
 * the Profile trust-center grouping.
 *
 * Deliberately ABSENT: a Privacy Policy and Terms/EULA. Their drafts live in
 * docs/ with unresolved founder and legal inputs, and an unfinished policy
 * must never be exposed in the app (the integrity tests enforce this). They
 * join this registry only when their publication blockers are resolved.
 */

import type { TrustDocument } from './document-model';
import { ATTRIBUTIONS } from './attributions';
import { CORRECTIONS_POLICY } from './corrections-policy';
import { HOW_AFFECTS_ME_WORKS } from './how-affects-me-works';
import { PRIVACY_DATA_CONTROLS } from './privacy-data-controls';
import { RISK_LEVELS } from './risk-levels';
import { SAFETY_DISCLAIMER } from './safety-disclaimer';
import { SOURCES_METHODOLOGY } from './sources-methodology';

export const TRUST_DOCUMENTS: readonly TrustDocument[] = [
  SOURCES_METHODOLOGY,
  HOW_AFFECTS_ME_WORKS,
  RISK_LEVELS,
  SAFETY_DISCLAIMER,
  CORRECTIONS_POLICY,
  PRIVACY_DATA_CONTROLS,
  ATTRIBUTIONS,
];

export function documentBySlug(slug: string): TrustDocument | undefined {
  return TRUST_DOCUMENTS.find((doc) => doc.slug === slug);
}

export interface ProfileDocumentGroup {
  /** Uppercased section label on the Profile screen. */
  title: string;
  /** Slugs of the documents in this group, display order. */
  slugs: readonly string[];
}

/**
 * The one document Profile promotes to a PRIMARY destination (P2A): Profile's
 * three primary rows are Personalization, Notifications, and Privacy & Data
 * Controls, and the third is this document rather than a row Profile invents.
 *
 * It stays registered in its group below — the registry remains the single
 * definition of what exists and where it belongs — and Profile simply skips
 * it when rendering the groups, so it appears exactly once on screen while
 * the "every document reachable exactly once" guarantee is unchanged.
 */
export const PROFILE_PRIMARY_DOCUMENT_SLUG = 'privacy-data-controls';

/**
 * The Profile trust-center grouping. Every slug must resolve in
 * TRUST_DOCUMENTS and every registered document must appear exactly once —
 * both enforced by tests — so Profile can never grow a dead row and a
 * finished document can never be silently unreachable.
 */
export const PROFILE_DOCUMENT_GROUPS: readonly ProfileDocumentGroup[] = [
  {
    title: 'About & Safety',
    slugs: [
      'sources-methodology',
      'how-affects-me-works',
      'risk-levels',
      'safety-disclaimer',
      'corrections-policy',
    ],
  },
  {
    title: 'Privacy & Data',
    slugs: ['privacy-data-controls'],
  },
  {
    title: 'Legal',
    slugs: ['attributions'],
  },
];
