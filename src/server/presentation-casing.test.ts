/**
 * P3D/P3E/P2B7M corpus-wide display-capitalization contract, proven over every
 * recorded FDA and FSIS notice at full pipeline depth (raw fixture → parse →
 * projectCase → shared presentation models).
 *
 * Three guarantees:
 *
 *  1. Recorded regressions — the audited defective notices render corrected
 *     (including both confirmed P2B7M live escapes), and the audited
 *     preservation cases (the stylized brand "a2", the FSIS package-prose row
 *     names) render byte-identical to before.
 *
 *  2. The unexpected-delta guard, for the NARROW transforms — the leading-word
 *     helper, unit spacing, and reason-clause casing each change exactly the
 *     approved set of source values. If one of these fails because a new value
 *     entered the set, do not add it to make the test pass: stop and review the
 *     new delta against docs/recall-feed-usability.md first — silent widening
 *     of a narrow casing transform is the regression these guards exist to
 *     catch.
 *
 *  3. PROPERTY guards, for the shopper-title contract — which is supposed to
 *     touch most titles, so an "exactly these values" guard would be the wrong
 *     instrument. Instead every recorded title must satisfy the properties that
 *     make the contract safe on titles nobody has reviewed: casing-only,
 *     additive (never decapitalizes), idempotent, and complete (no ordinary
 *     lowercase word survives a correction). These cannot be satisfied by
 *     memorizing today's corpus.
 *
 * Display-only invariants are asserted alongside: canonical projections keep
 * the raw source casing, search matches identically for any query casing, and
 * the domain layer (projection, material-change) imports no presentation code.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';

import { detectChanges } from '../domain/material-change';
import { projectCase } from '../domain/projection';
import type { CaseProjection } from '../domain/recall-types';
import {
  capitalizeLeadingWord,
  displayProductTitle,
  headlineCaseShopperTitle,
  humanizeAllCaps,
  normalizeUnitSpacing,
  productDisplayName,
  reasonClauseCasing,
} from '../lib/consumer-summary';
import { buildSearchEntry, matchesSearch, parseSearchQuery } from '../lib/feed-search';
import {
  buildDetailModel,
  buildHomeCardModel,
  conciseReasonLine,
} from '../lib/recall-presentation';
import { interpretReason } from '../lib/recall-reason';
import { buildShareMessage } from '../lib/share-message';
import type { FeedItem } from '../lib/recall-feed';
import { parseFdaAnnouncement, slugFromPath, type FdaListingItem } from './fda/parse';
import { parseFsisRecord, type FsisRawRecord } from './fsis/parse';
import { formatPushContent } from './push/format';
import type { DeliverableEvent } from './push/types';

const TODAY = '2026-09-04';

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

const CORPUS = loadCorpus();

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
    geography: projection.geography,
    officialUrl: projection.officialUrl,
    timeline: [],
  };
}

function caseOf(fragment: string): { id: string; projection: CaseProjection } {
  const found = CORPUS.find((entry) => entry.id.includes(fragment));
  assert.ok(found, `recorded corpus case missing: ${fragment}`);
  return found!;
}

function modelsOf(fragment: string) {
  const { id, projection } = caseOf(fragment);
  const home = buildHomeCardModel(feedItemOf(id, projection), {
    today: TODAY,
    prefs: null,
  });
  const detail = buildDetailModel(
    { id, projection, timeline: [], affectedProducts: projection.affectedProducts, visuals: [] },
    { today: TODAY, affectsYou: false },
  );
  return { id, projection, home, detail };
}

function initialPushOf(projection: CaseProjection) {
  const event: DeliverableEvent = {
    id: 'test-event',
    recallCaseId: 'test-case',
    kind: 'initial',
    triggerRuleId: 'test',
    payloadSummary: '',
    createdAt: `${TODAY}T00:00:00Z`,
    projection,
  };
  return formatPushContent(event);
}

// ── Recorded regressions: the two corrected notices ─────────────────────────

test('recorded regression: the terrafina brand renders corrected on every surface', () => {
  const { projection, home, detail } = modelsOf('sunco-frenchie-issues-allergy-alert');
  assert.equal(home.brand.text, 'Terrafina');
  assert.equal(detail.brand.text, 'Terrafina');
  assert.equal(
    detail.whatHappened.text,
    'Terrafina recalled Golden Raisins because the products may contain sulfites, an allergen that is not declared on the label.',
  );
  // Canonical stored data keeps the raw source casing — display-only fix.
  assert.deepEqual(projection.brands, ['terrafina']);
});

test('recorded regression: the lowercase saucepans description is headline-cased', () => {
  const { projection, home, detail } = modelsOf('town-food-service-equipment');
  // Founder decision B: spelled-out units are ordinary headline words
  // ("Quart"/"Quarts"); digit tokens are preserved. P2B7M amendment: the
  // minor words now follow headline style ("of"/"with"/"from"/"to"), where
  // the original all-ordinary-words rule shouted them.
  const expected = '4 Sizes of Aluminum Saucepans with Capacities Ranging from 1 Quart to 3 Quarts';
  assert.equal(home.productName, expected);
  assert.equal(detail.productName, expected);
  // Future push copy uses the same shared contract (founder decision D).
  assert.equal(
    initialPushOf(projection).title,
    'Recall alert: 4 Sizes of Aluminum Saucepans with Capacities Ranging from…',
  );
  // The canonical description keeps the raw source casing.
  assert.equal(
    projection.productDescription,
    '4 sizes of aluminum saucepans with capacities ranging from 1 quart to 3 quarts',
  );
});

// ── Recorded preservation: audited values that must NOT change ──────────────

test('recorded preservation: the stylized brand a2 is untouched everywhere', () => {
  const { projection, home, detail } = modelsOf('a2-platinum-usa-label');
  assert.equal(home.brand.text, 'a2');
  assert.equal(detail.brand.text, 'a2');
  assert.match(detail.whatHappened.text, /^a2 recalled a2 Platinum Premium Infant Formula/);
  assert.equal(initialPushOf(projection).title.startsWith('Recall alert: a2 Platinum'), true);
  for (const item of detail.affectedProducts.items) {
    if (item.name !== null) {
      assert.match(item.name, /^a2 Platinium Premium infant formula/);
    }
  }
});

test('recorded preservation: FSIS package-prose row names keep their source casing', () => {
  // Founder decision C: row names take leading-word mode only — package
  // descriptions are never headline-cased, and a digit-leading first token
  // is never rewritten.
  const { detail } = modelsOf('023-2024');
  const named = detail.affectedProducts.items
    .map((item) => item.name)
    .filter((name): name is string => name !== null);
  const prose = named.filter((name) => name.includes('or various weight packages'));
  assert.equal(prose.length, 5, 'expected the five recorded deli package-prose rows');
  for (const name of prose) {
    assert.match(name, /^[\d.]+-lb\., or various weight packages sliced in retail delis$/);
  }
});

test('recorded preservation: a measurement-only row name is untouched', () => {
  const { detail } = modelsOf('PHA-02122025-01');
  const names = detail.affectedProducts.items.map((item) => item.name);
  assert.ok(names.includes('30 8-oz'), 'expected the recorded "30 8-oz" row name');
});

// ── The corpus-wide unexpected-delta guard ──────────────────────────────────

/**
 * The complete approved population of source values the LEADING-WORD transform
 * may change, from the P3D-A audit (2026-09-04): one defectively lowercase FDA
 * brand entry. Nothing else in the recorded corpus is defect-shaped at the
 * brand, company or package-row slots.
 *
 * P2B7M narrowed this guard to those three slots deliberately. The shopper
 * TITLE slot left it: its transform is no longer a narrow defect gate whose
 * widening is the thing to fear, but a headline-style contract that is
 * SUPPOSED to touch most titles. The title slot is guarded below by properties
 * that hold for every value instead — additive, casing-only, idempotent —
 * which cannot be satisfied by memorizing today's strings.
 */
