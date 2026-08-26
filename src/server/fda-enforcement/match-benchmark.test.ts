/**
 * Labeled announcement↔enforcement matching benchmark over REAL data: 24
 * live RecallCases paired with their firms' actual openFDA enforcement
 * records (bulk export 2026-08-25), hand-labeled with ground-truth event
 * ids. Categories: UPC positives, no-UPC name positives, multi-product
 * hard positives, multi-event expansions, same-firm/same-product false
 * friends years apart, same-firm different-recall events INSIDE the date
 * window, and announcements whose enforcement records do not exist yet.
 *
 * THE GATE: accepted matches must have ZERO false positives — every
 * accepted event must be in the entry's ground truth. A miss (recall) is
 * acceptable; a wrong classification source never is.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';

import { blockByFirm, indexByNormalizedFirm, matchCase } from './match';
import { parseEnforcementRecord, type OpenFdaEnforcementRaw } from './parse';

interface BenchmarkEntry {
  name: string;
  note: string;
  truthEventIds: string[];
  case: {
    caseId: string;
    title: string;
    firmNames: string[];
    publishedDates: string[];
    bodyText: string;
  };
  enforcement: OpenFdaEnforcementRaw[];
}

const FIXTURE = join(__dirname, 'fixtures', 'match-benchmark.json.gz');
const entries: BenchmarkEntry[] = JSON.parse(gunzipSync(readFileSync(FIXTURE)).toString('utf8'));

function runEntry(entry: BenchmarkEntry) {
  const records = entry.enforcement.map(parseEnforcementRecord);
  const index = indexByNormalizedFirm(records);
  const facts = {
    caseId: entry.case.caseId,
    publishedDates: entry.case.publishedDates,
    firmNames: entry.case.firmNames,
    titleText: entry.case.title,
    productText: '',
    bodyText: entry.case.bodyText,
  };
  return matchCase(facts, blockByFirm(facts, index));
}

test('benchmark: zero false accepted matches across all labeled entries', () => {
  let acceptedTotal = 0;
  let truthTotal = 0;
  let truthHit = 0;
  const falsePositives: string[] = [];
  for (const entry of entries) {
    const result = runEntry(entry);
    const truth = new Set(entry.truthEventIds);
    truthTotal += truth.size;
    for (const match of result.accepted) {
      acceptedTotal += 1;
      if (truth.has(match.eventId)) truthHit += 1;
      else falsePositives.push(`${entry.name} accepted event ${match.eventId}`);
    }
  }
  assert.deepEqual(falsePositives, [], falsePositives.join('; '));
  // Diagnostics for the QA report (never a gate): recall over labeled truth.
  const precision = acceptedTotal > 0 ? truthHit / acceptedTotal : 1;
  const recall = truthTotal > 0 ? truthHit / truthTotal : 1;
  assert.equal(precision, 1);
  // The floor pins measured behavior so a rule change that silently destroys
  // coverage fails loudly; raising recall only ever raises this number.
  assert.ok(
    recall >= 0.8,
    `benchmark recall regressed: ${truthHit}/${truthTotal} (${recall.toFixed(2)})`,
  );
});

test('benchmark: overlapping multi-event evidence stays ambiguous, never forced', () => {
  // Total Nutrition's base+expansion produced TWO enforcement events whose
  // product lists overlap (the expansion re-lists base products). Name
  // evidence cannot separate them, so the matcher must preserve the
  // ambiguity — accepting either by "higher share" would be a guess.
  const entry = entries.find((e) => e.name === 'total-nutrition-expand')!;
  const result = runEntry(entry);
  assert.equal(result.state, 'ambiguous');
  assert.equal(result.accepted.length, 0);
  assert.deepEqual(result.ambiguous.map((e) => e.eventId).sort(), ['99072', '99317']);
});

test('benchmark: known same-firm false friends are never accepted', () => {
  // Event ids of the measured recurring-product traps: Gold Medal flour
  // 2016, Green Sprouts 2016, Kroger Private Selection non-berry events,
  // Mellace nonpareils 2020/2025, Conagra Birds Eye (in-window!), Gellert
  // artichokes (in-window!), Shang Hao Jia soda biscuits (in-window!).
  const FORBIDDEN: Record<string, string[]> = {
    'gold-medal-flour': ['74285', '81969', '74703'],
    'green-sprouts': ['73374'],
    'kroger-berries': ['74630', '74412', '78421'],
    'mellace-nonpareils': ['85539', '97101'],
    conagra: ['89114', '87890'],
    gellert: ['99055'],
    'shang-hao-jia': ['97301'],
    'meijer-almonds': ['98204', '91352', '75635'],
  };
  for (const entry of entries) {
    const forbidden = FORBIDDEN[entry.name];
    if (!forbidden) continue;
    const result = runEntry(entry);
    for (const match of result.accepted) {
      assert.ok(
        !forbidden.includes(match.eventId),
        `${entry.name}: forbidden event ${match.eventId} was accepted`,
      );
    }
  }
});

test('benchmark: deterministic positives stay matched (regression floor)', () => {
  // Entries the matcher provably resolves today. Every accepted event is
  // verified against ground truth above; this pins them against regression.
  const MUST_ACCEPT: Record<string, string[]> = {
    'aller-c': ['98663'],
    yocrunch: ['97250'],
    jenis: ['97981'],
    'utz-dirty': ['98864'],
    'albertsons-tuna': ['97306'],
    'wicklow-gold': ['96077'],
    'good-gather-burrito': ['97572'],
    'howe-sunflower': ['98867'],
    flagstone: ['95158'],
    tovala: ['90591'],
    'kick-ash': ['94227'],
    'gold-medal-flour': ['92231'],
    'green-sprouts': ['95470'],
    'meijer-almonds': ['97077'],
    'kroger-berries': ['83083'],
    'mellace-nonpareils': ['98083'],
    'shang-hao-jia': ['97145'],
    conagra: ['89506'],
    albanese: ['90326'],
    gellert: ['99357'],
  };
  const results = new Map(entries.map((entry) => [entry.name, runEntry(entry)]));
  for (const [name, eventIds] of Object.entries(MUST_ACCEPT)) {
    const result = results.get(name);
    assert.ok(result, `benchmark entry ${name} missing`);
    for (const eventId of eventIds) {
      assert.ok(
        result!.accepted.some((match) => match.eventId === eventId),
        `${name}: expected accepted event ${eventId}; got [${result!.accepted
          .map((m) => m.eventId)
          .join(', ')}] state=${result!.state}`,
      );
    }
  }
});

test('benchmark: announcements with no enforcement records stay unmatched', () => {
  for (const name of ['lidl-eridanous', 'momchipz', 'everything-sprouts']) {
    const entry = entries.find((e) => e.name === name)!;
    const result = runEntry(entry);
    assert.equal(result.state, 'unmatched', name);
    assert.equal(result.accepted.length, 0, name);
  }
});
