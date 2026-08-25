/**
 * FDA announcement parser: one listing item and/or detail-page content region
 * → NormalizedSourceRecord. Every FDA quirk verified in the source contract
 * (§3.1, re-verified live 2026-08-21) is contained here:
 *
 * - No recall number or event id exists — identity is the announcement URL
 *   slug, with the observed update-churn prefixes ("updated-", "update-",
 *   "updated-release-") stripped so a retitled re-publish maps to the same
 *   source record instead of founding a duplicate case.
 * - The listing is unsorted, HTML-entity-encoded, and mixes every FDA product
 *   category — food scoping happens here and is explicit.
 * - Announcements are pre-classification by design: `not_yet_classified`
 *   unless the announcement itself states an authoritative class.
 * - Distribution, illness, quantity, instructions, and product codes live in
 *   press-release prose/tables — extraction is deterministic and best-effort,
 *   with source text preserved wherever structure cannot be established.
 */

import {
  extractChemicalAgent,
  extractPathogen,
  extractPathogenOrAllergen,
} from '../../domain/hazard';
import { classifyIllnessReport } from '../../domain/illness';
import { extractRetailerNames } from '../../domain/retailer';
import { statesInText } from '../../domain/us-geography';
import { declaresExpansion, declaresRevision } from '../duplicates';
import { extractProductPhotos, primaryPhoto } from '../../lib/product-photos';
import type { Classification, Geography, HazardCategory } from '../../domain/recall-types';
import type { NormalizedSourceRecord } from '../../domain/source-record';
import {
  CONSUMER_ACTION_PATTERN,
  decodeEntities,
  joinSentences,
  splitSentences,
  stripHtml,
} from '../../domain/text';

/** Raw shape of one FDA listing JSON item (undocumented backend, §3.1). */
export interface FdaListingItem {
  path: string;
  /** Listing date, "MM/DD/YYYY". */
  field_change_date_2: string;
  /** HTML (anchor-wrapped) brand name(s). */
  field_brand_name: string;
  field_product_description: string;
  field_recall_reason_description: string;
  /** Category taxonomy term(s), comma-joined ("Milk, Sesame", "Salmonella"). */
  field_recall_reason: string;
  field_company_name: string;
  /** Regulated-category tags ("Food &amp; Beverages", "Drugs", …). */
  field_regulated_product_field: string;
  /** Drupal node last-edit time as an HTML <time> element — moves on ANY page
   * edit, which is what makes listing-item hashing detect detail changes. */
  changed: string;
  [key: string]: unknown;
}

export class FdaParseError extends Error {
  constructor(
    message: string,
    public readonly path: string | null,
  ) {
    super(message);
    this.name = 'FdaParseError';
  }
}

export function isFdaListingItem(value: unknown): value is FdaListingItem {
  const item = value as FdaListingItem;
  return (
    typeof item?.path === 'string' &&
    item.path.startsWith('/') &&
    typeof item.field_regulated_product_field === 'string'
  );
}

export type FoodScope = 'food' | 'excluded_animal' | 'excluded_nonfood';

/**
 * Food-first scoping (task Part 5). Included: anything tagged
 * "Food & Beverages" (744 of 1,026 live items), which covers dietary
 * supplements co-tagged as food. Deliberately deferred, not silently decided:
 * items also tagged "Animal & Veterinary" (pet food such as "Canine Food") are
 * excluded because neither the source contract nor the product architecture
 * has approved pet food as initial scope — revisit as an explicit product
 * decision. Everything else (drugs, devices, cosmetics, …) is out of scope.
 */
export function foodScope(item: FdaListingItem): FoodScope {
  const tags = decodeEntities(item.field_regulated_product_field ?? '');
  if (!/\bFood & Beverages\b/i.test(tags)) return 'excluded_nonfood';
  if (/\bAnimal & Veterinary\b/i.test(tags)) return 'excluded_animal';
  return 'food';
}

