# Production runbook (P2B7R)

_Read-only operational audit, 2026-09-19. Nothing in production was changed,
triggered, or written by this audit._

This document answers the founder-facing questions: **where recalls are
ingested, what it depends on, what breaks it, how you would find out, what it
costs, and what is left before external users.** It is the escalation and
recovery home.

It deliberately does **not** restate job semantics — the lease protocol, skip
gates, run bookkeeping, health thresholds, and the full repair history live in
[recall-operations.md](recall-operations.md), which stays authoritative for
those. Where this document names a mechanism, that file explains it.

| You want                              | Read                                                         |
| ------------------------------------- | ------------------------------------------------------------ |
| Job semantics, schedules, repairs     | [recall-operations.md](recall-operations.md)                 |
| Why the watchdog exists, its protocol | [recall-scheduler-watchdog.md](recall-scheduler-watchdog.md) |
| Verified FDA/FSIS source behavior     | [recall-source-contract.md](recall-source-contract.md)       |
| Client caching and sync protocol      | [recall-feed-sync.md](recall-feed-sync.md)                   |
| Push pipeline detail                  | [recall-push-delivery.md](recall-push-delivery.md)           |
| Founder/counsel inputs before launch  | [recall-launch-blockers.md](recall-launch-blockers.md)       |

---

## 1. The eleven questions, answered plainly

**1. Where are new recalls ingested?** In the cloud, on GitHub's servers.
Every production run is a GitHub Actions job on a `ubuntu-latest` runner that
checks out this repository, installs dependencies, and writes to Supabase.

**2. Does ingestion depend on your computer?** No. Your laptop runs the same
commands when you choose to, and they take the same lease, but nothing waits
on it. Ingestion has been running continuously — measured 807 FDA and 807 FSIS
executions in the last 30 days — with no local involvement.

**3. Does any AI or LLM process production recalls?** **No.** There is no AI
dependency of any kind in the production path. See §4 for the evidence.

**4. Which workflow runs ingestion?** `.github/workflows/scheduled-ingest.yml`
runs FDA, FSIS, labels, and push in that order.
`.github/workflows/daily-maintenance.yml` runs the weekly-gated openFDA
enforcement reconciliation and the full label sweep once a day.

**5. When and how often?** Effectively **every ~45 minutes, around the
clock** — but _not_ from the cron line in the file. The Supabase scheduler
watchdog is the real scheduler (§2). Measured over the last 7 days: 248 FDA
and 248 FSIS executions, median gap **44 minutes**, worst gap **56 minutes**.
The `7,37 * * * *` cron in the workflow is a best-effort bonus that GitHub
delivers unreliably (measured 9–24% historically).

**6. Does pushing master change production ingestion?** **Yes — this is the
single most important thing to understand.** GitHub Actions runs whatever is
on `master` at the moment a run starts. There is no build, no deploy step, and
no separate release. Pushing master _is_ deploying the ingestion pipeline.

**7. Does a push trigger ingestion immediately?** **No.** Neither workflow has
a `push` trigger. A push changes _what the next run executes_, not _when_ it
runs. This was observed live during this audit: commit `73e5dd6` was pushed at
18:58 UTC; nothing ran; the next watchdog dispatch at 19:25 UTC started a run
holding the lease as `runnervmlun5p:2174:73e5dd643502` — the newly pushed
code, 27 minutes later.

**8. What happens when the mobile app is released?** Nothing changes
server-side. Ingestion, the database, and the schedule are already running in
their production shape and are independent of App Store state. What changes is
load: each install performs a first full sync (~345 KB) and then incremental
syncs (~38 KB each). See §13.

**9. How do new recalls reach every shopper?** Today, **only when the app
asks.** The app syncs on cold launch and on pull-to-refresh. Push notification
delivery is built but deliberately inactive (§8), and there is no background
refresh. See §7 and the P0 finding in §11.

**10. What happens when a dependency fails?** See the failure-mode table in
§10. In short: the pipelines only ever add, so a failure leaves the last good
data visible rather than deleting anything — but with one important exception,
a failure is not currently _announced_ to you (§11).

**11. What operational work remains before launch?** See §11 — one P0, five
P1s.

---

## 2. Architecture and data flow

```
  ┌─ Supabase Cron (pg_cron, every 5 min) ────────────────────────────┐
  │        ↓ net.http_post + Vault-held shared secret                 │
  │  Edge Function  ingest-watchdog                                   │
  │        ↓ watchdog_tick()  — one atomic Postgres decision          │
  │  stale > 40 min?  no ingest running?  no dispatch in 20 min?      │
  │        ↓ yes to all: claim, then                                  │
  │  POST api.github.com /actions/workflows/scheduled-ingest.yml      │
  │       /dispatches   {"ref": "master"}                             │
  └───────────────────────────────┬───────────────────────────────────┘
                                  │  (GitHub's own `7,37 * * * *` cron
                                  │   also fires here, best-effort)
                                  ▼
        GitHub Actions runner (ubuntu-latest, node 24)
        checkout master → npm ci → four sequential steps:

   ┌──────────────┐  ┌──────────────┐  ┌──────────┐  ┌────────────┐
   │ jobs:fda     │→ │ jobs:fsis    │→ │jobs:labels│→ │ jobs:push  │
   └──────┬───────┘  └──────┬───────┘  └────┬─────┘  └─────┬──────┘
          │                 │               │              │
   www.fda.gov       www.fsis.usda.gov   label PDFs    exp.host
   (listing + RSS)   (Drupal JSON API)   → PNG render   (NO-OP: not
          │                 │               │            activated)
          └────────┬────────┴───────────────┘
                   ▼
         scripts/run-job.ts  →  runJob()
                   ▼
         acquire_job_lease(job, holder, ttl)   ── Postgres, atomic
                   ▼
         canonical pipeline (src/server/pipeline.ts)
           parse → normalize → quarantine on failure
           → applied-version gate (archived vs APPLIED)
           → archive_snapshot()        ← transaction 1
           → case linking / merge / projection
           → material-change detection
           → apply_case_transition()   ← transaction 2 (CAS on
                 projection + timeline + affected_products
                 + notification_events + applied markers)
              or found_recall_case()   ← transaction 2', new cases
                   ▼
         finishIngestRun + annotate  →  ingest_runs row
                   ▼
         release_job_lease
                   ▼
  ┌────────────────── Supabase Postgres ─────────────────────────────┐
  │ recall_cases · affected_products · product_visuals   ← anon READ │
  │ consumer_feed_manifest (view)                        ← anon READ │
  │ source_records · source_snapshots · notification_events          │
  │ ingest_runs · job_leases · push_* · watchdog_*   ← service only  │
  └───────────────────────────────┬──────────────────────────────────┘
                                  ▼   PostgREST + RLS, publishable key
                      Mobile app (Expo / React Native)
                      manifest diff → changed rows only
                      → on-device cache → Feed / Saved
```

