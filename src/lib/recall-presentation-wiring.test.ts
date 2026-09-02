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
  assert.match(DETAIL, /model\.quantityLine/);
  assert.match(DETAIL, /model\.officialSource\.label/);
  assert.match(DETAIL, /model\.affectsYouBanner/);
  assert.match(DETAIL, /model\.whereSold/);
  assert.match(DETAIL, /model\.affectedProducts/);
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
  // The screen consumes `model.affectedProductsTable` — columns and cells are
  // decided by the shared contract; no raw fact bags, package-check
  // internals, or rejected facts reach JSX, and the screen composes no field
  // labels or cell values of its own.
  assert.match(DETAIL, /model\.affectedProductsTable/);
  assert.match(DETAIL, /table\.columns\.map/);
  assert.match(DETAIL, /row\.cells\.map/);
  assert.ok(!DETAIL.includes('.rejected'), 'Detail reads rejected facts');
  assert.ok(!DETAIL.includes('rawText'), 'Detail renders raw extracted text');
  assert.ok(!DETAIL.includes('PACKAGE_FIELD_LABEL'), 'Detail composes its own field labels');
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
  // Each code disclosure beneath the table is structurally tied to exactly
  // one row: it renders that row's own `row.codes` under a key derived from
  // that row's stable id — no path exists to another version's codes.
  assert.match(DETAIL, /row\.codes/);
  assert.match(DETAIL, /codes-\$\{row\.id\}/);
  assert.match(DETAIL, /row-\$\{row\.id\}/);
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
  assert.match(DETAIL, /model\.lead/);
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
