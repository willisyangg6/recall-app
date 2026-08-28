/**
 * Watchdog state loading + presentation, shared by `npm run ops:health` and
 * `npm run scheduler:status` so the two can never drift apart. Read-only by
 * construction: every query is a SELECT; classification is summarizeWatchdog
 * (./health.ts, pure and tested).
 */

import { summarizeWatchdog, type WatchdogHealthInput, type WatchdogSummary } from './health';

/**
 * The slice of a supabase-js client this module reads with. Callers pass the
 * real client via `asWatchdogQueryClient` — a structural check of the full
 * supabase-js builder generics against this interface sends tsc into deep
 * instantiation, so the boundary is an explicit cast instead.
 */
export interface QueryClient {
  from(table: string): {
    select(columns: string): {
      limit(
        count: number,
      ): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
      eq(
        column: string,
        value: unknown,
      ): {
        order(
          column: string,
          opts: { ascending: boolean },
        ): {
          limit(
            count: number,
          ): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
        };
      };
      order(
        column: string,
        opts: { ascending: boolean },
      ): {
        limit(
          count: number,
        ): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
      };
    };
  };
}

/** Boundary cast for a real supabase-js client (see QueryClient docs). */
export function asWatchdogQueryClient(client: { from(table: string): unknown }): QueryClient {
  return client as QueryClient;
}

export interface WatchdogReport {
  summary: WatchdogSummary;
  input: WatchdogHealthInput;
  lastInvocation: {
    invokedAt: string;
    decision: string;
    staleSources: string[];
    errorClass: string | null;
  } | null;
}

interface ConfigRow {
  enabled: boolean;
  installed_at: string;
  github_token_expires_at: string | null;
  cooldown_minutes: number;
}

interface InvocationRow {
  invoked_at: string;
  decision: string;
  stale_sources: string[] | null;
  error_class: string | null;
}

interface DispatchRow {
  claimed_at: string;
  status: string;
  github_run_id: number | null;
  error_class: string | null;
  finalized_at: string | null;
}

/**
 * @returns the report, or null when the watchdog tables do not exist yet
 * (scheduler_watchdog migration pending — the pre-activation state). Any
 * other database failure throws.
 */
export async function loadWatchdogReport(
  client: QueryClient,
  nowMs: number,
): Promise<WatchdogReport | null> {
  const configResult = await client
    .from('watchdog_config')
    .select('enabled, installed_at, github_token_expires_at, cooldown_minutes')
    .limit(1);
  if (configResult.error) {
    if (/watchdog_config/.test(configResult.error.message)) return null;
    throw new Error(`watchdog_config query failed: ${configResult.error.message}`);
  }
  const config = (configResult.data?.[0] as ConfigRow | undefined) ?? null;

  const invocationResult = await client
    .from('watchdog_invocations')
    .select('invoked_at, decision, stale_sources, error_class')
    .eq('probe', false)
    .order('invoked_at', { ascending: false })
    .limit(1);
  if (invocationResult.error) {
    throw new Error(`watchdog_invocations query failed: ${invocationResult.error.message}`);
  }
  const invocation = (invocationResult.data?.[0] as InvocationRow | undefined) ?? null;

  const dispatchResult = await client
    .from('watchdog_dispatches')
    .select('claimed_at, status, github_run_id, error_class, finalized_at')
    .order('claimed_at', { ascending: false })
    .limit(25);
  if (dispatchResult.error) {
    throw new Error(`watchdog_dispatches query failed: ${dispatchResult.error.message}`);
  }
  const dispatches = (dispatchResult.data ?? []) as DispatchRow[];

  const lastAccepted = dispatches.find((row) => row.status === 'accepted') ?? null;
  const lastFailure = dispatches.find((row) => row.status === 'failed') ?? null;
  // Failed dispatches newer than the last accepted one; in-flight 'claimed'
  // rows are neither success nor failure and do not break the streak.
  let consecutiveFailures = 0;
  for (const row of dispatches) {
    if (row.status === 'accepted') break;
    if (row.status === 'failed') consecutiveFailures += 1;
  }

  const input: WatchdogHealthInput = {
    installed: true,
    config: config
      ? {
          enabled: config.enabled,
          installedAt: config.installed_at,
          githubTokenExpiresAt: config.github_token_expires_at,
        }
      : null,
    lastHeartbeatAt: invocation?.invoked_at ?? null,
    lastDecision: invocation?.decision ?? null,
    lastErrorClass: invocation?.error_class ?? null,
    lastAccepted: lastAccepted
      ? { claimedAt: lastAccepted.claimed_at, githubRunId: lastAccepted.github_run_id }
      : null,
    lastFailure: lastFailure
      ? {
          finalizedAt: lastFailure.finalized_at ?? lastFailure.claimed_at,
          errorClass: lastFailure.error_class,
        }
      : null,
    consecutiveFailures,
    acceptedGraceMinutes: config?.cooldown_minutes ?? 20,
  };

  return {
    summary: summarizeWatchdog(input, nowMs),
    input,
    lastInvocation: invocation
      ? {
          invokedAt: invocation.invoked_at,
          decision: invocation.decision,
          staleSources: invocation.stale_sources ?? [],
          errorClass: invocation.error_class,
        }
      : null,
  };
}

/** The section body, one format for ops:health and scheduler:status. */
export function formatWatchdogSection(report: WatchdogReport | null): string[] {
  if (!report) {
    return ['  status:              not installed (scheduler_watchdog migration pending)'];
  }
  const { summary, input, lastInvocation } = report;
  const lines: string[] = [`  status:              ${summary.status}`];
  lines.push(
    `  last heartbeat:      ${input.lastHeartbeatAt ?? '— (no cron invocation recorded)'}`,
  );
  lines.push(
    `  last decision:       ${
      lastInvocation
        ? `${lastInvocation.decision}${
            lastInvocation.staleSources.length
              ? ` (stale: ${lastInvocation.staleSources.join(', ')})`
              : ''
          }`
        : '—'
    }`,
  );
  lines.push(
    `  last accepted dispatch: ${
      input.lastAccepted
        ? `${input.lastAccepted.claimedAt}${
            input.lastAccepted.githubRunId ? ` (run ${input.lastAccepted.githubRunId})` : ''
          }`
        : '—'
    }`,
  );
  lines.push(
    `  last dispatch failure:  ${
      input.lastFailure
        ? `${input.lastFailure.finalizedAt}${
            input.lastFailure.errorClass ? ` (${input.lastFailure.errorClass})` : ''
          }`
        : '—'
    }`,
  );
  lines.push(`  consecutive failures: ${input.consecutiveFailures}`);
  lines.push(`  token expiration:    ${input.config?.githubTokenExpiresAt ?? 'not recorded'}`);
  for (const note of summary.notes) lines.push(`    · ${note}`);
  return lines;
}
