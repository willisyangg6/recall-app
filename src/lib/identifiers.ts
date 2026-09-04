/**
 * Consumer Projection V2 — identifier normalization.
 *
 * Turns the source's own identifier text into values a person can compare
 * against a package in their hand, without ever changing what the source
 * said. Every function here is lossless-or-nothing: a value is normalized only
 * when the transformation is unambiguous, and the raw source text is always
 * carried alongside for provenance.
 */

import { splitIdentifierList } from './identifier-lists';

/** A consumer-ready identifier value plus the source text it came from. */
export interface NormalizedValue {
  /** What the consumer sees. */
  display: string;
  /** Exactly what the source said. */
  raw: string;
  /**
   * Identity of the underlying fact, independent of how the source spelled it.
   * Two spellings of one date ("2026 AUGUST 31" and "August 31, 2026") share a
   * canonical key, which is what stops both forms from rendering side by side.
   * Absent when the value could not be resolved to a canonical form.
   */
  canonical?: string;
}

// ── Shared consumer value formatting ────────────────────────────────────────

/** Units a measurement may carry. Anything else is left exactly as written. */
const MEASURE_UNITS =
  '(?:oz|ounces?|lbs?|pounds?|g|grams?|kg|mg|ml|l|liters?|litres?|ct|count|pk|packs?|qt|quarts?|pt|pints?|gal|gallons?|fl\\s?oz)';

/**
 * Put the space back between a number and its unit ("3oz" → "3 oz").
 *
 * Purely presentational and reversible: digits, unit spelling, and everything
 * around them are preserved, so "12 oz (340g)" becomes "12 oz (340 g)" and an
 * unrecognized unit is never touched. Applied through the whole projection so
 * sizes read consistently no matter which source shape produced them.
 */
export function formatMeasurements(value: string): string {
  return value.replace(
    new RegExp(String.raw`(\d)\s*(${MEASURE_UNITS})\b`, 'gi'),
    (_match, digit: string, unit: string) => `${digit} ${unit.replace(/\s+/g, ' ')}`,
  );
}

/**
 * Sentence-style casing for a safe textual package value: the first letter is
 * capitalized and NOTHING else is changed, so FSIS's "vacuum package" and
 * FDA's "glass jars" both read as consumer copy ("Vacuum package") while
 * acronyms, brands, codes, and proper names inside the value keep the casing
 * the source gave them. This is the one shared renderer both agencies' values
 * flow through — consumer display is agency-neutral by construction.
 */
export function sentenceCaseValue(value: string): string {
  // Only a value that OPENS with a lowercase word is adjusted — "12 oz
  // plastic cups" starts with its measurement and reads correctly as is.
  const letter = value.charAt(0);
  if (letter === '' || letter !== letter.toLowerCase() || !/[a-z]/.test(letter)) return value;
  // Only a word that is lowercase THROUGHOUT is safely a common noun; "iPhone"
  // -style casing is intentional and stays.
  const word = value.match(/^[A-Za-z]+/)?.[0] ?? '';
  if (word !== word.toLowerCase()) return value;
  return `${letter.toUpperCase()}${value.slice(1)}`;
}

// ── Barcodes ────────────────────────────────────────────────────────────────

/**
 * A printed UPC is often spaced for legibility ("6 28634 44216 6"). Removing
 * the separators is lossless, and the digits are what a shopper compares
 * against the barcode. Leading zeroes are significant and preserved.
 *
 * Only 8/12/13/14-digit runs (UPC-E, UPC-A, EAN-13, GTIN-14) qualify —
 * arbitrary numbers are never relabeled as barcodes.
 */
const BARCODE_LENGTHS = [8, 12, 13, 14];

export function normalizeUpc(raw: string): NormalizedValue | null {
  const trimmed = raw.trim();
  // Reject anything carrying non-separator characters: a real UPC value is
  // digits plus spaces/hyphens only.
  if (!/^[\d\s-]+$/.test(trimmed)) return null;

  // A caption like "UPC Bottom of Package:2 041548816678" leaves a stray digit
  // against the barcode, and 1 + 12 digits is itself a valid EAN-13 length, so
  // the corrupted number would pass unnoticed. When one whitespace-separated
  // segment is a complete barcode by itself, that segment is the barcode; a
  // genuinely spaced UPC ("6 28634 44216 6") groups into 1/5/5/1 and has no
  // such segment, so its digits are read as one value.
  const segments = trimmed.split(/\s+/);
  const standalone = segments.find((segment) =>
    BARCODE_LENGTHS.includes(segment.replace(/\D/g, '').length),
  );
  const value = segments.length > 1 && standalone ? standalone : trimmed;

  const digits = value.replace(/\D/g, '');
  if (!BARCODE_LENGTHS.includes(digits.length)) return null;
  return { display: digits, raw: trimmed, canonical: `upc:${digits}` };
}