const APPROVED_DELTAS = new Set([
  'fda:sunco-frenchie-issues-allergy-alert-undeclared-sulfites-golden-raisins § brand § terrafina',
]);

test('corpus guard: the leading-word transform changes exactly the approved values', () => {
  const observed = new Set<string>();
  for (const { id, projection } of CORPUS) {
    // Brand slots (brand line, What Happened subject).
    for (const brand of projection.brands ?? []) {
      const trimmed = brand.trim();
      if (capitalizeLeadingWord(trimmed) !== trimmed) {
        observed.add(`${id} § brand § ${trimmed}`);
      }
    }
    // Company slot (brand-fallback line, sentence fallback subject).
    const firm = (projection.recallingFirm.displayName ?? '').trim();
    if (firm !== '' && capitalizeLeadingWord(firm) !== firm) {
      observed.add(`${id} § company § ${firm}`);
    }
    // Affected-product row-name slot (leading-word mode after un-shouting).
    for (const product of projection.affectedProducts) {
      const unshouted = humanizeAllCaps(product.name);
      if (capitalizeLeadingWord(unshouted) !== unshouted) {
        observed.add(`${id} § row § ${unshouted}`);
      }
    }
  }
  assert.deepEqual(
    [...observed].sort(),
    [...APPROVED_DELTAS].sort(),
    'The set of source values the leading-word transform changes has widened or shrunk. ' +
      'Do not edit APPROVED_DELTAS to make this pass — review the new delta first (P3D contract).',
  );
});

// ── P2B7M: the shopper-title contract, guarded by properties ────────────────

/** The staged title a shopper surface hands to the capitalization contract. */
function stagedTitleOf(projection: CaseProjection): string {
  return humanizeAllCaps(
    normalizeUnitSpacing(
      productDisplayName(projection.productDescription ?? null, projection.title),
    ),
  );
}

/** Whether the pre-P2B7M whole-string gate would have fired on a value. */
function legacyGateFires(staged: string): boolean {
  return !/\p{Lu}/u.test(staged) && /\p{Ll}/u.test(staged);
}

