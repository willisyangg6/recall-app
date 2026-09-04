/**
 * Consumer Projection V2 — package identifiers stated in prose.
 *
 * Most announcements never use a table. They state identifiers inline, in a
 * handful of recurring shapes verified across a 160-announcement sample:
 *
 *   "PRIVATE SELECTION FROZEN TRIPLE BERRY MEDLEY, 48 OZ (BEST BY: 07-07-20; UPC: 0001111079120)"
 *   "stamped with the SELL BY date of September 15, 2022"
 *   "marked with any of the following Lot numbers: 1472, 1481, 1531"
 *   "The UPC code is- 7-43490-00010-4."
 *
 * Extraction is strictly label-driven: a value becomes a lot/date/barcode only
 * because the source's own words label it. Notices that explicitly say there
 * are no codes ("the labeling does not have any UPC or lot codes") are
 * recognized as such, so honest source silence is never counted as a parser
 * failure — that distinction is what keeps the QA metrics truthful.
 */

import type { ConsumerConcept } from './consumer-concepts';
import {
  extractCodeDatePairs,
  normalizeDateValue,
  resolveDateWithCode,
  splitTrailingPlacement,
} from './identifiers';
import {
  hasProseWordRun,
  isTimeOrPhoneFragment,
  resolveEmbeddedLabel,
  splitDateList,
  splitIdentifierList,
  stripTrailingProse,
} from './identifier-lists';
import type { SemanticFact } from './source-tables';

/** Label vocabulary → concept. Longest alternatives first so "best if used by" wins. */
const LABEL_PATTERNS: [string, ConsumerConcept, 'explicit'?][] = [
  ['best[- ]?if[- ]?used[- ]?by(?:[- ]?date)?', 'best_by'],
  ['best[- ]?before(?:[- ]?date)?', 'best_by'],
  ['best[- ]?by(?:[- ]?date)?', 'best_by'],
  ['use[- ]?by(?:[- ]?date)?', 'use_by'],
  ['sell[- ]?by(?:[- ]?date)?', 'sell_by'],
  ['freeze[- ]?by(?:[- ]?date)?', 'freeze_by'],
  ['expiration(?:[- ]?dates?)?', 'expiration'],
  ['expiry(?:[- ]?dates?)?', 'expiration'],
  ['production[- ]?codes?', 'production_code'],
  ['production[- ]?dates?', 'production_date'],
  ['u\\.?p\\.?c\\.?(?:[- ]?codes?)?', 'upc'],
  ['bar[- ]?codes?', 'upc'],
  // "code"/"number" makes the label explicit and any connector will do; a bare
  // "lot"/"batch" is an ordinary English noun ("a single production lot of
  // washed broccoli") and only counts as a label with an explicit connector.
  ['lot[- ]?(?:codes?|numbers?|#)', 'lot'],
  ['batch[- ]?(?:codes?|numbers?|#)', 'lot'],
  ['lot', 'lot', 'explicit'],
  ['batch', 'lot', 'explicit'],
  ['case[- ]?codes?', 'case_code'],
  ['item[- ]?(?:numbers?|codes?)', 'item_number'],
];

/** Connectors between a label and its value, including the observed "is-". */
const CONNECTOR = String.raw`(?:[”"’']?\s*(?:date)?\s*(?::|=|#|–|—)\s*|[”"’']?\s+(?:date\s+)?(?:of|is|are|is-|:-)\s*|\s+)`;

/** Connector for labels that are also ordinary words: punctuation or a verb. */
const EXPLICIT_CONNECTOR = String.raw`(?:[”"’']?\s*(?::|=|#|–|—)\s*|[”"’']?\s+(?:is|are|is-|:-)\s+)`;

/** Optional filler the source puts between label and value. */
const FILLER = String.raw`(?:(?:the|a|any|all|following|these|listed|with|dates?|codes?|numbers?)\s+){0,4}`;

/**
 * A value runs until the source clearly moves on: a semicolon, a colon, a
 * closing paren, a newline, a sentence end, or the start of another label.
 * The prose stops ("which", "may be", …) are matched as whole phrases — a
 * bare "may " stop would truncate "through May 2029" at the month name,
 * which is exactly how an expiration range once rendered as "between
 * November 2028 through".
 */
