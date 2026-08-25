/**
 * Consumer Projection V2 — the semantic layer between government source data
 * and the UI.
 *
 *   source data → parsed facts → consumer concepts → UI
 *
 * rather than "source table column → UI card". Everything here is a pure,
 * deterministic function of an already-persisted `CaseProjection`, so parser
 * improvements reach all stored cases with no re-ingestion, and nothing is
 * inferred that the source did not state.
 *
 * Governing product rule: the official notice is provenance, not required
 * reading. When a fact cannot be established we say so plainly ("Distribution
 * not specified.") and never send the user to a government page to finish a
 * normal task.
 */

import { normalizedAllergenTokens } from '@/domain/hazard';
import type { AffectedProduct, CaseProjection } from '@/domain/recall-types';
import { extractRetailerNames, isRetailerName, retailersWithPlaces } from '@/domain/retailer';
import { cleanDisplayText, stripHtml } from '@/domain/text';
import {
  isUsCityName,
  normalizeStateToken,
  splitAdjacentCities,
  statesInText,
} from '@/domain/us-geography';
import {
  CONCEPT_LABEL,
  conceptForLabel,
  isCodeAndDateLabel,
  isLayoutArtifactValue,
  normalizeLabel,
  PACKAGE_CONCEPT_PRIORITY,
  SUPPRESSED_CONCEPTS,
  type ConsumerConcept,
} from './consumer-concepts';
import { humanizeAllCaps, parseProductLine } from './consumer-summary';
import {
  APPROVED_CHANNELS,
  packageFieldFor,
  packageRejectionReason,
  PACKAGE_FIELD_LABEL,
  PACKAGE_FIELD_ORDER,
  type PackageField,
  type RejectedFact,
} from './consumer-schema';
import { composeCodeLocation, isValidForConcept, type CodeLocation } from './fact-types';
import {
  dateSortKey,
  extractCodeDatePairs,
  extractDate,
  formatMeasurements,
  normalizeDateValue,
  normalizeUpcList,
  resolveDateWithCode,
  sentenceCaseValue,
  splitCompoundCell,
  splitTrailingPlacement,
} from './identifiers';
import {
  extractProductPhotos,
  galleryPhotos,
  primaryPhoto,
  type ProductPhoto,
} from './product-photos';
import { extractProseIdentifiers, extractProseVariantLines } from './prose-identifiers';
import { consumerActionDisplay } from './recall-display';
import { extractAffectedProductLists, extractDistributionListStates } from './source-lists';
import { interpretTables, type SemanticFact } from './source-tables';
import { isGeographicName, variantIdentityRejection } from './variant-identity';

// ── Output shape ────────────────────────────────────────────────────────────

export interface ConceptValues {
  concept: ConsumerConcept;
  /** Consumer label ("Barcode (UPC)"), never a raw source heading. */
  label: string;
  /** Deduplicated, display-normalized values. */
  values: string[];
  /** The corresponding source text, for provenance. */
  raw: string[];
  /**
   * Identity of each value independent of source spelling. Two spellings of
   * one fact share a key, which is both how duplicates are collapsed and how
   * a case-level value is recognized as already belonging to a variant.
   */
  canonicalKeys: string[];
  /** True when the source called these batch codes rather than lot codes. */
  isBatch: boolean;
}

export interface AffectedVariant {
  /** Recognizable name of this affected version. */
  name: string;
  /**
   * This version's identifying details, drawn ONLY from the approved package
   * field vocabulary and always in the same order. A source column we have no
   * approved field for cannot appear here — it is recorded in `rejected`.
   */
  fields: PackageField[];
  /** Extracted, deliberately not rendered. Development/QA provenance only. */
  rejected: RejectedFact[];
  /** Where this version's codes are, when it genuinely differs from the rest. */
  codeLocation: CodeLocation | null;
  /** This version's own codes, when the source lists them per version. */
  lotCodes: LotCodeSet | null;
  /** The source's own photo of this version, when it establishes one. */
  photo: ProductPhoto | null;
  /** Source identity of the row/line this version came from. */
  scope: string | null;
}

export interface LotCodeSet {
  count: number;
  /** Every affected code, shown only behind explicit disclosure. */
  codes: string[];
  /** Code→date pairs when the source states them together. */
  pairs: { code: string; date: string }[];
  /** Consumer label for the codes ("Lot code" / "Batch code"). */
  label: string;
}

/**
 * Where a recall reached, as structured concepts rather than a generated
 * paragraph.
 *
 * A composed sentence had to decide, for every notice, which of the source's
 * clauses were about distribution — and it kept getting that wrong in the same
 * direction, carrying a lot number or a best-by window into the answer because
 * the source's own sentence happened to contain one. These fields can only hold
 * places, sellers, and routes, so nothing else can arrive here.
 */
/**
 * A retailer together with the geography the source explicitly gave it
 * ("PCC Markets in Washington", "Market of Choice stores in Ashland, Bend, …
 * in Oregon"). Preserved for future store-based personalization; the current
 * UI renders retailers and places in their own blocks without flattening this
 * relationship away.
 */
export interface RetailerCoverage {
  retailer: string;
  states: string[];
  areas: string[];
}

export interface ConsumerDistribution {
  scopeType: 'nationwide' | 'states' | 'areas' | 'unspecified';
  /** The lead line: "Nationwide.", "Arizona, California, and Utah.". */
  areaText: string;
  states: string[];
  /** City/borough/metro places the source states, more specific than a state. */
  areas: string[];
  /** Source-stated retailer → geography relationships, preserved internally. */
  coverage: RetailerCoverage[];
  /** Explicitly named stores and chains. */
  retailers: string[];
  /** Retailers to show before the disclosure; the rest sit behind "view all". */
  retailersShown: string[];
  /** How many named retailers are held back. */
  retailersHidden: number;
  /** Specific store addresses the source lists, behind their own disclosure. */
  retailLocations: string[];
  /** Ecommerce platforms explicitly named by the source. */
  onlinePlatforms: string[];
  /** Broad routes worth naming; generic "retail stores" is never one. */
  channels: string[];
  /** True when nothing about distribution could be established. */
  unspecified: boolean;
}

export interface ConsumerPackageCheck {
  /**
   * True when at least one useful approved fact survived. When false the whole
   * section is hidden: a clean omission beats a residual blob of source text.
   */
  render: boolean;
  /** Explains what "matching" means for this recall. */
  scopeStatement: string;
  variants: AffectedVariant[];
  /**
   * Fields PROVEN to apply to every affected version — every version's own
   * source row states the same value. Rendered once, above the version cards,
   * under an explicit "applies to all affected versions" statement. This is
   * the only legal home for a version-spanning fact in variant mode; shared
   * scope is never inferred from a fact merely being unassigned.
   */
  sharedFields: PackageField[];
  /**
   * Case-level approved fields not tied to one variant. In variant mode this
   * is always empty: a fact is variant-owned, proven shared, or suppressed —
   * package fields never render loosely after the version cards.
   */
  fields: PackageField[];
  /** Extracted, deliberately not rendered. Development/QA provenance only. */
  rejected: RejectedFact[];
  /** Large code sets, collapsed behind their own disclosure step. */
  lotCodes: LotCodeSet | null;
  /** Printed production codes, each mapped to the date the source paired it with. */
  productionCodes: LotCodeSet | null;
  /**
   * The readable calendar dates those production codes stand for. Shown above
   * the codes, because "July 11, 15, 16, 18, and 22, 2026" is something a
   * person can check and "26192" is not.
   */
  productionDates: string | null;
  /**
   * Where to look on the package, and what the code looks like — standardized
   * copy composed from the source's semantics, shown once when it applies to
   * every affected version. Null when the source never states a usable one.
   */
  codeLocation: CodeLocation | null;
  /** Photos most useful for comparing a package in hand. */
  photos: ProductPhoto[];
  coverage: PackageCoverage;
  /** True when any identifying detail at all could be shown. */
  hasIdentifiers: boolean;
}

export type PackageCoverage = 'structured' | 'partial' | 'source_silent' | 'parser_missed';

export interface ConsumerAction {
  text: string;
  /** 'source' = the notice's own instruction; 'app' = our recommendation. */
  origin: 'source' | 'app';
  /** Retailer/food-service guidance, secondary to the consumer action. */
  secondary: string | null;
}

export interface ConsumerCase {
  photos: ProductPhoto[];
  primaryPhoto: ProductPhoto | null;
  distribution: ConsumerDistribution;
  packageCheck: ConsumerPackageCheck;
  /** Affected version names, for a compact "Affected versions" line. */
  variantNames: string[];
  action: ConsumerAction;
  /** How much product the notice says was recalled; null when it never says. */
  quantityText: string | null;
}

// ── Value normalization, dedup, aggregation ─────────────────────────────────

/**
 * A single source cell can pack several concepts: "Batch code/ Best Before
 * (bottom of package): LLA616903 – 30 SEP 2027 …" is a code list, a date list,
 * and a placement hint at once. Expanding it here is what lets the UI keep
 * dates separate from codes and show the placement once.
 */
function expandFact(item: SemanticFact): SemanticFact[] {
  const base = { evidence: item.evidence, scope: item.scope, raw: item.raw ?? item.value };
  const compound = splitCompoundCell(item.value);
  const labelSaysBoth = isCodeAndDateLabel(`${item.sourceLabel} ${compound.inlineLabel ?? ''}`);

  // A production-date field whose values are printed codes with the calendar
  // date beside them ("26192 (07/11/26)") states two different facts. The
  // consumer-facing date must be the readable one; the printed code is what
  // they will actually find on the bag, so both survive — related, not merged.
  if (item.concept === 'production_date' || item.concept === 'production_code') {
    const pairs = extractCodeDatePairs(compound.body);
    if (pairs.length > 0) {
      return pairs.flatMap((pair) => [
        {
          ...base,
          concept: 'production_date' as const,
          sourceLabel: item.sourceLabel,
          value: pair.date,
          pairedCode: pair.code,
        },
        {
          ...base,
          concept: 'production_code' as const,
          sourceLabel: item.sourceLabel,
          value: pair.code,
          pairedDate: pair.date,
        },
      ]);
    }
  }

  // A dual label with no printed pairs ("LOT #/EXP DATE" over "2025.07.07,
  // 2025.07.12, …") is resolved by what the values actually are: when every
  // part reads as a calendar date, the cell holds dates, and presenting them
  // as lot codes would show a shopper nine numbers no package carries.
  if (labelSaysBoth && compound.pairs.length === 0) {
    const parts = splitDateList(compound.body);
    if (parts.length > 0 && parts.every((part) => extractDate(part) !== null)) {
      const dateConcept: ConsumerConcept = /\bexp/i.test(item.sourceLabel)
        ? 'expiration'
        : /\buse[- ]?by\b/i.test(item.sourceLabel)
          ? 'use_by'
          : /\bsell[- ]?by\b/i.test(item.sourceLabel)
            ? 'sell_by'
            : 'best_by';
      return parts.map((part) => ({
        ...base,
        concept: dateConcept,
        sourceLabel: item.sourceLabel,
        value: part,
      }));
    }
  }

  if (labelSaysBoth && compound.pairs.length > 0) {
    const out: SemanticFact[] = [];
    for (const pair of compound.pairs) {
      out.push({
        ...base,
        concept: 'lot',
        sourceLabel: item.sourceLabel,
        value: pair.code,
        pairedDate: pair.date,
      });
      out.push({
        ...base,
        concept: 'best_by',
        sourceLabel: item.sourceLabel,
        value: pair.date,
        pairedCode: pair.code,
      });
    }
    if (compound.locationHint) {
      out.push({
        ...base,
        concept: 'identifier_location',
        sourceLabel: item.sourceLabel,
        value: compound.locationHint,
      });
    }
    return out;
  }

  // Strip an inline label prefix so it never reaches the UI, then lift any
  // trailing placement phrase out of the value itself: "2026 AUGUST 31, back
  // of package" is a date AND a place to look, not a strangely worded date.
  const body =
    compound.inlineLabel && compound.body !== '' && compound.body !== item.value
      ? compound.body
      : item.value;
  const placementSplit = PLACEMENT_BEARING.has(item.concept)
    ? splitTrailingPlacement(body)
    : { value: body, placement: null };

  // One cell can carry a second, differently-labeled identifier inline:
  // "6 Oz (UPC 46675000105)" is a size AND that version's barcode. Left merged,
  // the barcode is unsearchable and reads as part of the size; split out, it
  // stays attached to the same product row, which is where it belongs.
  const inline = placementSplit.value.match(INLINE_LABELLED_TAIL);
  const value = inline
    ? placementSplit.value.slice(0, inline.index).replace(/[\s,;(]+$/, '')
    : placementSplit.value;
  const out: SemanticFact[] = [
    { ...base, ...item, value: value === '' ? placementSplit.value : value },
  ];
  if (inline && value !== '') {
    for (const extra of extractProseIdentifiers(inline[1]).facts) {
      if (extra.concept === item.concept) continue;
      out.push({ ...base, ...extra });
    }
  }
  const placement = placementSplit.placement ?? compound.locationHint;
  if (placement) {
    out.push({
      ...base,
      concept: 'identifier_location',
      sourceLabel: item.sourceLabel,
      value: placement,
    });
  }
  return out;
}

/** A differently-labeled identifier appended to the end of another value. */
const INLINE_LABELLED_TAIL =
  /[,;(]\s*((?:UPC|U\.P\.C\.|Barcode|Bar code|Lot|Batch|Best\s+(?:By|Before)|Use\s+By|Sell\s+By|Expiration|Item\s+(?:Number|Code))\b[^)]{2,60})\)?\s*$/i;

