/**
 * Saved recalls (P2A) — the pure, dependency-free half: the stored document
 * shape, the toggle, and the resolution of saved ids against a loaded feed
 * corpus. Storage (expo-file-system) lives in saved-recalls-store, which is
 * unimportable under the Node test harness; everything provable lives here.
 *
 * ## What a save actually is
 *
 * A list of recall CASE IDS on this device, newest save first. Deliberately
 * not a snapshot of the recall: a saved copy would be a second, silently
 * ageing truth for information the product exists to keep accurate. The
 * Saved screen resolves ids against the same complete corpus the feed
 * already holds, so a saved recall always renders the current official
 * facts or is honestly reported as no longer in the active feed.
 *
 * ## What it is not
 *
 * Device-local and nothing else: no server row, no installation identity, no
 * sync, and no signal into ranking, personalization, notifications, or the
 * shopper-report system. Saving is a private bookmark. It IS cleared by
 * "Reset app and delete my data", which promises the app returns to its
 * default state.
 */

/** Bump when the stored document's shape changes (a stale file is discarded). */
export const SAVED_RECALLS_SCHEMA_VERSION = 1;

interface SavedRecallsDocument {
  version: number;
  /** Case ids, newest save first. */
  ids: string[];
}

/**
 * Read a stored document. Anything unreadable, mis-shaped, or written under a
 * different schema version degrades to "nothing saved" rather than throwing:
 * a corrupt bookmark file must never break a screen.
 */
export function parseSavedRecalls(text: string | null): string[] {
  if (text === null) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return [];
    const document = parsed as Partial<SavedRecallsDocument>;
    if (document.version !== SAVED_RECALLS_SCHEMA_VERSION) return [];
    if (!Array.isArray(document.ids)) return [];
    return sanitizeSavedIds(document.ids);
  } catch {
    return [];
  }
}

export function serializeSavedRecalls(ids: string[]): string {
  const document: SavedRecallsDocument = {
    version: SAVED_RECALLS_SCHEMA_VERSION,
    ids: sanitizeSavedIds(ids),
  };
  return JSON.stringify(document);
}

/** Non-empty strings only, first occurrence wins — order is save order. */
export function sanitizeSavedIds(values: unknown[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const id = value.trim();
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function isSavedId(ids: readonly string[], id: string): boolean {
  return ids.includes(id);
}

/**
 * Save (prepend, so Saved reads newest-first) or unsave (remove in place).
 * Pure: returns a new array and never mutates the one it was given.
 */
export function toggleSavedId(ids: readonly string[], id: string): string[] {
  return isSavedId(ids, id) ? ids.filter((saved) => saved !== id) : [id, ...ids];
}

/**
 * The saved items present in a loaded corpus, in save order.
 *
 * Ids the corpus does not carry are skipped, not rendered as an error: the
 * consumer feed is the active corpus, so a recall that closed or was
 * retracted after being saved is simply no longer there. `missingSavedCount`
 * reports how many were skipped so the screen can say so plainly instead of
 * quietly showing a shorter list than the user saved.
 */
export function selectSavedItems<T extends { id: string }>(
  ids: readonly string[],
  items: readonly T[],
): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const selected: T[] = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (item !== undefined) selected.push(item);
  }
  return selected;
}

export function missingSavedCount(
  ids: readonly string[],
  items: readonly { id: string }[],
): number {
  return ids.length - selectSavedItems(ids, items).length;
}

// ── User-facing copy — a tested contract, not incidental strings ────────────

/**
 * The spoken names of the save control (P2B7H).
 *
 * The control is ICON-ONLY on every surface, so these are no longer a
 * second channel beside a visible word — they are the ONLY words the
 * control has, and they carry its whole meaning to anyone who cannot see
 * the bookmark. They therefore name the ACTION a tap performs, not the
 * condition the control is in: "Saved" spoken alone would state a fact and
 * leave a screen-reader user guessing what pressing it would do. The
 * condition is announced separately and conventionally, as the control's
 * selected state (`SaveControlState.selected` → `accessibilityState`), so
 * assistive technology reads "Remove from saved recalls, selected" rather
 * than the product inventing its own way to say "on".
 *
 * The visible `Save` / `Saved` words these replaced are gone, and so are
 * their constants: a copy constant nothing renders is a string that drifts
 * out of agreement with the product unnoticed.
 */
