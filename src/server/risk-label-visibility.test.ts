/**
 * P2B7N — the risk label's visibility contract, proven at full pipeline depth
 * (recorded raw fixture → parse → projectCase → the shared presentation
 * models) and pinned against the three screens that render them.
 *
 * ## The rule
 *
 * An FSIS Public Health Alert never receives a recall classification. The
 * domain says so honestly (`not_applicable_pha` → tier `unknown`), and that
 * answer is what storage, filtering, sorting, search, ranking and push all
 * read. As a BADGE, though, `UNKNOWN` sitting beside `PUBLIC HEALTH ALERT`
 * told a shopper nothing and made a completely, correctly processed alert
 * look like a parsing failure. So the label — and only the label — is
 * dropped, by `riskLabelSuppressed`, in `riskView`, which is the ONE place
 * Feed, Saved and Detail all reach their risk state through.
 *
 * ## What this file has to prove
 *
 *  1. The rule needs BOTH halves. A PHA whose tier is unknown badges nothing;
 *     a recall whose tier is unknown still badges `UNKNOWN`; and a PHA that
 *     ever arrived carrying a real class would badge that class rather than
 *     have real agency data silently discarded.
 *  2. Feed, Saved and Detail cannot disagree, because none of them decides.
 *     Feed and Saved are the same builder and the same component; Detail is
 *     the same builder; and no screen spells the notice-type check itself.
 *  3. Hiding the label leaves NOTHING behind — no wrapper, no spacer, no
 *     accessibility node, and nothing that announces the tier.
 *  4. Nothing but presentation moved: the tier, the stored classification, the
 *     official-classification block, risk filtering and search are unchanged.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { projectCase } from '../domain/projection';
import type { CaseProjection, Classification } from '../domain/recall-types';
import { consumerRiskTier } from '../domain/risk-tier';
import { matchesRiskFilter } from '../lib/feed-filters';
import { buildSearchEntry, matchesSearch, parseSearchQuery } from '../lib/feed-search';
import type { FeedItem } from '../lib/recall-feed';
import { buildDetailModel, buildHomeCardModel } from '../lib/recall-presentation';
import { riskLabelSuppressed, riskView } from '../lib/risk-display';
import { parseFsisRecord, type FsisRawRecord } from './fsis/parse';

const TODAY = '2026-09-19';

const SOURCE = (...parts: string[]) => readFileSync(join(__dirname, '..', ...parts), 'utf8');
const RECALL_CARD = SOURCE('components', 'recall-card.tsx');
const DETAIL = SOURCE('app', 'recall', '[id].tsx');
const FEED = SOURCE('app', '(tabs)', 'index.tsx');
const SAVED = SOURCE('app', '(tabs)', 'saved.tsx');
const RISK_DISPLAY = SOURCE('lib', 'risk-display.ts');

/** A recorded real FSIS record, projected exactly as the pipeline projects it. */
function recorded(fixture: string): CaseProjection {
  const record = JSON.parse(
    readFileSync(join(__dirname, 'fsis', 'fixtures', `${fixture}.json`), 'utf8'),
  ) as FsisRawRecord;
  return projectCase([parseFsisRecord(record)]);
}

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

/**
 * The card model Feed and Saved BOTH build (they call this one builder), and
 * the Detail model, over the same projection — so every assertion below covers
 * all three surfaces at once rather than three near-copies that could drift.
 */
function modelsOf(projection: CaseProjection, id = 'case-under-test') {
  return {
    card: buildHomeCardModel(feedItemOf(id, projection), { today: TODAY, prefs: null }),
    detail: buildDetailModel(
      { id, projection, timeline: [], affectedProducts: projection.affectedProducts, visuals: [] },
      { today: TODAY, affectsYou: false },
    ),
  };
}

/**
 * A derived variant of a recorded record. Subtractive/synthetic TEST INPUT
 * only — never displayed or persisted as recall data — used for the states the
 * live corpus does not currently contain (see the corpus note below).
 */
function withClassification(
  projection: CaseProjection,
  classification: Classification,
): CaseProjection {
  return { ...projection, classification };
}

// Recorded real notices. The PHAs are genuine USDA FSIS Public Health Alerts;
// the recalls are genuine classified FSIS recalls.
const PHA = recorded('pha-active-nationwide-pha-08082026-01');
const PHA_IMPORT = recorded('pha-import-ecuador-pha-12022024-01');
const RECALL_CLASS_I = recorded('recall-active-nationwide-017-2026');

