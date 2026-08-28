import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { UserRecallPreferences } from '@/domain/preferences';
import type { Geography } from '@/domain/recall-types';
import { evaluatePersonalRelevance, pushEligible, type RelevanceInput } from './relevance';

function geo(scope: Geography['scope'], states: string[] = []): Geography {
  return { scope, states, confidence: 'stated', sourceText: null };
}

function item(overrides: Partial<RelevanceInput> = {}): RelevanceInput {
  return {
    geography: geo('unknown'),
    pathogenOrAllergen: null,
    retailerNames: [],
    // A general hazard by default: these cases test geography and positive
    // signals, and the allergen-only rule must not silently rewrite them.
    hazardCategory: 'unknown',
    reasonText: null,
    ...overrides,
  };
}

function prefs(overrides: Partial<UserRecallPreferences> = {}): UserRecallPreferences {
  return { state: null, allergens: [], retailers: [], ...overrides };
}

/** The §35 example user: California; Sesame + Peanuts; Costco + Trader Joe's. */
const CALIFORNIAN = prefs({
  state: 'CA',
  allergens: ['sesame', 'peanut'],
  retailers: ['costco', 'trader-joes'],
});

// ── Geographic relevance semantics ───────────────────────────────────────────

test('nationwide matches every selected state', () => {
  const r = evaluatePersonalRelevance(item({ geography: geo('nationwide') }), CALIFORNIAN);
  assert.equal(r.geographic, 'matches');
  assert.equal(r.affectsMe, true);
  assert.deepEqual(
    r.reasons.map((reason) => reason.kind),
    ['nationwide'],
  );
});

test('explicit state list containing the home state matches', () => {
  const r = evaluatePersonalRelevance(
    item({ geography: geo('states', ['California', 'Nevada']) }),
    CALIFORNIAN,
  );
  assert.equal(r.geographic, 'matches');
  assert.equal(r.affectsMe, true);
  assert.deepEqual(r.reasons, [{ kind: 'state', label: 'Affects California' }]);
});

test('an authoritative state list without the home state is does_not_match', () => {
  const r = evaluatePersonalRelevance(item({ geography: geo('states', ['Maine']) }), CALIFORNIAN);
  assert.equal(r.geographic, 'does_not_match');
  assert.equal(r.affectsMe, false);
  assert.deepEqual(r.reasons, []);
});

test('unknown distribution stays unknown — never does_not_match', () => {
  const r = evaluatePersonalRelevance(item({ geography: geo('unknown') }), CALIFORNIAN);
  assert.equal(r.geographic, 'unknown');
  assert.equal(r.affectsMe, false);
  // No personal signal: no reasons at all — the UI never claims non-relevance.
  assert.deepEqual(r.reasons, []);
});

test('a states-list case with no chosen state is unknown, not a match either way', () => {
  const r = evaluatePersonalRelevance(
    item({ geography: geo('states', ['California']) }),
    prefs({ allergens: ['sesame'] }),
  );
  assert.equal(r.geographic, 'unknown');
});

// ── Allergen match semantics ─────────────────────────────────────────────────

test('exact major allergen match (undeclared sesame → Sesame preference)', () => {
  const r = evaluatePersonalRelevance(
    item({
      geography: geo('states', ['California']),
      pathogenOrAllergen: 'undeclared sesame',
    }),
    CALIFORNIAN,
  );
  assert.deepEqual(r.matchedAllergens, ['sesame']);
  assert.equal(r.reasons[0].kind, 'allergen');
  assert.equal(r.reasons[0].label, 'Your allergen · Sesame');
});

test('a specific tree nut matches a Tree nuts preference', () => {
  const r = evaluatePersonalRelevance(
    item({ pathogenOrAllergen: 'undeclared cashews' }),
    prefs({ state: 'CA', allergens: ['tree nuts'] }),
  );
  assert.deepEqual(r.matchedAllergens, ['tree nuts']);
});

