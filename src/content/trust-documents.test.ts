/**
 * Documentation integrity (C7): the trust documents' important claims are
 * pinned to the implementation they describe. Each test does two things:
 * runs the REAL domain code on a fixture to prove the behavior, and asserts
 * the document states that behavior — so semantics and their consumer
 * explanation can only change together.
 *
 * Text assertions use short distinctive fragments, not whole sentences:
 * wording may be polished freely, but a claim cannot disappear or invert
 * without failing here.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isKnownAllergenMismatch } from '@/domain/allergen-only';
import { CONSUMER_ALLERGENS, type UserRecallPreferences } from '@/domain/preferences';
import { canonicalRetailerIds } from '@/domain/retailer-catalog';
import { evaluatePersonalRelevance, pushEligible, type RelevanceInput } from '@/lib/relevance';
import { RISK_FILTER_TIERS } from '@/lib/feed-filters';
import { RECENT_WINDOW_DAYS } from '@/lib/feed-relevance';
import { riskTierWord } from '@/lib/risk-display';
import { documentPlainText } from './document-model';
import { HOW_AFFECTS_ME_WORKS } from './how-affects-me-works';
import { RISK_LEVELS, SEVERITY_TIERS, UNCERTAINTY_TIERS } from './risk-levels';
import { SAFETY_DISCLAIMER } from './safety-disclaimer';
import { SOURCES_METHODOLOGY } from './sources-methodology';
import { ATTRIBUTIONS } from './attributions';
import { CORRECTIONS_POLICY } from './corrections-policy';
import { PRIVACY_DATA_CONTROLS } from './privacy-data-controls';
import { TRUST_DOCUMENTS } from './index';

const affectsMeText = documentPlainText(HOW_AFFECTS_ME_WORKS);
const riskText = documentPlainText(RISK_LEVELS);
const sourcesText = documentPlainText(SOURCES_METHODOLOGY);
const disclaimerText = documentPlainText(SAFETY_DISCLAIMER);
const allText = TRUST_DOCUMENTS.map(documentPlainText).join('\n');

function geography(
  scope: 'states' | 'nationwide' | 'unknown',
  states: string[] = [],
): RelevanceInput['geography'] {
  return { scope, states, confidence: 'stated', sourceText: null };
}

/** A general (non-allergen) hazard case for geographic fixtures. */
function generalHazard(geo: RelevanceInput['geography']): RelevanceInput {
  return {
    geography: geo,
    retailerNames: ['Costco'],
    hazardCategory: 'microbial',
    pathogenOrAllergen: 'Listeria monocytogenes',
    reasonText: 'Product Contamination',
  };
}

const CA_PREFS: UserRecallPreferences = {
  state: 'CA',
  allergens: ['peanut'],
  retailers: canonicalRetailerIds(['Costco']),
};

test('explicit geographic exclusion is final and documented — personal signals never override it', () => {
  // The fixture user matches on retailer (Costco) yet the notice states other
  // states only: excluded, exactly as the document claims.
  const excluded = evaluatePersonalRelevance(
    generalHazard(geography('states', ['Maine'])),
    CA_PREFS,
  );
  assert.equal(excluded.geographic, 'does_not_match');
  assert.equal(excluded.matchedRetailers.length, 1, 'fixture must actually match a retailer');
  assert.equal(excluded.affectsMe, false);
  assert.equal(excluded.reasons.length, 0, 'an excluded notice renders no personal reasons');

  assert.match(affectsMeText, /explicit geographic exclusion is final/i);
  assert.match(affectsMeText, /never overrides what the notice itself says/i);
});

test('nationwide behavior is documented correctly for both with- and without-state users', () => {
  const nationwide = generalHazard(geography('nationwide'));
  assert.equal(evaluatePersonalRelevance(nationwide, CA_PREFS).affectsMe, true);
  // Without a chosen state, nationwide alone is not a personal signal.
  const noState: UserRecallPreferences = { state: null, allergens: [], retailers: [] };
  assert.equal(evaluatePersonalRelevance(nationwide, noState).affectsMe, false);

  assert.match(affectsMeText, /nationwide notice affects every state/i);
  assert.match(affectsMeText, /once you have chosen a state/i);
  assert.match(affectsMeText, /only allergen and store matches appear/i);
});

test('unknown geography is never treated as "not you" — and the document says so', () => {
  const unknown = generalHazard(geography('unknown'));
  const relevance = evaluatePersonalRelevance(unknown, CA_PREFS);
  assert.equal(relevance.geographic, 'unknown');
  // Retailer signal qualifies it despite unknown geography.
  assert.equal(relevance.affectsMe, true);

  assert.match(affectsMeText, /Unknown is unknown/);
  assert.match(affectsMeText, /never treated as .not you./i);
});

