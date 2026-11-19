/**
 * Retailer-only notices under the ONE shared verdict
 * (docs/recall-personalization.md, "Retailer-only notices: the same verdict").
 *
 * Every row of that truth table is pinned here against the real adapter
 * (`retailerRelevanceInput`) and the real shared evaluation — Affects You,
 * the card label and push eligibility are all this one answer.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import type { UserRecallPreferences } from '@/domain/preferences';

import { affectsYouVerdict, evaluatePersonalRelevance, pushEligible } from './relevance';
import { readRetailerNoticeRows, type RetailerNotice } from './retailer-notices';
import {
  buildRetailerDetailModel,
  buildRetailerHomeCardModel,
  retailerNoticesForAffects,
  retailerRelevanceInput,
} from './retailer-notice-presentation';

const KIRKLAND = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '..',
      'server',
      'retailer',
      'fixtures',
      'approvals',
      'kirkland-whipped-cream.json',
    ),
    'utf8',
  ),
).fields as unknown;

const BASE = (() => {
  const [read] = readRetailerNoticeRows([
    {
      id: '8c4663c8-2009-4094-86b0-0c69c24dec4e',
      publisher: 'costco',
      document_url:
        'https://gdx-assets.costco.com/adobe/assets/urn:aaid:aem:8dedd165-f61b-475a-b7bb-5f33f77a4675/original/as/FINAL%20KS%20Whipped%20Cream%20Member%20Letter.pdf',
      notice_date: '2026-11-07',
      fields: KIRKLAND,
    },
  ]);
  assert.ok(read);
  return read;
})();

/** The approved notice with its states and structured reason varied. */
function costco(
  states: string[],
  reason: { hazardCategory: string; agent: string | null } = BASE.fields.reason,
  retailer = 'Costco',
): RetailerNotice {
  const notice = structuredClone(BASE);
  notice.fields.whereSold.states = states;
  notice.fields.reason = reason as RetailerNotice['fields']['reason'];
  notice.fields.retailer = retailer as RetailerNotice['fields']['retailer'];
  return notice;
}

function prefs(
  states: string[],
  extra: { retailers?: string[]; allergens?: string[] } = {},
): UserRecallPreferences {
  return {
    states,
    retailers: extra.retailers ?? [],
    allergens: extra.allergens ?? [],
  } as unknown as UserRecallPreferences;
}

const AL_FL_GA = ['Alabama', 'Florida', 'Georgia'];
const MILK_ONLY = { hazardCategory: 'allergen', agent: 'undeclared milk' };

const ROWS: [string, UserRecallPreferences, RetailerNotice, boolean][] = [
  ['AL / letter stating AL, FL, GA', prefs(['AL']), costco(AL_FL_GA), true],
  [
    'AL + Costco / letter stating AL, FL, GA',
    prefs(['AL'], { retailers: ['costco'] }),
    costco(AL_FL_GA),
    true,
  ],
  [
    'CA + Costco / explicit exclusion',
    prefs(['CA'], { retailers: ['costco'] }),
    costco(AL_FL_GA),
    false,
  ],
  [
    'CA + ALDI + Milk / ALDI milk-only letter stating AL, GA',
    prefs(['CA'], { retailers: ['aldi'], allergens: ['milk'] }),
    costco(['Alabama', 'Georgia'], MILK_ONLY, 'ALDI'),
    false,
  ],
  ['CA + Costco / no state stated', prefs(['CA'], { retailers: ['costco'] }), costco([]), true],
  ['CA / no state stated, no store', prefs(['CA']), costco([]), false],
  [
    '(no state) + Costco / AL, FL, GA',
    prefs([], { retailers: ['costco'] }),
    costco(AL_FL_GA),
    true,
  ],
  [
    '(no state) + Target / AL, FL, GA',
    prefs([], { retailers: ['target'] }),
    costco(AL_FL_GA),
    false,
  ],
  [
    'CA + Peanut + Costco / milk-only, no state',
    prefs(['CA'], { retailers: ['costco'], allergens: ['peanut'] }),
    costco([], MILK_ONLY),
    false,
  ],
  [
    'CA + Milk / milk-only, no state',
    prefs(['CA'], { allergens: ['milk'] }),
    costco([], MILK_ONLY),
    true,
  ],
  [
    'CA + Milk / milk-only stating CA',
    prefs(['CA'], { allergens: ['milk'] }),
    costco(['California'], MILK_ONLY),
    true,
  ],
  ['nothing chosen / any', prefs([]), costco(AL_FL_GA), false],
];

