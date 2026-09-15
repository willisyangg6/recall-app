/**
 * The Profile hub's display rules (P2B5): the personalization summary the
 * featured card shows, the version line, and the hub's own copy.
 *
 * Profile READS this device's preferences — through the same store the
 * Personalization screen saves to — and never writes them. Everything here
 * is pure: the screen decides where the preferences come from and whether
 * the read has answered yet; this module decides only what each answer
 * says, so the rules can be proven under Node against the closed
 * vocabularies (`domain/preferences`, `domain/retailer-catalog`).
 *
 * The summary is compact by contract. Allergens and stores show at most two
 * names, then `+N` — the same shape the Feed card gives a multi-state
 * distribution — while the spoken description always carries every name,
 * so an abbreviated value never hides a choice from a screen reader.
 *
 * Three answers exist and none may pass for another: a read that has not
 * resolved (loading), a read that failed or a platform with no preferences
 * (unavailable), and a real answer — which may be empty. `Not chosen` and
 * `None selected` are therefore claims about this device, made only when
 * the store has actually said so.
 */

import {
  CONSUMER_ALLERGENS,
  stateNameForCode,
  type UserRecallPreferences,
} from '@/domain/preferences';
import { retailerById } from '@/domain/retailer-catalog';

// ── The summary ─────────────────────────────────────────────────────────────

/** This device's personalization as display names. */
export interface PersonalizationSummary {
  /** The chosen state's full name, or null when none is chosen. */
  state: string | null;
  /** Allergen labels in the canonical (display) order, never a raw token. */
  allergens: readonly string[];
  /** Canonical retailer names in the order they were chosen, never a raw id. */
  retailers: readonly string[];
}

/**
 * Display names from the stored preference shape. An unknown token or id is
 * dropped rather than shown raw — the same tolerance `sanitizePreferences`
 * applies on the way in.
 */
export function summarizePreferences(prefs: UserRecallPreferences): PersonalizationSummary {
  const chosen = new Set(prefs.allergens);
  return {
    state: stateNameForCode(prefs.state),
    allergens: CONSUMER_ALLERGENS.filter((option) => chosen.has(option.token)).map(
      (option) => option.label,
    ),
    retailers: prefs.retailers
      .map((id) => retailerById(id)?.name ?? null)
      .filter((name): name is string => name !== null),
  };
}

/** What the store has answered so far. */
export type PreferenceSummaryState =
  /** The read has not resolved. Nothing is claimed about this device yet. */
  | { status: 'loading' }
  /** The read failed, or this platform has no preferences at all. */
  | { status: 'unavailable' }
  /** The store's real answer, which may hold nothing. */
  | { status: 'ready'; summary: PersonalizationSummary };

export const SUMMARY_LABELS = {
  state: 'State',
  allergens: 'Allergens',
  retailers: 'Stores',
} as const;

export type SummaryKey = keyof typeof SUMMARY_LABELS;

/** No state chosen — a real answer. */
export const NOT_CHOSEN = 'Not chosen';
/** No allergen or store chosen — a real answer. */
export const NONE_SELECTED = 'None selected';
/** The read has not answered. */
export const LOADING_VALUE = 'Loading…';
/** The read failed. Never shown as an empty choice. */
export const UNAVAILABLE_VALUE = 'Unavailable';

/** How many names a value shows before it counts the rest. */
export const SUMMARY_VISIBLE_NAMES = 2;

export interface CompactList {
  /** What the card shows: up to two names, then `+N`. */
  visible: string;
  /** What is spoken: every name, as a sentence fragment. */
  accessible: string;
}