/** Observed update-churn slug prefixes ("updated-…", "update-…", "updated-release-…"). */
const SLUG_UPDATE_PREFIX = /^updated?(?:-release)?-/;

/** "Updated – " / "UPDATE: " headline prefixes, stripped for display only. */
const TITLE_UPDATE_PREFIX = /^\s*updated?(?:\s+release)?\s*[–—:-]+\s*/i;

export function slugFromPath(path: string): string {
  return (
    path
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '')
      .split('/')
      .pop() ?? ''
  );
}

/**
 * Announcement identity (task Part 3): the URL slug with update-churn prefixes
 * stripped. Verified live: an update either replaces the original listing row
 * with an "updated-…" slug (Dreyer's) or coexists with it ("update-…",
 * Albertsons) — both map to one identity here, so a retitle produces a new
 * snapshot of the same record, never a duplicate consumer case. The full path
 * is preserved as the raw identity and in officialUrl.
 */
export function announcementIdentity(path: string): { nativeId: string; rawNativeId: string } {
  const slug = slugFromPath(path).toLowerCase();
  return { nativeId: slug.replace(SLUG_UPDATE_PREFIX, ''), rawNativeId: path };
}

/**
 * FDA's CMS appends "-0" (then "-1", …) when a new announcement's URL alias
 * collides with an existing one — i.e. when a revised re-publication carries
 * the same title (verified live: primavera-…-health-risk / …-health-risk-0,
 * one real recall as two announcements). The base slug is therefore a
 * CANDIDATE parent identity, never a conclusion: the pipeline links the two
 * into one case only when the base record exists AND the same-event evidence
 * gate (same firm, same hazard, related titles, bounded window) passes.
 * A product name that genuinely ends in a digit ("…-omega-3") simply finds
 * no parent, or fails the gate, and founds its own case as before.
 */
export function collisionBaseIdentity(nativeId: string): string | null {
  const match = nativeId.match(/^(.{20,})-\d{1,2}$/);
  return match ? match[1] : null;
}

