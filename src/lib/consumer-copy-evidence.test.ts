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
import { test } from 'node:test';

import { deriveIllnessStatus, illnessNoticeCopy } from '@/domain/illness-status';
import type { CaseProjection } from '@/domain/recall-types';
import { displayableRetailerNames } from '@/domain/retailer-display';
import { formatPushContent } from '@/server/push/format';
import type { DeliverableEvent } from '@/server/push/types';
import { buildSearchEntry, matchesSearch, parseSearchQuery } from './feed-search';
import type { CaseDetail, FeedItem } from './recall-feed';
import { buildDetailModel, buildHomeCardModel } from './recall-presentation';
import { normalizedUpdate } from './what-happened';

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
  return `Some announcement prose.\nEditor’s Note: ${text}\nMore prose.`;
}

// ── The update note: what changed, and when ─────────────────────────────────

test('the worked example survives verbatim: the SK Food Group Feb 9 note', () => {
  // The exact recorded note behind the milestone's worked example. It states a
  // completed change, it dates itself, and it is therefore kept.
  assert.equal(
    normalizedUpdate(
      noteOf(
        'Feb. 9, 2024 – Details of this public health alert were updated to reflect ' +
          'additional products affected by the dairy products that have been recalled due to ' +
          'possible Listeria Monocytogenes contamination. Check back frequently to see if ' +
          'additional products have been added.',
      ),
    ),
    'Updated Feb 9, 2024: additional affected products were added.',
  );
});

test('a referenced date is never presented as the date of the update', () => {
  // Recorded shape, 21 of 58 dated notes: the only date in the note belongs to
  // the notice BEING expanded, so the update itself is undated and says so.
  assert.equal(
    normalizedUpdate(
      noteOf(
        'This release is being reissued as an expansion of the May 16, 2017 public health ' +
          'alert to include additional products and production dates.',
      ),
    ),
    'Update: additional affected products were added.',
  );
  // …while a date the note states as ITS OWN is kept, in both the shapes FSIS
  // writes: a leading dateline, and the direct object of an update verb.
  assert.equal(
    normalizedUpdate(noteOf('(May 5, 2017): This release is being updated to correct the label.')),
    'Updated May 5, 2017: affected product and label details were corrected.',
  );
  assert.equal(
    normalizedUpdate(
      noteOf('Details of this recall were updated April 27, 2022, to correct the lot codes.'),
    ),
    'Updated Apr 27, 2022: affected product and label details were corrected.',
  );
  // A later "updated on <date>" beats an earlier referenced date in the same
  // note — the recorded Sept. 30 / Oct. 13 shape.
  assert.equal(
    normalizedUpdate(
      noteOf(
        'This release is being reissued as an expansion of the Sept. 30, 2016, release to ' +
          'include additional products. This press release was updated on Oct. 13, 2016 to ' +
          'include more information about the sandwich steak products.',
      ),
    ),
    'Updated Oct 13, 2016: additional affected products were added.',
  );
});

test('one month is spelled one way, however the notice spells it', () => {
  const short = normalizedUpdate(noteOf('Sept. 1, 2022 — The product labels have been updated.'));
  const long = normalizedUpdate(
    noteOf('September 1, 2022 — The product labels have been updated.'),
  );
  assert.equal(short, 'Updated Sep 1, 2022: affected product and label details were corrected.');
  assert.equal(short, long);
});

test('a date-shaped string that is not a date never renders as one', () => {
  // "Lot 5, 2024" has a date's shape and no month in it. The old rule rendered
  // the unmatched word verbatim ("Updated Lot 5, 2024"); the gate drops it.
  const note = normalizedUpdate(noteOf('Lot 5, 2024 codes were corrected on the product labels.'));
  assert.equal(note, 'Update: affected product and label details were corrected.');
});