/** Names as a spoken list: `A`, `A and B`, `A, B and C`. */
function spokenList(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The compact-display rule for allergens and stores: `None selected` for
 * zero; one or two names in full; beyond two, the first two and `+N` for
 * the rest. The accessible form never abbreviates.
 */
export function compactList(names: readonly string[]): CompactList {
  if (names.length === 0) return { visible: NONE_SELECTED, accessible: NONE_SELECTED };
  const accessible = spokenList(names);
  if (names.length <= SUMMARY_VISIBLE_NAMES) return { visible: names.join(', '), accessible };
  const shown = names.slice(0, SUMMARY_VISIBLE_NAMES).join(', ');
  return { visible: `${shown} +${names.length - SUMMARY_VISIBLE_NAMES}`, accessible };
}

export interface SummaryLine {
  key: SummaryKey;
  label: string;
  visible: string;
  accessible: string;
  /**
   * `value` is a real choice; `empty` is a real answer that nothing was
   * chosen; `pending` is no answer at all (loading or unavailable). The card
   * quietens everything that is not a value, but the words alone tell the
   * three apart.
   */
  kind: 'value' | 'empty' | 'pending';
}

/** The three lines the featured card shows for a given answer. */
export function summaryLines(state: PreferenceSummaryState): SummaryLine[] {
  if (state.status !== 'ready') {
    const word = state.status === 'loading' ? LOADING_VALUE : UNAVAILABLE_VALUE;
    return (Object.keys(SUMMARY_LABELS) as SummaryKey[]).map((key) => ({
      key,
      label: SUMMARY_LABELS[key],
      visible: word,
      accessible: word,
      kind: 'pending',
    }));
  }
  const { summary } = state;
  const allergens = compactList(summary.allergens);
  const retailers = compactList(summary.retailers);
  return [
    {
      key: 'state',
      label: SUMMARY_LABELS.state,
      visible: summary.state ?? NOT_CHOSEN,
      accessible: summary.state ?? NOT_CHOSEN,
      kind: summary.state === null ? 'empty' : 'value',
    },
    {
      key: 'allergens',
      label: SUMMARY_LABELS.allergens,
      ...allergens,
      kind: summary.allergens.length === 0 ? 'empty' : 'value',
    },
    {
      key: 'retailers',
      label: SUMMARY_LABELS.retailers,
      ...retailers,
      kind: summary.retailers.length === 0 ? 'empty' : 'value',
    },
  ];
}

/** Spoken while the read is pending, in place of three `Loading…` lines. */
export const LOADING_DESCRIPTION = 'Loading your preferences.';
/** Spoken when the read failed, in place of three `Unavailable` lines. */
export const UNAVAILABLE_DESCRIPTION = 'Your preferences could not be read.';

/**
 * The whole card is one link, so it speaks once: its name, then every
 * choice in full — or the honest pending sentence.
 */
export function summaryAccessibilityLabel(label: string, state: PreferenceSummaryState): string {
  if (state.status === 'loading') return `${label}. ${LOADING_DESCRIPTION}`;
  if (state.status === 'unavailable') return `${label}. ${UNAVAILABLE_DESCRIPTION}`;
  const lines = summaryLines(state).map((line) => `${line.label}: ${line.accessible}.`);
  return `${label}. ${lines.join(' ')}`;
}

// ── The hub's copy ──────────────────────────────────────────────────────────

/** The visible affordance on the featured card. The card itself is the target. */
export const EDIT_LABEL = 'Edit';
export const PERSONALIZATION_HINT = 'Opens your state, allergens to watch, and stores.';
export const NOTIFICATIONS_SUMMARY = 'Recall alerts for this device.';
export const NOTIFICATIONS_HINT = 'Opens recall alert settings for this device.';
export const DOCUMENT_HINT = 'Opens the document.';
export const APP_VERSION_LABEL = 'App version';
/** The development entry's heading; the row beneath it is the harness. */
export const DEVELOPMENT_HEADING = 'Development builds only';
export const DEVELOPMENT_HINT = 'Development builds only. Not part of the product.';

/** What the version line reads when no native version exists (Expo Go, web, dev). */
export const VERSION_FALLBACK = 'Development build';

export function versionLine(version: string | null, build: string | null): string {
  return version ? `${version}${build ? ` (${build})` : ''}` : VERSION_FALLBACK;
}
