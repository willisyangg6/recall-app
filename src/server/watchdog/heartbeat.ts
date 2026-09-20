/**
 * The dead-man heartbeat decision (P2B7S) — provider-agnostic, pure, and
 * NOT ACTIVATED.
 *
 * ## The gap it closes
 *
 * Every existing alarm lives inside the thing it is watching. `ops:health`
 * and `scheduler:status` only speak when the founder runs them. GitHub's
 * failure email only fires when a workflow RUNS and fails. The Supabase
 * watchdog can dispatch a missed tick, but a monitor inside the GitHub
 * scheduler cannot notice that GitHub scheduling itself stopped, and a
 * watchdog whose pg_cron is off cannot report that its own pg_cron is off.
 *
 * Nothing currently notices SILENCE. That is the runbook's P0-1 server half:
 * if pg_cron stops, the Edge Function is undeployed, or the PAT is revoked,
 * ingestion degrades to GitHub cron's measured 9-24% delivery and the
 * founder finds out by chance.
 *
 * A dead-man switch inverts the signal. An external service expects a ping
 * on a schedule and alarms when one does not arrive. Silence — the one
 * failure mode nothing inside the system can report — becomes the alarm.
 *
 * ## The rule that makes it worth anything
 *
 * A heartbeat sent because the workflow process reached its last step
 * proves only that a runner booted. This decision therefore re-reads the
 * database and pings ONLY when both required agency channels independently
 * satisfy the freshness SLO. A run whose FDA step failed, or that stood
 * down on a held lease, or that completed against an unreachable source,
 * withholds the ping and the monitor alarms.
 *
 * ## Purely operational
 *
 * Shoppers never see ingestion freshness anywhere in the app (founder
 * decision). This module and the workflow step that drives it are the ONLY
 * consumers of agency freshness in the product, which is why the threshold,
 * the job names and the lookback window all live here rather than in a
 * shared module with a client half.
 *
 * ## Not activated
 *
 * No account exists, no secret is set, and this repository creates neither.
 * With no URL configured the decision is `not_configured`, which the script
 * prints plainly and exits 0 on. Nothing anywhere claims monitoring is
 * active until the founder configures it and verifies a test alert.
 *
 * Pure module: no network, no clock, no environment reads.
 */

/**
 * The two agency channels a heartbeat depends on. BOTH are required: the
 * ping is withheld unless each is independently within the SLO, so a
 * healthy FSIS can never mask a dead FDA.
 *
 * The slow channels (`fda_enforcement`, `fsis_labels`, `push_delivery`) are
 * deliberately absent. Enforcement reconciliation advances classifications
 * on cases already published and labels add imagery; neither gates whether
 * a NEW recall can appear, so neither may hold the alarm open or silence it.
 */
export type HeartbeatAgency = 'fda' | 'fsis';

export const HEARTBEAT_AGENCIES: readonly HeartbeatAgency[] = ['fda', 'fsis'];

/** The production job whose runs establish each channel's freshness. */
export const AGENCY_JOB_NAME: Record<HeartbeatAgency, string> = {
  fda: 'fda_announcements',
  fsis: 'fsis_ingest',
};

/**
 * The SLO a channel must satisfy for its heartbeat to be sent, in minutes.
 *
 * ── DERIVED FROM PRODUCTION, 2026-09-19 (read-only) ────────────────────────
 *
 * Measured over the 17.8 days since the scheduler watchdog took over
 * delivery (2026-09-02), sampling the age of the OLDER of the two agency
 * channels once a minute (n = 25,667):
 *
 *     p50 21.9m   p90 41.2m   p95 44.6m   p99 50.6m   p99.9 55.9m   max 67.7m
 *
 * The age exceeded 60m for 0.043% of wall-clock and 75m never. The nominal
 * cycle is ~45m: the watchdog calls a channel stale at 40m and dispatches,
 * so a healthy gap is 40m plus GitHub queue time plus the run itself.
 *
 * 90 minutes is two nominal cycles and 33% above the highest age ever
 * observed in this regime. One cycle can be missed entirely without
 * alarming; two cannot. A tighter 75m would leave only 7 minutes over the
 * observed maximum — less than one watchdog tick — and would eventually
 * page on a working pipeline, which is how an alarm stops being read.
 *
 * Replaying this boundary over recorded history: 0 breaches in the current
 * regime (2026-09-10 onward), 0 during the 2026-09-09 FDA source outage
 * (the pipeline kept completing checks inside the window while the source
 * returned 404s — the heartbeat measures whether WE are still checking),
 * and sustained breaches across the known-bad pre-watchdog window.
 *
 * It is a purely operational number. Nothing derived from it is ever shown
 * to a shopper: the app has no freshness surface at all.
 */
export const HEARTBEAT_SLO_MINUTES = 90;

/** How far back the freshness query looks. See `AGENCY_LOOKBACK_DAYS`. */
export const AGENCY_LOOKBACK_DAYS = 7;

/** Bounded, so a hung monitor can never hold the workflow open. */
export const HEARTBEAT_TIMEOUT_MS = 10_000;
export const HEARTBEAT_MAX_ATTEMPTS = 3;
export const HEARTBEAT_RETRY_DELAY_MS = 2_000;

/**
 * The configured endpoints, by name only. Values come from repository
 * secrets and never appear in a log, an error, or this file.
 *
 *   overall  pinged only when EVERY required channel is within the SLO
 *   fda      optional per-channel monitor, pinged when FDA alone is within
 *   fsis     likewise for FSIS
 *
 * Per-channel monitors are optional because two monitors cost two alarms to
 * maintain; one overall check is enough to detect silence, and the split
 * only earns its keep if the founder wants to know WHICH agency stalled
 * without opening the dashboard.
 */
