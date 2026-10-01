/**
 * The one-page Edit preferences (2026-09-30), reached from Ready: its draft,
 * what it may save, and how saving behaves. Pure, so every rule is tested
 * without React; `components/onboarding/edit-preferences-step.tsx` draws it
 * and `app/onboarding/edit-preferences.tsx` connects it to the store.
 *
 * ## One working draft
 *
 * Opening the page copies the SAVED preferences into one local draft. Every
 * chooser, chip removal and `Add allergens` changes that copy and nothing
 * else: the choosers (the States and Stores search sheets, and the allergen
 * grid in its sheet) are controlled components that save nothing of their
 * own, so they are handed the draft and the draft's toggles. Closing a
 * chooser keeps the draft, so edits in the other categories survive.
 *
 * `Save changes` commits the whole draft ONCE through the canonical store
 * (`commitPreferences`, which answers after the local write and lets the
 * server mirror follow). A second press while one is in flight does nothing.
 * A failed local write leaves the page open with the draft intact and the
 * button ready to retry. Cancel, Back and every other way out discard the
 * draft: nothing reaches the store, Profile or Ready.
 *
 * ## What may be saved
 *
 * At least one state, as everywhere else; zero allergens and zero stores are
 * complete answers, including clearing earlier ones.
 */

import { typography } from '@/constants/design-tokens';
import {
  CONSUMER_ALLERGENS,
  stateNamesForCodes,
  type UserRecallPreferences,
} from '@/domain/preferences';
import { retailerById } from '@/domain/retailer-catalog';
import { toggleAllergen, toggleRetailer, toggleStateCode } from '@/lib/personalization-screen';

export type EditorSave = 'idle' | 'saving' | 'failed';

export interface EditorState {
  /** What was saved when the page opened: what Cancel returns to. */
  readonly saved: UserRecallPreferences;
  /** The working copy every control edits. */
  readonly draft: UserRecallPreferences;
  readonly save: EditorSave;
}

/** The page opens on a COPY of the saved preferences. */
export function beginEditing(saved: UserRecallPreferences): EditorState {
  return {
    saved,
    draft: {
      states: [...saved.states],
      allergens: [...saved.allergens],
      retailers: [...saved.retailers],
    },
    save: 'idle',
  };
}

export type EditorAction =
  | { type: 'toggle-state'; code: string }
  | { type: 'toggle-allergen'; token: string }
  | { type: 'toggle-store'; id: string }
  | { type: 'clear-allergens' }
  | { type: 'save-started' }
  | { type: 'save-failed' };

/**
 * Every edit the page can make. Edits are refused while a save is in flight
 * (the draft being written is the draft that was shown); a failed save
 * returns the page to editing with the draft untouched.
 */
export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  if (action.type === 'save-started') return { ...state, save: 'saving' };
  if (action.type === 'save-failed') return { ...state, save: 'failed' };
  if (state.save === 'saving') return state;
  const draft = state.draft;
  switch (action.type) {
    case 'toggle-state':
      return edit(state, { ...draft, states: toggleStateCode(draft.states, action.code) });
    case 'toggle-allergen':
      return edit(state, toggleAllergen(draft, action.token));
    case 'toggle-store':
      return edit(state, toggleRetailer(draft, action.id));
    case 'clear-allergens':
      return draft.allergens.length === 0 ? state : edit(state, { ...draft, allergens: [] });
  }
}

function edit(state: EditorState, draft: UserRecallPreferences): EditorState {
  return { ...state, draft, save: state.save === 'failed' ? 'idle' : state.save };
}

/** Save needs at least one state; allergens and stores may be empty. */
export function canSaveDraft(draft: UserRecallPreferences): boolean {
  return draft.states.length > 0;
}

/**
 * What `Save changes` should write, or null when it must do nothing: a save
 * already in flight (a double tap), or a draft without a state.
 */
export function saveRequest(state: EditorState): UserRecallPreferences | null {
  if (state.save === 'saving' || !canSaveDraft(state.draft)) return null;
  return state.draft;
}

// ── What the page shows ─────────────────────────────────────────────────────

export interface Chip {
  /** The id the chip removes: a state code, an allergen token or a store id. */
  id: string;
  name: string;
}