/** "MM/DD/YYYY" → "YYYY-MM-DD" (null when unparseable). */
function listingDateToIso(value: string | undefined): string | null {
  const match = (value ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[1]}-${match[2]}` : null;
}

/** First datetime="…" attribute → its date part. */
function datetimeAttrDate(html: string | undefined): string | null {
  const match = (html ?? '').match(/datetime="(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

// ── Detail-page content region ───────────────────────────────────────────────

export interface FdaDetailFields {
  /** The headline exactly as published (update prefix intact). */
  rawTitle: string | null;
  companyAnnouncementDate: string | null;
  fdaPublishDate: string | null;
  productType: string | null;
  reasonDescription: string | null;
  companyName: string | null;
  brands: string[];
  productDescription: string | null;
  /** Press-release body region (announcement content after the summary block). */
  bodyHtml: string | null;
  bodyText: string;
  imageUrls: string[];
}

function ddItems(ddHtml: string): string[] {
  const items = [...ddHtml.matchAll(/<div class="field--item">([\s\S]*?)<\/div>/g)]
    .map((m) => stripHtml(m[1]))
    .filter((t) => t !== '');
  return items;
}

function ddText(ddHtml: string): string | null {
  const items = ddItems(ddHtml);
  if (items.length > 0) return items.join('\n');
  // Drop nested field--label captions ("Recall Reason Description") so only
  // the value remains.
  const text = stripHtml(ddHtml.replace(/<div class="field--label">[\s\S]*?<\/div>/g, ' '));
  return text === '' ? null : text;
}

/** Parse the structured summary block + body out of a detail content region. */
export function parseFdaDetail(mainHtml: string): FdaDetailFields {
  const rawTitle = mainHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)
    ? stripHtml(mainHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)![1])
        .replace(/\n+/g, ' ')
        .trim()
    : null;

  const fields: FdaDetailFields = {
    rawTitle: rawTitle === '' ? null : rawTitle,
    companyAnnouncementDate: null,
    fdaPublishDate: null,
    productType: null,
    reasonDescription: null,
    companyName: null,
    brands: [],
    productDescription: null,
    bodyHtml: null,
    bodyText: '',
    imageUrls: [],
  };

  const dl = mainHtml.match(/<dl class="lcds-description-list--grid">([\s\S]*?)<\/dl>/);
  if (dl) {
    for (const pair of dl[1].matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g)) {
      const label = stripHtml(pair[1]).toLowerCase();
      const dd = pair[2];
      if (label.startsWith('company announcement date')) {
        fields.companyAnnouncementDate = datetimeAttrDate(dd);
      } else if (label.startsWith('fda publish date')) {
        fields.fdaPublishDate = datetimeAttrDate(dd);
      } else if (label.startsWith('product type')) {
        fields.productType = ddText(dd);
      } else if (label.startsWith('reason for announcement')) {
        fields.reasonDescription = ddText(dd)?.replace(/\n+/g, '; ') ?? null;
      } else if (label.startsWith('company name')) {
        fields.companyName = ddText(dd);
      } else if (label.startsWith('brand name')) {
        fields.brands = ddItems(dd);
      } else if (label.startsWith('product description')) {
        fields.productDescription = ddText(dd)?.replace(/\n+/g, '; ') ?? null;
      }
    }
  }

  const bodyStart = mainHtml.search(/<h2[^>]*>\s*Company Announcement\s*<\/h2>/i);
  const bodyHtml = bodyStart >= 0 ? mainHtml.slice(bodyStart) : null;
  fields.bodyHtml = bodyHtml;
  // Fall back to the whole region so page-shape drift degrades, not blinds.
  fields.bodyText = stripHtml(bodyHtml ?? mainHtml);

  const seen = new Set<string>();
  for (const img of mainHtml.matchAll(/<img[^>]*\bsrc="(\/files\/[^"]+)"[^>]*>/g)) {
    const url = `https://www.fda.gov${decodeEntities(img[1])}`;
    if (!seen.has(url)) {
      seen.add(url);
      fields.imageUrls.push(url);
    }
  }
  return fields;
}

// ── Product tables → "check your package" lines ──────────────────────────────

const PRODUCT_TABLE_SIGNAL =
  /product|description|brand|upc|lot|batch|best[- ]?(if used )?by|use[- ]?by|sell[- ]?by|expir|size|item|code|flavor|sku|sold at/i;

function tableCells(rowHtml: string): string[] {
  return [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) =>
    stripHtml(m[1])
      .replace(/\s*\n\s*/g, ' ')
      .trim(),
  );
}

/**
 * Deterministic extraction of product tables from the press-release body into
 * one line per product row, preserving the source's own column labels
 * ("Batch Code/Best Before Date: … | UPC: …"). A code is labeled only by the
 * table's own header — never guessed. Tables without product-ish headers are
 * skipped; unparseable rows are simply not emitted (the full body text remains
 * preserved in the record).
 */
export function extractTableProductLines(bodyHtml: string | null): string[] {
  if (!bodyHtml) return [];
  const lines: string[] = [];
  for (const table of bodyHtml.matchAll(/<table[\s\S]*?<\/table>/g)) {
    const rows = [...table[0].matchAll(/<tr[\s\S]*?<\/tr>/g)].map((r) => r[0]);
    if (rows.length < 2) continue;
    const header = tableCells(rows[0]);
    if (!PRODUCT_TABLE_SIGNAL.test(header.join(' '))) continue;
    for (const row of rows.slice(1)) {
      if (/<th/i.test(row)) continue;
      const cells = tableCells(row);
      const parts: string[] = [];
      cells.forEach((cell, index) => {
        if (cell === '') return;
        const label = header[index]?.trim() ?? '';
        parts.push(label !== '' && index > 0 ? `${label}: ${cell}` : cell);
      });
      if (parts.length > 0) lines.push(parts.join(' | '));
    }
  }
  return lines;
}

