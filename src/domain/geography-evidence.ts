/**
 * The canonical geography persisted on a case (Phase C5.2A).
 *
 * `projection.geography` means exactly one thing:
 *
 *   The authoritative source stated, in a distribution construction, that the
 *   recalled product went to these places.
 *
 * Before this module, geography was written once by whichever source adapter
 * happened to parse the record first (FDA prose, FSIS `field_states`) and then
 * frozen: incremental ingestion re-projects a case only when its source page's
 * content hash moves, so a parser improvement never reached a stored case. The
 * detail screen quietly compensated with its own display-time supplement,
 * which meant the field the FEED CARD, personalization, Affects Me ranking and
 * push eligibility all read could say "Distribution not specified" about a
 * notice whose own words say Seattle and Tacoma, WA.
 *
 * So geography follows `retailerNames` (domain/retailer-evidence.ts): the
 * case's own evidence is authoritative, re-derived by `projectCase` from text
 * already persisted with the case. One derivation, no network, identical for
 * FDA and FSIS, and self-healing — a repair writes exactly what a full
 * re-projection would have produced, and the next re-projection recomputes it
 * rather than erasing it.
 *
 * Three kinds of evidence are read, all of them explicit:
 *
 *   prose   distribution sentences ("…were sold at grocery stores … within
 *           the Seattle and Tacoma Metro areas in WA")
 *   list    a declared geography list under a distribution lead-in
 *   table   a table column whose HEADER assigns it a state role
 *           ("State/Retailer", "US Distribution States", "States")
 *
 * And these are never geography, however many place names they contain: the
 * recalling firm's own address, a headquarters, a manufacturing facility, a
 * contact block, a store-address table, a retailer's known footprint, or a
 * bare city with no state the source attached to it. Unknown is an honest
 * answer; a false "this reached your state" is not, and neither is a state
 * list missing one of its states — that turns "not sure" into "does not
 * affect you", which is the same harm pointing the other way.
 */

import type { Geography } from './recall-types';
import { CONSUMER_ACTION_PATTERN, splitSentences, stripHtml } from './text';
import { isContainedStateArtifact, normalizeStateToken, statesInText } from './us-geography';

// ── Prose gates ─────────────────────────────────────────────────────────────

/** A clause that talks about where recalled product went. */
const DISTRIBUTION_SENTENCE =
  /\bdistribut\w+|\bsold\b|\bshipped\b|\bavailable (?:in|at|through)\b|\bnationwide\b/i;

/**
 * Sentences that describe the FIRM, not where product went. "Metro Produce
 * Distributors Inc. of Minneapolis, Minnesota, is voluntarily recalling…"
 * satisfies the distribution gate on the word "Distributors" alone and then
 * hands over the company's own address as if it were a destination. Same
 * wording the display layer has excluded since C2 (lib/consumer-projection).
 */
const FIRM_LOCATION_SENTENCE =
  /\b(?:is|are|has|have)\s+(?:voluntarily\s+)?recalling\b|\bof\s+[A-Z][A-Za-z.\- ]+,\s*[A-Z][A-Za-z.]+\s+is\b|\bheadquarter/i;

/** Where a product sits inside a store — merchandising, not distribution. */
const MERCHANDISING =
  /\b(?:frozen|refrigerated|dairy|deli|produce|bakery|meat|freezer|cooler|chilled)\s+(?:section|case|aisle|department|counter|display)\b|\baisle\s+\d/i;

/** Phone numbers, emails and "call/contact" lines: never distribution. */
const CONTACT_LINE = /\bcall\b|\bcontact\b|\bquestions\b|@|\b\d{3}-\d{3}-\d{4}\b/i;

const NATIONWIDE =
  /\bnationwide\b|\bnationally\b|\bacross the (?:country|united states)\b|\ball 50 states\b/i;

/** The sentences of a notice that genuinely state where product went. */
export function distributionSentences(text: string): string[] {
  return splitSentences(text).filter(
    (sentence) =>
      DISTRIBUTION_SENTENCE.test(sentence) &&
      !FIRM_LOCATION_SENTENCE.test(sentence) &&
      !CONSUMER_ACTION_PATTERN.test(sentence) &&
      !MERCHANDISING.test(sentence) &&
      !CONTACT_LINE.test(sentence),
  );
}

// ── Distribution tables ─────────────────────────────────────────────────────

