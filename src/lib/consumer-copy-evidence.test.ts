/**
 * P2B7Q — the EVIDENCE contract for Lotly-authored recall copy.
 *
 * `consumer-copy.test.ts` pins the app's voice: which words it uses, which it
 * never uses, and which surfaces may say them. This file pins the other half,
 * which the P2B7Q audit was run to establish: that every app-authored
 * factual sentence is EARNED by the source evidence it claims to describe.
 *
 * The failure mode is shared across every template in the inventory: a
 * sentence that reads as an official statement while asserting something the
 * notice never said. The audit's standing rules, each with a test below:
 *
 *   absence never becomes zero or "none";
 *   possibility never becomes certainty;
 *   an upstream supplier's event never becomes this product's event;
 *   a publication or referenced date never becomes the update's date;
 *   a generic source change never becomes a specific claim about what changed;
 *   a retailer list is never exhaustive;
 *   a fallback never looks like an agency-authored fact;
 *   and the surfaces never contradict each other.
 *
 * Every fixture here is shaped like a real ingest — the recorded corpus
 * sentences the audit measured — so a future notice arriving through the same
 * pipeline is governed by the same assertions.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { deriveIllnessStatus, illnessNoticeCopy } from '@/domain/illness-status';
import type { CaseProjection, TimelineEntry } from '@/domain/recall-types';
import { displayableRetailerNames } from '@/domain/retailer-display';
import { formatPushContent } from '@/server/push/format';
import type { DeliverableEvent } from '@/server/push/types';
import { buildSearchEntry, matchesSearch, parseSearchQuery } from './feed-search';
import type { CaseDetail, FeedItem } from './recall-feed';
import { buildDetailModel, buildHomeCardModel } from './recall-presentation';
import { buildWhatHappened } from './what-happened';

const TODAY = '2026-09-20';

function projection(overrides: Partial<CaseProjection> = {}): CaseProjection {
  return {
    sourceAgency: 'FSIS',
    noticeType: 'recall',
    state: 'active',
    closedYear: null,
    classification: { value: 'class_I', sourceText: 'Class I' },
    title: 'Acme Foods Recalls Chicken Products',
    summaryText: '',
    summaryHtml: null,
    reasonText: null,
    hazardCategory: 'unknown',
    pathogenOrAllergen: null,
    recallingFirm: { displayName: 'Acme Foods', rawVariants: ['Acme Foods'] },
    brands: [],
    productDescription: null,
    retailerNames: [],
    heroImageUrl: null,
    geography: { scope: 'unknown', states: [], confidence: 'inferred', sourceText: null },
    affectedProducts: [],
    quantityText: null,
    illnessStatement: null,
    reportsIllness: false,
    consumerAction: null,
    contactText: null,
    officialUrl: 'https://www.fsis.usda.gov/x',
    otherOfficialUrls: [],
    sourceIdentifiers: [],
    publishedAt: '2026-08-01',
    lastPublicActivityAt: '2026-08-01',
    ...overrides,
  };
}

function detailOf(overrides: Partial<CaseProjection> = {}, extra: Partial<CaseDetail> = {}) {
  const source = projection(overrides);
  const detail: CaseDetail = {
    id: 'case-1',
    projection: source,
    timeline: [],
    affectedProducts: [],
    visuals: [],
    ...extra,
  };
  return buildDetailModel(detail, { today: TODAY, affectsYou: false });
}

function feedItemOf(source: CaseProjection): FeedItem {
  return {
    id: 'case-1',
    sourceAgency: source.sourceAgency,
    noticeType: source.noticeType,
    state: source.state,
    title: source.title,
    classification: source.classification,
    hazardCategory: source.hazardCategory,
    publishedAt: source.publishedAt,
    lastPublicActivityAt: source.lastPublicActivityAt,
    reasonText: source.reasonText,
    pathogenOrAllergen: source.pathogenOrAllergen,
    firmName: source.recallingFirm.displayName,
    brands: source.brands ?? [],
    productDescription: source.productDescription ?? null,
    retailerNames: source.retailerNames ?? [],
    heroImageUrl: source.heroImageUrl ?? null,
    productNames: source.affectedProducts.map((product) => product.name),
    geography: source.geography,
    officialUrl: source.officialUrl,
    timeline: [],
  };
}

function cardOf(overrides: Partial<CaseProjection> = {}) {
  return buildHomeCardModel(feedItemOf(projection(overrides)), { today: TODAY, prefs: null });
}

function initialPushOf(source: CaseProjection) {
  const event: DeliverableEvent = {
    id: 'event-1',
    recallCaseId: 'case-1',
    kind: 'initial',
    triggerRuleId: 'new_case',
    payloadSummary: '',
    createdAt: `${TODAY}T00:00:00Z`,
    projection: source,
  };
  return formatPushContent(event);
}

/** An Editor's Note as FSIS publishes one, on its own line in the summary. */
function noteOf(text: string): string {
  return `Some announcement prose.\nEditor\u2019s Note: ${text}\nMore prose.`;
}

