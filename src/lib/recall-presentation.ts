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

import { foodCategoryLabel } from '@/domain/food-category';
import { sanitizeLaunchCategoryIds } from '@/domain/food-category-launch';
import {
  deriveIllnessStatus,
  illnessNoticeCopy,
  narrativeWithoutIllness,
  type IllnessNoticeCopy,
} from '@/domain/illness-status';
import { hasMaterialUpdate, materialActivityAt } from '@/domain/material-activity';
import type {
  CaseProjection,
  Geography,
  NoticeType,
  SourceAgency,
  TimelineEntry,
} from '@/domain/recall-types';
import type { UserRecallPreferences } from '@/domain/preferences';
import { displayableRetailerNames } from '@/domain/retailer-display';
import { evaluateReportEligibility } from '@/domain/shopper-report';
import { STATE_TO_POSTAL } from '@/domain/us-geography';
import {
  buildConsumerCase,
  type AffectedVariant,
  type ConsumerDistribution,
  type ConsumerPackageCheck,
  type LotCodeSet,
} from './consumer-projection';
import { PACKAGE_FIELD_LABEL, type PackageField, type PackageFieldKey } from './consumer-schema';
import {
  capitalizeLeadingWord,
  companyDisplayName,
  displayProductTitle,
  extractAttachmentLinks,
  humanizeAllCaps,
  productDisplayName,
  type OfficialAttachment,
} from './consumer-summary';
import type { CodeLocation } from './fact-types';
import type { ProductPhoto } from './product-photos';
import {
  allocateRecallImages,
  type RecallImage,
  type RecallImageAllocation,
  type RowImageAssignment,
  type RowImageCandidate,
} from './recall-images';
import type { CaseDetail, FeedItem } from './recall-feed';
import {
  allergenReasonLabel,
  healthRiskSummary,
  selectHazardGuidance,
  stateLabel,
  type HazardGuidance,
} from './recall-display';
import { interpretReason } from './recall-reason';
import { affectsYouVerdict } from './relevance';
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
  // The one shared shopper-title pipeline (P3D, extended by P2B7G): a jammed
  // quantity+unit boundary is spaced, ALL-CAPS is un-shouted, a defectively
  // lowercase headline is headline-cased, a lowercase leading article opens
  // with a capital, and an already-cased name passes through untouched. Push
  // copy uses the same composition.
  return displayProductTitle(name);
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

// ── Illness status ──────────────────────────────────────────────────────────
//
// There is no illness classifier here any more (P2B7K). `illnessLine`, its
// private count patterns, and its second negation guard lived in this file and
// disagreed with both `domain/illness.ts` and the stored `reportsIllness`
// flag — the same recall could be described one way on Detail and the opposite
// way in the notification ledger. `domain/illness-status.ts` is now the one
// reader of illness prose, and this contract only renders what it decides.

// ── Geography ───────────────────────────────────────────────────────────────

/**
 * THE shopper-facing location state (P2B7E). Feed and Detail render where a
 * recall reached at very different widths — the card's compact "CT, IL +4"
 * against Detail's complete jurisdiction list — but they must never disagree
 * about WHICH of these four things is true of a recall, and above all about
 * whether the app knows where the product went at all.
 *
 * Feed's input is the canonical tri-state `Geography`, which has no notion of
 * a sub-state area, so a card can only ever reach `nationwide`, `states` or
 * `unspecified`. Detail's input is the consumer projection's distribution,
 * which additionally carries a stated metro phrase. That is a difference of
 * GRANULARITY, not of verdict: a surface that knows less says less, and
 * neither surface may answer "nowhere".
 */
export type LocationState = 'nationwide' | 'states' | 'areas' | 'unspecified';

/**
 * The exact words for "the notice does not say where the product went", and
 * the ONLY thing an unspecified distribution may render — on either surface.
 *
 * An empty string is not a representation of this state. Detail used to let
 * one through (an unspecified distribution that named a retailer, an online
 * platform or a channel produced an empty lead, which the section-presence
 * rule then read as "nothing to say" and removed the whole heading), so a
 * recall read "Distribution not specified" on the card and lost Where It Was
 * Sold entirely on its own detail screen. Measured over the live corpus that
 * was 35 of 895 active cases. The honest line is not optional: a shopper who
 * cannot be told where a product went must be told that, on both surfaces.
 */
export const UNSPECIFIED_DISTRIBUTION = 'Distribution not specified';

/** Feed's location state, from the canonical tri-state geography. */
export function geographyLocationState(geography: Geography): LocationState {
  if (geography.scope === 'nationwide') return 'nationwide';
  if (geography.scope === 'states' && geography.states.length > 0) return 'states';
  return 'unspecified';
}

/**
 * Detail's location state. The consumer projection already decided this from
 * the same canonical geography plus the places the source stated, so this
 * names the contract rather than re-deriving it — the point is that both
 * screens read one typed verdict instead of each inspecting raw fields.
 */
export function distributionLocationState(distribution: ConsumerDistribution): LocationState {
  return distribution.scopeType;
}

/**
 * Compact Home location: one or two state abbreviations, "+N" beyond that,
 * "Nationwide", or the honest unspecified line. States arrive from the
 * canonical tri-state geography — exclusions (containment artifacts,
 * firm-address noise) are applied by that derivation before display, and
 * nothing here re-adds a state it removed.
 */
export function homeLocationSummary(geography: Geography): string {
  const state = geographyLocationState(geography);
  if (state === 'nationwide') return 'Nationwide';
  if (state !== 'states') return UNSPECIFIED_DISTRIBUTION;
  const codes = geography.states.map((name) => STATE_TO_POSTAL[name] ?? name);
  if (codes.length <= 2) return codes.join(', ');
  return `${codes[0]}, ${codes[1]} +${codes.length - 2}`;
}

/**
 * One in-place disclosure control: "See all (N)" while collapsed, "Show less"
 * while expanded. Three surfaces share this shape — the Detail jurisdiction
 * list, the Affected Products row list, and an individual multi-value product
 * cell — so every reveal on the screen words itself, counts itself, and
 * announces itself the same way, and no screen composes disclosure copy of
 * its own.
 *
 * Expanding NEVER navigates: there is no page, modal, or sheet behind any of
 * these. The list grows where it already is.
 */
export interface DisclosureControl {
  /** Visible text while collapsed. Always "See all (N)" with the REAL total. */
  expandLabel: string;
  /** Visible text while expanded. */
  collapseLabel: string;
  /**
   * Spoken label while collapsed. Names the count AND what is being revealed,
   * because "See all (10)" alone tells a screen-reader user nothing about
   * what the ten things are.
   */
  expandAccessibilityLabel: string;
  /**
   * Spoken label while expanded — identical to the visible word, so Voice
   * Control matches what a sighted user would say out loud.
   */
  collapseAccessibilityLabel: string;
}

/** The one collapse word. Never "Show fewer", never "Collapse". */
export const SHOW_LESS_LABEL = 'Show less';

/**
 * Build the control for a list of `total` items described by `noun`
 * ("states", "affected products", "lot codes"). `total` is always the
 * complete count, never the hidden remainder: "See all (10)" on a
 * ten-jurisdiction recall, not "See all (5)".
 */
