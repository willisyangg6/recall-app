/**
 * THE illness-status contract (P2B7K).
 *
 * ## Illnesses only
 *
 * This module answers exactly one shopper question: **did this recall's
 * official notice report illnesses?** It answers nothing else. Injuries,
 * adverse reactions, adverse events, hospitalizations and deaths get no
 * status of their own and no notice — they stay in `What Happened`, in the
 * source's own words, and `narrativeWithoutIllness` is written so they cannot
 * be removed from it (founder decision, P2B7K).
 *
 * Injury and adverse-reaction language is still recognised here, but only
 * defensively: a notice that denies injuries has NOT denied illnesses, and a
 * notice reporting one allergic reaction has NOT reported an illness. Without
 * that recognition both would be misread as illness facts, which is exactly
 * the defect the audit found in production.
 *
 * ## The four states
 *
 *   `reported_count`        a trustworthy count, exact or explicitly
 *                           approximate ("Approximately 12 illnesses reported")
 *   `reported_unspecified`  illness is confirmed, no trustworthy count
 *   `explicit_none`         the source explicitly denies ILLNESSES
 *   `unknown`               everything else — and it renders nothing at all
 *
 * `unknown` is the safety net, and it is deliberately large. Silence,
 * ambiguity, an injury-only statement, an adverse-reaction-only statement, a
 * hospitalization with no illness stated, and a count that cannot be
 * separated from another harm all land here, because each of them is a case
 * where the app does not know. `illnessNoticeCopy` returns `null` for it, so
 * no caller can render a row, a placeholder, or a zero.
 *
 * ## Why the audit forced this
 *
 * Measured on the live active corpus (docs/recall-illness-status.md §3), the
 * shipped path asserted "Illnesses have been reported." over sources that
 * DENY illnesses, and printed "No illnesses reported." over 150 sources that
 * denied something else entirely. Both are the app stating a fact the
 * official notice does not state, which is the one thing recall correctness
 * cannot tolerate.
 */

import { splitSentences } from './text';
import { DISEASE_NAME, isNonReportProse } from './illness';

export type IllnessStatusKind =
  'reported_count' | 'reported_unspecified' | 'explicit_none' | 'unknown';

export interface IllnessStatus {
  kind: IllnessStatusKind;
  /** The illness count. Non-null if and only if kind is `reported_count`. */
  illnesses: number | null;
  /** The source qualified the count ("approximately 470"). Never true without a count. */
  approximate: boolean;
  /**
   * The verbatim source sentences backing this status. Used to decide what
   * `What Happened` may drop; never rendered as the status itself.
   */
  statements: string[];
}

const UNKNOWN: IllnessStatus = {
  kind: 'unknown',
  illnesses: null,
  approximate: false,
  statements: [],
};

// ── Reading numbers ─────────────────────────────────────────────────────────

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
 * A written or numeric figure, or null when it cannot be trusted as a count.
 *
 * A bare four-digit number in 1900–2100 is rejected outright. Recall prose is
 * saturated with dates — "onset dates reported between July 24, 2022 and
 * September 19, 2022 with 5 hospitalization" reads `2022` as a count
 * otherwise — and no notice in the live corpus states an illness count that
 * large (the maximum is 470). A genuine four-digit count falls back to the
 * uncounted copy, which is conservative rather than wrong.
 */
