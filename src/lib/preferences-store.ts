/**
 * Preference persistence (native).
 *
 * Source of truth is the LOCAL copy: preferences are this device's own
 * choices, they must work offline and before push is ever enabled, and only
 * this installation writes them. The server row (installation_preferences)
 * is explicitly a mirror the delivery worker reads for push eligibility —
 * mirrored after every local save, and mirrored again on the next save or
 * app launch when a sync fails (dirty flag). There are never two
 * authorities: local wins, the server converges.
 *
 * Stored in SecureStore alongside the installation id: allergen selections
 * are sensitive-ish personal data, and the keychain survives reinstalls, so
 * preferences and the installation identity live and die together. Reading
 * or writing preferences NEVER triggers a notification-permission prompt —
 * the installation id is an opaque UUID with no permission attached.
 *
 * Since 2026-10-04 the durable local write and the server mirror are two
 * separate things (lib/preference-persistence.ts, where the rules and their
 * proofs live): the write runs in the shared installation mutation queue
 * and answers at once; the mirror is one coalescing worker that always
 * sends the newest local value, so a slow network can never delay what the
 * device holds and an older value can never overwrite a newer one. This
 * file only wires that module to SecureStore, the RPC and the queue.
 */

import * as SecureStore from 'expo-secure-store';

import {
  EMPTY_PREFERENCES,
  sanitizePreferences,
  type UserRecallPreferences,
} from '@/domain/preferences';
import {
  ALLERGEN_CONSENT_VERSION,
  allergensForServer,
  nextDecisionTime,
  serverAllergenConsent,
  type AllergenConsentDecision,
} from './allergen-consent';
import {
  loadAllergenConsent,
  loadAllergenConsentStrict,
  saveAllergenConsent,
} from './allergen-consent-store';
import { getOrCreateInstallationId } from './installation-id';
import { enqueueInstallationMutation } from './installation-lifecycle';
import { createPreferencePersistence, type SaveResult } from './preference-persistence';
import { setInstallationPreferences } from './push-api';

export type { SaveResult } from './preference-persistence';

const PREFS_KEY = 'recall.preferences';
/** '1' while the newest local value has not been confirmed by the mirror. */
const DIRTY_KEY = 'recall.preferences-dirty';

/** Preferences are available on this platform. */
export function preferencesAvailable(): boolean {
  return true;
}

/**
 * The newest preferences this process has read or written (2026-10-04), in
 * memory only, or null before any read. A screen arriving after another
 * (the Feed after onboarding) starts from them instead of from "not read
 * yet", so its first visible frame already reflects the choices — no
 * flip once the focus read lands. Every screen still re-reads on focus.
 */
let known: UserRecallPreferences | null = null;

export function knownPreferences(): UserRecallPreferences | null {
  return known;
}

/** The locally stored preferences; EMPTY when none were ever saved. */
export async function loadPreferences(): Promise<UserRecallPreferences> {
  try {
    const raw = await SecureStore.getItemAsync(PREFS_KEY);
    known = raw ? sanitizePreferences(JSON.parse(raw)) : { ...EMPTY_PREFERENCES };
    return known;
  } catch {
    // A corrupt or unreadable value degrades to empty preferences — it never
    // crashes Home or Settings.
    return { ...EMPTY_PREFERENCES };
  }
}

async function syncToServer(prefs: UserRecallPreferences): Promise<void> {
  // Allergens leave this device only with consent (2026-10-13); states and
  // stores mirror exactly as before. A strict read: an unreadable record
  // fails this run (still owed) rather than sending "no decision".
  const consent = await loadAllergenConsentStrict();
  await setInstallationPreferences({
    installationId: await getOrCreateInstallationId(),
    stateCodes: prefs.states,
    allergens: allergensForServer(prefs.allergens, consent),
    retailerIds: prefs.retailers,
    allergenConsent: serverAllergenConsent(consent),
    allergenConsentDecidedAt: consent?.at ?? null,
  });
}

type DevelopmentMirrorModule = typeof import('./development-preference-mirror');

/**
 * In a development build the Design Preview can keep saves on this device
 * (QA of the real selectors without a production write). The `require` sits
 * inside the `__DEV__` branch, so a release bundle folds the module away and
 * the mirror below is always the real RPC.
 */
const developmentMirror = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('./development-preference-mirror') as DevelopmentMirrorModule)
  : null;

const persistence = createPreferencePersistence({
  // C7.1: the SHARED installation mutation queue, so local writes — and the
  // launch flush — serialize against push registration writes and "Reset
  // app and delete my data". Save-vs-save ordering is exactly what it was.
  enqueueLocal: enqueueInstallationMutation,
  readLocal: loadPreferences,
  writeLocal: (prefs) => SecureStore.setItemAsync(PREFS_KEY, JSON.stringify(prefs)),
  isDirty: async () => (await SecureStore.getItemAsync(DIRTY_KEY)) === '1',
  setDirty: (dirty) =>
    dirty ? SecureStore.setItemAsync(DIRTY_KEY, '1') : SecureStore.deleteItemAsync(DIRTY_KEY),
  // The consent decides what a mirror carries, so it is part of "synced".
  mirrorKey: async () => {
    const consent = await loadAllergenConsent();
    return `${serverAllergenConsent(consent) ?? 'none'}@${consent?.at ?? ''}`;
  },
  readStoredStrict: async () => {
    const raw = await SecureStore.getItemAsync(PREFS_KEY); // a read error throws
    return raw === null ? null : sanitizePreferences(JSON.parse(raw)); // corrupt JSON throws
  },
  syncRemote:
    __DEV__ && developmentMirror
      ? developmentMirror.wrapDevelopmentMirror(syncToServer)
      : syncToServer,
});

