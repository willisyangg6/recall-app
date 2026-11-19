# Retailer recall notices

Status (2026-11-17): **first launch cohort built and verified on staging; nothing applied in
production beyond the two Costco migrations.** Retailer notices now reach the screen through
[one presentation path](#one-presentation-path) shared with agency recalls. See [Launch cohort](#launch-cohort-2026-11-16) for
the store-by-store readiness table and the exact rollout order.

- **Costco:** private monitoring, live and scheduled in production. Nothing approved yet.
- **ALDI:** the same pipeline ([sources.ts](../src/server/retailer/sources.ts)) and a scheduled job
  that stays off until its migration is applied.
- **Walmart + Sam's Club, Target, Whole Foods Market:** [store listings](#store-listings) attached
  to existing agency recalls, never a card of their own.
- **Publix:** a store-listing reader built from Publix's own page component and tested against
  its field shape, but **not ready**: live coverage is unverified because no populated Publix list
  has been observed ([Publix gap](#publix-gap)).
- **Manual intake: none.** No source in this launch depends on a person
  ([Not in this launch](#not-in-this-launch-h-e-b-kroger-albertsons)).
- Build 1.2.0 (14) shows none of this beyond Costco notices
  ([Build 14](#build-14-and-a-second-retailer)).
- The full retailer inventory is under [Coverage of Lotly's 77 stores](#coverage-of-lotlys-77-stores).

The live feed, the case tables and the notification ledger are untouched by design, not by
omission. Retailer notices never create push alerts.

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

### ALDI — automated, permitted (verified 2026-11-16)

- Index: <https://corporate.aldi.us/newsroom/product-recalls>. It is server-rendered HTML that
  answers the honest client, and its `robots.txt` disallows only four named crawlers.
- Each entry is one paragraph under a "<year> Recalls" heading, with a date and one link:
  `<b>November 16, 2026:</b> <a href="https://dm.cms.aldi.cx/…">Title</a>`. The native id is
  the document's path on ALDI's asset host.
- Only ALDI's own documents become notices. On 2026-11-16 the index listed 80 entries: 75 ALDI
  PDFs back to 2018, 4 CPSC pages and 1 FSIS page. The agency pages are skipped: the agency
  adapters already read FSIS, and CPSC is not food.
- **Unlike Costco, the index dates every entry.** ALDI's notices are press releases. Some print a
  dateline ("Batavia, Ill. (May 9, 2024) –") or "Effective: February 23, 2026"; others print no
  date. Their product tables carry whole-line code dates ("10/30/26" under Best By). A notice is
  therefore dated by that dateline when it prints one, and otherwise by ALDI's own index date. A
  code-date line never dates it ([Date rule](#what-is-stored)).
- The tables print UPCs under a "UPC Code" column, and lots and Best if Used By dates instead of
  a store item number.

### Trader Joe's, Kroger and others — manual only

Many retailers refuse an honestly identified client. Trader Joe's answers 403 (even for
`robots.txt`), Kroger's banners reset the connection, and H-E-B serves a bot challenge. They are
not fetched automatically, and the monitor never imitates a browser to get past bot protection.
None of them is in this launch. The full list is in
[Coverage of Lotly's 77 stores](#coverage-of-lotlys-77-stores).

### Coverage of Lotly's 77 stores

Measured 2026-11-16 with the monitor's own client identity, against every entry in
[retailer-catalog.ts](../src/domain/retailer-catalog.ts). Chains that share a recall page are
grouped. "Automated" means the page answered `lotly-recall-ingest/1.0` with its entries in the
HTML.

| Status                                 | Count | Stores (shared page)                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------- | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automated: own notices (this pipeline) |     3 | Costco (live), ALDI (staging), Lidl (`lidl.com/c/product-recalls`, not built)                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Automated: agency-linked lists         |    12 | Walmart + Sam's Club (`corporate.walmart.com/recalls`), Target (help articles), Whole Foods Market, Winn-Dixie, Schnucks, Dierbergs, Smart & Final, FoodMaxx + Lucky (`thesavemartcompanies.com`), Publix (own recalls only; none listed), The Fresh Market (own recalls only; none listed)                                                                                                                                                                                                    |
| No automated source: page refuses us   |    39 | Kroger family (19: Kroger, Harris Teeter, Fred Meyer, QFC, Ralphs, King Soopers, Smith's, Fry's, Dillons, Mariano's, Pick 'n Save, Gerbes, Jay C, Pay Less, Owen's, Ruler Foods, Baker's, Food 4 Less, City Market); Albertsons Companies (8: Albertsons, Safeway, Vons, Jewel-Osco, Acme, Randalls, Tom Thumb, Shaw's); Hannaford; Trader Joe's; H-E-B; Wegmans (list loads through in-browser search); ShopRite; BJ's; Weis; Big Y; WinCo; PCC; Save A Lot; Hy-Vee (newsroom press releases) |
| No verified public source              |    23 | Stop & Shop, Giant Food, The Giant Company, Food Lion, Meijer, Sprouts, Price Chopper, Tops, Giant Eagle + Market District, Fareway, Lunds & Byerlys, Market of Choice, Grocery Outlet, Raley's, H Mart, Dollar General, Dollar Tree, Family Dollar, 7-Eleven, Wawa, Kwik Trip, Piggly Wiggly                                                                                                                                                                                                  |

Notes on the table:

- The Kroger banners share an `/i/recall-alerts` page. Search confirmed the page on Fred Meyer,
  Ralphs, City Market and Harris Teeter (`/i/product-recalls`), and our client was refused on
  each banner probed. The other banners are assumed to follow the pattern.
- "No verified public source" means our probes and a web search found no recall page. These
  chains' recalls reach Lotly only when an agency publishes them.

What each automated source adds, checked against Lotly's production records for the year to
2026-11-16:

| Source          | Last year | Already a Lotly agency case             | Not in Lotly                                                                                |
| --------------- | --------: | --------------------------------------- | ------------------------------------------------------------------------------------------- |
| Costco          |        21 | 2 food (link candidates)                | Kirkland whipped cream; Madeleines and Caesar (both in FDA's Enforcement Report)            |
| ALDI            |         4 | 3                                       | Priano Protein Tortelloni (published 2026-11-16; no agency notice yet)                      |
| Lidl            |         6 | 6                                       | none                                                                                        |
| Walmart + Sam's |        11 | 11                                      | none. Adds per-state store distribution, e.g. "Sold at select Walmart stores in … CT, MA …" |
| Target          |         5 | 5 food (+5 non-food)                    | none. Adds Target item numbers and "Target Stores & Target.com"                             |
| Whole Foods     |        27 | 22 (+4 Canadian notices, 1 nasal spray) | none in the US                                                                              |

- **Most retailer value is distribution, not new recalls.** Outside Costco, a retailer's own US
  food notices from the last year were almost all also agency notices. The gain is where a
  product was sold: for example, Lotly's Tractor Wheels case names no retailer, while Walmart,
  Target, Whole Foods and Costco each list it.
- **Attaching that distribution is not built.** Adding a retailer's states to an agency case is a
  material change (`expansion_geography`) that would send a second alert
  ([Why a separate, private slice](#why-a-separate-private-slice)). It needs the linked-notice
  design in [Linked notices (later)](#linked-notices-later).

## What is stored

Two private tables (service role only; see [Boundary](#boundary)):

- `retailer_notices`, one row per index entry `(publisher, native_id)`, holding the stated facts,
  their evidence, and the decision.
- `retailer_notice_documents`, append-only, one row per `(notice, content hash)`: the original
  bytes, the text read from them, and the index entry as seen when fetched.

Field rules. Each is pinned by a test in [src/server/retailer/](../src/server/retailer/):

- **Stated versus measured.** `stated_notice_date` comes only from the retailer.
  - For a source whose index carries no dates (Costco), it is a whole-line date near the top of
    the letter.
  - For a source whose index dates every entry (ALDI), it is the document's explicit dateline
    ("(May 9, 2024) –" or "Effective: February 23, 2026") when it prints one, and otherwise the
    retailer's index date.
  - It is never a date inside a sentence, a code-date line or a filename (the undated meatloaf
    letter is named `…_31426.pdf` and stays undated). `first_seen_at` and `last_seen_on_index_at` are our own
    measurements. The two families are never mixed.
- **Item numbers never become UPCs.** UPCs are read only after an explicit "UPC" label, or as
  12- or 13-digit codes under a "UPC" / "UPC Code" table column. With no label, nothing is read.
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
| No match, dated before 2024-01-01                       | `review`         |
| No agency case matches                                  | `new_candidate`  |
| Two or more agency cases match                          | `review`         |
| One match, but codes or states conflict with the agency | `review`         |
| One consistent match                                    | `link_candidate` |

A match needs the agency case's firm or brand named in the notice and at least one shared product
word, within ±45 days of the notice's stated date. Costco's own names (Costco, Kirkland Signature)
appear in every Costco letter, so a match on them needs two shared product words. ALDI is treated
the same way. Headline boilerplate ("Because of Possible Health Risk") is never a product word.

Before 2024 the agency corpus can't answer for a notice. FDA keeps announcements online for three
years, and Lotly holds 56 from 2023 against 234 from 2024. An older notice with no match may be an
agency recall Lotly never ingested, so it goes to review (`predates_agency_coverage`) and is never
proposed as standalone. A code conflict
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
npm run retailer:monitor -- --publisher aldi     # the same dry run for ALDI (default: costco)
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

It is a separate workflow so agency ingestion is unaffected: a Costco failure cannot fail or
delay an agency tick, and the scheduler watchdog neither watches nor dispatches it. GitHub cron is
best-effort: a dropped tick is not queued, and nothing re-dispatches it.

Observed delivery, production `retailer_costco` runs 2026-11-15 to 2026-11-19: GitHub delivered 12
of about 48 ticks. Every delivered run succeeded, and none was cancelled, queued or lease-skipped.
The median gap between runs was 8.0 hours and the longest 11.6 hours. On cron alone there is **no
maximum gap**. [recall-alert-timing.md](recall-alert-timing.md#why-costco-ran-812-hours-apart) has
the full check.

**On the agency tick (2026-11-19; off until the founder sets it).** With the repository variable
`RETAILER_ON_INGEST=true`, `scheduled-ingest.yml` also runs both monitors, as separate jobs with no
`needs:` and an 8-minute timeout. That workflow runs about every 45 minutes because the watchdog
dispatches it, so a dropped retailer tick no longer matters. ALDI additionally needs
`RETAILER_ALDI_ENABLED`.

**Due gate.** Every trigger first takes the job lease, then checks for a succeeded or partial run
that started less than `RETAILER_MIN_INTERVAL_MINUTES` (100) minutes ago.

- If it finds one, it stands down: it fetches nothing and writes no `ingest_runs` row.
- A failed run never counts, so a failure is retried on the next tick.
- The result is a run about every 2¼ hours, and at most about 2¾ hours on the measured tick grid.
- The cron and manual dispatch here obey the same gate. `npm run jobs:retailer-costco -- --force`
  bypasses it from a laptop.

How a failure shows:

- **failed** (red workflow; GitHub emails on a failed scheduled run): the index could not be
  fetched, parsed to no entries, or a database read or write failed. Nothing stored is changed or
  removed.
- **partial**: a letter could not be fetched. That notice is skipped this run and retried on the
  next; a warning annotation names it on the run page.
- `npm run ops:health` lists "Costco notices (private)" and "ALDI notices (private)" with the same
  thresholds (`RETAILER_FRESHNESS` in
  [health.ts](../src/server/jobs/health.ts)): healthy within 12 hours of a successful run,
  degraded after 12 hours, UNHEALTHY (non-zero exit) after 24 hours or when there has never been a
  success. A late run is visible **only** here: GitHub emails a failed run, never a missed one.
- ALDI is behind the repository variable `RETAILER_ALDI_ENABLED`, which `ops:health` (database
  only) cannot read, so the workflow existing never makes it healthy. With no ALDI notices and no
  run it reports "not enabled" (degraded). Once ALDI notices are stored (the rollout's first
  manual apply, immediately before enabling) it expects runs: degraded until its first success,
  UNHEALTHY if none succeeds within 24 hours of the first stored notice.
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

## Approval and the client read path

Status (2026-11-16): **merged to `master` (`5085966`).** The migration
`20261115000000_retailer_notice_approvals.sql` is **applied in production** (2026-11-16; the app's
key gets `42501` on the approvals table and `consumer_retailer_notices()` returns `[]`). Nothing has
been approved in production, and no build with the new client has shipped. The launch scope is every
verified standalone retailer food recall that fits the existing UI, starting with Costco and ALDI
([Reconciled queues](#reconciled-queues-2026-11-16)).

### The approval step (private)

`retailer_notice_approvals` (service role only: RLS, no policies, no client grant, no DELETE)
records a reviewer's approval of ONE archived letter:

- the letter's exact SHA-256 (`document_content_hash`);
- the shopper-facing fields they approved (version 1,
  [retailer-notice-fields.ts](../src/lib/retailer-notice-fields.ts));
- the verbatim excerpt and PDF page behind every field (`field_evidence`), and their notes. Both
  stay private.

A unique index allows one live approval per notice, so a notice can appear once, never twice.

`npm run retailer:review` is the only writer
([approval.ts](../src/server/retailer/approval.ts)), on the shared three-flag contract:

```bash
npm run retailer:review -- approve <request.json>                       # dry run: checks + plan
npm run retailer:review -- approve <request.json> --apply --confirm --expect <n>
npm run retailer:review -- withdraw <native-id> --reason <text>
npm run retailer:review -- confirm-agency-match <native-id> --case <agency-case-uuid>
# withdraw and confirm-agency-match take --publisher aldi for an ALDI notice (default costco)
```

An approval is refused unless:

- the reviewed hash is the notice's current letter, and that letter is archived and readable;
- the monitor classes the notice a standalone `new_candidate` food recall, read as text, with a
  stated date;
- every shown field has an excerpt printed on the cited page;
- identifiers, sizes, names and states appear verbatim in their excerpts, and every number, date
  or email in reviewer prose appears in its excerpt;
- item numbers, UPCs and states are ones the letter itself states.

The approved retailer name must be the publisher's own ("Costco" for `costco`, "ALDI" for `aldi`).

The state list may be empty when the letter states none. No state is then approved or inferred:
Costco's region names and the index title never become states.

The field shape has no consumer pack size. The package identifiers are separate lists, never
merged: retailer item numbers, supplier codes, lots, best-by dates, can timestamps and UPCs. At
least one identifier, of any kind, is required. Costco identifies a package by its own item number;
ALDI prints lots, Best if Used By dates and UPCs instead.

The reviewed requests live in [fixtures/approvals/](../src/server/retailer/fixtures/approvals/).
The Kirkland whipped cream request omits the ambiguous "case pack 8CT/3PK" and shows the contact
email only as printed.

### The read path (clients)

`consumer_retailer_notices()` is a read-only `SECURITY DEFINER` function with a pinned
`search_path`, executable by `anon`. It returns only `id`, `publisher`, `document_url`,
`notice_date`, `approved_at` and the approved `fields`, and only while ALL of these hold, checked on
every read:

- the approval is live (not withdrawn);
- no agency case has been confirmed as the same recall (`confirm-agency-match`);
- the approval's hash equals the notice's current letter. A revised letter therefore disappears the
  moment the monitor archives it, until it is approved again;
- the monitor still classes it a standalone food recall read from a text letter. A later agency
  match that turns it into a `link_candidate` or `review` hides it too.

Clients gain no table privilege, and `FEED_RELATIONS` is unchanged. Retailer notices never enter
`recall_cases`, so installed builds keep reading exactly what they read today and can never
mislabel one as an FDA recall.

### The new client

- **Read path:** [retailer-notices.ts](../src/lib/retailer-notices.ts) calls the function
  separately from the agency feed.
  - It never touches `recall_cases`, `FeedItem` or the feed cache, so there is no cache version to
    bump.
  - It is fault tolerant: any failure reads as no notices.
  - [use-retailer-notices.ts](../src/hooks/use-retailer-notices.ts) keeps the list in memory only
    and fails closed, so a withdrawn notice is gone on the next load.
- **All recalls only:** notices are placed by the letter's date under the same 60-day boundary.
  - They are hidden while a browsing filter is active, because they have no risk tier or agency
    to filter on.
  - Search narrows them like any card.
  - Affects me never includes them in this release.
- **The same card and the same Recall Details.** There is no retailer layout:
  [retailer-notice-presentation.ts](../src/lib/retailer-notice-presentation.ts) builds the shared
  `HomeCardModel` (rendered by `RecallCard`) and the shared `DetailModel` (rendered by the Recall
  Details screen at `/recall/retailer:<id>`) through the [one presentation
  path](#one-presentation-path) below, and it decides only this:
  - **Risk:** the existing Unknown treatment in the normal badge position
    (`unclassifiedRiskView`). It is never Pending, whose note promises an agency classification
    later, and never a severity tier.
  - **The one source link:** named for the document the retailer publishes: "View Costco's
    letter" or "View ALDI's recall notice". It opens that document.
  - **Publisher, name and host must agree.** A row is read only when its publisher, its approved
    retailer name and its document host all match: `costco`, "Costco" and `costco.com`, or
    `aldi`, "ALDI" and `dm.cms.aldi.cx`. Any other row is dropped whole.
  - **Where It Was Sold:** the letter's states, then Costco as the stated retailer. A letter that
    states no state is the agency contract's unspecified distribution that names a retailer: the
    card and the section read "Distribution not specified", and Costco stays the stated retailer.
  - **Affected Products:** the approved identifiers become the same typed facts the agency
    extractors emit (`package_size`, `best_by`, `lot`, `upc`, `item_number`). They pass through
    the same gate (`aggregateFacts` → `toPackageFields`), so they inherit the agency labels,
    order, date formatter, validation, de-duplication and omission rules. No row is added:
    - Best by "APR/02/27" shows as "April 2, 2027", with the raw marking kept;
    - the lot shows exactly as the letter prints it, "04/02/2027", never reformatted;
    - the Costco item number and supplier code reach the gate as `item_number` and are dropped by
      it, exactly as an agency notice's item code is;
    - can timestamps have no concept.
  - **Product photo:** the approved `fields.image` reaches the existing image slot: the card's
    112-point tile and Detail's 112×144 header photo, both `contain` (never cropped or stretched).
    It's served from the existing public `product-visuals` bucket. With no approved photo, both
    keep the approved no-image shape, with no tile and no placeholder.
    - The photo is one JPEG embedded in the approved letter, stored unaltered at
      `retailer-notices/<letter sha256>/<image sha256>.jpg`.
    - The approval step re-reads the archived letter's embedded JPEGs
      ([pdf-images.ts](../src/server/retailer/pdf-images.ts); unencrypted PDFs, or AES-128 with an
      empty user password) and refuses unless the PDF object, size, hash and path all match.
    - A revised letter has a new hash, so the old path cannot be re-approved for it, and the old
      approval stops being shown the moment the letter changes.
    - For the Kirkland letter it is PDF object 11, 763×2046, SHA-256 `8a1a80cb…`.
  - **Card reason:** the shared `conciseReasonLine`, fed the reviewer-approved structured reason
    (`fields.reason`: an agency `hazardCategory` and an agent printed in its excerpt). For the
    Kirkland letter the card reads "Possible cleaning chemical contamination".
  - **Not shown:** the purchase window, the instructions and the contact line. The screen has no
    slot for them, so they stay in the approved fields (`RETAILER_FIELDS_WITHOUT_A_SLOT`).
  - **Absent:** no Affects You verdict, no save control (`saveable: false`; Saved cannot load a
    notice) and no community reports.
  - **Read path for the detail:** the screen reads a `retailer:` id only from the approved read
    path, never as a case. After one reload, an id that is not approved shows "Recall not found".

- **Alerts stay off:** retailer notices write nothing to the notification ledger.

### One presentation path

Source-specific extraction ends at the approved fields. From there a retailer notice takes the
same steps an agency case takes, and nothing below is written per retailer, per product or per
notice:

| Step                | Agency case                                | Approved retailer notice                                                                                                                                                                                              |
| ------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What Happened       | `recallNarrative` over the projection      | `recallNarrative` over the structured reason, with the letter's own prose (`whatHappened`, `whyRecalled`) as the source text. The prose is evidence, never the paragraph                                              |
| Illness notice      | `deriveIllnessStatus(summaryText)`         | The same, over the letter's prose. "No illnesses have been reported" gets the badge; "no serious adverse effects requiring medical care" is not an illness status and gets none                                       |
| Health Risk         | `selectHazardGuides` + `healthRiskSummary` | The same, over the structured reason                                                                                                                                                                                  |
| Agent spelling      | The FDA/FSIS parsers' extractors           | The same extractors (`extractPathogen`, `extractChemicalAgent`), only where they respell the approved agent ("salmonella" → "Salmonella"); an answer that drops a word ("inorganic arsenic" → "arsenic") is not taken |
| Category            | `categoriesForCase`, stored on the case    | `categoriesForCase` over the approved product name, stored on the approval (`product_categories`) by the approval step; read and launch-filtered by the same `cardCategoryLabel` / `detailCategory`                   |
| Package identifiers | `aggregateFacts` → `toPackageFields`       | The same gate. Retailer item numbers, supplier codes and can timestamps have no field and stay privately in the approved fields                                                                                       |
| Image               | `allocateRecallImages`                     | The same, with the approved embedded photo as the hero                                                                                                                                                                |

Three shared-generator gaps the retailer letters exposed were fixed in the shared code, so they
apply to agency cases too. Measured over all 935 production cases (read-only, 2026-11-17), only
the first changes any agency text, in two cases:

- A stated temperature lapse ("may not have been stored, distributed or sold at appropriate
  temperatures") is the cause of a pathogen risk: "…because the products may not have been stored
  at appropriate temperatures, which may allow the growth of Clostridium botulinum." Beside any
  other reason it is a second sentence. Changed: FDA Priano and Fry Pie Factory.
- A count-noun chemical agent takes its article ("a cleaning chemical"); mass nouns ("lead") never
  do. No agency case changes.
- "Plastic foreign material" names plastic as the contaminant (construction H in
  [hazard.ts](../src/domain/hazard.ts)). No agency case's text changes.

### Verification

- [approval.test.ts](../src/server/retailer/approval.test.ts) and
  [approval-migration.test.ts](../src/server/retailer/approval-migration.test.ts) cover the checks
  and the SQL contract.
- [retailer-notice-presentation.test.ts](../src/lib/retailer-notice-presentation.test.ts) covers
  the adapted card and detail models (same keys as an agency card, Unknown risk, only existing
  sections, identifiers never relabeled), and the agency sections being unchanged with no notice.
- [retailer-notice-live.test.ts](../src/server/retailer/retailer-notice-live.test.ts) runs the
  whole flow on an isolated staging stack. It is opt-in (`LOTLY_RETAILER_STAGING=1` and a
  `verify-stack` workdir) and covers:
  - hidden before approval, and every private table refusing the app's key;
  - shown exactly once after approval, with display-safe columns only;
  - hidden when the letter is revised, and shown once after re-approval;
  - hidden after a confirmed agency match;
  - the shipped agency feed loader, the manifest and every case and ledger count identical
    throughout.

### Release preflight (2026-11-15, staging)

- **Second letter:** Traditional Madeleines (real PDF `c7b0b8e6…`, no photo) has a warehouse list,
  an allergen reason and no package codes. It approved and rendered through the shared card and
  Recall Details.
  - Warehouse states are proved by their "City, ST" postal code.
  - Affected Products is omitted, because no approved field has a value.
- **Caesar Salad** could not be approved then: its letter states no states, and the field reader
  required at least one. That rule was removed on 2026-11-16 (see the launch batch below).
- **Disappearance:** unapproved, withdrawn, superseded (a re-approval replaces the old row; a
  revised letter hides it) and agency-matched notices are absent from the read path. After the
  next load, the feed card, Recall Details ("Recall not found") and the photo all disappear.
- **No push:** approving creates no `notification_events` row, and the push job's dry run is
  identical before and after.
- **Shared-stack tests:** the two `preference-states-live` failures were an outdated shared stack.
  On a current isolated stack, all 14 pass.

#### The photo's public URL after withdrawal

Withdrawal hides the notice everywhere in the app, but the photo object stays in the public
`product-visuals` bucket. Its direct URL still returns 200 for anyone who has it. This is the same
lifetime as FSIS label images. The path contains two SHA-256 values, so it is not guessable. It
names only a photo the retailer itself published in its letter. Removing it requires deleting the
object (see the rollback steps).

### Reconciled queues (2026-11-16)

Every entry on both indexes, from the production dry runs that day. Costco: unchanged, no new or
revised letter. ALDI: first run, all 75 documents read.

| Outcome                    | Costco (21)                                                                                                        | ALDI (75)                                                                                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ready for approval         | Kirkland Heavy Whipped Cream                                                                                       | Priano Protein Tortelloni                                                                                                                                                                                                                |
| Ready, historical          | Traditional Madeleines (2026-04-07), Caesar Salad (2025-11-07)                                                     | Happy Farms Cream Cheese Spread (2024-05-09), Nature's Nectar 100% Apple Juice (2024-09-05)                                                                                                                                              |
| Linked to an existing case | Tractor Wheels → FDA `38c00154`; Motor City 5 Cheese Bread → FDA `c4bc0caa`                                        | 19 link candidates (e.g. Rosina meatballs → FSIS 2026-02-22). Also Bunny Luv carrots: the matcher proposed it as new, but it is FDA's "Grimmway Farms Recalls Organic … Baby Carrots" (2024-11-17), named "Grimmway Enterprises" by ALDI |
| Needs manual review        | Punahele (scanned, no text), Meatloaf (undated), Ajinomoto Yakitori and Shoyu Ramen (codes not in FSIS `9c9edbd7`) | 49: 32 dated before 2024, 8 with several possible matches, 7 food status unclear, 1 notice kind unclear, 1 with codes the agency notice lacks                                                                                            |
| Excluded                   | 12 (11 not food, 1 quality notice)                                                                                 | 3 (not food)                                                                                                                                                                                                                             |

"Historical" notices show accurately: the card and Recall Details state only "Announced <date>"
and file them under Older notices. They never claim a recall is ongoing. They do carry the Unknown
risk badge even where FDA has since classified the recall, and FDA's Enforcement Report marks
these terminated:

| Notice                      | FDA Enforcement Report                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| Traditional Madeleines      | `H-0682-2026`, Class I, Terminated                                                                |
| Caesar Salad                | `H-0224-2026` / `H-0225-2026`, Class II, Terminated                                               |
| Happy Farms Cream Cheese    | `F-1289-2024` to `F-1295-2024` (Schreiber Foods), Class II, Terminated                            |
| Nature's Nectar Apple Juice | Refresco `F-1746-2024` / `F-1795-2024` (Class II, Terminated); coverage of this brand unconfirmed |

### Launch batch (2026-11-16)

Reviewed against each letter's latest version (the monitor's production dry run that day:
unchanged, still `new_candidate`, no agency match) and against the agency record, including FDA's
Enforcement Report through 2026-11-04:

| Notice                            | Letter      | Where It Was Sold          | Agency record                                                                 |
| --------------------------------- | ----------- | -------------------------- | ----------------------------------------------------------------------------- |
| Kirkland Heavy Whipped Cream      | `df0f1de8…` | 12 stated states           | none found (the newest report predates the 11-07 letter)                      |
| Traditional Madeleines            | `c7b0b8e6…` | 9, from the warehouse list | FDA `H-0682-2026`, Class I, Terminated; no Lotly agency case                  |
| Caesar Salad (+ Chicken Sandwich) | `7f1b51a4…` | Distribution not specified | FDA `H-0224-2026` / `H-0225-2026`, Class II, Terminated; no Lotly agency case |

Enforcement records are not Lotly agency cases, so neither notice can appear twice; the record is
kept in the approval's private review notes. Caesar's letter names two items under one product
slot: the card names "Caesar Salad", What Happened names both items, and the Sell By range stays in
What Happened (there is no sell-by field, and it is never relabeled Best By).

On staging, all three approved with no problems and read back through the app's key. The card,
Where It Was Sold, every case, ledger and push table count, and the shipped agency feed and manifest
were checked; the counts and the feed were identical before and after approval.

### ALDI batch (2026-11-16, staging)

Requests are in [fixtures/approvals/](../src/server/retailer/fixtures/approvals/) (`aldi-*.json`).
On staging, with `20261118000000_retailer_notice_publishers.sql` applied, the ALDI monitor ran live
(75 documents, no failures). All three approved with no problems. The app's key then read six
notices: three Costco, three ALDI.

| Notice                      | Card                                                                 | Affected Products              |
| --------------------------- | -------------------------------------------------------------------- | ------------------------------ |
| Priano Protein Tortelloni   | Potential Clostridium botulinum contamination · AL, GA +2 · Today    | Best by, lot `T9101926`, 9 oz. |
| Happy Farms Cream Cheese    | Potential Salmonella contamination · AL, AZ +27 · May 9, 2024        | 4 UPCs, 8 oz.                  |
| Nature's Nectar Apple Juice | Potential inorganic arsenic contamination · AL, FL +14 · Sep 5, 2024 | 1 UPC, 64 fl oz.               |

- Each Where It Was Sold names ALDI, and each source link reads "View ALDI's recall notice" on
  `dm.cms.aldi.cx`.
- Agency cases, source records, notification events, deliveries, every push table, and the agency
  feed and manifest were identical before and after.
- The private tables still answered the app's key with 401.

The Priano card and What Happened name two items under one product slot, as Caesar's do. The Sell
By dates on Happy Farms and the Best By codes on Nature's Nectar ("MAR2625 CT89-4", a date and a
plant code together) are not approved as fields.

### Build 14 and a second retailer

Build 1.2.0 (14, `7a965ce`) reads only Costco notices and has no store-listing read path. Its read path drops any row whose publisher
is not `costco`, whose retailer name is not "Costco", or whose document is not on `costco.com`. On
staging, with the same six rows, build 14's exact client code read three, the Costco ones. It
fails closed: an ALDI notice is never shown wrongly, it is simply absent. Showing ALDI needs a new
binary with this read path.

### Rollout, each step a separate approval

The exact order is under [Rollout order](#rollout-order). Step 1 is done:
`20261115000000_retailer_notice_approvals.sql` was applied 2026-11-16.

To stop at any point: withdraw the approval (`retailer:review -- withdraw`). The notice disappears
from the new client on its next load, and older builds never saw it.

## Launch cohort (2026-11-16)

The first release covers Costco, ALDI, Walmart + Sam's Club, Target, Whole Foods Market and
Publix. Every source is automated; none needs manual intake. Everything below was run on the isolated staging stack. That stack has the same migrations
as production plus the two new ones, and the 57 production agency cases these sources link,
copied in with a read-only production query.

| Store           | Path                                  | Coverage  | Staging result (2026-11-16)                                                                                 | Ready?                                |
| --------------- | ------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Costco          | Own notices, automated (live)         | Automated | 21 entries, unchanged. Kirkland whipped cream approved and read back                                        | Yes: approve Kirkland in production   |
| ALDI            | Own notices, automated                | Automated | Scheduled job run: 75 read, succeeded, lease released. Priano approved and read back                        | After its migration; enable the job   |
| Walmart + Sam's | Store listings                        | Automated | 11 entries: 10 linked (9 by agency URL, 1 by reviewer), 1 review                                            | After the listings migration          |
| Target          | Store listings (5 newest Grocery/OTC) | Automated | 5 entries, all linked by agency URL                                                                         | After the listings migration          |
| Whole Foods     | Store listings                        | Automated | 108 rows: 47 linked, 41 review (older FDA pages Lotly does not hold), 17 excluded (Canadian notices)        | After the listings migration          |
| Publix          | Store listings                        | Automated | Empty run: 0 entries, succeeded. Populated reader built from Publix's component; every entry goes to review | **No**: see [Publix gap](#publix-gap) |

- **Tractor Wheels:** Recall Details for this one FDA recall names Target, Walmart and Whole Foods
  Market once each, in the existing store row. The agency's own distribution ("Nationwide") is
  unchanged. Target and Whole Foods linked by the FDA URL; Walmart linked FDA's advisory page,
  which Lotly does not hold, so it went to review and a reviewer confirmed it.
- **States stay with their store, in the data.** For Flowers Hawaiian Bread, Walmart's line gives
  Walmart Oklahoma and Texas and Sam's Club Louisiana and Texas. Those are kept per store in
  `retailer_store_listings`; the screen names the stores, and the agency's five states stay the
  distribution and the alert input.
- **No duplicate card, no second push.** Across the run, `recall_cases`, `source_records`,
  `notification_events`, `notification_deliveries`, every push table, and the agency feed and
  manifest were identical before and after. The private tables answered the app's key with 401.
- **Review batch: current notices only.** Kirkland (Costco) is prepared: no Lotly agency case and
  no FDA Enforcement Report record. Priano (ALDI) is no longer standalone: FDA published "ALDI
  Recalls Priano Protein Carbonara Tortelloni and Priano Protein Herb & Cheese Tortelloni" on
  2026-11-17 (production case `f06111ba…`: both varieties, lot T9101926, Best if Used By
  12/18/2026, Alabama, Georgia, North Carolina and South Carolina, with FDA's product photos). On
  staging the next ALDI run re-decided the notice as `link_candidate` for that case, the read path
  stopped returning it, and a reviewer confirmed the match (`confirm-agency-match`), so FDA's case
  is the one card. Madeleines, Caesar, Happy Farms and Nature's Nectar are ended (FDA:
  Terminated). They were withdrawn on staging and stay out until Lotly can show a recall's status.
  Their request files remain for that later release.
- **Finding:** Lotly holds two agency cases for one H-E-B Creamy Creations recall (`261c3408…`
  and `b35ed0e7…`, both 2024-04-29). It surfaced in an H-E-B trial that is not part of this launch.
- **Duplicate-looking cards on staging (2026-11-17).** Brad's Crunchy Kale and Tractor Wheels each
  showed twice. Each pair was two different case ids for one FDA URL: the staging stack's own
  ingested case (with its source record) and a production copy the staging seed script added
  (`38c00154…`, `81f864e2…`). The seed inserted source records with ignore-duplicates, so the
  copies kept no source record. 30 such orphan copies were found, each with exactly one twin and
  nothing referencing it, and were removed from staging only. Production holds one case per FDA
  URL (935 cases, 935 ids, 0 shared URLs, read through the public feed path). No title-based
  de-duplication was added.
- **Simulator captures** (2026-11-17, this branch's Metro on the staging stack): see
  `~/Desktop/Lotly-Retailer-Review/final/`.

## Store listings

Walmart (with Sam's Club), Target, Whole Foods Market and Publix each publish a list of the recalls
they sold, linking the FDA or FSIS notice. For the year to 2026-11-16, every US food entry on
those lists was already a Lotly agency case. A listing is therefore never a new card: it adds the
store's own statement to the agency recall it names.

- **Private until linked.** `retailer_store_listings`
  ([migration](../supabase/migrations/20261118100000_retailer_store_listings.sql)) is service-role
  only. `consumer_store_listings()` returns one row per store, and only for a listing linked to an
  existing case.
- **Linked only when certain.** The agency link must be a source URL of exactly one Lotly case. A
  reviewer can link a listing in review (`retailer:listings -- confirm`), and that choice survives
  every later run while the store's link is unchanged. Everything else goes to review and is never
  shown: no agency link, a link Lotly does not hold, several cases, or a sold-at line not read
  completely. Canadian notices are excluded.
- **One store, its own facts, kept in the data.** Each store keeps its own scope, states and
  channels ([store-listings.ts](../src/server/retailer/store-listings.ts)). Nothing is merged into
  the agency's distribution or the alert verdict, and one store's states are never given to
  another.
- **Never a case write.** A listing reads `source_records` and `recall_cases` (SELECT) and writes
  only its own table. No case changes, so no material change is detected and no alert is sent.
- **On screen:** only the store's verified name, once, in Where It Was Sold's existing store row
  (`withListedStores` in [recall-presentation.ts](../src/lib/recall-presentation.ts)). A name the
  agency already stated, alone or inside a run such as "Costco and Sam's Club", is not repeated.
  No heading, no per-store link and no channel phrase is added; the official agency report link is
  the screen's one source link.

```bash
npm run retailer:listings -- --publisher walmart     # dry run (walmart, target, wholefoods, publix)
npm run retailer:listings -- --publisher walmart --apply --confirm --expect <n>
npm run retailer:listings -- confirm <native-id> --publisher walmart --case <agency-case-uuid> --by <name>
```

Source notes, verified 2026-11-16 with the honest client:

- Walmart: <https://corporate.walmart.com/recalls>, "Food Recalls" section. About three months of
  entries, each with a "Sold at …" line. Proofpoint-wrapped links are unwrapped.
- Target: <https://www.target.com/help/articles/news-safety/product-recalls> highlights the five
  newest Grocery/OTC articles. Each article says "Sold at: Target Stores & Target.com" and links
  FDA or FSIS. Older articles are reachable only through Target's search, so only the newest five
  are read.
- Whole Foods: <https://www.wholefoodsmarket.com/legal/product-recalls>, a table of date, product,
  reason and link.
- Publix: <https://corporate.publix.com/newsroom/recalls> renders `<recall-list :item-list="…">`.
  See [Publix gap](#publix-gap).

Listing runs are manual in this release. A schedule is a later step (see
[Rollout order](#rollout-order)).

### Publix gap

What is verified: the page answers the honest client, and its empty state (`:item-list="null"` with
"There are no Publix recalls at this time.") runs as an empty run. Publix's own `RecallList`
component (`cp_RecallList.js` on `assets.publixcdn.com`, read 2026-11-17) defines each entry as
`RecallDateText`, `Title`, `RecallDetailsUrl` and `SoldAtPublixText`. The reader accepts exactly
those four text fields and refuses anything else.

What is not verified, and why Publix is not ready:

- **No populated list has been observed.** The page has been empty on every read since
  2026-11-16. The old recall detail pages now show "page not found", there is no recall feed (the
  RSS-looking paths are the site's not-found page), and archive copies are off-limits.
- **No agency link.** An entry links a Publix page, not an FDA or FSIS notice, so it cannot link to
  a case by URL. Every Publix entry goes to review. Linking automatically would need the detail
  page's format, which has not been seen.

Publix becomes ready when a real populated list (and one detail page) can be recorded and tested.

## Not in this launch: H-E-B, Kroger, Albertsons

No source in this launch depends on manual intake, and none of these three has a source the
monitor can read. H-E-B answers every endpoint (newsroom posts, its RSS feeds, its WordPress API and
heb.com's recall page) with an Incapsula bot challenge. `thekrogerco.com/product-recalls/` returns
404 and Kroger's banner pages reset the connection. `albertsonscompanies.com/product-recalls.html`
returns 403. The monitor never gets past bot protection. Their recalls reach Lotly only when an
agency publishes them.

## Rollout order

Each step needs its own approval, in this order. The FSIS attachments migration
(`20261117000000_fsis_attachments.sql`, draft PR #6) applies **before** these: the retailer
migrations were renumbered to `20261118…` so versions stay in apply order whichever PR merges
first. On the staging stack they were recorded under their earlier `20261116…` numbers; the SQL is
identical.

1. Apply `20261118000000_retailer_notice_publishers.sql`: publisher check (costco, aldi), the
   `product_categories` column, and the read function recreated to return it. On staging this
   delta was applied by hand on top of the earlier `20261116000000` record.
2. Apply `20261118100000_retailer_store_listings.sql` (listings table and read function).
3. Approve Kirkland in production (`retailer:review`, real `approvedBy`); the approval stores its
   category.
4. ALDI: `npm run retailer:monitor -- --publisher aldi` dry run, apply with its count. Do not
   approve Priano: FDA now publishes it (`f06111ba…`), so the run should decide it
   `link_candidate`; confirm with `retailer:review -- confirm-agency-match … --publisher aldi
--case f06111ba-84ba-41aa-a3fc-8da900b770a5`. Bunny Luv carrots is decided `new_candidate` and
   is probably FDA's Grimmway Farms recall, but neither stored Grimmway case states the letter's
   UPCs, so it stays **unconfirmed and unapproved** until its exact identifiers support one case
   (unapproved, it is never shown). Merge this branch and set the repository variable
   `RETAILER_ALDI_ENABLED=true`; `ops:health` then expects its first scheduled success within 24
   hours.
5. Listings: `npm run retailer:listings -- --publisher <p>` dry run then apply, for walmart,
   target and wholefoods. Publix is not ready ([Publix gap](#publix-gap)). Confirm the Walmart Tractor Wheels listing by hand. Scheduling
   listings is a later job.
6. Build and ship the client with the multi-publisher read path and store listings. It requests
   `product_categories`, so it needs step 1 first; on a backend without it the client reads no
   retailer notices (fail closed).

Before step 6, every installed build is unaffected: build 14 requests only its own columns, drops
non-Costco notices and has no listing read path.

A notice that becomes an agency recall leaves one card. The monitor re-decides every notice on
each run, a consistent single match becomes `link_candidate`, and the read path returns only
`new_candidate` notices. The reviewer's confirmation then makes the link permanent. No retailer
step writes the notification ledger, so the agency case's own alert is the only one.

Until then both cards can show. That window has no fixed maximum; it is the sum of:

1. agency publication → Lotly case: the next agency ingest (watchdog-backed; 45-minute median,
   87-minute longest gap over 14 days to 2026-11-18);
2. → the retailer's next **successful** monitor run (see [Scheduled runs](#scheduled-runs): on cron
   alone 8.0 hours median, 11.6 hours longest observed, unbounded when ticks are dropped; on the
   agency tick about 2¼ hours typical, 2¾ hours worst measured);
3. → the shopper's next notice load (app launch or Feed refresh);
4. if the matcher misses the agency case (a firm-name variant), until a reviewer confirms it.

A late or failing monitor shows in `ops:health` and as a red workflow; a missed match (4) shows
nowhere automatically, so check approved notices against new agency cases after each approval.

### Linked notices (later)

Linked notices (`link_candidate`) add nothing to an agency card in this release. A later release
can show an "Also announced by Costco on {date}" row on the agency detail from the same kind of
read path, without touching the case projection, so no material change or second alert can result.
Retailer alerting needs its own decision, ledger keys that stop a retailer notice and an agency
case for the same recall from both sending an initial alert, and agency-free push wording.
