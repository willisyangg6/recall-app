/**
 * Approved retailer notices through the SAME presentation steps an agency
 * recall takes (docs/recall-retailer-notices.md, "One presentation path").
 *
 * Source-specific extraction ends at the approved fields: a reviewer-checked
 * product name, firm, structured reason (hazard family + agent, the terms an
 * agency case carries), the retailer's own prose as evidence, states, package
 * identifiers and photo. From there nothing is retailer-specific:
 *
 * - What Happened, the illness notice and Health Risk come from the shared
 *   `recallNarrative` over that structured reason and the letter's prose,
 *   exactly as an agency case's come from its projection. The letter's prose
 *   is EVIDENCE (illness status, temperature context), never the paragraph.
 * - The category is the stored answer of the shared server-side classifier,
 *   read and launch-filtered by the same card/Detail functions.
 * - Package identifiers become the same typed facts the agency extractors
 *   emit and pass the same `aggregateFacts` → `toPackageFields` gate; an item
 *   number, supplier code or can timestamp has no approved field and is
 *   dropped there, kept privately in the approved fields.
 * - The photo goes through the shared image allocation.
 * - The card's reason is the shared `conciseReasonLine`.
 *
 * - Affects You is the SAME `affectsYouVerdict` over `retailerRelevanceInput`
 *   (docs/recall-personalization.md, "Retailer-only notices"): the approved
 *   states (or unknown), the publishing retailer as the store signal, and the
 *   approved structured reason. Push eligibility is that verdict too.
 *
 * What stays the retailer's own: the neutral Unknown risk treatment (no agency
 * classification exists), the one source link naming the retailer's document,
 * the publishing retailer in the existing store row, and no save or community
 * reports. Nothing here is written to recall_cases.
 */

import type { UserRecallPreferences } from '@/domain/preferences';
import type { Geography } from '@/domain/recall-types';

import {
  aggregateFacts,
  toPackageFields,
  type ConsumerDistribution,
  type ConsumerPackageCheck,
} from './consumer-projection';
import { tierForActivityDate } from './feed-relevance';
import type { FeedItem } from './recall-feed';
import { allocateRecallImages } from './recall-images';
import { affectsYouVerdict, evaluatePersonalRelevance, type RelevanceInput } from './relevance';
import {
  extractAllergenEvidence,
  extractChemicalAgent,
  extractPathogen,
  formatAllergenList,
  normalizedAllergenTokens,
} from '@/domain/hazard';
import { narrativeWithoutIllness } from '@/domain/illness-status';
import {
  activityDisplay,
  affectedProductsModel,
  affectedProductsSection,
  cardCategoryId,
  cardCategoryLabel,
  cardSummaryText,
  conciseReasonLine,
  detailCategory,
  detailImageSet,
  homeLocationSummary,
  productImagery,
  recallNarrative,
  whereSoldModel,
  whereSoldSection,
  type DetailModel,
  type HomeCardModel,
  type NarrativeEvidence,
} from './recall-presentation';
import { compareRecencyKeys, recencyKey, type RecencyKey } from './recency-order';
import type { RetailerNoticeFields } from './retailer-notice-fields';
import type { RetailerNotice } from './retailer-notices';
import type { SemanticFact } from './source-tables';
import { unclassifiedRiskView } from './risk-display';

// ── Route identity ──────────────────────────────────────────────────────────

/**
 * A retailer notice opens Recall Details at `/recall/retailer:<id>`. The
 * prefix can never collide with a case id (a uuid), so the screen knows which
 * read path to use, and a Costco id can never be fetched as a case.
 */
export const RETAILER_ROUTE_PREFIX = 'retailer:';

export function retailerRouteId(notice: Pick<RetailerNotice, 'id'>): string {
  return `${RETAILER_ROUTE_PREFIX}${notice.id}`;
}

/** The notice id a Recall Details route names, or null for an agency case. */
export function retailerNoticeIdFromRoute(routeId: string): string | null {
  return routeId.startsWith(RETAILER_ROUTE_PREFIX)
    ? routeId.slice(RETAILER_ROUTE_PREFIX.length)
    : null;
}

// ── The shared models ───────────────────────────────────────────────────────

/** What each retailer calls the document it publishes. */
const DOCUMENT_NOUN: Record<RetailerNoticeFields['retailer'], string> = {
  Costco: 'letter',
  ALDI: 'recall notice',
};

/**
 * "View Costco’s letter", "View ALDI’s recall notice": the only source link a
 * retailer notice has, named for the document that retailer publishes.
 */
export function retailerLetterLinkLabel(fields: RetailerNoticeFields): string {
  return `View ${fields.retailer}’s ${DOCUMENT_NOUN[fields.retailer]}`;
}

