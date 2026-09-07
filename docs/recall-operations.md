# Recall operations: scheduled ingestion (Phase C1)

_Written 2026-08-26, when the pipeline ended at the NotificationEvent
ledger and nothing here touched devices. Since Phase C2 both workflows end
with a `jobs:push` step — but **invoking the push job is not device
delivery**: until the founder runs `push:activate -- --confirm`, the job is
a no-send no-op and no device notification is sent (see
docs/recall-push-delivery.md)._

## Architecture

**GitHub Actions scheduled workflows running the existing tsx scripts, with
Supabase as the only stateful infrastructure.** No new runtime, no second
parser: the workflows execute the same `npm run jobs:*` commands a human
runs, and those commands invoke the canonical pipelines unchanged.

Why this and not something else:

- The pipelines are Node scripts with a native binary (`@napi-rs/canvas`) and
  pdfjs WASM assets read from `node_modules` — they need a full Node runtime
  with a filesystem. That rules out Supabase Edge Functions (Deno, no native
  modules) without forking the label pipeline, and makes serverless platforms
  (Vercel cron: duration caps, daily-only crons on Hobby) a poor fit for
  multi-minute jobs.
- GitHub Actions is repo-native: the schedule, the commands, and the logs
  live where the code lives; `workflow_dispatch` gives one-click manual runs;
  GitHub emails on scheduled-workflow failure out of the box; the only new
  secret surface is two repo secrets.
- Portability is trivial: the jobs are plain npm scripts. If runs outgrow
  Actions, point Railway/Fly/Render at the same commands.

Known platform caveats (accepted): GitHub disables cron workflows after 60
days without repo activity (a warning email precedes it; any commit re-arms
it), and — measured, not assumed — **scheduled ticks are dropped rather than
delayed**, at rates high enough to matter. See the `:07`/`:37` decision below;
this is the sharpest edge of the Actions choice and the one to watch.

## Job units and schedules (all UTC)

| Job               | Command                    | Schedule                              | Why this cadence                                                                                                                                                                         |
| ----------------- | -------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FDA announcements | `npm run jobs:fda`         | `:07` and `:37`                       | Fast consumer channel; one listing fetch + one RSS fetch per tick (source contract §9 recommends 30–60 min).                                                                             |
| FSIS recalls/PHAs | `npm run jobs:fsis`        | `:07` and `:37`                       | Same: one API call returns the whole feed.                                                                                                                                               |
| FSIS labels       | `npm run jobs:labels`      | `:07`/`:37` (recent) + daily `--full` | New notices get visuals within a tick; the daily sweep retries failures and re-verifies the recent window.                                                                               |
| FDA enforcement   | `npm run jobs:enforcement` | daily 09:15                           | The source updates **weekly**; the daily run is one manifest request, and the full download + reconcile happens only when the export date moves.                                         |
| Push delivery     | `npm run jobs:push`        | end of both workflows                 | Events created in a tick are delivered the same cycle; the next tick reads receipts (≥15 min, per Expo guidance). No-send no-op until `push:activate`. See docs/recall-push-delivery.md. |

Workflows: `.github/workflows/scheduled-ingest.yml` (the twice-hourly tick,
running fda → fsis → labels as independent steps) and
`.github/workflows/daily-maintenance.yml` (enforcement → labels `--full`).
Agency polling runs around the clock — quiet hours are a notification-
delivery concern (Phase C2), never an ingestion one.

### Why `:07`/`:37` and not `*/30` [DECISION] (2026-08-27)

GitHub delivers `schedule` events on a best-effort basis and documents the
top of the hour as its most contended window. A missed tick is **dropped, not
queued**, so it is simply lost. Measured on this repository while the cron was
`*/30` (which fires at `:00` and `:30`, the two worst slots):

|                                                      |                        |
| ---------------------------------------------------- | ---------------------- |
| ticks expected 2026-08-26 04:55Z → 2026-08-27 14:34Z | 67                     |
| ticks actually delivered                             | **16 (24%)**           |
| median gap                                           | 64 min (requested: 30) |
| worst gap                                            | 664 min                |
| gaps inside tolerance (≤35 min)                      | 1 of 16                |

`daily-maintenance` was hit the same way — its 09:15Z run arrived at 19:51Z on
2026-08-27 — so this was never specific to ingestion. The offset keeps the
cadence at twice hourly and only moves it off the boundary; frequency is
unchanged, and raising it would make dropped ticks more likely, not less.

**OUTCOME (2026-08-28): the offset did not work.** The 22-hour window under
`:07/:37` delivered at most 4 of 44 expected ticks (~9%, worse than the 24%
baseline; median gap 386 min, worst 694 min), none of the observed starts
landed on a scheduled minute, and `ops:health` attributed every gap to
scheduler silence — the reconsideration bar below was met. The designed fix
is the **Supabase scheduler watchdog** (docs/recall-scheduler-watchdog.md):
Supabase Cron → Edge Function → atomic claim → `workflow_dispatch` on this
same workflow whenever FDA/FSIS freshness lapses. The watchdog is built and
tested and is designed to become the primary freshness owner once deployed
and activated. **Superseded 2026-09-05:** the O2-A read-only production
audit verified exactly that state — the watchdog is deployed, enabled, and
has been active since 2026-08-28, and it is the effective freshness owner
(see "Production verification (O2-A, 2026-09-05)" below). The GitHub cron
entry stays regardless as a free extra tick, but it is a secondary/bonus
channel, not the dependable freshness owner.

The cron is pinned by `src/server/jobs/workflow-schedule.test.ts`, which also
asserts `workflow_dispatch` survives on both workflows — it is the recovery
path for a missed tick, and the only way to run CI on demand.

### Verifying the offset — 24-hour window

Start the clock at the first push that carries the new cron. Do not claim the
offset works before this completes; a single good tick proves nothing about a
probabilistic drop.

1. **T+1h.** `npm run ops:health` — FDA/FSIS `healthy`, and the most recent
   attempt should carry a `:07`/`:37` minute. Confirm in GitHub → Actions that
   `scheduled-ingest` runs are appearing with event `schedule` (not just the
   manual dispatch).
2. **T+24h.** Re-measure delivery the same way the baseline was measured —
   count `fda_announcements` runs over the window and compare against 48
   expected ticks. Record median and worst gap.
3. **Judge against the baseline, not against perfection.** 24% was the
   failure. Sustained **≥ 80%** delivery with a worst gap under ~2 h means the
   offset worked. **50–80%** is an improvement that has not solved the
   problem. **≤ 40%** means the slot was never the cause — reopen the
   diagnosis rather than trying another offset.
4. **Watch `daily-maintenance` in the same window** without changing it. Its
   09:15Z slot is already off the hour, so it is the control: if it arrives on
   time while ingest still drops ticks, the congestion theory is wrong and the
   difference is frequency, not placement.
5. **Confirm the new observability on real data.** Any lease skip recorded in
   the window should show up on the `lease skips:` line without moving the
   last successful run and without degrading status.

If a gap re-opens past the 3 h threshold, `ops:health` now says which of the
two causes it is — read that line before touching anything.

#### When to reconsider external scheduling

Not after one incident, and not on the strength of this measurement alone. The
bar is: the offset has run its 24-hour window, delivery is still ≤ 40%, and
`ops:health` attributes the gaps to scheduler silence rather than lease
contention — i.e. GitHub is demonstrably not starting the workflow, at a rate
that keeps recalls stale past 3 h. Only then does the trade become worth it,
because every alternative (self-hosted runner, external cron hitting a
dispatch endpoint, a hosted scheduler) adds a credential, a host, and a new
thing that can fail silently — against a workflow that is otherwise correct.
An additional shifted cron entry inside the same workflow is the cheaper next
step and should be tried first.

**That bar was met on 2026-08-28** (≈9% delivery, all scheduler silence), and
the external scheduler is built: see docs/recall-scheduler-watchdog.md for
the architecture, activation, rollback, and the `Scheduler watchdog` section
in `ops:health` plus `npm run scheduler:status` / `npm run scheduler:probe`.
Whether it has been activated in production is a live question those
commands answer; do not assume it from the code's presence. That question
was answered on 2026-09-05: the O2-A audit ran those commands read-only and
verified the watchdog deployed, enabled, and active — see the next section.

### Production verification (O2-A, 2026-09-05) [DATED MEASUREMENT]

A read-only production audit (ledger: `.reports/o2-a-production-freshness.json`,
git-ignored) established the live operational state as of 2026-09-05 and
classified it **healthy**. These are dated measurements of that audit window,
not standing guarantees.

