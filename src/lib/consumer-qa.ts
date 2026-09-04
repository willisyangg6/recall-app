/**
 * Consumer Projection V2 — automated QA invariants.
 *
 * Manual review found a different defect on nearly every recall inspected,
 * which does not scale. These invariants encode the anti-patterns that review
 * uncovered so they are detected automatically across a large sample of real
 * announcements, and so a regression re-appearing anywhere is caught by the
 * cluster it belongs to rather than by someone noticing it on one record.
 *
 * A violation always means "our projection did something wrong", never "the
 * source was incomplete": missing source data is measured separately as
 * coverage, and honest omission is correct behavior.
 */

import { classifyIllnessReport } from '@/domain/illness';
import { extractRetailerNames, retailersWithPlaces } from '@/domain/retailer';
import {
  isUsCityName,
  normalizeStateToken,
  STATE_TO_POSTAL,
  statesInText,
} from '@/domain/us-geography';
import { isGeographicName, variantIdentityRejection } from './variant-identity';
import type { AffectedProduct, CaseProjection } from '@/domain/recall-types';
import {
  buildConsumerCase,
  collectSourceFacts,
  extractRetailerListBlock,
  extractRetailLocationBlock,
  joinValues,
  tableRetailLocations,
  type ConsumerCase,
} from './consumer-projection';
import { extractAffectedProductLists } from './source-lists';
import { normalizeLabel, SUPPRESSED_CONCEPTS, type ConsumerConcept } from './consumer-concepts';
import {
  CONCEPT_DESTINATION,
  PACKAGE_FIELD_LABEL,
  type PackageField,
  type PackageFieldKey,
} from './consumer-schema';
import { humanizeAllCaps, productDisplayName } from './consumer-summary';
import {
  extractCodeDatePairs,
  formatMeasurements,
  normalizeDateValue,
  normalizeUpc,
} from './identifiers';
import {
  extractProductPhotos,
  galleryPhotos,
  primaryPhoto,
  type PhotoRole,
} from './product-photos';
import { isCodeLocation, isValidForConcept } from './fact-types';
import { extractProseIdentifiers, withoutSupplierRecallReferences } from './prose-identifiers';
import { healthRiskSummary, reasonLine } from './recall-display';
import { buildWhatHappened } from './what-happened';

export type QaSeverity = 'critical' | 'major' | 'minor';

export interface QaViolation {
  /** Stable cluster id — the harness groups by this. */
  rule: string;
  severity: QaSeverity;
  detail: string;
}

/**
 * What became of a fact the source supported. Measuring this is what turns
 * "information loss" from a thing someone has to notice into a number that can
 * be tracked between passes.
 */
export type FactDisposition =
  /** Shown to the consumer in the source's own words. */
  | 'retained'
  /** Shown in a cleaner but equivalent form (a resolved date, a joined barcode). */
  | 'normalized'
  /** Merged with an identical fact stated more than once. */
  | 'aggregated'
  /** Shown under the specific product version the source attached it to. */
  | 'relationship_preserved'
  /** Deliberately not displayed (page layout, low-value source metadata). */
  | 'suppressed'
  /** Extracted but did not reach the UI — the failure this report exists to find. */
  | 'projection_dropped';

export interface SourceFactInventory {
  total: number;
  byDisposition: Record<FactDisposition, number>;
}

export interface QaRecordResult {
  id: string;
  violations: QaViolation[];
  inventory: SourceFactInventory;
  /** Per-record signals for aggregate metrics. */
  signals: {
    photosInSource: number;
    photosShown: number;
    hasVariants: boolean;
    variantCount: number;
    /** Versions carrying at least one identifier of their own. */
    variantsWithIdentifiers: number;
    orphanIdentifiers: number;
    hasDates: boolean;
    hasUpc: boolean;
    hasLotCodes: boolean;
    codeDatePairsInSource: number;
    codeDatePairsPreserved: number;
    distributionKnown: boolean;
    retailersFound: number;
    areasFound: number;
    packageCoverage: string;
    actionOrigin: 'source' | 'app';
    sourceHasDateKeyword: boolean;
    sourceHasUpcKeyword: boolean;
    sourceHasRetailerStatement: boolean;
    sourceHasAreaPhrase: boolean;
    /** Standardization signals. */
    dateFieldsPresent: number;
    dateFieldsNormalized: number;
    dateLeaks: number;
    typeMismatches: number;
    codeLocationShown: boolean;
    codeLocationCandidates: number;
    codeLocationRejected: number;
    hazardHasTemplate: boolean;
    healthRiskRendered: boolean;
    quantityInSource: boolean;
    quantitySurfaced: boolean;
    /** Closed-schema signals. */
    packageFieldLabels: string[];
    checkerRendered: boolean;
    /** Extracted facts the schema declined, by why. */
    rejectedUnsupported: number;
    rejectedWrongDestination: number;
    rejectedInvalidType: number;
    rejectedIntentionallySuppressed: number;
    /** Completeness of each closed destination, source-present vs surfaced. */
    sourceHasSize: boolean;
    sizeSurfaced: boolean;
    sourceHasLot: boolean;
    lotSurfaced: boolean;
    sourceHasRetailLocation: boolean;
    retailLocationsSurfaced: boolean;
    sourceHasPlatform: boolean;
    platformSurfaced: boolean;
    statesSurfaced: boolean;
    /** Must always be zero: a label outside the allowlist, or a leaked fact. */
    unapprovedFieldLabels: number;
    crossDestinationLeaks: number;
    actionIsFragment: boolean;
    /** Distribution entity roles. */
    statesInSourceClause: number;
    statesRetained: number;
    citiesAsRetailers: number;
    retailerCoverageEntries: number;
    /** Source-declared affected-product lists. */
    listDetected: boolean;
    listItemCount: number;
    listItemsWithIdentifiers: number;
    /** Case-level fields of a kind some version owns — must be zero. */
    orphanPackageFields: number;
    /** Closed variant identity. */
    variantsTotal: number;
    invalidVariantIdentities: number;
    dateLikeVariantNames: number;
    geographyLikeVariantNames: number;
    codeLikeVariantNames: number;
    labelLikeVariantNames: number;
    rawRowVariantNames: number;
    affectedVersionsWithMetadata: number;
    /** Shared fields and loose rows. */
    sharedFieldCount: number;
    ambiguousScopeSuppressed: number;
    looseFieldsAfterCards: number;
    /** Distribution role exclusivity. */
    geographyAsRetailer: number;
    /** Date parity. */
    malformedRenderedDates: number;
    /** Month/year date granularity. */
    monthYearSourcePresent: number;
    monthYearNormalized: number;
    monthYearInventedDays: number;
    /** Images by the role the projection assigned them. */
    recognitionImages: number;
    codeImages: number;
    extremeAspectImages: number;
    homeThumbnailValid: boolean;
  };
}

/** Copy that sends the user to a government page to finish a normal task. */
const EXTERNAL_NOTICE =
  /\b(?:check|see|open|refer to|consult|visit|read)\b[^.]{0,40}\b(?:official notice|official (?:fda|usda|fsis) )?(?:notice|announcement|fda\.gov|usda\.gov|fda page|website)\b/i;

/** Page-layout artifacts that must never reach consumer text. */
const LAYOUT_ARTIFACT = /\bsee (?:image|photo|picture)s?\b|\bimage below\b/i;

/** Source headings that must be routed into concepts, never rendered raw. */
const RAW_SOURCE_HEADINGS = new Set([
  'generic name',
  'sold at',
  'intended use',
  'condition',
  'shelf life',
  'product packaging',
  'net weight',
  'net wt',
  'see image below',
  'product type',
]);