/**
 * Approved fields Recall Details does not render. The package identifiers
 * here are dropped by the shared package-field gate (no approved field), and
 * the detail screen has no instructions, contact or purchase-window slot.
 * They stay in the approved fields, searchable, and are never relabeled.
 */
export const RETAILER_FIELDS_WITHOUT_A_SLOT = [
  'packageChecks.retailerItemNumbers',
  'packageChecks.supplierCodes',
  'packageChecks.canTimestamps',
  'whereSold.purchaseWindow',
  'instructions',
  'contact',
] as const;

/**
 * The canonical tri-state geography. A letter that states no state is
 * `unknown`, exactly as an agency notice that names no place is, so the card
 * reads the shared "Distribution not specified" line. Costco's own region
 * names ("Select Locations in the Midwest") are never mapped to states.
 */
export function geographyOf(fields: RetailerNoticeFields): Geography {
  const { states } = fields.whereSold;
  return states.length > 0
    ? { scope: 'states', states, confidence: 'stated', sourceText: null }
    : { scope: 'unknown', states: [], confidence: 'stated', sourceText: null };
}

/**
 * The reviewer's approved allergen agent as the canonical "undeclared …"
 * statement relevance reads, naming EVERY allergen either shared reading
 * finds. Each reading alone can miss one ("undeclared Tree Nuts
 * (Hazelnut/Filbert) and soy": the evidence extractor stops at the
 * parenthesis and keeps tree nuts; the token normalizer keeps only soy). A
 * missed allergen is dangerous here, because the known allergen-only
 * mismatch would then WITHHOLD the recall from a shopper allergic to it; the
 * union only adds allergens the approved text names.
 */
function allergenStatement(agent: string | null): string | null {
  if (agent === null) return null;
  const words = new Map<string, string>();
  for (const word of extractAllergenEvidence(agent)) {
    for (const token of normalizedAllergenTokens(`undeclared ${word}`)) words.set(token, word);
  }
  for (const token of normalizedAllergenTokens(agent)) {
    if (!words.has(token)) words.set(token, token);
  }
  return words.size > 0 ? `undeclared ${formatAllergenList([...words.values()])}` : agent;
}

/**
 * The facts the ONE relevance evaluation reads, from the approved fields
 * (docs/recall-personalization.md, "Retailer-only notices"). The publishing
 * retailer is the store signal; a letter that states no state is `unknown`,
 * never nationwide; the agent and hazard are the reviewer's structured reason.
 */
export function retailerRelevanceInput(notice: Pick<RetailerNotice, 'fields'>): RelevanceInput {
  const { fields } = notice;
  return {
    geography: geographyOf(fields),
    retailerNames: [fields.retailer],
    pathogenOrAllergen:
      fields.reason.hazardCategory === 'allergen'
        ? allergenStatement(fields.reason.agent)
        : canonicalAgent(fields),
    hazardCategory: fields.reason.hazardCategory,
    reasonText: fields.whyRecalled,
  };
}

/** The Feed card model, for the shared `RecallCard`. */
export function buildRetailerHomeCardModel(
  notice: RetailerNotice,
  today: string,
  prefs: UserRecallPreferences | null = null,
): HomeCardModel {
  const { fields } = notice;
  return {
    id: retailerRouteId(notice),
    noticeLabel: null,
    risk: unclassifiedRiskView(),
    activity: activityDisplay(notice.noticeDate, [], today),
    // The same verdict an agency card renders, from the same preferences.
    affectsYou: affectsYouVerdict(retailerRelevanceInput(notice), prefs),
    productName: fields.productName,
    // The company line, exactly as an agency card falls back to the firm
    // when no consumer brand is stated separately.
    brand: { text: fields.firmName, brands: [], usedBrand: false },
    // The SAME concise-reason path an agency card takes, over the reviewer's
    // structured reason: "Potential cleaning chemical contamination." here,
    // which the card renders in its own wording, exactly as for agencies.
    reasonLine: cardSummaryText(
      conciseReasonLine({
        reasonText: fields.whyRecalled,
        hazardCategory: fields.reason.hazardCategory,
        pathogenOrAllergen: canonicalAgent(fields),
        title: null,
      }),
    ),
    // The shared classifier's stored answer, through the same display gate.
    categoryLabel: cardCategoryLabel(notice.productCategories),
    categoryId: cardCategoryId(notice.productCategories),
    // The approved photo through the shared image slot; null keeps the
    // approved no-image card shape, exactly as for an agency recall.
    heroImageUrl: notice.imageUrl,
    locationSummary: homeLocationSummary(geographyOf(fields)),
    saveable: false,
  };
}

/** One approved value as the typed fact an agency extractor would emit. */
function facts(concept: SemanticFact['concept'], sourceLabel: string, values: string[]) {
  return values.map((value): SemanticFact => ({ concept, sourceLabel, value, raw: value }));
}