const VALUE = String.raw`([^;():\n]{1,90}?)(?=\s*[;():\n]|\.\s|\.$|,?\s+(?:and\s+)?(?:the\s+)?(?:UPC|Lot|Batch|Best|Use|Sell|Expiration|Item|Case)\b|,?\s+(?:which|that|can be|may\s+(?:be|contain|have|include|not)|located|printed|stamped|marked|found|on the|because|due|after|with|are|is)\b|\s*$)`;

/**
 * A label separated from its values by a subordinate clause, which real
 * notices do constantly: "the following affected lot codes, which is affixed
 * to the case as seen in the below image: 13150423, 13150723, …". The clause
 * is skipped only up to a colon, so the values still come from the labeled
 * statement and never from unrelated prose.
 *
 * The clause must not END in another identifier label: in "…with Best if Used
 * by Date Dec 10, 2024, and Lot Code: BFFG327A6" the colon belongs to the LOT
 * label, and reading across it files a lot code under a best-by date.
 */
const CLAUSE_THEN_COLON = String.raw`(?:[^:.;\n]{0,80})(?<!\b(?:UPC|Lot|Batch|Item|Case|Product|Production)(?:[- ]?(?:Code|Number|#)s?)?|\b(?:Best|Use|Sell)[- ](?:If[- ]Used[- ])?By(?:[- ]Date)?|\bBest[- ]Before(?:[- ]Date)?|\bExpiration(?:[- ]Date)?):\s*`;

/** The source explicitly stating that no codes exist. */
const NO_CODES_STATEMENT =
  /\b(?:does\s+not\s+have|do\s+not\s+have|has\s+no|have\s+no|without|no)\s+(?:any\s+)?(?:UPC|lot|batch|product)\b[^.]{0,40}\bcodes?\b|\bnot?\s+(?:UPC|lot)\s+coded\b/i;

/**
 * The notice mentions codes/dates only to say they vary ("different
 * expiration dates stamped on the back side") without stating any value.
 * There is nothing to extract — honest source silence, not a parser gap.
 */
const UNSPECIFIED_CODES_STATEMENT =
  /\b(?:different|varying|various|multiple|assorted|several)\s+(?:UPC|lot|batch|production|expiration|expiry|best[- ]?by|use[- ]?by|sell[- ]?by)\b[^.]{0,30}\b(?:codes?|dates?|numbers?)\b/i;

/**
 * Drop the bare word "date" left at the END of a date value.
 *
 * A notice writes its label on either side of the value — "a Best By date of
 * February 2021" and "a Best By February 2021 date" both occur — and the
 * second leaves the label's own noun inside the value, so Hormel rendered
 * `Best by: February 2021 date`. It is removed ONLY when what remains still
 * resolves to a calendar date, which is what proves the word was the label's
 * and not the source's own wording; anything else is kept verbatim.
 */
function withoutTrailingDateWord(value: string): string {
  const trimmed = value.replace(/[\s,]+dates?$/i, '').trim();
  if (trimmed === value || trimmed === '') return value;
  return normalizeDateValue(trimmed).canonical !== undefined ? trimmed : value;
}

/**
 * A value that opens by saying WHERE the code is rather than what it is.
 * Middlefield's "Customers can find the lot codes on 8 oz. packets and 5 lb.
 * loaves located on the side." put `on 8 oz` in the Lot code field; the
 * sentence is a placement statement, and the code-location path already owns
 * it ("On the side of the package.").
 */
const PLACEMENT_LEAD =
  /^(?:on|in|at|under|underneath|beneath|below|above|near|next\s+to|inside|outside|located|printed|stamped|marked|found|displayed|embossed)\b/i;

/** Concepts whose values are printed codes, and so are never prose. */
const CODE_CONCEPTS = new Set<ConsumerConcept>([
  'lot',
  'case_code',
  'item_number',
  'production_code',
]);