**Ordered execution, one tick.** Watchdog decides → GitHub dispatches →
runner checks out master HEAD → `npm ci` → for each of the four jobs:
acquire lease (skip and record if held) → fetch source → empty/halved guard →
whole-feed hash gate (skip if unchanged) → per-record parse and quarantine →
per-record applied-version gate → archive snapshot → link/merge → project →
diff → atomic case transition → ledger events → mark applied → finish and
annotate the run row → release lease. A non-zero exit marks the step failed;
later steps still run (`if: ${{ !cancelled() }}`).

### Reliability properties (verified in code and against production)

| Property                         | Answer                                                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Transaction boundaries           | Three Postgres functions: `archive_snapshot`, `apply_case_transition`, `found_recall_case`. Each is one transaction.                   |
| Per-case vs whole-run            | Per **case**. One `apply_case_transition` per changed case; the run is a loop, not a transaction.                                      |
| Idempotency boundary             | Per source record, via `applied_content_hash` + `applied_snapshot_seq`. Re-running is safe and cheap.                                  |
| Compare-and-set guards           | `apply_case_transition` requires `last_changed_at = expected`; 3 attempts then the item stays pending. Markers are sequence-monotonic. |
| Partial-write risk               | Bounded to "archived but not applied" — a durable, retryable `pending` state, not a torn consumer view.                                |
| One case fails                   | Isolated: recorded in `itemFailures`, every sibling still applies, run downgrades to `partial`. >20% failures fails the run loudly.    |
| One agency fails, other succeeds | **Yes, by design** — separate workflow steps guarded by `!cancelled()`.                                                                |
| Retry behavior                   | FSIS 4× with fingerprint rotation; FDA 3×; read-only DB calls 4× (500 ms·2ⁿ, cap 5 s). **No mutation is ever auto-retried.**           |
| Source request timeouts          | **None on the FDA/FSIS feed fetches** — bounded only by the 25-minute workflow timeout and lease TTL. Binary fetches use 45 s.         |
| Database statement timeouts      | Supabase default; PG `57014` is classified transient and retried on reads. One occurrence in 30 days (enforcement, 2026-09-08).        |
| Raw evidence retained            | **Yes** — `source_snapshots` is append-only and holds the verbatim agency payload (10,721 rows). Full replay is possible.              |
| Failed run safely rerunnable     | **Yes.** Idempotent by construction; the next tick _is_ the retry.                                                                     |

---

## 3. Workflow inventory

Both workflows are identical in shape; only their triggers, steps, and
timeouts differ.

|                         | `scheduled-ingest.yml`                                                                          | `daily-maintenance.yml`                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Purpose                 | Fast channel: FDA + FSIS + labels + push                                                        | openFDA enforcement + full label sweep                   |
| Schedule (UTC)          | `7,37 * * * *`                                                                                  | `15 9 * * *`                                             |
| Timezone                | UTC only (GitHub cron has no timezone)                                                          | UTC                                                      |
| `workflow_dispatch`     | Yes — the watchdog's target and your recovery path                                              | Yes                                                      |
| `push` / `pull_request` | **None**                                                                                        | **None**                                                 |
| Default-branch behavior | `schedule` runs only on `master` (GitHub rule)                                                  | Same                                                     |
| Permissions             | `contents: read` (explicitly narrowed)                                                          | `contents: read`                                         |
| Concurrency             | group `scheduled-ingest`, `cancel-in-progress: false`                                           | group `daily-maintenance`, same                          |
| Cancellation            | Queues, never cancels a running job                                                             | Same                                                     |
| Environment             | None (no GitHub Environment protection rules)                                                   | None                                                     |
| Runner                  | `ubuntu-latest`, Node 24, npm cache                                                             | Same                                                     |
| Timeout                 | 25 min                                                                                          | 110 min                                                  |
| Retry                   | None at the workflow level — the next tick is it                                                | Same                                                     |
| Matrix                  | None                                                                                            | None                                                     |
| Dependent workflows     | None                                                                                            | None                                                     |
| Commands                | `jobs:fda`, `jobs:fsis`, `jobs:labels`, `jobs:push`                                             | `jobs:enforcement`, `jobs:labels -- --full`, `jobs:push` |
| Artifacts retained      | None — only GitHub's own run logs                                                               | None                                                     |
| Secrets referenced      | `SUPABASE_URL`, `SUPABASE_SECRET_KEY`                                                           | Same                                                     |
| Production services     | www.fda.gov, www.fsis.usda.gov, Supabase, exp.host                                              | api.fda.gov, www.fsis.usda.gov, Supabase, exp.host       |
| Third-party actions     | `actions/checkout@v7`, `actions/setup-node@v7` — GitHub-owned, **mutable tags, not SHA-pinned** | Same                                                     |