// ── Geography (architecture Part 5: deterministic, honest unknowns) ──────────
//
// State recognition lives in the shared us-geography module, so the ingest
// parser and the display projection read a clause like "throughout MI, MN,
// and ND" identically — every explicitly named state retained, arbitrary
// two-letter uppercase strings never promoted to states.

// Deliberately excludes "stores in …": corporate-profile boilerplate
// ("currently operates 1,404 stores in Alabama, …") would masquerade as
// distribution. Verified against the recorded Publix announcement.
const DISTRIBUTION_SENTENCE =
  /\bdistribut\w+|\bsold\b|\bshipped\b|\bavailable (?:in|at)\b|\bnationwide\b/i;

const NATIONWIDE =
  /\bnationwide\b|\bnationally\b|\bacross the (?:country|united states)\b|\ball 50 states\b/i;

/**
 * Distribution from the announcement's own prose, per the architecture Part 5
 * rules: the literal "nationwide", or explicitly named states; anything less
 * (regions, retailer footprints, "eight-state operating area") stays
 * `unknown` with the source sentence preserved and displayed. Confidence is
 * always 'inferred' — FDA distribution is prose, never structured.
 */
export function parseFdaGeography(bodyText: string, title: string): Geography {
  const sentences = splitSentences(bodyText).filter(
    (s) => DISTRIBUTION_SENTENCE.test(s) && !CONSUMER_ACTION_PATTERN.test(s),
  );
  const sourceOf = (list: string[]) => list.slice(0, 2).join(' ').slice(0, 400) || null;

  const nationwideSentence = sentences.find((s) => NATIONWIDE.test(s));
  if (nationwideSentence) {
    return {
      scope: 'nationwide',
      states: [],
      confidence: 'inferred',
      sourceText: nationwideSentence.slice(0, 400),
    };
  }
  const withStates = sentences.filter((s) => statesInText(s).length > 0);
  if (withStates.length > 0) {
    return {
      scope: 'states',
      states: [...new Set(withStates.flatMap(statesInText))].sort(),
      confidence: 'inferred',
      sourceText: sourceOf(withStates),
    };
  }
  if (sentences.length > 0) {
    return {
      scope: 'unknown',
      states: [],
      confidence: 'inferred',
      sourceText: sourceOf(sentences),
    };
  }
  // Titles sometimes carry the only distribution statement ("…34 Texas Stores…").
  const titleStates = statesInText(title);
  if (titleStates.length > 0) {
    return { scope: 'states', states: titleStates, confidence: 'inferred', sourceText: title };
  }
  return { scope: 'unknown', states: [], confidence: 'inferred', sourceText: null };
}

// ── Quantity (task Part 10: preserve when the source states it) ──────────────

// The "of <product>" tail is kept only when it names the product directly
// ("120 cases of Enoki Mushroom"); possessive chains ("3,860 units of its 4oz
// and 12 oz packages of its …") add clutter, not identification.
const QUANTITY_PATTERN =
  /recall(?:ing|ed|s)?(?:\s+of)?\s+((?:approximately\s+|about\s+|a total of\s+)?[\d][\d,]*\s+(?:cases|pounds|lbs\.?|units|packages|bags|boxes|jars|bottles|containers|pouches|cartons)\b(?:\s+of\s+(?!its\b|their\b|the\s+company)[^,.;]{1,60})?)/i;

/**
 * The recall quantity exactly as the source states it, extracted only from a
 * direct "recalling <N> <unit>" construction — package sizes and unrelated
 * numbers never qualify. null = the source states no quantity (most FDA
 * announcements), never zero.
 */
