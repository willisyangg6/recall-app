/**
 * Product-category QA (Phase C10A) — read-only against the live DB.
 *
 *   npm run qa:product-categories
 *
 * This is NOT the accuracy gate. `npm run qa:categories` measures the frozen
 * classifier against the reviewed gold set and is the only thing that may
 * report how often it is RIGHT. This command reports what the derivation
 * would place across the real corpus and enforces the STRUCTURAL invariants
 * an optional discovery filter depends on:
 *
 *   · every case carries at least one category (the derivation is total);
 *   · every id is in the closed vocabulary, de-duplicated, in display order;
 *   · `other` never co-occurs with a real category;
 *   · the derivation is deterministic and a fixed point;
 *   · no category is produced by hazard, allergen, pathogen or reason text;
 *   · attaching categories changes NOTHING about All Recalls membership or
 *     order, Affects Me eligibility or order, or personal relevance.
 *
 * The last one is the load-bearing product claim — Category is a discovery
 * tool, never a safety, relevance, risk or notification boundary — so it is
 * measured against the real loader over the real corpus rather than asserted.
 */

import { buildAffectsMeSections } from '../src/lib/affects-me-ranking';
import { buildFeedSections } from '../src/lib/feed-relevance';
import { evaluatePersonalRelevance } from '../src/lib/relevance';
import type { FeedItem } from '../src/lib/recall-feed';
import type { UserRecallPreferences } from '../src/domain/preferences';
import {
  FOOD_CATEGORIES,
  FOOD_CATEGORY_IDS,
  foodCategoryLabel,
  isFoodCategoryId,
  MAX_CATEGORIES_PER_CASE,
  type FoodCategoryId,
} from '../src/domain/food-category';
import { categoryProductText } from '../src/domain/food-category-matcher';
import { deriveProductCategories, readProductCategories } from '../src/domain/projection';
import { createSupabaseServerClient, SupabaseStore } from '../src/server/store/supabase-store';

/** The profile used across personalization QA, so results stay comparable. */
const PROFILE: UserRecallPreferences = {
  state: 'CA',
  allergens: ['sesame', 'peanut'],
  retailers: ['costco', 'trader-joes'],
};

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment may be configured another way.
  }
}

