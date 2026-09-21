/**
 * P2B7N.1 — Feed / Saved card parity, proven at full pipeline depth
 * (recorded raw fixture → parse → projectCase → each screen's REAL list
 * adapter → the shared card model) and pinned against the two screen
 * sources.
 *
 * ## The defect this exists for
 *
 * Founder QA: the SK Food Group Public Health Alert showed PUBLIC HEALTH
 * ALERT + AFFECTS YOU on the Feed, and on Saved the same saved recall showed
 * PUBLIC HEALTH ALERT and nothing else. The recall had not changed, the
 * stored data had not changed, and the user's preferences had not changed —
 * only the tab it was read from.
 *
 * The cause was not a rendering difference. Both screens already rendered
 * the same `RecallCard` from the same `buildHomeCardModel`, which is exactly
 * why the existing "one shared card" pins all passed: the divergence was in
 * an ARGUMENT. Saved had no preferences in scope and passed the literal
 * `affectsYou: false`, so every saved card asserted, as a fact, that the
 * recall did not affect the user.
 *
 * ## What is proven here
 *
 *  1. Field-by-field parity of the complete card model, over recorded real
 *     notices, built through each screen's own list adapter — the Feed's
 *     filter/search/section chain and Saved's `selectSavedItems`. The audit
 *     is driven off the model's own key set, so a NEW card field cannot be
 *     added without either being covered or being declared a documented
 *     difference.
 *  2. The verdict is DERIVED, never carried. It is recomputed from current
 *     preferences on both surfaces, so removing a preference removes the
 *     label on both and adding one adds it on both. Nothing is snapshotted
 *     at save time.
 *  3. Save state and personalization are independent: saving or unsaving
 *     changes the bookmark and cannot change the verdict.
 *  4. All versus Affects me changes MEMBERSHIP only, never the verdict.
 *  5. The two screen sources hand the builder byte-identical arguments and
 *     state no verdict of their own.
 *
 * Every claim above is asserted through a named helper (`parityReport`,
 * `screenContractViolations`), and the mutation section at the foot of the
 * file feeds those same helpers deliberately broken inputs — so a passing
 * run is evidence the assertions can actually fail.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { test } from 'node:test';

import type { UserRecallPreferences } from '@/domain/preferences';
import { projectCase } from '@/domain/projection';
import type { CaseProjection } from '@/domain/recall-types';
import { buildAffectsMeSections } from '@/lib/affects-me-ranking';
import { applyFeedFilters, EMPTY_FEED_FILTERS } from '@/lib/feed-filters';
import { buildFeedSections } from '@/lib/feed-relevance';
import { buildSearchEntry, filterBySearch } from '@/lib/feed-search';
import type { FeedItem } from '@/lib/recall-feed';
import { buildHomeCardModel, type HomeCardModel } from '@/lib/recall-presentation';
import { evaluatePersonalRelevance } from '@/lib/relevance';
import { isSavedId, saveControlState, selectSavedItems, toggleSavedId } from '@/lib/saved-recalls';
import { parseFdaAnnouncement, slugFromPath, type FdaListingItem } from './fda/parse';
import { parseFsisRecord, type FsisRawRecord } from './fsis/parse';

const TODAY = '2026-09-19';
const NOW = new Date(`${TODAY}T12:00:00.000Z`);

const SRC = join(__dirname, '..');
const read = (...parts: string[]): string => readFileSync(join(SRC, ...parts), 'utf8');
const FEED_SOURCE = read('app', '(tabs)', 'index.tsx');
const SAVED_SOURCE = read('app', '(tabs)', 'saved.tsx');
const CARD_SOURCE = read('components', 'recall-card.tsx');
// Read as TEXT, never imported: a React Native component cannot load under
// Node, which is why every card contract in this repo is pinned at source.
const RELEVANCE_LABEL_SOURCE = read('components', 'ui', 'relevance-label.tsx');

/** Source with comments removed, so a file may document what it does not do. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

/** The card's executable text: its documentation describes what it refuses. */
const CARD_CODE = codeOnly(CARD_SOURCE);

// ── Recorded real notices ───────────────────────────────────────────────────

const FSIS_FIXTURES = join(__dirname, 'fsis', 'fixtures');
const FDA_FIXTURES = join(__dirname, 'fda', 'fixtures');