test('corpus guard: the title contract is additive, casing-only, and idempotent', () => {
  // The three properties that make the contract safe on values nobody has
  // reviewed — including every notice ingested after this test was written.
  // No frozen list can express these, and no frozen list is needed to.
  for (const { id, projection } of CORPUS) {
    const staged = stagedTitleOf(projection);
    const rendered = headlineCaseShopperTitle(staged);
    // Casing-only: the letters and their order never change.
    assert.equal(rendered.toLowerCase(), staged.toLowerCase(), `${id}: not casing-only`);
    assert.equal(rendered.length, staged.length, `${id}: length changed`);
    // Additive: every uppercase letter the source carried is still uppercase,
    // so no stylized identity ("biQ-FEL", "iHerb", "a2") can be rebuilt.
    for (let index = 0; index < staged.length; index += 1) {
      if (/\p{Lu}/u.test(staged[index])) {
        assert.equal(rendered[index], staged[index], `${id}: decapitalized at ${index}`);
      }
    }
    // Idempotent: rendering a rendered title is a fixed point.
    assert.equal(headlineCaseShopperTitle(rendered), rendered, `${id}: not idempotent`);
  }
});

test('corpus guard: the P2B7M escape class is corrected across the recorded corpus', () => {
  // The defect: a title whose capitalized opening words convinced the old
  // whole-string gate that its lowercase tail was intentional. The recorded
  // corpus reproduces this class widely, so it is real evidence rather than a
  // pair of pinned examples — and every member must now render with no
  // ordinary lowercase word left behind.
  const escapes: string[] = [];
  for (const { id, projection } of CORPUS) {
    const staged = stagedTitleOf(projection);
    if (legacyGateFires(staged)) continue; // the old gate already fixed these
    const rendered = headlineCaseShopperTitle(staged);
    if (rendered === staged) continue;
    escapes.push(`${id} § ${staged}`);
    // The correction is complete: no ordinary lowercase word survives except
    // the minor words and protected notation headline style keeps lowercase.
    for (const token of rendered.split(/\s+/)) {
      if (token === '' || !/\p{Ll}/u.test(token)) continue; // punctuation, "&"
      if (/\p{Nd}/u.test(token) || /\p{Lu}/u.test(token)) continue; // codes, cased words
      assert.match(
        token,
        /^[([]*(?:a|an|the|and|or|nor|but|of|to|in|on|at|by|for|from|with|as|de|del|da|di|du|van|von|e\.g\.|i\.e\.|etc\.|w|oz|lbs?|g|kg|mg|ml|mL|l|L|ct|pk|pc|qt|pt|gal|fl|ea|[a-z]+[)\]])[.,;:)\]]*$/,
        `${id}: "${token}" escaped capitalization in "${rendered}"`,
      );
    }
  }
  assert.ok(
    escapes.length > 0,
    'the recorded corpus no longer reproduces the P2B7M escape class — if the ' +
      'fixtures changed deliberately, re-record one; do not delete this guard.',
  );
});

test('recorded regression: both confirmed live escapes render corrected end to end', () => {
  // The exact two titles the founder reported, driven through the recorded
  // pipeline rather than asserted against the helper in isolation.
  const byheart = modelsOf('byheart-updates-information-regarding-voluntary-recall-all-batches');
  const expectedByheart = 'Whole Nutrition Infant Formula 24 oz Cans and 0.6 oz Packets';
  assert.equal(byheart.home.productName, expectedByheart);
  assert.equal(byheart.detail.productName, expectedByheart);
  assert.equal(initialPushOf(byheart.projection).title, `Recall alert: ${expectedByheart}`);
  // Canonical stored text keeps the raw source casing and spacing.
  assert.equal(
    byheart.projection.productDescription,
    'Whole Nutrition Infant formula 24 oz cans and 0.6oz packets',
  );
  // The flour notice is live-only (no recorded fixture), so its SHAPE is
  // pinned at the contract boundary; scripts/qa-title-casing.ts measures the
  // live corpus itself.
  assert.equal(
    displayProductTitle('All purpose flour, bread mix, flat bread pizza mix'),
    'All Purpose Flour, Bread Mix, Flat Bread Pizza Mix',
  );
});

/**
 * Push-only ALL-CAPS humanization deltas, frozen separately from the two P3D
 * lowercase deltas above. Push now shares the full `displayProductTitle`
 * composition (spacing + un-shout + headline-case + leading word) with
 * Home/Detail; the un-shout half
 * fires on no recorded product name at the push boundary, so this approved
 * set is EMPTY. A value appearing here means a fixture gained an ALL-CAPS
 * product name — review it against the Home/Detail rendering before approving.
 */
const APPROVED_PUSH_HUMANIZE_DELTAS = new Set<string>([]);

test('corpus guard: un-shouting fires on no recorded push product name', () => {
  const observed = new Set<string>();
  for (const { id, projection } of CORPUS) {
    const raw = productDisplayName(projection.productDescription ?? null, projection.title);
    if (humanizeAllCaps(raw) !== raw) {
      observed.add(`${id} § push-humanize § ${raw}`);
    }
  }
  assert.deepEqual([...observed].sort(), [...APPROVED_PUSH_HUMANIZE_DELTAS].sort());
});

