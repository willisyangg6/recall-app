/**
 * The canonical structured content model for Recall's trust documents (C7).
 *
 * Every consumer-facing claim about how Recall works — sources, relevance,
 * risk vocabulary, safety limits, corrections, privacy behavior, attribution —
 * lives in ONE structured document per topic under src/content/, rendered by
 * one document screen (app/document/[slug].tsx). Screens never restate these
 * claims in JSX, so a claim can only drift in one place, and the integrity
 * tests (trust-documents.test.ts) pin the claims to the implementation they
 * describe.
 *
 * The model is deliberately renderer-agnostic plain data — paragraphs,
 * bullets, and links — so the same documents can later be rendered on a
 * public website without a Markdown dependency or a second copy of the words.
 */

export type DocumentBlock =
  /** One flowing paragraph of consumer prose. */
  | { kind: 'paragraph'; text: string }
  /** A bulleted list; each item is one complete statement. */
  | { kind: 'bullets'; items: readonly string[] }
  /** An external official-source link, opened in the system browser. */
  | { kind: 'link'; label: string; url: string };

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
  /** One-line Profile-row description. */
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

/**
 * Every human-readable word of a document as one string — the surface the
 * integrity tests assert claims (and forbidden claims) against.
 */
export function documentPlainText(doc: TrustDocument): string {
  const parts: string[] = [doc.title, doc.summary];
  for (const section of doc.sections) {
    if (section.title) parts.push(section.title);
    for (const block of section.blocks) {
      if (block.kind === 'paragraph') parts.push(block.text);
      else if (block.kind === 'bullets') parts.push(...block.items);
      else parts.push(block.label, block.url);
    }
  }
  return parts.join('\n');
}