export function parseFdaQuantity(bodyText: string): string | null {
  const match = bodyText.match(QUANTITY_PATTERN);
  return match ? match[1].replace(/\s+/g, ' ').trim() : null;
}

// ── Hazard/reason mapping (deterministic category lookup) ────────────────────

const MICROBIAL_CATEGORIES =
  /salmonella|listeria|e\. ?coli|botulism|microbial contamination|pathogenic microorganism|potential foodborne illness|bacteria|mold|insufficient pasteurization|potential lack of sterility|hepatitis|cyclospora|norovirus/i;

const ALLERGEN_CATEGORY_TOKENS = [
  'milk',
  'eggs',
  'fish',
  'crustacean shellfish',
  'tree nuts',
  'peanuts',
  'wheat',
  'soybean',
  'sesame',
  'sulfites',
  'gluten',
];

const CHEMICAL_CATEGORIES = /\blead\b|pesticide|radionuclides|impurity|elevated levels/i;

const INTEGRITY_CATEGORIES =
  /^defect$|packaging defect|potential packaging issue|choking threats|discoloration/i;

const REGULATORY_CATEGORIES =
  /mislabeling|incorrect instructions|unapproved|prohibited ingredient|ingredient level/i;

export interface FdaHazard {
  hazardCategory: HazardCategory;
  pathogenOrAllergen: string | null;
}

const FOREIGN_MATERIAL_WORDS =
  /\bmetal\b|\bplastic\b|\bglass\b|\bwood\b|\brubber\b|foreign (?:material|matter|object)/i;
const FOREIGN_MATERIAL_SPECIFIC = ['metal', 'plastic', 'glass', 'wood', 'rubber'];

/**
 * Fixed lookup from the FDA listing's reason-category taxonomy (plus the
 * announcement text for agent names). Unmapped categories → 'unknown', never
 * guessed; the raw category and full text stay preserved in the snapshot.
 */
export function deriveFdaHazard(categoryText: string, fullText: string): FdaHazard {
  const category = decodeEntities(categoryText ?? '').trim();
  const tokens = category
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t !== '');

  const allergens = tokens.filter((t) => ALLERGEN_CATEGORY_TOKENS.includes(t));
  const hasGenericAllergen = tokens.some((t) => t === 'potential or undeclared allergen');

  if (MICROBIAL_CATEGORIES.test(category)) {
    // The category names the pathogen class; the specific organism comes from
    // the source's own text (title/reason/body), falling back to a category
    // token that is itself an organism name.
    const fromText = extractPathogen(fullText);
    const fromCategory = tokens.find((t) => /^(salmonella|listeria|e\. ?coli)$/i.test(t));
    return {
      hazardCategory: 'microbial_contamination',
      pathogenOrAllergen:
        fromText ??
        (fromCategory ? fromCategory.charAt(0).toUpperCase() + fromCategory.slice(1) : null),
    };
  }
  if (allergens.length > 0 || hasGenericAllergen) {
    const named =
      allergens.length > 0
        ? allergens
        : (fullText
            .match(/undeclared\s+([a-z]+(?:,? and [a-z]+)*)/i)?.[1]
            .split(/,? and /)
            .map((a) => a.trim().toLowerCase()) ?? []);
    return {
      hazardCategory: 'allergen',
      pathogenOrAllergen:
        named.length > 0
          ? `undeclared ${named.join(named.length === 2 ? ' and ' : ', ').replace(/, ([a-z ]+)$/, ', and $1')}`
          : (extractPathogenOrAllergen(fullText) ?? null),
    };
  }
  if (/potential foreign material/i.test(category)) {
    return { hazardCategory: 'foreign_material', pathogenOrAllergen: null };
  }
  if (/potential metal or chemical contaminant/i.test(category)) {
    // This one category covers both physical fragments and chemical agents;
    // the announcement's own wording decides which.
    if (FOREIGN_MATERIAL_WORDS.test(fullText)) {
      return { hazardCategory: 'foreign_material', pathogenOrAllergen: null };
    }
    return {
      hazardCategory: 'chemical_contamination',
      pathogenOrAllergen: extractChemicalAgent(fullText),
    };
  }
  if (CHEMICAL_CATEGORIES.test(category)) {
    return {
      hazardCategory: 'chemical_contamination',
      pathogenOrAllergen: extractChemicalAgent(fullText),
    };
  }
  if (INTEGRITY_CATEGORIES.test(category)) {
    return { hazardCategory: 'product_integrity', pathogenOrAllergen: null };
  }
  if (REGULATORY_CATEGORIES.test(category)) {
    return { hazardCategory: 'other_regulatory', pathogenOrAllergen: null };
  }
  return { hazardCategory: 'unknown', pathogenOrAllergen: extractPathogenOrAllergen(fullText) };
}

