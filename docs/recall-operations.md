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

**OUTCOME (2026-08-28): the offset did not work.** The 22-hour window under
`:07/:37` delivered at most 4 of 44 expected ticks (~9%, worse than the 24%
baseline; median gap 386 min, worst 694 min), none of the observed starts
landed on a scheduled minute, and `ops:health` attributed every gap to
scheduler silence — the reconsideration bar below was met. The fix is the
**Supabase scheduler watchdog** (docs/recall-scheduler-watchdog.md): Supabase
Cron → Edge Function → atomic claim → `workflow_dispatch` on this same
workflow whenever FDA/FSIS freshness lapses. The cron entry stays as a free
best-effort extra tick during the watchdog observation period; do not rely on
it for freshness.

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
the external scheduler exists: see docs/recall-scheduler-watchdog.md for the
architecture, activation, rollback, and the new `Scheduler watchdog` section
in `ops:health` plus `npm run scheduler:status` / `npm run scheduler:probe`.

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
  Activation requires `supabase db push` of
  `20260904000000_consumer_feed_manifest.sql`; until then clients fall back
  to exactly the pre-C8 complete load.
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
touches `projection.heroImageUrl` — professional card-hero sourcing is
C9.1 (docs/recall-imagery.md).

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
PROFESSIONAL PACKSHOT coverage (not yet measured — C9.1 defines it).
`qa:imagery` gates on the frozen interim policy — zero label renders
promoted to card hero, zero unknown-provenance heroes, zero
URL-normalization drift — with bounded live probes only, never a corpus
download. There is deliberately NO imagery repair command: the only
historical repair C9 contemplated was blanket hero promotion of ordinary
label renders, which the professional-imagery objective forbids;
`src/server/imagery-guards.test.ts` keeps every promotion path removed.
Professional hero repair, if C9.1's classifier finds work, will be built
there on the reserved `updateCaseHeroImage` compare-and-set seam.

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

```
npm run repair:allergens:dry           # report only, writes nothing
npm run repair:allergens -- --confirm  # APPLY — requires BOTH flags; NOT YET AUTHORIZED
npm run repair:allergens:dry           # verify: "would change" must be 0
```

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

```
npm run repair:hazards:dry           # report only, writes nothing
npm run repair:hazards -- --confirm  # APPLY — requires BOTH flags; NOT YET AUTHORIZED
npm run repair:hazards:dry           # verify: "would change" must be 0
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

| From               | To                        | Why                                            |
| ------------------ | ------------------------- | ---------------------------------------------- |
| `other_regulatory` | `allergen`                | labeling-only reason, allergen stated in prose |
| `unknown`          | `allergen`                | empty reason array, allergen stated in prose   |
| `foreign_material` | `allergen`                | 115-2017 — its "plastic" was the packaging     |
| `unknown`          | `microbial_contamination` | PHA-07302018-1 — ingested before Cyclospora    |

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

The command also guards the **expected population**: P2e-A source-reviewed
exactly 22 record and 22 case corrections, and a run proposing a larger,
smaller, or different set exits non-zero for review before any apply. An
**empty** set (0 and 0) is not a failure — it is exactly what the post-apply
verification dry run reports, and what a second apply would find.

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

**Status: implemented and dry-run only. The apply has not been run and is not
yet authorized.**

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

The scheduler watchdog adds two Supabase-side credentials — a fine-grained
GitHub token (`GITHUB_ACTIONS_TOKEN`, Edge Function secret only) and the
cron shared secret (`WATCHDOG_SHARED_SECRET`, Edge Function secret + Vault +
optionally local `.env` for the probe CLI). Neither is a repo secret, neither
appears in any table, log, or migration; docs/recall-scheduler-watchdog.md
§Credentials has scopes and rotation.

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