test('a possibility never becomes a completed change', () => {
  // Recorded: the only additive statement in the note is about what MIGHT
  // happen. Nothing was added, so nothing is claimed.
  assert.equal(
    normalizedUpdate(
      noteOf(
        'FSIS is continuing to investigate illnesses associated with this widespread outbreak, ' +
          'and additional product from other companies may also be recalled.',
      ),
    ),
    null,
  );
  assert.equal(
    normalizedUpdate(
      noteOf(
        'Consumers are advised to check this recall release often as there may be additional ' +
          'products included in this recall in the near future.',
      ),
    ),
    null,
  );
  // The hedge is on the ADDITION, never on the hazard: a completed expansion
  // whose products "may be contaminated" keeps its clause.
  assert.equal(
    normalizedUpdate(
      noteOf(
        'Dec. 11, 2021: This product recall has been expanded, with an expanded list of fully ' +
          'cooked ham products that may be contaminated with Listeria monocytogenes.',
      ),
    ),
    'Updated Dec 11, 2021: additional affected products were added.',
  );
});

test('a negated expansion is never rendered as an expansion', () => {
  // Recorded: the note says in so many words that the recall was NOT expanded.
  assert.equal(
    normalizedUpdate(
      noteOf(
        'This release was updated July 12 to further clarify and correct “Use or Freeze by” and ' +
          '“Best by” date ranges, as well as to provide an updated product list. The product ' +
          'list remains the same and the recall is not expanded.',
      ),
    ),
    'Update: affected product and label details were corrected.',
  );
});

test('an expansion of something other than products claims nothing about products', () => {
  // Distribution, poundage and a school list are all expansions. None of them
  // adds a product, and the template that says products were added is silent.
  for (const note of [
    'October 4, 2023 – Details of this recall were updated to expand the distribution of the ' +
      'product to retailers in Alabama and Florida.',
    'Details of this recall were updated April 27, 2022, to expand the April 16, 2022, recall ' +
      'poundage from 709 pounds to 3,819 pounds.',
    'The scope of this recall expansion now includes an additional 5,156,076 pounds of raw beef ' +
      'products, which were produced and packed from July 26, 2018 to Sept. 7, 2018.',
    'October 17, 2024 – A preliminary list of schools that received products that include ' +
      'BrucePac recalled ready-to-eat (RTE) meat and poultry have been added.',
  ]) {
    const rendered = normalizedUpdate(noteOf(note));
    assert.ok(
      rendered === null || !rendered.includes('additional affected products were added'),
      `claimed products were added from: ${note}`,
    );
  }
  // …and a note that really does add a product still says so.
  assert.equal(
    normalizedUpdate(
      noteOf('Details of this recall were updated on Jan. 30, 2015 to reflect additional product.'),
    ),
    'Updated Jan 30, 2015: additional affected products were added.',
  );
});

test('an upstream supplier’s test is never attributed to this product', () => {
  // Recorded: the sequenced sample was the INGREDIENT, at its own
  // manufacturer. The clause states what was tested, never whose product.
  const upstream = normalizedUpdate(
    noteOf(
      'September 30, 2025: Whole genome sequencing confirmed a sample of pasta from the same ' +
        'FDA-regulated pasta manufacturer as the ingredient used in these meals is genetically ' +
        'related to the Listeria Outbreak Linked to Prepared Meals.',
    ),
  );
  assert.equal(
    upstream,
    'Updated Sep 30, 2025: laboratory testing linked samples to the outbreak strain.',
  );
  assert.ok(!/product samples/.test(upstream ?? ''));
});

test('an unclassifiable or housekeeping note renders nothing at all', () => {
  assert.equal(normalizedUpdate(noteOf('This release was reissued.')), null);
  assert.equal(
    normalizedUpdate(
      noteOf('Details of this recall release were updated to reflect updated contact information.'),
    ),
    null,
  );
  assert.equal(normalizedUpdate('No note here at all.'), null);
  assert.equal(normalizedUpdate(null), null);
});

test('the update note never invents a date the notice did not state', () => {
  const dated = normalizedUpdate(
    noteOf('This release is being reissued to include additional product.'),
  );
  assert.equal(dated, 'Update: additional affected products were added.');
  assert.ok(!/\d{4}/.test(dated ?? ''), 'an undated note must carry no year');
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
  assert.equal(denied?.text, 'No illnesses reported');

  const counted = detailOf({
    summaryText: 'There have been 3 reported illnesses associated with these products.',
  }).illnessNotice;
  assert.equal(counted?.text, '3 illnesses reported');

  // Nothing in the app converts the unknown state into either of the others.
  assert.notEqual(denied?.text, null);
  assert.ok(!/\b0\b|none/i.test(denied?.text ?? ''));
});