test('specific fish and crustacean shellfish map to their groups', () => {
  const fish = evaluatePersonalRelevance(
    item({ pathogenOrAllergen: 'undeclared fish' }),
    prefs({ state: 'CA', allergens: ['fish'] }),
  );
  assert.deepEqual(fish.matchedAllergens, ['fish']);
  const shellfish = evaluatePersonalRelevance(
    item({ pathogenOrAllergen: 'undeclared crustacean shellfish' }),
    prefs({ state: 'CA', allergens: ['shellfish'] }),
  );
  assert.deepEqual(shellfish.matchedAllergens, ['shellfish']);
});

test('a pathogen recall never produces an allergen match', () => {
  const r = evaluatePersonalRelevance(
    item({ geography: geo('nationwide'), pathogenOrAllergen: 'Salmonella' }),
    CALIFORNIAN,
  );
  assert.deepEqual(r.matchedAllergens, []);
  // …and the recall is NOT thereby irrelevant: geography still matches.
  assert.equal(r.affectsMe, true);
});

test('multiple selected allergens all match, in canonical display order', () => {
  const r = evaluatePersonalRelevance(
    item({ pathogenOrAllergen: 'undeclared sesame and peanuts' }),
    CALIFORNIAN,
  );
  assert.deepEqual(r.matchedAllergens, ['peanut', 'sesame']);
});

// ── Retailer match semantics ─────────────────────────────────────────────────

test('canonical retailer match: stated Costco matches a Costco preference', () => {
  const r = evaluatePersonalRelevance(item({ retailerNames: ['Costco'] }), CALIFORNIAN);
  assert.deepEqual(r.matchedRetailers, ['costco']);
  assert.equal(r.reasons.find((reason) => reason.kind === 'retailer')?.label, 'Sold at Costco');
});

test('alias forms resolve to the same identity (Costco Wholesale, Trader Joes)', () => {
  const r = evaluatePersonalRelevance(
    item({ retailerNames: ['Costco Wholesale', 'Trader Joes'] }),
    CALIFORNIAN,
  );
  assert.deepEqual(r.matchedRetailers, ['costco', 'trader-joes']);
});

test('an unrelated retailer does not match, and unknown retailers match nothing', () => {
  const unrelated = evaluatePersonalRelevance(item({ retailerNames: ['Walmart'] }), CALIFORNIAN);
  assert.deepEqual(unrelated.matchedRetailers, []);
  const unknown = evaluatePersonalRelevance(item({ retailerNames: [] }), CALIFORNIAN);
  assert.deepEqual(unknown.matchedRetailers, []);
});

test('an ambiguous alias stays unmatched (bare "Giant")', () => {
  const r = evaluatePersonalRelevance(
    item({ retailerNames: ['Giant'] }),
    prefs({ state: 'CA', retailers: ['giant-food', 'giant-company'] }),
  );
  assert.deepEqual(r.matchedRetailers, []);
});

test('retailer absence is not exclusion: state match still qualifies', () => {
  const r = evaluatePersonalRelevance(
    item({ geography: geo('states', ['California']), retailerNames: ['Walmart'] }),
    CALIFORNIAN,
  );
  assert.equal(r.affectsMe, true);
  // §35 F: no Costco reason invented — only the true state reason.
  assert.deepEqual(
    r.reasons.map((reason) => reason.kind),
    ['state'],
  );
});

// ── The §35 Affects Me matrix ────────────────────────────────────────────────

test('matrix A: nationwide Salmonella → yes, reason Nationwide', () => {
  const r = evaluatePersonalRelevance(
    item({ geography: geo('nationwide'), pathogenOrAllergen: 'Salmonella' }),
    CALIFORNIAN,
  );
  assert.equal(r.affectsMe, true);
  assert.deepEqual(r.reasons, [{ kind: 'nationwide', label: 'Nationwide recall' }]);
});

test('matrix B: California-only undeclared sesame → yes, California + Sesame', () => {
  const r = evaluatePersonalRelevance(
    item({ geography: geo('states', ['California']), pathogenOrAllergen: 'undeclared sesame' }),
    CALIFORNIAN,
  );
  assert.equal(r.affectsMe, true);
  assert.deepEqual(
    r.reasons.map((reason) => reason.label),
    ['Your allergen · Sesame', 'Affects California'],
  );
});

