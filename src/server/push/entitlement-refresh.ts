/**
 * The entitlement refresh: the first step of every ACTIVATED push run, before
 * any event is matched (worker.ts). Rules and delays: entitlement.ts.
 *
 * It refreshes every enabled registration that carries a purchase id and is
 * due (needsRefresh). It runs on that fixed schedule, never because a recall
 * matched someone: a match-triggered check would let RevenueCat infer when a
 * customer's alerts matched a recall (for allergen alerts, health-adjacent).
 * RevenueCat learns only that the customer has alerts on.
 *
 * Bounded per run (MAX_CHECKS_PER_RUN, oldest-checked first) to stay inside
 * RevenueCat's documented 480 requests per minute for customer information,
 * and a 429 ends the run's checking at once.
 * Rows beyond the budget wait for the next run. If they age past the
 * staleness limit, their alerts are held (delayed, never sent on an
 * unverified status).
 *
 * A failed check writes nothing (fail closed). The purchase id never reaches
 * a log, a metric or an error string: only counts leave this module.
 */

import { needsRefresh, nextEntitlement, type SubscriptionEntitlement } from './entitlement';
import { RevenueCatUnavailableError, type EntitlementSource } from './revenuecat-entitlement';
import type { PushStore } from './types';

/** Sequential checks per run; about 1 minute at RevenueCat's measured latency. */
export const MAX_CHECKS_PER_RUN = 400;

export interface EntitlementRefreshMetrics {
  /** 'unconfigured' means no source: every registration is held (fail closed). */
  entitlementSource: 'revenuecat' | 'unconfigured';
  entitlementRowsDue: number;
  entitlementChecks: number;
  entitlementActive: number;
  entitlementInactive: number;
  entitlementCheckFailures: number;
  /** Due rows left for the next run by the per-run budget. */
  entitlementDeferred: number;
  /** Checks whose write did not land: the row was disabled or re-registered meanwhile. */
  entitlementNotLanded: number;
}

export interface EntitlementRefreshResult {
  metrics: EntitlementRefreshMetrics;
  /** The entitlement each refreshed subscription now has (written unless a dry run). */
  updated: Map<string, SubscriptionEntitlement>;
  /** Payload-free diagnostics: never a purchase id. */
  errors: string[];
}

export async function refreshEntitlements(
  store: PushStore,
  source: EntitlementSource | null,
  options: { nowIso: string; dryRun: boolean; maxChecks?: number },
): Promise<EntitlementRefreshResult> {
  const metrics: EntitlementRefreshMetrics = {
    entitlementSource: source ? 'revenuecat' : 'unconfigured',
    entitlementRowsDue: 0,
    entitlementChecks: 0,
    entitlementActive: 0,
    entitlementInactive: 0,
    entitlementCheckFailures: 0,
    entitlementDeferred: 0,
    entitlementNotLanded: 0,
  };
  const updated = new Map<string, SubscriptionEntitlement>();
  const errors: string[] = [];
  if (source === null) {
    console.warn(
      '  Entitlement check NOT CONFIGURED (REVENUECAT_SECRET_KEY / REVENUECAT_PROJECT_ID / ' +
        'REVENUECAT_PREMIUM_ENTITLEMENT_ID): every alert is held.',
    );
    return { metrics, updated, errors };
  }

  const due = (await store.listEntitlementRefreshRows()).filter((row) =>
    needsRefresh(row.entitlement, options.nowIso),
  );
  metrics.entitlementRowsDue = due.length;
  const budget = options.maxChecks ?? MAX_CHECKS_PER_RUN;
  metrics.entitlementDeferred = Math.max(0, due.length - budget);

  const batch = due.slice(0, budget);
  for (const [index, row] of batch.entries()) {
    let next: SubscriptionEntitlement;
    try {
      const observation = await source.check(row.purchaseId);
      next = nextEntitlement(row.entitlement, observation, options.nowIso);
    } catch (error) {
      metrics.entitlementCheckFailures += 1;
      if (error instanceof RevenueCatUnavailableError && error.rateLimited) {
        // Rate limited: stop asking this run. The rest wait for the next run,
        // and the staleness gate keeps their alerts held if it comes to that.
        metrics.entitlementDeferred += batch.length - index - 1;
        if (!errors.includes(error.message)) errors.push(error.message);
        break;
      }
      // RevenueCatUnavailableError messages are built payload-free; anything
      // else is reduced to its name so no value can ride along.
      const detail =
        error instanceof Error && error.name === 'RevenueCatUnavailableError'
          ? error.message
          : `entitlement check failed (${error instanceof Error ? error.name : 'error'})`;
      if (!errors.includes(detail)) errors.push(detail);
      continue;
    }
    metrics.entitlementChecks += 1;
    if (next.status === 'active') metrics.entitlementActive += 1;
    else metrics.entitlementInactive += 1;
    if (options.dryRun) {
      updated.set(row.subscriptionId, next);
      continue;
    }
    if (await store.recordEntitlement(row.subscriptionId, row.purchaseId, next)) {
      updated.set(row.subscriptionId, next);
    } else {
      metrics.entitlementNotLanded += 1;
    }
  }
  return { metrics, updated, errors };
}