export interface HeartbeatConfig {
  overall: string | null;
  fda: string | null;
  fsis: string | null;
}

/**
 * The last successful check per channel, read straight from `ingest_runs`.
 *
 * `observedAt` is the moment the reading was taken. It comes from the
 * runner's clock, which is what every other command in this repository's
 * operational layer already uses (`ops:health` measures every freshness
 * window with `Date.now()`), and GitHub's runners are NTP-synced to within
 * milliseconds of a 90-MINUTE threshold. A runner clock wrong enough to
 * matter here would already be breaking far more than the heartbeat.
 */
export interface HeartbeatFreshness {
  fdaCheckedAt: string | null;
  fsisCheckedAt: string | null;
  observedAt: string;
}

export interface ChannelVerdict {
  agency: HeartbeatAgency;
  ageMinutes: number | null;
  withinSlo: boolean;
}

export type HeartbeatAction = 'send' | 'withhold' | 'not_configured';

export interface HeartbeatPlan {
  action: HeartbeatAction;
  channels: readonly ChannelVerdict[];
  /** URLs to ping, in order. Empty for every action but `send`. */
  targets: readonly { name: 'overall' | HeartbeatAgency; url: string }[];
  /** Channels that failed the SLO; drives the withhold explanation. */
  breachedChannels: readonly HeartbeatAgency[];
  /**
   * One line for the workflow log. Never contains a URL, a secret, a row, or
   * an agency error message — only names, ages and the decision.
   */
  summary: string;
}

function ageMinutes(checkedAt: string | null, observedMs: number): number | null {
  if (checkedAt === null) return null;
  const ms = Date.parse(checkedAt);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor((observedMs - ms) / 60_000));
}

function describe(channel: ChannelVerdict): string {
  if (channel.ageMinutes === null) return `${channel.agency}=no-successful-check`;
  return `${channel.agency}=${channel.ageMinutes}m`;
}

/**
 * Decide, from configuration and measured freshness alone.
 *
 * Order matters: configuration is checked FIRST, so an unconfigured
 * repository reports `not_configured` rather than a misleading "everything
 * is fine, nothing to send". The two states must never be confused — one
 * means the monitor is watching and happy, the other means nothing is
 * watching at all.
 */
export function planHeartbeat(
  config: HeartbeatConfig,
  freshness: HeartbeatFreshness,
  sloMinutes: number = HEARTBEAT_SLO_MINUTES,
): HeartbeatPlan {
  const observedMs = Date.parse(freshness.observedAt);
  const checkedBy: Record<HeartbeatAgency, string | null> = {
    fda: freshness.fdaCheckedAt,
    fsis: freshness.fsisCheckedAt,
  };
  const channels: ChannelVerdict[] = HEARTBEAT_AGENCIES.map((agency) => {
    const age = Number.isFinite(observedMs) ? ageMinutes(checkedBy[agency], observedMs) : null;
    // A channel with no successful check, or an unreadable server clock, is
    // NOT within the SLO. Unknown never counts as healthy.
    return { agency, ageMinutes: age, withinSlo: age !== null && age < sloMinutes };
  });
  const breachedChannels = channels.filter((c) => !c.withinSlo).map((c) => c.agency);
  const detail = channels.map(describe).join(' ');

  const configured = config.overall !== null || config.fda !== null || config.fsis !== null;
  if (!configured) {
    return {
      action: 'not_configured',
      channels,
      targets: [],
      breachedChannels,
      summary:
        'heartbeat NOT CONFIGURED: no HEARTBEAT_URL secret is set, so no external monitor ' +
        `is watching this pipeline. Freshness observed anyway: ${detail} ` +
        `(SLO ${sloMinutes}m).`,
    };
  }

  const targets: { name: 'overall' | HeartbeatAgency; url: string }[] = [];
  // The overall monitor is the one that detects total silence, so it is
  // pinged only when EVERY required channel is healthy.
  if (config.overall !== null && breachedChannels.length === 0) {
    targets.push({ name: 'overall', url: config.overall });
  }
  for (const channel of channels) {
    const url = config[channel.agency];
    if (url !== null && channel.withinSlo) targets.push({ name: channel.agency, url });
  }

  if (targets.length === 0) {
    return {
      action: 'withhold',
      channels,
      targets: [],
      breachedChannels,
      summary:
        `heartbeat WITHHELD: ${breachedChannels.join(', ')} past the ${sloMinutes}m SLO ` +
        `(${detail}). The external monitor will alarm on the missing ping, which is the ` +
        'intended behaviour. Ingestion itself is unaffected.',
    };
  }

  return {
    action: 'send',
    channels,
    targets,
    breachedChannels,
    summary:
      `heartbeat OK: ${detail} (SLO ${sloMinutes}m); ` +
      `pinging ${targets.map((t) => t.name).join(', ')}.`,
  };
}

/**
 * Redact anything URL-shaped from text that is about to be logged.
 *
 * Belt and braces: the plan's own summary never contains a URL, but an
 * error thrown by `fetch` frequently embeds the request URL, and a
 * heartbeat URL IS the credential — anyone holding it can forge a healthy
 * ping and silence the alarm forever. Every heartbeat log line goes through
 * this.
 */
export function redactUrls(text: string): string {
  return text.replace(/https?:\/\/\S+/gi, '[redacted-url]');
}