test('matrix C: Texas-only undeclared sesame → no; geographic exclusion wins', () => {
  const r = evaluatePersonalRelevance(
    item({ geography: geo('states', ['Texas']), pathogenOrAllergen: 'undeclared sesame' }),
    CALIFORNIAN,
  );
  assert.equal(r.affectsMe, false);
  assert.equal(r.geographic, 'does_not_match');
  // The match exists internally but never overrides authoritative exclusion.
  assert.deepEqual(r.matchedAllergens, ['sesame']);
  assert.deepEqual(r.reasons, []);
});

test('matrix D: unknown geography + Costco → yes, with unknown-location context', () => {
  const r = evaluatePersonalRelevance(item({ retailerNames: ['Costco'] }), CALIFORNIAN);
  assert.equal(r.affectsMe, true);
  assert.deepEqual(
    r.reasons.map((reason) => reason.label),
    ['Sold at Costco', 'Location not specified'],
  );
});

test('matrix E: unknown geography + no personal signal → not in the primary list', () => {
  const r = evaluatePersonalRelevance(item(), CALIFORNIAN);
  assert.equal(r.affectsMe, false);
  assert.equal(r.geographic, 'unknown');
});

test('matrix G: New York only + Costco → no; exclusion beats the retailer match', () => {
  const r = evaluatePersonalRelevance(
    item({ geography: geo('states', ['New York']), retailerNames: ['Costco'] }),
    CALIFORNIAN,
  );
  assert.equal(r.affectsMe, false);
  assert.deepEqual(r.matchedRetailers, ['costco']);
  assert.deepEqual(r.reasons, []);
});

test('matrix H: nationwide + unrelated allergen and retailer → yes', () => {
  const r = evaluatePersonalRelevance(
    item({
      geography: geo('nationwide'),
      pathogenOrAllergen: 'undeclared milk',
      retailerNames: ['Walmart'],
    }),
    CALIFORNIAN,
  );
  assert.equal(r.affectsMe, true);
  assert.deepEqual(r.reasons, [{ kind: 'nationwide', label: 'Nationwide recall' }]);
});

// ── Partial and empty preference configurations ──────────────────────────────

test('no preferences at all: nothing affects me, nothing matches', () => {
  const r = evaluatePersonalRelevance(item({ geography: geo('nationwide') }), prefs());
  assert.equal(r.affectsMe, false);
  assert.deepEqual(r.matchedAllergens, []);
  assert.deepEqual(r.matchedRetailers, []);
});

test('state only: geography drives everything', () => {
  const only = prefs({ state: 'TX' });
  assert.equal(
    evaluatePersonalRelevance(item({ geography: geo('states', ['Texas']) }), only).affectsMe,
    true,
  );
  assert.equal(
    evaluatePersonalRelevance(item({ geography: geo('states', ['Maine']) }), only).affectsMe,
    false,
  );
  assert.equal(evaluatePersonalRelevance(item(), only).affectsMe, false);
});

test('allergens only (no state): allergen matches qualify as personal signals', () => {
  const only = prefs({ allergens: ['peanut'] });
  const match = evaluatePersonalRelevance(item({ pathogenOrAllergen: 'undeclared peanuts' }), only);
  assert.equal(match.affectsMe, true);
  // Nationwide alone does not fill Affects Me while no state is chosen.
  const nationwide = evaluatePersonalRelevance(item({ geography: geo('nationwide') }), only);
  assert.equal(nationwide.affectsMe, false);
});

test('retailers only (no state): retailer matches qualify as personal signals', () => {
  const only = prefs({ retailers: ['costco'] });
  assert.equal(
    evaluatePersonalRelevance(item({ retailerNames: ['Costco'] }), only).affectsMe,
    true,
  );
  assert.equal(evaluatePersonalRelevance(item(), only).affectsMe, false);
});

test('state + allergen and state + retailer combine, all three stack', () => {
  const r = evaluatePersonalRelevance(
    item({
      geography: geo('states', ['California']),
      pathogenOrAllergen: 'undeclared sesame',
      retailerNames: ['Costco'],
    }),
    CALIFORNIAN,
  );
  assert.equal(r.affectsMe, true);
  assert.deepEqual(
    r.reasons.map((reason) => reason.label),
    ['Your allergen · Sesame', 'Sold at Costco', 'Affects California'],
  );
});