test('push and Home/Detail share one title pipeline for every recorded name', () => {
  // Parity by construction: both surfaces call displayProductTitle. Proven
  // corpus-wide over the shared semantic input (the raw display name) —
  // Home/Detail additionally strip measurements/brand prefixes, which changes
  // words, never their normalization treatment.
  for (const { projection } of CORPUS) {
    const raw = productDisplayName(projection.productDescription ?? null, projection.title);
    assert.equal(
      displayProductTitle(raw),
      capitalizeLeadingWord(headlineCaseShopperTitle(humanizeAllCaps(normalizeUnitSpacing(raw)))),
    );
    const once = displayProductTitle(raw);
    assert.equal(displayProductTitle(once), once); // idempotent corpus-wide
  }
});

// ── P2B7G: shopper-title normalization guards ───────────────────────────────

/**
 * The complete approved population of recorded product names the P2B7G
 * unit-spacing rule changes — audited 2026-09-18: every one is a genuine
 * quantity jammed against its abbreviated unit ("0.6oz", "14oz (397g)",
 * "30g", "20.36oz", "19.8oz", "4lb"), and no code, identifier, or stylized
 * value appears. As with the P3D set above: a new value here means a fixture
 * gained a jammed unit — review it against docs/recall-feed-usability.md
 * (P2B7G) before approving, never silently.
 */
const APPROVED_UNIT_SPACING_DELTAS = new Set([
  'fda:byheart-updates-information-regarding-voluntary-recall-all-batches-byheart-whole-nutrition-infant § spacing § Whole Nutrition Infant formula 24 oz cans and 0.6oz packets',
  'fda:kettle-cuisine-recalls-marketside-tomato-bisque-soup-kit-sold-exclusively-walmart-stores-because § spacing § Tomato Bisque Soup Kit 14oz (397g)',
  'fda:orgain-issues-voluntary-allergy-alert-possible-undeclared-peanut-residue-single-batch-30g-protein § spacing § 30g Plant Protein Complete Protein Powder – Chocolate',
  'fda:palermo-villa-inc-issues-recall-1728-connies-thin-crust-cheese-frozen-pizzas-due-possible-plastic § spacing § Thin crust cheese frozen pizza, 20.36oz',
  'fda:reckittmead-johnson-nutrition-voluntarily-recalls-select-batches-nutramigen-hypoallergenic-infant § spacing § Nutramigen Powder infant formula in 12.6 and 19.8oz cans',
  'fda:wawona-frozen-foods-voluntarily-recalls-organic-daybreak-blend-processed-and-sold-2022-due-possible § spacing § Organic Daybreak Blend 4lb bags of frozen fruit',
]);

test('corpus guard: unit spacing changes exactly the approved recorded names', () => {
  const observed = new Set<string>();
  for (const { id, projection } of CORPUS) {
    const raw = productDisplayName(projection.productDescription ?? null, projection.title);
    if (normalizeUnitSpacing(raw) !== raw) {
      observed.add(`${id} § spacing § ${raw}`);
    }
  }
  assert.deepEqual(
    [...observed].sort(),
    [...APPROVED_UNIT_SPACING_DELTAS].sort(),
    'The set of recorded names the P2B7G unit-spacing rule changes has widened or shrunk. ' +
      'Review the new delta against the P2B7G contract before editing this set.',
  );
});

test('corpus guard: the legacy whole-string gate no longer governs any title', () => {
  // A mutation guard with teeth: it recomputes what the pre-P2B7M gate would
  // have decided and asserts the contract does NOT agree with it — on the
  // recorded corpus there are titles the old gate spared that the contract
  // corrects. Restoring the whole-string gate (returning `text` whenever any
  // ordinary token carries uppercase) makes this set empty and fails here.
  const correctedDespiteLegacyGate = CORPUS.filter(({ projection }) => {
    const staged = stagedTitleOf(projection);
    return !legacyGateFires(staged) && headlineCaseShopperTitle(staged) !== staged;
  });
  assert.ok(
    correctedDespiteLegacyGate.length >= 20,
    `the contract now agrees with the old whole-string gate on all but ${correctedDespiteLegacyGate.length} ` +
      'recorded titles — the P2B7M per-segment decision has been weakened or reverted.',
  );
});

test('corpus guard: unit spacing is length-1 additive and never reorders characters', () => {
  // Spacing may only INSERT spaces between a digit and a unit — proven
  // corpus-wide by removing the inserted spaces and comparing byte-identical.
  for (const { projection } of CORPUS) {
    const values = [
      productDisplayName(projection.productDescription ?? null, projection.title),
      ...projection.affectedProducts.map((product) => product.name),
    ];
    for (const value of values) {
      const spaced = normalizeUnitSpacing(value);
      assert.equal(spaced.replace(/ /g, ''), value.replace(/ /g, ''));
    }
  }
});