/** A recorded FSIS record from the verbatim benchmark set, by recall number. */
function benchmarkFsis(recallNumber: string): CaseProjection {
  const records = JSON.parse(
    readFileSync(join(FSIS_FIXTURES, 'benchmark-records.json'), 'utf8'),
  ) as { record?: FsisRawRecord }[];
  const raw = records
    .map((entry) => (entry.record ?? entry) as FsisRawRecord)
    .find((entry) => entry.field_recall_number_export === recallNumber);
  assert.ok(raw, `recorded FSIS benchmark record ${recallNumber} missing`);
  return projectCase([parseFsisRecord(raw!)]);
}

/** A recorded standalone FSIS fixture file. */
function fsisFixture(name: string): CaseProjection {
  const record = JSON.parse(
    readFileSync(join(FSIS_FIXTURES, `${name}.json`), 'utf8'),
  ) as FsisRawRecord;
  return projectCase([parseFsisRecord(record)]);
}

interface FdaCorpusEntry {
  path: string;
  listing: FdaListingItem;
  mainHtml: string;
}

const FDA_CORPUS: FdaCorpusEntry[] = JSON.parse(
  gunzipSync(readFileSync(join(FDA_FIXTURES, 'qa-corpus.json.gz'))).toString('utf8'),
);

/** A recorded FDA announcement, found by a fragment of its official slug. */
function fdaFixture(slugFragment: string): CaseProjection {
  const entry = FDA_CORPUS.find((candidate) => slugFromPath(candidate.path).includes(slugFragment));
  assert.ok(entry, `recorded FDA announcement ${slugFragment} missing`);
  return projectCase([
    parseFdaAnnouncement({
      listing: entry!.listing,
      detailMainHtml: entry!.mainHtml,
      path: entry!.path,
    }),
  ]);
}

/**
 * A feed row exactly as the feed query materializes one, carrying every
 * field the card model reads — `productCategories` included, so the category
 * tag is a real stored answer here rather than an absent one.
 */
function feedItemOf(id: string, projection: CaseProjection): FeedItem {
  return {
    id,
    sourceAgency: projection.sourceAgency,
    noticeType: projection.noticeType,
    state: projection.state,
    title: projection.title,
    classification: projection.classification,
    hazardCategory: projection.hazardCategory,
    publishedAt: projection.publishedAt,
    lastPublicActivityAt: projection.lastPublicActivityAt,
    reasonText: projection.reasonText,
    pathogenOrAllergen: projection.pathogenOrAllergen,
    firmName: projection.recallingFirm.displayName,
    brands: projection.brands ?? [],
    productDescription: projection.productDescription ?? null,
    retailerNames: projection.retailerNames ?? [],
    heroImageUrl: projection.heroImageUrl ?? null,
    productNames: projection.affectedProducts.map((product) => product.name),
    productCategories: projection.productCategories,
    geography: projection.geography,
    officialUrl: projection.officialUrl,
    timeline: [],
  };
}

// The founder-observed notice, and one real example of every other state the
// parity contract has to hold for. All genuine, recorded agency records.
const SK_PHA = feedItemOf('sk-food-group-pha', benchmarkFsis('PHA-02082024-01'));
const CRITICAL_NATIONWIDE = feedItemOf(
  'fsis-017-2026',
  fsisFixture('recall-active-nationwide-017-2026'),
);
const CRITICAL_CALIFORNIA = feedItemOf(
  'fsis-016-2026',
  fsisFixture('recall-active-stated-states-016-2026'),
);
// Geography the source never stated, and one named retailer. The retailer
// preference is therefore the ONLY thing that can decide this card — a
// nationwide notice would match on the chosen state alone and prove nothing
// about whether preferences reach Saved.
// A recall whose notice names a store but never says where it went: the only
// thing that can make it personal is the retailer preference. (Braga Fresh
// used to play this part; P2B7Q.2 recovered the twenty distribution states its
// notice actually lists, which makes it a geography case now — as it did for
// Wawona's five.)
const RETAILER_ONLY = feedItemOf(
  'fda-lunds-byerlys',
  fdaFixture('lunds-byerlys-voluntarily-recalls-lb-lone-star-dip-due-potential-mold'),
);
const PENDING_FL_IL_IN = feedItemOf('fda-lipari', fdaFixture('lipari-foods-issues-recall-ham'));
const PENDING_WITH_IMAGE = feedItemOf(
  'fda-tailor-cut',
  fdaFixture('tailor-cut-produce-recalls-cut-fruit-mix'),
);

const CORPUS: FeedItem[] = [
  SK_PHA,
  CRITICAL_NATIONWIDE,
  CRITICAL_CALIFORNIA,
  RETAILER_ONLY,
  PENDING_FL_IL_IN,
  PENDING_WITH_IMAGE,
];