function numberFrom(raw: string): number | null {
  const key = raw.toLowerCase();
  const word = NUMBER_WORDS[key];
  if (word !== undefined) return word;
  if (/^\d{4}$/.test(key) && Number(key) >= 1900 && Number(key) <= 2100) return null;
  const value = Number(key.replace(/,/g, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
}

const NUM = String.raw`(\d{1,4}(?:,\d{3})?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)`;

/**
 * Illness counts — numbers that directly count illnesses, sick people, or
 * case-patients, and nothing else.
 *
 * Widened past the shipped patterns by exactly the shapes the live corpus
 * proved were lost: "Four (4) illnesses", "92 instances of illness", "55
 * reports of illnesses", "12 recorded illnesses", "three case-patients", "two
 * cases of illness". "27 states", "120 cases (packages)", lot numbers and
 * dates never qualify.
 */
const ILLNESS_COUNT: RegExp[] = [
  new RegExp(
    String.raw`\b${NUM}\b(?:\s*\(\s*\d{1,4}\s*\))?\s+(?:\w+\s+){0,2}?(?:illness(?:es)?|case-patients?)\b`,
    'gi',
  ),
  new RegExp(
    String.raw`\b${NUM}\b\s+(?:\w+\s+){0,2}?(?:instances?|reports?|cases?)\s+of\s+(?:\w+\s+){0,3}?illness`,
    'gi',
  ),
  new RegExp(
    String.raw`\b${NUM}\b\s+(?:sick(?:ened)?\s+)?(?:people|persons?|individuals?)\b[^.]{0,80}?\b(?:infected|sickened|ill\b|illness)`,
    'gi',
  ),
  new RegExp(String.raw`\b${NUM}\b\s+sick\s+(?:people|persons?|individuals?)\b`, 'gi'),
  new RegExp(String.raw`\b${NUM}\b\s+cases?\s+of\s+illness\b`, 'gi'),
  // "3 cases of infant botulism", "nine cases of salmonellosis" — a count of
  // NAMED-DISEASE cases is a count of illnesses (P2B7L.2). Whether those
  // illnesses belong to THIS recall is a separate question, settled by
  // attribution below, so this pattern may safely read the figure.
  new RegExp(
    String.raw`\b${NUM}\b\s+(?:\w+\s+){0,2}?cases?\s+of\s+(?:\w+\s+){0,2}?${DISEASE_NAME}\b`,
    'gi',
  ),
];

/**
 * A figure that counts the records for which some DATUM IS KNOWN, not the
 * illnesses themselves.
 *
 * The FDA outbreak advisory for the ByHeart infant-formula recall states three
 * of these in two sentences:
 *
 *   "For 27 cases with illness ONSET INFORMATION AVAILABLE, illnesses started
 *    on dates ranging from August 9 to November 13, 2025."
 *   "For 23 infants with age and 24 infants with sex INFORMATION AVAILABLE…"
 *
 * The outbreak's own size in that notice is 31. `27` is the subset whose onset
 * date the investigators happen to hold, and displaying "27 illnesses reported"
 * quotes a real number of the source's against a fact it was never stated for —
 * the same class of error as reading a year as a count, and guarded the same
 * way.
 */
const AVAILABILITY_SUBSET =
  /\b(?:information|data)\s+(?:is\s+|was\s+|are\s+)?available\b|\bavailable\s+(?:\w+\s+){0,2}?(?:information|data)\b|\bfor\s+whom\s+data\b/i;

/** How far past a figure the availability qualifier may sit and still disown it. */
const AVAILABILITY_REACH = 60;

/**
 * A figure counting how many of the case-patients suffered a FURTHER harm —
 * "1 case-patient WAS HOSPITALIZED", "2 case-patients died". It counts a subset
 * of the illnesses, never the illnesses.
 *
 * Narrow on purpose. "9 illnesses, 8 hospitalizations, and 1 death" must keep
 * its 9: there the hospitalizations are a separate figure beside the illness
 * count, not a predicate on it. Only a number whose own noun phrase is the
 * SUBJECT of the further-harm verb is disowned.
 */
const FURTHER_HARM_SUBSET =
  /^\s*(?:\w+[-\s]){0,3}?(?:was|were|has been|have been)\s+(?:hospitali[sz]|died|hospitalized)/i;

/** How far past a figure its own verb may sit. */
const SUBSET_VERB_REACH = 40;

/**
 * One unambiguous count, or null. Two different numbers for the same fact
 * cannot be summed or chosen between without inventing a figure the source
 * never stated, so disagreement collapses to null.
 */
function countIn(text: string, patterns: RegExp[]): number | null {
  const found = new Set<number>();
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = numberFrom(match[1]);
      if (value === null) continue;
      // The figure counts records with a datum available, not illnesses.
      const trailing = text.slice(match.index, match.index + match[0].length + AVAILABILITY_REACH);
      if (AVAILABILITY_SUBSET.test(trailing)) continue;
      // The figure counts which of the case-patients were hospitalized or died.
      const after = text.slice(
        match.index + match[0].length,
        match.index + match[0].length + SUBSET_VERB_REACH,
      );
      if (FURTHER_HARM_SUBSET.test(after)) continue;
      found.add(value);
    }
  }
  return found.size === 1 ? [...found][0] : null;
}

/** "approximately 470 reports", "at least 9 illnesses" — unambiguous hedges. */
const APPROXIMATE_HEDGE =
  /\b(?:approximately|around|at least|more than|over|nearly|roughly|some)\s+(?:\d|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)/i;

/**
 * "about 12 illnesses" hedges a quantity. "provided information ABOUT 3 cases
 * of infant botulism" does not — there `about` is the preposition, and the
 * source states exactly three. Reading it as a hedge printed "Approximately 3
 * illnesses reported" over the Nara Organics notice (P2B7L.2), which is the app
 * adding uncertainty the source did not express.
 */
const APPROXIMATE_ABOUT =
  /(?<!\b(?:information|informed|informing|notified|notify|notice|notices|details?|data|reports?|reported|reporting|learned|told|concerns?|questions?|complaints?|inquir(?:y|ies))\s)\babout\s+(?:\d|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)/i;

/** Did the source qualify its own figure? */
function isApproximate(text: string): boolean {
  return APPROXIMATE_HEDGE.test(text) || APPROXIMATE_ABOUT.test(text);
}

/**
 * Two harm families joined in one phrase — "illness or adverse reactions",
 * "injury or illness".
 *
 * On its own this is harmless: "No illnesses or injuries have been reported"
 * denies illnesses perfectly clearly. It only becomes a problem when a NUMBER
 * is attached to the pair — "approximately 470 reports of illness or adverse
 * reactions" — because the illness share of that figure is not stated and
 * cannot be derived. `sharesFigureWithOtherHarm` below applies this only when
 * a count is present, so a shared denial still reads as a denial while a
 * shared count establishes no illness status at all (founder decision,
 * P2B7K) and stays in `What Happened` whole.
 */
const JOINED_HARMS =
  /\b(?:illness(?:es)?|sick)\b\s*(?:,\s*)?(?:or|and\/or|and)\s+(?:\w+\s+){0,2}?(?:adverse (?:reactions?|events?)|allergic reactions?|injur(?:y|ies)|reactions?)\b|\b(?:adverse (?:reactions?|events?)|allergic reactions?|injur(?:y|ies))\b\s*(?:,\s*)?(?:or|and\/or|and)\s+(?:\w+\s+){0,2}?(?:illness(?:es)?|sick)\b/i;

// ── Denial and assertion ────────────────────────────────────────────────────