// ── The update note: removed, generator and all (P2B7Q.1) ───────────────────

/**
 * P2B7Q hardened `normalizedUpdate` until every clause it rendered was earned
 * by the source, and its tests are gone with it — the founder then removed the
 * treatment entirely. THAT a recall changed is already told honestly, by its
 * resurfacing in Recent Activity and by the "Updated" date the material-change
 * ledger earns. WHAT changed was a paraphrase of an Editor's Note, which is
 * editorial prose the app has no business writing.
 *
 * These are the tests that keep it gone. They are deliberately about ABSENCE:
 * no field, no generator, and no Editor's Note text reaching a shopper by any
 * other route.
 */
test('no update note reaches the model, from the richest Editor\u2019s Note in the corpus', () => {
  const summary = noteOf(
    'Feb. 9, 2024 \u2013 Details of this public health alert were updated to reflect ' +
      'additional products affected by the dairy products that have been recalled due to ' +
      'possible Listeria Monocytogenes contamination.',
  );
  const model = detailOf({ summaryText: summary });
  assert.ok(!('update' in model.whatHappened), 'the DetailModel still carries an update field');
  assert.deepEqual(Object.keys(model.whatHappened), ['text']);
  const rendered = JSON.stringify(model);
  for (const fragment of ['Editor', 'additional affected products', 'Updated Feb 9']) {
    assert.ok(!rendered.includes(fragment), `the model still carries "${fragment}"`);
  }
});

test('buildWhatHappened returns text and provenance only \u2014 the generator is deleted', () => {
  const happened = buildWhatHappened({
    title: 'Acme Foods Recalls Chicken Products',
    noticeType: 'recall',
    reasonText: 'Product Contamination',
    hazardCategory: 'microbial_contamination',
    pathogenOrAllergen: 'Salmonella',
    firmDisplayName: 'Acme Foods',
    summaryText: noteOf('Details of this recall were updated to reflect additional product.'),
    productDescription: null,
    consumerBrand: null,
  });
  assert.deepEqual(Object.keys(happened).sort(), ['source', 'text']);
  assert.ok(!/additional|Editor|Updated/i.test(happened.text));
});

test('the Detail screen renders no update line, and imports no generator', () => {
  const screen = readFileSync(join(__dirname, '..', 'app', 'recall', '[id].tsx'), 'utf8');
  const code = screen
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  assert.ok(!code.includes('whatHappened.update'), 'Detail still renders an update line');
  assert.ok(!code.includes('normalizedUpdate'), 'Detail still reaches for the generator');
  // …and the generator is not exported from anywhere under src/.
  const owner = readFileSync(join(__dirname, 'what-happened.ts'), 'utf8');
  assert.ok(!owner.includes('export function normalizedUpdate'), 'the generator is back');
});

// ── Illness: absence, denial and count are three different things ───────────

test('silence, denial and a count are three distinct illness answers', () => {
  // Silence renders NOTHING — not "0", not "none", not a placeholder row.
  assert.equal(illnessNoticeCopy(deriveIllnessStatus('Acme recalled chicken products.')), null);
  assert.equal(detailOf({ summaryText: 'Acme recalled chicken products.' }).illnessNotice, null);

  const denied = detailOf({
    summaryText:
      'There have been no confirmed reports of illness due to consumption of these products.',
  }).illnessNotice;
  assert.deepEqual(denied?.lines, ['No illnesses reported']);

  const counted = detailOf({
    summaryText: 'There have been 3 reported illnesses associated with these products.',
  }).illnessNotice;
  assert.deepEqual(counted?.lines, ['3 illnesses reported']);

  // Nothing in the app converts the unknown state into either of the others.
  assert.ok(!/\b0\b|none/i.test(denied?.lines.join(' ') ?? ''));
});

