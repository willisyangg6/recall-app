/**
 * The shared consumer presentation contract (P1).
 *
 * One pure, deterministic mapping from canonical recall data to the exact
 * consumer-facing fields both screens render. Home cards consume
 * `buildHomeCardModel`; the detail screen consumes `buildDetailModel`; neither
 * screen assembles product names, brands, dates, reasons, illness lines,
 * geography, imagery, or affected products on its own. The authoritative
 * behavior contract lives in docs/recall-feed-usability.md.
 *
 * Rules that govern everything here:
 *  - Display-only. Canonical/raw recall data is never modified, and every
 *    transformation degrades to the source-supported value when a cleaner one
 *    cannot be derived safely.
 *  - Missing information is omitted or stated honestly — never invented.
 *  - Time is injected (`today` as YYYY-MM-DD), so every function is testable
 *    with a fixed date and no formatting depends on the process timezone.
 */

import { classifyIllnessReport, type IllnessReport } from '@/domain/illness';
import { hasMaterialUpdate, materialActivityAt } from '@/domain/material-activity';
import type {
  CaseProjection,
  Geography,
  NoticeType,
  SourceAgency,
  TimelineEntry,
} from '@/domain/recall-types';
import { STATE_TO_POSTAL } from '@/domain/us-geography';
import {
  buildConsumerCase,
  type AffectedVariant,
  type ConsumerAction,
  type ConsumerDistribution,
  type ConsumerPackageCheck,
  type LotCodeSet,
} from './consumer-projection';
import { PACKAGE_FIELD_LABEL, type PackageField, type PackageFieldKey } from './consumer-schema';
import {
  companyDisplayName,
  extractAttachmentLinks,
  humanizeAllCaps,
  productDisplayName,
  type OfficialAttachment,
} from './consumer-summary';
import type { CodeLocation } from './fact-types';
import type { ProductPhoto } from './product-photos';
import type { CaseDetail, FeedItem } from './recall-feed';
import { allergenReasonLabel, healthRiskSummary, stateLabel } from './recall-display';
import { interpretReason } from './recall-reason';
import { agencyLabel, riskView, type RiskView } from './risk-display';
import { measurementOnlyName } from './variant-identity';
import { buildWhatHappened } from './what-happened';

// ── Activity date ───────────────────────────────────────────────────────────

/**
 * Today's calendar date where the user is, as YYYY-MM-DD. The one impure
 * seam: screens call this once and pass the result in, so every mapping
 * below stays pure and the tests inject a fixed date.
 */
export function todayIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The calendar day before an ISO day, computed in UTC so no timezone shifts it. */
function previousDay(iso: string): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Day-precision consumer date: "Today", "Yesterday", "Aug 29", or
 * "Aug 29, 2025" when the year differs from today's. Source dates are
 * day-precision at both agencies, so nothing here can ever claim hour-level
 * recency ("2 hours ago" is unknowable and is never produced).
 */
export function formatActivityDate(dateIso: string, today: string): string {
  const day = dateIso.slice(0, 10);
  if (day === today) return 'Today';
  if (day === previousDay(today)) return 'Yesterday';
  const match = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateIso;
  const [, year, month, dayOfMonth] = match;
  const base = `${MONTHS[Number(month) - 1]} ${Number(dayOfMonth)}`;
  return year === today.slice(0, 4) ? base : `${base}, ${year}`;
}

export interface ActivityDisplay {
  /** Exactly one label. `updated` only when a MATERIAL event postdates the announcement. */
  kind: 'announced' | 'updated';
  /** The day being reported (YYYY-MM-DD). */
  dateIso: string;
  /** "Announced Today" / "Updated Aug 29" / "Announced Aug 29, 2025". */
  text: string;
}

/**
 * The one activity line. "Updated" is earned only by the material-change
 * ledger (domain/material-activity.ts) — an agency wording edit or our own
 * maintenance write can never produce it.
 */
export function activityDisplay(
  publishedAt: string,
  timeline: readonly TimelineEntry[] | null | undefined,
  today: string,
): ActivityDisplay {
  const updated = hasMaterialUpdate(publishedAt, timeline);
  const dateIso = updated ? materialActivityAt(publishedAt, timeline) : publishedAt.slice(0, 10);
  return {
    kind: updated ? 'updated' : 'announced',
    dateIso,
    text: `${updated ? 'Updated' : 'Announced'} ${formatActivityDate(dateIso, today)}`,
  };
}

// ── Brand ───────────────────────────────────────────────────────────────────

export interface BrandDisplay {
  /** The one brand/company line under the product name. */
  text: string;
  /** The consumer brands actually displayed (empty on company fallback). */
  brands: string[];
  /** True when `text` is built from consumer brands rather than the company. */
  usedBrand: boolean;
}

