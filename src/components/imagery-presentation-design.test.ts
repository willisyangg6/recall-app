/**
 * P2B7I — no-image card layout and complete carousel indicators, pinned at
 * the source level.
 *
 * React Native components cannot render under Node, so — as the feed-design,
 * detail-design and wiring suites do — these tests read the card, the tile,
 * the pager, the screens and the harness as text and pin what the milestone
 * promises. The pure halves (the failure memory and the page view) are
 * exercised directly.
 *
 * What P2B7I settles (founder direction):
 *
 *   - a Feed or Saved card with no usable image has NO media column — the
 *     text takes the card's width; never a grey square, never a stand-in;
 *   - a hero that fails to load settles into that same layout, once, and is
 *     not re-requested as the list recycles;
 *   - Detail's pager has NO presentation cap: every usable official photo
 *     is swipeable, so a 74-photo notice pages `1 / 74` to `74 / 74`. What
 *     is bounded is the INDICATOR — a sliding window of at most
 *     `IMAGE_DOTS_WINDOW` dots — and it bounds no pages;
 *   - the compact counter is ADDED beside that window, never instead of it;
 *   - a failed page leaves the set, every healthy image after it stays
 *     reachable, the index stays valid, and every page failing is the
 *     no-image header;
 *   - the wording is honest: the counter's denominator is always reachable,
 *     and a shortfall against the published total is one separate
 *     sentence, spoken once.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { layout } from '@/constants/design-tokens';
import { DESIGN_PREVIEW_SCENARIOS } from '@/lib/design-preview';
import { hasImageFailed, recordImageFailure } from '@/lib/image-failures';
import {
  detailImageSet,
  imageCounterText,
  imageDotWindow,
  imagePageView,
  imagePositionLabel,
  imageUnavailableLabel,
  IMAGE_DOTS_WINDOW,
} from '@/lib/recall-presentation';
import type { RecallImage } from '@/lib/recall-images';

const SRC = join(__dirname, '..');
const read = (...parts: string[]): string => readFileSync(join(SRC, ...parts), 'utf8');

const CARD = read('components', 'recall-card.tsx');
const MEDIA_TILE = read('components', 'ui', 'media-tile.tsx');
const IMAGE_SET = read('components', 'ui', 'official-image-set.tsx');
const FAILURES = read('lib', 'image-failures.ts');
const FEED = read('app', '(tabs)', 'index.tsx');
const SAVED = read('app', '(tabs)', 'saved.tsx');
const DETAIL = read('app', 'recall', '[id].tsx');
const PREVIEW = read('app', 'design-preview', 'index.tsx');
const PRESENTATION = read('lib', 'recall-presentation.ts');

/** Source with comments removed, so a file may document what it does not do. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

const CARD_CODE = codeOnly(CARD);
const MEDIA_TILE_CODE = codeOnly(MEDIA_TILE);
const IMAGE_SET_CODE = codeOnly(IMAGE_SET);

function official(url: string): RecallImage {
  return {
    url,
    source: 'fda_announcement',
    caption: null,
    classification: null,
    width: null,
    height: null,
    aspectRatio: 1,
  };
}

const urls = (count: number) =>
  Array.from({ length: count }, (_, index) => `https://www.fda.gov/files/p2b7i-${index + 1}.jpg`);
const setOf = (count: number) => detailImageSet(urls(count).map(official), 'Widget')!;
const NONE: ReadonlySet<string> = new Set();

// ── 1. The card without imagery ─────────────────────────────────────────────

test('P2B7I: an absent image renders no media column — no footprint, no placeholder, no gap', () => {
  // The tile is an image or it is nothing: the ONE early return covers the
  // absent and the failed states, and no branch draws a bare square.
  assert.ok(
    MEDIA_TILE.includes(
      'if (uri === null || failedUri === uri || hasImageFailed(uri)) return null;',
    ),
  );
  assert.equal((MEDIA_TILE_CODE.match(/return null/g) ?? []).length, 1);
  // The Surface exists only to hold an Image: exactly one, unconditional
  // inside it, with the square footprint sized by the caller's token.
  assert.equal((MEDIA_TILE_CODE.match(/<Image\b/g) ?? []).length, 1);
  assert.ok(!MEDIA_TILE_CODE.includes('image !== null ?'), 'a placeholder branch survives');
  assert.ok(MEDIA_TILE.includes('{ width: size, height: size }'));
  // The card hands every state to the tile and holds no media rule, no
  // placeholder and no reserved width of its own; its content row is a
  // gapped flex row and its text column fills whatever is left.
  assert.match(
    CARD,
    /<MediaTile\s+uri=\{model\.heroImageUrl\}\s+alt=\{model\.productName\}\s+size=\{layout\.cardMediaSize\}\s*\/>/,
  );
  assert.ok(!/heroImageUrl \?/.test(CARD_CODE), 'the card decides the media itself');
  assert.ok(!CARD.includes('media-placeholder'));
  assert.ok(!CARD_CODE.includes('cardMediaSize }'), 'the card reserves the media width');
  assert.match(
    CARD,
    /content: \{\s*flexDirection: 'row',\s*alignItems: 'flex-start',\s*gap: spacing\[12\],\s*\}/,
  );
  assert.match(CARD, /identity: \{\s*flex: 1,\s*minWidth: 0,/);
  // Everything around the content row is untouched: the status row, the
  // three-line title clamp, the footer with the location and the save control.
  assert.ok(CARD.includes('<Text variant="heading-3" numberOfLines={3}>'));
  assert.ok(CARD.includes('<View style={styles.statusRow}>'));
  assert.ok(CARD.includes('<View style={styles.footerRow}>'));
  assert.ok(CARD.includes('<SaveRecallButton caseId={model.id} />'));
  assert.equal(layout.cardMediaSize, 112);
});

test('P2B7I: no stock photo, mascot, illustration, or pressable stand-in replaces a missing image', () => {
  for (const forbidden of [
    'require(',
    'mascot',
    'Mascot',
    'placeholder.png',
    'unavailable',
    'Unavailable',
    'No image',
    'Pressable',
    'onPress',
    'ImageBackground',
    'Icon',
  ]) {
    assert.ok(!MEDIA_TILE_CODE.includes(forbidden), `the tile substitutes: ${forbidden}`);
  }
  assert.ok(!CARD_CODE.includes('image-unavailable'));
  assert.equal(
    (CARD_CODE.match(/source=\{/g) ?? []).length,
    0,
    'the card renders an image of its own',
  );
});

test('P2B7I: Feed and Saved share the one card, and neither lists a media rule of its own', () => {
  assert.ok(FEED.includes('<RecallCard'));
  assert.ok(SAVED.includes('<RecallCard'));
  for (const screen of [FEED, SAVED]) {
    assert.ok(!screen.includes('MediaTile'));
    assert.ok(!screen.includes('media-placeholder'));
    assert.ok(!screen.includes('heroImageUrl ?'));
    assert.ok(!screen.includes('OfficialImageSet'));
  }
  // Detail's approved no-image header is unchanged: null renders nothing.
  assert.match(
    DETAIL,
    /\{model\.productImages \? <OfficialImageSet set=\{model\.productImages\} \/> : null\}/,
  );
});

// ── 2. Failure: settle once, remember, never loop ───────────────────────────

test('P2B7I: a failed hero settles into the no-image layout and is remembered for the session', () => {
  // The platform's failure event records the verdict, re-renders THIS mount
  // into its absent shape, and tells a counting caller — in that order.
  assert.match(
    MEDIA_TILE,
    /onError=\{\(\) => \{\s*recordImageFailure\(uri\);\s*setFailedUri\(uri\);\s*onLoadFailed\?\.\(uri\);\s*\}\}/,
  );
  // Every later mount of the same URL reads the memory before rendering.
  assert.ok(MEDIA_TILE.includes("from '@/lib/image-failures'"));
  assert.ok(MEDIA_TILE.includes('hasImageFailed(uri)'));
  // The memory is a leaf: no imports, session-scoped, never persisted.
  assert.ok(!FAILURES.includes('import '));
  for (const persisted of ['AsyncStorage', 'SecureStore', 'FileSystem', 'localStorage', 'fetch(']) {
    assert.ok(!FAILURES.includes(persisted), `the failure memory persists: ${persisted}`);
  }
  // Behaviour: unknown until recorded, then known, idempotently.
  const url = 'https://www.fda.gov/files/p2b7i-failure-probe.jpg';
  assert.equal(hasImageFailed(url), false);
  recordImageFailure(url);
  assert.equal(hasImageFailed(url), true);
  recordImageFailure(url);
  assert.equal(hasImageFailed(url), true);
  assert.equal(hasImageFailed(`${url}?other`), false, 'the memory is keyed by exact URL');
});

test('P2B7I: nothing retries, remounts, or times a failed image', () => {
  for (const loop of [
    'setTimeout',
    'setInterval',
    'retry',
    'Retry',
    'attempt',
    'key={',
    'onLoadStart',
    'onLoadEnd',
    'useEffect',
    'ActivityIndicator',
  ]) {
    assert.ok(!MEDIA_TILE_CODE.includes(loop), `the tile retries or remounts: ${loop}`);
  }
  // The pager seeds its failure state from the memory, so a page that failed
  // before is out before the first render — not requested again, and not a
  // blank page first.
  assert.match(
    IMAGE_SET,
    /useState<ReadonlySet<string>>\(\s*\(\) =>\s*new Set\(set\.images\.filter\(\(image\) => hasImageFailed\(image\.url\)\)\.map\(\(image\) => image\.url\)\),\s*\);/,
  );
  // One failure report per URL: a repeat report cannot churn state.
  assert.ok(
    IMAGE_SET.includes('setFailed((prior) => (prior.has(url) ? prior : new Set(prior).add(url)));'),
  );
});

// ── 3. The indicator matrix ─────────────────────────────────────────────────

test('P2B7I: 0 / 1 / 2 / 6 / 7 / 74 official images — nothing, static, dots, then dots + counter, and every page reachable', () => {
  assert.equal(IMAGE_DOTS_WINDOW, 5);
  assert.equal(
    detailImageSet([], 'Widget'),
    null,
    '0 images is no set: no media, no dots, no counter',
  );
  // `pages` is ALWAYS the official count — the corrected contract drops
  // nothing for presentation — and only the dot COUNT is bounded.
  const expected = {
    1: { indicator: 'none', dots: 1 },
    2: { indicator: 'dots', dots: 2 },
    5: { indicator: 'dots', dots: 5 },
    6: { indicator: 'dots-and-counter', dots: 5 },
    7: { indicator: 'dots-and-counter', dots: 5 },
    74: { indicator: 'dots-and-counter', dots: 5 },
  } as const;
  for (const [count, shape] of Object.entries(expected)) {
    const total = Number(count);
    const view = imagePageView(setOf(total), NONE);
    assert.equal(view.pages.length, total, `${count} official: a page was dropped`);
    assert.equal(view.usableCount, total, `${count} official`);
    assert.equal(view.officialCount, total, `${count} official`);
    assert.equal(view.indicator, shape.indicator, `${count} official`);
    assert.equal(imageDotWindow(0, view.usableCount).length, shape.dots, `${count} official`);
  }
  // The pages the retired cap would have hidden are reachable, and the
  // counter reaches its own denominator.
  const many = imagePageView(setOf(74), NONE);
  assert.equal(many.pages[6].url, urls(74)[6], 'page 7 is unreachable');
  assert.equal(many.pages[73].url, urls(74)[73], 'page 74 is unreachable');
  assert.equal(imageCounterText(6, many.usableCount), '7 / 74');
  assert.equal(imageCounterText(73, many.usableCount), '74 / 74');
});

test('P2B7I: the dots and the counter coexist — the counter never replaces the dots', () => {
  // The dots are rendered from the sliding WINDOW, unconditionally, in a
  // paged set…
  assert.ok(IMAGE_SET.includes('{imageDotWindow(current, usableCount).map((page) => ('));
  assert.ok(IMAGE_SET.includes('style={[styles.dot, page === current && styles.dotCurrent]}'));
  // …and the counter is a SIBLING gated on the contract's verdict, not the
  // other arm of a ternary that would swap the dots away.
  assert.ok(IMAGE_SET.includes("{indicator === 'dots-and-counter' ? ("));
  assert.ok(!IMAGE_SET_CODE.includes('<= IMAGE_DOTS_MAX'));
  assert.ok(!IMAGE_SET_CODE.includes('IMAGE_DOTS_MAX'));
  assert.ok(!PRESENTATION.includes('IMAGE_DOTS_MAX'));
  const dotsAt = IMAGE_SET_CODE.indexOf('{imageDotWindow(current, usableCount).map((page) => (');
  const counterAt = IMAGE_SET_CODE.indexOf("{indicator === 'dots-and-counter' ? (");
  assert.ok(dotsAt > 0 && counterAt > dotsAt, 'the counter is not beside the dots');
  // There is no indicator shape that has a counter and no dots, and every
  // large set keeps all of its pages while showing the bounded window.
  for (const count of [6, 7, 15, 51, 74, 87]) {
    const view = imagePageView(setOf(count), NONE);
    assert.equal(view.indicator, 'dots-and-counter', `${count}`);
    assert.equal(view.pages.length, count, `${count}: a page was dropped`);
    assert.equal(imageDotWindow(0, view.usableCount).length, IMAGE_DOTS_WINDOW, `${count}`);
  }
  // And no prose anywhere: the rejected sentence cannot return.
  for (const prose of ['Showing', 'official images', 'truncation']) {
    assert.ok(!IMAGE_SET_CODE.includes(prose), `prose returned: ${prose}`);
  }
});

test('P2B7I: the dot window follows the beginning, the middle and the end, and bounds no pages', () => {
  // The window the component draws, over a 74-page set: first pages at the
  // start, centred through the middle, last pages at the end — and the
  // active page always has a dot in it.
  assert.deepEqual(imageDotWindow(0, 74), [0, 1, 2, 3, 4]);
  assert.deepEqual(imageDotWindow(36, 74), [34, 35, 36, 37, 38]);
  assert.deepEqual(imageDotWindow(73, 74), [69, 70, 71, 72, 73]);
  // A set that fits gets one dot each, no window movement.
  assert.deepEqual(imageDotWindow(1, 3), [0, 1, 2]);
  // THE SEPARATION, stated directly: the number of dots is capped at five
  // while the number of accessible pages is not capped at all.
  for (const count of [6, 7, 15, 74, 87]) {
    const view = imagePageView(setOf(count), NONE);
    for (const current of [0, Math.floor(count / 2), count - 1]) {
      const window = imageDotWindow(current, view.usableCount);
      assert.equal(window.length, IMAGE_DOTS_WINDOW, `${count}/${current}`);
      assert.ok(window.includes(current), `${count}/${current}: the active page has no dot`);
    }
    assert.equal(view.pages.length, count, `${count}: the dot window bounded the pages`);
  }
});

test('P2B7I: the counter follows the page the shopper settled on', () => {
  // `current` is derived from the settled page, which the two scroll-end
  // events write; the counter reads `current`.
  assert.ok(IMAGE_SET.includes('onMomentumScrollEnd={onSettled}'));
  assert.ok(IMAGE_SET.includes('onScrollEndDrag={onSettled}'));
  assert.ok(IMAGE_SET.includes('if (image) setVisible({ url: image.url, at });'));
  assert.ok(IMAGE_SET.includes('{imageCounterText(current, usableCount)}'));
  assert.ok(IMAGE_SET.includes('page === current && styles.dotCurrent'));
  // It updates through the FINAL page, not just the first few.
  assert.equal(imageCounterText(0, 74), '1 / 74');
  assert.equal(imageCounterText(5, 74), '6 / 74');
  assert.equal(imageCounterText(6, 74), '7 / 74');
  assert.equal(imageCounterText(72, 74), '73 / 74');
  assert.equal(imageCounterText(73, 74), '74 / 74');
  // The denominator is the reachable count — never a total behind a cap.
  assert.ok(!IMAGE_SET_CODE.includes('imageCounterText(current, officialCount)'));
});

// ── 4. Accessibility ────────────────────────────────────────────────────────

test('P2B7I: the dots are hidden from assistive technology, and the counter speaks only when something failed', () => {
  // The dots' container carries both platforms' hiding props…
  assert.match(
    IMAGE_SET,
    /<View\s+style=\{styles\.dots\}\s+accessibilityElementsHidden\s+importantForAccessibility="no-hide-descendants">/,
  );
  // …and the counter sits OUTSIDE it, silent while every published photo is
  // reachable (each page already announces the same two numbers, so a
  // second element would duplicate them) and spoken — as a sentence, never
  // its slash — when a failure means fewer pages than were published.
  const hiddenClose = IMAGE_SET.indexOf('</View>', IMAGE_SET.indexOf('style={styles.dots}'));
  const counterAt = IMAGE_SET.indexOf('accessibilityLabel={unavailable ?? undefined}');
  assert.ok(hiddenClose > 0 && counterAt > hiddenClose, 'the counter is inside the hidden dots');
  assert.ok(IMAGE_SET.includes('accessible={unavailable !== null}'));
  assert.ok(
    IMAGE_SET.includes(
      "importantForAccessibility={unavailable === null ? 'no-hide-descendants' : 'auto'}",
    ),
  );
  assert.equal(imageUnavailableLabel(74, 74), null, 'a duplicate announcement with no failure');
  assert.equal(
    imageUnavailableLabel(72, 74),
    '72 of 74 official images can be shown; the rest could not be loaded',
  );
  // Nothing in the indicator is focusable or pressable.
  for (const control of ['onPress', 'accessibilityRole="button"', 'Pressable']) {
    assert.ok(!IMAGE_SET_CODE.includes(control));
  }
});

test('P2B7I: the spoken position counts reachable pages, and repeats no total', () => {
  assert.ok(IMAGE_SET.includes('positionLabel={imagePositionLabel(index, usableCount)}'));
  // Every counted page IS reachable now, so the position needs no
  // qualifier — and the last page announces itself as the last.
  assert.equal(imagePositionLabel(1, 74), 'Image 2 of 74');
  assert.equal(imagePositionLabel(73, 74), 'Image 74 of 74');
  assert.equal(imagePositionLabel(0, 2), 'Image 1 of 2');
  // With failures it counts the survivors, and says nothing about the
  // published total — that belongs to the counter, once.
  assert.equal(imagePositionLabel(1, 72), 'Image 2 of 72');
  for (const duplicated of ['published', 'could not be loaded', 'shown']) {
    assert.ok(
      !imagePositionLabel(1, 72).includes(duplicated),
      `the page repeats the shortfall: ${duplicated}`,
    );
  }
  // The tile speaks it as the image's VALUE after its factual label, and
  // announces nothing for a lone tile.
  assert.ok(
    MEDIA_TILE.includes(
      'accessibilityValue={positionLabel !== null ? { text: positionLabel } : undefined}',
    ),
  );
  assert.ok(MEDIA_TILE.includes('accessibilityLabel={alt}'));
  assert.ok(MEDIA_TILE.includes('accessibilityRole="image"'));
});

// ── 5. Failed pages ─────────────────────────────────────────────────────────

test('P2B7I: a failed page leaves the set, every healthy image after it stays reachable, and the index stays valid', () => {
  const seven = setOf(7);
  const view = imagePageView(seven, new Set([seven.images[3].url]));
  assert.equal(view.pages.length, 6, 'a healthy page was lost with the failed one');
  assert.ok(!view.pages.some((image) => image.url === seven.images[3].url));
  assert.deepEqual(
    view.pages.map((image) => image.url),
    [0, 1, 2, 4, 5, 6].map((index) => seven.images[index].url),
  );
  assert.equal(view.officialCount, 7);
  assert.equal(view.usableCount, 6);
  assert.equal(view.indicator, 'dots-and-counter');
  // An EARLY failure in a long set must not stop paging: the last official
  // photo is still reachable, which the retired six-page cap prevented.
  const many = setOf(74);
  const earlyFailed = imagePageView(many, new Set([many.images[1].url]));
  assert.equal(earlyFailed.pages.length, 73);
  assert.equal(earlyFailed.pages[72].url, many.images[73].url, 'the last photo is unreachable');
  assert.equal(imageCounterText(72, earlyFailed.usableCount), '73 / 73');
  assert.equal(
    imageUnavailableLabel(earlyFailed.usableCount, earlyFailed.officialCount),
    '73 of 74 official images can be shown; the rest could not be loaded',
  );
  // In a small complete set: two remain of three, still paged, and the
  // counter appears to say one of the three published is not shown.
  const three = setOf(3);
  const twoLeft = imagePageView(three, new Set([three.images[1].url]));
  assert.equal(twoLeft.pages.length, 2);
  assert.equal(twoLeft.indicator, 'dots-and-counter');
  assert.equal(imageCounterText(1, twoLeft.usableCount), '2 / 2');
  // The index correction: identity first, then the clamped settled position,
  // once, with no animation and no second programmatic scroll.
  assert.ok(IMAGE_SET.includes('pages.findIndex((image) => image.url === visible.url)'));
  assert.ok(IMAGE_SET.includes('Math.min(visible.at, pages.length - 1)'));
  assert.equal((IMAGE_SET_CODE.match(/scrollToOffset\(/g) ?? []).length, 1);
  assert.ok(IMAGE_SET.includes('animated: false'));
  assert.ok(!IMAGE_SET_CODE.includes('animated: true'));
  // A failed page never renders a blank: the tile is null once failed, and
  // the data the pager maps is already the filtered pages.
  assert.ok(IMAGE_SET.includes('data={pages}'));
  assert.ok(IMAGE_SET.includes('keyExtractor={(image) => image.url}'));
});

test('P2B7I: every page failing resolves to the no-image treatment', () => {
  const three = setOf(3);
  const all = imagePageView(three, new Set(three.images.map((image) => image.url)));
  assert.equal(all.pages.length, 0);
  assert.equal(all.indicator, 'none');
  assert.ok(IMAGE_SET.includes('if (pages.length === 0) return null;'));
  // Down to one: the static tile with no indicator, not a counter over a
  // lone image.
  const two = setOf(2);
  const oneLeft = imagePageView(two, new Set([two.images[1].url]));
  assert.equal(oneLeft.pages.length, 1);
  assert.equal(oneLeft.indicator, 'none');
  assert.ok(IMAGE_SET.includes('if (pages.length === 1) {'));
});

// ── 6. Roles and interaction preserved ──────────────────────────────────────

test('P2B7I: no auto-advance, no arrows, no press target, no new gallery, no cover or crop', () => {
  for (const forbidden of [
    'setInterval',
    'setTimeout',
    'requestAnimationFrame',
    'Animated',
    'autoPlay',
    'LayoutAnimation',
    'Pressable',
    'TouchableOpacity',
    'onPress',
    'chevron',
    'arrow',
    'cover',
  ]) {
    assert.ok(!IMAGE_SET_CODE.includes(forbidden), `the pager grew: ${forbidden}`);
    assert.ok(!MEDIA_TILE_CODE.includes(forbidden), `the tile grew: ${forbidden}`);
  }
  assert.ok(IMAGE_SET.includes('pagingEnabled'));
  assert.ok(IMAGE_SET.includes('horizontal'));
  assert.ok(MEDIA_TILE.includes('resizeMode="contain"'));
  // The pager is exactly the tile: it never grows to the identity column's
  // height, so the indicator sits directly beneath the image.
  assert.match(
    IMAGE_SET,
    /viewport: \{\s*width: layout\.detailMediaSize,\s*height: layout\.detailMediaSize,\s*flexGrow: 0,\s*\}/,
  );
  // Detail renders the one carousel, once; Feed stays single-image.
  assert.equal((DETAIL.match(/<OfficialImageSet\b/g) ?? []).length, 1);
  assert.equal((CARD.match(/<MediaTile\b/g) ?? []).length, 1);
  for (const paged of ['OfficialImageSet', 'productImages', 'pagingEnabled', 'positionLabel']) {
    assert.ok(!CARD.includes(paged), `feed imagery is no longer single-image: ${paged}`);
  }
});

test('P2B7I: no general gallery under Affected Products; row-matched thumbnails stay intact', () => {
  for (const gallery of [
    'labelPages',
    'officialLabels',
    'Official product labels',
    'images.gallery',
  ]) {
    assert.ok(!DETAIL.includes(gallery), `a gallery returned: ${gallery}`);
  }
  // The row thumbnail: rendered only when the allocator matched an image to
  // that exact row, through the same tile — which now renders nothing for a
  // failed row image instead of a grey square, with nothing reserved.
  assert.match(
    DETAIL,
    /\{row\.image \? \(\s*<MediaTile\s+uri=\{row\.image\.url\}\s+alt=\{row\.image\.accessibilityText\}\s+size=\{layout\.rowMediaSize\}\s*\/>\s*\) : null\}/,
  );
  assert.equal((DETAIL.match(/<MediaTile\b/g) ?? []).length, 1);
});

// ── 7. The harness ──────────────────────────────────────────────────────────

test('P2B7I: the Design Preview offers every card and carousel state the milestone names', () => {
  // Feed card cases: healthy image, no image, failed image, long title
  // without an image, and the no-image card at an accessibility size.
  for (const caption of [
    "'Does not affect you · image'",
    'Does not affect you · no image',
    'SIMULATED: the image fails to load',
    'Longest product name · no image',
    'No image at an accessibility text size',
  ]) {
    assert.ok(PREVIEW.includes(caption), `feed card case missing: ${caption}`);
  }
  assert.ok(PREVIEW.includes("heroImageUrl: unreachableImage('card')"));
  assert.ok(PREVIEW.includes('model: { ...longTitle, heroImageUrl: null }'));
  // Carousel samples: dots only, dots plus counter, the largest, a failed
  // middle page, every page failing — each simulated failure with its own
  // URL so the session memory cannot pre-settle a later sample.
  for (const caption of [
    'one dot per image, and ',
    'a sliding window of at ',
    'AND the compact counter beside it',
    'every one of them is a page',
    'SIMULATED: three candidates, the middle one unreachable.',
    'SIMULATED: every candidate unreachable.',
  ]) {
    assert.ok(PREVIEW.includes(caption), `carousel sample missing: ${caption}`);
  }
  assert.ok(PREVIEW.includes("unreachable('page'"));
  assert.ok(PREVIEW.includes("['all-1', 'all-2', 'all-3'].map"));
  assert.ok(!PREVIEW.includes('IMAGE_DOTS_MAX'));
  assert.ok(!PREVIEW.includes('IMAGE_PAGES_MAX'), 'the harness still names the retired cap');
  assert.ok(!PREVIEW.includes('the compact counter replaces the dots'));
  assert.ok(!PREVIEW.includes('pages at most'), 'the harness still promises a capped pager');
  // Detail scenarios: 0 (the no-image header), 1, 2, 6, 7, 15+, and the largest.
  const ids = DESIGN_PREVIEW_SCENARIOS.map((scenario) => scenario.id);
  for (const id of [
    'header_no_image',
    'images_one',
    'images_two',
    'images_six',
    'images_seven',
    'images_many',
    'images_largest',
  ]) {
    assert.ok(ids.includes(id as (typeof ids)[number]), `scenario missing: ${id}`);
  }
  const seven = DESIGN_PREVIEW_SCENARIOS.find((scenario) => scenario.id === 'images_seven')!;
  assert.equal(seven.requirement, 'images_seven');
  assert.equal(seven.simulation, null);
  assert.ok(seven.expectation.includes('AND the compact counter 1 / 7'));
  assert.ok(seven.expectation.includes('7 / 7'), 'the seventh page is not claimed reachable');
  const five = DESIGN_PREVIEW_SCENARIOS.find((scenario) => scenario.id === 'images_five')!;
  assert.ok(five.expectation.includes('No counter') || five.expectation.includes('no counter'));
  const largest = DESIGN_PREVIEW_SCENARIOS.find((scenario) => scenario.id === 'images_largest')!;
  assert.ok(largest.expectation.includes('all N ') || largest.expectation.includes('reachable'));
});