Every step is the same `npm run jobs:*` script a human runs, and every one
lands in `scripts/run-job.ts` — pinned by
`src/server/jobs/workflow-schedule.test.ts`.

### What a push to master does and does not do

Verified against current GitHub documentation and confirmed live in
production during this audit.

| Question                                                   | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does scheduled ingestion run only from the default branch? | **Yes.** "Scheduled workflows will only run on the default branch."                                                                                                                                                                                                                                                                                                                                                                          |
| Does it use the latest master commit?                      | **Yes.** "Scheduled workflows run on the latest commit on the default branch."                                                                                                                                                                                                                                                                                                                                                               |
| Does pushing master launch anything immediately?           | **No.** Neither workflow has a `push` trigger.                                                                                                                                                                                                                                                                                                                                                                                               |
| Does a push change what the next run executes?             | **Yes.** The next run — cron or watchdog dispatch — checks out the new HEAD. Master is the deploy channel.                                                                                                                                                                                                                                                                                                                                   |
| Can a UI-only commit change server behavior?               | **Yes, indirectly.** Every run re-installs from `package-lock.json` and re-runs whatever is on master. A UI commit that also touches `package.json`/`package-lock.json`, any file under `src/server/`, `src/domain/`, `src/lib/`, `scripts/`, or the workflow YAML changes the next run. A commit touching only `src/app/` or `src/components/` does not — but note `src/lib/` and `src/domain/` are shared by the app **and** the pipeline. |
| Do separate FDA/FSIS workflows explain the run clusters?   | **No — there are no separate workflows.** See §5.                                                                                                                                                                                                                                                                                                                                                                                            |
| Can multiple workflows or retries overlap?                 | Structurally possible, empirically never: **0 lease skips and 0 same-job execution overlaps in 30 days.**                                                                                                                                                                                                                                                                                                                                    |
| Do concurrency settings prevent duplicates?                | Two layers do. The `concurrency` group queues at GitHub; the Postgres `job_leases` row is the real rail and also covers laptop runs.                                                                                                                                                                                                                                                                                                         |