/**
 * A stored "brand" value that names no brand ("various", "and Others",
 * "unbranded", "No Brand Name", "Multiple brand names"). Never displayed,
 * never used for name deduplication, and never a sentence subject.
 */
const JUNK_BRAND =
  /^(?:and\s+)?(?:various|multiple|assorted|others?|unbranded|n\/?a|none|unknown|(?:no|multiple|various|all)\s+brand(?:\s+names?)?s?)\.?$/i;

/**
 * One stored brands entry can itself be a source-written list ("Dole, Ahold,
 * Kroger, Lidl, and Others"). Comma-separated entries expand into their
 * segments so the multi-brand compaction sees real brands; entries without a
 * comma stay whole — "and" is part of many brand names and is never split on.
 */
function expandBrandEntry(entry: string): string[] {
  if (!entry.includes(', ')) return [entry];
  return entry.split(/,\s*/).map((segment) => segment.replace(/^and\s+/i, ''));
}

/**
 * The consumer brand leads; the legal company is only a fallback. A known
 * brand is never replaced by its parent company merely because the product
 * name repeats the brand, and a genuinely multi-brand recall reads as the
 * first two known brands plus "+N" — never an invented "Multiple brands".
 */
export function displayBrand(
  brands: string[] | undefined,
  firmName: string | null,
  title: string,
): BrandDisplay {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const entry of (brands ?? []).flatMap(expandBrandEntry)) {
    const trimmed = entry.trim();
    const key = trimmed.toLowerCase();
    if (trimmed.length < 2 || JUNK_BRAND.test(trimmed) || seen.has(key)) continue;
    seen.add(key);
    cleaned.push(trimmed);
  }
  if (cleaned.length > 0) {
    const text =
      cleaned.length <= 2
        ? cleaned.join(', ')
        : `${cleaned[0]}, ${cleaned[1]} +${cleaned.length - 2}`;
    return { text, brands: cleaned, usedBrand: true };
  }
  const company = companyDisplayName(firmName);
  if (company) return { text: company, brands: [], usedBrand: false };
  return {
    text: /\b(various|multiple|several)\b/i.test(title)
      ? 'Multiple products and brands'
      : 'Company not specified',
    brands: [],
    usedBrand: false,
  };
}

/**
 * The one presentation-level identity decision (P2a). Three roles, decided in
 * one place so no surface improvises its own:
 *
 *  - `brand` — the brand-first display line both screens show under the name.
 *  - `legalFirm` — the recalling company, preserved for official traceability
 *    (share copy, provenance); never substituted into consumer prose merely
 *    because it issued the notice.
 *  - `whatHappenedSubject` — the subject of "X recalled Y": the ONE reliable
 *    consumer brand when exactly one is displayed. Null otherwise, letting
 *    What Happened fall back to the company — for a genuinely multi-brand
 *    recall the recalling firm, not any single brand, is the accurate actor,
 *    and a subject is never invented.
 */
export interface CaseIdentity {
  brand: BrandDisplay;
  legalFirm: string | null;
  whatHappenedSubject: string | null;
}

/**
 * A sentence subject must read as a NAME. Stored brand entries occasionally
 * carry source prose ("Crazy Fresh and Quick & Easy an Unbranded and
 * Bountiful Fresh gift baskets"); a length cap keeps prose out of "X recalled
 * Y" while every genuine brand name passes.
 */
const MAX_SUBJECT_LENGTH = 40;

export function caseIdentity(
  brands: string[] | undefined,
  firmName: string | null,
  title: string,
): CaseIdentity {
  const brand = displayBrand(brands, firmName, title);
  const single = brand.usedBrand && brand.brands.length === 1 ? brand.brands[0] : null;
  return {
    brand,
    legalFirm: companyDisplayName(firmName),
    whatHappenedSubject: single !== null && single.length <= MAX_SUBJECT_LENGTH ? single : null,
  };
}

// ── Product name ────────────────────────────────────────────────────────────

/**
 * A trailing package measurement ("… 7 oz", "… 150g", "… 2.5 lb"). Only ever
 * removed under the evidence rule in `stripTrailingMeasurement`.
 */
const TRAILING_MEASUREMENT =
  /[\s,;:–—-]*\(?\d+(?:[.,]\d+)?\s*(?:fl\.?\s?oz|oz|ounces?|lbs?|pounds?|grams?|g|kg|mg|ml|liters?|litres?|l|ct|count|pks?|packs?)\b\.?\)?$/i;

/** Case/spacing/punctuation-insensitive containment key for measurement text. */
function measurementKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Conservatively drop a trailing package measurement from a product name —
 * but only when (a) a meaningful name remains and (b) the removed measurement
 * is preserved in the supported affected-product/package evidence, so the
 * information is not lost. Anything else keeps the official wording.
 */