/**
 * The approved package identifiers through the SHARED package-field gate
 * (consumer-projection `aggregateFacts` → `toPackageFields`), so they inherit
 * the agency formatting, validation, de-duplication and field order.
 */
export function retailerPackageFields(fields: RetailerNoticeFields) {
  const checks = fields.packageChecks;
  return toPackageFields(
    aggregateFacts([
      ...facts('package_size', 'Product', fields.size === null ? [] : [fields.size]),
      ...facts('best_by', 'Best If Used By', checks.bestByDates),
      ...facts('lot', 'Lot', checks.lotCodes),
      ...facts('upc', 'UPC', checks.upcs),
      ...facts('item_number', 'Item', checks.retailerItemNumbers),
      ...facts('item_number', 'item code', checks.supplierCodes),
    ]),
  );
}

function packageCheckOf(fields: RetailerNoticeFields): ConsumerPackageCheck {
  const { fields: packageFields, rejected } = retailerPackageFields(fields);
  return {
    render: packageFields.length > 0,
    scopeStatement: '',
    variants: [],
    sharedFields: [],
    fields: packageFields,
    rejected,
    lotCodes: null,
    productionCodes: null,
    productionDates: null,
    productionDateValues: [],
    codeLocation: null,
    photos: [],
    coverage: packageFields.length > 0 ? 'structured' : 'source_silent',
    hasIdentifiers: packageFields.length > 0,
  };
}

function distributionOf(fields: RetailerNoticeFields): ConsumerDistribution {
  const { states } = fields.whereSold;
  // With no stated state this is the agency projection's own shape for an
  // unspecified distribution that still names a retailer: an empty lead,
  // which the shared `whereSoldModel` renders as "Distribution not
  // specified", with Costco kept as the stated retailer.
  return {
    scopeType: states.length > 0 ? 'states' : 'unspecified',
    areaText: '',
    states,
    areas: [],
    coverage: states.length > 0 ? [{ retailer: fields.retailer, states, areas: [] }] : [],
    retailers: [fields.retailer],
    statedRetailers: [fields.retailer],
    retailersShown: [fields.retailer],
    retailersHidden: 0,
    retailLocations: [],
    onlinePlatforms: [],
    channels: [],
    unspecified: false,
  };
}

/**
 * The approved fields as the shared narrative's evidence: the structured
 * reason in agency terms, and the letter's own prose (what happened and why)
 * as the source text the illness and context rules read.
 */
/**
 * The approved agent in the canonical spelling agency ingestion stores
 * ("salmonella" → "Salmonella"), through the same domain extractors the FDA
 * and FSIS parsers use. Only a respelling is taken: an extractor answer that
 * drops a word ("inorganic arsenic" → "arsenic") would lose a stated
 * specific, so the approved agent stays as approved.
 */
export function canonicalAgent(fields: RetailerNoticeFields): string | null {
  const { agent, hazardCategory } = fields.reason;
  if (agent === null) return null;
  const canonical =
    hazardCategory === 'microbial_contamination'
      ? extractPathogen(agent)
      : hazardCategory === 'chemical_contamination'
        ? extractChemicalAgent(agent)
        : null;
  return canonical !== null && canonical.toLowerCase() === agent.toLowerCase() ? canonical : agent;
}

export function retailerNarrativeEvidence(fields: RetailerNoticeFields): NarrativeEvidence {
  return {
    title: fields.productName,
    noticeType: 'recall',
    reasonText: fields.whyRecalled,
    hazardCategory: fields.reason.hazardCategory,
    pathogenOrAllergen: canonicalAgent(fields),
    firmDisplayName: fields.firmName,
    summaryText: `${fields.whatHappened}\n${fields.whyRecalled}`,
    productDescription: fields.productName,
    consumerBrand: null,
    retracted: false,
  };
}

/** The Recall Details model, for the shared Recall Details screen. */
export function buildRetailerDetailModel(
  notice: RetailerNotice,
  today: string,
  prefs: UserRecallPreferences | null = null,
): DetailModel {
  const { fields } = notice;
  const narrative = recallNarrative(retailerNarrativeEvidence(fields));
  const sold = whereSoldModel(distributionOf(fields));
  const products = affectedProductsModel(packageCheckOf(fields), fields.productName);
  const images = allocateRecallImages({
    heroImageUrl: notice.imageUrl,
    photos: [],
    labelVisuals: [],
    rows: [],
  });
  return {
    id: retailerRouteId(notice),
    noticeTypeLabel: 'Recall',
    retracted: false,
    risk: unclassifiedRiskView(),
    activity: activityDisplay(notice.noticeDate, [], today),
    productName: fields.productName,
    brand: { text: fields.firmName, brands: [], usedBrand: false },
    officialSource: { url: notice.documentUrl, label: retailerLetterLinkLabel(fields) },
    heroImageUrl: images.hero?.url ?? null,
    productImages: detailImageSet(productImagery(images), fields.productName),
    category: detailCategory(notice.productCategories),
    affectsYou: affectsYouVerdict(retailerRelevanceInput(notice), prefs),
    affectsYouBanner: 'Warning: This recall affects you.',
    whatHappened: {
      text: narrativeWithoutIllness(narrative.happened.text, narrative.illnessStatus),
      scope: narrative.happened.scope,
    },
    illnessNotice: narrative.illnessNotice,
    whereSold: sold,
    affectedProducts: products,
    sections: {
      whereSold: whereSoldSection(sold),
      communityReports: null,
      healthRisk: narrative.healthRiskSection,
      affectedProducts: affectedProductsSection(products, images.rowImages),
    },
    healthRisk: narrative.standardizedRisk,
    attachments: [],
    images,
    officialTitle: null,
    agencyLabel: fields.retailer,
    sourceOrganization: fields.retailer,
  };
}

