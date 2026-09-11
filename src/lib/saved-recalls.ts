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

/** The control's label while the recall is NOT saved. */
export const SAVE_ACTION_LABEL = 'Save';

/** The control's label while it IS saved (tapping again removes it). */
export const SAVED_ACTION_LABEL = 'Saved';

/** Spoken names: the visible label states a condition, not the action. */
export const SAVE_ACCESSIBILITY_LABEL = 'Save this recall';
export const SAVED_ACCESSIBILITY_LABEL = 'Saved. Remove from Saved';

export const SAVED_EMPTY_TITLE = 'Nothing saved yet';

export const SAVED_EMPTY_BODY =
  'Save a recall from the feed or its detail page to keep it here. Saved recalls stay on this ' +
  'device.';

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
