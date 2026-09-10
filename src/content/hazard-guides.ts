/**
 * Reviewed hazard guides — the standardized health content behind the Recall
 * Detail "Health Risk" section (P1B).
 *
 * ## Standardization is the whole point
 *
 * The same recognized hazard must produce the SAME reviewed copy on every
 * recall that carries it. Every Salmonella recall shows the Salmonella guide;
 * every Listeria recall shows the Listeria guide. Nothing here is assembled
 * from a notice's own prose, and nothing is generated at runtime: an earlier
 * attempt to recompose arbitrary announcement text into health copy produced
 * inconsistent and occasionally bad sentences, which is exactly why this is a
 * fixed, versioned, reviewed registry instead.
 *
 * ## What a guide is, and is not
 *
 *  - It is general education about a recognized hazard family: what the hazard
 *    is, what it can do, and which groups the authoritative source identifies
 *    as more likely to become seriously ill.
 *  - It is NOT a statement about this recall. Whether illnesses were reported
 *    in a specific recall is a separate canonical fact rendered separately
 *    (`DetailModel.illnessLine`, from domain/illness.ts). The two must never
 *    be merged: a symptom list is what the hazard CAN cause, never a claim
 *    that anyone experienced it here.
 *  - It is NOT diagnosis, treatment, or individualized advice. Copy states
 *    what a hazard can cause and who is more at risk; it never tells a reader
 *    what their symptoms mean.
 *
 * ## Sourcing rule
 *
 * Every guide cites one authoritative U.S. government public-health page and
 * carries the date its copy was last checked against that page. Only CDC, FDA,
 * and USDA/FSIS are acceptable sources. `reviewedOn` is the date a person
 * verified THIS copy against THAT url — not the source page's own revision
 * date — because it is the date that governs when the copy is re-checked.
 *
 * ## Extension seam (deliberately unused)
 *
 * A future notice could carry an exceptional official health instruction so
 * specific that omitting it would be a real safety problem — a recall-specific
 * antidote, exposure window, or agency directive that no standardized guide
 * could express. Nothing in the recorded corpus requires that today, so this
 * milestone does NOT implement it: the seam is a guide-level override that
 * would be authored per notice and reviewed like any other guide entry. It is
 * documented here so it is added deliberately, once a real case demands it,
 * rather than reopening the general "recompose notice prose" path this
 * registry exists to close.
 */

/** Stable guide identifiers. Never reused for different content. */
export type HazardGuideKey =
  | 'botulism'
  | 'listeria'
  | 'stec'
  | 'salmonella'
  | 'undeclared-allergen'
  | 'hepatitis-a'
  | 'cyclospora';

export interface HazardGuideSource {
  /** Authoritative U.S. government publisher — the only accepted set. */
  organization: 'CDC' | 'FDA' | 'FSIS';
  url: string;
  /** ISO date this guide's copy was last checked against `url`. */
  reviewedOn: string;
}

