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
//
// Evidence is read at SENTENCE and CLAUSE scope, never at paragraph scope.
// That is the whole difference between this module and the display-time reader
// it replaced (P2B7Q.2): a paragraph-scope reader admits every state anywhere
// in a paragraph that happens to mention distribution, which is how "Publix
// locations in Virgina and North Carolina are NOT impacted by this voluntary
// recall" put North Carolina on a recall's map, and how the Michigan
// Department of Agriculture's sampling programme put Michigan on another's.

/**
 * The frames in which a notice states that the recalled product WENT
 * somewhere. Each is a verb (or a recall-scope statement) plus the
 * preposition that introduces its destination, with a bounded gap between
 * them so an intervening phrase cannot break the frame — "available TO
 * CONSUMERS at Kroger stores in Texas and Louisiana" is the same statement as
 * "available at", and so is "distributed BETWEEN 21/07/2025 AND 04/08/2025 BY
 * NEUHAUS STORES in New York, Virginia, …". The gap may not cross a clause
 * boundary (`[^;:]`), which keeps the verb of one clause from borrowing the
 * preposition of the next. A full stop is NOT a boundary here — the text is
 * already split into sentences, so an interior period is an abbreviation, and
 * excluding it stranded "distributed by Primavera Nueva Inc. IN California
 * and Nevada".
 *
 * Every frame here was earned by a real notice whose states were being lost.
 * A bare distribution KEYWORD is deliberately not enough: "sold under the
 * following sales order numbers" and "Do not consume, serve, use, sell, or
 * distribute recalled products" both contain one and neither says where
 * anything went.
 */
