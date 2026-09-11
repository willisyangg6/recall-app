/**
 * Web variant: the feed's own persistence is already deliberately absent on
 * web (feed-cache-store.web.ts), and the expo-file-system File API does not
 * support it. Rather than introduce a second storage backend with its own
 * quota and private-mode failure modes, saving is simply unavailable on web
 * — the control does not render and the Saved tab explains, the same
 * convention preferences-store.web.ts and push-registration.web.ts use.
 */

export function savedRecallsAvailable(): boolean {
  return false;
}

export async function loadSavedRecalls(): Promise<string[]> {
  return [];
}

export async function toggleSavedRecall(_id: string): Promise<string[]> {
  return [];
}

export async function deleteLocalSavedRecalls(): Promise<void> {}
