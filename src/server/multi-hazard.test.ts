/**
 * Founder decision E (2026-10-07), proven against recorded notices: a reason
 * naming several supported hazards names every one of them — in the Feed
 * reason line, in What Happened, and in Health Risk — joined by the source's
 * own connective, in the source's order, with each reviewed guide whole.
 * A notice naming one supported hazard renders exactly as before, and the
 * stored `pathogenOrAllergen` scalar is read, never changed.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';

import { HAZARD_GUIDES, type HazardGuideKey } from '../content/hazard-guides';
import { projectCase } from '../domain/projection';
import type { CaseProjection } from '../domain/recall-types';
import { interpretReason } from '../lib/recall-reason';
import { buildDetailModel, conciseReasonLine } from '../lib/recall-presentation';
import { parseFdaAnnouncement, slugFromPath, type FdaListingItem } from './fda/parse';

function baselineCase(idPrefix: string): CaseProjection {
  const baseline = JSON.parse(readFileSync('src/content/baseline-recalls.json', 'utf8')) as {
    cases: { item: { id: string }; detail: { projection: CaseProjection } }[];
  };
  const found = baseline.cases.find((entry) => entry.item.id.startsWith(idPrefix));
  assert.ok(found, `baseline case ${idPrefix} missing`);
  return found!.detail.projection;
}

function fdaCase(fragment: string): CaseProjection {
  const corpus: { path: string; listing: FdaListingItem; mainHtml: string }[] = JSON.parse(
    gunzipSync(readFileSync('src/server/fda/fixtures/qa-corpus.json.gz')).toString('utf8'),
  );
  const entry = corpus.find((e) => slugFromPath(e.path).includes(fragment));
  assert.ok(entry, `corpus record missing: ${fragment}`);
  return projectCase([
    parseFdaAnnouncement({
      listing: entry!.listing,
      detailMainHtml: entry!.mainHtml,
      path: entry!.path,
    }),
  ]);
}

function surfaces(projection: CaseProjection) {
  const model = buildDetailModel(
    {
      id: 'test',
      projection,
      timeline: [],
      affectedProducts: projection.affectedProducts ?? [],
      visuals: [],
    },
    { today: '2026-10-07', affectsYou: false },
  );
  return {
    // The Feed reads the same four fields a feed row carries.
    feed: conciseReasonLine({
      reasonText: projection.reasonText,
      hazardCategory: projection.hazardCategory,
      pathogenOrAllergen: projection.pathogenOrAllergen,
      title: projection.title,
    }),
    whatHappened: model.whatHappened.text,
    healthRisk: model.sections.healthRisk,
  };
}

const guide = (key: HazardGuideKey) => HAZARD_GUIDES.find((entry) => entry.key === key)!;

/** Exactly the reviewed guide, untouched, as a multi-hazard entry. */
function entryFor(key: HazardGuideKey) {
  const reviewed = guide(key);
  return {
    organism: reviewed.organism,
    risk: reviewed.risk,
    symptoms: reviewed.symptoms,
    higherRisk: reviewed.higherRisk,
    source: { label: `Learn more from ${reviewed.source.organization}`, url: reviewed.source.url },
  };
}

for (const [id, label, phrase, keys] of [
  [
    '02593a77',
    'Berlin Seeds: "(STEC) and/or Salmonella"',
    'E. coli and/or Salmonella',
    ['stec', 'salmonella'],
  ],
  [
    '3880fbba',
    'Everything Sprouts radish: "(STEC) or Salmonella"',
    'E. coli or Salmonella',
    ['stec', 'salmonella'],
  ],
  [
    '4e15c02c',
    'Everything Sprouts alfalfa: "Salmonella and … (STEC)"',
    'Salmonella and E. coli',
    ['salmonella', 'stec'],
  ],
] as const) {
  test(`${label}: every supported hazard, the source's connective and order`, () => {
    const projection = baselineCase(id);
    // The stored scalar names ONE hazard and stays exactly as stored.
    assert.equal(projection.pathogenOrAllergen, 'Salmonella');
    const { feed, whatHappened, healthRisk } = surfaces(projection);
    assert.equal(feed, `Potential ${phrase} contamination.`);
    assert.match(whatHappened, new RegExp(`may be contaminated with ${phrase}\\.$`));
    // One section holding each reviewed guide whole, in the source's order;
    // the single-guide fields are empty so nothing renders twice.
    assert.ok(healthRisk);
    assert.equal(healthRisk!.risk, null);
    assert.equal(healthRisk!.symptoms, null);
    assert.equal(healthRisk!.source, null);
    assert.deepEqual(healthRisk!.hazards, keys.map(entryFor));
  });
}

test('Lyons Magnus: one SUPPORTED hazard (Cronobacter has no reviewed guide) renders as before', () => {
  const { feed, whatHappened, healthRisk } = surfaces(
    fdaCase('lyons-magnus-expands-voluntary-recall'),
  );
  assert.equal(feed, 'Potential Clostridium botulinum contamination.');
  assert.match(whatHappened, /may be contaminated with Clostridium botulinum\.$/);
  assert.equal(healthRisk?.hazards, null);
  assert.equal(healthRisk?.risk, guide('botulism').risk);
});

test('a single-hazard notice is unchanged on every surface', () => {
  const { feed, whatHappened, healthRisk } = surfaces(baselineCase('080dedcf'));
  assert.equal(feed, 'Potential Salmonella contamination.');
  assert.match(whatHappened, /may be contaminated with Salmonella\.$/);
  assert.deepEqual(healthRisk, {
    risk: guide('salmonella').risk,
    symptoms: guide('salmonella').symptoms,
    higherRisk: guide('salmonella').higherRisk,
    source: { label: 'Learn more from CDC', url: guide('salmonella').source.url },
    hazards: null,
  });
});

test('only a bare connective joins hazards; anything else keeps the single rendering', () => {
  const hazards = (reasonText: string) =>
    interpretReason({
      reasonText,
      hazardCategory: 'microbial_contamination',
      pathogenOrAllergen: 'Salmonella',
    });
  const named = (reasonText: string) => {
    const reason = hazards(reasonText);
    return reason.family === 'pathogen' ? (reason.hazards?.phrase ?? null) : null;
  };
  assert.equal(
    named('Potential Listeria, Salmonella, and E. coli contamination'),
    'Listeria, Salmonella, and E. coli',
  );
  assert.equal(named('Possible Salmonella or Listeria monocytogenes'), 'Salmonella or Listeria');
  // A clause between the organisms, a repeated mention, or one supported
  // hazard beside an unsupported one is not a stated list of hazards.
  assert.equal(named('Salmonella; the firm also tested for E. coli'), null);
  assert.equal(named('Salmonella and E. coli, including Salmonella Typhimurium'), null);
  assert.equal(named('Cronobacter sakazakii and Salmonella'), null);
  assert.equal(named('Possible Salmonella contamination'), null);
  // A single-hazard reason carries no hazards field at all.
  assert.deepEqual(hazards('Possible Salmonella contamination'), {
    family: 'pathogen',
    pathogen: 'Salmonella',
  });
});
