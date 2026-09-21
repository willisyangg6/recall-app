/**
 * Display formatting for recall data. One rule dominates: unknown data is
 * communicated honestly ("Not specified"), never rendered as an empty value or
 * a guessed default.
 *
 * ## What is deliberately NOT here any more (P2B7Q)
 *
 * This file used to carry a second, dormant wording of four facts the shipped
 * app already states elsewhere — and each dormant copy contradicted the live
 * one:
 *
 *  - `illnessDisplay` — a fourth reader of illness prose ("No illnesses have
 *    been reported.", and an invented sentence for the unknown state). The one
 *    illness contract is `domain/illness-status.ts`, whose notice says "No
 *    illnesses reported" and renders NOTHING when the source established no
 *    status (P2B7K). It was the last of that audit's four readers.
 *  - `geographyLabel` / `geographyDetail` — a second location wording that
 *    said "13 states" as a bare count (`whereSoldModel` renders the complete
 *    list instead, P2a) and referred the reader out to the government page
 *    ("Check the official notice for more information"), which is a standing
 *    critical QA violation.
 *  - `timingLine` — "Announced X · Updated Y", both labels at once, where
 *    `activityDisplay` states exactly one and earns "Updated" only from the
 *    material-change ledger.
 *  - `hazardLabel` and `formatDate` — unreferenced by anything.
 *
 * P2B7Q.1 removed one more: `consumerActionDisplay`, the standardizer behind
 * the "What should I do?" instruction. That whole concept is gone — the
 * screen never rendered it, and the founder retired the idea rather than the
 * code alone, so there is no dormant generator waiting to be wired up.
 *
 * None of them had a caller. They are gone rather than left dormant because a
 * dormant second wording is exactly what the copy audit exists to prevent: it
 * costs nothing until a screen imports it, and then the app says two different
 * things about one recall. The live owners are `domain/illness-status.ts`,
 * `lib/recall-presentation.ts`, and this file's surviving reason/hazard/action
 * helpers.
 */

import {
  ALLERGEN_GUIDE_KEY,
  HAZARD_GUIDES,
  hazardGuideByKey,
  type HazardGuide,
  type HazardGuideKey,
  type HazardGuideSource,
} from '@/content/hazard-guides';
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