// ── Placement among agency recalls (unchanged) ──────────────────────────────

export type HomeRow =
  { kind: 'agency'; item: FeedItem } | { kind: 'retailer'; notice: RetailerNotice };

/** The row's list key: a retailer id is prefixed so it can never equal a case id. */
export function homeRowKey(row: HomeRow): string {
  return row.kind === 'agency' ? row.item.id : retailerRouteId(row.notice);
}

function retailerKey(notice: RetailerNotice): RecencyKey {
  return {
    materialActivityAt: notice.noticeDate,
    publishedAt: notice.noticeDate,
    id: retailerRouteId(notice),
  };
}

/**
 * One section's rows: the agency items in the order they arrived (already
 * newest first), with retailer notices interleaved by the letter's date under
 * the same total order. The agency items are the same objects in the same
 * relative order, so with no notices the section is exactly the agency list.
 */
export function mergeSectionRows(agency: FeedItem[], notices: RetailerNotice[]): HomeRow[] {
  const sorted = [...notices].sort((a, b) => compareRecencyKeys(retailerKey(a), retailerKey(b)));
  const rows: HomeRow[] = [];
  let next = 0;
  for (const item of agency) {
    const key = recencyKey(item);
    while (next < sorted.length && compareRecencyKeys(retailerKey(sorted[next]), key) < 0) {
      rows.push({ kind: 'retailer', notice: sorted[next++] });
    }
    rows.push({ kind: 'agency', item });
  }
  while (next < sorted.length) rows.push({ kind: 'retailer', notice: sorted[next++] });
  return rows;
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Search over the approved names and every package identifier. */
export function retailerNoticeMatches(notice: RetailerNotice, query: string): boolean {
  const needle = normalized(query);
  if (needle === '') return true;
  const { fields } = notice;
  const haystack = [
    fields.retailer,
    fields.productName,
    fields.firmName,
    ...Object.values(fields.packageChecks).flat(),
  ].map(normalized);
  const digits = needle.replace(/\D/g, '');
  return haystack.some(
    (value) =>
      value.includes(needle) || (digits.length >= 4 && value.replace(/\D/g, '').includes(digits)),
  );
}

/**
 * Which notices All recalls shows, split by the SAME 60-day boundary the
 * agency sections use, applied to the letter's date. Notices are hidden
 * whenever a browsing filter is active: they carry no category, risk tier or
 * agency, so no filter can place them honestly. Search narrows them like any
 * card.
 */
export function retailerNoticesForAll(
  notices: RetailerNotice[],
  now: Date,
  { filtersActive, query }: { filtersActive: boolean; query: string },
): { recent: RetailerNotice[]; older: RetailerNotice[] } {
  if (filtersActive) return { recent: [], older: [] };
  const recent: RetailerNotice[] = [];
  const older: RetailerNotice[] = [];
  for (const notice of notices) {
    if (!retailerNoticeMatches(notice, query)) continue;
    (tierForActivityDate(notice.noticeDate, now) === 'recent' ? recent : older).push(notice);
  }
  return { recent, older };
}

/**
 * Which notices Affects you shows: exactly those the shared relevance
 * evaluation says affect this user, split by the same 60-day boundary on the
 * letter's date, with the same filter and search rules as All recalls. A
 * notice with no confirmed-open evidence (retailers publish none) is counted
 * only while recent, as an agency recall without that evidence is.
 */
export function retailerNoticesForAffects(
  notices: RetailerNotice[],
  now: Date,
  prefs: UserRecallPreferences,
  options: { filtersActive: boolean; query: string },
): { recent: RetailerNotice[]; older: RetailerNotice[] } {
  const affecting = notices.filter(
    (notice) => evaluatePersonalRelevance(retailerRelevanceInput(notice), prefs).affectsMe,
  );
  return retailerNoticesForAll(affecting, now, options);
}
