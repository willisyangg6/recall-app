/**
 * P1 wiring contract: Home and Detail consume the shared presentation models
 * (lib/recall-presentation.ts) and do not rebuild product names, brands,
 * dates, reasons, illness, geography, imagery, or affected products on their
 * own. Asserted against the screen sources, the same way the feed-controls
 * and profile contracts are pinned — a silent return to screen-level
 * formatting is exactly the regression this suite exists to catch.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const HOME = readFileSync(join(__dirname, '..', 'app', 'index.tsx'), 'utf8');
const DETAIL = readFileSync(join(__dirname, '..', 'app', 'recall', '[id].tsx'), 'utf8');

/** Formatting entry points the screens must no longer call directly. */
const RETIRED_SCREEN_FORMATTERS = [
  'productDisplayName(',
  'companyLine(',
  'brandLine(',
  'reasonLine(',
  'timingLine(',
  'geographyLabel(',
  'geographyDetail(',
  'illnessDisplay(',
  'buildWhatHappened(',
  'formatDate(',
  'healthRiskSummary(',
  'buildConsumerCase(',
  'riskView(',
  // P2b: product-identity and affected-row construction live in the shared
  // contract; a screen may render models but never clean or classify fields
  // itself.
  'cleanProductName(',
  'stripTrailingMeasurement(',
  'splitTrailingMeasurements(',
  'measurementOnlyName(',
  'packagingOnlyName(',
  'affectedProductsModel(',
  'affectedProductsTable(',
  // P2c: image-role allocation lives in the shared contract; a screen may
  // render the allocation's verdicts but never extract, rank, deduplicate,
  // or match images itself.
  'allocateRecallImages(',
  'extractProductPhotos(',
  'galleryPhotos(',
  'primaryPhoto(',
  'packageCheckPhotos(',
];