test('the illness count agrees with its number and its grammar', () => {
  assert.deepEqual(
    detailOf({ summaryText: 'One illness has been reported in connection with this recall.' })
      .illnessNotice?.lines,
    ['1 illness reported'],
  );
  assert.deepEqual(
    detailOf({ summaryText: 'Two illnesses have been reported in connection with this recall.' })
      .illnessNotice?.lines,
    ['2 illnesses reported'],
  );
});

// ── Hospitalizations and deaths (P2B7Q.1) ──────────────────────────────────

/**
 * The gap P2B7Q measured and P2B7Q.1 closes.
 *
 * P2B7K's compact notice was illnesses-only, on the understanding that a
 * hospitalization or a death survived in `What Happened`. It did not: the
 * narrative is built from structured slots and never carries a source
 * sentence, so 8 of 898 active cases affirmed one of those facts and not one
 * of them showed it anywhere. These are the recorded sentences behind that
 * measurement, each now stated on its own line.
 */
test('a hospitalization and a death are stated, one fact per line, in fixed order', () => {
  const model = detailOf({
    title: 'Acme Foods Recalls Soft Cheese Products',
    reasonText: 'Product Contamination',
    hazardCategory: 'microbial_contamination',
    pathogenOrAllergen: 'Listeria monocytogenes',
    summaryText:
      'To date, there have been 9 illnesses, 8 hospitalizations, and 1 death linked to the soft cheese products.',
  });
  assert.deepEqual(model.illnessNotice?.lines, [
    '9 illnesses reported',
    '8 hospitalizations reported',
    '1 death reported',
  ]);
  assert.equal(model.illnessNotice?.tone, 'reported');
  // One utterance, one stop per fact.
  assert.equal(
    model.illnessNotice?.spoken,
    '9 illnesses reported. 8 hospitalizations reported. 1 death reported.',
  );
  // …and the narrative is untouched: it never carried the sentence.
  assert.match(
    model.whatHappened.text,
    /^Acme Foods recalled .* may be contaminated with Listeria monocytogenes\.$/,
  );
});

test('a hospitalization with no illness count still renders — the notice is no longer silent', () => {
  // Recorded (`2c491bc9`, `4c2f1bf1`): the notice states a hospitalization and
  // no illness count at all. Illness status stays honestly unknown, so no
  // illness line renders — and the fact the notice DID establish is stated.
  const model = detailOf({
    summaryText: 'One hospitalization due to Listeria monocytogenes has been reported to date.',
  });
  assert.deepEqual(model.illnessNotice?.lines, ['1 hospitalization reported']);
  assert.equal(model.illnessNotice?.tone, 'reported');
});

test('a harm the hazard MIGHT cause is never reported as one that happened', () => {
  // The single largest hazard in the corpus: FDA and FSIS carry standing
  // education verbatim on hundreds of notices. Each of these states what the
  // organism can do, and none of them reports anything.
  for (const education of [
    'In some persons, however, the diarrhea may be so severe that the patient needs to be hospitalized.',
    'The condition can lead to serious kidney damage and even death.',
    'HUS can lead to death.',
    'Complications from Cronobacter infection in infants can include brain abscess, developmental delays, motor impairments, and death.',
    'Death has been reported in cases of severe overdose.',
  ]) {
    const status = deriveIllnessStatus(education);
    assert.equal(status.hospitalizations.kind, 'unknown', education);
    assert.equal(status.deaths.kind, 'unknown', education);
    const copy = illnessNoticeCopy(status);
    assert.ok(
      copy === null || !/hospitali|death/i.test(copy.lines.join(' ')),
      `education became a report: ${education}`,
    );
  }
});

test('a denied harm renders no line, and never a reassuring one', () => {
  // Affirmation and denial in one sentence: each mention is judged on its own.
  const mixed = deriveIllnessStatus(
    'There have been 20 reported cases with 5 hospitalization and no deaths.',
  );
  assert.equal(mixed.hospitalizations.count, 5);
  assert.equal(mixed.deaths.kind, 'unknown');
  const lines = illnessNoticeCopy(mixed)?.lines ?? [];
  assert.ok(lines.includes('5 hospitalizations reported'));
  assert.ok(!lines.some((line) => /death/i.test(line)), 'a death line was rendered from a denial');

  // A whole-notice denial of both renders the illness line alone.
  assert.deepEqual(
    illnessNoticeCopy(deriveIllnessStatus('No illnesses or deaths have been reported to date.'))
      ?.lines,
    ['No illnesses reported'],
  );
});