export interface HazardGuide {
  key: HazardGuideKey;
  /** Bumped whenever this guide's consumer-visible copy changes. */
  version: number;
  /**
   * TIE-BREAKER ONLY. This exists for exactly one purpose: when a notice's
   * canonical reason names more than one supported hazard, the app must show
   * ONE guide, and it must pick the same one every time. The highest
   * `displayPriority` wins, so match order, registry order, and the order the
   * organisms happen to appear in the reason text all decide nothing.
   *
   * It is NOT a medical severity scale. This registry offers no universal
   * comparison between these hazards, makes no claim about which is worse for
   * any person, and nothing about the number reaches the consumer — it is not
   * rendered, ranked, or described anywhere in the app. Two hazards being
   * ordered here says only which guide is displayed when a single notice
   * names both.
   *
   * The values reflect a presentation judgment about which guide a reader is
   * least well served by missing: guides whose authoritative sources direct
   * people toward urgent care (botulism 100, listeriosis 80, Shiga
   * toxin-producing E. coli 60, undeclared allergens 50) are shown ahead of
   * guides whose sources describe an illness people most often manage at home
   * (salmonellosis 40, hepatitis A 30, cyclosporiasis 20). No recorded notice
   * names two supported hazards today, so this has never chosen in practice.
   */
  displayPriority: number;
  /**
   * Case-insensitive matchers for the organism this guide covers, applied ONLY
   * to the canonical structured reason evidence (`pathogenOrAllergen` and
   * `reasonText`) — never to announcement prose. Empty for guides selected by
   * typed-reason family rather than by name.
   */
  match: readonly RegExp[];
  /**
   * The standardized risk statement: why exposure matters, in one or two
   * plain sentences.
   *
   * `null` on exactly one guide — the undeclared-allergen guide — whose risk
   * sentence must name the specific undeclared allergen and is therefore
   * produced by the existing approved allergen template in
   * lib/recall-display.ts. That template is deterministic, so the same
   * allergen still yields the same sentence on every recall.
   */
  risk: string | null;
  /**
   * Short "Common symptoms" bullets, or `null` where a symptom list is not
   * medically appropriate for the hazard family (foreign material, packaging
   * defects, regulatory-only issues). `null` is a real answer, not a gap:
   * forcing infection-shaped symptom copy onto a non-infectious hazard is a
   * correctness failure, not a coverage win.
   */
  symptoms: readonly string[] | null;
  /** Concise higher-risk-group statement, when the source states one. */
  higherRisk: string | null;
  source: HazardGuideSource;
}

/**
 * The reviewed guides. Listed in descending `displayPriority` for readability
 * only — selection reads the field, never array position.
 */
