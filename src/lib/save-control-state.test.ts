/**
 * The save control's rendered state, and the Detail location contract
 * (P2B7E) — the two regressions this milestone repairs, proved as BEHAVIOUR
 * rather than as source text.
 *
 * ## Why these tests are shaped this way
 *
 * React Native components cannot render under Node, so the milestone's
 * design suites read screens as text. That is a real blind spot: a
 * source-string assertion cannot tell "the bookmark is rendered in both
 * states" from "the bookmark is rendered in one state and the other state
 * silently drops it", and it cannot exercise a transition at all.
 *
 * So the smallest pure contract behind each control is extracted and driven
 * here through the SAME sequences a finger produces:
 *
 *   - `saveControlState` — everything the one save control renders, decided
 *     from one boolean. Transitions are driven through the real store
 *     (`createSavedRecallsCache`) and the real toggle (`toggleSavedId`), not
 *     by flipping the boolean by hand, so what is proved is the pipeline the
 *     screens actually run: tap → storage → publish → snapshot → rendered
 *     state.
 *
 *   - the location contract — `homeLocationSummary` (Feed) and
 *     `whereSoldModel` / `whereSoldSection` (Detail) over the same recall,
 *     so the two surfaces are pinned against each other rather than each
 *     against its own expectation.
 *
 * The structural suites still assert that the screens render these contracts
 * (`feed-design`, `detail-design`, `recall-presentation-wiring`); this file
 * asserts the contracts are right. Neither replaces the native QA recorded
 * in the milestone report.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import type { Geography } from '@/domain/recall-types';

import { buildConsumerCase, type ConsumerDistribution } from './consumer-projection';
import {
  distributionLocationState,
  geographyLocationState,
  homeLocationSummary,
  UNSPECIFIED_DISTRIBUTION,
  whereSoldModel,
  whereSoldSection,
  type LocationState,
} from './recall-presentation';
import { createSavedRecallsCache } from './saved-recalls-cache';
import {
  isSavedId,
  SAVE_ACCESSIBILITY_LABEL,
  SAVED_ACCESSIBILITY_LABEL,
  saveControlState,
  toggleSavedId,
} from './saved-recalls';

/**
 * The declared glyphs, read from the icon primitive's own table. Importing
 * `@/components/ui/icon` here is impossible — it pulls in `react-native`,
 * which the Node harness cannot transform, and which is exactly why the
 * design suites read screens as text. Parsing the table keeps this test
 * honest about the REAL glyph set instead of restating the union, and the
 * asset check below proves each name resolves to files that exist.
 */