test('a neighbouring figure is never read as a harm count', () => {
  // "9 illnesses, 8 hospitalizations, and 1 death" must yield 8 and 1 — the
  // comma between a figure and the next noun disowns it.
  const status = deriveIllnessStatus(
    'To date, there have been 9 illnesses, 8 hospitalizations, and 1 death linked to the products.',
  );
  assert.equal(status.illnesses, 9);
  assert.equal(status.hospitalizations.count, 8);
  assert.equal(status.deaths.count, 1);
});

test('an affirmation with no trustworthy figure says so without inventing one', () => {
  // Recorded (`f84e2407`): "Approximately half of affected case-patients have
  // been hospitalized" states a hospitalization and no number at all.
  const status = deriveIllnessStatus(
    'Approximately half of affected case-patients have been hospitalized due to illness.',
  );
  assert.equal(status.hospitalizations.kind, 'reported_unspecified');
  assert.equal(status.hospitalizations.count, null);
  assert.ok(illnessNoticeCopy(status)!.lines.includes('Hospitalizations reported'));
});

test('a harm inherits the illness contract’s attribution, never its own', () => {
  // Recorded (`5a521509`): the notice states "7 illnesses resulting in 3
  // hospitalizations across the United States … 3 of which MAY be linked to a
  // single product". The source does not tie those figures to this recall, so
  // the illness status is unknown — and the hospitalization is too. The harms
  // are read from the SAME own-attributed sentences, so they cannot claim an
  // outbreak the illness line already declined to claim.
  const status = deriveIllnessStatus(
    'No other Ambrosia Brands products are impacted by this recall. ' +
      'To date, there have been 7 illnesses resulting in 3 hospitalizations across the ' +
      'United States due to Salmonella contamination, 3 of which may be linked to a single product.',
  );
  assert.equal(status.kind, 'unknown');
  assert.equal(status.hospitalizations.kind, 'unknown');
  assert.equal(illnessNoticeCopy(status), null);
});

test('a reported death overrides the calm treatment of an illness denial', () => {
  const copy = illnessNoticeCopy(
    deriveIllnessStatus(
      'No illnesses have been reported. Two deaths have been reported in connection with this recall.',
    ),
  )!;
  assert.ok(copy.lines.includes('2 deaths reported'));
  assert.equal(copy.tone, 'reported', 'a reported death still read as the calm state');
});

// ── Certainty, negation and subject ─────────────────────────────────────────

test('a stated hazard stays a possibility on every surface', () => {
  const source = {
    title: 'Acme Foods Recalls Chicken Products',
    reasonText: 'Product Contamination',
    hazardCategory: 'microbial_contamination',
    pathogenOrAllergen: 'Salmonella',
  } satisfies Partial<CaseProjection>;
  const model = detailOf(source);
  assert.match(model.whatHappened.text, /may be contaminated with Salmonella/);
  assert.ok(!/\bis contaminated\b|\bcaused\b/.test(model.whatHappened.text));
  assert.equal(cardOf(source).reasonLine, 'Potential Salmonella contamination');
});

test('the subject of "X recalled Y" is a source-stated party, never invented', () => {
  assert.match(detailOf().whatHappened.text, /^Acme Foods recalled /);
  // With no firm and no brand the frame goes subjectless rather than guessing.
  const anonymous = detailOf({
    recallingFirm: { displayName: null, rawVariants: [] },
    brands: [],
  });
  assert.match(anonymous.whatHappened.text, /^A recall was issued for /);
  // A public health alert keeps the producing company; it never says "recalled".
  const alert = detailOf({ noticeType: 'public_health_alert' });
  assert.match(alert.whatHappened.text, /^A public health alert was issued for .* from Acme Foods/);
  assert.ok(!/ recalled /.test(alert.whatHappened.text));
});

test('a quantity sentence is rendered only from a source-stated recall quantity', () => {
  const withQuantity = detailOf({
    sourceAgency: 'FDA',
    quantityText: 'approximately 2,060 cases',
    officialUrl: 'https://www.fda.gov/x',
  });
  assert.match(withQuantity.whatHappened.text, /The recall covers approximately 2,060 cases\./);
  // FSIS's quantity field is the amount RECOVERED — a different fact, never shown.
  const fsis = detailOf({ quantityText: 'approximately 2,060 cases' });
  assert.ok(!/The recall covers/.test(fsis.whatHappened.text));
  assert.ok(!/The recall covers/.test(detailOf({ sourceAgency: 'FDA' }).whatHappened.text));
});

