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
  capitalizeLeadingWord,
  companyDisplayName,
  displayHeadlineCase,
  extractAttachmentLinks,
  humanizeAllCaps,
  productDisplayName,
  type OfficialAttachment,
} from './consumer-summary';
import type { CodeLocation } from './fact-types';
import type { ProductPhoto } from './product-photos';
import {
  allocateRecallImages,
  type RecallImageAllocation,
  type RowImageAssignment,
  type RowImageCandidate,
} from './recall-images';
import type { CaseDetail, FeedItem } from './recall-feed';
import { allergenReasonLabel, healthRiskSummary, stateLabel } from './recall-display';
import { interpretReason } from './recall-reason';
import { agencyLabel, riskView, type RiskView } from './risk-display';
import {
  measurementKey,
  measurementOnlyName,
  packagingOnlyName,
  splitTrailingMeasurements,
} from './variant-identity';
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
 * A displayed brand must be a plausible CONCISE identity — a name, not a
 * sentence, product enumeration, or recall description. Stored brand entries
 * occasionally carry source prose whole ("Crazy Fresh and Quick & Easy an
 * Unbranded and Bountiful Fresh gift baskets" — the recorded Russ Davis
 * class); the length cap is the same bound the What Happened subject already
 * uses, so the visible brand line and the sentence subject share one identity
 * contract. An over-long entry is never sliced into a fabricated brand — it
 * is skipped, another concise stored brand wins when one exists, and the safe
 * company fallback stands otherwise.
 */
const MAX_BRAND_IDENTITY_LENGTH = 40;

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
    if (trimmed.length < 2 || trimmed.length > MAX_BRAND_IDENTITY_LENGTH) continue;
    if (JUNK_BRAND.test(trimmed) || seen.has(key)) continue;
    seen.add(key);
    // Display casing only (P3D): a defectively lowercase brand opens with a
    // capital ("terrafina" → "Terrafina"); stylized identities ("a2") pass
    // untouched. The dedupe key above is case-insensitive, so identity and
    // deduplication are unaffected.
    cleaned.push(capitalizeLeadingWord(trimmed));
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
 * Conservatively drop a trailing package measurement — or a comma/and-joined
 * LIST of them ("… 500 ml, 250 ml, and 100 ml") — from a product name. Only
 * when (a) a meaningful name remains (`splitTrailingMeasurements` refuses
 * otherwise) and (b) EVERY removed measurement is preserved in the supported
 * affected-product/package evidence, so no information is lost. Anything else
 * keeps the official wording. No product-to-size pairing is ever invented —
 * the sizes move into package evidence, never onto a different product.
 */