/** Values that are prose rather than an identifier. */
function isPlausibleValue(concept: ConsumerConcept, value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 2 || trimmed.length > 90) return false;
  // Every identifier family we extract is anchored by digits.
  if (!/\d/.test(trimmed)) return false;
  // Reject sentences: identifiers are short token runs, not clauses.
  if (trimmed.split(/\s+/).length > 12) return false;
  // A clock time, a telephone number, or an extension is a fact about the
  // notice, not a marking on the package.
  if (isTimeOrPhoneFragment(trimmed)) return false;
  if (CODE_CONCEPTS.has(concept)) {
    // A code that opens by saying WHERE it is, is the placement sentence, not
    // the code.
    if (PLACEMENT_LEAD.test(trimmed)) return false;
    // Prose at the FRONT is a flattened source row, not a code with noise
    // after it. Moonlight's column-header run ("… Facility Code Lot Code") is
    // followed by the row's own cells, and the "4401" in it sits under the
    // PLU Sticker column — emitting it would state a lot code the source
    // never gave. A trailing tail is trimmed and the code kept; a leading one
    // is refused.
    if (hasProseWordRun(trimmed)) return false;
  }
  if (
    /\b(?:because|which|consumers|should|please|contact|call|recall(?:ed|ing)?)\b/i.test(trimmed)
  ) {
    return false;
  }
  if (concept === 'upc') {
    // A barcode is digits plus separators only.
    return /^[\d\s.-]{6,}$/.test(trimmed);
  }
  return true;
}

