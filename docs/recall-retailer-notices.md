# Retailer recall notices (Costco first)

Status (2026-11-14): **private monitoring, live and scheduled.** The migration
`20261113000000_retailer_notices.sql` is applied in production, two manual runs stored the 21
notices on the index, and `retailer-notices.yml` runs the monitor every two hours. No app build
reads retailer notices. The live feed, the case tables and the notification ledger are untouched by
design, not by omission.

This document is the authoritative home for retailer-published notices: what the sources actually
do, how the monitor reads them, what it is allowed to write, and what a client release would need.
Agency sources remain in [recall-source-contract.md](recall-source-contract.md); the case model in
[recall-domain-architecture.md](recall-domain-architecture.md).

## Why a separate, private slice

A retailer notice is not a government record, and the shipped app cannot tell the difference yet:

- Every build reads `recall_cases` directly (`state=eq.active`), so any row written there appears
  in installed apps immediately.
- Those builds treat any agency that is not FSIS as FDA: `agencyLabel` in
  [risk-display.ts](../src/lib/risk-display.ts) prints "FDA", `sourceOrganization` in
  [recall-presentation.ts](../src/lib/recall-presentation.ts) credits "U.S. Food and Drug
  Administration", `officialSourceLink` builds "View the official … report", and the push
  formatter in [format.ts](../src/server/push/format.ts) says "{Agency} announced this". A
  Costco-founded case would be shown, and alerted, as an FDA recall.
- Attaching retailer facts to an agency case is not neutral either: an added product line changes
  the affected-product fingerprint (`expansion_products`) and an added state widens geography
  (`expansion_geography`). Both are material changes that send a second alert.

So in this slice retailer notices live in their own private tables and change nothing a shopper
can see or be alerted about.

## Sources (verified 2026-11-13)

### Costco — automated, permitted

- Index: <https://www.costco.com/f/-/recalls>. `robots.txt` does not disallow `/f/`. Fetched with
  the same honest client identity as the FDA adapter (`lotly-recall-ingest/1.0`), one request per
  document, sequentially.
- The page is a Next.js app. Entries arrive in the React flight stream
  (`self.__next_f.push([1,"…"])`) as CMS `text_builder` blocks, each with a stable `uniqueId`
  (`blt…`) and a markdown line such as `Recall Notice: [Title (Item #1777000) …](PDF link)`. That
  `uniqueId` is the notice's native id. One block (saunas) links two letters; each letter becomes
  its own entry (`uid:1`, `uid:2`).
- **The index carries no dates.** A notice's date comes only from its letter. The page's own "older
  than 120 days" note is not an age signal either: a letter dated 2025-11-07 was still listed on
  2026-11-13.
- **The printed label is not a status.** The index labels Punahele "Recall Notice", while the
  letter says FSIS issued a public health alert and "a recall has not been requested". Labels seen:
  "Recall Notice", "Member Notice", "Product Information Notice", and none (saunas).
- Letters are PDFs on `gdx-assets.costco.com`, linked with literal spaces or `%3A`-encoded URNs.
  Most are text PDFs; at least one (Punahele) is a scanned page with no text layer.
- Costco item numbers ("Item #1777000") are Costco's own SKUs. They are not UPCs, and none of the
  21 letters on 2026-11-13 printed a UPC.
- Scope phrases ("Select Locations in the Midwest and Southeast", "MW, NW, SD Regions Only") are
  Costco's own region names. They are kept as printed and never mapped to states.

### Trader Joe's and Kroger — manual only

Both refuse an honestly identified client: Trader Joe's answers 403 (even for `robots.txt`) and
Kroger resets the connection. They are not fetched automatically, and the monitor does not imitate a
browser to get past bot protection. Any Trader Joe's or Kroger notice enters only by manual intake.

## What is stored

