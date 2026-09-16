/**
 * The Personalization screen's copy and pure list rules (P2B6A), kept out of
 * the route so they are one tested contract rather than strings and slices
 * inside a component.
 *
 * What is here is what the screen does: the 52 jurisdictions sorted by name
 * and filtered by a case-insensitive substring; the store catalog in its
 * canonical (alphabetical) order, filtered by the catalog's own search and
 * never reordered by a selection; the toggles that add a choice at the end
 * of its list and remove it by filtering; the words the main screen uses to
 * summarize the chosen stores and the selector uses to count them; the
 * autosave status words; and the three answers a read can give besides a
 * real one (loading, failed, and a platform without preferences), which the
 * screen must never render as an empty selection.
 *
 * Consumer copy here follows DESIGN.md "Consumer copy": short sentences, one
 * job each, no em dashes.
 *
 * A leaf: it imports the preference domain and the retailer catalog and
 * nothing that can read or write anything. The store stays the route's.
 */

import {
  stateNameForCode,
  SUPPORTED_STATE_CODES,
  type UserRecallPreferences,
} from '@/domain/preferences';
import { retailerById, searchRetailers, type CanonicalRetailer } from '@/domain/retailer-catalog';

// ── What the screen can be showing ──────────────────────────────────────────

/**
 * The read's answer. `ready` is the only one that renders controls; the
 * other three each have their own words, so a pending read, a failed read
 * and the web can never pass for "nothing chosen".
 */
export type PreferencesLoadState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'unsupported' }
  | { status: 'ready'; prefs: UserRecallPreferences };

export const LOADING_STATE = {
  title: 'Loading your preferences…',
  body: 'Reading what this device has saved.',
} as const;

export const FAILED_STATE = {
  title: 'Your preferences could not be read',
  body: 'Nothing was changed. Go back and open this screen again to retry.',
} as const;

export const UNSUPPORTED_STATE = {
  title: 'Available in the app',
  body: 'Personalization is available in the Lotly mobile app.',
} as const;

// ── Copy (founder-approved, P2B6A follow-up) ────────────────────────────────

export const PERSONALIZATION_INTRO =
  'Choose what Lotly should watch for. These preferences shape Affects me and your recall alerts. You can still browse every recall.';

export const STATE_SECTION_LABEL = 'Your state';
export const STATE_SECTION_HELPER =
  'Choose the state you want Lotly to watch. Nationwide recalls are always included.';
/** The trigger row's words when no state is chosen. */
export const STATE_PLACEHOLDER = 'Choose your state';
export const STATE_SELECT_LABEL = 'Select';
export const STATE_CHANGE_LABEL = 'Change';
/** Spoken after the trigger's name: what pressing it does. */
export const STATE_TRIGGER_HINT = 'Opens the list of states.';
export const STATE_SELECTOR_TITLE = 'Choose your state';
export const STATE_CLEAR_LABEL = 'Clear selection';
/** The same words the questionnaire's searchable state list uses. */
export const STATE_SEARCH_LABEL = 'Search states';
export const STATE_SEARCH_PLACEHOLDER = 'Search states';
export const STATE_SEARCH_HINT = 'Filters the list of states below. Choose a state from the list.';
export const STATE_SEARCH_NO_MATCH = 'No state matches that search.';

export const STORE_SECTION_LABEL = 'Stores you shop at';
export const STORE_SECTION_HELPER =
  'Choose stores you shop at. Lotly flags recalls that name them. Some notices do not list every store, so an unflagged recall may still apply.';
/** The main screen's words when no store is chosen. */
export const NO_STORES_SELECTED = 'No stores selected';
export const ADD_STORES_LABEL = 'Add stores';
export const EDIT_STORES_LABEL = 'Edit stores';
export const STORES_TRIGGER_HINT = 'Opens the list of stores.';
export const STORE_SELECTOR_TITLE = 'Choose stores';
export const STORE_SEARCH_LABEL = 'Search stores';
export const STORE_SEARCH_PLACEHOLDER = 'Search stores';
export const STORE_SEARCH_HINT = 'Filters the list of stores below. Check a store to choose it.';
export const STORE_SEARCH_NO_MATCH = 'No store matches that search.';

