/**
 * The canonical retailer evidence persisted on a case (Phase C3.1).
 *
 * `projection.retailerNames` means exactly one thing:
 *
 *   The authoritative source stated, in a high-confidence sold-at /
 *   shipped-to / distributed-to construction, that the product was associated
 *   with this retailer.
 *
 * That is a narrower claim than the detail screen's "Where it was sold"
 * section makes, and deliberately so. The display layer also reads source
 * TABLES and block store lists, which a live census showed carry product
 * rows, barcodes, package weights, store street addresses, and column
 * headings alongside genuine store names. Display can present an uncertain
 * string beside the official source link; a persisted field cannot, because
 * this is the field personalization and push eligibility match on, and a
 * false "Sold at Costco" is worse than no retailer at all.
 *
 * So only the verb-gated sentence seam (domain/retailer.ts) feeds this field.
 * It measured 254 of the 283 retailer-bearing cases and 150 of the 162
 * catalog-matchable ones — ~93% of the personalization value for none of the
 * table/list contamination.
 *
 * Derivation is a pure function of text already persisted with the case, so
 * it needs no network, it is identical for FDA and FSIS (no per-adapter
 * retailer systems), and re-running it on unchanged input always produces the
 * same answer — which is what lets `projectCase` own it and makes a
 * historical repair self-healing rather than something a later re-projection
 * would silently erase.
 */

import type { Geography } from './recall-types';
import { extractRetailerNames, isRetailerName } from './retailer';
import { isUsCityName, normalizeStateToken } from './us-geography';

export interface RetailerEvidenceSource {
  title: string;
  summaryText: string;
  /**
   * Retailer names the case already carries — unioned from its source records
   * during projection, or read back from a stored projection during a repair.
   */
  carried: readonly string[];
  geography: Geography;
}

export interface RetailerEvidence {
  /** The canonical names, source order preserved, first spelling wins. */
  names: string[];
  /**
   * Carried names the hardened contract rejects. A full re-projection simply
   * drops these; a historical repair reports them instead of overwriting,
   * because silently deleting stored evidence is not a repair.
   */
  rejectedCarried: string[];
}

/**
 * One entity has one role. Anything the case types as geography is barred
 * from being a retailer even if it survived the name gate — the notice's own
 * state list is the most authoritative statement available that a token is a
 * place.
 */
function isGeography(name: string, geography: Geography): boolean {
  if (normalizeStateToken(name) !== null) return true;
  if (isUsCityName(name)) return true;
  const key = name.trim().toLowerCase();
  return geography.states.some((state) => state.toLowerCase() === key);
}

/** Comparison form for containment: letters and digits only. */
function dedupeKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * One store named once, in its fullest form. A notice refers to the same
 * chain several ways on one page — "Costco" and "Costco Wholesale", "Roche
 * Bros" and "Roche Bros. Supermarkets" — and persisting both makes one
 * distribution route read as two. The longer name wins because it is the more
 * complete answer to "where was this sold"; the source's own ordering is then
 * restored so the field still reads as the notice wrote it.
 */
function keepFullestForm(names: string[]): string[] {
  const kept: string[] = [];
  for (const name of [...names].sort((a, b) => dedupeKey(b).length - dedupeKey(a).length)) {
    const key = dedupeKey(name);
    if (key === '' || kept.some((existing) => dedupeKey(existing).includes(key))) continue;
    kept.push(name);
  }
  return names.filter((name) => kept.includes(name));
}

/**
 * The canonical retailer evidence for one case, with the carried names that
 * failed the contract reported separately.
 */
export function evaluateRetailerEvidence(source: RetailerEvidenceSource): RetailerEvidence {
  const stated = extractRetailerNames(`${source.title}\n${source.summaryText}`);
  const accept = (name: string): boolean =>
    isRetailerName(name) && !isGeography(name, source.geography);

  const names: string[] = [];
  const seen = new Set<string>();
  // Carried names lead so an established spelling keeps its place; freshly
  // stated ones append. Both go through the same gate — being already stored
  // is not evidence of being right.
  for (const name of [...source.carried, ...stated]) {
    const cleaned = name.trim();
    const key = cleaned.toLowerCase();
    if (cleaned === '' || seen.has(key) || !accept(cleaned)) continue;
    seen.add(key);
    names.push(cleaned);
  }

  const fullest = keepFullestForm(names);
  // A carried name is "kept" if it survived in any form — a shorter spelling
  // absorbed into its own fuller one is preserved, not lost.
  const keptKeys = new Set(fullest.map(dedupeKey));
  const rejectedCarried = source.carried
    .map((name) => name.trim())
    .filter(
      (name) =>
        name !== '' &&
        ![...keptKeys].some((key) => key.includes(dedupeKey(name)) && dedupeKey(name) !== ''),
    );

  return { names: fullest, rejectedCarried };
}

/** The canonical retailer names for one case. */
export function deriveRetailerNames(source: RetailerEvidenceSource): string[] {
  return evaluateRetailerEvidence(source).names;
}