/**
 * Split a source cell that lists several barcodes into individual values,
 * through the one shared separator policy. A slash used as a list separator
 * ("012345 / 067890") is barcode-specific and handled here; inside a code a
 * slash is meaningful and left alone.
 */
export function normalizeUpcList(raw: string): NormalizedValue[] {
  const out: NormalizedValue[] = [];
  for (const part of splitIdentifierList(raw.replace(/\/(?=\s)/g, ','))) {
    const normalized = normalizeUpc(part.replace(/^[^\d]*/, '').replace(/[^\d\s-]*$/, ''));
    if (normalized && !out.some((v) => v.display === normalized.display)) out.push(normalized);
  }
  return out;
}

// ── Dates ───────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** A calendar day resolved from source text. */
interface CalendarDay {
  year: number;
  month: number;
  day: number;
}

/** Two-digit years in recall notices are always this century. */
function fullYear(text: string): number {
  const value = Number(text);
  return text.length === 2 ? 2000 + value : value;
}

function isValidDay({ year, month, day }: CalendarDay): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1990 || year > 2100) return false;
  return new Date(Date.UTC(year, month - 1, day)).getUTCDate() === day;
}

const MONTH_NAME = String.raw`([A-Za-z]{3,9})\.?`;

/**
 * The Canadian bilingual month symbols (CFIA's official set), printed on
 * imported products as "2028 FE 04". Both live FSIS examples corroborate the
 * reading from the notice's own text: BCI Foods' soup can marked "2028 FE 04"
 * was "produced on February 4, 2026" — the marking is the production day plus
 * exactly the two-year shelf life. Only the exact uppercase code set ever
 * matches; "NO" here can only be November because it stands in a date shape.
 */
const BILINGUAL_MONTHS: Record<string, number> = {
  JA: 1,
  FE: 2,
  MR: 3,
  AL: 4,
  MA: 5,
  JN: 6,
  JL: 7,
  AU: 8,
  SE: 9,
  OC: 10,
  NO: 11,
  DE: 12,
};

/**
 * Parse one calendar day from the shapes announcements actually print.
 *
 * Numeric dates are read month-first. Every source here is a US federal
 * notice, where M/D/Y is the convention — and where the first component
 * exceeds 12 it cannot be a month, so that reading is rejected rather than
 * guessed at. Anything that does not resolve returns null and keeps the
 * source's own wording downstream.
 */
function parseCalendarDay(text: string): CalendarDay | null {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  const candidates: [RegExp, (m: RegExpMatchArray) => CalendarDay | null][] = [
    // 2026-08-31 (ISO is unambiguous)
    [
      /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
      (m) => ({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }),
    ],
    // 2026 AUGUST 31
    [
      new RegExp(`^(\\d{4})\\s+${MONTH_NAME}\\s+(\\d{1,2})$`),
      (m) => ({ year: Number(m[1]), month: MONTHS[m[2].toLowerCase()], day: Number(m[3]) }),
    ],
    // AUGUST 31, 2026 / AUG 31 2026
    [
      new RegExp(`^${MONTH_NAME}\\s+(\\d{1,2}),?\\s+(\\d{2,4})$`),
      (m) => ({ year: fullYear(m[3]), month: MONTHS[m[1].toLowerCase()], day: Number(m[2]) }),
    ],
    // 31 AUGUST 2026 / 14FEB2026
    [
      new RegExp(`^(\\d{1,2})\\s*${MONTH_NAME},?\\s*(\\d{2,4})$`),
      (m) => ({ year: fullYear(m[3]), month: MONTHS[m[2].toLowerCase()], day: Number(m[1]) }),
    ],
    // Jun-03-24 / JUN.03.24 — a month name inside a numeric separator run.
    [
      new RegExp(`^${MONTH_NAME}[/.-](\\d{1,2})[/.-](\\d{2,4})$`),
      (m) => ({ year: fullYear(m[3]), month: MONTHS[m[1].toLowerCase()], day: Number(m[2]) }),
    ],
    // 2026.07.11 — year first with dots, unambiguous like ISO.
    [
      /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/,
      (m) => ({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }),
    ],
    // 02/14/2026, 2-14-26, 2.14.26 — month first, per US convention.
    [
      /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/,
      (m) => ({ year: fullYear(m[3]), month: Number(m[1]), day: Number(m[2]) }),
    ],
    // 11 19 2027, 03 26 27 — the same month-first numeric date with spaces
    // instead of separators, which is how AquaStar's notices print their
    // best-by markings. The token must be COMPLETE: three numeric groups and
    // nothing else, the first two of one or two digits. That anchoring is
    // what keeps a lot code out — "10662 5085 10" opens with five digits and
    // can never match — and the month/day validation below rejects a
    // day-first reading ("30 10 2026") rather than guessing at it.
    [
      /^(\d{1,2})\s+(\d{1,2})\s+(\d{2}|\d{4})$/,
      (m) => ({ year: fullYear(m[3]), month: Number(m[1]), day: Number(m[2]) }),
    ],
    // 2028 FE 04 — Canadian bilingual month symbol on imported product.
    [
      /^(\d{4})\s+([A-Z]{2})\s+(\d{1,2})$/,
      (m) => {
        const month = BILINGUAL_MONTHS[m[2]];
        return month ? { year: Number(m[1]), month, day: Number(m[3]) } : null;
      },
    ],
  ];
  for (const [pattern, extract] of candidates) {
    const match = trimmed.match(pattern);
    if (!match) continue;
    const day = extract(match);
    if (day && !Number.isNaN(day.month) && isValidDay(day)) return day;
  }
  return null;
}

