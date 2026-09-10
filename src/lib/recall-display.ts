/**
 * Display formatting for recall data. One rule dominates: unknown data is
 * communicated honestly ("Not specified"), never rendered as an empty value or
 * a guessed default.
 */

import {
  ALLERGEN_GUIDE_KEY,
  HAZARD_GUIDES,
  hazardGuideByKey,
  type HazardGuide,
  type HazardGuideKey,
  type HazardGuideSource,
} from '@/content/hazard-guides';
import type { IllnessReport } from '@/domain/illness';
import type { CaseProjection } from '@/domain/recall-types';
import { cleanDisplayText, joinSentences } from '@/domain/text';
import type { TypedReason } from './recall-reason';

export function noticeTypeLabel(noticeType: 'recall' | 'public_health_alert'): string {
  return noticeType === 'public_health_alert' ? 'Public Health Alert' : 'Recall';
}

// Risk wording lives in src/lib/risk-display.ts: the consumer tier and the
// official agency classification are two separate layers, and the label that
// used to live here ("Class I · High risk") merged them into one.

/** Consumer wording for FSIS's structured reason values. Unmapped → verbatim. */
const REASON_DISPLAY: Record<string, string> = {
  'produced without benefit of inspection': 'Produced without inspection',
  'import violation': 'Import violation',
  misbranding: 'Misbranding',
  mislabeling: 'Mislabeling',
  'insanitary conditions': 'Insanitary conditions',
  'processing defect': 'Processing defect',
  'unfit for human consumption': 'Unfit for human consumption',
};

/** The nine FDA-recognized major allergens get the "… allergen" suffix;
 * other sensitivity triggers (gluten, sulfites) read as plain "Undeclared X". */
const MAJOR_ALLERGENS = new Set([
  'milk',
  'egg',
  'peanut',
  'tree nut',
  'soy',
  'wheat',
  'sesame',
  'fish',
  'shellfish',
]);

/** Source allergen words → consistent consumer display words. */
const ALLERGEN_DISPLAY: Record<string, string> = {
  eggs: 'egg',
  soybean: 'soy',
  soybeans: 'soy',
  peanuts: 'peanut',
  'tree nuts': 'tree nut',
  'crustacean shellfish': 'shellfish',
};

/**
 * "Undeclared milk allergen" / "Undeclared milk and soy allergens" — the one
 * allergen-reason wording, shared with the presentation contract (P1).
 */
export function allergenReasonLabel(pathogenOrAllergen: string | null): string {
  const phrase = pathogenOrAllergen?.match(/^undeclared\s+(.+)$/i)?.[1] ?? null;
  if (!phrase) return 'Undeclared allergen';
  const names = phrase
    .split(/,|\band\/or\b|\band\b|\bor\b/i)
    .map((n) => n.trim().toLowerCase())
    .filter((n) => n !== '')
    .map((n) => ALLERGEN_DISPLAY[n] ?? n);
  if (names.length === 0) return 'Undeclared allergen';
  const joined =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const allMajor = names.every((n) => MAJOR_ALLERGENS.has(n));
  if (!allMajor) return `Undeclared ${joined}`;
  return `Undeclared ${joined} allergen${names.length > 1 ? 's' : ''}`;
}

const MATERIAL_WORDS = ['glass', 'metal', 'plastic', 'wood', 'rubber'];

/** The specific foreign material a reason names, when it names one (P1 shares this). */
export function materialFrom(text: string | null): string | null {
  if (!text) return null;
  return MATERIAL_WORDS.find((m) => new RegExp(`\\b${m}\\b`, 'i').test(text)) ?? null;
}

/**
 * Concise consumer reason line with consistent casing and terminology across
 * agencies ("Possible E. coli contamination", "Undeclared soy allergen").
 * The structured hazard slots drive the label — raw source phrasing (with its
 * inconsistent capitalization) is used verbatim only when nothing structured
 * is available, and always survives untouched in the projection.
 */