Two private tables (service role only; see [Boundary](#boundary)):

- `retailer_notices`, one row per index entry `(publisher, native_id)`, holding the stated facts,
  their evidence, and the decision.
- `retailer_notice_documents`, append-only, one row per `(notice, content hash)`: the original
  bytes, the text read from them, and the index entry as seen when fetched.

Field rules. Each is pinned by a test in [src/server/retailer/](../src/server/retailer/):

- **Stated versus measured.** `stated_notice_date` is only a whole-line date near the top of the
  letter. It is never a date inside a sentence, and never a filename (the undated meatloaf letter is
  named `…_31426.pdf` and stays undated). `first_seen_at` and `last_seen_on_index_at` are our own
  measurements. The two families are never mixed.
- **Item numbers never become UPCs.** UPCs are read only after an explicit "UPC" label.
- **States only as retailer pairs.** A state is recorded as `{retailer, state, basis, evidence}`
  and only from a sentence saying the item was sold or distributed there: a stated list
  (`stated_state_list`) or a list of named warehouses (`named_store_locations`). Nationwide scope is
  never inferred from a missing list.
- **Package sizes are claims.** "67oz, 20-count" is stored with `verifiedInAgencyNotice` and the
  size tokens the matched agency notice does not print. A package size is never used as an
  identifier.
- **No inferred agency or classification.** `agencies_named` lists only agencies the letter names.
  No classification is ever assigned.
- **Evidence is verbatim.** Every evidence string is an excerpt of the letter's text with runs of
  whitespace collapsed (PDF line breaks fall mid-phrase).
- **Disappearance means nothing.** When a notice leaves the index its row keeps every value; there
  is no status column a disappearance could flip. An index that parses to zero entries fails the run
  rather than reading as "all withdrawn".

## Decisions

The first rule that fires decides. Flags are recorded with the decision but never decide on their
own.

| Rule                                                    | Decision         |
| ------------------------------------------------------- | ---------------- |
| Document unreadable, or a scan with no text layer       | `review`         |
| Not food (CPSC, appliances, plants, cleaners)           | `excluded`       |
| Food status unclear                                     | `review`         |
| Letter says the product is safe (label/quality notice)  | `excluded`       |
| Notice kind unclear                                     | `review`         |
| No stated date                                          | `review`         |
| No agency case matches                                  | `new_candidate`  |
| Two or more agency cases match                          | `review`         |
| One match, but codes or states conflict with the agency | `review`         |
| One consistent match                                    | `link_candidate` |

A match needs the agency case's firm or brand named in the notice and at least one shared product
word, within ±45 days of the notice's stated date. Costco's own names (Costco, Kirkland Signature)
appear in every Costco letter, so a match on them needs two shared product words. A code conflict
means the letter's code dates (Best By, Sell By, lot dates) share no date with the agency notice.
Flags: `retailer_notice_dated_before_agency`, `package_claim_unverified`,
`retailer_label_differs_from_agency_status`.

A decision is a proposal stored on the private row. It creates no case, links no source record and
writes no notification event.

### Outcome on 2026-11-13 (21 notices, full production corpus)

| Decision         | Notices                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `new_candidate`  | Kirkland Heavy Whipped Cream #1777000 (11-07), Traditional Madeleines (04-07), Caesar Salad (2025-11-07)                                          |
| `link_candidate` | Tractor Wheels #1977696 → FDA `38c00154` (Costco 2 days earlier; "67oz" unverified), Motor City 5 Cheese Bread → FDA `c4bc0caa` (2 days earlier)  |
| `review`         | Punahele (scanned), Meatloaf (undated), Ajinomoto Yakitori and Shoyu Ramen (codes not in FSIS `9c9edbd7`)                                         |
| `excluded`       | 11 non-food notices, including the Little Giant ladders (CPSC) and the Desert Willow plant (pest notice); Alreef Turkish Delight (quality notice) |

## Boundary

- The store writes only `retailer_notices` and `retailer_notice_documents`, and only SELECTs
  `recall_cases`. The scheduled job adds only the shared job runner's own bookkeeping: its
  `job_leases` lease and one `ingest_runs` row per run. [store.test.ts](../src/server/retailer/store.test.ts) drives a full plan and apply
  through a recording client. It also fails if any retailer module names a ledger or case table,
  calls an RPC, or imports the pipeline or push code.
- The migration revokes all privileges from `public`, `anon` and `authenticated`, enables RLS with
  no policies, creates no view, and gives `retailer_notice_documents` no UPDATE grant. Its own
  `do` block fails the migration if a client role can still reach either table. `link_case_id` is
  deliberately not a foreign key, so a retailer proposal can never constrain or cascade into
  `recall_cases`.
- The table list in
  [data-api-privileges-migration.test.ts](../src/server/data-api-privileges-migration.test.ts) is
  unchanged: the app's public API still reads only the four feed relations.

## Operating it

```bash
npm run retailer:costco                          # dry run: fetch, read, decide, write nothing
npm run retailer:costco -- --report <file.json>  # dry run plus a JSON report
npm run retailer:costco -- --apply --confirm --expect <n>
```

The command uses the repository's shared three-flag mutation contract
([repair-authorization.ts](../src/server/repair-authorization.ts)). `<n>` is the dry run's planned
writes: rows upserted plus documents archived. A rerun over unchanged sources plans only
`last_seen_on_index_at` touches and archives nothing. A dry run against a database without the
migration plans as a first run and says so; an apply there is refused.

Rollout, each step a separate approval (all done):

1. Apply the migration. **Done 2026-11-14** (`supabase db push --linked`). Afterwards both tables
   had RLS with no policies and no `anon` or `authenticated` privilege, and the app's publishable
   key received `42501 permission denied` for every read and write on both.
2. Run `retailer:costco` twice by hand. **Done 2026-11-14:** the first apply wrote 42 (21 notices,
   21 documents); the second wrote 21 last-seen updates and archived nothing. No other table
   changed.
3. Confirm Costco answers the scheduler's network. **Done 2026-11-14:** GitHub run `43624894238`
   on the diagnostic branch `diag/costco-runner-probe` (a no-secret, push-triggered probe from a
   hosted `ubuntu-latest` runner with Node 24 and the production User-Agent) succeeded. The job
   failed unless all three attempts read the index, found notice documents and received a real
   PDF. The branch was never merged and **has been deleted**, locally and on GitHub.
4. Schedule it. **Done 2026-11-14:** see [Scheduled runs](#scheduled-runs).

## Scheduled runs

`.github/workflows/retailer-notices.yml` runs `npm run jobs:retailer-costco` every two hours at
`:23` UTC (and on `workflow_dispatch`). That is the shared job runner
([scripts/run-job.ts](../scripts/run-job.ts),
[retailer-costco-job.ts](../src/server/jobs/retailer-costco-job.ts)): the same plan and apply as the
manual command, under a `retailer_costco` lease, recording one `ingest_runs` row whose metrics hold
the decision tally, the notices that are new or changed this run, and the review queue. The
schedule never runs the human-gated `retailer:costco` CLI.

It is a separate workflow so agency ingestion is unaffected: `scheduled-ingest.yml` and
`daily-maintenance.yml` are unchanged, a Costco failure cannot fail or delay an agency tick, and
the scheduler watchdog neither watches nor dispatches it. GitHub cron is best-effort, so a missed
tick is simply picked up by the next one.

How a failure shows:

- **failed** (red workflow; GitHub emails on a failed scheduled run): the index could not be
  fetched, parsed to no entries, or a database read or write failed. Nothing stored is changed or
  removed.
- **partial**: a letter could not be fetched. That notice is skipped this run and retried on the
  next; a warning annotation names it on the run page.
- `npm run ops:health` lists the job as "Costco notices (private)". It warns after 12 hours and is
  stale after 24 hours without a successful run.
- New or changed notices and the manual-review queue appear as notice annotations on the run page
  and in the run's `ingest_runs.metrics` (`newOrChanged`, `reviewQueue`).

To disable the schedule:

```bash
gh workflow disable retailer-notices.yml   # or Actions → retailer-notices → Disable workflow
gh workflow enable retailer-notices.yml    # to resume
```

Disabling stops new runs and leaves every stored notice as it is. A run already in progress
finishes, or can be cancelled from the Actions page; it holds only its own lease, which expires
after 30 minutes.

## Showing verified notices in the app: the smallest safe client change

Not built. This is the minimum a release needs, because old builds must never see a retailer
notice:

1. **Server: a reviewed, separate read path.** Add `verified_at` and `verified_by` to
   `retailer_notices`, set only by a human review of a `new_candidate`. Add one view,
   `consumer_retailer_notices`, exposing only verified rows and only display-safe columns: id,
   publisher, index title, stated notice date, document URL, retailer item numbers, the
   retailer/state pairs, and `link_case_id`. Grant SELECT on the view to `anon` and add it to
   `FEED_RELATIONS` on purpose. Nothing is ever written to `recall_cases`, so installed builds keep
   reading exactly what they read today.
2. **Client: a second item kind, never an agency item.** In
   [recall-feed.ts](../src/lib/recall-feed.ts), fetch the view alongside the feed and give
   `FeedItem` a `kind: 'agency' | 'retailer_notice'` discriminant. Bump
   `FEED_CACHE_SCHEMA_VERSION` ([feed-cache.ts](../src/lib/feed-cache.ts), currently 4), since
   the cached shape changes. A retailer item:
   - renders a "Costco notice" label and no risk badge (it has no classification);
   - opens a retailer detail whose only official link is "View Costco's notice" (the PDF);
   - never passes through `agencyLabel`, `riskView`, `officialSourceLink` or
     `sourceOrganization`;
   - matches the Stores filter and Affects You only through its retailer/state pairs.
3. **Linked notices** (`link_candidate`, after review) add nothing to an agency card in the first
   release. A later release can show an "Also announced by Costco on {date}" row on the agency
   detail, read from the same view, without touching the case projection, so no material change
   or second alert can result.
4. **Alerts stay off** for retailer items in that release. Alerting needs its own decision, ledger
   rows keyed so a retailer notice and an agency case for the same recall cannot both send an
   initial alert, and agency-free push wording.
