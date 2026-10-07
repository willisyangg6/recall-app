/**
 * The Filters sheet's draft (2026-10-06, the approved Feed + Filters design).
 *
 * One sheet now holds all three dimensions — Location, Risk level and
 * Category — on both feeds. What it edits is a DRAFT copy of that feed's
 * applied filters: nothing reaches the list until Apply, and Close, the
 * backdrop and Android's back discard the draft. Clear all empties the
 * draft only (Apply then commits the empty set). None of this is a
 * preference: filters stay session-only browsing state and never touch
 * the saved personalization profile.
 *
 * Selection semantics are unchanged from the three single-dimension sheets
 * this replaces: every dimension is multi-select (OR within, AND across, in
 * `applyFeedFilters`). "All risks" and "All categories" are the empty
 * selection — choosing one clears its dimension, and choosing any specific
 * option leaves it — so "All" and a specific option are never both selected.
 *
 * Pure data and functions; no React.
 */

import { sanitizeLaunchCategoryIds } from '@/domain/food-category-launch';
import { stateNameForCode } from '@/domain/preferences';
import { EMPTY_FEED_FILTERS, type FeedFilterState } from '@/lib/feed-filters';

export type FilterDimension = 'stateCodes' | 'riskTiers' | 'categoryIds';

/** Toggle one specific option in a dimension of the draft. */
export function toggleDraftOption(
  draft: FeedFilterState,
  dimension: FilterDimension,
  value: string,
): FeedFilterState {
  const current = draft[dimension] as string[];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  return { ...draft, [dimension]: next } as FeedFilterState;
}

/** "All risks" / "All categories" / "All locations": the dimension's empty selection. */
export function selectAllInDimension(
  draft: FeedFilterState,
  dimension: FilterDimension,
): FeedFilterState {
  return { ...draft, [dimension]: [] } as FeedFilterState;
}

/** Whether a dimension's "All" control is the selected one. */
export function isAllSelected(draft: FeedFilterState, dimension: FilterDimension): boolean {
  return draft[dimension].length === 0;
}

/** Clear all: every dimension of the draft emptied; nothing applied yet. */
export function clearDraft(): FeedFilterState {
  return {
    stateCodes: [],
    riskTiers: [],
    categoryIds: [],
  };
}

/**
 * The draft as it may become applied state: the category selection crosses
 * the launch allowlist, exactly as the single sheets' Apply did, so a hidden
 * or unknown id can never enter the filter by any path.
 */
export function committedFilters(draft: FeedFilterState): FeedFilterState {
  return {
    stateCodes: [...draft.stateCodes],
    riskTiers: [...draft.riskTiers],
    categoryIds: sanitizeLaunchCategoryIds(draft.categoryIds),
  };
}

/**
 * How many dimensions narrow the feed — the Filters button's count. A count
 * of GROUPS, never of matching recalls or of selected options.
 */
export function activeGroupCount(filters: FeedFilterState): number {
  return (
    (filters.stateCodes.length > 0 ? 1 : 0) +
    (filters.riskTiers.length > 0 ? 1 : 0) +
    (filters.categoryIds.length > 0 ? 1 : 0)
  );
}

/** The Filters button's visible label: "Filters", or "Filters · 2". */
export function filtersButtonLabel(filters: FeedFilterState): string {
  const count = activeGroupCount(filters);
  return count === 0 ? 'Filters' : `Filters · ${count}`;
}

/** The Filters button's spoken label. */
export function filtersButtonAccessibilityLabel(filters: FeedFilterState): string {
  const count = activeGroupCount(filters);
  if (count === 0) return 'Filters';
  return count === 1 ? 'Filters, 1 group active' : `Filters, ${count} groups active`;
}

/** No location chosen: the summary row's words. */
export const ALL_LOCATIONS = 'All locations';

/**
 * The location row's summary: the chosen state names (two at most, then a
 * count), or "All locations".
 */
export function locationSummary(stateCodes: readonly string[]): string {
  if (stateCodes.length === 0) return ALL_LOCATIONS;
  const names = stateCodes
    .map((code) => stateNameForCode(code) ?? code)
    .sort((a, b) => a.localeCompare(b));
  if (names.length <= 2) return names.join(', ');
  return `${names[0]}, ${names[1]} +${names.length - 2}`;
}

/**
 * The location row's note. The Location filter admits nationwide recalls
 * alongside the ones naming a chosen state (`locationMatchTier`), so the
 * note says so — and only when a state is chosen, the one time it is true
 * that something beyond the named states is included.
 */
export function locationNote(stateCodes: readonly string[]): string | null {
  return stateCodes.length > 0 ? 'Includes nationwide recalls' : null;
}

export { EMPTY_FEED_FILTERS };