// ── State-change semantics (Home recalculates immediately) ───────────────────

test('changing the state recalculates relevance against the same facts', () => {
  const texasOnly = item({ geography: geo('states', ['Texas']) });
  assert.equal(evaluatePersonalRelevance(texasOnly, CALIFORNIAN).affectsMe, false);
  assert.equal(
    evaluatePersonalRelevance(texasOnly, { ...CALIFORNIAN, state: 'TX' }).affectsMe,
    true,
  );
});

// ── Push eligibility policy (§24) ────────────────────────────────────────────

test('push: no preferences or no state → deliver-all behavior stands', () => {
  assert.equal(pushEligible(item(), null), true);
  assert.equal(pushEligible(item(), prefs({ allergens: ['peanut'] })), true);
});

test('push: with a state, geography gates delivery', () => {
  assert.equal(pushEligible(item({ geography: geo('nationwide') }), CALIFORNIAN), true);
  assert.equal(pushEligible(item({ geography: geo('states', ['California']) }), CALIFORNIAN), true);
  assert.equal(pushEligible(item({ geography: geo('states', ['Texas']) }), CALIFORNIAN), false);
});

test('push: unknown geography delivers only with a personal signal', () => {
  assert.equal(pushEligible(item(), CALIFORNIAN), false);
  assert.equal(pushEligible(item({ pathogenOrAllergen: 'undeclared sesame' }), CALIFORNIAN), true);
  assert.equal(pushEligible(item({ retailerNames: ['Costco'] }), CALIFORNIAN), true);
});

test('C3.1: enriching retailerNames leaves geographic and allergen semantics alone', () => {
  // Retailer evidence is a positive signal only. Adding it must never widen,
  // narrow, or otherwise disturb the two dimensions decided in C3 — a case
  // excluded by geography stays excluded, and an allergen match is unmoved.
  const excluded = { geography: geo('states', ['Texas']), pathogenOrAllergen: 'undeclared milk' };
  const before = evaluatePersonalRelevance(item({ ...excluded }), CALIFORNIAN);
  const after = evaluatePersonalRelevance(
    item({ ...excluded, retailerNames: ['Costco'] }),
    CALIFORNIAN,
  );
  assert.equal(before.geographic, after.geographic);
  assert.deepEqual(before.matchedAllergens, after.matchedAllergens);
  // Exclusion still beats every signal, retailer included.
  assert.equal(after.affectsMe, false);

  // And on a matching geography the allergen verdict is likewise unchanged.
  const included = {
    geography: geo('states', ['California']),
    pathogenOrAllergen: 'undeclared sesame',
  };
  const plain = evaluatePersonalRelevance(item({ ...included }), CALIFORNIAN);
  const enriched = evaluatePersonalRelevance(
    item({ ...included, retailerNames: ['Costco'] }),
    CALIFORNIAN,
  );
  assert.equal(plain.geographic, enriched.geographic);
  assert.deepEqual(plain.matchedAllergens, enriched.matchedAllergens);
  assert.equal(plain.affectsMe, enriched.affectsMe);
});

// ── C5.2B: known allergen-only mismatches are withheld ───────────────────────

/** An allergen-only recall the source names: category, reason and agent agree. */
function allergenOnly(agent: string, overrides: Partial<RelevanceInput> = {}): RelevanceInput {
  return item({
    hazardCategory: 'allergen',
    reasonText: 'Unreported Allergens',
    pathogenOrAllergen: agent,
    ...overrides,
  });
}

/** California + Milk — the household case: someone shops for a milk allergy. */
const MILK_USER = prefs({ state: 'CA', allergens: ['milk'] });
/** California + Peanut, so every milk recall below is a known mismatch. */
const PEANUT_USER = prefs({ state: 'CA', allergens: ['peanut'] });

