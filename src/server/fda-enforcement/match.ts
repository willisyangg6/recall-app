/**
 * FDA announcement ↔ FDA enforcement reconciliation.
 *
 * PRECISION FIRST: a wrong Class I/II/III on a recall is materially worse
 * than "Not yet assigned" persisting. Every rule here was derived from a
 * measured corpus overlap (701 live cases × 29,317 enforcement records,
 * 2026-08-25), not guessed:
 *
 * - Firm identity + UPC overlap is NOT sufficient alone: staple products
 *   keep their UPC across distinct recalls years apart (measured: Gold Medal
 *   flour recalled 2016 AND 2023 with identical UPCs; Jack and the Green
 *   Sprouts alfalfa 9 years apart; deltas 759–3,471 days). The DATE WINDOW
 *   is load-bearing.
 * - The window comes from UPC-confirmed pairs: announcement publishes
 *   between ~15 days before and ~44 days after recall initiation
 *   (p5=−15, p95=+44). The window here is deliberately wider (−45…+90) to
 *   catch stragglers while still excluding every measured recurring-product
 *   false friend (nearest at +229 days) and re-recall pairs like JFE
 *   cucumbers (~150 days apart).
 * - Title similarity ALONE is insufficient even at 100%: "Spicy Breakfast
 *   Burrito" matched a same-firm event 229 days away with share 1.00.
 *   Product-name evidence only disambiguates WITHIN the window.
 * - One case may legitimately match SEVERAL enforcement events (measured:
 *   Total Nutrition's expanded recall spans events 99317+99072). Never
 *   forced one-to-one.
 * - Out-of-window same-firm negatives score share p75=0.13; in-window true
 *   matches median 0.50. The 0.6 accept / 0.4 conflict thresholds sit in
 *   the measured gap; the labeled benchmark pins them.
 *
 * All matching representations are internal. Nothing here rewrites consumer
 * data — the only consumer-visible outcome of a match is the official FDA
 * classification flowing through the projection.
 */

import { normalizeFirmName, upcDigitsIn } from '../duplicates';
import type { EnforcementRecord } from './parse';

/** The matcher's view of one consumer RecallCase (announcement side). */
export interface AnnouncementFacts {
  caseId: string;
  /** Every notice record's own publish date — expansions anchor their own window. */
  publishedDates: string[];
  /** Display firm plus raw variants, un-normalized. */
  firmNames: string[];
  /** Title(s) — the product-naming line(s). */
  titleText: string;
  /** Brand names + affected-product names, source-stated. */
  productText: string;
  /** Combined announcement bodies (deduped by the caller). */
  bodyText: string;
}

export type MatchMethod = 'code-identity' | 'name-identity';

export interface EventEvidence {
  eventId: string;
  records: EnforcementRecord[];
  /** UPC digit runs stated on both sides. */
  sharedUpcs: string[];
  /**
   * Product-name agreement, the better of two directions: how much of the
   * announcement's product vocabulary the event covers (title-named
   * products), and how much of the event's product-description vocabulary
   * the FULL announcement text covers (multi-product recalls name products
   * in the body, not the title — measured on Tovala, Kick Ash, Flagstone).
   */
  productShare: number;
  sharedTokens: string[];
  /** publishedAt − recall_initiation, days; the smallest across notice dates. */
  windowDeltaDays: number | null;
  inWindow: boolean;
}

export interface AcceptedMatch {
  eventId: string;
  method: MatchMethod;
  records: EnforcementRecord[];
  /** Human-readable evidence lines — the audit answer to "why Class X?". */
  evidence: string[];
}

export type CaseMatchState = 'unmatched' | 'candidate' | 'matched_deterministic' | 'ambiguous';

export interface CaseMatchResult {
  caseId: string;
  state: CaseMatchState;
  accepted: AcceptedMatch[];
  /** Name-qualified events that conflict — preserved, never forced. */
  ambiguous: EventEvidence[];
  /** In-window same-firm events that did not qualify. */
  candidates: EventEvidence[];
}

/** Matcher revision recorded with every accepted match (bump on rule change). */
export const MATCHER_VERSION = 'fda-enforcement-match/1';