export const HAZARD_GUIDES: readonly HazardGuide[] = [
  {
    key: 'botulism',
    version: 1,
    displayPriority: 100,
    match: [
      /\bclostridium botulinum\b/i,
      /\bc\.\s?botulinum\b/i,
      /\bbotulinum\b/i,
      /\bbotulism\b/i,
    ],
    risk:
      'Botulism is a rare illness caused by a toxin that attacks the body’s nerves. ' +
      'It is life-threatening and needs emergency medical care right away.',
    symptoms: [
      'Double or blurred vision',
      'Drooping eyelids',
      'Slurred speech',
      'Difficulty swallowing',
      'Muscle weakness',
      'Difficulty breathing',
      'Nausea, vomiting, or stomach pain',
    ],
    // CDC identifies no lower-risk group for foodborne botulism.
    higherRisk: null,
    source: {
      organization: 'CDC',
      url: 'https://www.cdc.gov/botulism/signs-symptoms/index.html',
      reviewedOn: '2026-09-09',
    },
  },
  {
    key: 'listeria',
    version: 1,
    displayPriority: 80,
    match: [/\blisteria\b/i, /\blisteriosis\b/i],
    risk:
      'Listeria bacteria can cause a serious infection called listeriosis. During pregnancy, ' +
      'the infection can cause serious complications even when the pregnant person feels only ' +
      'mildly ill.',
    symptoms: [
      'Fever',
      'Muscle aches or fatigue',
      'Headache, stiff neck, or confusion',
      'Diarrhea or vomiting',
    ],
    higherRisk:
      'Pregnant people, newborns, adults 65 and older, and people with weakened immune systems ' +
      'are at much higher risk. Other people are rarely seriously ill.',
    source: {
      organization: 'CDC',
      url: 'https://www.cdc.gov/listeria/signs-symptoms/index.html',
      reviewedOn: '2026-09-10',
    },
  },
  {
    key: 'stec',
    version: 1,
    displayPriority: 60,
    match: [/\be\.\s?coli\b/i, /\bescherichia coli\b/i, /\bshiga toxin\b/i, /\bstec\b/i],
    risk:
      'Some kinds of E. coli produce a toxin that can cause severe illness. A small number of ' +
      'people go on to develop a dangerous kidney complication that needs emergency care.',
    symptoms: [
      'Diarrhea, which may be bloody',
      'Stomach cramps, which can be severe',
      'Vomiting',
      'A low fever',
    ],
    higherRisk:
      'Young children and adults 65 and older are more likely to develop severe complications.',
    source: {
      organization: 'CDC',
      url: 'https://www.cdc.gov/ecoli/signs-symptoms/index.html',
      reviewedOn: '2026-09-09',
    },
  },
  {
    key: 'undeclared-allergen',
    version: 1,
    displayPriority: 50,
    // Selected by typed-reason family (`allergen`), never by organism name.
    match: [],
    // Named per allergen by the approved template — see the `risk` doc above.
    risk: null,
    symptoms: [
      'Hives or flushed skin',
      'Tingling or swelling of the mouth, face, or throat',
      'Coughing or wheezing',
      'Trouble breathing',
      'Vomiting, diarrhea, or stomach cramps',
      'Dizziness or fainting',
    ],
    higherRisk:
      'Only people allergic or sensitive to the undeclared ingredient are at risk. A mild ' +
      'reaction in the past does not mean the next one will be mild, and a severe reaction ' +
      'needs emergency care.',
    source: {
      organization: 'FDA',
      url: 'https://www.fda.gov/food/buy-store-serve-safe-food/food-allergies-what-you-need-know',
      reviewedOn: '2026-09-09',
    },
  },
  {
    key: 'salmonella',
    version: 1,
    displayPriority: 40,
    match: [/\bsalmonella\b/i, /\bsalmonellosis\b/i],
    risk:
      'Salmonella bacteria can cause food poisoning. Most people recover on their own, but ' +
      'some infections are serious enough to need medical care.',
    symptoms: [
      'Diarrhea, which may be bloody',
      'Stomach cramps, which can be severe',
      'Fever',
      'Nausea or vomiting',
      'Headache',
    ],
    higherRisk:
      'Children under 5, adults 65 and older, and people with weakened immune systems are more ' +
      'likely to become seriously ill.',
    source: {
      organization: 'CDC',
      url: 'https://www.cdc.gov/salmonella/signs-symptoms/index.html',
      reviewedOn: '2026-09-10',
    },
  },
  {
    key: 'hepatitis-a',
    version: 1,
    displayPriority: 30,
    match: [/\bhepatitis a\b/i],
    risk:
      'Hepatitis A is a contagious infection of the liver. Most people recover completely, but ' +
      'it can cause serious illness.',
    symptoms: [
      'Feeling tired',
      'Fever',
      'Nausea, vomiting, or stomach pain',
      'Loss of appetite',
      'Yellow skin or eyes',
      'Dark urine or clay-colored stools',
      'Joint pain',
    ],
    higherRisk:
      'Older adults and people with other serious health problems, such as chronic liver ' +
      'disease, are more likely to become severely ill.',
    source: {
      organization: 'CDC',
      url: 'https://www.cdc.gov/hepatitis-a/about/index.html',
      reviewedOn: '2026-09-10',
    },
  },
  {
    key: 'cyclospora',
    version: 1,
    displayPriority: 20,
    match: [/\bcyclospora\b/i, /\bcyclosporiasis\b/i],
    risk:
      'Cyclospora is a parasite that can cause an intestinal illness, and symptoms may improve ' +
      'and then return.',
    symptoms: [
      'Watery diarrhea',
      'Loss of appetite and weight loss',
      'Stomach cramps or bloating',
      'Increased gas',
      'Nausea',
      'Feeling very tired',
    ],
    // CDC identifies no higher-risk group on the cited page.
    higherRisk: null,
    source: {
      organization: 'CDC',
      url: 'https://www.cdc.gov/cyclosporiasis/signs-symptoms/index.html',
      reviewedOn: '2026-09-10',
    },
  },
];

/** The guide covering undeclared allergens, selected by typed-reason family. */
export const ALLERGEN_GUIDE_KEY: HazardGuideKey = 'undeclared-allergen';

export function hazardGuideByKey(key: HazardGuideKey): HazardGuide | null {
  return HAZARD_GUIDES.find((guide) => guide.key === key) ?? null;
}
