/**
 * Recall lineage: one real-world recall event → one RecallCase → one or more
 * authoritative source artifacts.
 *
 * FDA has no recall number, so identity is the announcement URL slug — and
 * FDA publishes revisions of one recall under NEW identities in three
 * verified ways:
 *
 *   1. Slug collision: re-publishing a revised announcement whose title
 *      slugifies identically appends a suffix ("…-health-risk" →
 *      "…-health-risk-0", verified live on Primavera Nueva).
 *   2. Declared expansion: a new announcement whose own title and body state
 *      that it EXPANDS an existing recall ("Lidl US Expands Recall of
 *      Eridanous Shortbread Cookies…", "…is expanding its July 24, 2026
 *      recall…"), published under a fresh slug. Verified live on Eridanous
 *      (Lidl), OLA-OLA Pounded Yam (Fayus), and Glutinous Rice Balls
 *      (Khong Guan).
 *   3. Retitled correction: a corrected re-publication whose TITLE changed,
 *      so the slug changed with it, opening with an FDA editorial note that
 *      declares the revision ("On 8/24/2026, the recalling firm updated
 *      their press release to correctly identify wheat, rather than gluten,
 *      as the allergen."). The old slug leaves the listing and 301-redirects
 *      to the new one. Verified live on Momchipz (Exotique Foods,
 *      gluten→wheat, 2026-08-25) and Lewis Bake Shop (Hartford Bakery).
 *
 * Read as separate identities, one real recall becomes two Home cards.
 *
 * The linkers here are deliberately conservative (a false merge is worse than
 * a temporary duplicate): neither a slug collision nor expansion nor revision
 * wording alone ever merges. The records must corroborate — same firm, same
 * hazard, a bounded publication window, and shared content: substantial body
 * overlap for a collision, product identity (overlapping UPCs or the
 * expansion title naming the parent's product) for a declared expansion, and
 * an overlapping UPC plus near-copy body overlap for a declared revision.
 * Title similarity by itself remains insufficient evidence everywhere:
 * identical titles are exactly why slugs collide, and a firm that recalls the
 * same product twice reuses its own headline. Anything below the bar founds
 * its own case and is only FLAGGED by the development duplicate-candidate
 * report, never auto-merged.
 */

import type { NormalizedSourceRecord } from '../domain/source-record';

