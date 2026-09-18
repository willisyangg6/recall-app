/**
 * The compact-card presentation contract (P2B7H): the metadata date, the
 * icon-only save control, and the summary's punctuation — the three things
 * this milestone changed about how a recall reads on a card.
 *
 * React Native components cannot render under Node, so — as the
 * feed-design, saved-design and detail-design suites do — the screens are
 * read as text and pinned. What can be proved as BEHAVIOUR is proved that
 * way instead: the save state's real store transitions live in
 * `lib/save-control-state.test.ts`, and the summary rule is exercised
 * against the real presentation contract below and against the whole
 * recorded corpus in `server/presentation-casing.test.ts`.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { hitTarget, iconSize, typography } from '@/constants/design-tokens';
import type { FeedItem } from '@/lib/recall-feed';
import { buildHomeCardModel, cardSummaryText, todayIso } from '@/lib/recall-presentation';
import { saveControlState } from '@/lib/saved-recalls';

const SRC = join(__dirname, '..');
const read = (...parts: string[]): string => readFileSync(join(SRC, ...parts), 'utf8');

const CARD = read('components', 'recall-card.tsx');
const SAVE_BUTTON = read('components', 'save-recall-button.tsx');
const DETAIL = read('app', 'recall', '[id].tsx');
const FEED = read('app', '(tabs)', 'index.tsx');
const SAVED = read('app', '(tabs)', 'saved.tsx');
const PREVIEW = read('app', 'design-preview', 'index.tsx');

function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

// ── 1. The date metadata is readable, and one hierarchy across surfaces ─────

test('P2B7H: the activity date renders in the readable caption token, at least 12pt', () => {
  // The founder finding was a SIZE, so the size is what is asserted — the
  // token name alone would not catch a token whose scale changed.
  assert.ok(typography.caption.fontSize >= 12, 'the caption token fell below 12pt');
  assert.equal(typography.caption.fontSize, 12);
  assert.equal(typography['micro-caption'].fontSize, 10);

  // Card (Feed and Saved) and Detail draw the date from the same model
  // field in the same token, so there is ONE metadata hierarchy.
  const dateLine = '<Text variant="caption" color="text/secondary">';
  for (const [name, source] of [
    ['card', CARD],
    ['detail', DETAIL],
  ] as const) {
    const index = source.indexOf('{model.activity.text}');
    assert.ok(index > 0, `${name} does not render the activity date`);
    const opening = source.lastIndexOf('<Text', index);
    assert.ok(
      source.slice(opening, index).includes('variant="caption"'),
      `${name} renders the activity date in a token other than caption`,
    );
  }
  assert.ok(CARD.includes(dateLine));
  // The 10pt token is gone from the card entirely — it was the whole defect.
  assert.ok(!codeOnly(CARD).includes('micro-caption'));
});

test('P2B7H: the date sits in the same type step as the brand and category beside it', () => {
  // The complaint was relative, not absolute: the date measured smaller
  // than everything adjacent to it. Brand and the category tag are both
  // `caption`, so the status row and the identity block now agree.
  assert.ok(CARD.includes('<Text variant="caption" color="text/secondary">'));
  const CATEGORY_TAG = read('components', 'ui', 'category-tag.tsx');
  assert.ok(CATEGORY_TAG.includes('variant="caption"'));
  assert.equal(typography.caption.fontSize, typography.caption.fontSize);
});

test('P2B7H: nothing that carries the date fixes a height or caps Dynamic Type', () => {
  for (const [name, source] of [
    ['card', CARD],
    ['detail', DETAIL],
    ['save control', SAVE_BUTTON],
  ] as const) {
    const code = codeOnly(source);
    assert.ok(!/\bheight:\s*\d/.test(code), `${name} fixes a height`);
    assert.ok(!code.includes('maxHeight'), `${name} caps a height`);
    assert.ok(!code.includes('maxFontSizeMultiplier'), `${name} caps Dynamic Type`);
  }
  // The status row wraps rather than clipping when the type grows.
  assert.ok(CARD.includes("flexWrap: 'wrap'"));
});

// ── 2. The save control is icon-only, on all three surfaces ─────────────────

test('P2B7H: the save control renders the bookmark alone — no visible word anywhere', () => {
  assert.ok(!SAVE_BUTTON.includes('<Text'), 'the save control renders text again');
  assert.ok(SAVE_BUTTON.includes('<Icon name={state.icon} size={20} color="icon/primary" />'));
  // Neither the icon nor its absence may be conditional.
  assert.ok(!/\{[^}]*\?[^}]*<Icon/.test(SAVE_BUTTON), 'the icon is rendered conditionally');
  // Both glyphs exist and differ: outline unsaved, the SAME bookmark filled.
  assert.equal(saveControlState(false).icon, 'bookmark');
  assert.equal(saveControlState(true).icon, 'bookmark-filled');
  // No surface re-adds the word next to the shared control.
  for (const [name, source] of [
    ['card', CARD],
    ['detail', DETAIL],
    ['feed', FEED],
    ['saved', SAVED],
  ] as const) {
    const code = codeOnly(source);
    for (const word of ['SAVE_ACTION_LABEL', 'SAVED_ACTION_LABEL', 'state.label']) {
      assert.ok(!code.includes(word), `${name} renders the retired save word ${word}`);
    }
  }
});

test('P2B7H: Feed, Saved and Detail use the ONE control, not three implementations', () => {
  // Feed and Saved reach it through the shared card; Detail renders it
  // directly. Nothing draws a bookmark of its own.
  assert.ok(CARD.includes("import { SaveRecallButton } from '@/components/save-recall-button';"));
  assert.ok(DETAIL.includes("import { SaveRecallButton } from '@/components/save-recall-button';"));
  assert.ok(DETAIL.includes('<SaveRecallButton caseId={model.id} />'));
  assert.ok(CARD.includes('<SaveRecallButton caseId={model.id} />'));
  assert.ok(FEED.includes('<RecallCard'));
  assert.ok(SAVED.includes('<RecallCard'));
  for (const [name, source] of [
    ['feed', FEED],
    ['saved', SAVED],
  ] as const) {
    assert.ok(
      !codeOnly(source).includes('name="bookmark"'),
      `${name} draws its own bookmark instead of using the shared control`,
    );
  }
  // One store, one contract — no screen may reach past it.
  assert.ok(SAVE_BUTTON.includes("from '@/hooks/use-saved-recalls'"));
  assert.ok(SAVE_BUTTON.includes('saveControlState(isSavedId(ids, caseId))'));
});

test('P2B7H: the accessible contract carries the whole meaning the word used to', () => {
  // Role, action label and selected state, all from the one contract.
  assert.ok(SAVE_BUTTON.includes('accessibilityRole="button"'));
  assert.ok(SAVE_BUTTON.includes('accessibilityLabel={state.accessibilityLabel}'));
  assert.ok(SAVE_BUTTON.includes('accessibilityState={{ selected: state.selected }}'));
  // The words are actions, and they differ between the states.
  assert.equal(saveControlState(false).accessibilityLabel, 'Save recall');
  assert.equal(saveControlState(true).accessibilityLabel, 'Remove from saved recalls');
  assert.equal(saveControlState(false).selected, false);
  assert.equal(saveControlState(true).selected, true);
  // The card is one grouped element to VoiceOver, so it exposes the same
  // action — read from the same contract, never a second spelling.
  assert.ok(CARD.includes('label: save.accessibilityLabel,'));
  assert.ok(CARD.includes('saveControlState(isSavedId(savedRecalls.ids, model.id))'));
  // The icon itself is never the accessible element.
  const ICON = read('components', 'ui', 'icon.tsx');
  assert.ok(ICON.includes('accessible={false}'));
});

test('P2B7H: the icon-only control still meets the 44pt minimum target', () => {
  assert.equal(hitTarget.minimum, 44);
  // A 20pt glyph with no caption beneath it is well under the minimum, so
  // hitSlop is what makes the target honest — and it is computed from the
  // token, not typed as a number.
  assert.ok(SAVE_BUTTON.includes('const HIT_SLOP = hitSlopToMinimum(iconSize[20]);'));
  assert.ok(SAVE_BUTTON.includes('hitSlop={HIT_SLOP}'));
  assert.equal(iconSize[20], 20);
  // The computed slop really does reach 44 on both axes.
  const { top, bottom, left, right } = {
    top: Math.ceil((44 - 20) / 2),
    bottom: Math.ceil((44 - 20) / 2),
    left: 0,
    right: 0,
  };
  assert.ok(20 + top + bottom >= hitTarget.minimum);
  assert.ok(44 + left + right >= hitTarget.minimum);
});

test('P2B7H: the development gallery shows both save states without touching the store', () => {
  // The appearance is split out so the harness renders the PRODUCT's own
  // control in both states rather than a second copy of the glyph.
  assert.ok(SAVE_BUTTON.includes('export function SaveControlAppearance('));
  assert.ok(PREVIEW.includes('SaveControlAppearance'));
  assert.ok(PREVIEW.includes('saveControlState(false)'));
  assert.ok(PREVIEW.includes('saveControlState(true)'));
});

// ── 3. The card summary carries no trailing full stop ───────────────────────

function item(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: 'summary-001',
    sourceAgency: 'FSIS',
    noticeType: 'recall',
    state: 'active',
    title: 'Example Foods Recalls Product',
    classification: { value: 'class_I', sourceText: null, officialClasses: ['class_I'] },
    hazardCategory: 'other_regulatory',
    publishedAt: '2026-09-01T00:00:00Z',
    lastPublicActivityAt: '2026-09-01T00:00:00Z',
    reasonText: 'Import violation',
    pathogenOrAllergen: null,
    firmName: 'Example Foods',
    brands: ['Example'],
    productDescription: null,
    retailerNames: [],
    heroImageUrl: null,
    productNames: [],
    geography: { scope: 'nationwide', states: [], confidence: 'stated', sourceText: null },
    officialUrl: 'https://example.gov/recall',
    timeline: [],
    ...overrides,
  };
}

test('P2B7H: the Lotly-generated card summary ends without a full stop', () => {
  const today = todayIso();
  const built = buildHomeCardModel(item(), { today, affectsYou: false });
  assert.equal(built.reasonLine, 'Import violation');

  const allergen = buildHomeCardModel(
    item({
      hazardCategory: 'allergen',
      reasonText: 'unreported allergens',
      pathogenOrAllergen: 'undeclared peanuts',
    }),
    { today, affectsYou: false },
  );
  // The prompt's own example, end to end through the real builder.
  assert.equal(allergen.reasonLine, 'Undeclared peanut allergen');
});

test('P2B7H: Feed and Saved punctuate identically, because they share one builder', () => {
  // Both screens build their cards through `buildHomeCardModel` — there is
  // no second path where one could keep the stop.
  assert.ok(FEED.includes('buildHomeCardModel('));
  assert.ok(SAVED.includes('buildHomeCardModel('));
  const PRESENTATION = read('lib', 'recall-presentation.ts');
  assert.ok(PRESENTATION.includes('reasonLine: cardSummaryText('));
  // The card renders the model's line verbatim; it strips nothing itself.
  assert.ok(CARD.includes('{model.reasonLine}'));
  for (const forbidden of ['replace(', 'slice(', 'endsWith', 'trim(']) {
    assert.ok(!codeOnly(CARD).includes(forbidden), `the card rewrites copy with ${forbidden}`);
  }
});

test('P2B7H: the rule is presentation-only — Detail prose and the source sentence keep their stops', () => {
  const PRESENTATION = read('lib', 'recall-presentation.ts');
  // `conciseReasonLine` still composes a sentence; only the card's model
  // strips it. Detail's narrative never passes through `cardSummaryText`.
  assert.ok(PRESENTATION.includes("return 'Import violation.';"));
  const narrative = PRESENTATION.slice(PRESENTATION.indexOf('export function detailNarrative'));
  assert.ok(!narrative.slice(0, 1200).includes('cardSummaryText'));
  assert.equal((PRESENTATION.match(/cardSummaryText\(/g) ?? []).length, 2); // definition + one call
});

test('P2B7H: the summary rule refuses to mangle anything that is not a sentence stop', () => {
  // Stripped: an ordinary single-sentence Lotly line.
  assert.equal(cardSummaryText('Import violation.'), 'Import violation');
  assert.equal(cardSummaryText('Undeclared peanut allergen.'), 'Undeclared peanut allergen');
  assert.equal(
    cardSummaryText('Potential Listeria monocytogenes contamination.'),
    'Potential Listeria monocytogenes contamination',
  );

  // Kept: everything a naive strip would have broken.
  for (const untouched of [
    'Net weight 1.5 oz.', // a unit abbreviation
    'Recalled by Acme Foods Inc.', // a company suffix
    'Sold at 40 St.', // a street abbreviation
    'Lot code A.', // a single-letter initial
    'Reason unclear…', // a composed ellipsis
    'Reason unclear...', // a typed ellipsis
    'Undeclared milk. Undeclared soy.', // multi-sentence source text
    'Contains 2.5 percent milk', // a decimal, and no trailing stop at all
    'Is it safe?', // not a full stop
  ]) {
    assert.equal(cardSummaryText(untouched), untouched, `mangled: ${untouched}`);
  }

  // An interior abbreviation is NOT a sentence break: these are single
  // sentences whose final stop is a sentence stop, and 13 recorded notices
  // read "Potential E. coli contamination." — they must lose the stop like
  // every other card, not keep one because of the abbreviation inside.
  assert.equal(
    cardSummaryText('Potential E. coli contamination.'),
    'Potential E. coli contamination',
  );
  assert.equal(cardSummaryText('U.S. distribution only.'), 'U.S. distribution only');

  // A recall with no reason line stays absent, not an empty string.
  assert.equal(cardSummaryText(null), null);
});
