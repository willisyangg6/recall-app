# Alert timing: evidence and decisions

How long it takes from an agency or retailer publishing a recall to Lotly handing an alert to Expo,
measured stage by stage in production. It also records why the Costco monitor ran 8–12 hours apart,
the scheduling change that fixes it, and the proposed overnight-hold scope.

This document owns the **timing evidence and the scheduling decision**. The rules themselves live
in their own documents:

- The hold's rule: [Overnight sending hold](recall-push-delivery.md#overnight-sending-hold-d1-founder-approved-2026-10-14).
- The retailer job: [Scheduled runs](recall-retailer-notices.md#scheduled-runs).
- The watchdog: [recall-scheduler-watchdog.md](recall-scheduler-watchdog.md).

Measured read-only on 2026-11-19 at about 06:30 UTC, using `supabase db query --linked` (SELECT
only) and the public GitHub Actions API. Nothing was written, dispatched, sent or replayed.

## Stages

Each stage has one source of truth. They are kept distinct because each has a different cause and
a different fix.

| #   | Stage               | Where it is recorded                                                   |
| --- | ------------------- | ---------------------------------------------------------------------- |
| 1   | Source publication  | The agency page: FDA "FDA Publish Date", FSIS `field_recall_date`      |
| 2   | First discovery     | Earliest `source_snapshots.fetched_at` for the record                  |
| 3   | Ingestion           | `recall_cases.created_at` (the canonical case)                         |
| 4   | Verification        | Agency: none needed. Retailer: `retailer_notice_approvals.approved_at` |
| 5   | Alert creation      | `notification_events.created_at`                                       |
| 6   | Queue eligibility   | `notification_deliveries.created_at` (a matching subscription)         |
| 7   | Scheduled execution | The push run that attempts the row (`ingest_runs`, `push_delivery`)    |
| 8   | Provider acceptance | An Expo ticket: `status` `ticket_accepted`, `sent_at`                  |

**Publication time of day is not published.** FDA's publish date is a date with no time (it renders
as midnight New York). FSIS's recall and last-modified dates are dates only. The company announcement
date on an FDA page sometimes carries a time. So stage 1 → 2 can be measured only when that time
exists; otherwise it is bounded by the ingest cadence.

## Agency recalls, stage by stage

Every new-recall alert from the last 12 days. Times are UTC on 2026-11.

| Recall                        | Company announcement | FDA publish date | 2. First fetched | 3+5. Case and alert | 6. Queued             | 8. Expo                                   |
| ----------------------------- | -------------------- | ---------------- | ---------------- | ------------------- | --------------------- | ----------------------------------------- |
| Naia sorbetto (FDA)           | 16 14:18             | 17               | 17 14:46         | 17 14:50            | 17 14:50              | None: one not entitled, one HTTP 403 ×5   |
| ALDI Priano (FDA)             | 16 16:20             | 17               | 17 17:46         | 17 17:51            | 17 17:55              | None: not entitled                        |
| Larbi Yellow Dock (FDA)       | 17 23:30             | 17               | 18 00:41         | 18 00:46            | 18 00:46              | None: HTTP 403 ×5                         |
| Fresh & Ready expansion (FDA) | 17 16:18             | 18               | 18 18:16         | 18 18:34            | 18 18:34              | None yet: HTTP 403 ×4, then held at 22:00 |
| Family Farmstead (FDA)        | Oct 15               | 10               | 11 00:11         | 11 00:18            | No subscriber matched | —                                         |
| FSIS public health alert      | —                    | 14 (recall date) | 14 23:05         | 14 23:13            | No subscriber matched | —                                         |
| Fresh & Ready (FDA)           | 08                   | 08               | 09 12:50         | 09 12:55            | No subscriber matched | —                                         |

What this shows:

- **1 → 2:** the one sample with a real time, Larbi, was fetched 71 minutes after the company's
  stated announcement time. For the rest it is bounded by the cadence below: about 45 minutes, at
  most about an hour.