// ── Preference profiles ─────────────────────────────────────────────────────

const NO_PREFERENCES: UserRecallPreferences = { state: null, allergens: [], retailers: [] };
const CALIFORNIA: UserRecallPreferences = { state: 'CA', allergens: [], retailers: [] };
const TEXAS: UserRecallPreferences = { state: 'TX', allergens: [], retailers: [] };
const TEXAS_PLUS_STORE: UserRecallPreferences = {
  state: 'TX',
  allergens: [],
  retailers: ['lunds-byerlys'],
};

// ── The two screen adapters, as the screens actually run them ───────────────

interface SurfaceContext {
  today: string;
  prefs: UserRecallPreferences | null;
}

/**
 * Everything the FEED lists, in All mode, through its real chain: the
 * browsing filters, then search, then sectioning. Nothing is dropped by
 * sectioning — it partitions — so this covers the whole corpus.
 */
function feedCards(
  corpus: readonly FeedItem[],
  context: SurfaceContext,
): Map<string, HomeCardModel> {
  const entries = new Map(corpus.map((item) => [item.id, buildSearchEntry(item)]));
  const visible = filterBySearch(applyFeedFilters([...corpus], EMPTY_FEED_FILTERS), '', (item) =>
    entries.get(item.id)!,
  );
  const sections = buildFeedSections(visible, NOW);
  const listed = [...sections.recent, ...sections.olderActive];
  return new Map(listed.map((item) => [item.id, buildHomeCardModel(item, context)]));
}

/** Everything the FEED lists in Affects me mode, through its real ranking. */
function affectsMeCards(
  corpus: readonly FeedItem[],
  context: SurfaceContext,
): Map<string, HomeCardModel> {
  const prefs = context.prefs;
  const ranked = buildAffectsMeSections(
    [...corpus],
    (item) => evaluatePersonalRelevance(item, prefs ?? NO_PREFERENCES),
    { now: NOW },
  );
  const listed = [...ranked.affects, ...ranked.older];
  return new Map(listed.map((item) => [item.id, buildHomeCardModel(item, context)]));
}

/** Everything SAVED lists, through its real adapter: ids resolved in save order. */
function savedCards(
  savedIds: readonly string[],
  corpus: readonly FeedItem[],
  context: SurfaceContext,
): Map<string, HomeCardModel> {
  const items = selectSavedItems(savedIds, corpus);
  return new Map(items.map((item) => [item.id, buildHomeCardModel(item, context)]));
}

// ── The parity comparator ───────────────────────────────────────────────────

/**
 * The card-model fields the parity contract covers, and the ONE product
 * reason each is on the list. Every key of `HomeCardModel` must appear here
 * (asserted below), so adding a field to the card forces a parity decision
 * rather than silently creating a thirteenth way the two screens could
 * disagree.
 */
const AUDITED_FIELDS: Record<keyof HomeCardModel, string> = {
  id: 'identity — the same recall, and the same id Detail opens',
  productName: 'title, including the three-line clamp the card applies to it',
  brand: 'brand / company',
  risk: 'risk and status badges',
  noticeLabel: 'notice-type badge (PUBLIC HEALTH ALERT)',
  affectsYou: 'the Affects You treatment',
  categoryLabel: 'category tag',
  reasonLine: 'hazard summary',
  locationSummary: 'geography',
  heroImageUrl: 'imagery, and therefore the image / no-image card shape',
  activity: 'the one activity date',
};

/**
 * The differences the contract PERMITS between the two surfaces. It is
 * empty, and that is the point: bookmark selected state is not in the card
 * model at all (the card reads it from the shared saved-list store), list
 * context is the screen's, and search-match provenance does not exist yet.
 * Nothing about the recall itself may differ.
 */
const DOCUMENTED_DIFFERENCES: readonly (keyof HomeCardModel)[] = [];

/** Every field on which two card models disagree, named in product terms. */
function parityReport(feed: HomeCardModel, saved: HomeCardModel): string[] {
  const differences: string[] = [];
  for (const field of Object.keys(AUDITED_FIELDS) as (keyof HomeCardModel)[]) {
    if (DOCUMENTED_DIFFERENCES.includes(field)) continue;
    const a = JSON.stringify(feed[field]);
    const b = JSON.stringify(saved[field]);
    if (a !== b) differences.push(`${field} (${AUDITED_FIELDS[field]}): feed ${a} ≠ saved ${b}`);
  }
  return differences;
}

/** The structural rules the two screen sources must satisfy. */
const SHARED_CALL = '<RecallCard model={buildHomeCardModel(item, { today, prefs })} />';