test('Home renders cards from the presentation model, not its own formatting', () => {
  assert.match(HOME, /buildHomeCardModel\(/);
  assert.match(HOME, /from '@\/lib\/recall-presentation'/);
  for (const formatter of RETIRED_SCREEN_FORMATTERS) {
    assert.ok(!HOME.includes(formatter), `Home still calls ${formatter}`);
  }
  // The card renders model fields — the raw FeedItem no longer reaches it.
  assert.match(HOME, /model: HomeCardModel/);
  assert.match(HOME, /model\.productName/);
  assert.match(HOME, /model\.brand\.text/);
  assert.match(HOME, /model\.reasonLine/);
  assert.match(HOME, /model\.activity\.text/);
  assert.match(HOME, /model\.locationSummary/);
});

test('Home cards carry no per-card source attribution and exactly one activity label', () => {
  assert.ok(!HOME.includes('Source:'), 'per-card source attribution returned to Home');
  // The retired two-date line ("Announced … · Updated …") cannot be rebuilt:
  // the card's only date text is the model's single activity line.
  assert.ok(!HOME.includes('lastPublicActivityAt)'), 'a card formats its own activity date');
});

test('the Affects-you flag is fed from the shared relevance verdict in every feed mode', () => {
  // Relevance is evaluated whenever preferences exist — not gated on the
  // Affects me tab — and the card flag reads that same verdict.
  assert.match(HOME, /const hasPersonalization = prefs !== null && hasAnyPreference\(prefs\)/);
  assert.match(HOME, /if \(hasPersonalization\) \{/);
  assert.match(HOME, /affectsYou: relevanceById\.get\(item\.id\)\?\.affectsMe \?\? false/);
});

test('Detail renders from the presentation model, not its own formatting', () => {
  assert.match(DETAIL, /buildDetailModel\(/);
  assert.match(DETAIL, /from '@\/lib\/recall-presentation'/);
  for (const formatter of RETIRED_SCREEN_FORMATTERS) {
    assert.ok(!DETAIL.includes(formatter), `Detail still calls ${formatter}`);
  }
  assert.match(DETAIL, /model\.productName/);
  assert.match(DETAIL, /model\.brand\.text/);
  assert.match(DETAIL, /model\.activity\.text/);
  assert.match(DETAIL, /model\.whatHappened\.text/);
  assert.match(DETAIL, /model\.illnessLine/);
  assert.match(DETAIL, /model\.officialSource\.label/);
  assert.match(DETAIL, /model\.affectsYouBanner/);
  // Optional sections are read from the model's OWN visibility decision.
  assert.match(DETAIL, /model\.sections/);
});

test('the recall quantity is narrative the model composed, never screen styling (P3C-1)', () => {
  // The quantity sentence belongs to What Happened, in the same body type as
  // the reason it follows. The screen has no quantity slot at all: it cannot
  // compose one, cannot mute one, and cannot order it after the illness
  // status. `recall-presentation.test.ts` pins the model side — that the
  // narrative ends with the quantity sentence when the source states one.
  assert.ok(!DETAIL.includes('quantityLine'), 'Detail styles a standalone quantity line');
  assert.ok(!DETAIL.includes('The recall covers'), 'Detail composes quantity copy of its own');
  assert.ok(!DETAIL.includes('quantityText'), 'Detail reads the raw quantity fact');
  assert.ok(!DETAIL.includes('detailNarrative('), 'Detail assembles the narrative itself');
  // The narrative renders BEFORE the illness status, so the order a reader
  // gets is reason, quantity, illness.
  assert.ok(
    DETAIL.indexOf('model.whatHappened.text') < DETAIL.indexOf('model.illnessLine'),
    'the illness status renders before the narrative',
  );
  // And nothing in What Happened is muted secondary text except the Update
  // line the P1 contract put there.
  const section = DETAIL.slice(
    DETAIL.indexOf('<Section title="What happened">'),
    DETAIL.indexOf('{/* Where it was sold'),
  );
  assert.equal(
    section.match(/themeColor="textSecondary"/g)?.length ?? 0,
    1,
    'What happened carries a second muted line',
  );
});

test('Detail introduces none of the disallowed dead controls', () => {
  for (const dead of ['View Retailers', 'View retailers', 'what should I do?', 'Save']) {
    assert.ok(!DETAIL.includes(`>${dead}<`), `dead control "${dead}" rendered on Detail`);
  }
  // No retailer control of any kind yet (P2a founder decision): the collapsed
  // retailer list is a later milestone, and a summary line is not rendered in
  // its place. The named-retailer data stays preserved in the model.
  assert.ok(!DETAIL.includes('retailerSummary'), 'a retailer summary is rendered');
  assert.ok(!DETAIL.includes('View all'), 'a retailer-list disclosure control was reintroduced');
});

test('Affected Products renders the shared P2b table model, not screen-built rows', () => {
  // The screen consumes `model.sections.affectedProducts.table` — columns and
  // cells are decided by the shared contract; no raw fact bags, package-check
  // internals, or rejected facts reach JSX, and the screen composes no field
  // labels or cell values of its own. The model supplies the collapsed and
  // expanded VIEWS (columns recomputed from the rows each shows) — the
  // screen only picks which one to render.
  assert.match(DETAIL, /affectedProducts\.table/);
  assert.match(DETAIL, /expanded \? table\.expanded : table\.collapsed/);
  assert.match(DETAIL, /view\.columns\.map/);
  assert.match(DETAIL, /row\.cells\.map/);
  assert.ok(!DETAIL.includes('.rejected'), 'Detail reads rejected facts');
  assert.ok(!DETAIL.includes('rawText'), 'Detail renders raw extracted text');
  assert.ok(!DETAIL.includes('PACKAGE_FIELD_LABEL'), 'Detail composes its own field labels');
  // The screen never re-derives visible columns or rows itself.
  assert.ok(!DETAIL.includes('rows.slice'), 'the screen slices rows itself');
  assert.ok(!DETAIL.includes('columns.filter'), 'the screen filters columns itself');
  // The table scrolls horizontally as ONE unit — header and rows together.
  assert.match(DETAIL, /ScrollView[\s\S]{0,40}horizontal/);
  // The reveal control comes from the model ("See all (N)"), collapses again,
  // and no screen-invented count exists.
  assert.match(DETAIL, /table\.seeAllLabel/);
  assert.match(DETAIL, /Show fewer/);
  assert.ok(!DETAIL.includes("'See all"), 'the See all label is screen-composed');
  // A missing cell renders EMPTY — never a dash or placeholder text.
  assert.ok(!DETAIL.includes("?? '—'"), 'a dash placeholder is rendered');
  assert.ok(!DETAIL.includes('Unknown'), 'an unknown placeholder is rendered');
  // No version image or image placeholder in P2b (P2c owns image roles).
  assert.ok(!DETAIL.includes('item.photo'), 'a version image is rendered');
  assert.ok(!DETAIL.includes('row.photo'), 'a version image is rendered');
});

test('row codes live inside the table: an in-cell control and a row-keyed modal, no lists below', () => {
  // A row's collapsed code set renders through its own cell's control
  // (`cell.codes` + the model's label) and opens the modal keyed to exactly
  // that row — the product identity as context, this row's codes only, an
  // explicit Close. The retired below-table row-code disclosure area cannot
  // return, and there is no path to a sibling row's codes.
  assert.match(DETAIL, /cell\.codes/);
  assert.match(DETAIL, /cell\.codesLabel/);
  assert.match(DETAIL, /RowCodesModal/);
  assert.match(DETAIL, /rowId: row\.id, name: row\.name, codes: cell\.codes/);
  assert.match(DETAIL, /accessibilityViewIsModal/);
  assert.match(DETAIL, />Close</);
  assert.ok(!DETAIL.includes('codes-${row.id}'), 'the below-table row-code disclosure returned');
  assert.ok(!DETAIL.includes('row-${row.id}'), 'the below-table row-code toggle returned');
  assert.ok(!DETAIL.includes('row.codes'), 'a row code set is read outside its cell');
  // No new dependency and no separate navigation route for the modal.
  assert.match(DETAIL, /Modal[,\s]/);
  assert.ok(!DETAIL.includes('router.push'), 'the modal became a navigation route');
});

test('no shared-facts block can render under Affected Products', () => {
  // Founder decision: the consumer table has no shared-facts section. A fact
  // proven to apply to every version reaches the screen only inside each
  // row's cells (materialized by the shared table model); the screen has no
  // path to the model's internal shared-evidence fields.
  assert.ok(!DETAIL.includes('appliesToAll'), 'a shared-facts block is rendered');
  assert.ok(!DETAIL.includes('Applies to all'), 'shared-facts copy is rendered');
  assert.ok(!DETAIL.includes('sharedFields'), 'package-check shared internals reach the screen');
});

test('P3C-2: no code or date disclosure can render beneath the Affected Products table', () => {
  // The founder's final ruling: lot, batch, case and production codes, and
  // row-applicable production dates, appear in table columns and cells and
  // nowhere else. The screen must have no second surface for them — not the
  // retired disclosures, not a renamed replacement.
  //
  // The retired model fields are the first gate. They no longer exist on the
  // section type, so naming one is a compile error; naming one as a string
  // is what a future refactor would do first.
  for (const retired of [
    'caseCodes',
    'productionCodes',
    'productionDates',
    'affectedProducts.table ?',
    'openCodeSets',
    'toggleCodeSet',
    'Affected production dates',
    '<CodeSet',
    'function CodeSet',
  ]) {
    assert.ok(!DETAIL.includes(retired), `the below-table disclosure returned: ${retired}`);
  }
  // The section renders the table and nothing else: one child, no sibling
  // control, no second heading, no "applies to all" replacement card.
  assert.match(
    DETAIL,
    /<Section title="Affected Products">\s*<AffectedProductsTableView[\s\S]{0,240}?<\/Section>/,
    'the Affected Products section renders something besides the table',
  );
  assert.ok(!DETAIL.includes('Applies to all affected versions'), 'the retired card returned');
  // And the screen never redistributes: no code set is read outside the cell
  // the model put it in, and no row/code assignment happens on the screen.
  assert.ok(!DETAIL.includes('sharedCodes'), 'the screen reads the model shared-code evidence');
  assert.ok(!DETAIL.includes('.items'), 'the screen reads model items instead of table rows');
  assert.ok(!DETAIL.includes('rowImages'), 'the screen matches images to rows itself');
});

test('no orphan attachment links render under Affected Products', () => {
  // The official "Product labels (PDF)" / "Product list (PDF)" links stay
  // preserved in the model (`model.attachments`) for a later source/image
  // surface; the Detail screen renders no independent attachment element.
  assert.ok(!DETAIL.includes('model.attachments'), 'attachment links rendered');
  assert.ok(!DETAIL.includes('Product labels'), 'the labels PDF link rendered');
});

test('Home cards carry ONE generic Affects-you flag — the legacy reason chips are gone', () => {
  // P2a: the match-explanation chips ("Your allergen · X", "Affects
  // California", "Nationwide recall") no longer reach the card. Matching
  // logic is untouched; only its rendering was removed.
  assert.ok(!HOME.includes('personalReasons'), 'Home still consumes personalReasons');
  assert.ok(!HOME.includes('.reasons.map'), 'Home still renders match-reason labels');
  assert.match(HOME, /label="Affects you"/);
});

test('Home and Detail render the same shared risk state, and no explanatory risk copy', () => {
  // Both surfaces read RiskView labels; neither suppresses a non-rated state.
  assert.match(HOME, /model\.risk\.badgeLabel/);
  assert.match(DETAIL, /model\.risk\.headlineLabel/);
  // P2a founder decision: "Risk pending" stands by itself — no explanatory
  // note or pending-classification copy renders anywhere on Detail, and no
  // bottom classification block restates the top state.
  assert.ok(!DETAIL.includes('model.risk.note'), 'explanatory risk copy rendered');
  assert.ok(!DETAIL.includes('model.risk.official'), 'a classification block rendered');
});

test('Detail header: badge + one activity date + name + brand + one link; no metadata line', () => {
  // The one material date renders beside the badge, from the shared model.
  assert.match(DETAIL, /model\.activity\.text/);
  // "Recall · Active" metadata is gone entirely.
  assert.ok(!DETAIL.includes('model.lifecycleLabel'), 'lifecycle metadata rendered');
  assert.ok(!DETAIL.includes('· {model'), 'a dotted metadata line rendered');
  // The official link renders exactly once, near the heading, and the legacy
  // bottom source block, official-title quote, provenance copy, and share
  // control are gone. The model keeps those fields for later milestones.
  assert.equal(DETAIL.split('model.officialSource.label').length - 1, 1);
  assert.ok(!DETAIL.includes('Official source'), 'legacy Official source section returned');
  assert.ok(!DETAIL.includes('model.officialTitle'), 'official-title quote rendered');
  assert.ok(!DETAIL.includes('model.sourceOrganization'), 'source disclaimer rendered');
  assert.ok(!DETAIL.includes('Share this recall'), 'bottom share control rendered');
  assert.ok(!DETAIL.includes('buildShareMessage'), 'share message built on Detail');
});

test('Where It Was Sold renders only the one state representation', () => {
  assert.match(DETAIL, /whereSold\.lead/);
  // No second state list, no count threshold, no channel prose, no online
  // block, no store-address disclosure — the data all stays in the model.
  assert.ok(!DETAIL.includes('model.states.join'), 'a second state list is rendered');
  assert.ok(!DETAIL.includes('LISTED_STATES'), 'the count-vs-list threshold returned');
  assert.ok(!DETAIL.includes('Also sold through'), 'channel prose rendered');
  assert.ok(!DETAIL.includes('venueChannels'), 'channel list rendered');
  assert.ok(!DETAIL.includes('onlinePlatforms'), 'online platforms rendered');
  assert.ok(!DETAIL.includes('retailLocations'), 'store addresses rendered');
});

test('Affected Products renders data only — no helper, coverage, or disclaimer copy', () => {
  assert.ok(!DETAIL.includes('scopeStatement'), 'coverage claim rendered');
  assert.ok(!DETAIL.includes('products.note'), 'coverage explanation rendered');
  assert.ok(!DETAIL.includes('Check your package'), 'helper copy rendered');
  assert.ok(!DETAIL.includes('Compare with your package'), 'compare copy rendered');
  assert.ok(!DETAIL.includes('ComparePhotos'), 'compare-photos block rendered');
  assert.ok(!DETAIL.includes('FindTheCode'), 'Find the Code rendered');
  assert.ok(!DETAIL.includes('FIND THE CODE'), 'Find the Code heading rendered');
});

test('the retired lower sections are gone; the hero renders once near the title', () => {
  assert.ok(!DETAIL.includes('What you should do'), 'What You Should Do rendered');
  assert.ok(!DETAIL.includes('model.action'), 'consumer action rendered');
  assert.ok(!DETAIL.includes('Health risk'), 'Health Risk rendered');
  assert.ok(!DETAIL.includes('model.healthRisk'), 'health-risk copy rendered');
  assert.ok(!DETAIL.includes('galleryPhotos'), 'a lower photo gallery rendered');
  // Exactly one hero render.
  assert.equal(DETAIL.split('model.heroImageUrl').length - 1, 2); // condition + uri
});

test('both screens share one relevance evaluation — matching logic is not duplicated', () => {
  // Each screen calls the one canonical evaluator; nobody reimplements
  // geography/allergen/retailer matching inline.
  assert.match(HOME, /evaluatePersonalRelevance\(/);
  assert.match(DETAIL, /evaluatePersonalRelevance\(/);
  assert.match(DETAIL, /\.affectsMe/);
});

test('P2c: row images render only the shared allocation — no screen-local matching', () => {
  // The table row carries the allocator's verdict; the screen renders it
  // verbatim (URL + conservative accessibility text) and decides nothing.
  assert.match(DETAIL, /row\.image \?/);
  assert.match(DETAIL, /uri=\{row\.image\.url\}/);
  assert.match(DETAIL, /alt=\{row\.image\.accessibilityText\}/);
  // No screen-side matching signals: the screen never reads captions,
  // classifications, or the raw photo set to decide what an image belongs to.
  assert.ok(!DETAIL.includes('.caption'), 'Detail inspects image captions');
  assert.ok(!DETAIL.includes('.classification'), 'Detail inspects image classification');
  assert.ok(!DETAIL.includes('rowImages.get'), 'Detail re-derives row assignments');
  assert.ok(!DETAIL.includes('measurementKey'), 'Detail matches identity keys itself');
  assert.ok(!HOME.includes('images.'), 'Home reads the detail allocation');
  // No gallery or supporting imagery renders yet (the carousel is a later
  // milestone), and no placeholder ever renders for an absent image.
  assert.ok(!DETAIL.includes('images.gallery'), 'a lower gallery rendered');
  assert.ok(!DETAIL.includes('images.supporting'), 'supporting close-ups rendered');
  // The thumbnail render is gated on the assignment itself — an unassigned
  // row reaches no image element at all, so no placeholder can exist.
  assert.match(DETAIL, /\{row\.image \? \(/);
});

test('P3A: optional Detail sections are model-owned — no screen-level content predicate', () => {
  // Every optional section renders from the shared contract's decision, so a
  // heading, container, divider, or its spacing can never appear above
  // nothing. The screen reads the decision and re-derives nothing.
  assert.match(DETAIL, /const \{ whereSold, affectedProducts \} = model\.sections/);
  assert.match(DETAIL, /\{whereSold \? \(/);
  assert.match(DETAIL, /\{affectedProducts \? \(/);
  // Both headings exist ONLY inside their section's conditional.
  for (const heading of ['Where it was sold', 'Affected Products']) {
    const before = DETAIL.slice(0, DETAIL.indexOf(`<Section title="${heading}">`));
    assert.match(before.slice(-400), /\? \(/, `${heading} can render unconditionally`);
  }
  // The screen never re-evaluates row/column/code content to decide.
  assert.ok(!DETAIL.includes('items.length'), 'the screen counts model items');
  assert.ok(!DETAIL.includes('rows.length'), 'the screen counts table rows');
  assert.ok(!DETAIL.includes('columns.length'), 'the screen counts table columns');
  assert.ok(!DETAIL.includes('.coverage'), 'the screen inspects coverage');
  assert.ok(!DETAIL.includes('model.affectedProducts.'), 'the screen reads the evidence model');
  assert.ok(!DETAIL.includes('model.whereSold.'), 'the screen reads the evidence model');
  // No fabricated fallback copy fills an empty optional section.
  for (const filler of ['Not specified', 'None listed', 'No products', 'Not available']) {
    assert.ok(!DETAIL.includes(filler), `fallback copy "${filler}" fills an empty section`);
  }
});

test('P3A: the Detail screen holds no notice ids, hazard parsing, or raw-prose regexes', () => {
  // Section visibility and reason interpretation are model-owned; the screen
  // may not recognize a specific recall or read source prose.
  assert.ok(!/\b(?:PHA-\d|\d{3}-20\d\d)\b/.test(DETAIL), 'a notice id appears in the screen');
  for (const material of ['glass', 'plastic', 'metal', 'foreign material']) {
    assert.ok(
      !DETAIL.toLowerCase().includes(material),
      `hazard vocabulary "${material}" on screen`,
    );
  }
  assert.ok(!DETAIL.includes('summaryText'), 'the screen reads raw announcement prose');
  // `reasonText`/`hazardCategory` reach the screen for ONE purpose only —
  // the canonical relevance evaluation, whose matching contract is unchanged.
  // They are never read a second time to describe the hazard.
  assert.equal(DETAIL.split('reasonText').length - 1, 2, 'reason text read outside relevance');
  assert.match(DETAIL, /reasonText: projection\.reasonText/);
  assert.equal(DETAIL.split('hazardCategory').length - 1, 2, 'hazard read outside relevance');
  assert.match(DETAIL, /hazardCategory: projection\.hazardCategory/);
  assert.ok(!DETAIL.includes('interpretReason'), 'the screen interprets reasons itself');
  assert.ok(!HOME.includes('interpretReason'), 'Home interprets reasons itself');
  assert.ok(!HOME.includes('conciseReasonLine'), 'Home composes its own reason line');
});

test('hero accessibility text inherits the shared model product name (P3D)', () => {
  // The corrected display name reaches assistive tech through the same model
  // field the visible title uses — no screen-local casing or alt text.
  assert.match(HOME, /alt=\{model\.productName\}/);
  assert.match(DETAIL, /alt=\{model\.productName\}/);
});