/** publishedAt − recall_initiation must sit in [−45 … +90] days. */
const WINDOW_MIN_DELTA_DAYS = -45;
const WINDOW_MAX_DELTA_DAYS = 90;
/** Accept threshold for name identity (measured gap: negatives p75=0.13). */
const NAME_ACCEPT_SHARE = 0.6;
/** A second event at this share makes name evidence ambiguous, not decisive. */
const NAME_CONFLICT_SHARE = 0.4;

/** Vocabulary that names no product — shared by every recall text. */
const STOP_TOKENS = new Set(
  (
    'recall recalls recalled recalling issues issued issue voluntary voluntarily alert allergy ' +
    'allergen undeclared because possible potential health risk due contamination contaminated ' +
    'company brand brands products product packaged package packaging plastic glass bottle bag ' +
    'box container jar pouch ounce ounces pound pounds gram grams count pack packs case cases ' +
    'labeled label labels frozen fresh organic natural style select premium original classic ' +
    'food foods inc llc corp corporation ltd company distributed sold with without'
  ).split(/\s+/),
);

/** Distinctive lowercase word tokens (≥4 chars, not recall boilerplate). */
export function productTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length >= 4 && !STOP_TOKENS.has(token)),
  );
}

const enforcementText = (record: EnforcementRecord) =>
  `${record.productDescription}\n${record.codeInfo ?? ''}`;

function daysBetween(aIso: string, bIso: string): number {
  return Math.round((Date.parse(aIso) - Date.parse(bIso)) / 86_400_000);
}

/** Smallest publish−initiation delta across the case's notice dates. */
function windowDelta(facts: AnnouncementFacts, initiationIso: string | null): number | null {
  if (initiationIso === null) return null;
  let best: number | null = null;
  for (const published of facts.publishedDates) {
    const delta = daysBetween(published, initiationIso);
    if (best === null || Math.abs(delta) < Math.abs(best)) best = delta;
  }
  return best;
}

/** Evidence for one candidate EVENT (its records considered together). */
function evaluateEvent(
  facts: AnnouncementFacts,
  eventId: string,
  records: EnforcementRecord[],
): EventEvidence {
  const caseUpcs = upcDigitsIn(`${facts.bodyText}\n${facts.titleText}\n${facts.productText}`);
  const sharedUpcs = new Set<string>();
  for (const record of records) {
    for (const upc of upcDigitsIn(enforcementText(record))) {
      if (caseUpcs.has(upc)) sharedUpcs.add(upc);
    }
  }

  // Product-name evidence, both directions, best across the event's records.
  const firmTokens = productTokens(facts.firmNames.join(' '));
  const caseTokens = [...productTokens(`${facts.titleText}\n${facts.productText}`)].filter(
    (token) => !firmTokens.has(token),
  );
  const fullAnnouncementTokens = productTokens(
    `${facts.titleText}\n${facts.productText}\n${facts.bodyText}`,
  );
  let bestShare = 0;
  let bestShared: string[] = [];
  for (const record of records) {
    // An ingredient list is recipe contents, not product identity — it
    // dilutes coverage (measured: Wegmans Pecan Blend's description is 80%
    // ingredients). Identity vocabulary ends where the ingredients begin.
    const identityText = record.productDescription.split(/\bingredients?\s*:/i)[0];
    const recordTokens = [...productTokens(identityText)].filter((token) => !firmTokens.has(token));
    const recordTokenSet = new Set(recordTokens);
    const forwardShared = caseTokens.filter((token) => recordTokenSet.has(token));
    const forward = caseTokens.length > 0 ? forwardShared.length / caseTokens.length : 0;
    // Inverse coverage needs ≥2 distinctive event tokens: a one-word
    // description can never qualify by name.
    const inverseShared = recordTokens.filter((token) => fullAnnouncementTokens.has(token));
    const inverse = recordTokens.length >= 2 ? inverseShared.length / recordTokens.length : 0;
    const share = Math.max(forward, inverse);
    if (share > bestShare) {
      bestShare = share;
      bestShared = forward >= inverse ? forwardShared : inverseShared;
    }
  }

  const delta = windowDelta(facts, records[0]?.recallInitiationDate ?? null);
  return {
    eventId,
    records,
    sharedUpcs: [...sharedUpcs].sort(),
    productShare: bestShare,
    sharedTokens: bestShared,
    windowDeltaDays: delta,
    inWindow: delta !== null && delta >= WINDOW_MIN_DELTA_DAYS && delta <= WINDOW_MAX_DELTA_DAYS,
  };
}