export function disclosureControl(total: number, noun: string): DisclosureControl {
  return {
    expandLabel: `See all (${total})`,
    collapseLabel: SHOW_LESS_LABEL,
    expandAccessibilityLabel: `See all ${total} ${noun}`,
    collapseAccessibilityLabel: SHOW_LESS_LABEL,
  };
}

/**
 * At most this many jurisdictions render on Recall Detail before the list
 * discloses the rest in place. Five is the founder's number; Home is
 * unaffected and keeps its own two-code "+N" summary
 * (`homeLocationSummary`), which is a different, much tighter surface.
 */
export const WHERE_SOLD_INITIAL_STATES = 5;

export interface WhereSoldModel {
  /**
   * The shared location verdict (P2B7E) — the same contract the Feed card
   * reads. Carried so the two surfaces can be pinned equivalent instead of
   * each re-inspecting scopes, states and area text.
   */
  locationState: LocationState;
  /** The ONE rendered representation of where the recall reached (P2a
   * founder decision): the complete full-name state list, "Nationwide", a
   * stated metro phrase, or the honest unspecified statement — no trailing
   * period, never a bare count beside the list, and the only thing the
   * Where-it-was-sold section renders at this stage. NEVER empty: an
   * unspecified distribution renders `UNSPECIFIED_DISTRIBUTION`. */
  lead: string;
  /**
   * The lead as Detail renders it BEFORE the jurisdiction list is expanded:
   * the first `WHERE_SOLD_INITIAL_STATES` jurisdictions in canonical order,
   * comma-joined with no terminal "and" — because an "and" would assert the
   * list had ended when five of ten are showing. Identical to `lead` (same
   * string) whenever nothing is hidden, which includes every nationwide,
   * metro-phrase, and unspecified-distribution case: those are untouched by
   * this disclosure and never carry a control.
   */
  leadCollapsed: string;
  /**
   * The jurisdiction reveal, or null when every jurisdiction already shows.
   * Null is the whole gate: five or fewer jurisdictions render complete with
   * no control at all.
   */
  statesDisclosure: DisclosureControl | null;
  /** Complete full-name state list (empty when not state-scoped). Preserved
   * for matching/traceability; the rendered representation is `lead`. */
  states: string[];
  /** Source-stated retailers, preserved in full for the model. */
  retailers: string[];
  retailerCount: number;
  /**
   * The retailers to NAME on Detail — the source's own spellings, comma
   * joined — or null when the notice named no store this app will vouch for
   * (P2B7O). Detail is the only surface that renders it; Feed and Saved
   * carry no retailer content at all.
   *
   * Built from `distribution.statedRetailers` — the hardened sold-at
   * evidence — passed through the display gate, and NOT from `retailers`
   * above, which carries table headings and product attributes alongside
   * real stores. Measured live: 171 of 898 consumer-visible active cases
   * carry hardened evidence, 151 distinct strings, of which the gate rejects
   * exactly one.
   *
   * Every nameable store is listed; there is no "+N more". A truncated list
   * would hide stores with no way to reveal them, and the section's label
   * ("Retailers named in the notice") already scopes the claim to what the
   * announcement said rather than to everywhere the product was sold. The
   * app states no purchase and no completed sale — only that the notice
   * named these stores.
   */
  retailersNamed: string | null;
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
  const locationState = distributionLocationState(distribution);
  const states = locationState === 'states' ? distribution.states : [];
  const stated = states.length > 0 ? joinNames(states) : distribution.areaText.replace(/\.$/, '');
  // The projection leaves `areaText` EMPTY for an unspecified distribution
  // that still named a retailer, an online platform or a channel — written
  // when those routes rendered in this section and carried the answer
  // themselves. The P2a founder decision removed all of them from the
  // screen, which left that case with no line at all and, downstream, no
  // section. The fallback is stated here rather than in the projection so
  // the display decision stays in the display contract and no stored
  // projection changes (P2B7E).
  const lead = stated.trim() === '' ? UNSPECIFIED_DISTRIBUTION : stated;
  // Only a state list can be too long to show at once. Nationwide, a stated
  // metro phrase, and the honest unspecified statement are single sentences
  // with nothing to reveal, so they keep `lead` verbatim and get no control —
  // their handling is deliberately untouched here.
  const hiddenStates = states.length > WHERE_SOLD_INITIAL_STATES;
  const leadCollapsed = hiddenStates ? states.slice(0, WHERE_SOLD_INITIAL_STATES).join(', ') : lead;
  // Nameable stores only, and from the hardened field alone (P2B7O). The
  // full `retailers` evidence stays on the model untouched for traceability.
  const nameable = displayableRetailerNames(distribution.statedRetailers);
  const retailersNamed = nameable.length === 0 ? null : nameable.join(', ');
  return {
    locationState,
    lead,
    leadCollapsed,
    statesDisclosure: hiddenStates ? disclosureControl(states.length, 'states') : null,
    states,
    retailers: distribution.retailers,
    retailerCount: distribution.retailers.length,
    retailersNamed,
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
  /** Every value, joined exactly as the projection composed it. */
  value: string;
  /**
   * The individual values behind `value`, in source order. Carried so a long
   * field can disclose two values at a time without re-splitting formatted
   * text — the separator differs by field, and reverse-engineering it from
   * the joined string would be inventing data semantics. A single-value field
   * holds exactly one entry.
   */
  values: string[];
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
  /** Those dates as individual values, so the cell can disclose them two at
   * a time. Empty whenever `sharedProductionDates` is null. */
  sharedProductionDateValues: string[];
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
    .map((field) => ({
      key: field.key,
      label: field.label,
      value: field.value,
      values: [...field.values],
    }));
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
      fields.unshift({
        key: 'size',
        label: PACKAGE_FIELD_LABEL.size,
        value: variantName,
        values: [variantName],
      });
    } else if (!measurementKey(size.value).includes(measurementKey(variantName))) {
      size.value = `${size.value}, ${variantName}`;
      size.values = [...size.values, variantName];
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
        values: [variantName],
      });
    } else if (!measurementKey(packaging.value).includes(measurementKey(variantName))) {
      packaging.value = `${packaging.value}, ${variantName}`;
      packaging.values = [...packaging.values, variantName];
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
      sharedProductionDateValues: packageCheck.productionDateValues,
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
    sharedProductionDateValues: [],
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

/**
 * One cell — and, when the field holds more than two values, its own
 * independent disclosure.
 *
 * Every affected-product field can hold several values: expiration and
 * best-by dates, lot and batch codes, barcodes, package sizes, production
 * dates. They are all treated identically here. Two or fewer values always
 * render in full; beyond that the cell shows the first two and reveals the
 * rest IN PLACE. The retired "View N codes" modal is gone — a code list is
 * not a different kind of thing from a date list, and neither is worth
 * leaving the table for.
 *
 * `text` is the complete composed value, byte-identical to what this cell
 * rendered before any disclosure existed, so expanding a cell always lands
 * back on the projection's own wording.
 */
export interface AffectedProductsTableCell {
  /** The column this cell sits in — the stable identity the screen keys its
   * per-cell expansion by, so expansion cannot follow the wrong column when
   * the visible column set changes. */
  key: AffectedProductsTableColumnKey;
  /** Every value this field holds, in source order. Empty renders an EMPTY
   * cell: a missing value is never a dash, "unknown", or a value borrowed
   * from another version. */
  values: string[];
  /** All values as the projection composed them; null renders an empty cell. */
  text: string | null;
  /** The first two values, comma-joined — no terminal "and", which would
   * assert the list had ended. Identical to `text` when nothing is hidden. */
  collapsedText: string | null;
  /** This cell's own reveal, or null when two or fewer values render. For an
   * ordinary cell this is entirely independent of the section's row
   * disclosure and of every sibling cell; for a paired cell it is the
   * group's ONE coordinated control, carried identically by both halves. */
  disclosure: DisclosureControl | null;
  /**
   * When the source stated this cell's values as explicit code/date PAIRS,
   * the identity of that pair group — shared by exactly the two cells that
   * hold its two halves, and unique within the row. Null for an ordinary
   * independent cell.
   *
   * Both halves of a group carry the same `values.length`, the same
   * `disclosure`, and their values in the same line order, so line _n_ of one
   * is the partner of line _n_ of the other. The screen keys expansion by
   * this identity rather than by column, which is what makes it structurally
   * impossible for one half to expand while the other stays collapsed.
   *
   * A paired cell's values are rendered ONE PER LINE, never comma-joined: a
   * date like "September 30, 2027" carries its own comma, and joining would
   * both blur the values and destroy the alignment the pairing depends on.
   */
  pairGroup: string | null;
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
  /** The section-level reveal over product ROWS, or null when every row
   * already shows (a single-product recall gets no control at all). Entirely
   * independent of any cell's own disclosure. */
  rowsDisclosure: DisclosureControl | null;
}

/**
 * The identity of one cell's expansion state.
 *
 * A row id and a column key can each contain anything the source did, so they
 * are joined on a character neither can hold. For a PAIRED cell the second
 * half is the group identity rather than the column, and both halves of the
 * group produce the same id — which is what makes it impossible for one
 * paired column to expand while its partner stays collapsed.
 */
export function cellStateId(rowId: string, cell: AffectedProductsTableCell): string {
  return `${rowId}\u0000${cell.pairGroup ?? cell.key}`;
}

/**
 * Drop the cell-expansion state of every row the collapsed view will not
 * show, so a hidden row can never return already expanded. Cells in rows that
 * stay visible keep theirs, and a pair group's single entry is dropped or
 * kept as one thing.
 */
export function visibleCellState(
  open: ReadonlySet<string>,
  visibleRowIds: readonly string[],
): ReadonlySet<string> {
  const visible = new Set(visibleRowIds);
  return new Set([...open].filter((id) => visible.has(id.split('\u0000')[0])));
}

/**
 * At most this many affected-version rows render before "See all (N)".
 *
 * One: a recall's first affected product stands for the section, and a
 * shopper checking a package in hand scans one row far faster than a wall of
 * them. Rows stay in official/source order — the first row is the source's
 * first row, never the soonest expiry, the lowest lot code, or anything else
 * this app decided was more important.
 */
export const AFFECTED_PRODUCTS_INITIAL_ROWS = 1;

/** Which column a collapsed lot/batch code set belongs to, from the consumer
 * label the projection gave it — the word the source itself printed. */
function codeColumnKey(codes: LotCodeSet): 'lotCodes' | 'batchCodes' {
  return /batch/i.test(codes.label) ? 'batchCodes' : 'lotCodes';
}

/**
 * The columns a code set's paired dates could live in. A pair's date carries
 * no concept of its own — the projection records only "the source printed
 * this date beside this code" — so the partner column is never guessed from
 * the pair. It is IDENTIFIED, by the rule below.
 */
const PAIRABLE_DATE_COLUMNS: AffectedProductsTableColumnKey[] = [
  'bestBy',
  'useBy',
  'sellBy',
  'expiration',
  'productionDates',
];

/**
 * The column that holds exactly this code set's paired dates, or null.
 *
 * The test is SET EQUALITY: a column qualifies only when its values are
 * precisely the distinct dates the pairs name — no date the pairs do not
 * name, and none of theirs missing. That is evidence the two columns are the
 * two halves of one source statement, and it is the only thing that makes a
 * pair group honest:
 *
 *  - a column with an extra date would, once aligned, silently drop that date
 *    from view;
 *  - a column missing one of the pairs' dates was never the pairs' partner;
 *  - and array position proves nothing at all, so it is never consulted.
 *
 * When nothing qualifies, no group forms and both columns keep their ordinary
 * independent behaviour. Every value still renders; only the pairing goes
 * unshown, which is the conservative failure.
 */
function pairedDateColumn(
  codes: LotCodeSet,
  values: ReadonlyMap<AffectedProductsTableColumnKey, AffectedProductsTableCell>,
  claimed: ReadonlySet<AffectedProductsTableColumnKey>,
): AffectedProductsTableColumnKey | null {
  const dates = new Set(codes.pairs.map((pair) => pair.date));
  if (dates.size === 0) return null;
  for (const key of PAIRABLE_DATE_COLUMNS) {
    if (claimed.has(key)) continue;
    const candidate = values.get(key);
    if (candidate === undefined) continue;
    const held = new Set(candidate.values);
    if (held.size === dates.size && [...dates].every((date) => held.has(date))) return key;
  }
  return null;
}

/**
 * One rendered line of a pair group: a code and the date the source printed
 * beside it. `date` is null for a code the source left undated — those lines
 * follow the pairs, keep the code visible, and render an EMPTY date so
 * nothing implies a pairing the source never made.
 */
interface PairLine {
  code: string;
  date: string | null;
}

/**
 * Build the two halves of a pair group.
 *
 * Source order throughout: the pairs in the order the projection collected
 * them (which is the order the codes appear in the notice), then any undated
 * codes in theirs. The date half follows the CODE order rather than the date
 * column's own, because alignment is the whole point — line _n_ of each half
 * must be the same source statement.
 */
function pairGroupCells(
  dateKey: AffectedProductsTableColumnKey,
  codeKey: AffectedProductsTableColumnKey,
  codes: LotCodeSet,
): { lines: PairLine[]; date: AffectedProductsTableCell; code: AffectedProductsTableCell } {
  const pairedCodes = new Set(codes.pairs.map((pair) => pair.code));
  const lines: PairLine[] = [
    ...codes.pairs.map((pair) => ({ code: pair.code, date: pair.date })),
    ...codes.codes.filter((code) => !pairedCodes.has(code)).map((code) => ({ code, date: null })),
  ];
  const group = `${dateKey}+${codeKey}`;
  // ONE control for the group, carried identically by both halves so either
  // column can be tapped and neither can move alone. The visible count is the
  // number of lines the control reveals — under-counting would hide values
  // behind a smaller number — and the spoken label names the pairs, which is
  // the fact a screen-reader user needs.
  const control =
    lines.length > CELL_INLINE_VALUES
      ? disclosureControl(lines.length, pairGroupNoun(lines.length, codes.pairs.length))
      : null;
  const half = (key: AffectedProductsTableColumnKey, values: string[]) => ({
    key,
    values,
    // Line-joined, never comma-joined: these values can contain commas.
    text: values.join('\n'),
    collapsedText:
      control === null ? values.join('\n') : values.slice(0, CELL_INLINE_VALUES).join('\n'),
    disclosure: control,
    pairGroup: group,
  });
  return {
    lines,
    date: half(
      dateKey,
      lines.map((line) => line.date ?? ''),
    ),
    code: half(
      codeKey,
      lines.map((line) => line.code),
    ),
  };
}

/**
 * What the group's control announces. When every line is a pair it is exactly
 * that — "See all 22 identifier pairs". When undated codes ride along, the
 * label says how many of the lines are actually paired rather than letting
 * the word "pairs" cover values the source never paired.
 */
function pairGroupNoun(lines: number, pairs: number): string {
  return lines === pairs ? 'identifier pairs' : `identifiers (${pairs} paired with a date)`;
}

/**
 * At most this many values render inline in ANY cell; beyond it the cell
 * shows its own in-place reveal. One threshold for every field — a two-date
 * cell and a two-code cell behave identically, and a shopper never has to
 * learn which columns collapse.
 */
const CELL_INLINE_VALUES = 2;

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
  const sharedByKey = new Map(model.appliesToAll.map((field) => [field.key, field]));
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
    for (const key of TABLE_COLUMN_ORDER) {
      if (key === 'productionCodes' || key === 'productionDates') continue;
      const field = item.fields.find((entry) => entry.key === key) ?? sharedByKey.get(key);
      if (field !== undefined) values.set(key, cell(key, field.value, field.values));
    }
    // A code set is a multi-value cell like any other: inline at two values
    // or fewer, its own in-place reveal beyond that. Either way it is a cell
    // of this row — never a block below the table, and never a modal.
    //
    // The values are the source's own codes, nothing composed. The retired
    // modal also printed each code beside the date the source paired it with;
    // a cell cannot, because a value like "March 26, 2027" carries its own
    // comma and could not be comma-joined unambiguously. Those dates keep
    // their own column wherever the source stated them as dates.
    const codeCell = (key: AffectedProductsTableColumnKey, codes: LotCodeSet) => {
      if (values.has(key)) return;
      values.set(key, cell(key, codes.codes.join(', '), codes.codes));
    };
    // The row's OWN set first, so a row that states its codes can never be
    // overwritten by the recall-level set.
    if (item.codes) codeCell(codeColumnKey(item.codes), item.codes);
    for (const shared of model.sharedCodes) codeCell(shared.key, shared.codes);
    if (model.sharedProductionDates !== null && !values.has('productionDates')) {
      values.set(
        'productionDates',
        cell('productionDates', model.sharedProductionDates, model.sharedProductionDateValues),
      );
    }

    // ── Identifier pairs ────────────────────────────────────────────────
    //
    // Independent per-cell disclosure is right for independent fields, and
    // wrong for the one case where the source stated a RELATIONSHIP: when a
    // notice prints each code beside its own date, two columns of unrelated
    // lists invite exactly the reading the source ruled out — that every code
    // combines with every date. Twenty-two batch codes beside three best-by
    // dates is sixty-six product identities a shopper might check for; the
    // notice named twenty-two.
    //
    // So where — and only where — the projection holds explicit pairs AND a
    // date column is provably their partner, the two columns become one
    // coordinated group: aligned line by line, revealed and collapsed
    // together, under a single control. Everywhere else nothing changes.
    const claimed = new Set<AffectedProductsTableColumnKey>();
    const pairCodeSets: { key: AffectedProductsTableColumnKey; codes: LotCodeSet }[] = [
      ...(item.codes ? [{ key: codeColumnKey(item.codes), codes: item.codes }] : []),
      ...model.sharedCodes.map((shared) => ({
        key: shared.key as AffectedProductsTableColumnKey,
        codes: shared.codes,
      })),
    ];
    for (const { key, codes } of pairCodeSets) {
      // Only the cell this very set produced may be rewritten: a row whose
      // own codes already own the column is never overwritten by the
      // recall-level set (the same precedence codeCell applies).
      const existing = values.get(key);
      if (existing === undefined || existing.pairGroup !== null) continue;
      if (existing.values.length !== codes.codes.length) continue;
      const dateKey = pairedDateColumn(codes, values, claimed);
      if (dateKey === null) continue;
      const group = pairGroupCells(dateKey, key, codes);
      values.set(dateKey, group.date);
      values.set(key, group.code);
      claimed.add(dateKey);
      claimed.add(key);
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
            ? // A product name is one value and never discloses: it is the
              // row's identity, not a list.
              cell('product', entry.item.name, entry.item.name === null ? [] : [entry.item.name])
            : (entry.values.get(column.key) ?? emptyCell(column.key)),
        ),
        image: entry.image,
      })),
    };
  };

  const initialRows = Math.min(AFFECTED_PRODUCTS_INITIAL_ROWS, entries.length);
  const expanded = view(entries);
  return {
    // Columns are justified by the rows each view actually shows: collapsed
    // uses the first row, and "See all" recomputes over every row.
    collapsed: entries.length > initialRows ? view(entries.slice(0, initialRows)) : expanded,
    expanded,
    initialRows,
    rowsDisclosure:
      entries.length > AFFECTED_PRODUCTS_INITIAL_ROWS
        ? disclosureControl(entries.length, 'affected products')
        : null,
  };
}

