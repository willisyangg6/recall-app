/**
 * Approved retailer notices, ADAPTED into the shared presentation contract:
 * the same Feed card model (`HomeCardModel`) the agency recalls build, and the
 * same Recall Details model (`DetailModel`), built through the same shared
 * builders (`whereSoldModel`, `affectedProductsModel`, `activityDisplay`, …).
 * The card and the detail screen render a Costco recall exactly as they
 * render an FDA or FSIS one; no retailer layout exists.
 *
 * What the adapter decides, and only this:
 *
 * - Risk: the existing neutral Unknown treatment (`unclassifiedRiskView`) in
 *   the normal badge position. Never Pending (its note promises an agency
 *   classification) and never a severity tier.
 * - The one source link reads "View Costco's letter" and opens the letter.
 * - Costco is the stated retailer under Where It Was Sold.
 * - Package identifiers become the SAME typed facts the agency extractors
 *   produce (package_size, best_by, lot, upc, item_number) and go through the
 *   SAME gate, `aggregateFacts` → `toPackageFields`: the same date formatter
 *   ("APR/02/27" → "April 2, 2027", raw kept), the same code validation and
 *   de-duplication, the same closed field vocabulary and display order. An
 *   item number or supplier code has no approved field, so that gate drops
 *   it exactly as it drops an agency notice's item code; can timestamps have
 *   no concept at all. No row is added to Affected Products.
 * - The card's reason comes from the shared `conciseReasonLine`, fed the
 *   reviewer-approved structured reason (`fields.reason`) in the same terms an
 *   agency case carries; What Happened stays the approved prose.
 * - No Affects You verdict, no save control, no community reports, no health
 *   guidance, no illness notice: the agency evidence those read does not exist
 *   for a retailer notice.
 *
 * Every visible string is an approved field read verbatim, or a label the
 * shared contract already owns. Nothing here is written to recall_cases.
 */

import {
  aggregateFacts,
  toPackageFields,
  type ConsumerDistribution,
  type ConsumerPackageCheck,
} from './consumer-projection';
import { tierForActivityDate } from './feed-relevance';
import type { FeedItem } from './recall-feed';
import { allocateRecallImages } from './recall-images';
import {
  activityDisplay,
  affectedProductsModel,
  affectedProductsSection,
  cardSummaryText,
  conciseReasonLine,
  detailImageSet,
  homeLocationSummary,
  productImagery,
  whereSoldModel,
  whereSoldSection,
  type DetailModel,
  type HomeCardModel,
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

/** "View Costco’s letter": the only source link a retailer notice has. */
export function retailerLetterLinkLabel(fields: RetailerNoticeFields): string {
  return `View ${fields.retailer}’s letter`;
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

function geographyOf(fields: RetailerNoticeFields) {
  return {
    scope: 'states' as const,
    states: fields.whereSold.states,
    confidence: 'stated' as const,
    sourceText: null,
  };
}

/** The Feed card model, for the shared `RecallCard`. */
export function buildRetailerHomeCardModel(notice: RetailerNotice, today: string): HomeCardModel {
  const { fields } = notice;
  return {
    id: retailerRouteId(notice),
    noticeLabel: null,
    risk: unclassifiedRiskView(),
    activity: activityDisplay(notice.noticeDate, [], today),
    affectsYou: false,
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
        pathogenOrAllergen: fields.reason.agent,
        title: null,
      }),
    ),
    categoryLabel: null,
    categoryId: null,
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
  return {
    scopeType: 'states',
    areaText: '',
    states,
    areas: [],
    coverage: [{ retailer: fields.retailer, states, areas: [] }],
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

/** The Recall Details model, for the shared Recall Details screen. */
export function buildRetailerDetailModel(notice: RetailerNotice, today: string): DetailModel {
  const { fields } = notice;
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
    category: null,
    affectsYou: false,
    affectsYouBanner: 'Warning: This recall affects you.',
    whatHappened: { text: fields.whatHappened, scope: null },
    illnessNotice: null,
    whereSold: sold,
    affectedProducts: products,
    sections: {
      whereSold: whereSoldSection(sold),
      communityReports: null,
      healthRisk: null,
      affectedProducts: affectedProductsSection(products, images.rowImages),
    },
    healthRisk: null,
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
 * card. Affects you never includes them in this release.
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