/** The specific foreign material when the text names one. */
export function foreignMaterialAgent(fullText: string): string | null {
  return (
    FOREIGN_MATERIAL_SPECIFIC.find((m) => new RegExp(`\\b${m}\\b`, 'i').test(fullText)) ?? null
  );
}

// ── Classification (Part 7: announcements are pre-classification) ────────────

function parseClassification(bodyText: string): Classification {
  // Only an explicit authoritative statement in the announcement itself
  // counts; hazard language never implies a class.
  const match = bodyText.match(
    /\b(?:FDA|U\.S\. Food and Drug Administration)[^.]{0,120}?\bclassified\b[^.]{0,60}?\bClass\s+(I{1,3})\b/i,
  );
  if (match) {
    const value =
      match[1].length === 1 ? 'class_I' : match[1].length === 2 ? 'class_II' : 'class_III';
    return { value, sourceText: match[0].trim() };
  }
  return { value: 'not_yet_classified', sourceText: null };
}

// ── The full parse ───────────────────────────────────────────────────────────

export interface FdaAnnouncementSource {
  /** The raw listing item, when discovered via the listing JSON. */
  listing: FdaListingItem | null;
  /** The detail page's <main> content region, when fetched. */
  detailMainHtml: string | null;
  /** Announcement path for RSS-only discovery (no listing row). */
  path?: string;
  /** RSS title, as a title fallback when no detail page is available. */
  rssTitle?: string | null;
}

function listingBrands(item: FdaListingItem): string[] {
  return stripHtml(item.field_brand_name ?? '')
    .split(/,|\n/)
    .map((b) => b.trim())
    .filter((b) => b !== '');
}