test('the recorded fixtures really are what this contract is about', () => {
  for (const pha of [PHA, PHA_IMPORT]) {
    assert.equal(pha.noticeType, 'public_health_alert');
    assert.equal(pha.classification.value, 'not_applicable_pha');
    // The DOMAIN answer, unchanged by P2B7N and read by everything that is
    // not a badge.
    assert.equal(consumerRiskTier(pha.classification), 'unknown');
  }
  assert.equal(RECALL_CLASS_I.noticeType, 'recall');
  assert.equal(consumerRiskTier(RECALL_CLASS_I.classification), 'critical');
});

test('PHA + unknown: Feed, Saved and Detail all hide UNKNOWN and keep the notice label', () => {
  for (const pha of [PHA, PHA_IMPORT]) {
    const { card, detail } = modelsOf(pha);

    // Feed and Saved are the SAME model from the SAME builder, so this one
    // assertion is both card surfaces.
    assert.equal(card.risk.badgeLabel, null);
    // Detail makes no second decision.
    assert.equal(detail.risk.headlineLabel, null);
    assert.equal(card.risk.badgeLabel, detail.risk.headlineLabel);

    // The label that carries actual information stays, on all three.
    assert.equal(card.noticeLabel, 'Public Health Alert');
    assert.equal(detail.noticeTypeLabel, 'Public Health Alert');

    // The tier is untouched — this is presentation, not a data rewrite.
    assert.equal(card.risk.tier, 'unknown');
    assert.equal(detail.risk.tier, 'unknown');

    // And the one place that ADDS information about the missing class still
    // says so, in full, on Detail.
    assert.deepEqual(detail.risk.official, {
      heading: 'Official USDA FSIS classification',
      text: 'Not assigned',
      note: 'Public health alerts do not receive a formal classification.',
    });
  }
});

test('nothing the shopper can see or hear on a PHA says the risk is unknown', () => {
  const { card, detail } = modelsOf(PHA);

  // Every string the card renders. With no badge there is no node to carry
  // the spoken label, so "Unknown" must not appear anywhere in what is left —
  // not as a badge, not as a caption, not as a substitute word.
  const cardText = [
    card.noticeLabel,
    card.risk.badgeLabel,
    card.activity.text,
    card.productName,
    card.brand.text,
    card.reasonLine,
    card.categoryLabel,
    card.locationSummary,
  ]
    .filter((value): value is string => value !== null)
    .join(' | ');
  assert.doesNotMatch(cardText, /unknown/i);

  // Detail's header area, likewise. `official.text` deliberately reads "Not
  // assigned" with its own explanation — an honest statement about the
  // classification, which is not the same as badging the risk as unknown.
  const detailHeader = [
    detail.noticeTypeLabel,
    detail.risk.headlineLabel,
    detail.lifecycleLabel,
    detail.activity.text,
  ]
    .filter((value): value is string => value !== null)
    .join(' | ');
  assert.doesNotMatch(detailHeader, /unknown/i);
  assert.equal(detail.risk.official?.text, 'Not assigned');
});

test('a genuinely unclassifiable RECALL still reads UNKNOWN — the exception is the PHA’s alone', () => {
  // A recall whose stored classification cannot be resolved to a supported
  // class. Derived from a recorded FSIS recall: the legacy `multiple_classes`
  // scalar, persisted before `officialClasses` existed, is the real shape that
  // produces this state. (The live corpus holds NO non-PHA unknown notice
  // today — see the corpus note at the foot of this file — so the state is
  // proven from a derived input rather than left unproven.)
  const unknownRecall = withClassification(RECALL_CLASS_I, {
    value: 'multiple_classes',
    sourceText: null,
  });
  assert.equal(unknownRecall.noticeType, 'recall');
  assert.equal(consumerRiskTier(unknownRecall.classification), 'unknown');

  const { card, detail } = modelsOf(unknownRecall);
  // That absence IS information — a recall that should carry a class and does
  // not — so it is still stated, on every surface, exactly as before.
  assert.equal(card.risk.badgeLabel, 'UNKNOWN');
  assert.equal(detail.risk.headlineLabel, 'UNKNOWN');
  assert.equal(card.risk.accessibilityLabel, 'Risk level: Unknown');
  // A recall carries no notice label; its risk IS its label.
  assert.equal(card.noticeLabel, null);
  assert.equal(detail.noticeTypeLabel, 'Recall');
});