const ICON_SOURCE = readFileSync(join(__dirname, '..', 'components', 'ui', 'icon.tsx'), 'utf8');
const GLYPH_TABLE = ICON_SOURCE.slice(
  ICON_SOURCE.indexOf('const GLYPHS = {'),
  ICON_SOURCE.indexOf('} as const;', ICON_SOURCE.indexOf('const GLYPHS = {')),
);
const ICON_NAMES = [...GLYPH_TABLE.matchAll(/^\s+'?([a-z-]+)'?:\s*require\(/gm)].map(
  (match) => match[1],
);
const ASSETS = join(__dirname, '..', '..', 'assets', 'icons');

// ── 1. The save control's two states ────────────────────────────────────────

test('P2B7H: the unsaved state is the OUTLINE bookmark, alone, spoken as an action', () => {
  const state = saveControlState(false);
  assert.equal(state.icon, 'bookmark');
  assert.equal(state.accessibilityLabel, SAVE_ACCESSIBILITY_LABEL);
  assert.equal(state.accessibilityLabel, 'Save recall');
  assert.equal(state.selected, false);
});

test('P2B7H: the saved state is the FILLED bookmark, alone, spoken as an action', () => {
  const state = saveControlState(true);
  assert.equal(state.icon, 'bookmark-filled');
  assert.equal(state.accessibilityLabel, SAVED_ACCESSIBILITY_LABEL);
  assert.equal(state.accessibilityLabel, 'Remove from saved recalls');
  assert.equal(state.selected, true);
});

test('P2B7H: the contract carries NO visible word for a surface to render', () => {
  // The icon-only direction is enforced where the state is decided, not
  // only where it is drawn: with no label in the contract, a screen cannot
  // put the word back on one surface and leave the other two without it.
  for (const saved of [false, true]) {
    const state = saveControlState(saved);
    assert.deepEqual(Object.keys(state).sort(), ['accessibilityLabel', 'icon', 'selected']);
    assert.ok(!('label' in state));
  }
});

test('P2B7H: the spoken name states the ACTION, and the condition is the selected state', () => {
  // With no visible word, the accessibility label is the control's only
  // wording. It must say what a tap DOES — "Saved" spoken alone would state
  // a condition and leave the action unguessable — while the condition is
  // announced conventionally, as selected.
  const unsaved = saveControlState(false);
  const saved = saveControlState(true);
  for (const state of [unsaved, saved]) {
    assert.match(state.accessibilityLabel, /^[A-Z]/, 'the spoken name is not a sentence');
    assert.ok(state.accessibilityLabel.length > 0);
    // An action, not a bare condition word.
    assert.notEqual(state.accessibilityLabel, 'Save');
    assert.notEqual(state.accessibilityLabel, 'Saved');
  }
  assert.notEqual(unsaved.accessibilityLabel, saved.accessibilityLabel);
  assert.equal(unsaved.selected, false);
  assert.equal(saved.selected, true);
});

test('P2B7E: NEITHER state can render without a bookmark', () => {
  // The defect this pins: the word changed and the glyph went away. There is
  // no value of `saved` for which the icon is absent, empty, or not a
  // bookmark — and both names are real, declared glyphs.
  for (const saved of [false, true]) {
    const { icon } = saveControlState(saved);
    assert.equal(typeof icon, 'string');
    assert.notEqual(icon, '');
    assert.match(icon, /^bookmark/, `the ${saved ? 'saved' : 'unsaved'} state lost its bookmark`);
    assert.ok(ICON_NAMES.includes(icon), `${icon} is not a declared glyph`);
    // …and the glyph it names is a real, non-empty file at every scale.
    for (const scale of ['', '@2x', '@3x']) {
      const file = join(ASSETS, `${icon}${scale}.png`);
      assert.ok(existsSync(file), `${icon}${scale}.png is missing`);
      assert.ok(readFileSync(file).byteLength > 0, `${icon}${scale}.png is empty`);
    }
  }
  // And the two states are actually DIFFERENT glyphs — a saved state that
  // reused the outline would be a silent regression of the filled treatment.
  assert.notEqual(saveControlState(true).icon, saveControlState(false).icon);
});

// ── 2. Transitions, driven through the real store ───────────────────────────

/**
 * One surface's rendered save state for one recall, read the way a screen
 * reads it: through the store's snapshot, not through a local boolean.
 */
function renderedSaveState(cache: ReturnType<typeof createSavedRecallsCache>, id: string) {
  return saveControlState(isSavedId(cache.getSnapshot().ids, id));
}

/** A store bound to an in-memory "storage" that a toggle really writes to. */
function storeWithStorage(initial: string[] = []) {
  let stored = [...initial];
  const cache = createSavedRecallsCache({
    load: () => Promise.resolve([...stored]),
    available: () => true,
  });
  return {
    cache,
    /** Exactly what `useSavedRecalls().toggle` does: write, then publish. */
    toggle(id: string) {
      stored = toggleSavedId(stored, id);
      cache.publish([...stored]);
    },
    /** A write that fails: storage is unchanged and the unchanged list is published. */
    failedToggle(id: string) {
      void id;
      cache.publish([...stored]);
    },
    stored: () => [...stored],
  };
}

test('P2B7E: unsaved → saved → unsaved keeps the icon at every step (one surface)', async () => {
  const store = storeWithStorage();
  const id = 'case-1';
  const seen: string[] = [];
  const unsubscribe = store.cache.subscribe(() => {});
  await Promise.resolve();

  seen.push(renderedSaveState(store.cache, id).icon);
  store.toggle(id);
  seen.push(renderedSaveState(store.cache, id).icon);
  store.toggle(id);
  seen.push(renderedSaveState(store.cache, id).icon);

  assert.deepEqual(seen, ['bookmark', 'bookmark-filled', 'bookmark']);
  // The label follows the same three steps, and never once without a glyph.
  unsubscribe();
});

test('P2B7E: repeated toggling never removes the icon, in either direction', async () => {
  const store = storeWithStorage();
  const id = 'case-1';
  const unsubscribe = store.cache.subscribe(() => {});
  await Promise.resolve();

  for (let tap = 0; tap < 12; tap += 1) {
    const before = renderedSaveState(store.cache, id);
    assert.match(before.icon, /^bookmark/, `icon lost before tap ${tap}`);
    store.toggle(id);
    const after = renderedSaveState(store.cache, id);
    assert.match(after.icon, /^bookmark/, `icon lost after tap ${tap}`);
    // Glyph, spoken action and selected state always move together.
    assert.equal(after.icon === 'bookmark-filled', after.selected);
    assert.equal(
      after.icon === 'bookmark-filled',
      after.accessibilityLabel === SAVED_ACCESSIBILITY_LABEL,
    );
    assert.notEqual(after.icon, before.icon, `tap ${tap} did not change the glyph`);
  }
  unsubscribe();
});

test('P2B7E: Feed, Detail and Saved read ONE save state — they cannot disagree', async () => {
  // Three subscribers on the one store, exactly as the three screens are.
  const store = storeWithStorage();
  const id = 'case-1';
  const other = 'case-2';
  const stops = [
    store.cache.subscribe(() => {}),
    store.cache.subscribe(() => {}),
    store.cache.subscribe(() => {}),
  ];
  await Promise.resolve();

  const everySurface = () => [
    renderedSaveState(store.cache, id),
    renderedSaveState(store.cache, id),
    renderedSaveState(store.cache, id),
  ];

  for (const surface of everySurface()) assert.equal(surface.icon, 'bookmark');

  // Saved from ONE surface: all three now render the saved state.
  store.toggle(id);
  for (const surface of everySurface()) {
    assert.equal(surface.icon, 'bookmark-filled');
    assert.equal(surface.accessibilityLabel, SAVED_ACCESSIBILITY_LABEL);
    assert.equal(surface.selected, true);
  }

  // A different recall is untouched on every surface.
  assert.equal(renderedSaveState(store.cache, other).icon, 'bookmark');

  // Unsaved from ONE surface: all three go back.
  store.toggle(id);
  for (const surface of everySurface()) assert.equal(surface.icon, 'bookmark');
  for (const stop of stops) stop();
});

test('P2B7E: a save that fails leaves icon and spoken state honest, and agreeing', async () => {
  const store = storeWithStorage();
  const id = 'case-1';
  const unsubscribe = store.cache.subscribe(() => {});
  await Promise.resolve();

  store.failedToggle(id);
  const state = renderedSaveState(store.cache, id);
  // Storage never changed, so the control still offers to save — with its
  // outline bookmark. No optimistic half-state, and no missing glyph.
  assert.deepEqual(store.stored(), []);
  assert.equal(state.icon, 'bookmark');
  assert.equal(state.accessibilityLabel, SAVE_ACCESSIBILITY_LABEL);
  assert.equal(state.selected, false);
  unsubscribe();
});

test('P2B7E: saved state survives rehydration from storage', async () => {
  // A cold launch reads the saved list back; the control must render the
  // filled bookmark on its first snapshot after that read, not the outline.
  const store = storeWithStorage(['case-1']);
  const unsubscribe = store.cache.subscribe(() => {});
  await Promise.resolve();
  await Promise.resolve();

  const state = renderedSaveState(store.cache, 'case-1');
  assert.equal(state.icon, 'bookmark-filled');
  assert.equal(state.accessibilityLabel, SAVED_ACCESSIBILITY_LABEL);
  assert.equal(state.selected, true);
  unsubscribe();
});

// ── 3. Other declared icons are untouched by a save transition ──────────────

test('P2B7E: the declared glyph set is unchanged before and after a save', async () => {
  // The save control shares `Icon` and its glyph table with the tab bar, the
  // search field, the filter chevrons, the map pin, the external link and
  // the warning/info callouts. A repair that swapped the bookmark source
  // could not silently drop any of them.
  const before = [...ICON_NAMES];
  const store = storeWithStorage();
  const unsubscribe = store.cache.subscribe(() => {});
  await Promise.resolve();
  store.toggle('case-1');
  store.toggle('case-1');
  unsubscribe();

  assert.deepEqual([...ICON_NAMES], before);
  for (const required of [
    'home',
    'bookmark',
    'bookmark-filled',
    'user',
    'search',
    'map-pin',
    'flag',
    'chevron-down',
    'chevron-right',
    'external-link',
    'warning',
    'info',
  ]) {
    assert.ok(ICON_NAMES.includes(required), `${required} is gone`);
  }
});

// ── 4. The Detail location contract ─────────────────────────────────────────

function geography(scope: Geography['scope'], states: string[] = []): Geography {
  return { scope, states, confidence: 'stated', sourceText: null };
}

function distribution(overrides: Partial<ConsumerDistribution> = {}): ConsumerDistribution {
  return {
    scopeType: 'unspecified',
    areaText: '',
    states: [],
    areas: [],
    coverage: [],
    retailers: [],
    statedRetailers: [],
    retailersShown: [],
    retailersHidden: 0,
    retailLocations: [],
    onlinePlatforms: [],
    channels: [],
    unspecified: true,
    ...overrides,
  };
}

test('P2B7E: every location state renders a Detail line — nothing is ever empty', () => {
  const cases: { label: string; distribution: ConsumerDistribution; state: LocationState }[] = [
    {
      label: 'known jurisdictions',
      distribution: distribution({
        scopeType: 'states',
        states: ['California', 'Nevada'],
        areaText: 'California and Nevada.',
        unspecified: false,
      }),
      state: 'states',
    },
    {
      label: 'nationwide',
      distribution: distribution({
        scopeType: 'nationwide',
        areaText: 'Nationwide.',
        unspecified: false,
      }),
      state: 'nationwide',
    },
    {
      label: 'a stated metro area',
      distribution: distribution({
        scopeType: 'areas',
        areas: ['Seattle'],
        areaText: 'the Seattle metro area.',
        unspecified: false,
      }),
      state: 'areas',
    },
    { label: 'unspecified distribution', distribution: distribution(), state: 'unspecified' },
  ];

  for (const one of cases) {
    const model = whereSoldModel(one.distribution);
    assert.equal(model.locationState, one.state, one.label);
    assert.equal(distributionLocationState(one.distribution), one.state, one.label);
    assert.notEqual(model.lead.trim(), '', `${one.label} produced an empty lead`);
    assert.notEqual(model.leadCollapsed.trim(), '', `${one.label} collapsed to nothing`);
    // The section is present for ALL of them — this is the whole repair.
    assert.equal(whereSoldSection(model), model, `${one.label} lost its section`);
  }
});

test('P2B7E: a missing raw distribution value cannot remove the Detail section', () => {
  // Every shape that used to leave `areaText` empty, because the projection
  // expected the retailer/platform/channel blocks to carry the answer —
  // blocks the P2a founder decision removed from the screen.
  const shapes: ConsumerDistribution[] = [
    distribution(),
    distribution({ areaText: '   ' }),
    distribution({ onlinePlatforms: ['Amazon'] }),
    distribution({ retailers: ['Costco Wholesale'], retailersShown: ['Costco Wholesale'] }),
    distribution({ channels: ['convenience stores'] }),
    distribution({ onlinePlatforms: ['Amazon'], channels: ['wholesalers'] }),
    // A "states" scope that carries no states is not a known location either.
    distribution({ scopeType: 'states', states: [] }),
  ];

  for (const shape of shapes) {
    const model = whereSoldModel(shape);
    assert.equal(model.lead, UNSPECIFIED_DISTRIBUTION);
    assert.equal(model.leadCollapsed, UNSPECIFIED_DISTRIBUTION);
    assert.notEqual(whereSoldSection(model), null);
    // The evidence itself is preserved, unrendered, for the retailer milestone.
    assert.deepEqual(model.retailers, shape.retailers);
    assert.deepEqual(model.onlinePlatforms, shape.onlinePlatforms);
    assert.deepEqual(model.channels, shape.channels);
  }
});

test('P2B7E: Feed and Detail agree on the location STATE for the same recall', () => {
  const pairs: { geography: Geography; distribution: ConsumerDistribution }[] = [
    {
      geography: geography('nationwide'),
      distribution: distribution({
        scopeType: 'nationwide',
        areaText: 'Nationwide.',
        unspecified: false,
      }),
    },
    {
      geography: geography('states', ['California', 'Nevada']),
      distribution: distribution({
        scopeType: 'states',
        states: ['California', 'Nevada'],
        areaText: 'California and Nevada.',
        unspecified: false,
      }),
    },
    { geography: geography('unknown'), distribution: distribution() },
    { geography: geography('states', []), distribution: distribution() },
  ];

  for (const pair of pairs) {
    assert.equal(
      geographyLocationState(pair.geography),
      distributionLocationState(pair.distribution),
      'the two surfaces disagree about the location state',
    );
  }

  // And the unspecified state renders the SAME words on both surfaces.
  assert.equal(homeLocationSummary(geography('unknown')), UNSPECIFIED_DISTRIBUTION);
  assert.equal(whereSoldModel(distribution()).lead, UNSPECIFIED_DISTRIBUTION);
  assert.equal(homeLocationSummary(geography('unknown')), whereSoldModel(distribution()).lead);
});

test('P2B7E: the biQ-FEL shape renders Where It Was Sold on both surfaces', () => {
  // Live case 1b5ead1a-4f0c-42a8-af9e-477824c8e114 — "500mL supplement
  // bottle", biQ-FEL. Its only stated distribution route is Amazon, and its
  // canonical geography is unknown, so the Feed card reads "Distribution not
  // specified" while Detail used to omit the section outright. Rebuilt here
  // from the real projection rather than asserted as a string.
  const consumer = buildConsumerCase(
    {
      id: 'biq-fel',
      sourceAgency: 'FDA',
      noticeType: 'recall',
      state: 'active',
      title: 'biQ-FEL 500mL supplement bottle',
      classification: { kind: 'unclassified' },
      hazardCategory: 'undeclared_drug_ingredient',
      pathogenOrAllergen: null,
      reasonText: 'Product contains sildenafil and tadalafil',
      summaryText:
        'The product was sold online through Amazon. biQ-FEL is recalling its 500mL supplement bottle.',
      summaryHtml: null,
      publishedAt: '2026-09-15T00:00:00.000Z',
      officialUrl: 'https://www.fda.gov/',
      firmName: 'A&P Creations LLC',
      brands: ['biQ-FEL'],
      productDescription: '500mL supplement bottle',
      retailerNames: [],
      geography: geography('unknown'),
    } as unknown as Parameters<typeof buildConsumerCase>[0],
    [],
  );

  // Whatever the projection made of it, the two surfaces must agree that the
  // location is unspecified and must BOTH say so.
  const model = whereSoldModel(consumer.distribution);
  assert.equal(model.locationState, 'unspecified');
  assert.equal(model.lead, UNSPECIFIED_DISTRIBUTION);
  assert.notEqual(whereSoldSection(model), null, 'Detail omitted Where It Was Sold');
  assert.equal(homeLocationSummary(geography('unknown')), UNSPECIFIED_DISTRIBUTION);
});