/** Chosen states, by full name, in the domain's canonical order. */
export function stateChips(draft: UserRecallPreferences): Chip[] {
  const names = stateNamesForCodes(draft.states);
  return draft.states.map((code, i) => ({ id: code, name: names[i] ?? code }));
}

/** Chosen allergens, in the canonical CONSUMER_ALLERGENS order, never tap order. */
export function allergenChips(draft: UserRecallPreferences): Chip[] {
  const chosen = new Set(draft.allergens);
  return CONSUMER_ALLERGENS.filter((option) => chosen.has(option.token)).map((option) => ({
    id: option.token,
    name: option.label,
  }));
}

/** Chosen stores, in the order they were chosen, under their catalog names. */
export function storeChips(draft: UserRecallPreferences): Chip[] {
  return draft.retailers.map((id) => ({ id, name: retailerById(id)?.name ?? id }));
}

// ── The page's measured sizes (the approved editor target at 393pt) ─────────

/**
 * The editor's own text sizes and leading, in points, before the reader's
 * text scale, measured on assets/brand/reference/lotly-ready-edit-preferences-target.png
 * with the bundled Public Sans: the headline Bold 31pt; the body 17.4pt; the
 * section titles Bold 19pt; the counts 13.7pt; the helpers 10.8pt (12pt
 * here: the target's size is too small to read); the chips 12.9pt; `Add
 * allergens` 16pt; the caption 11.4pt (12pt); `Save changes` 14pt on a 43pt
 * pill (16pt on 46pt, the Ready step's pill). The shared type scale and
 * Button are unchanged.
 */
export const EDITOR_TYPE = {
  cancel: { fontSize: 16, lineHeight: 22 },
  headline: { fontSize: 31, lineHeight: 37 },
  body: { fontSize: 17, lineHeight: 23 },
  sectionTitle: { fontSize: 19, lineHeight: 24 },
  count: { fontSize: 14, lineHeight: 19 },
  helper: { fontSize: 12, lineHeight: 16 },
  edit: { fontSize: 16, lineHeight: 22 },
  chip: { fontSize: 13, lineHeight: 18 },
  add: { fontSize: 16, lineHeight: 22 },
  caption: { fontSize: 12, lineHeight: 16 },
  save: { fontSize: 16, lineHeight: 22 },
} as const;

/** The page margin the target draws (21pt), on the 4pt grid. */
export const EDITOR_MARGIN = 20;
/** The leading column every section's artwork sits in: wide enough for two pictograms. */
export const SECTION_ICON_COLUMN = 44;
/** Between the artwork column and the text. */
export const SECTION_ICON_GAP = 10;
/** Above and below each section, between the rules. */
export const SECTION_PADDING = 16;
/** A chip's drawn height (the target's 31pt pill); hitSlop takes it to 44. */
export const CHIP_HEIGHT = 32;
/** Between chip rows: larger than the two hitSlops meeting, so targets never overlap. */
export const CHIP_ROW_GAP = 12;
/** `Save changes`' pill height, in points. */
export const SAVE_MIN_HEIGHT = 46;
/** The mini mascot's drawn width: its 121 target pixels at 393pt. */
export const MINI_MASCOT_WIDTH = 51;
/** The mini mascot's pixel size (lotly-ready-preferences-mini-mascot.png). */
export const MINI_MASCOT_PX = { width: 121, height: 115 } as const;
/** The section's allergen pictograms: one, or two on a diagonal (as the Ready plate). */
export const EDITOR_PICTOGRAM = { single: 36, pair: 30, step: 12 } as const;
/** From this text scale chips become full-width rows with their own 44pt Remove button. */
export const CHIP_ROWS_SCALE = 1.5;

export function chipsAsRows(fontScale: number): boolean {
  return fontScale >= CHIP_ROWS_SCALE;
}

/**
 * The headline's base size and leading: at the accessibility sizes the
 * shared `heading-2` base (still multiplied by the reader's setting, never
 * capped), as on Ready, States and Stores; the measured 31pt otherwise.
 */
export function editorHeadlineType(fontScale: number): { fontSize: number; lineHeight: number } {
  const token = typography['heading-2'];
  return chipsAsRows(fontScale)
    ? { fontSize: token.fontSize, lineHeight: token.lineHeight }
    : EDITOR_TYPE.headline;
}