/**
 * Persist preferences: the durable local write first (never lost to a
 * network error, never delayed by one), then the coalescing server mirror.
 * Answers `{ synced }` once the mirror attempt covering this value has
 * finished; the Personalization screen's status line reads it.
 */
export function savePreferences(prefs: UserRecallPreferences): Promise<SaveResult> {
  return persistence.save(prefs);
}

/**
 * The same save, answered as soon as the LOCAL copy is written (2026-09-30,
 * the one-page Edit preferences): resolves with the stored value once the
 * device holds it, and rejects only if that local write fails. The mirror
 * follows on its own, with the same dirty flag and retry.
 */
export function commitPreferences(prefs: UserRecallPreferences): Promise<UserRecallPreferences> {
  return persistence.commit(prefs);
}

/**
 * The stored preferences, read AFTER every write requested before this call
 * has landed (2026-10-04): what a screen that opens a draft over another
 * (the editor over Ready) reads, so a toggle still in the queue can never be
 * missed and then reverted by Save.
 */
export function loadPreferencesSettled(): Promise<UserRecallPreferences> {
  return persistence.readSettled();
}

/**
 * Told every value this device commits, as soon as it is written locally, so
 * a screen already showing preferences (Ready, under the editor it opened)
 * shows the saved value at once instead of the one it last read. Returns the
 * unsubscribe.
 */
export function onPreferencesSaved(listener: (prefs: UserRecallPreferences) => void): () => void {
  return persistence.onSaved(listener);
}

persistence.onSaved((prefs) => {
  known = prefs;
});

/**
 * Mirror again while a previous sync is still owed (called once at app
 * launch). No-op when the last mirror landed; silent — launch is never
 * blocked. Queued (C7.1) so a launch-time flush can never interleave with a
 * save or with data deletion.
 */
export function flushPreferencesSync(): Promise<void> {
  return persistence.flush();
}

/**
 * Record the shopper's allergen consent decision (2026-10-13) and mirror its
 * effect: a grant sends the allergens with the consent version; a decline or
 * withdrawal sends none, which removes the server copy. The mirror is marked
 * owed first, so an offline change is retried like any save.
 */
export async function setAllergenConsentDecision(
  decision: AllergenConsentDecision,
  options: {
    /**
     * The disclosure the shopper answered (`ALLERGEN_CONSENT_VERSIONS`). By
     * default the long one; a withdrawal keeps the version of the decision
     * it replaces, so the record still says which text was accepted.
     */
    version?: string;
    /**
     * Called once the decision is recorded on this iPhone, before the server
     * mirror runs: onboarding advances here instead of waiting on the network.
     */
    onRecorded?: () => void;
  } = {},
): Promise<SaveResult> {
  // Strict: a decision is never timed without the previous one, or a clock
  // behind it could make a withdrawal look older than the grant it replaces.
  const prior = await loadAllergenConsentStrict();
  await saveAllergenConsent({
    decision,
    version:
      options.version ??
      (decision === 'withdrawn' ? prior?.version : undefined) ??
      ALLERGEN_CONSENT_VERSION,
    // Strictly later than the previous decision, even if the clock moved
    // back: the server orders decisions by this time (20261014000000).
    at: nextDecisionTime(prior, new Date()),
  });
  options.onRecorded?.();
  return persistence.touch();
}

/**
 * Whether the server has yet to receive the newest preferences or consent
 * (2026-10-13): drives "removal pending" on Privacy & Data Controls.
 */
export function allergenServerSyncPending(): Promise<boolean> {
  return persistence.mirrorOwed();
}

/**
 * Re-send the newest local preferences to the server mirror, once (the
 * daily foreground check-in, 2026-10-12): recreates a row deleted for
 * inactivity; a no-op RPC when the row is intact. Queued like every write.
 */
export function remirrorPreferences(): Promise<void> {
  return persistence.remirror();
}

/**
 * The reset's guard (C7.1, 2026-10-04): inside the reset's own queue turn,
 * before the server deletion, drop any pending mirror request and wait for
 * the run in flight, so nothing written under the old installation id can
 * land after its rows are deleted.
 */
export function settlePreferenceMirror(): Promise<void> {
  return persistence.settleMirror();
}

/**
 * Remove the locally persisted preference state — the preference blob and
 * the retry flag (C7.1 reset). Local-only: never touches the server, and
 * deliberately NOT queued — the reset orchestrator calls it inside its own
 * queue turn, after the server deletion for the old id succeeded.
 */
export async function deleteLocalPreferenceState(): Promise<void> {
  await SecureStore.deleteItemAsync(PREFS_KEY);
  await SecureStore.deleteItemAsync(DIRTY_KEY);
}