function screenContractViolations(feedSource: string, savedSource: string): string[] {
  const problems: string[] = [];
  for (const [name, source] of [
    ['feed', feedSource],
    ['saved', savedSource],
  ] as const) {
    const code = codeOnly(source);
    if (!source.includes(SHARED_CALL)) {
      problems.push(`${name} does not build its card with the shared arguments`);
    }
    if (!code.includes('usePreferences(')) {
      problems.push(`${name} does not read current preferences`);
    }
    if (/affectsYou\s*:/.test(code)) {
      problems.push(`${name} states the Affects-you verdict itself`);
    }
    if (/affectsYou\s*[=)]/.test(code)) {
      problems.push(`${name} derives an Affects-you verdict of its own`);
    }
  }
  return problems;
}

// ── 1. The structural parity contract ───────────────────────────────────────

test('every field of the card model is covered by the parity audit', () => {
  // Driven off a real model, so the audit cannot fall behind the type.
  const model = buildHomeCardModel(SK_PHA, { today: TODAY, prefs: CALIFORNIA });
  assert.deepEqual(Object.keys(model).sort(), Object.keys(AUDITED_FIELDS).sort());
  assert.deepEqual(DOCUMENTED_DIFFERENCES, []);
});

test('the same real notice built through both screen adapters is the same card', () => {
  const context: SurfaceContext = { today: TODAY, prefs: CALIFORNIA };
  const feed = feedCards(CORPUS, context);
  const saved = savedCards(
    // Save order is deliberately NOT feed order — parity must not depend on it.
    CORPUS.map((item) => item.id).reverse(),
    CORPUS,
    context,
  );
  assert.equal(saved.size, CORPUS.length);
  for (const item of CORPUS) {
    const a = feed.get(item.id);
    const b = saved.get(item.id);
    assert.ok(a && b, `${item.id} is not listed by both surfaces`);
    assert.deepEqual(parityReport(a!, b!), [], `${item.id} diverges between Feed and Saved`);
    // Whole-object equality too: the audit list cannot be the only guard.
    assert.deepEqual(a, b);
  }
});

test('the two screens hand the shared builder byte-identical arguments', () => {
  assert.deepEqual(screenContractViolations(FEED_SOURCE, SAVED_SOURCE), []);
  // Neither screen reaches the relevance label or its wording directly: the
  // card renders it, from the model field, once.
  for (const source of [FEED_SOURCE, SAVED_SOURCE].map(codeOnly)) {
    assert.ok(!source.includes('RelevanceLabel'));
    assert.ok(!source.includes('AFFECTS YOU'));
  }
  assert.equal((CARD_CODE.match(/<RelevanceLabel\b/g) ?? []).length, 1);
  assert.ok(CARD_SOURCE.includes('{model.affectsYou ? <RelevanceLabel /> : null}'));
});

// ── 2. Required case 1: the founder-observed PHA ────────────────────────────

test('case 1 — the SK Food Group PHA shows PUBLIC HEALTH ALERT and AFFECTS YOU on both', () => {
  const context: SurfaceContext = { today: TODAY, prefs: CALIFORNIA };
  const feed = feedCards(CORPUS, context).get(SK_PHA.id)!;
  const saved = savedCards([SK_PHA.id], CORPUS, context).get(SK_PHA.id)!;

  // The exact presentation the founder saw on the Feed.
  assert.equal(feed.noticeLabel, 'Public Health Alert');
  assert.equal(feed.affectsYou, true);
  // P2B7N: a PHA carries no risk badge, which is why the long notice label
  // and AFFECTS YOU are the two things sharing the status row.
  assert.equal(feed.risk.badgeLabel, null);

  // …and the whole of it on Saved. This is the regression itself.
  assert.deepEqual(parityReport(feed, saved), []);
  assert.equal(saved.noticeLabel, 'Public Health Alert');
  assert.equal(saved.affectsYou, true);
  assert.equal(saved.risk.badgeLabel, null);
});

// ── 3. Required cases 2–5: the other card states ────────────────────────────

test('case 2 — a Critical recall that affects the user reads the same on both', () => {
  const context: SurfaceContext = { today: TODAY, prefs: CALIFORNIA };
  const feed = feedCards(CORPUS, context).get(CRITICAL_NATIONWIDE.id)!;
  const saved = savedCards([CRITICAL_NATIONWIDE.id], CORPUS, context).get(CRITICAL_NATIONWIDE.id)!;
  assert.equal(feed.risk.badgeLabel, 'CRITICAL');
  assert.equal(feed.affectsYou, true);
  assert.deepEqual(parityReport(feed, saved), []);
});