/** The selector sheets' dismiss actions. */
export const DONE_LABEL = 'Done';
export const DONE_HINT = 'Closes the list. Your choices are already saved.';
export const CLOSE_LABEL = 'Close';
export const CLOSE_HINT = 'Closes the list without changing your choice.';

/** "A", "A and B", "A, B and C": the spoken form of a list of names. */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The trigger row's spoken name: the section and the current choice. */
export function stateTriggerLabel(stateName: string | null): string {
  return `State: ${stateName ?? 'not chosen'}`;
}

/** The store row's spoken name: the section and every chosen store. */
export function storeTriggerLabel(names: readonly string[]): string {
  return `Stores: ${names.length === 0 ? 'none selected' : listNames(names)}`;
}

// ── The state list ──────────────────────────────────────────────────────────

export interface StateChoice {
  code: string;
  name: string;
}

/** Every supported jurisdiction, by name. */
export function stateChoices(): StateChoice[] {
  return SUPPORTED_STATE_CODES.map((code) => ({
    code,
    name: stateNameForCode(code) as string,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

/** The choices whose name contains the query, case-insensitively; all of them for a blank query. */
export function filterStateChoices(choices: readonly StateChoice[], query: string): StateChoice[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...choices];
  return choices.filter((choice) => choice.name.toLowerCase().includes(needle));
}

// ── The store list ──────────────────────────────────────────────────────────

/**
 * The selector's rows: the catalog in its canonical order (the catalog's own
 * search sorts by name), narrowed by the catalog's own matching when
 * something is typed. Selection is not an input: a checked row stays exactly
 * where the catalog puts it, so nothing moves under the shopper's finger.
 */
export function storeRows(query: string): CanonicalRetailer[] {
  return searchRetailers(query);
}

export interface ChosenStore {
  id: string;
  name: string;
}

/** The chosen stores, in the order they were chosen, under their catalog names. */
export function chosenStores(selected: readonly string[]): ChosenStore[] {
  return selected.map((id) => ({ id, name: retailerById(id)?.name ?? id }));
}

/** The main screen's summary of the chosen stores: every name, or the empty words. */
export function storeSummary(selected: readonly string[]): string {
  if (selected.length === 0) return NO_STORES_SELECTED;
  return chosenStores(selected)
    .map((store) => store.name)
    .join(', ');
}

/** The main screen's one action for the store section. */
export function storeActionLabel(selected: readonly string[]): string {
  return selected.length === 0 ? ADD_STORES_LABEL : EDIT_STORES_LABEL;
}

/** The selector's count line: words, not colour, carry how many are chosen. */
export function storeCountLabel(count: number): string {
  if (count === 0) return NO_STORES_SELECTED;
  return count === 1 ? '1 store selected' : `${count} stores selected`;
}

// ── The edits ───────────────────────────────────────────────────────────────

export function withState(
  prefs: UserRecallPreferences,
  state: string | null,
): UserRecallPreferences {
  return { ...prefs, state };
}

/** Adds the token at the end of the list, or removes it — the same shape the store saves. */
export function toggleAllergen(prefs: UserRecallPreferences, token: string): UserRecallPreferences {
  return {
    ...prefs,
    allergens: prefs.allergens.includes(token)
      ? prefs.allergens.filter((t) => t !== token)
      : [...prefs.allergens, token],
  };
}

/** Adds the store at the end of the list, or removes it. */
export function toggleRetailer(prefs: UserRecallPreferences, id: string): UserRecallPreferences {
  return {
    ...prefs,
    retailers: prefs.retailers.includes(id)
      ? prefs.retailers.filter((r) => r !== id)
      : [...prefs.retailers, id],
  };
}

// ── Autosave feedback ───────────────────────────────────────────────────────

/** Silent when idle, honest when offline. */
export type SaveState = 'idle' | 'saving' | 'saved' | 'local_only';

export const SAVE_STATUS: Record<Exclude<SaveState, 'idle'>, string> = {
  saving: 'Saving…',
  saved: 'Saved.',
  local_only: 'Saved on this device. It will sync the next time you open Lotly online.',
};

/** The line under the form, or null while nothing has been changed. */
export function saveStatusText(state: SaveState): string | null {
  return state === 'idle' ? null : SAVE_STATUS[state];
}