export function reasonLine(
  reasonText: string | null,
  hazardCategory: string,
  pathogenOrAllergen: string | null,
): string | null {
  const pathogen =
    pathogenOrAllergen && !/^undeclared/i.test(pathogenOrAllergen) ? pathogenOrAllergen : null;

  // Hazard-first standardized label (agency-agnostic, consistent casing).
  let hazardLabel: string | null = null;
  if (hazardCategory === 'microbial_contamination') {
    hazardLabel = pathogen ? `Possible ${pathogen} contamination` : 'Possible contamination';
  } else if (hazardCategory === 'allergen') {
    hazardLabel = allergenReasonLabel(pathogenOrAllergen);
  } else if (hazardCategory === 'foreign_material') {
    const material = materialFrom(reasonText);
    hazardLabel = material
      ? `Possible ${material} contamination`
      : 'Possible foreign material contamination';
  } else if (hazardCategory === 'chemical_contamination') {
    hazardLabel = pathogen ? `Possible ${pathogen} contamination` : 'Possible contamination';
  }

  // FSIS multi-reason records append their regulatory reasons; source parts
  // already represented by the hazard label are not repeated. Unmapped free
  // text (FDA reason descriptions) appears verbatim only when no structured
  // label exists.
  const out: string[] = hazardLabel ? [hazardLabel] : [];
  for (const part of (reasonText ?? '').split(',')) {
    const key = part.trim().toLowerCase();
    if (key === '') continue;
    if (key === 'product contamination' || key === 'unreported allergens') {
      if (hazardLabel) continue;
      out.push(key === 'product contamination' ? 'Possible contamination' : 'Undeclared allergen');
    } else if (REASON_DISPLAY[key]) {
      out.push(REASON_DISPLAY[key]);
    } else if (!hazardLabel) {
      out.push(part.trim().replace(/[.\s]+$/, ''));
    }
  }
  return out.length > 0 ? [...new Set(out)].join(' · ') : null;
}

/**
 * Deterministic hazard-family health-risk templates (1–2 concise sentences,
 * standard consumer-education facts matching the agencies' own descriptions).
 * Shown only when the structured hazard slots identify the agent — an unknown
 * hazard yields null and the section is omitted. Never assembled from source
 * prose, so it can never start mid-sentence or carry government boilerplate.
 */
const PATHOGEN_HEALTH_RISK: [RegExp, string][] = [
  [
    /listeria/i,
    'Listeria can cause serious illness, especially in pregnant people, older adults, newborns, and people with weakened immune systems.',
  ],
  [
    /salmonella/i,
    'Salmonella can cause fever, diarrhea, nausea, and abdominal pain. Young children, older adults, and people with weakened immune systems may face more serious illness.',
  ],
  [
    /e\. ?coli/i,
    'E. coli can cause severe stomach cramps, diarrhea, and vomiting. Young children, older adults, and people with weakened immune systems may face more serious complications.',
  ],
  [
    /botulinum/i,
    'Botulism is a rare but serious illness that can cause weakness, blurred vision, difficulty swallowing, and trouble breathing, and can be life-threatening.',
  ],
  [
    /campylobacter/i,
    'Campylobacter can cause diarrhea, fever, and stomach cramps. Young children, older adults, and people with weakened immune systems may become more seriously ill.',
  ],
  [
    /cyclospora/i,
    'Cyclospora can cause watery diarrhea, loss of appetite, cramping, and fatigue that may last for weeks without treatment.',
  ],
  [
    /hepatitis a/i,
    'Hepatitis A is a contagious liver infection that can cause fatigue, nausea, jaundice, and stomach pain, ranging from mild to severe illness.',
  ],
  [
    /norovirus/i,
    'Norovirus can cause vomiting, diarrhea, and stomach pain, and spreads easily from person to person.',
  ],
  [
    /\blead\b/i,
    'Lead exposure can be harmful, especially for infants, young children, and pregnant people, and may cause serious health effects over time.',
  ],
  [
    /cesium/i,
    'Long-term exposure to elevated levels of Cesium-137 may increase the risk of cancer.',
  ],
];