const AFFIRMATIVE_FRAMES: RegExp[] = [
  /\bdistribut(?:ed|es|ing|ion)\b[^;:]{0,80}?\b(?:to|at|in|into|through|throughout|across|within)\b/i,
  // "Product was distributed (CA, TX, OR, WA, TX, IL, FL) ." and
  // "Distribution: AZ, CA, CO, HI, NJ, NV, OR, TX, WA – online and retail
  // stores." — a destination list introduced by punctuation rather than by a
  // preposition. Both were losing every state they named.
  /\bdistribut(?:ed|es|ing|ion)\b\s*[:(]/i,
  // Nationwide takes no preposition: "was distributed nationwide."
  /\b(?:distribut\w+|sold|shipped|available)\b[^;:]{0,60}?\bnationwide\b|\bnationwide\s+distribution\b/i,
  /\bsold\b[^;:]{0,80}?\b(?:at|in|to|through|throughout|via|within|across)\b/i,
  /\bship(?:ped|ping|ment|ments)\b[^;:]{0,80}?\b(?:to|in|into|through|throughout|across|within)\b/i,
  // "Product was SENT TO retail stores located in New York, Massachusetts,
  // Maine, …" — a whole second distribution sentence the keyword gate missed.
  /\bsent\s+(?:out\s+)?to\b/i,
  /\bdeliver(?:ed|ies|y)\b[^;:]{0,80}?\b(?:to|in|throughout|across)\b/i,
  /\bavailable\b[^;:]{0,80}?\b(?:at|in|through|via)\b/i,
  // "The product CAN BE FOUND AT PCC Markets in Washington State and Earth
  // Fare Stores in Florida & South Carolina". The modal is required: "Listeria
  // was found in a sample" is an investigation, not a destination.
  /\b(?:can|could|may|might|will|would)\s+be\s+found\s+(?:at|in)\b/i,
  // "This recall EXTENDS ONLY TO Sun International stores in Florida, …"
  /\brecall\s+(?:extends|applies)\b[^;:]{0,24}?\bto\b/i,
  // "The STATES INVOLVED ARE AL, AR, GA, IL, IN, KY, LA, MI, MO, MS, OH, SC,
  // TN, TX and WV." — a declared list with no verb of its own.
  /\bstates\s+involved\b/i,
];

/**
 * A destination stated as a COHORT whose places the next sentence names:
 *
 *   "The product was distributed to all Lidl US store locations. Lidl US HAS
 *    STORE LOCATIONS IN Delaware, District of Columbia, Georgia, …"
 *   "…distributes through … Full Circle subscribers. Farm Fresh to You
 *    SUBSCRIBERS ARE LOCATED IN California & Nevada."
 *
 * Admitted only inside a paragraph that already carries an affirmative
 * distribution frame, which is what separates it from the corporate-profile
 * boilerplate that closes a press release: "Publix … currently operates 1,421
 * stores in Florida, Georgia, …" sits in a paragraph about the company, names
 * a footprint rather than a destination, and is refused. A retailer's
 * footprint is geography only when the notice itself ties it to the recalled
 * product.
 */
const COHORT_LOCATION =
  /\b(?:has|have)\s+(?:store\s+)?locations?\s+in\b|\b(?:subscribers?|customers?|members?|stores?|locations?)\s+(?:are|is)\s+located\s+in\b/i;

/**
 * A declared list is introduced and then continues past the sentence that
 * introduced it — across a full stop the source wrote instead of a comma
 * ("…the following States in the United States: Arizona, California.
 * Maryland, New Jersey, …"), across a line break (one state per line), or into
 * a block of store addresses ("…were sold at the following locations:").
 */
const LIST_LEAD_IN = /\bthe\s+following\b|:\s*$/i;

/**
 * Spans inside an otherwise good sentence that name a place which is NOT a
 * destination. They are cut out of the clause before its states are read,
 * rather than used to veto the whole sentence — because the announcement's
 * opening line very often carries the firm's address AND the distribution
 * statement at once:
 *
 *   "(Clovis, California) Wawona Frozen Foods is voluntarily recalling
 *    year-old packages of its Organic DayBreak Blend DISTRIBUTED TO COSTCO
 *    WHOLESALE STORES IN ARIZONA, CALIFORNIA, COLORADO, UTAH AND WASHINGTON"
 *
 * Vetoing that sentence — which is what a sentence-level firm rule does —
 * throws away five states the notice plainly states. Cutting the dateline out
 * of it keeps them and still refuses Clovis.
 */
const NON_DESTINATION_SPANS: RegExp[] = [
  // A news dateline opening the announcement. Each form REQUIRES the thing
  // that makes it a dateline — a parenthesis, or a dash — because without
  // that a line beginning "New York, New Jersey, Pennsylvania, …" is a
  // declared state list, and cutting its first two states off is the exact
  // failure this module exists to prevent.
  //   "(Clovis, California) Wawona Frozen Foods…"
  /^\([A-Z][A-Za-z.' ]{1,28},\s*[A-Z][A-Za-z.]{1,20}\)\s*/,
  //   "New York, New York (November 27, 2024) Handsome Brook Farms…"
  /^[A-Z][A-Za-z.' ]{1,28},\s*[A-Z][A-Za-z.]{1,20}\s*\([^)]{0,40}\)\s*[–—\-]*\s*/,
  //   "LAKELAND, Fla., Oct. 15, 2025 - " / "ARLINGTON, VA – " / "HOUSTON, TX, May 5, 2026 — "
  /^[A-Z][A-Za-z.' ]{1,28},\s*[A-Z][A-Za-z.]{1,20}\.?(?:,?\s*[A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s*\d{4})?\*?\s*[–—\-]{1,3}\s*/,
  //   "6/24/2024, San Francisco, CA - Feve Artisan Chocolatier…"
  /^\d{1,2}\/\d{1,2}\/\d{2,4},\s*[A-Z][A-Za-z.' ]{1,28},\s*[A-Z][A-Za-z.]{1,20}\s*[–—\-]{1,3}\s*/,
  // The firm's own apposition: "Cooperstown Cheese Company OF MILFORD, NY, is
  // recalling…", "Bedner Growers, Inc. OF BOYNTON BEACH, FLORIDA is…".
  /\bof\s+[A-Z][A-Za-z.'\- ]{1,30},\s*[A-Z][A-Za-z.]{1,20},?\s+(?=(?:is|are|has|have|which|dba|d\/b\/a)\b)/i,
  // A headquarters, and a supplier's or grower's own site.
  /\bheadquarter\w*\b[^.;]{0,60}/i,
  // "spinach GROWN BY ITS SUPPLIER ELEMENT FARMS IN THEIR POMPTON PLAINS, NEW
  // JERSEY FARM and distributed under the BrightFarms brand" — the span runs
  // to the LAST site word, but may never swallow a distribution verb, so a
  // destination stated later in the same sentence is never cut away with it.
  /\b(?:grown|produced|packed|processed|manufactured|supplied)\s+by\b(?:(?!\b(?:distribut|sold|shipped|sent|deliver)\w*\b)[^.;]){0,130}\b(?:farms?|facilit(?:y|ies)|plants?)\b/i,
];

/** Where a product sits inside a store — merchandising, not distribution. */
const MERCHANDISING =
  /\b(?:frozen|refrigerated|dairy|deli|produce|bakery|meat|freezer|cooler|chilled)\s+(?:section|case|aisle|department|counter|display)\b|\baisle\s+\d/i;

/** Phone numbers, emails and "call/contact" lines: never distribution. */
const CONTACT_LINE = /\bcall\b|\bcontact\b|\bquestions\b|@|\b\d{3}-\d{3}-\d{4}\b/i;

/**
 * Sampling, testing and regulatory sentences. A state health department is a
 * LABORATORY, not a destination: "routine sampling by the Arkansas Department
 * of Health" and "a routine sampling program by the Michigan Department of
 * Agriculture and Rural Development" each put a state on a recall that never
 * reached it. These sentences rarely carry a distribution frame at all, and
 * the veto states the rule rather than relying on that.
 */
const INVESTIGATION =
  /\bsampl(?:e|es|ed|ing)\b|\btest(?:ed|ing)?\s+positive\b|\btest\s+results?\b|\bdepartment\s+of\s+(?:agriculture|health|public\s+health)\b|\blaborator(?:y|ies)\b|\binspection\s+agency\b/i;

/**
 * The notice saying a place is NOT affected. Everything this matches is read
 * for the states it names and those states are EXCLUDED — never admitted.
 */
const NEGATED =
  /\b(?:are|is|was|were|has|have)\s+not\s+(?:been\s+)?(?:impacted|affected|included|involved|distributed|sold|shipped|part\b)|\bdoes\s+not\s+(?:apply|include|affect|impact)\b|\bno\s+(?:product|products)\s+(?:were|was|are|is)\s+(?:impacted|affected|distributed|sold|shipped)\b/i;

/**
 * A shipping ORIGIN, stripped out of an affirmative clause before its states
 * are read. "The eggs were produced and distributed FROM FARMS IN TEXAS" and
 * "shipped from our facility in Idaho" name where product came from, and the
 * contract is explicit that a manufacturing, processing, supplier or shipping
 * location is not a destination. Only the "from <facility>" shape is stripped
 * — "distributed from May 4th through May 30th" is a date range and is left
 * alone.
 */
const ORIGIN_CLAUSE =
  /\bfrom\s+(?:its\s+|our\s+|their\s+|the\s+|a\s+)?(?:farms?|facilit(?:y|ies)|plants?|warehouses?|manufactur\w*|processing\b|production\b|suppliers?|kitchens?)\b[^,.;]{0,60}/gi;

/**
 * The connective that ends the affirmative half of a sentence and begins its
 * exception: "…distributed to stores located in Alabama, Georgia, Kentucky,
 * South Carolina, Tennessee and Florida, EXCEPT FOR stores in Jacksonville,
 * Tallahassee, Tampa and Sarasota." The six states are affirmed and the four
 * cities are excluded — vetoing the whole sentence on the word "except" would
 * throw away the best distribution statement in the notice.
 */
const EXCLUSION_CONNECTIVE = /\b(?:except(?:\s+for)?|excluding|other\s+than|apart\s+from)\b/i;

const NATIONWIDE =
  /\bnationwide\b|\bnationally\b|\bacross the (?:country|united states)\b|\ball 50 states\b/i;

/** Any mention of distribution at all. Provenance only — never evidence. */
const DISTRIBUTION_KEYWORD =
  /\bdistribut\w+|\bsold\b|\bshipped\b|\bsent\b|\bavailable\b|\bnationwide\b/i;

/** How far a declared list may run before the reader stops trusting it. */
const MAX_LIST_CONTINUATION = 40;

/** The sentence with every non-destination span cut out of it. */
function destinationClause(sentence: string): string {
  let clause = sentence;
  for (const span of NON_DESTINATION_SPANS) clause = clause.replace(span, ' ');
  return clause.replace(ORIGIN_CLAUSE, ' ');
}

function vetoed(sentence: string): boolean {
  return (
    CONSUMER_ACTION_PATTERN.test(sentence) ||
    MERCHANDISING.test(sentence) ||
    CONTACT_LINE.test(sentence) ||
    INVESTIGATION.test(sentence)
  );
}

function affirmativeFrame(sentence: string): boolean {
  return AFFIRMATIVE_FRAMES.some((frame) => frame.test(sentence));
}

/** The affirmative half of a sentence, and the exception it carries. */
function splitAtException(sentence: string): { affirmed: string; excepted: string } {
  const match = EXCLUSION_CONNECTIVE.exec(sentence);
  if (!match) return { affirmed: sentence, excepted: '' };
  return {
    affirmed: sentence.slice(0, match.index),
    excepted: sentence.slice(match.index + match[0].length),
  };
}

export interface ProseGeographyEvidence {
  /** States the notice affirmatively says the product went to. */
  states: string[];
  /** States the notice explicitly says are NOT affected. */
  excludedStates: string[];
  /** The affirmative sentences, for traceability and `sourceText`. */
  sentences: string[];
  /**
   * Every unit that contributed a state — the affirmative sentences plus the
   * declared-list units they carried — in document order. This is the "why"
   * a repair ledger and a founder report need: each admitted state can be
   * quoted back to the sentence that admitted it.
   */
  admittedUnits: string[];
  /** The sentence that stated nationwide distribution, if one did. */
  nationwideSentence: string | null;
}

/**
 * Every state a notice's own prose affirmatively places the recalled product
 * in, and every state it explicitly rules out.
 *
 * The unit of evidence is a sentence inside a line; a paragraph is a line.
 * Three things happen per unit and nothing else does:
 *
 *   1. a negated unit contributes its states to the EXCLUDED set;
 *   2. a vetoed unit contributes nothing;
 *   3. a unit carrying an affirmative frame contributes the states of its
 *      affirmative half, and the states of its exception clause to the
 *      excluded set.
 *
 * A unit that introduces a declared list additionally consumes the units that
 * follow it — the rest of its own line, then whole lines — for as long as each
 * one names a state and passes the vetoes. That is what recovers the fourteen
 * states after "Angelicae Sinensis was distributed in the following states.",
 * the eight after "…the following States in the United States: Arizona,
 * California.", and the three the five store addresses under "…were sold at
 * the following locations:" spell out.
 */
export function readDistributionProse(summaryText: string): ProseGeographyEvidence {
  const affirmed = new Set<string>();
  const excluded = new Set<string>();
  const sentences: string[] = [];
  const admitted: string[] = [];
  let nationwideSentence: string | null = null;

  // Units in document order, each tagged with the line it came from, so a
  // declared list can run to the end of its own line and then onward.
  const units: { text: string; line: number }[] = [];
  summaryText.split(/\n+/).forEach((line, index) => {
    for (const sentence of splitSentences(line)) units.push({ text: sentence, line: index });
  });

  // A cohort sentence ("Lidl US has store locations in …") is evidence only
  // where the same paragraph already states that product was distributed.
  const paragraphHasFrame = new Set<number>();
  for (const unit of units) {
    if (!vetoed(unit.text) && !NEGATED.test(unit.text) && affirmativeFrame(unit.text)) {
      paragraphHasFrame.add(unit.line);
    }
  }

  const consumed = new Set<number>();

  units.forEach((unit, index) => {
    const sentence = unit.text;
    if (NEGATED.test(sentence)) {
      for (const state of statesInText(sentence)) excluded.add(state);
      return;
    }
    if (vetoed(sentence)) return;

    const primary = affirmativeFrame(sentence);
    const cohort = !primary && COHORT_LOCATION.test(sentence) && paragraphHasFrame.has(unit.line);
    if (!primary && !cohort && !consumed.has(index)) return;

    const { affirmed: head, excepted } = splitAtException(sentence);
    const named = statesInText(destinationClause(head));
    for (const state of named) affirmed.add(state);
    for (const state of statesInText(excepted)) excluded.add(state);
    if (primary || cohort) sentences.push(sentence);
    if (named.length > 0) admitted.push(sentence);
    if (nationwideSentence === null && NATIONWIDE.test(head)) nationwideSentence = sentence;

    if (!primary || !LIST_LEAD_IN.test(sentence)) return;
    // A declared list continues until a unit stops looking like one.
    for (
      let next = index + 1;
      next < units.length && next - index <= MAX_LIST_CONTINUATION;
      next++
    ) {
      const candidate = units[next].text;
      if (NEGATED.test(candidate)) {
        for (const state of statesInText(candidate)) excluded.add(state);
        break;
      }
      if (vetoed(candidate)) break;
      const continued = statesInText(destinationClause(candidate));
      if (continued.length === 0) break;
      for (const state of continued) affirmed.add(state);
      admitted.push(candidate);
      consumed.add(next);
    }
  });

  return {
    states: [...affirmed].sort(),
    excludedStates: [...excluded].sort(),
    sentences,
    admittedUnits: admitted,
    nationwideSentence,
  };
}

/**
 * Sentences that TALK about distribution, for provenance only.
 *
 * This is a keyword gate, and it is deliberately not the evidence contract: it
 * decides nothing about geography and contributes no state anywhere. Its one
 * job is to preserve what a notice said about where product went when the
 * evidence rules refuse to name a place — the "eight-state operating area"
 * sentence that a Publix notice offers instead of a state list — so an honest
 * `unknown` still carries the source's own words with it.
 *
 * Because it names no place, the evidence vetoes do not apply to it: the
 * Publix sentence is BOTH the firm's own announcement and the only thing the
 * notice says about distribution, and quoting it costs nothing. Only a
 * consumer instruction is filtered, so the quote is never "return it to the
 * place of purchase".
 *
 * `readDistributionProse` is the reader. Nothing may derive a state from this.
 */
export function distributionSentences(text: string): string[] {
  return splitSentences(text).filter(
    (sentence) => DISTRIBUTION_KEYWORD.test(sentence) && !CONSUMER_ACTION_PATTERN.test(sentence),
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

/** Why a state the case carried is not in the derived geography. */
export type GeographyRemovalReason =
  /** Its name occurs only inside a longer state's name ("West Virginia"). */
  | 'containment-artifact'
  /** The notice states in so many words that this place is not affected. */
  | 'explicitly-excluded';

export interface GeographyEvidence {
  geography: Geography;
  /** States this derivation adds to what the case carried. */
  addedStates: string[];
  /**
   * States the case carried that the notice's own text proves do not belong:
   * a containment artifact, or a place the notice explicitly rules out.
   * Nothing else is ever removed.
   */
  removedStates: string[];
  /** Each removal with its reason, for the repair ledger and the report. */
  removals: { state: string; reason: GeographyRemovalReason }[];
  /**
   * States the notice explicitly says are NOT affected, whether or not the
   * case carried them. Kept so a widening can never re-add one.
   */
  excludedStates: string[];
  /**
   * States the notice both affirms and excludes. The notice contradicts
   * itself, so they are refused — reported, never guessed either way.
   */
  contradictedStates: string[];
  /** Which kinds of evidence contributed: 'prose' | 'list' | 'table'. */
  bases: string[];
  /** Table fragments that look state-like and were deliberately not guessed. */
  unresolvedTokens: string[];
}

/**
 * The canonical geography for one case.
 *
 * Widening, with two proven exceptions. A stated scope is never second-guessed
 * — `nationwide` is returned untouched — and a carried state survives unless
 * the notice's own text shows its name occurs solely inside a longer state's
 * name, or the notice says in so many words that the place is not affected.
 *
 * Absence is never widened into presence: a notice with no distribution
 * evidence stays `unknown`, and `nationwide` must be stated, never inferred
 * from a long state list.
 */
export function evaluateGeographyEvidence(source: GeographyEvidenceSource): GeographyEvidence {
  const carried = source.carried;
  const unresolvedTokens: string[] = [];
  const bases: string[] = [];
  const empty = {
    addedStates: [],
    removedStates: [],
    removals: [],
    excludedStates: [],
    contradictedStates: [],
    unresolvedTokens,
  };

  if (carried.scope === 'nationwide') {
    return { geography: carried, ...empty, bases: [] };
  }

  const prose = readDistributionProse(source.summaryText);
  if (prose.states.length > 0) bases.push('prose');

  const table = distributionTableStates(source.summaryHtml);
  if (table.states.length > 0) bases.push('table');
  unresolvedTokens.push(...table.unresolvedTokens);

  // Nationwide is a widening, so it may only be READ from a case that has no
  // state list yet: an FSIS record whose structured field names three states
  // is a better statement than the word "nationwide" elsewhere in its prose.
  // It is never INFERRED — a forty-state list is a forty-state list, and no
  // number of states adds up to this word.
  //
  // States the PROSE also names do not veto it, because a notice that says
  // "distributed nationwide in retail grocery stores in all U.S. states other
  // than Alaska" is nationwide, and reading it as `states: [Puerto Rico]`
  // told 49 states a nationwide recall had missed them.
  if (carried.scope === 'unknown' && table.states.length === 0 && prose.nationwideSentence) {
    return {
      geography: {
        scope: 'nationwide',
        states: [],
        confidence: 'inferred',
        sourceText: prose.nationwideSentence.slice(0, 400),
      },
      ...empty,
      bases: ['prose'],
    };
  }

  const affirmed = [...new Set([...prose.states, ...table.states])];
  const excludedStates = prose.excludedStates;
  // A place the notice both affirms and rules out is evidence against itself.
  // Refusing it is the only honest answer: admitting it tells a shopper the
  // recall reached them on the strength of a sentence that says it did not,
  // and asserting the exclusion drops a state the notice also affirmed.
  const contradictedStates = affirmed.filter((state) => excludedStates.includes(state));

  const removals: { state: string; reason: GeographyRemovalReason }[] = [];
  const evidenceText = `${source.title}\n${source.summaryText}`;
  for (const state of carried.states) {
    if (isContainedStateArtifact(state, evidenceText)) {
      removals.push({ state, reason: 'containment-artifact' });
    } else if (excludedStates.includes(state)) {
      removals.push({ state, reason: 'explicitly-excluded' });
    }
  }
  const removedStates = removals.map((removal) => removal.state);

  const kept = carried.states.filter((state) => !removedStates.includes(state));
  const states = [
    ...new Set([...kept, ...affirmed.filter((state) => !excludedStates.includes(state))]),
  ].sort();
  const addedStates = states.filter((state) => !carried.states.includes(state));
  const measured = {
    addedStates,
    removedStates,
    removals,
    excludedStates,
    contradictedStates,
    unresolvedTokens,
  };

  if (states.length === 0) {
    return { geography: { ...carried, scope: 'unknown', states: [] }, ...measured, bases };
  }
  return {
    geography: {
      scope: 'states',
      states,
      // A structured source list stays 'stated'; anything this module had to
      // read out of prose, a declared list or a table is 'inferred', and says
      // so.
      confidence:
        carried.scope === 'states' && addedStates.length === 0 && removedStates.length === 0
          ? carried.confidence
          : 'inferred',
      sourceText: carried.sourceText ?? prose.sentences[0]?.slice(0, 400) ?? null,
    },
    ...measured,
    bases,
  };
}

/** The canonical geography for one case. */
export function deriveGeography(source: GeographyEvidenceSource): Geography {
  return evaluateGeographyEvidence(source).geography;
}
