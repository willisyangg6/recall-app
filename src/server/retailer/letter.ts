/**
 * Read one retailer member letter into stated facts.
 *
 * Every value is either stated in the letter or null/[] — the parser never
 * infers. Evidence strings are verbatim excerpts of the letter's text with
 * runs of whitespace collapsed to one space (PDF line breaks fall mid-phrase,
 * "Item #1977696 Once\nUpon a Farm"), so each one can be found again in the
 * archived document.
 *
 * Fields that must never mix:
 *   - retailer item numbers ("Item #1777000") are not UPCs and never become
 *     one; UPCs are read only after an explicit "UPC" label;
 *   - a state is recorded only as a (retailer, state) pair read from a
 *     sentence that says the item was sold there;
 *   - package sizes are claims, not identifiers.
 */

import { upcDigitsIn } from '../duplicates';
import { POSTAL_TO_STATE, statesInText } from '../../domain/us-geography';

import type {
  DocumentExtraction,
  FoodStatus,
  NoticeKind,
  PackageClaim,
  ParsedNotice,
  RetailerIndexEntry,
  StateClaim,
} from './types';

export const LETTER_PARSER_VERSION = 'costco-letter/1';

const RETAILER_DISPLAY_NAME: Record<RetailerIndexEntry['publisher'], string> = {
  costco: 'Costco',
};

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const MONTH_ABBREVIATIONS = MONTHS.map((month) => month.slice(0, 3));

function isoDate(year: number, month: number, day: number): string | null {
  if (year < 100) year += 2000;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function monthNumber(name: string): number | null {
  const lower = name.toLowerCase().replace(/\.$/, '');
  const full = MONTHS.indexOf(lower);
  if (full >= 0) return full + 1;
  const abbreviation = MONTH_ABBREVIATIONS.indexOf(lower.slice(0, 3));
  return abbreviation >= 0 && lower.length <= 4 ? abbreviation + 1 : null;
}

/** One whole-line date, as letters print their own date. */
function parseDateLine(line: string): string | null {
  const body = line.replace(/^\s*date\s*:\s*/i, '').trim();
  let match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(body);
  if (match) return isoDate(Number(match[3]), Number(match[1]), Number(match[2]));
  match = /^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(body);
  if (match) {
    const month = monthNumber(match[1]);
    return month ? isoDate(Number(match[3]), month, Number(match[2])) : null;
  }
  return null;
}

/**
 * The letter's own date: a line near the top that is nothing but a date. A
 * date inside a sentence ("purchased between 10/11/2026 …") is never it, and
 * an undated letter stays undated — a filename such as `…_31426.pdf` is not a
 * statement.
 */
export function statedLetterDate(text: string): { iso: string | null; text: string | null } {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^_+$/.test(line))
    .slice(0, 12);
  for (const line of lines) {
    const iso = parseDateLine(line);
    if (iso) return { iso, text: line };
  }
  return { iso: null, text: null };
}

/** Code/scope dates in any of the forms member letters and agencies print. */
export function codeDatesIn(text: string): string[] {
  const found = new Set<string>();
  const add = (iso: string | null) => iso && found.add(iso);
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/g)) {
    add(isoDate(Number(m[3]), Number(m[1]), Number(m[2])));
  }
  for (const m of text.matchAll(/\b(\d{1,2})[\s-]([A-Za-z]{3,9})\.?[\s-](\d{4})\b/g)) {
    const month = monthNumber(m[2]);
    if (month) add(isoDate(Number(m[3]), month, Number(m[1])));
  }
  for (const m of text.matchAll(/\b([A-Za-z]{3,9})\.?[\s/-](\d{1,2}),?[\s/-](\d{4}|\d{2})\b/g)) {
    const month = monthNumber(m[1]);
    if (month) add(isoDate(Number(m[3]), month, Number(m[2])));
  }
  // Bare MMDDYY only where the letter says it is a code date ("Best By dates
  // ranging from 110825 through 011227").
  for (const m of text.matchAll(
    /\b(?:best\s*(?:if\s*used\s*)?by|sell\s*by|use\s*by|ranging\s+from|through)\b[^.]{0,60}/gi,
  )) {
    for (const d of m[0].matchAll(/\b(\d{2})(\d{2})(\d{2})\b/g)) {
      add(isoDate(Number(d[3]), Number(d[1]), Number(d[2])));
    }
  }
  return [...found].sort();
}

