/**
 * Reads one customer's `premium` entitlement from RevenueCat's REST API v2,
 * for the alert entitlement gate (entitlement.ts). Server-only.
 *
 *   GET https://api.revenuecat.com/v2/projects/{project_id}/customers/{purchase_id}/active_entitlements
 *   Authorization: Bearer <v2 secret key, customer_information:customers:read only>
 *
 * The response lists active entitlements by RevenueCat's internal
 * `entitlement_id` (not the `premium` lookup key), with `expires_at` in epoch
 * milliseconds (null for a non-expiring grant). So the job is configured with
 * the project id and premium's entitlement id. Neither is a secret; the key is.
 *
 * The purchase id is BEARER-SENSITIVE (it unlocks the entitlement in the
 * RevenueCat SDK). It appears only in the request path. No error message
 * built here contains it, the URL, or a response body.
 *
 * Outcomes:
 *   200          the observation (active iff premium's id is listed)
 *   404          the customer does not exist, so not entitled (definitive)
 *   anything else, a network error or a timeout:
 *                RevenueCatUnavailableError. The caller writes nothing, and
 *                the staleness gate holds alerts once the cached status is
 *                too old (fail closed).
 */

import type { EntitlementObservation } from './entitlement';

const API_BASE = 'https://api.revenuecat.com/v2';
const DEFAULT_TIMEOUT_MS = 10_000;

export class RevenueCatUnavailableError extends Error {
  constructor(
    detail: string,
    /** RevenueCat answered 429: the caller stops checking for this run. */
    readonly rateLimited = false,
  ) {
    super(`RevenueCat entitlement check failed (${detail})`);
    this.name = 'RevenueCatUnavailableError';
  }
}

/** The worker's view: one purchase id in, one observation out (or a throw). */
export interface EntitlementSource {
  check(purchaseId: string): Promise<EntitlementObservation>;
}

export interface RevenueCatEntitlementConfig {
  secretKey: string;
  projectId: string;
  /** RevenueCat's internal id of the `premium` entitlement. */
  premiumEntitlementId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const PURCHASE_ID_SHAPE = /^[A-Za-z0-9-]{16,64}$/;
const PROJECT_ID_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;

interface ActiveEntitlementList {
  items?: { entitlement_id?: unknown; expires_at?: unknown }[];
}

export function revenueCatEntitlementSource(
  config: RevenueCatEntitlementConfig,
): EntitlementSource {
  if (!PROJECT_ID_SHAPE.test(config.projectId)) {
    throw new Error('REVENUECAT_PROJECT_ID is malformed');
  }
  if (!PROJECT_ID_SHAPE.test(config.premiumEntitlementId)) {
    throw new Error('REVENUECAT_PREMIUM_ENTITLEMENT_ID is malformed');
  }
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async check(purchaseId) {
      // The stored shape is enforced by the database; re-checked so nothing
      // else can ever be interpolated into the path.
      if (!PURCHASE_ID_SHAPE.test(purchaseId)) {
        throw new RevenueCatUnavailableError('malformed purchase id');
      }
      const url =
        `${API_BASE}/projects/${config.projectId}/customers/` +
        `${encodeURIComponent(purchaseId)}/active_entitlements`;
      let response: Response;
      try {
        response = await fetchImpl(url, {
          headers: { authorization: `Bearer ${config.secretKey}`, accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        // Never the error's own message: a fetch failure can quote the URL.
        const kind =
          error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network';
        throw new RevenueCatUnavailableError(kind);
      }
      if (response.status === 404) return { active: false, expiresAt: null };
      if (!response.ok) {
        throw new RevenueCatUnavailableError(`HTTP ${response.status}`, response.status === 429);
      }

      let body: ActiveEntitlementList;
      try {
        body = (await response.json()) as ActiveEntitlementList;
      } catch {
        throw new RevenueCatUnavailableError('unreadable response');
      }
      if (!body || !Array.isArray(body.items)) {
        throw new RevenueCatUnavailableError('unexpected response shape');
      }
      const premium = body.items.find(
        (item) => item.entitlement_id === config.premiumEntitlementId,
      );
      if (!premium) return { active: false, expiresAt: null };
      const expiresMs = premium.expires_at;
      if (expiresMs === null || expiresMs === undefined) {
        // A non-expiring grant: active, with no known expiry, which the gate
        // refuses (as the app does).
        return { active: true, expiresAt: null };
      }
      if (typeof expiresMs !== 'number' || !Number.isFinite(expiresMs)) {
        throw new RevenueCatUnavailableError('unexpected expiry');
      }
      return { active: true, expiresAt: new Date(expiresMs).toISOString() };
    },
  };
}

/**
 * The job's source, from the server environment (GitHub `production`
 * environment, `jobs:push` steps only; never EAS, never the app):
 *   REVENUECAT_SECRET_KEY               v2 secret key, customer_information:customers:read
 *   REVENUECAT_PROJECT_ID               not secret
 *   REVENUECAT_PREMIUM_ENTITLEMENT_ID   not secret: premium's internal id
 * Any missing or malformed value returns null: every alert is held and the
 * run says so (fail closed). The key's value is never printed.
 */
export function entitlementSourceFromEnv(
  env: Record<string, string | undefined>,
): EntitlementSource | null {
  const secretKey = env.REVENUECAT_SECRET_KEY;
  const projectId = env.REVENUECAT_PROJECT_ID;
  const premiumEntitlementId = env.REVENUECAT_PREMIUM_ENTITLEMENT_ID;
  if (!secretKey || !projectId || !premiumEntitlementId) return null;
  try {
    return revenueCatEntitlementSource({ secretKey, projectId, premiumEntitlementId });
  } catch (error) {
    console.warn(
      `  ${error instanceof Error ? error.message : 'RevenueCat configuration invalid'}`,
    );
    return null;
  }
}