- **2 → 3 and 5:** 4–18 minutes. The detail page is fetched and the pipeline runs inside the same
  tick, and the alert is written in the same transaction as the case.
- **5 → 6:** 0–4 minutes. The push step runs after ingestion in the same workflow run.
- **6 → 8: no production sample yet.** Every send since activation (2026-10-16) got Expo HTTP 403,
  because the GitHub secret was misnamed. That was fixed on 2026-11-19, and the first real send is
  pending. Rows were also deferred by the overnight hold on 6 nights in 30 days, for up to about
  12 hours each. None of those rows reached Expo either, because of the 403.
- **Verification (4):** agency alerts have no human step. The official agency page is the evidence.

Classification updates arrive differently. The weekly openFDA export creates 4–7 "classified Class
I/II" updates on weeks-old recalls in one run (2026-11-03, 11-10, 11-17). The `daily-maintenance`
reconcile creates them. It is scheduled for 09:15 UTC, but GitHub started it between 15:48 and 19:49
UTC on each of the last 10 days.

## Cadence by job

Seven days to 2026-11-19 06:30 UTC. Gaps are between run starts.

| Job                 | Runs | Failed | Lease skips | Median gap | 90th pct | Longest  |
| ------------------- | ---- | ------ | ----------- | ---------- | -------- | -------- |
| `fda_announcements` | 236  | 1      | 0           | 44.9 min   | 48.2 min | 59.8 min |
| `fsis_ingest`       | 236  | 0      | 0           | 44.9 min   | 52.4 min | 63.3 min |
| `push_delivery`     | 243  | 0      | 0           | 44.7 min   | 52.4 min | 57.8 min |
| `fda_enforcement`   | 7    | 0      | 0           | 23.6 h     | 25.9 h   | 27.2 h   |
| `retailer_costco`   | 12   | 0      | 0           | 8.0 h      | 10.7 h   | 11.6 h   |

`retailer_costco` covers its whole life, 2026-11-15 to 11-19.

**Agency cadence is the watchdog's, not cron's.** Since 2026-11-12, `scheduled-ingest.yml` ran 22
times from its own cron and 190 times from `workflow_dispatch`. The watchdog accepted 211 dispatches
in 7 days (all HTTP 200, none failed). It dispatches when FDA or FSIS has had no success for 40
minutes (`stale_after_minutes`), so the real cadence is about 45 minutes. Its last invocation was
06:30 UTC. Successful agency runs take 65 s to 23 min, with a median of 6 min.

## Why Costco ran 8–12 hours apart

Every possible cause was checked against production:

| Check                  | Finding                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------- |
| Cron expression        | `23 */2 * * *`: correct, 12 ticks a day                                               |
| Ticks GitHub delivered | 12 of about 48: every run was a `schedule` event                                      |
| Run outcome            | 12 of 12 succeeded, in 8–20 s                                                         |
| Cancellations          | None. The concurrency group never held a pending run                                  |
| Queued or stuck runs   | None                                                                                  |
| Lease skips            | None (`job_leases` held no stale `retailer_costco` lease)                             |
| Stale-run detection    | None. The watchdog covers only FDA and FSIS, and nothing re-dispatches a dropped tick |

So the gaps are **dropped GitHub schedule events, nothing else**. This repository has measured that
before: 24% delivery on `*/30` and 9% on the `:07/:37` offset in August, which is why the watchdog
exists. A different cron frequency would not help: dropped events are not queued, so a more frequent
cron only adds more events to drop. `daily-maintenance.yml` shows the same problem as lateness rather
than loss.

**ALDI and the store listing jobs.** ALDI is in the same workflow behind `RETAILER_ALDI_ENABLED`
(off). Run as it is, it would get the same 8–12-hour gaps. Store listings are manual in this
release. When they are scheduled, they should use the same mechanism as below, not a new cron.

## Decision 1: retailer monitors ride the agency tick