/** Legal-suffix and punctuation-insensitive firm identity. */
export function normalizeFirmName(name: string | null): string {
  return (name ?? '')
    .toLowerCase()
    .replace(
      /\b(?:llc|l\.l\.c\.?|inc\.?|incorporated|corp\.?|corporation|ltd\.?|llp|lp|plc|co\.?|company|dba|d\/b\/a)\b/g,
      ' ',
    )
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Word-set Jaccard similarity of two texts, 0..1. */
export function bodySimilarity(a: string | null, b: string | null): number {
  const tokens = (text: string | null) =>
    new Set(
      (text ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((token) => token.length >= 3),
    );
  const setA = tokens(a);
  const setB = tokens(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const token of setA) if (setB.has(token)) shared += 1;
  return shared / (setA.size + setB.size - shared);
}

/** Update-churn title prefixes, stripped before comparing titles. */
const TITLE_NOISE = /^\s*updated?(?:\s+release)?\s*[–—:-]+\s*/i;

function normalizeTitle(title: string): string {
  return title.replace(TITLE_NOISE, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** One title extends the other ("… Health Risk" → "… Health Risk - Revised to Include …"). */
export function titlesRelate(a: string, b: string): boolean {
  const first = normalizeTitle(a);
  const second = normalizeTitle(b);
  if (first === '' || second === '') return false;
  const prefix = Math.min(first.length, second.length, 48);
  return first.slice(0, prefix) === second.slice(0, prefix);
}

const SAME_EVENT_WINDOW_DAYS = 180;
const SAME_EVENT_BODY_SIMILARITY = 0.6;

// ── Declared expansions ─────────────────────────────────────────────────────

/**
 * The announcement's own words state that it extends an existing recall.
 * Bounded to expansion vocabulary — "recalls", "updated", or a similar title
 * never qualifies, because those words also open genuinely new events.
 */
const EXPANSION_TITLE = /\bexpand(?:s|ed|ing)?\b[^.]{0,60}?\brecall|\brecall\s+expansion\b/i;
const EXPANSION_BODY =
  /\bis\s+expanding\s+its\b[^.]{0,120}?\brecall|\bexpand(?:s|ed|ing)\s+(?:its|the|this)\s+(?:\w+\s+){0,3}?recall|\brecall\s+(?:was|is\s+being)\s+(?:initiated,?\s+and\s+later\s+)?expanded\b/i;

/** True when a record's own text declares it an expansion of an existing recall. */
export function declaresExpansion(title: string, summaryText?: string | null): boolean {
  if (EXPANSION_TITLE.test(title)) return true;
  // Only the opening of the body counts: FDA expansion announcements declare
  // themselves in the first paragraph, while a passing later mention ("if the
  // recall is expanded…") is speculation, not identity.
  return EXPANSION_BODY.test((summaryText ?? '').slice(0, 600));
}

/**
 * The product phrase an expansion title names: the segment after "recall of",
 * before the reason/extension tails. "Lidl US Expands Recall of Eridanous
 * Shortbread Cookies Due to Undeclared …" → "eridanous shortbread cookies".
 * Normalized for containment tests; empty when the title has no such segment.
 */
export function expansionProductPhrase(title: string): string {
  const match = title.match(/\brecall\s+of\s+(.+)$/i);
  if (!match) return '';
  const phrase = match[1]
    .split(/\s+(?:due\s+to|because|to\s+include|for\s+possible|over)\s+/i)[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return phrase.length >= 8 ? phrase : '';
}

/** Barcode-length digit runs in a text, separator-insensitive. */
export function upcDigitsIn(text: string | null): Set<string> {
  const out = new Set<string>();
  for (const match of (text ?? '').matchAll(/\b\d[\d\s-]{9,18}\d\b/g)) {
    const digits = match[0].replace(/\D/g, '');
    if (digits.length >= 12 && digits.length <= 14) out.add(digits);
  }
  return out;
}

/** Expansion bodies restate less of the original than a re-publication does. */
const EXPANSION_BODY_SIMILARITY = 0.45;
const EXPANSION_WINDOW_DAYS = 120;

/**
 * Deterministic gate for a DECLARED-expansion pair: the child's own text
 * declares an expansion, firm and hazard match, publication dates sit within
 * a bounded window (in either order — FDA re-dates a base page when it edits
 * it, so an expansion can carry the earlier date), and the two records share
 * product identity: an overlapping barcode, or the expansion title naming the
 * parent's product, corroborated by body overlap. Title similarity alone
 * remains insufficient, exactly as for slug collisions.
 */
export function isExpansionOfSameEvent(
  child: NormalizedSourceRecord,
  parent: NormalizedSourceRecord,
): boolean {
  // FDA only: FSIS assigns authoritative recall numbers, and its expansions
  // carry the parent's number — lineage there never rests on wording. FSIS
  // bodies also share heavy agency boilerplate, which would dilute the body
  // corroboration this gate depends on.
  if (child.sourceAgency !== 'FDA' || parent.sourceAgency !== 'FDA') return false;
  if (!declaresExpansion(child.title, child.summaryText)) return false;
  const firmA = normalizeFirmName(child.firmDisplayName);
  const firmB = normalizeFirmName(parent.firmDisplayName);
  if (firmA === '' || firmB === '' || firmA !== firmB) return false;
  if (child.hazardCategory !== parent.hazardCategory) return false;
  const ageMs = Math.abs(Date.parse(child.publishedAt) - Date.parse(parent.publishedAt));
  if (!(ageMs <= EXPANSION_WINDOW_DAYS * 24 * 60 * 60 * 1000)) return false;

  const childUpcs = upcDigitsIn(child.summaryText);
  const parentUpcs = upcDigitsIn(parent.summaryText);
  const upcOverlap = [...childUpcs].some((upc) => parentUpcs.has(upc));
  const phrase = expansionProductPhrase(child.title);
  const parentTitle = parent.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const productOverlap = phrase !== '' && parentTitle.includes(phrase);
  if (!upcOverlap && !productOverlap) return false;
  return bodySimilarity(child.summaryText, parent.summaryText) >= EXPANSION_BODY_SIMILARITY;
}

// ── Declared revisions (retitled corrections) ───────────────────────────────

/**
 * FDA's editorial revision note: the body opens by declaring that this page
 * updates/replaces an earlier press release. Every live occurrence sits in
 * the first ~200 characters ("This press release was updated on…", "The
 * press release has been updated…", "…the recalling firm updated their press
 * release to…", "This press release is an update to the company's press
 * release…", "This updated press release includes…"). Bounded to "press
 * release" vocabulary: a bare "updated" also opens genuinely new events, and
 * the old page's trailing "Link to Updated Press Release" navigation link
 * sits far outside the opening window this detector reads.
 */
const REVISION_BODY =
  /\bpress\s+release\b[^.\n]{0,80}?\b(?:was|has\s+been|is\s+being)\s+(?:updated|revised|corrected)\b|\bpress\s+release\s+is\s+an\s+update\b|\b(?:updated|revised|corrected)\s+(?:their|its|the\s+company['’]s|the)\s+press\s+release\b|\bthis\s+(?:updated|revised|corrected)\s+press\s+release\b|\breplaces\s+an\s+earlier\s+(?:version|release)\b/i;

/** True when a record's body opens with an FDA editorial revision note. */
export function declaresRevision(summaryText?: string | null): boolean {
  return REVISION_BODY.test((summaryText ?? '').slice(0, 600));
}

/**
 * A revision is a re-publication, not a new document: its body is a
 * near-copy of the original's. This floor must sit decisively above the
 * slug-collision threshold (0.6), which two genuinely distinct events by the
 * same firm about similar products can reach on shared boilerplate alone.
 * Verified live: Momchipz gluten→wheat scored 0.91.
 */
const REVISION_BODY_SIMILARITY = 0.8;

/**
 * Deterministic gate for a DECLARED-revision pair: the child's body opens by
 * declaring it a revision of an earlier press release, firm and hazard match,
 * publication dates sit within the expansion window (either order — FDA
 * re-dates edited pages), the two bodies share a barcode, and the body is a
 * near-copy of the parent's. A revision title has no "recall of …" phrase to
 * name its parent's product, so the barcode requirement is absolute here —
 * a revision pair without shared UPCs stays a review candidate for a human.
 */
export function isRevisionOfSameEvent(
  child: NormalizedSourceRecord,
  parent: NormalizedSourceRecord,
): boolean {
  // FDA only, for the same reasons as declared expansions: FSIS lineage
  // rests on agency-assigned recall numbers, never on wording.
  if (child.sourceAgency !== 'FDA' || parent.sourceAgency !== 'FDA') return false;
  if (!declaresRevision(child.summaryText)) return false;
  const firmA = normalizeFirmName(child.firmDisplayName);
  const firmB = normalizeFirmName(parent.firmDisplayName);
  if (firmA === '' || firmB === '' || firmA !== firmB) return false;
  if (child.hazardCategory !== parent.hazardCategory) return false;
  const ageMs = Math.abs(Date.parse(child.publishedAt) - Date.parse(parent.publishedAt));
  if (!(ageMs <= EXPANSION_WINDOW_DAYS * 24 * 60 * 60 * 1000)) return false;

  const childUpcs = upcDigitsIn(child.summaryText);
  const parentUpcs = upcDigitsIn(parent.summaryText);
  if (![...childUpcs].some((upc) => parentUpcs.has(upc))) return false;
  return bodySimilarity(child.summaryText, parent.summaryText) >= REVISION_BODY_SIMILARITY;
}

/**
 * Deterministic same-real-world-recall gate for a slug-collision pair. Every
 * clause must hold; failing any one leaves the records as separate cases.
 *
 * Title relation is deliberately NOT sufficient evidence: an identical title
 * is exactly WHY the slug collided, and a firm that recalls the same product
 * twice (two contamination events months apart, verified live: JFE
 * Franchising cucumbers, Dec 2024 and May 2025) reuses its own headline. Only
 * substantially shared body content — the revised announcement repeating the
 * original's text — distinguishes a re-publication from a second event.
 */
export function isSameRecallEvent(
  child: NormalizedSourceRecord,
  parent: NormalizedSourceRecord,
): boolean {
  const firmA = normalizeFirmName(child.firmDisplayName);
  const firmB = normalizeFirmName(parent.firmDisplayName);
  if (firmA === '' || firmB === '' || firmA !== firmB) return false;
  if (child.hazardCategory !== parent.hazardCategory) return false;
  const ageMs = Math.abs(Date.parse(child.publishedAt) - Date.parse(parent.publishedAt));
  if (!(ageMs <= SAME_EVENT_WINDOW_DAYS * 24 * 60 * 60 * 1000)) return false;
  return bodySimilarity(child.summaryText, parent.summaryText) >= SAME_EVENT_BODY_SIMILARITY;
}

// ── Development duplicate-candidate detection (report only, never a merge) ──

export type DuplicateVerdict = 'deterministic' | 'review' | 'distinct';

export interface CaseFingerprint {
  caseId: string;
  title: string;
  firm: string | null;
  hazardCategory: string;
  publishedAt: string;
  sourceIds: string[];
  summaryText: string | null;
  /** Source agency; declared-expansion lineage applies to FDA cases only. */
  agency?: string;
}

export interface DuplicateCandidate {
  a: CaseFingerprint;
  b: CaseFingerprint;
  verdict: DuplicateVerdict;
  signals: string[];
}

/** A slug-collision relation between any pair of the two cases' source ids. */
function slugCollision(a: CaseFingerprint, b: CaseFingerprint): boolean {
  return a.sourceIds.some((idA) =>
    b.sourceIds.some(
      (idB) =>
        idB === `${idA}-0` ||
        idA === `${idB}-0` ||
        /^(.{20,})-\d$/.exec(idB)?.[1] === idA ||
        /^(.{20,})-\d$/.exec(idA)?.[1] === idB,
    ),
  );
}

/**
 * Classify potentially-duplicate case pairs across one agency's cases.
 * Same-firm pairs only — a firm mismatch is already `distinct`. Output feeds
 * the development QA report; nothing here merges anything.
 */
export function findDuplicateCandidates(cases: CaseFingerprint[]): DuplicateCandidate[] {
  const byFirm = new Map<string, CaseFingerprint[]>();
  for (const item of cases) {
    const firm = normalizeFirmName(item.firm);
    if (firm === '') continue;
    byFirm.set(firm, [...(byFirm.get(firm) ?? []), item]);
  }
  const out: DuplicateCandidate[] = [];
  for (const group of byFirm.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        const signals: string[] = ['same-firm'];
        if (slugCollision(a, b)) signals.push('slug-collision');
        if (a.hazardCategory === b.hazardCategory) signals.push('same-hazard');
        if (titlesRelate(a.title, b.title)) signals.push('title-prefix');
        const similarity = bodySimilarity(a.summaryText, b.summaryText);
        if (similarity >= SAME_EVENT_BODY_SIMILARITY) {
          signals.push(`body-similarity-${similarity.toFixed(2)}`);
        }
        const daysApart =
          Math.abs(Date.parse(a.publishedAt) - Date.parse(b.publishedAt)) / 86_400_000;
        if (daysApart <= SAME_EVENT_WINDOW_DAYS) signals.push('close-dates');

        // Declared lineage: one case's own announcement says it expands a
        // recall, or opens with FDA's editorial revision note, and the pair
        // shares product identity. FDA only — FSIS lineage rests on
        // authoritative recall numbers, never wording.
        const fdaPair = a.agency !== 'FSIS' && b.agency !== 'FSIS';
        const upcsA = upcDigitsIn(a.summaryText);
        const upcsB = upcDigitsIn(b.summaryText);
        const upcOverlap = [...upcsA].some((upc) => upcsB.has(upc));
        const expansionChild = fdaPair
          ? [a, b].find((item) => declaresExpansion(item.title, item.summaryText))
          : undefined;
        const expansionParent = expansionChild === a ? b : a;
        if (expansionChild) {
          signals.push('expansion-language');
          if (upcOverlap) signals.push('upc-overlap');
          const phrase = expansionProductPhrase(expansionChild.title);
          if (
            phrase !== '' &&
            expansionParent.title
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, ' ')
              .includes(phrase)
          ) {
            signals.push('product-overlap');
          }
          if (similarity >= EXPANSION_BODY_SIMILARITY) {
            signals.push(`expansion-body-${similarity.toFixed(2)}`);
          }
        }
        const revisionChild = fdaPair
          ? [a, b].find((item) => declaresRevision(item.summaryText))
          : undefined;
        if (revisionChild) {
          signals.push('revision-language');
          if (upcOverlap && !signals.includes('upc-overlap')) signals.push('upc-overlap');
          if (similarity >= REVISION_BODY_SIMILARITY) {
            signals.push(`revision-body-${similarity.toFixed(2)}`);
          }
        }

        // Body similarity is required — a title prefix is vacuous for a
        // slug collision, because an identical title is why slugs collide.
        // A declared expansion additionally needs product identity: another
        // recall by the same firm is not an expansion just for being nearby.
        // A declared revision needs both a shared barcode and a near-copy
        // body: a revision is a re-publication, and 0.6-level similarity is
        // reachable by two distinct events sharing firm boilerplate.
        const expansionDaysApart = daysApart <= EXPANSION_WINDOW_DAYS;
        const deterministic =
          (signals.includes('slug-collision') &&
            signals.includes('same-hazard') &&
            signals.includes('close-dates') &&
            signals.some((s) => s.startsWith('body-similarity'))) ||
          (signals.includes('expansion-language') &&
            signals.includes('same-hazard') &&
            expansionDaysApart &&
            (signals.includes('upc-overlap') || signals.includes('product-overlap')) &&
            signals.some((s) => s.startsWith('expansion-body'))) ||
          (signals.includes('revision-language') &&
            signals.includes('same-hazard') &&
            expansionDaysApart &&
            signals.includes('upc-overlap') &&
            signals.some((s) => s.startsWith('revision-body')));
        // Review = an identity signal without content corroboration (a
        // possible second distinct event behind one title), or near-identical
        // titles AND bodies without the identity signal. Same-firm pairs with
        // merely similar boilerplate stay distinct — FSIS bodies share
        // agency boilerplate, and FSIS recall numbers are authoritative.
        const review =
          !deterministic &&
          signals.includes('same-hazard') &&
          signals.includes('close-dates') &&
          (signals.includes('slug-collision') ||
            (signals.includes('expansion-language') &&
              (signals.includes('product-overlap') || signals.includes('upc-overlap'))) ||
            (signals.includes('revision-language') && signals.includes('upc-overlap')) ||
            (signals.includes('title-prefix') &&
              signals.some((s) => s.startsWith('body-similarity'))));
        const verdict: DuplicateVerdict = deterministic
          ? 'deterministic'
          : review
            ? 'review'
            : 'distinct';
        if (verdict !== 'distinct') out.push({ a, b, verdict, signals });
      }
    }
  }
  return out;
}