/**
 * A column header that assigns its column a state role: "States",
 * "State/Retailer", "US Distribution States", "Distributed to States",
 * "Select Stores in These Affected States".
 */
const STATE_HEADER = /\bstates?\b/i;

/**
 * A column header that names distribution without naming states
 * ("DISTRIBUTION"). Accepted only when the column's entire content is state
 * tokens — a live "Distributed to" column holds Walmart, UNFI and Sprouts, and
 * reading those as places is exactly the retailer-footprint inference this
 * module refuses to make.
 */
const DISTRIBUTION_HEADER = /\bdistribut\w+/i;

/**
 * A table of store ADDRESSES. Its "State" column is the state each shop sits
 * in, which is a street address, not a distribution statement — the same
 * evidence class as the recalling firm's letterhead. One live example (Big Y,
 * 30 rows of Address/City/State/Zip) is enough to make the rule explicit.
 */
const ADDRESS_TABLE_HEADER = /\baddress(?:es)?\b|\bzip\b|\bpostal code\b|\bstreet\b/i;

interface Cell {
  /** The cell's text with its own source line breaks preserved. */
  lines: string[];
  isHeader: boolean;
}

function cellsOf(rowHtml: string): Cell[] {
  const cells: Cell[] = [];
  for (const match of rowHtml.matchAll(/<t([dh])[^>]*>([\s\S]*?)<\/t\1>/gi)) {
    // stripHtml turns <br> and </p> into newlines: inside one cell those are
    // the source's own row separators, and flattening them is what produced
    // "Food Lion-NC Kroger-VA WVA" as a single retailer name.
    cells.push({
      lines: stripHtml(match[2])
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter((line) => line !== ''),
      isHeader: match[1].toLowerCase() === 'h',
    });
  }
  return cells;
}

/** Every state token a single table line names, plus what would not resolve. */
function statesInTableLine(line: string): { states: string[]; unresolved: string[] } {
  const tokens = line.split(/[^A-Za-z]+/).filter((token) => token !== '');
  const resolved = tokens.map((token) => normalizeStateToken(token));
  const allStates = tokens.length > 0 && resolved.every((state) => state !== null);
  const states: string[] = [];
  const unresolved: string[] = [];
  tokens.forEach((token, index) => {
    const state = resolved[index];
    if (state === null) {
      // Reported, never guessed. "WVA" is very probably West Virginia and
      // "RS" is very probably a Military Resale Store, and this module can
      // prove neither — so it says so instead of choosing.
      if (/^[A-Z]{2,3}$/.test(token)) unresolved.push(token);
      return;
    }
    // A leading code followed by other words is a NAME that happens to start
    // with a state's letters — "OK Foods", "IN-N-OUT" — not a state.
    if (index === 0 && tokens.length > 1 && !allStates) return;
    states.push(state);
  });
  // Full state names span several tokens, so they are read from the whole line.
  return { states: [...new Set([...states, ...statesInText(line)])], unresolved };
}

export interface DistributionTableEvidence {
  states: string[];
  /** State-column lines that name no state — the retailer half of the cell. */
  nonStateLines: string[];
  /** Uppercase fragments that look state-like but resolve to nothing. */
  unresolvedTokens: string[];
}

/**
 * States a notice's own tables state, read only from columns whose header
 * gives them a state role.
 *
 * Structure decides, never content: a table full of state abbreviations is not
 * a distribution table, and this returns nothing for one. That is why the
 * "State" column of a store-address table contributes no geography even though
 * every cell in it is a valid state.
 */
