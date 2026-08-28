/**
 * Feed completeness QA (Phase C5.1) — read-only against the live DB.
 *
 *   npm run qa:feed
 *
 * Answers the one question the app cannot answer for itself: does Home
 * actually hold every active recall? A truncated feed is indistinguishable
 * from a complete one from inside the app — the sections render, the counts
 * look plausible, and nothing errors — so completeness has to be checked
 * against an independent authority.
 *
 * It therefore compares two different paths to the same corpus:
 *
 *   AUTHORITATIVE  a server-side `count=exact` over the consumer read
 *                  contract — `state = active AND merged_into IS NULL` — via
 *                  the service role, never row-limited, and not the path the
 *                  app uses. The `merged_into` half is not a convenience: it
 *                  is the RLS policy the client reads under, so a case merged
 *                  into another is not missing from the feed, it is
 *                  deliberately represented by its surviving case. Both
 *                  numbers are printed so that distinction stays visible
 *                  rather than being quietly absorbed into the baseline.
 *   LOADED         the real client loader (`fetchFeedPage` + `loadAllPages`,
 *                  which together ARE `fetchCurrentFeed`) over the anon key
 *                  and RLS, exactly as the phone runs it. The loader is driven,
 *                  never reimplemented, so this measures shipping code.
 *
 * Then it re-derives every downstream number — All Recalls sections, "affects
 * me" eligibility and sections for the representative profile — from what the
 * loader returned, so a shortfall shows up as the product damage it causes.
 *
 * Hard gates (non-zero exit): missing active ids, duplicate ids, and any
 * qualifying case that no section placed.
 */

import type { UserRecallPreferences } from '../src/domain/preferences';
import { buildAffectsMeSections } from '../src/lib/affects-me-ranking';
import { buildFeedSections } from '../src/lib/feed-relevance';
import { FEED_PAGE_SIZE, loadAllPages } from '../src/lib/feed-pagination';
import type { FeedItem } from '../src/lib/recall-feed';
import { evaluatePersonalRelevance } from '../src/lib/relevance';
import { createSupabaseServerClient } from '../src/server/store/supabase-store';

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