**Change:** `scheduled-ingest.yml` gains two jobs, `retailer-costco` and `retailer-aldi`, behind a
new repository variable, `RETAILER_ON_INGEST` (unset by default). The jobs themselves gain a **due
gate**: a run whose last success started less than 100 minutes ago stands down before fetching
anything (`minSuccessIntervalMinutes` in `src/server/jobs/runner.ts`).

**Why this is the smallest reliable fix:**

- **It reuses the trigger that already works.** The watchdog is independent of GitHub's scheduler
  (Supabase Cron every 5 minutes), and it already starts this workflow about every 45 minutes. No
  migration, no Edge Function change and no new secret is needed.
- **It keeps the nominal two-hour cadence.** On the measured tick grid, the first tick at or after
  100 minutes runs: typically about 2 h 15 min after the last success, at most about 2 h 45 min.
  Costco's index is fetched about 11 times a day, the same as the intended 12.
- **Agency ingestion is isolated.** The jobs are separate, run in parallel on their own runners and
  have no `needs:`. A retailer failure never stops an agency step. The watchdog reads agency
  freshness, never a run's conclusion. A retailer job can hold the run open only for its 8-minute
  timeout, and normally finishes well before the agency job. A failure turns the run red, which is
  intended.
- **Cost:** the repository is public, so standard runners are not billed (the timing API reports 0
  billable ms). The gate makes the extra ticks cost one `npm ci` and one database read.

`retailer-notices.yml` keeps its cron and manual dispatch as a free extra chance. Manual dispatch
obeys the gate. To force a run inside the interval, run `npm run jobs:retailer-costco -- --force`
locally.

### No double processing, no duplicate alert

Recovery and overlap are safe by construction. The PR adds no new path that could double-process:

1. **One run at a time.** Both triggers (the agency tick and the retailer cron) take the same
   Postgres lease (`job_leases`). The due gate is read **inside** the lease, so two triggers that
   arrive together run once. The second stands down (`skipped_lease`), and the next one finds the
   fresh success (`skipped_not_due`). `retailer-costco-job.test.ts` proves this with two
   simultaneous triggers.
2. **Idempotent writes.** A rerun of the retailer monitor plans no write when nothing changed (the
   stable-JSON comparison), and archives a document only when its hash is new.
3. **No alert path.** The retailer monitors never write the notification ledger
   ([recall-retailer-notices.md](recall-retailer-notices.md)). They cannot send, or duplicate, an
   alert.
4. **The agency path is unchanged.** Watchdog dispatches are atomic claims, with one claim per
   cooldown. Alerts are keyed by `dedup_key` (unique), and deliveries by (event, subscription)
   (unique). A delivery that holds a ticket is never re-sent. The one documented at-least-once edge
   is unchanged: a crash between the Expo request and the ticket write.

### Independent stale-job detection

- **Detection:** the watchdog (Supabase Cron, independent of GitHub) detects stale FDA/FSIS and
  dispatches. Because the retailer jobs now ride that dispatch, a stalled retailer monitor is
  retried on the next tick (within about 45 minutes) without a retailer-specific watchdog.
  `ops:health` reports a retailer job degraded after 12 hours and UNHEALTHY after 24.
- **A failed run never counts as recent,** so the gate never delays a retry.
- **A crashed or timed-out run** leaves its lease for at most 30 minutes (`leaseTtlSeconds`). After
  that the next tick runs.
- **Not covered here:** a run stuck in GitHub's queue with no runner (the 2026-10-05 incident)
  blocks the whole `scheduled-ingest` group. The detection and recovery for it is the unmerged
  `ingest-watchdog-stuck-queue` branch (`ae63fc5`). It is unchanged by this work.

### Automatic collection latency versus reviewer latency

Retailer notices have two independent delays. Only the first is automatic:

1. **Collection (automatic):** retailer publication → the next successful monitor run. Before the
   change, this was 8–12 hours with no maximum. With `RETAILER_ON_INGEST`, it is about 2¼ hours
   typical and about 2¾ hours worst on the measured grid, plus the gate's own interval if the notice
   lands just after a run.