/**
 * A clause that denies what follows. Broader than the shipped guard: it
 * accepts `not`/`never` as well as a standalone `no`, so "has not received
 * reports of illnesses" is a denial rather than a report.
 *
 * `neither` was added in P2B7L.2, off the repair dry run. Four live cases read
 * as REPORTS over a notice that denies illnesses outright — "Neither FSIS nor
 * the company received any reports of illnesses associated with consumption of
 * this product" — because `neither` is not `no`, `not`, `never` or `without`,
 * so the denial guard let the sentence through and the verb-leading assertion
 * pattern ("received … reports of … illness") then matched it word for word.
 * That is the §3.2 class: the app asserting the inverse of the official notice,
 * and the prepared repair was about to write it into storage.
 *
 * "no other/additional/further" is excluded here, and only here, so the
 * qualifier disqualifies its OWN denial and not every denial beside it in the
 * same sentence.
 */
const DENIAL_LEAD = String.raw`(?:\bno\b(?!\s+(?:other|additional|further)\b)|\bnot\b|\bnever\b|\bwithout\b|\bneither\b)`;

const DENIES_ILLNESS = new RegExp(
  String.raw`${DENIAL_LEAD}[^.]{0,80}?\b(?:illness(?:es)?|sickness(?:es)?|sickened|ill\b)`,
  'i',
);

/**
 * "No other illnesses have been reported", "FSIS has received no additional
 * reports of injury or illness" — a qualified none. It ESTABLISHES NOTHING on
 * its own: neither a report nor a denial (founder decision, P2B7L, superseding
 * the P2B7K reading below).
 *
 * P2B7K read this shape as PROOF that an illness occurred, on the reasoning
 * that "no other" presupposes a first one stated elsewhere on the page. That
 * reasoning holds for an outbreak notice. It does not hold for the sentence
 * FSIS actually publishes, which is closure boilerplate:
 *
 *   "FSIS has received no additional reports of injury or illness from
 *    consumption of these products."
 *
 * Measured read-only on the live corpus (docs/recall-illness-status.md §5.3),
 * 28 cases carry this shape and NONE of them states an illness anywhere else
 * once the qualifier sentence is removed. The sentence is ambiguous four ways:
 * "additional" may point back at an injury rather than an illness; "injury or
 * illness" is a disjunction that names neither; FSIS publishes it over notices
 * with no confirmed adverse reactions at all; and no independent illness
 * evidence accompanies it. Reading it as proof announced "Illnesses reported"
 * over 28 notices that report none.
 *
 * So it is inert, and the rest of the notice decides. A trustworthy illness
 * count stated in a DIFFERENT sentence still establishes that count — which is
 * what keeps a genuine outbreak's "no additional illnesses" from erasing the
 * figure the notice already gave. A count stated inside the qualifier sentence
 * itself also survives, because quoting a number the source wrote is not
 * manufacturing one; `qualifierEstablishesNothing` is what draws that line.
 */
const QUALIFIED_NONE_ILLNESS =
  /\bno\s+(?:other|additional|further)\b[^.]{0,60}?\b(?:illness(?:es)?|sick|case-patients?)\b/i;

/**
 * A qualified-none sentence carrying no illness figure of its own — so it
 * neither reports nor denies, and both `assertsIllness` and `deniesIllness`
 * must decline it (P2B7L).
 *
 * The count carve-out is deliberate and narrow: "no additional illnesses
 * beyond the 9 already reported" states 9 illnesses in the source's own words,
 * and dropping it would lose a real figure. "No additional reports of injury
 * or illness" states no figure at all, and is exactly the shape that must
 * establish nothing.
 */
function qualifierEstablishesNothing(sentence: string): boolean {
  return QUALIFIED_NONE_ILLNESS.test(sentence) && countIn(sentence, ILLNESS_COUNT) === null;
}

/**
 * Illness asserted without a count: "Illnesses have been reported",
 * "case-patients have been identified", "several illnesses", and the FDA
 * supplier-chain wording where the recall's own cause is an outbreak already
 * reported ("associated with reported salmonellosis illnesses").
 */
/**
 * Nouns that name HUMAN BEINGS (or the case records that stand for them). Used
 * to decide whether a sentence reports people rather than describing a product
 * or a pathogen — the thing that makes a report a report.
 */
const PEOPLE = String.raw`(?:case-patients?|cases?|people|persons?|individuals?|patients?|infants?|babies|children|consumers?|customers?)`;

const ASSERTS_ILLNESS: RegExp[] = [
  /\b(?:illness(?:es)?|sick people|case-patients?)\b[^.]{0,60}\b(?:have|has) been (?:reported|confirmed|identified|received)/i,
  /\b(?:several|multiple|numerous)\s+(?:\w+\s+){0,2}?illness(?:es)?\b/i,
  /\b(?:associated with|linked to)\b[^.]{0,40}\breported\b[^.]{0,40}\b(?:illness(?:es)?|salmonellosis|listeriosis)/i,
  /\b(?:outbreak|cluster)s?\s+of\b[^.]{0,60}\b(?:illness(?:es)?|infections?)\b/i,
  // "FSIS has received reports of illness associated with this product" — the
  // verb leads the noun, so the patterns above miss it. A denial of the same
  // shape ("has NOT received reports of illnesses") is rejected before this is
  // reached, by `DENIES_ILLNESS` in `assertsIllness`.
  /\b(?:receives?d?|there (?:have|has) been)\b[^.]{0,40}\breports?\s+of\b[^.]{0,30}\b(?:illness(?:es)?|sick)/i,
  // People, the named disease, and the agency's verb of record — the shape
  // the FDA outbreak advisories use when they never write "illness" at all
  // (P2B7L.2):
  //
  //   "a total of 31 infants with suspected or confirmed INFANT BOTULISM and
  //    confirmed exposure to ByHeart Whole Nutrition infant formula (various
  //    lots) HAVE BEEN REPORTED from 15 states"
  //
  // It needs all three parts. A disease name beside a verb of record but no
  // people ("Uneviscerated fish have been linked to outbreaks of botulism
  // poisoning") is a statement about a food, and stays inert.
  new RegExp(
    String.raw`\b${PEOPLE}\b[^.]{0,60}?\b${DISEASE_NAME}\b[^.]{0,120}?\b(?:have|has)\s+been\s+(?:reported|confirmed|identified)\b`,
    'i',
  ),
];

