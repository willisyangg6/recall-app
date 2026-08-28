/**
 * Personalization QA report (Phase C3) — read-only against the live DB.
 *
 *   npm run qa:personalization
 *
 * Quantifies the three personalization dimensions over the real corpus:
 *
 * GEOGRAPHY   scope distribution (nationwide / states / unknown), so the
 *             tri-state relevance semantics rest on measured reality.
 * ALLERGENS   canonical-token coverage of allergen cases, unmapped tokens,
 *             and the group mappings (specific tree nuts → Tree nuts).
 * RETAILERS   canonicalization compatibility: how much observed retailer
 *             evidence resolves to the canonical catalog, what stays
 *             unresolved, and the coverage gap between the persisted
 *             projection field (what feed/push/detail personalization
 *             matches on) and the detail screen's richer derivation.
 * AFFECTS ME  live coverage for representative states: how the active feed
 *             splits into matches / unknown / excluded per state.
 * RANKING     (C3.2) the deterministic Affects-me order for the representative
 *             profile, with the priority behind every position, plus the
 *             invariants: eligibility unchanged by ranking, sections disjoint,
 *             All Recalls untouched.
 *
 * Everything is deterministic; nothing is written anywhere.
 */

import { normalizedAllergenTokens } from '../src/domain/hazard';
import { materialActivityAt } from '../src/domain/material-activity';
import type { CaseProjection, TimelineEntry } from '../src/domain/recall-types';
import {
  canonicalRetailerIds,
  retailerById,
  RETAILER_CATALOG,
} from '../src/domain/retailer-catalog';
import {
  buildAffectsMeSections,
  explainAffectsMePriority,
  type AffectsMeRankable,
} from '../src/lib/affects-me-ranking';
import { buildDistribution } from '../src/lib/consumer-projection';
import { productDisplayName } from '../src/lib/consumer-summary';
import { feedTier } from '../src/lib/feed-relevance';
import { interpretTables } from '../src/lib/source-tables';
import { evaluatePersonalRelevance } from '../src/lib/relevance';
import { createSupabaseServerClient } from '../src/server/store/supabase-store';

interface Row {
  id: string;
  source_agency: string;
  state: string;
  hazard_category: string;
  projection: CaseProjection;
  timeline: TimelineEntry[] | null;
}

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment may be configured another way.
  }
}

async function fetchAllCases(): Promise<Row[]> {
  loadDotEnv();
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY.');
    process.exit(1);
  }
  const client = createSupabaseServerClient(url, secretKey);
  const rows: Row[] = [];
  for (let from = 0; ; from += 500) {
    // Two constraints the earlier sweep was missing (C5.1):
    //   `merged_into is null` is the consumer read contract (the client's RLS
    //   policy). Counting merged duplicates made this report disagree with
    //   what a user can actually see — 895 rows here against 882 on the phone,
    //   with the duplicates also inflating every coverage percentage.
    //   `order(id)` makes the range windows deterministic; unordered paging
    //   may repeat or skip rows, which is the same class of bug C5.1 fixes in
    //   the app itself.
    const { data, error } = await client
      .from('recall_cases')
      .select('id, source_agency, state, hazard_category, projection, timeline')
      .is('merged_into', null)
      .order('id', { ascending: true })
      .range(from, from + 499);
    if (error) {
      console.error(`recall_cases query failed: ${error.message}`);
      process.exit(1);
    }
    rows.push(...(data as Row[]));
    if (!data || data.length < 500) break;
  }
  return rows;
}

