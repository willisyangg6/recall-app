# Feed performance & Supabase egress (Phase C8)

_Written 2026-08-29. The app keeps serving the complete active recall corpus
(C5.1's frozen guarantee) while no longer re-downloading hundreds of
unchanged full recall rows — on the phone or in the scheduled jobs. This
milestone began with measurement; every number below is labeled measured or
estimated._

## 1. Measured baseline (2026-08-28/29, live production, read-only)

| Path                                      | Measured                                                             |
| ----------------------------------------- | -------------------------------------------------------------------- |
| Cold full feed (real loader, 883 cases)   | **1.67 MB decompressed / ~328 KB wire (gzip)**, 2 requests, ~1.9 s   |
| Feed page gzip ratio                      | 3.86× (curl, `Accept-Encoding: gzip` vs `identity`)                  |
| Detail screen                             | median case 16.6 KB, largest 316 KB decompressed                     |
| Full `recall_cases` row (listCases shape) | avg 13.6 KB (projection 13.2 KB), p90 26 KB, max 64 KB (n=120)       |
| Full FDA `source_records` row             | avg ~18–19 KB (`normalized.summaryHtml` ≈ 12.5 KB) (n=120)           |
| Full FSIS `source_records` row            | avg ~9 KB (`summaryHtml` ≈ 4 KB) (n=120)                             |
| Labels-job candidate scan, `recent` mode  | ~36 KB per tick (11 rows)                                            |
| Labels-job candidate scan, `full` mode    | ~3.6 MB per daily sweep (966 rows)                                   |
| Heaviest client-visible feed fields       | productNames ~388 KB, geography ~223 KB, timeline ~222 KB per corpus |

Job frequency, from `ingest_runs` (last 7 days at audit time): FDA job ran
56×, and **37 of those were full per-record runs** — the FDA listing's
content hash moves on any page edit anywhere in the feed, so the
unchanged-source gate passes far less often than FSIS's (2 full runs of 56).
Client behavior: the feed loads once per app mount plus manual
pull-to-refresh only — there is no focus- or interval-driven refetch.

## 2. Where the egress actually was (ranked)

1. **FDA per-record ingest reads (automated, dominant).** Every full FDA run
   called `getSourceRecordByNativeId` — `select('*')`, ~18–19 KB/row — once
   per feed item (~715), only to compare a snapshot hash and find the case
   id: **~12.7 MB decompressed per full run**, at 37 full runs/week and
   rising with the C7.2 watchdog's restored cadence (dispatches every ~45
   min ⇒ up to ~20+ full runs/day going forward). Order of magnitude:
   **hundreds of MB/day decompressed** once the scheduler is fully healthy.
2. **Founder maintenance/QA sweeps (manual, bursty).** `listCases()` moves
   ~26 MB per pass (1,912 × 13.6 KB); the FDA image backfill ~57–63 MB per
   run (snapshot payloads per record); `repair:geography` ~2 × 26 MB
   (deliberate double sweep); `qa:personalization` / `qa:duplicates` /
   `qa:fda-enforcement` ~11–18 MB each. During the C5–C7 development weeks
   these ran many times per day — the most plausible driver of the Free-plan
   5 GB overage, alongside (1).
3. **Mobile cold feed loads.** 1.67 MB decompressed (~328 KB wire) per
   launch. Negligible at today's usage; the dominant term at 100–1,000 DAU
   (100 DAU × 2 loads/day ≈ 10 GB/month decompressed ≈ 2 GB wire).
4. **Labels daily full sweep** ~3.6 MB/day; **enforcement weekly heavy
   branch** ~18 MB/week; per-tick runner metadata (`latestJobMetric`, 2×25
   `ingest_runs` rows per job) ~tens of KB/tick; push job in no-send mode,
   watchdog, `ops:health` — all small.

The observed Free-plan overage cannot be attributed line-by-line after the
fact (no billing API); the ranking above is from code paths × measured row
sizes × observed run history, and the two implementation targets are the two
top items that are _repeatable_: the FDA per-record reads and the client's
full-corpus reloads.

## 3. What C8 ships

### 3a. Ingest identity-slice reads (server, automated path)

`RecallStore.getSourceRecordLinkByNativeId` returns `{id, recallCaseId}`
(`select('id, recall_case_id')`) and replaces the full-row fetch in the two
pipeline sites that never read `normalized`: the per-item hash gate and
retraction targeting (`src/server/pipeline.ts`). The expansion-parent lookup
keeps the full row — its evidence guard genuinely reads the payload.

> **O3-B1 amendment (2026-09-05):** the pipeline's per-item read is now
> `getSourceRecordGateByNativeId` — the same identity slice plus the
> applied-version marker columns (`apply_state`, `applied_content_hash`,
> `applied_snapshot_seq`, ~60 additional bytes), still never `normalized`.
> The egress property this section measures is unchanged and remains pinned
> by `src/server/pipeline-egress.test.ts` and the column-list tests in
> `src/server/store/supabase-store.test.ts`.