/**
 * The sentence hedges the LINK between this recall and the illnesses — "may
 * be associated with", "might be linked to", "possibly related".
 *
 * A hedged link is not a report about this product. The source is saying it
 * does not yet know, and `unknown` is the state for exactly that:
 *
 *   "Baloian initiated this recall after learning from SunFed Produce, LLC,
 *    that its supplier of American cucumbers, “Agrotato, S.A. de C.V.,” MAY BE
 *    ASSOCIATED WITH reported salmonellosis illnesses…"
 *
 * This hedges the association itself, which is why it is written against
 * `associated|linked|related|connected` rather than against `may` at large: a
 * notice may say a product "may be contaminated" and still report illnesses
 * plainly in the next sentence, and that report must still count.
 */
const HEDGED_LINKAGE =
  /\b(?:may|might|could)\s+(?:be\s+)?(?:associated|linked|related|connected)\b|\bpossibly\s+(?:associated|linked|related)\b|\bpotential(?:ly)?\s+link/i;

/**
 * The illnesses in this sentence belong to ANOTHER party's product — the
 * supplier's lot, the ingredient, the upstream recall this one follows from.
 *
 * The distinction the live corpus forced (P2B7L.1). Two FDA notices carry the
 * same clause, "the cucumbers described above were associated with reported
 * salmonellosis illnesses", and they mean different things:
 *
 *   SunFed's own notice recalls those cucumbers — the illnesses are the
 *   recalled product's, and it reports them.
 *
 *   Walmart's notice recalls cut cucumber SLICES that "MAY CONTAIN RECALLED
 *   whole cucumbers SUPPLIED BY SunFed… which initiated a recall after the FDA
 *   notified SunFed that the cucumbers described above were associated with
 *   reported salmonellosis illnesses". The illnesses are SunFed's whole
 *   cucumbers'; Walmart's own notice states none for the slices, and one of the
 *   two Walmart notices explicitly says so ("To date, no illnesses have been
 *   reported for the recalled Marketside Fresh Cut Cucumber Slices").
 *
 * Attributing the supplier's outbreak to the downstream recall would tell a
 * shopper this product made people ill when its own notice does not say that.
 * So a sentence whose illness clause is framed by supplier chain establishes
 * nothing, and the rest of the notice decides — which is what lets the
 * explicit denial in the Walmart notice be heard.
 *
 * Deliberately NOT a suppressor: "produced by", "manufactured by". FSIS names
 * the recalling establishment that way in the very sentence that links the
 * illnesses to it ("a link between the Listeria monocytogenes illnesses and
 * ready-to-eat pork products produced by Long Phung Foods"), and those are
 * genuine reports.
 */
