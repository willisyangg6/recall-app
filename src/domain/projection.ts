/**
 * Canonical case projection: a pure, deterministic function from a case's
 * linked source records to the consumer-facing shape (architecture Part 8.4).
 * Re-running it on unchanged inputs must always produce identical output —
 * idempotent ingestion and material-change detection both depend on that.
 */

import type {
  AffectedProduct,
  CaseProjection,
  Classification,
  ClassificationValue,
  Geography,
  OfficialClass,
  SourceAgency,
  SourceIdentifier,
} from './recall-types';
import { deriveGeography } from './geography-evidence';
import { deriveIllnessStatus, statusReportsIllness } from './illness-status';
import { deriveRetailerNames } from './retailer-evidence';
import { isOfficialClass, officialClassesOf } from './risk-tier';
import type { NormalizedSourceRecord } from './source-record';
import { isFoodCategoryId, orderFoodCategories, type FoodCategoryId } from './food-category';
import { categoriesForCase } from './food-category-matcher';

/**
 * The facts the product-category derivation is allowed to read. Deliberately
 * the projected consumer text and nothing else — the same three fields the
 * frozen matcher's own input type accepts, so this wrapper cannot widen what
 * the classifier sees.
 */
export interface ProductCategoryInput {
  sourceAgency: SourceAgency;
  title: string;
  productDescription: string | null;
  affectedProducts: readonly Pick<AffectedProduct, 'name'>[];
  /**
   * The announcement's own summary prose (C10A.1). Passed whole because the
   * classifier — not this wrapper — owns the bounded, guarded extraction of
   * the ONE sentence it may read; splitting that logic across the seam would
   * let a caller decide what counts as product evidence. Optional so a
   * projection persisted before `summaryText` existed still derives.
   */
  summaryText?: string | null;
}

/**
 * THE product-category derivation (C10A). One function, called by
 * `projectCase` and by the historical backfill and by QA, so a re-projection,
 * a repair and a report can never disagree about a case's categories.
 *
 * It delegates to the FROZEN classifier (`categoriesForCase`) without adding
 * a single input of its own: the hazard, allergen, pathogen, recalling firm,
 * brand, retailer and geography are all in scope at this call site and none
 * of them is passed. That is the whole contract.
 *
 * `summaryText` is the announcement's own prose and is the one field added in
 * C10A.1. It is NOT an exception to the contract: the classifier reads a
 * single closed grammar out of it (the product-identification sentence) and
 * only where the title has already proved non-descriptive, so cause, pathogen,
 * allergen, firm, retailer and geography prose remain unreadable. QA re-derives
 * every stored case with that prose rewritten and requires byte-identical
 * output.
 *
 * Idempotent and a fixed point: the output is already canonical
 * (`orderFoodCategories`), so re-deriving from a re-projected case returns
 * the identical array.
 */
export function deriveProductCategories(input: ProductCategoryInput): FoodCategoryId[] {
  return categoriesForCase({
    sourceAgency: input.sourceAgency,
    title: input.title,
    productDescription: input.productDescription,
    productLines: input.affectedProducts
      .map((product) => product.name)
      .filter((name) => name.trim() !== ''),
    announcementSummary: input.summaryText ?? null,
  }).categories;
}

/**
 * Read a stored projection's categories, preserving the difference between
 * "not derived yet" and "derived, and the answer is Other".
 *
 * Returns null when the key is absent — every projection persisted before
 * C10A — so a filter can decline to place those cases rather than dropping
 * them into the Other chip, and so the backfill can tell a case that needs
 * writing from one that does not. A stored value that is not a well-formed
 * category list is normalized rather than trusted, because the column is
 * JSON and nothing in Postgres enforces this shape.
 */
export function readProductCategories(projection: CaseProjection): FoodCategoryId[] | null {
  const stored = projection.productCategories;
  if (stored === undefined || stored === null) return null;
  if (!Array.isArray(stored)) return null;
  const valid = stored.filter(
    (id): id is FoodCategoryId => typeof id === 'string' && isFoodCategoryId(id),
  );
  return valid.length === 0 ? null : orderFoodCategories(valid);
}