test('pending and rated recalls are untouched on every surface', () => {
  const pending = withClassification(RECALL_CLASS_I, {
    value: 'not_yet_classified',
    sourceText: null,
    officialClasses: [],
  });
  const pendingModels = modelsOf(pending);
  assert.equal(pendingModels.card.risk.badgeLabel, 'PENDING');
  assert.equal(pendingModels.detail.risk.headlineLabel, 'PENDING');

  const rated = modelsOf(RECALL_CLASS_I);
  assert.equal(rated.card.risk.badgeLabel, 'CRITICAL');
  assert.equal(rated.detail.risk.headlineLabel, 'CRITICAL');
  assert.equal(rated.card.risk.accessibilityLabel, 'Risk level: Critical');

  // A PHA that ever arrived carrying a real agency class would show it: only
  // the meaningless `unknown` is suppressed, so meaningful data can never be
  // discarded by this rule.
  const classifiedPha = withClassification(PHA, {
    value: 'class_I',
    sourceText: 'Class I',
    officialClasses: ['class_I'],
  });
  const phaModels = modelsOf(classifiedPha);
  assert.equal(phaModels.card.risk.badgeLabel, 'CRITICAL');
  assert.equal(phaModels.detail.risk.headlineLabel, 'CRITICAL');
  assert.equal(phaModels.card.noticeLabel, 'Public Health Alert');
});