/** Concepts whose values may carry a trailing "where to look" phrase. */
const PLACEMENT_BEARING = new Set<ConsumerConcept>([
  'best_by',
  'use_by',
  'sell_by',
  'expiration',
  'freeze_by',
  'production_date',
  'production_code',
  'upc',
  'lot',
  'case_code',
  'item_number',
]);

/** Comparison key: case/punctuation/spacing-insensitive. */
function dedupeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

/** Concepts whose values are calendar dates. */
const DATE_CONCEPTS = new Set<ConsumerConcept>([
  'best_by',
  'use_by',
  'sell_by',
  'expiration',
  'freeze_by',
  'production_date',
]);

/** Concepts whose cells may list several codes that must split into facts. */
const CODE_LIST_CONCEPTS = new Set<ConsumerConcept>([
  'lot',
  'production_code',
  'case_code',
  'item_number',
]);

/**
 * Split a cell holding several dates into its parts, without breaking a range.
 *
 * "12/04/19, 12/10/19" is two dates; "7/13/2026 - 8/11/2026" is one range, and
 * splitting on its separator would turn a span into two unrelated days. Only
 * list separators divide — the range separator is left to the normalizer.
 */
function splitDateList(value: string): string[] {
  const parts = value
    // A comma before a bare year belongs to the date it is part of: splitting
    // "July 11, 2026" would turn one day into a day and a year. Four digits
    // that continue into a date ("2025.07.12") are a year-first date, not a
    // bare year, and the comma before them does separate list entries.
    .split(
      /\s*(?:,(?!\s*\d{4}\b(?![./-]\d))|;|\band\b|\bor\b)\s*|\s{2,}|(?<=\d{2,4})\s+(?=\d{1,2}[/.-]\d)/i,
    )
    .map((part) => part.trim())
    .filter((part) => part !== '');
  return parts.length > 1 ? parts : [value];
}

/** One consumer-ready value plus the identity that decides whether it repeats. */
interface DisplayedValue {
  display: string;
  canonical: string;
  raw: string;
  /** Chronological position, for date concepts. */
  sortKey: string | null;
}

/**
 * Present a source value for consumers, per concept, alongside the canonical
 * identity of the underlying fact. The identity is what prevents "August 31,
 * 2026" and "2026 AUGUST 31" — the same day written twice by the same notice —
 * from being rendered as two different dates joined by "and".
 */
function displayValues(concept: ConsumerConcept, raw: string): DisplayedValue[] {
  // A conjunction or list bullet left at either end is the seam where a source
  // cell was split, not part of the value: "and #24150", "B241851006 and",
  // "5 265 •".
  const trimmed = raw
    .replace(/\s+/g, ' ')
    .replace(/^[•·\s]+|[•·\s]+$/g, '')
    .replace(/^(?:and|or)\s+|\s+(?:and|or)$/gi, '')
    .trim();
  // A cell listing several codes ("25E04-A, 25E04-B") is several facts, each
  // with its own canonical identity. Left joined, the combined string can
  // never match one code stated elsewhere, and deduplication against a
  // version that owns one of them silently fails — which is exactly how an
  // orphan "Lot code: 25E04-A" row appeared below the version cards.
  if (CODE_LIST_CONCEPTS.has(concept)) {
    const parts = trimmed.split(/\s*(?:,|;|•|·|\band\b|\bor\b)\s*/i).filter((part) => part !== '');
    if (parts.length > 1) {
      return parts.map((part) => ({
        display: part,
        canonical: dedupeKey(part),
        raw: part,
        sortKey: null,
      }));
    }
  }
  if (concept === 'upc') {
    const normalized = normalizeUpcList(trimmed);
    // Not a recognizable barcode length → show the source's own text rather
    // than claiming a normalization that would be lossy.
    return normalized.length > 0
      ? normalized.map((value) => ({
          display: value.display,
          canonical: value.canonical ?? dedupeKey(value.display),
          raw: value.raw,
          sortKey: null,
        }))
      : [{ display: trimmed, canonical: dedupeKey(trimmed), raw: trimmed, sortKey: null }];
  }
  if (DATE_CONCEPTS.has(concept)) {
    // The WHOLE value is normalized first: "between July 20, 2026 and August
    // 17, 2026" is one range, and list-splitting it on "and" turns a span
    // covering every date in the window into two endpoint days — a shopper
    // whose eggs read July 30 concludes they are safe.
    const whole = normalizeDateValue(trimmed);
    if (whole.canonical !== undefined) {
      return [
        {
          display: whole.display,
          canonical: whole.canonical,
          raw: whole.raw,
          sortKey: dateSortKey(whole),
        },
      ];
    }
    // One cell often holds several dates ("12/04/19, 12/10/19, 12/20/19").
    // Each is its own fact, so each gets the standard format and its own place
    // in the chronological ordering; normalizing only the whole string would
    // leave the list in the source's raw formatting.
    const parts = splitDateList(trimmed);
    // A cell can hold a date wrapped in noise ("BB 11/13/2024", "03-15-2024
    // product of USA") or a date beside a lot code. Each part contributes only
    // if a date can be read from it; a cell where none can falls back to the
    // source's own wording untouched.
    const dates = parts.map((part) => extractDate(part)).filter((date) => date !== null);
    // With nothing parseable, keep the source's own wording — but per part, so
    // each is type-checked on its own. Falling back to the whole cell let
    // "10/2025 and 1365200" pass as a date because one half of it looked like
    // one, carrying a lot number into a best-by field.
    const values =
      dates.length > 0
        ? dates
        : parts.length > 1
          ? parts.map((part) => normalizeDateValue(part))
          : [whole];
    return values.map((normalized) => ({
      display: normalized.display,
      canonical: normalized.canonical ?? dedupeKey(normalized.display),
      raw: normalized.raw,
      sortKey: dateSortKey(normalized),
    }));
  }
  let display =
    concept === 'packaging' ||
    concept === 'package_color' ||
    concept === 'package_size' ||
    concept === 'variant' ||
    concept === 'unknown'
      ? // Shouted source values ("TOP SIRLOIN BUTT") are un-shouted for display,
        // and measurements get their space back ("3oz" → "3 oz"); acronyms,
        // digits, and the underlying source text are preserved.
        formatMeasurements(humanizeAllCaps(trimmed))
      : trimmed;
  // Safe textual values read as consumer copy through ONE shared renderer,
  // whichever agency's grammar produced them: FSIS's "vacuum package" and
  // FDA's "glass jars" both open with a capital, and nothing else changes.
  if (concept === 'packaging' || concept === 'package_color') {
    display = sentenceCaseValue(display);
  }
  return [{ display, canonical: dedupeKey(display), raw: trimmed, sortKey: null }];
}

/**
 * Group facts into consumer concepts, deduplicating and aggregating repeated
 * values. This is what turns three near-identical "Packaging" rows into a
 * single `Packaging: Paper bag` and three `Net weight` rows into `12 oz, 20 oz`.
 *
 * Grouping happens by canonical identity, never by display string, so a value
 * the source spelled two ways appears once. Dates additionally sort
 * chronologically — a source that prints September, June, then May is telling
 * the truth in an order no reader can scan.
 */
export function aggregateFacts(facts: SemanticFact[]): ConceptValues[] {
  const groups = new Map<ConsumerConcept, Map<string, DisplayedValue>>();
  // A code set the source called "batch" keeps that word: it is what is
  // printed on the package, and both labels are in the approved vocabulary.
  const batchConcepts = new Set<ConsumerConcept>();
  for (const item of facts.flatMap(expandFact)) {
    if (SUPPRESSED_CONCEPTS.has(item.concept)) continue;
    if (isLayoutArtifactValue(item.value)) continue;
    if (item.concept === 'lot' && /batch/i.test(item.sourceLabel)) batchConcepts.add('lot');
    const group = groups.get(item.concept) ?? new Map<string, DisplayedValue>();
    for (const value of displayValues(item.concept, item.value)) {
      if (value.display === '' || isLayoutArtifactValue(value.display)) continue;
      // A source label says what a value is meant to be; it does not make the
      // value that thing. A net weight filed under "Use by" is dropped rather
      // than shown as a date nobody will find on their package.
      if (!isValidForConcept(item.concept, value.display)) continue;
      if (value.canonical === '' || group.has(value.canonical)) continue;
      group.set(value.canonical, value);
    }
    groups.set(item.concept, group);
  }

  const order = (concept: ConsumerConcept) => {
    const index = PACKAGE_CONCEPT_PRIORITY.indexOf(concept);
    return index === -1 ? PACKAGE_CONCEPT_PRIORITY.length : index;
  };
  return [...groups.entries()]
    .filter(([, group]) => group.size > 0)
    .sort(([a], [b]) => order(a) - order(b))
    .map(([concept, group]) => {
      const values = [...group.values()];
      if (DATE_CONCEPTS.has(concept)) {
        values.sort((a, b) => (a.sortKey ?? '￿').localeCompare(b.sortKey ?? '￿'));
      }
      return {
        concept,
        label: CONCEPT_LABEL[concept],
        values: values.map((v) => v.display),
        raw: values.map((v) => v.raw),
        canonicalKeys: values.map((v) => v.canonical),
        isBatch: batchConcepts.has(concept),
      };
    });
}

/**
 * Project aggregated facts through the closed consumer schema.
 *
 * This is the gate the whole pass exists for. Everything upstream may produce
 * whatever the source states; nothing downstream renders anything this function
 * did not return. A concept with no approved field does not become a field with
 * a guessed name — it becomes a counted rejection with its source label
 * preserved, and the UI never learns it existed.
 */
export function toPackageFields(groups: ConceptValues[]): {
  fields: PackageField[];
  rejected: RejectedFact[];
} {
  const byKey = new Map<string, PackageField>();
  const rejected: RejectedFact[] = [];
  for (const group of groups) {
    const key = packageFieldFor(group.concept, group.isBatch);
    if (key === null) {
      rejected.push({
        concept: group.concept,
        sourceLabel: group.label,
        values: group.values,
        reason: packageRejectionReason(group.concept),
      });
      continue;
    }
    // Two source columns can legitimately land on one approved field (a "Lot"
    // column and a "Lot Code" column). They merge rather than each drawing a
    // row, so the card's shape stays fixed.
    const existing = byKey.get(key);
    const merged: PackageField = existing
      ? {
          ...existing,
          values: [...existing.values, ...group.values],
          raw: [...existing.raw, ...group.raw],
          canonicalKeys: [...existing.canonicalKeys, ...group.canonicalKeys],
          value: '',
        }
      : {
          key,
          label: PACKAGE_FIELD_LABEL[key],
          value: '',
          values: [...group.values],
          raw: [...group.raw],
          canonicalKeys: [...group.canonicalKeys],
        };
    merged.value = joinFactValues(group.concept, merged.values);
    byKey.set(key, merged);
  }
  const fields = PACKAGE_FIELD_ORDER.map((key) => byKey.get(key)).filter(
    (field): field is PackageField => field !== undefined,
  );
  return { fields, rejected };
}

/** The concept an approved field key stands for, for rejection accounting. */
function conceptForFieldKey(key: PackageField['key']): ConsumerConcept {
  switch (key) {
    case 'bestBy':
      return 'best_by';
    case 'useBy':
      return 'use_by';
    case 'sellBy':
      return 'sell_by';
    case 'expiration':
      return 'expiration';
    case 'size':
      return 'package_size';
    case 'packaging':
      return 'packaging';
    case 'upc':
      return 'upc';
    default:
      return 'lot';
  }
}

/**
 * Remove case-level values that a specific version already claims.
 *
 * When a source table gives the UPC in the Potato Market Loaf row, that
 * barcode belongs to that loaf. Re-stating it below the version cards as an
 * unattached "Barcode (UPC)" invents a recall-wide relationship the source
 * never asserted, and a shopper holding a Mini Potato Loaf would match on it
 * wrongly. Ambiguity is resolved by omission from the checker, never by
 * inventing ownership — the raw source text is still preserved on the case.
 */
function withoutVariantOwnedValues(
  caseFacts: ConceptValues[],
  variants: AffectedVariant[],
): ConceptValues[] {
  const owned = new Set<string>();
  for (const variant of variants) {
    for (const field of variant.fields) {
      for (const key of field.canonicalKeys) owned.add(`${field.key}|${key}`);
    }
  }
  if (owned.size === 0) return caseFacts;
  const out: ConceptValues[] = [];
  for (const group of caseFacts) {
    const field = packageFieldFor(group.concept, group.isBatch);
    const keep = group.canonicalKeys
      .map((key, index) => ({ key, index }))
      .filter(({ key }) => field === null || !owned.has(`${field}|${key}`));
    if (keep.length === 0) continue;
    out.push({
      ...group,
      values: keep.map(({ index }) => group.values[index]),
      raw: keep.map(({ index }) => group.raw[index]),
      canonicalKeys: keep.map(({ key }) => key),
    });
  }
  return out;
}

/**
 * Join a concept's values for display.
 *
 * Dates in the same month and year collapse to one readable phrase — five
 * production dates read as "July 11, 15, 16, 18, and 22, 2026" rather than as
 * five sentences repeating the same month. Everything else joins plainly.
 */
