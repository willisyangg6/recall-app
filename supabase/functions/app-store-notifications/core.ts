/**
 * app-store-notifications — the decision logic (portable TypeScript, no
 * imports; tested by the Node suite in src/server/app-store-notifications/).
 * The Deno adapter (./index.ts) wires the WebCrypto verifier
 * (./apple-jws.ts), the service-role RPC and Deno.serve.
 *
 * ## What it receives
 *
 * App Store Server Notifications V2: `POST {"signedPayload": "<JWS>"}`.
 * Apple allows ONE notification URL per environment, and Lotly's is
 * RevenueCat's — it must stay RevenueCat's, because RevenueCat keeps
 * subscriptions correct from it. So this endpoint is RevenueCat's
 * "Apple Server Notification Forwarding URL" (path A in
 * docs/recall-privacy-program-proposal.md §2.6): it receives every
 * notification type RevenueCat forwards, and acts on exactly one.
 *
 * ## What it does
 *
 *   1. Verify the JWS (./apple-jws.ts, held equal to Apple's library by
 *      test): the x5c chain to the pinned
 *      Apple Root CA - G3, Apple's marker OIDs on the intermediate and leaf,
 *      the signature, the bundle id, the environment (and in Production the
 *      app's Apple id). Anything that fails is refused (401) and changes
 *      nothing.
 *   2. Any type other than RESCIND_CONSENT: 200, nothing stored.
 *   3. RESCIND_CONSENT: verify `appData.signedAppTransactionInfo` the same
 *      way, take its `appTransactionId`, and call `apply_consent_revocation`,
 *      which records the notification's UUID (replay protection) and
 *      disables the alert subscriptions whose keyed hash matches — in one
 *      transaction. A duplicate is a 200 that changes nothing. A database
 *      failure is a 500, so the sender retries.
 *
 * Nothing identifying is logged or returned: no ids, no hashes, no payload.
 */

export type AppStoreEnvironment = 'Sandbox' | 'Production';

export const RESCIND_CONSENT = 'RESCIND_CONSENT';

/** A request body larger than this is refused unread (Apple's are a few KB). */
export const MAX_BODY_BYTES = 64 * 1024;

/** The fields of a verified notification this endpoint reads. */
export interface VerifiedNotification {
  notificationType?: string;
  notificationUUID?: string;
  signedDate?: number;
  appData?: {
    environment?: string;
    signedAppTransactionInfo?: string;
  };
}

/** The verifier contract (Apple's SignedDataVerifier shape; one per environment). */
export interface NotificationVerifier {
  verifyAndDecodeNotification(signedPayload: string): Promise<VerifiedNotification>;
  verifyAndDecodeAppTransaction(
    signedAppTransaction: string,
  ): Promise<{ appTransactionId?: string }>;
}

export interface AppStoreNotificationDeps {
  /** Only environments with a verifier are accepted. */
  verifiers: Partial<Record<AppStoreEnvironment, NotificationVerifier>>;
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: string | null }>;
  log: (line: string) => void;
}

export interface EndpointResponse {
  status: number;
  body: { ok: boolean; reason?: string };
}

const refuse = (status: number, reason: string): EndpointResponse => ({
  status,
  body: { ok: false, reason },
});

/**
 * The environment the payload CLAIMS, read before verification only to pick
 * the verifier; the verifier then checks the claim against the signature.
 */
export function claimedEnvironment(signedPayload: string): AppStoreEnvironment | null {
  const part = signedPayload.split('.')[1];
  if (!part) return null;
  try {
    const json = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
      ),
    ) as Record<string, { environment?: unknown } | undefined>;
    const environment =
      json.data?.environment ?? json.summary?.environment ?? json.appData?.environment;
    return environment === 'Sandbox' || environment === 'Production' ? environment : null;
  } catch {
    return null;
  }
}

export async function handleAppStoreNotification(
  request: { method: string; body: string },
  deps: AppStoreNotificationDeps,
): Promise<EndpointResponse> {
  if (request.method !== 'POST') return refuse(405, 'method');
  if (request.body.length > MAX_BODY_BYTES) return refuse(413, 'size');

  let signedPayload: unknown;
  try {
    signedPayload = (JSON.parse(request.body) as { signedPayload?: unknown }).signedPayload;
  } catch {
    return refuse(400, 'body');
  }
  if (typeof signedPayload !== 'string' || signedPayload.length === 0) {
    return refuse(400, 'body');
  }

  const environment = claimedEnvironment(signedPayload);
  const verifier = environment ? deps.verifiers[environment] : undefined;
  if (!environment || !verifier) {
    deps.log(`refused: environment ${environment ?? 'unknown'} not accepted`);
    return refuse(400, 'environment');
  }

  let notification: VerifiedNotification;
  try {
    notification = await verifier.verifyAndDecodeNotification(signedPayload);
  } catch {
    deps.log(`refused: ${environment} notification failed verification`);
    return refuse(401, 'verification');
  }

  const type = notification.notificationType ?? 'UNKNOWN';
  if (type !== RESCIND_CONSENT) {
    deps.log(`ignored: ${type} (${environment})`);
    return { status: 200, body: { ok: true } };
  }

  const signedTransaction = notification.appData?.signedAppTransactionInfo;
  if (
    typeof notification.notificationUUID !== 'string' ||
    typeof notification.signedDate !== 'number' ||
    typeof signedTransaction !== 'string'
  ) {
    deps.log(`refused: ${type} (${environment}) is missing a required field`);
    return refuse(400, 'fields');
  }

  let appTransactionId: string | undefined;
  try {
    appTransactionId = (await verifier.verifyAndDecodeAppTransaction(signedTransaction))
      .appTransactionId;
  } catch {
    deps.log(`refused: ${type} (${environment}) app transaction failed verification`);
    return refuse(401, 'verification');
  }
  if (typeof appTransactionId !== 'string' || appTransactionId.length === 0) {
    deps.log(`refused: ${type} (${environment}) has no app transaction id`);
    return refuse(400, 'fields');
  }

  const { data, error } = await deps.rpc('apply_consent_revocation', {
    p_notification_uuid: notification.notificationUUID,
    p_notification_type: type,
    p_environment: environment,
    p_signed_at: new Date(notification.signedDate).toISOString(),
    p_app_transaction_id: appTransactionId,
  });
  if (error !== null) {
    // Not recorded (the RPC is one transaction): the sender's retry applies it.
    deps.log(`failed: ${type} (${environment}) could not be applied`);
    return refuse(500, 'apply');
  }
  const result = (data ?? {}) as { duplicate?: unknown; disabled?: unknown };
  deps.log(
    `applied: ${type} (${environment}) duplicate=${String(result.duplicate)} disabled=${String(result.disabled)}`,
  );
  return { status: 200, body: { ok: true } };
}