test('the rule needs both halves, and is stated exactly once', () => {
  assert.equal(riskLabelSuppressed('public_health_alert', 'unknown'), true);
  assert.equal(riskLabelSuppressed('public_health_alert', 'critical'), false);
  assert.equal(riskLabelSuppressed('public_health_alert', 'pending'), false);
  assert.equal(riskLabelSuppressed('recall', 'unknown'), false);
  assert.equal(riskLabelSuppressed('recall', 'critical'), false);

  // `riskView` is the ONE caller — the decision is made where both model
  // builders already meet, so no surface can be given a different answer.
  // Exactly two occurrences in the whole of the shipped app: the declaration
  // and that single call.
  assert.equal(RISK_DISPLAY.split('riskLabelSuppressed(').length - 1, 2);
  const callers = readdirSync(join(__dirname, '..'), { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .filter((file) =>
      readFileSync(join(__dirname, '..', file), 'utf8').includes('riskLabelSuppressed'),
    );
  assert.deepEqual(
    callers,
    ['lib/risk-display.ts'],
    `the rule is applied in ${callers.join(', ')}`,
  );
  assert.match(RISK_DISPLAY, /const suppressed = riskLabelSuppressed\(noticeType, tier\);/);
  assert.match(RISK_DISPLAY, /badgeLabel: suppressed \? null : label\.text,/);
  assert.match(RISK_DISPLAY, /headlineLabel: suppressed \? null : label\.text,/);
});

test('no screen re-decides the rule, and none can spell the check itself', () => {
  // The regression this guards is a scattered `noticeType === 'public_health_alert'`
  // beside a risk check, in one component but not the others.
  for (const [name, source] of [
    ['the card', RECALL_CARD],
    ['Detail', DETAIL],
    ['Feed', FEED],
    ['Saved', SAVED],
  ] as const) {
    assert.ok(!source.includes("'public_health_alert'"), `${name} spells the notice-type check`);
    assert.ok(!source.includes('riskLabelSuppressed'), `${name} re-applies the rule`);
    assert.ok(!source.includes('consumerRiskTier('), `${name} derives its own tier`);
  }

  // Feed and Saved reach the card through the ONE builder and the ONE
  // component, so their status rows are the same code, not two copies.
  for (const [name, source] of [
    ['Feed', FEED],
    ['Saved', SAVED],
  ] as const) {
    assert.match(source, /<RecallCard/, `${name} does not render the shared card`);
    assert.match(source, /buildHomeCardModel\(/, `${name} does not use the shared builder`);
    assert.ok(!source.includes('<RiskLabel'), `${name} renders its own risk label`);
    assert.ok(!source.includes('<NoticeLabel'), `${name} renders its own notice label`);
  }

  // Detail consumes the model's decision rather than its own.
  assert.match(DETAIL, /\{model\.risk\.headlineLabel \? \(/);
});

test('a hidden label leaves no wrapper, no spacer and no accessibility node', () => {
  // Both status rows render the label as a bare conditional whose alternative
  // is `null` — React renders nothing at all for that, so there is no empty
  // View, no placeholder and no element for a screen reader to land on. The
  // rows are gapped flex containers, so an omitted child also leaves no gap:
  // PUBLIC HEALTH ALERT simply moves into the leading position and the date
  // stays beside it.
  assert.match(RECALL_CARD, /\{model\.risk\.badgeLabel \? \(\s*<RiskLabel/);
  assert.match(RECALL_CARD, /\) : null\}\s*\{\/\*[\s\S]*?\*\/\}\s*\{model\.noticeLabel \?/);
  assert.match(DETAIL, /\{model\.risk\.headlineLabel \? \(\s*<RiskLabel/);

  // The spoken label reaches exactly one node — the label itself — so with no
  // label there is nothing to announce. No other element on either surface is
  // handed `risk.accessibilityLabel`.
  for (const [name, source] of [
    ['the card', RECALL_CARD],
    ['Detail', DETAIL],
  ] as const) {
    const uses = source.split('risk.accessibilityLabel').length - 1;
    assert.equal(uses, 1, `${name} passes the spoken risk label to ${uses} nodes`);
    assert.match(source, /accessibilityLabel=\{model\.risk\.accessibilityLabel\}/, name);
  }

  // Neither status row reserves height for the badge: no fixed height, and
  // both rows still wrap, so a long PHA label and Dynamic Type grow the row
  // rather than clipping it.
  assert.match(RECALL_CARD, /statusRow: \{[\s\S]*?flexWrap: 'wrap',[\s\S]*?\},/);
  assert.match(RECALL_CARD, /statusGroup: \{[\s\S]*?flexWrap: 'wrap',[\s\S]*?\},/);
  assert.ok(
    !/statusRow: \{[\s\S]*?height:/.test(RECALL_CARD),
    'the card status row fixes a height',
  );
});

test('filtering, sorting and search read the RAW classification, never the badge', () => {
  const pha = feedItemOf('pha', PHA);
  const { card } = modelsOf(PHA);

  // The Risk filter is derived from the stored classification through the
  // domain tier — the same value the hidden badge would have shown. Selecting
  // Unknown still finds the PHA, which is exactly right: the notice IS
  // unclassified, whatever the card chooses to display.
  assert.equal(card.risk.badgeLabel, null);
  assert.equal(matchesRiskFilter(pha.classification, ['unknown']), true);
  assert.equal(matchesRiskFilter(pha.classification, ['critical', 'unknown']), true);
  assert.equal(matchesRiskFilter(pha.classification, ['critical']), false);
  // No selection admits everything, unchanged.
  assert.equal(matchesRiskFilter(pha.classification, []), true);

  // The filter module reads the domain tier directly and imports no
  // presentation code, so a presentation verdict cannot leak into it.
  const FILTERS = SOURCE('lib', 'feed-filters.ts');
  assert.match(FILTERS, /tiers\.includes\(consumerRiskTier\(classification\)\)/);
  assert.ok(!FILTERS.includes('badgeLabel'), 'the risk filter reads a presentation label');
  assert.ok(!FILTERS.includes('riskView'), 'the risk filter reads the presentation view');
  assert.ok(!FILTERS.includes('riskLabelSuppressed'), 'the risk filter reads the hide rule');

  // Search matches the same fields it always did; the badge was never one of
  // them, and a PHA is still found by its own words.
  const entry = buildSearchEntry(pha);
  // A word from the alert's own official title — a PHA is still found by what
  // it is about, exactly as before.
  const word = PHA.title.split(/[\s,]+/).find((part) => part.length > 4);
  assert.ok(word, 'the recorded PHA has no title word to search for');
  const titleQuery = parseSearchQuery(word!);
  assert.ok(titleQuery);
  assert.equal(matchesSearch(entry, titleQuery), true);
  // The badge was never a searchable field, and dropping it adds none: the
  // word the card no longer shows was never a way to find this notice.
  const unknownQuery = parseSearchQuery('unknown');
  assert.ok(unknownQuery);
  assert.equal(matchesSearch(entry, unknownQuery), false);
});

test('P2B7N changed presentation only — the projection is byte-identical', () => {
  // The models are derived from the projection; the projection is not touched
  // by them. Re-projecting the same recorded record must produce exactly the
  // same stored shape after the models have been built over it.
  const before = JSON.stringify(recorded('pha-active-nationwide-pha-08082026-01'));
  modelsOf(PHA);
  const after = JSON.stringify(recorded('pha-active-nationwide-pha-08082026-01'));
  assert.equal(before, after);
  assert.equal(PHA.classification.value, 'not_applicable_pha');
  assert.equal(riskView(PHA.classification, 'FSIS', 'recall').badgeLabel, 'UNKNOWN');
});

/**
 * CORPUS NOTE (measured 2026-09-19, read-only, against the live corpus):
 *
 *   1,931 cases · 168 PHAs — all FSIS, all `not_applicable_pha`, all tier
 *   `unknown`; 167 feed-visible (active, unmerged), 1 retracted, 0 closed.
 *   PHAs carrying any non-unknown classification: 0.
 *   Non-PHA notices whose tier is `unknown`: 0 (339 are `pending`).
 *
 * So today the rule hides exactly 168 badges and changes nothing else. The
 * "recall + unknown" and "PHA + a real class" rows of the matrix are proven
 * above from derived inputs BECAUSE the corpus does not currently contain
 * them — they are reachable states (a legacy `multiple_classes` scalar, an
 * unsupported classification value) and must not become unproven just because
 * no live notice sits there this week. Counts move as the agencies publish
 * and are not gates.
 */
