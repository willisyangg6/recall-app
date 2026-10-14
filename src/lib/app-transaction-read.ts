/**
 * Reading StoreKit's appTransactionId with a time limit (2026-10-13).
 *
 * The id decides a regulated 13–17 user's registration route
 * (lib/revocation-key.ts), and that registration runs inside the shared
 * installation mutation queue — the same queue as preference saves and
 * "Reset app and delete my data". `AppTransaction.shared` is a native call
 * with no cancellation; if it stalls, an unbounded await would hold the
 * queue and everything behind it.
 *
 * The rule:
 *
 * - The read answers within `timeoutMs`, always. A timeout, a rejection, a
 *   missing module or a missing id all answer `null`. There is no fallback
 *   identifier: `null` makes the route `blocked`, so a regulated teen's
 *   alerts stay OFF through the existing disable and retry behavior.
 * - One native call at a time. A call still pending is SHARED by later reads
 *   (each with its own time limit), so retries against a stalled StoreKit do
 *   not pile up native calls.
 * - Late completion is inert. A call that settles after its reader gave up
 *   only clears the in-flight slot; its value is never acted on, and a late
 *   rejection is swallowed. The next read — the next registration attempt —
 *   starts a fresh call.
 *
 * A leaf: no React, no native imports; the native wiring is
 * push-registration.ts.
 */

export const APP_TRANSACTION_TIMEOUT_MS = 5_000;

export interface AppTransactionReadDeps {
  /** The native read (modules/app-transaction). May never settle. */
  read(): Promise<{ appTransactionId?: string | null } | null>;
  timeoutMs?: number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export function boundedAppTransactionRead(
  deps: AppTransactionReadDeps,
): () => Promise<string | null> {
  const timeoutMs = deps.timeoutMs ?? APP_TRANSACTION_TIMEOUT_MS;
  const setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer =
    deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let inFlight: Promise<string | null> | null = null;

  const start = (): Promise<string | null> => {
    let call: Promise<{ appTransactionId?: string | null } | null>;
    try {
      call = deps.read();
    } catch {
      call = Promise.resolve(null);
    }
    const settled = call.then(
      (info) => {
        const id = info?.appTransactionId;
        return typeof id === 'string' && id.length > 0 ? id : null;
      },
      () => null,
    );
    // Whenever the call settles — on time or late — the slot frees up, so
    // the next read starts a fresh call. Only the call that owns the slot
    // clears it.
    inFlight = settled;
    void settled.then(() => {
      if (inFlight === settled) inFlight = null;
    });
    return settled;
  };

  return () => {
    const call = inFlight ?? start();
    return new Promise<string | null>((resolve) => {
      const handle = setTimer(() => resolve(null), timeoutMs);
      void call.then((id) => {
        clearTimer(handle);
        resolve(id);
      });
    });
  };
}