test('C5.2B truth table: matching allergen-only recalls stay in, whatever the geography', () => {
  for (const [label, geography] of [
    ['state match', geo('states', ['California'])],
    ['nationwide', geo('nationwide')],
    ['unknown location', geo('unknown')],
  ] as const) {
    const r = evaluatePersonalRelevance(allergenOnly('undeclared milk', { geography }), MILK_USER);
    assert.equal(r.affectsMe, true, label);
    assert.ok(
      r.reasons.some((reason) => reason.label === 'Your allergen · Milk'),
      `${label} explains itself`,
    );
  }
  // An explicit state list WITHOUT the user's state still excludes it.
  const texasOnly = evaluatePersonalRelevance(
    allergenOnly('undeclared milk', { geography: geo('states', ['Texas']) }),
    MILK_USER,
  );
  assert.equal(texasOnly.affectsMe, false);
});

test('C5.2B truth table: a known nonmatching allergen-only recall is out, whatever the geography', () => {
  for (const [label, geography] of [
    ['state match', geo('states', ['California'])],
    ['nationwide', geo('nationwide')],
    ['unknown location', geo('unknown')],
  ] as const) {
    const r = evaluatePersonalRelevance(
      allergenOnly('undeclared milk', { geography }),
      PEANUT_USER,
    );
    assert.equal(r.affectsMe, false, label);
    // Nothing personal to say about a recall we are not showing.
    assert.deepEqual(r.reasons, [], label);
  }
});

test('C5.2B: a retailer match cannot resurrect a known allergen mismatch', () => {
  const r = evaluatePersonalRelevance(
    allergenOnly('undeclared milk', {
      geography: geo('states', ['California']),
      retailerNames: ['Costco'],
    }),
    prefs({ state: 'CA', allergens: ['peanut'], retailers: ['costco'] }),
  );
  assert.equal(r.affectsMe, false);
  assert.deepEqual(r.reasons, []);
  // The match data is still computed — it is the VERDICT that is final.
  assert.deepEqual(r.matchedRetailers, ['costco']);
});

test('C5.2B: with no allergens selected, allergen-only recalls are not this user’s news', () => {
  const stateOnly = prefs({ state: 'CA' });
  assert.equal(
    evaluatePersonalRelevance(
      allergenOnly('undeclared milk', { geography: geo('states', ['California']) }),
      stateOnly,
    ).affectsMe,
    false,
  );
  // …while a general hazard in the same state still qualifies on location.
  assert.equal(
    evaluatePersonalRelevance(
      item({
        geography: geo('states', ['California']),
        hazardCategory: 'microbial_contamination',
        pathogenOrAllergen: 'Salmonella',
      }),
      stateOnly,
    ).affectsMe,
    true,
  );
});

test('C5.2B: multiple household allergens need only one match', () => {
  const household = prefs({ state: 'CA', allergens: ['milk', 'peanut', 'sesame'] });
  const oneMatch = evaluatePersonalRelevance(
    allergenOnly('undeclared soy and sesame', { geography: geo('nationwide') }),
    household,
  );
  assert.equal(oneMatch.affectsMe, true);
  assert.deepEqual(oneMatch.matchedAllergens, ['sesame']);

  const noMatch = evaluatePersonalRelevance(
    allergenOnly('undeclared soy and wheat', { geography: geo('nationwide') }),
    household,
  );
  assert.equal(noMatch.affectsMe, false);
});

test('C5.2B: an unidentified allergen never creates a false negative', () => {
  // "undeclared allergen" could be the user's own — location still qualifies.
  const r = evaluatePersonalRelevance(
    allergenOnly('undeclared allergen', { geography: geo('states', ['California']) }),
    PEANUT_USER,
  );
  assert.equal(r.affectsMe, true);
  const nullAgent = evaluatePersonalRelevance(
    allergenOnly(null as unknown as string, { geography: geo('nationwide') }),
    PEANUT_USER,
  );
  assert.equal(nullAgent.affectsMe, true);
});

test('C5.2B: a non-selectable allergen-only notice is withheld from Affects Me', () => {
  const r = evaluatePersonalRelevance(
    allergenOnly('undeclared sulfites', { geography: geo('states', ['California']) }),
    MILK_USER,
  );
  assert.equal(r.affectsMe, false);
  assert.deepEqual(r.reasons, []);
});