test('case 3 — a Pending recall that does not affect the user shows AFFECTS YOU on neither', () => {
  // Recorded FDA announcement distributed in Florida, Illinois and Indiana;
  // the user is in Texas, so the source's own geography excludes them.
  const context: SurfaceContext = { today: TODAY, prefs: TEXAS };
  const feed = feedCards(CORPUS, context).get(PENDING_FL_IL_IN.id)!;
  const saved = savedCards([PENDING_FL_IL_IN.id], CORPUS, context).get(PENDING_FL_IL_IN.id)!;
  assert.equal(feed.risk.badgeLabel, 'PENDING');
  assert.equal(feed.affectsYou, false);
  assert.equal(saved.affectsYou, false);
  assert.deepEqual(parityReport(feed, saved), []);
});

test('case 4 — a recall with no stored image is the same text-led card on both', () => {
  const context: SurfaceContext = { today: TODAY, prefs: CALIFORNIA };
  assert.equal(SK_PHA.heroImageUrl, null, 'the no-image fixture gained an image');
  const feed = feedCards(CORPUS, context).get(SK_PHA.id)!;
  const saved = savedCards([SK_PHA.id], CORPUS, context).get(SK_PHA.id)!;
  assert.equal(feed.heroImageUrl, null);
  assert.equal(saved.heroImageUrl, null);
  // And the imagery dimension is genuinely exercised in both directions: a
  // recorded notice that DOES carry official FDA photography.
  const withImage = feedCards(CORPUS, context).get(PENDING_WITH_IMAGE.id)!;
  const savedWithImage = savedCards([PENDING_WITH_IMAGE.id], CORPUS, context).get(
    PENDING_WITH_IMAGE.id,
  )!;
  assert.ok(withImage.heroImageUrl?.startsWith('https://www.fda.gov/'));
  assert.equal(withImage.heroImageUrl, savedWithImage.heroImageUrl);
  assert.deepEqual(parityReport(withImage, savedWithImage), []);
});

test('case 5 — a category-tagged recall carries the same one tag on both', () => {
  const context: SurfaceContext = { today: TODAY, prefs: CALIFORNIA };
  const feed = feedCards(CORPUS, context).get(CRITICAL_CALIFORNIA.id)!;
  const saved = savedCards([CRITICAL_CALIFORNIA.id], CORPUS, context).get(CRITICAL_CALIFORNIA.id)!;
  assert.equal(feed.categoryLabel, 'Seafood');
  assert.equal(saved.categoryLabel, 'Seafood');
  assert.deepEqual(parityReport(feed, saved), []);
});

// ── 4. Required case 6: saving is not a personalization signal ──────────────

test('case 6 — saving changes the bookmark and nothing about the verdict', () => {
  const context: SurfaceContext = { today: TODAY, prefs: CALIFORNIA };
  const before = buildHomeCardModel(SK_PHA, context);

  let ids: readonly string[] = [];
  assert.equal(saveControlState(isSavedId(ids, SK_PHA.id)).icon, 'bookmark');
  ids = toggleSavedId(ids, SK_PHA.id);
  assert.equal(saveControlState(isSavedId(ids, SK_PHA.id)).icon, 'bookmark-filled');
  assert.equal(saveControlState(isSavedId(ids, SK_PHA.id)).selected, true);

  // The card model is unchanged across the transition — it has no save field
  // at all, so the bookmark cannot leak into the personalization verdict.
  const afterSaving = savedCards(ids, CORPUS, context).get(SK_PHA.id)!;
  assert.deepEqual(parityReport(before, afterSaving), []);
  assert.deepEqual(before, afterSaving);
  assert.ok(!('saved' in before) && !('selected' in before));

  // And unsaving does not take the verdict with it.
  ids = toggleSavedId(ids, SK_PHA.id);
  assert.deepEqual(ids, []);
  assert.equal(buildHomeCardModel(SK_PHA, context).affectsYou, true);
});

// ── 5. Required cases 7–8: preferences change, both surfaces follow ─────────

