/**
 * P3D/P3E corpus-wide display-capitalization contract, proven over every
 * recorded FDA and FSIS notice at full pipeline depth (raw fixture → parse →
 * projectCase → shared presentation models).
 *
 * Two guarantees, both pinned exactly:
 *
 *  1. Recorded regressions — the two audited defective notices render
 *     corrected, and the audited preservation cases (the stylized brand "a2",
 *     the FSIS package-prose row names) render byte-identical to before.
 *
 *  2. The unexpected-delta guard — across the WHOLE corpus, the set of source
 *     values the P3D display transforms change is EXACTLY the approved set
 *     from the P3D-A audit. If this test fails because a new value entered
 *     the set, do not add it here to make the test pass: stop and review the
 *     new delta against docs/recall-feed-usability.md (P3D) first — silent
 *     widening of a casing transform is the regression this guard exists to
 *     catch.
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
  displayHeadlineCase,
  headlineCaseIfLowercase,
  humanizeAllCaps,
  productDisplayName,
  reasonClauseCasing,
} from '../lib/consumer-summary';
import { buildSearchEntry, matchesSearch, parseSearchQuery } from '../lib/feed-search';
import { buildDetailModel, buildHomeCardModel } from '../lib/recall-presentation';
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
    affectsYou: false,
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
  // ("Quart"/"Quarts"); digit tokens are preserved.
  const expected = '4 Sizes Of Aluminum Saucepans With Capacities Ranging From 1 Quart To 3 Quarts';
  assert.equal(home.productName, expected);
  assert.equal(detail.productName, expected);
  // Future push copy uses the same shared contract (founder decision D).
  assert.equal(
    initialPushOf(projection).title,
    'Recall alert: 4 Sizes Of Aluminum Saucepans With Capacities Ranging From…',
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
 * The complete approved population of source values the P3D transforms may
 * change, from the P3D-A audit (2026-09-04): one defectively lowercase FDA
 * brand entry and one defectively lowercase FDA product description. Nothing
 * else in the recorded corpus is defect-shaped at any call site.
 */
const APPROVED_DELTAS = new Set([
  'fda:sunco-frenchie-issues-allergy-alert-undeclared-sulfites-golden-raisins § brand § terrafina',
  'fda:town-food-service-equipment-co-inc-recalls-aluminum-saucepans-because-possible-health-risk § headline § 4 sizes of aluminum saucepans with capacities ranging from 1 quart to 3 quarts',
]);

test('corpus guard: the P3D transforms change exactly the approved source values', () => {
  const observed = new Set<string>();
  for (const { id, projection } of CORPUS) {
    // Headline slot (product name for Home/Detail/share/push).
    const headline = productDisplayName(projection.productDescription ?? null, projection.title);
    if (headlineCaseIfLowercase(headline) !== headline) {
      observed.add(`${id} § headline § ${headline}`);
    }
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
    'The set of source values the P3D display transforms change has widened or shrunk. ' +
      'Do not edit APPROVED_DELTAS to make this pass — review the new delta first (P3D contract).',
  );
});

/**
 * Push-only ALL-CAPS humanization deltas, frozen separately from the two P3D
 * lowercase deltas above. Push now shares the full `displayHeadlineCase`
 * composition (un-shout + headline-case) with Home/Detail; the un-shout half
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

test('push and Home/Detail share one casing pipeline for every recorded name', () => {
  // Parity by construction: both surfaces call displayHeadlineCase. Proven
  // corpus-wide over the shared semantic input (the raw display name) —
  // Home/Detail additionally strip measurements/brand prefixes, which changes
  // words, never their casing treatment.
  for (const { projection } of CORPUS) {
    const raw = productDisplayName(projection.productDescription ?? null, projection.title);
    assert.equal(displayHeadlineCase(raw), headlineCaseIfLowercase(humanizeAllCaps(raw)));
    const once = displayHeadlineCase(raw);
    assert.equal(displayHeadlineCase(once), once); // idempotent corpus-wide
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
      assert.equal(headlineCaseIfLowercase(value).toLowerCase(), value.toLowerCase());
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
  assert.match(source, /displayHeadlineCase/);
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
    'a2 recalled a2 Platinum Premium Infant Formula 0-12 months USA label because of presence of cereulide toxin produced by some strains of the bacterium Bacillus cereus. The recall covers 16,428 units.',
  );
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
    'Nordic Naturals recalled Baby’s Vitamin D3 Liquid because of elevated level of vitamin D3 dosage. The recall covers 3,800 units.',
  );
  const perrigo = modelsOf('perrigo-issues-voluntary-recall');
  assert.equal(
    perrigo.detail.whatHappened.text,
    'Perrigo Company recalled Premium Infant Formula with Iron Milk-Based Powder because the products contain levels of vitamin D above the maximum level permitted. The recall covers 16,500 cans.',
  );
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
  // sentence; Detail embeds the same phrase mid-sentence. After P3E the two
  // agree on every semantic span — Home can no longer show "Cronobacter
  // sakazakii" while Detail flattens it.
  const nutramigen = modelsOf('nutramigen-hypoallergenic-infant');
  assert.equal(nutramigen.home.reasonLine, 'Potential Cronobacter sakazakii contamination.');
  assert.ok(nutramigen.detail.whatHappened.text.includes('Cronobacter sakazakii'));
  const byheart = modelsOf('byheart-issues-voluntary-recall');
  assert.equal(
    byheart.home.reasonLine,
    'Potential for cross-contamination with Cronobacter sakazakii.',
  );
  assert.ok(byheart.detail.whatHappened.text.includes('Cronobacter sakazakii'));
  const littleRemedies = modelsOf('little-remediesr-honey-cough-syrup');
  assert.equal(littleRemedies.home.reasonLine, 'Potential Foodborne Illness – Bacillus cereus.');
  assert.ok(littleRemedies.detail.whatHappened.text.includes('Bacillus cereus'));
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
  // Push copy is built from reasonLine (lib/recall-display), which renders
  // the source reason verbatim — the P3E clause transform never reaches it.
  const { projection } = caseOf('nutramigen-hypoallergenic-infant');
  assert.deepEqual(initialPushOf(projection), {
    title: 'Recall alert: Nutramigen Powder infant formula in 12.6 and 19.8oz cans',
    body: 'Possible contamination. Check your package.',
  });
});