test('C5.2B: general and mixed hazards are never suppressed by an allergen mismatch', () => {
  const inCalifornia = geo('states', ['California']);
  const cases: [string, RelevanceInput][] = [
    [
      'Salmonella',
      item({
        geography: inCalifornia,
        hazardCategory: 'microbial_contamination',
        pathogenOrAllergen: 'Salmonella',
      }),
    ],
    [
      'E. coli',
      item({
        geography: inCalifornia,
        hazardCategory: 'microbial_contamination',
        pathogenOrAllergen: 'E. coli O157:H7',
      }),
    ],
    [
      'Listeria',
      item({
        geography: inCalifornia,
        hazardCategory: 'microbial_contamination',
        pathogenOrAllergen: 'Listeria monocytogenes',
      }),
    ],
    [
      'foreign material / metal',
      item({
        geography: geo('nationwide'),
        hazardCategory: 'foreign_material',
        reasonText: 'Product Contamination',
        pathogenOrAllergen: null,
      }),
    ],
    [
      'mixed pathogen + undeclared milk',
      item({
        geography: inCalifornia,
        hazardCategory: 'microbial_contamination',
        reasonText: 'Product Contamination, Unreported Allergens',
        pathogenOrAllergen: 'Salmonella',
      }),
    ],
    [
      'mixed, mislabelled by the source as allergen',
      item({
        geography: inCalifornia,
        hazardCategory: 'allergen',
        reasonText: 'Product Contamination, Unreported Allergens',
        pathogenOrAllergen: 'undeclared milk',
      }),
    ],
  ];
  for (const [label, input] of cases) {
    assert.equal(evaluatePersonalRelevance(input, PEANUT_USER).affectsMe, true, label);
  }
});

test('C5.2B: unknown geography still needs a real signal, and a match still counts', () => {
  const silent = item({ geography: geo('unknown') });
  assert.equal(evaluatePersonalRelevance(silent, PEANUT_USER).affectsMe, false);
  assert.deepEqual(evaluatePersonalRelevance(silent, PEANUT_USER).reasons, []);

  const allergenMatch = evaluatePersonalRelevance(
    allergenOnly('undeclared peanuts', { geography: geo('unknown') }),
    PEANUT_USER,
  );
  assert.equal(allergenMatch.affectsMe, true);
  assert.ok(allergenMatch.reasons.some((r) => r.label === 'Location not specified'));

  const retailerMatch = evaluatePersonalRelevance(
    item({
      geography: geo('unknown'),
      hazardCategory: 'microbial_contamination',
      pathogenOrAllergen: 'Salmonella',
      retailerNames: ['Costco'],
    }),
    prefs({ state: 'CA', allergens: ['peanut'], retailers: ['costco'] }),
  );
  assert.equal(retailerMatch.affectsMe, true);
  assert.ok(retailerMatch.reasons.some((r) => r.label === 'Location not specified'));
});

test('C5.2B: Home and push reach the same verdict for every case in the table', () => {
  const inputs: RelevanceInput[] = [
    allergenOnly('undeclared milk', { geography: geo('states', ['California']) }),
    allergenOnly('undeclared milk', { geography: geo('nationwide') }),
    allergenOnly('undeclared milk', { geography: geo('unknown') }),
    allergenOnly('undeclared peanuts', { geography: geo('nationwide') }),
    allergenOnly('undeclared allergen', { geography: geo('states', ['California']) }),
    item({
      geography: geo('states', ['California']),
      hazardCategory: 'microbial_contamination',
      pathogenOrAllergen: 'Salmonella',
    }),
    item({ geography: geo('states', ['Texas']), pathogenOrAllergen: 'undeclared peanuts' }),
  ];
  for (const [user, label] of [
    [MILK_USER, 'milk user'],
    [PEANUT_USER, 'peanut user'],
  ] as const) {
    for (const input of inputs) {
      assert.equal(
        pushEligible(input, user),
        evaluatePersonalRelevance(input, user).affectsMe,
        `${label} · ${input.pathogenOrAllergen} · ${input.geography.scope}`,
      );
    }
  }
});