test('corpus guard: the P3D transforms are casing-only, so they can never collide values', () => {
  // Both helpers may change letter case and nothing else. Two transformed
  // values can therefore only render identically when their inputs were
  // already case-insensitively equal — a new collision between distinct
  // values is impossible by this property, proven over every corpus value.
  for (const { projection } of CORPUS) {
    const values = [
      productDisplayName(projection.productDescription ?? null, projection.title),
      ...(projection.brands ?? []),
      projection.recallingFirm.displayName ?? '',
      ...projection.affectedProducts.map((product) => product.name),
    ];
    for (const value of values) {
      assert.equal(headlineCaseShopperTitle(value).toLowerCase(), value.toLowerCase());
      assert.equal(capitalizeLeadingWord(value).toLowerCase(), value.toLowerCase());
    }
  }
  // And the two corrected renderings collide with no other recorded case.
  const terrafinaCases = CORPUS.filter(
    ({ id, projection }) =>
      (projection.brands ?? []).some((brand) => brand.trim().toLowerCase() === 'terrafina') &&
      !id.includes('sunco-frenchie'),
  );
  assert.equal(terrafinaCases.length, 0);
});

// ── Search, identity, and notification invariance ───────────────────────────

test('search matches the corrected recalls identically for any query casing', () => {
  const { id, projection } = caseOf('sunco-frenchie-issues-allergy-alert');
  const entry = buildSearchEntry(feedItemOf(id, projection));
  for (const query of ['terrafina', 'Terrafina', 'TERRAFINA']) {
    const parsed = parseSearchQuery(query);
    assert.ok(parsed && matchesSearch(entry, parsed), `search miss for "${query}"`);
  }
  const saucepans = caseOf('town-food-service-equipment');
  const saucepanEntry = buildSearchEntry(feedItemOf(saucepans.id, saucepans.projection));
  for (const query of ['aluminum saucepans', 'Aluminum Saucepans']) {
    const parsed = parseSearchQuery(query);
    assert.ok(parsed && matchesSearch(saucepanEntry, parsed), `search miss for "${query}"`);
  }
});

test('material-change detection sees no change on the corrected recalls', () => {
  for (const fragment of ['sunco-frenchie', 'town-food-service-equipment']) {
    const { projection } = caseOf(fragment);
    const result = detectChanges(projection, projection);
    assert.equal(result.material.length, 0);
  }
});

test('the domain layer imports no presentation casing code (structural)', () => {
  for (const file of ['projection.ts', 'material-change.ts', 'material-activity.ts']) {
    const source = readFileSync(join(__dirname, '..', 'domain', file), 'utf8');
    assert.ok(
      !source.includes('consumer-summary') && !source.includes('recall-presentation'),
      `domain/${file} must not import presentation code`,
    );
  }
});

