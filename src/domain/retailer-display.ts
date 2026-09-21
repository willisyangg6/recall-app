/**
 * The display gate for stored retailer evidence (P2B7O).
 *
 * `projection.retailerNames` is the hardened, verb-gated sold-at evidence
 * (domain/retailer-evidence.ts). It is trustworthy enough to name a store to
 * a shopper — but "trustworthy enough to persist and match on" and
 * "trustworthy enough to print under the word RETAILER" are not the same
 * bar, and the corpus proves it: a live census of the 151 distinct stored
 * strings on consumer-visible active cases found exactly one that names no
 * store at all — `"Roseville and Sacr"`, two truncated California city names
 * that reached the field because the extractor's geography check tested the
 * WHOLE string and neither half is the whole string.
 *
 * This module is the one place that decides whether a stored string may be
 * WORDED as a retailer. It is deliberately the same rule the extractor
 * already applies, read per segment instead of per string: one entity has
 * one role, and anything the country knows as a place is barred from being
 * somewhere you shopped.
 *
 * One consumer surface reads it — Detail's "Where It Was Sold" — because
 * that is the only place in the app that names a retailer at all. Feed and
 * Saved show none, and search matches retailer evidence without ever telling
 * the reader that it did.
 *
 * What it is NOT: a catalog membership test. A store the canonical retailer
 * catalog has never heard of is still a real store the notice named — 70 of
 * the 151 stored strings resolve to no catalog chain and every one of them
 * is a genuine local grocer. Rejecting those would delete true information
 * to satisfy a list. This gate rejects places, and nothing else.
 *
 * Nothing here mutates stored data. A rejected string stays in the
 * projection, stays SEARCHABLE, and still admits its case to the results —
 * it simply never gets printed as a store. Suppressing a name from Detail
 * must never remove a recall from a search, and does not.
 */

import { isUsCityName, normalizeStateToken } from './us-geography';

/**
 * The seams a source writes a list of names on. A stored entry is sometimes
 * a run the extractor kept whole ("Kroger and King Soopers", "Costco and
 * Sam's Club" — 12 of the 151), which is the source's own wording and stays
 * exactly as written; splitting here is for INSPECTION only, so a place
 * hiding on one side of a conjunction cannot ride in on the other's back.
 */
function segmentsOf(name: string): string[] {
  return name
    .split(/\s*,\s*|\s+and\s+|\s*&\s*/i)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '');
}

/**
 * May this stored retailer string be presented to a shopper as a retailer?
 *
 * False when any segment of it is a US state or a US city — the same
 * "one entity has one role" rule `evaluateRetailerEvidence` applies to the
 * whole string, applied to each name in the run. Measured over the live
 * corpus: 150 of 151 distinct stored strings pass, 1 is rejected, and
 * exactly 1 of the 171 retailer-bearing cases is left with no nameable
 * store (which is the correct answer for that case — it has no trustworthy
 * retailer evidence, only two city names).
 */
export function isDisplayableRetailerName(name: string): boolean {
  const segments = segmentsOf(name);
  if (segments.length === 0) return false;
  return !segments.some(
    (segment) => normalizeStateToken(segment) !== null || isUsCityName(segment),
  );
}

/** The nameable subset of a case's stored retailer evidence, order preserved. */
export function displayableRetailerNames(names: readonly string[]): string[] {
  return names.filter(isDisplayableRetailerName);
}