const SEVERITY_ORDER: ClassificationValue[] = [
  'class_I',
  'class_II',
  'class_III',
  'not_yet_classified',
  'not_applicable_pha',
  // Cases only — a source record never carries it. Listed so an unexpected
  // value can never sort first and win a fallback by accident.
  'multiple_classes',
];

export function classificationSeverityRank(value: ClassificationValue): number {
  return SEVERITY_ORDER.indexOf(value);
}

/** Stable ordering: newest published first; native id breaks ties deterministically. */
function newestFirst(records: NormalizedSourceRecord[]): NormalizedSourceRecord[] {
  return [...records].sort(
    (a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.nativeId.localeCompare(b.nativeId),
  );
}

/**
 * Precedence: stated beats inferred; a wider stated scope beats a narrower one
 * (an expansion widening states → nationwide must win). Narrowing is never
 * applied from record disagreement (architecture Part 8.4).
 */
export function combineGeography(records: NormalizedSourceRecord[]): Geography {
  const geos = records.map((r) => r.geography);
  for (const confidence of ['stated', 'inferred'] as const) {
    const atLevel = geos.filter((g) => g.confidence === confidence && g.scope !== 'unknown');
    if (atLevel.length === 0) continue;
    const nationwide = atLevel.find((g) => g.scope === 'nationwide');
    if (nationwide) return nationwide;
    const states = [...new Set(atLevel.flatMap((g) => g.states))].sort();
    return {
      scope: 'states',
      states,
      confidence,
      sourceText: atLevel.map((g) => g.sourceText).find((t) => t !== null) ?? null,
    };
  }
  const withText = geos.find((g) => g.sourceText !== null);
  return {
    scope: 'unknown',
    states: [],
    confidence: 'stated',
    sourceText: withText?.sourceText ?? null,
  };
}

/**
 * The case's authoritative classification, as a SET.
 *
 * FDA classifies per affected product, so one recall legitimately carries
 * several official classes (measured: 175 openFDA events are mixed). Collapsing
 * that to the most severe class would state something the agency did not — that
 * every affected product is Class I — so a mixed case names no single class at
 * all: it carries the distinct set, and `value` says `multiple_classes`.
 *
 * With no official class anywhere, the existing non-class states rank as before
 * ("not yet classified" beats "not applicable"), and the set is empty.
 */
function combineClassification(records: NormalizedSourceRecord[]): Classification {
  const ranked = [...records].sort(
    (a, b) =>
      classificationSeverityRank(a.classification.value) -
      classificationSeverityRank(b.classification.value),
  );
  const official = ranked.filter((r) => isOfficialClass(r.classification.value));
  const classes = officialClassesOf({
    value: 'not_yet_classified',
    officialClasses: official.map((r) => r.classification.value as OfficialClass),
  });
  if (classes.length === 0) {
    return { ...ranked[0].classification, officialClasses: [] };
  }
  if (classes.length === 1) {
    return { ...official[0].classification, officialClasses: classes };
  }
  return {
    value: 'multiple_classes',
    // No single agency wording describes a set; each record keeps its own.
    sourceText: null,
    officialClasses: classes,
  };
}

function combineProducts(records: NormalizedSourceRecord[]): AffectedProduct[] {
  const seen = new Set<string>();
  const products: AffectedProduct[] = [];
  // Oldest record first so the original product list stays ahead of expansion additions.
  for (const record of newestFirst(records).reverse()) {
    for (const line of record.productLines) {
      const key = `${record.nativeId} ${line.trim().toLowerCase()}`;
      if (seen.has(key) || line.trim() === '') continue;
      seen.add(key);
      products.push({
        sourceNativeId: record.nativeId,
        name: line.trim(),
        rawText: line,
        extractionConfidence: 'stated',
      });
    }
  }
  return products;
}

/**
 * Does this illness statement report an actual ILLNESS?
 *
 * The canonical flag behind `CaseProjection.reportsIllness`, which drives
 * material-change detection (`health_impact`) and, when push is activated,
 * the notification that says illnesses are now reported. It is therefore a
 * claim the app will eventually make on a lock screen, and it must be true
 * only for a confirmed illness.
 *
 * It delegates to the shared contract rather than deciding for itself
 * (P2B7K). The regex it replaced — `!/\bno\b[^.]*\b(reports?|illness|adverse|injur)/i` —
 * was a fourth, weaker reader of the same prose, and it was wrong in both
 * directions on the live corpus: "has **not** received any confirmed reports
 * of illnesses" contains no standalone `no`, so a firm's explicit denial
 * counted as a report on 20 active cases, while a genuine report that happened
 * to contain the word "no" elsewhere counted as none. Delegating makes the
 * ledger and Recall Detail structurally incapable of disagreeing.
 *
 * TRUE for: a trustworthy illness count, and illness reported without one.
 * FALSE for: an explicit denial, silence, injuries, adverse reactions,
 * hospitalizations and deaths with no illness stated, and hazard education.
 */
export function statementReportsIllness(statement: string | null): boolean {
  return statusReportsIllness(deriveIllnessStatus(statement));
}

/**
 * A title that declares its announcement an expansion of the recall. Detected
 * from the persisted title so already-stored records qualify without
 * re-ingestion.
 */
const TITLE_DECLARES_EXPANSION =
  /\bexpand(?:s|ed|ing)?\b[^.]{0,60}?\brecall|\brecall\s+expansion\b/i;

const EXPANSION_VOICE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function projectCase(records: NormalizedSourceRecord[]): CaseProjection {
  const projection = projectCaseFields(records);
  // Categories are derived from the case's OWN projected consumer text, for
  // the same reason geography and retailerNames are: a parser improvement then
  // reaches a case whose source page has not changed, and the persisted field
  // agrees with what a fresh derivation would produce. Computed last, from the
  // finished projection, so there is exactly one input construction shared by
  // ingestion, the historical backfill and QA.
  return {
    ...projection,
    productCategories: deriveProductCategories(projection),
  };
}

function projectCaseFields(records: NormalizedSourceRecord[]): CaseProjection {
  if (records.length === 0) {
    throw new Error('projectCase requires at least one source record');
  }
  // FDA enforcement records (Phase B) are not consumer notices: they carry
  // the official classification and NOTHING else consumer-visible. They
  // never supply the voice, the dates, the identifiers, the firm variants,
  // or the products — classification enrichment must not make a recall read
  // as newly announced or reshuffle its provenance. Notice records drive
  // everything; enforcement records join only the classification combine.
  const notices = records.filter((r) => r.sourceSystem !== 'openfda_enforcement');
  const voiced = notices.length > 0 ? notices : records;
  const ordered = newestFirst(voiced);
  // Consumer text comes from the newest primary notice; a retraction notice is
  // the primary voice only when it is all the case has.
  //
  // One caveat, verified live on Khong Guan: FDA re-dates a BASE announcement
  // when it edits it (removing customer names), which can leave the base
  // "newer" than the expansion that declares the recall's widest scope. The
  // expansion's own words are the agency's latest statement of WHAT is
  // recalled, so an expansion-declaring record within a short window of the
  // true newest wins the voice; a genuinely newer announcement months later
  // still supersedes it.
  const newestNonRetraction = ordered.find((r) => !r.isRetractionNotice) ?? ordered[0];
  const newestExpansion = ordered.find(
    (r) => !r.isRetractionNotice && TITLE_DECLARES_EXPANSION.test(r.title),
  );
  const expansionIsVoice =
    newestExpansion !== undefined &&
    Math.abs(
      Date.parse(newestNonRetraction.publishedAt) - Date.parse(newestExpansion.publishedAt),
    ) <= EXPANSION_VOICE_WINDOW_MS;
  const primary = expansionIsVoice ? newestExpansion : newestNonRetraction;
  const newest = expansionIsVoice ? newestExpansion : ordered[0];

  const retracted = voiced.some((r) => r.isRetractionNotice || r.lifecycle === 'retracted');
  const closed = voiced.every((r) => r.lifecycle === 'closed');
  const state = retracted ? 'retracted' : closed ? 'closed' : 'active';

  const closedYears = voiced.map((r) => r.closedYear).filter((y): y is string => y !== null);
  const closedYear = closedYears.length > 0 ? closedYears.sort().at(-1)! : null;

  const publishedAt = voiced.map((r) => r.publishedAt).sort()[0];
  const lastPublicActivityAt = voiced
    .flatMap((r) => [r.publishedAt, r.lastModifiedAt])
    .filter((d): d is string => d !== null)
    .sort()
    .at(-1)!;

  const sourceIdentifiers: SourceIdentifier[] = newestFirst(voiced)
    .reverse()
    .map((r) => ({
      system: r.sourceSystem,
      id: r.nativeId,
      ...(r.rawNativeId !== r.nativeId ? { rawId: r.rawNativeId } : {}),
      url: r.officialUrl,
    }));

  // Oldest-first for a deterministic, input-order-independent variant list.
  const firmVariants = [
    ...new Set(
      newestFirst(voiced)
        .reverse()
        .flatMap((r) => r.firmRawVariants)
        .filter((v) => v.trim() !== ''),
    ),
  ];

  // The case's OWN geography evidence is authoritative, for the same reason
  // retailerNames is (below): the records' geography is combined, then
  // re-derived against the case's projected consumer text under the one shared
  // contract (domain/geography-evidence.ts). That is what lets a parser
  // improvement reach a case whose source page has not changed, and what makes
  // the persisted field agree with what the detail screen already displays.
  const geography = deriveGeography({
    title: newest.title,
    summaryText: newest.summaryText,
    summaryHtml: newest.summaryHtml,
    carried: combineGeography(voiced),
  });

  return {
    sourceAgency: primary.sourceAgency,
    noticeType: primary.noticeType,
    state,
    closedYear,
    // Classification alone combines over ALL records: a matched
    // enforcement record is exactly where the official class arrives.
    classification: combineClassification(records),
    title: newest.title,
    summaryText: newest.summaryText,
    summaryHtml: newest.summaryHtml,
    reasonText: primary.reasonText,
    hazardCategory: primary.hazardCategory,
    // Newest-first: a correction that renames the allergen (verified live:
    // Momchipz gluten→wheat) must win, and input order must never matter.
    pathogenOrAllergen: ordered.map((r) => r.pathogenOrAllergen).find((p) => p !== null) ?? null,
    recallingFirm: {
      displayName: primary.firmDisplayName ?? firmVariants[0] ?? null,
      rawVariants: firmVariants,
    },
    // `?? []` / `?? null`: records normalized before these fields existed
    // (persisted FSIS rows) omit them; absence means unknown, never invented.
    brands: [
      ...new Set(
        newestFirst(voiced)
          .reverse()
          .flatMap((r) => r.brands ?? [])
          .filter((b) => b.trim() !== ''),
      ),
    ],
    productDescription: primary.productDescription ?? null,
    // The case's OWN retailer evidence is authoritative, not whichever
    // adapter happened to parse first: the records' names are unioned, then
    // re-derived against the case's projected consumer text under the one
    // shared contract (domain/retailer-evidence.ts). That makes this field
    // identical for FDA and FSIS with no adapter-specific retailer system,
    // and self-healing — a later legitimate re-projection recomputes the same
    // answer instead of erasing a repaired one.
    retailerNames: deriveRetailerNames({
      title: newest.title,
      summaryText: newest.summaryText,
      carried: [
        ...new Set(
          newestFirst(voiced)
            .reverse()
            .flatMap((r) => r.retailerNames ?? []),
        ),
      ],
      geography,
    }),
    heroImageUrl: ordered.map((r) => r.heroImageUrl).find((url) => url != null) ?? null,
    geography,
    affectedProducts: combineProducts(voiced),
    quantityText: newest.quantityText,
    illnessStatement: newest.illnessStatement,
    // Derived from the notice's OWN prose, not from the extracted statement
    // (P2B7K). `illnessStatement` is whatever the sentence extractor kept, and
    // on the live corpus it is empty for FSIS outbreak notices that plainly
    // report illnesses — which left `reportsIllness` false while Recall Detail
    // showed "8 illnesses reported" for the same case. Reading `summaryText`
    // here is what makes the ledger and the screen structurally incapable of
    // disagreeing: both now classify the identical input with the identical
    // contract.
    reportsIllness: statusReportsIllness(deriveIllnessStatus(newest.summaryText)),
    consumerAction: primary.consumerAction,
    contactText: primary.contactText,
    officialUrl: primary.officialUrl,
    otherOfficialUrls: [
      ...new Set(records.map((r) => r.officialUrl).filter((u) => u !== primary.officialUrl)),
    ],
    sourceIdentifiers,
    publishedAt,
    lastPublicActivityAt,
  };
}