/** Place words that must not be counted as a named retailer in QA metrics. */
const US_PLACE_WORDS =
  /^(?:Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New|North|South|West|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode|Tennessee|Texas|Utah|Vermont|Virginia|Washington|Wisconsin|Wyoming|Puerto|The|These|Select|Various|Multiple|All|Consumers|Customers|Distributors|Retailers|Wholesalers|Stores|Retail|Grocery|Distribution|AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/;

/** Package identifiers that must not clutter the always-visible sections. */
const PACKAGE_CODE_IN_PROSE =
  /\blot\s*(?:code|number|#)?\s*[:#]?\s*[A-Z0-9]{4,}|\bUPC\b\s*[:#]?\s*\d{6,}|\bbatch\s*(?:code|number)?\s*[:#]?\s*[A-Z0-9]{4,}/i;

/** Concepts that identify a specific package, and so can be owned by a version. */
const IDENTIFIER_CONCEPTS = new Set<ConsumerConcept>([
  'upc',
  'lot',
  'production_code',
  'case_code',
  'item_number',
  'best_by',
  'use_by',
  'sell_by',
  'expiration',
  'freeze_by',
  'production_date',
  'package_size',
  'package_color',
  'packaging',
]);

/** A placement phrase left inside the value it was supposed to describe. */
const PLACEMENT_IN_VALUE =
  /\b(?:back|front|bottom|top|side|reverse|lid|cap|panel)\s+of\s+(?:the\s+)?(?:package|packaging|bag|box|carton|container|label|pouch|can|jar|bottle)\b/i;

/** A measurement whose number and unit were never separated ("3oz"). */
const UNFORMATTED_MEASURE =
  /(?<![A-Za-z0-9])\d+(?:\.\d+)?(?:oz|ounces?|lbs?|pounds?|kg|ml|gal|gallons?|qt|quarts?|pt|pints?)\b/i;

/** Metro/region phrasing in the source, for the geography-loss check. */
const AREA_IN_SOURCE =
  /\b(?:[Mm]etro(?:politan)?\s+[Aa]reas?|[Gg]reater\s+[A-Z][a-z]+\s+[Aa]rea|[A-Z][a-z]+\s+[Cc]ounty|[Tt]ri-state\s+area)\b/;

const RECOGNITION = new Set<PhotoRole>([
  'package_front',
  'package_full',
  'package_label',
  'product_only',
  'package_back',
]);
const CODE_ROLES = new Set<PhotoRole>(['barcode_closeup', 'code_closeup']);

/** Concepts whose values are calendar dates. */
const DATE_CONCEPTS = new Set<ConsumerConcept>([
  'best_by',
  'use_by',
  'sell_by',
  'expiration',
  'freeze_by',
  'production_date',
]);

/** Source date formatting that should never survive into consumer copy. */
const RAW_DATE_FORMAT =
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{1,2}-\d{1,2}-\d{2,4}\b|\b\d{1,2}[A-Z]{3}\d{2,4}\b/;

/**
 * A stated recall total in the source text. Counts of people ("27 cases with
 * illness onset") are excluded by the sentence guard in `recallQuantity`; this
 * denominator only asks whether a number-plus-unit appears near recall wording.
 */
const QUANTITY_IN_SOURCE =
  /\b[\d][\d,]{1,12}\s+(?:cases|units|pounds|lbs\.?|bottles|jars|packages|containers|cartons|bags|boxes|pouches|tubs|cans)\b[^.\n]{0,60}\b(?:recall\w*|affected|distributed|involved)\b|\b(?:recall\w*|affected|isolated to|distributed)\b[^.\n]{0,60}\b[\d][\d,]{1,12}\s+(?:cases|units|pounds|lbs\.?|bottles|jars|packages|containers|cartons|bags|boxes|pouches|tubs|cans)\b/i;

/**
 * Package identification, which "Where it was sold" must never contain. Each
 * of these reached that section before the structured schema: a lot number and
 * a shipping window rode in on the source's own sentence, because the sentence
 * happened to mention them.
 */
const DISTRIBUTION_MUST_NOT_CONTAIN =
  /\blot\s*#?\s*[A-Z0-9]{3,}|\bbatch\s*#?\s*[A-Z0-9]{3,}|\bUPC\b|\bbest[-\s]?(?:if\s+used\s+)?by\b|\buse[-\s]?by\b|\bsell[-\s]?by\b|\bexpiration\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{8,14}\b/i;

/**
 * The generic shop words, which are never this section's answer. Matched
 * case-sensitively: "Labonne's Supermarkets" is a chain, "supermarkets" is the
 * category a specific retailer list gets compressed into.
 */
const GENERIC_CHANNEL_ONLY = /\b(?:retail stores|grocery stores|supermarkets|club stores)\b/;

/** Full state name → its postal code, for the redundant-abbreviation check. */
const STATE_TO_CODE: Record<string, string> = STATE_TO_POSTAL;

/** In-store placement, which answers a different question than distribution. */
const MERCHANDISING_TEXT =
  /\b(?:frozen|refrigerated|dairy|deli|produce|bakery|meat|freezer|cooler|chilled)\s+(?:section|case|aisle|department|counter|display)\b|\baisle\s+\d/i;

/**
 * Hazards for which an approved deterministic Health Risk template exists. A
 * recognized hazard must always render one — a routing gap here silently drops
 * a warning whose words we already have.
 */
const HAZARD_WITH_TEMPLATE =
  /listeria|salmonella|e\. ?coli|botulinum|campylobacter|cyclospora|hepatitis a|norovirus|cronobacter|bacillus cereus|cereulide|\bmold\b|sildenafil|tadalafil|yellow oleander|\blead\b|patulin|vitamin d3?|\balcohol\b|not fully pasteuri[sz]ed|under[- ]?process|\bchoking\b|(?:plastic|glass|metal|rubber|foreign)\s+(?:pieces?|particles?|fragments?|material)|cleaning agents?|undeclared/i;

/** Concepts whose values are codes, printed exactly as the package shows them. */
const CODE_CONCEPTS = new Set<ConsumerConcept>([
  'upc',
  'product_code',
  'lot',
  'production_code',
  'case_code',
  'item_number',
  'establishment_number',
]);

/**
 * The identity of a value, independent of how it was spelled. Used to tell a
 * genuine second fact from the same fact written twice.
 */
function canonicalOf(concept: ConsumerConcept, value: string): string {
  if (concept === 'upc' || concept === 'product_code') {
    // The source often repeats the label inside the value ("UPC 0-71430-…").
    const bare = value.replace(/^\s*(?:UPC|U\.P\.C\.|Barcode|Bar code)\s*[:#]?\s*/i, '');
    const normalized = normalizeUpc(bare);
    if (normalized?.canonical) return normalized.canonical;
    return bare.toLowerCase().replace(/[^a-z0-9]/g, '');
  }
  const date = normalizeDateValue(value);
  if (date.canonical) return date.canonical;
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Concepts that are the same thing for accounting purposes. A code the source
 * labelled UPC is shown as a "Product code" when it is not a valid barcode —
 * relabelled, not lost, and the inventory must not report it as dropped.
 */
function conceptFamily(concept: ConsumerConcept): ConsumerConcept {
  return concept === 'product_code' ? 'upc' : concept;
}

/**
 * The lookup keys a rendered value answers to. Display transforms are lossless
 * but they change the string ("Dec 10, 2024" → "December 10, 2024", "10oz" →
 * "10 oz"), so both the source spelling and the shown spelling count as the
 * same fact. Without this the completeness report would call every normalized
 * value a loss, and a number that cries wolf is worse than no number.
 */
function keysFor(concept: ConsumerConcept, ...values: string[]): string[] {
  const family = conceptFamily(concept);
  return values
    .filter((value) => value !== '')
    .flatMap((value) => [value, formatMeasurements(humanizeAllCaps(value))])
    .map((value) => `${family}|${canonicalOf(concept, value)}`);
}

function push(violations: QaViolation[], rule: string, severity: QaSeverity, detail: string): void {
  violations.push({ rule, severity, detail: detail.slice(0, 160) });
}

/**
 * The concept an approved field represents, so the type, formatting, and
 * duplication invariants can keep working against the closed schema.
 */
function conceptForField(key: PackageFieldKey): ConsumerConcept {
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

/** Every approved field rendered anywhere in the package checker. */
function renderedFields(consumer: ConsumerCase): PackageField[] {
  return [
    ...consumer.packageCheck.fields,
    ...consumer.packageCheck.sharedFields,
    ...consumer.packageCheck.variants.flatMap((variant) => variant.fields),
  ];
}

/**
 * Labels that used to reach consumers and never may again. Each was a real
 * source heading routed to a real concept — the defect was rendering it at
 * all, so the check is on the label text a consumer could see.
 */
const FORBIDDEN_LABELS = [
  'Details',
  'Item number',
  'Case code',
  'Generic name',
  'Internal code',
  'Product code',
  'Establishment number',
  'Package color',
  'Where to find it',
  'Amount recalled',
  'Where it was sold',
  'Store location',
];

/** The complete set of labels a package card may print. */
const APPROVED_LABELS = new Set<string>(Object.values(PACKAGE_FIELD_LABEL));

/**
 * Classify every fact the source supported by what the projection did with it.
 * This is the source→projection completeness view: a development instrument,
 * not a runtime system, whose whole purpose is to make silent information loss
 * countable.
 */
export function inventorySourceFacts(
  sourceFacts: { concept: ConsumerConcept; value: string; scope?: string }[],
  consumer: ConsumerCase,
): SourceFactInventory {
  const byDisposition: Record<FactDisposition, number> = {
    retained: 0,
    normalized: 0,
    aggregated: 0,
    relationship_preserved: 0,
    suppressed: 0,
    projection_dropped: 0,
  };

  const variantKeys = new Set<string>();
  for (const variant of consumer.packageCheck.variants) {
    for (const field of variant.fields) {
      field.values.forEach((value, index) => {
        for (const key of keysFor(conceptForField(field.key), value, field.raw[index] ?? '')) {
          variantKeys.add(key);
        }
      });
    }
    for (const code of variant.lotCodes?.codes ?? []) {
      for (const key of keysFor('lot', code)) variantKeys.add(key);
    }
    if (variant.name !== null) {
      for (const key of keysFor('variant', variant.name)) variantKeys.add(key);
    }
  }
  const caseKeys = new Map<string, string>();
  for (const field of [...consumer.packageCheck.fields, ...consumer.packageCheck.sharedFields]) {
    field.values.forEach((value, index) => {
      for (const key of keysFor(conceptForField(field.key), value, field.raw[index] ?? '')) {
        caseKeys.set(key, value);
      }
    });
  }
  for (const [set, concept] of [
    [consumer.packageCheck.lotCodes, 'lot'],
    [consumer.packageCheck.productionCodes, 'production_code'],
  ] as const) {
    for (const code of set?.codes ?? []) {
      for (const key of keysFor(concept, code)) caseKeys.set(key, code);
    }
  }
  const seen = new Set<string>();
  const distributionText = [
    consumer.distribution.areaText,
    ...consumer.distribution.areas,
    ...consumer.distribution.retailers,
    ...consumer.distribution.retailLocations,
    ...consumer.distribution.onlinePlatforms,
    ...consumer.distribution.channels,
  ]
    .join(' ')
    .toLowerCase();

  for (const fact of sourceFacts) {
    const key = `${conceptFamily(fact.concept)}|${canonicalOf(fact.concept, fact.value)}`;
    if (SUPPRESSED_CONCEPTS.has(fact.concept)) {
      byDisposition.suppressed += 1;
      continue;
    }
    // The same fact stated more than once by the source is aggregated, by
    // design — that is a success, not a loss.
    if (seen.has(key)) {
      byDisposition.aggregated += 1;
      continue;
    }
    seen.add(key);
    // A version's name has its trailing size split into its own field
    // ("Potato Market Loaf 20oz" → name + Size), so the projected name is a
    // prefix of the source's. That is a split, not a loss.
    const nameSplit =
      fact.concept === 'variant' &&
      [...variantKeys].some(
        (candidate) => candidate.startsWith('variant|') && key.startsWith(candidate),
      );
    // A cell listing several values — codes ("L18A05A, L18A05B, L18A05C") or
    // dates ("12/04/19, 12/10/19, 12/20/19") — is split into one each, so the
    // combined string is not itself a rendered value.
    const parts =
      CODE_CONCEPTS.has(fact.concept) || DATE_CONCEPTS.has(fact.concept)
        ? fact.value.split(/\s*(?:,|;|\band\b|\bor\b)\s*/i)
        : [];
    if (
      parts.length > 1 &&
      parts.every((part) =>
        keysFor(fact.concept, part.trim()).some((k) => variantKeys.has(k) || caseKeys.has(k)),
      )
    ) {
      byDisposition.aggregated += 1;
      continue;
    }
    if (variantKeys.has(key) || nameSplit) {
      byDisposition.relationship_preserved += 1;
    } else if (caseKeys.has(key)) {
      // "Retained" means the consumer reads the source's own words; anything
      // reformatted (a resolved date, a joined barcode) is normalized.
      byDisposition[caseKeys.get(key) === fact.value ? 'retained' : 'normalized'] += 1;
    } else if (
      fact.concept === 'distribution' ||
      fact.concept === 'retail_location' ||
      fact.concept === 'brand' ||
      fact.concept === 'company' ||
      fact.concept === 'quantity' ||
      fact.concept === 'identifier_location' ||
      fact.concept === 'unknown'
    ) {
      // Routed to a section of their own; presence there is checked by the
      // dedicated distribution, quantity, and header invariants above.
      const present =
        fact.concept === 'identifier_location'
          ? consumer.packageCheck.codeLocation !== null
          : fact.concept === 'quantity'
            ? consumer.quantityText !== null
            : distributionText.includes(fact.value.toLowerCase().slice(0, 12));
      byDisposition[present ? 'retained' : 'suppressed'] += 1;
    } else if (CONCEPT_DESTINATION[fact.concept] === 'not_rendered') {
      // Preserved for provenance and deliberately not shown. The closed schema
      // has no approved field for it, which is a decision — not a loss.
      byDisposition.suppressed += 1;
    } else {
      byDisposition.projection_dropped += 1;
    }
  }

  return { total: sourceFacts.length, byDisposition };
}

/** Values a person would read as a repeated product name before every field. */
function repeatsProductName(values: string[], productName: string): boolean {
  if (productName.length < 6 || values.length < 2) return false;
  const key = productName.toLowerCase().slice(0, 24);
  return values.filter((v) => v.toLowerCase().includes(key)).length >= 2;
}

/**
 * Run every consumer-projection invariant against one case.
 * `sourceText`/`sourceHtml` are the preserved authoritative source, used to
 * distinguish "the source never said it" from "we failed to extract it".
 */
export function auditConsumerCase(
  id: string,
  projection: CaseProjection,
  affectedProducts: AffectedProduct[],
  consumer: ConsumerCase = buildConsumerCase(projection, affectedProducts),
): QaRecordResult {
  const violations: QaViolation[] = [];
  const summary = projection.summaryText ?? '';
  const html = projection.summaryHtml ?? '';

  const product = productDisplayName(projection.productDescription ?? null, projection.title);
  const happened = buildWhatHappened({
    title: projection.title,
    noticeType: projection.noticeType,
    reasonText: projection.reasonText,
    hazardCategory: projection.hazardCategory,
    pathogenOrAllergen: projection.pathogenOrAllergen,
    firmDisplayName: projection.recallingFirm.displayName,
    summaryText: projection.summaryText,
    productDescription: projection.productDescription ?? null,
  });
  const healthRisk = healthRiskSummary(
    projection.hazardCategory,
    projection.pathogenOrAllergen,
    projection.reasonText,
  );
  const reason = reasonLine(
    projection.reasonText,
    projection.hazardCategory,
    projection.pathogenOrAllergen,
  );

  // Every string this app would render to a consumer for this case. Variant
  // names are excluded from the repetition check below: a source that names
  // three sizes of one product legitimately repeats the product name, whereas
  // repeating it before every FIELD VALUE is the defect V2 removes.
  const fields = renderedFields(consumer);
  const fieldValues = fields.flatMap((field) => field.values);
  // A nameless row (P3C-2) contributes no name to the copy checks — there is
  // no rendered string to check.
  const packageValues = [
    ...fieldValues,
    ...consumer.packageCheck.variants
      .map((v) => v.name)
      .filter((name): name is string => name !== null),
  ];
  const renderedLabels = fields.map((field) => field.label);
  const distributionCopy = [
    consumer.distribution.areaText,
    ...consumer.distribution.areas,
    ...consumer.distribution.retailers,
    ...consumer.distribution.retailLocations,
    ...consumer.distribution.onlinePlatforms,
    ...consumer.distribution.channels,
  ].join(' ');
  const consumerCopy = [
    distributionCopy,
    consumer.action.text,
    consumer.action.secondary ?? '',
    consumer.packageCheck.scopeStatement,
    happened.text,
    happened.update ?? '',
    healthRisk ?? '',
    reason ?? '',
    consumer.packageCheck.codeLocation?.text ?? '',
    consumer.packageCheck.codeLocation?.appearance ?? '',
    ...packageValues,
    ...renderedLabels,
  ];

  // ── Never send the user to the government page ──
  for (const text of consumerCopy) {
    if (EXTERNAL_NOTICE.test(text)) {
      push(violations, 'external-notice-instruction', 'critical', text);
      break;
    }
  }
  // ── Layout artifacts ──
  for (const text of [...packageValues, ...renderedLabels, consumer.packageCheck.scopeStatement]) {
    if (LAYOUT_ARTIFACT.test(text)) {
      push(violations, 'layout-artifact-in-ui', 'critical', text);
      break;
    }
  }
  // ── Raw source headings ──
  for (const label of renderedLabels) {
    if (RAW_SOURCE_HEADINGS.has(normalizeLabel(label))) {
      push(violations, 'raw-source-heading', 'critical', label);
      break;
    }
  }
  // ── Repetition and duplication ──
  if (repeatsProductName(fieldValues, product)) {
    push(violations, 'product-name-repeated-in-values', 'major', product);
  }
  for (const field of fields) {
    const keys = field.values.map((v) => v.toLowerCase().replace(/[^a-z0-9]/g, ''));
    if (new Set(keys).size !== keys.length) {
      push(violations, 'duplicate-values', 'major', `${field.label}: ${field.values.join(' | ')}`);
      break;
    }
  }
  // ── Closed schema: only approved labels may ever be rendered ──
  const unapproved = renderedLabels.find((label) => !APPROVED_LABELS.has(label));
  if (unapproved) {
    push(violations, 'unapproved-package-field', 'critical', unapproved);
  }
  const forbidden = renderedLabels.find((label) => FORBIDDEN_LABELS.includes(label));
  if (forbidden) {
    push(violations, `forbidden-package-field`, 'critical', forbidden);
  }
  // ── Lot-code volume ──
  const inlineLots = fields.find((field) => field.key === 'lotCodes' || field.key === 'batchCodes');
  if (inlineLots && inlineLots.values.length > 8) {
    push(
      violations,
      'lot-codes-not-collapsed',
      'major',
      `${inlineLots.values.length} codes rendered inline`,
    );
  }
  if (PACKAGE_CODE_IN_PROSE.test(consumer.action.text)) {
    push(violations, 'package-codes-in-action', 'major', consumer.action.text);
  }
  if (PACKAGE_CODE_IN_PROSE.test(happened.text)) {
    push(violations, 'package-codes-in-what-happened', 'major', happened.text);
  }
  // ── Sentence quality ──
  for (const [name, text] of [
    ['distribution', consumer.distribution.areaText],
    ['action', consumer.action.text],
    ['scope', consumer.packageCheck.scopeStatement],
  ] as const) {
    if (text === '') continue;
    // "28 states." is a complete answer to where, and opens with a digit.
    if (!/^[A-Z“"(0-9]/.test(text))
      push(violations, 'malformed-sentence-start', 'major', `${name}: ${text}`);
    if (!/[.!?]$/.test(text))
      push(violations, 'missing-terminal-punctuation', 'minor', `${name}: ${text}`);
  }
  for (const value of packageValues) {
    // A long all-caps run is shouted source text that was never humanized.
    if (value.length > 12 && value === value.toUpperCase() && /[A-Z]{6,}/.test(value)) {
      push(violations, 'raw-all-caps-value', 'minor', value);
      break;
    }
  }
  // ── Geography honesty ──
  if (
    consumer.distribution.scopeType !== 'nationwide' &&
    /nationwide/i.test(consumer.distribution.areaText)
  ) {
    push(
      violations,
      'unknown-geography-became-nationwide',
      'critical',
      consumer.distribution.areaText,
    );
  }
  if (
    !consumer.distribution.unspecified &&
    consumer.distribution.areaText === 'Distribution not specified.'
  ) {
    push(violations, 'distribution-known-but-unstated', 'major', consumer.distribution.areaText);
  }
  // ── Firm location must never become distribution ──
  // Only a violation when the firm's own address became the distribution
  // statement. A sentence that genuinely describes where product went ("…
  // distributed to stores within 100 miles of Jamestown, NY") legitimately
  // names the same city, so a distribution verb clears it.
  const firmCity = summary.match(
    /\bof\s+([A-Z][A-Za-z.\- ]{2,24}),\s*([A-Z][A-Za-z.]{1,20})\s+is\s+(?:voluntarily\s+)?recalling/,
  );
  if (
    firmCity &&
    consumer.distribution.areaText.includes(firmCity[1]) &&
    consumer.distribution.retailers.length === 0 &&
    consumer.distribution.states.length === 0
  ) {
    push(violations, 'firm-location-as-distribution', 'critical', consumer.distribution.areaText);
  }
  // ── Illness semantics ──
  const illness = classifyIllnessReport(summary);
  if (
    illness.status === 'reported' &&
    illness.statements.every((s) => /can cause|may cause|symptoms/i.test(s))
  ) {
    push(violations, 'illness-education-as-report', 'critical', illness.statements.join(' '));
  }
  // ── Health risk ──
  if (healthRisk && healthRisk.split(/\s+/).length > 50) {
    push(violations, 'health-risk-too-long', 'major', healthRisk);
  }
  // ── Action always present ──
  if (consumer.action.text.trim() === '') {
    push(violations, 'missing-consumer-action', 'critical', '(empty)');
  }
  // ── Photos ──
  const sourcePhotoCount = [...html.matchAll(/<img[^>]*src="\/files\//g)].length;
  if (sourcePhotoCount > 0 && consumer.photos.length === 0) {
    push(violations, 'photos-in-source-none-shown', 'critical', `${sourcePhotoCount} in source`);
  }
  const photoUrls = consumer.photos.map((p) => p.url);
  if (new Set(photoUrls).size !== photoUrls.length) {
    push(violations, 'duplicate-gallery-photos', 'major', `${photoUrls.length} photos`);
  }
  if (consumer.photos.some((p) => /logo|banner|icon|footer|social/i.test(p.url))) {
    push(violations, 'page-chrome-as-photo', 'critical', photoUrls.join(' '));
  }

  // ── Semantic relationships ──
  // The checks that matter most: extraction can be perfect while the meaning
  // is destroyed, and only a comparison against the source's own structure can
  // tell the difference.
  const sourceFacts = collectSourceFacts(projection);

  // An identifier the source printed inside one product row must not be shown
  // as though it belonged to the whole recall: a shopper holding a different
  // version would match on it wrongly.
  const scopedValues = new Map<string, string>();
  for (const fact of sourceFacts) {
    if (!fact.scope || !IDENTIFIER_CONCEPTS.has(fact.concept)) continue;
    scopedValues.set(`${fact.concept}|${canonicalOf(fact.concept, fact.value)}`, fact.scope);
  }
  // Ownership can only be lost where there was somewhere else to put it. A
  // table with one product column, or one with no product identity at all
  // (dates over columns of lot codes), states nothing about a specific
  // version — so its values belong to the recall, exactly as Part 21 requires:
  // uncertain ownership is left unassigned rather than invented.
  const competingScopes =
    new Set(scopedValues.values()).size >= 2 && consumer.packageCheck.variants.length > 0;
  const orphans = !competingScopes
    ? []
    : consumer.packageCheck.fields.flatMap((field) =>
        field.canonicalKeys
          .filter((key) => scopedValues.has(`${conceptForField(field.key)}|${key}`))
          .map((key) => `${field.label}: ${key}`),
      );
  if (orphans.length > 0) {
    push(violations, 'orphan-identifier', 'major', orphans.join(' | '));
  }

  // Two spellings of one fact rendered side by side ("August 31, 2026 and 2026
  // AUGUST 31") — the source repeating itself, not two different dates.
  for (const field of fields) {
    const concept = conceptForField(field.key);
    const canonical = field.values.map((value) => canonicalOf(concept, value));
    if (new Set(canonical).size !== canonical.length) {
      push(
        violations,
        'raw-and-normalized-duplicate',
        'major',
        `${field.label}: ${field.values.join(' | ')}`,
      );
      break;
    }
  }

  // A placement phrase belongs in "Where to find it", never inside the value
  // it describes.
  for (const field of fields) {
    const merged = field.values.find((value) => PLACEMENT_IN_VALUE.test(value));
    if (merged) {
      push(violations, 'location-hint-in-identifier-value', 'major', `${field.label}: ${merged}`);
      break;
    }
  }

  // A source table that gives each row its own identifiers has stated which
  // values belong together; rendering them as parallel global lists discards
  // that and leaves nothing matchable.
  // Only rows that name a product establish a product relationship. A table
  // whose columns are just a date and its codes has no versions to lose — that
  // relationship is checked by the code↔date pairing rule instead.
  const namedScopes = new Set(
    sourceFacts
      .filter((fact) => fact.scope && fact.concept === 'variant')
      .map((fact) => fact.scope),
  );
  const scopesWithIdentifiers = new Set(
    sourceFacts
      .filter(
        (fact) =>
          fact.scope && namedScopes.has(fact.scope) && IDENTIFIER_CONCEPTS.has(fact.concept),
      )
      .map((fact) => fact.scope),
  );
  if (scopesWithIdentifiers.size >= 2 && consumer.packageCheck.variants.length === 0) {
    push(
      violations,
      'variant-relationship-lost',
      'critical',
      `${scopesWithIdentifiers.size} source rows carry identifiers, no versions projected`,
    );
  }

  // A code the source published with its calendar date must keep that date.
  const sourcePairs = extractCodeDatePairs(summary).length;
  // A pairing survives in one of two shapes. A collapsed code set carries the
  // date on each code explicitly. A ROW preserves it structurally: when the
  // row states exactly one date and its own codes beside it, every code in
  // that row is printed next to the date it belongs to, and the reader needs
  // no second surface to see it (P3C-2 — King Arthur's nineteen rows and
  // MedTech's five state their pairs this way, one date per row).
  const rowStructuralPairs = consumer.packageCheck.variants.reduce((sum, variant) => {
    const dates = variant.fields
      .filter((field) => DATE_CONCEPTS.has(conceptForField(field.key)))
      .flatMap((field) => field.values);
    if (dates.length !== 1) return sum;
    return (
      sum +
      variant.fields
        .filter((field) => field.key === 'lotCodes' || field.key === 'batchCodes')
        .reduce((codes, field) => codes + field.values.length, 0)
    );
  }, 0);
  const projectedPairs =
    (consumer.packageCheck.lotCodes?.pairs.length ?? 0) +
    (consumer.packageCheck.productionCodes?.pairs.length ?? 0) +
    consumer.packageCheck.variants.reduce((sum, v) => sum + (v.lotCodes?.pairs.length ?? 0), 0) +
    rowStructuralPairs;
  const projectedCodes =
    (consumer.packageCheck.lotCodes?.count ?? 0) +
    (consumer.packageCheck.productionCodes?.count ?? 0) +
    consumer.packageCheck.variants.reduce(
      (sum, v) =>
        sum +
        (v.lotCodes?.count ?? 0) +
        v.fields
          .filter((field) => field.key === 'lotCodes' || field.key === 'batchCodes')
          .reduce((codes, field) => codes + field.values.length, 0),
      0,
    );
  if (sourcePairs >= 2 && projectedCodes > 0 && projectedPairs === 0) {
    push(
      violations,
      'code-date-pair-split',
      'major',
      `${sourcePairs} code/date pairs in source, none preserved`,
    );
  }

  // A value the source explicitly published as a UPC must reach the consumer
  // as `Barcode (UPC)`. Relabelling it — which is what happened to Publix's
  // `41415-06453` and Zion Market's `8541200408`, both printed on the package
  // exactly as written — sends a shopper looking for a field that is not
  // there.
  const explicitUpcs = sourceFacts
    .filter((fact) => fact.concept === 'upc' && isValidForConcept('upc', fact.value))
    .map((fact) => canonicalOf('upc', fact.value));
  if (explicitUpcs.length > 0) {
    const shownAsUpc = new Set(
      fields
        .filter((field) => field.key === 'upc')
        .flatMap((field) => field.values.map((value) => canonicalOf('upc', value))),
    );
    const downgraded = explicitUpcs.find((key) => !shownAsUpc.has(key));
    if (downgraded && shownAsUpc.size === 0) {
      push(violations, 'explicit-upc-not-shown-as-upc', 'critical', downgraded);
    }
  }

  // Signals for the standardization metrics below.
  const dateValues = fields
    .filter((field) => DATE_CONCEPTS.has(conceptForField(field.key)))
    .flatMap((field) => field.values);
  const locationCandidates = sourceFacts.filter((f) => f.concept === 'identifier_location').length;
  const hazardTemplateExists = HAZARD_WITH_TEMPLATE.test(
    `${projection.pathogenOrAllergen ?? ''} ${projection.reasonText ?? ''}`,
  );
  // A stated recall total, never a package size and never inferred.
  const quantityStatedInSource =
    projection.quantityText !== null || QUANTITY_IN_SOURCE.test(summary);

  // ── Standardization: one meaning, one format, one place ──
  // A value must be the KIND of thing its field promises. `Use by: 58 oz` is
  // the canonical failure: a shopper looks for that date, never finds it, and
  // concludes their package is fine.
  for (const field of fields) {
    const concept = conceptForField(field.key);
    const wrongType = field.values.find((value) => !isValidForConcept(concept, value));
    if (wrongType) {
      push(violations, 'semantic-type-mismatch', 'critical', `${field.label}: ${wrongType}`);
      break;
    }
  }
  // Every consumer-readable date uses one format, whatever the source printed.
  const dateLeak = dateValues.find((value) => RAW_DATE_FORMAT.test(value));
  if (dateLeak) push(violations, 'unnormalized-date', 'major', dateLeak);

  // A place to look must be a place, and must be stated once.
  const location = consumer.packageCheck.codeLocation;
  if (location && !isCodeLocation(location.raw)) {
    push(violations, 'invalid-code-location', 'critical', location.raw);
  }
  const variantLocations = consumer.packageCheck.variants
    .map((variant) => variant.codeLocation?.text)
    .filter((text): text is string => text !== undefined);
  if (
    variantLocations.length > 1 &&
    variantLocations.length === consumer.packageCheck.variants.length &&
    new Set(variantLocations).size === 1
  ) {
    push(violations, 'repeated-variant-code-location', 'major', variantLocations[0]);
  }
  if (location && variantLocations.includes(location.text)) {
    push(violations, 'code-location-shown-twice', 'major', location.text);
  }

  // Distribution describes where a recall reached, not where a shelf is, and
  // never a package identifier. The structured schema makes most of this
  // unrepresentable; these invariants prove it stays that way.
  if (MERCHANDISING_TEXT.test(distributionCopy)) {
    push(violations, 'merchandising-as-distribution', 'critical', distributionCopy);
  }
  if (DISTRIBUTION_MUST_NOT_CONTAIN.test(distributionCopy)) {
    push(violations, 'package-identifier-in-distribution', 'critical', distributionCopy);
  }
  const distributionNames = [
    ...consumer.distribution.retailers,
    ...consumer.distribution.onlinePlatforms,
  ].map((name) => name.toLowerCase());
  if (new Set(distributionNames).size !== distributionNames.length) {
    push(violations, 'duplicate-distribution-name', 'major', distributionNames.join(' | '));
  }
  // Specific evidence must never be compressed into the generic shop word.
  if (GENERIC_CHANNEL_ONLY.test(distributionCopy)) {
    push(violations, 'specific-retailer-collapsed-to-generic', 'major', distributionCopy);
  }
  // A state named twice — once abbreviated, once in full — reads as two places.
  const abbreviated = consumer.distribution.states.find(
    (state) =>
      distributionCopy.includes(state) &&
      new RegExp(`\\b${STATE_TO_CODE[state] ?? '\\u0000'}\\b`).test(distributionCopy),
  );
  if (abbreviated) {
    push(violations, 'state-abbreviation-repeated', 'minor', distributionCopy);
  }

  // Checker imagery: no code macros, and no central image repeating what the
  // version cards already show.
  if (consumer.packageCheck.photos.some((photo) => CODE_ROLES.has(photo.role))) {
    push(
      violations,
      'code-image-in-package-checker',
      'major',
      consumer.packageCheck.photos[0].alt ?? '',
    );
  }
  if (
    consumer.packageCheck.variants.length > 1 &&
    consumer.packageCheck.variants.every((variant) => variant.photo !== null) &&
    consumer.packageCheck.photos.length > 0
  ) {
    push(violations, 'redundant-checker-image', 'major', `${consumer.packageCheck.photos.length}`);
  }

  // A recognized hazard with an approved template must always produce one.
  if (
    !healthRisk &&
    projection.hazardCategory !== 'unknown' &&
    HAZARD_WITH_TEMPLATE.test(
      `${projection.pathogenOrAllergen ?? ''} ${projection.reasonText ?? ''}`,
    )
  ) {
    push(
      violations,
      'health-risk-missing-for-known-hazard',
      'critical',
      projection.reasonText ?? '',
    );
  }

  // Scope copy must never argue with the identifiers printed beneath it.
  if (
    /regardless of code or date/i.test(consumer.packageCheck.scopeStatement) &&
    fields.length > 0
  ) {
    push(
      violations,
      'scope-contradicts-identifiers',
      'major',
      consumer.packageCheck.scopeStatement,
    );
  }

  // Measurements read as a unit, not a token: "3oz" is a string, "3 oz" is a
  // size. Codes are exempt by design — their characters are what a consumer
  // compares, so we never insert a space into one, even when it happens to end
  // in something that looks like a unit.
  const measurable = fields
    .filter((field) => !CODE_CONCEPTS.has(conceptForField(field.key)))
    .flatMap((field) => field.values)
    .concat(
      consumer.packageCheck.variants
        .map((variant) => variant.name)
        .filter((name): name is string => name !== null),
    );
  const unformatted = measurable.find((value) => UNFORMATTED_MEASURE.test(value));
  if (unformatted) push(violations, 'unformatted-measure', 'minor', unformatted);

  // ── Distribution specificity ──
  // Compressing named stores into "grocery stores" is a real loss: it is the
  // difference between a shopper knowing a recall applies to them and not.
  const listedRetailers = extractRetailerListBlock(summary);
  if (listedRetailers.length > 0 && consumer.distribution.retailers.length === 0) {
    push(violations, 'named-retailer-lost', 'major', listedRetailers.slice(0, 4).join(', '));
  }
  const sourceHasAreaPhrase = AREA_IN_SOURCE.test(summary);
  if (
    sourceHasAreaPhrase &&
    consumer.distribution.areas.length === 0 &&
    consumer.distribution.states.length === 0 &&
    consumer.distribution.scopeType !== 'nationwide'
  ) {
    push(violations, 'geography-lost', 'major', consumer.distribution.areaText);
  }

  // ── Image roles ──
  const allPhotos = extractProductPhotos(html);
  const gallery = galleryPhotos(allPhotos);
  const recognitionImages = allPhotos.filter((photo) => RECOGNITION.has(photo.role));
  const codeImages = allPhotos.filter((photo) => CODE_ROLES.has(photo.role));
  if (consumer.photos.some((photo) => CODE_ROLES.has(photo.role)) && recognitionImages.length > 0) {
    push(
      violations,
      'code-image-in-primary-gallery',
      'major',
      consumer.photos.find((p) => CODE_ROLES.has(p.role))?.alt ?? '',
    );
  }
  if (recognitionImages.length > 0 && consumer.photos.length === 0) {
    push(violations, 'useful-image-not-surfaced', 'critical', `${recognitionImages.length} usable`);
  }
  // A label photograph is often the only visual a notice supplies; rejecting
  // one because it contains a barcode would leave the recall unrecognizable.
  const rejectedLabel = allPhotos.find(
    (photo) => photo.role === 'package_label' && !gallery.includes(photo),
  );
  if (rejectedLabel) {
    push(violations, 'label-image-rejected', 'major', rejectedLabel.alt ?? rejectedLabel.url);
  }
  const home = primaryPhoto(allPhotos);
  const homeThumbnailValid = home === null || RECOGNITION.has(home.role);
  if (!homeThumbnailValid && recognitionImages.length > 0) {
    push(violations, 'code-image-as-home-thumbnail', 'major', home?.alt ?? '');
  }
  const extremeAspectImages = consumer.photos.filter(
    (photo) => photo.aspectRatio !== null && (photo.aspectRatio < 0.45 || photo.aspectRatio > 2.2),
  ).length;

  // ── Source-present but not projected (parser gaps, not source gaps) ──
  // "Source states a date" requires an actual value, not just the label. A
  // notice saying only where to look ("marked with a best by date on the
  // inside of the fin seal") states nothing to extract, and counting that as
  // a parser failure would make the metric dishonest. Identifiers inside a
  // supplier-recall reference sentence belong to the OTHER product and are
  // excluded from the denominator exactly as they are from extraction.
  const ownProductSummary = withoutSupplierRecallReferences(summary);
  const sourceHasDateKeyword =
    /\b(?:best[-\s]?(?:if\s+used\s+)?by|best before|use[-\s]?by|sell[-\s]?by|expiration|expiry)\b(?:[^.\n]{0,30})\d/i.test(
      ownProductSummary,
    );
  const sourceHasUpcKeyword = /\bUPC\b[^.\n]{0,30}\d/i.test(ownProductSummary);
  // "Source states a retailer" means a named store, not a place: a bare state
  // or city after "distributed in" is geography and is measured separately.
  const retailerCandidate =
    /\b(?:sold|shipped|distributed|available)\s+(?:exclusively\s+|only\s+)?(?:at|to|through)\s+(?:the\s+following\s+)?(?:select\s+)?([A-Z][A-Za-z0-9'’&.-]{2,}(?:\s+[A-Z][A-Za-z0-9'’&.-]{2,})?)/g;
  let sourceHasRetailerStatement = false;
  for (const candidate of summary.matchAll(retailerCandidate)) {
    if (!US_PLACE_WORDS.test(candidate[1]) && !isUsCityName(candidate[1])) {
      sourceHasRetailerStatement = true;
      break;
    }
  }

  const hasDates = fields.some((field) =>
    ['bestBy', 'useBy', 'sellBy', 'expiration'].includes(field.key),
  );
  const hasUpc = fields.some((field) => field.key === 'upc');

  // A notice that says the product carries no codes — or only that its codes
  // vary — states no value to extract, so these are not parser failures.
  const statesNoCodes = extractProseIdentifiers(summary).statesNoCodes;
  if (
    sourceHasDateKeyword &&
    !hasDates &&
    consumer.packageCheck.lotCodes === null &&
    !statesNoCodes
  ) {
    push(violations, 'date-in-source-not-projected', 'major', 'source states a date label');
  }
  if (sourceHasUpcKeyword && !hasUpc && !statesNoCodes) {
    push(violations, 'upc-in-source-not-projected', 'major', 'source states a UPC');
  }
  if (consumer.packageCheck.coverage === 'parser_missed') {
    push(
      violations,
      'package-identifiers-parser-missed',
      'major',
      'identifier keywords present, none extracted',
    );
  }

  // ── Distribution entity roles ──
  // Every consumer-visible distribution entity has exactly one typed role.
  // A known city rendered under RETAILERS, or a state dropped from an
  // explicit multi-state clause, is a classification failure — the closed
  // taxonomy makes both unrepresentable, and these invariants prove it.
  const citiesAsRetailers = consumer.distribution.retailers.filter((name) => isUsCityName(name));
  if (citiesAsRetailers.length > 0) {
    push(violations, 'city-as-retailer', 'critical', citiesAsRetailers.join(' | '));
  }
  const distributionLines = summary
    .split('\n')
    .filter(
      (line) =>
        /\bdistribut\w+|\bsold\b|\bshipped\b|\bavailable (?:in|at|through)\b/i.test(line) &&
        !/\b(?:is|are|has|have)\s+(?:voluntarily\s+)?recalling\b|\bheadquarter/i.test(line) &&
        !/\bcall\b|\bcontact\b|\bquestions\b|@|\b\d{3}-\d{3}-\d{4}\b/i.test(line),
    );
  const clauseStates = statesInText(distributionLines.join(' '));
  // A nationwide scope subsumes every named state — nothing is "dropped".
  const statesRetained =
    consumer.distribution.scopeType === 'nationwide'
      ? clauseStates
      : clauseStates.filter((state) => consumer.distribution.states.includes(state));
  if (
    consumer.distribution.scopeType !== 'nationwide' &&
    statesRetained.length < clauseStates.length
  ) {
    push(
      violations,
      'state-dropped-from-multi-state-clause',
      'critical',
      clauseStates.filter((state) => !statesRetained.includes(state)).join(', '),
    );
  }
  // A retailer the source explicitly tied to places must still be a retailer.
  // Consignees and distribution infrastructure ("TRIMAR USA LLC", "Wakefern
  // distribution centers") are business-to-business facts, not places a
  // consumer shopped, and are not counted against the consumer projection.
  const coverageStated = retailersWithPlaces(summary).filter(
    (entry) =>
      entry.retailer.length >= 4 &&
      !/\b(?:LLC|L\.L\.C\.?|Inc\.?|Ltd\.?|Corp\.?|LP|LLP)\.?$/i.test(entry.retailer) &&
      !/\bdistribution\s+cent(?:er|re)s?\b/i.test(entry.retailer),
  );
  const coverageLost = coverageStated.filter(
    (entry) =>
      !consumer.distribution.retailers.some(
        (name) => name.toLowerCase() === entry.retailer.toLowerCase(),
      ),
  );
  if (coverageLost.length > 0) {
    push(
      violations,
      'retailer-place-relationship-lost',
      'major',
      coverageLost.map((entry) => entry.retailer).join(' | '),
    );
  }

  // ── Source-declared affected-product lists ──
  // List items that carry their own identifiers are product rows; flattening
  // them into one global code pile destroys the source's own structure.
  const listItems = extractAffectedProductLists(html);
  const listItemsWithIdentifiers = listItems.filter((item) =>
    item.facts.some(
      (fact) => IDENTIFIER_CONCEPTS.has(fact.concept) && fact.concept !== 'package_size',
    ),
  );
  if (listItemsWithIdentifiers.length >= 2 && consumer.packageCheck.variants.length === 0) {
    push(
      violations,
      'list-relationship-lost',
      'critical',
      `${listItemsWithIdentifiers.length} list items carry identifiers, no versions projected`,
    );
  }

  // ── Variant-mode orphan package fields ──
  // When versions own identifying fields, no case-level field of a kind any
  // version carries may render outside a card. Hard zero.
  const qaVariantMode = consumer.packageCheck.variants.some(
    (variant) => variant.fields.length > 0 || variant.lotCodes !== null,
  );
  const variantKeySet = new Set(
    consumer.packageCheck.variants.flatMap((variant) => variant.fields.map((field) => field.key)),
  );
  const orphanFields = qaVariantMode
    ? consumer.packageCheck.fields.filter((field) => variantKeySet.has(field.key))
    : [];
  if (orphanFields.length > 0) {
    push(
      violations,
      'variant-mode-orphan-field',
      'critical',
      orphanFields.map((field) => `${field.label}: ${field.value}`).join(' | '),
    );
  }

  // ── Month/year date granularity ──
  // "05/27" states a month and a year. Rendering it raw is a formatting leak;
  // rendering it with a day is an invention, which is worse.
  const MONTH_YEAR_RAW = /^\d{1,2}\/\d{2}$|^\d{1,2}\/20\d{2}$/;
  // Distinct months, not repetitions: four rows stating "06/2025" are one
  // fact, and collapsing them into one rendered "June 2025" is the intended
  // behavior, not a normalization miss.
  const monthYearSourcePresent = new Set(
    sourceFacts
      .filter((fact) => DATE_CONCEPTS.has(fact.concept) && MONTH_YEAR_RAW.test(fact.value.trim()))
      .map((fact) => normalizeDateValue(fact.value.trim()).canonical ?? fact.value.trim()),
  ).size;
  let monthYearNormalized = 0;
  let monthYearInventedDays = 0;
  for (const field of fields) {
    if (!DATE_CONCEPTS.has(conceptForField(field.key))) continue;
    field.values.forEach((value, index) => {
      const rawValue = (field.raw[index] ?? '').trim();
      if (!MONTH_YEAR_RAW.test(rawValue)) return;
      if (/^[A-Z][a-z]+ \d{4}$/.test(value)) {
        monthYearNormalized += 1;
      } else if (/^[A-Z][a-z]+ \d{1,2}, \d{4}$/.test(value)) {
        monthYearInventedDays += 1;
        push(violations, 'month-year-invented-day', 'critical', `${rawValue} → ${value}`);
      }
    });
  }

  // ── Closed variant identity ──
  // A variant name is a product identity, never a date, a place, a code, a
  // field label, or a serialized source row. The projection gates these at
  // construction; this invariant proves nothing leaks around the gate.
  const identityRejections = consumer.packageCheck.variants
    .map((variant) => variant.name)
    .filter((name): name is string => name !== null)
    .map((name) => ({ name, why: variantIdentityRejection(name) }))
    .filter((entry) => entry.why !== null);
  for (const entry of identityRejections.slice(0, 3)) {
    push(violations, 'invalid-variant-identity', 'critical', `${entry.why}: ${entry.name}`);
  }
  // The "Affected versions:" line is clean product names only.
  const versionLineMetadata = consumer.variantNames.filter(
    (name) => variantIdentityRejection(name) !== null,
  );
  if (versionLineMetadata.length > 0) {
    push(violations, 'affected-versions-metadata', 'critical', versionLineMetadata.join(' | '));
  }

  // ── Mutually exclusive distribution roles ──
  // Once geography, never a retailer. The projection enforces this; the
  // invariant proves the intersections stay empty.
  const geographyNames = new Set(
    [...consumer.distribution.states, ...consumer.distribution.areas].map((name) =>
      name.toLowerCase(),
    ),
  );
  const geographyAsRetailer = consumer.distribution.retailers.filter(
    (name) =>
      geographyNames.has(name.toLowerCase()) ||
      normalizeStateToken(name) !== null ||
      isGeographicName(name),
  );
  if (geographyAsRetailer.length > 0) {
    push(violations, 'geography-as-retailer', 'critical', geographyAsRetailer.join(' | '));
  }
  const areasAsRetailLocations = consumer.distribution.retailLocations.filter((location) =>
    geographyNames.has(location.toLowerCase()),
  );
  if (areasAsRetailLocations.length > 0) {
    push(violations, 'area-as-retail-location', 'major', areasAsRetailLocations.join(' | '));
  }

  // ── Shared fields and loose rows ──
  // In variant mode, case-level fields render nowhere: variant-owned, proven
  // shared (the block above the cards), or suppressed. Any remainder would
  // render loosely after the cards — hard zero.
  const looseFieldsAfterCards = qaVariantMode ? consumer.packageCheck.fields.length : 0;
  if (looseFieldsAfterCards > 0) {
    push(
      violations,
      'loose-field-after-variants',
      'critical',
      consumer.packageCheck.fields.map((field) => `${field.label}: ${field.value}`).join(' | '),
    );
  }

  // ── Malformed and artifact values ──
  // A rendered date is semantically complete or absent: no dangling range
  // connectors, no unpaired "between".
  const MALFORMED_DATE =
    /\b(?:between|through|thru|from|until|to|ranging)\s*$|^\s*(?:between|ranging)\b(?!.*[–—-]|.*\bto\b|.*\bthrough\b)/i;
  const malformedDates = dateValues.filter((value) => MALFORMED_DATE.test(value));
  if (malformedDates.length > 0) {
    push(violations, 'malformed-date-rendered', 'critical', malformedDates.join(' | '));
  }
  // Source separator artifacts (list bullets, stranded conjunctions) never
  // survive into a rendered value.
  const artifactValues = [
    ...fieldValues,
    ...(consumer.packageCheck.lotCodes?.codes ?? []),
    ...consumer.packageCheck.variants.flatMap((variant) => variant.lotCodes?.codes ?? []),
  ].filter(
    (value) => /[•·]/.test(value) || /^(?:and|or)\s/i.test(value) || /[–—-]\s*$/.test(value),
  );
  if (artifactValues.length > 0) {
    push(violations, 'value-separator-artifact', 'major', artifactValues.join(' | '));
  }
  // A rendered value must not carry another field's label inside it.
  const labelInValue = fieldValues.filter((value) =>
    /\b(?:best[- ]?(?:if[- ]?used[- ]?)?by|use[- ]?by|sell[- ]?by|expiration|lot\s+code|batch\s+code|upc)\b\s*(?:date)?\s*[:#]/i.test(
      value,
    ),
  );
  if (labelInValue.length > 0) {
    push(violations, 'field-label-inside-value', 'major', labelInValue.join(' | '));
  }

  // ── Closed-schema accounting ──
  const rejectionCount = (reason: string) =>
    consumer.packageCheck.rejected.filter((fact) => fact.reason === reason).length;
  // Cross-destination leaks: a fact rendered in a section that is not its
  // approved home. The schema makes these unrepresentable; counting them is
  // how we prove it, rather than assuming it.
  const crossDestinationLeaks =
    (MERCHANDISING_TEXT.test(distributionCopy) ? 1 : 0) +
    (DISTRIBUTION_MUST_NOT_CONTAIN.test(distributionCopy) ? 1 : 0) +
    renderedLabels.filter((label) => !APPROVED_LABELS.has(label)).length;
  // Denominators are what EXTRACTION found, because this pass's question is
  // what the closed schema does with a fact once it exists — not whether the
  // parser found it, which the coverage metrics above already measure. Nothing
  // is ever invented, so a surfaced fact is source-present by definition and
  // the union can never exceed 100%.
  const sizeSurfaced = fields.some((field) => field.key === 'size');
  const lotSurfaced =
    fields.some((field) => field.key === 'lotCodes' || field.key === 'batchCodes') ||
    consumer.packageCheck.lotCodes !== null ||
    consumer.packageCheck.variants.some((variant) => variant.lotCodes !== null);
  const sourceHasSize = sizeSurfaced || sourceFacts.some((fact) => fact.concept === 'package_size');
  const sourceHasLot = lotSurfaced || sourceFacts.some((fact) => fact.concept === 'lot');
  const sourceHasRetailLocation =
    extractRetailLocationBlock(summary).length > 0 || tableRetailLocations(sourceFacts).length > 0;
  // A platform counts as source-present only when the notice says product was
  // SOLD there; a company's Amazon storefront in the contact block is not a
  // distribution statement.
  const sourceHasPlatform =
    consumer.distribution.onlinePlatforms.length > 0 ||
    /\b(?:sold|purchased|available|shipped|distributed)\b[^.\n]{0,40}\b(?:amazon|ebay|instacart|walmart\.com|weee!|thrive market|iherb)\b/i.test(
      summary,
    );

  return {
    id,
    violations,
    inventory: inventorySourceFacts(sourceFacts, consumer),
    signals: {
      packageFieldLabels: renderedLabels,
      checkerRendered: consumer.packageCheck.render,
      rejectedUnsupported: rejectionCount('unsupported-consumer-field'),
      rejectedWrongDestination: rejectionCount('wrong-destination'),
      rejectedInvalidType: rejectionCount('invalid-type'),
      rejectedIntentionallySuppressed: rejectionCount('intentionally-suppressed'),
      sourceHasSize,
      sizeSurfaced,
      sourceHasLot,
      lotSurfaced,
      sourceHasRetailLocation,
      retailLocationsSurfaced: consumer.distribution.retailLocations.length > 0,
      sourceHasPlatform,
      platformSurfaced: consumer.distribution.onlinePlatforms.length > 0,
      statesSurfaced: consumer.distribution.states.length > 0,
      unapprovedFieldLabels: renderedLabels.filter((label) => !APPROVED_LABELS.has(label)).length,
      crossDestinationLeaks,
      actionIsFragment:
        consumer.action.origin === 'source' && consumer.action.text.split(/\s+/).length < 6,
      statesInSourceClause: clauseStates.length,
      statesRetained: statesRetained.length,
      citiesAsRetailers: citiesAsRetailers.length,
      retailerCoverageEntries: consumer.distribution.coverage.length,
      listDetected: listItems.length > 0,
      listItemCount: listItems.length,
      listItemsWithIdentifiers: listItemsWithIdentifiers.length,
      orphanPackageFields: orphanFields.length,
      variantsTotal: consumer.packageCheck.variants.length,
      invalidVariantIdentities: identityRejections.length,
      dateLikeVariantNames: identityRejections.filter((e) => e.why === 'date').length,
      geographyLikeVariantNames: identityRejections.filter((e) => e.why === 'geography').length,
      codeLikeVariantNames: identityRejections.filter((e) => e.why === 'code').length,
      labelLikeVariantNames: identityRejections.filter((e) => e.why === 'field-label').length,
      rawRowVariantNames: identityRejections.filter((e) => e.why === 'raw-source-row').length,
      affectedVersionsWithMetadata: versionLineMetadata.length,
      sharedFieldCount: consumer.packageCheck.sharedFields.length,
      ambiguousScopeSuppressed: rejectionCount('ambiguous-scope'),
      looseFieldsAfterCards,
      geographyAsRetailer: geographyAsRetailer.length,
      malformedRenderedDates: malformedDates.length,
      monthYearSourcePresent,
      monthYearNormalized,
      monthYearInventedDays,
      photosInSource: sourcePhotoCount,
      photosShown: consumer.photos.length,
      hasVariants: consumer.packageCheck.variants.length > 0,
      variantCount: consumer.packageCheck.variants.length,
      variantsWithIdentifiers: consumer.packageCheck.variants.filter(
        (variant) => variant.fields.length > 0 || variant.lotCodes !== null,
      ).length,
      orphanIdentifiers: orphans.length,
      hasDates,
      hasUpc,
      hasLotCodes:
        consumer.packageCheck.lotCodes !== null ||
        consumer.packageCheck.variants.some((variant) => variant.lotCodes !== null),
      codeDatePairsInSource: sourcePairs,
      codeDatePairsPreserved: projectedPairs,
      distributionKnown: !consumer.distribution.unspecified,
      retailersFound: consumer.distribution.retailers.length,
      areasFound: consumer.distribution.areas.length,
      packageCoverage: consumer.packageCheck.coverage,
      actionOrigin: consumer.action.origin,
      sourceHasDateKeyword,
      sourceHasUpcKeyword,
      // Honest denominator: a retailer the ingest-time parser already
      // recognized is source-present too, whatever sentence shape carried it.
      // Honest denominator: whatever sentence shape carried the name, if the
      // source states a retailer at all it counts as source-present.
      sourceHasRetailerStatement:
        sourceHasRetailerStatement ||
        listedRetailers.length > 0 ||
        (projection.retailerNames?.length ?? 0) > 0 ||
        extractRetailerNames(`${projection.title}\n${summary}`).length > 0,
      sourceHasAreaPhrase,
      dateFieldsPresent: dateValues.length,
      dateFieldsNormalized: dateValues.filter((v) => !RAW_DATE_FORMAT.test(v)).length,
      dateLeaks: dateValues.filter((v) => RAW_DATE_FORMAT.test(v)).length,
      typeMismatches: fields.flatMap((field) =>
        field.values.filter((value) => !isValidForConcept(conceptForField(field.key), value)),
      ).length,
      codeLocationShown: consumer.packageCheck.codeLocation !== null,
      codeLocationCandidates: locationCandidates,
      codeLocationRejected:
        locationCandidates - (consumer.packageCheck.codeLocation === null ? 0 : 1),
      hazardHasTemplate: hazardTemplateExists,
      healthRiskRendered: healthRisk !== null,
      quantityInSource: quantityStatedInSource,
      quantitySurfaced: consumer.quantityText !== null,
      recognitionImages: recognitionImages.length,
      codeImages: codeImages.length,
      extremeAspectImages,
      homeThumbnailValid,
    },
  };
}

export interface QaSummary {
  records: number;
  violationsByRule: { rule: string; severity: QaSeverity; count: number; examples: string[] }[];
  criticalCount: number;
  majorCount: number;
  minorCount: number;
  metrics: Record<string, number>;
  /** Source→projection completeness, summed across the sample. */
  inventory: SourceFactInventory;
}

/** Aggregate per-record audits into a grouped report. */
export function summarizeQa(results: QaRecordResult[]): QaSummary {
  const byRule = new Map<string, { severity: QaSeverity; count: number; examples: string[] }>();
  let criticalCount = 0;
  let majorCount = 0;
  let minorCount = 0;

  for (const result of results) {
    for (const violation of result.violations) {
      const entry = byRule.get(violation.rule) ?? {
        severity: violation.severity,
        count: 0,
        examples: [],
      };
      entry.count += 1;
      if (entry.examples.length < 3) entry.examples.push(`${result.id}: ${violation.detail}`);
      byRule.set(violation.rule, entry);
      if (violation.severity === 'critical') criticalCount += 1;
      else if (violation.severity === 'major') majorCount += 1;
      else minorCount += 1;
    }
  }

  const count = (predicate: (r: QaRecordResult) => boolean) => results.filter(predicate).length;
  const sum = (select: (r: QaRecordResult) => number) =>
    results.reduce((total, result) => total + select(result), 0);
  const inventory: SourceFactInventory = {
    total: sum((r) => r.inventory.total),
    byDisposition: {
      retained: sum((r) => r.inventory.byDisposition.retained),
      normalized: sum((r) => r.inventory.byDisposition.normalized),
      aggregated: sum((r) => r.inventory.byDisposition.aggregated),
      relationship_preserved: sum((r) => r.inventory.byDisposition.relationship_preserved),
      suppressed: sum((r) => r.inventory.byDisposition.suppressed),
      projection_dropped: sum((r) => r.inventory.byDisposition.projection_dropped),
    },
  };
  const metrics: Record<string, number> = {
    records: results.length,
    photosSourcePresent: count((r) => r.signals.photosInSource > 0),
    photosShown: count((r) => r.signals.photosShown > 0),
    // Image roles: how many records surface each kind, and whether the feed
    // thumbnail is always a recognizable product image.
    recordsWithCodeImages: count((r) => r.signals.codeImages > 0),
    codeImagesExcluded: sum((r) => r.signals.codeImages),
    extremeAspectImages: sum((r) => r.signals.extremeAspectImages),
    homeThumbnailValid: count((r) => r.signals.homeThumbnailValid),
    // Relationship preservation — the point of this pass.
    variantBearingRecords: count((r) => r.signals.variantCount > 0),
    variantsWithOwnIdentifiers: count((r) => r.signals.variantsWithIdentifiers > 0),
    variantRelationshipsPreserved: sum((r) => r.signals.variantsWithIdentifiers),
    orphanIdentifiers: sum((r) => r.signals.orphanIdentifiers),
    codeDatePairsInSource: sum((r) => r.signals.codeDatePairsInSource),
    codeDatePairsPreserved: sum((r) => r.signals.codeDatePairsPreserved),
    areasExtracted: count((r) => r.signals.areasFound > 0),
    areaSourcePresent: count((r) => r.signals.sourceHasAreaPhrase),
    variantsExtracted: count((r) => r.signals.hasVariants),
    datesExtracted: count((r) => r.signals.hasDates),
    // Records where the source prints a date/barcode value that we failed to
    // project — the only honest denominator for a "miss", since extraction
    // also succeeds from tables and photo captions the prose signal misses.
    dateMissed: count((r) => r.signals.sourceHasDateKeyword && !r.signals.hasDates),
    upcExtracted: count((r) => r.signals.hasUpc),
    upcMissed: count((r) => r.signals.sourceHasUpcKeyword && !r.signals.hasUpc),
    lotCodesExtracted: count((r) => r.signals.hasLotCodes),
    distributionKnown: count((r) => r.signals.distributionKnown),
    retailerExtracted: count((r) => r.signals.retailersFound > 0),
    retailerSourcePresent: count((r) => r.signals.sourceHasRetailerStatement),
    packageStructured: count((r) => r.signals.packageCoverage === 'structured'),
    packagePartial: count((r) => r.signals.packageCoverage === 'partial'),
    packageSourceSilent: count((r) => r.signals.packageCoverage === 'source_silent'),
    packageParserMissed: count((r) => r.signals.packageCoverage === 'parser_missed'),
    // Standardization.
    dateFieldsPresent: sum((r) => r.signals.dateFieldsPresent),
    dateFieldsNormalized: sum((r) => r.signals.dateFieldsNormalized),
    dateLeaks: sum((r) => r.signals.dateLeaks),
    typeMismatches: sum((r) => r.signals.typeMismatches),
    codeLocationShown: count((r) => r.signals.codeLocationShown),
    codeLocationCandidates: sum((r) => r.signals.codeLocationCandidates),
    codeLocationRejected: sum((r) => Math.max(0, r.signals.codeLocationRejected)),
    hazardTemplateRecognized: count((r) => r.signals.hazardHasTemplate),
    hazardTemplateRendered: count(
      (r) => r.signals.hazardHasTemplate && r.signals.healthRiskRendered,
    ),
    quantityInSource: count((r) => r.signals.quantityInSource),
    quantitySurfaced: count((r) => r.signals.quantitySurfaced),
    quantityMissed: count((r) => r.signals.quantityInSource && !r.signals.quantitySurfaced),
    actionFromSource: count((r) => r.signals.actionOrigin === 'source'),
    actionAppFallback: count((r) => r.signals.actionOrigin === 'app'),
    actionFragments: count((r) => r.signals.actionIsFragment),
    // Closed schema.
    uniquePackageFieldLabels: new Set(results.flatMap((r) => r.signals.packageFieldLabels)).size,
    unapprovedFieldLabels: sum((r) => r.signals.unapprovedFieldLabels),
    crossDestinationLeaks: sum((r) => r.signals.crossDestinationLeaks),
    checkersRendered: count((r) => r.signals.checkerRendered),
    checkersHidden: count((r) => !r.signals.checkerRendered),
    rejectedUnsupported: sum((r) => r.signals.rejectedUnsupported),
    rejectedWrongDestination: sum((r) => r.signals.rejectedWrongDestination),
    rejectedInvalidType: sum((r) => r.signals.rejectedInvalidType),
    rejectedIntentionallySuppressed: sum((r) => r.signals.rejectedIntentionallySuppressed),
    // Distribution entity roles.
    statesInSourceClauses: sum((r) => r.signals.statesInSourceClause),
    statesRetainedFromClauses: sum((r) => r.signals.statesRetained),
    citiesAsRetailers: sum((r) => r.signals.citiesAsRetailers),
    retailerCoverageEntries: sum((r) => r.signals.retailerCoverageEntries),
    // Source-declared product lists.
    listsDetected: count((r) => r.signals.listDetected),
    listItems: sum((r) => r.signals.listItemCount),
    listItemsWithIdentifiers: sum((r) => r.signals.listItemsWithIdentifiers),
    // Variant-mode orphan package fields — hard zero.
    orphanPackageFields: sum((r) => r.signals.orphanPackageFields),
    // Closed variant identity — every count after "variantsTotal" must be 0.
    variantsTotal: sum((r) => r.signals.variantsTotal),
    invalidVariantIdentities: sum((r) => r.signals.invalidVariantIdentities),
    dateLikeVariantNames: sum((r) => r.signals.dateLikeVariantNames),
    geographyLikeVariantNames: sum((r) => r.signals.geographyLikeVariantNames),
    codeLikeVariantNames: sum((r) => r.signals.codeLikeVariantNames),
    labelLikeVariantNames: sum((r) => r.signals.labelLikeVariantNames),
    rawRowVariantNames: sum((r) => r.signals.rawRowVariantNames),
    affectedVersionsWithMetadata: sum((r) => r.signals.affectedVersionsWithMetadata),
    // Shared fields and loose rows — loose rows must be 0.
    recordsWithSharedFields: count((r) => r.signals.sharedFieldCount > 0),
    sharedFieldsRendered: sum((r) => r.signals.sharedFieldCount),
    ambiguousScopeSuppressed: sum((r) => r.signals.ambiguousScopeSuppressed),
    looseFieldsAfterCards: sum((r) => r.signals.looseFieldsAfterCards),
    // Distribution role exclusivity — must be 0.
    geographyAsRetailer: sum((r) => r.signals.geographyAsRetailer),
    // Date parity — malformed must be 0.
    malformedRenderedDates: sum((r) => r.signals.malformedRenderedDates),
    // Month/year date granularity.
    monthYearSourcePresent: sum((r) => r.signals.monthYearSourcePresent),
    monthYearNormalized: sum((r) => r.signals.monthYearNormalized),
    monthYearInventedDays: sum((r) => r.signals.monthYearInventedDays),
    sizeSourcePresent: count((r) => r.signals.sourceHasSize),
    sizeSurfaced: count((r) => r.signals.sizeSurfaced),
    lotSourcePresent: count((r) => r.signals.sourceHasLot),
    lotSurfaced: count((r) => r.signals.lotSurfaced),
    retailLocationSourcePresent: count((r) => r.signals.sourceHasRetailLocation),
    retailLocationSurfaced: count((r) => r.signals.retailLocationsSurfaced),
    platformSourcePresent: count((r) => r.signals.sourceHasPlatform),
    platformSurfaced: count((r) => r.signals.platformSurfaced),
    statesSurfaced: count((r) => r.signals.statesSurfaced),
  };

  return {
    records: results.length,
    violationsByRule: [...byRule.entries()]
      .map(([rule, entry]) => ({ rule, ...entry }))
      .sort((a, b) => b.count - a.count),
    criticalCount,
    majorCount,
    minorCount,
    metrics,
    inventory,
  };
}

export { joinValues };
