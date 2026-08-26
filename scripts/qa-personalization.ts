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
 *
 * Everything is deterministic; nothing is written anywhere.
 */

import { normalizedAllergenTokens } from '../src/domain/hazard';
import type { CaseProjection } from '../src/domain/recall-types';
import {
  canonicalRetailerIds,
  retailerById,
  RETAILER_CATALOG,
} from '../src/domain/retailer-catalog';
import { buildDistribution } from '../src/lib/consumer-projection';
import { interpretTables } from '../src/lib/source-tables';
import { evaluatePersonalRelevance } from '../src/lib/relevance';
import { createSupabaseServerClient } from '../src/server/store/supabase-store';

interface Row {
  id: string;
  source_agency: string;
  state: string;
  hazard_category: string;
  projection: CaseProjection;
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
    const { data, error } = await client
      .from('recall_cases')
      .select('id, source_agency, state, hazard_category, projection')
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
    for (const row of active) {
      const relevance = evaluatePersonalRelevance(
        {
          geography: row.projection.geography,
          pathogenOrAllergen: row.projection.pathogenOrAllergen,
          retailerNames: row.projection.retailerNames ?? [],
        },
        { state, allergens: [], retailers: [] },
      );
      if (relevance.geographic === 'matches') matches += 1;
      else if (relevance.geographic === 'unknown') unknown += 1;
      else excluded += 1;
    }
    console.log(
      `    ${state}: affects ${matches} (${pct(matches, active.length)}), ` +
        `location unknown ${unknown}, excluded ${excluded}`,
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
}

void main();