function sentencesOf(flat: string): string[] {
  return (
    flat
      // Never split after an initialism: "with the U.S. Consumer Product Safety
      // Commission" is one sentence.
      .split(/(?<![A-Z]\.[A-Z]\.)(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
      .map((sentence) => sentence.trim())
      .filter(Boolean)
  );
}

const RECALL_VERB =
  /\b(?:is|are)\s+(?:voluntarily\s+)?recalling\b|\bis\s+conducting\s+a\s+voluntary\s+recall\b|\b(?:announced|announcing|issued|issuing)\s+(?:a\s+|the\s+)?(?:voluntary\s+)?recall\b/i;
const SUBJECT_FILLER = /^(?:out of|guided by|due to|as a|in an|following|after)\b/i;
/** "…, in cooperation with the CPSC (CPSC)," — the agency is never the firm. */
const COOPERATION_CLAUSE =
  /,?\s*\b(?:in cooperation with|in conjunction with|together with|working with)\b[^,]*(?:,|$)/gi;
/** Where a letter's preamble ends: the greeting, a list's colon, a table row's ")". */
const PREAMBLE_END = /(?:Members?,|:|\))\s+/g;
const NOT_A_FIRM =
  /\b(?:Commission|Administration|Department|Notice)\b|^(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i;
const AGENCY_TAIL =
  /\s+(?:and|in cooperation with|together with|working with)\s+(?:the\s+)?(?:U\.?S\.?\s+)?(?:FDA|USDA|FSIS|Food and Drug Administration|Department of Agriculture|Consumer Product Safety Commission|CPSC)\b.*$/i;

function recallingFirm(sentences: string[]): { firm: string | null; evidence: string | null } {
  for (const sentence of sentences) {
    const verb = RECALL_VERB.exec(sentence);
    if (!verb) continue;
    let subject = sentence.slice(0, verb.index).replace(COOPERATION_CLAUSE, ' ');
    const boundaries = [...subject.matchAll(PREAMBLE_END)];
    const last = boundaries.at(-1);
    if (last) subject = subject.slice(last.index! + last[0].length);
    // The clause nearest the verb is the subject; earlier clauses are
    // preamble ("Costco records indicate that you, …, Bodum, is recalling").
    const segment = subject
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part && !SUBJECT_FILLER.test(part))
      .at(-1);
    const firm =
      segment
        ?.replace(AGENCY_TAIL, '')
        .replace(/\s+(?:is|are|has|have|was|were)$/i, '')
        .trim() ?? null;
    if (firm && firm.length <= 80 && /^[A-Z]/.test(firm) && !NOT_A_FIRM.test(firm)) {
      return { firm, evidence: sentence };
    }
    return { firm: null, evidence: sentence };
  }
  return { firm: null, evidence: null };
}

const AGENCY_PATTERNS: [string, RegExp][] = [
  ['FDA', /\bFDA\b|Food (?:&|and) Drug Administration/],
  ['USDA', /\bUSDA\b|Department of Agriculture/],
  ['FSIS', /\bFSIS\b|Food Safety and Inspection Service/],
  ['CPSC', /\bCPSC\b|Consumer Product Safety Commission/],
];

function noticeKind(sentences: string[]): { kind: NoticeKind; evidence: string | null } {
  const find = (pattern: RegExp) => sentences.find((sentence) => pattern.test(sentence)) ?? null;
  const pha = find(/public health alert/i);
  if (pha) return { kind: 'public_health_alert', evidence: pha };
  const safe = find(/\bremains safe\b|\bsafe to consume\b|\blimited to labeling only\b/i);
  if (safe) return { kind: 'quality_notice', evidence: safe };
  const recall = find(/\brecall(?:s|ed|ing)?\b/i);
  if (recall) return { kind: 'recall', evidence: recall };
  return { kind: 'unclear', evidence: null };
}

const FOOD_SIGNAL =
  /\b(?:FDA|USDA|FSIS|consume|consumption|eat|eating|edible|food|allergens?|allerg(?:y|ic)|salmonella|listeria|e\.\s?coli|botulism|undeclared|best\s+(?:if\s+used\s+)?by|best\s+before|sell\s+by|use\s+by|nutrition)\b/gi;
const NON_FOOD_SIGNAL =
  /\b(?:CPSC|Consumer Product Safety Commission|ladders?|heaters?|generators?|power stations?|coolers?|air ?fr[yi]ers?|french press(?:es)?|saunas?|cleaners?|chargers?|batter(?:y|ies)|plants?|infested|pests?|fire hazard|burn hazard|fall hazard|shock hazard|electrocution)\b/gi;

function foodStatus(flat: string): { status: FoodStatus; evidence: string[] } {
  const food = [...new Set((flat.match(FOOD_SIGNAL) ?? []).map((s) => s.toLowerCase()))];
  const nonFood = [...new Set((flat.match(NON_FOOD_SIGNAL) ?? []).map((s) => s.toLowerCase()))];
  const evidence = [...food.map((s) => `food:${s}`), ...nonFood.map((s) => `non_food:${s}`)];
  if (food.length > 0 && nonFood.length === 0) return { status: 'food', evidence };
  if (nonFood.length > 0 && food.length === 0) return { status: 'non_food', evidence };
  return { status: 'unclear', evidence };
}

function retailerItemNumbers(entry: RetailerIndexEntry, text: string): string[] {
  const found: string[] = [];
  const add = (value: string) => !found.includes(value) && found.push(value);
  for (const source of [entry.indexTitle, text]) {
    for (const m of source.matchAll(/\bitems?\b\s*(?:number\s*)?#?\s*(\d{5,8})\b/gi)) add(m[1]);
    for (const m of source.matchAll(/#\s?(\d{5,8})\b/g)) add(m[1]);
  }
  // A "Costco Item Number | Description" table: rows open with the number.
  const table = /Item Number[^\n]*\n([\s\S]*?)(?:\n\s*\n|$)/i.exec(text);
  if (table) for (const m of table[1].matchAll(/^(\d{6,8})\s+\S/gm)) add(m[1]);
  return found;
}

function upcs(flat: string, itemNumbers: string[]): string[] {
  const found = new Set<string>();
  for (const m of flat.matchAll(/\bUPC\b[^A-Za-z]{0,40}/gi)) {
    for (const digits of upcDigitsIn(m[0])) if (!itemNumbers.includes(digits)) found.add(digits);
  }
  return [...found];
}

const CODE_KEYWORD =
  /\b(?:lots?|best\s*(?:if\s*used\s*)?by|best\s*before|sell\s*by|use\s*by|item code|timestamps?|coded with|code dates?)\b/i;

const SIZE_TOKEN =
  /\b\d+(?:\.\d+)?\s?-?\s?(?:fl\.?\s?oz|oz|lbs?|kg|g|ml|l|ct|count|pk|pack)\b(?!\w)/gi;

export function normalizeSizeToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/[\s-]+/g, '')
    .replace(/count$/, 'ct')
    .replace(/pack$/, 'pk')
    .replace(/fl\.?oz$/, 'floz');
}

function packageClaims(sentences: string[], itemNumbers: string[]): PackageClaim[] {
  const claims: PackageClaim[] = [];
  for (const sentence of sentences) {
    const fragments: string[] = [];
    for (const item of itemNumbers) {
      const at = sentence.search(new RegExp(`#\\s?${item}\\b`));
      if (at < 0) continue;
      const tail = sentence.slice(at);
      const end = tail.search(/\s+between\b|[.;]\s|$/);
      fragments.push(tail.slice(0, end < 0 ? undefined : end));
    }
    const product = /\bProduct:\s*([^●]+?)(?=\s+●|\s+Lot:|$)/.exec(sentence);
    if (product) fragments.push(product[1]);
    for (const fragment of fragments) {
      const sizeTokens = [...new Set(fragment.match(SIZE_TOKEN) ?? [])].map((s) => s.trim());
      if (sizeTokens.length === 0) continue;
      if (claims.some((claim) => claim.text === fragment.trim())) continue;
      claims.push({
        text: fragment.trim(),
        sizeTokens,
        verifiedInAgencyNotice: null,
        unverifiedSizeTokens: [],
      });
    }
  }
  return claims;
}

const SOLD_SENTENCE =
  /\b(?:sold|distributed|available)\b[^.]{0,120}?\b(?:following states|states?:|locations in|warehouses?\b|stores? in)/i;

function stateClaims(sentences: string[], retailer: string): StateClaim[] {
  const claims: StateClaim[] = [];
  for (const sentence of sentences) {
    if (!SOLD_SENTENCE.test(sentence)) continue;
    const basis = /warehouse/i.test(sentence) ? 'named_store_locations' : 'stated_state_list';
    const named =
      basis === 'named_store_locations'
        ? [...sentence.matchAll(/,\s*([A-Z]{2})\b/g)]
            .map((match) => POSTAL_TO_STATE[match[1]])
            .filter((state): state is string => Boolean(state))
        : [];
    for (const state of [...statesInText(sentence), ...named]) {
      if (!claims.some((claim) => claim.state === state)) {
        claims.push({ retailer, state, basis, evidence: sentence });
      }
    }
  }
  return claims;
}

/** The raw scope phrase the index title carries after the item number. */
export function indexScopeText(title: string): string | null {
  const after = /\)\s*(.+)$/.exec(title)?.[1] ?? null;
  const candidate = after?.replace(/^[-–—\s]+|^for\s+/i, '').trim() ?? null;
  if (candidate && /\b(?:locations?|regions?|only|states?|all us)\b/i.test(candidate)) {
    return candidate;
  }
  const plain = /\b(?:All US Locations|[A-Za-z ]+ Only)\.?$/i.exec(title)?.[0] ?? null;
  return plain?.trim() ?? null;
}

export function parseLetter(
  entry: RetailerIndexEntry,
  extraction: DocumentExtraction,
  text: string,
): ParsedNotice {
  const retailer = RETAILER_DISPLAY_NAME[entry.publisher];
  const empty: ParsedNotice = {
    extraction,
    statedNoticeDate: null,
    statedNoticeDateText: null,
    recallingFirmText: null,
    recallingFirmEvidence: null,
    agenciesNamed: [],
    noticeKind: 'unclear',
    noticeKindEvidence: null,
    foodStatus: 'unclear',
    foodEvidence: [],
    retailerItemNumbers: retailerItemNumbers(entry, ''),
    upcs: [],
    codeEvidence: [],
    packageClaims: [],
    stateClaims: [],
    indexScopeText: indexScopeText(entry.indexTitle),
  };
  // A scan or an unreadable file is stored, never read by guesswork.
  if (extraction !== 'text') return empty;

  const flat = text.replace(/\s+/g, ' ').trim();
  const sentences = sentencesOf(flat);
  const date = statedLetterDate(text);
  const firm = recallingFirm(sentences);
  const kind = noticeKind(sentences);
  // The index title names the product ("… Cleaners") even when the letter doesn't.
  const food = foodStatus(`${entry.indexTitle} ${flat}`);
  const items = retailerItemNumbers(entry, text);

  return {
    ...empty,
    statedNoticeDate: date.iso,
    statedNoticeDateText: date.text,
    recallingFirmText: firm.firm,
    recallingFirmEvidence: firm.evidence,
    agenciesNamed: AGENCY_PATTERNS.filter(([, pattern]) => pattern.test(flat)).map(
      ([name]) => name,
    ),
    noticeKind: kind.kind,
    noticeKindEvidence: kind.evidence,
    foodStatus: food.status,
    foodEvidence: food.evidence,
    retailerItemNumbers: items,
    upcs: upcs(flat, items),
    codeEvidence: sentences.filter((sentence) => CODE_KEYWORD.test(sentence)),
    packageClaims: packageClaims(sentences, items),
    stateClaims: stateClaims(sentences, retailer),
  };
}