function formatDay({ year, month, day }: CalendarDay): string {
  return `${MONTH_NAMES[month - 1]} ${day}, ${year}`;
}

function canonicalDay({ year, month, day }: CalendarDay): string {
  return `date:${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * A month/year marking with no day: "05/27" on a supplement bottle means
 * May 2027. Sources print these constantly, and the two honest options are to
 * render the granularity the source stated or nothing — inventing a day would
 * tell a shopper to compare against a date their package does not carry.
 *
 * The numeric form is accepted only when the first part can only be a month
 * and the year lands in the plausible recall window; anything else keeps the
 * source's own wording.
 */
function parseMonthYear(text: string): { year: number; month: number } | null {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  const numeric = trimmed.match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/);
  if (numeric) {
    const month = Number(numeric[1]);
    const year = numeric[2].length === 2 ? 2000 + Number(numeric[2]) : Number(numeric[2]);
    // Two-digit years are bounded tightly: "05/98" is likelier to be a day
    // than the year 2098, so it is left exactly as written.
    const plausible =
      numeric[2].length === 2 ? year >= 2015 && year <= 2049 : year >= 1990 && year <= 2100;
    if (month >= 1 && month <= 12 && plausible) return { year, month };
    return null;
  }
  const named = trimmed.match(new RegExp(`^${MONTH_NAME},?\\s+(\\d{4})$`));
  if (named) {
    const month = MONTHS[named[1].toLowerCase()];
    const year = Number(named[2]);
    if (month && year >= 1990 && year <= 2100) return { year, month };
  }
  return null;
}

function formatMonthYear({ year, month }: { year: number; month: number }): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function canonicalMonthYear({ year, month }: { year: number; month: number }): string {
  return `month:${year}-${String(month).padStart(2, '0')}`;
}

/** Qualifiers that change what a date means and must survive normalization. */
const DATE_QUALIFIER =
  /^(through|thru|before|on or before|on or after|after|up to and including|up to|no later than|beginning|starting)\s+/i;

/** How a qualifier reads once it opens the displayed value. */
const QUALIFIER_DISPLAY: Record<string, string> = {
  through: 'Through',
  thru: 'Through',
  before: 'Before',
  'on or before': 'On or before',
  'on or after': 'On or after',
  after: 'After',
  'up to and including': 'Through',
  'up to': 'Through',
  'no later than': 'No later than',
  beginning: 'Beginning',
  starting: 'Beginning',
};

/** Separators a source uses between the two ends of a date range. */
const RANGE_SEPARATOR = /\s*(?:–|—|-|\bto\b|\bthrough\b|\bthru\b)\s*/i;

/**
 * Normalize a date value into one consumer standard: `February 14, 2026`.
 *
 * Three shapes are handled, and nothing else is touched:
 *
 *   single    "02/14/2026", "14FEB2026", "2026 AUGUST 31" → February 14, 2026
 *   range     "7/13/2026 - 8/11/2026"                     → July 13–August 11, 2026
 *   qualified "through February 27, 2026"                 → Through February 27, 2026
 *
 * A qualifier is meaning, not formatting: "through February 27" covers every
 * date up to that day, so collapsing it to a single date would misstate which
 * packages are affected. The source's exact wording is always preserved in
 * `raw`, and any value that does not resolve is returned untouched.
 */
export function normalizeDateValue(raw: string): NormalizedValue {
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  const unchanged: NormalizedValue = { display: trimmed, raw: trimmed };
  if (trimmed === '') return unchanged;

  // A leading qualifier is lifted off, the rest normalized, then restored.
  const qualifier = trimmed.match(DATE_QUALIFIER);
  if (qualifier) {
    const rest = normalizeDateValue(trimmed.slice(qualifier[0].length));
    if (rest.canonical === undefined) return unchanged;
    const word = QUALIFIER_DISPLAY[qualifier[1].toLowerCase()] ?? qualifier[1];
    return {
      display: `${word} ${rest.display}`,
      raw: trimmed,
      canonical: `${word.toLowerCase()}|${rest.canonical}`,
    };
  }

  const single = parseCalendarDay(trimmed);
  if (single) {
    return { display: formatDay(single), raw: trimmed, canonical: canonicalDay(single) };
  }

  // Month/year granularity ("05/27" → May 2027) — never given an invented day.
  const monthYear = parseMonthYear(trimmed);
  if (monthYear) {
    return {
      display: formatMonthYear(monthYear),
      raw: trimmed,
      canonical: canonicalMonthYear(monthYear),
    };
  }

  // "from 4/26/2018 to 10/10/2018", "between July 20, 2026 and August 17,
  // 2026", "ranging 9/1/24 – 11/23/24" — the lead-in is grammar, not a
  // qualifier, but it changes the grammar of the rest: after "between" or
  // "from", the word "and" separates the two ENDS of one span, where in any
  // other date value it separates entries in a list.
  const bounded = trimmed.match(/^(?:from|between|ranging(?:\s+from|\s+between)?)\s+/i);
  const rangeText = bounded ? trimmed.slice(bounded[0].length) : trimmed;
  const separator = bounded
    ? /\s*(?:–|—|-|\bto\b|\bthrough\b|\bthru\b|\band\b)\s*/i
    : RANGE_SEPARATOR;
  // A range's ends often carry the list punctuation the source wrote around
  // its connector ("from July 8, 2026, to June 29, 2027" leaves a trailing
  // comma on the start date). The comma is grammar, not date content, so it is
  // trimmed before each end is read — without this the range fails to parse
  // and downstream list-splitting shows the two ENDPOINTS of a span as two
  // separate days, which misstates which packages are affected.
  const parts = rangeText.split(separator).map((part) => part.replace(/^[\s,]+|[\s,.]+$/g, ''));
  if (parts.length === 2) {
    let start = parseCalendarDay(parts[0]);
    const end = parseCalendarDay(parts[1]);
    // "July 20 – August 17, 2026" states the year once, at the end; the start
    // borrows it. Only a bare month-and-day start qualifies, so a start that
    // stated its own year is never rewritten.
    if (!start && end) {
      const monthDay = parts[0].trim().match(new RegExp(`^${MONTH_NAME}\\s+(\\d{1,2})$`));
      if (monthDay) {
        const candidate = {
          year: end.year,
          month: MONTHS[monthDay[1].toLowerCase()],
          day: Number(monthDay[2]),
        };
        if (!Number.isNaN(candidate.month) && isValidDay(candidate)) start = candidate;
      }
    }
    if (start && end) {
      // Within one year the year is stated once; across years both are needed,
      // because that distinction is exactly what a shopper is checking.
      const display =
        start.year === end.year
          ? `${MONTH_NAMES[start.month - 1]} ${start.day}–${formatDay(end)}`
          : `${formatDay(start)}–${formatDay(end)}`;
      return {
        display,
        raw: trimmed,
        canonical: `range:${canonicalDay(start)}:${canonicalDay(end)}`,
      };
    }
    // A month-granular span: "between November 2028 through May 2029". The
    // source stated no days, so none are invented — the range keeps the
    // month/year granularity at both ends.
    const startMonth = parseMonthYear(parts[0]);
    const endMonth = parseMonthYear(parts[1]);
    if (startMonth && endMonth) {
      return {
        display: `${formatMonthYear(startMonth)}–${formatMonthYear(endMonth)}`,
        raw: trimmed,
        canonical: `range:${canonicalMonthYear(startMonth)}:${canonicalMonthYear(endMonth)}`,
      };
    }
  }
  return unchanged;
}

/** Label abbreviations a source prefixes to the date itself. */
const DATE_LABEL_PREFIX = /^(?:bb|bbe|bb\/|best before|best by|exp\.?|use by|sell by)\b[:.\s]*/i;

/**
 * Pull a date out of a cell that also holds something else.
 *
 * Real cells read "03-15-2024 product of USA" or "BB 11/13/2024" — the date is
 * there, wrapped in a label abbreviation or trailing marketing text. Extracting
 * it is what lets the value reach the one consumer date format instead of being
 * shown exactly as the source typed it.
 */
export function extractDate(value: string): NormalizedValue | null {
  const stripped = value.replace(/\s+/g, ' ').trim().replace(DATE_LABEL_PREFIX, '');
  const direct = normalizeDateValue(stripped);
  if (direct.canonical) return direct;
  const found = stripped.match(
    /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{2,4}\b|\b\d{1,2}\s*[A-Za-z]{3,9}\.?\s*\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/,
  );
  if (!found) return null;
  const parsed = normalizeDateValue(found[0]);
  return parsed.canonical ? { ...parsed, raw: value.trim() } : null;
}

/**
 * Resolve an ambiguous numeric date using the printed code the source paired
 * with it.
 *
 * "26192 (07/11/26)" looks like two unrelated tokens, but 26192 is a Julian
 * pack code — year 26, day 192 — and day 192 of 2026 IS July 11. The notice
 * has therefore stated the same day twice, and the agreement between its own
 * two representations proves the numeric date is month-first. Only then is it
 * reformatted; a code that does not resolve, or resolves to a different day,
 * leaves the source wording exactly as written.
 *
 * This is the general principle of the projection in miniature: normalize when
 * the source itself supplies the evidence, never on assumption.
 */
export function resolveDateWithCode(date: string, code: string): NormalizedValue {
  const trimmed = date.replace(/\s+/g, ' ').trim();
  const unchanged: NormalizedValue = { display: trimmed, raw: trimmed };

  const julian = code.trim().match(/^(\d{2})(\d{3})$/);
  const numeric = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!julian || !numeric) return unchanged;

  const codeYear = 2000 + Number(julian[1]);
  const dayOfYear = Number(julian[2]);
  if (dayOfYear < 1 || dayOfYear > 366) return unchanged;
  const resolved = new Date(Date.UTC(codeYear, 0, dayOfYear));
  if (resolved.getUTCFullYear() !== codeYear) return unchanged;
  const month = resolved.getUTCMonth() + 1;
  const day = resolved.getUTCDate();

  const [, first, second, yearText] = numeric;
  const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
  if (year !== codeYear) return unchanged;
  // The two readings of the numeric date; the code must confirm one of them.
  const agrees =
    (Number(first) === month && Number(second) === day) ||
    (Number(second) === month && Number(first) === day);
  if (!agrees) return unchanged;

  return {
    display: `${MONTH_NAMES[month - 1]} ${day}, ${year}`,
    raw: trimmed,
    canonical: `date:${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

/**
 * Sort key for a normalized date, so a variant's dates read chronologically
 * rather than in whatever order the source printed them. Values that could not
 * be resolved to a calendar date keep source order (they sort last).
 */
export function dateSortKey(value: NormalizedValue): string {
  if (value.canonical?.startsWith('date:')) return value.canonical.slice(5);
  // "2027-05" sorts with (just ahead of) that month's days, which is where a
  // month-granular marking belongs chronologically.
  if (value.canonical?.startsWith('month:')) return value.canonical.slice(6);
  // A range sorts by where it begins.
  if (value.canonical?.startsWith('range:')) return value.canonical.split(':')[2] ?? '￿';
  return '￿';
}

// ── Placement phrases riding inside a value ─────────────────────────────────

/** On-package placement, as the source phrases it at the end of a value. */
const TRAILING_PLACEMENT =
  /[,;(]?\s*((?:located\s+|printed\s+|stamped\s+|found\s+)?(?:on|in|at|under|beneath|below)?\s*(?:the\s+)?(?:back|front|bottom|top|side|reverse|lid|cap|panel|end|neck|shoulder)\b[^,;)\n]{0,40})\)?\s*$/i;

/**
 * Split a trailing placement phrase off a value: FDA photo captions and table
 * cells routinely append where to look to the value itself
 * ("2026 AUGUST 31, back of package"). Left in place it corrupts the
 * identifier, defeats deduplication against the same date written plainly, and
 * reads as though the date itself were "back of package".
 */
export function splitTrailingPlacement(raw: string): { value: string; placement: string | null } {
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  const match = trimmed.match(TRAILING_PLACEMENT);
  if (!match || match.index === undefined || match.index < 2)
    return { value: trimmed, placement: null };
  const value = trimmed
    .slice(0, match.index)
    .replace(/[\s,;(]+$/, '')
    .trim();
  // Never strip so much that nothing identifying is left.
  if (value === '' || !/\w/.test(value)) return { value: trimmed, placement: null };
  return { value, placement: match[1].replace(/\s+/g, ' ').trim() };
}

// ── Compound source cells ───────────────────────────────────────────────────

export interface CompoundCell {
  /** Inline label prefix the source put inside the cell, if any. */
  inlineLabel: string | null;
  /** Parenthetical placement hint ("bottom of package"). */
  locationHint: string | null;
  /** Code/date pairs when the cell lists them together. */
  pairs: { code: string; date: string }[];
  /** Remaining value text after the prefix/hint are removed. */
  body: string;
}

/**
 * Real FDA table cells often pack a label, a placement hint, and a long list
 * of code–date pairs into one cell:
 *
 *   "Batch code/ Best Before (bottom of package): LLA616903 – 30 SEP 2027
 *    LLA617003 – 30 SEP 2027 …"
 *
 * Splitting this deterministically is what lets the UI show "Where to find it"
 * once, keep best-before dates separate from lot codes, and collapse the code
 * list behind progressive disclosure instead of dumping it on the page.
 */
export function splitCompoundCell(raw: string): CompoundCell {
  let text = raw.replace(/\s+/g, ' ').trim();
  let inlineLabel: string | null = null;
  let locationHint: string | null = null;

  // "<label> (<hint>): <body>" or "<label>: <body>"
  const labelled = text.match(/^([^:]{2,60}?)\s*(?:\(([^)]{2,60})\))?\s*:\s*(.*)$/s);
  if (labelled && /[a-z]/i.test(labelled[1])) {
    inlineLabel = labelled[1].trim();
    locationHint = labelled[2]?.trim() ?? null;
    text = labelled[3].trim();
  }
  if (!locationHint) {
    const parenthetical = text.match(
      /\(([^)]*\b(?:bottom|top|side|back|front|lid|cap|panel|label|package|packaging|pouch|bag|box|carton)\b[^)]*)\)/i,
    );
    if (parenthetical) {
      locationHint = parenthetical[1].trim();
      text = text.replace(parenthetical[0], ' ').replace(/\s+/g, ' ').trim();
    }
  }

  return { inlineLabel, locationHint, pairs: extractCodeDatePairs(text), body: text };
}