/**
 * Build one cell from a field's composed text and its individual values.
 *
 * The collapsed form is the first two values comma-joined; the expanded form
 * is `text` exactly as the projection composed it, so expanding always lands
 * on the wording that shipped before disclosure existed. Nothing here
 * deduplicates, reorders, or reformats a value — whatever the projection
 * already decided about duplicates and order is what renders.
 */
function cell(
  key: AffectedProductsTableColumnKey,
  text: string | null,
  values: readonly string[],
): AffectedProductsTableCell {
  const all = [...values];
  const hidden = all.length > CELL_INLINE_VALUES;
  return {
    key,
    values: all,
    text,
    collapsedText: hidden ? all.slice(0, CELL_INLINE_VALUES).join(', ') : text,
    disclosure: hidden
      ? disclosureControl(all.length, TABLE_COLUMN_LABEL[key].toLowerCase())
      : null,
    pairGroup: null,
  };
}

function emptyCell(key: AffectedProductsTableColumnKey): AffectedProductsTableCell {
  return { key, values: [], text: null, collapsedText: null, disclosure: null, pairGroup: null };
}

// ── The header's official product imagery (P2B7C) ───────────────────────────

/** One official product photograph as the header renders it. */
export interface DetailImage {
  /** The authoritative official URL — never rehosted, never rewritten. */
  url: string;
  /**
   * The factual spoken description: the model's own product name, the same
   * text the single hero tile has always carried. Never a source caption,
   * and never anything derived from the pixels.
   */
  accessibilityLabel: string;
  /**
   * The source's published aspect ratio, carried for provenance and QA (the
   * Design Preview picks its extreme-shape examples by it). It is NOT layout
   * input: every image renders `contain`, so an unusually tall or wide one
   * is letterboxed rather than cropped, whatever this says.
   */
  aspectRatio: number | null;
}