Effect (estimate from measured sizes): a full FDA run's per-record reads
drop from ~12.7 MB to **~84 KB** decompressed (~99%); FSIS from ~11.4 MB to
~145 KB. Semantics are pinned unchanged by the existing pipeline tests plus
`src/server/pipeline-egress.test.ts` (unchanged records: narrow reads only;
expansions: full parent read survives).

### 3b. Client persistent cache + incremental reconciliation

**Server surface** — one migration,
`supabase/migrations/20260904000000_consumer_feed_manifest.sql`:

```
consumer_feed_manifest (view, security_invoker)
  id       uuid    — consumer-visible active case
  version  text    — md5(projection::text || timeline::text || ordered product names)
```

Why a read-time content hash and not `last_changed_at` or a version column:
the retailer/geography repairs and the image backfill **deliberately
preserve `lastChangedAt`** (so they cannot fire notifications), so no stored
timestamp moves on every client-visible change — and a writer-maintained
version column would be one forgotten writer away from silently stranding
stale rows in every cache. The hash is computed from current row content on
every read: re-projection, enrichment, backfill, state changes, merges — all
move the token by construction, with **zero writer discipline required**.
The token over-approximates in the safe direction only (a projection change
the feed row doesn't display still bumps it → one redundant re-download);
the reverse — a client-visible change leaving the token unmoved — is
impossible, because the hashed inputs are a superset of everything
`FEED_SELECT` serves (the generated feed columns are stored projections of
the same jsonb).

Security: `security_invoker = true` (anon reads through the existing
`recall_cases` RLS policy and grants — the view adds no privilege), the
WHERE clause restates `state = 'active' and merged_into is null` as defense
in depth, SELECT-only grants, no SECURITY DEFINER, no new policies or
tables. Hidden/inactive/merged cases produce **no manifest row at all** —
no id, count, or hash leaks. Pinned by `src/server/consumer-manifest.test.ts`
(repo-standard textual migration pins) and live-gated by `qa:egress`.

**Client protocol** (`src/lib/feed-sync.ts`, pure and injectable):

1. Fetch the complete manifest (id-cursor paging, complete-or-throw — the
   same discipline as the feed loader; `MANIFEST_PAGE_SIZE` 1000).
2. Diff against the cache: download ids that are new, hold a different
   token, or hold a `null` token; remove cached ids absent from the
   manifest.
3. Fetch needed rows by id (`FEED_IDS_CHUNK_SIZE` 60, same `FEED_SELECT` +
   `state=eq.active` + RLS as the cold loader) — or via the frozen complete
   loader when the cache is empty or more than half the manifest drifted.
4. Commit atomically: the complete corpus plus, per item, the manifest token
   that **prompted** its download.

**Consistency model (stated honestly):** tokens are recorded before their
rows are fetched, so cached content is always at least as new as its token
claims. A row that changes mid-sync is stored with the older token and
re-downloaded next sync — one redundant fetch, never an undetectable stale
row. A case added/hidden after the manifest read appears/disappears one sync
later. An id the manifest listed but the row fetch no longer sees is
authoritatively invisible and is removed in the same commit. An empty
manifest over a non-empty cache is never trusted alone — it triggers a full
verifying reload.

**Failure behavior:** manifest unavailable (including a backend that has not
applied the migration yet) → full-load fallback, committed with null tokens
(re-verified when the manifest returns). Any row-fetch failure → the sync
throws, nothing is committed, the previous complete cache stands. Cache
write failure → the fresh corpus still serves from memory. Corrupt or
schema-mismatched cache documents are discarded whole (cold rebuild) — never
partially believed.

**Storage** (`src/lib/feed-cache.ts` + `feed-cache-store.ts`): one JSON
document in `Paths.cache` via `expo-file-system` (~57.0.6, installed with
`npx expo install`), written temp-file-then-rename so the named file only
ever holds a complete document (a crash mid-swap reads as _absent_ — a cold
load — never torn). A single document, not SQLite, because the frozen
product semantics load the whole corpus into memory for every render
(sections, ranking, filters, search) — access is strictly read-all/
replace-all, so row-level storage buys nothing. OS cache eviction just
causes a cold load. The document contains public recall content only — no
installation id, preferences, or push material (pinned by test).

**Web:** `feed-cache-store.web.ts` returns no store; the sync engine then
performs a complete network load per visit — exactly the pre-C8 web
behavior, deliberately, rather than growing an IndexedDB backend inside
this milestone. Web export verified.

**UI (`src/app/index.tsx`):** the last complete cached corpus renders
immediately on mount; a background reconciliation replaces it (the cache
only ever fills a not-yet-ready state, so a faster network result is never
overwritten by older cached items). Pull-to-refresh runs a real
reconciliation. A module-level session coalesces concurrent syncs (mount +
remount + pull-to-refresh share one in-flight reconciliation). The existing
stale-banner behavior on refresh failure is unchanged.

## 4. Cold vs warm, before vs after (883-case corpus)

| Load                        | Requests | Decompressed | Wire (est.)  |
| --------------------------- | -------- | ------------ | ------------ |
| Cold full load (unchanged)  | 2        | 1.67 MB      | ~328 KB      |
| Warm unchanged refresh, was | 2        | 1.67 MB      | ~328 KB      |
| Warm unchanged refresh, now | 1        | ~87 KB       | ~40 KB       |
| One changed case, now       | 2        | ~87 KB + row | ~40 KB + row |

Warm-unchanged reduction: **~95% decompressed / ~88% wire** (gate: ≥80%,
enforced live by `qa:egress` once the migration is applied; proven at the
engine level by tests today). No full projection rows move on a warm
unchanged refresh — gate: zero `recall_cases` requests.

Estimated monthly transfer (decompressed JSON; wire ≈ ÷3.9; estimates):

| Scenario                          | Before C8     | After C8              |
| --------------------------------- | ------------- | --------------------- |
| Automated jobs (watchdog cadence) | ~6–9 GB/month | **~0.2–0.4 GB/month** |
| 1 DAU (2 sessions/day)            | ~100 MB/month | ~7 MB/month + colds   |
| 100 DAU                           | ~10 GB/month  | ~0.6 GB/month         |
| 1,000 DAU                         | ~100 GB/month | ~6 GB/month           |

Do not read these as billing predictions — billed egress is compressed and
includes surfaces this doc does not model; no billing-window observation has
been made yet.

## 5. Operations

- **Activation (founder):** review + `supabase db push` (adds only the
  view + grant; additive, no RLS/policy changes), then `npm run qa:egress`
  must print PASS. **The migration is verified applied in production**
  (2026-09-05, O2-A read-only audit: linked migration history matches the
  local file, and the view answered a read-only SELECT — 890 rows at
  audit). No post-apply `qa:egress` PASS is recorded in the docs yet; run
  it to close that gate. If the manifest is ever unavailable the app still
  behaves exactly as pre-C8 (full loads via the fallback path).
- **`npm run qa:egress`** (read-only): authoritative count, cold-load
  bytes/completeness, manifest bytes + hidden-id gate, warm-refresh
  bytes/row-count gates + % reduction, changed-row example, largest
  rows/fields, and scheduled-job estimates from run history. Non-zero exit
  on any gate, including "manifest not deployed".
- **Founder QA costs (unchanged by design — audit quality first):**
  `qa:feed` ~1.7 MB, `qa:personalization` ~11 MB, `qa:duplicates` ~11 MB,
  `qa:fda-enforcement` ~18 MB, image backfill ~57–63 MB, `repair:geography`
  ~2×26 MB per pass. Run them when needed; just know the price.

## 6. Rejected alternatives

- **`last_changed_at` as the sync token** — provably wrong here: the C4/C5
  maintenance writers preserve it on purpose (see §3b).
- **Writer-maintained version column** — every present and future writer
  must bump it; one miss = silently stale caches. The read-time hash cannot
  be missed.
- **Sync RPC / SECURITY DEFINER function** — more privilege surface for no
  gain at this scale; a security_invoker view keeps anon inside existing
  RLS.
- **Trimming feed fields (timeline, productNames)** — saves bytes by
  weakening product behavior (material-activity ranking, identifier
  search); completeness and behavior are frozen. Not considered further.
- **SQLite cache** — row-level access is useless to a whole-corpus-in-memory
  product; a native dependency + migration machinery for nothing (§3b).
- **IndexedDB web cache** — would materially enlarge the milestone; web
  keeps its complete network path explicitly.
- **Delta/If-None-Match on the feed pages** — an ETag over a 500-row page
  invalidates on any single row change; per-case tokens are strictly
  better.

## 7. Known limitations & scaling notes

- The manifest hashes ~13 KB of projection per case per request (server-side
  compute, not egress). At ~900 cases this is milliseconds; at ~10k cases
  consider a stored hash maintained by trigger — a deliberate future trade
  once writer discipline can be enforced mechanically.
- The cache document is one JSON file parsed wholesale at launch (~1.7 MB ≈
  tens of ms). Fine to ~5k cases; past that, revisit storage (§3b) together
  with list virtualization.
- A changed case re-downloads whole (~2 KB avg) — no field-level deltas;
  bounded and simple beats clever here.
- Left in place, documented (small or out of milestone scope): the
  `latestJobMetric` double-fetch (2×25 `ingest_runs` rows per job per tick,
  ~tens of KB), the push worker's pre-activation `listEnabledSubscriptions`
  read (0 rows today), `notification_deliveries select('*')` on the manual
  dry-run path, and the labels `full`-sweep 3.6 MB/day scan (its
  `summaryHtml` read is genuinely needed for URL extraction).
- Pre-existing, flagged for a future fix (not touched — merge tooling is
  outside this milestone): `qa-duplicate-cases.ts` and
  `reconcile-duplicate-cases.ts` page with `.range()` and **no `.order()`**,
  which Postgres does not guarantee stable — their sweeps can in principle
  skip/repeat rows across pages.