export const SAVE_ACCESSIBILITY_LABEL = 'Save recall';
export const SAVED_ACCESSIBILITY_LABEL = 'Remove from saved recalls';

/**
 * The approved bookmark glyphs, named here rather than at the call site
 * (P2B7E). These are `IconName`s from `components/ui/icon`, but this module
 * is a LEAF — the client/server boundary and the bundle both depend on it
 * importing no component — so the two names are a literal union, pinned
 * against the real glyph set by `saved-recalls.test.ts`.
 */
export type SaveControlIcon = 'bookmark' | 'bookmark-filled';

/**
 * Everything the one save control renders, decided from one boolean.
 *
 * Why this exists (P2B7E): the control appears on the Feed card, on Recall
 * Detail, and on Saved, and its saved state changes several things at once.
 * Deriving them separately at three call sites is how some of them can
 * agree while another silently drifts, which is precisely the shape of
 * "the word changed to Saved but the icon went away". There is one function,
 * it is pure, and the icon is not optional in either state.
 *
 * P2B7H made the control ICON-ONLY (the Figma direction, node 81:792), so
 * the state now decides THREE things rather than four: the glyph, the
 * spoken action, and the announced selection. The bookmark carries the
 * state visually — outline unsaved, the same bookmark filled once saved —
 * which is why the glyph pair, not a word, is the non-colour channel. No
 * surface may add a visible word back on its own: there is no label in
 * this contract to render.
 */
export interface SaveControlState {
  /** The bookmark: outline while unsaved, the same bookmark filled once saved. */
  icon: SaveControlIcon;
  /** The spoken name of the action a tap performs. */
  accessibilityLabel: string;
  /** What a screen reader announces as the control's selected state. */
  selected: boolean;
}

export function saveControlState(saved: boolean): SaveControlState {
  return saved
    ? {
        icon: 'bookmark-filled',
        accessibilityLabel: SAVED_ACCESSIBILITY_LABEL,
        selected: true,
      }
    : {
        icon: 'bookmark',
        accessibilityLabel: SAVE_ACCESSIBILITY_LABEL,
        selected: false,
      };
}

/** One whole-screen state's words: a title over an explanation. */
export interface SavedStateCopy {
  title: string;
  body: string;
}

/** Storage and the corpus have not both answered yet. */
export const SAVED_LOADING: SavedStateCopy = {
  title: 'Loading saved recalls…',
  body: 'Reading what you saved.',
};

export const SAVED_EMPTY_TITLE = 'No saved recalls';

export const SAVED_EMPTY_BODY = 'Save a recall to find it here later.';

export const SAVED_EMPTY: SavedStateCopy = {
  title: SAVED_EMPTY_TITLE,
  body: SAVED_EMPTY_BODY,
};

/**
 * The feed read failed. Its body is the feed session's own message, and the
 * words say nothing about the saved list: a failed read of the corpus leaves
 * every saved id exactly where it was on this device.
 */
export const SAVED_ERROR_TITLE = 'Could not load recalls';

/** Web has no saved-recall storage (saved-recalls-store.web.ts). */
export const SAVED_UNAVAILABLE: SavedStateCopy = {
  title: 'Available in the app',
  body: 'Saved recalls are stored on your device. Open Lotly on your phone to save one.',
};

/**
 * The public backend configuration is missing (P3C1). Same rule as the
 * Feed's (`feed-copy.ts`, which explains the split): the release sentence
 * names no environment variable, and adds the one fact that matters here,
 * which is that nothing saved was lost. `SAVED_NOT_CONFIGURED_DEV` is the
 * developer's version, and Saved picks between them on `__DEV__`.
 */
export const SAVED_NOT_CONFIGURED: SavedStateCopy = {
  title: 'Recalls are unavailable',
  body: 'Lotly couldn’t reach the recall service. Your saved recalls are still on this device.',
};

/** The same state said to whoever can fix it. Development builds only. */
export const SAVED_NOT_CONFIGURED_DEV: SavedStateCopy = {
  title: 'Backend not configured',
  body:
    'Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env (see README), ' +
    'then restart the dev server.',
};

/**
 * Shown when saved ids no longer appear in the active corpus. Honest about
 * why — the recall is gone from the feed, not from the device by mistake.
 */
export function savedMissingNotice(count: number): string | null {
  if (count < 1) return null;
  return count === 1
    ? '1 saved recall is no longer in the active feed.'
    : `${count} saved recalls are no longer in the active feed.`;
}