export function distributionTableStates(summaryHtml: string | null): DistributionTableEvidence {
  const states = new Set<string>();
  const nonStateLines: string[] = [];
  const unresolvedTokens = new Set<string>();
  if (!summaryHtml) return { states: [], nonStateLines: [], unresolvedTokens: [] };

  for (const table of summaryHtml.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const rows = [...table[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((row) => cellsOf(row[0]));
    if (rows.length < 2) continue;
    const headers = rows[0].map((cell) => cell.lines.join(' '));
    if (headers.some((header) => ADDRESS_TABLE_HEADER.test(header))) continue;

    for (const [index, header] of headers.entries()) {
      if (header.length > 60) continue;
      const namesState = STATE_HEADER.test(header);
      const namesDistribution = DISTRIBUTION_HEADER.test(header);
      if (!namesState && !namesDistribution) continue;

      const column = rows.slice(1).flatMap((row) => row[index]?.lines ?? []);
      if (column.length === 0) continue;
      const read = column.map((line) => ({ line, ...statesInTableLine(line) }));
      // A header that names distribution but not states earns the column only
      // when the column is nothing BUT states.
      if (!namesState && read.some((entry) => entry.states.length === 0)) continue;

      for (const entry of read) {
        for (const state of entry.states) states.add(state);
        for (const token of entry.unresolved) unresolvedTokens.add(token);
        if (entry.states.length === 0) nonStateLines.push(entry.line);
      }
    }
  }
  return {
    states: [...states].sort(),
    nonStateLines,
    unresolvedTokens: [...unresolvedTokens].sort(),
  };
}

// ── The canonical derivation ────────────────────────────────────────────────

export interface GeographyEvidenceSource {
  title: string;
  summaryText: string;
  /** The announcement's own HTML, preserved on every persisted case. */
  summaryHtml: string | null;
  /**
   * Geography the case already carries — combined from its source records
   * during projection, or read back from a stored projection during a repair.
   */
  carried: Geography;
}

export interface GeographyEvidence {
  geography: Geography;
  /** States this derivation adds to what the case carried. */
  addedStates: string[];
  /**
   * States the case carried that the source text proves are a containment
   * artifact ("Virginia" read out of "West Virginia"). Nothing else is ever
   * removed.
   */
  removedStates: string[];
  /** Which kinds of evidence contributed: 'prose' | 'list' | 'table'. */
  bases: string[];
  /** Table fragments that look state-like and were deliberately not guessed. */
  unresolvedTokens: string[];
}

/**
 * The canonical geography for one case.
 *
 * Widening only, with a single narrowly-proven exception. A stated scope is
 * never second-guessed: `nationwide` is returned untouched, and a carried
 * state survives unless the notice's own text shows its name occurs solely
 * inside a longer state's name.
 */
export function evaluateGeographyEvidence(source: GeographyEvidenceSource): GeographyEvidence {
  const carried = source.carried;
  const unresolvedTokens: string[] = [];
  const bases: string[] = [];

  if (carried.scope === 'nationwide') {
    return { geography: carried, addedStates: [], removedStates: [], bases: [], unresolvedTokens };
  }

  const sentences = distributionSentences(source.summaryText);
  const prose = [...new Set(sentences.flatMap(statesInText))];
  if (prose.length > 0) bases.push('prose');

  const table = distributionTableStates(source.summaryHtml);
  if (table.states.length > 0) bases.push('table');
  unresolvedTokens.push(...table.unresolvedTokens);

  // Nationwide is a widening, so it may only be READ from a case that has no
  // state list yet: an FSIS record whose structured field names three states
  // is a better statement than the word "nationwide" elsewhere in its prose.
  const nationwideSentence = sentences.find((sentence) => NATIONWIDE.test(sentence));
  if (
    carried.scope === 'unknown' &&
    prose.length === 0 &&
    table.states.length === 0 &&
    nationwideSentence
  ) {
    return {
      geography: {
        scope: 'nationwide',
        states: [],
        confidence: 'inferred',
        sourceText: nationwideSentence.slice(0, 400),
      },
      addedStates: [],
      removedStates: [],
      bases: ['prose'],
      unresolvedTokens,
    };
  }

  const removedStates = carried.states.filter((state) =>
    isContainedStateArtifact(state, `${source.title}\n${source.summaryText}`),
  );
  const kept = carried.states.filter((state) => !removedStates.includes(state));
  const states = [...new Set([...kept, ...prose, ...table.states])].sort();
  const addedStates = states.filter((state) => !carried.states.includes(state));

  if (states.length === 0) {
    return {
      geography: { ...carried, scope: 'unknown', states: [] },
      addedStates,
      removedStates,
      bases,
      unresolvedTokens,
    };
  }
  return {
    geography: {
      scope: 'states',
      states,
      // A structured source list stays 'stated'; anything this module had to
      // read out of prose or a table is 'inferred', and says so.
      confidence:
        carried.scope === 'states' && addedStates.length === 0 ? carried.confidence : 'inferred',
      sourceText: carried.sourceText ?? sentences[0]?.slice(0, 400) ?? null,
    },
    addedStates,
    removedStates,
    bases,
    unresolvedTokens,
  };
}

/** The canonical geography for one case. */
export function deriveGeography(source: GeographyEvidenceSource): Geography {
  return evaluateGeographyEvidence(source).geography;
}
