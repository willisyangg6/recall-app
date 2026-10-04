/**
 * The alert registration protocol (2026-10-04): what this installation
 * WANTS on the server, what it KNOWS the server holds, and the sequence
 * that keeps the two from crossing — a leaf with no Expo and no I/O of its
 * own, so every ordering is provable in Node against the server rule's
 * mirror (src/server/push/memory-push-store.ts).
 *
 * ## The problem it closes
 *
 * A registration the shopper abandoned — the education's 10 s deadline, or
 * `Continue without alerts` while the write was in flight — may have
 * committed on the server in the instant before the client gave up. The
 * client sees a failure and writes no local flag; the server holds an
 * ENABLED subscription nobody asked for. A bare "best-effort disable" is
 * not enough: the disable can reach the server BEFORE the delayed
 * registration (and be undone by it), or AFTER a newer registration the
 * shopper retried successfully (and silence it).
 *
 * ## The rule
 *
 * Every write to the subscription carries a sequence from one persisted,
 * monotonic counter per installation; the server applies a write only when
 * no higher sequence has been applied (the push_subscription_sequence
 * migration). The client's side of the contract:
 *
 * - A registration whose outcome is UNKNOWN (aborted, timed out, network
 *   error, a gateway 5xx) is followed by a disable with the NEXT sequence:
 *   it outranks the registration whether the registration landed before
 *   it, after it, or never. A registration the server REFUSED (a 4xx)
 *   committed nothing and needs no cleanup.
 * - That cleanup is `pending` until a disable carrying its sequence (or a
 *   later one) is confirmed, or a LATER registration is confirmed — then
 *   the server state is known again and the cleanup is obsolete; if it is
 *   still in flight it is refused by the server as outranked.
 * - A cleanup that cannot be sent (offline) stays pending in storage and is
 *   retried at the next launch and before the next registration.
 * - A registration interrupted by a crash leaves `inFlight` in storage; the
 *   next launch treats it as unknown and cleans it up the same way.
 * - The local enabled flag is written only after a CONFIRMED registration
 *   and cleared before any disable is sent, so nothing ever reports a
 *   server state it does not know.
 *
 * The caller serializes every operation on the installation mutation queue;
 * this leaf assumes one operation runs at a time against its storage.
 */

export interface AlertIntentState {
  /** The last sequence issued; every write carries the next one. */
  sequence: number;
  /** A registration is confirmed and no disable has been issued since. */
  enabled: boolean;
  /** A disable not yet confirmed, by the sequence it carries; null when settled. */
  pending: number | null;
  /** A registration sent and not yet answered, by its sequence; null otherwise. */
  inFlight: number | null;
}

export const INITIAL_ALERT_INTENT: AlertIntentState = {
  sequence: 0,
  enabled: false,
  pending: null,
  inFlight: null,
};

/** The server's answer to a sequenced write (push-api `SequencedWriteResult`). */
export interface WriteDecision {
  /** False when the server refused the write as outranked. */
  applied: boolean;
  /** The sequence the server now holds for this installation. */
  lastSequence: number;
}

export interface AlertIntentPorts {
  /** The persisted state; null when nothing was ever stored. */
  load(): Promise<AlertIntentState | null>;
  save(state: AlertIntentState): Promise<void>;
  /** The server registration carrying `sequence`; rejects on any failure. */
  register(sequence: number, signal?: AbortSignal): Promise<WriteDecision>;
  /** The server disable carrying `sequence`; rejects on any failure. */
  disable(sequence: number): Promise<WriteDecision>;
  /** True when the server certainly refused the write (nothing committed). */
  isDefiniteRejection(error: unknown): boolean;
}

export function parseAlertIntent(raw: string | null): AlertIntentState | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<AlertIntentState>;
    const int = (n: unknown): number | null =>
      typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null;
    const sequence = int(value.sequence);
    if (sequence === null) return null;
    return {
      sequence,
      enabled: value.enabled === true,
      pending: int(value.pending),
      inFlight: int(value.inFlight),
    };
  } catch {
    return null;
  }
}

export function serializeAlertIntent(state: AlertIntentState): string {
  return JSON.stringify(state);
}