const pct = (n: number, d: number): string => (d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`);

interface Gate {
  label: string;
  value: number;
  limit: number;
}

/**
 * Everything an announcement says EXCEPT its product-identification sentence,
 * rewritten as loud nonsense (C10A.1).
 *
 * The classifier reads ONE bounded span of the announcement — the sentence
 * whose whole job is to name the product — and only where the title has
 * already proved non-descriptive. This is how that claim is MEASURED rather
 * than asserted: every other sentence is replaced with cause, pathogen,
 * allergen, firm, retailer, geography and illness prose, and the derivation
 * must come out byte-identical over the whole corpus. The product sentence is
 * deliberately preserved — rewriting it would change the product, which is
 * supposed to change the answer.
 *
 * ## This shape must track the classifier's (C10A.2)
 *
 * It did not, and the gap was loud rather than silent, which is the point of
 * measuring. C10A.2 made the noun "items"/"products" optional, so the
 * classifier began reading sentences like "The fried pork rinds were produced
 * on…". This constant still required the noun, so the rewrite DELETED the
 * product sentence on exactly those 12 cases and the gate reported them as
 * hazard-sensitive. They were not: with the shipped shape preserved, zero of
 * the 1,914 stored cases move. A shape that under-matches here does not test
 * hazard blindness at all — it tests what happens when you erase the product
 * name, which is supposed to change the answer.
 */
const PRODUCT_SENTENCE_SHAPE = /\bThe\s+[^.\n]{3,200}?\s+(?:was|were)\s+produced\b/i;

const ANNOUNCEMENT_NOISE = [
  'The recalled articles may be contaminated with Salmonella, Listeria monocytogenes and undeclared milk, wheat, shellfish and peanuts. ',
  'Dairy Bakery Seafood Co, a Fishtown establishment, began the recall after a complaint about chocolate cake, cheese and shrimp. ',
  'These articles were shipped to Whole Foods, Costco and Dairy Barn in Maine, California and Puerto Rico. ',
  'There have been confirmed reports of illness and adverse reactions to the undeclared peanut allergen. ',
];

function poisonAnnouncement(summary: string): string {
  let index = 0;
  return summary
    .split(/(?<=[.\n])/)
    .map((chunk) =>
      PRODUCT_SENTENCE_SHAPE.test(chunk)
        ? chunk
        : ANNOUNCEMENT_NOISE[index++ % ANNOUNCEMENT_NOISE.length],
    )
    .join('');
}

async function main(): Promise<void> {
  loadDotEnv();
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY.');
    process.exit(1);
  }
  const store = new SupabaseStore(createSupabaseServerClient(url, secretKey));
  const rows = await store.listCases();

  interface Derived {
    id: string;
    agency: string;
    active: boolean;
    categories: FoodCategoryId[];
    stored: FoodCategoryId[] | null;
    basis: string;
    text: string;
  }

  const derived: Derived[] = [];
  for (const row of rows) {
    const p = row.projection;
    const input = {
      sourceAgency: p.sourceAgency,
      title: p.title,
      productDescription: p.productDescription ?? null,
      affectedProducts: p.affectedProducts ?? [],
      summaryText: p.summaryText ?? null,
    };
    const categories = deriveProductCategories(input);
    const productText = categoryProductText({
      sourceAgency: p.sourceAgency,
      title: p.title,
      productDescription: p.productDescription ?? null,
      announcementSummary: p.summaryText ?? null,
      productLines: (p.affectedProducts ?? []).map((a) => a.name),
    });
    derived.push({
      id: row.id,
      agency: p.sourceAgency,
      active: p.state === 'active',
      categories,
      stored: readProductCategories(p),
      basis: productText.basis,
      text: productText.text,
    });
  }

  const all = derived;
  const active = derived.filter((d) => d.active);
  console.log(`\nProduct-category QA — ${all.length} cases (${active.length} active)`);
  console.log(
    `Vocabulary (${FOOD_CATEGORIES.length}): ${FOOD_CATEGORIES.map((c) => foodCategoryLabel(c.id)).join(' · ')}`,
  );
  console.log(
    `\nNOTE: accuracy is NOT measured here, and the classifier does NOT meet its gate.` +
      `\n      C10A.2 measured 87.5% natural exact-set / 88.0% at-least-one-correct against a` +
      `\n      90% bar on a 200-case holdout of previously untouched cases — see` +
      `\n      npm run qa:categories, which exits non-zero for that reason.`,
  );

  // ── Distribution ──────────────────────────────────────────────────────────
  console.log(`\nDISTRIBUTION (all · active)`);
  for (const category of FOOD_CATEGORIES) {
    const a = all.filter((d) => d.categories.includes(category.id));
    const b = active.filter((d) => d.categories.includes(category.id));
    const fda = a.filter((d) => d.agency === 'FDA').length;
    console.log(
      `  ${foodCategoryLabel(category.id).padEnd(21)} ${String(a.length).padStart(5)} ${pct(a.length, all.length).padStart(7)}` +
        `  ·  ${String(b.length).padStart(4)} ${pct(b.length, active.length).padStart(7)}` +
        `   (FDA ${fda}, FSIS ${a.length - fda})`,
    );
  }
  const multi = all.filter((d) => d.categories.length > 1);
  const activeMulti = active.filter((d) => d.categories.length > 1);
  const otherOnly = all.filter((d) => d.categories.length === 1 && d.categories[0] === 'other');
  const activeOtherOnly = active.filter(
    (d) => d.categories.length === 1 && d.categories[0] === 'other',
  );
  console.log(
    `  ${'(multi-category)'.padEnd(21)} ${String(multi.length).padStart(5)} ${pct(multi.length, all.length).padStart(7)}` +
      `  ·  ${String(activeMulti.length).padStart(4)} ${pct(activeMulti.length, active.length).padStart(7)}`,
  );
  console.log(
    `  ${'(other only)'.padEnd(21)} ${String(otherOnly.length).padStart(5)} ${pct(otherOnly.length, all.length).padStart(7)}` +
      `  ·  ${String(activeOtherOnly.length).padStart(4)} ${pct(activeOtherOnly.length, active.length).padStart(7)}`,
  );

  // ── Derivation basis ──────────────────────────────────────────────────────
  console.log(`\nDERIVATION BASIS (what named the product)`);
  for (const basis of [
    'product_description',
    'title_grammar',
    'summary_grammar',
    'product_lines',
    'title_raw',
  ]) {
    const a = all.filter((d) => d.basis === basis).length;
    const b = active.filter((d) => d.basis === basis).length;
    console.log(
      `  ${basis.padEnd(21)} ${String(a).padStart(5)} ${pct(a, all.length).padStart(7)}  ·  ${String(b).padStart(4)} ${pct(b, active.length).padStart(7)}`,
    );
  }
  const structured = all.filter((d) => d.basis === 'product_description').length;
  const structuredActive = active.filter((d) => d.basis === 'product_description').length;
  console.log(
    `  → structured product name ${pct(structured, all.length)} all · ${pct(structuredActive, active.length)} active`,
  );

  // ── Storage state ─────────────────────────────────────────────────────────
  const storedCount = all.filter((d) => d.stored !== null).length;
  const staleCount = all.filter(
    (d) => d.stored !== null && d.stored.join('|') !== d.categories.join('|'),
  ).length;
  console.log(`\nSTORAGE STATE`);
  console.log(`  projections carrying categories: ${storedCount} / ${all.length}`);
  console.log(`  projections predating the field: ${all.length - storedCount}`);
  console.log(`  stored but stale (backfill would rewrite): ${staleCount}`);
  console.log(
    `  → backfill would write ${all.length - storedCount + staleCount} case(s); run backfill:product-categories:dry for the plan`,
  );

  // ── Examples ──────────────────────────────────────────────────────────────
  const sorted = [...all].sort((a, b) => a.id.localeCompare(b.id));
  console.log(`\nREPRESENTATIVE EXAMPLES (deterministic, first by case id)`);
  for (const category of FOOD_CATEGORY_IDS) {
    const examples = sorted
      .filter((d) => d.categories.length === 1 && d.categories[0] === category)
      .slice(0, 2);
    console.log(`  ${foodCategoryLabel(category)}`);
    if (examples.length === 0) console.log(`    (none single-label)`);
    for (const e of examples) console.log(`    · [${e.basis}] ${e.text.slice(0, 84)}`);
  }
  console.log(`  (multi-category)`);
  for (const e of sorted.filter((d) => d.categories.length > 1).slice(0, 6)) {
    console.log(`    · ${e.categories.join('+').padEnd(34)} ${e.text.slice(0, 62)}`);
  }

  // ── High-frequency terms among `other` ────────────────────────────────────
  const freq = new Map<string, number>();
  for (const d of all.filter((x) => x.categories.includes('other'))) {
    for (const word of d.text
      .toLowerCase()
      .replace(/[^a-z ]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3)) {
      freq.set(word, (freq.get(word) ?? 0) + 1);
    }
  }
  const top = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 18);
  console.log(`\nHIGH-FREQUENCY TERMS IN 'other' (what the lexicon does not name)`);
  console.log(`  ${top.map(([w, c]) => `${w}(${c})`).join('  ') || '(none)'}`);

  // ── Structural invariants ─────────────────────────────────────────────────
  const noCategory = all.filter((d) => d.categories.length === 0).length;
  const invalidId = all.filter((d) => d.categories.some((c) => !isFoodCategoryId(c))).length;
  const duplicateId = all.filter((d) => new Set(d.categories).size !== d.categories.length).length;
  const overCap = all.filter((d) => d.categories.length > MAX_CATEGORIES_PER_CASE).length;
  const misordered = all.filter((d) => {
    const ordered = [...d.categories].sort(
      (x, y) => FOOD_CATEGORY_IDS.indexOf(x) - FOOD_CATEGORY_IDS.indexOf(y),
    );
    return ordered.join('|') !== d.categories.join('|');
  }).length;
  const otherMixed = all.filter(
    (d) => d.categories.includes('other') && d.categories.length > 1,
  ).length;

  // Determinism + fixed point: re-derive and compare.
  let nondeterministic = 0;
  for (const row of rows) {
    const p = row.projection;
    const input = {
      sourceAgency: p.sourceAgency,
      title: p.title,
      productDescription: p.productDescription ?? null,
      affectedProducts: p.affectedProducts ?? [],
    };
    const a = deriveProductCategories(input);
    const b = deriveProductCategories(input);
    if (a.join('|') !== b.join('|')) nondeterministic += 1;
  }

  // Hazard blindness, measured rather than asserted: re-derive every case with
  // the hazard, allergen and reason fields replaced by loud nonsense. The
  // derivation must be byte-identical, because it never receives them.
  let hazardSensitive = 0;
  for (const row of rows) {
    const p = row.projection;
    const base = deriveProductCategories({
      sourceAgency: p.sourceAgency,
      title: p.title,
      productDescription: p.productDescription ?? null,
      affectedProducts: p.affectedProducts ?? [],
      summaryText: p.summaryText ?? null,
    });
    const poisoned = deriveProductCategories({
      ...({
        hazardCategory: 'allergen',
        pathogenOrAllergen: 'milk wheat shellfish peanut',
        reasonText: 'undeclared milk and undeclared wheat and salmonella',
        recallingFirm: { displayName: 'Dairy Bakery Seafood Co', rawVariants: [] },
        retailerNames: ['Dairy Barn'],
      } as unknown as Record<string, never>),
      sourceAgency: p.sourceAgency,
      title: p.title,
      productDescription: p.productDescription ?? null,
      affectedProducts: p.affectedProducts ?? [],
      // C10A.1 reads ONE bounded span of the announcement, so the announcement
      // is poisoned too: every cause, pathogen, allergen, firm, retailer and
      // geography clause in it is rewritten to loud nonsense, and a sentence
      // of pure hazard prose is appended. The product-identification sentence
      // is left alone — rewriting THAT would be changing the product, which is
      // supposed to change the answer.
      summaryText: poisonAnnouncement(p.summaryText ?? ''),
    });
    if (base.join('|') !== poisoned.join('|')) hazardSensitive += 1;
  }

  // ── Feed / relevance invariance, over the whole active corpus ────────────
  //
  // Built from the stored projections rather than the anon client loader, so
  // this needs no second credential and covers every active case rather than
  // one page. The functions exercised are exactly the ones Home runs.
  const items: FeedItem[] = rows
    .filter((row) => row.projection.state === 'active')
    .map((row) => {
      const p = row.projection;
      return {
        id: row.id,
        sourceAgency: p.sourceAgency,
        noticeType: p.noticeType,
        state: p.state,
        title: p.title,
        classification: p.classification,
        hazardCategory: p.hazardCategory,
        publishedAt: p.publishedAt,
        lastPublicActivityAt: p.lastPublicActivityAt,
        reasonText: p.reasonText,
        pathogenOrAllergen: p.pathogenOrAllergen,
        firmName: p.recallingFirm?.displayName ?? null,
        brands: p.brands ?? [],
        productDescription: p.productDescription ?? null,
        retailerNames: p.retailerNames ?? [],
        heroImageUrl: p.heroImageUrl ?? null,
        productNames: (p.affectedProducts ?? []).map((a) => a.name),
        geography: p.geography,
        officialUrl: p.officialUrl,
        timeline: row.timeline ?? [],
      } satisfies FeedItem;
    });

  const derivedById = new Map(derived.map((d) => [d.id, d.categories]));
  const withCategories: FeedItem[] = items.map((item) => ({
    ...item,
    // The real derived categories, attached to the very objects the ranking
    // code consumes. Nothing downstream may notice.
    ...({ productCategories: derivedById.get(item.id) } as unknown as Record<string, never>),
  }));

  const idsOf = (list: readonly { id: string }[]): string => list.map((i) => i.id).join(',');
  const relevanceOf = (item: FeedItem) =>
    evaluatePersonalRelevance(
      {
        geography: item.geography,
        pathogenOrAllergen: item.pathogenOrAllergen,
        retailerNames: item.retailerNames,
        hazardCategory: item.hazardCategory,
        reasonText: item.reasonText,
      },
      PROFILE,
    );

  const now = new Date();
  const before = buildFeedSections(items, now);
  const after = buildFeedSections(withCategories, now);
  const allRecallsDrift =
    (idsOf(before.recent) !== idsOf(after.recent) ? 1 : 0) +
    (idsOf(before.olderActive) !== idsOf(after.olderActive) ? 1 : 0);

  const beforeAffects = buildAffectsMeSections(items, relevanceOf, { now });
  const afterAffects = buildAffectsMeSections(withCategories, relevanceOf, { now });
  const affectsDrift =
    (idsOf(beforeAffects.affects) !== idsOf(afterAffects.affects) ? 1 : 0) +
    (idsOf(beforeAffects.older) !== idsOf(afterAffects.older) ? 1 : 0);

  const relevanceDrift = items.filter((item, index) => {
    const a = relevanceOf(item);
    const b = relevanceOf(withCategories[index]);
    return (
      a.affectsMe !== b.affectsMe ||
      a.geographic !== b.geographic ||
      a.matchedAllergens.join('|') !== b.matchedAllergens.join('|') ||
      a.matchedRetailers.join('|') !== b.matchedRetailers.join('|') ||
      a.reasons.length !== b.reasons.length
    );
  }).length;

  console.log(`\nALL RECALLS / AFFECTS ME (${items.length} active cases)`);
  console.log(
    `  All Recalls recent / older:      ${before.recent.length} / ${before.olderActive.length}`,
  );
  console.log(
    `  Affects Me affects / older:      ${beforeAffects.affects.length} / ${beforeAffects.older.length}`,
  );
  console.log(
    `  qualifying under the profile:    ${items.filter((i) => relevanceOf(i).affectsMe).length}`,
  );

  const gates: Gate[] = [
    { label: 'cases with no category', value: noCategory, limit: 0 },
    { label: 'invalid category ids', value: invalidId, limit: 0 },
    { label: 'duplicate category ids', value: duplicateId, limit: 0 },
    { label: 'category lists over the cap', value: overCap, limit: 0 },
    { label: 'category lists out of display order', value: misordered, limit: 0 },
    { label: "'other' mixed with a real category", value: otherMixed, limit: 0 },
    { label: 'nondeterministic derivations', value: nondeterministic, limit: 0 },
    { label: 'categories sensitive to hazard/allergen text', value: hazardSensitive, limit: 0 },
    { label: 'All Recalls membership/order changes', value: allRecallsDrift, limit: 0 },
    { label: 'Affects Me membership/order changes', value: affectsDrift, limit: 0 },
    { label: 'personal relevance changes', value: relevanceDrift, limit: 0 },
  ];

  console.log(`\nGATES`);
  let failed = 0;
  for (const gate of gates) {
    const ok = gate.value <= gate.limit;
    if (!ok) failed += 1;
    console.log(
      `  ${ok ? 'PASS' : 'FAIL'}  ${gate.label.padEnd(46)} ${gate.value}  (gate: ${gate.limit})`,
    );
  }

  console.log(
    failed === 0
      ? `\nPASS: every case carries a valid, deterministic, hazard-blind category set, and attaching it changes nothing a consumer depends on.\n`
      : `\nFAIL: ${failed} gate(s) breached.\n`,
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