test('the identified allergen-only mismatch is the one exclusion, exactly as documented', () => {
  const milkOnly: RelevanceInput = {
    geography: geography('states', ['California']),
    retailerNames: [],
    hazardCategory: 'allergen',
    pathogenOrAllergen: 'undeclared milk',
    reasonText: 'Unreported Allergens',
  };
  assert.equal(isKnownAllergenMismatch(milkOnly, ['peanut']), true);
  assert.equal(evaluatePersonalRelevance(milkOnly, CA_PREFS).affectsMe, false);
  // Selecting the named allergen includes it again — more allergens, more notices.
  assert.equal(
    evaluatePersonalRelevance(milkOnly, { ...CA_PREFS, allergens: ['peanut', 'milk'] }).affectsMe,
    true,
  );
  // An UNNAMED allergen never excludes.
  const unnamed: RelevanceInput = { ...milkOnly, pathogenOrAllergen: null };
  assert.equal(isKnownAllergenMismatch(unnamed, ['peanut']), false);
  assert.equal(evaluatePersonalRelevance(unnamed, CA_PREFS).affectsMe, true);

  assert.match(affectsMeText, /exactly one exclusion/i);
  assert.match(affectsMeText, /names which allergens/i);
  assert.match(affectsMeText, /without naming it, it is never excluded/i);
  assert.match(affectsMeText, /can only include more notices/i);
  assert.match(affectsMeText, /never fewer/i);
});

test('general hazards are never excluded by allergen preferences — and the document says so', () => {
  const general = generalHazard(geography('states', ['California']));
  assert.equal(isKnownAllergenMismatch(general, ['peanut']), false);
  assert.equal(evaluatePersonalRelevance(general, CA_PREFS).affectsMe, true);
  assert.match(affectsMeText, /any hazard beyond allergens is never excluded/i);
});

test('retailer matching never implies a purchase, and requires the notice to name the store', () => {
  assert.match(affectsMeText, /never knows or guesses what you actually bought/i);
  assert.match(affectsMeText, /no purchase history/i);
  assert.match(affectsMeText, /official notice itself states the product was sold/i);
  assert.match(affectsMeText, /no store flag never means/i);
  // No document may claim Recall LEARNED what you bought. The ban is on
  // inference and on any store of purchase data Recall assembled itself.
  //
  // AMENDED BY P1D (deliberate): this used to forbid the words "you bought"
  // outright, which was a sound proxy while the app could not receive a
  // purchase fact at all. A community shopper report is the one thing a
  // person can volunteer about a purchase — they write it themselves — so
  // the proxy is replaced by the claims it stood for, plus the requirement
  // below that the exception is disclosed rather than quietly true.
  for (const claim of [
    /based on your purchases/i,
    /your purchase history/i,
    /we know what you (bought|purchased)/i,
    /from your receipts/i,
    /track(ing|s)? your (purchases|shopping)/i,
  ]) {
    assert.doesNotMatch(allText, claim, `a document claims purchase knowledge: ${claim}`);
  }
  // The relevance claim stays absolute where it still is absolute…
  assert.match(affectsMeText, /no purchase history, no receipts, and no inference/i);
  // …and the one voluntary exception is named in the same breath, so the
  // trust documents cannot contradict the shopper-report feature.
  assert.match(affectsMeText, /shopper report you choose to submit/i);
  assert.match(affectsMeText, /never affects Affects Me/i);
});

test('All Recalls always remaining available is stated', () => {
  assert.match(affectsMeText, /All Recalls always remains available/i);
  assert.match(affectsMeText, /Everything excluded from Affects Me remains in All Recalls/i);
});

test('Affects Me is described as a shortlist, never a guarantee', () => {
  assert.match(affectsMeText, /shortlist/i);
  assert.match(affectsMeText, /not a guarantee of safety or completeness/i);
});

test('push delivery uses the same relevance result, including the no-state default', () => {
  const excluded = generalHazard(geography('states', ['Maine']));
  const matching = generalHazard(geography('states', ['California']));
  for (const input of [excluded, matching]) {
    assert.equal(
      pushEligible(input, CA_PREFS),
      evaluatePersonalRelevance(input, CA_PREFS).affectsMe,
    );
  }
  // No state chosen → delivery is not narrowed at all.
  assert.equal(pushEligible(excluded, { state: null, allergens: ['peanut'], retailers: [] }), true);

  assert.match(affectsMeText, /same relevance evaluation/i);
  assert.match(affectsMeText, /Until you choose a state, alerts are not narrowed/i);
});

