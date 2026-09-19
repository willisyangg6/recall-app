/**
 * The Category Tag's RENDERING (P2B7D), pinned at the source level — React
 * Native components cannot render under Node, so this reads the tag, the
 * card, the two screens and the harness as text, exactly as the other
 * `*-design` suites do.
 *
 * What the milestone promised visually, and what these tests hold to:
 *
 *   · it is quiet product metadata, not a fourth status — so it borrows no
 *     risk or relevance palette, no warning treatment, no icon and no
 *     uppercase mono;
 *   · it is not a control — no press handler, no button role, no chip shape;
 *   · it is written ONCE, in the shared card, so Feed and Saved cannot drift;
 *   · an absent category leaves no container, no spacer and nothing spoken;
 *   · Recall Detail is untouched.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { foodCategoryLabel } from '@/domain/food-category';
import { LAUNCH_CATEGORY_IDS } from '@/domain/food-category-launch';
import { radius, spacing } from '@/constants/design-tokens';

const SRC = join(__dirname, '..');
const read = (...parts: string[]): string => readFileSync(join(SRC, ...parts), 'utf8');

const TAG = read('components', 'ui', 'category-tag.tsx');
const CARD = read('components', 'recall-card.tsx');
const FEED = read('app', '(tabs)', 'index.tsx');
const SAVED = read('app', '(tabs)', 'saved.tsx');
const DETAIL = read('app', 'recall', '[id].tsx');
const PREVIEW = read('app', 'design-preview', 'index.tsx');
const CHIP = read('components', 'ui', 'chip.tsx');

/** Source with comments removed, so a file may document what it does not do. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

// ── 1. One implementation, on the shared card path ──────────────────────────

test('the tag is written once, in the shared card, so Feed and Saved cannot disagree', () => {
  // Exactly one call site in the whole app, and it is the card both screens
  // render. Neither screen composes a tag of its own.
  assert.equal((CARD.match(/<CategoryTag\b/g) ?? []).length, 1);
  assert.ok(CARD.includes("import { CategoryTag } from '@/components/ui/category-tag';"));
  for (const [name, source] of [
    ['feed', FEED],
    ['saved', SAVED],
  ] as const) {
    for (const forbidden of ['CategoryTag', 'category-tag', 'foodCategoryLabel']) {
      assert.ok(!codeOnly(source).includes(forbidden), `${name} renders its own category`);
    }
  }
  // Saved touches the category vocabulary at all — it has no filter row, so
  // its cards' tags can only have come from the shared card.
  assert.ok(!codeOnly(SAVED).includes('food-category'));
  // The Feed's ONLY category imports are the filter's (C10B, untouched): the
  // id type and the launch allowlist's sheet options and sanitizer. It reads
  // no label and renders no tag.
  const feedCategoryImports = [...codeOnly(FEED).matchAll(/^import .*food-category.*$/gm)].map(
    (m) => m[0],
  );
  assert.deepEqual(feedCategoryImports, [
    "import type { FoodCategoryId } from '@/domain/food-category';",
    "import { LAUNCH_CATEGORY_OPTIONS, sanitizeLaunchCategoryIds } from '@/domain/food-category-launch';",
  ]);
  // Both screens reach the card through the same builder with the same
  // arguments, so the same recall carries the same word on both. Since
  // P2B7N.1 the two call sites are BYTE-IDENTICAL — there is no longer a
  // per-screen argument for one of them to get wrong.
  const CALL = '<RecallCard model={buildHomeCardModel(item, { today, prefs })} />';
  assert.ok(SAVED.includes(CALL));
  assert.ok(FEED.includes(CALL));
  assert.ok(FEED.includes("import { RecallCard } from '@/components/recall-card';"));
  assert.ok(SAVED.includes("import { RecallCard } from '@/components/recall-card';"));
  // The card reads the model's finished word and maps no id to a label.
  assert.ok(CARD.includes('label={model.categoryLabel}'));
  assert.ok(!codeOnly(CARD).includes('foodCategoryLabel'));
  assert.ok(!codeOnly(TAG).includes('foodCategoryLabel'), 'the tag spells a label of its own');
  assert.ok(!codeOnly(TAG).includes('FoodCategoryId'), 'the tag can be handed an id');
});

// ── 2. Absence leaves nothing behind ────────────────────────────────────────

test('a recall with no displayable category renders no container, spacer or spoken element', () => {
  // A conditional ELEMENT, not a conditional style: null renders nothing,
  // and React Native's `gap` does not space an unrendered child, so the card
  // closes up exactly as it did before P2B7D.
  assert.ok(
    CARD.includes('{model.categoryLabel ? <CategoryTag label={model.categoryLabel} /> : null}'),
  );
  // No reserved height anywhere on the path — the identity column and the
  // tag are both sized by their content.
  assert.deepEqual(codeOnly(TAG).match(/\b(height|minHeight|width|minWidth):/g) ?? [], []);
  // The tag renders no empty/placeholder state of its own, and cannot be
  // asked to: its only prop is a required string.
  assert.ok(TAG.includes('export function CategoryTag({ label }: { label: string })'));
  assert.ok(!codeOnly(TAG).includes('label?:'));
  assert.ok(!codeOnly(TAG).includes('?? '), 'the tag substitutes a fallback word');
  for (const forbidden of ['Other', 'Unknown', 'Uncategorized', 'Uncategorised', 'N/A']) {
    assert.ok(!codeOnly(TAG).includes(forbidden), `the tag can render "${forbidden}"`);
  }
});

// ── 3. Not a status: no risk, relevance, warning or icon ────────────────────

test('the tag borrows no risk or relevance treatment, and carries no glyph', () => {
  for (const forbidden of [
    'riskPalette',
    'relevancePalette',
    'ConsumerRiskTier',
    'risk-tier',
    'RiskLabel',
    'RelevanceLabel',
    'NoticeLabel',
    'Callout',
    'warning',
    'Icon',
    'iconSize',
  ]) {
    assert.ok(!codeOnly(TAG).includes(forbidden), `the category tag uses ${forbidden}`);
  }
  // It has NO fill of its own: the Surface default is the card's own surface,
  // so no colour can read as a severity and the mark survives greyscale.
  assert.ok(!codeOnly(TAG).includes('background='), 'the tag paints a fill');
  assert.ok(!codeOnly(TAG).includes('backgroundColor'), 'the tag paints a fill');
  assert.ok(TAG.includes('border="border/subtle"'));
  // Stronger than naming the two palettes: the file holds no hex literal at
  // all (pinned below), so no risk red and no relevance lime can be in it —
  // and `design-foundation.test.ts` separately proves `riskPalette` is read
  // by the Risk Label alone, which is why this file must not read it either.
  // It sits BELOW the identity, never in the status row beside the risk
  // badge: the card's status row is closed before the content row opens.
  const statusRow = CARD.slice(CARD.indexOf('styles.statusRow'), CARD.indexOf('styles.content'));
  assert.ok(!statusRow.includes('CategoryTag'), 'the tag moved into the status row');
  const identity = CARD.slice(CARD.indexOf('styles.identity'), CARD.indexOf('styles.footerRow'));
  assert.ok(identity.includes('<CategoryTag'), 'the tag left the identity column');
  // …and not in the footer either, where the save control's tap target lives.
  const footer = CARD.slice(CARD.indexOf('styles.footerRow'));
  assert.ok(!footer.includes('<CategoryTag'));
});

test('the tag is not a control: no press, no button role, no chip shape', () => {
  for (const forbidden of [
    'onPress',
    'Pressable',
    'TouchableOpacity',
    'accessibilityRole="button"',
    'accessibilityRole="link"',
    'accessibilityState',
    'accessibilityActions',
    'hitSlop',
    'expo-router',
    'Link',
    'useState',
  ]) {
    assert.ok(!codeOnly(TAG).includes(forbidden), `the category tag is interactive: ${forbidden}`);
  }
  // Static text, explicitly.
  assert.ok(TAG.includes('accessibilityRole="text"'));
  // `radius/full` is the Navigation Chip's pill shape — a filter a shopper
  // could try to tap. The tag takes the compact-label radius instead.
  assert.ok(TAG.includes('radius={4}'));
  assert.ok(!codeOnly(TAG).includes('radius="full"'));
  assert.ok(CHIP.includes('radius="full"'), 'the interactive chip is no longer the pill');
  assert.equal(radius[4], 4);
  // Nothing animates: a metadata mark that moves reads as a control.
  for (const forbidden of [
    'Animated',
    'withTiming',
    'withSpring',
    'LayoutAnimation',
    'reanimated',
  ]) {
    assert.ok(!TAG.includes(forbidden), `the tag animates via ${forbidden}`);
  }
});

// ── 4. Tokens, type and casing ──────────────────────────────────────────────

test('the tag spells no value of its own and never shouts', () => {
  for (const forbidden of [
    'fontSize:',
    'fontWeight:',
    'fontFamily:',
    'lineHeight:',
    'letterSpacing:',
    '#',
    'ThemedText',
    'ThemedView',
    "from '@/constants/theme'",
    'Spacing.',
    'Radii.',
    'Colors.',
  ]) {
    assert.ok(!codeOnly(TAG).includes(forbidden), `the category tag hardcodes ${forbidden}`);
  }
  // Public Sans caption — not the uppercase IBM Plex Mono `label` type the
  // Risk and Notice labels share, which is what makes a badge read as one.
  assert.ok(TAG.includes('<Text variant="caption" color="text/secondary">'));
  assert.ok(!codeOnly(TAG).includes('variant="label'));
  assert.ok(!codeOnly(TAG).includes('variant="heading'));
  // The word is printed exactly as given: nothing cases, cuts or pads it.
  assert.ok(TAG.includes('{label}'));
  for (const forbidden of ['toUpperCase', 'toLowerCase', 'slice(', 'substring', 'padStart']) {
    assert.ok(!TAG.includes(forbidden), `the tag rewrites the label with ${forbidden}`);
  }
  // …and the card does not shout it on the tag's behalf.
  assert.ok(!CARD.includes('categoryLabel.toUpperCase'));
  // The real labels are sentence case, so "never all caps" is a property of
  // the data too, not only of the component.
  for (const id of LAUNCH_CATEGORY_IDS) {
    const label = foodCategoryLabel(id);
    assert.notEqual(label, label.toUpperCase(), `${id} is all caps in the vocabulary`);
  }
  // The compact-label padding, from the scale, and no fixed box around it.
  assert.ok(TAG.includes(`paddingHorizontal: spacing[8]`));
  assert.ok(TAG.includes(`paddingVertical: spacing[4]`));
  assert.equal(spacing[8], 8);
  assert.equal(spacing[4], 4);
  assert.ok(TAG.includes("alignSelf: 'flex-start'"), 'the tag stretches to the column width');
});

test('Dynamic Type is honoured, and long labels wrap instead of clipping', () => {
  for (const forbidden of [
    'numberOfLines',
    'ellipsizeMode',
    'adjustsFontSizeToFit',
    'maxFontSizeMultiplier',
    'allowFontScaling',
  ]) {
    assert.ok(!TAG.includes(forbidden), `the tag caps or clips text with ${forbidden}`);
  }
  // The card caps nothing around the tag either (P2B1's promise, re-scoped
  // by P2B7G: the product-name Text now carries the card's ONE deliberate
  // three-line clamp — feed-design.test.ts owns that contract — and no other
  // capping or clipping prop exists anywhere on the card).
  for (const forbidden of ['ellipsizeMode', 'maxFontSizeMultiplier']) {
    assert.ok(!CARD.includes(forbidden), `the card caps text with ${forbidden}`);
  }
  assert.equal((CARD.match(/numberOfLines=/g) ?? []).length, 1);
  assert.ok(/variant="heading-3" numberOfLines=\{3\}/.test(CARD));
  assert.deepEqual(codeOnly(CARD).match(/\bheight: [^,]+/g) ?? [], []);
});

// ── 5. Accessibility ────────────────────────────────────────────────────────

test('the tag speaks once, names what it is, and does not make the card repetitive', () => {
  assert.ok(TAG.includes('export function categoryAccessibilityLabel(label: string): string'));
  assert.ok(TAG.includes('return `Category: ${label}`;'));
  assert.ok(TAG.includes('accessibilityLabel={categoryAccessibilityLabel(label)}'));
  assert.ok(TAG.includes('accessible'));
  // One spoken element per card, because there is one tag per card, and the
  // word appears nowhere else on the card to be repeated.
  assert.equal(
    (codeOnly(CARD).match(/categoryLabel/g) ?? []).length,
    2,
    'the card reads the label somewhere other than the one conditional render',
  );
  // The card's own accessibility contract is unchanged: still one element,
  // still exactly the one custom save action.
  assert.equal((CARD.match(/accessibilityActions=/g) ?? []).length, 1);
  assert.ok(CARD.includes('accessibilityHint={CARD_ACCESSIBILITY_HINT}'));
  assert.ok(!codeOnly(TAG).includes('accessibilityHint'), 'a metadata mark hints at an action');
});

// ── 6. Detail and the harness ───────────────────────────────────────────────

test('Recall Detail renders no category, and the harness compares the treatments it rejected', () => {
  for (const forbidden of ['CategoryTag', 'categoryLabel', 'category-tag']) {
    assert.ok(!DETAIL.includes(forbidden), `Recall Detail references ${forbidden}`);
  }
  // The development harness keeps the comparison that chose this treatment,
  // over real recalls, and names which one shipped.
  assert.ok(PREVIEW.includes('CATEGORY TAG TREATMENTS'));
  assert.ok(PREVIEW.includes('B · subtle neutral tag under the brand — SHIPPED'));
  assert.ok(PREVIEW.includes('A · inline metadata on the brand line'));
  assert.ok(PREVIEW.includes('C · filled neutral tag in the status row'));
  // The two rejected treatments exist ONLY in the dev-only harness, which
  // Metro strips from a release build — the product ships one treatment.
  assert.ok(PREVIEW.includes('if (!isDevelopmentBuild())'));
  assert.ok(!codeOnly(CARD).includes('treatment'));
  assert.ok(!codeOnly(TAG).includes('variant:'), 'the shipped tag carries a treatment switch');
});
