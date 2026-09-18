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

/**
 * The Profile group a document is listed under (P2B6B): the document screen
 * shows the group's title in the navigator, above the document's own full
 * title on the page, so the two are never the same words twice.
 */
export function profileGroupFor(slug: string): ProfileDocumentGroup | undefined {
  return PROFILE_DOCUMENT_GROUPS.find((group) => group.slugs.includes(slug));
}

export interface ProfileDocumentGroup {
  /** The group's label on the Profile screen, rendered as written (title case). */
  title: string;
  /** Slugs of the documents in this group, display order. */
  slugs: readonly string[];
  /** A quiet caption Profile shows beneath the group, when one belongs to it. */
  footnote?: string;
}

/**
 * The one document that is a PRIMARY Profile destination (P2A): alongside
 * Personalization and Notifications, Privacy & Data Controls — this
 * registered document rather than a row Profile invents. On the P2B5 hub it
 * is the one document row that keeps its supporting line; every other
 * document reads by its title alone. It is registered in its group below
 * like any other, so "every document reachable exactly once" is one rule.
 */
export const PROFILE_PRIMARY_DOCUMENT_SLUG = 'privacy-data-controls';

/**
 * The Profile trust-center grouping, in the order the hub shows it (P2B5:
 * Privacy & Data directly beneath the preferences, then About & Safety,
 * then Legal). Every slug must resolve in TRUST_DOCUMENTS and every
 * registered document must appear exactly once — both enforced by tests —
 * so Profile can never grow a dead row and a finished document can never be
 * silently unreachable. About & Safety carries the hub's one-sentence
 * statement of where recall information comes from; "Recall" there is the
 * noun, not the product.
 */
export const PROFILE_DOCUMENT_GROUPS: readonly ProfileDocumentGroup[] = [
  {
    title: 'Privacy & Data',
    slugs: ['privacy-data-controls'],
  },
  {
    title: 'About & Safety',
    slugs: [
      'sources-methodology',
      'how-affects-me-works',
      'risk-levels',
      'safety-disclaimer',
      'corrections-policy',
    ],
    footnote:
      'Recall information comes from official FDA and USDA FSIS notices; every recall links to its government source.',
  },
  {
    title: 'Legal',
    slugs: ['attributions'],
  },
];