async function main(): Promise<void> {
  loadDotEnv();

  // The client loader reads EXPO_PUBLIC_* at module load, so it must be
  // imported after the env file is in place.
  const { fetchFeedPage, isFeedConfigured } = await import('../src/lib/recall-feed');

  if (!isFeedConfigured()) {
    console.error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.');
    process.exit(1);
  }
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY (needed for the independent count).');
    process.exit(1);
  }

  console.log('FEED COMPLETENESS QA (C5.1) — read-only\n');

  // ── Authoritative count, independent of the client path ───────────────────
  const admin = createSupabaseServerClient(url, secretKey);
  const { count: allActive, error: allError } = await admin
    .from('recall_cases')
    .select('id', { count: 'exact', head: true })
    .eq('state', 'active');
  const { count: activeCount, error: countError } = await admin
    .from('recall_cases')
    .select('id', { count: 'exact', head: true })
    .eq('state', 'active')
    .is('merged_into', null);
  if (countError || allError || activeCount === null || allActive === null) {
    console.error(
      `Authoritative count failed: ${countError?.message ?? allError?.message ?? 'no count returned'}`,
    );
    process.exit(1);
  }

  const { data: idRows, error: idError } = await fetchAllActiveIds(admin);
  if (idError) {
    console.error(`Authoritative id sweep failed: ${idError}`);
    process.exit(1);
  }
  const authoritativeIds = new Set(idRows);

  console.log('AUTHORITATIVE (service role, server-side count)');
  console.log(`  active recall cases:            ${allActive}`);
  console.log(
    `  of which merged into another:   ${allActive - activeCount} ` +
      `(hidden from the client by RLS, by design — the surviving case carries them)`,
  );
  console.log(`  consumer-visible active cases:  ${activeCount}   <- the completeness target`);
  console.log(`  ids swept:                      ${authoritativeIds.size}`);

  // ── The real client loader ────────────────────────────────────────────────
  let pages = 0;
  const pageSizes: number[] = [];
  const instrumented = async (cursor: string | null, pageSize: number): Promise<FeedItem[]> => {
    const rows = await fetchFeedPage(cursor, pageSize);
    pages += 1;
    pageSizes.push(rows.length);
    return rows;
  };

  const started = Date.now();
  const items = await loadAllPages(instrumented);
  const elapsed = Date.now() - started;

  const loadedIds = items.map((i) => i.id);
  const uniqueLoaded = new Set(loadedIds);
  const missing = [...authoritativeIds].filter((id) => !uniqueLoaded.has(id));
  const unexpected = [...uniqueLoaded].filter((id) => !authoritativeIds.has(id));
  const duplicates = loadedIds.length - uniqueLoaded.size;

  console.log('\nLOADED (client loader: fetchFeedPage + loadAllPages)');
  console.log(`  page size:                      ${FEED_PAGE_SIZE}`);
  console.log(`  pages requested:                ${pages} (${pageSizes.join(' + ')} rows)`);
  console.log(`  rows returned:                  ${items.length}`);
  console.log(`  unique case ids:                ${uniqueLoaded.size}`);
  console.log(`  duration:                       ${elapsed} ms`);

  const sortStarted = Date.now();
  const { recent, olderActive } = buildFeedSections(items);
  const sortMs = Date.now() - sortStarted;

  console.log('\nCOMPLETENESS');
  console.log(`  missing active ids:             ${missing.length}  (gate: 0)`);
  console.log(`  duplicate ids:                  ${duplicates}  (gate: 0)`);
  console.log(`  ids not in the active set:      ${unexpected.length}  (gate: 0)`);
  console.log(`  coverage:                       ${uniqueLoaded.size}/${activeCount}`);
  if (missing.length > 0) {
    console.log(`  first missing:                  ${missing.slice(0, 5).join(', ')}`);
  }

  // What the old single-request path would have delivered, for contrast.
  const OLD_LIMIT = 500;
  console.log('\nAGAINST THE PREVIOUS BEHAVIOUR');
  console.log(`  previous request limit:         ${OLD_LIMIT}`);
  console.log(
    `  active cases it could not see:  ${Math.max(0, activeCount - OLD_LIMIT)} ` +
      `(${((Math.max(0, activeCount - OLD_LIMIT) / activeCount) * 100).toFixed(1)}% of the corpus)`,
  );

  console.log('\nALL RECALLS (unchanged product behaviour, complete input)');
  console.log(`  recent:                         ${recent.length}`);
  console.log(`  older active:                   ${olderActive.length}`);
  console.log(`  total placed:                   ${recent.length + olderActive.length}`);
  console.log(
    `  omitted active cases:           ${items.length - recent.length - olderActive.length}  (gate: 0)`,
  );
  console.log(`  client sectioning + sort:       ${sortMs} ms`);

  // ── Affects Me over the complete corpus ───────────────────────────────────
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

  const rankStarted = Date.now();
  const sections = buildAffectsMeSections(items, relevanceOf);
  const rankMs = Date.now() - rankStarted;

  const qualifying = items.filter((item) => relevanceOf(item).affectsMe);
  const placed = [...sections.affects, ...sections.older];
  const placedIds = new Set(placed.map((i) => i.id));

  console.log(
    `\nAFFECTS ME — representative profile (${PROFILE.state} · ` +
      `${PROFILE.allergens.join(', ')} · ${PROFILE.retailers.join(', ')})`,
  );
  console.log(`  qualifying (eligibility):       ${qualifying.length}`);
  console.log(
    `  placed in affects + older:      ${sections.affects.length + sections.older.length}`,
  );
  console.log(
    `  eligibility unaccounted for:    ${qualifying.length - sections.affects.length - sections.older.length}  (gate: 0)`,
  );
  console.log(`  affects me (recent):            ${sections.affects.length}`);
  console.log(`  older active:                   ${sections.older.length}`);
  console.log(`  duplicates across sections:     ${placed.length - placedIds.size}  (gate: 0)`);
  console.log(`  ranking over ${items.length} cases:        ${rankMs} ms`);

  // How much of the personalized result the old 500-row window could not see.
  // Ordering is by id, which is unrelated to relevance, so this is measured,
  // not assumed: it is simply which qualifying cases fell outside the window.
  const oldWindow = new Set(
    [...items]
      .sort(
        (a, b) =>
          b.lastPublicActivityAt.localeCompare(a.lastPublicActivityAt) ||
          b.publishedAt.localeCompare(a.publishedAt) ||
          a.id.localeCompare(b.id),
      )
      .slice(0, OLD_LIMIT)
      .map((i) => i.id),
  );
  const lostQualifying = qualifying.filter((i) => !oldWindow.has(i.id));
  const lostAffects = sections.affects.filter((i) => !oldWindow.has(i.id));
  console.log(`  qualifying cases the 500-row window missed: ${lostQualifying.length}`);
  console.log(`  of those, in the recent "Affects me" list:  ${lostAffects.length}`);

  const failures = [
    missing.length > 0 && `${missing.length} active case(s) missing from the loaded feed`,
    duplicates > 0 && `${duplicates} duplicate id(s)`,
    unexpected.length > 0 && `${unexpected.length} loaded id(s) not active`,
    items.length - recent.length - olderActive.length !== 0 && 'All Recalls omitted active cases',
    qualifying.length - sections.affects.length - sections.older.length !== 0 &&
      'Affects Me eligibility does not match placement',
    placed.length !== placedIds.size && 'a case appears in more than one section',
  ].filter(Boolean);

  console.log('');
  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL: ${failure}`);
    process.exit(1);
  }
  console.log('PASS: every active case is loaded exactly once and placed exactly once.');
}

/**
 * Sweep every consumer-visible active id via the service role, paging past the
 * server cap. Ordered by the primary key so the range windows cannot overlap
 * or skip — the same reason the client pages on `id`.
 */
async function fetchAllActiveIds(
  admin: ReturnType<typeof createSupabaseServerClient>,
): Promise<{ data: string[]; error: string | null }> {
  const ids: string[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from('recall_cases')
      .select('id')
      .eq('state', 'active')
      .is('merged_into', null)
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) return { data: [], error: error.message };
    ids.push(...(data ?? []).map((row) => row.id as string));
    if (!data || data.length < pageSize) break;
  }
  return { data: ids, error: null };
}

void main();