/**
 * The header's official FDA product photography, in the allocator's own
 * order and complete — every candidate is navigable.
 *
 * There is NO presentation cap. A cap would make any count the screen showed
 * a lie about what a shopper can reach (the P2B7C correction: the counter
 * must describe reachable pages), so the set carries everything the
 * allocation produced and the pager virtualizes instead of dropping images.
 *
 * The set is never re-ranked, re-deduplicated, or re-collected downstream: a
 * screen renders exactly `images`, in exactly this order.
 */
export interface DetailImageSet {
  /** Every official product photo, in official order. Never empty — an empty
   * set is `null`, so no surface can render an indicator over nothing. */
  images: DetailImage[];
}

/** The stored wording for a rendered FSIS label page — ours, not the source's. */
export const OFFICIAL_LABEL_ALT = 'Official product label';

/**
 * How many position DOTS the indicator may draw at once (P2B7I correction,
 * founder decision).
 *
 * This bounds the INDICATOR and nothing else. Every usable official photo
 * stays swipeable however many there are — a 74-photo notice pages from
 * `1 / 74` to `74 / 74` — and the dots become a moving window over those
 * pages rather than one mark each, because seventy-four marks under a
 * 152pt tile communicate nothing. The number of dots therefore never says
 * anything about how many images a shopper can reach; the counter does
 * that.
 */