function acceptEvidence(evidence: EventEvidence, method: MatchMethod): string[] {
  const lines = [
    'same normalized recalling firm',
    `recall initiated ${Math.abs(evidence.windowDeltaDays!)} day(s) ${
      evidence.windowDeltaDays! >= 0 ? 'before' : 'after'
    } the announcement`,
  ];
  if (method === 'code-identity') {
    lines.push(`exact UPC overlap: ${evidence.sharedUpcs.join(', ')}`);
    if (evidence.productShare > 0) {
      lines.push(`product-name agreement ${evidence.productShare.toFixed(2)}`);
    }
  } else {
    lines.push(
      `distinctive product-name agreement ${evidence.productShare.toFixed(2)} (${evidence.sharedTokens
        .slice(0, 6)
        .join(' ')})`,
    );
    lines.push('sole qualifying enforcement event for this firm and window');
  }
  return lines;
}

/**
 * Reconcile one case against one firm-and-window candidate pool.
 *
 * The caller does the cheap blocking (normalized-firm equality); this
 * function applies the window and the evidence rules, per EVENT:
 *
 * - code identity: any shared UPC accepts the event outright — several
 *   events may each accept this way (multi-event expansions are real).
 * - name identity: share ≥ 0.6 accepts ONLY when no other in-window event
 *   reaches the 0.4 conflict line — otherwise every name-qualified event is
 *   preserved as ambiguous rather than guessed between.
 */
export function matchCase(
  facts: AnnouncementFacts,
  candidateRecords: EnforcementRecord[],
): CaseMatchResult {
  const byEvent = new Map<string, EnforcementRecord[]>();
  for (const record of candidateRecords) {
    byEvent.set(record.eventId, [...(byEvent.get(record.eventId) ?? []), record]);
  }

  const inWindow: EventEvidence[] = [];
  for (const [eventId, records] of byEvent) {
    const evidence = evaluateEvent(facts, eventId, records);
    if (evidence.inWindow) inWindow.push(evidence);
  }

  const accepted: AcceptedMatch[] = [];
  const remaining: EventEvidence[] = [];
  for (const evidence of inWindow) {
    if (evidence.sharedUpcs.length > 0) {
      accepted.push({
        eventId: evidence.eventId,
        method: 'code-identity',
        records: evidence.records,
        evidence: acceptEvidence(evidence, 'code-identity'),
      });
    } else {
      remaining.push(evidence);
    }
  }

  const nameQualified = remaining.filter((e) => e.productShare >= NAME_ACCEPT_SHARE);
  const nameConflicting = remaining.filter((e) => e.productShare >= NAME_CONFLICT_SHARE);
  let ambiguous: EventEvidence[] = [];
  if (nameQualified.length === 1 && nameConflicting.length === 1) {
    accepted.push({
      eventId: nameQualified[0].eventId,
      method: 'name-identity',
      records: nameQualified[0].records,
      evidence: acceptEvidence(nameQualified[0], 'name-identity'),
    });
  } else if (nameQualified.length >= 1) {
    // Name evidence exists but does not single out one event — preserve the
    // ambiguity for a human instead of picking the higher share.
    ambiguous = nameConflicting;
  }

  const acceptedIds = new Set(accepted.map((a) => a.eventId));
  const ambiguousIds = new Set(ambiguous.map((a) => a.eventId));
  const candidates = inWindow.filter(
    (e) => !acceptedIds.has(e.eventId) && !ambiguousIds.has(e.eventId),
  );

  return {
    caseId: facts.caseId,
    state:
      accepted.length > 0
        ? 'matched_deterministic'
        : ambiguous.length > 0
          ? 'ambiguous'
          : inWindow.length > 0
            ? 'candidate'
            : 'unmatched',
    accepted,
    ambiguous,
    candidates,
  };
}

/**
 * Build the matcher's view of a live case from its projection and its
 * NOTICE records. Combined evidence across every announcement version
 * (expansions/corrections) — token sets dedupe, so restated facts are never
 * double-counted, and each notice date anchors its own window.
 */