Sources: [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows),
[Create a workflow dispatch event](https://docs.github.com/en/rest/actions/workflows?apiVersion=2022-11-28).

---

## 4. Dependency inventory

### Production AI dependency: none

**Conclusion: no AI, LLM, embedding, vector, OCR, or hosted-inference
dependency exists anywhere in the production path.** Every classification —
hazard category, allergen, illness status, food category, risk tier, retailer,
geography — is deterministic code in `src/domain/` and `src/server/`, tested
against recorded real agency fixtures.

Evidence:

- The 22 runtime dependencies are Expo/React Native packages plus
  `@supabase/supabase-js`. No inference SDK is present.
- A repository-wide search for `openai`, `anthropic`, `gemini`, `bedrock`,
  `azure-ai`, `huggingface`, `replicate`, `together`, `groq`, `cohere`,
  `mistral`, `ollama`, `vertex-ai`, `langchain`, `llamaindex`, `embedding`,
  `pinecone`, `weaviate`, `qdrant`, `tesseract`, `ocr`, and `gpt-` returns
  **zero production hits**. The only `openai` string in the repository is
  `supabase/config.toml:101`, a commented default in the Supabase CLI's
  **local dev-stack** scaffold (Supabase Studio's assistant). It is not read
  by any job, is not set in production, and the local stack is not used.
- Every outbound host in `src/server/`, `scripts/`, and
  `supabase/functions/` is one of: `www.fsis.usda.gov`, `www.fda.gov`,
  `api.fda.gov`, `api.github.com`, `exp.host`, or the Supabase project.
- `src/server/fsis/labels.ts` renders label PDFs to images "on canvas — no
  OCR, no models, no network". `src/server/push/format.ts` composes
  notification text with "No LLM, no raw agency headlines".

**Development tools are not runtime dependencies.** Claude, Codex, Fable, and
Opus are used to _write_ this repository. They are not invoked by any job, are
not in `package.json`, hold no credentials used by production, and no
production data path passes through them. Recall content is never generated,
summarized, or classified by a model.

### Non-AI production dependencies

| Dependency                        | Role                                                        | Failure blast radius                                          |
| --------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------- |
| GitHub Actions                    | The compute that runs every job                             | Ingestion stops entirely; app serves last good data           |
| Supabase Postgres                 | The only stateful store                                     | Ingestion fails **and** the app cannot sync                   |
| Supabase Edge Functions + pg_cron | The scheduler watchdog                                      | Ingestion falls back to GitHub cron (measured 9–24% delivery) |
| Supabase Storage                  | Rendered FSIS label images                                  | Detail-screen label images fail; recall text unaffected       |
| www.fsis.usda.gov                 | FSIS recalls/PHAs JSON API + label PDFs                     | FSIS recalls stop updating; FDA unaffected                    |
| www.fda.gov                       | FDA announcement listing, RSS, detail pages, product photos | FDA recalls stop updating; FSIS unaffected                    |
| api.fda.gov (openFDA)             | Enforcement classification reconciliation                   | Risk classifications stop advancing; recalls still ingest     |
| api.github.com                    | The watchdog's dispatch target                              | Watchdog cannot dispatch; falls back to GitHub cron           |
| exp.host (Expo Push)              | Push transport                                              | **Currently inert** — push is not activated                   |
| APNs / FCM                        | Device delivery, behind Expo                                | Currently inert                                               |
| Analytics / crash reporting       | **None.** No analytics, crash, or telemetry SDK is present. | —                                                             |

### Secrets, by name only

| Name                                   | Lives in                                    | Purpose                                                            |
| -------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------ |
| `SUPABASE_URL`                         | GitHub Actions repo secret; local `.env`    | Supabase project endpoint                                          |
| `SUPABASE_SECRET_KEY`                  | GitHub Actions repo secret; local `.env`    | **Service role — bypasses RLS entirely.** Server-only.             |
| `EXPO_ACCESS_TOKEN`                    | Optional, server env only                   | Expo enhanced push security; not currently required                |
| `GITHUB_ACTIONS_TOKEN`                 | Supabase Edge Function secret **only**      | Fine-grained PAT, this repo only, Actions: RW. Expires 2027-08-28. |
| `WATCHDOG_SHARED_SECRET`               | Edge Function secret + Vault + local `.env` | Authenticates pg_cron → Edge Function                              |
| `EXPO_PUBLIC_SUPABASE_URL`             | App bundle (public by design)               | Client read endpoint                                               |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | App bundle (public by design)               | Client key, constrained by RLS to read-only                        |

No value appears in this document, in any table, log, migration, or the app
bundle.

---

## 5. What the observed run clusters actually were

The clusters you noticed are **one workflow run executing its four steps in
sequence**, not duplicate schedules, retries, or concurrent matrix jobs.

Each `scheduled-ingest` run produces four `ingest_runs` rows —
`fda_announcements`, `fsis_ingest`, `fsis_labels`, `push_delivery` — carrying
the **same git SHA**, seconds apart, because the FSIS/labels/push steps are
fast (0.4–2 s) once FDA finishes.

The specific windows:

- **~18:03 on 2026-09-19** — a single run. `fda_announcements` started
  17:59:57 and took 3 m 14 s (a real per-record pass); `fsis_ingest` then
  started at 18:03:12, `fsis_labels` at 18:03:13, `push_delivery` at 18:03:16.
  Four rows stamped 18:03 are the tail of one run, all `bdd5cdbcc215`.
  It overlapped your repair dry run only in wall-clock time: a dry run keeps
  lease and run bookkeeping in a `MemoryStore` and writes nothing to
  production, so there was no interaction.
- **~05:15** — same pattern. On 2026-09-12: FDA at 05:10:10, then FSIS
  05:14:51, labels 05:14:53, push 05:14:56.
- **~04:36** — same pattern. On 2026-09-11: labels 04:35:26, push 04:35:28,
  FDA 04:39:39.

**Why they drift across the clock.** The watchdog dispatches on a _freshness_
rule, not a wall-clock one: it fires ~40–45 minutes after the last success,
so run times precess rather than landing on fixed minutes. Measured dispatch
intervals over 7 days: min 15 min, median 45 min, max 85 min.

**No duplicate execution occurred.** Over 30 days: **0 lease skips** (no run
ever found the lease held) and **0 same-job execution overlaps**. Over 7 days
the watchdog recorded 207 dispatch claims — 206 accepted, 1 failed
(`github_server_error`, retried automatically) — all targeting
`willisyangg6/recall-app` / `scheduled-ingest.yml` / `ref: master`, and
nothing else.

This is fully distinguishable from the evidence in the database; no telemetry
is missing for this question. The one thing that still cannot be established
from the database alone is the **exact split between GitHub cron and watchdog
dispatch**, because GitHub's authoritative run history is not readable here
(no `gh`, no local GitHub credential by design). Watchdog dispatches are
verifiable directly; cron delivery remains an inferred upper bound.

---

## 6. Live production evidence (read-only, 2026-09-19)

All figures measured directly from production during this audit.

**Health: all jobs healthy.** Watchdog healthy, 0 consecutive failures.

| Job                 | 7d executions | outcomes                    | median gap | worst gap | p50 duration |
| ------------------- | ------------- | --------------------------- | ---------- | --------- | ------------ |
| `fda_announcements` | 248           | 244 ok, 4 partial, 0 failed | 44.4 min   | 56.4 min  | 108 s        |
| `fsis_ingest`       | 248           | 248 ok                      | 43.8 min   | 56.3 min  | 0.8 s        |
| `fsis_labels`       | 255           | 254 ok, 1 partial           | 43.2 min   | 55.4 min  | 1.4 s        |
| `push_delivery`     | 255           | 255 ok (no-send no-op)      | 43.1 min   | 55.4 min  | 0.4 s        |
| `fda_enforcement`   | 7             | 7 ok                        | 23.9 h     | 26.1 h    | 1.4 s        |

- **Zero failed runs in the last 7 days.** Over 30 days there were 4, all in
  the 2026-09-08/09 incident already hardened and documented: one enforcement
  statement timeout and three FDA fetch faults (Cloudflare 502, a persistent
  404, and an HTML-on-200 parse).
- **Longest gap between fast-channel successes, 7 days: 56 minutes.**
- **Watchdog heartbeat: 2,016 of 2,016 expected invocations in 7 days
  (100%)**, gap p50 5.00 min / p95 5.01 / max 5.11. Decisions: 1,715 `fresh`,
  207 `dispatch_claimed`, 94 `dispatch_cooldown`, 0 `ingest_running`,
  0 `configuration_error`, 0 probes.
- **Skip gate effectiveness (7d):** FSIS took the unchanged-source gate on
  238/248 runs (96%), mean 1.7 s vs 17.8 s overall; FDA on 124/248 (50%),
  mean 1.1 s vs 114.4 s overall. This is what keeps ticks cheap.
- **Work done (7d):** 5 new cases, 17 changed cases, 10 notification events,
  1,990 FDA detail pages fetched, 0 detail-fetch failures, 7 quarantined
  records, 0 item failures, 0 deferred, 0 stale-skipped, 0 CAS exhaustions.
- **Corpus:** 1,931 recall cases (911 active, 1,019 closed, 1 retracted);
  **898 consumer-visible**; 3,550 source records; 10,721 raw snapshots;
  4,896 affected products; 3,055 product visuals; 2,374 notification events.
- **Freshness by agency:** FDA newest publication 2026-09-18, 720
  consumer-visible active; FSIS newest publication 2026-09-09, 178
  consumer-visible active. FSIS's older date reflects an unchanged upstream
  feed, not a missed ingest — the FSIS job succeeded every ~45 minutes and
  the hash gate correctly skipped per-record work.
- **Known backlog, unchanged:** 3 permanently failing FSIS label PDFs; 1
  legacy-unverified source record (the governed FSIS 083-2016 exception).

---

## 7. Mobile data delivery

**The path.** Ingest writes `recall_cases`. RLS exposes only
`state = active AND merged_into IS NULL` to the publishable key. The client
reads the `consumer_feed_manifest` view (id + content-hash token, 898 entries,
~38 KB gzip, one request), diffs it against the on-device cache, downloads
only changed rows, and commits atomically. A sync yields a **complete** corpus
or throws — never a partial feed. Feed and Saved share one session; Saved is
ids resolved against the live corpus, never a stored copy. Preferences are
applied on-device. Images load lazily from www.fda.gov and Supabase Storage.

**When the app actually syncs — and when it does not.**

| Situation                       | Behavior                                                                    |
| ------------------------------- | --------------------------------------------------------------------------- |
| Cold launch                     | Renders the cache instantly, then syncs in the background. ✅               |
| Pull-to-refresh (Feed or Saved) | Full reconciliation. ✅                                                     |
| **Returning from background**   | **No sync.** There is no `AppState` listener anywhere in `src/`. ❌         |
| **Background refresh**          | **None.** No `expo-background-task`, no `UIBackgroundModes`. ❌             |
| No network                      | Cached corpus renders; "Lotly couldn't reach the recall service…" appears.  |
| Sync fails with a cached corpus | Cache is kept and shown, with the same message. Never a blank screen.       |
| Corrupt/stale-schema cache      | Discarded whole; cold load. Cache schema version guards this.               |
| Closed / retracted / merged     | Drops out of the manifest and is removed from the cache in the same commit. |
| Feed size limit                 | **None.** The loader pages to exhaustion; the old 500-row window is gone.   |

**So: how soon does a shopper see a new recall?**

- **Open app, user pulls to refresh:** immediately.
- **Open app, user does nothing:** never, until they pull to refresh or the
  app cold-launches.
- **Closed app, reopened after iOS killed the process:** on that cold launch —
  so in practice, within one app open.
- **Backgrounded app resumed without a process kill:** **not at all.** This is
  the P0 in §11.
- **Without network:** cached corpus, with an explicit message.

Worst case end-to-end with push off: up to ~56 minutes of ingestion latency,
plus however long until the shopper next cold-launches or pulls to refresh.

**Shared vs user-specific.** Everything in the feed is shared public recall
data — identical for every shopper. User-specific data is preferences
(state, allergens, retailers), saved recall ids, and the push token, all keyed
by an opaque random installation UUID. **Scales with users:** sync egress and
image traffic. **Scales with recalls:** database size, manifest size, cold-load
size. **Scales with saved items/preferences:** almost nothing — saved ids are
local, preferences are one small row.

---

## 8. Push readiness

**Current state, from production evidence: not activated.**
`push_delivery_config` is **empty** (no `push_enabled_at` row), `ops:health`
reports `not activated (no-send state)`, and `notification_deliveries` holds
**0 rows**. There is 1 push subscription and 3 installation preference rows
(development devices). The `jobs:push` step has run 255 times in 7 days and
sent nothing.

| Question                    | Answer                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What creates ledger entries | The canonical pipeline, inside `apply_case_transition` — one event per distinct material change.                                                        |
| What selects recipients     | `classifySubscriptionsForEvent` — the one seam. Requires the event to postdate `max(push_enabled_at, subscription.enabled_at, preferences.updated_at)`. |
| Device tokens               | `push_subscriptions`, keyed by an opaque client-generated UUID. RLS on, no policies, no anon grants.                                                    |
| Authentication              | None — bearer-capability model. The installation UUID is the credential; write-only RPCs, no enumeration.                                               |
| Provider                    | Expo Push Service (`exp.host`) → APNs/FCM. No Apple/Google credentials in this repo.                                                                    |
| Retry / dedup               | `(event_id, subscription_id)` unique row created **before** any send. Bounded to 5 attempts, backoff 30 min·2ⁿ capped at 6 h.                           |
| Badge / deep link           | Tap → `/recall/[id]`.                                                                                                                                   |
| Failure recording           | Tickets and receipts recorded separately; `DeviceNotRegistered` disables the subscription.                                                              |
| Rate limits                 | Expo: 100 messages/request, 600/s/project. The worker chunks to 100.                                                                                    |
| Env / secrets               | Only `EXPO_ACCESS_TOKEN`, and only if enhanced push security is enabled.                                                                                |
| Activation safeguards       | Three independent horizons (global, per-subscription, per-preference). Activation requires `npm run push:activate -- --confirm` and is never inferred.  |

**Unresolved blockers before activation:** the 2,374-event historical ledger
must remain structurally unreachable (it is, by the activation horizon, but
this deserves one explicit pre-activation verification); the allergen-data
architecture question in
[recall-launch-blockers.md](recall-launch-blockers.md) §2 is unresolved and
push eligibility reads the server-side allergen mirror; and quiet hours do not
exist, so an activated system can notify at 3 a.m.

**The activation milestone is separate and must not be folded into other
work.** It should: verify the horizon against the live ledger read-only;
confirm the App Privacy label and counsel answers; add quiet hours or an
explicit decision not to; run `push:test` to a founder device; then
`push:activate -- --confirm` with `--deactivate --confirm` rehearsed as the
documented off switch.

---

## 9. Security and secret boundaries

| Finding                                                                                                                                                                                                                                                                                                                                      | Grade                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| The app embeds only the **publishable** key. RLS limits it to `recall_cases`, `affected_products`, `product_visuals`, and the `consumer_feed_manifest` view.                                                                                                                                                                                 | Acceptable              |
| Every other table has RLS enabled with **no policies and no anon grants** — structurally unreachable by the client.                                                                                                                                                                                                                          | Acceptable              |
| The unauthenticated write surface is exactly 4 `SECURITY DEFINER` RPCs (push register/disable, preferences, installation deletion) plus 4 shopper-report RPCs, each with `set search_path = public`, strict shape validation, and no enumeration oracle. Shopper reports are **disabled** in production (`reports_enabled = false`, 0 rows). | Acceptable              |
| Installation ids are `Crypto.randomUUID()` in SecureStore — 122 bits. Guessing another installation is infeasible.                                                                                                                                                                                                                           | Acceptable              |
| Workflow `permissions: contents: read` — narrower than default.                                                                                                                                                                                                                                                                              | Acceptable              |
| **No `pull_request` or `pull_request_target` trigger exists**, so no fork PR can run these workflows or reach production secrets at all.                                                                                                                                                                                                     | Acceptable              |
| Secrets are masked by GitHub, never printed by any job, and the iOS export is grepped for secret markers as a standing gate.                                                                                                                                                                                                                 | Acceptable              |
| **`SUPABASE_SECRET_KEY` is set at job level, so `npm ci` runs with the service-role key in its environment.** A malicious `postinstall` anywhere in the dependency tree could exfiltrate full production read/write. The lockfile bounds but does not eliminate this.                                                                        | **Important hardening** |
| **`actions/checkout@v7` / `actions/setup-node@v7` are mutable tags, not SHA-pinned.** GitHub-owned, so low risk, but tag mutation is the documented supply-chain vector.                                                                                                                                                                     | **Important hardening** |
| **`workflow_dispatch` can target an arbitrary ref.** Anyone with write access (or a token with Actions: write) could push a branch and dispatch it with the production service-role secret. No GitHub Environment protection rules exist.                                                                                                    | **Important hardening** |
| Anyone with repository write access can read all repository secrets (GitHub's documented model). Currently a sole-owner repository.                                                                                                                                                                                                          | Acceptable now          |
| **Branch protection on `master` is not verifiable from the repository** and must be inspected in GitHub settings. Since master _is_ the deploy channel, this matters.                                                                                                                                                                        | **Unknown — inspect**   |
| **Whether GitHub emails you when a _watchdog-dispatched_ run fails is unverified.** GitHub notifies "workflows you've triggered"; for scheduled workflows, the creator. Watchdog dispatches are made by a PAT, not by the cron.                                                                                                              | **Unknown — inspect**   |
| No secret rotation runbook exists for `SUPABASE_SECRET_KEY` or `GITHUB_ACTIONS_TOKEN` (which expires 2027-08-28).                                                                                                                                                                                                                            | Important hardening     |

---

## 10. Failure modes

| Failure                                                            | Current behavior                                                                      | Shopper impact                                   | Detection                                           | Recovery                               | Missing protection                          | Severity |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------- | -------------------------------------- | ------------------------------------------- | -------- |
| GitHub schedule delayed                                            | Watchdog dispatches on freshness instead                                              | None — measured worst gap 56 min                 | `ops:health`                                        | Automatic                              | —                                           | Low      |
| GitHub schedule disabled                                           | Watchdog still dispatches; cron is a bonus only                                       | None                                             | `ops:health`                                        | Any commit re-arms cron                | —                                           | Low      |
| **Watchdog stops** (pg_cron off, function undeployed, PAT expired) | Falls back to GitHub cron alone (measured 9–24%)                                      | **Recalls go stale, silently**                   | `ops:health` / `scheduler:status` — **manual only** | Redeploy function; rotate PAT          | **No dead-man alert**                       | **High** |
| Workflow code regression                                           | Next run executes the new master HEAD                                                 | Depends on the regression                        | `npm run check` pre-push; run failure               | Revert and push                        | No staging environment                      | Medium   |
| FDA unavailable                                                    | 3 bounded retries, then run fails; FSIS/labels/push still run                         | FDA recalls stop updating; FSIS unaffected       | `ingest_runs.outcome = failed`; `ops:health` 3 h    | Next tick retries                      | Alerting (§11 P0)                           | Medium   |
| FSIS unavailable                                                   | 4 retries with fingerprint rotation, then fails; FDA unaffected                       | FSIS recalls stop updating                       | Same                                                | Next tick retries                      | Alerting                                    | Medium   |
| Agency HTML/schema change                                          | Parse quarantine; >20% quarantine **fails the run loudly**                            | New recalls stop appearing for that source       | `ops:health`, quarantine counts in `metrics`        | Fix parser, push, next tick re-ingests | Alerting                                    | Medium   |
| Source returns empty/halved                                        | **Treated as SOURCE FAILED** — ingests nothing, fails loudly                          | None — last good data stands                     | Run failure                                         | Next tick                              | Alerting                                    | Low      |
| Duplicate concurrent runs                                          | Concurrency group queues; Postgres lease stands the second down                       | None                                             | `metrics.skippedLease` row                          | Automatic                              | —                                           | Low      |
| Statement timeout                                                  | PG `57014` classified transient; 4 bounded read retries                               | None                                             | Run metrics / `ops:health`                          | Automatic, else next tick              | —                                           | Low      |
| Partial database write                                             | Bounded to `pending` (archived-not-applied); retried next tick                        | None — no torn consumer view                     | Applied-version section of `ops:health`             | Automatic                              | —                                           | Low      |
| Supabase unavailable                                               | Jobs fail; **app cannot sync either**                                                 | App serves cached corpus with a failure message  | Run failure; Supabase dashboard                     | Wait; next tick retries                | Alerting; no status page subscription       | High     |
| Service secret invalid                                             | Every job fails immediately                                                           | Recalls freeze                                   | Run failure                                         | Rotate and update the repo secret      | **No rotation runbook**                     | High     |
| Malformed recall record                                            | Quarantined with its raw payload retained; siblings unaffected                        | That one recall is missing                       | Quarantine count in `metrics`                       | Fix parser; re-ingest is automatic     | Per-record quarantine alerting              | Medium   |
| Identity / merge error                                             | Expansion guards reject unless corroborated — a false merge is worse than a duplicate | Duplicate or conflated case                      | `qa:duplicates`                                     | `reconcile:duplicates`                 | Not on a schedule                           | Medium   |
| Image / label PDF failure                                          | Per-PDF backoff (6 h·2ⁿ, cap 7 d); 3 permanently failing today                        | Missing label image; recall text unaffected      | `ops:health` label backlog                          | Daily full sweep retries               | —                                           | Low      |
| Client offline                                                     | Cached corpus + explicit message                                                      | Sees last synced data, told it may be stale      | In-app                                              | Reconnect                              | —                                           | Low      |
| **Stale client cache while server is healthy**                     | Sync succeeds; app shows whatever the server has                                      | **Shopper sees a stale feed with no indication** | **None**                                            | Pull to refresh                        | **Freshness indicator; foreground refresh** | **High** |
| Push provider unavailable                                          | Bounded retries, then permanent failure recorded                                      | None — push is inactive                          | `ops:health` delivery counters                      | Automatic                              | —                                           | Low      |
| Bad notification fan-out                                           | Three horizons make historical events structurally undeliverable                      | None today                                       | Dry-run review output                               | `--deactivate --confirm`               | Pre-activation horizon verification         | Medium   |

---

## 11. Launch readiness

### P0 — must fix before external users

**P0-1. Ingestion can go stale silently, on both sides.**

Two halves of one failure, and neither is currently detected:

- _Server side:_ the only alerting channel is GitHub's per-user workflow
  notification. Nothing watches the watchdog. If pg_cron stops, the Edge
  Function is undeployed, or the PAT is revoked, ingestion degrades to GitHub
  cron's measured 9–24% delivery — and you would only find out by running
  `ops:health` by hand. There is no dead-man alert.
- _Client side:_ the app has **no freshness indicator anywhere** and **never
  refreshes on foreground**. A successful sync against a database that stopped
  updating three days ago renders exactly like a current one. For an app whose
  purpose is recall alerts, presenting a stale corpus as current is materially
  misleading.

Minimum fix: an automated freshness alert that reaches you without your
running anything (a `dead-man` check on last successful fast-channel run,
delivered somewhere you actually read), **plus** an `AppState` foreground
revalidation and a visible "checked X ago" signal derived from real data.

### P1 — strongly recommended before launch

1. **Narrow the workflow `env:` scope** so `SUPABASE_SECRET_KEY` is set only
   on the steps that need it, not on `npm ci`. Four lines of YAML; removes a
   whole supply-chain exfiltration path.
2. **SHA-pin the two GitHub actions**, per GitHub's own hardening guidance.
3. **Verify and document the alerting reality**: confirm in GitHub settings
   whether you receive failure email for watchdog-dispatched runs, and confirm
   branch protection on `master` — which is the deploy channel.
4. **Write the secret-rotation runbook** for `SUPABASE_SECRET_KEY` and
   `GITHUB_ACTIONS_TOKEN` (expires 2027-08-28), before you need it.
5. **Adopt explicit freshness SLOs** and encode them in `ops:health` (§12).

### P2 — can follow launch

1. Add per-request timeouts to the FDA/FSIS feed fetches (currently bounded
   only by the 25-minute workflow timeout).
2. Decide a retention policy for `source_snapshots` (~1,780 rows/week) and
   `ingest_runs` (~1,000/week). Neither is near a limit; both grow forever.
3. Put `qa:duplicates` and `qa:feed` on a schedule rather than running them by
   hand.
4. Extend the watchdog to cover `daily-maintenance` — currently measured
   healthy (7/7 in 7 days, worst gap 26.1 h), so this is not urgent.
5. Update [recall-data-flow-audit.md](recall-data-flow-audit.md) §4, which
   predates the shopper-report and installation-deletion RPCs and so
   understates the anon RPC surface by five functions.

---

## 12. Recommended SLOs

Derived from measured behavior, not guessed. Current worst-case observations
in parentheses.

| Metric                                     | Target   | Alert at              | Basis                                           |
| ------------------------------------------ | -------- | --------------------- | ----------------------------------------------- |
| Age of last successful fast-channel run    | ≤ 60 min | 3 h                   | Observed worst gap 56 min; matches `ops:health` |
| Watchdog heartbeat age                     | ≤ 10 min | 15 min                | 5-min cadence, 100% delivery measured           |
| Age of last successful daily job           | ≤ 24 h   | 30 h warn / 36 h fail | Already derived and implemented                 |
| Consecutive watchdog dispatch failures     | 0        | 2                     | Already implemented                             |
| Newest source publication age (per agency) | ≤ 7 d    | 14 d                  | Existing silent-feed alarm                      |
| Failed runs in a rolling 24 h              | 0        | 2                     | 0 in the last 7 days                            |
| Quarantined records per run                | 0        | >5% of feed           | 7 in 7 days across ~568k items seen             |

**Recovery procedure.** Run `npm run ops:health`. If a fast job is stale,
check `npm run scheduler:status` — a dead heartbeat means the watchdog, not
ingestion. If the watchdog is healthy but runs are failing, read the error on
the newest `ingest_runs` row. The safe manual recovery is always
`npm run scheduler:probe -- --dispatch`, or the Actions tab's "Run workflow".
Running a job by hand is equally safe: it takes the same lease and records the
same bookkeeping. **Every job is idempotent — rerunning a failed run cannot
double-apply anything.**

**Recovery boundaries.** Raw agency payloads are retained in
`source_snapshots`, so any run can be replayed. Failures never delete or close
recalls — the pipelines only ever add. What is _not_ automatically recoverable:
a bad parser that silently mis-normalizes valid records (it would need a
governed repair, as in the O3 and P2B7L waves), and anything requiring a
migration.

---

## 13. Capacity and cost

**Costs independent of user count** (everything today):

| Driver          | Measured workload                                                                      | Formula                                          |
| --------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------ |
| GitHub Actions  | ~32 runs/day × ~2–5 min ≈ **1,900–4,800 min/month** on a **private** repo (2,000 free) | `runs/day × 30 × avg_minutes`                    |
| Edge Function   | 8,640 invocations/month (500K free)                                                    | `288/day × 30`                                   |
| Database size   | **~107 MB logical** after ~30 days                                                     | `Σ(rows × avg_row)`; snapshots dominate at 52 MB |
| Snapshot growth | ~1,780 rows/week ≈ **~9 MB/week logical**                                              | `rows/week × 5 KB`                               |
| Ingest egress   | ~85 KB per full FDA run, ~145 KB per full FSIS run                                     | already optimized by C8 identity slices          |

**Costs that grow with recalls:** database size, manifest size (898 entries =
~38 KB gzip), cold-load size (~345 KB gzip for 898 cases ≈ **0.38 KB/case
gzip**).

**Costs that grow with users:**

```
monthly egress ≈ installs × 0.345 MB                  (first sync)
               + users × syncs_per_user_per_month × 0.038 MB
               + image traffic (Supabase Storage label images;
                 FDA product photos are served by www.fda.gov, not us)
```

At 1,000 monthly users syncing 30×/month: ~0.35 GB of first syncs + ~1.1 GB of
incremental syncs ≈ **1.5 GB/month**, before images. At 10,000: ~15 GB/month.
The Supabase project already outgrew the Free plan's 5 GB egress during
development.

**Costs that grow with saved items or preferences:** effectively zero. Saved
ids are local; preferences are one small row per installation.

**To turn these into dollars you need:** the current Supabase plan and its
included database/egress/storage quotas, the current GitHub plan and Actions
minute balance (private-repo minutes are billed), the Supabase dashboard's
actual database size and egress for the last full billing period, and — once
push is live — expected notification volume. Every formula above is stated so
you can evaluate it against those numbers; no dollar figure is estimated here
because the plan details are not in the repository.

---

## 14. Known limitations of this audit

- **GitHub's authoritative run history was not readable** (no `gh`, no local
  GitHub credential, by design). Workflow-run attribution is reconstructed
  from `ingest_runs.version` and `watchdog_dispatches`. Watchdog dispatches
  are verified directly; the exact cron-vs-dispatch split is an inferred
  upper bound.
- **Branch protection and GitHub Environment rules are not visible** from the
  repository and must be inspected in GitHub settings.
- **Whether failure email reaches you for watchdog-dispatched runs is
  unverified** — no run has failed in the last 7 days to test it.
- All production figures are **dated measurements of 2026-09-19**, not
  standing guarantees. Re-run `npm run ops:health` for current state.

## 15. Read-only commands used

```bash
npm run check           # typecheck + lint + 2,710 tests — all green
npm run ops:health      # live job/source/watchdog health
npm run scheduler:status# watchdog invocation + dispatch history
npm run qa:feed         # client feed completeness against the service role
npm run qa:egress       # cold/warm sync bytes and manifest gates
git diff --check
```

Plus ad-hoc read-only `SELECT`s (no `insert`/`update`/`delete`/`rpc`) against
`ingest_runs`, `watchdog_invocations`, `watchdog_dispatches`, `watchdog_config`,
`job_leases`, `source_records`, `source_snapshots`, `recall_cases`,
`affected_products`, `notification_events`, `notification_deliveries`,
`push_subscriptions`, `push_delivery_config`, `installation_preferences`,
`shopper_reports`, and `shopper_report_config`.
