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

Known platform caveats (accepted): cron ticks can lag minutes at busy times,
and GitHub disables cron workflows after 60 days without repo activity (a
warning email precedes it; any commit re-arms it).

## Job units and schedules (all UTC)

| Job               | Command                    | Schedule                               | Why this cadence                                                                                                                                                                         |
| ----------------- | -------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FDA announcements | `npm run jobs:fda`         | every 30 min                           | Fast consumer channel; one listing fetch + one RSS fetch per tick (source contract §9 recommends 30–60 min).                                                                             |
| FSIS recalls/PHAs | `npm run jobs:fsis`        | every 30 min                           | Same: one API call returns the whole feed.                                                                                                                                               |
| FSIS labels       | `npm run jobs:labels`      | every 30 min (recent) + daily `--full` | New notices get visuals within a tick; the daily sweep retries failures and re-verifies the recent window.                                                                               |
| FDA enforcement   | `npm run jobs:enforcement` | daily 09:15                            | The source updates **weekly**; the daily run is one manifest request, and the full download + reconcile happens only when the export date moves.                                         |
| Push delivery     | `npm run jobs:push`        | end of both workflows                  | Events created in a tick are delivered the same cycle; the next tick reads receipts (≥15 min, per Expo guidance). No-send no-op until `push:activate`. See docs/recall-push-delivery.md. |

Workflows: `.github/workflows/scheduled-ingest.yml` (the 30-min tick, running
fda → fsis → labels as independent steps) and
`.github/workflows/daily-maintenance.yml` (enforcement → labels `--full`).
Agency polling runs around the clock — quiet hours are a notification-
delivery concern (Phase C2), never an ingestion one.

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

## Run bookkeeping and health

Every job execution ends as exactly one `ingest_runs` row (the pipeline's own
row for FDA/FSIS full runs, a runner-created row otherwise) carrying:
`job_name`, `outcome` (`succeeded` / `partial` / `failed`), compact `metrics`
(counts, feed hash, newest source date, notification tallies — never logs),
`version` (git SHA), and `error`. `partial` means completed with item-level
failures (quarantined records, failed detail fetches, failed label PDFs).

`npm run ops:health` answers, from the database alone: last run and last
success per job, staleness against per-job expectations (fast jobs 3 h,
labels/enforcement ~daily, enforcement export ≤ 10 days old), newest-source
staleness (a silent feed alarm at 14 days), the label-failure backlog, and
the 7-day deliverable/suppressed notification flow. Non-zero exit when
anything is UNHEALTHY.

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