export function stripTrailingMeasurement(name: string, packageEvidence: string[]): string {
  const match = name.match(TRAILING_MEASUREMENT);
  if (!match || match.index === undefined) return name;
  const remainder = name
    .slice(0, match.index)
    .replace(/[\s,;:–—-]+$/, '')
    .trim();
  if (remainder.length < 3 || !/[A-Za-z]/.test(remainder)) return name;
  const removed = measurementKey(match[0]);
  if (removed === '') return name;
  const preserved = packageEvidence.some((line) => measurementKey(line).includes(removed));
  return preserved ? remainder : name;
}

/**
 * Drop a duplicated displayed-brand prefix from the product name when safe
 * ("Kirkland Signature Almond Butter" under a "Kirkland Signature" brand line
 * → "Almond Butter"); otherwise tolerate the repetition.
 */
function stripBrandPrefix(name: string, displayedBrands: string[]): string {
  for (const brand of displayedBrands) {
    if (brand.length < 2) continue;
    if (!name.toLowerCase().startsWith(brand.toLowerCase())) continue;
    const rest = name.slice(brand.length);
    // Only a whole-word prefix qualifies ("Great" never claims "Great Value").
    if (!/^[\s,:;–—-]/.test(rest)) continue;
    const remainder = rest.replace(/^[\s,:;–—-]+/, '').trim();
    // "VidaSlim Brand 90-day…" must not become "Brand 90-day…" — a remainder
    // that opens with the word "Brand" was naming the brand, not a product.
    if (/^brands?\b/i.test(remainder)) continue;
    if (remainder.length >= 3 && /[A-Za-z]/.test(remainder)) return remainder;
  }
  return name;
}

export interface ProductNameInput {
  title: string;
  productDescription: string | null;
  /** Displayed consumer brands, for safe brand-prefix deduplication. */
  displayedBrands: string[];
  /** Affected-product lines — the evidence a removed measurement must survive in. */
  packageEvidence: string[];
}

/**
 * The one cleaned consumer product name Home and Detail share. Derived from
 * the same canonical inputs on both screens, so they cannot disagree; the
 * stored title is never mutated and titles are never generatively rewritten.
 */
export function cleanProductName(input: ProductNameInput): string {
  let name = productDisplayName(input.productDescription, input.title);
  name = stripTrailingMeasurement(name, input.packageEvidence);
  name = stripBrandPrefix(name, input.displayedBrands);
  return humanizeAllCaps(name);
}

// ── Concise reason line (Home) ──────────────────────────────────────────────

/**
 * Consumer display names for the most common pathogens ("Salmonella
 * Enteritidis" → "Salmonella"). A fixed table only; an unlisted agent is
 * preserved verbatim rather than shortened by guesswork.
 */
const PATHOGEN_DISPLAY: [RegExp, string][] = [
  [/salmonella/i, 'Salmonella'],
  [/listeria/i, 'Listeria'],
  [/\be\.?\s?coli\b|\bstec\b/i, 'E. coli'],
];

function pathogenDisplayName(pathogen: string): string {
  for (const [pattern, display] of PATHOGEN_DISPLAY) {
    if (pattern.test(pathogen)) return display;
  }
  return pathogen.trim();
}