export function healthRiskSummary(
  hazardCategory: string,
  pathogenOrAllergen: string | null,
  reasonText: string | null,
): string | null {
  if (hazardCategory === 'allergen') {
    const label = allergenReasonLabel(pathogenOrAllergen);
    const names = label.match(/^Undeclared\s+(.+?)(?:\s+allergens?)?$/)?.[1] ?? null;
    if (!names || names === 'allergen') {
      return 'People with a food allergy or severe sensitivity risk a serious or life-threatening allergic reaction if they consume this product.';
    }
    if (/gluten/i.test(names)) {
      return 'People sensitive to gluten, including those with celiac disease, may experience serious reactions if they consume this product.';
    }
    const orJoined = names.replace(/,\s*/g, ' or ').replace(/\s+and\s+/g, ' or ');
    const article = /^[aeiou]/i.test(orJoined) ? 'an' : 'a';
    return `People with ${article} ${orJoined} allergy or severe sensitivity risk a serious or life-threatening allergic reaction if they consume this product.`;
  }
  if (hazardCategory === 'foreign_material') {
    const material = materialFrom(`${reasonText ?? ''} ${pathogenOrAllergen ?? ''}`);
    return `Swallowing pieces of ${material ?? 'foreign material'} can injure the mouth, throat, or digestive tract.`;
  }
  // A recognized hazard with an approved template must always produce one.
  // The pathogen field is frequently null even when the reason text names the
  // organism outright ("Potential Clostridium botulinum contamination"), so
  // both are searched — a routing gap here silently drops a health warning we
  // already have the words for.
  const evidence = `${pathogenOrAllergen ?? ''} ${reasonText ?? ''}`;
  for (const [pattern, text] of PATHOGEN_HEALTH_RISK) {
    if (pattern.test(evidence)) return text;
  }
  for (const [pattern, text] of HAZARD_HEALTH_RISK) {
    if (pattern.test(evidence)) return text;
  }
  if (hazardCategory === 'product_integrity') {
    return 'Damaged or defective packaging can make this product unsafe to eat or handle.';
  }
  return null; // no safe standardized summary — the section is omitted
}

/**
 * Hazard families that recur across recalls without naming a pathogen. Each
 * entry is an approved deterministic summary, matched against the source's own
 * reason text — never inferred from the product or the company.
 */
const HAZARD_HEALTH_RISK: [RegExp, string][] = [
  [
    /\bcronobacter\b/i,
    'Cronobacter can cause a rare but serious infection in infants, including fever, poor feeding, and sluggishness. Seek medical care promptly if an infant shows symptoms.',
  ],
  [
    /\bbacillus cereus\b|\bcereulide\b/i,
    'Bacillus cereus can cause vomiting, stomach cramps, and diarrhea, usually within hours of eating a contaminated food.',
  ],
  [
    /\bmold\b|\bmould\b/i,
    'Mold can cause allergic reactions and respiratory symptoms, and some molds produce toxins that can make people ill.',
  ],
  [
    /\bsildenafil\b|\btadalafil\b|\bundeclared drug\b/i,
    'This product contains a prescription medicine that is not on the label. It can interact dangerously with nitrates taken for blood pressure or heart conditions.',
  ],
  [
    /\byellow oleander\b|\btoxic plant\b/i,
    'Yellow oleander is poisonous and can cause nausea, vomiting, and dangerous changes in heart rhythm.',
  ],
  [
    /\blead\b/i,
    'Lead is unsafe at any level. It can harm the brain and nervous system, and young children and pregnant people are most at risk.',
  ],
  [
    /\bpatulin\b/i,
    'Patulin is a mold toxin that can cause nausea and digestive upset, and repeated exposure may pose longer-term risks.',
  ],
  [
    /\bvitamin d3?\b/i,
    'Too much vitamin D can cause nausea, vomiting, confusion, excessive thirst, and kidney problems.',
  ],
  [
    /\balcohol\b/i,
    'This product contains alcohol that is not expected in it, which is unsafe for children and for anyone avoiding alcohol.',
  ],
  [
    /\bnot fully pasteuri[sz]ed\b|\bunder[- ]?process(?:ed|ing)\b|\bnot pasteuri[sz]ed\b/i,
    'Food that has not been fully processed can allow harmful bacteria to survive and cause serious illness.',
  ],
  [
    /\bchoking\b/i,
    'Small or hard pieces in this product are a choking hazard, particularly for babies and young children.',
  ],
  [
    /\b(?:plastic|glass|metal|rubber|foreign)\s+(?:pieces?|particles?|fragments?|material)\b|\bglass\b[^.]{0,30}\bbreak/i,
    'Swallowing hard fragments can injure the mouth, throat, or digestive tract, and broken packaging can cause cuts.',
  ],
  [
    /\bcleaning agents?\b|\bsanitiz\w+\b|\bcaustic\b/i,
    'Cleaning chemicals are not safe to swallow and can irritate or burn the mouth, throat, and stomach.',
  ],
  [
    /\b(?:insufficient|does not provide sufficient) nutrition\b|\bnutrition (?:and labeling )?requirement/i,
    'This product does not supply the nutrition it should. Relying on it as a sole source of nutrition can cause serious harm, especially to infants.',
  ],
];

/**
 * A reviewed hazard guide with its risk sentence resolved — what the Health
 * risk section renders when a hazard is confidently recognized (P1B).
 */
export interface HazardGuidance {
  key: HazardGuideKey;
  version: number;
  risk: string;
  symptoms: readonly string[] | null;
  higherRisk: string | null;
  source: HazardGuideSource;
}