**Watchdog — verified active.** `watchdog_config.enabled = true`, installed
2026-08-28T19:04:49Z; five-minute heartbeat cadence with all 2,016 expected
invocations present in the audited seven-day window (gap median/p95/max =
5.0/5.0/5.1 min); stale threshold 40 min; dispatch cooldown 20 min; GitHub
token expiration recorded as 2027-08-28. Every watchdog dispatch in the
window was accepted: 203/203 over seven days (239/239 over thirty), zero
failures, zero invocation errors. At audit completion the watchdog considered
neither FDA nor FSIS stale. That the watchdog is the **primary freshness
owner** is an **inference** from production bookkeeping (~82% of fast-channel
runs in the window correlate with `watchdog_dispatches.github_run_id`), not a
GitHub-verified attribution — see the census limitation below.

**GitHub cron — still unreliable; evidence limitation.** GitHub's
authoritative workflow-run history could not be read during O2-A (no `gh`, no
local GitHub credential by design), so trigger attribution was reconstructed
from `ingest_runs` (`version` carries the runner's `GITHUB_SHA`) and
`watchdog_dispatches`. In the seven-day window: 336 expected cron ticks
(`7,37 * * * *`, 48/day), 249 workflow runs observed, 203 of them verified
watchdog dispatches — so **at most 46 runs (~14% of expected ticks) could
have come from GitHub cron, and some of those could have been manual**. That
is an inferred upper bound, not a verified GitHub delivery rate. Once
started, every audited fast-channel run completed successfully (312/312 over
thirty days, zero failed, zero stuck past the 25-minute grace).

**Freshness result.** Seven-day maximum gap between fast-channel successes:
**52.5 minutes** (median 44.9). Every gap over 60 minutes in the thirty-day
evidence ended when the watchdog came online on 2026-08-28; the pre-watchdog
maximum (~11.6 h) remains the relevant contrast. No stuck runs, no held
leases, no duplicate running jobs, and no manual intervention sustained
freshness during the audited seven days.

**FDA freshness (audit snapshot, 2026-09-05).** Within all configured
thresholds. Upstream comparison: nine of the ten newest food-scope FDA
listing items were present in production; the one absent item was a pet-food
recall co-tagged Animal & Veterinary, excluded by the documented food-scope
decision (`excluded_animal`) and verified absent by direct id lookup — a
scope exclusion, not a missed ingest. All five newest food-safety RSS items
were present. Snapshot counts at audit: 724 source records, 711 active
cases, newest stored publication 2026-09-04.

**FSIS freshness (audit snapshot, 2026-09-05).** Within all configured
thresholds. All 1,234 upstream FSIS API items matched the 1,234 stored
records, and the latest upstream recall (018-2026, 2026-08-26) was present.
The absence of newer FSIS snapshots reflected an unchanged upstream feed and
the unchanged-source hash gate correctly skipping per-record processing —
not a failed ingest (the job itself succeeded every ~45 minutes). Snapshot
counts at audit: 179 active / 1,016 closed / 1 retracted case. The three
permanently failing FSIS label PDFs are a known label-rendering backlog,
not ingest failures.

**Daily maintenance.** All seven audited days completed successfully, but
observed start times were later and more variable than the configured 09:15Z
slot (12:43–17:04 UTC); whether those were late cron deliveries or manual
dispatches is not distinguishable without GitHub run history. Production did
not go stale from this during the audit. This is a dated observation, not
proof of a permanent scheduler property; note the watchdog does not cover
`daily-maintenance`.

**Watch item — openFDA enforcement export.** At audit time `ops:health`
reported the enforcement leg healthy, but the source export date (2026-08-27)
sat exactly at the configured ten-day stale threshold: if the weekly openFDA
export does not advance within about a day of the audit, `ops:health` flips
that leg to STALE. That is a source-side condition to monitor — not a job
failure and not grounds for any mutation. Re-run `npm run ops:health` to
check; the three permanently failing FSIS label PDFs remain the other known,
unrelated backlog (see the labels section).

### The unchanged-source skip gate

Both fast feeds return their entire content every fetch. Each job hashes the
fetched content (order-insensitively — the FDA listing is not date-sorted)
and compares it to **`completedFeedHash`** — recorded only by a run that left
nothing deferred, degraded, pending, stale-skipped, or errored (O3-B1,
mirroring the enforcement job's `completedExportDate`): identical content
then skips the per-record processing entirely (~1-minute tick instead of
~5–8 minutes). An incomplete run withholds the token, so unfinished work
(a deferred FDA detail page, a pending version from a crash, a case-CAS
exhaustion) is always retried by the next tick's per-record pass even when
the feed bytes are identical. Quarantined records do NOT withhold the token —
a parse failure is deterministic on identical bytes, so the gate loses
nothing by skipping it. The gate can only ever skip work the per-record
applied-version gate would also have skipped, so it cannot change outcomes —
only cost. The FDA gate requires both the listing AND the RSS to be fetched
and unchanged, so an RSS-only discovery is never delayed. `--force` bypasses
the gate.

## Locking

One row per job in `job_leases`, taken atomically by the SQL function
`acquire_job_lease(job, holder, ttl)` (free, expired, or same-holder ⇒
acquired). The runner takes the lease before the body and releases it after —
scheduled and manual runs go through the same path, so a laptop run and a
scheduler run cannot interleave. A crashed holder's lease simply **expires**
(TTL: 25 min for the tick jobs, 110 min for enforcement/full labels), so a
stuck job recovers within one missed tick and can never block ingestion
permanently. `holder` records host:pid:version for audit. A second layer —
the workflow `concurrency` group — keeps the scheduler itself from stacking
runs. An attempt that finds the lease held **skips** (exit 0): overlap is
normal, not a failure.

A skip still records an `ingest_runs` row, marked `metrics.skippedLease` and
carrying the turned-away holder. That row is the whole point: without it, "the
scheduler never started us" and "we started and stood down" are the same
observation — nothing — and telling them apart is what the 2026-08-27 stall
turned on. The row is deliberately **outcome-less**: `succeeded` would conceal
the skip and reset freshness, `failed` would page an operator over a healthy
overlap, and `partial` would claim work that was never attempted. `finished_at`
IS set, which is what separates a skip from an in-flight or crashed run. Lease
TTL, acquisition, takeover, and release are untouched, and a skip runs no job
body — so it can produce no source records, RecallCases, NotificationEvents, or
deliveries.

## Run bookkeeping and health

Every job execution ends as exactly one `ingest_runs` row (the pipeline's own
row for FDA/FSIS full runs, a runner-created row otherwise) carrying:
`job_name`, `outcome` (`succeeded` / `partial` / `failed`, or **none** for a
lease skip), compact `metrics` (counts, feed hash, newest source date,
notification tallies — never logs), `version` (git SHA), and `error`.
`partial` means completed with item-level failures (quarantined records,
failed detail fetches, failed label PDFs).

Under the O3-B1 applied-version contract, `succeeded` means every in-scope
item reached its applied success condition; a run that left ANY item
deferred, degraded, pending, stale-skipped, CAS-exhausted, or errored is
`partial`, with per-state counts in `metrics` (`deferred`, `degradedFounded`,
`staleSkipped`, `conflictsExhausted`, `pendingCompleted`, `itemFailures`).
Per-item errors are isolated (one poison item no longer aborts the feed) and
a failure spike above 20% of records — quarantines plus isolated errors —
fails the run loudly.

`npm run ops:health` answers, from the database alone: the most recent
**attempt** and the last **success** per job, staleness against per-job
expectations (fast jobs 3 h, labels/enforcement ~daily, enforcement export ≤ 10
days old), newest-source staleness (a silent feed alarm at 14 days), the
label-failure backlog, and the 7-day deliverable/suppressed notification flow.
Non-zero exit when anything is UNHEALTHY.

### Applied-version state section (O3-B2)

`ops:health` now reads the service-role `source_record_apply_health` view and
reports the applied-version population: total records; `applied` / `pending` /
`applied_degraded` / legacy-unverified counts; pending and degraded counts by
source system; oldest pending age (minutes) and oldest degraded age (hours);
bounded identifiers for overdue actionable records (never payloads or
secrets); and whether the governed reconciliation has completed
(legacy-unverified = 0). A missing view is the explicit status
`not installed` (`applied_version_contract` migration pending) — never a
misleading healthy.

The four stored states mean four different things and must not be conflated:

| State              | Meaning                                                         | Health effect                                                                                                         |
| ------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `applied`          | current version fully completed                                 | healthy                                                                                                               |
| `pending`          | current archived work awaiting its retry tick                   | informational < 40 min; **degraded** past one watchdog window (40 min); **UNHEALTHY** ≥ 90 min (the pinned O3 alarm)  |
| `applied_degraded` | usable FDA listing coverage still owed its detail page          | visible + age-tracked; **degraded** after one daily cycle + slack (26 h); never UNHEALTHY alone (consumer is covered) |
| legacy-unverified  | pre-O3 row awaiting **governed reconciliation** — NOT `pending` | informational; blocks "O3 fully settled" but is never an ingest failure                                               |

Thresholds are derived, not invented: 30-minute ingest cadence, the
watchdog's 40-minute staleness window, the O3-B0/B1 pinned 90-minute pending
alarm, and the daily maintenance cycle. Classification is pure in
`src/server/applied-state-health.ts` (tested in
`applied-state-health.test.ts`); the script is presentation.

Attempt and success are separate on purpose, because two very different
outages present with the identical symptom `no success in Nh`:

| Reading                                                           | What it means                                                          | Where to look                                                                                                       |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `no attempt recorded since the last success`                      | **Scheduler silence.** GitHub never created or started the workflow.   | GitHub Actions: is the workflow enabled, are `schedule` runs being created, is Actions billing blocked?             |
| `all N attempt(s) since the last success skipped on a held lease` | **Lease contention.** The scheduler is fine; a worker holds the lease. | `job_leases` — expect self-recovery within the 25-min TTL; a lease older than that means a holder is not releasing. |

The five attempt states `ops:health` distinguishes are `succeeded`, `partial`,
`failed`, `skipped_lease`, and `running` (outcome-less and not a skip: in
flight, or a process that died before recording). A lease skip never counts as
a success, so it can never satisfy freshness, and never reads as a source
failure. The classification is pure and lives in `src/server/jobs/health.ts`
(tested in `health.test.ts`); the script is presentation.

## Client feed completeness

`npm run qa:feed` (read-only) answers the one question the app cannot answer
about itself: does Home actually hold every active recall? A truncated feed is
indistinguishable from a complete one from inside the app — sections render,
counts look plausible, nothing errors — so it is checked against an independent
authority. The script counts the consumer read contract
(`state = active AND merged_into IS NULL`) server-side via the service role,
then **drives the real client loader** (`fetchFeedPage` + `loadAllPages`, which
together are `fetchCurrentFeed`) under the anon key and RLS, and re-derives
every downstream number from what the loader returned. Hard gates, non-zero
exit: missing active ids, duplicate ids, loaded ids that are not active, All
Recalls omitting an active case, "affects me" eligibility not matching
placement, and any case in two sections.

Current baseline (2026-08-27): 882 consumer-visible active cases, loaded in 2
pages, 0 missing, 0 duplicates, ~590 ms, 12 ms to section and sort. The 13-case
gap between 895 total active rows and 882 visible ones is the merged-duplicate
set, hidden by RLS by design; the script prints both numbers so the distinction
is never silently absorbed into the baseline.

Operationally the loader is linear in corpus size with no ceiling — see
architecture §2.4 for the pagination contract and the growth budget. Watch
total payload rather than row count; the alarm to raise is a rising page count
against flat coverage.

## Egress (Phase C8)

The Supabase project outgrew the Free plan's 5 GB egress; C8 measured where
the bytes actually went and fixed the two repeatable sources — full detail in
docs/recall-feed-sync.md. Operationally:

- **Ingest reads are identity-slices now.** The per-item hash gate and
  retraction targeting read `select('id, recall_case_id')` instead of full
  source-record rows (~19 KB each on FDA). A full FDA run's per-record reads
  fell from ~12.7 MB to ~84 KB decompressed (estimate from measured row
  sizes). The expansion-parent lookup still reads the full row — its
  evidence guard needs `normalized`.
- **The client feed syncs incrementally** against the anon-readable
  `consumer_feed_manifest` view (id + content-hash token per visible case).
  Activation required `supabase db push` of
  `20260904000000_consumer_feed_manifest.sql`; O2-A verified it **applied in
  production** on 2026-09-05 (linked migration history matches the local
  file, and the view answered a read-only SELECT — 890 rows at audit). The
  pre-C8 full-load fallback remains the client's behavior only if the
  manifest is ever unavailable.
- **`npm run qa:egress`** (read-only) is the standing measurement: cold-load
  bytes and completeness, manifest hidden-id gate, warm-refresh
  zero-full-rows and ≥80%-reduction gates, and scheduled-job estimates from
  `ingest_runs` history. It exits non-zero while the manifest migration is
  unapplied.
- **Founder QA/maintenance commands read the corpus at full weight on
  purpose** (audit quality over transfer): `qa:personalization` ~11 MB,
  `qa:duplicates` ~11 MB, `qa:fda-enforcement` ~18 MB, image backfill
  ~57–63 MB, `repair:geography` ~2×26 MB per pass. These are per-invocation
  costs, not schedules — during heavy development weeks they were plausibly
  the largest single egress driver.

## Failure semantics

**SOURCE EMPTY is SOURCE FAILED.** A feed returning zero items — or under
half of the last successful run's count (openFDA: manifest total halved) —
fails the run without ingesting. A parse-quarantine spike above 20% fails
the run (source shape drift); isolated quarantines are `partial`. HTTP and
database failures throw, record a failed run, and exit non-zero so the
scheduler shows red and GitHub emails. Failures never delete or close
recalls: the pipelines only ever add, so the consumer keeps the last good
data while operations shows the outage.

Retries: the fetch adapters keep their bounded in-process retries (FSIS 4×
with fingerprint rotation, FDA 3×, both exponential backoff); beyond that,
the next scheduled tick IS the retry — spaced, bounded, and safe because
every pipeline is idempotent. GitHub does not auto-retry scheduled runs, so
there is no retry-storm interaction. Failed label PDFs retry with their own
backoff (6h·2ⁿ, capped at 7 days).

## O3 applied-version contract: implementation status (O3-B1, 2026-09-05)

The crash-safe applied-version contract (archived ≠ applied; atomic case
transitions; atomic founding; deferred/degraded FDA detail; completion-gated
feed hash — design ledger `.reports/o3-b0-design-closure.json`, mechanics in
[docs/recall-domain-architecture.md](recall-domain-architecture.md) Part 8.3)
is **implemented in code and NOT yet active anywhere**:

- The migration `supabase/migrations/20260907000000_applied_version_contract.sql`
  (four nullable marker columns on `source_records`, the
  `source_record_apply_health` view, and the `archive_snapshot` /
  `apply_case_transition` / `found_recall_case` functions) is **created but
  not applied** to any database. It contains no legacy seeding by design:
  every existing row stays `NULL` (legacy-unverified) until the separately
  authorized O3-B2 reconciliation verifies it, or its content changes.
- The application code is **committed-in-tree only, not deployed**: scheduled
  ingestion in production continues to run the pre-O3 code until the founder
  applies the migration (its own authorization; `supabase db push`) and then
  pushes the code (its own authorization). Schema-first is mandatory — the
  new code writes the marker columns and calls the RPCs.
- O3-B2 (2026-09-06) adds the applied-state health section above and the
  governed reconciliation below — **implemented and locally verified, never
  run against production**. Production dry run, migration apply, marker
  apply, and code push each remain separately authorized founder steps.
- Push delivery remains inactive throughout.

## Applied-state reconciliation (O3-B2): governed, plan-bound, dry-run first

The one-time census + marker seeding for the pre-O3 population — an explicit
maintenance command, never scheduled, and deliberately NOT a repair:

```bash
npm run reconcile:applied-state:dry                          # census + reviewable PLAN (writes nothing to the DB)
npm run reconcile:applied-state -- --confirm \
    --plan <reviewed-plan.json> --digest <plan digest>       # APPLY: marker seeding only, all four gates required
```

What it does, and refuses to do:

- **Dry run (default)** reads the complete population (records, latest
  archived snapshot payloads, cases, generated columns, products, bounded
  initial-event evidence — no network, no upstream fetches, zero writes),
  re-derives every record through its canonical parser, groups by case, and
  classifies every record and case into exactly one bucket
  (`consistent_legacy_seedable`, `equivalent_legacy_seedable`,
  `already_applied_consistent`,
  `pending_current_version`, `applied_degraded`, `normalized_drift`,
  `case_projection_drift`, `affected_products_drift`,
  `missing_initial_event`, `orphan_case`, `missing_snapshot`,
  `snapshot_parse_failure`, `unsupported_source_system`,
  `applied_marker_inconsistent`, `invalid_case_link`,
  `case_blocked_by_sibling`, `multiple_findings`). The output is a durable
  JSON **plan/ledger** (`.reports/`, refused if the requested path exists)
  with per-record fingerprints and a deterministic **plan digest** —
  identical audits produce identical digests regardless of pagination order.
- **Seeding eligibility** requires the FULL proof: the latest snapshot
  parses; the re-derived normalized state equals the stored one (pinned
  comparison contract — for enforcement records the stored match-provenance
  block is audit history and is copied, everything else byte-equal, except
  that a legacy-unverified record may match under the four versioned
  legacy-equivalence rules below); the
  case link is valid; the projection recomputed from ALL contributors equals
  the stored projection; the generated columns agree; the product rows agree
  (ordinal order contractual); the initial event exists; and NO sibling is
  pending, degraded, or inconsistent — one bad contributor blocks the whole
  case (`case_blocked_by_sibling`).
- **Apply** requires `--apply` AND `--confirm` AND the reviewed `--plan`
  file AND its `--digest`, refuses a plan whose content was edited (its own
  digest breaks) or produced at a different git commit, re-verifies every
  fingerprint against the live rows per case group immediately before
  seeding, and writes ONLY `apply_state`, `applied_content_hash`,
  `applied_snapshot_seq`, `applied_at` through the legacy-null-guarded
  monotonic seed. Anything that moved since the plan is a recorded
  **conflict** (a governed outcome, exit 0) — the plan is immutable input
  and is never regenerated mid-apply. Reruns are idempotent
  (already-seeded, zero writes).
- **Everything else is refused and enumerated**, never auto-repaired:
  drift, missing initial events, orphan cases, missing snapshots, parse
  failures, pending/degraded work, malformed markers. Each finding carries
  field-level before/derived evidence for a separately reviewed,
  evidence-specific correction after the production dry run establishes the
  real historical population. Marker seeding creates **zero** notification
  events and deliveries, changes no timeline or `last_changed_at`, and
  cannot make historical events newly eligible.

The command exits non-zero only for a malformed/tampered plan, a digest or
commit mismatch, a missing schema, retry exhaustion, a concurrent-writer
invalidation, or an unhandled failure — refusals and conflicts are expected
governance, reported in counters and the ledger. Engine:
`src/server/applied-state-reconcile.ts` (tested in
`applied-state-reconcile.test.ts` and `applied-state-read-hardening.test.ts`);
CLI: `scripts/reconcile-applied-state.ts`.

### Read-path hardening (O3-B3A, 2026-09-06)

**Historical evidence.** The first production dry run (2026-09-06,
19:51–20:09 UTC) aborted when ONE transient HTTPS `fetch failed` landed
among the ~12,800 sequential requests the original N+1 read shape issued
(two per record for snapshot meta + payload, three per case for generated
columns, products, and the initial-event probe). The failure path behaved
exactly as designed — zero production writes, no partial plan, no usable
digest — and the census/apply contracts were not disproven. The hardened
rerun (O3-B3 Phase 3B, 2026-09-06 21:49 UTC) completed in 20 seconds with
zero writes and produced the valid plan
`.reports/o3-b3-reconciliation-dry-run-v2.json` (schema
`recall-applied-state-plan/1`, commit-bound to `7c2a25a`): 3,523 records,
33 strictly seedable, 3,475 refused as parser/projector-era drift
(evidence analysis: `.reports/o3-b4-historical-drift-analysis.json`).
That plan remains completely unapplied; marker seeding remains
unauthorized.

**Bounded read model.** The audit now reads in pages and chunks only —
request count proportional to pages, never records × attributes: the
`source_record_apply_health` view (marker + latest-snapshot identity, one
paginated read that also opens the drift fence), full record rows per
system (paginated), latest payloads fetched by globally-unique snapshot
`seq` in bounded chunks, and one paginated read each for audit-shaped case
rows (projection + CAS token + generated columns), all product rows, and
initial-event case ids. For the production population (3,523 records /
1,920 cases) that is ≈ 100 requests instead of ~12,800. A structural
regression test fails if any per-record/per-case read returns to the audit.

**Retry policy (audit reads ONLY).** One centralized bounded policy: 4
total attempts, 500ms·2ⁿ backoff with ±25% jitter capped at 5s; 429-class
responses wait ≥2s (the Retry-After substitute — supabase-js does not
expose response headers on errors). Retried: transient transport failures
(`fetch failed`, reset/timeout classes) and 408/429/502/503/504. Never
retried: permission, schema, validation, auth, and ordinary 4xx failures —
and never any mutating call (`applySeedPlan` writes at-most-once, with no
retry wrapper reachable; pinned by test). The policy deliberately LAYERS on
postgrest-js's own bounded retry (3 inner attempts at 1s/2s/4s for thrown
transport errors and 503/520 on idempotent methods — which the 2026-09-06
failure had already exhausted, proving that outage was sustained, not a
single blip): one outer attempt spans a full inner cycle, so total
tolerance reaches ~30-60s of sustained outage at a bounded 16 transport
attempts per read, and POST mutations are excluded at both layers. Diagnostics carry the read name,
page, and attempt count — sanitized, bounded, never payloads or key-bearing
URLs. Retries never change plan contents or the digest.

**Fail-closed output.** The plan file is written atomically (tmp + rename)
only after the complete audit and digest construction succeed; an existing
destination is refused; retry exhaustion and drift exit non-zero and leave
only a timestamped failure artifact that cannot satisfy the plan schema.

**Concurrent-drift fence.** The health view and the case CAS tokens are
captured before the census and re-read after it. Under the O3 write
contract every material change moves at least one fenced fact (membership,
latest snapshot seq/hash, marker state, or `last_changed_at` — projection,
products, and events only ever commit with a `last_changed_at` move), so a
concurrent scheduled tick that genuinely changed anything material
invalidates the audit with bounded identifiers and a rerun instruction,
while an unchanged tick (whose only writes are `last_seen_at` bumps and run
rows — fields the fence never reads) passes harmlessly.

### Legacy-equivalence contract (O3-B4B, 2026-09-07)

The O3-B4A evidence audit (`.reports/o3-b4-historical-drift-analysis.json`)
proved that most Phase 3B refusals are pre-era representation, not data
defects. The founder accepted exactly four equivalence rules, implemented as
`LEGACY_EQUIVALENCE_CONTRACT = legacy-equivalence/1` in
`src/server/applied-state-reconcile.ts` (pinned in
`applied-state-equivalence.test.ts`):

- **R1 / R2** — stored absent/`null` `declaresRevision` / `declaresExpansion`
  vs derived exactly `false`. The domain contract defines absence as
  "unknown, never true"; the only consumer is ingest-time truthiness.
- **R3** — stored absent/`null` `retailerNames` vs derived exactly `[]`, at
  BOTH the normalized-record and case-projection boundaries; every projection
  consumer already defaults the missing value to `[]`.
- **R4** — a legacy projection classification lacking the newer
  `officialClasses` set, accepted ONLY when every other classification field
  is canonically identical AND both shapes resolve identically through
  `officialClassesOf`, `consumerRiskTier`, and `classificationStatus` —
  semantic class equality, never a blanket missing-field pass.

Every rule is **legacy-directional**: it applies only while
`apply_state IS NULL` (projection rules additionally require an all-legacy
case group), and unknown never equals affirmative evidence — `null` vs
`true`, `null` vs a nonempty retailer list, and any new or different class,
tier, or status all remain real drift (counterexamples pinned in tests).
`pending`, `applied`, and `applied_degraded` records — including the 15
already-applied production records — and every record processed under O3
keep strict byte-equality. There is deliberately NO broad "consumer-inert"
rule: a field being ignored by current consumers does not make its stored
value equivalent (the ~117 such records from O3-B4A stay refused), because a
seeded marker asserts derivation equality, not display invisibility. A
record certified only through these rules is classified
`equivalent_legacy_seedable` (vs `consistent_legacy_seedable` for exact
equality) and its plan entry names the rules used.

Plan binding: the plan schema is now `recall-applied-state-plan/2` and every
plan records its `equivalenceContract`; apply refuses any other schema or
contract version, so the Phase 3B plan (`plan/1`, commit-bound to `7c2a25a`)
can never be applied or silently reinterpreted under the new rules — it
stays a frozen evidence artifact. **No production dry run under R1–R4 has
happened yet**; the O3-B4A evidence-audit projection (NOT a production
census) expects roughly 2,389 certifiable records (≈2,374 legacy, freeing
≈886 enforcement records) with ≈1,134 still refused as genuine
parser/projector-era drift. The seven notification-eligible improvement
events, the nine ambiguous records, and any O3-B5 historical re-derivation
remain deferred founder decisions; marker seeding remains separately
authorized.

## Labels: incremental by construction

Discovery is a database scan (no agency traffic); only PDFs with **no**
`product_visuals` rows are fetched — new notices and previously failed
documents. The ~3,000 already-rendered pages are never re-fetched or
re-rendered; a bounded recent-window re-verification in the daily `--full`
sweep catches the rare in-place PDF revision (content-addressed keys make the
replacement atomic and auditable). Per-URL failures live in
`product_visual_failures` — retried with backoff, visible in `ops:health`.
`scripts/render-fsis-labels.ts` remains the manual historical backfill;
the FDA image backfill stays a maintenance tool and is deliberately **not**
scheduled (normal FDA parsing derives hero images).

C9 (2026-08-29) hardened this pipeline at two seams (docs/recall-imagery.md):
href resolution goes through the canonical resolver in
`src/lib/official-urls.ts` (protocol-relative hrefs used to become the
duplicated-host 404s recorded in `product_visual_failures`), and the PDF
fetch goes through the bounded allowlisted fetcher
`src/server/safe-fetch.ts` (redirect revalidation, streaming size cap,
content-type + magic-byte checks) with the per-document cap raised
15 → 64 MB (five real 21–52 MB scanned label sheets were failing on size
alone). Of the eight ledgered failures, seven recover on the next `--full`
sweep; 047-2023 is a dead link at FSIS itself. Rendered pages are
DETAIL-SCREEN EVIDENCE only: under the C9 frozen policy the sync never
touches `projection.heroImageUrl` — professional card-hero sourcing was
researched by C9.1 (2026-08-30) and **deferred**; no provider is integrated
(docs/recall-imagery.md §12).

## Product categories: derived, accepted, backfilled (C10B)

```
npm run qa:categories                     # offline; launch gate (exits 0 when sound)
npm run qa:categories:launch              # the same launch gate, named after its script
npm run qa:categories:frozen              # offline; the FROZEN C10A.2 report, verbatim
npm run qa:product-categories             # read-only; live distribution + persisted gates
npm run backfill:product-categories:dry   # read-only; the historical write plan
npm run backfill:product-categories       # APPLY — authorized and executed once (C10B)
```

`projectCase` derives `projection.productCategories`, so new and re-projected
cases carry categories automatically. C10B applied the historical backfill and
shipped the Category filter — see docs/recall-food-categories.md §8.

### `qa:categories` is a launch gate, not an accuracy gate

Before C10B this command was **permanently red**: it asserted a ≥90% bar the
classifier does not meet (87.5%), so it failed every run while telling nobody
anything new, and a red command nobody can fix is a command everybody learns to
ignore. The accuracy question was settled once, by a founder decision recorded
in docs/recall-food-categories.md, and re-asserting it on every run is not
oversight — it is noise.

`scripts/qa-categories.ts` is a **frozen harness file** (its sha256 is in
`category-freeze-manifest.json`, because C10A.1 proved an edited harness can
move a headline number three points). It was therefore not edited.
`scripts/qa-categories-launch.ts` **runs it and reprints its output verbatim**,
then adds the launch baseline and the launch gate around it. Every measured
number is still the frozen harness's own.

The gate blocks on the five things that can change **without anyone noticing**:

1. frozen classifier / harness / final-label hashes still match the manifest;
2. the derivation is still deterministic across repeated runs;
3. the frozen human-reviewed unreasonable-placement baseline is ≤3% (it is
   **1.0%, 2/200**) and its records still resolve to cases in the final split;
4. every production invariance suite passes — Category cannot reach relevance,
   ranking, risk, Affects Me, push, or material-change detection;
5. the launch-visible allowlist is unchanged (nine visible, three hidden).

The research bars are printed as **NOT MET** and gate nothing: 87.5% against
both the original 95% and the C10A.2 90%. Nothing converts the high-80s into a
≥90% result, and none of this may be cited to relax the personalization or
notification bars, which are separate, stricter, and share no input.

### `qa:product-categories` grades derivation AND persisted data

The derivation gates (total, valid, ordered, deterministic, hazard-blind, zero
effect on All Recalls / Affects Me / relevance) are unchanged. C10B adds gates
over the **raw persisted jsonb** — deliberately not the normalized read, which
repairs damage on the way out and would report a clean bill of health over a
corrupt column: zero active cases missing categories, zero invalid ids, zero
duplicates, zero ordering violations, zero `other` mixed with a real category,
zero over the cap.

`npm run qa:product-categories -- --pre-backfill` downgrades **only** the
missing-categories gate to advisory. It exists for the single pre-apply
verification run, where "882 active cases hold no categories" is the work order
rather than a defect. It must not appear in a post-apply or CI invocation.

### The backfill

Zero network requests. Writes exactly one projection field under a
compare-and-set on `last_changed_at`, takes no job lease (so it never blocks
the agency feeds), and can never create a case, a timeline entry, or a
notification — `detectChanges` does not diff `productCategories` under any
rule, and this path does not go through the pipeline anyway.

It is **idempotent and resumable**: every decision is made from current state,
so a completed run is a no-op and an interrupted one simply resumes. C10B's
apply was in fact interrupted partway (a tooling timeout, not an error) and was
resumed by re-running the same command; the dry run afterwards is the
verification report and must read `would update: 0`.

Safe to run while scheduled ingestion is running. A case an ingest writes
mid-run fails its CAS, is re-read, re-derived from the newer text and retried
once; anything still moving is reported as concurrently modified and left for
the next run. Never bypass CAS.

## Imagery: standing QA, no repair command (C9)

```
npm run qa:imagery            # read-only gates: frozen policy, provenance, URLs, GTINs
```

Three coverage concepts are distinct and never conflated: CARD HERO
coverage (`projection.heroImageUrl` — today exclusively official FDA
photographs under the historical selection, ~619 active), DETAIL VISUAL
coverage (a hero and/or rendered label pages in product_visuals), and
PROFESSIONAL PACKSHOT coverage (sampled once by the completed C9.1
research, 2026-08-30, and deliberately not tracked in production — external
sourcing is deferred, docs/recall-imagery.md §12).
`qa:imagery` gates on the frozen interim policy — zero label renders
promoted to card hero, zero unknown-provenance heroes, zero
URL-normalization drift — with bounded live probes only, never a corpus
download. There is deliberately NO imagery repair command: the only
historical repair C9 contemplated was blanket hero promotion of ordinary
label renders, which the professional-imagery objective forbids;
`src/server/imagery-guards.test.ts` keeps every promotion path removed.
Professional hero repair remains unbuilt on purpose: C9.1 (2026-08-30)
concluded no classifier clears the precision bar and no free source
qualifies, and deferred external sourcing; the reserved
`updateCaseHeroImage` compare-and-set seam stays without a production
caller until that deferral is revisited.

## Retailer evidence: a one-time historical repair

```
npm run backfill:retailers:dry    # report only, writes nothing
npm run backfill:retailers        # apply
npm run backfill:retailers:dry    # verify: "would update" must be 0
```

`projection.retailerNames` is derived by `projectCase` (C3.1), so every new
and re-projected case carries it automatically. Cases stored _before_ that
existed will never be revisited by normal ingestion — the snapshot hash gate
skips unchanged pages by design — hence a one-time repair.

Safety shape, identical to the FDA image backfill: dry-run by default,
explicit `--apply`, **zero network requests** (the derivation reads text
already persisted with the case), and a single-field write that carries
`timeline` and `lastChangedAt` through untouched. It therefore bypasses the
pipeline's re-projection path entirely — no material-change detection, no
NotificationEvent, no new or merged cases, no moved dates. A historical
projection repair is not public activity.

Conflicts are **reported, never resolved**: a case carrying stored evidence
the hardened contract rejects is listed and left completely alone. Deleting
stored evidence is a decision for a human, not a maintenance script.

The operation is idempotent and resumable — every decision is made from
current state — so the dry run doubles as the post-apply verification report.

### Running it alongside scheduled ingestion

Safe, and deliberately so: the FDA and FSIS jobs tick every 30 minutes and a
run over ~1,900 cases takes minutes, so the two WILL overlap. The repair
loads every case up front, and a plain `updateCase` writes the whole row back
from that copy — which would roll back an ingest's projection, timeline, and
`last_changed_at` together.

So each write goes through `updateCaseRetailerNames`, which patches the
projection column alone and only while the row still carries the
`last_changed_at` it was read with (every real projection write moves it —
`pipeline.reprojectCase` sets it to `now`). An ingest landing mid-run makes
the update match no row; the repair then re-reads that case, re-derives from
the **newer** text, and retries once. Anything still moving is counted under
"Changed by ingest mid-run" and left for the next run.

The repair takes **no job lease** on purpose. Holding the FDA and FSIS leases
for the length of a maintenance pass would stall the agency feeds, and a
crash mid-pass would strand them until the TTL expired — a worse failure than
skipping a handful of cases that the next run picks up anyway.

## Geography: a one-time historical repair (C5.2A)

```
npm run repair:geography:dry    # report only, writes nothing
npm run repair:geography        # apply
npm run repair:geography:dry    # verify: "would update" must be 0
```

`projection.geography` is derived by `projectCase` from
`domain/geography-evidence.ts` (C5.2A), so every new and re-projected case
carries the canonical answer automatically. Cases stored _before_ that existed
will never be revisited by normal ingestion — the snapshot hash gate skips
unchanged pages by design — hence a one-time repair.

Same safety shape as the retailer backfill above: dry-run by default, explicit
`--apply`, **zero network requests**, and a single-field write through
`updateCaseGeography` that carries `timeline` and `lastChangedAt` through
untouched. It bypasses the pipeline's re-projection path entirely — no
material-change detection, no NotificationEvent, no new or merged cases, no
moved dates. This matters more here than for retailers: `detectChanges` DOES
diff geography, and a widening would fire `expansion_geography` and push a
"recall expanded" alert for a notice that has not changed since publication.
Reading evidence an older parser could not is not an agency announcement.

Narrowing is **refused, not applied**. Any state that would disappear turns the
case into a reported conflict, untouched, except one proven case: a state whose
name occurs in the notice only inside a longer state's name ("Virginia" read
out of "West Virginia"). Every removal is printed with its case id.