test('the illness count agrees with its number and its grammar', () => {
  assert.equal(
    detailOf({ summaryText: 'One illness has been reported in connection with this recall.' })
      .illnessNotice?.text,
    '1 illness reported',
  );
  assert.equal(
    detailOf({ summaryText: 'Two illnesses have been reported in connection with this recall.' })
      .illnessNotice?.text,
    '2 illnesses reported',
  );
});

/**
 * MEASURED, NOT ASSUMED: what the app does with a hospitalization or a death.
 *
 * P2B7K's de-duplication was written to keep a sentence carrying a
 * hospitalization, a death, an injury or an adverse reaction in What Happened,
 * "duplicated", because the compact notice shows only the illness count.
 *
 * That safety property does not exist, and this test is what says so. What
 * Happened is built from structured slots — it never contains a source
 * sentence in the first place — so `narrativeWithoutIllness` has nothing to
 * keep. Measured over the whole 1,931-case table it changes nothing, and over
 * the 898 active consumer-visible cases the 8 whose notice affirms a
 * hospitalization or a death show that fact on no surface at all.
 *
 * This is pinned rather than fixed because showing a death count is an
 * information-hierarchy decision the founder owns, and P2B7K's notice is
 * illnesses-only by founder decision. The test exists so the gap cannot be
 * mistaken for an accident, and so the day it is closed, it is closed
 * deliberately. See docs/recall-illness-status.md §1.2 (P2B7Q).
 */
test('a severe-outcome fact reaches only the illness count today — measured, not assumed', () => {
  const model = detailOf({
    title: 'Acme Foods Recalls Soft Cheese Products',
    reasonText: 'Product Contamination',
    hazardCategory: 'microbial_contamination',
    pathogenOrAllergen: 'Listeria monocytogenes',
    summaryText:
      'To date, there have been 9 illnesses, 8 hospitalizations, and 1 death linked to the soft cheese products.',
  });
  // The count is stated…
  assert.equal(model.illnessNotice?.text, '9 illnesses reported');
  // …and What Happened is the structured narrative, carrying no source prose,
  // so the hospitalizations and the death appear on no surface.
  assert.match(
    model.whatHappened.text,
    /^Acme Foods recalled .* may be contaminated with Listeria monocytogenes\.$/,
  );
  const everything = [
    model.whatHappened.text,
    model.whatHappened.update ?? '',
    model.illnessNotice?.text ?? '',
    model.illnessNotice?.spoken ?? '',
    model.sections.healthRisk?.risk ?? '',
  ].join(' ');
  assert.ok(!/hospitali|death/i.test(everything));
  // A notice that states a hospitalization and NO illness count renders
  // nothing at all, because illness status stays unknown.
  const hospitalizationOnly = detailOf({
    summaryText: 'One hospitalization due to Listeria monocytogenes has been reported to date.',
  });
  assert.equal(hospitalizationOnly.illnessNotice, null);
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

// ── Fallbacks look like fallbacks ───────────────────────────────────────────

test('an app recommendation is marked as ours, and a source instruction as the notice’s', () => {
  const ours = detailOf().action;
  assert.equal(ours.origin, 'app');
  assert.match(ours.text, /^We recommend that you do not eat this product\./);
  const theirs = detailOf({
    consumerAction:
      'Consumers should throw the product away or return it to the place of purchase.',
  }).action;
  assert.equal(theirs.origin, 'source');
  assert.ok(!/We recommend/.test(theirs.text));
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

test('the update note is display-time, so a corrected ingest needs no rewrite', () => {
  // Same stored summary, rendered twice: the note is derived on every read,
  // never stored, so every future ingest inherits the corrected classifier.
  const summary = noteOf(
    'Details of this recall were updated on Jan. 30, 2015 to reflect additional product.',
  );
  assert.equal(normalizedUpdate(summary), normalizedUpdate(summary));
  assert.equal(
    detailOf({ summaryText: summary }).whatHappened.update,
    'Updated Jan 30, 2015: additional affected products were added.',
  );
});