const SUPPLIER_CHAIN =
  /\bsupplied by\b|\bits supplier\b|\bsupplier(?:'s)?\s+(?:lot|of)\b|\bmay contain\b[^.]{0,80}?\brecalled\b/i;

/**
 * People are stated to have fallen ill or to have EATEN the product. That is a
 * direct report about human beings, and it outranks the supply framing around
 * it.
 *
 * Needed because "supplied by" does not always name a third party — FSIS uses
 * it for the RECALLING establishment in the very sentence that reports the
 * victims:
 *
 *   "Traceback information was available for 5 case-patients and indicated
 *    that all 5 case-patients CONSUMED beef products SUPPLIED BY Adams Farms
 *    Slaughterhouse."
 *
 * Suppressing that as supplier prose would discard a report of five people who
 * ate the recalled beef. Distinguishing the two uses by firm identity is not
 * something this module can do, so it does not try: it asks instead whether
 * the sentence reports PEOPLE, which is the thing that makes a report a
 * report.
 */
const DIRECT_VICTIM = new RegExp(
  String.raw`\b${PEOPLE}\b[^.]{0,80}?\b(?:consumed|ate|became ill|fell ill|were sickened|sickened|reported (?:eating|consuming))`,
  'i',
);

/**
 * A count this sentence attaches to illness AND another harm at once, so the
 * illness share is unknowable. Only a sentence that actually carries a number
 * qualifies: joined wording alone ("no illnesses or injuries") is an ordinary
 * denial of both.
 */
function sharesFigureWithOtherHarm(sentence: string): boolean {
  return JOINED_HARMS.test(sentence) && countIn(sentence, ILLNESS_COUNT) !== null;
}

// ── Attribution: whose illnesses are these? ─────────────────────────────────

/**
 * The notice itself says the link between the product and the cases HAS NOT
 * BEEN ESTABLISHED.
 *
 *   "The FDA HAS NOT IDENTIFIED A DIRECT LINK between any infant formula and
 *    these cases and there is no historical precedent of infant formula
 *    causing infant botulism."
 *
 * This is the founder's rule for the ByHeart shape: an investigation exists,
 * cases exist, exposure exists, and the authority explicitly declines to
 * connect them. `unknown` is the state for that — NOT `explicit_none`. A
 * linkage denial denies a LINK, not an illness, and a notice that says nobody
 * has tied these cases to the product has not said the product caused none.
 * `deniesIllness` refuses it for exactly that reason.
 *
 * It is read over the WHOLE notice, not a window, because it is a statement
 * about the investigation rather than about the sentence beside it — and
 * because the ByHeart notice states it both before and after the case count,
 * which is precisely the order-dependence this milestone removes.
 */
const LINKAGE_DENIAL =
  /\b(?:has|have|had)\s+not\s+(?:yet\s+)?(?:been\s+)?(?:identified|established|found|determined|confirmed|linked)\b[^.]{0,60}?\b(?:link|linked|association|associated|connection)\b|\bno\s+(?:direct\s+|confirmed\s+|established\s+)?link\b/i;

/**
 * People are stated to have been EXPOSED to the recalled product — weaker than
 * having fallen ill from it, stronger than sharing a country with an outbreak.
 *
 *   "31 infants with suspected or confirmed infant botulism and CONFIRMED
 *    EXPOSURE TO ByHeart Whole Nutrition infant formula"
 *
 * Exposure ties the people to this product, so it is own evidence — unless the
 * notice carries a linkage denial, which is the authority saying that exposure
 * is exactly what has NOT been shown to explain the illnesses. That single
 * distinction is what separates the two live ByHeart notices: the November 7
 * one pairs "13 infants received ByHeart formula at some point" with the FDA's
 * no-direct-link statement and establishes nothing; the November 19 one drops
 * the disclaimer and writes "confirmed exposure", and reports.
 */
const EXPOSURE_ANCHOR = /\b(?:confirmed\s+|documented\s+|reported\s+)?exposure\s+to\b/i;

/**
 * The sentence ties the illnesses to THIS recall in its own words. Outranks
 * every frame above, including a linkage denial elsewhere in the notice: a
 * notice that explicitly links illnesses to its own product has reported them
 * whatever else it says.
 */
const OWN_LINKAGE =
  /\b(?:linked to|associated with|attributed to|traced (?:back )?to|in connection with)\b[^.]{0,80}?\b(?:this|these|the recalled|the affected|our)\b|\bconsumption of\s+(?:these|this|the recalled|the affected)\b/i;

/**
 * The sentence scopes its cases to the COUNTRY rather than to this recall —
 * the outbreak the notice is reporting about, not the outbreak it is reporting.
 *
 *   "an estimated 83 cases of infant botulism that were reported NATIONWIDE
 *    since August 2025"
 *
 * Read against the SENTENCE, never the framing window, and deliberately narrow.
 * "multistate outbreak" is not here: FSIS and FDA describe a recall's OWN
 * outbreak that way in the very sentence that counts its illnesses ("a
 * multistate outbreak of 28 Salmonella Hadar illnesses in 12 states"), and
 * "distributed nationwide" is ordinary distribution prose. Tested over the
 * whole 1,931-case table, no notice backs an illness status with a sentence
 * containing `nationwide`, so this costs nothing and closes the shape where a
 * national case count would otherwise be adopted as this product's.
 */
const NATIONAL_SCOPE = /\bnation(?:wide|ally)\b/i;

/** Where a sentence's illnesses belong. */
type Provenance = 'own' | 'elsewhere';

/**
 * A sentence that cannot stand on its own — the fragment a punctuation split
 * leaves behind.
 *
 * A well-formed sentence in this corpus opens with a capitalised subject
 * ("Twelve illnesses and one death have been reported to date", "Based on
 * epidemiological investigation, one case-patient has been identified"). A
 * fragment opens lowercase, or with a relative pronoun or a bare conjunction,
 * because the clause it belongs to is upstream.
 *
 * That difference is the whole segmentation fix. Framing reaches forward across
 * a split ONLY into a continuation, so recombining the halves and leaving them
 * apart give the same reading, while a self-contained report standing next to
 * unrelated supplier prose keeps its own subject.
 *
 * Measured: a purely positional window (any preceding sentence frames the next)
 * silenced seven genuine reports in the live corpus, among them "Twelve
 * illnesses and one death have been reported to date", which merely happened to
 * follow a sentence naming the firm's supplier. Adjacency is not framing.
 */
const CONTINUATION_LOWERCASE = /^[a-z]/;
const CONTINUATION_WORD = /^(?:which|who|whom|whose|that|and|but|or|nor)\b/i;

function isContinuation(sentence: string): boolean {
  return CONTINUATION_LOWERCASE.test(sentence) || CONTINUATION_WORD.test(sentence);
}

/**
 * The candidate sentence, prefixed by the clause it was split out of.
 *
 * Walks back through consecutive continuations, so a clause broken into three
 * pieces is reassembled as surely as one broken into two, with no window size
 * to tune.
 */
function framingContext(sentences: readonly string[], index: number): string {
  let start = index;
  while (start > 0 && isContinuation(sentences[start])) start -= 1;
  return sentences.slice(start, index + 1).join(' ');
}

/**
 * Whose illnesses a sentence is reporting.
 *
 * Attribution is a property of the EVIDENCE, not a tie-break between rival
 * answers. Evidence attributed elsewhere is discarded rather than outranked, so
 * a supplier's outbreak cannot beat the recalling firm's own denial — and,
 * equally, a denial never beats an own-product report, which is what keeps "we
 * reported 9 illnesses; no additional illnesses since" positive.
 */
function provenanceOf(sentence: string, frame: string, noticeDeniesLinkage: boolean): Provenance {
  // People who ate the product or fell ill from it, or an explicit link the
  // notice draws itself. Nothing downgrades these.
  if (DIRECT_VICTIM.test(sentence) || OWN_LINKAGE.test(sentence)) return 'own';
  // The authority says the link is not established: exposure and background
  // both stop being this recall's evidence.
  if (noticeDeniesLinkage) return 'elsewhere';
  if (EXPOSURE_ANCHOR.test(sentence)) return 'own';
  // Cases counted for the country, with nothing tying them to this product.
  if (NATIONAL_SCOPE.test(sentence)) return 'elsewhere';
  if (SUPPLIER_CHAIN.test(frame) || HEDGED_LINKAGE.test(frame)) return 'elsewhere';
  return 'own';
}

/**
 * Does this sentence positively assert an illness (as opposed to denying one)?
 *
 * Attribution is NOT asked here any more (P2B7L.2). This predicate answers only
 * "is this a positive illness statement?", and `provenanceOf` separately answers
 * "about whom?". Keeping them apart is what makes the evidence orderable by
 * subject instead of by position.
 */
function assertsIllness(sentence: string): boolean {
  if (sharesFigureWithOtherHarm(sentence)) return false;
  // A linkage denial is a statement about what has NOT been shown. It asserts
  // nothing, and (see `deniesIllness`) it denies nothing either.
  if (LINKAGE_DENIAL.test(sentence)) return false;
  // A qualified none with no figure of its own asserts nothing (P2B7L). This
  // must come before ASSERTS_ILLNESS below, whose verb-leading pattern
  // ("...has received ... reports of ... illness") matches the FSIS closure
  // boilerplate word for word — DENIES_ILLNESS cannot reject it, because
  // `no other/additional/further` is deliberately excluded from DENIAL_LEAD.
  if (qualifierEstablishesNothing(sentence)) return false;
  if (DENIES_ILLNESS.test(sentence)) return false;
  if (countIn(sentence, ILLNESS_COUNT) !== null) return true;
  return ASSERTS_ILLNESS.some((pattern) => pattern.test(sentence));
}

/**
 * Does this sentence explicitly deny ILLNESSES — not some other harm?
 *
 * FSIS's dominant allergen boilerplate is "There have been no confirmed
 * reports of adverse reactions due to consumption of these products", which
 * says nothing whatever about illnesses. 150 active cases were being shown
 * "No illnesses reported." on the strength of a sentence like that, and this
 * predicate is what makes that unreachable: only an illness word, denied,
 * counts.
 */
function deniesIllness(sentence: string): boolean {
  // Unchanged in effect, stated through the shared predicate: a qualified none
  // is not a denial either, whether or not it carries a figure.
  if (QUALIFIED_NONE_ILLNESS.test(sentence)) return false;
  if (sharesFigureWithOtherHarm(sentence)) return false;
  // "The FDA has not identified a direct link between any infant formula and
  // these cases" denies a LINK, not an illness. Reading it as a denial would
  // print "No illnesses reported" over an active outbreak investigation
  // (founder decision, P2B7L.2).
  if (LINKAGE_DENIAL.test(sentence)) return false;
  return DENIES_ILLNESS.test(sentence);
}

/**
 * Does this sentence speak about harm at all — in any family?
 *
 * Used only to find the sentences worth reading. A sentence that mentions an
 * injury or an adverse reaction is examined and then, correctly, produces no
 * illness status; that is different from never looking at it.
 *
 * Disease NAMES were added in P2B7L.2 and are eligibility only. The FDA states
 * the infant-formula outbreak's linked cases without ever writing "illness" —
 * "31 infants with suspected or confirmed infant botulism … have been reported"
 * — so gating on the generic harm words alone made the report unreadable.
 * Becoming eligible means only that a sentence is LOOKED AT; education,
 * attribution and denial all still decide what it establishes.
 */
const MENTIONS_HARM = new RegExp(
  String.raw`\b(?:illness(?:es)?|ill|sick(?:ened)?|case-patients?|infected|adverse (?:reactions?|events?|health events?|health effects?)|allergic reactions?|injur(?:y|ies)|hospitali[sz]\w*|deaths?|fatalit(?:y|ies)|` +
    DISEASE_NAME +
    String.raw`)\b`,
  'i',
);

// ── Derivation ──────────────────────────────────────────────────────────────

/**
 * Derive the illness status of ONE notice from its summary prose.
 *
 * Three passes, in this order and for this reason:
 *
 *   1. ELIGIBILITY — advice, hazard education and discovery prose are dropped,
 *      through the predicate shared with `domain/illness.ts`, so "Salmonella
 *      can cause serious illness" cannot become a report in one module and
 *      education in the other.
 *   2. ATTRIBUTION — each surviving positive statement is assigned to this
 *      recall or to somewhere else, from the framing its neighbourhood
 *      establishes. Evidence attributed elsewhere is DISCARDED here, not
 *      weighed later.
 *   3. RESOLUTION — an own-product report wins; otherwise an own-product
 *      denial; otherwise nothing is known.
 *
 * Because attribution happens before resolution, the answer does not depend on
 * which statement came first, and — because framing reaches across sentence
 * boundaries — it does not depend on how the prose was punctuated either.
 */
export function deriveIllnessStatus(summaryText: string | null): IllnessStatus {
  if (!summaryText) return UNKNOWN;

  const sentences = splitSentences(summaryText);
  const eligible: { sentence: string; frame: string }[] = [];
  for (const [index, sentence] of sentences.entries()) {
    if (isNonReportProse(sentence) || !MENTIONS_HARM.test(sentence)) continue;
    eligible.push({ sentence, frame: framingContext(sentences, index) });
  }
  if (eligible.length === 0) return UNKNOWN;

  // A statement about what the investigation has NOT shown, made anywhere in
  // the notice. Read whole-notice on purpose: it is not a property of its
  // neighbours, and the notice that motivated it states it on both sides of
  // the evidence.
  const noticeDeniesLinkage = sentences.some((sentence) => LINKAGE_DENIAL.test(sentence));

  const asserted = eligible
    .filter(({ sentence }) => assertsIllness(sentence))
    .filter(({ sentence, frame }) => provenanceOf(sentence, frame, noticeDeniesLinkage) === 'own')
    .map(({ sentence }) => sentence);

  if (asserted.length > 0) {
    const text = asserted.join(' ');
    // `assertsIllness` already rejected a figure shared with another harm, so
    // a surviving count counts illnesses and nothing else.
    const count = countIn(text, ILLNESS_COUNT);
    return {
      kind: count === null ? 'reported_unspecified' : 'reported_count',
      illnesses: count,
      approximate: count !== null && isApproximate(text),
      statements: asserted.slice(0, 3),
    };
  }

  // Denials are never re-attributed. A firm that denies illnesses for its own
  // product is denying them however it describes its supply chain, and losing
  // that denial would turn an `explicit_none` into silence — the opposite of
  // the conservative direction.
  const denials = eligible
    .filter(({ sentence }) => deniesIllness(sentence))
    .map(({ sentence }) => sentence);
  if (denials.length > 0) {
    return {
      kind: 'explicit_none',
      illnesses: null,
      approximate: false,
      statements: denials.slice(0, 2),
    };
  }

  // Everything else is unknown, including a sentence that denies or reports
  // only injuries, adverse reactions, hospitalizations or deaths. Those are
  // real facts and they stay in the narrative; they are simply not an illness
  // status, and inventing one from them is the defect this returns to avoid.
  return UNKNOWN;
}

/**
 * Resolve the status of a CASE from its linked notices, newest first.
 *
 * Two rules, both biased toward not un-saying a reported illness:
 *
 *   1. Silence never supersedes. A later notice that says nothing about
 *      illnesses leaves an earlier report standing — an update about
 *      packaging does not retract an outbreak.
 *   2. A denial never supersedes a report. If the newest establishing notice
 *      denies illnesses but an older linked notice reported them, the result
 *      is `reported_unspecified` carrying both statements, never
 *      `explicit_none`. Telling a shopper "no illnesses" over an official
 *      notice that reported some is the failure this rule exists to prevent;
 *      the contradicted count is dropped rather than guessed.
 *
 * A later report with a larger count supersedes normally: outbreak counts
 * grow, and the newest notice is the authority on the number.
 */
export function resolveIllnessStatus(newestFirst: readonly IllnessStatus[]): IllnessStatus {
  const establishing = newestFirst.filter((status) => status.kind !== 'unknown');
  if (establishing.length === 0) return UNKNOWN;

  const [newest, ...older] = establishing;
  if (newest.kind !== 'explicit_none') return newest;

  const contradicted = older.find((status) => status.kind !== 'explicit_none');
  if (!contradicted) return newest;

  return {
    kind: 'reported_unspecified',
    illnesses: null,
    approximate: false,
    statements: [...contradicted.statements, ...newest.statements].slice(0, 3),
  };
}

/**
 * Whether the canonical `reportsIllness` flag is true for this status.
 *
 * TRUE only for confirmed illness — a trustworthy count, or illness reported
 * without one. FALSE for an explicit denial, for silence, and for every
 * injury, adverse-reaction, hospitalization, death, educational and
 * hypothetical statement, none of which reach a `reported_*` kind.
 *
 * This is the flag that drives material-change detection and, when push is
 * eventually activated, the `health_impact` notification. It must never be
 * true for a recall whose notice does not report an illness.
 */
export function statusReportsIllness(status: IllnessStatus): boolean {
  return status.kind === 'reported_count' || status.kind === 'reported_unspecified';
}

// ── Shopper copy ────────────────────────────────────────────────────────────

export interface IllnessNoticeCopy {
  /** The visible sentence. */
  text: string;
  /** What a screen reader speaks for the whole notice, as one utterance. */
  spoken: string;
  /** Which glyph and treatment the notice takes. */
  tone: 'reported' | 'none';
}

/**
 * THE copy for the compact illness notice, or null when nothing may be shown.
 *
 * Null is returned for `unknown`, and only for `unknown`. There is no unknown
 * sentence, no placeholder, no em dash: the source did not establish illness
 * status, so the notice does not render. A caller that wants a row for every
 * recall cannot get one from here.
 *
 * The word "yet" appears nowhere. "No illnesses reported yet" predicts
 * illnesses the source never predicted (founder decision).
 */
export function illnessNoticeCopy(status: IllnessStatus): IllnessNoticeCopy | null {
  switch (status.kind) {
    case 'unknown':
      return null;

    case 'explicit_none':
      return { text: 'No illnesses reported', spoken: 'No illnesses reported.', tone: 'none' };

    case 'reported_unspecified':
      return {
        text: 'Illnesses reported',
        spoken: 'Illnesses reported. The notice does not give a count.',
        tone: 'reported',
      };

    case 'reported_count': {
      const count = status.illnesses!;
      const noun = count === 1 ? 'illness' : 'illnesses';
      const text = status.approximate
        ? `Approximately ${count} ${noun} reported`
        : `${count} ${noun} reported`;
      return { text, spoken: `${text}.`, tone: 'reported' };
    }
  }
}

// ── What Happened de-duplication ────────────────────────────────────────────

/**
 * Facts a sentence carries that the illness notice does NOT display.
 *
 * The notice shows an illness count, or the bare fact that illnesses were
 * reported. Everything below is something it cannot show, so a sentence
 * carrying any of it must survive in the narrative.
 */
const UNDISPLAYED_FACT: [string, RegExp][] = [
  ['hospitalization', /\bhospitali[sz]\w*/i],
  ['death', /\b(?:deaths?|died|fatalit(?:y|ies))\b/i],
  ['injury', /\binjur(?:y|ies)\b/i],
  [
    'adverse reaction',
    /\badverse (?:reactions?|events?|health events?|health effects?)|allergic reactions?/i,
  ],
  // A qualification the notice's own copy does not reproduce: onset windows,
  // states, investigations, suspicion, and any hedge on the link itself.
  [
    'qualification',
    /\b(?:onset|under investigation|investigating|allegedly|may be|possibly|suspects?|suspected|epidemiolog\w*|traceback|in \d{1,2} states|from \d{1,2} states)\b/i,
  ],
];

/** Which undisplayed facts this sentence carries. */
function undisplayedFactsIn(sentence: string): string[] {
  return UNDISPLAYED_FACT.filter(([, pattern]) => pattern.test(sentence)).map(([name]) => name);
}

/**
 * The `What Happened` narrative with the illness sentence removed — but only
 * when the notice completely represents that illness fact.
 *
 * A sentence is dropped only when ALL of these hold:
 *
 *   1. a notice renders at all (`unknown` drops nothing);
 *   2. the sentence is one of the sentences backing the status;
 *   3. the sentence carries NO fact the notice cannot display — no
 *      hospitalization, death, injury, adverse reaction, or qualification.
 *
 * Clause (3) is the whole safety property. "To date, there have been 9
 * illnesses, 8 hospitalizations, and 1 death linked to the soft cheese
 * products" is never dropped, because the notice shows only the 9. Showing an
 * illness count twice is a blemish; taking a death out of the app is a
 * correctness failure, and the founder's rule is explicit that
 * hospitalization, death, injury and adverse-event information is never
 * deleted.
 *
 * WHAT THIS DOES NOT ESTABLISH (measured, P2B7Q). Clause (3) can only PRESERVE
 * a sentence the narrative already contains, and over the whole 1,931-case
 * table the narrative contains none: `buildWhatHappened` composes it from
 * structured slots, so this function is a no-op on every recorded case. It is
 * therefore not the reason a hospitalization or a death is safe — nothing is,
 * today. Of the 898 active consumer-visible cases, 8 have a notice that
 * affirms a hospitalization or a death and not one of them shows it anywhere.
 * See docs/recall-illness-status.md §1.2.
 *
 * Sentences that are not backing statements — why the recall happened, where
 * the product went, how much was recalled — are never candidates. If removal
 * would empty the narrative it is kept whole: the notice states a status, it
 * does not explain a recall.
 */
export function narrativeWithoutIllness(narrative: string, status: IllnessStatus): string {
  if (status.kind === 'unknown' || status.statements.length === 0) return narrative;

  const backing = new Set(status.statements.map(normalize));
  const sentences = splitSentences(narrative);
  const kept = sentences.filter((sentence) => {
    if (!backing.has(normalize(sentence))) return true;
    return undisplayedFactsIn(sentence).length > 0;
  });

  // Nothing was dropped, so hand back the ORIGINAL text rather than a
  // re-joined copy of it. Rebuilding collapses the source's own spacing and
  // line breaks, which would make every narrative in the corpus look edited
  // and make "was anything removed?" impossible to answer by comparison.
  if (kept.length === sentences.length) return narrative;
  if (kept.length === 0) return narrative;
  const rebuilt = kept.join(' ').trim();
  return rebuilt === '' ? narrative : rebuilt;
}

/**
 * Whether the narrative still states the illness fact the notice shows.
 *
 * True when a backing sentence had to be kept for a fact the notice cannot
 * display — the deliberate, safe duplication above. Exposed so the
 * presentation contract and its tests can reason about it rather than
 * rediscovering it by string comparison.
 */
export function narrativeKeepsIllnessSentence(narrative: string, status: IllnessStatus): boolean {
  if (status.kind === 'unknown' || status.statements.length === 0) return false;
  const backing = new Set(status.statements.map(normalize));
  return splitSentences(narrative).some(
    (sentence) => backing.has(normalize(sentence)) && undisplayedFactsIn(sentence).length > 0,
  );
}

function normalize(sentence: string): string {
  return sentence.replace(/\s+/g, ' ').trim().toLowerCase();
}