for (const [label, user, notice, expected] of ROWS) {
  test(`truth table: ${label} → ${expected ? 'Yes' : 'No'}`, () => {
    const input = retailerRelevanceInput(notice);
    assert.equal(evaluatePersonalRelevance(input, user).affectsMe, expected);
    // Card label, Detail banner and push are the same answer.
    assert.equal(affectsYouVerdict(input, user), expected);
    assert.equal(pushEligible(input, user), expected);
    assert.equal(buildRetailerHomeCardModel(notice, '2026-11-18', user).affectsYou, expected);
    assert.equal(buildRetailerDetailModel(notice, '2026-11-18', user).affectsYou, expected);
  });
}

test('unknown distribution stays unknown — never read as nationwide', () => {
  const input = retailerRelevanceInput(costco([]));
  assert.equal(input.geography.scope, 'unknown');
  const relevance = evaluatePersonalRelevance(input, prefs(['CA'], { retailers: ['costco'] }));
  assert.equal(relevance.geographic, 'unknown');
  assert.deepEqual(
    relevance.reasons.map((reason) => reason.kind),
    ['retailer', 'unknown_geography'],
  );
});

test('the publishing retailer is the store signal, for Costco and ALDI alike', () => {
  for (const [retailer, id] of [
    ['Costco', 'costco'],
    ['ALDI', 'aldi'],
  ] as const) {
    const relevance = evaluatePersonalRelevance(
      retailerRelevanceInput(costco([], BASE.fields.reason, retailer)),
      prefs([], { retailers: [id] }),
    );
    assert.deepEqual(relevance.matchedRetailers, [id], retailer);
  }
});

test('Affects you lists exactly the matching notices, hidden under a filter', () => {
  const now = new Date('2026-11-18T12:00:00Z');
  const matching = costco(AL_FL_GA);
  const excluded = { ...costco(['Texas']), id: 'b2a1f0c3-0000-4000-8000-000000000001' };
  const user = prefs(['AL']);
  const shown = retailerNoticesForAffects([matching, excluded], now, user, {
    filtersActive: false,
    query: '',
  });
  assert.deepEqual(
    shown.recent.map((notice) => notice.id),
    [matching.id],
  );
  const filtered = retailerNoticesForAffects([matching], now, user, {
    filtersActive: true,
    query: '',
  });
  assert.deepEqual(filtered, { recent: [], older: [] });
});

test('every allergen the approved agent names counts — none is lost to a parenthesis', () => {
  // The reviewed Madeleines agent: tree nuts and soy. A tree-nut or a soy
  // shopper must both be reached; neither may be withheld as a mismatch.
  const madeleines = costco(['California'], {
    hazardCategory: 'allergen',
    agent: 'undeclared Tree Nuts (Hazelnut/Filbert) and soy',
  });
  for (const allergen of ['tree nuts', 'soy']) {
    const relevance = evaluatePersonalRelevance(
      retailerRelevanceInput(madeleines),
      prefs([], { allergens: [allergen] }),
    );
    assert.deepEqual(relevance.matchedAllergens, [allergen], allergen);
    assert.equal(relevance.affectsMe, true, allergen);
  }
  // A milk shopper is the known mismatch it always was.
  assert.equal(
    evaluatePersonalRelevance(
      retailerRelevanceInput(madeleines),
      prefs(['CA'], { allergens: ['milk'] }),
    ).affectsMe,
    false,
  );
});