/** A printed date, in the shapes announcements actually use. */
const DATE_TOKEN = String.raw`\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{2,4}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{2,4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}`;

/**
 * Codes the source printed together with the calendar date they stand for, in
 * both observed forms:
 *
 *   "LLA616903 – 30 SEP 2027"      (dash-separated, Outshine)
 *   "26192 (07/11/26)"             (parenthesized, Dairyland Produce)
 *
 * Keeping the pair together is what lets the app lead with the date a person
 * can actually read while still showing the opaque code printed on the bag —
 * dropping either half loses information the consumer needs.
 */
export function extractCodeDatePairs(text: string): { code: string; date: string }[] {
  const pairs: { code: string; date: string }[] = [];
  const seen = new Set<string>();
  const patterns = [
    new RegExp(String.raw`\b([A-Z0-9][A-Z0-9-]{3,20})\s*[–—-]\s*(${DATE_TOKEN})`, 'g'),
    new RegExp(String.raw`\b([A-Z0-9][A-Z0-9-]{2,20})\s*\(\s*(${DATE_TOKEN})\s*\)`, 'g'),
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const code = match[1].trim();
      // A date must never be mistaken for the code standing beside it.
      if (new RegExp(`^(?:${DATE_TOKEN})$`).test(code)) continue;
      if (seen.has(code)) continue;
      seen.add(code);
      pairs.push({ code, date: match[2].trim() });
    }
  }
  return pairs;
}