test('the push formatter stays a pure server-safe module (structural)', () => {
  const source = readFileSync(join(__dirname, 'push', 'format.ts'), 'utf8');
  // Presentation helpers only — no store, transport, react, or expo imports:
  // formatting can never write the ledger or attempt a delivery.
  assert.ok(!/from '.*(push-store|expo-transport|worker)'/.test(source));
  assert.ok(!/from '(react|react-native|expo)/.test(source));
  assert.match(source, /displayProductTitle/);
});

// ── P3E: reason-clause sentence-interior casing ─────────────────────────────
//
// The What Happened free-text reason clauses (`contents`/`verbatim` families)
// previously lowercased the WHOLE source phrase; the P3E audit over the
// recorded FDA corpus found 28 notices reaching these clauses, 11 of them
// with source capitalization flattened, 7 of those genuinely wrong for
// consumers (taxonomic organism names on infant formula, vitamin
// designations). `reasonClauseCasing` (lib/consumer-summary.ts) now
// normalizes each phrase to sentence-interior lowercase and restores only
// evidence-backed semantic spans. Everything here drives the full recorded
// pipeline (fixture → parse → projectCase → presentation models).

test('recorded regression: Cronobacter sakazakii casing survives on infant formula (Nutramigen, ByHeart)', () => {
  const nutramigen = modelsOf('nutramigen-hypoallergenic-infant');
  assert.equal(
    nutramigen.detail.whatHappened.text,
    'Enfamil recalled Nutramigen Powder infant formula in 12.6 and 19.8oz cans because of potential Cronobacter sakazakii contamination.',
  );
  // Canonical stored reason keeps the raw source casing — display-only fix.
  assert.equal(nutramigen.projection.reasonText, 'Potential Cronobacter sakazakii contamination');

  const byheart = modelsOf('byheart-issues-voluntary-recall');
  assert.equal(
    byheart.detail.whatHappened.text,
    'ByHeart recalled Whole Nutrition Infant Formula, Milk Based Powder with Iron for 0-12months because of potential for cross-contamination with Cronobacter sakazakii.',
  );
  assert.equal(
    byheart.projection.reasonText,
    'Potential for cross-contamination with Cronobacter sakazakii',
  );
});

test('recorded regression: Bacillus cereus casing survives (Little Remedies, a2)', () => {
  const littleRemedies = modelsOf('little-remediesr-honey-cough-syrup');
  assert.equal(
    littleRemedies.detail.whatHappened.text,
    'Little Remedies recalled Honey Cough Syrup because of potential foodborne illness – Bacillus cereus.',
  );
  const a2 = modelsOf('a2-platinum-usa-label');
  assert.equal(
    a2.detail.whatHappened.text,
    'a2 recalled a2 Platinum Premium Infant Formula 0-12 months USA label because of presence of cereulide toxin produced by some strains of the bacterium Bacillus cereus.',
  );
  // P2B7V: the extent is its own paragraph; the corrected casing is unchanged.
  assert.equal(a2.detail.whatHappened.scope, 'The recall covers 16,428 units.');
});

test('recorded regression: the Talaromyces genus casing survives (Comforts baby water)', () => {
  const { detail } = modelsOf('comforts-baby-water');
  assert.equal(
    detail.whatHappened.text,
    'Comforts recalled Comforts FOR BABY Purified Water with Fluoride because of potential mold contamination - Talaromyces penicillium.',
  );
});

test('recorded regression: vitamin designations keep their letter uppercase (Nordic D3, Perrigo D)', () => {
  const nordic = modelsOf('nordic-naturals');
  assert.equal(
    nordic.detail.whatHappened.text,
    'Nordic Naturals recalled Baby’s Vitamin D3 Liquid because of elevated level of vitamin D3 dosage.',
  );
  assert.equal(nordic.detail.whatHappened.scope, 'The recall covers 3,800 units.');
  const perrigo = modelsOf('perrigo-issues-voluntary-recall');
  assert.equal(
    perrigo.detail.whatHappened.text,
    'Perrigo Company recalled Premium Infant Formula with Iron Milk-Based Powder because the products contain levels of vitamin D above the maximum level permitted.',
  );
  assert.equal(perrigo.detail.whatHappened.scope, 'The recall covers 16,500 cans.');
});

test('recorded preservation: generic source title casing still flattens to natural prose', () => {
  // These four notices carry source capitalization that is styling, not
  // meaning — their clauses stay byte-identical to the pre-P3E rendering.
  assert.equal(
    modelsOf('shopaax').detail.whatHappened.text,
    'Kingdom Honey recalled Royal Honey because of undeclared sildenafil.',
  );
  // "lead" is lowercase in the canonical chemical vocabulary — the
  // vocabulary affirms natural lowercase rather than restoring a capital.
  assert.equal(
    modelsOf('ikm-recalls').detail.whatHappened.text,
    'IKM recalled Metal Cookware Items because of potential foodborne illness – lead contamination.',
  );
  assert.equal(
    modelsOf('mondelez').detail.whatHappened.text,
    'CHIPS AHOY recalled Baked brownie bites because of product safety – choking threats.',
  );
  assert.equal(
    modelsOf('my-wifes-slaw').detail.whatHappened.text,
    'My Wife’s Slaw recalled Original and Jalapeno Heat flavored coleslaw because of foodborne illness - potential for microorganisms growth.',
  );
  // Punctuation/parentheses pass through a clause that was already natural
  // lowercase in the source.
  assert.equal(
    modelsOf('ea-sween').detail.whatHappened.text,
    'Deli Express recalled BBQ Pulled Pork Sandwich because of the potential presence of foreign particles (plastic).',
  );
});

test('Home and Detail render compatible casing for every corrected semantic span (P3A parity)', () => {
  // Home's concise reason line keeps the source's own casing as a standalone
  // label; Detail embeds the same phrase mid-sentence. After P3E the two
  // agree on every semantic span — Home can no longer show "Cronobacter
  // sakazakii" while Detail flattens it.
  //
  // P2B7H: the card's line carries no final full stop (`cardSummaryText`,
  // presentation-only — the sentence `conciseReasonLine` composes is
  // unchanged, and so is Detail's prose). That is punctuation, not casing,
  // and the CASING parity this test exists for is unaffected: every span
  // below still matches Detail span for span.
  const nutramigen = modelsOf('nutramigen-hypoallergenic-infant');
  assert.equal(nutramigen.home.reasonLine, 'Potential Cronobacter sakazakii contamination');
  assert.ok(nutramigen.detail.whatHappened.text.includes('Cronobacter sakazakii'));
  const byheart = modelsOf('byheart-issues-voluntary-recall');
  assert.equal(
    byheart.home.reasonLine,
    'Potential for cross-contamination with Cronobacter sakazakii',
  );
  assert.ok(byheart.detail.whatHappened.text.includes('Cronobacter sakazakii'));
  const littleRemedies = modelsOf('little-remediesr-honey-cough-syrup');
  assert.equal(littleRemedies.home.reasonLine, 'Potential Foodborne Illness – Bacillus cereus');
  assert.ok(littleRemedies.detail.whatHappened.text.includes('Bacillus cereus'));
  // Detail's own prose still ends in a full stop — the card's rule stopped
  // at the card.
  for (const model of [nutramigen, byheart, littleRemedies]) {
    assert.ok(model.detail.whatHappened.text.endsWith('.'));
  }
});

test('P2B7H: across the whole corpus, card summaries drop only a sentence stop', () => {
  // The risk in a punctuation rule is not the lines it changes — it is the
  // ones it should have left alone. So the rule is run over every recorded
  // FDA and FSIS notice and checked against the sentence it came from: the
  // card's line must be either identical to `conciseReasonLine`'s output or
  // exactly that output minus one final '.', never anything else.
  let stripped = 0;
  let kept = 0;
  for (const { id, projection } of CORPUS) {
    const item = feedItemOf(id, projection);
    const sentence = conciseReasonLine({
      reasonText: item.reasonText,
      hazardCategory: item.hazardCategory,
      pathogenOrAllergen: item.pathogenOrAllergen,
      title: item.title,
    });
    const card = buildHomeCardModel(item, { today: TODAY, prefs: null }).reasonLine;
    if (sentence === null) {
      assert.equal(card, null, `${id} invented a card line`);
      continue;
    }
    assert.ok(card !== null, `${id} lost its card line`);
    if (card === sentence) {
      kept += 1;
      continue;
    }
    stripped += 1;
    assert.equal(`${card}.`, sentence, `${id} changed more than the final stop`);
    // Nothing that is not a sentence stop was taken.
    assert.ok(!card!.endsWith('.'), `${id} left a stop behind`);
    assert.ok(!/(?:\.\.|…)$/.test(sentence), `${id} had an ellipsis stripped`);
  }
  // This test's invariant is the per-line equality above, not a count: the
  // only thing asserted about the corpus totals is that the path was
  // actually exercised on real data. What the rule REFUSES to strip is
  // pinned by name in `components/card-presentation-design.test.ts`, where
  // the inputs are fixed and a corpus that happens to contain no
  // abbreviation this month cannot weaken the test.
  assert.ok(stripped > 0, 'no corpus line reached the card summary rule');
  assert.equal(stripped + kept > 0, true);
});

test('P2B7H: Detail prose keeps every stop the card dropped', () => {
  // The same corpus, the other surface: the card rule must not have reached
  // Detail's narrative, which is prose and ends in a full stop.
  for (const { id, projection } of CORPUS) {
    const detail = buildDetailModel(
      { id, projection, timeline: [], affectedProducts: projection.affectedProducts, visuals: [] },
      { today: TODAY, affectsYou: false },
    );
    const text = detail.whatHappened.text.trim();
    if (text === '') continue;
    assert.ok(/[.!?]$/.test(text), `${id} lost Detail's sentence punctuation: ${text.slice(-60)}`);
  }
});

test('share copy inherits the corrected clause from the one shared sentence', () => {
  const { projection, detail } = modelsOf('nutramigen-hypoallergenic-infant');
  const share = buildShareMessage({
    productName: detail.productName,
    firmDisplayName: projection.recallingFirm.displayName,
    brands: projection.brands ?? [],
    whatHappened: detail.whatHappened.text,
    consumerAction: null,
    agencyLabel: projection.sourceAgency,
    officialUrl: projection.officialUrl,
  });
  assert.ok(share.message.includes('because of potential Cronobacter sakazakii contamination.'));
});

/**
 * The complete approved population of recorded reason clauses P3E changes,
 * frozen from the P3E audit (2026-09-04): the seven occurrences of medically
 * meaningful casing the pre-P3E whole-phrase lowercasing destroyed. Keyed by
 * notice identity, clause family, and the exact source phrase; each entry
 * pins the pre-P3E rendering and the corrected rendering, plus the evidence
 * rule that authorizes the restored span. If this guard fails because a new
 * clause entered (or left) the set, do not edit this table to make it pass:
 * review the source notice's own capitalization against
 * docs/recall-feed-usability.md (P3E) first — silent widening of a casing
 * transform is the regression this guard exists to catch.
 */
const APPROVED_REASON_CLAUSE_DELTAS: Record<
  string,
  { baseline: string; corrected: string; rule: string }
> = {
  'fda:reckittmead-johnson-nutrition-voluntarily-recalls-select-batches-nutramigen-hypoallergenic-infant § verbatim § Potential Cronobacter sakazakii contamination':
    {
      baseline: 'potential cronobacter sakazakii contamination',
      corrected: 'potential Cronobacter sakazakii contamination',
      rule: 'organism genus vocabulary (Cronobacter)',
    },
  'fda:byheart-issues-voluntary-recall-five-batches-its-infant-formula-because-possible-health-risk § verbatim § Potential for cross-contamination with Cronobacter sakazakii':
    {
      baseline: 'potential for cross-contamination with cronobacter sakazakii',
      corrected: 'potential for cross-contamination with Cronobacter sakazakii',
      rule: 'organism genus vocabulary (Cronobacter)',
    },
  'fda:medtech-products-inc-issues-nationwide-recall-little-remediesr-honey-cough-syrup-due-microbial § verbatim § Potential Foodborne Illness – Bacillus cereus':
    {
      baseline: 'potential foodborne illness – bacillus cereus',
      corrected: 'potential foodborne illness – Bacillus cereus',
      rule: 'organism genus vocabulary (Bacillus)',
    },
  'fda:a2-platinum-usa-label-infant-formula-recalled-because-possible-health-risk § verbatim § Presence of cereulide toxin produced by some strains of the bacterium Bacillus cereus':
    {
      baseline:
        'presence of cereulide toxin produced by some strains of the bacterium bacillus cereus',
      corrected:
        'presence of cereulide toxin produced by some strains of the bacterium Bacillus cereus',
      rule: 'organism genus vocabulary (Bacillus)',
    },
  'fda:fda-alerts-consumers-recall-certain-comforts-baby-water-fluoride § verbatim § Potential mold contamination - Talaromyces penicillium':
    {
      baseline: 'potential mold contamination - talaromyces penicillium',
      corrected: 'potential mold contamination - Talaromyces penicillium',
      rule: 'organism genus vocabulary (Talaromyces)',
    },
  'fda:nordic-naturals-issues-voluntary-recall-babys-vitamin-d3-liquid-due-elevated-levels-vitamin-d3 § verbatim § Elevated level of Vitamin D3 dosage':
    {
      baseline: 'elevated level of vitamin d3 dosage',
      corrected: 'elevated level of vitamin D3 dosage',
      rule: 'vitamin designation construction',
    },
  'fda:perrigo-issues-voluntary-recall-one-batch-premium-infant-formula-iron-milk-based-powder-due-elevated § contents § levels of Vitamin D above the maximum level permitted':
    {
      baseline: 'levels of vitamin d above the maximum level permitted',
      corrected: 'levels of vitamin D above the maximum level permitted',
      rule: 'vitamin designation construction',
    },
};

test('corpus guard: reason-clause casing changes exactly the approved recorded clauses', () => {
  const observed: Record<string, { baseline: string; corrected: string }> = {};
  for (const { id, projection } of CORPUS) {
    const typed = interpretReason({
      reasonText: projection.reasonText,
      hazardCategory: projection.hazardCategory,
      pathogenOrAllergen: projection.pathogenOrAllergen,
      summaryText: projection.summaryText,
      title: projection.title,
    });
    if (typed.family !== 'contents' && typed.family !== 'verbatim') continue;
    const phrase = typed.family === 'contents' ? typed.contents : typed.noun;
    const baseline = phrase.toLowerCase(); // the pre-P3E rendering
    const corrected = reasonClauseCasing(phrase);
    // Casing-only and idempotent over every recorded free-text reason.
    assert.equal(corrected.toLowerCase(), baseline, `${id}: transform is not casing-only`);
    assert.equal(reasonClauseCasing(corrected), corrected, `${id}: transform is not idempotent`);
    if (corrected !== baseline) {
      observed[`${id} § ${typed.family} § ${phrase}`] = { baseline, corrected };
    }
  }
  const expected = Object.fromEntries(
    Object.entries(APPROVED_REASON_CLAUSE_DELTAS).map(([key, { baseline, corrected }]) => [
      key,
      { baseline, corrected },
    ]),
  );
  assert.deepEqual(
    observed,
    expected,
    'The set of recorded reason clauses the P3E casing transform changes has widened or shrunk. ' +
      "Do not edit APPROVED_REASON_CLAUSE_DELTAS to make this pass — review the notice's own " +
      'source capitalization first (P3E contract, docs/recall-feed-usability.md).',
  );
});

test('the corrected notices change no canonical, search, push, or materiality behavior', () => {
  for (const key of Object.keys(APPROVED_REASON_CLAUSE_DELTAS)) {
    const fragment = key.split(' § ')[0].replace(/^fda:/, '');
    const { id, projection } = caseOf(fragment);
    // Canonical reason text keeps the raw source casing (display-only fix)…
    const sourcePhrase = key.split(' § ')[2];
    assert.ok(
      (projection.reasonText ?? '').includes(sourcePhrase.slice(0, 24)) ||
        (projection.reasonText ?? '')
          .toLowerCase()
          .includes(sourcePhrase.slice(0, 24).toLowerCase()),
      `${id}: canonical reason text lost its source phrase`,
    );
    assert.notEqual(projection.reasonText, projection.reasonText?.toLowerCase());
    // …identity and materiality are untouched (a display change can never
    // trigger a notification)…
    assert.equal(detectChanges(projection, projection).material.length, 0, id);
    // …and search — which never indexes reason text — matches identically
    // for any query casing.
    const entry = buildSearchEntry(feedItemOf(id, projection));
    const parsed = parseSearchQuery(projection.title.split(/\s+/)[0]);
    if (parsed) assert.ok(matchesSearch(entry, parsed), `${id}: title search miss`);
  }
  // Push copy is built from the SAME `conciseReasonLine` the Feed and Saved
  // card render (P2B7Q), so the P3E clause transform — which belongs to
  // Detail's "because …" clause alone — still never reaches it.
  const { home, projection } = modelsOf('nutramigen-hypoallergenic-infant');
  assert.deepEqual(initialPushOf(projection), {
    // P2B7G: the one approved unit-spacing delta ("19.8oz" → "19.8 oz") —
    // see APPROVED_UNIT_SPACING_DELTAS above. P2B7M: the lowercase tail under
    // the capitalized "Nutramigen Powder" head is now corrected too, and push
    // gets the correction at the same instant Feed, Saved and Detail do.
    title: 'Recall alert: Nutramigen Powder Infant Formula in 12.6 and 19.8 oz Cans',
    body: 'Potential Cronobacter sakazakii contamination. Check your package.',
  });
  // …and it is the card's sentence, character for character. Push used to
  // build its own from the retired `recall-display.reasonLine`, which said
  // "Possible contamination" where the card said "Potential Cronobacter
  // sakazakii contamination" — a notification naming a vaguer hazard than
  // the screen it opens.
  assert.equal(initialPushOf(projection).body, `${home.reasonLine}. Check your package.`);
});