function cleanValue(value: string): string {
  return (
    value
      // A leading "of" is the connector's residue, never part of a value.
      .replace(/^\s*of\s+/i, '')
      .replace(/^[\s:;,.\-–—#("“]+/, '')
      .replace(/[\s:;,.\-–—)"”]+$/, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * The labels that COMPETE with a barcode label for ownership of a printed
 * value, built from this module's own label vocabulary rather than a second
 * keyword list: every label above that means something other than a barcode,
 * plus the printed abbreviations a package carries instead of the spelled-out
 * words. `BBD`/`BBE`/`BB` and a bare `EXP` are how notices print a best-before
 * or expiration marking (D. Coluccio's `BBD 15-01-2025`), and "packaging date"
 * is the wording FSIS uses beside a best-by date (Water Lilies).
 */
const COMPETING_LABEL = new RegExp(
  `\\b(?:${[
    ...LABEL_PATTERNS.filter(([, concept]) => concept !== 'upc').map(([pattern]) => pattern),
    'packaging[- ]?dates?',
    // The printed abbreviations, closed to a letter so "expands" is not a
    // label and "Bubba" holds no "BB".
    '(?:bbd|bbe|bb|exp)(?![a-z])',
  ]
    .map((pattern) => `(?:${pattern})`)
    .join('|')})`,
  'gi',
);

/** The barcode labels, from the same vocabulary. */
const BARCODE_LABEL = new RegExp(
  `\\b(?:${LABEL_PATTERNS.filter(([, concept]) => concept === 'upc')
    .map(([pattern]) => `(?:${pattern})`)
    .join('|')})`,
  'gi',
);

/**
 * True when the label GOVERNING this position in the sentence is a barcode
 * label — or when no label governs it at all, which is the ordinary
 * continuation case ("with UPC #199284530959 (4oz) and #199284306226 (12oz)",
 * where the one UPC label owns both values).
 *
 * Ownership is positional and bounded: the nearest label to the LEFT of the
 * value wins, exactly as a reader resolves it. That is what stops a digit run
 * the source explicitly published as a best-by date, a packaging date, or a
 * lot code from also becoming a barcode because its digits happen to be
 * eight, twelve, thirteen or fourteen long. Digit length decides nothing here.
 */
export function barcodeLabelGoverns(sentence: string, index: number): boolean {
  const before = sentence.slice(0, index);
  const last = (pattern: RegExp): number => {
    let end = -1;
    for (const match of before.matchAll(pattern)) end = match.index + match[0].length;
    return end;
  };
  const competing = last(COMPETING_LABEL);
  if (competing === -1) return true;
  return last(BARCODE_LABEL) > competing;
}

/**
 * True when an earlier, LABEL-ANCHORED pass already published this exact span
 * under a label that is not a barcode.
 *
 * The label-anchored passes are the module's strongest evidence — a value is
 * there only because the source's own words introduced it — so a span already
 * claimed by one of them is settled. It catches the case positional ownership
 * cannot: a value stated under its label somewhere the sentence split does not
 * reach.
 */
function claimedByAnotherLabel(facts: SemanticFact[], run: string): boolean {
  const needle = run.trim();
  if (needle === '') return false;
  const delimited = new RegExp(
    `(?:^|[^\\w-])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^\\w-]|$)`,
  );
  return facts.some((fact) => {
    if (fact.concept === 'upc') return false;
    return [fact.value, fact.raw ?? ''].some(
      (span) => span.trim() === needle || delimited.test(span),
    );
  });
}

export interface ProseIdentifierResult {
  facts: SemanticFact[];
  /** True when the notice explicitly states the product carries no codes. */
  statesNoCodes: boolean;
}

/**
 * A sentence describing the SUPPLIER'S recall, not this product. Blank Slate's
 * notice reads "The recall was initiated after notification that Rooted in
 * Rare brand Aquafaba powder … with UPC #199284530959 … was recalled." —
 * every identifier in that sentence belongs to the recalled INGREDIENT, and
 * extracting them told Coconut Fudge Sandwich buyers to check another
 * product's barcode. The whole sentence is withheld from identifier
 * extraction; it remains in the preserved source and the narrative sections.
 */
const SUPPLIER_RECALL_SENTENCE =
  /\b(?:notification|notified|being\s+notified|learning|notice)\b[^.\n]{0,240}?\b(?:was|were|has\s+been|have\s+been|had\s+been|is\s+being|are\s+being)\s+recall/i;

/** The text with supplier-recall reference sentences removed. */
export function withoutSupplierRecallReferences(text: string): string {
  if (!SUPPLIER_RECALL_SENTENCE.test(text)) return text;
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z“"])|\n/)
    .filter((sentence) => !SUPPLIER_RECALL_SENTENCE.test(sentence))
    .join('\n');
}

/** Labels that introduce a list of printed codes paired with real dates. */
const PAIR_LIST_LABELS: [string, ConsumerConcept, ConsumerConcept][] = [
  // [label, concept for the calendar date, concept for the printed code]
  ['production[- ]?dates?', 'production_date', 'production_code'],
  ['production[- ]?codes?', 'production_date', 'production_code'],
  ['pack(?:ing)?[- ]?dates?', 'production_date', 'production_code'],
  ['lot[- ]?(?:codes?|numbers?)?', 'best_by', 'lot'],
  ['batch[- ]?(?:codes?|numbers?)?', 'best_by', 'lot'],
];

/**
 * Codes a notice publishes together with the calendar date each one stands
 * for, as the Dairyland Produce jalapeño recall does:
 *
 *   "Production dates are: 26192 (07/11/26), 26196 (07/15/26), …"
 *
 * Reading only the code turns a readable date into an opaque five-digit number
 * — technically source-grounded and useless to a shopper. Reading only the date
 * throws away the string actually printed on the bag. Both are kept, and the
 * relationship between them is what makes either one usable.
 */
function extractPairedCodeLists(summaryText: string): SemanticFact[] {
  const facts: SemanticFact[] = [];
  for (const [labelPattern, dateConcept, codeConcept] of PAIR_LIST_LABELS) {
    const pattern = new RegExp(String.raw`\b(${labelPattern})\b[^.:\n]{0,30}[:=]?\s*`, 'gi');
    for (const match of summaryText.matchAll(pattern)) {
      // The list runs to the end of the sentence. Dates use slashes, not
      // periods, so the first ". " reliably terminates it.
      const rest = summaryText.slice(
        match.index! + match[0].length,
        match.index! + match[0].length + 600,
      );
      const end = rest.search(/\.\s|\.$|\n\n/);
      const pairs = extractCodeDatePairs(end === -1 ? rest : rest.slice(0, end));
      if (pairs.length === 0) continue;
      const sourceLabel = match[1].replace(/\s+/g, ' ').trim();
      for (const pair of pairs) {
        facts.push({
          concept: codeConcept,
          sourceLabel,
          value: pair.code,
          raw: `${pair.code} (${pair.date})`,
          evidence: 'prose',
          pairedDate: pair.date,
        });
        facts.push({
          concept: dateConcept,
          sourceLabel,
          // The paired code can prove the order of an otherwise ambiguous
          // numeric date; when it does, the readable form is what consumers see.
          value: resolveDateWithCode(pair.date, pair.code).display,
          raw: `${pair.code} (${pair.date})`,
          evidence: 'prose',
          pairedCode: pair.code,
        });
      }
    }
  }
  return facts;
}

/**
 * Alternating label/value runs: "LOT 25079 Expiration May 03 2026, LOT 25055
 * Expiration May 12 2026, …". Each lot keeps the date printed beside it — the
 * relationship is the sentence's whole content, and reading only the dates
 * (which a label-anchored pattern does) drops the codes that identify the
 * affected packages.
 */
const LOT_DATE_RUN = new RegExp(
  String.raw`\bLOT\s*#?\s*([A-Z0-9][A-Z0-9-]{2,14})[\s,]+(Expiration|Expires?|Exp\.?|Best\s+By|Best\s+Before|Use\s+By|Sell\s+By)[\s:]+((?:[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{2,4})|(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}))`,
  'gi',
);

function dateConceptForLabel(label: string): ConsumerConcept {
  if (/best/i.test(label)) return 'best_by';
  if (/use/i.test(label)) return 'use_by';
  if (/sell/i.test(label)) return 'sell_by';
  return 'expiration';
}

/** A segment that opens its own identifier label, ending the previous list. */
const SEGMENT_STARTS_A_LABEL =
  /^["“'’]?(?:(?:and|or|the)\s+)*(?:lot|batch|upc|u\.p\.c|bar[\s-]?code|item|case|sku|product|package|packaging|production|best|use|sell|freeze|expir)\b/i;

/**
 * Extend a matched value across the semicolons that continue its list.
 *
 * The value grammar stops at a semicolon, which is right for a sentence and
 * wrong for a list: Al'Fez Natural Tahini publishes `BEST BEFORE: "2024 JL
 * 31"; "2024 SE 09"; "2025 MR 27"; "2025 AL 04"`, and stopping at the first
 * semicolon dropped three of the four dates a shopper needs. Semicolons and
 * commas separate identifiers identically; only the grammar disagreed.
 *
 * A segment is taken only while it continues the SAME list. One that opens a
 * new label, carries no digit, reads as prose, or states a time ends it — so
 * the sentence after the list can never be absorbed into it.
 */
function continueAcrossSemicolons(text: string, match: RegExpMatchArray): string {
  let value = match[2];
  let cursor = (match.index ?? 0) + match[0].length;
  for (;;) {
    const rest = text.slice(cursor);
    const gap = rest.match(/^\s*;\s*/);
    if (!gap) return value;
    const segment = rest.slice(gap[0].length).match(/^[^;.\n]{1,90}/)?.[0];
    if (segment === undefined) return value;
    const trimmed = segment.trim();
    if (
      trimmed === '' ||
      !/\d/.test(trimmed) ||
      trimmed.split(/\s+/).length > 8 ||
      SEGMENT_STARTS_A_LABEL.test(trimmed) ||
      hasProseWordRun(trimmed) ||
      isTimeOrPhoneFragment(trimmed)
    ) {
      return value;
    }
    value = `${value}; ${trimmed}`;
    cursor += gap[0].length + segment.length;
  }
}

/**
 * Extract label-driven identifiers from announcement prose.
 * Multi-value lists ("Lot numbers: 1472, 1481, 1531") are split into one fact
 * per value so the package checker can collapse large sets on its own.
 */
export function extractProseIdentifiers(rawSummaryText: string | null): ProseIdentifierResult {
  if (!rawSummaryText) return { facts: [], statesNoCodes: false };
  // Identifiers inside a supplier-recall reference belong to the OTHER
  // product; label-driven extraction must never see them.
  const summaryText = withoutSupplierRecallReferences(rawSummaryText);
  const statesNoCodes =
    NO_CODES_STATEMENT.test(summaryText) || UNSPECIFIED_CODES_STATEMENT.test(summaryText);
  const facts: SemanticFact[] = [];
  const seen = new Set<string>();

  // Alternating "LOT <code> Expiration <date>" runs, each code keeping its
  // own date.
  for (const match of summaryText.matchAll(LOT_DATE_RUN)) {
    const code = match[1].trim();
    const date = match[3].trim();
    const dateConcept = dateConceptForLabel(match[2]);
    const lotKey = `lot|${code.toLowerCase()}`;
    if (!seen.has(lotKey)) {
      seen.add(lotKey);
      facts.push({
        concept: 'lot',
        sourceLabel: 'LOT',
        value: code,
        raw: match[0],
        evidence: 'prose',
        pairedDate: date,
      });
    }
    const dateKey = `${dateConcept}|${date.toLowerCase()}`;
    if (!seen.has(dateKey)) {
      seen.add(dateKey);
      facts.push({
        concept: dateConcept,
        sourceLabel: match[2].replace(/\s+/g, ' ').trim(),
        value: date,
        raw: match[0],
        evidence: 'prose',
        pairedCode: code,
      });
    }
  }

  // Code↔date lists come first, so a paired code is never also emitted as a
  // bare, unexplained value.
  const pairedCodes = new Set<string>();
  for (const fact of extractPairedCodeLists(summaryText)) {
    const key = `${fact.concept}|${fact.value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (fact.concept === 'production_code' || fact.concept === 'lot') {
      pairedCodes.add(fact.value.toLowerCase());
    }
    facts.push(fact);
  }

  for (const [labelPattern, concept, strictness] of LABEL_PATTERNS) {
    const connector = strictness === 'explicit' ? EXPLICIT_CONNECTOR : CONNECTOR;
    const patterns = [
      new RegExp(String.raw`\b(${labelPattern})\b${connector}${FILLER}${VALUE}`, 'gi'),
      new RegExp(String.raw`\b(${labelPattern})\b${CLAUSE_THEN_COLON}${VALUE}`, 'gi'),
    ];
    for (const match of patterns.flatMap((pattern) => [...summaryText.matchAll(pattern)])) {
      const sourceLabel = match[1].replace(/\s+/g, ' ').trim();
      const rawValue = cleanValue(continueAcrossSemicolons(summaryText, match));
      if (rawValue === '') continue;

      // A list of values under one label becomes one fact per value. Date
      // lists split too — "SEP 01 2026", …, and "SEP 07 2026" is five dates,
      // and validating them as one string rejects the lot for being long —
      // EXCEPT a bounded span ("between X and Y"), whose "and" joins the two
      // ends of one range and must reach the date model whole. The comma
      // guard keeps "June 19, 2026" intact: a comma before a bare year is
      // part of the date, not a list separator.
      const isDateList =
        concept === 'best_by' ||
        concept === 'use_by' ||
        concept === 'sell_by' ||
        concept === 'expiration' ||
        concept === 'freeze_by' ||
        concept === 'production_date';
      const bounded = /^(?:between|from|ranging)\b/i.test(rawValue);
      // A trailing placement phrase ("…, back of package") is lifted BEFORE a
      // date list splits, so it survives as its own fact instead of becoming
      // a digit-less "date" the validators drop.
      const placement = isDateList && !bounded ? splitTrailingPlacement(rawValue) : null;
      if (placement?.placement) {
        const key = `identifier_location|${placement.placement.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          facts.push({
            concept: 'identifier_location',
            sourceLabel,
            value: placement.placement,
            raw: rawValue,
            evidence: 'prose',
          });
        }
      }
      // One separator policy for every identifier family, so a connector can
      // never survive as part of a code ("& 233") and a semicolon-delimited
      // list splits exactly as a comma-delimited one does.
      const parts =
        concept === 'lot' ||
        concept === 'upc' ||
        concept === 'item_number' ||
        concept === 'case_code' ||
        concept === 'production_code'
          ? splitIdentifierList(rawValue)
          : isDateList && !bounded
            ? splitDateList(placement?.value ?? rawValue)
            : [rawValue];
      for (const part of parts) {
        // A part that repeats a field label inside itself is either that
        // label's own noise ("lot code 22740") or a different labelled
        // statement the split tore loose ("date code of 17037"). The second
        // kind ends this list: everything after it was stated under the OTHER
        // label, and reading on files one label's values under another's.
        const resolved = resolveEmbeddedLabel(concept, cleanValue(part));
        if (resolved === null) break;
        const cleaned = cleanValue(
          CODE_CONCEPTS.has(concept) ? stripTrailingProse(resolved) : resolved,
        );
        // Before a date, a leading "on" is the connector the label handed off
        // with — "best by date on 05/2026" states May 2026 — exactly as a
        // leading "of" is. Before a CODE the same word means placement, which
        // is why only dates strip it.
        const value = isDateList
          ? withoutTrailingDateWord(cleaned.replace(/^on\s+/i, ''))
          : cleaned;
        if (!isPlausibleValue(concept, value)) continue;
        // A code already published with its calendar date is fully described
        // by that pair; re-emitting the bare code loses the explanation.
        if (pairedCodes.has(value.toLowerCase())) continue;
        const key = `${concept}|${value.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        facts.push({ concept, sourceLabel, value, raw: value, evidence: 'prose' });
      }
    }
  }
  // Labeled date spans the connector grammar cannot reach: the label sits in
  // quotes with a plural "dates" bridge — '"USE BY" dates between 6/25/26 and
  // 6/10/27', '“best by” dates up to January 23, 2022'. The bound phrase is
  // captured whole so the shared date model reads it as one range or
  // qualified date, never as endpoint fragments.
  const DATE_LABEL_FAMILY: [string, ConsumerConcept][] = [
    ['best[- ]?(?:if[- ]?used[- ]?)?by', 'best_by'],
    ['best[- ]?before', 'best_by'],
    ['use[- ]?by', 'use_by'],
    ['sell[- ]?by', 'sell_by'],
    ['expiration|expiry', 'expiration'],
  ];
  for (const [labelPattern, concept] of DATE_LABEL_FAMILY) {
    const pattern = new RegExp(
      String.raw`\b(${labelPattern})\b[”"’']?\s+dates?\s+(?:of\s+)?((?:between|from|up\s+to|through|ranging)\s+[^.;:\n"“”]{4,70}?)(?=[.;\n]|,?\s+(?:located|printed|marked|stamped|found|represented|shown|displayed|embossed)\b|$)`,
      'gi',
    );
    for (const match of summaryText.matchAll(pattern)) {
      const value = cleanValue(match[2]);
      if (!/\d/.test(value)) continue;
      const key = `${concept}|${value.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      facts.push({
        concept,
        sourceLabel: match[1].replace(/\s+/g, ' ').trim(),
        value,
        raw: match[0],
        evidence: 'prose',
      });
    }
  }

  // A range rather than a list: "Lot number … range from 2622404 to 2772412".
  // The source has stated exactly which packages are affected; a consumer can
  // check their own code against the bounds, so dropping this as "no codes
  // stated" would be both a miss and untrue.
  for (const [labelPattern, concept] of LABEL_PATTERNS) {
    if (concept !== 'lot' && concept !== 'case_code' && concept !== 'item_number') continue;
    const pattern = new RegExp(
      String.raw`\b(${labelPattern})\b[^.\n]{0,80}?\b(?:rang(?:e|es|ed|ing)\s+from|between)\s+([A-Z0-9][A-Z0-9-]{2,20})\s+(?:to|and|through|[–—-])\s+([A-Z0-9][A-Z0-9-]{2,20})`,
      'gi',
    );
    for (const match of summaryText.matchAll(pattern)) {
      const value = `${match[2]} to ${match[3]}`;
      const key = `${concept}|${value.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      facts.push({
        concept,
        sourceLabel: match[1].replace(/\s+/g, ' ').trim(),
        value,
        raw: match[0],
        evidence: 'prose',
      });
    }
  }

  // Barcode continuation lists: "with UPC #199284530959 (4oz) and #199284306226
  // (12oz)" repeats the value but not the label, so a label-anchored match
  // finds only the first. Within a sentence that names UPC, a run of digits of
  // a valid barcode length continues that label — but ONLY where no other
  // label already owns it. A UPC-compatible length is not evidence of
  // anything: AquaStar prints "Best Before: 10 22 2027" beside its barcodes,
  // and eight digits made that date a second barcode on the shelf-check the
  // consumer is asked to perform.
  for (const sentence of summaryText.split(/(?<=[.!?])\s+|\n/)) {
    if (!/\bU\.?P\.?C\.?\b/i.test(sentence)) continue;
    for (const run of sentence.matchAll(/#?\b(\d[\d\s-]{6,17}\d)\b/g)) {
      // Ownership first, in both the forms this module can prove it: the label
      // governing this position, and the label-anchored facts already emitted.
      if (run.index !== undefined && !barcodeLabelGoverns(sentence, run.index)) continue;
      if (claimedByAnotherLabel(facts, run[1])) continue;
      // A caption like "UPC Bottom of Package:2 041548816678" puts a stray
      // digit against the barcode, and 1 + 12 digits is itself a valid EAN-13
      // length — so the corrupted value would pass. When one whitespace-
      // separated segment is a complete barcode on its own, that segment is
      // the barcode; a genuinely spaced UPC ("6 28634 44216 6") has no such
      // segment, so its grouping is left intact.
      const segments = run[1].trim().split(/\s+/);
      const standalone = segments.find((segment) =>
        [8, 12, 13, 14].includes(segment.replace(/\D/g, '').length),
      );
      const value = segments.length > 1 && standalone ? standalone : run[1];
      const digits = value.replace(/\D/g, '');
      if (![8, 12, 13, 14].includes(digits.length)) continue;
      const key = `upc|${value.trim().toLowerCase()}`;
      if (seen.has(key)) continue;
      // Skip a value already captured in another spacing form.
      if (facts.some((f) => f.concept === 'upc' && f.value.replace(/\D/g, '') === digits)) continue;
      seen.add(key);
      facts.push({
        concept: 'upc',
        sourceLabel: 'UPC',
        value: value.trim(),
        raw: run[1].trim(),
        evidence: 'prose',
      });
    }
  }

  return { facts, statesNoCodes };
}

/**
 * Product lines that carry their own inline identifiers, e.g.
 * "PRIVATE SELECTION FROZEN TRIPLE BERRY MEDLEY, 48 OZ (BEST BY: 07-07-20; UPC: 0001111079120)".
 * Each becomes an affected version with its identifying facts attached, which
 * is far more useful than a flat list of codes with no product to match them to.
 */
export function extractProseVariantLines(
  summaryText: string | null,
): { name: string; facts: SemanticFact[] }[] {
  if (!summaryText) return [];
  const out: { name: string; facts: SemanticFact[] }[] = [];
  const seen = new Set<string>();

  for (const rawLine of summaryText.split('\n')) {
    const line = rawLine.trim();
    if (line.length < 12 || line.length > 300) continue;
    // Require a parenthesized identifier block: that is what distinguishes a
    // product line from ordinary prose.
    const match = line.match(/^([^(]{4,120}?)\s*\(([^)]{6,200})\)\s*[.;]?$/);
    if (!match) continue;
    const inner = match[2];
    if (!/\b(?:UPC|LOT|BATCH|BEST|USE|SELL|EXP)\b/i.test(inner)) continue;

    const name = cleanValue(match[1]).replace(/[,;]$/, '');
    if (name.length < 4 || /\b(?:consumers?|recall(?:ed|ing)?|company|contact)\b/i.test(name))
      continue;
    const { facts } = extractProseIdentifiers(inner);
    if (facts.length === 0) continue;

    const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, facts });
  }
  return out;
}
