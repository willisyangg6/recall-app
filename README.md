# recall-app

A consumer mobile app for US product recall alerts, starting with food recalls.

**Current status:** the FSIS vertical slice and FDA announcement discovery
(Phase A) are implemented. The app ingests real USDA FSIS recall/Public Health
Alert data and real FDA food recall announcements through one shared canonical
pipeline (raw snapshots → normalized records → recall cases → material-change
detection → notification ledger) and renders both agencies on the same
dashboard. FDA Phase B (openFDA enforcement reconciliation — the official
Class I/II/III arriving weeks later onto the same case) is implemented and
runs as the scheduled, weekly-gated daily maintenance job. Personalization
(Phase C3) is implemented. Push delivery machinery — registration, the
notification-event ledger, the delivery job, and copy formatting — is
implemented but **deliberately inactive**: until the founder runs
`push:activate -- --confirm`, `jobs:push` is a no-send no-op and no device
notification is sent. Accounts are not implemented. Production operations
were audited read-only on 2026-09-05 (O2-A) and classified **healthy**: the
Supabase scheduler watchdog is verified deployed and active, and FDA/FSIS
data was fresh and matched to upstream — see "Operational verification (O2)"
below and [docs/recall-operations.md](docs/recall-operations.md).

Design documents:

- [docs/recall-source-contract.md](docs/recall-source-contract.md) — verified behavior of the official FDA/FSIS data sources
- [docs/recall-domain-architecture.md](docs/recall-domain-architecture.md) — the canonical domain model and ingestion architecture

Trust & App Store preparation (C7): the in-app trust center renders the
structured documents in `src/content/` (sources & methodology, Affects-Me
semantics, risk vocabulary, disclaimer, corrections, privacy behavior,
attributions), pinned to the implementation by
`src/content/*.test.ts`. The code-backed audits and drafts live in
[docs/recall-data-flow-audit.md](docs/recall-data-flow-audit.md),
[docs/recall-app-store-readiness.md](docs/recall-app-store-readiness.md),
[docs/recall-privacy-policy-draft.md](docs/recall-privacy-policy-draft.md)
(draft — not published), and
[docs/recall-launch-blockers.md](docs/recall-launch-blockers.md).

## Tech stack

- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/) / React Native, TypeScript (strict), [Expo Router](https://docs.expo.dev/router/introduction/)
- Supabase (Postgres + Data API) for persistence; schema in [supabase/migrations/](supabase/migrations/)
- Node's built-in test runner (via `tsx`) with recorded real FSIS fixtures
- ESLint + Prettier

## Project structure

```
src/
  app/          # Expo Router routes (dashboard + recall detail)
  components/   # reusable UI components
  constants/    # theme tokens (placeholder — final branding undecided)
  domain/       # canonical model: types, projection, material-change rules
  lib/          # client-safe read path + display formatting
  server/       # server-only: FSIS + FDA adapters, ingestion pipeline, stores
scripts/        # explicitly invoked commands (live FSIS/FDA ingest)
supabase/       # Supabase CLI config + SQL migrations
docs/           # design documents
```

`src/server/` and `scripts/` run in Node only and may use secrets; nothing in
`src/app/`, `src/components/`, or `src/lib/` may import them or touch anything
beyond `EXPO_PUBLIC_*` configuration.

## Getting started

```bash
npm install
```

### Validation (no backend needed)

```bash
npm run typecheck    # TypeScript
npm run lint         # ESLint
npm test             # domain/pipeline tests against recorded real FSIS fixtures
npm run check        # all three
npm run qa:fda       # consumer-projection QA report over 160 recorded real
                     # FDA announcements (offline, development-only)
npm run qa:personalization  # geography/allergen/retailer coverage report
                            # (read-only against the live DB)
npm run qa:feed      # feed-completeness QA: drives the real Home loader and
                     # proves it holds every active case (read-only, live DB)
```

The test suite never touches the network: it runs against real FSIS API
records recorded in [src/server/fsis/fixtures/](src/server/fsis/fixtures/) and
real FDA announcements recorded in
[src/server/fda/fixtures/](src/server/fda/fixtures/).

### Live ingestion (production jobs, also runnable by hand)

Every ingestion path goes through one production job layer
(`scripts/run-job.ts`): a Postgres job lease (no two instances of the same
job run at once, scheduled or manual), an unchanged-source skip gate, source
plausibility guards, and per-run operational metrics on `ingest_runs`. GitHub
Actions runs the same commands on a schedule — see
[docs/recall-operations.md](docs/recall-operations.md).

```bash
npm run jobs:fda            # FDA announcements (ingest:fda is an alias)
npm run jobs:fsis           # FSIS recalls/PHAs (ingest:fsis is an alias)
npm run jobs:labels         # FSIS label visuals, recent window (incremental)
npm run jobs:labels -- --full   # daily full sweep + failure retries
npm run jobs:enforcement    # openFDA reconcile, gated on the weekly export date
npm run jobs:push           # push delivery + Expo receipt processing
npm run ops:health          # source/job health from the database, non-zero when unhealthy
```

`--dry-run` on `jobs:fda`/`jobs:fsis` runs the full pipeline in memory and
persists nothing (zero configuration needed); on `jobs:labels`/
`jobs:enforcement`/`jobs:push` it reads the live database and writes nothing
(`jobs:push` additionally sends nothing to Expo). `--force` bypasses the
unchanged-source gate after a code change.

Historical corrections are separate, explicitly invoked maintenance commands,
never scheduled. Each is dry-run by default and needs a second acknowledgment
(`--confirm`) before it writes; each leaves a durable JSON ledger on apply.
The completed ones are kept as operational record — see
[docs/recall-operations.md](docs/recall-operations.md) for each one's exact
status and semantics.

```bash
npm run repair:geography:dry             # applied 2026-09-02 (completed)
npm run repair:allergens:dry             # applied 2026-09-02 (completed)
npm run repair:hazards:dry               # P2e-B, applied 2026-09-03 (completed)
npm run repair:fda-contaminants:dry      # P3B, applied 2026-09-04 (completed)
```

### Push notifications (Phase C2)

Deliverable NotificationEvents become real device pushes via the Expo Push
Service — but only after the founder explicitly activates delivery:

```bash
npm run push:activate                       # show state; --confirm activates
npm run push:test -- --subscription <id>    # ONE labeled test push to ONE device
```

Until `push:activate -- --confirm` runs, `jobs:push` is a no-send no-op, and
events created before activation are permanently excluded (as are events
predating each device's own opt-in). In the app, alerts are opt-in via
Home → Alerts → "Enable recall alerts" — the permission prompt never fires on
launch. Design, safety model, and device-setup steps:
[docs/recall-push-delivery.md](docs/recall-push-delivery.md).

### Personalization (Phase C3)

Home offers **Affects me** / **All recalls**: one home state, allergen
selections (the nine major US allergens), and a searchable canonical store
catalog, all edited in the same Alerts screen and autosaved. Relevance is one
deterministic evaluation ([src/lib/relevance.ts](src/lib/relevance.ts))
shared by the feed, the detail screen's "Why this may affect you" section,
and push eligibility: nationwide always matches the chosen state, an
authoritative state list is respected in both directions, and unknown
distribution is never treated as "doesn't affect you" — allergen/retailer
matches are positive signals that never become exclusion filters. Changing
preferences can never push historical events (a preference-updated horizon
joins the C2 activation/subscription horizons). All recalls always remains
one tap away. Design and safety proofs:
[docs/recall-personalization.md](docs/recall-personalization.md).

### Backend setup (one-time)

1. Create a free Supabase project at [supabase.com](https://supabase.com).
2. Apply the schema:
   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```
3. Copy `.env.example` to `.env` and fill in the values from your project's
   dashboard (Project Settings → API). `SUPABASE_SECRET_KEY` is server-only:
   it is used by the ingest script and must never appear in app code or in any
   `EXPO_PUBLIC_*` variable.
4. Run `npm run ingest:fsis` and `npm run ingest:fda` to load current data.

### Run the app

```bash
npm start            # dev server (press i for iOS Simulator)
npm run ios
```

With `.env` configured, the home screen shows current FSIS and FDA recalls and
FSIS Public Health Alerts (newest activity first, source-labeled); tapping an
item opens a detail view with the official government source link. Without
configuration it shows setup instructions.

## What the FSIS slice supports

- Fetches the official FSIS Recall API (browser-fingerprint headers + retries
  for its Akamai bot filtering; no auth exists).
- Preserves every raw payload as hash-gated, append-only source snapshots.
- Normalizes FSIS quirks (dirty recall numbers, HTML entities, empty-vs-unknown
  fields) into the canonical model; unparseable records are quarantined with
  their raw payload, never silently dropped.
- One consumer case per real-world recall: expansion records (`005-2026-EXP`)
  join their parent case; PHA retractions retract the case they reference.
- Deterministic material-change detection (expansions, classification
  assignment/change — upgrades and downgrades alike, illness reports,
  instruction changes, retractions) with
  an auditable, deduplicated notification-eligibility ledger. Closures update
  the dashboard but never notify. Historical records discovered at first import
  are ledgered but suppressed as backfill.
- Read model exposed to the app via the Supabase Data API with row-level
  security: the mobile client can only read `recall_cases` and
  `affected_products`; all writes are service-role only.
- Consumer presentation layer (deterministic, display-only — the canonical
  projection is never altered): product-first summaries that preserve
  upstream-ingredient relationships ("…Containing Recalled FDA-Regulated
  Jalapeños"), un-shouted company/product names, structured "check your
  package" identifiers (use-by/best-by/sell-by dates, lots, case codes,
  establishment numbers — labeled only when the source wording says so),
  template-built "What happened" summaries (deterministic reason templates
  over structured source fields — never assembled from raw press-release
  prose; Editor's Notes become normalized Update lines or are omitted),
  standardized consumer instructions, and official product-list/label PDF
  links extracted from the notice's own HTML (links only; no PDF parsing).
- Honest illness semantics (P1 presentation contract): explicit zero → "No
  illnesses reported."; a reliably counted report → "55 illnesses reported.";
  reported without a reliable count → "Illnesses have been reported."; source
  silence → the line is omitted — never converted to zero. Disease education
  and discovery prose are never presented as illness reports.
- Feed relevance separated from source lifecycle: FSIS keeps Public Health
  Alerts "active" for years (live: 167 of 178 active cases are PHAs back to
  2014), so Home shows recent activity first and collapses older agency-active
  notices into a clearly labeled section — nothing is hidden or relabeled.
- Extraction-quality benchmark: 66 verbatim real records
  ([src/server/fsis/fixtures/benchmark-records.json](src/server/fsis/fixtures/benchmark-records.json))
  with hand-verified expectations and aggregate coverage floors, run as part
  of `npm test`.

## What the FDA slice supports (Phase A: announcement discovery)

- Discovers new FDA food recall announcements from the official listing JSON
  backend (fresh to the previous day; unsorted; undocumented — shape drift and
  staleness raise ingest warnings), with the official food-safety RSS as an
  independent cross-check: an announcement seen in both channels is one case,
  an announcement missing from the listing is warned about and ingested from
  its official page.
- Announcement identity is the URL slug with the verified update-churn
  prefixes (`updated-`, `update-`, `updated-release-`) stripped, so a retitled
  re-publish updates the existing case instead of duplicating it — whether the
  new row replaces the original or coexists with it (both patterns observed
  live).
- Food-only scope is explicit and tested: items tagged `Food & Beverages`
  (including food-tagged dietary supplements); pet food (`Animal &
Veterinary` co-tags) is deliberately deferred, not silently included.
- Fetches the official announcement page for new/changed records only and
  preserves its `<main>` content region in the snapshot store (dates,
  press-release body, product tables, photo URLs).
- Announcements are pre-classification by design: cases render honestly as
  "Risk pending" until enforcement enrichment supplies the official class; a
  class is never inferred from hazard language.
- Deterministic consumer extraction from the announcement's own words:
  distribution (nationwide / named states / honest unknown with source text),
  three-way illness semantics with FDA-specific wording patterns, standardized
  consumer instructions, product tables → "check your package" lines labeled
  by the source's own column headers, and stated recall quantities preserved
  verbatim ("120 cases of Enoki Mushroom 150g") — a founder-valued field.
- FDA reason categories map into the same structured hazard slots (allergen /
  microbial / foreign material / chemical contamination) feeding the shared
  template-built "What happened" system, with standardized consumer reason
  labels ("Potential E. coli contamination.", "Undeclared soy allergen.") and
  concise template-built "Health risk" summaries — never raw press-release
  styling or prose fragments.
- The official notice is provenance, not required reading: package
  identifiers (UPCs, lots, best-by/expiration dates, on-package locations)
  are extracted into the app from the announcement's own tables and
  label-driven prose, presented as a progressive "Do you have this product?"
  package checker — identifiers stay out of the always-visible page and out
  of the consumer action. When FDA genuinely states no identifiers, the app
  says so honestly instead of sending the user to the FDA page.
- **Consumer Projection V2** — a semantic layer (source data → parsed facts →
  consumer concepts → UI) so government table columns never dictate app
  sections. It reconstructs the source's own table grid (orientation, colspan,
  rowspan, headers that carry their own value) before giving any cell a
  meaning, routes every fact into our own concepts, deduplicates by canonical
  identity rather than by display string, orders identifiers by how easily a
  person can check them (version → date → size → barcode → lot code),
  collapses large code sets behind a second disclosure step, and shows
  official product photography in-app. It runs entirely at display time over
  preserved source data, so it improved all persisted cases with no
  re-ingestion. See
  [docs/recall-domain-architecture.md](docs/recall-domain-architecture.md).
- **Relationships survive into the projection.** When a notice states which
  values belong together — this flavor's barcode, this row's dates, this
  code's calendar date — the app keeps that association instead of flattening
  it into parallel global lists. Each affected version owns its own
  identifiers, codes, and photo; a value one version owns is never restated as
  a recall-wide identifier, and where ownership is genuinely uncertain the
  value stays at recall level rather than being invented onto a version.
- Official FDA product photos are surfaced directly in the app (horizontal
  gallery on the detail screen, package-comparison shots inside the checker,
  modest thumbnails on Home cards) — referenced at their authoritative agency
  URLs, never rehosted, and absent images simply render nothing. Images carry
  a semantic **role**, so barcode macros move to the package checker (where a
  consumer is comparing codes) while a photograph of a package label that
  happens to contain a barcode stays a primary recognition image.
- **One consumer presentation contract.** The same semantic fact always means
  the same thing, is validated against its type, and reads the same way: every
  date becomes `February 14, 2026` (ranges and qualifiers included), code
  locations are composed from surface and position rather than concatenated
  from source fragments, and a value that fails its type check is omitted
  rather than rendered wrongly — `Use by: 58 oz` cannot occur.
- **Closed consumer schemas.** The parser may extract anything the notice
  states, but the UI renders a fixed vocabulary the app defines: a package card
  holds exactly nine approved fields (Best by, Use by, Sell by, Expiration,
  Size, Packaging, Barcode (UPC), Lot code, Batch code), always in the same
  order, and there is no generic `label: value` renderer for a source heading to
  slip through. Facts with no approved field are preserved and counted, never
  shown. Every fact has one allowed destination — a recall total only in "What
  happened", geography and sellers only in "Where it was sold", dates and codes
  only in "Check your package" — and the section hides itself entirely when
  nothing useful survives, rather than filling with residual source text.
- Automated consumer-projection QA (`npm run qa:fda`) audits a
  160-announcement corpus against the anti-patterns manual review found —
  including semantic-relationship loss, not just junk strings — and reports
  source → projection completeness so information loss is measurable.
  `src/server/fda/qa-harness.test.ts` keeps critical violations at zero.
- Company, brand, and sold-at retailer are distinct consumer roles; retailers
  are shown only when the source's own text states the relationship (never
  inferred from store footprints).
- **Typed distribution geography.** One canonical US geography module (states,
  postal codes, a curated city gazetteer) is shared by ingest, display, and QA:
  a clause like "throughout MI, MN, and ND" keeps all three states, and a known
  city or borough can never be classified as a retailer — city lists render in
  their own AREAS block, with source-stated retailer → geography relationships
  preserved internally.
- **One case per real-world recall.** FDA re-publications that collide on URL
  slug ("…-health-risk-0") link to the original case only through a
  deterministic evidence gate (same firm, hazard, window, and high body
  overlap); `npm run qa:duplicates` reports duplicate candidates without
  merging, and a firm that recalls the same product twice stays two cases.
  Announcements that declare themselves expansions under a fresh URL ("Lidl US
  Expands Recall of Eridanous Shortbread Cookies…") link the same way — the
  pipeline searches for the parent and requires product identity (a shared UPC
  or the expansion title naming the parent's product) plus body corroboration,
  linking only when exactly one case qualifies; the merged case speaks with
  the expansion's declared scope. Retitled corrections — republished under a
  fresh URL because the corrected title changed the slug, opening with FDA's
  "updated their press release" editorial note (Momchipz, gluten→wheat) —
  link through the same search under their own gate: the revision note plus
  a shared UPC plus near-copy body overlap.
- **Closed variant identity and shared fields.** A version card's name must be
  a product distinction — never a date, a state, a code, a field label, or a
  serialized source row (`src/lib/variant-identity.ts` gates construction and
  QA audits the result). Source lists are role-classified before
  interpretation, so a distribution-states list or a "best buy dates" list
  never becomes product variants. In variant mode a package fact renders in
  exactly two places: the version card that owns it, or a proven-shared
  "Applies to all affected versions" block above the cards — never as a loose
  row after them. Field values are validated too: incomplete date ranges are
  suppressed rather than rendered ("between November 2028 through" cannot
  occur), and FDA and FSIS share one date model and one text renderer, so
  "vacuum package" reads `Vacuum package` and "between July 20, 2026 and
  August 17, 2026" reads `July 20–August 17, 2026`.
- **FDA classification enrichment (Phase B).** Fast announcements reach the
  app weeks before FDA assigns the formal Class I/II/III, so cases honestly
  say "Not yet assigned" until openFDA's enforcement data publishes the
  official class. `npm run reconcile:fda-enforcement` (dry-run by default)
  reconciles announcements to enforcement records through an evidence-gated
  matcher — same firm, a measured date window, and shared UPC digits or
  decisive product-name agreement; ambiguity is preserved, never forced, and
  a labeled real-data benchmark holds accepted-match false positives at
  zero. A match links the enforcement records to the case (raw payloads
  snapshotted, human-readable evidence stored) and only the classification
  reaches the consumer: never the voice, the dates, or the Home ordering.
  Classification assignments and official reclassifications are material
  changes; historical backfill suppresses their notifications as backfill.
  `npm run qa:fda-enforcement` reports source, match, and classification QA.
- **Consumer risk tier, separate from the regulatory class.** FDA classifies
  per affected product, so one recall can carry several official classes.
  Cards and the top of the detail screen lead with Recall's own five-level
  language (Critical / High / Moderate / Low / Minimal, plus Pending and
  Unrated), derived deterministically from the authoritative class SET —
  {Class I} is Critical, a mixed set containing Class I is High, {Class II}
  is Moderate, {Class II, Class III} is Low, {Class III} is Minimal. No
  averaging, no heuristic scoring, and never a tier before an official
  classification exists. The agency's own wording is preserved exactly and
  shown deeper in the detail screen ("Official FDA classifications — Class I
  and Class II"). Risk is never carried by color alone: every badge has
  visible text and a spoken label.
- **FSIS label visuals.** Official label PDFs are rasterized once, server-side
  (no OCR), into content-addressed WebP pages that join the ordinary Product
  Photos gallery (`npm run labels:fsis:dry` for the bounded local dry run); the
  PDF link remains as provenance.
- **Maintenance backfills are explicit, never folded into ingestion.** Fields
  derived at parse time only reach older records when something re-parses
  them, and incremental ingestion deliberately skips unchanged pages. A
  backfill therefore re-derives from the preserved snapshots — the archived
  source bytes — through the same canonical parser, with no network fetch and
  no second extractor: `npm run backfill:fda-images:dry` reports what would
  change (it doubles as the post-apply verification report),
  `npm run backfill:fda-images` writes only `heroImageUrl` and the record's
  image fields. It cannot create a case, write a notification, re-date a
  recall, or touch FSIS, and re-running it is a no-op.
- Extraction-quality benchmark over recorded real announcements
  ([src/server/fda/fixtures/](src/server/fda/fixtures/)) with hand-verified
  expectations and coverage floors, run as part of `npm test`.

### Personalization (built in Phase C3)

The "Affects me" experience is live in the app: user state, allergen
preferences via `normalizedAllergenTokens`, and stores via the canonical
retailer catalog, with "All recalls" always one tap away — personalization
organizes the full truth and never hides the national feed. State arrives
via manual input, not location permissions. See
[docs/recall-personalization.md](docs/recall-personalization.md).

## Intentionally not implemented yet

Accounts/auth, onboarding flow, quiet hours and other notification
preferences, ingest-time retailer enrichment of stored projections, pet-food
scope, Spanish records, CPSC/NHTSA, analytics, final visual design.

## Consumer presentation milestones (P3 series) — implemented and shipped

All five P3 presentation milestones are display-time only — none required a
production repair, migration, backfill, cache-schema bump, re-projection, or
notification (P3B's three-record hazard repair is the separately authorized
exception, applied and verified 2026-09-04). The authoritative contracts live
in [docs/recall-feed-usability.md](docs/recall-feed-usability.md).

- **P3A — optional-section visibility and Home/Detail reason parity**
  (shipped `80ed509`): sections render only over meaningful
  content, Home and Detail share one typed-reason interpretation, and one
  evidence-gated owner decides foreign-material hazards.
- **P3B — FDA contaminant-category classification** (shipped `48870a1`;
  production repair applied 2026-09-04): the disjunctive FDA category no
  longer lets packaging choose the hazard; three stored cases corrected to
  `chemical_contamination` (asbestos, Cesium-137 ×2). See
  [docs/recall-operations.md](docs/recall-operations.md).
- **P3C-1 — affected-product value correctness** (shipped `aab6588`):
  barcode ownership decided by the governing label, never digit length;
  space-delimited dates parse and deduplicate; structured identifier and
  date cells join with commas only, with no same-month collapse; the recall
  quantity is a sentence of the What Happened narrative.
- **P3C-2 — affected-product row ownership** (shipped `51c1a7b`): the
  Affected Products table is the sole presentation of codes and
  row-applicable production dates; below-table disclosures are retired;
  nameless-but-supported rows survive; ambiguous ownership is refused.
- **P3D — consumer-facing display capitalization** (shipped `cae9732`):
  defect-gated headline and leading-word casing with structural preservation
  of intentional casing (`iHerb`, `a2`, `FDA`, `E. coli`).
- **P3E — reason-clause casing** (shipped `b4a1a12`): evidence-gated
  restoration of medically meaningful casing in free-text reason clauses
  (`Cronobacter sakazakii`, `Bacillus cereus`, `vitamin D3`); exactly seven
  recorded-corpus clauses change, frozen by a corpus guard.

Still deferred within this area: the Dynarex `Mfg. Dt.` / `Exp. Dt.`
day-first columns stay unsupported and hidden (a month-first reading would
misstate them), and none of this activates push delivery.

## Consumer product milestones (P1 series)

- **P1B — standardized health guidance** (shipped, display-time):
  Recall Detail gains a `Health Risk` section between
  `Where it was sold` and `Affected Products`. Copy comes from a versioned,
  source-reviewed registry ([src/content/hazard-guides.ts](src/content/hazard-guides.ts))
  so the same recognized hazard renders identical wording on every recall —
  guides for botulism, Listeria, Shiga toxin-producing _E. coli_, undeclared
  allergens, Salmonella, hepatitis A, and Cyclospora, each citing a CDC or
  FDA page with a review date. Selection reuses the shared typed-reason
  interpreter; a notice naming two supported hazards resolves by an explicit
  `displayPriority` tie-breaker — a presentation ordering that picks one
  guide deterministically, never a claim of medical severity. The guides
  carry no onset, incubation, or recovery-duration windows: they explain the
  hazard, its common symptoms, and materially higher-risk groups, without
  inviting readers to self-diagnose by timing. Hazards with no reviewed guide keep a risk sentence alone
  (never invented symptoms), unmapped and regulatory-only reasons omit the
  section entirely, and a retracted notice suppresses it. Recall-specific
  illness facts stay separate in What Happened. Measured over the 226
  recorded notices: 203 render a section (150 full guides, 53 risk-only),
  23 correctly omitted — no coverage regression. No ingestion, projection,
  notification, migration, or database change. The contract lives in
  [docs/recall-feed-usability.md](docs/recall-feed-usability.md).

  Settled by P1B, deliberately not built: no consumer correction history, no
  generic "What should I do?" section or page, and no shopper/community
  reporting UI — shopper reports are P1C (data model, questionnaire logic,
  aggregation) and P1D (visible flow).

- **P1C — community shopper reports, data foundation** (implemented,
  uncommitted; **feature OFF**, migration **not applied to production**):
  the secure backend and nonvisual client foundation for community
  corroboration ("N shoppers reported finding it here"), with no
  questionnaire, no Detail copy, and no route — those are P1D. One
  forward-only migration
  ([supabase/migrations/20260910000000_shopper_reports.sql](supabase/migrations/20260910000000_shopper_reports.sql))
  adds an RLS-locked `shopper_reports` table (no policies, no public
  grants; one row per installation and case), a disabled-by-default
  kill-switch config, and five SECURITY DEFINER RPCs: submit/update
  (idempotent upsert validated server-side against the case's own
  lifecycle, official geography, and canonical retailer evidence), get-my,
  withdraw (physical delete), a thresholded public summary (0–2 reports
  return one indistinguishable hidden state; 3+ return the real exact
  total), and an extended `delete_installation_data` covering reports.
  Ownership reuses the existing keychain-held random-UUID bearer
  capability. Two founder decisions are recorded and enforced: the
  residual multi-installation (Sybil) risk is an **accepted MVP
  limitation** — bounded to count inflation, containable by the kill
  switch, never described as Sybil-proof — and reports carry a **12-month
  retention** (`expires_at`, restarted only by a meaningful edit): expired
  rows stop counting and stop returning instantly, never block a fresh
  submission, and a daily pg_cron job (`recall-shopper-report-expiry`)
  physically deletes them within ~24 hours. Details and remaining launch
  preconditions:
  [docs/recall-shopper-reports.md](docs/recall-shopper-reports.md) and
  [docs/recall-launch-blockers.md](docs/recall-launch-blockers.md).
  Client foundation: `src/domain/shopper-report.ts`,
  `src/lib/report-api.ts`, `src/lib/shopper-report-store.ts` (mutations
  ride the shared installation mutation queue; reads never mint an
  identity). Verified by deterministic suites plus a live matrix over real
  PostgREST on a disposable local stack (applied the full migration chain;
  torn down completely). Community data influences no official field,
  feed, notification, or ranking — the aggregate is one-way by
  construction.

## Operational verification (O2)

- **O2-A — read-only production audit, completed 2026-09-05. Final
  classification: `healthy`.** The scheduler watchdog is verified deployed
  and active in production (since 2026-08-28) and, by the audit's inferred
  dispatch attribution, is the effective freshness owner; GitHub's native
  cron remains a secondary best-effort channel. FDA and FSIS were fresh and
  matched to upstream within the documented food scope. All named
  migrations (installation deletion, consumer feed manifest, product-visual
  provenance) are verified applied. No remediation or production mutation
  was required. Dated evidence and grades:
  [docs/recall-operations.md](docs/recall-operations.md) ("Production
  verification (O2-A, 2026-09-05)") and
  [docs/recall-scheduler-watchdog.md](docs/recall-scheduler-watchdog.md).
- **O2-B — documentation reconciliation only** (this closeout): repository
  docs updated to the verified state; no code, configuration, or production
  change.
- Push delivery remains deliberately inactive and was outside O2's scope.

## Ingest-pipeline atomicity and historical repair (O3)

**O3 is complete: implemented, deployed, and production-settled.** The
applied-version contract (crash-safe ingestion: archived snapshots and
downstream application are separate, atomically-tracked facts) shipped and
has run through natural FDA and FSIS cycles. Governed, plan-bound,
digest-bound historical reconciliation and re-derivation then resolved the
pre-O3 legacy population in independently reviewed waves — culminating in a
final settlement and Simulator QA pass. Final production state: **3,525 of
3,526 source records `applied`, 0 `pending`, 0 `applied_degraded`, and
exactly 1 permanent governed exception** (FSIS 083-2016, held because
current derivation would erase its valid stored `undeclared wheat`
evidence — a deliberate exclusion, not an ingest failure). The repair
program created zero notification events and zero deliveries; push
delivery remains deliberately inactive throughout. Full history, the
implementation checkpoint sequence, and the final closeout are recorded in
[docs/recall-operations.md](docs/recall-operations.md).

Two presentation gaps remain, tracked as future UI work rather than O3
defects: Detail has no dedicated section for the corrected consumer
instruction (`consumerAction`) or for canonical retailer identity, and the
repair's stored `corrected` timeline entries have no consumer-facing
timeline renderer yet. See
[docs/recall-feed-usability.md](docs/recall-feed-usability.md).

See [AGENTS.md](AGENTS.md) for standing rules for coding agents working in this
repository, and
[docs/recall-agent-workflow.md](docs/recall-agent-workflow.md) for milestone
prompt and report templates, context management, and model routing.