The dry run is the verification report. Read it for:

- `scope/state-list contradictions: 0 → 0` — the hard gate.
- `Conflicts` and `Failures` — both should be 0.
- `Table fragments NOT interpreted` — `WVA`, `RS` today. These are fragments
  the derivation refused to guess; if a future notice depends on one, it shows
  up here rather than silently going missing.
- `Effect on representative profiles` — matches/unknown/excluded per state,
  before and after. Cases moving from `unknown` into a state list that excludes
  a profile is the expected, correct direction: the source's own list is now
  being read.

Concurrency, lease behaviour and the single retry are identical to the
retailer backfill — see "Running it alongside scheduled ingestion" above; the
repair takes no job lease for the same reasons.

Note the case count: the repair uses `listCases()` and so also visits cases
merged into a duplicate (1,912 vs the 1,899 a consumer can read). Repairing a
merged row's geography is harmless and keeps it consistent if it is ever
unmerged; this matches the retailer backfill's behaviour.

## Allergen agent: a one-time historical correction (P2d-B)

**Status: applied and verified 2026-09-02.** The apply wrote 278 normalized
source-record corrections and 274 case-projection corrections, with 0 write
conflicts, 0 failures, and 0 notifications. The post-apply verification dry
run reported 0 remaining eligible record or case changes: the population is
settled. Named spot checks: FSIS 111-2015 corrected to
`undeclared eggs, milk, and wheat`; the Steak Burrito PHA corrected to
`undeclared egg`. The repository remained clean throughout. This is a
**completed historical repair, not a recurring operation** — the commands
below are kept as operational record and for the standing verification, not
as an invitation to rerun the apply:

```
npm run repair:allergens:dry           # verify: "would change" must be 0 — safe to rerun any time
npm run repair:allergens -- --confirm  # HISTORICAL APPLY — already run 2026-09-02; do NOT rerun casually.
```

The same post-apply report also listed 22 outside-category refusals and one
category conflict (PHA-07302018-1) — records P2d-B correctly left untouched
because they fell outside its allergen-only scope, not evidence that P2d-B
itself was incomplete or unauthorized. Those were investigated and resolved
separately by the P2e hazard-category repair below, whose own counts (49
records / 48 cases) are distinct from P2d-B's 278/274 and do not revise them.

P2d-A taught the one canonical extractor (`domain/hazard.ts`) the allergen
constructions FSIS and FDA actually publish, but stored `normalized` records
and case projections were computed with the old extractor, and the ingest hash
gate never revisits an unchanged page — hence a one-time correction.

Unlike the retailer and geography repairs, this one re-derives from **archived
official snapshots**, in the FDA image-backfill mold: it re-runs the canonical
adapters (`parseFsisRecord` / `parseFdaAnnouncement`) over the raw payload
each snapshot preserved — never a repair-only re-implementation of the
allergen rules — so a corrected value is exactly what ingestion would produce
today. Zero network requests; a record with no usable snapshot is reported and
never guessed.