export const IMAGE_DOTS_WINDOW = 5;

/** Which indicator a rendered image set carries — see `imagePageView`. */
export type ImageIndicator = 'none' | 'dots' | 'dots-and-counter';

/**
 * A `DetailImageSet` as the pager should render it right now — the pure
 * decision, so the component owns no rule of its own.
 */
export interface ImagePageView {
  /**
   * EVERY page a shopper can swipe to, in official order: the complete set
   * minus the candidates known to have failed. There is no presentation
   * cap. A failed candidate simply leaves the set, and the healthy images
   * after it stay reachable; when every candidate has failed this is empty
   * and the header takes its no-image shape.
   */
  pages: DetailImage[];
  /** How many official photos the source published — the whole set, failed or not. */
  officialCount: number;
  /**
   * How many of them can actually be shown — `pages.length`, named so the
   * counter's denominator and the failure wording read from one field.
   * Equal to `officialCount` until something fails.
   */
  usableCount: number;
  /**
   * `none` for a lone page (a static tile: nothing to swipe, so nothing to
   * indicate); `dots` while every published photo is reachable and few
   * enough to mark individually; `dots-and-counter` beyond that, or when a
   * failure means fewer pages than the agency published. The counter is
   * only ever ADDED beside the dots, never swapped for them.
   */
  indicator: ImageIndicator;
}

export function imagePageView(set: DetailImageSet, failed: ReadonlySet<string>): ImagePageView {
  // No cap, no slice: the pager gets every usable page and virtualizes.
  const pages = set.images.filter((image) => !failed.has(image.url));
  const officialCount = set.images.length;
  const usableCount = pages.length;
  const indicator: ImageIndicator =
    usableCount < 2
      ? 'none'
      : usableCount > IMAGE_DOTS_WINDOW || usableCount < officialCount
        ? 'dots-and-counter'
        : 'dots';
  return { pages, officialCount, usableCount, indicator };
}

/**
 * Which page indices the dots stand for right now — a window of at most
 * `IMAGE_DOTS_WINDOW`, sliding over a longer set.
 *
 * At the beginning it is the first pages, through the middle it follows the
 * current page (centred, so the active dot is never at an edge while pages
 * remain on both sides), and at the end it is the final pages — so the
 * marks always contain the current position and a reader can tell which end
 * of the set they are near. A set that fits is simply all of it.
 */
export function imageDotWindow(current: number, pageCount: number): number[] {
  const size = Math.min(IMAGE_DOTS_WINDOW, pageCount);
  const centred = current - Math.floor(size / 2);
  const start = Math.min(Math.max(centred, 0), pageCount - size);
  return Array.from({ length: size }, (_, offset) => start + offset);
}

/**
 * The spoken position of one page, over the pages a shopper can actually
 * reach: `Image 2 of 74`. Every counted page IS reachable — there is no
 * cap — so the count needs no qualifier. When images have failed it counts
 * the survivors, and the one sentence about what could not be shown rides
 * the counter instead (`imageUnavailableLabel`), not every page.
 *
 * Composed here, not in the component, because it is consumer copy.
 */
export function imagePositionLabel(index: number, usableCount: number): string {
  return `Image ${index + 1} of ${usableCount}`;
}

/**
 * The visible counter beside the dots: `2 / 74`, current page over the
 * pages that can be shown. With nothing failing that IS the agency's
 * official total, exactly; when something fails the denominator drops to
 * what is reachable, because a denominator a shopper cannot swipe to is
 * the defect this milestone exists to close. Deliberately not a sentence —
 * the rejected `Showing 6 of 74 official images.` prose is gone.
 */
export function imageCounterText(index: number, usableCount: number): string {
  return `${index + 1} / ${usableCount}`;
}

/**
 * The one spoken sentence about images that could not be loaded, or null
 * when every published photo is reachable (the ordinary case, where the
 * page's own `Image 2 of 74` already says everything and a second
 * announcement would only repeat it).
 *
 * It keeps the two numbers apart — what can be shown, and what the agency
 * published — so a failed image is never implied to be viewable.
 */
export function imageUnavailableLabel(usableCount: number, officialCount: number): string | null {
  if (usableCount >= officialCount) return null;
  return `${usableCount} of ${officialCount} official images can be shown; the rest could not be loaded`;
}

/**
 * The header's image set, or null for "render nothing".
 *
 * The images arrive in the allocator's order and leave in it. This function
 * labels them — it never sorts, caps, filters by quality, re-reads a
 * caption, or looks at a pixel.
 */
export function detailImageSet(
  images: readonly RecallImage[],
  accessibilityLabel: string,
): DetailImageSet | null {
  if (images.length === 0) return null;
  return {
    images: images.map((image) => ({
      url: image.url,
      accessibilityLabel,
      aspectRatio: image.aspectRatio,
    })),
  };
}

/**
 * The allocation's official FDA PRODUCT PHOTOGRAPHY, hero first, in the
 * allocator's own order.
 *
 * Two rules live in this one filter:
 *
 *  - The stored hero leads, so the picture a shopper saw on the Feed card is
 *    the first page of Detail's set. Home and Detail read one authoritative
 *    hero identity (`projection.heroImageUrl`); neither selects or transforms
 *    it, so the two can never disagree.
 *  - FSIS label renders are excluded ENTIRELY, and by source rather than by
 *    position — so even a stored hero that pointed at a label render (the
 *    frozen imagery policy forbids it, and `qa:imagery` gates on it) could
 *    not reach the header. Label renders stay in `images.gallery` for the
 *    allocation and evidence pipeline; no screen renders them as a gallery
 *    (P2B7C correction — founder decision: imagery under Affected Products
 *    is only ever an image matched to that exact product row).
 */