test('one quantity is stated once — the figure is never repeated in the paragraph', () => {
  // Both quantity paths can fire on the same FDA recall: the narrative's own
  // "recalling N <unit>" sentence, and the stored `quantityText`. The second
  // is suppressed when the first already carried the figure, so the paragraph
  // states the amount once.
  const model = detailOf({
    sourceAgency: 'FDA',
    officialUrl: 'https://www.fda.gov/x',
    title: 'Acme Foods Recalls Chicken Products',
    reasonText: 'Product Contamination',
    hazardCategory: 'microbial_contamination',
    pathogenOrAllergen: 'Salmonella',
    summaryText: 'Acme Foods is recalling approximately 1,626 pounds of chicken products.',
    quantityText: 'approximately 1,626 pounds of chicken products',
  });
  const occurrences = model.whatHappened.text.split('1,626').length - 1;
  assert.equal(
    occurrences,
    1,
    `the quantity figure appears ${occurrences} times: ${model.whatHappened.text}`,
  );
  assert.equal(model.whatHappened.text.split('The recall covers').length - 1, 1);
});

// ── Unknowns are stated, never filled in ────────────────────────────────────

test('an unknown distribution is stated as unknown on both surfaces, never as "none"', () => {
  const unknown = {
    geography: { scope: 'unknown', states: [], confidence: 'inferred', sourceText: null },
  } satisfies Partial<CaseProjection>;
  assert.equal(cardOf(unknown).locationSummary, 'Distribution not specified');
  assert.equal(detailOf(unknown).sections.whereSold.lead, 'Distribution not specified');
  // Nationwide is claimed only when the source says nationwide.
  const nationwide = {
    geography: { scope: 'nationwide', states: [], confidence: 'stated', sourceText: null },
  } satisfies Partial<CaseProjection>;
  assert.equal(cardOf(nationwide).locationSummary, 'Nationwide');
  assert.equal(detailOf(nationwide).sections.whereSold.lead, 'Nationwide');
});

test('a notice that named no store shows no retailer line, and a named list is never capped', () => {
  assert.equal(detailOf().sections.whereSold.retailersNamed, null);
  // The display gate suppresses a malformed NAME; it never invents one.
  assert.deepEqual(displayableRetailerNames(['Roseville and Sacr']), []);
  assert.deepEqual(displayableRetailerNames(['Walmart', 'Kroger']), ['Walmart', 'Kroger']);
  assert.ok(
    !/\+\d|more|and others/i.test(displayableRetailerNames(['Walmart', 'Kroger']).join(', ')),
  );
});

// ── Cross-surface agreement, and the differences that are intentional ───────

test('a push and the card it opens state the same reason, in the same words', () => {
  for (const source of [
    projection({
      reasonText: 'Product Contamination',
      hazardCategory: 'microbial_contamination',
      pathogenOrAllergen: 'Listeria monocytogenes',
    }),
    projection({
      reasonText: 'Unreported Allergens',
      hazardCategory: 'allergen',
      pathogenOrAllergen: 'Undeclared milk',
    }),
    projection({
      reasonText: 'Produced Without Benefit Of Inspection',
      hazardCategory: 'other_regulatory',
    }),
  ]) {
    const card = buildHomeCardModel(feedItemOf(source), { today: TODAY, prefs: null });
    assert.equal(initialPushOf(source).body, `${card.reasonLine}. Check your package.`);
  }
});

test('the Feed card and Detail never disagree about the activity label', () => {
  const source = projection({ publishedAt: '2026-08-01', lastPublicActivityAt: '2026-08-01' });
  const card = buildHomeCardModel(feedItemOf(source), { today: TODAY, prefs: null });
  const detail = buildDetailModel(
    { id: 'case-1', projection: source, timeline: [], affectedProducts: [], visuals: [] },
    { today: TODAY, affectsYou: false },
  );
  assert.equal(card.activity.text, detail.activity.text);
  assert.match(card.activity.text, /^Announced /);
});

test('retailers stay a Detail-only fact, and searching for one still finds it (P2B7O)', () => {
  const source = projection({ retailerNames: ['Vandermeer Grocers'] });
  const card = buildHomeCardModel(feedItemOf(source), { today: TODAY, prefs: null });
  const rendered = JSON.stringify(card);
  assert.ok(!rendered.includes('Vandermeer'), 'a retailer reached the Feed card model');
  // …and the recall is still reachable by that store's name.
  const parsed = parseSearchQuery('Vandermeer');
  assert.ok(parsed !== null && matchesSearch(buildSearchEntry(feedItemOf(source)), parsed));
});