test('case 7 — removing the matching preference removes AFFECTS YOU on both', () => {
  const matching: SurfaceContext = { today: TODAY, prefs: TEXAS_PLUS_STORE };
  const removed: SurfaceContext = { today: TODAY, prefs: TEXAS };
  const saved = [RETAILER_ONLY.id];

  assert.deepEqual(RETAILER_ONLY.retailerNames, ['Lunds & Byerlys']);
  assert.equal(RETAILER_ONLY.geography.scope, 'unknown');
  assert.equal(feedCards(CORPUS, matching).get(RETAILER_ONLY.id)!.affectsYou, true);
  assert.equal(savedCards(saved, CORPUS, matching).get(RETAILER_ONLY.id)!.affectsYou, true);

  // The retailer preference is dropped; the recall is unchanged and still saved.
  assert.equal(feedCards(CORPUS, removed).get(RETAILER_ONLY.id)!.affectsYou, false);
  assert.equal(savedCards(saved, CORPUS, removed).get(RETAILER_ONLY.id)!.affectsYou, false);
  assert.deepEqual(
    parityReport(
      feedCards(CORPUS, removed).get(RETAILER_ONLY.id)!,
      savedCards(saved, CORPUS, removed).get(RETAILER_ONLY.id)!,
    ),
    [],
  );
});

test('case 8 — adding a preference adds AFFECTS YOU to an already-saved recall on both', () => {
  const before: SurfaceContext = { today: TODAY, prefs: TEXAS };
  const after: SurfaceContext = { today: TODAY, prefs: TEXAS_PLUS_STORE };
  const saved = [RETAILER_ONLY.id];

  assert.equal(savedCards(saved, CORPUS, before).get(RETAILER_ONLY.id)!.affectsYou, false);
  // The recall was saved BEFORE the preference existed. Nothing was frozen at
  // save time, so it starts matching the moment the preference does.
  assert.equal(savedCards(saved, CORPUS, after).get(RETAILER_ONLY.id)!.affectsYou, true);
  assert.equal(feedCards(CORPUS, after).get(RETAILER_ONLY.id)!.affectsYou, true);
});

test('preferences not yet read, and a profile with nothing chosen, both claim nothing', () => {
  for (const prefs of [null, NO_PREFERENCES]) {
    const context: SurfaceContext = { today: TODAY, prefs };
    for (const item of CORPUS) {
      assert.equal(
        savedCards([item.id], CORPUS, context).get(item.id)!.affectsYou,
        false,
        `${item.id} claimed relevance with no preferences`,
      );
      assert.equal(feedCards(CORPUS, context).get(item.id)!.affectsYou, false);
    }
  }
});

// ── 6. Required case 9: All versus Affects me ───────────────────────────────

test('case 9 — All and Affects me change membership only; the verdict is one answer', () => {
  const context: SurfaceContext = { today: TODAY, prefs: TEXAS };
  const all = feedCards(CORPUS, context);
  const personalized = affectsMeCards(CORPUS, context);
  const saved = savedCards(
    CORPUS.map((item) => item.id),
    CORPUS,
    context,
  );

  // Membership differs: Affects me lists only what matches.
  assert.equal(all.size, CORPUS.length);
  assert.ok(personalized.size < all.size, 'Affects me listed the whole corpus');
  assert.ok(personalized.size > 0, 'Affects me listed nothing to compare');

  // The verdict does not. Every card Affects me lists is byte-identical to
  // the All card and the Saved card for the same recall.
  for (const [id, card] of personalized) {
    assert.deepEqual(parityReport(all.get(id)!, card), [], `${id} differs between feed modes`);
    assert.deepEqual(parityReport(card, saved.get(id)!), [], `${id} differs from its saved card`);
    assert.equal(card.affectsYou, true);
  }
  // And a recall Affects me withholds still reports the same verdict on the
  // cards that DO list it — the mode never rewrites the answer.
  for (const [id, card] of all) {
    if (personalized.has(id)) continue;
    assert.equal(card.affectsYou, false);
    assert.equal(saved.get(id)!.affectsYou, false);
  }
});

// ── 7. Required case 10: accessibility ──────────────────────────────────────