export function parseFdaAnnouncement(source: FdaAnnouncementSource): NormalizedSourceRecord {
  const path = source.listing?.path ?? source.path ?? null;
  if (!path) throw new FdaParseError('announcement has no path', null);
  if (!source.listing && !source.detailMainHtml) {
    throw new FdaParseError('announcement has neither listing item nor detail content', path);
  }
  const { nativeId, rawNativeId } = announcementIdentity(path);
  if (nativeId === '') throw new FdaParseError('announcement path has no slug', path);

  const detail = source.detailMainHtml ? parseFdaDetail(source.detailMainHtml) : null;
  const listing = source.listing;

  const companyName =
    detail?.companyName ?? (listing ? decodeEntities(listing.field_company_name ?? '').trim() : '');
  const firm = companyName === '' ? null : companyName;

  const productDescription =
    detail?.productDescription ??
    (listing ? decodeEntities(listing.field_product_description ?? '').trim() : '') ??
    '';
  const brands = detail?.brands.length ? detail.brands : listing ? listingBrands(listing) : [];

  const rawTitle =
    detail?.rawTitle ??
    source.rssTitle ??
    // Composition of two structured source facts — used only when neither the
    // detail page nor RSS supplied the official headline.
    (firm && productDescription !== '' ? `${firm} recalls ${productDescription}` : null);
  if (!rawTitle) throw new FdaParseError('announcement has no derivable title', path);
  const title = rawTitle.replace(TITLE_UPDATE_PREFIX, '').trim();

  const publishedAt =
    detail?.fdaPublishDate ?? (listing ? listingDateToIso(listing.field_change_date_2) : null);
  if (!publishedAt) {
    throw new FdaParseError('announcement has no parseable publish date', path);
  }
  const lastModifiedAt = listing?.changed
    ? (listing.changed.match(/datetime="(\d{4}-\d{2}-\d{2})/)?.[1] ?? null)
    : null;

  const reasonDescription =
    detail?.reasonDescription ??
    (listing ? decodeEntities(listing.field_recall_reason_description ?? '').trim() : '') ??
    '';
  const categoryText = listing?.field_recall_reason ?? '';
  const bodyText = detail?.bodyText ?? '';
  const hazardText = `${title}\n${reasonDescription}\n${bodyText}`;
  const hazard = deriveFdaHazard(categoryText, hazardText);

  return {
    sourceSystem: 'fda_announcement',
    sourceAgency: 'FDA',
    nativeId,
    rawNativeId,
    // FDA MVP announcements are recalls; market withdrawals/safety alerts are
    // not separately identifiable in the listing and stay labeled by their own
    // titles (architecture Part 4 noticeType note).
    noticeType: 'recall',
    // The listing exposes no closure signal; lifecycle truth arrives with
    // enforcement reconciliation (Phase B). 'active' is the honest default.
    lifecycle: 'active',
    closedYear: null,
    classification: parseClassification(bodyText),
    // A slug-collision suffix proposes the base announcement as this record's
    // parent; the pipeline's evidence gate decides whether they link.
    expansionOfNativeId: collisionBaseIdentity(nativeId),
    // A declared expansion ("…Expands Recall of…") has no linkable parent id;
    // the pipeline searches for the parent under its own evidence gate. Same
    // for a declared revision (FDA's "updated their press release" editorial
    // note), whose slug changes whenever the correction retitled the page.
    declaresExpansion: declaresExpansion(title, bodyText),
    declaresRevision: declaresRevision(bodyText),
    isRetractionNotice: false,
    retractsNativeIds: [],
    title,
    summaryText: bodyText,
    summaryHtml: detail?.bodyHtml ?? null,
    reasonText:
      reasonDescription === ''
        ? categoryText === ''
          ? null
          : decodeEntities(categoryText)
        : reasonDescription,
    hazardCategory: hazard.hazardCategory,
    pathogenOrAllergen: hazard.pathogenOrAllergen,
    firmDisplayName: firm,
    firmRawVariants: firm ? [firm] : [],
    brands,
    productDescription: productDescription === '' ? null : productDescription,
    imageUrls: detail?.imageUrls ?? [],
    geography: parseFdaGeography(bodyText, title),
    retailerNames: extractRetailerNames(`${title}\n${bodyText}`),
    // Lead photo for feed cards, selected by the same rules the detail
    // gallery uses (agency-hosted only, code close-ups deprioritized).
    heroImageUrl: primaryPhoto(extractProductPhotos(detail?.bodyHtml ?? null))?.url ?? null,
    productLines: extractTableProductLines(detail?.bodyHtml ?? null),
    quantityText: parseFdaQuantity(bodyText),
    illnessStatement: (() => {
      const report = classifyIllnessReport(bodyText);
      return report.statements.length > 0 ? joinSentences(report.statements) : null;
    })(),
    consumerAction: (() => {
      const matches = splitSentences(bodyText).filter((s) => CONSUMER_ACTION_PATTERN.test(s));
      return matches.length > 0 ? joinSentences(matches.slice(0, 2)) : null;
    })(),
    contactText: null,
    officialUrl: `https://www.fda.gov${path.startsWith('/') ? path : `/${path}`}`,
    publishedAt,
    lastModifiedAt,
  };
}
