# Recall operations: scheduled ingestion (Phase C1)

_Written 2026-08-26. Turns the manually-operated pipelines into a
continuously-running service. Push delivery is Phase C2 — nothing here
touches devices; the pipeline still ends at the NotificationEvent ledger._

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

**This is a hypothesis under observation, not a proven fix.** GitHub does not
publish its contention model, and the offset is an inference from documented
behaviour plus the measurement above. See the verification procedure below
before treating it as settled.

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

### The unchanged-source skip gate

Both fast feeds return their entire content every fetch. Each job hashes the
fetched content (order-insensitively — the FDA listing is not date-sorted)
and compares it to the hash recorded by the last successful run: identical
content skips the per-record processing entirely (~1-minute tick instead of
~5–8 minutes). The gate can only ever skip work the per-record snapshot hash
gate would also have skipped, so it cannot change outcomes — only cost. The
FDA gate requires both the listing AND the RSS to be fetched and unchanged,
so an RSS-only discovery is never delayed. `--force` bypasses the gate.

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

`npm run ops:health` answers, from the database alone: the most recent
**attempt** and the last **success** per job, staleness against per-job
expectations (fast jobs 3 h, labels/enforcement ~daily, enforcement export ≤ 10
days old), newest-source staleness (a silent feed alarm at 14 days), the
label-failure backlog, and the 7-day deliverable/suppressed notification flow.
Non-zero exit when anything is UNHEALTHY.

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

## Secrets

Production jobs use two environment variables — `SUPABASE_URL` and
`SUPABASE_SECRET_KEY` — supplied as GitHub Actions repo secrets (Settings →
Secrets and variables → Actions), locally via `.env` (gitignored). A third,
`EXPO_ACCESS_TOKEN`, is optional and only needed if enhanced push security is
enabled on the Expo account (docs/recall-push-delivery.md). All are
server-only, never in any `EXPO_PUBLIC_*` variable, never printed by any job,
and the iOS export is grepped for secret markers as a standing gate.

## Activation (founder steps — nothing is deployed until these run)

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