It writes exactly two fields: `normalized.pathogenOrAllergen` (through a
compare-and-swap on the field's own current value — source records have no
version column an ingest reliably moves) and `projection.pathogenOrAllergen`
(through `updateCasePathogenOrAllergen`, conditional on `last_changed_at`,
with `timeline` and `lastChangedAt` untouched). Case-level precedence is
delegated to `projectCase` over the corrected records, so a multi-source case
resolves exactly as a real re-projection would. Rows that changed between the
dry-run read and the write are **skipped and reported**, never re-derived on
the fly — the apply writes only what the reviewed dry-run proposed. No
material-change detection (`detectChanges` has no hazard rule anyway), no
NotificationEvent, no snapshot/hash/date/lineage changes, no job lease.

Scope guardrails, straight from the P2d-A recorded-corpus evidence: only
records whose stored **and** re-derived hazard category is `allergen` are ever
written. A value difference on any other record — including a pathogen
record — is refused and reported (`REFUSED` buckets in the report; the command
exits non-zero if a pathogen record's agent would change). A re-parse that
moves the hazard category itself is likewise refused. The pre-existing
Yellow 5/Yellow 6 verbatim-fallback quirk is deliberately out of scope: stored
values already equal to the canonical derivation are never touched.

Applying is double-gated: `--apply` alone is refused; the second
acknowledgment (`--confirm`) must accompany it. `--json <path>` writes the
full machine-readable report including the per-record ledger. The operation is
idempotent and resumable; the dry run doubles as the post-apply verification
report.

**Status: applied 2026-09-02 and verified** — the post-apply production dry
run reported 0 remaining eligible corrections. Rerunning it is a safe no-op
and is the standing verification command.

## Hazard category: a one-time historical correction (P2e-B)

**Status: applied and verified 2026-09-03.** The apply wrote 49/49 planned
source-record corrections and 48/48 planned case-projection corrections (48
unique cases; one multi-source case, `007-2020` + `007-2020-EXP`), with 0 CAS
conflicts, 0 skipped writes, 0 failures, 0 notifications, 0 missing
snapshots, and 0 parse failures — exactly the reviewed population, exactly
the reviewed transition census below. The one expected agent-only refusal,
**083-2016**, was preserved untouched as designed. The post-apply
verification dry run reported 0 record changes and 0 case changes: the
population is settled. This is a **completed historical repair, not a
recurring operation** — the commands below are kept as operational record and
for the standing verification, not as an invitation to rerun the apply:

```
npm run repair:hazards:dry           # verify: "would change" must be 0 — safe to rerun any time
npm run repair:hazards -- --confirm  # HISTORICAL APPLY — already run 2026-09-03; do NOT rerun casually.
                                      # The approved-population guard (49/48) would refuse a second apply
                                      # anyway once the corpus is settled, but this is not a substitute
                                      # for treating it as a one-time operation.
```

P2e-A audited every record whose stored hazard category disagreed with its
official notice and found two shared causes, both fixed in the canonical
parser rather than in this repair: FSIS under-reports allergens in its
structured reason enum (20 notices filed `Misbranding`/`Mislabeling` or with
an empty reason state an undeclared allergen in prose), and a bare
material-word scan read **packaging** as foreign-material evidence (115-2017,
an undeclared-anchovy recall sold in "plastic bowls"). One further record,
PHA-07302018-1, is genuinely stale: it was ingested before Cyclospora entered
the canonical pathogen list, and the hash gate never revisits an unchanged
page. See [recall-domain-architecture.md](recall-domain-architecture.md),
"Canonical hazard-category precedence", for the rules themselves.

A second pass over the same bare-keyword foreign-material scan found 27 more
records on the same defect in both directions: 20 generic "Due to Possible
Foreign Matter Contamination" titles that named no material (`unknown`, not
`foreign_material`, because the old scan had nothing to match), and 7 where
the old scan matched a packaging word with no real contamination grammar
behind it (correctly `unknown`, not `foreign_material`). One of the 20 is the
`007-2020`/`007-2020-EXP` multi-source case. The approved-transition table and
population guard below cover the full, expanded 49-record/48-case scope.