export function stripTrailingMeasurement(name: string, packageEvidence: string[]): string {
  const split = splitTrailingMeasurements(name);
  if (!split) return name;
  const evidenceKeys = packageEvidence.map(measurementKey);
  const preserved = split.measurements.every((measurement) => {
    const key = measurementKey(measurement);
    return key !== '' && evidenceKeys.some((line) => line.includes(key));
  });
  return preserved ? split.base : name;
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
 *
 * A name derived from the STRUCTURED product description counts that
 * description's own trailing sizes as evidence: the consumer projection
 * deterministically preserves a description's trailing measurement list as
 * package-Size evidence (`buildPackageCheck`, the description-size guarantee),
 * so stripping it here moves the sizes into the Affected Products data rather
 * than losing them — and both screens apply the identical rule to the
 * identical field, so they cannot diverge. Title-derived names keep the
 * strict line-evidence gate.
 */
export function cleanProductName(input: ProductNameInput): string {
  let name = productDisplayName(input.productDescription, input.title);
  const described = (input.productDescription ?? '').replace(/[\s.]+$/, '').trim();
  const fromDescription = described.length >= 3 && name === described;
  const evidence = fromDescription
    ? [...input.packageEvidence, ...(splitTrailingMeasurements(name)?.measurements ?? [])]
    : input.packageEvidence;
  name = stripTrailingMeasurement(name, evidence);
  name = stripBrandPrefix(name, input.displayedBrands);
  // The one shared headline pipeline (P3D): ALL-CAPS is un-shouted, a
  // defectively lowercase headline is headline-cased, and an already-cased
  // name passes through untouched. Push copy uses the same composition.
  return displayHeadlineCase(name);
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
  /**
   * The official headline. Home carries it on every feed row already, and it
   * is where an announcement most often states its contaminant ("Due to
   * Possible Plastic Contaminant") — so passing it costs no egress and closes
   * the largest part of the Home/Detail specificity gap (P3A).
   */
  title: string | null;
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
    title: input.title,
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
  /** Stable identity of this affected version (the projection's source row
   * scope where one exists) — the anchor P2c's version-specific image
   * assignment will use. Never rendered as text. */
  rowId: string;
  /** Recognizable product/version name (the cleaned product name when the
   * notice describes a single product). Null when the gated projection's
   * version name was only a package measurement or only a packaging
   * description — those values render in the Package Size / Packaging fields,
   * never as Product, and no product name is invented. */
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
  /** Fields proven to apply to every affected version. Internal evidence
   * only: the table materializes these into every row — no separate
   * consumer-facing shared-facts block ever renders. */
  appliesToAll: AffectedProductField[];
  items: AffectedProductItem[];
  /**
   * Code sets the source states about the whole recalled population (P3C-2).
   * Internal evidence only, exactly like `appliesToAll`: the table repeats
   * each set into every row it applies to, and — when the notice supports no
   * named row at all — into one anonymous evidence row. There is no
   * consumer-facing code block beneath the table for these to render in.
   */
  sharedCodes: SharedCodeSet[];
  /** The readable calendar dates the shared production codes stand for. Same
   * treatment: a table cell in every applicable row, never a block. */
  sharedProductionDates: string | null;
  codeLocation: CodeLocation | null;
  comparePhotos: ProductPhoto[];
}

/**
 * One code set proven to apply to the whole recalled population, together
 * with the table column that owns it. The column is decided here, from the
 * set's own source concept, so a production code can never be relabelled as a
 * lot code to fit an existing column.
 */
export interface SharedCodeSet {
  key: 'lotCodes' | 'batchCodes' | 'productionCodes';
  codes: LotCodeSet;
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

function variantItem(variant: AffectedVariant, index: number): AffectedProductItem {
  const rowId = variant.scope ?? `v${index}`;
  // A source row that stated no product name at all (P3C-2) is already
  // nameless: its own facts render, its Product cell stays honestly empty,
  // and nothing is borrowed from the recall title to fill it.
  if (variant.name === null) {
    return {
      rowId,
      name: null,
      fields: orderedFields(variant.fields),
      codes: variant.lotCodes,
      codeLocation: variant.codeLocation,
      photo: variant.photo,
    };
  }
  const variantName = variant.name;
  // A version name that is ONLY a package measurement (identity contract:
  // measurementOnlyName) is package-size evidence, not a product name. It is
  // demoted into the row's Size field — verbatim, so the source evidence is
  // preserved — and the row renders without a Product value rather than with
  // a measurement masquerading as one. No product name is invented.
  if (measurementOnlyName(variantName)) {
    const fields = orderedFields(variant.fields);
    const size = fields.find((field) => field.key === 'size');
    if (size === undefined) {
      // Size leads the presentation order, so the demoted value goes first.
      fields.unshift({ key: 'size', label: PACKAGE_FIELD_LABEL.size, value: variantName });
    } else if (!measurementKey(size.value).includes(measurementKey(variantName))) {
      size.value = `${size.value}, ${variantName}`;
    }
    return {
      rowId,
      name: null,
      fields,
      codes: variant.lotCodes,
      codeLocation: variant.codeLocation,
      photo: variant.photo,
    };
  }
  // A version name that is ONLY a packaging description (identity contract:
  // packagingOnlyName — "Cardboard boxes", "Plastic bags") is packaging
  // evidence, never a consumer product name. Same demotion shape: the value
  // moves to the row's Packaging field, the row's own identifying facts
  // survive, and Product stays empty rather than showing a container.
  if (packagingOnlyName(variantName)) {
    const fields = orderedFields(variant.fields);
    const packaging = fields.find((field) => field.key === 'packaging');
    if (packaging === undefined) {
      // Packaging closes the presentation order, so the demoted value goes last.
      fields.push({
        key: 'packaging',
        label: PACKAGE_FIELD_LABEL.packaging,
        value: variantName,
      });
    } else if (!measurementKey(packaging.value).includes(measurementKey(variantName))) {
      packaging.value = `${packaging.value}, ${variantName}`;
    }
    return {
      rowId,
      name: null,
      fields,
      codes: variant.lotCodes,
      codeLocation: variant.codeLocation,
      photo: variant.photo,
    };
  }
  return {
    rowId,
    // Leading-word casing only (P3D founder decision): a row name is as often
    // package-description prose as a product headline, so headline mode never
    // applies here — "4-lb., or various weight packages…" keeps its source
    // casing (digit-leading first token), while a defectively lowercase
    // product-name row opens with a capital.
    name: capitalizeLeadingWord(humanizeAllCaps(variantName)),
    fields: orderedFields(variant.fields),
    codes: variant.lotCodes,
    codeLocation: variant.codeLocation,
    photo: variant.photo,
  };
}

/**
 * The recall-level code sets, each routed to the column its own source
 * concept owns. The projection has already proven these apply to the whole
 * recalled population — a set whose owner was ambiguous was rejected upstream
 * (`ambiguous-scope`) and is structurally unreachable here — so repeating
 * them into every row asserts nothing the source did not.
 */
function sharedCodeSets(packageCheck: ConsumerPackageCheck): SharedCodeSet[] {
  const sets: SharedCodeSet[] = [];
  if (packageCheck.lotCodes) {
    sets.push({ key: codeColumnKey(packageCheck.lotCodes), codes: packageCheck.lotCodes });
  }
  if (packageCheck.productionCodes) {
    sets.push({ key: 'productionCodes', codes: packageCheck.productionCodes });
  }
  return sets;
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
    // Variant mode keeps proven-shared fields distinguished internally; without
    // variants, case-level and shared fields merge into one product item so
    // no field renders loosely outside a card.
    const hasVariants = packageCheck.variants.length > 0;
    const caseFields = orderedFields([...packageCheck.fields, ...packageCheck.sharedFields]);
    const items = hasVariants
      ? packageCheck.variants.map(variantItem)
      : caseFields.length > 0
        ? [
            {
              rowId: 'case',
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
      sharedCodes: sharedCodeSets(packageCheck),
      sharedProductionDates: packageCheck.productionDates,
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
    sharedCodes: [],
    sharedProductionDates: null,
    codeLocation: null,
    comparePhotos: [],
  };
}

// ── Affected-products table (P2b) ───────────────────────────────────────────

/**
 * Column labels for the compact Affected Products table. Drawn from the same
 * closed field vocabulary as `PACKAGE_FIELD_LABEL` — no new consumer field can
 * enter through a column — with only the table-appropriate wording tweaks:
 * "Package Size" (a column names the whole dimension) and pluralized code
 * labels (one cell may hold several codes). Date labels keep their exact
 * source-specific meaning — a Sell by is never relabeled Expiration.
 */
const TABLE_COLUMN_LABEL: Record<AffectedProductsTableColumnKey, string> = {
  product: 'Product',
  size: 'Package Size',
  packaging: 'Packaging',
  bestBy: 'Best by',
  useBy: 'Use by',
  sellBy: 'Sell by',
  expiration: 'Expiration',
  productionDates: 'Production dates',
  upc: 'Barcode (UPC)',
  lotCodes: 'Lot codes',
  batchCodes: 'Batch codes',
  productionCodes: 'Production codes',
};

/**
 * Every column the table may render (P3C-2). It is the closed package-field
 * vocabulary plus Product, plus the two columns that give the retired
 * below-table disclosure's own values a home: the printed production codes
 * and the readable calendar dates they stand for. Both were already
 * consumer-visible and already gated by the projection — this moves where
 * they render, and opens no new extraction path.
 */
export type AffectedProductsTableColumnKey =
  'product' | PackageFieldKey | 'productionCodes' | 'productionDates';

/**
 * Column order (frozen, P3C-2 extension): Package Size, then the identifying
 * dates under their source-specific labels — production dates last among them,
 * because they describe when the package was made rather than a marking a
 * shopper reads off it — then Barcode (UPC), then the printed codes, then
 * remaining package description.
 */
const TABLE_COLUMN_ORDER: Exclude<AffectedProductsTableColumnKey, 'product'>[] = [
  'size',
  'bestBy',
  'useBy',
  'sellBy',
  'expiration',
  'productionDates',
  'upc',
  'lotCodes',
  'batchCodes',
  'productionCodes',
  'packaging',
];

export interface AffectedProductsTableColumn {
  key: AffectedProductsTableColumnKey;
  label: string;
}

export interface AffectedProductsTableCell {
  /** Plain value; null renders an EMPTY cell: a missing value is never a
   * dash, "unknown", or a value borrowed from another version. */
  text: string | null;
  /** This row's own collapsed code set, when it is too large to print
   * inline: renders as an in-cell control (`codesLabel`) that opens a modal
   * showing exactly this row's codes and its source-supported code/date
   * pairs — never a sibling row's. Null for plain cells. */
  codes: LotCodeSet | null;
  /** The in-cell control's text ("View 22 codes"); null for plain cells. */
  codesLabel: string | null;
}

export interface AffectedProductsTableRow {
  /** Stable row identity (the projection's source-row scope) for P2c. */
  id: string;
  /** This row's product name; null renders an empty Product cell, never a
   * placeholder — and never labels anything else as Product. */
  name: string | null;
  /** One cell per column, aligned with the owning view's `columns`. */
  cells: AffectedProductsTableCell[];
  /** The image the shared allocator confidently matched to this exact
   * version (P2c), rendered left of the Product value. Null renders nothing
   * — no placeholder, no reserved space. The screen never matches images
   * itself. */
  image: { url: string; accessibilityText: string } | null;
}

/** One rendering of the table: the columns justified by exactly the rows
 * this view shows, and those rows' cells aligned to them. */
export interface AffectedProductsTableViewModel {
  /** Header labels, rendered once as the uppermost row. A column exists only
   * when at least one row IN THIS VIEW has a supported value (or an in-cell
   * code set) for it — a column every visible row would leave empty never
   * renders. */
  columns: AffectedProductsTableColumn[];
  /** One affected version per row, in source order. */
  rows: AffectedProductsTableRow[];
}

export interface AffectedProductsTable {
  /** The initial rendering: the first `initialRows` rows, with columns
   * computed from exactly those rows. */
  collapsed: AffectedProductsTableViewModel;
  /** The full rendering after "See all": every row, columns recomputed over
   * all of them. Identical to `collapsed` when nothing is hidden. */
  expanded: AffectedProductsTableViewModel;
  /** How many rows render before the reveal control. */
  initialRows: number;
  /** "See all (N)" when more rows exist than initially render; null otherwise. */
  seeAllLabel: string | null;
}

/** At most this many affected-version rows render before "See all (N)". */
export const AFFECTED_PRODUCTS_INITIAL_ROWS = 3;

/** Which column a collapsed lot/batch code set belongs to, from the consumer
 * label the projection gave it — the word the source itself printed. */
function codeColumnKey(codes: LotCodeSet): 'lotCodes' | 'batchCodes' {
  return /batch/i.test(codes.label) ? 'batchCodes' : 'lotCodes';
}

/**
 * At most this many codes render inline in a cell; beyond it the cell shows
 * the row-local "View N codes" control instead. Matches the projection's own
 * collapse threshold, so a small set that arrived as inline field text and a
 * small set that arrived as a code object read identically.
 */
const INLINE_CODES = 4;

/**
 * The compact table-like structure Detail renders for Affected Products
 * (P2b, restructured by P2c and made the SOLE presentation by P3C-2): column
 * labels once, one affected version per row, columns drawn only from fields
 * the currently visible rows populate, Product first when any visible row has
 * a name.
 *
 * Cells hold each version's own facts plus every fact PROVEN to apply to the
 * whole recalled population — shared fields, shared lot/batch/production code
 * sets, and the readable production dates — repeated per row. The model never
 * merges values across versions, and never widens a row-scoped fact.
 *
 * Every affected-product code lives in a cell of the row it belongs to,
 * inline while the set is small and behind that row's own "View N codes"
 * control when it is not. Nothing renders beneath the table: the standalone
 * lot/batch/case/production-code disclosure and the standalone
 * production-date line are retired, and there is no "applies to all affected
 * versions" card to replace them.
 *
 * Null only when the gated model supports no row and no shared fact at all.
 */
export function affectedProductsTable(
  model: AffectedProductsModel,
  rowImages: ReadonlyMap<string, RowImageAssignment> = new Map(),
): AffectedProductsTable | null {
  // The consumer table has NO shared-facts section and NO code block beneath
  // it (founder decision, made total by P3C-2). A fact the model PROVED
  // applies to every affected version — `appliesToAll` fields, `sharedCodes`
  // sets, and the readable production dates — materializes here into every
  // row: the column exists once and the value repeats per row. Repetition is
  // preferred over a separate block, and visual deduplication is not a goal.
  // Association safety is unweakened: merely-case-level evidence with an
  // ambiguous owner was already rejected upstream (`ambiguous-scope`) and is
  // structurally unreachable from this model, so nothing here can guess a
  // value into a row the source never tied it to.
  const sharedByKey = new Map(model.appliesToAll.map((field) => [field.key, field.value]));
  const hasShared =
    sharedByKey.size > 0 || model.sharedCodes.length > 0 || model.sharedProductionDates !== null;
  // A notice can state supported codes or dates and name no product row for
  // them at all (Twin Sisters' eight cheese lot codes; FSIS 103-2019's seven).
  // Those facts belong in the table, so the table gets ONE anonymous evidence
  // row to hold them. Its Product cell stays empty and — since it is the only
  // row — the Product column does not render at all. No name is invented, and
  // no ownership is asserted beyond what the source stated about the whole
  // recalled population.
  const items: AffectedProductItem[] =
    model.items.length > 0
      ? model.items
      : hasShared
        ? [{ rowId: 'case', name: null, fields: [], codes: null, codeLocation: null, photo: null }]
        : [];
  if (items.length === 0) return null;

  const entries = items.map((item) => {
    const values = new Map<AffectedProductsTableColumnKey, AffectedProductsTableCell>();
    const plain = (text: string) => ({ text, codes: null, codesLabel: null });
    for (const key of TABLE_COLUMN_ORDER) {
      if (key === 'productionCodes' || key === 'productionDates') continue;
      const text = item.fields.find((field) => field.key === key)?.value ?? sharedByKey.get(key);
      if (text !== undefined) values.set(key, plain(text));
    }
    // A code set renders inline while it is small enough to read at a glance,
    // and behind this row's own "View N codes" control when it is not. Either
    // way it is a cell of this row — never a block below the table.
    const codeCell = (key: AffectedProductsTableColumnKey, codes: LotCodeSet) => {
      if (values.has(key)) return;
      values.set(
        key,
        codes.count <= INLINE_CODES
          ? plain(codes.codes.join(', '))
          : { text: null, codes, codesLabel: `View ${codes.count} codes` },
      );
    };
    // The row's OWN set first, so a row that states its codes can never be
    // overwritten by the recall-level set.
    if (item.codes) codeCell(codeColumnKey(item.codes), item.codes);
    for (const shared of model.sharedCodes) codeCell(shared.key, shared.codes);
    if (model.sharedProductionDates !== null && !values.has('productionDates')) {
      values.set('productionDates', plain(model.sharedProductionDates));
    }
    const assignment = rowImages.get(item.rowId) ?? null;
    return {
      item,
      values,
      // The shared allocator's verdict, verbatim: the table only carries it
      // to the row so the screen has nothing to decide.
      image: assignment
        ? { url: assignment.image.url, accessibilityText: assignment.accessibilityText }
        : null,
    };
  });

  const view = (visible: typeof entries): AffectedProductsTableViewModel => {
    const columns: AffectedProductsTableColumn[] = [];
    if (visible.some((entry) => entry.item.name !== null)) {
      columns.push({ key: 'product', label: TABLE_COLUMN_LABEL.product });
    }
    for (const key of TABLE_COLUMN_ORDER) {
      if (visible.some((entry) => entry.values.has(key))) {
        columns.push({ key, label: TABLE_COLUMN_LABEL[key] });
      }
    }
    return {
      columns,
      rows: visible.map((entry) => ({
        id: entry.item.rowId,
        name: entry.item.name,
        cells: columns.map((column) =>
          column.key === 'product'
            ? { text: entry.item.name, codes: null, codesLabel: null }
            : (entry.values.get(column.key) ?? { text: null, codes: null, codesLabel: null }),
        ),
        image: entry.image,
      })),
    };
  };

  const initialRows = Math.min(AFFECTED_PRODUCTS_INITIAL_ROWS, entries.length);
  const expanded = view(entries);
  return {
    // Columns are justified by the rows each view actually shows: collapsed
    // uses the first three, and "See all" recomputes over every row.
    collapsed: entries.length > initialRows ? view(entries.slice(0, initialRows)) : expanded,
    expanded,
    initialRows,
    seeAllLabel:
      entries.length > AFFECTED_PRODUCTS_INITIAL_ROWS ? `See all (${entries.length})` : null,
  };
}

// ── Optional section visibility (P3A) ───────────────────────────────────────

/**
 * The Affected Products SECTION as the screen renders it: the table, and
 * nothing else (P3C-2).
 *
 * The section used to carry three further slots beneath the table — the
 * recall-level lot/batch codes, the printed production codes, and the
 * readable production dates — each with its own disclosure control. That
 * contract is retired. Every affected-product code and every row-applicable
 * production date now renders as a cell of the table row it belongs to, so a
 * section with no table has nothing to show and does not render.
 *
 * This type exists so the visibility decision has exactly one home. The
 * screen renders `DetailModel.sections.affectedProducts` or renders nothing —
 * it never re-derives whether a row, column, or code set is worth a heading,
 * and it has no second place to put a code.
 */
export interface AffectedProductsSection {
  /** The compact table over the gated rows. Never null: a section exists
   * exactly when a meaningful table does. */
  table: AffectedProductsTable;
}

/**
 * Does this table view carry anything a person can actually read?
 *
 * MEANINGFUL: a row with a consumer-facing product name, a cell holding a
 * supported value, or a cell holding this row's own collapsed code set.
 *
 * NOT MEANINGFUL: an empty row object; a row whose every value is null,
 * empty, rejected, or whitespace; the row's internal `id`; an empty column
 * set; and — explicitly — a row image with no accompanying value. An image
 * is decoration for a product row, never a reason to open a section.
 */
function tableHasContent(table: AffectedProductsTable): boolean {
  const view = table.expanded;
  if (view.columns.length === 0) return false;
  return view.rows.some(
    (row) =>
      (row.name ?? '').trim() !== '' ||
      row.cells.some((cell) => (cell.text ?? '').trim() !== '' || cell.codes !== null),
  );
}

/**
 * The Affected Products section, or `null` when the notice supports nothing
 * to put under the heading (P3A).
 *
 * The rule this closes: a heading, its spacing, and an empty container used
 * to render whenever the gated projection produced no rows — the recorded
 * Steak Burrito PHA (FSIS PHA-07292026-01) showed "AFFECTED PRODUCTS" with
 * nothing beneath it. Coverage/helper/disclaimer prose (`model.note`) was
 * removed from the screen by the P2a founder decision and is deliberately
 * NOT counted as content: an explanation of why there is nothing to show is
 * not something to show.
 *
 * A minimal row is preserved on purpose. A supported product NAME alone is
 * meaningful — a real affected product is never hidden merely because the
 * notice states no size, barcode, date, or code for it.
 *
 * P3C-2 makes the table the whole section. A notice whose only supported
 * package facts are recall-level codes still shows a section: those codes
 * reach the table as its one anonymous evidence row, rather than as a
 * disclosure beneath a table that was never built.
 */
export function affectedProductsSection(
  model: AffectedProductsModel,
  rowImages: ReadonlyMap<string, RowImageAssignment> = new Map(),
): AffectedProductsSection | null {
  const built = affectedProductsTable(model, rowImages);
  if (built === null || !tableHasContent(built)) return null;
  return { table: built };
}

/**
 * The "Where it was sold" section, or `null`. The section renders exactly one
 * thing at this stage (the P2a founder decision): the full state
 * representation, "Nationwide", a stated metro phrase, or the honest
 * unspecified statement. When the canonical geography supports none of those
 * the lead is empty, and the heading must not render alone — measured over
 * the recorded corpus, 9 notices reach that state.
 *
 * The complete evidence model (retailers, store addresses, online platforms,
 * channels) stays on `DetailModel.whereSold` for the later retailer-list
 * milestone; only the RENDER decision lives here.
 */
export function whereSoldSection(model: WhereSoldModel): WhereSoldModel | null {
  return model.lead.trim() === '' ? null : model;
}

/**
 * The optional consumer sections of the Detail screen, each already decided:
 * present means "there is meaningful content", `null` means "render no
 * heading, no container, and no surrounding spacing".
 *
 * Every optional section belongs here. A screen condition that re-inspects
 * rows, columns, codes, or geography is the defect this type exists to make
 * unrepresentable.
 */
export interface DetailSections {
  whereSold: WhereSoldModel | null;
  affectedProducts: AffectedProductsSection | null;
}

// ── Quantity ────────────────────────────────────────────────────────────────

/**
 * The complete authoritative recall quantity as one sentence, or null.
 *
 * FDA only: the FSIS `quantityText` field is the amount RECOVERED — a
 * different fact — and is deliberately not shown (standing decision). Omitted
 * when the What Happened narrative already carries the same figure, and never
 * truncated.
 *
 * This is a NARRATIVE sentence, not a separate presentation slot. It belongs
 * to the What Happened paragraph, in the same voice and the same body type as
 * the reason sentence beside it — how much was recalled is consumer context,
 * not a disclaimer. `detailNarrative` below is the one place it is composed;
 * no screen assembles or styles it.
 */
export function recallQuantitySentence(
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

/**
 * The What Happened narrative, assembled once by the model.
 *
 * The reason sentence leads; a source-supported quantity the reason did not
 * already state follows it, in the same paragraph. The illness-status sentence
 * renders after this narrative, so the order a reader gets is always: what
 * happened, how much, who got sick. The screen renders the finished text and
 * composes nothing.
 */
export function detailNarrative(reasonText: string, quantitySentence: string | null): string {
  return quantitySentence ? `${reasonText} ${quantitySentence}` : reasonText;
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
    // The SAME typed interpretation Detail renders, over the canonical
    // evidence a feed row carries (P3A). Home never names a material,
    // agent, allergen or family Detail would not — see `interpretReason`.
    reasonLine: conciseReasonLine({
      reasonText: item.reasonText,
      hazardCategory: item.hazardCategory,
      pathogenOrAllergen: item.pathogenOrAllergen,
      title: item.title,
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
  /**
   * The complete What Happened narrative (P3C-1): the reason sentence plus,
   * when the source states one the reason did not already carry, the recall
   * quantity — one paragraph, one voice. There is deliberately no separate
   * quantity field for a screen to style on its own.
   */
  whatHappened: { text: string; update: string | null };
  illnessLine: string | null;
  /**
   * The complete evidence models. These are PRESERVED SOURCE EVIDENCE for
   * traceability, matching, and later milestones — they are NOT the render
   * decision, and the screen does not read them. Render `sections`.
   */
  whereSold: WhereSoldModel;
  affectedProducts: AffectedProductsModel;
  /**
   * The optional consumer sections, already decided by this contract (P3A):
   * a section is present only when it has meaningful content, and `null`
   * means the heading, its container, and its spacing all stay absent.
   */
  sections: DetailSections;
  /** Existing source-supported content preserved below the standardized sections. */
  action: ConsumerAction;
  healthRisk: string | null;
  attachments: OfficialAttachment[];
  /** The full P2c image-role allocation: the hero, per-row assignments, the
   * deduplicated future-carousel gallery, and retained supporting assets.
   * One owner — screens render its verdicts and decide nothing. */
  images: RecallImageAllocation;
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
  const affectedProductsView = affectedProductsModel(consumer.packageCheck, productName);
  // The one image-role allocation (P2c): the stored hero resolved, row images
  // assigned only on official evidence, the gallery deduplicated — and no
  // asset ever holding two visible roles. Screens consume the verdicts.
  const images = allocateRecallImages({
    heroImageUrl: projection.heroImageUrl ?? null,
    photos: consumer.officialPhotos,
    labelVisuals,
    rows: affectedProductsView.items.map((item): RowImageCandidate => {
      const size = item.fields.find((field) => field.key === 'size')?.value ?? null;
      return {
        rowId: item.rowId,
        name: item.name,
        // A merged multi-size cell is not one matchable size.
        size: size !== null && !size.includes(',') ? size : null,
        upc: item.fields.find((field) => field.key === 'upc')?.value ?? null,
        sourcePhotoUrl: item.photo?.url ?? null,
      };
    }),
  });
  const heroImageUrl = images.hero?.url ?? null;
  const sold = whereSoldModel(consumer.distribution);

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
    whatHappened: {
      text: detailNarrative(
        happened.text,
        recallQuantitySentence(projection.sourceAgency, consumer.quantityText, happened.text),
      ),
      update: happened.update,
    },
    illnessLine: illnessLine(classifyIllnessReport(projection.summaryText)),
    whereSold: sold,
    affectedProducts: affectedProductsView,
    sections: {
      whereSold: whereSoldSection(sold),
      affectedProducts: affectedProductsSection(affectedProductsView, images.rowImages),
    },
    action: consumer.action,
    healthRisk: healthRiskSummary(
      projection.hazardCategory,
      projection.pathogenOrAllergen,
      projection.reasonText,
    ),
    attachments: extractAttachmentLinks(projection.summaryHtml),
    images,
    officialTitle: productName !== projection.title ? projection.title : null,
    agencyLabel: agencyLabel(projection.sourceAgency),
    sourceOrganization:
      projection.sourceAgency === 'FSIS'
        ? 'U.S. Department of Agriculture'
        : 'U.S. Food and Drug Administration',
  };
}