/**
 * The typed-reason families whose canonical reason may NAME a recognized
 * organism, and are therefore eligible for the organism dictionary.
 *
 * `pathogen` is the primary path: the structured `pathogenOrAllergen` slot
 * named the organism outright. `verbatim` is the documented safety net —
 * that family means the canonical reason survived the interpreter's grammar
 * gates as a clean noun phrase, and the structured slot is frequently null on
 * notices whose reason names the organism anyway ("Potential Clostridium
 * botulinum contamination"). Recognizing six organism names inside that short
 * canonical field is not a second classifier: the FAMILY is never re-decided
 * here, only which named organism an already-hazard-bearing reason states.
 *
 * Every other family is excluded on purpose. A foreign-material, packaging,
 * labeling, import, inspection, or unmapped reason names no organism, and
 * forcing an infection guide onto one would invent a hazard the source never
 * stated.
 */
const ORGANISM_BEARING_FAMILIES: ReadonlySet<TypedReason['family']> = new Set([
  'pathogen',
  'verbatim',
]);

function guidance(guide: HazardGuide, risk: string): HazardGuidance {
  return {
    key: guide.key,
    version: guide.version,
    risk,
    symptoms: guide.symptoms,
    higherRisk: guide.higherRisk,
    source: guide.source,
  };
}

/**
 * Select the one reviewed hazard guide this notice's canonical reason
 * identifies, or null when no guide can be assigned confidently.
 *
 * Deterministic and conservative by construction:
 *
 *  - The hazard FAMILY comes from `interpretReason` — the one bounded typed
 *    reason interpretation Home and Detail already share. Nothing is
 *    re-decided from prose here.
 *  - Evidence is the canonical structured reason only (`pathogenOrAllergen`
 *    and `reasonText`). The announcement body is deliberately never read: a
 *    guide must be the same for every recall carrying the hazard, and source
 *    prose is exactly what would make it differ.
 *  - MULTI-HAZARD DISPLAY PRECEDENCE: a notice must show exactly one guide.
 *    When its reason names more than one supported hazard, the guide with the
 *    highest `displayPriority` wins — a presentation tie-breaker, not a claim
 *    that one hazard is medically worse than another. Match order, registry
 *    order, and the order the organisms appear in the text decide nothing, so
 *    the same notice always resolves to the same guide.
 *  - No recognized hazard means null, and the caller falls back to a
 *    risk-only sentence or omits the section entirely.
 */
export function selectHazardGuidance(
  reason: TypedReason,
  evidence: { pathogenOrAllergen: string | null; reasonText: string | null },
): HazardGuidance | null {
  if (reason.family === 'allergen') {
    // The allergen guide's risk sentence names the specific undeclared
    // allergen, so it comes from the approved template above rather than from
    // a fixed string — deterministic, so one allergen always reads the same.
    const guide = hazardGuideByKey(ALLERGEN_GUIDE_KEY);
    const risk = healthRiskSummary('allergen', evidence.pathogenOrAllergen, evidence.reasonText);
    return guide && risk ? guidance(guide, risk) : null;
  }
  if (!ORGANISM_BEARING_FAMILIES.has(reason.family)) return null;

  const text = `${evidence.pathogenOrAllergen ?? ''} ${evidence.reasonText ?? ''}`;
  let selected: HazardGuide | null = null;
  for (const guide of HAZARD_GUIDES) {
    if (guide.match.length === 0) continue;
    if (!guide.match.some((pattern) => pattern.test(text))) continue;
    if (selected === null || guide.displayPriority > selected.displayPriority) selected = guide;
  }
  return selected && selected.risk !== null ? guidance(selected, selected.risk) : null;
}

export function stateLabel(state: 'active' | 'closed' | 'retracted'): string {
  switch (state) {
    case 'active':
      return 'Active';
    case 'closed':
      // "Closed" means the agency concluded its process — never "safe now".
      return 'Closed by agency';
    case 'retracted':
      return 'Retracted';
  }
}

export function hazardLabel(hazardCategory: string): string | null {
  switch (hazardCategory) {
    case 'allergen':
      return 'Undeclared allergen';
    case 'microbial_contamination':
      return 'Possible contamination';
    case 'foreign_material':
      return 'Foreign material';
    case 'chemical_contamination':
      return 'Chemical contamination';
    case 'product_integrity':
      return 'Product integrity';
    case 'other_regulatory':
      return 'Regulatory issue';
    default:
      return null;
  }
}