export function productImagery(allocation: RecallImageAllocation): RecallImage[] {
  const ordered = [...(allocation.hero ? [allocation.hero] : []), ...allocation.gallery];
  return ordered.filter((image) => image.source === 'fda_announcement');
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
      // `text` is the complete composed value of every cell — a field's
      // joined value, a code set's joined codes, or the row's product name —
      // so it alone decides renderability. A whitespace-only name is not
      // content, exactly as before disclosure existed.
      row.cells.some((entry) => (entry.text ?? '').trim() !== ''),
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
  // Imagery is never a reason to open this section, and never its content:
  // the ONLY image this section may show is one the allocator matched to an
  // exact affected-product row (`AffectedProductsTableRow.image`), inside
  // that row. A general gallery of the notice's label pages was built in
  // P2B7C and REMOVED by founder decision in its correction — an image that
  // cannot be tied to a row is not evidence about any row on screen.
  if (built === null || !tableHasContent(built)) return null;
  return { table: built };
}

/**
 * The "Where it was sold" section. ALWAYS present for a valid recall
 * (P2B7E) — this function is total, and the section is not optional.
 *
 * The section renders exactly one thing at this stage (the P2a founder
 * decision): the full state representation, "Nationwide", a stated metro
 * phrase, or the honest unspecified statement. Those four cases are
 * exhaustive, because `whereSoldModel` now falls back to
 * `UNSPECIFIED_DISTRIBUTION` rather than to an empty lead.
 *
 * It used to return `null` on an empty lead, which is how a recall could say
 * "Distribution not specified" on its Feed card and then omit Where It Was
 * Sold entirely on its own detail screen. "We do not know" is an answer a
 * shopper is owed, not a reason to remove the question.
 *
 * The complete evidence model (retailers, store addresses, online platforms,
 * channels) stays on `DetailModel.whereSold` for the later retailer-list
 * milestone; only the RENDER decision lives here.
 */
export function whereSoldSection(model: WhereSoldModel): WhereSoldModel {
  return model;
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
  /** Never null (P2B7E): every valid recall renders Where It Was Sold. */
  whereSold: WhereSoldModel;
  /** Community shopper reports (P1D), nested under Where it was sold. */
  communityReports: CommunityReportsSection | null;
  healthRisk: HealthRiskSection | null;
  affectedProducts: AffectedProductsSection | null;
}

// ── Community shopper reports ───────────────────────────────────────────────

/**
 * The case-derived half of the community shopper-report block (P1D), or
 * `null` for "this recall can never take a report — ask the server nothing
 * and render nothing".
 *
 * Two independent gates decide the block, and BOTH must open:
 *
 *  1. This one, computed purely from the case (an active, non-merged notice
 *     with usable official geography, mirroring the server's own eligibility
 *     rules in domain/shopper-report.ts). It also carries the only choices a
 *     report may name, so the questionnaire offers official states and
 *     notice-listed retailers and nothing else.
 *  2. The SERVER's thresholded summary at render time, which additionally
 *     reports `unavailable` whenever the feature gate is off. The app holds
 *     no local copy of that gate — the server is the single source of truth
 *     for whether the feature is visible at all.
 *
 * The section is deliberately nested under Where it was sold rather than
 * standing alone, and this decision enforces it: community reports
 * corroborate the official distribution statement, so where the case renders
 * no such statement there is nothing to corroborate and no entry point goes
 * silently missing.
 */
export interface CommunityReportsSection {
  /** The case a report would be filed against. */
  caseId: string;
  /** Jurisdictions a report may name (postal codes). Never empty. */
  allowedStateCodes: readonly string[];
  /** Exact canonical retailer names the store question may offer; [] = no question. */
  retailerChoices: readonly string[];
}

/**
 * Decide the community section for one case.
 *
 * The block is nested under Where it was sold, and that host section is now
 * present for every valid recall (P2B7E), so the nesting invariant is
 * STRUCTURAL — `DetailSections.whereSold` is not nullable — rather than a
 * runtime argument this function has to re-check. What remains here is the
 * block's own eligibility, unchanged.
 */
export function communityReportsSection(
  caseId: string,
  projection: CaseProjection,
): CommunityReportsSection | null {
  const eligibility = evaluateReportEligibility({
    state: projection.state,
    geography: projection.geography,
    retailerNames: projection.retailerNames ?? [],
  });
  if (!eligibility.eligible) return null;
  return {
    caseId,
    allowedStateCodes: eligibility.allowedStateCodes,
    retailerChoices: eligibility.retailerChoices,
  };
}

// ── Health Risk ─────────────────────────────────────────────────────────────

/**
 * The "Health Risk" section (P1B), or `null`.
 *
 * Standardized content only: the section renders a reviewed hazard guide
 * (src/content/hazard-guides.ts) selected from the canonical typed reason, so
 * every recall carrying the same recognized hazard shows identical copy. It
 * is never assembled from a notice's own prose.
 *
 * Two tiers plus omission, in strict precedence:
 *
 *  1. A reviewed guide matched — risk statement, "Common symptoms" bullets,
 *     the higher-risk-group line when the source states one, and the
 *     authoritative source link.
 *  2. No guide, but the approved hazard templates still produce a defensible
 *     risk sentence (Cronobacter, mold, choking, foreign material, packaging
 *     defects, and the other recurring families) — that sentence renders
 *     ALONE. No symptom list is invented for a hazard that has no reviewed
 *     one, and no source is cited that was not recorded.
 *  3. Neither — no section at all: no heading, no container, no spacing. An
 *     unmapped, regulatory-only, or unknown hazard is left silent rather than
 *     given health copy it cannot support.
 *
 * Recall-specific illness facts are NOT here. Whether this recall reported
 * illnesses is a separate canonical fact, rendered by the compact illness
 * notice in the Detail identity area (`DetailModel.illnessNotice`, P2B7K);
 * merging them would imply that the general symptoms below were experienced
 * in this recall.
 */
export interface HealthRiskSection {
  /** The standardized risk statement — always present when the section is. */
  risk: string;
  /** Reviewed symptom bullets, or null when no symptom list is defensible. */
  symptoms: readonly string[] | null;
  /** Higher-risk-group statement, when the authoritative source states one. */
  higherRisk: string | null;
  /** The official source link ("Learn more from CDC"), tier 1 only. */
  source: { label: string; url: string } | null;
}

/**
 * Decide the Health Risk section for one case.
 *
 * A retracted notice is suppressed entirely: the agency has withdrawn the
 * claim that this product carries the hazard, so standing hazard education
 * beside it would assert a risk the source no longer states. A CLOSED recall
 * keeps its section — closure means the agency finished its process, not that
 * the product left anyone's kitchen, and a shopper holding it still needs to
 * know what the hazard does.
 */