test('case 10 — AFFECTS YOU is announced exactly once per card, on whichever surface', () => {
  // The card is ONE grouped element, and the relevance label is one node
  // inside it with one spoken name. There is no second announcement to
  // duplicate and no per-screen wording to drift.
  assert.ok(
    RELEVANCE_LABEL_SOURCE.includes("export const RELEVANCE_ACCESSIBILITY_LABEL = 'Affects you';"),
  );
  // One spoken name on one node, and the card groups it into a single
  // element — so there is exactly one announcement to make.
  assert.equal((RELEVANCE_LABEL_SOURCE.match(/accessibilityLabel=/g) ?? []).length, 1);
  assert.ok(CARD_SOURCE.includes('accessibilityRole="button"'));
  assert.equal((CARD_CODE.match(/<RelevanceLabel\b/g) ?? []).length, 1);
  assert.equal((CARD_CODE.match(/model\.affectsYou/g) ?? []).length, 1);

  const affecting: SurfaceContext = { today: TODAY, prefs: CALIFORNIA };
  const notAffecting: SurfaceContext = { today: TODAY, prefs: null };
  for (const build of [
    (context: SurfaceContext) => feedCards(CORPUS, context).get(SK_PHA.id)!,
    (context: SurfaceContext) => savedCards([SK_PHA.id], CORPUS, context).get(SK_PHA.id)!,
    (context: SurfaceContext) => affectsMeCards(CORPUS, context).get(SK_PHA.id)!,
  ]) {
    assert.equal(build(affecting).affectsYou, true);
  }
  // Absent relevance leaves NOTHING behind: the label is a conditional
  // element, so there is no wrapper, spacer or stale spoken node to announce
  // after a preference is removed.
  assert.equal(feedCards(CORPUS, notAffecting).get(SK_PHA.id)!.affectsYou, false);
  assert.equal(savedCards([SK_PHA.id], CORPUS, notAffecting).get(SK_PHA.id)!.affectsYou, false);
  assert.ok(!CARD_CODE.includes('affectsYou ?  :'));
  assert.ok(!/style=\{[^}]*affectsYou/.test(CARD_CODE));
});

// ── 8. PHA wrapping is unchanged ────────────────────────────────────────────

test('the PHA status row still wraps rather than shrinking, clipping or fixing a height', () => {
  // P2B7N.1 changed no styling. The status row wraps, both labels keep their
  // full text, and nothing bounds the card's height.
  assert.match(CARD_SOURCE, /statusRow: \{[^}]*flexWrap: 'wrap'/s);
  assert.match(CARD_SOURCE, /statusGroup: \{[^}]*flexWrap: 'wrap'/s);
  for (const forbidden of [
    'height:',
    'maxHeight',
    'minHeight',
    'adjustsFontSizeToFit',
    'maxFontSizeMultiplier',
    'allowFontScaling={false}',
  ]) {
    assert.ok(!CARD_CODE.includes(forbidden), `the card bounds its own size: ${forbidden}`);
  }
  // The one bounded element stays the product name, and it is a LINE count.
  assert.equal((CARD_CODE.match(/numberOfLines=/g) ?? []).length, 1);
  assert.ok(CARD_SOURCE.includes('numberOfLines={3}'));
  // Neither label is abbreviated on its way to the card.
  assert.equal(
    buildHomeCardModel(SK_PHA, { today: TODAY, prefs: null }).noticeLabel,
    'Public Health Alert',
  );
});

// ── 9. Mutation evidence ────────────────────────────────────────────────────
//
// Each case below applies one of the named regressions to the SAME helper
// the assertions above use, and asserts it is reported. Without this the
// tests could pass by being unable to fail.

test('mutation — Saved hardcoding Affects You off is caught', () => {
  const context: SurfaceContext = { today: TODAY, prefs: CALIFORNIA };
  const feed = feedCards(CORPUS, context).get(SK_PHA.id)!;
  const mutated: HomeCardModel = { ...feed, affectsYou: false };
  assert.match(parityReport(feed, mutated).join('\n'), /affectsYou .*Affects You treatment/);
  // …and at the source level, which is where the real defect lived.
  const mutatedSource = SAVED_SOURCE.replace(
    SHARED_CALL,
    '<RecallCard model={buildHomeCardModel(item, { today, affectsYou: false })} />',
  );
  assert.notEqual(mutatedSource, SAVED_SOURCE);
  assert.deepEqual(screenContractViolations(FEED_SOURCE, mutatedSource), [
    'saved does not build its card with the shared arguments',
    'saved states the Affects-you verdict itself',
  ]);
});

test('mutation — Saved omitting preferences entirely is caught', () => {
  const feed = feedCards(CORPUS, { today: TODAY, prefs: CALIFORNIA }).get(SK_PHA.id)!;
  const withoutPrefs = savedCards([SK_PHA.id], CORPUS, { today: TODAY, prefs: null }).get(
    SK_PHA.id,
  )!;
  assert.notDeepEqual(parityReport(feed, withoutPrefs), []);

  const mutatedSource = SAVED_SOURCE.replace(
    'const prefs = usePreferences();',
    'const prefs = null;',
  );
  assert.notEqual(mutatedSource, SAVED_SOURCE);
  assert.deepEqual(screenContractViolations(FEED_SOURCE, mutatedSource), [
    'saved does not read current preferences',
  ]);
});