test('the documented allergen vocabulary is exactly the canonical consumer set', () => {
  for (const option of CONSUMER_ALLERGENS) {
    assert.ok(
      affectsMeText.includes(option.label),
      `allergen "${option.label}" missing from the document`,
    );
  }
});

test('local-first preferences and the server mirror are described', () => {
  assert.match(affectsMeText, /saved on this device first/i);
  assert.match(affectsMeText, /synced to Recall.s server/i);
});

test('the risk document uses the canonical tier vocabulary, five levels + two states', () => {
  assert.deepEqual(SEVERITY_TIERS, ['critical', 'high', 'moderate', 'low', 'minimal']);
  assert.deepEqual(UNCERTAINTY_TIERS, ['pending', 'unrated']);
  assert.deepEqual([...SEVERITY_TIERS, ...UNCERTAINTY_TIERS], RISK_FILTER_TIERS);
  // Every canonical word appears, spelled by riskTierWord, never retyped.
  for (const tier of RISK_FILTER_TIERS) {
    assert.ok(riskText.includes(riskTierWord(tier)), `tier word "${riskTierWord(tier)}" missing`);
  }
});

test('Pending and Not rated are separated from the severity levels and never called low risk', () => {
  const fiveLevels = RISK_LEVELS.sections.find((s) => s.title === 'The five risk levels');
  const states = RISK_LEVELS.sections.find(
    (s) => s.title === 'Two states that are not risk levels',
  );
  assert.ok(fiveLevels && states, 'the two sections must exist separately');
  const levelItems = fiveLevels.blocks.flatMap((b) => (b.kind === 'bullets' ? b.items : []));
  assert.equal(levelItems.length, 5);
  for (const tier of UNCERTAINTY_TIERS) {
    assert.ok(
      !levelItems.some((item) => item.startsWith(riskTierWord(tier))),
      `${riskTierWord(tier)} must not be listed among the five levels`,
    );
  }
  assert.match(riskText, /not additional severity levels/i);
  assert.match(riskText, /neither means low risk/i);
});

test('the risk document defers to the official classification', () => {
  assert.match(riskText, /does not replace the official agency classification/i);
  assert.match(riskText, /classification is assigned, raised, lowered/i);
});

test('official source precedence and the per-notice official link are stated', () => {
  assert.match(sourcesText, /official notice controls/i);
  assert.match(sourcesText, /every notice links to its official government source/i);
  assert.match(disclaimerText, /official notice controls/i);
});

test('the recent/older display window matches the implementation', () => {
  assert.ok(sourcesText.includes(`within ${RECENT_WINDOW_DAYS} days`));
});

test('the disclaimer claims no affiliation and no endorsement — and no document contradicts it', () => {
  assert.match(disclaimerText, /not affiliated with, sponsored by, or endorsed by/i);
  // Every mention of endorsement anywhere must be a negation ("not…endorsed",
  // "does not imply…endorses") — an affirmative endorsement claim is banned.
  for (const doc of TRUST_DOCUMENTS) {
    for (const line of documentPlainText(doc).split('\n')) {
      if (/endors/i.test(line)) {
        assert.match(line, /\bnot\b/i, `affirmative endorsement wording in ${doc.slug}: ${line}`);
      }
    }
  }
  assert.doesNotMatch(allText, /official (FDA|USDA|government) app|on behalf of the (FDA|USDA)/i);
});

test('no medical-diagnosis or treatment claim exists anywhere', () => {
  assert.match(disclaimerText, /not medical advice/i);
  assert.match(disclaimerText, /does not provide diagnosis or treatment/i);
  assert.doesNotMatch(allText, /we (diagnose|treat)|medical advice for you|treatment plan/i);
});

test('the corrections policy promises no response times and no unreal support channel', () => {
  const correctionsText = documentPlainText(CORRECTIONS_POLICY);
  assert.match(correctionsText, /not available yet/i);
  assert.doesNotMatch(correctionsText, /within \d+|business days|hours of/i);
  assert.match(correctionsText, /never alters the authoritative government notice/i);
});

test('attributions document the actual integrations and no hypothetical ones', () => {
  const attributionsText = documentPlainText(ATTRIBUTIONS);
  assert.match(attributionsText, /U\.S\. Food and Drug Administration/);
  assert.match(attributionsText, /Food Safety and Inspection Service/);
  assert.match(attributionsText, /public domain/i);
  // Future integrations must not be documented as current data sources.
  assert.doesNotMatch(allText, /Open Food Facts|GS1|barcode database/i);
});

test('no document invents accounts, households, or child profiles', () => {
  const privacyText = documentPlainText(PRIVACY_DATA_CONTROLS);
  assert.match(privacyText, /works without an account/i);
  assert.doesNotMatch(allText, /create an account|sign (in|up)|household member|child profile/i);
});