export function healthRiskSection(
  guidance: HazardGuidance | null,
  fallbackRisk: string | null,
  options: { retracted: boolean },
): HealthRiskSection | null {
  if (options.retracted) return null;
  if (guidance) {
    return {
      risk: guidance.risk,
      symptoms: guidance.symptoms,
      higherRisk: guidance.higherRisk,
      source: {
        label: `Learn more from ${guidance.source.organization}`,
        url: guidance.source.url,
      },
    };
  }
  if (fallbackRisk) {
    return { risk: fallbackRisk, symptoms: null, higherRisk: null, source: null };
  }
  return null;
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

// ── Product category tag (P2B7D) ────────────────────────────────────────────

/**
 * The ONE product category a recall card may show, as its shopper-facing
 * label — or null, which renders nothing at all.
 *
 * ## It displays an answer; it never computes one
 *
 * The only input is `FeedItem.productCategories`: the ids the server-side
 * classifier derived and `projection.productCategories` stored, read back by
 * `domain/product-categories-stored.ts`. Nothing here looks at the title,
 * brand, reason, agency, hazard or image, and no other overload exists — a
 * second, weaker, on-device classifier is the failure this signature is shaped
 * to prevent (docs/recall-food-categories.md §8, `category-invariance.test.ts`).
 *
 * ## Why `sanitizeLaunchCategoryIds` and not a list of our own
 *
 * It is THE boundary the Category filter already puts every id through: it
 * drops non-strings and unknown ids, drops the three launch-hidden ids,
 * collapses duplicates, and sorts into the frozen vocabulary's display order.
 * Reusing it — rather than re-deciding here what a shopper may see — is what
 * makes it impossible for a card to show a category the filter does not offer.
 * A card tagged `Prepared foods` with no Prepared foods chip behind it would
 * be a visible dead end, and `supplements` has no validation at all
 * (docs/recall-food-categories.md §8, "Launch-visible allowlist").
 *
 * ## Why the FIRST one, and why at most one
 *
 * 2.5% of active cases carry more than one category, and the vocabulary's
 * order is a fixed display order, not a confidence ranking — every stored id
 * is one the source's own product text genuinely named, so there is no
 * "primary" to demote. Taking the first launch-visible id after the canonical
 * sort is therefore an arbitrary-but-stable choice among equally valid
 * answers, and stability is what matters: Feed and Saved read the same stored
 * list through this same function and cannot disagree.
 *
 * Null for: no stored categories (an un-enriched case — NOT `other`), and a
 * list whose every id is launch-hidden. Both render nothing: no placeholder
 * word, no empty container, no spacer, no spoken element.
 */
export function cardCategoryLabel(productCategories: unknown): string | null {
  const [displayable] = sanitizeLaunchCategoryIds(productCategories);
  return displayable === undefined ? null : foodCategoryLabel(displayable);
}

// ── Card summary punctuation ────────────────────────────────────────────────

/**
 * Tails that are NOT sentence-ending punctuation, and must survive intact.
 *
 *   - an ellipsis, typed (`...`) or composed (`…`) — it marks elision, and
 *     removing one dot of three produces nonsense;
 *   - an abbreviation or an initial — `1.5 oz.`, `Whole Foods Market Inc.`,
 *     `Route 9 Co.`, a lone initial `J.` — where the period belongs to the
 *     token, not to the sentence. A single letter counts, which also covers
 *     the last dot of `U.S.`.
 *
 * Deliberately conservative: this list decides what is KEPT, so an unlisted
 * abbreviation loses a period it should have kept, which is a cosmetic
 * error on a card. The inverse — a rule that stripped aggressively — would
 * mangle a code or a measurement, which is a correctness error, and recall
 * correctness is the product.
 */
const NON_TERMINAL_TAIL =
  /(?:\.\.\.|…|(?:^|[\s(\[/-])(?:[A-Za-z]|[Nn]o|[Ii]nc|[Cc]orp|[Cc]os?|[Ll]td|[Ll]lc|[Ss]t|[Aa]ve|[Mm]t|[Dd]r|[Mm]rs?|[Mm]s|[Jj]r|[Ss]r|[Vv]s|etc|approx|est|min|max|oz|lb|lbs|fl|pt|qt|gal|ct|pkg|pcs|dept|mfg|no)\.)$/;

/**
 * More than one sentence: a break INSIDE the text, not just the final stop.
 *
 * A stop followed by whitespace is not enough — `Potential E. coli
 * contamination.` would read as two sentences and keep a period every other
 * card had dropped (13 recorded FDA/FSIS notices do exactly this). A real
 * break starts a new sentence, so the next non-space character must be
 * capitalised or a digit; `E. coli`, `U.S. distribution` and `1.5 oz` are
 * not breaks.
 */
const INTERIOR_SENTENCE_BREAK = /[.!?]["')\]]?\s+[A-Z0-9]/;

/**
 * The compact-card rendering of a Lotly-generated hazard/reason summary
 * (P2B7H): the same sentence `conciseReasonLine` composed, without its
 * final full stop.
 *
 * ## Why this exists, and why it is HERE
 *
 * On a card the summary is a compact label sitting among a risk badge, a
 * category tag, a date and a location — none of which is punctuated — and
 * a lone trailing period on the one line that has it reads as a stray mark
 * rather than as grammar. On Detail the same reason is prose inside a
 * paragraph and keeps its stop.
 *
 * So this is PRESENTATION ONLY, applied at the narrowest boundary that both
 * card surfaces share and Detail does not: `buildHomeCardModel`, the one
 * builder behind the shared `RecallCard`. Feed and Saved both reach the card
 * through it and therefore cannot disagree. Nothing upstream changes —
 * `conciseReasonLine` still returns its sentence, Detail's narrative
 * (`detailNarrative`) is untouched, and no stored field is rewritten. The
 * period is dropped on the way to the card and nowhere else.
 *
 * ## What it will not touch
 *
 * Only a single trailing `.` on a single-sentence string. An ellipsis, an
 * abbreviation, an initial, a decimal, a code, a question or exclamation,
 * and any text carrying an interior sentence break are all returned exactly
 * as given — a multi-sentence verbatim source reason keeps every stop it
 * came with, because removing only the last one would leave the text
 * inconsistently punctuated rather than unpunctuated.
 */
export function cardSummaryText(line: string | null): string | null {
  if (line === null) return null;
  const text = line.trimEnd();
  if (!text.endsWith('.')) return text;
  if (NON_TERMINAL_TAIL.test(text)) return text;
  if (INTERIOR_SENTENCE_BREAK.test(text)) return text;
  return text.slice(0, -1);
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
  /**
   * The one displayable product category ("Bakery"), or null when the case
   * has none stored or carries only launch-hidden ids. Quiet metadata, never
   * a risk, a relevance or a completeness statement — see `cardCategoryLabel`.
   */
  categoryLabel: string | null;
  heroImageUrl: string | null;
  locationSummary: string;
}

export interface HomeCardContext {
  /** Injected calendar date (YYYY-MM-DD) — see `todayIso`. */
  today: string;
  /**
   * The preferences saved on this device RIGHT NOW, or null when they have
   * not been read yet (or the platform has no preference storage).
   *
   * P2B7N.1 replaced an `affectsYou: boolean` here, and the change is the
   * whole point rather than a refactor. A boolean made the personalization
   * verdict a screen's answer to give: the Feed computed it, Saved — which
   * had no preferences in scope — passed a literal `false`, and the same
   * saved recall lost its AFFECTS YOU the moment it was read from the other
   * tab. Taking the inputs instead of the answer means a surface has no
   * verdict to pass and therefore none it can get wrong; both card screens
   * hand over the same two things and necessarily receive the same model.
   *
   * Nothing is snapshotted: the verdict is recomputed from these live
   * preferences on every build, so changing a preference changes every
   * surface at once (`affectsYouVerdict`).
   */
  prefs: UserRecallPreferences | null;
}

export function buildHomeCardModel(item: FeedItem, context: HomeCardContext): HomeCardModel {
  const { brand } = caseIdentity(item.brands, item.firmName, item.title);
  return {
    id: item.id,
    noticeLabel: noticeLabel(item.noticeType),
    risk: riskView(item.classification, item.sourceAgency, item.noticeType),
    activity: activityDisplay(item.publishedAt, item.timeline, context.today),
    // Derived HERE, from the current preferences, for every card surface.
    // A feed row already satisfies `RelevanceInput` in full, so it is passed
    // whole — no surface re-lists the facts relevance reads, and none can
    // omit one (P2B7N.1).
    affectsYou: affectsYouVerdict(item, context.prefs),
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
    // The SAME sentence Detail's reason clause is built from, rendered for
    // a compact card: `cardSummaryText` drops its trailing full stop and
    // changes nothing else (P2B7H). Feed and Saved both build their cards
    // here, so the two can never punctuate the same recall differently.
    reasonLine: cardSummaryText(
      conciseReasonLine({
        reasonText: item.reasonText,
        hazardCategory: item.hazardCategory,
        pathogenOrAllergen: item.pathogenOrAllergen,
        title: item.title,
      }),
    ),
    // The STORED answer, launch-filtered and capped at one. Feed and Saved
    // both reach the card through this builder, so the same recall carries
    // the same tag on both — there is no second display rule to drift.
    categoryLabel: cardCategoryLabel(item.productCategories),
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
  /** The SAME selected hero image Home shows; null renders nothing. Home's
   * card field and the stored selection — Detail renders `productImages`,
   * which begins with this image when there is one. */
  heroImageUrl: string | null;
  /**
   * The header's official FDA product photography (P2B7C): the allocator's
   * hero — the same image the Feed card shows — followed by its gallery
   * order, complete and uncapped, so every page the indicator counts can
   * actually be reached.
   *
   * Null renders nothing (the approved no-image header). One image renders
   * the static tile Detail has always shown; several page by hand in that
   * same tile. FSIS label renders are never in here, and are rendered
   * nowhere else either.
   */
  productImages: DetailImageSet | null;
  affectsYou: boolean;
  /** The generic approved banner text, shown iff `affectsYou`. */
  affectsYouBanner: string;
  /**
   * The complete What Happened narrative (P3C-1): the reason sentence plus,
   * when the source states one the reason did not already carry, the recall
   * quantity — one paragraph, one voice. There is deliberately no separate
   * quantity field for a screen to style on its own, and no `update` field:
   * the generated update note was removed with its generator (P2B7Q.1).
   */
  whatHappened: { text: string };
  /**
   * The compact illness notice (P2B7K), or null when the official notice never
   * established illness status — in which case Detail renders nothing at all
   * for it. It carries ONLY illness: injuries, adverse reactions,
   * hospitalizations and deaths stay in `whatHappened`, in the source's words.
   */
  illnessNotice: IllnessNoticeCopy | null;
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
  /**
   * The approved standardized risk sentence for this hazard, or null — the
   * EVIDENCE field, kept for traceability and for the Health Risk section's
   * risk-only tier. It is not the render decision: screens read
   * `sections.healthRisk`, which owns tiering, source citation, and whether
   * the section appears at all.
   */
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
    alt: OFFICIAL_LABEL_ALT,
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
  // The ONE visible image surface (P2B7C, as corrected): the header's
  // official FDA product photography, hero first. FSIS label renders stay in
  // the allocation for the evidence pipeline and are rendered nowhere; the
  // only other imagery on the screen is a thumbnail the allocator matched to
  // an exact affected-product row. The header collects, reorders, and
  // deduplicates nothing of its own.
  const productImages = detailImageSet(productImagery(images), productName);
  const productsSection = affectedProductsSection(affectedProductsView, images.rowImages);
  const sold = whereSoldModel(consumer.distribution);
  // The standardized health guide (P1B) is selected from the SAME typed
  // reason What Happened rendered — `interpretReason` is pure, so calling it
  // with Detail's identical evidence cannot produce a different family, and
  // the hazard is interpreted in exactly one place. The guide's own organism
  // lookup then reads only the canonical structured reason (never the
  // announcement body), so the same hazard yields the same copy everywhere.
  const hazardGuidance: HazardGuidance | null = selectHazardGuidance(
    interpretReason({
      reasonText: projection.reasonText,
      hazardCategory: projection.hazardCategory,
      pathogenOrAllergen: projection.pathogenOrAllergen,
      summaryText: projection.summaryText,
      title: projection.title,
    }),
    {
      pathogenOrAllergen: projection.pathogenOrAllergen,
      reasonText: projection.reasonText,
    },
  );
  const standardizedRisk = healthRiskSummary(
    projection.hazardCategory,
    projection.pathogenOrAllergen,
    projection.reasonText,
  );

  // Derived once and used twice: the notice renders it, and the What Happened
  // narrative is de-duplicated against the very sentences it came from.
  const illnessStatus = deriveIllnessStatus(projection.summaryText);

  // Decided once: the community block nests under this section, so both
  // read the same verdict rather than recomputing it.
  const whereSoldDecision = whereSoldSection(sold);

  return {
    id: detail.id,
    noticeTypeLabel:
      projection.noticeType === 'public_health_alert' ? 'Public Health Alert' : 'Recall',
    lifecycleLabel: lifecycleLabel(projection),
    retracted: projection.state === 'retracted',
    risk: riskView(projection.classification, projection.sourceAgency, projection.noticeType),
    activity: activityDisplay(projection.publishedAt, detail.timeline, context.today),
    productName,
    brand,
    officialSource: officialSourceLink(
      projection.sourceAgency,
      projection.noticeType,
      projection.officialUrl,
    ),
    heroImageUrl,
    productImages,
    affectsYou: context.affectsYou,
    affectsYouBanner: 'Warning: This recall affects you.',
    whatHappened: {
      // The illness sentence is removed from the narrative only when the
      // notice completely represents it (P2B7K).
      //
      // MEASURED (P2B7Q): over the whole 1,931-case table this step changes
      // NOTHING, because the narrative below is built from structured slots
      // and never contains a source sentence to begin with. The guard is kept
      // — it is the correct rule the moment any source prose reaches this
      // paragraph — but it must not be read as evidence that a
      // hospitalization, death, injury or adverse reaction survives here.
      // None does.
      //
      // That gap is why P2B7Q.1 gave hospitalizations and deaths their own
      // lines on the compact notice (`illnessNotice` below): they are stated
      // there, from the illness contract's own derivation, rather than left
      // to a narrative that was never going to carry them. Injuries and
      // adverse reactions still have no status anywhere — see
      // docs/recall-illness-status.md §1.2.
      text: narrativeWithoutIllness(
        detailNarrative(
          happened.text,
          recallQuantitySentence(projection.sourceAgency, consumer.quantityText, happened.text),
        ),
        illnessStatus,
      ),
    },
    illnessNotice: illnessNoticeCopy(illnessStatus),
    whereSold: sold,
    affectedProducts: affectedProductsView,
    sections: {
      whereSold: whereSoldDecision,
      communityReports: communityReportsSection(detail.id, projection),
      healthRisk: healthRiskSection(hazardGuidance, standardizedRisk, {
        retracted: projection.state === 'retracted',
      }),
      affectedProducts: productsSection,
    },
    healthRisk: standardizedRisk,
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
