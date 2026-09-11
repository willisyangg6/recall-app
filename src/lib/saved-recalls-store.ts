/**
 * Saved-recall persistence (native).
 *
 * One small JSON document in the app's DOCUMENT directory — not the cache
 * directory the feed corpus uses. The feed cache is re-downloadable public
 * data and is safe for the OS to reclaim; a saved list is the user's own
 * choice and could not be recovered, so it lives where the OS does not
 * evict it. It is still written atomically (temp file + rename), so a crash
 * mid-write can never leave a torn document where a complete one stood.
 *
 * Local only: no server row, no sync, and — importantly — no installation
 * identity. Saving a recall must never mint an id or touch a permission.
 *
 * Every operation is failure-tolerant: storage trouble degrades to "nothing
 * saved" on read and to "the toggle did not stick" on write, never to an
 * exception on a screen.
 */

import { File, Paths } from 'expo-file-system';

import { parseSavedRecalls, serializeSavedRecalls, toggleSavedId } from './saved-recalls';
import { createSerialQueue } from './serial-queue';

const SAVED_FILE = 'recall-saved-v1.json';
const TEMP_FILE = 'recall-saved-v1.json.tmp';

/** Saved recalls are available on this platform. */
export function savedRecallsAvailable(): boolean {
  return true;
}

/**
 * Serializes writes. A fast double-tap, or a save on one screen while
 * another is mid-write, would otherwise let an older list land last and
 * silently drop the newer choice. Same reasoning as the preference store's
 * queue; this one is private to saved recalls because it shares no state
 * with the installation lifecycle.
 */
const enqueue = createSerialQueue();

async function read(): Promise<string | null> {
  try {
    const file = new File(Paths.document, SAVED_FILE);
    if (!file.exists) return null;
    return await file.text();
  } catch {
    return null;
  }
}

function write(text: string): boolean {
  try {
    const temp = new File(Paths.document, TEMP_FILE);
    if (temp.exists) temp.delete();
    temp.write(text);
    const target = new File(Paths.document, SAVED_FILE);
    // Complete-document swap: the named file only ever holds a whole
    // document. A process death between delete and move leaves it ABSENT,
    // which reads as "nothing saved" — never as a torn list.
    if (target.exists) target.delete();
    temp.move(target);
    return true;
  } catch {
    return false;
  }
}

export async function loadSavedRecalls(): Promise<string[]> {
  return parseSavedRecalls(await read());
}

/**
 * Save or unsave one recall, and resolve with the list as it now stands.
 * Reads inside the queue turn so the toggle always applies to the current
 * stored list rather than to a copy a screen captured earlier. A failed
 * write resolves with the UNCHANGED list, so the UI reflects storage rather
 * than an optimistic guess.
 */
export function toggleSavedRecall(id: string): Promise<string[]> {
  return enqueue(async () => {
    const current = parseSavedRecalls(await read());
    const next = toggleSavedId(current, id);
    return write(serializeSavedRecalls(next)) ? next : current;
  });
}

/**
 * Remove the locally persisted saved list ("Reset app and delete my data").
 * Local-only, never throws; deliberately unqueued because the reset
 * orchestrator calls it inside its own turn of the installation queue.
 */
export async function deleteLocalSavedRecalls(): Promise<void> {
  for (const name of [SAVED_FILE, TEMP_FILE]) {
    try {
      const file = new File(Paths.document, name);
      if (file.exists) file.delete();
    } catch {
      // An unremovable file is overwritten by the next toggle; there is
      // nothing useful to surface on the reset path.
    }
  }
}