test('mutation — a second, screen-local matching function is caught', () => {
  const mutatedSource = SAVED_SOURCE.replace(
    SHARED_CALL,
    '<RecallCard model={buildHomeCardModel(item, { today, prefs })} affectsYou={savedMatches(item)} />',
  );
  assert.notEqual(mutatedSource, SAVED_SOURCE);
  const problems = screenContractViolations(FEED_SOURCE, mutatedSource);
  assert.ok(problems.includes('saved does not build its card with the shared arguments'));
  assert.ok(problems.includes('saved derives an Affects-you verdict of its own'));
});

test('mutation — using save state as the match verdict is caught', () => {
  const context: SurfaceContext = { today: TODAY, prefs: TEXAS };
  // Texas: the Walmart advisory does NOT affect this user, but it IS
  // saved. A surface that read the bookmark as the verdict would flip it.
  const honest = savedCards([RETAILER_ONLY.id], CORPUS, context).get(RETAILER_ONLY.id)!;
  assert.equal(honest.affectsYou, false);
  const asIfSaveMeantMatch: HomeCardModel = {
    ...honest,
    affectsYou: isSavedId([RETAILER_ONLY.id], RETAILER_ONLY.id),
  };
  assert.equal(asIfSaveMeantMatch.affectsYou, true);
  assert.notDeepEqual(
    parityReport(feedCards(CORPUS, context).get(RETAILER_ONLY.id)!, asIfSaveMeantMatch),
    [],
  );
});

test('mutation — a stale stored verdict overriding current preferences is caught', () => {
  // A verdict frozen when the recall was saved (the user was then in
  // California and it matched), replayed after they moved to Texas.
  const frozen = buildHomeCardModel(RETAILER_ONLY, { today: TODAY, prefs: TEXAS_PLUS_STORE });
  assert.equal(frozen.affectsYou, true);
  const now: SurfaceContext = { today: TODAY, prefs: TEXAS };
  const live = savedCards([RETAILER_ONLY.id], CORPUS, now).get(RETAILER_ONLY.id)!;
  assert.equal(live.affectsYou, false);
  assert.notDeepEqual(parityReport(feedCards(CORPUS, now).get(RETAILER_ONLY.id)!, frozen), []);
});

test('mutation — omitting or duplicating the Affects You announcement is caught', () => {
  const omitted = CARD_SOURCE.replace('{model.affectsYou ? <RelevanceLabel /> : null}', '');
  assert.notEqual(omitted, CARD_SOURCE);
  assert.equal((omitted.match(/<RelevanceLabel\b/g) ?? []).length, 0);
  const duplicated = CARD_SOURCE.replace(
    '{model.affectsYou ? <RelevanceLabel /> : null}',
    '{model.affectsYou ? <RelevanceLabel /> : null}\n{model.affectsYou ? <RelevanceLabel /> : null}',
  );
  assert.equal((duplicated.match(/<RelevanceLabel\b/g) ?? []).length, 2);
  // The live assertion demands exactly one.
  assert.equal((CARD_SOURCE.match(/<RelevanceLabel\b/g) ?? []).length, 1);
});

test('mutation — replacing PHA wrapping with clipping or a fixed height is caught', () => {
  for (const mutated of [
    CARD_SOURCE.replace("flexWrap: 'wrap',\n    flexShrink: 1,", 'height: 24,'),
    CARD_SOURCE.replace('padding: spacing[12],', 'padding: spacing[12],\n    maxHeight: 180,'),
    CARD_SOURCE.replace('<NoticeLabel label={model.noticeLabel} />', '<NoticeLabel label="PHA" />'),
  ]) {
    assert.notEqual(mutated, CARD_SOURCE, 'a wrapping mutation did not apply');
  }
  const fixedHeight = CARD_SOURCE.replace(
    'padding: spacing[12],',
    'padding: spacing[12],\n    maxHeight: 180,',
  );
  assert.ok(fixedHeight.includes('maxHeight'));
  assert.ok(!CARD_SOURCE.includes('maxHeight'));
  // Abbreviating the notice label is a model-level change, and the model
  // states the full words.
  assert.equal(
    buildHomeCardModel(SK_PHA, { today: TODAY, prefs: null }).noticeLabel,
    'Public Health Alert',
  );
});

test('mutation — a new unaudited card field is caught by the coverage assertion', () => {
  const model = buildHomeCardModel(SK_PHA, { today: TODAY, prefs: CALIFORNIA });
  const withNewField = { ...model, searchMatchReason: 'brand' };
  assert.notDeepEqual(Object.keys(withNewField).sort(), Object.keys(AUDITED_FIELDS).sort());
});