/** Compact geography for cards; the full state list lives in the detail view. */
export function geographyLabel(geography: CaseProjection['geography']): string {
  switch (geography.scope) {
    case 'nationwide':
      return 'Nationwide';
    case 'states':
      return geography.states.length > 3
        ? `${geography.states.length} states`
        : geography.states.join(', ');
    case 'unknown':
      // Unknown is never rendered as nationwide or as "none".
      return 'Distribution not specified';
  }
}

/** Full geography for the detail view (complete state list, honest unknowns). */
export function geographyDetail(geography: CaseProjection['geography']): string {
  switch (geography.scope) {
    case 'nationwide':
      return 'Nationwide';
    case 'states':
      return geography.states.join(', ');
    case 'unknown':
      return 'Distribution not specified. Check the official notice for more information.';
  }
}

/**
 * Standardized illness-report presentation (three-way semantics, Part 4).
 * Source silence is presented as "not provided" — NEVER as zero.
 */
export function illnessDisplay(report: IllnessReport): { headline: string; detail: string | null } {
  switch (report.status) {
    case 'none_reported':
      return { headline: 'No illnesses have been reported.', detail: null };
    case 'reported':
      return {
        headline: 'Illnesses have been reported.',
        detail: cleanDisplayText(joinSentences(report.statements)),
      };
    case 'unknown':
      return { headline: 'No illness count is provided in this notice.', detail: null };
  }
}

export interface ActionDisplay {
  /** The consumer instruction, standardized when functionally equivalent. */
  primary: string;
  /** Retailer/institution guidance, secondary to the consumer action. */
  secondary: string | null;
  /** True when primary is our standardized wording (source preserved in data). */
  standardized: boolean;
}

/**
 * Standardize functionally-equivalent consumer instructions ("thrown away or
 * returned to the place of purchase" appears in ~75% of FSIS notices) while
 * preserving genuinely different instructions verbatim.
 */
export function consumerActionDisplay(sourceText: string | null): ActionDisplay | null {
  if (!sourceText) return null;
  const throwAway = /thrown away|throw (it|them|the product) away|discard|dispose of/i.test(
    sourceText,
  );
  // FSIS boilerplate says "returned to the place of purchase"; FDA press
  // releases say "return it to the/their place of purchase" — same action.
  // "to the original place of purchase", "to their place of purchase", "to the
  // store where it was purchased" — one action, written a dozen ways. The
  // adjective slot is what an exact-phrase match kept missing.
  const returnable =
    /return(ed|ing)?\s+(?:it|them|these|the\s+(?:affected\s+)?(?:product|item)s?|any\s+(?:remaining\s+)?product)?\s*to\s+(?:the|their|your)\s+(?:\w+\s+){0,2}(?:place of purchase|point of purchase|store of purchase|retailer|store where)|return\s+(?:the\s+)?(?:product|item)s?\s+[^.]{0,60}place of purchase|returned to (?:the|their|your)\s+(?:\w+\s+){0,2}place of purchase/i.test(
      sourceText,
    );
  const refund = /for a (full )?refund/i.test(sourceText);
  const destroy = /destroy/i.test(sourceText);
  const retailer = /(do not|should not|urged not to) (sell|serve|use or serve)\b/i.test(sourceText);

  let primary: string | null = null;
  if (throwAway && returnable) {
    primary = `Do not eat this product. Throw it away or return it to the place of purchase${refund ? ' for a refund' : ''}.`;
  } else if (destroy && returnable) {
    primary = `Do not eat this product. Destroy it or return it to the place of purchase${refund ? ' for a refund' : ''}.`;
  } else if (destroy) {
    primary = 'Do not eat this product. Destroy it.';
  } else if (throwAway) {
    primary = 'Do not eat this product. Throw it away.';
  } else if (returnable) {
    primary = `Do not eat this product. Return it to the place of purchase${refund ? ' for a refund' : ''}.`;
  }
  const standardized = primary !== null;
  return {
    primary: primary ?? cleanDisplayText(sourceText),
    secondary: retailer ? 'Restaurants and retailers should not sell or serve it.' : null,
    standardized,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Aug 17, 2026" from an ISO date, without timezone surprises. */
export function formatDate(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return isoDate;
  const [, year, month, day] = match;
  return `${MONTHS[Number(month) - 1]} ${Number(day)}, ${year}`;
}

export function timingLine(publishedAt: string, lastPublicActivityAt: string): string {
  const published = `Announced ${formatDate(publishedAt)}`;
  return lastPublicActivityAt > publishedAt
    ? `${published} · Updated ${formatDate(lastPublicActivityAt)}`
    : published;
}