export function announcementFactsFor(
  caseId: string,
  projection: {
    title: string;
    recallingFirm: { displayName: string | null; rawVariants: string[] };
    brands: string[];
    affectedProducts: { name: string }[];
    publishedAt: string;
  },
  noticeRecords: {
    title: string;
    summaryText: string;
    publishedAt: string;
    firmDisplayName: string | null;
  }[],
): AnnouncementFacts {
  const titles = [projection.title, ...noticeRecords.map((r) => r.title)];
  const bodies = [...new Set(noticeRecords.map((r) => r.summaryText))];
  return {
    caseId,
    publishedDates: [
      ...new Set([projection.publishedAt, ...noticeRecords.map((r) => r.publishedAt)]),
    ],
    firmNames: [
      ...new Set(
        [
          projection.recallingFirm.displayName,
          ...projection.recallingFirm.rawVariants,
          ...noticeRecords.map((r) => r.firmDisplayName),
        ].filter((name): name is string => !!name),
      ),
    ],
    titleText: [...new Set(titles)].join('\n'),
    productText: [
      ...projection.brands,
      ...projection.affectedProducts.map((product) => product.name),
    ].join('\n'),
    bodyText: bodies.join('\n'),
  };
}

/**
 * Firm blocking key: normalized firm tokens with connective words dropped
 * and plurals trimmed. Measured drift between announcement and enforcement
 * firm strings that exact normalized equality misses:
 *   "Danone U.S."   vs "DANONE US LLC"                  → single-letter runs
 *   "Jeni's … Ice Cream" vs "Jenis … Ice Creams LLC"    → apostrophes/plural
 *   "Kroger"        vs "The Kroger Co"                  → leading "The"
 *   "Jacks and the Green Sprouts" vs "Jack & The Green Sprouts, Inc." → "&"
 */
export function firmBlockingTokens(name: string): string[] {
  return normalizeFirmName(name)
    .split(' ')
    .filter((token) => token !== '' && token !== 'the' && token !== 'and')
    .map((token) => token.replace(/s$/, ''))
    .filter((token) => token !== '');
}

export interface FirmIndex {
  exact: Map<string, EnforcementRecord[]>;
  entries: { tokens: string[]; records: EnforcementRecord[] }[];
}

/** Index an enforcement corpus for blocking. */
export function indexByNormalizedFirm(records: EnforcementRecord[]): FirmIndex {
  const exact = new Map<string, EnforcementRecord[]>();
  for (const record of records) {
    const key = firmBlockingTokens(record.recallingFirm).join(' ');
    if (key === '') continue;
    exact.set(key, [...(exact.get(key) ?? []), record]);
  }
  return {
    exact,
    entries: [...exact.entries()].map(([key, recs]) => ({
      tokens: key.split(' '),
      records: recs,
    })),
  };
}

const isTokenPrefix = (shorter: string[], longer: string[]) =>
  shorter.length > 0 &&
  shorter.length <= longer.length &&
  shorter.every((token, index) => longer[index] === token);

/**
 * Cheap, interpretable blocking: same cleaned firm key, or one key a
 * token-prefix of the other — enforcement firm strings append facility
 * detail ("Meijer, Inc #816 - Grand River Packaging…") that equality
 * misses. Blocking only ADMITS candidates; the window and the evidence
 * gates still decide, so a generous block cannot create a false match by
 * itself.
 */
export function blockByFirm(
  facts: Pick<AnnouncementFacts, 'firmNames'>,
  index: FirmIndex,
): EnforcementRecord[] {
  const seen = new Set<EnforcementRecord>();
  const out: EnforcementRecord[] = [];
  const firmTokenLists = facts.firmNames
    .map(firmBlockingTokens)
    .filter((tokens) => tokens.length > 0);
  for (const tokens of firmTokenLists) {
    for (const entry of index.entries) {
      if (isTokenPrefix(tokens, entry.tokens) || isTokenPrefix(entry.tokens, tokens)) {
        for (const record of entry.records) {
          if (!seen.has(record)) {
            seen.add(record);
            out.push(record);
          }
        }
      }
    }
  }
  return out;
}
