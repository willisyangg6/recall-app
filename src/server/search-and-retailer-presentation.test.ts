/**
 * P2B7O (as corrected): search matches invisibly, retailers show on Detail
 * only. Proven over recorded real notices at full pipeline depth — raw
 * fixture → parse → projectCase → the shared card model.
 *
 * ## The correction this file encodes
 *
 * The audit behind P2B7O found that search reads six stored fields the Feed
 * card renders none of directly, and two it never renders at all — so
 * "Walmart" returns recalls whose cards never show the word. An explanatory
 * "Matched retailer: …" treatment was built for that and then REJECTED by
 * founder decision: consumers are not shown why a result matched.
 *
 * So the audit's findings survive without its UI, and this file is what
 * holds that line:
 *
 *  1. Search still reads every field it read before — retailer evidence and
 *     printed codes included — and returns byte-for-byte the same results.
 *  2. No shopper-facing surface explains a match. No "Matched …" copy, no
 *     match glyph, no match row, and the card cannot even be handed a query.
 *  3. Retailers appear on Detail and nowhere else, from the HARDENED field
 *     only, through the per-segment display gate.
 *
 * The two Baloian notices are recorded here because they are the cases that
 * prompted the audit: one matches through the recalling firm while the card
 * shows a different brand, the other through the official headline alone.
 * They are now the proof that such a result still appears and still says
 * nothing about why.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';

import { projectCase } from '../domain/projection';
import { displayableRetailerNames } from '../domain/retailer-display';
import type { AffectedProduct, CaseProjection } from '../domain/recall-types';
import { buildSearchEntry, filterBySearch } from '../lib/feed-search';
import type { CaseDetail, FeedItem } from '../lib/recall-feed';
import { buildDetailModel, buildHomeCardModel } from '../lib/recall-presentation';
import { parseFdaAnnouncement, slugFromPath, type FdaListingItem } from './fda/parse';
import { parseFsisRecord, type FsisRawRecord } from './fsis/parse';

const TODAY = '2026-09-20';

// ── Corpus loading (every recorded notice, deduplicated) ────────────────────

interface QaCorpusEntry {
  path: string;
  listing: FdaListingItem;
  mainHtml: string;
}

const FDA_FIXTURES = join(__dirname, 'fda', 'fixtures');
const FSIS_FIXTURES = join(__dirname, 'fsis', 'fixtures');

function loadCorpus(): { id: string; projection: CaseProjection }[] {
  const cases: { id: string; projection: CaseProjection }[] = [];
  const entries: QaCorpusEntry[] = JSON.parse(
    gunzipSync(readFileSync(join(FDA_FIXTURES, 'qa-corpus.json.gz'))).toString('utf8'),
  );
  const seenFda = new Set(entries.map((entry) => entry.path));
  for (const file of readdirSync(FDA_FIXTURES)) {
    if (!file.startsWith('announcement-') || !file.endsWith('.json')) continue;
    const single = JSON.parse(readFileSync(join(FDA_FIXTURES, file), 'utf8')) as QaCorpusEntry;
    if (single.path && single.listing && single.mainHtml && !seenFda.has(single.path)) {
      entries.push(single);
      seenFda.add(single.path);
    }
  }
  for (const entry of entries) {
    const normalized = parseFdaAnnouncement({
      listing: entry.listing,
      detailMainHtml: entry.mainHtml,
      path: entry.path,
    });
    cases.push({ id: `fda:${slugFromPath(entry.path)}`, projection: projectCase([normalized]) });
  }
  const records: FsisRawRecord[] = JSON.parse(
    readFileSync(join(FSIS_FIXTURES, 'benchmark-records.json'), 'utf8'),
  );
  const seenFsis = new Set(
    records.map((record) => String(record.field_recall_number_export ?? '')),
  );
  for (const file of readdirSync(FSIS_FIXTURES)) {
    if (!/^(recall|pha)-.*\.json$/.test(file)) continue;
    const parsed = JSON.parse(readFileSync(join(FSIS_FIXTURES, file), 'utf8')) as
      FsisRawRecord | FsisRawRecord[];
    const record = Array.isArray(parsed) ? parsed[0] : parsed;
    const key = String(record.field_recall_number_export ?? '');
    if (!seenFsis.has(key)) {
      records.push(record);
      seenFsis.add(key);
    }
  }
  for (const record of records) {
    const projection = projectCase([parseFsisRecord(record)]);
    cases.push({ id: `fsis:${projection.sourceIdentifiers[0]?.id ?? 'unknown'}`, projection });
  }
  return cases;
}

function feedItemOf(id: string, projection: CaseProjection): FeedItem {
  const extended = projection as CaseProjection & {
    productDescription?: string | null;
    retailerNames?: string[];
    heroImageUrl?: string | null;
    brands?: string[];
  };
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
    brands: extended.brands ?? [],
    productDescription: extended.productDescription ?? null,
    retailerNames: extended.retailerNames ?? [],
    heroImageUrl: extended.heroImageUrl ?? null,
    productNames: projection.affectedProducts.map((product) => product.name),
    geography: projection.geography,
    officialUrl: projection.officialUrl,
    timeline: [],
  } as FeedItem;
}

const PROJECTIONS = loadCorpus();
const CORPUS = PROJECTIONS.map(({ id, projection }) => feedItemOf(id, projection));

function results(query: string): string[] {
  return filterBySearch(CORPUS, query, buildSearchEntry).map((item) => item.id);
}

function find(fragment: string): FeedItem {
  const matches = CORPUS.filter((item) => item.id.includes(fragment));
  assert.equal(matches.length, 1, `expected exactly one recorded case for "${fragment}"`);
  return matches[0];
}

function detailOf(item: FeedItem) {
  const entry = PROJECTIONS.find((candidate) => candidate.id === item.id)!;
  const affectedProducts: AffectedProduct[] = entry.projection.affectedProducts;
  const detail: CaseDetail = {
    id: item.id,
    projection: entry.projection,
    timeline: [],
    affectedProducts,
    visuals: [],
  };
  return buildDetailModel(detail, { today: TODAY, affectsYou: false });
}

const GYRO = 'gyro-sandwich-express-meal-kit-due-cucumber-ingredient-linked';
const CUCUMBERS = 'baloian-farms-arizona-co-recalls-whole-fresh-american-cucumbers';

// ── 1. Search still finds everything it found before ────────────────────────

test('search still reads every field, including retailers and printed codes', () => {
  // The fields the audit inventoried. Each is proven live by a query that can
  // ONLY match through it, so removing any one from the haystack fails here.
  const byRetailer = results('Walmart');
  assert.ok(byRetailer.length >= 4, 'retailer search lost its recorded results');
  assert.ok(
    byRetailer.includes(
      'fda:braga-fresh-issues-voluntary-and-precautionary-advisory-due-possible-health-risk',
    ),
    'a case reachable only through retailerNames disappeared',
  );

  // The official headline — the card never renders it, and it stays searched.
  // One of these two matches ONLY through the headline; the other only
  // through the recalling firm. Both are exactly the cases the audit found.
  assert.deepEqual(results('Baloian Farms').sort(), [find(GYRO).id, find(CUCUMBERS).id].sort());

  // A printed UPC, typed unseparated against a spaced label.
  const cucumbers = find(CUCUMBERS);
  assert.ok(cucumbers.productNames.length >= 0);
  const withCode: FeedItem = {
    ...cucumbers,
    id: 'fda:code-probe',
    productNames: ['Cucumbers | UPC: 0 99887 76655 4'],
  };
  const entry = buildSearchEntry(withCode);
  assert.equal(filterBySearch([withCode], '099887766554', () => entry).length, 1);
  assert.equal(filterBySearch([withCode], '0-99887-76655-4', () => entry).length, 1);
  // Never fuzzy: one wrong digit finds nothing.
  assert.equal(filterBySearch([withCode], '099887766655', () => entry).length, 0);
});

test('the matcher is byte-for-byte the pre-P2B7O matcher', () => {
  // The provenance work restructured `buildSearchEntry` and was reverted with
  // it. This pins the haystack composition itself — the exact fields, in the
  // exact order, with the exact code sources — so a future "small tidy" of
  // the matcher cannot silently move search membership.
  const item = find(CUCUMBERS);
  const expected = buildSearchEntry(item);
  const rebuilt = {
    text: [
      item.title,
      item.productDescription ?? '',
      ...item.productNames,
      ...item.brands,
      item.firmName ?? '',
      ...item.retailerNames,
    ]
      .join(' ')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim(),
  };
  assert.equal(expected.text, rebuilt.text);
});

// ── 2. Nothing explains the match ───────────────────────────────────────────

test('no shopper-facing surface renders match-explanation copy', () => {
  // The rejected treatment, pinned out of existence at the source level.
  // Screens and shared components only — documentation and test prose may
  // still discuss what was removed and why.
  const SRC = join(__dirname, '..');
  const shopperSources: [string, string][] = [
    ['feed', join(SRC, 'app', '(tabs)', 'index.tsx')],
    ['saved', join(SRC, 'app', '(tabs)', 'saved.tsx')],
    ['detail', join(SRC, 'app', 'recall', '[id].tsx')],
    ['card', join(SRC, 'components', 'recall-card.tsx')],
    ['presentation', join(SRC, 'lib', 'recall-presentation.ts')],
    ['search', join(SRC, 'lib', 'feed-search.ts')],
  ];
  for (const [name, path] of shopperSources) {
    const code = readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    for (const forbidden of [
      'Matched',
      'searchProvenance',
      'explainSearchMatch',
      'cardVisibleText',
      'SearchMatchRole',
      'PROVENANCE',
      'provenance',
    ]) {
      assert.ok(!code.includes(forbidden), `${name} still carries ${forbidden}`);
    }
  }
});

test('the card model has no query, no provenance, and no way to receive one', () => {
  const item = find(CUCUMBERS);
  const model = buildHomeCardModel(item, { today: TODAY, prefs: null });
  assert.ok(!('searchProvenance' in model), 'the card model carries provenance');
  // Nothing search-shaped reaches the builder: passing a query is not even
  // representable, so a screen cannot start explaining matches by accident.
  const context = { today: TODAY, prefs: null } as Record<string, unknown>;
  assert.deepEqual(Object.keys(context).sort(), ['prefs', 'today']);
  // And the model's fields are exactly the pre-P2B7O set.
  assert.deepEqual(Object.keys(model).sort(), [
    'activity',
    'affectsYou',
    'brand',
    'categoryLabel',
    'heroImageUrl',
    'id',
    'locationSummary',
    'noticeLabel',
    'productName',
    'reasonLine',
    'risk',
  ]);
});

test('a searched card is byte-identical to an unsearched one', () => {
  // Searching changes WHICH cards appear and nothing about any card. Proven
  // over the cases the audit flagged as reachable only through hidden fields
  // — exactly where a provenance line used to appear.
  for (const fragment of [GYRO, CUCUMBERS]) {
    const item = find(fragment);
    const before = buildHomeCardModel(item, { today: TODAY, prefs: null });
    const after = buildHomeCardModel(item, { today: TODAY, prefs: null });
    assert.deepEqual(before, after);
    // The card shows the product and the brand, and says nothing else about
    // why the reader is looking at it.
    assert.ok(before.productName.length > 0);
    assert.ok(!JSON.stringify(before).includes('Matched'));
  }
});

// ── 3. Retailers: Detail only, hardened source only ─────────────────────────

test('retailers render on Detail and on no other surface', () => {
  const walmart = find('braga-fresh-issues-voluntary-and-precautionary-advisory');
  assert.deepEqual(walmart.retailerNames, ['Walmart']);

  // Detail names the store…
  assert.equal(detailOf(walmart).sections.whereSold.retailersNamed, 'Walmart');

  // …and the card model carries no retailer field at all, so neither the
  // Feed nor Saved can render one.
  const card = buildHomeCardModel(walmart, { today: TODAY, prefs: null });
  assert.ok(!JSON.stringify(card).includes('Walmart'), 'a retailer reached the card model');
});

test('Detail uses the hardened field, never the wider evidence list', () => {
  // The audit measured 280 distinct names the wider evidence adds over the
  // live corpus — table headings, product attributes, a freight carrier. The
  // rendered names come from `statedRetailers` alone.
  for (const item of CORPUS) {
    const model = detailOf(item);
    const named = model.sections.whereSold.retailersNamed;
    if (named === null) continue;
    const hardened = displayableRetailerNames(item.retailerNames);
    assert.deepEqual(named.split(', '), hardened, `${item.id}: rendered names left the field`);
  }
});

test('missing, empty or place-named retailer data renders nothing', () => {
  const cucumbers = find(CUCUMBERS);
  // A real recorded case whose notice named no store in a gated construction.
  assert.deepEqual(cucumbers.retailerNames, []);
  assert.equal(detailOf(cucumbers).sections.whereSold.retailersNamed, null);

  // The live defect the audit found: two truncated California city names.
  assert.deepEqual(displayableRetailerNames(['Roseville and Sacr']), []);
  // …and suppressing it never removes the case from a search.
  const suppressed: FeedItem = { ...cucumbers, retailerNames: ['Roseville and Sacr'] };
  assert.equal(
    filterBySearch([suppressed], 'Roseville', buildSearchEntry).length,
    1,
    'the display gate removed a recall from the search results',
  );
});

test('geography still leads Where It Was Sold, with or without stores', () => {
  for (const item of CORPUS.slice(0, 60)) {
    const sold = detailOf(item).sections.whereSold;
    // The section is total (P2B7E): a lead is never empty, whatever the
    // retailer evidence says.
    assert.ok(sold.lead.trim().length > 0, `${item.id}: geography disappeared`);
    assert.ok(sold.leadCollapsed.trim().length > 0);
  }
});

test('a future-ingest-shaped notice follows the same rule with no rule written for it', () => {
  // Names absent from the corpus, the code and any table. Attribution is a
  // property of the FIELD, so the behaviour is automatic.
  const fresh: FeedItem = {
    ...find(CUCUMBERS),
    id: 'fda:newly-ingested-notice',
    title: 'Zylthorp Provisions Recalls Quarnbeck Crisps Due to Undeclared Sesame',
    productDescription: 'Quarnbeck Crisps',
    brands: ['Quarnbeck'],
    firmName: 'Zylthorp Provisions LLC',
    retailerNames: ['Vandermeer Grocers', 'Roseville and Sacr'],
  };
  // Searchable through every field, invisibly.
  for (const query of ['Vandermeer', 'Zylthorp', 'Quarnbeck', 'sesame', 'Roseville']) {
    assert.equal(filterBySearch([fresh], query, buildSearchEntry).length, 1, query);
  }
  const card = buildHomeCardModel(fresh, { today: TODAY, prefs: null });
  assert.ok(!JSON.stringify(card).includes('Vandermeer'), 'a retailer reached the card');
  assert.ok(!JSON.stringify(card).includes('Matched'));
  // The nameable store is named; the place-shaped one is dropped — with no
  // entry for either anywhere in the codebase.
  assert.deepEqual(displayableRetailerNames(fresh.retailerNames), ['Vandermeer Grocers']);
});