2. **Review (human):** a new candidate is shown only after a reviewer approves it. This has no
   automatic bound. There is **no production sample**: no approval rows exist, and Costco has
   published no new notice since the 2026-11-14 seed.

Neither delay affects an alert: retailer notices do not send any.

## Decision 2: the overnight hold covers updates, not new recalls (proposed, switched off)

**Today (D1):** no alert is sent 22:00–09:59 New York time. Everything due then waits for the first
run after 10:00, for up to about 12 h 53 min.

**Proposed policy:** send new matching recall alerts without the blanket delay.

**What the PR does:** it adds a hold **scope**, read from the repository variable
`PUSH_OVERNIGHT_HOLD`.

- **Unset, or any other value: `all`.** This is today's rule, byte for byte. Merging changes
  nothing.
- **`except_new_recalls`:** during the hold hours, a due delivery is sent at once only when all
  three are true. Everything else still waits for 10:00:
  1. It is a new-recall alert (`initial`). Updates, classifications and retractions stay held. This
     is what keeps the weekly classification batch, scheduled for about 04:15 New York time, from
     sending at night.
  2. The agency announced it within the late-alert window: fewer than 3 New York calendar days ago,
     with a readable date. An older recall Lotly has only just found waits for the morning and gets
     the dated wording (D4).
  3. Its alert was created within the last 12 hours (`OVERNIGHT_FRESH_HOURS`).

**How it avoids releasing a burst of historical alerts:**

- **Rule 3** keeps any backlog (a provider outage, an entitlement backlog, retries) for the morning,
  so recovering at night never releases a pile of queued alerts at 3 a.m.
- **Rules 1 and 2** keep weeks-old recalls and batch updates in the morning.
- **The existing guards are unchanged:** the 30-day backfill suppression, the activation,
  subscription and preference horizons, and the 1,000-send cap per run.
- **Switching it on mid-night** releases only that night's fresh new-recall alerts. Nothing is
  replayed: rows are re-judged, never re-created.

**Local time and user settings: neither is available.**

- No device time zone, quiet-hours preference or locale is stored. `push_subscriptions` and
  preferences hold none.
- A shopper's chosen states are not a time zone: one shopper chose all 52 jurisdictions.
- A per-user rule would need a new client field (for example, the device's IANA zone at
  registration), a migration and a new build. That is out of scope here.
- The phone's own Focus and Sleep schedules already silence notifications for people who set them.

**Public wording:** no app copy names the hold hours. The Terms describe _sending_, never arrival.
Check the published website legal pages before switching the scope on.

## Rollout (integrator)

Merging the PR changes no production behaviour: both variables are unset by default. Each step
below is a separate production decision for the founder:

1. **Merge** the PR after `ea9e475`. Expect no change in runs: the new jobs show as "skipped".
2. **Retailer cadence:** set the repository variable `RETAILER_ON_INGEST=true` (Settings → Secrets
   and variables → Actions → Variables). Then verify:
   - The next `scheduled-ingest` run shows a `retailer-costco` job that either succeeds or logs
     `not due`.
   - Over the next 6 hours, `retailer_costco` gaps stay under about 2¾ hours. Use
     `npm run ops:health`, or the `ingest_runs` query in this document.
   - **Rollback:** delete the variable.
3. **ALDI:** unchanged. It still needs its migration and `RETAILER_ALDI_ENABLED=true`. It then rides
   the same tick automatically.
4. **Overnight hold:** set `PUSH_OVERNIGHT_HOLD=except_new_recalls`, but only after the founder
   approves the policy and the first real Expo send is confirmed on a phone. Then:
   - Expect `sendingHoldExempted` in the first `push_delivery` run's metrics after 22:00 New York
     time. It stays 0 when no new recall arrives.
   - **Rollback:** delete the variable. The rule returns to `all` on the next run.
