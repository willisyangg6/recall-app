/**
 * The canonical structured content model for Lotly's trust documents (C7).
 *
 * Every consumer-facing claim about how Lotly works — sources, relevance,
 * risk vocabulary, safety limits, corrections, privacy behavior, attribution —
 * lives in ONE structured document per topic under src/content/, rendered by
 * one document screen (app/document/[slug].tsx) through one shared renderer
 * (components/document/). Screens never restate these claims in JSX, so a
 * claim can only drift in one place, and the integrity tests
 * (trust-documents.test.ts) pin the claims to the implementation they
 * describe.
 *
 * The model is deliberately renderer-agnostic plain data — paragraphs,
 * lists, notes, links, and the risk-level rows — so the same documents can
 * later be rendered on a public website without a Markdown dependency or a
 * second copy of the words. P2B6B added three typed kinds the redesign
 * needed and no untyped one: a note (rendered as the information callout),
 * a link to another registered document, and the risk-level rows (rendered
 * with the production Risk Label). A kind is added here only when a
 * document's own content asks for it; there is no table and no ordered list
 * because no document holds one.
 */

import type { ConsumerRiskTier } from '@/domain/risk-tier';
import { riskTierWord } from '@/lib/risk-display';

export type DocumentBlock =
  /** One flowing paragraph of consumer prose. */
  | { kind: 'paragraph'; text: string }
  /** A bulleted list; each item is one complete statement. */
  | { kind: 'bullets'; items: readonly string[] }
  /** An external official-source link, opened in the system browser. */
  | { kind: 'link'; label: string; url: string }
  /** A link to another registered document, by its stable slug. */
  | { kind: 'document-link'; label: string; slug: string }
  /** A limitation or boundary the reader should not miss: the information callout. */
  | { kind: 'note'; text: string }
  /** One row per consumer risk tier: the product's own label beside its meaning. */
  | { kind: 'risk-levels'; items: readonly RiskLevelItem[] };

export interface RiskLevelItem {
  tier: ConsumerRiskTier;
  /** The meaning as a complete sentence (or sentences), starting with a capital. */
  meaning: string;
}

export interface DocumentSection {
  /** Section heading; null for an unlabeled lead section. */
  title: string | null;
  blocks: readonly DocumentBlock[];
}

export interface TrustDocument {
  /** Stable route id: the screen renders /document/<slug>. Never renamed. */
  slug: string;
  /** Screen and Profile-row title. */
  title: string;
  /** One-line Profile-row description, and the document's standfirst. */
  summary: string;
  sections: readonly DocumentSection[];
}

export function paragraph(text: string): DocumentBlock {
  return { kind: 'paragraph', text };
}

export function bullets(items: readonly string[]): DocumentBlock {
  return { kind: 'bullets', items };
}

export function link(label: string, url: string): DocumentBlock {
  return { kind: 'link', label, url };
}

export function documentLink(label: string, slug: string): DocumentBlock {
  return { kind: 'document-link', label, slug };
}

export function note(text: string): DocumentBlock {
  return { kind: 'note', text };
}

export function riskLevels(items: readonly RiskLevelItem[]): DocumentBlock {
  return { kind: 'risk-levels', items };
}

/** The complete list of block kinds, for the renderer's and the tests' coverage. */
export const DOCUMENT_BLOCK_KINDS = [
  'paragraph',
  'bullets',
  'link',
  'document-link',
  'note',
  'risk-levels',
] as const satisfies readonly DocumentBlock['kind'][];

/** A risk-level row as one line of text: the canonical word, then its meaning. */
export function riskLevelText(item: RiskLevelItem): string {
  return `${riskTierWord(item.tier)}: ${item.meaning}`;
}

/**
 * Every human-readable word of a block as one string per line — the surface
 * the integrity tests assert claims (and forbidden claims) against.
 */
export function blockPlainText(block: DocumentBlock): string[] {
  switch (block.kind) {
    case 'paragraph':
    case 'note':
      return [block.text];
    case 'bullets':
      return [...block.items];
    case 'link':
      return [block.label, block.url];
    case 'document-link':
      return [block.label];
    case 'risk-levels':
      return block.items.map(riskLevelText);
  }
}

/** Every human-readable word of a document as one string. */
export function documentPlainText(doc: TrustDocument): string {
  const parts: string[] = [doc.title, doc.summary];
  for (const section of doc.sections) {
    if (section.title) parts.push(section.title);
    for (const block of section.blocks) parts.push(...blockPlainText(block));
  }
  return parts.join('\n');
}