function sentenceOf(fragment: string): string {
  const trimmed = fragment.trim().replace(/[.\s]+$/, '');
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}.`;
}

export interface ReasonInput {
  reasonText: string | null;
  hazardCategory: string;
  pathogenOrAllergen: string | null;
}

/**
 * One concise, deterministic reason sentence for Home cards, rendered from
 * the SAME typed-reason interpretation Detail's What Happened clause uses
 * (lib/recall-reason.ts) — the two surfaces can never disagree about a
 * recall's reason family. "Potential", never "Possible", for the approved
 * pathogen pattern; allergen lines name only source-supported allergens;
 * contamination, allergen, mislabeling, and foreign-material distinctions
 * are preserved.
 *
 * Fallback (documented): when only free source text applies, a short cleaned
 * verbatim source reason (≤ 60 chars) is used as its own sentence; otherwise
 * the line is omitted entirely. A concise reason is never composed from
 * prose fragments.
 */
export function conciseReasonLine(input: ReasonInput): string | null {
  const typed = interpretReason({
    reasonText: input.reasonText,
    hazardCategory: input.hazardCategory,
    pathogenOrAllergen: input.pathogenOrAllergen,
  });
  switch (typed.family) {
    case 'pathogen':
      return typed.pathogen
        ? `Potential ${pathogenDisplayName(typed.pathogen)} contamination.`
        : 'Potential contamination.';
    case 'allergen':
      return `${allergenReasonLabel(input.pathogenOrAllergen)}.`;
    case 'foreign_material':
      return typed.material
        ? `Potential ${typed.material} contamination.`
        : 'Potential foreign material contamination.';
    case 'chemical': {
      const agent = typed.agent && !/^undeclared/i.test(typed.agent) ? typed.agent : null;
      return agent
        ? `Potential ${pathogenDisplayName(agent)} contamination.`
        : 'Potential chemical contamination.';
    }
    case 'inspection':
      return 'Produced without required inspection.';
    case 'import':
      return 'Import violation.';
    case 'unfit':
      return 'May be unfit to eat.';
    case 'insanitary':
      return 'Made under insanitary conditions.';
    case 'processing':
      return 'Processing defect.';
    case 'mislabeled':
      return typed.word === 'mislabeled' ? 'Mislabeled product.' : 'Misbranded product.';
    case 'nutrition':
      return 'Does not meet infant formula nutrition requirements.';
    case 'unapproved':
    case 'contents':
    case 'verbatim':
    case 'unknown': {
      // The source's own short reason as a standalone sentence — safe here
      // even when it could not glue onto "because of" grammatically.
      const verbatim = (input.reasonText ?? '').replace(/^due to\s+/i, '').trim();
      if (verbatim.length >= 3 && verbatim.length <= 60) return sentenceOf(verbatim);
      if (typed.family === 'unapproved') {
        return `Contains ${typed.ingredient} not approved for ${typed.use}.`;
      }
      if (typed.family === 'contents') return `Contains ${typed.contents}.`;
      // A stated microbial hazard still earns its honest generic line when
      // the source's own wording is too long for a card.
      if (input.hazardCategory === 'microbial_contamination') return 'Potential contamination.';
      return null;
    }
  }
}

// ── Illness line ────────────────────────────────────────────────────────────

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

/**
 * Counted-illness patterns. Deliberately narrow: a number qualifies only when
 * it directly counts illnesses or sick people — hospitalization and death
 * counts never fold in, and "27 states" or "120 cases (packages)" never match.
 */
const COUNTED_ILLNESS = [
  /\b(\d{1,4}(?:,\d{3})?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b\s+(?:confirmed\s+|reported\s+)?(?:illness(?:es)?|case-patients?)\b/gi,
  /\b(\d{1,4}(?:,\d{3})?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b\s+(?:sick(?:ened)?\s+)?(?:people|persons?|individuals?)\b[^.]{0,80}?\b(?:infected|sickened|ill\b|illness)/gi,
];

function countedIllnesses(statements: string[]): number | null {
  const counts = new Set<number>();
  for (const statement of statements) {
    for (const pattern of COUNTED_ILLNESS) {
      for (const match of statement.matchAll(pattern)) {
        const raw = match[1].toLowerCase();
        const value = NUMBER_WORDS[raw] ?? Number(raw.replace(/,/g, ''));
        if (Number.isFinite(value) && value > 0) counts.add(value);
      }
    }
  }
  // One unambiguous count or nothing — two different numbers cannot be summed
  // or chosen between without inventing a figure the source never stated.
  return counts.size === 1 ? [...counts][0] : null;
}

/**
 * A negated report statement ("No customer illnesses have been reported…")
 * that slipped past the domain classifier's explicit-zero patterns. The
 * presentation boundary must never turn a negation into a positive report,
 * so the guard is enforced here as well — display-only; the canonical
 * classifier and stored `reportsIllness` derivations are untouched.
 * "No other/additional/further" qualifiers imply a prior report and are
 * deliberately NOT treated as zero.
 */
const NEGATED_REPORT =
  /\bno\b[^.]{0,80}\b(?:illness(?:es)?|adverse reactions?|allergic reactions?|injur(?:y|ies)|sickness(?:es)?)\b[^.]{0,80}\b(?:reported|received|confirmed|associated)/i;

function isNegatedReport(statement: string): boolean {
  if (/\bno (?:other|additional|further)\b/i.test(statement)) return false;
  return NEGATED_REPORT.test(statement);
}

/**
 * The four honest illness states. Explicit zero → "No illnesses reported.";
 * a reliably counted report → "N illness(es) reported."; reported without a
 * reliable count → "Illnesses have been reported."; source silence → null
 * (the line is omitted — silence is never converted to zero).
 */
export function illnessLine(report: IllnessReport): string | null {
  switch (report.status) {
    case 'none_reported':
      return 'No illnesses reported.';
    case 'reported': {
      const positive = report.statements.filter((statement) => !isNegatedReport(statement));
      if (positive.length === 0 && report.statements.length > 0) return 'No illnesses reported.';
      const count = countedIllnesses(positive);
      if (count === null) return 'Illnesses have been reported.';
      return count === 1 ? '1 illness reported.' : `${count} illnesses reported.`;
    }
    case 'unknown':
      return null;
  }
}

// ── Geography ───────────────────────────────────────────────────────────────

/**
 * Compact Home location: one or two state abbreviations, "+N" beyond that,
 * "Nationwide", or an honest unspecified line. States arrive from the
 * canonical tri-state geography — exclusions (containment artifacts,
 * firm-address noise) are applied by that derivation before display, and
 * nothing here re-adds a state it removed.
 */
export function homeLocationSummary(geography: Geography): string {
  if (geography.scope === 'nationwide') return 'Nationwide';
  if (geography.scope !== 'states' || geography.states.length === 0) {
    return 'Distribution not specified';
  }
  const codes = geography.states.map((name) => STATE_TO_POSTAL[name] ?? name);
  if (codes.length <= 2) return codes.join(', ');
  return `${codes[0]}, ${codes[1]} +${codes.length - 2}`;
}

export interface WhereSoldModel {
  /** The ONE rendered representation of where the recall reached (P2a
   * founder decision): the complete full-name state list, "Nationwide", a
   * stated metro phrase, or the honest unspecified statement — no trailing
   * period, never a bare count beside the list, and the only thing the
   * Where-it-was-sold section renders at this stage. */
  lead: string;
  /** Complete full-name state list (empty when not state-scoped). Preserved
   * for matching/traceability; the rendered representation is `lead`. */
  states: string[];
  /** Source-stated retailers, preserved in full for the model. */
  retailers: string[];
  retailerCount: number;
  /** Simple noninteractive retailer summary — no retailer-list disclosure
   * exists yet, so a plain sentence stands in ("Sold at X, Y, and 3 more"). */
  retailerSummary: string | null;
  /** Specific store addresses the source lists, behind their own disclosure. */
  retailLocations: string[];
  onlinePlatforms: string[];
  /** Every approved channel the source stated, preserved for traceability. */
  channels: string[];
  /** The channels consumers can actually recognize as a place they shopped
   * (farmers markets, convenience stores…). Trade/distribution channels
   * (wholesalers, distributors, independent retailers, food service) stay in
   * `channels` but are never rendered as if they were stores. */
  venueChannels: string[];
}

const RETAILERS_SUMMARIZED = 3;

/**
 * Trade/distribution channels: routes a shopper cannot identify a purchase
 * against. "Also sold through wholesalers, distributors." answers no consumer
 * question — the evidence stays in the model, off the screen.
 */
const TRADE_CHANNELS = new Set([
  'wholesalers',
  'distributors',
  'independent retailers',
  'food service',
]);

function joinNames(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

/**
 * The consumer "Where it was sold" model. The separate AREAS block is gone:
 * a clearly identified metro/city already contributes its state to the
 * canonical/display geography derivation when the source states one, and the
 * underlying area data stays preserved in `ConsumerDistribution` for matching
 * and traceability.
 *
 * States render exactly once (P2a founder decision): a state-scoped recall
 * leads with the complete full-name list — never a "13 states." count, and
 * never a second copy of the same list. Leads carry no trailing period.
 */
export function whereSoldModel(distribution: ConsumerDistribution): WhereSoldModel {
  const states = distribution.scopeType === 'states' ? distribution.states : [];
  const lead = states.length > 0 ? joinNames(states) : distribution.areaText.replace(/\.$/, '');
  const shown = distribution.retailers.slice(0, RETAILERS_SUMMARIZED);
  const hidden = distribution.retailers.length - shown.length;
  const retailerSummary =
    distribution.retailers.length === 0
      ? null
      : hidden > 0
        ? `Sold at ${shown.join(', ')}, and ${hidden} more ${hidden === 1 ? 'retailer' : 'retailers'}.`
        : `Sold at ${joinNames(shown)}.`;
  return {
    lead,
    states,
    retailers: distribution.retailers,
    retailerCount: distribution.retailers.length,
    retailerSummary,
    retailLocations: distribution.retailLocations,
    onlinePlatforms: distribution.onlinePlatforms,
    channels: distribution.channels,
    venueChannels: distribution.channels.filter((channel) => !TRADE_CHANNELS.has(channel)),
  };
}

// ── Official source ─────────────────────────────────────────────────────────

export interface OfficialSourceLink {
  url: string;
  /** "View the official FDA report" / "…FSIS report" / "…FSIS alert". */
  label: string;
}

export function officialSourceLink(
  sourceAgency: SourceAgency,
  noticeType: NoticeType,
  url: string,
): OfficialSourceLink {
  const document = noticeType === 'public_health_alert' ? 'alert' : 'report';
  return { url, label: `View the official ${sourceAgency} ${document}` };
}

/** The explicit notice label. Only PHAs carry one — a recall's primary label is its risk. */
export function noticeLabel(noticeType: NoticeType): string | null {
  return noticeType === 'public_health_alert' ? 'Public Health Alert' : null;
}

// ── Affected products ───────────────────────────────────────────────────────

export interface AffectedProductField {
  key: PackageFieldKey;
  label: string;
  value: string;
}

export interface AffectedProductItem {
  /** Recognizable product/version name (the cleaned product name when the
   * notice describes a single product). Null when the gated projection's
   * version name was only a package measurement — that value renders in the
   * Package Size field, never as Product, and no product name is invented. */
  name: string | null;
  /** Populated approved fields only, in the stable presentation order. */
  fields: AffectedProductField[];
  /** This item's own collapsed code set, when the source lists one. */
  codes: LotCodeSet | null;
  codeLocation: CodeLocation | null;
  photo: ProductPhoto | null;
}

export type AffectedProductsCoverage = 'structured' | 'partial' | 'source_silent' | 'unstructured';

export interface AffectedProductsModel {
  /** structured — identifying details below, with the confident scope claim;
   * partial — package evidence renders (packaging/size only) under
   * conservative wording that never claims complete coverage; source_silent —
   * the notice provides no package identifiers; unstructured — evidence
   * exists but could not be structured safely (never presented as source
   * silence). */
  coverage: AffectedProductsCoverage;
  /** What "matching" means for this recall (structured coverage only). */
  scopeStatement: string | null;
  /** The honest statement for the two identifier-less states. */
  note: string | null;
  /** Fields proven to apply to every affected version, shown once. */
  appliesToAll: AffectedProductField[];
  items: AffectedProductItem[];
  /** Recall-level collapsed code sets and production-date disclosure. */
  caseCodes: LotCodeSet | null;
  productionCodes: LotCodeSet | null;
  productionDates: string | null;
  codeLocation: CodeLocation | null;
  comparePhotos: ProductPhoto[];
}

/**
 * Stable presentation order (frozen): Package Size, then the identifying
 * dates under their source-specific labels, then Barcode (UPC), then
 * lot/batch codes, then remaining package description. Fields the gated P0A
 * projection does not support (e.g. establishment numbers) cannot appear —
 * the closed schema is never bypassed here.
 */
const PRESENTATION_FIELD_ORDER: PackageFieldKey[] = [
  'size',
  'bestBy',
  'useBy',
  'sellBy',
  'expiration',
  'upc',
  'lotCodes',
  'batchCodes',
  'packaging',
];

function orderedFields(fields: PackageField[]): AffectedProductField[] {
  return [...fields]
    .filter((field) => field.value.trim() !== '')
    .sort(
      (a, b) => PRESENTATION_FIELD_ORDER.indexOf(a.key) - PRESENTATION_FIELD_ORDER.indexOf(b.key),
    )
    .map((field) => ({ key: field.key, label: field.label, value: field.value }));
}

function variantItem(variant: AffectedVariant): AffectedProductItem {
  // A version name that is ONLY a package measurement (identity contract:
  // measurementOnlyName) is package-size evidence, not a product name. It is
  // demoted into the card's Size field — verbatim, so the source evidence is
  // preserved — and the card renders without a Product line rather than with
  // a measurement masquerading as one. No product name is invented.
  if (measurementOnlyName(variant.name)) {
    const fields = orderedFields(variant.fields);
    const size = fields.find((field) => field.key === 'size');
    if (size === undefined) {
      // Size leads the presentation order, so the demoted value goes first.
      fields.unshift({ key: 'size', label: PACKAGE_FIELD_LABEL.size, value: variant.name });
    } else if (!measurementKey(size.value).includes(measurementKey(variant.name))) {
      size.value = `${size.value}, ${variant.name}`;
    }
    return {
      name: null,
      fields,
      codes: variant.lotCodes,
      codeLocation: variant.codeLocation,
      photo: variant.photo,
    };
  }
  return {
    name: humanizeAllCaps(variant.name),
    fields: orderedFields(variant.fields),
    codes: variant.lotCodes,
    codeLocation: variant.codeLocation,
    photo: variant.photo,
  };
}

/**
 * The Affected Products presentation model, consuming ONLY the gated P0A
 * consumer projection: variant fields, shared fields, and case fields that
 * survived the closed schema and its type gates. Rejected facts (including
 * internal artifacts such as a "40 lb" package size proposed as a lot code)
 * are structurally unreachable — this mapping never reads
 * `packageCheck.rejected`.
 */
export function affectedProductsModel(
  packageCheck: ConsumerPackageCheck,
  productName: string,
): AffectedProductsModel {
  if (packageCheck.render) {
    // Variant mode keeps proven-shared fields in their own block; without
    // variants, case-level and shared fields merge into one product item so
    // no field renders loosely outside a card.
    const hasVariants = packageCheck.variants.length > 0;
    const caseFields = orderedFields([...packageCheck.fields, ...packageCheck.sharedFields]);
    const items = hasVariants
      ? packageCheck.variants.map(variantItem)
      : caseFields.length > 0
        ? [
            {
              name: productName,
              fields: caseFields,
              codes: null,
              codeLocation: null,
              photo: null,
            },
          ]
        : [];
    return {
      coverage: packageCheck.coverage === 'partial' ? 'partial' : 'structured',
      scopeStatement: packageCheck.scopeStatement,
      note: null,
      appliesToAll: hasVariants ? orderedFields(packageCheck.sharedFields) : [],
      items,
      caseCodes: packageCheck.lotCodes,
      productionCodes: packageCheck.productionCodes,
      productionDates: packageCheck.productionDates,
      codeLocation: packageCheck.codeLocation,
      comparePhotos: packageCheck.photos,
    };
  }
  // Nothing renderable survived. Distinguish honest source silence from
  // evidence we could not structure — a parser miss must never be presented
  // as the official source having said nothing.
  const silent = packageCheck.coverage === 'source_silent';
  return {
    coverage: silent ? 'source_silent' : 'unstructured',
    scopeStatement: null,
    note: silent
      ? 'The official notice does not provide package-specific identifiers.'
      : 'This notice describes package details that can’t be shown reliably here yet. Check the official notice for the exact identifiers.',
    appliesToAll: [],
    items: [],
    caseCodes: null,
    productionCodes: null,
    productionDates: null,
    codeLocation: null,
    comparePhotos: [],
  };
}

// ── Quantity ────────────────────────────────────────────────────────────────

/**
 * The complete authoritative recall quantity as one sentence, or null. FDA
 * only: the FSIS `quantityText` field is the amount RECOVERED — a different
 * fact — and is deliberately not shown (standing decision). Omitted when the
 * What Happened prose already carries the same figure, and never truncated.
 */
export function quantityLine(
  sourceAgency: SourceAgency,
  quantityText: string | null,
  whatHappenedText: string,
): string | null {
  if (sourceAgency !== 'FDA' || !quantityText) return null;
  // Some stored quantity spans carry a clipped reason tail ("…Recipe Kit on
  // the recommendation of the Fo"). The quantity itself — amount, unit, and
  // product — is preserved complete; only the non-quantity clause is dropped.
  let text = quantityText.trim();
  // "becau" and friends: the stored span can clip the connective itself.
  const tail = text.search(
    /\s+(?:because|becaus|becau|due to|after|following|on the recommendation)\b/i,
  );
  if (tail > 0) text = text.slice(0, tail);
  text = text.replace(/[\s,;:.]+$/, '');
  if (text === '') return null;
  const figure = text.match(/[\d,]+/)?.[0];
  if (figure && whatHappenedText.includes(figure)) return null;
  return `The recall covers ${text}.`;
}

// ── Home card model ─────────────────────────────────────────────────────────

export interface HomeCardModel {
  /** Stable recall identity — the same id Detail loads. */
  id: string;
  /** 'Public Health Alert' for PHAs; null for recalls (risk is their label). */
  noticeLabel: string | null;
  risk: RiskView;
  activity: ActivityDisplay;
  affectsYou: boolean;
  productName: string;
  brand: BrandDisplay;
  reasonLine: string | null;
  heroImageUrl: string | null;
  locationSummary: string;
}

export interface HomeCardContext {
  /** Injected calendar date (YYYY-MM-DD) — see `todayIso`. */
  today: string;
  /** Whether saved preferences establish a match (lib/relevance.ts verdict). */
  affectsYou: boolean;
}

export function buildHomeCardModel(item: FeedItem, context: HomeCardContext): HomeCardModel {
  const { brand } = caseIdentity(item.brands, item.firmName, item.title);
  return {
    id: item.id,
    noticeLabel: noticeLabel(item.noticeType),
    risk: riskView(item.classification, item.sourceAgency),
    activity: activityDisplay(item.publishedAt, item.timeline, context.today),
    affectsYou: context.affectsYou,
    productName: cleanProductName({
      title: item.title,
      productDescription: item.productDescription,
      displayedBrands: brand.brands,
      packageEvidence: item.productNames,
    }),
    brand,
    reasonLine: conciseReasonLine({
      reasonText: item.reasonText,
      hazardCategory: item.hazardCategory,
      pathogenOrAllergen: item.pathogenOrAllergen,
    }),
    heroImageUrl: item.heroImageUrl,
    locationSummary: homeLocationSummary(item.geography),
  };
}

// ── Detail model ────────────────────────────────────────────────────────────

export interface DetailModel {
  id: string;
  /** 'Recall' / 'Public Health Alert' — always explicit on Detail. */
  noticeTypeLabel: string;
  /** 'Active' / 'Closed by agency (2024)' / 'Retracted'. */
  lifecycleLabel: string;
  retracted: boolean;
  risk: RiskView;
  activity: ActivityDisplay;
  productName: string;
  brand: BrandDisplay;
  officialSource: OfficialSourceLink;
  /** The SAME selected hero image Home shows; null renders nothing. */
  heroImageUrl: string | null;
  affectsYou: boolean;
  /** The generic approved banner text, shown iff `affectsYou`. */
  affectsYouBanner: string;
  whatHappened: { text: string; update: string | null };
  illnessLine: string | null;
  quantityLine: string | null;
  whereSold: WhereSoldModel;
  affectedProducts: AffectedProductsModel;
  /** Existing source-supported content preserved below the standardized sections. */
  action: ConsumerAction;
  healthRisk: string | null;
  attachments: OfficialAttachment[];
  /** Remaining official imagery (gallery + label renders), hero deduplicated. */
  galleryPhotos: ProductPhoto[];
  /** The exact official headline, when the cleaned name differs. */
  officialTitle: string | null;
  /** 'FDA' / 'USDA FSIS' for provenance/share copy. */
  agencyLabel: string;
  sourceOrganization: string;
}

export interface DetailContext {
  today: string;
  affectsYou: boolean;
}

function lifecycleLabel(projection: CaseProjection): string {
  const base = stateLabel(projection.state);
  return projection.state === 'closed' && projection.closedYear
    ? `${base} (${projection.closedYear})`
    : base;
}

export function buildDetailModel(detail: CaseDetail, context: DetailContext): DetailModel {
  const { projection, affectedProducts } = detail;
  const consumer = buildConsumerCase(projection, affectedProducts);
  const identity = caseIdentity(
    projection.brands ?? [],
    projection.recallingFirm.displayName,
    projection.title,
  );
  const brand = identity.brand;
  const productName = cleanProductName({
    title: projection.title,
    productDescription: projection.productDescription ?? null,
    displayedBrands: brand.brands,
    packageEvidence: affectedProducts.map((product) => product.name),
  });
  const happened = buildWhatHappened({
    title: projection.title,
    noticeType: projection.noticeType,
    reasonText: projection.reasonText,
    hazardCategory: projection.hazardCategory,
    pathogenOrAllergen: projection.pathogenOrAllergen,
    firmDisplayName: projection.recallingFirm.displayName,
    summaryText: projection.summaryText,
    productDescription: projection.productDescription ?? null,
    consumerBrand: identity.whatHappenedSubject,
  });

  // Official label renders join the photo evidence exactly as before.
  const labelVisuals: ProductPhoto[] = detail.visuals.map((visual, index) => ({
    url: visual.url,
    alt: 'Official product label',
    order: consumer.photos.length + index,
    role: visual.role as ProductPhoto['role'],
    width: visual.width,
    height: visual.height,
    aspectRatio:
      visual.width !== null && visual.height !== null && visual.height > 0
        ? visual.width / visual.height
        : null,
  }));
  const heroImageUrl = projection.heroImageUrl ?? null;
  const galleryPhotos = [...consumer.photos, ...labelVisuals].filter(
    (photo) => photo.url !== heroImageUrl,
  );

  return {
    id: detail.id,
    noticeTypeLabel:
      projection.noticeType === 'public_health_alert' ? 'Public Health Alert' : 'Recall',
    lifecycleLabel: lifecycleLabel(projection),
    retracted: projection.state === 'retracted',
    risk: riskView(projection.classification, projection.sourceAgency),
    activity: activityDisplay(projection.publishedAt, detail.timeline, context.today),
    productName,
    brand,
    officialSource: officialSourceLink(
      projection.sourceAgency,
      projection.noticeType,
      projection.officialUrl,
    ),
    heroImageUrl,
    affectsYou: context.affectsYou,
    affectsYouBanner: 'Warning: This recall affects you.',
    whatHappened: { text: happened.text, update: happened.update },
    illnessLine: illnessLine(classifyIllnessReport(projection.summaryText)),
    quantityLine: quantityLine(projection.sourceAgency, consumer.quantityText, happened.text),
    whereSold: whereSoldModel(consumer.distribution),
    affectedProducts: affectedProductsModel(consumer.packageCheck, productName),
    action: consumer.action,
    healthRisk: healthRiskSummary(
      projection.hazardCategory,
      projection.pathogenOrAllergen,
      projection.reasonText,
    ),
    attachments: extractAttachmentLinks(projection.summaryHtml),
    galleryPhotos,
    officialTitle: productName !== projection.title ? projection.title : null,
    agencyLabel: agencyLabel(projection.sourceAgency),
    sourceOrganization:
      projection.sourceAgency === 'FSIS'
        ? 'U.S. Department of Agriculture'
        : 'U.S. Food and Drug Administration',
  };
}