Mechanically this is the P2d-B repair's safety pattern applied to a second
field pair. It re-derives from **archived official snapshots**, re-running the
canonical adapters (`parseFsisRecord` / `parseFdaAnnouncement`) over the raw
payload each snapshot preserved — never a repair-only re-implementation — so a
corrected value is exactly what ingestion would produce today. Zero network
requests; a record with no usable snapshot is reported and never guessed.

It writes exactly four fields: `normalized.hazardCategory` and
`normalized.pathogenOrAllergen` (one compare-and-swap guarded on **both**
observed values), and the same pair inside `projection` (through
`updateCaseHazard`, conditional on `last_changed_at`, with `timeline` and
`lastChangedAt` untouched). The pair is written together because it is one
fact — a category corrected without its agent would leave the projection
internally inconsistent. The generated `recall_cases.hazard_category` column
follows the projection JSON automatically and is **never written directly**.
Case-level precedence is delegated to `projectCase` over the corrected
records, so a multi-source case resolves exactly as a real re-projection
would. Rows that changed between the dry-run read and the write are **skipped
and reported**, never re-derived on the fly. No pipeline or material-change
invocation, no NotificationEvent, no snapshot/hash/date/lineage changes, no
job lease. Dates, classifications, geography, retailers, products, images and
the notification ledger stay byte-identical.

Scope guardrails, straight from the P2e-A evidence. A record is writable only
when its category moves along an **approved transition**:

| From               | To                        | Why                                                                             | Applied |
| ------------------ | ------------------------- | ------------------------------------------------------------------------------- | ------- |
| `other_regulatory` | `allergen`                | labeling-only reason, allergen stated in prose                                  | 15      |
| `unknown`          | `allergen`                | empty reason array, allergen stated in prose                                    | 5       |
| `foreign_material` | `allergen`                | 115-2017 — its "plastic" was the packaging                                      | 1       |
| `unknown`          | `microbial_contamination` | PHA-07302018-1 — ingested before Cyclospora                                     | 1       |
| `unknown`          | `foreign_material`        | generic "Foreign Matter Contamination" title, no material named in the old scan | 20      |
| `foreign_material` | `unknown`                 | old scan matched a packaging word, no contamination grammar                     | 7       |

Every other move is refused and reported, and the command exits non-zero. An
**agent-only** difference on a record whose category is unchanged is also
refused: that is what keeps **083-2016** byte-identical. Its
`other_regulatory` category is correct (produced without benefit of
inspection), and its stored `undeclared wheat` is a truthful-but-incomplete
pre-P2d artifact drawn from an editor's note about secondary cross
contamination — replacing it with null would lose information. Representing
several hazard roles on one case is deferred mixed-hazard debt with its own
model decision. Records P2d-B already corrected are re-derived to the same
values and reported `unchanged`.

The command also guards the **expected population**: the full P2e review
(P2e-A's original 22 plus the 27-record foreign-material follow-up)
source-reviewed exactly 49 record and 48 case corrections
(`APPROVED_RECORD_CORRECTIONS` / `APPROVED_CASE_CORRECTIONS` in
`src/server/hazard-repair.ts`), and a run proposing a larger, smaller, or
different set exits non-zero for review before any apply. An **empty** set (0
and 0) is not a failure — it is `settled`, exactly what the post-apply
verification dry run reported after the 2026-09-03 apply, and what any later
rerun will find as long as the corpus stays in this state.

Applying is double-gated: `--apply` alone is refused; the second
acknowledgment (`--confirm`) must accompany it. **Durable ledger:** an apply
always leaves a complete machine-readable report behind rather than trusting
terminal scrollback — `--json <path>` writes it where you ask, and with no
`--json` an apply writes a timestamped report to `.reports/` (git-ignored) and
prints the path. The ledger carries planned, applied, conflicted, refused,
failed and unchanged counts plus every before/after value. A dry run writes
one only when `--json` is given. The operation is idempotent and resumable;
the dry run doubles as the post-apply verification report.

Historical repair is **notification-silent by construction**: `last_changed_at`
never moves (it is the CAS predicate), the pipeline is never invoked, and
`detectChanges` has no hazard rule at all. Consumers still see the correction,
because the C8 feed manifest token is a read-time content hash over the
projection — no cache schema bump is needed, and no cache invalidation step
exists to forget. A **future** policy — that a source-driven hazard change on
an active case should be eligible for notification, while parser maintenance
and historical repairs must never be — is deliberately **not** implemented
here; `material-change.ts` was not modified in P2e-B.

**Status: applied and verified 2026-09-03** — 49/49 record writes, 48/48
case writes, 0 conflicts, 0 failures, 0 notifications; the post-apply
production dry run reported a `settled` population (0 record and 0 case
changes remaining). This is a completed one-time historical repair. Rerunning
the dry run is a safe, standing verification command; rerunning the apply is
not a normal operation — see the warning on the command block above.

## FDA contaminant category: a historical correction (P3B)

**Status: applied and verified 2026-09-04.** The apply wrote 3/3 planned
source-record corrections and 3/3 planned case-projection corrections across 3
active, distinct, single-source FDA cases, with 0 CAS conflicts, 0 skipped
writes, 0 refused transitions, 0 refused agent transitions, 0 missing
snapshots, 0 parse failures, 0 failures, 0 notification events, and 0 new
cases — exactly the reviewed population and exactly the approved transition
census (`foreign_material → chemical_contamination` ×3, agent
`null → asbestos` ×1 and `null → Cesium-137` ×2). The post-apply
verification dry run reported 0 record changes and 0 case changes: the
population is settled.

Bounded read-only verification confirmed the final stored values agree at both
layers — `normalized` on the source record and `projection` on the case:

| Notice                                       | Final stored value                      |
| -------------------------------------------- | --------------------------------------- |
| Dynarex Dynacare Baby Powder                 | `chemical_contamination` / `asbestos`   |
| AquaStar Cocktail Shrimp 6oz                 | `chemical_contamination` / `Cesium-137` |
| AquaStar Kroger Mercado Frozen Cooked Shrimp | `chemical_contamination` / `Cesium-137` |

It also confirmed that timelines and `lastChangedAt` did not move, that the
denormalized `recall_cases.hazard_category` column changed consistently with
`projection.hazardCategory`, and that no unrelated field, row or notification
record changed. No migration, deployment, ingestion run, or live FDA fetch
occurred. Manual simulator QA confirmed the three notices no longer describe
the hazard as foreign material.

This is a **completed historical repair, not a recurring operation** — the
commands below are kept as operational record and for the standing
verification, not as an invitation to rerun the apply:

```
npm run repair:fda-contaminants:dry            # verify: "would change" must be 0 — safe to rerun any time
npm run repair:fda-contaminants -- --confirm   # HISTORICAL APPLY — already run 2026-09-04; do NOT rerun casually.
                                                # Requires BOTH flags. The approved-population guard would refuse a
                                                # second apply once the corpus is settled, but that is not a
                                                # substitute for treating it as a one-time operation.
```

**Durable ledgers** (git-ignored, in `.reports/`, kept as operational
history): `p3b-dry-run.json` and `p3b-dry-run-2.json` (the two read-only
dry runs — the first predates the asbestos correction below and reported
Dynarex's agent as `null`; the second is the reviewed population that
authorized the apply), `p3b-apply.json` (the apply), and
`p3b-post-apply.json` (the settled post-apply verification).

**The defect.** The FDA reason category `Potential Metal or Chemical
Contaminant` is disjunctive — one taxonomy heading covering a physical
fragment hazard AND a chemical/radiological one — so the heading itself proves
neither. The committed parser decided between them with a bare scan for
material words anywhere in the announcement, so **packaging chose the
hazard**: the same false-positive shape P2e-B eliminated for FSIS, left open
on this one FDA branch. `deriveFdaHazard` now routes the branch through THE
shared evidence owner, `extractForeignMaterialEvidence` in
`src/domain/hazard.ts`, exactly as the FSIS `Product Contamination` branch
does. Nothing enumerates packaging nouns; the rule is the inverse, so an
unlisted container word cannot outrun it. See
[recall-domain-architecture.md](recall-domain-architecture.md), "Canonical
hazard-category precedence", for the rule itself and
[recall-source-contract.md](recall-source-contract.md) §3.1 for the source
behavior that makes the category ambiguous.

**The verified population.** A read-only comparison reparsed all 721 archived
FDA production snapshots (2026-09-03, 100% snapshot coverage) and found
exactly three canonical differences — all active, all in this category, all
stored `foreign_material` / null because the only material word in the
announcement described the package:

| Notice                                       | False trigger                      | What the source states                           | Correct value                           |
| -------------------------------------------- | ---------------------------------- | ------------------------------------------------ | --------------------------------------- |
| Dynarex Dynacare Baby Powder                 | "packaged in plastic bottles"      | "the potential to be contaminated with asbestos" | `chemical_contamination` / `asbestos`   |
| AquaStar Cocktail Shrimp 6oz                 | "packaged in a clear plastic tray" | contamination with Cesium-137 (Cs-137)           | `chemical_contamination` / `Cesium-137` |
| AquaStar Kroger Mercado Frozen Cooked Shrimp | "packaged in clear plastic bag"    | contamination with Cesium-137 (Cs-137)           | `chemical_contamination` / `Cesium-137` |

FDA's taxonomy has **no separate mineral or radiological category**, and P3B
deliberately does not add one. Within the closed schema the honest
representation of both asbestos and Cs-137 is the chemical category plus the
named agent — never a nameless foreign-material line, and never null when the
source states one. (Asbestos is not chemically a "chemical" in the strict
sense; this is the app's existing honest mapping onto its current closed
taxonomy, not a scientific classification claim.)

**The chemical-agent extractor now recognizes asbestos, evidence-gated.** The
Dynarex announcement directly states "the potential to be contaminated with
asbestos" — asbestos is not in `CHEMICAL_AGENTS`' historical bare-keyword list
(`lead`, `cadmium`, `arsenic`, `mercury`, `Cesium-137`), so leaving it there
left the agent null even though the source names it. `extractChemicalAgent`
(`src/domain/hazard.ts`) now also checks a second, evidence-gated list
(`EVIDENCE_GATED_CHEMICAL_AGENTS`, currently just `asbestos`) against a
bounded contamination construction — "contaminated with asbestos", "asbestos
contamination" — so a facility mention, an educational aside ("Asbestos is a
naturally occurring mineral...", which the same Dynarex announcement also
contains one sentence later), or a negated statement ("asbestos-free",
"contains no asbestos") is never mistaken for the product stating the hazard.
The historical bare-keyword agents are unchanged.