export function joinFactValues(concept: ConsumerConcept, values: string[]): string {
  if (values.length < 2 || !DATE_CONCEPTS.has(concept)) return joinValues(values);
  const parsed = values.map((value) => value.match(/^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/));
  if (parsed.some((match) => match === null)) return joinValues(values);
  const months = new Set(parsed.map((m) => m![1]));
  const years = new Set(parsed.map((m) => m![3]));
  if (months.size !== 1 || years.size !== 1) return joinValues(values);
  const days = parsed.map((m) => m![2]);
  return `${[...months][0]} ${joinValues(days)}, ${[...years][0]}`;
}

/** Join aggregated values into one consumer string ("12 oz, 20 oz"). */
export function joinValues(values: string[]): string {
  if (values.length <= 2) return values.join(' and ');
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
}

// ── Prose "Label: value" blocks ─────────────────────────────────────────────

/**
 * Many announcements list identifiers as labeled prose lines rather than a
 * table:
 *
 *   Brand: Momchipz
 *   Size: 3oz (85 g)
 *   UPC: 6 28634 44216 6 Best
 *   Before: 2026 AUGUST 31
 *
 * Note the real-world defect in the last two lines: the label "Best Before"
 * is split across a line break, so "Best" lands at the end of the UPC value.
 * This repairs that split before routing, which is why the Best-before date
 * survives at all on notices formatted this way.
 */