// ── Retired concepts stay retired ───────────────────────────────────────────

/**
 * The "What should I do?" instruction is gone, generator and all (P2B7Q.1).
 *
 * It was built, tested and rendered nowhere — P2B7Q measured that — and it was
 * the app's only piece of copy that gave a shopper an INSTRUCTION in Lotly's
 * own voice ("We recommend that you do not eat this product."). The founder
 * retired the concept rather than the wiring, so no dormant generator is left
 * for a future screen to pick up.
 */
test('the consumer-action concept is gone from the model and from the source', () => {
  const model = detailOf({
    consumerAction:
      'Consumers should throw the product away or return it to the place of purchase.',
  });
  assert.ok(!('action' in model), 'the DetailModel still carries an action');
  const rendered = JSON.stringify(model);
  assert.ok(!rendered.includes('We recommend'), 'an app instruction is still composed');
  assert.ok(
    !rendered.includes('throw the product away'),
    'a source instruction still reaches a model',
  );
  for (const [name, path] of [
    ['projection', join(__dirname, 'consumer-projection.ts')],
    ['display', join(__dirname, 'recall-display.ts')],
  ] as const) {
    const code = readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    for (const gone of ['buildConsumerAction', 'consumerActionDisplay', 'We recommend that you']) {
      assert.ok(!code.includes(gone), `${name} still carries ${gone}`);
    }
  }
});

test('the raw projection is never mutated by rendering it', () => {
  const source = projection({
    summaryText: noteOf('Feb. 9, 2024 – Details were updated to reflect additional products.'),
    reasonText: 'Product Contamination',
    hazardCategory: 'microbial_contamination',
    pathogenOrAllergen: 'Salmonella',
    retailerNames: ['Walmart'],
  });
  const before = JSON.stringify(source);
  buildDetailModel(
    { id: 'case-1', projection: source, timeline: [], affectedProducts: [], visuals: [] },
    { today: TODAY, affectsYou: false },
  );
  buildHomeCardModel(feedItemOf(source), { today: TODAY, prefs: null });
  initialPushOf(source);
  assert.equal(JSON.stringify(source), before, 'rendering mutated the stored projection');
});

test('a corrected narrative is display-time, so a future ingest needs no rewrite', () => {
  // Same stored summary, rendered twice: the narrative is derived on every
  // read and nothing about it is stored, so every future ingest inherits the
  // current contract without a backfill.
  const summary = 'Acme Foods is recalling chicken products.';
  const first = detailOf({ summaryText: summary }).whatHappened.text;
  const second = detailOf({ summaryText: summary }).whatHappened.text;
  assert.equal(first, second);
});

// ── P2B7Q.1: what an update still tells a shopper ───────────────────────────

/**
 * The founder removed the generated update NOTE and kept update RESURFACING.
 * `feed-relevance.test.ts` pins the resurfacing; this pins the other half —
 * the "Updated" date, and the identity it is attached to.
 */
test('an update changes the date on the SAME recall, never the recall', () => {
  const source = projection({ publishedAt: '2024-01-05T00:00:00.000Z' });
  const timeline: TimelineEntry[] = [
    {
      occurredAt: '2026-08-13T00:00:00.000Z',
      kind: 'expanded',
      summary: 'the recall was expanded',
      causedBySnapshotIds: [],
      material: true,
      ruleId: 'expansion_products',
    },
  ];

  const before = buildDetailModel(
    { id: 'case-1', projection: source, timeline: [], affectedProducts: [], visuals: [] },
    { today: TODAY, affectsYou: false },
  );
  const after = buildDetailModel(
    { id: 'case-1', projection: source, timeline, affectedProducts: [], visuals: [] },
    { today: TODAY, affectsYou: false },
  );

  // One identity across the update — an update is not a new recall.
  assert.equal(before.id, after.id);
  // The date is the ONLY thing the shopper is told changed, and "Updated" is
  // earned from the material-change ledger rather than from any prose.
  assert.equal(before.activity.kind, 'announced');
  assert.equal(after.activity.kind, 'updated');
  assert.match(after.activity.text, /^Updated /);
  // …and the card says exactly the same thing, from the same ledger.
  const card = buildHomeCardModel(
    { ...feedItemOf(source), timeline },
    { today: TODAY, prefs: null },
  );
  assert.equal(card.activity.text, after.activity.text);
  // Nothing anywhere paraphrases WHAT changed.
  assert.ok(!/additional|expansion|expanded|products were added/i.test(JSON.stringify(after)));
});