**The tooling.** `src/server/fda-contaminant-repair.ts` and
`scripts/repair-fda-contaminants.ts` are a separate, narrowly scoped repair
built on the P2d/P2e safety pattern. The settled P2e-B repair, its approved
49/48 population and its commands are **not** reopened or modified.

Scope is decided from the **archived official reason category** alone — never
from a title, product name, source id or native id. Only FDA announcement
records whose recorded category is `Potential Metal or Chemical Contaminant`
are planned; every other source system and every other FDA category is
out of scope and untouched, so this repair cannot reach the P2e-B population
or any FSIS row.

It writes exactly four fields: `normalized.hazardCategory` and
`normalized.pathogenOrAllergen` on source records (one compare-and-swap
guarded on **both** observed values), and the same pair inside `projection`
(through `updateCaseHazard`, conditional on `last_changed_at`). Category and
agent are written **together**, because they are one canonical fact. The
generated `recall_cases.hazard_category` column follows the projection JSON
automatically and is **never written directly**. Case reconstruction is
delegated to `projectCase` over the corrected records, so a multi-source case
resolves exactly as a real re-projection would, never by assumption. No
network, no pipeline, no `detectChanges`, no NotificationEvent, no job lease;
dates, classifications, states, retailers, products, images, raw snapshots,
hashes and the notification ledger stay byte-identical.

**Plan-then-apply.** Unlike P2e-B's single pass, P3B plans the entire
population first and only then writes, so a blocker anywhere refuses the
**whole** apply rather than being discovered after some rows were already
corrected. The blockers, each exiting non-zero with the ledger printed:

- a missing archived snapshot (its official category is unknowable, so the
  record cannot be ruled in or out of scope);
- a snapshot the canonical adapter cannot parse;
- a category transition outside the approved table;
- an agent transition outside the approved table;
- a population that is not the reviewed one.

Approved transitions, the only writable moves:

| From               | To                       | Approved agent moves                   | Expected |
| ------------------ | ------------------------ | -------------------------------------- | -------- |
| `foreign_material` | `chemical_contamination` | `null → asbestos`, `null → Cesium-137` | 3        |

**The applied population:** 3 source records and 3 case projections, all
active — `foreign_material → chemical_contamination` ×3, with agent
`null → asbestos` ×1 (Dynarex) and `null → Cesium-137` ×2 (both AquaStar
shrimp notices). The case structure was confirmed first by the 2026-09-03 dry
run (`.reports/p3b-dry-run.json`, pre-asbestos-correction — 3 distinct,
active, single-source cases, 0 multi-source; it reported Dynarex's agent as
`null → null` because it predates the asbestos correction), then by the
reviewed 2026-09-03 dry run (`.reports/p3b-dry-run-2.json`) carrying the
corrected agent census, and the 2026-09-04 apply matched it exactly. The dry
run now reports an **empty** set (0 and 0), which is not a failure — it is
`settled`, and it is what the standing verification must keep reporting.

Applying is double-gated: `--apply` alone is refused; the second
acknowledgment (`--confirm`) must accompany it. **Durable ledger:** an apply
always leaves a complete machine-readable report behind — `--json <path>`
writes it where you ask, and with no `--json` an apply writes a timestamped
report to `.reports/` (git-ignored) and prints the path. A dry run writes one
only when `--json` is given. The operation is idempotent and restartable;
rows that changed between the plan read and the write are **skipped and
reported**, never re-derived on the fly.

Historical correction is **notification-silent by construction**:
`last_changed_at` never moves (it is the CAS predicate), the pipeline is never
invoked, and `detectChanges` has no hazard rule at all. Consumers still see the
correction, because the C8 feed manifest token is a read-time content hash over
the projection — **no cache schema bump and no migration are needed**. Whether a
future **source-driven** hazard change on an active case should be eligible for
notification remains a separate policy milestone, deliberately not decided here;
`material-change.ts` was not modified in P3B.

**A later milestone touched these same notices for a different reason, and
needed no production action.** P3C (affected-product data and presentation
correctness) concerns affected-product codes, dates, barcodes, identifier
punctuation, and quantity presentation on the AquaStar and Dynarex notices,
not their hazard category.

**P3C-1 is implemented and is display-time only.** Its audit traced every
disputed value from the archived official payloads through parsing, normalized
data, projection and presentation model, and found the defects entirely in the
shared read path: no persisted value is wrong. It therefore has **no
operational surface at all** — no repair command, no dry run, no migration, no
backfill, no cache-schema bump, no re-projection, and no notification. There is
nothing here to authorize or to apply, and the P3B apply must not be rerun for
it.

**P3C-2 (affected-product row ownership) is implemented, simulator-verified,
and shipped** — committed and pushed in `51c1a7b`. The Affected Products table
is now the only visual owner of lot, batch, case, and production codes and of
row-applicable production dates; no code disclosure renders beneath the table.
AquaStar and Dynarex were verified in the live app. Like P3C-1 it is
display-time only: no production repair or migration was required, and there
is nothing here to authorize or to apply. If a canonical-data defect is ever
proven in this area, that correction is a separate repair needing its own
reviewed dry run and its own explicit apply authorization under the rules in
this document — it is in no way covered by the completed P3B authorization
above. See [recall-feed-usability.md](recall-feed-usability.md), "P3C —
affected-product data and presentation correctness".

## Enforcement: weekly-gated

The daily job reads the one-request openFDA bulk manifest and compares its
`export_date` to `completedExportDate` recorded by the last **applied**
reconciliation (a dry run records only `checkedExportDate`, so it can never
mask a real update). Unchanged ⇒ a seconds-long no-op run; changed ⇒ the
full canonical reconcile (`src/server/fda-enforcement/reconcile.ts`, the
same function the manual CLI runs). Matcher, thresholds, ambiguity handling,
class sets, tier projection, and historical suppression are Phase B's,
untouched. A run that would expose a mixed-class case as a scalar class
fails on a hard gate.

Dated status (O2-A, 2026-09-05): the daily check was running and healthy,
with the source export date 2026-08-27 sitting exactly at the ten-day stale
threshold — see the watch item under "Production verification (O2-A,
2026-09-05)".

## Secrets

Production jobs use two environment variables — `SUPABASE_URL` and
`SUPABASE_SECRET_KEY` — supplied as GitHub Actions repo secrets (Settings →
Secrets and variables → Actions), locally via `.env` (gitignored). A third,
`EXPO_ACCESS_TOKEN`, is optional and only needed if enhanced push security is
enabled on the Expo account (docs/recall-push-delivery.md). All are
server-only, never in any `EXPO_PUBLIC_*` variable, never printed by any job,
and the iOS export is grepped for secret markers as a standing gate.

The scheduler watchdog adds two Supabase-side credentials — a fine-grained
GitHub token (`GITHUB_ACTIONS_TOKEN`, Edge Function secret only) and the
cron shared secret (`WATCHDOG_SHARED_SECRET`, Edge Function secret + Vault +
optionally local `.env` for the probe CLI). Neither is a repo secret, neither
appears in any table, log, or migration; docs/recall-scheduler-watchdog.md
§Credentials has scopes and rotation.

## Activation (C1 founder steps — completed; kept as record)

_These steps were the original C1 activation, and they were carried out in
2026-08: the measured delivery windows above record live `schedule` runs on
this repository, and the applied repairs in this document record dated
production writes through the same job layer. The list is kept as the
operational record of what activation involved (and as the template for a
re-activation after a credential loss), not as pending work._

1. Review + apply the ops migration: `supabase db push`
   (adds `ingest_runs` job columns, `job_leases` + lease functions,
   `product_visual_failures`; additive only).
2. Add the two repo secrets `SUPABASE_URL` and `SUPABASE_SECRET_KEY` on GitHub.
3. Commit + push the C1 changes — pushing the workflow files **enables** the
   schedules.
4. Watch the first runs (Actions tab, or `gh run list`), then
   `npm run ops:health` — all four jobs should go healthy within a day
   (enforcement after its first daily run).
5. In GitHub notification settings, keep "Actions: only notify for failed
   workflows" on — that is the founder alerting channel for now.

Cost at current scale: ~$0–8/month (GitHub Actions minutes on a private repo
beyond the 2,000 free — the skip gate keeps most ticks ~1 minute; Supabase
stays on its current plan; no new egress of note). The knob is the tick
cadence: hourly fits the free tier, 30 min costs a few dollars.