export function parseProseFacts(summaryText: string | null): SemanticFact[] {
  if (!summaryText) return [];
  // A list bullet inside one line separates two labeled facts ("Lot code :
  // 5 265 • Best-If-Used-By date: MAR 24, 2027"); read whole, the second
  // label and its date ride inside the first value.
  const lines = summaryText
    .split('\n')
    .flatMap((line) => line.split(/\s*[•·]\s*/))
    .map((line) => line.trim());
  const facts: SemanticFact[] = [];

  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^([A-Za-z][A-Za-z /()#-]{1,40}?)\s*:\s*(.+)$/);
    if (!match) continue;
    let label = match[1].trim();
    let value = match[2].trim();

    // Repair a label split across the newline: if this value ends with a word
    // that joins the NEXT line's label into a recognized label, move it there.
    const next = lines[index + 1]?.match(/^([A-Za-z][A-Za-z /-]{1,30}?)\s*:\s*(.+)$/);
    if (next) {
      const trailing = value.match(/\s([A-Za-z]{3,10})$/);
      if (trailing) {
        const joined = `${trailing[1]} ${next[1]}`;
        if (conceptForLabel(joined) !== 'unknown' && conceptForLabel(next[1]) === 'unknown') {
          value = value.slice(0, trailing.index).trim();
          lines[index + 1] = `${joined}: ${next[2]}`;
        }
      }
    }

    const concept = conceptForLabel(label);
    if (concept === 'unknown' || concept === 'layout_artifact') continue;
    if (isLayoutArtifactValue(value)) continue;
    // Guard against sentences that merely contain a colon.
    if (value.split(/\s+/).length > 18) continue;
    label = label.replace(/\s+/g, ' ');
    facts.push({ concept, sourceLabel: label, value });
  }
  return facts;
}

/**
 * The announcement's prose with its own tables removed.
 *
 * `summaryText` is the whole announcement body flattened, tables included, so
 * every table cell would otherwise be read TWICE: once by the table
 * interpreter, which knows which product row it belongs to, and once by the
 * prose extractor, which does not. The second reading is where relationships
 * go to die — it is what turned one variant's barcode into a recall-wide
 * barcode, and what re-emitted a row's batch codes as an unattached list.
 *
 * The prose extractor therefore reads only what the tables did not cover.
 */
function proseOutsideTables(summaryHtml: string | null, summaryText: string | null): string {
  const text = summaryText ?? '';
  if (!summaryHtml || text === '') return text;
  const tables = [...summaryHtml.matchAll(/<table[\s\S]*?<\/table>/gi)];
  if (tables.length === 0) return text;
  const tableText = normalizeForContains(tables.map((table) => stripHtml(table[0])).join(' '));
  if (tableText === '') return text;
  return text
    .split('\n')
    .filter((line) => {
      const normalized = normalizeForContains(line);
      // Only lines substantial enough to identify: a short fragment could
      // coincide with table text without having come from it.
      return normalized.length < 8 || !tableText.includes(normalized);
    })
    .join('\n');
}

/** Whitespace/punctuation-insensitive form, for substring containment tests. */
function normalizeForContains(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// ── Variants ────────────────────────────────────────────────────────────────

/** Trailing size inside a variant name ("… Bread, Net Wt. 8 oz (227g)"). */
const EMBEDDED_SIZE =
  /,?\s*(?:net\s+wt\.?|net\s+weight|weight)?\s*:?\s*(\d[\d./]*\s*(?:oz|ounce|ounces|lb|lbs|pound|pounds|g|gram|grams|kg|ml|l|fl\.?\s*oz|count|ct|pack|pk)\b[^,]*)$/i;

function splitVariantName(name: string): { name: string; size: string | null } {
  const match = name.match(EMBEDDED_SIZE);
  if (!match || match.index === undefined || match.index < 3) return { name, size: null };
  return {
    name: name
      .slice(0, match.index)
      .replace(/[\s,]+$/, '')
      .trim(),
    size: match[1].replace(/\s+/g, ' ').trim(),
  };
}

/**
 * Affected versions stated in prose rather than a table: "Products affected
 * include Outshine Strawberry, Watermelon, Grape, Tangerine and Black Cherry
 * 6-Count 2.5 ounce Fruit Bars and the Outshine 24-Count 2.5 ounce Variety
 * Pack Fruit Bars." Without this, notices whose table holds only codes and
 * "See Image Below" would surface no recognizable versions at all.
 */
export function parseProseVariants(summaryText: string | null): string[] {
  if (!summaryText) return [];
  // A period inside a decimal size ("2.5 ounce") must not end the list, so the
  // terminator is a period followed by whitespace/end rather than any period.
  const match = summaryText.match(
    /\b(?:products?|items?|flavors?|varieties)\s+(?:affected\s+)?(?:include|includes|affected are|are)\s*:?\s*((?:[^.\n]|\.(?=\d))*)/i,
  );
  if (!match || match[1].trim().length < 10) return [];
  const listText = match[1].slice(0, 300);
  // Split on commas and the final "and"; keep multi-word names intact.
  const parts = listText
    .split(/,\s*(?:and\s+)?|\s+and\s+the\s+|\s+and\s+(?=[A-Z0-9])/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(
      (p) =>
        p.length >= 3 &&
        p.length <= 90 &&
        // A product name, not the sentence's way of introducing one: "products
        // affected are as follows" and "…as shown in the images below" are
        // grammar, and presenting them as affected versions is nonsense.
        !/^(?:as\b|the following|listed|shown|below|described|detailed|outlined|set out)/i.test(
          p,
        ) &&
        /[A-Z0-9]/.test(p),
    );
  if (parts.length < 2) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const part of parts) {
    const key = dedupeKey(part);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    names.push(part);
  }
  return names.slice(0, 12);
}

interface VariantSource {
  facts: SemanticFact[];
  scope?: string;
  /** The source's own image of this version, when it establishes one. */
  photo?: ProductPhoto | null;
}

/** What became of a set of source rows: real versions, plus the facts of rows
 * that had no valid product identity to own them. */
interface BuiltVariants {
  variants: AffectedVariant[];
  /**
   * Facts from rows whose name failed the closed variant-identity contract.
   * They attach to the parent product scope — a date or a state is never an
   * affected version, but the identifiers beside it are still real.
   */
  unassigned: SemanticFact[];
}

/**
 * Turn source rows into affected versions, keeping every relationship the
 * source established. Each version owns the identifiers printed in its own
 * row — its barcode, its dates, its codes — instead of contributing them to a
 * recall-wide pile in which nothing can be matched back to anything.
 *
 * Every candidate name passes the closed variant-identity contract: a date, a
 * state, a code, or a serialized source row can never become a version card,
 * whatever upstream shape proposed it. A row with facts but no valid identity
 * contributes its facts to the parent scope instead.
 */
function buildVariants(sources: VariantSource[]): BuiltVariants {
  const variants: AffectedVariant[] = [];
  const unassigned: SemanticFact[] = [];
  const seen = new Set<string>();
  // Some product tables have no description column: the versions are told
  // apart by BRAND ("Market 32" 1-lb bags vs "Waterfront Bistro" 2-lb bags).
  // The brand names the version only when it actually distinguishes rows —
  // one shared brand repeated down a table is the recall's brand, not a set of
  // versions, and turning it into one would invent products.
  const brands = new Set(
    sources
      .filter((source) => !source.facts.some((f) => f.concept === 'variant'))
      .flatMap((source) => source.facts.filter((f) => f.concept === 'brand').map((f) => f.value)),
  );
  const brandNamesVersions = sources.length >= 2 && brands.size >= 2;

  for (const source of sources) {
    const nameFact =
      source.facts.find((f) => f.concept === 'variant') ??
      (brandNamesVersions ? source.facts.find((f) => f.concept === 'brand') : undefined);
    if (!nameFact) continue;
    const split = splitVariantName(nameFact.value);
    const name = formatMeasurements(humanizeAllCaps(split.name));
    if (name.length < 2) continue;
    // The closed identity gate. An invalid identity does not become a card,
    // and its row's facts widen to the recall scope rather than vanishing.
    if (variantIdentityRejection(name) !== null) {
      for (const factItem of source.facts) {
        if (factItem === nameFact) continue;
        unassigned.push(factItem);
      }
      continue;
    }

    // A variant carries only identifying facts. Distribution belongs to
    // "Where it was sold"; brand and company are header identity, not package
    // details — repeating them on every variant is the noise V2 removes.
    const identifying = source.facts.filter(
      (f) =>
        f !== nameFact &&
        f.concept !== 'distribution' &&
        f.concept !== 'brand' &&
        f.concept !== 'company',
    );
    if (split.size) {
      identifying.push({
        concept: 'package_size',
        sourceLabel: 'Net weight',
        value: split.size,
        evidence: nameFact.evidence,
        scope: source.scope,
      });
    }
    const expanded = identifying.flatMap(expandFact);
    // This version's own codes stay with this version. A large set still
    // collapses, but behind the version it belongs to.
    const lotSet = buildLotCodes(expanded);
    const collapse = lotSet !== null && lotSet.count > SMALL_CODE_SET;
    const aggregated = aggregateFacts(
      collapse ? expanded.filter((f) => f.concept !== 'lot') : expanded,
    );
    // A version's own location is lifted out of its facts: it is an
    // instruction about the package, not an identifier to compare.
    const projected = toPackageFields(
      aggregated.filter((f) => f.concept !== 'identifier_location'),
    );
    const key = `${dedupeKey(name)}|${projected.fields.map((f) => f.value).join('|')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    variants.push({
      name,
      fields: projected.fields,
      rejected: projected.rejected,
      codeLocation: codeLocationFrom(expanded, ''),
      lotCodes: collapse ? lotSet : null,
      photo: source.photo ?? null,
      scope: source.scope ?? null,
    });
  }
  return { variants, unassigned };
}

/**
 * Rows whose product and barcode cells read "See Image Below" state their
 * identity in the announcement's photos rather than in text. When the table
 * has exactly as many rows as there are recognizable product photos, the
 * source's own ordering pairs them — and each photo's caption names the
 * version and its barcode ("Outshine Fruit Bars Strawberry, 6 Bars, UPC
 * 041548610047"), which is how a flavor keeps its own barcode and its own
 * batch codes instead of all six flavors sharing one undifferentiated list.
 *
 * The correspondence is used only when the counts match exactly; a mismatch
 * means the source did not establish the pairing, and nothing is guessed.
 */
function attachDeferredImages(
  table: {
    variants: { facts: SemanticFact[]; scope: string; index: number }[];
    defersToImages: boolean;
  },
  photos: ProductPhoto[],
): VariantSource[] {
  const gallery = galleryPhotos(photos);
  if (!table.defersToImages || gallery.length !== table.variants.length) {
    return table.variants;
  }
  return table.variants.map((row, index) => {
    const photo = gallery[index];
    const caption = photo.alt ?? '';
    const captionFacts = extractProseIdentifiers(caption).facts.map((fact) => ({
      ...fact,
      evidence: 'caption' as const,
      scope: row.scope,
    }));
    const { name, size } = captionVariantName(caption);
    const facts = [...row.facts, ...captionFacts];
    if (name) {
      facts.unshift({
        concept: 'variant',
        sourceLabel: 'photo caption',
        value: name,
        evidence: 'caption',
        scope: row.scope,
      });
    }
    if (size) {
      facts.push({
        concept: 'package_size',
        sourceLabel: 'photo caption',
        value: size,
        evidence: 'caption',
        scope: row.scope,
      });
    }
    return { facts, scope: row.scope, photo };
  });
}

/**
 * The product name inside a photo caption, with its identifier tail removed:
 * "Outshine Fruit Bars Strawberry, 6 Bars, UPC 041548610047" names a version
 * ("Outshine Fruit Bars Strawberry") and a size ("6 Bars"), and the barcode is
 * extracted separately rather than becoming part of the name.
 */
function captionVariantName(caption: string): { name: string | null; size: string | null } {
  const head = caption
    .replace(
      /[,;]?\s*\b(?:UPC|Lot|Batch|Best\s+(?:By|Before)|Use\s+By|Sell\s+By|Expiration)\b.*$/i,
      '',
    )
    .replace(/\b(?:label|labeling|image|photo|picture)\b\s*\d*\s*$/i, '')
    .replace(/^\s*(?:image|photo|picture)\s*\d*\s*[-–—:]\s*/i, '')
    .replace(/[\s,;:–—-]+$/, '')
    .trim();
  if (head.length < 3) return { name: null, size: null };
  const sizeMatch = head.match(
    /,\s*((?:\d[\d./]*\s*)?(?:oz|ounces?|lbs?|pounds?|g|grams?|kg|ml|l|ct|count|bars?|packs?|pk|pieces?|cans?|bottles?)\b[^,]{0,14})$/i,
  );
  if (sizeMatch && sizeMatch.index !== undefined && sizeMatch.index >= 3) {
    return {
      name: head.slice(0, sizeMatch.index).trim(),
      size: formatMeasurements(sizeMatch[1].trim()),
    };
  }
  return { name: head, size: null };
}

/**
 * Attach each photo to the version its own caption names. Used when the source
 * captions its images with product names (Prince Bakery) rather than relying on
 * position. Matching is exact on the normalized name, so a photo is never
 * shown against a version it does not depict.
 */
function attachNamedPhotos(variants: AffectedVariant[], photos: ProductPhoto[]): AffectedVariant[] {
  const gallery = galleryPhotos(photos);
  if (gallery.length === 0) return variants;
  const used = new Set<string>();
  const matched = new Map<string, ProductPhoto>();
  // The most specific version claims first, so "Sesame Italian Bread Large"
  // takes its own photo before "Sesame Italian Bread" can match the same
  // caption by prefix; then the closest remaining caption wins.
  for (const variant of [...variants].sort(
    (a, b) => dedupeKey(b.name).length - dedupeKey(a.name).length,
  )) {
    if (variant.photo) continue;
    const key = dedupeKey(variant.name);
    if (key.length < 6) continue;
    const match = gallery
      .filter((photo) => !used.has(photo.url) && dedupeKey(photo.alt ?? '').startsWith(key))
      .sort((a, b) => dedupeKey(a.alt ?? '').length - dedupeKey(b.alt ?? '').length)[0];
    if (!match) continue;
    used.add(match.url);
    matched.set(variant.name, match);
  }
  return variants.map((variant) => ({
    ...variant,
    photo: variant.photo ?? matched.get(variant.name) ?? null,
  }));
}

// ── Distribution ────────────────────────────────────────────────────────────

const CHANNEL_PATTERNS: [RegExp, string][] = [
  [/\bgrocery stores?\b|\bsupermarkets?\b/i, 'grocery stores'],
  [/\bwholesalers?\b|\bwholesale\b/i, 'wholesalers'],
  [/\brestaurants?\b/i, 'restaurants'],
  [/\bcaf[eé]s?\b/i, 'cafés'],
  [/\bfood ?service\b/i, 'food service'],
  [/\bconvenience stores?\b/i, 'convenience stores'],
  [/\bfarmers'? markets?\b/i, 'farmers markets'],
  [/\bbodegas?\b/i, 'bodegas'],
  [/\bdistributors?\b/i, 'distributors'],
  [/\bretail(?: stores?| markets?| locations?)\b/i, 'retail stores'],
  [/\bclubs? stores?\b|\bwarehouse clubs?\b/i, 'club stores'],
  [/\bindependent retailers?\b|\bindependent grocers?\b/i, 'independent retailers'],
];

/** Ecommerce platforms, recognized only when the source names them. */
const ONLINE_PATTERNS =
  /\b(Amazon\.com|Amazon|eBay|Walmart\.com|Instacart|Etsy|Shopify|Thrive Market|Weee!|iHerb|[A-Z][A-Za-z0-9-]{2,24}\.com)\b/g;

/** Sentences that describe the firm, not where recalled product went. */
const FIRM_LOCATION_SENTENCE =
  /\b(?:is|are|has|have)\s+(?:voluntarily\s+)?recalling\b|\bof\s+[A-Z][A-Za-z.\- ]+,\s*[A-Z][A-Za-z.]+\s+is\b|\bheadquarter/i;

const DISTRIBUTION_SENTENCE =
  /\bdistribut\w+|\bsold\b|\bshipped\b|\bavailable (?:in|at|through)\b|\bnationwide\b/i;

/**
 * Where a product sits INSIDE a store, which is merchandising, not
 * distribution. "…is sold in the frozen section" tells a shopper nothing about
 * whether the recall reached them; presenting it under "Where it was sold"
 * answers the wrong question with confident-sounding text.
 */
const MERCHANDISING =
  /\b(?:frozen|refrigerated|dairy|deli|produce|bakery|meat|freezer|cooler|chilled)\s+(?:section|case|aisle|department|counter|display)\b|\bin\s+the\s+(?:frozen|refrigerated|chilled)\s+(?:food\s+)?(?:section|aisle|case)\b|\baisle\s+\d|\bsold\s+(?:frozen|refrigerated|chilled)\b/i;

/**
 * The generic shop words are absent from the approved channel set on purpose.
 * "Retail stores" says only that a consumer product was sold in shops, which
 * the reader already assumes — and it is what a specific retailer list gets
 * compressed into when extraction fails, which is far worse than saying
 * nothing.
 */
function collectChannels(text: string): string[] {
  const channels: string[] = [];
  for (const [pattern, label] of CHANNEL_PATTERNS) {
    if (pattern.test(text) && !channels.includes(label)) channels.push(label);
  }
  return channels;
}

function collectOnlinePlatforms(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(ONLINE_PATTERNS)) {
    const name = match[1];
    // A bare company domain in contact details is not a sales channel: require
    // a selling preposition immediately before it.
    const lead = text.slice(Math.max(0, match.index! - 30), match.index!);
    if (
      !/\b(?:through|on|via|from|at|purchased)\s+$|\b(?:through|on|via|from|at)\s+\S{0,12}$/i.test(
        lead,
      )
    ) {
      continue;
    }
    if (!found.some((f) => f.toLowerCase() === name.toLowerCase())) found.push(name);
  }
  return found;
}

/**
 * The region of the notice that talks about where product went. Sentence
 * splitting alone is unreliable here — "sold to 49 U.S. customers through
 * Amazon.com" splits at "U.S." and separates the verb from the platform — so
 * channel/platform detection runs over the joined distribution lines while
 * firm-location and contact lines stay excluded.
 */
function distributionRegion(summary: string): string {
  return summary
    .split('\n')
    .filter(
      (line) =>
        DISTRIBUTION_SENTENCE.test(line) &&
        !FIRM_LOCATION_SENTENCE.test(line) &&
        !MERCHANDISING.test(line) &&
        !/\bcall\b|\bcontact\b|\bquestions\b|@|\b\d{3}-\d{3}-\d{4}\b/i.test(line),
    )
    .join(' ');
}

/**
 * Metro/region phrasing our structured state list cannot represent. "Seattle
 * and Tacoma Metro areas in WA" is far more useful to a shopper than the bare
 * state, and compressing it away is a real loss of consumer information.
 */
const AREA_PHRASE =
  /\b((?:[A-Z][A-Za-z.'’-]+(?:\s*[/&]\s*|\s+and\s+|\s+)?){1,4}?(?:[Mm]etro(?:politan)?\s+[Aa]reas?|[Mm]etro|[Aa]reas?|[Cc]ount(?:y|ies)|[Rr]egion|[Nn]eighborhoods?|[Bb]oroughs?))\b/g;

/** Words that make an "… area" phrase a description of the firm, not of sales. */
const NOT_AN_AREA = /\b(?:production|manufactur|storage|preparation|kitchen|facility|plant)\b/i;

/** One place token: up to three capitalized words ("Ann Arbor", "West Linn"). */
const PLACE_TOKEN = String.raw`[A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){0,2}`;

/** A comma/and-separated run of place tokens. */
const PLACE_RUN = String.raw`(${PLACE_TOKEN}(?:(?:,\s*(?:and\s+)?|,?\s+and\s+)${PLACE_TOKEN})*)`;

/**
 * "around Bronx and Westchester, New York" / "in Ann Arbor and Brighton, MI"
 * — one or more capitalized place names introduced by a locality preposition
 * and closed by a state (full name or postal code). Bounded to a short run so
 * a sentence cannot wander into it.
 */
const NAMED_PLACES = new RegExp(
  String.raw`\b(?:around|throughout|in and around|within|in)\s+${PLACE_RUN},\s+([A-Z][A-Za-z. ]+|[A-Z]{2}\b)`,
  'g',
);

/**
 * A city list after a venue word: "stores in Ashland, Bend, … West Linn in
 * Oregon". The venue word hands the rest of the clause to geography — these
 * names are where the stores ARE, and reading them as more stores is how
 * "Bend" and "Corvallis" ended up rendered as retailers.
 */
const VENUE_PLACE_LIST = new RegExp(
  String.raw`\b(?:[Ss]tores?|[Ll]ocations?|[Ss]hops?|[Oo]utlets?|[Ss]upermarkets?)\s+in\s+${PLACE_RUN}(?:\s+in\s+([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)?|[A-Z]{2}\b))?`,
  'g',
);

/** The retailer name directly before a venue word, for coverage association. */
const RETAILER_BEFORE_VENUE = new RegExp(
  String.raw`([A-Z][\w'’&.-]*(?:\s+(?:of|the|&|and|[A-Z][\w'’&.-]*)){0,3})\s+(?:retail\s+|grocery\s+)?(?:[Ss]tores?|[Ll]ocations?|[Ss]hops?|[Oo]utlets?|[Ss]upermarkets?)\s+in\s`,
);

/** A bare place list after a selling verb: "distributed in Brooklyn, Queens, …". */
const PLACE_LIST_AFTER_IN = new RegExp(
  String.raw`\b(?:distributed|sold|shipped|available|delivered)\b[^.;\n]{0,40}?\bin\s+${PLACE_RUN}`,
  'g',
);

/** The distribution places one notice states, by kind. */
interface PlaceMentions {
  /** Metro/region phrases ("Seattle and Tacoma metro areas, Washington"). */
  phrases: string[];
  /** Plain city/borough names ("Bronx", "Ann Arbor"). */
  cities: string[];
  /** States the source attached to those places ("…, MI"). */
  states: string[];
  /** Retailer → geography relationships stated in the same clauses. */
  coverage: RetailerCoverage[];
}

/** The leading state (full name or postal code) of a captured tail, if any. */
function leadingState(text: string): string | null {
  const trimmed = text.trim();
  const code = trimmed.match(/^([A-Z]{2})\b/);
  if (code) return normalizeStateToken(code[1]);
  // Longest name first so "West Virginia" wins over "Virginia".
  const sorted = [...trimmed.matchAll(/^[A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)?/g)];
  for (const candidate of sorted.map((m) => m[0])) {
    const resolved = normalizeStateToken(candidate);
    if (resolved) return resolved;
    const oneWord = normalizeStateToken(candidate.split(' ')[0]);
    if (oneWord) return oneWord;
  }
  return null;
}

/**
 * Extract every geographic place a notice's distribution sentences mention,
 * classified as a state, a metro phrase, or a city — never as a retailer.
 * City recognition is deterministic: the curated gazetteer, or an explicit
 * state suffix in the source's own clause.
 */
function collectPlaces(text: string): PlaceMentions {
  const phrases: string[] = [];
  const cities: string[] = [];
  const states = new Set<string>();
  const coverage: RetailerCoverage[] = [];
  const addUnique = (list: string[], value: string) => {
    const cleaned = value.replace(/\s+/g, ' ').trim();
    if (cleaned !== '' && !list.some((v) => v.toLowerCase() === cleaned.toLowerCase())) {
      list.push(cleaned);
    }
  };
  const addCity = (name: string) => {
    const parts = splitAdjacentCities(name);
    if (parts) for (const part of parts) addUnique(cities, part);
    else addUnique(cities, name);
  };

  const lines = text
    .split('\n')
    .filter(
      (line) =>
        DISTRIBUTION_SENTENCE.test(line) &&
        !NOT_AN_AREA.test(line) &&
        !FIRM_LOCATION_SENTENCE.test(line),
    );

  // Cities first, phrases second: a phrase like "Bronx and New York City
  // area" is split into borough + metro phrase only when the borough is
  // independently established as a city, so "Seattle and Tacoma metro areas"
  // — one phrase naming one metro — is never torn apart.
  for (const line of lines) {
    // Places closed by an explicit state: "in Ann Arbor and Brighton, MI".
    for (const match of line.matchAll(NAMED_PLACES)) {
      const state = leadingState(match[2]);
      if (!state) continue;
      states.add(state);
      for (const part of match[1].split(/,\s*(?:and\s+)?|,?\s+and\s+/)) {
        if (part.split(/\s+/).length > 3 || normalizeStateToken(part)) continue;
        // The generic-tail phrases stay with the phrase pass below.
        if (/\b(?:areas?|metro|region|county|counties|neighborhoods?|boroughs?)$/i.test(part)) {
          continue;
        }
        addCity(part);
      }
    }

    // Bare place lists after a selling verb: "distributed in Brooklyn, Queens,
    // Bronx and New York City area…". Only gazetteer-known cities qualify, and
    // the first unknown token ends the run, so prose can never ride in.
    for (const match of line.matchAll(PLACE_LIST_AFTER_IN)) {
      for (const part of match[1].split(/,\s*(?:and\s+)?|,?\s+and\s+/)) {
        if (normalizeStateToken(part)) continue;
        if (!isUsCityName(part) && !splitAdjacentCities(part)) break;
        addCity(part);
      }
    }

    // City lists after a venue word: "Market of Choice stores in Ashland, …".
    for (const match of line.matchAll(VENUE_PLACE_LIST)) {
      const trailingState = match[2] ? normalizeStateToken(match[2]) : null;
      const entry: RetailerCoverage = { retailer: '', states: [], areas: [] };
      let stopped = false;
      for (const part of match[1].split(/,\s*(?:and\s+)?|,?\s+and\s+/)) {
        if (stopped) break;
        const asState = normalizeStateToken(part);
        if (asState) {
          states.add(asState);
          addUnique(entry.states, asState);
          continue;
        }
        const split = splitAdjacentCities(part);
        if (isUsCityName(part) || split) {
          addCity(part);
          for (const city of split ?? [part]) addUnique(entry.areas, city);
          continue;
        }
        // An unrecognized token ends the run — everything after it is prose.
        stopped = true;
      }
      if (trailingState) {
        states.add(trailingState);
        addUnique(entry.states, trailingState);
      }
      if (entry.states.length > 0 || entry.areas.length > 0) {
        const lead = line.slice(0, match.index! + match[0].length);
        const retailer = lead.match(RETAILER_BEFORE_VENUE)?.[1]?.trim() ?? '';
        if (retailer !== '' && isRetailerName(retailer)) {
          entry.retailer = retailer;
          coverage.push(entry);
        }
      }
    }
  }

  // The phrase pass, with cities established: a leading known city splits off
  // ("Bronx and New York City area" → borough + phrase), but a phrase whose
  // leading name is NOT independently a city ("Seattle and Tacoma metro
  // areas") stays whole.
  for (const line of lines) {
    for (const match of line.matchAll(AREA_PHRASE)) {
      // The place name keeps its capitals; the generic tail is a common noun
      // the source happened to title-case ("Metro areas" → "metro areas").
      let phrase = match[1]
        .replace(/\s+/g, ' ')
        .trim()
        .replace(
          /\b(Metro(?:politan)?|Areas?|Count(?:y|ies)|Region|Neighborhoods?|Boroughs?)\b(?=(?:\s+(?:areas?|metro))?\s*$)/g,
          (word) => word.toLowerCase(),
        );
      if (phrase.split(/\s+/).length < 2) continue;
      const parts = phrase.split(/,\s*(?:and\s+)?|,?\s+and\s+/);
      while (
        parts.length > 1 &&
        cities.some((city) => city.toLowerCase() === parts[0].toLowerCase())
      ) {
        parts.shift();
      }
      phrase = parts.join(' and ');
      if (phrase.split(/\s+/).length < 2) continue;
      // "…Metro areas in WA" — restore the state name the source abbreviated.
      const tail = line.slice(match.index! + match[0].length, match.index! + match[0].length + 24);
      const state = tail.match(
        /^\s+in\s+([A-Z]{2})\b|^\s+in\s+([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)?)/,
      );
      const resolved = state ? normalizeStateToken(state[1] ?? state[2]) : null;
      if (resolved) {
        phrase = `${phrase}, ${resolved}`;
        states.add(resolved);
      }
      addUnique(phrases, phrase);
    }
  }

  // A phrase subsumes its own leading place: with "New York City area" shown,
  // a bare "New York City" entry would read as a second place.
  const dedupedCities = cities.filter(
    (city) => !phrases.some((phrase) => phrase.toLowerCase().startsWith(city.toLowerCase())),
  );

  return {
    phrases: phrases.slice(0, 3),
    cities: dedupedCities.slice(0, 12),
    states: [...states],
    coverage,
  };
}

/**
 * Named stores listed as a block rather than in a sentence — a heading that
 * announces retailers, then one store per line:
 *
 *   Other grocery stores in Seattle/Tacoma area in WA:
 *   Central Co-op
 *   Fred Meyer Stores
 *   PCC Markets
 *   …
 *
 * Sentence-level retailer extraction cannot see these at all, so a notice that
 * names twelve stores was being reduced to "grocery stores". This retailer
 * data is also exactly what store-based personalization will need.
 */
/** A legal-entity tail, which is part of a store's name and never a name itself. */
const CORPORATE_SUFFIX = /^(?:LLC|L\.L\.C\.|Inc\.?|Incorporated|Ltd\.?|Co\.?|Corp\.?|LP|LLP)$/i;

export function extractRetailerListBlock(summaryText: string | null): string[] {
  if (!summaryText) return [];
  const lines = summaryText.split('\n').map((line) => line.trim());
  const found: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    // A heading naming stores or locations, ending in a colon.
    // "…Café locations in Seattle area in WA:" lists neighborhoods, not
    // businesses. A heading naming stores or retailers lists companies; one
    // naming locations lists places, which belong to geography instead.
    const heading = lines[index];
    if (
      !/\b(?:stores?|retailers?|retail|markets?|supermarkets?|distributors?|grocers?|sold at|available at|distributed to)\b[^:]{0,70}:$/i.test(
        heading,
      )
    ) {
      continue;
    }
    if (/\blocations?\b/i.test(heading)) continue;
    for (let next = index + 1; next < lines.length; next++) {
      const line = lines[next];
      // The block ends at a blank line, a sentence, or another heading.
      if (line === '' || line.endsWith(':') || line.split(/\s+/).length > 6) break;
      if (!/^[A-Z0-9]/.test(line)) break;
      // A period ends the block — unless it is the abbreviation inside a legal
      // name. "Golden Touch Trading Inc." used to end the list, silently
      // dropping the ten stores listed after it.
      if (/[.!?]$/.test(line) && !/\b(?:Inc|LLC|L\.L\.C|Ltd|Co|Corp)\.$/i.test(line)) break;
      // "H-Mart Kakaako, LLC" is one store, not two. A comma only separates
      // names when neither side is a bare corporate suffix.
      const parts = line.split(/\s*,\s*/);
      const names = parts.some((part) => CORPORATE_SUFFIX.test(part.trim())) ? [line] : parts;
      for (const name of names) {
        const cleaned = name.replace(/\s+/g, ' ').trim();
        if (cleaned.length < 3 || cleaned.length > 44) continue;
        // A block under a "sold at" heading is not always a store list: some
        // notices list PRODUCTS there, barcode and all.
        if (!isRetailerName(cleaned)) continue;
        if (!found.some((f) => f.toLowerCase() === cleaned.toLowerCase())) found.push(cleaned);
      }
    }
  }
  return found;
}

/**
 * Specific store addresses the notice lists under its own heading:
 *
 *   The product was sold at the following Zion Market locations:
 *   2751 Beverly Blvd, Los Angeles, CA
 *   …
 *
 * Six named addresses is the most specific answer a recall can give to "did
 * this reach the store I shop at". Collapsing that to "Sold through retail
 * stores" is the single largest kind of information loss this layer prevents.
 */
export function extractRetailLocationBlock(summaryText: string | null): string[] {
  if (!summaryText) return [];
  const lines = summaryText.split('\n').map((line) => line.trim());
  const found: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (!/\blocations?\b[^:]{0,50}:$/i.test(lines[index])) continue;
    for (let next = index + 1; next < lines.length; next++) {
      const line = lines[next];
      if (line === '' || line.endsWith(':')) break;
      // An address states a street number and a place; a sentence does not.
      if (!/^\d{1,6}\s+\S|^[A-Z][A-Za-z.'’ -]{2,30},\s*\d{1,6}\s/.test(line)) break;
      if (line.length > 90) break;
      const cleaned = line.replace(/\s+/g, ' ').replace(/[;,]$/, '').trim();
      if (!found.some((f) => f.toLowerCase() === cleaned.toLowerCase())) found.push(cleaned);
    }
  }
  return found;
}

/**
 * Store addresses from a Retailer/Address table.
 *
 * An address only counts when the same row also names a store: that is what
 * makes it a place someone shopped rather than the recalling firm's own
 * headquarters, which announcements print in a table of their own.
 */
export function tableRetailLocations(tableFacts: SemanticFact[]): string[] {
  const retailerScopes = new Set(
    tableFacts
      .filter((fact) => fact.concept === 'distribution' && isRetailerName(fact.value.trim()))
      .map((fact) => fact.scope),
  );
  return tableFacts
    .filter((fact) => fact.concept === 'retail_location' && retailerScopes.has(fact.scope))
    .map((fact) => cleanDisplayText(fact.value))
    .filter((value) => isValidForConcept('retail_location', value));
}

/** How many states read as a list before a count plus disclosure reads better. */
const STATES_LISTED = 12;

/** Two-letter state codes, which a sentence pattern can mistake for a store. */
const STATE_CODE =
  /^(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/;

/**
 * One store named once, in its fullest form.
 *
 * Notices refer to the same chain several ways on one page — "Costco" and
 * "Costco Wholesale", or "H-E-B" twice — and listing both makes a single
 * distribution route read as two. The longer name wins because it is the more
 * complete answer to "where was this sold".
 */
function dedupeRetailers(names: string[]): string[] {
  const kept: string[] = [];
  // Longest first, so "Costco Wholesale" is established before "Costco" is
  // tested against it.
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    const key = dedupeKey(name);
    if (key === '' || STATE_CODE.test(name.trim())) continue;
    if (kept.some((existing) => dedupeKey(existing).includes(key))) continue;
    kept.push(name);
  }
  // Restore the source's own ordering, emitting each surviving name once.
  const remaining = new Set(kept);
  const ordered: string[] = [];
  for (const name of names) {
    if (!remaining.delete(name)) continue;
    ordered.push(name);
  }
  return ordered;
}

/** How many named retailers the separate retailer line shows before "more". */
const RETAILERS_LISTED = 5;

/**
 * Build the structured "Where it was sold" projection.
 *
 * Every field can hold only one kind of thing: places, sellers, platforms, or
 * broad routes. There is deliberately no free-text field and no path that
 * copies a source sentence through, because that path is what carried a lot
 * number and a two-week shipping window into the answer to "did this recall
 * reach my store?".
 *
 * When nothing can be established the copy stops at "Distribution not
 * specified." — it never refers the user to the government page.
 */
export function buildDistribution(
  projection: CaseProjection,
  tableFacts: SemanticFact[],
): ConsumerDistribution {
  const summary = projection.summaryText ?? '';
  const distributionText = distributionRegion(summary);

  // A "Retailer" column names stores as surely as a sentence does.
  const tableRetailers = tableFacts
    .filter((fact) => fact.concept === 'distribution')
    .map((fact) => cleanDisplayText(fact.value))
    .filter((value) => isRetailerName(value) && value.length <= 44);
  const sentenceRetailers =
    projection.retailerNames?.length > 0
      ? projection.retailerNames
      : extractRetailerNames(`${projection.title}\n${summary}`);
  const retailers = dedupeRetailers([
    ...sentenceRetailers,
    ...extractRetailerListBlock(summary),
    ...tableRetailers,
  ]);

  const retailLocations = [
    ...extractRetailLocationBlock(summary),
    ...tableRetailLocations(tableFacts),
  ];

  const onlinePlatforms = collectOnlinePlatforms(distributionText);
  const places = collectPlaces(summary);

  // A specific name always supersedes the generic word for the same route.
  // "Sold at Amazon.com and sold online through Amazon.com" names one channel
  // twice; "sold at Publix and also through retail stores" adds a category
  // that Publix already is.
  //
  // And one entity has exactly ONE role: anything this projection classifies
  // as geography — a state, a city, a metro phrase, a directional region —
  // is thereby forbidden from the retailer list. This is the hard invariant
  // that keeps "Southern California" out of RETAILERS while it renders under
  // AREAS; extraction bugs upstream can propose whatever they like and still
  // cannot put one string in both sections.
  const placeKeys = new Set(
    [...places.cities, ...places.phrases, ...projection.geography.states].map(dedupeKey),
  );
  const namedRetailers = retailers.filter(
    (name) =>
      !onlinePlatforms.some((platform) => dedupeKey(platform) === dedupeKey(name)) &&
      !placeKeys.has(dedupeKey(name)) &&
      normalizeStateToken(name) === null &&
      !isUsCityName(name) &&
      !isGeographicName(name),
  );
  // A "Sold At" column states a route as surely as a sentence does, so table
  // text that did not resolve to a store name is still read for channels.
  const tableChannelText = tableFacts
    .filter((fact) => fact.concept === 'distribution' && !isRetailerName(fact.value.trim()))
    .map((fact) => fact.value)
    .join(' ');
  // Only broad routes a consumer learns something from. The generic shop words
  // are not in the approved set at all, so "Sold through retail stores." can
  // never be this section's answer.
  const channels = collectChannels(`${distributionText} ${tableChannelText}`).filter((channel) =>
    APPROVED_CHANNELS.has(channel),
  );

  const geography = projection.geography;
  // Display-side state recovery: the persisted geography was extracted at
  // ingest time, and parser improvements must reach already-stored cases.
  // Supplement (never narrow) the geography with the states the notice's own
  // distribution sentences name — this is what restores "MI, MN, and ND" to
  // all three states, and what widens an FSIS structured state list when the
  // notice's prose explicitly names more states than the field carries. A
  // declared geography LIST under a distribution lead-in counts the same way:
  // "…and the following United States:" followed by one state per bullet is a
  // distribution statement the sentence extractors cannot see. A union can
  // only widen; a stated Nationwide scope is never second-guessed.
  const supplemental =
    geography.scope === 'nationwide'
      ? []
      : [
          ...statesInText(distributionText),
          ...places.states,
          ...extractDistributionListStates(projection.summaryHtml),
        ];
  const states = [...new Set([...geography.states, ...supplemental])].sort();

  const scopeType: ConsumerDistribution['scopeType'] =
    geography.scope === 'nationwide'
      ? 'nationwide'
      : states.length > 0
        ? 'states'
        : places.phrases.length > 0 || places.cities.length > 0
          ? 'areas'
          : 'unspecified';

  // The lead line answers one question — where — and states nothing else.
  // A metro phrase leads when the source gave one ("Seattle and Tacoma metro
  // areas, Washington"); otherwise the states; otherwise the cities. Plain
  // city lists render in their own AREAS block, never in the lead.
  let areaText: string;
  if (scopeType === 'nationwide') {
    areaText =
      places.phrases.length > 0
        ? `Nationwide, including ${joinValues(places.phrases)}.`
        : 'Nationwide.';
  } else if (scopeType === 'states') {
    areaText =
      places.phrases.length > 0
        ? `${joinValues(places.phrases)}.`
        : states.length > STATES_LISTED
          ? `${states.length} states.`
          : `${joinValues(states)}.`;
  } else if (scopeType === 'areas') {
    areaText = `${joinValues(places.phrases.length > 0 ? places.phrases : places.cities)}.`;
  } else {
    areaText =
      namedRetailers.length > 0 || onlinePlatforms.length > 0 || channels.length > 0
        ? ''
        : 'Distribution not specified.';
  }

  // The AREAS block: plain cities, plus any phrase the lead did not use.
  const areas = scopeType === 'areas' && places.phrases.length === 0 ? [] : places.cities;

  // Retailer → geography relationships from both clause shapes, deduplicated
  // by retailer with their places merged.
  const coverage = new Map<string, RetailerCoverage>();
  const coverageEntries = [
    ...places.coverage,
    ...retailersWithPlaces(summary).map((entry) => {
      const covered: RetailerCoverage = { retailer: entry.retailer, states: [], areas: [] };
      for (const place of entry.places) {
        const state = normalizeStateToken(place);
        if (state) covered.states.push(state);
        else if (isUsCityName(place)) covered.areas.push(place);
      }
      return covered;
    }),
  ];
  for (const entry of coverageEntries) {
    if (entry.states.length === 0 && entry.areas.length === 0) continue;
    // Coverage is a relationship ON the rendered retailers — an entry whose
    // name is not itself a consumer-visible retailer (a consignee, a
    // distribution center) is preserved in the source, not modeled here.
    if (!namedRetailers.some((name) => dedupeKey(name) === dedupeKey(entry.retailer))) continue;
    const key = dedupeKey(entry.retailer);
    const existing = coverage.get(key);
    if (!existing) {
      coverage.set(key, entry);
      continue;
    }
    existing.states = [...new Set([...existing.states, ...entry.states])];
    existing.areas = [...new Set([...existing.areas, ...entry.areas])];
  }

  return {
    scopeType,
    areaText,
    states,
    areas,
    coverage: [...coverage.values()],
    retailers: namedRetailers,
    retailersShown: namedRetailers.slice(0, RETAILERS_LISTED),
    retailersHidden: Math.max(0, namedRetailers.length - RETAILERS_LISTED),
    retailLocations,
    onlinePlatforms,
    channels,
    unspecified:
      scopeType === 'unspecified' &&
      namedRetailers.length === 0 &&
      onlinePlatforms.length === 0 &&
      channels.length === 0,
  };
}

// ── Lot codes ───────────────────────────────────────────────────────────────

/**
 * Collapse a code set behind its own disclosure step, preserving the calendar
 * date the source printed beside each code. The pairing is the whole point: a
 * consumer reads the date, then confirms against the code actually stamped on
 * their package.
 */
function buildLotCodes(
  facts: SemanticFact[],
  concept: 'lot' | 'production_code' = 'lot',
): LotCodeSet | null {
  const codes: string[] = [];
  const pairs: { code: string; date: string }[] = [];
  const seen = new Set<string>();
  let label = CONCEPT_LABEL[concept];

  // Facts arrive already expanded, so a code/date cell has become one fact per
  // code, with its date carried alongside.
  for (const item of facts) {
    if (item.concept !== concept) continue;
    if (concept === 'lot' && /batch/i.test(item.sourceLabel)) label = 'Batch code';
    const compound = splitCompoundCell(item.value);
    const tokens =
      compound.pairs.length > 0
        ? compound.pairs.map((p) => p.code)
        : // "and"/"or" and list bullets separate codes exactly as commas do;
          // without them a nine-code cell counts as four tokens, dodges the
          // collapse threshold, and lands inline as a wall of codes.
          compound.body.split(/[,;•·]|\s{2,}|\s+(?:and|or)\s+/i);
    for (const token of tokens) {
      // A conjunction stranded on a token by an upstream comma split is the
      // seam, not the code: ", and 30324s" must never render "and 30324s".
      const code = token
        .trim()
        .replace(/^(?:and|or)\s+/i, '')
        .replace(/[.;,]+$/, '');
      if (!/^[A-Za-z0-9][A-Za-z0-9 /-]{2,24}$/.test(code)) continue;
      if (seen.has(code)) continue;
      seen.add(code);
      codes.push(code);
      const date = item.pairedDate ?? compound.pairs.find((p) => p.code === code)?.date ?? null;
      if (date) {
        // The code itself can prove an ambiguous numeric date's order; when it
        // cannot, the source's own wording stands.
        const resolved = resolveDateWithCode(date, code);
        pairs.push({
          code,
          date: resolved.canonical ? resolved.display : normalizeDateValue(date).display,
        });
      }
    }
  }
  if (codes.length === 0) return null;
  return { count: codes.length, codes, pairs, label };
}

// ── Consumer action ─────────────────────────────────────────────────────────

/**
 * The always-visible instruction. Source instructions win when the notice
 * gives one; otherwise we state a cautious recommendation in OUR voice rather
 * than claiming the agency said it — and never refer the user elsewhere.
 * Undeclared-allergen recalls are scoped to the people actually at risk: the
 * food is not unsafe for everyone, and saying so would be false.
 */
export function buildConsumerAction(projection: CaseProjection): ConsumerAction {
  const fromSource = stripEmphasis(consumerActionDisplay(projection.consumerAction));
  const allergens = normalizedAllergenTokens(projection.pathogenOrAllergen);
  const isAllergen = projection.hazardCategory === 'allergen';

  if (fromSource?.standardized) {
    // Standardized source instruction; scope it to the at-risk group when the
    // hazard is an undeclared allergen.
    if (isAllergen && allergens.length > 0) {
      const list = joinValues(allergens).replace(/ and /g, ' or ').replace(/, /g, ', ');
      return {
        text: `If you are allergic or sensitive to ${list}, ${fromSource.primary.charAt(0).toLowerCase()}${fromSource.primary.slice(1)}`,
        origin: 'source',
        secondary: fromSource.secondary,
      };
    }
    return { text: fromSource.primary, origin: 'source', secondary: fromSource.secondary };
  }

  if (fromSource) {
    // Unrecognized but real source instruction: keep the source's meaning,
    // minus package-specific detail, which belongs in the package checker.
    const cleaned = stripPackageSpecifics(fromSource.primary);
    if (cleaned && isCompleteInstruction(cleaned)) {
      return { text: cleaned, origin: 'source', secondary: fromSource.secondary };
    }
  }

  if (isAllergen && allergens.length > 0) {
    const list = joinValues(allergens).replace(/ and /g, ' or ');
    return {
      text: `If you are allergic or sensitive to ${list}, do not eat this product. If your package matches the recall, throw it away.`,
      origin: 'app',
      secondary: null,
    };
  }
  if (isAllergen) {
    return {
      text: 'If you have a food allergy or sensitivity, do not eat this product. If your package matches the recall, throw it away.',
      origin: 'app',
      secondary: null,
    };
  }
  return {
    text: 'We recommend that you do not eat this product. If your package matches the recall, throw it away.',
    origin: 'app',
    secondary: null,
  };
}

/**
 * Some notices shout their instruction in markdown ("**DO NOT CONSUME THIS
 * PRODUCT**"). The emphasis is the source's formatting, not its words, and
 * rendering the asterisks makes our own copy look broken.
 */
function stripEmphasis<T extends { primary: string; secondary: string | null }>(
  action: T | null,
): T | null {
  if (!action) return null;
  const clean = (text: string) =>
    text
      .replace(/\*{1,3}|_{2,}/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  return {
    ...action,
    primary: clean(action.primary),
    secondary: action.secondary === null ? null : clean(action.secondary),
  };
}

/**
 * Remove lot/UPC/date specifics from an action sentence (they live in the
 * checker).
 *
 * The clause is bounded to the identifier itself. An unbounded strip is what
 * turned "Consumers who have purchased Sura Tanmen with lot code 1226183 are
 * urged not to consume the product and to return it to the original place of
 * purchase for a full refund." into "Consumers who have purchased Sura
 * Tanmen." — it swallowed the entire instruction because no comma or period
 * happened to follow the lot number.
 */
function stripPackageSpecifics(text: string): string | null {
  const cleaned = cleanDisplayText(
    text
      .replace(
        /\s*(?:with|bearing|having)\s+(?:the\s+)?(?:lot|batch|UPC|best[- ]by|use[- ]by)\s*(?:codes?|numbers?|dates?|#)?\s*[:#]?\s*[A-Z0-9][A-Z0-9/-]*(?:\s*(?:,|and)\s*[A-Z0-9][A-Z0-9/-]*)*/gi,
        '',
      )
      .replace(/\s*\((?:lot|batch|UPC)[^)]*\)/gi, ''),
  );
  return cleaned.length >= 12 ? cleaned : null;
}

/**
 * Verbs that make a sentence an instruction to a consumer. Every approved
 * action either tells someone what to do or tells them what not to do.
 */
const INSTRUCTION_VERB =
  /\b(?:do not|don't|should not|not to|stop|discard|dispose|destroy|throw|return|check|avoid|refrain|contact|dispose of|urged|advised|asked|encouraged|may return|can return)\b/i;

/**
 * True when a sentence actually instructs the reader.
 *
 * "Consumers who have purchased Sura Tanmen." is a grammatical sentence and
 * says nothing. Rendering a fragment under "What you should do" is worse than
 * rendering our own clear recommendation, because the reader believes they have
 * been told something.
 */
function isCompleteInstruction(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.split(/\s+/).length < 6) return false;
  if (!INSTRUCTION_VERB.test(trimmed)) return false;
  // A trailing subordinator means the sentence was cut off mid-clause.
  return !/\b(?:with|and|or|to|the|of|that|who|which|for|from|in|at|by)\s*[.]?$/i.test(trimmed);
}

// ── Package check ───────────────────────────────────────────────────────────

const IDENTIFIER_KEYWORDS =
  /\bUPC\b|\blot\b|\bbatch\b|best[-\s]?(if\s+used\s+)?by|use[-\s]?by|sell[-\s]?by|expiration date|date code|case code|item number/i;

/**
 * Concepts that name a specific product or package. A recall that lists any of
 * them is scoped to those products, whether or not the consumer schema has an
 * approved field for the one the source happened to use.
 */
const IDENTIFYING_CONCEPTS = new Set<ConsumerConcept>([
  'upc',
  'product_code',
  'lot',
  'case_code',
  'item_number',
  'production_code',
]);

/** At or below this many codes, show them inline rather than behind a tap. */
const SMALL_CODE_SET = 4;

/**
 * Photos to show inside the package checker.
 *
 * The checker exists to answer "is this MY package?", and it already prints
 * `Barcode (UPC): 041548610047` as text — a macro photograph of that same
 * barcode adds nothing a consumer can act on, so code crops are excluded here
 * as they are from the gallery. A package or label photograph that happens to
 * contain a barcode is a different thing entirely and still helps.
 *
 * When every affected version carries its own photo, those appear on the
 * version cards and a shared central image would only repeat one of them.
 */
function checkerPhotos(photos: ProductPhoto[], variants: AffectedVariant[]): ProductPhoto[] {
  // Once most versions carry their own picture, a shared one only repeats a
  // photo the reader is about to see on a card.
  const withPhoto = variants.filter((variant) => variant.photo !== null).length;
  if (variants.length > 1 && withPhoto * 2 >= variants.length) return [];
  const recognizable = galleryPhotos(photos).filter(
    (photo) => photo.role !== 'barcode_closeup' && photo.role !== 'code_closeup',
  );
  // One image is a comparison aid; a strip of them is the gallery again.
  return recognizable.slice(0, 1);
}

/**
 * Hoist fields every version states identically into one shared block.
 *
 * When all thirty-three egg rows carry the same "Best By / Sell By" range, the
 * range is a fact about the whole recall, proven by every row's own cell —
 * exactly the evidence Part 14's shared scope requires. Shown once above the
 * cards it is readable; repeated on every card it is noise; left loose below
 * the cards it reads as an unexplained extra. Only unanimous, identical
 * values hoist — a key any version omits, or states differently, stays where
 * the source put it.
 */
function hoistSharedFields(variants: AffectedVariant[]): {
  variants: AffectedVariant[];
  shared: PackageField[];
} {
  if (variants.length < 2) return { variants, shared: [] };
  const shared: PackageField[] = [];
  const sharedKeys = new Set<PackageField['key']>();
  const first = variants[0];
  for (const field of first.fields) {
    const signature = [...field.canonicalKeys].sort().join('|');
    const unanimous = variants.every((variant) =>
      variant.fields.some(
        (candidate) =>
          candidate.key === field.key &&
          [...candidate.canonicalKeys].sort().join('|') === signature,
      ),
    );
    if (unanimous) {
      shared.push({ ...field });
      sharedKeys.add(field.key);
    }
  }
  if (shared.length === 0) return { variants, shared };
  return {
    variants: variants.map((variant) => ({
      ...variant,
      fields: variant.fields.filter((field) => !sharedKeys.has(field.key)),
    })),
    shared,
  };
}

/**
 * Hoist a code location that applies to every affected version.
 *
 * Outshine states "bottom of package" once and it is true of all six flavors,
 * so repeating it inside every card is noise the reader has to skip six times.
 * Per-version locations survive only when they genuinely differ.
 */
function hoistSharedCodeLocation(
  variants: AffectedVariant[],
  caseLocation: CodeLocation | null,
): { variants: AffectedVariant[]; shared: CodeLocation | null } {
  const located = variants.filter((variant) => variant.codeLocation !== null);
  const distinct = new Set(located.map((variant) => variant.codeLocation!.text));
  const sharedByVariants =
    located.length === variants.length && variants.length > 0 && distinct.size === 1
      ? located[0].codeLocation
      : null;

  const shared = sharedByVariants ?? caseLocation;
  if (shared === null) return { variants, shared: null };
  // Any version whose location matches the shared statement stops repeating it.
  return {
    variants: variants.map((variant) =>
      variant.codeLocation?.text === shared.text ? { ...variant, codeLocation: null } : variant,
    ),
    shared,
  };
}

/**
 * Sentences that state where a code is printed. Each candidate is validated and
 * re-composed before it can be shown — the free-text match only proposes.
 *
 * The clause is bounded by a comma as well as a sentence end, because
 * "…located in Missouri City, TX and Houston, TX is voluntarily recalling
 * products containing…" is a company address that a looser bound turned into
 * a place to look for a lot code.
 */
const LOCATION_SENTENCE = [
  /\b(?:can|may)\s+be\s+found\s+(?:on|in|at|directly\s+beneath|below|beneath|under|next\s+to)\b[^.;\n]{3,70}/gi,
  /\b(?:printed|stamped|marked|displayed|embossed|located)\s+(?:on|in|at|below|beneath|under)\b[^.;\n]{3,70}/gi,
];

/**
 * Where a package's codes are, as one standardized statement.
 *
 * Every candidate must survive `composeCodeLocation`, which requires a
 * nameable surface or position and rejects recall narrative, firm addresses,
 * and cross-references between product versions. When nothing survives the
 * section is simply omitted: no location is better than a wrong one, because a
 * consumer sent to the wrong place will not find the code and may conclude
 * their package is unaffected.
 */
function codeLocationFrom(facts: SemanticFact[], projectionText: string): CodeLocation | null {
  const candidates: string[] = [];
  for (const item of facts) {
    if (item.concept === 'identifier_location') candidates.push(item.value);
    const compound = splitCompoundCell(item.value);
    if (compound.locationHint) candidates.push(compound.locationHint);
  }
  for (const pattern of LOCATION_SENTENCE) {
    for (const match of projectionText.matchAll(pattern)) candidates.push(match[0]);
  }

  // Prefer the statement that tells the consumer the most: knowing how the
  // code looks beats knowing only which surface it is on.
  const score = (location: CodeLocation) => (location.appearance ? 100 : 0) + location.text.length;
  let best: CodeLocation | null = null;
  for (const candidate of candidates) {
    const composed = composeCodeLocation(cleanDisplayText(candidate));
    if (composed && (best === null || score(composed) > score(best))) best = composed;
  }
  return best;
}

function buildPackageCheck(
  projection: CaseProjection,
  affectedProducts: AffectedProduct[],
  rawTableFacts: SemanticFact[],
  rawProseFacts: SemanticFact[],
  inputVariants: AffectedVariant[],
  photos: ProductPhoto[],
  sourceStatesNoCodes = false,
): ConsumerPackageCheck {
  let variants = inputVariants;
  const summary = projection.summaryText ?? '';
  // Expand compound cells once, so lot codes, dates, and placement hints are
  // separated before anything decides where they belong.
  const tableFacts = rawTableFacts.flatMap(expandFact);
  const proseFacts = rawProseFacts.flatMap(expandFact);

  // A labeled product-name line names the product the section already shows,
  // but the measurement inside it is the package size the source stated
  // ("Item name : Birch Benders 12 oz Sweet Potato Pancake and Waffle Mix").
  // Harvested only when no versions exist and nothing else states a size, so
  // an explicit Size fact always wins.
  if (
    variants.length === 0 &&
    !proseFacts.some((f) => f.concept === 'package_size') &&
    !tableFacts.some((f) => f.concept === 'package_size')
  ) {
    const named = proseFacts.find(
      (f) =>
        f.concept === 'variant' &&
        /\b\d[\d./]*\s*-?\s*(?:oz|ounces?|lbs?|pounds?|g|grams?|kg|ml|l)\b/i.test(f.value),
    );
    const measure = named?.value.match(
      /\b(\d[\d./]*\s*-?\s*(?:oz|ounces?|lbs?|pounds?|g|grams?|kg|ml|l))\b/i,
    );
    if (named && measure) {
      proseFacts.push({
        concept: 'package_size',
        sourceLabel: named.sourceLabel,
        value: measure[1],
        raw: named.raw ?? named.value,
        evidence: named.evidence,
        scope: named.scope,
      });
    }
  }

  // Case-level facts: prose facts, plus table facts when no variant carried
  // them (a single-variant table's facts are shown on the variant instead).
  // Lot codes are collapsed separately; distribution, identity, and placement
  // are rendered by their own sections.
  const variantFields = new Set(variants.flatMap((v) => v.fields.map((f) => f.key)));
  const caseFacts = [
    ...proseFacts,
    ...(variants.length === 0
      ? tableFacts
      : tableFacts.filter((f) => {
          const field = packageFieldFor(f.concept);
          return field === null || !variantFields.has(field);
        })),
  ].filter(
    (f) =>
      f.concept !== 'lot' &&
      f.concept !== 'production_code' &&
      f.concept !== 'distribution' &&
      f.concept !== 'variant' &&
      f.concept !== 'brand' &&
      f.concept !== 'company' &&
      f.concept !== 'identifier_location',
  );

  // Legacy structured product lines (persisted before V2) still contribute
  // identifiers when the announcement had no interpretable table.
  const legacyFacts: SemanticFact[] = [];
  if (variants.length === 0 && tableFacts.length === 0) {
    for (const product of affectedProducts) {
      const parsed = parseProductLine(product.rawText);
      if (!parsed) continue;
      for (const identifier of parsed.identifiers) {
        legacyFacts.push({
          concept: conceptForLabel(identifier.label),
          sourceLabel: identifier.label,
          value: identifier.value,
        });
      }
    }
  }

  const allLotFacts = [...tableFacts, ...proseFacts, ...legacyFacts.flatMap(expandFact)];
  // Codes already presented under a specific version are not restated as
  // recall-wide codes — whether the version carries them as a collapsed set
  // or as inline field values.
  const variantCodes = new Set(
    [
      ...variants.flatMap((v) => v.lotCodes?.codes ?? []),
      ...variants.flatMap((v) =>
        v.fields
          .filter((field) => field.key === 'lotCodes' || field.key === 'batchCodes')
          .flatMap((field) => field.values),
      ),
    ].map((code) => code.toLowerCase()),
  );
  const unclaimedLotFacts = allLotFacts.filter(
    (f) => f.concept !== 'lot' || !variantCodes.has(f.value.trim().toLowerCase()),
  );
  const lotSet = buildLotCodes(unclaimedLotFacts);
  // A handful of codes is easier to read inline than behind a second tap;
  // only genuinely large sets earn their own disclosure step.
  const collapseLots = lotSet !== null && lotSet.count > SMALL_CODE_SET;
  // Production codes are opaque by nature ("26192"). The readable calendar
  // date the source paired with each one is what leads; the printed code stays
  // available, mapped to its date, for the person checking a package.
  const productionSet = buildLotCodes(unclaimedLotFacts, 'production_code');
  const collapseProduction = productionSet !== null && productionSet.count > SMALL_CODE_SET;
  const facts = withoutVariantOwnedValues(
    aggregateFacts([
      ...caseFacts,
      // Legacy lot/production codes reach the checker through the code-set
      // path below, exactly like every other source shape — adding them here
      // as well rendered one large code list twice: collapsed AND inline.
      ...legacyFacts.filter((f) => f.concept !== 'lot' && f.concept !== 'production_code'),
      ...(lotSet && !collapseLots ? unclaimedLotFacts.filter((f) => f.concept === 'lot') : []),
      ...(productionSet && !collapseProduction
        ? unclaimedLotFacts.filter((f) => f.concept === 'production_code')
        : []),
    ]),
    variants,
  );
  let lotCodes = collapseLots ? lotSet : null;
  const productionCodes = collapseProduction ? productionSet : null;
  // Project the case-level facts through the closed schema. Anything with no
  // approved field stops here — recorded, counted, and never rendered.
  const projected = toPackageFields(facts);
  let fields = projected.fields;
  const rejected = [...projected.rejected, ...variants.flatMap((variant) => variant.rejected)];

  // The zero-orphan rule, now total. In variant mode a package fact has
  // exactly two legal scopes: inside the version card that owns it, or in the
  // proven-shared block above the cards. Nothing ever renders as a loose row
  // BELOW the cards. A case-level fact resolves by evidence:
  //
  //   - its kind is carried by some version → suppressed. A competing owner
  //     exists, so recall-wide scope would be an invention (the value-level
  //     duplicates were already removed by canonical identity above).
  //   - its kind is carried by NO version, and every source statement of that
  //     kind is a scope-less recall-level sentence → the shared block. The
  //     source itself asserted the fact about the whole recall ("Sura Tanmen
  //     with lot code 1226183"), which is exactly the shared-scope evidence
  //     Part 14 requires.
  //   - otherwise (row-scoped residue that failed to attach) → suppressed.
  //     Shared scope is never inferred from a fact merely being unassigned.
  const variantMode = variants.some(
    (variant) => variant.fields.length > 0 || variant.lotCodes !== null,
  );
  const sharedFromCase: PackageField[] = [];
  if (variantMode) {
    const variantFieldKeys = new Set(variants.flatMap((v) => v.fields.map((f) => f.key)));
    // Provenance by concept over the same inputs the case fields were built
    // from: any scoped statement of a kind means row residue may be present.
    const caseFieldInputs = [
      ...caseFacts,
      ...legacyFacts,
      ...unclaimedLotFacts.filter((f) => f.concept === 'lot' || f.concept === 'production_code'),
    ];
    const conceptHasScopedSource = (concept: ConsumerConcept) =>
      caseFieldInputs.some(
        (f) =>
          f.scope !== undefined &&
          (f.concept === concept || (concept === 'lot' && f.concept === 'production_code')),
      );
    for (const field of fields) {
      if (
        !variantFieldKeys.has(field.key) &&
        !conceptHasScopedSource(conceptForFieldKey(field.key))
      ) {
        sharedFromCase.push(field);
        continue;
      }
      rejected.push({
        concept: conceptForFieldKey(field.key),
        sourceLabel: field.label,
        values: field.values,
        reason: 'ambiguous-scope',
      });
    }
    fields = [];
    // The same rule for a collapsed case-level code set beside versions that
    // carry their own codes.
    const variantsOwnCodes =
      variantFieldKeys.has('lotCodes') ||
      variantFieldKeys.has('batchCodes') ||
      variants.some((variant) => variant.lotCodes !== null);
    if (lotCodes !== null && variantsOwnCodes) {
      rejected.push({
        concept: 'lot',
        sourceLabel: lotCodes.label,
        values: lotCodes.codes,
        reason: 'ambiguous-scope',
      });
      lotCodes = null;
    }
  }

  // Fields every version states identically move to the one shared block,
  // joined by recall-wide prose statements of kinds no version carries; the
  // block keeps the standard field order.
  const hoistedFields = hoistSharedFields(variants);
  variants = hoistedFields.variants;
  const sharedFields = [...hoistedFields.shared, ...sharedFromCase].sort(
    (a, b) => PACKAGE_FIELD_ORDER.indexOf(a.key) - PACKAGE_FIELD_ORDER.indexOf(b.key),
  );

  // A location every version shares is stated once, globally.
  const hoisted = hoistSharedCodeLocation(
    variants,
    codeLocationFrom([...tableFacts, ...proseFacts], summary),
  );
  const codeLocation = hoisted.shared;
  variants = hoisted.variants;

  // Production codes are opaque, so the calendar dates the source paired them
  // with lead the disclosure: "July 11, 15, 16, 18, and 22, 2026" is something
  // a person can read off a bag; "26192" is something they can only compare.
  const productionDateGroup = facts.find((group) => group.concept === 'production_date');
  const productionDates =
    productionSet !== null && productionDateGroup
      ? joinFactValues('production_date', productionDateGroup.values)
      : null;

  const hasIdentifiers =
    variants.length > 0 ||
    fields.length > 0 ||
    sharedFields.length > 0 ||
    lotCodes !== null ||
    productionCodes !== null ||
    affectedProducts.length > 0;

  /**
   * The kill switch. A section that exists because "some source data was
   * present" is how a wall of unexplained numbers gets published; the question
   * is whether anything a person can actually check survived the schema.
   *
   * A bare list of version names is not enough — that is the arbitrary product
   * list, not package identification.
   */
  const render =
    fields.length > 0 ||
    sharedFields.length > 0 ||
    variants.some((variant) => variant.fields.length > 0 || variant.photo !== null) ||
    lotCodes !== null ||
    productionCodes !== null;

  const coverage: PackageCoverage = hasIdentifiers
    ? [...fields, ...sharedFields].some((f) => f.key !== 'packaging' && f.key !== 'size') ||
      lotCodes !== null ||
      productionCodes !== null ||
      variants.length > 0
      ? 'structured'
      : 'partial'
    : // A notice that explicitly says the product carries no codes is honest
      // source silence, not a parser failure.
      IDENTIFIER_KEYWORDS.test(summary) && !sourceStatesNoCodes
      ? 'parser_missed'
      : 'source_silent';

  // Wording must stay true when the recall covers every version. Matched only
  // against recall-scope phrasing ("recalling all lots of…") — an incidental
  // "All products are Ready-to-Eat" sentence must not flip the statement.
  const coversAll =
    /\b(?:recall(?:s|ed|ing)?|affects?|affected)\b[^.]{0,60}\ball\s+(?:lots|products|varieties|flavors|sizes|codes|dates)\b/i.test(
      `${projection.title} ${summary}`,
    ) || /\ball\s+(?:lots|varieties|flavors)\s+(?:of|are)\b[^.]{0,40}\brecall/i.test(summary);
  // "All versions are affected, regardless of code" beside a list of four
  // barcodes reads as a contradiction — and the accurate meaning is narrower:
  // every lot and date OF THOSE PRODUCTS. The statement is written from what
  // the recall actually covers, so it can never argue with what is shown.
  const allFields = [...fields, ...sharedFields, ...variants.flatMap((variant) => variant.fields)];
  const showsIdentifyingProducts = allFields.some((field) => field.key === 'upc');
  // "Regardless of code" is only true when the source itself named no code. A
  // code we extracted and chose not to render still narrows what the recall
  // covers, so the statement must not claim otherwise just because the
  // consumer cannot see it.
  const sourceNamedCodes =
    lotCodes !== null ||
    productionCodes !== null ||
    allFields.some(
      (field) => field.key === 'upc' || field.key === 'lotCodes' || field.key === 'batchCodes',
    ) ||
    rejected.some((fact) => IDENTIFYING_CONCEPTS.has(fact.concept));
  const scopeStatement = coversAll
    ? showsIdentifyingProducts
      ? 'All lots and dates of the products below are included in this recall.'
      : variants.length > 1
        ? 'Every lot and date of the versions below is affected.'
        : sourceNamedCodes
          ? render
            ? 'Every lot and date of this product is affected. The details below identify it.'
            : 'Every lot and date of this product is affected.'
          : 'All versions of this product are affected, regardless of code or date.'
    : hasIdentifiers
      ? 'Only packages matching the affected details below are part of this recall.'
      : 'Detailed package identifiers were not clearly provided in this notice.';

  return {
    render,
    scopeStatement,
    variants,
    sharedFields,
    fields,
    rejected,
    lotCodes,
    productionCodes,
    productionDates,
    codeLocation,
    photos: checkerPhotos(photos, variants),
    coverage,
    hasIdentifiers,
  };
}

// ── Assembly ────────────────────────────────────────────────────────────────

/**
 * Build the full consumer projection for one case. Pure and deterministic:
 * derived entirely from data already persisted with the case.
 */
export function buildConsumerCase(
  projection: CaseProjection,
  affectedProducts: AffectedProduct[],
): ConsumerCase {
  const tables = interpretTables(projection.summaryHtml);
  const tableFacts = tables.flatMap((t) => t.variants.flatMap((v) => v.facts));
  // Prose reads only what the tables did not already scope to a product row.
  const proseText = proseOutsideTables(projection.summaryHtml, projection.summaryText);
  const prose = extractProseIdentifiers(proseText);
  const photos = extractProductPhotos(projection.summaryHtml);
  // Official photo captions frequently carry the barcode when the table cell
  // says only "See Image Below" (verified: Outshine). The caption is source
  // text like any other, and the same label-driven rules apply to it.
  // A table whose product cells defer to the photos gets each row paired with
  // the photo that depicts it, so a version keeps its own barcode and codes.
  let built = buildVariants(tables.flatMap((table) => attachDeferredImages(table, photos)));
  // Facts from rows whose name failed the identity contract widen to the
  // recall scope, whichever structural path proposed them.
  const unassignedFacts: SemanticFact[] = [...built.unassigned];
  if (built.variants.length === 0) {
    // A source-declared bullet list is structural evidence on par with a
    // table: each item is one product owning the identifiers stated in it.
    built = buildVariants(extractAffectedProductLists(projection.summaryHtml));
    unassignedFacts.push(...built.unassigned);
  }
  if (built.variants.length === 0) {
    // Product lines carrying their own inline identifiers are the richest
    // fallback: each version keeps the codes that identify it.
    built = buildVariants(
      extractProseVariantLines(projection.summaryText).map((line, index) => ({
        scope: `p${index}`,
        facts: [
          {
            concept: 'variant' as const,
            sourceLabel: 'product',
            value: line.name,
            evidence: 'prose' as const,
            scope: `p${index}`,
          },
          ...line.facts.map((fact) => ({
            ...fact,
            evidence: 'prose' as const,
            scope: `p${index}`,
          })),
        ],
      })),
    );
    unassignedFacts.push(...built.unassigned);
  }
  let variants = built.variants;
  if (variants.length === 0) {
    variants = parseProseVariants(projection.summaryText)
      // The same closed identity contract gates name-only versions.
      .filter((name) => variantIdentityRejection(name) === null)
      .map((name, index) => ({
        name,
        fields: [],
        rejected: [],
        codeLocation: null,
        lotCodes: null,
        photo: null,
        scope: `n${index}`,
      }));
  }
  variants = attachNamedPhotos(variants, photos);

  // A caption belongs to whichever version its photo depicts. Only captions
  // still unclaimed describe the recall as a whole.
  const claimedPhotos = new Set(
    variants.map((variant) => variant.photo?.url).filter((url): url is string => url !== undefined),
  );
  const captionFacts = extractProseIdentifiers(
    photos
      .filter((photo) => !claimedPhotos.has(photo.url))
      .map((photo) => photo.alt)
      .filter((alt): alt is string => alt !== null)
      .join('\n'),
  ).facts.map((fact) => ({ ...fact, evidence: 'caption' as const }));
  // Labeled block lines ("Brand: Momchipz") plus inline label-driven prose,
  // plus facts from rows the identity contract widened to recall scope.
  const proseFacts = [
    ...parseProseFacts(proseText),
    ...prose.facts.map((fact) => ({ ...fact, evidence: 'prose' as const })),
    ...captionFacts,
    ...unassignedFacts,
  ];

  const packageCheck = buildPackageCheck(
    projection,
    affectedProducts,
    tableFacts,
    proseFacts,
    variants,
    photos,
    prose.statesNoCodes,
  );

  return {
    // The always-visible gallery answers "is this the product?", so identifier
    // close-ups are held back for the package checker, where they answer the
    // different question the consumer is asking there.
    photos: galleryPhotos(photos),
    primaryPhoto: primaryPhoto(photos),
    distribution: buildDistribution(projection, tableFacts),
    packageCheck,
    // The always-visible summary line names the affected versions. A recall
    // covering 651 product rows repeats the same handful of product names
    // across them, so it is deduplicated — a comma-separated list of 651
    // entries is not a summary of anything.
    variantNames: summarizeVariantNames(variants),
    action: buildConsumerAction(projection),
    quantityText: recallQuantity(projection, [...tableFacts, ...proseFacts]),
  };
}

/**
 * Every semantic fact the source supports, before the projection decides what
 * to do with it. Development/QA only: comparing this inventory against the
 * rendered projection is what makes information loss measurable instead of
 * something someone has to notice by eye.
 */
export function collectSourceFacts(projection: CaseProjection): SemanticFact[] {
  const tables = interpretTables(projection.summaryHtml);
  const photos = extractProductPhotos(projection.summaryHtml);
  const proseText = proseOutsideTables(projection.summaryHtml, projection.summaryText);
  return [
    ...tables.flatMap((table) =>
      attachDeferredImages(table, photos).flatMap((variant) => variant.facts),
    ),
    ...extractAffectedProductLists(projection.summaryHtml).flatMap((item) => item.facts),
    ...parseProseFacts(proseText),
    ...extractProseIdentifiers(proseText).facts.map((fact) => ({
      ...fact,
      evidence: 'prose' as const,
    })),
    ...extractProseIdentifiers(
      photos
        .map((photo) => photo.alt)
        .filter((alt): alt is string => alt !== null)
        .join('\n'),
    ).facts.map((fact) => ({ ...fact, evidence: 'caption' as const })),
  ].flatMap(expandFact);
}

/**
 * Units a stated recall total is counted in. Deliberately excludes "cases" on
 * its own when the sentence is about illness — "27 cases with illness onset"
 * counts people, not packages, and reading it as a quantity would tell a
 * consumer 27 products were recalled.
 */
const QUANTITY_UNITS =
  '(?:cases|units|pounds|lbs\\.?|bottles|jars|packages|packs|kits|trays|sleeves|containers|cartons|bags|boxes|pouches|tubs|cans)';

/** Sentences where a count is about people, not product. */
const ILLNESS_COUNT = /\b(?:illness|illnesses|sick|hospitali|infection|outbreak|reported)\b/i;

/**
 * How much product the notice says was recalled, when it says so.
 *
 * The founder treats this as a valued field, and it is: "3,860 units" tells a
 * reader how wide the problem is. It is only ever read from an explicit
 * statement — never inferred by multiplying a package size by anything, and
 * never confused with the size of one package.
 *
 * Derived at display time, so it reaches every already-persisted case without
 * re-ingestion; a value captured at ingest always wins.
 */
export function recallQuantity(
  projection: CaseProjection,
  sourceFacts: SemanticFact[] = [],
): string | null {
  if (projection.quantityText) return groupDigits(projection.quantityText);
  // A "Quantity Recalled" table column states the total as plainly as a
  // sentence does. It has exactly one consumer home — What happened — so it is
  // read here rather than being left to arrive in a package card.
  const stated = sourceFacts.find(
    (fact) => fact.concept === 'quantity' && /\d/.test(fact.value) && fact.value.length <= 40,
  );
  if (stated) return groupDigits(cleanDisplayText(stated.value));
  const summary = projection.summaryText ?? '';
  const pattern = new RegExp(
    String.raw`\b(?:approximately\s+|about\s+|a total of\s+|totaling\s+|is\s+|to\s+)?([\d][\d,]{1,12})\s+(${QUANTITY_UNITS})\b`,
    'gi',
  );
  for (const match of summary.matchAll(pattern)) {
    // The illness guard looks only at the immediate clause. Recall notices
    // discuss illnesses in adjacent sentences constantly, and a wide window
    // would reject genuine product totals for being near the word "reported".
    const clause = summary.slice(
      Math.max(0, match.index! - 32),
      match.index! + match[0].length + 32,
    );
    if (ILLNESS_COUNT.test(clause)) continue;
    // The statement must be about the recall itself, not about production or
    // sales generally. Checked over a wider span than the illness guard,
    // because the recall verb often sits a clause away from the number.
    const context = summary.slice(
      Math.max(0, match.index! - 90),
      match.index! + match[0].length + 90,
    );
    if (!/\b(?:recall\w*|affected|isolated to|distributed|withdrawn|involved)\b/i.test(context)) {
      continue;
    }
    return groupDigits(`${match[1]} ${match[2].toLowerCase().replace(/\.$/, '')}`);
  }
  return null;
}

/**
 * "3240 packs" → "3,240 packs". A four-digit run without separators reads as a
 * code rather than a count, and the whole value of this field is that a person
 * can take in how large the recall is at a glance.
 */
function groupDigits(text: string): string {
  return text.replace(/\b\d{4,}\b/g, (digits) => digits.replace(/\B(?=(?:\d{3})+$)/g, ','));
}

/** Distinct version names for the summary line, longest run first. */
const SUMMARY_VARIANT_LIMIT = 8;

function summarizeVariantNames(variants: AffectedVariant[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const variant of variants) {
    const key = dedupeKey(variant.name);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    names.push(variant.name);
  }
  // One version IS the product the header already names; an "Affected
  // versions" line restating it adds nothing and invites metadata to ride in.
  if (names.length < 2) return [];
  return names.slice(0, SUMMARY_VARIANT_LIMIT);
}

/** Concept label lookup for UI code that renders a `ConceptValues`. */
export function conceptLabel(concept: ConsumerConcept): string {
  return CONCEPT_LABEL[concept];
}

export { normalizeLabel, proseOutsideTables, extractCodeDatePairs };
export type { SemanticFact };