function count(values: string[]): [string, number][] {
  const map = new Map<string, number>();
  for (const value of values) map.set(value, (map.get(value) ?? 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function pct(part: number, whole: number): string {
  return whole === 0 ? '—' : `${((100 * part) / whole).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const rows = await fetchAllCases();
  const active = rows.filter((row) => row.state === 'active');
  console.log(`Personalization QA — ${rows.length} cases (${active.length} active)\n`);

  // ── Geography ──────────────────────────────────────────────────────────────
  console.log('GEOGRAPHY (tri-state relevance input)');
  for (const [label, set] of [
    ['all', rows],
    ['active', active],
  ] as const) {
    const scopes = count(set.map((row) => row.projection.geography.scope));
    const line = scopes.map(([scope, n]) => `${scope} ${n} (${pct(n, set.length)})`).join(', ');
    console.log(`  ${label}: ${line}`);
  }
  const activeStates = count(active.flatMap((row) => row.projection.geography.states ?? [])).slice(
    0,
    8,
  );
  console.log(
    `  top states (active): ${activeStates.map(([state, n]) => `${state} ${n}`).join(', ')}`,
  );
  const contradictory = rows.filter(
    (row) =>
      (row.projection.geography.scope === 'states') !== row.projection.geography.states.length > 0,
  );
  console.log(`  scope/state-list contradictions: ${contradictory.length} (gate: 0)\n`);

  // ── Allergens ──────────────────────────────────────────────────────────────
  console.log('ALLERGENS (closed nine-major taxonomy)');
  const allergenCases = rows.filter((row) => row.hazard_category === 'allergen');
  const withAgent = allergenCases.filter((row) => row.projection.pathogenOrAllergen);
  console.log(
    `  allergen-hazard cases: ${allergenCases.length}; with a stated agent: ${withAgent.length} ` +
      `(${pct(withAgent.length, allergenCases.length)}); agent unstated: ${allergenCases.length - withAgent.length}`,
  );
  const tokens = count(
    withAgent.flatMap((row) => normalizedAllergenTokens(row.projection.pathogenOrAllergen)),
  );
  const MAJOR = new Set([
    'peanut',
    'tree nuts',
    'milk',
    'egg',
    'wheat',
    'soy',
    'sesame',
    'fish',
    'shellfish',
  ]);
  console.log(
    `  canonical tokens: ${tokens.map(([token, n]) => `${token} ${n}`).join(', ') || 'none'}`,
  );
  const nonMajor = tokens.filter(([token]) => !MAJOR.has(token));
  console.log(
    `  known non-major tokens (not selectable): ${nonMajor.map(([token, n]) => `${token} ${n}`).join(', ') || 'none'}`,
  );
  const zeroToken = withAgent.filter(
    (row) => normalizedAllergenTokens(row.projection.pathogenOrAllergen).length === 0,
  );
  console.log(`  stated agents yielding no token: ${zeroToken.length}`);
  for (const [value, n] of count(
    zeroToken.map((row) => row.projection.pathogenOrAllergen as string),
  ).slice(0, 6)) {
    console.log(`    · "${value}" ×${n}`);
  }
  const specificNuts = withAgent.filter((row) =>
    /almond|cashew|pistachio|hazelnut|walnut|pecan/i.test(row.projection.pathogenOrAllergen ?? ''),
  );
  const nutsMapped = specificNuts.filter((row) =>
    normalizedAllergenTokens(row.projection.pathogenOrAllergen).includes('tree nuts'),
  );
  console.log(
    `  specific tree nuts → "tree nuts": ${nutsMapped.length}/${specificNuts.length} (gate: all map, zero fabricated)\n`,
  );

  // ── Retailers ──────────────────────────────────────────────────────────────
  console.log(`RETAILERS (canonical catalog: ${RETAILER_CATALOG.length} chains)`);
  const persistedBearing = rows.filter((row) => (row.projection.retailerNames ?? []).length > 0);
  const persistedCanonical = persistedBearing.filter(
    (row) => canonicalRetailerIds(row.projection.retailerNames ?? []).length > 0,
  );
  console.log(
    `  persisted retailerNames (what personalization matches on): ` +
      `${persistedBearing.length} case(s), ${persistedCanonical.length} resolve to the catalog ` +
      `(${pct(persistedCanonical.length, persistedBearing.length)})`,
  );

  // Rich derivation — the detail screen's own retailer evidence. Reported to
  // size the coverage a future ingest-time enrichment would unlock.
  const derived: { id: string; active: boolean; evidence: string[] }[] = [];
  for (const row of rows) {
    try {
      const tables = interpretTables(row.projection.summaryHtml ?? null);
      const tableFacts = tables.flatMap((t) => t.variants.flatMap((v) => v.facts));
      const dist = buildDistribution(row.projection, tableFacts);
      derived.push({ id: row.id, active: row.state === 'active', evidence: dist.retailers });
    } catch {
      derived.push({ id: row.id, active: row.state === 'active', evidence: [] });
    }
  }
  const derivedBearing = derived.filter((entry) => entry.evidence.length > 0);
  const derivedCanonical = derivedBearing.filter(
    (entry) => canonicalRetailerIds(entry.evidence).length > 0,
  );
  const rawStrings = derivedBearing.flatMap((entry) => entry.evidence);
  const distinctRaw = new Set(rawStrings.map((value) => value.trim().toLowerCase()));
  console.log(
    `  display-derived evidence (detail screen facts): ${derivedBearing.length} case(s), ` +
      `${distinctRaw.size} distinct raw strings, ${derivedCanonical.length} case(s) resolve to the catalog ` +
      `(${pct(derivedCanonical.length, derivedBearing.length)})`,
  );
  const canonicalCounts = count(
    derivedBearing.flatMap((entry) => canonicalRetailerIds(entry.evidence)),
  );
  console.log(
    `  top canonical retailers: ${canonicalCounts
      .slice(0, 12)
      .map(([id, n]) => `${retailerById(id)?.name ?? id} ${n}`)
      .join(', ')}`,
  );
  const unresolved = count(
    derivedBearing
      .flatMap((entry) => entry.evidence)
      .filter((value) => canonicalRetailerIds([value]).length === 0)
      .map((value) => value.trim().toLowerCase()),
  );
  console.log(
    `  unresolved evidence strings (stay unmatched by design — never fuzzy-merged): ${unresolved.length} distinct; top:`,
  );
  for (const [value, n] of unresolved.slice(0, 8)) console.log(`    · "${value}" ×${n}`);
  // Alias fragmentation proof: variant spellings that resolve to one id.
  const aliasProof: [string, string][] = [
    ['Wal-Mart', 'walmart'],
    ['Costco Wholesale', 'costco'],
    ['Trader Joes', 'trader-joes'],
    ['Publix Super Markets', 'publix'],
    ['H.E.B.', 'heb'],
    ['Stop&Shop', 'stop-and-shop'],
  ];
  const aliasOk = aliasProof.every(([raw, id]) => canonicalRetailerIds([raw]).join() === id);
  console.log(
    `  alias fragmentation resolved (Walmart/Wal-Mart etc.): ${aliasOk ? 'yes' : 'NO — FIX'}`,
  );
  console.log(
    `  ambiguous aliases left separate: bare "Giant" → ${canonicalRetailerIds(['Giant']).length === 0 ? 'unmatched (correct)' : 'MATCHED — FIX'}\n`,
  );

  // ── Affects Me coverage ────────────────────────────────────────────────────
  console.log('AFFECTS ME (active feed coverage per representative state)');
  console.log('  state-only profiles (no allergens/retailers):');
  for (const state of ['CA', 'TX', 'NY', 'WY', 'PR']) {
    let matches = 0;
    let unknown = 0;
    let excluded = 0;
    let eligible = 0;
    for (const row of active) {
      const relevance = evaluatePersonalRelevance(
        {
          geography: row.projection.geography,
          pathogenOrAllergen: row.projection.pathogenOrAllergen,
          retailerNames: row.projection.retailerNames ?? [],
          hazardCategory: row.projection.hazardCategory,
          reasonText: row.projection.reasonText,
        },
        { state, allergens: [], retailers: [] },
      );
      if (relevance.geographic === 'matches') matches += 1;
      else if (relevance.geographic === 'unknown') unknown += 1;
      else excluded += 1;
      if (relevance.affectsMe) eligible += 1;
    }
    // Geographic relevance and Affects Me eligibility are DIFFERENT numbers
    // since C5.2B: a state-only profile no longer qualifies for an identified
    // allergen-only recall, because it selected no allergen those can match.
    console.log(
      `    ${state}: geography matches ${matches} (${pct(matches, active.length)}), ` +
        `location unknown ${unknown}, excluded ${excluded} · ` +
        `AFFECTS ME ${eligible} (${pct(eligible, active.length)})`,
    );
  }
  let affects = 0;
  let viaSignal = 0;
  for (const row of active) {
    const relevance = evaluatePersonalRelevance(
      {
        geography: row.projection.geography,
        pathogenOrAllergen: row.projection.pathogenOrAllergen,
        retailerNames: row.projection.retailerNames ?? [],
        hazardCategory: row.projection.hazardCategory,
        reasonText: row.projection.reasonText,
      },
      { state: 'CA', allergens: ['sesame', 'peanut'], retailers: ['costco', 'trader-joes'] },
    );
    if (relevance.affectsMe) {
      affects += 1;
      if (relevance.geographic === 'unknown') viaSignal += 1;
    }
  }
  console.log(
    `  example profile (CA + sesame/peanut + Costco/Trader Joe's): ` +
      `affects ${affects} of ${active.length} active (${viaSignal} via allergen/retailer signal on unknown geography)`,
  );

  // ── Ranking (C3.2) ─────────────────────────────────────────────────────────
  //
  // Review diagnostic only. Nothing below is consumer UI: sort keys, tuple
  // positions, and the priority explanation are internal by design.
  console.log('\nAFFECTS ME RANKING (deterministic lexicographic order, C3.2)');
  console.log('  profile: California · Sesame + Peanuts · Costco + Trader Joe’s');

  const PROFILE = {
    state: 'CA',
    allergens: ['sesame', 'peanut'],
    retailers: ['costco', 'trader-joes'],
  };

  interface Candidate extends AffectsMeRankable {
    projection: CaseProjection;
  }
  const candidates: Candidate[] = active.map((row) => ({
    id: row.id,
    classification: row.projection.classification,
    publishedAt: row.projection.publishedAt,
    timeline: row.timeline ?? [],
    projection: row.projection,
  }));
  const relevanceOf = (candidate: Candidate) =>
    evaluatePersonalRelevance(
      {
        geography: candidate.projection.geography,
        pathogenOrAllergen: candidate.projection.pathogenOrAllergen,
        retailerNames: candidate.projection.retailerNames ?? [],
        hazardCategory: candidate.projection.hazardCategory,
        reasonText: candidate.projection.reasonText,
      },
      PROFILE,
    );

  const ranked = buildAffectsMeSections(candidates, relevanceOf);
  console.log(`  sections: affects ${ranked.affects.length}, older active ${ranked.older.length}`);

  console.log(`\n  top ${Math.min(10, ranked.affects.length)} recent Affects Me results:`);
  for (const [index, candidate] of ranked.affects.slice(0, 10).entries()) {
    const relevance = relevanceOf(candidate);
    const priority = ranked.priorityById.get(candidate.id)!;
    const product = productDisplayName(
      candidate.projection.productDescription ?? null,
      candidate.projection.title,
    );
    const geographyReason =
      relevance.reasons.find((r) => r.kind !== 'allergen' && r.kind !== 'retailer')?.label ??
      'none';
    const signals =
      relevance.reasons
        .filter((r) => r.kind === 'allergen' || r.kind === 'retailer')
        .map((r) => r.label)
        .join(' + ') || 'none';
    console.log(
      `  ${String(index + 1).padStart(2)}. ${product.slice(0, 68)}${product.length > 68 ? '…' : ''}`,
    );
    console.log(
      `      risk ${priority.riskTier} · ${geographyReason} · signals: ${signals}` +
        ` · announced ${priority.publishedAt} · material activity ${priority.materialActivityAt}`,
    );
    console.log(`      priority: ${explainAffectsMePriority(priority)}`);
  }

  // ── Ranking invariants ─────────────────────────────────────────────────────
  console.log('\n  invariants');
  const eligible = candidates.filter((candidate) => relevanceOf(candidate).affectsMe);
  const sectioned = [...ranked.affects, ...ranked.older];
  console.log(
    `    eligibility unchanged by ranking: ${eligible.length} qualify, ` +
      `${sectioned.length} placed (gate: equal) — ${eligible.length === sectioned.length ? 'OK' : 'MISMATCH — FIX'}`,
  );
  const placedIds = sectioned.map((c) => c.id);
  console.log(
    `    duplicates across sections: ${placedIds.length - new Set(placedIds).size} (gate: 0)`,
  );
  const excludedPlaced = placedIds.filter(
    (id) => relevanceOf(candidates.find((c) => c.id === id)!).geographic === 'does_not_match',
  );
  console.log(
    `    geographically excluded cases placed anywhere: ${excludedPlaced.length} (gate: 0)`,
  );

  // Recency source: material activity vs the All Recalls date. The delta is the
  // point of the milestone — cases whose only recent movement was bookkeeping.
  const byPublicActivity = eligible.filter(
    (candidate) =>
      feedTier({ lastPublicActivityAt: candidate.projection.lastPublicActivityAt }) === 'recent',
  ).length;
  console.log(
    `    recent qualifying by lastPublicActivityAt: ${byPublicActivity}; ` +
      `by material activity: ${ranked.affects.length} ` +
      `(${byPublicActivity - ranked.affects.length} demoted — bookkeeping-only movement)`,
  );
  const raised = ranked.affects.filter((candidate) => {
    const priority = ranked.priorityById.get(candidate.id)!;
    return priority.materialActivityAt > priority.publishedAt;
  }).length;
  console.log(`    recent qualifying raised by a post-announcement material event: ${raised}`);

  // All Recalls: the untouched sectioning, reported so the review can see it
  // did not move. `buildFeedSections` is unchanged by C3.2.
  const allRecent = active.filter(
    (row) => feedTier({ lastPublicActivityAt: row.projection.lastPublicActivityAt }) === 'recent',
  ).length;
  console.log(
    `    All Recalls (unchanged): recent ${allRecent}, older active ${active.length - allRecent}`,
  );
}

void main();