export interface AlertIntent {
  /**
   * The deliberate enable: register with the next sequence. Resolves only
   * when the server confirmed; rejects with the port's error otherwise —
   * after cleaning up, best-effort, a registration whose outcome is unknown.
   */
  register(signal?: AbortSignal): Promise<void>;
  /**
   * The silent refresh of a confirmed registration (token rotation, launch):
   * the next sequence, failure swallowed — the server state wanted is the
   * one already held, so a late landing changes nothing it should not.
   */
  refresh(signal?: AbortSignal): Promise<void>;
  /** The deliberate disable: the local flag first, then the server, retried if offline. */
  disable(): Promise<void>;
  /**
   * At launch: turn a crashed registration into a pending cleanup, then send
   * whatever cleanup is pending. Never throws.
   */
  reconcile(): Promise<void>;
  /** The persisted state, for readers. */
  state(): Promise<AlertIntentState>;
}

export function alertIntent(ports: AlertIntentPorts): AlertIntent {
  const load = async (): Promise<AlertIntentState> =>
    (await ports.load()) ?? { ...INITIAL_ALERT_INTENT };

  /**
   * Send a pending cleanup; on failure it stays pending. The record is
   * re-read before the cleanup is marked settled, so a slow confirmation
   * never writes back a snapshot older than the current record.
   */
  const settle = async (state: AlertIntentState): Promise<AlertIntentState> => {
    const sequence = state.pending;
    if (sequence === null) return state;
    let decision: WriteDecision;
    try {
      decision = await ports.disable(sequence);
    } catch {
      return state;
    }
    // Applied, or refused because this installation has since written
    // something newer (only this client writes for its id): either way the
    // server's state is known and nothing is owed any more.
    const latest = await load();
    if (latest.pending !== sequence) return latest;
    const settled = {
      ...latest,
      pending: null,
      sequence: Math.max(latest.sequence, decision.lastSequence),
    };
    await ports.save(settled);
    return settled;
  };

  const send = async (
    state: AlertIntentState,
    signal: AbortSignal | undefined,
    /**
     * False for a refresh: the state wanted is the confirmed one already
     * held, so an unknown outcome needs no cleanup — a late landing only
     * re-asserts it, and a later disable outranks it anyway.
     */
    cleanupOnUnknown: boolean,
    /** One retry after a refusal, with the server's count adopted. */
    adopted = false,
  ): Promise<void> => {
    const sequence = state.sequence + 1;
    let current: AlertIntentState = { ...state, sequence, inFlight: sequence };
    await ports.save(current);
    let decision: WriteDecision;
    try {
      decision = await ports.register(sequence, signal);
    } catch (error) {
      current = { ...current, inFlight: null };
      if (cleanupOnUnknown && !ports.isDefiniteRejection(error)) {
        // The write may land at any moment, or may have landed already: a
        // disable with the next sequence outranks it either way. Confirmed
        // later, or at the next launch, if it cannot be sent now.
        const cleanup = current.sequence + 1;
        current = { ...current, sequence: cleanup, pending: cleanup, enabled: false };
        await ports.save(current);
        await settle(current);
      } else {
        await ports.save(current);
      }
      throw error;
    }
    if (!decision.applied) {
      // Refused: the server holds a higher count than this record — the
      // persisted counter was lost or is behind. Nothing was committed.
      // Adopt the server's count and send once more, ahead of it.
      current = {
        ...current,
        inFlight: null,
        sequence: Math.max(current.sequence, decision.lastSequence),
      };
      await ports.save(current);
      if (adopted) throw new Error('Registration refused: the server holds a newer write.');
      await send(current, signal, cleanupOnUnknown, true);
      return;
    }
    // Confirmed: the server holds this registration, and any older cleanup
    // still in flight is outranked by it.
    await ports.save({ ...current, inFlight: null, pending: null, enabled: true });
  };

  return {
    async register(signal) {
      const state = await settle(await load());
      await send(state, signal, true);
    },
    async refresh(signal) {
      const state = await load();
      if (!state.enabled || state.pending !== null) return;
      try {
        await send(state, signal, false);
      } catch {
        // Best-effort: the state wanted is unchanged.
      }
    },
    async disable() {
      const state = await load();
      const sequence = state.sequence + 1;
      const next: AlertIntentState = {
        ...state,
        sequence,
        enabled: false,
        pending: sequence,
        inFlight: null,
      };
      await ports.save(next);
      await settle(next);
    },
    async reconcile() {
      let state = await load();
      if (state.inFlight !== null) {
        // Interrupted before an answer: treat as unknown.
        const sequence = state.sequence + 1;
        state = state.enabled
          ? { ...state, inFlight: null }
          : { ...state, sequence, inFlight: null, pending: sequence };
        await ports.save(state);
      }
      await settle(state);
    },
    state: load,
  };
}
