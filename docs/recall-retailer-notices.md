# Retailer recall notices (Costco first)

Status (2026-11-14): **private monitoring, live and scheduled.** The migration
`20261113000000_retailer_notices.sql` is applied in production, two manual runs stored the 21
notices on the index, and `retailer-notices.yml` runs the monitor every two hours. No app build
reads retailer notices yet: the approval step and the new client are built on a branch
([Approval and the client read path](#approval-and-the-client-read-path)). The live feed, the case
tables and the notification ledger are untouched by design, not by omission.

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

## Approval and the client read path

Status (2026-11-15): **built on branch `retailer-notice-feed`, not deployed.** The migration
`20261115000000_retailer_notice_approvals.sql` is not applied in production, nothing has been
approved in production, and no build with the new client has shipped.

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
```

An approval is refused unless:

- the reviewed hash is the notice's current letter, and that letter is archived and readable;
- the monitor classes the notice a standalone `new_candidate` food recall, read as text, with a
  stated date;
- every shown field has an excerpt printed on the cited page;
- identifiers, sizes, names and states appear verbatim in their excerpts, and every number, date
  or email in reviewer prose appears in its excerpt;
- item numbers, UPCs and states are ones the letter itself states.

The field shape has no consumer pack size. The package identifiers are separate lists, never
merged: retailer item numbers, supplier codes, lots, best-by dates, can timestamps and UPCs.

The reviewed Kirkland whipped cream letter is the staging fixture:
[kirkland-whipped-cream.json](../src/server/retailer/fixtures/approvals/kirkland-whipped-cream.json).
It omits the ambiguous "case pack 8CT/3PK" and shows the contact email only as printed.

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
  - They are hidden while a browsing filter is active, because they have no category, risk or
    agency to filter on.
  - Search narrows them like any card.
  - Affects me never includes them in this release.
- **The same card and the same Recall Details.** There is no retailer layout:
  [retailer-notice-presentation.ts](../src/lib/retailer-notice-presentation.ts) adapts an approved
  notice into the shared `HomeCardModel` (rendered by `RecallCard`) and the shared `DetailModel`
  (rendered by the Recall Details screen at `/recall/retailer:<id>`). It builds them through the
  same shared builders (`whereSoldModel`, `affectedProductsModel`, `activityDisplay`,
  `homeLocationSummary`), and it decides only this:
  - **Risk:** the existing Unknown treatment in the normal badge position
    (`unclassifiedRiskView`). It is never Pending, whose note promises an agency classification
    later, and never a severity tier.
  - **The one source link:** "View Costco's letter", which opens the letter.
  - **Where It Was Sold:** the letter's states, then Costco as the stated retailer.
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
    Kirkland letter the card reads "Possible cleaning chemical contamination". What Happened stays
    the approved prose.
  - **Not shown:** the purchase window, the instructions and the contact line. The screen has no
    slot for them, so they stay in the approved fields (`RETAILER_FIELDS_WITHOUT_A_SLOT`).
  - **Absent:** no Affects You verdict, no save control (`saveable: false`; Saved cannot load a
    notice), no Health Risk, no community reports and no illness notice. The agency evidence those
    read does not exist for a retailer notice.
  - **Read path for the detail:** the screen reads a `retailer:` id only from the approved read
    path, never as a case. After one reload, an id that is not approved shows "Recall not found".

- **Alerts stay off:** retailer notices write nothing to the notification ledger.

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
- **Caesar Salad cannot be approved:** its letter states no states, and Where It Was Sold requires
  at least one.
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

### Rollout, each step a separate approval

1. Apply `20261115000000_retailer_notice_approvals.sql`. It's additive; installed builds are
   unaffected.
2. Approve the Kirkland letter in production with `retailer:review`. That is invisible to every
   installed build.
3. Ship the client build.

To stop at any point: withdraw the approval (`retailer:review -- withdraw`). The notice disappears
from the new client on its next load, and older builds never saw it.

### Linked notices (later)

Linked notices (`link_candidate`) add nothing to an agency card in this release. A later release
can show an "Also announced by Costco on {date}" row on the agency detail from the same kind of
read path, without touching the case projection, so no material change or second alert can result.
Retailer alerting needs its own decision, ledger keys that stop a retailer notice and an agency
case for the same recall from both sending an initial alert, and agency-free push wording.
