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
- [DESIGN.md](DESIGN.md) — the Lotly design contract: tokens, semantic meaning, Figma ↔ code mapping, and the product rules the visual system must carry

Trust & App Store preparation (C7): the in-app trust center renders the
structured documents in `src/content/` (sources & methodology, Affects-Me
semantics, risk vocabulary, disclaimer, corrections, privacy behavior,
attributions), pinned to the implementation by
`src/content/*.test.ts`. The code-backed audits and drafts live in
[docs/recall-data-flow-audit.md](docs/recall-data-flow-audit.md),
[docs/recall-app-store-readiness.md](docs/recall-app-store-readiness.md),
[docs/recall-privacy-policy-draft.md](docs/recall-privacy-policy-draft.md)
(draft — not published),
[docs/recall-launch-blockers.md](docs/recall-launch-blockers.md), and
[docs/recall-release-readiness.md](docs/recall-release-readiness.md) (build
identity, EAS profiles, and what Apple enrollment still blocks).

## Tech stack

- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/) / React Native, TypeScript (strict), [Expo Router](https://docs.expo.dev/router/introduction/)
- Supabase (Postgres + Data API) for persistence; schema in [supabase/migrations/](supabase/migrations/)
- Node's built-in test runner (via `tsx`) with recorded real FSIS fixtures
- ESLint + Prettier

## Project structure

```
src/
  app/          # Expo Router routes; (tabs)/ holds Feed, Saved and Profile
  components/   # reusable UI components; ui/ holds the design-system primitives
  constants/    # design tokens (design-tokens.ts, pinned to DESIGN.md) + legacy provisional theme
  domain/       # canonical model: types, projection, material-change rules
  lib/          # client-safe read path + display formatting
  server/       # server-only: FSIS + FDA adapters, ingestion pipeline, stores
assets/icons/   # the design's exported icon glyphs, tinted at render time (DESIGN.md, Iconography)
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
Profile → Notifications → "Enable recall alerts" — the permission prompt never
fires on launch, and opening the screen only reads the current status. Design, safety model, and device-setup steps:
[docs/recall-push-delivery.md](docs/recall-push-delivery.md).

### Personalization (Phase C3)

Feed offers **Affects me** / **All recalls**: one home state, allergen
selections (the nine major US allergens), and a searchable canonical store
catalog, all edited under Profile → Personalization and autosaved. Relevance is one
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
configuration a development build shows setup instructions; a release build
shows a shopper sentence instead, and names no environment variable.

### Release builds (EAS)

The installed app is **Lotly** (`lotly://`, `com.willisyang.lotly`,
iPhone-only), built from the EAS project `@willisyangg6/recall-app`. Three
profiles, no inheritance between them:

```bash
npx eas-cli build --profile development --platform ios   # dev client
npx eas-cli build --profile preview     --platform ios   # internal, release config
npx eas-cli build --profile simulator   --platform ios   # iOS Simulator .app
npx eas-cli build --profile production  --platform ios   # App Store archive
npx eas-cli submit --profile production --platform ios
```

The `simulator` profile is the only one that needs no Apple Developer
account, and today it is the only iOS build this project can produce at all:
a local `xcodebuild` fails in `expo-modules-jsi` under the Swift shipped with
Xcode 26.3 (the error, and why it cannot be worked around here, is in the
release-readiness document). Install a finished build with:

```bash
xcrun simctl install booted <path to Lotly.app>
xcrun simctl launch booted com.willisyang.lotly
```

`app.json`'s `version` is the marketing version and is edited by hand. Build
numbers are **not** in the repository: `appVersionSource` is `remote`, so EAS
holds and increments `CFBundleVersion` for each preview and production build
(development builds do not consume one). Every one of these commands needs an
Apple Developer account, which does not exist yet.

Full detail — identity, profiles, the two required `EXPO_PUBLIC_` variables on
EAS, what is verified, and what Apple enrollment still blocks — is in
[docs/recall-release-readiness.md](docs/recall-release-readiness.md).

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
  "Pending" until enforcement enrichment supplies the official class; a
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
  language (Critical / Very High / High / Moderate / Low, plus Pending and
  Unknown), derived deterministically from the authoritative class SET —
  {Class I} is Critical, a mixed set containing Class I is Very High,
  {Class II} is High, {Class II, Class III} is Moderate, {Class III} is Low.
  Pending means the agency has not assigned a classification yet; Unknown
  means the app cannot determine a supported one (a public health alert
  never receives one), and the two are never merged. No averaging, no
  heuristic scoring, and never a tier before an official classification
  exists. The agency's own wording is preserved exactly and
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
  construction. **The migration was applied to production on 2026-09-11**
  (audited read-only first); the feature gate remains `false`. Because the
  gate is off, none of the shipped experience is visible in a normal build;
  a **development-only** Design Preview harness (Profile → Design Preview,
  `__DEV__` only) renders the real screens over real recalls with the
  shopper-report values simulated in memory, so the states can be
  screenshotted without enabling anything or writing a row —
  [docs/recall-design-preview.md](docs/recall-design-preview.md).

- **P1D — the shopper-report experience** (implemented, uncommitted;
  **feature still OFF**): the complete consumer surface, built against the
  deployed contract with no SQL change. Recall Detail grows a community
  block _inside_ "Where it was sold" — `Did you find this product here?`
  below the threshold, `12 shoppers reported finding it here` at three or
  more, plus your own report with edit and remove once you have one. A
  questionnaire at `/report/<caseId>` asks one question per screen, starting
  with state (state → store → when), offering only the notice's own official
  jurisdictions and canonical retailers; on a single-state recall the state
  question is a `Did you find this product in <State>?` confirmation whose
  "No" ends the flow with nothing stored and the server never contacted. A
  point-of-submission disclosure sits above Submit, linking the in-app
  Privacy & Data Controls document — which now carries a full "Community
  shopper reports" section — because the formal Privacy Policy is still
  unpublished. Two gates gate everything: the case-derived section (null
  whenever `whereSold` is null, so an entry point can never outlive the
  official statement it corroborates) and the server's summary, which
  reads `unavailable` while the gate is off — so today the feature renders
  nowhere and the app holds no local flag that could drift. Copy and flow
  live in the tested contract `src/lib/shopper-report-presentation.ts`;
  the screen and the isolated `CommunityReportsBlock` hard-code no words
  and are meant to be restyled wholesale in the design-system pass.

## Consumer product milestones (P2 series)

- **P2A — three-tab navigation and Profile information architecture**
  (implemented, uncommitted): the app gains its first bottom navigation —
  exactly three destinations, `Feed` · `Saved` · `Profile`, with Feed
  initial. `(tabs)` is a route group, so `/` and `/profile` keep their
  existing paths and every deep link still resolves; Recall Details, the
  questionnaire, the settings pages, and the trust documents stay on the
  root stack and push over the bar, which is what keeps a fourth tab from
  appearing by accident. Search and Affects Me remain **controls inside
  Feed**, not destinations.

  Profile becomes a navigation page with three primary destinations —
  Personalization, Notifications, and Privacy & Data Controls. The first two
  previously opened one combined screen (`/settings`, titled "Alerts"); that
  screen is now two pages with their controls, copy, autosave, and stores
  unchanged, and `/settings` survives as a redirect to Notifications. The
  remaining trust documents keep their rows, so the simpler landing page
  orphans nothing. The C6 header entry to Profile is retired as duplicate
  navigation (no settings gear was removed — none existed).

  **Saved is new.** It did not exist before this milestone
  (`docs/recall-feed-usability.md` recorded it as deliberately absent), so a
  minimal version was built to make the third tab real rather than a dead
  destination: a device-local list of case ids, newest first, resolved
  against the same feed corpus the Feed already holds — never a stored copy
  of a recall, so a saved notice always shows current official facts. One
  save control serves the feed card and Recall Details, and the card itself
  moved to `components/recall-card.tsx` so Saved renders the identical card.
  Saving touches no server, mints no installation identity, and feeds nothing
  into ranking, personalization, or notifications; it **is** cleared by
  "Reset app and delete my data". No migration, no SQL, no notification
  change, and shopper reports remain disabled. Styling throughout is
  provisional (labels-only tabs, existing chip and row primitives) pending
  the design system; onboarding stays deferred. The contract lives in
  [docs/recall-feed-usability.md](docs/recall-feed-usability.md),
  "Navigation and Profile (P2A)".

- **P2B0 — design-system reconciliation and code foundation** (shipped,
  `ff810cc`): the Figma system, the founder's `DESIGN.md`, and the shipped
  product are reconciled into one design contract at [DESIGN.md](DESIGN.md)
  — Feed/Saved/Profile navigation, the Recall Detail section order including
  Health Risk, the community-report states and questionnaire, the
  jurisdiction / product-row / cell disclosures with paired identifier/date
  alignment, interaction states, the 44pt target, VoiceOver and Dynamic Type
  expectations, reduced motion, safe areas, and the prohibition on copying
  Figma's generated React/Tailwind into React Native. Token names follow
  Figma's slash-separated variables (`background/page`), and the document
  ends with the exact corrections Figma itself needs (the Detail screen's
  obsolete `label/Critical` treatment among them) and the Figma/code
  conflicts left for the founder.

  In code, `src/constants/design-tokens.ts` is the typed token foundation —
  semantic colours, the complete seven-label risk palette (Critical is
  `#EF4E47` / `#001F3E` / `#C82728` everywhere), the separate `Affects You`
  relevance palette, spacing, radii, typography with resolved line heights,
  elevation, icon sizes, and the 44pt hit target — re-exported through the
  existing `constants/theme.ts`, whose provisional values remain for
  un-migrated screens. Four shared primitives in `src/components/ui/` prove
  it: `Text`, `Surface`, `DisclosureControl` (extracted from Recall Detail,
  44pt via hitSlop), and `RiskLabel`, which replaces the provisional
  `RiskBadge` on the feed card, Recall Detail, and the Design Preview gallery
  at one canonical size. Public Sans and IBM Plex Mono are **not installed**
  (`CUSTOM_FONTS_INSTALLED` is false and pinned to `package.json`); the
  exact dependency change is recorded in `DESIGN.md` and awaits approval.
  Tests pin every token to the contract's front matter, the risk palette,
  the contract's product rules against the presentation contracts, and the
  primitives' token-only sourcing. No screen was restyled; no business
  logic, gate, SQL, or production configuration changed.

  **Follow-up (same day):** Public Sans and IBM Plex Mono are installed
  (`@expo-google-fonts/public-sans`, `@expo-google-fonts/ibm-plex-mono`,
  `expo-font`) and the root layout loads exactly the six contract faces
  behind the splash screen; `CUSTOM_FONTS_INSTALLED` is true. Three founder
  decisions applied: the visible risk label is the bare canonical word on
  every surface (`CRITICAL`, never `CRITICAL RISK`), the app is locked to
  light appearance (`userInterfaceStyle: light`; dark mode deferred until it
  has tokens and designs), and the bottom bar's `Feed` / `Saved` / `Profile`
  labels are styled from the tokens. The tier mapping, ranking, filtering,
  and notification logic are untouched.

- **P2B1 — the Lotly Feed** (shipped, `3e89771`): the first restyled
  product screen. The Feed, the shared recall card, the save control and the
  bottom navigation render from the design tokens and the shared primitives
  — four new ones in `src/components/ui/` (`Icon`, `RelevanceLabel`, `Chip`,
  `SearchBar`) beside the P2B0 four — laid out against the real device width
  and safe areas: the warm page, the elevated white search bar with an
  explicit `Clear` control, one chip row (the `All` / `Affects me` pair, a
  hairline, then the All-only Location / Risk / Category filters with
  chevrons and `Clear all`), `heading-3` section headings, and the Recall
  Card in its complete relevance × media matrix — a 112pt media tile that
  keeps its footprint as the neutral placeholder when there is no image, the
  lime `AFFECTS YOU` relevance label kept strictly apart from the risk label,
  the Public Health Alert notice label, and the bookmark save control that
  a screen reader can also reach as an action on the card itself. No icon
  library was installed: the glyphs are the Figma file's own exported
  vectors, rasterised into `assets/icons/` and tinted at render time. Every
  Feed behaviour is unchanged and pinned (`src/components/feed-design.test.ts`
  plus the existing suites); the dev-only Design Preview gained a Feed card
  matrix and a controls-and-states gallery over real recalls. Figma's bell,
  sliders glyph and `Urgency` chip were not reproduced (no behaviour; `Risk`
  is the shipped filter) — the decisions are in [DESIGN.md](DESIGN.md),
  "Known Figma/code conflicts".

- **P2B2 — the Lotly Recall Detail** (implemented, uncommitted): the second
  restyled product screen. Recall Detail renders from the tokens and the
  shared primitives — three new ones in `src/components/ui/` (`MediaTile`,
  extracted from the card; `Callout` in its warning and information tones;
  `NoticeLabel`, extracted from the card) plus the whole-screen
  `StateMessage` now shared with the Feed — with every shipped behaviour
  intact: the product header (risk label, notice label, date, save control,
  `heading-2` name, brand, official link with the external-link glyph, and
  the 152pt hero only when there is an image), the affects-you and retracted
  callouts, the four title-case sections separated by hairlines with their
  reveals on the heading rows, the community block styled as part of Where
  It Was Sold, and the Affected Products table as a white bordered grid with
  one fixed column width so the header and version rows stay aligned while
  only the table pans sideways. The pushed screens' back control is the
  platform chevron named `Back` (it read `(tabs)` before), and their header
  chrome is styled from the same tokens as the Feed's. Nothing in the
  presentation contract, the disclosure thresholds, the identifier/date
  pairing, the community copy or the server gate changed —
  `src/components/detail-design.test.ts` pins that beside the existing
  suites — and the dev-only Design Preview gained twenty-two Detail
  scenarios on real recalls (header, names, geography, every hazard guide,
  pair completeness, every risk tier) plus a Detail states-and-callouts
  gallery. Saved and Profile keep the provisional appearance.

- **P2B3 — the Lotly shopper-report questionnaire** (implemented,
  uncommitted; **feature still OFF**): the third restyled product screen.
  `/report/[id]` renders from the tokens and the shared primitives — two new
  ones in `src/components/ui/` (`Button`, the 44pt primary / secondary pill
  with disabled and busy states; `ChoiceRow` with `ChoiceGroup`, a
  single-choice radio row and its group) plus the network-free step
  components in `src/components/report-questionnaire.tsx` that the route
  composes — with every shipped behaviour intact: state first (the
  single-state yes/no confirm, or the picker over the notice's own
  jurisdictions with the shared search bar past eight of them), the store
  question only when the notice names stores, the five purchase-time
  buckets, a review of exactly what was asked, the one-line disclosure as a
  single link into Privacy & Data Controls, `Submit report` / `Update
report`, a refused submission shown beneath the action with every answer
  kept, removal only while editing behind the native confirmation, the
  exact success copy with no metric, and the removal-only paused screen. The
  presentation contract gained the `Question 1 of 3` progress line, the
  review rows, and the state-list search rules. A follow-up finalized
  unknown-geography recalls as **ineligible** for reports (a timeframe-only
  report says nothing about where a product was found): they expose no entry
  point and no questionnaire, and the flow can never build a draft without a
  jurisdiction. The same follow-up made only `Learn more.` interactive in the
  disclosure — the sentence is static text — and gave every disabled button
  label a token that clears WCAG AA on its own surface. No local gate, no count arithmetic, no new dependency; the server
  gate is still the only switch. `src/components/report-design.test.ts` pins
  the restyle beside the existing suites, and the dev-only Design Preview
  gained five questionnaire scenarios (single-state, multi-state, searchable
  nationwide, a refused submission, the paused owner) and a gallery of the
  real step components. Figma holds no questionnaire frame; the composition
  is the system's own ([DESIGN.md](DESIGN.md), conflict 26). Saved and
  Profile keep the provisional appearance.

- **P2B4 — the Lotly Saved screen** (implemented, uncommitted): the fourth
  restyled product screen, and a bounded visual milestone — no Saved feature
  was added or removed. `src/app/(tabs)/saved.tsx` renders from the tokens and
  the shared primitives: the warm page under the navigator's own `Saved` title
  (now styled from the same `screenHeader` as the Feed's, so the two titles
  cannot drift), the shared `RecallCard` at the Feed's exact list rhythm —
  content width, 16pt page margins, 16px apart — and every whole-screen state
  as the shared `StateMessage`, whose only change is an optional decorative
  glyph above the title. The empty state is `No saved recalls` / `Save a recall
to find it here later.` over the bookmark glyph the tab and the save control
  already use, and it is still decided only after BOTH storage and the corpus
  have answered, so it cannot flash at a user who has saves. The stale-feed and
  missing-from-feed notices are the shared soft-blue Information callout, and
  the stale sentence is now imported from `feed-copy` instead of duplicated.
  Everything Saved DOES is unchanged: device-local persistence, the one shared
  `useSavedRecalls` store behind Feed, Detail and Saved, save order, the card
  tap into Recall Details, the shared feed session and its pull-to-refresh,
  and the honest report of saved recalls the active feed no longer carries —
  whose ids are never pruned, which stays a known limitation (no card can be
  invented for a recall the corpus cannot describe). `src/components/saved-design.test.ts`
  pins the restyle beside the existing suites, and the dev-only Design Preview
  gained a Saved states-and-list gallery that neither reads nor writes the
  device's saved list. Profile keeps the provisional appearance.

- **P2B5 — the Lotly Profile hub** (implemented, uncommitted): the fifth
  restyled product screen, in the hierarchy the founder chose from the Phase 1
  explorations (Direction B's personalization-first lead over Direction A's
  grouped boxes; no permanent trust callout): a featured Personalization card,
  a boxed Notifications row, then Privacy & Data, About & Safety, Legal and
  App as grouped sections, and the development entry last, under the same
  navigator header as Feed and Saved. The card shows **this device's real
  preferences, read on focus through the one existing store and never
  written** — state, allergens and stores under compact rules (two names,
  then `+N`; every name spoken), with honest `Loading…` and `Unavailable`
  states that are never rendered as empty choices. Four small production
  components in `src/components/profile/` (`ProfileSection`, `NavigationRow`,
  `ValueRow`, `DevelopmentEntry`) plus the card, a `chevron-right` glyph
  derived from the set's own `chevron-down`, and the registry summaries now
  say Lotly where they named the product. Every destination is reached
  exactly once, the reset stays inside Privacy & Data Controls, and the
  Phase 1 directions are removed; `src/components/profile-design.test.ts`
  and `src/lib/profile-hub.test.ts` pin it. The dev-only Design Preview
  gained a gallery of the production components in every card state
  ([DESIGN.md](DESIGN.md) "Profile",
  [docs/recall-design-preview.md](docs/recall-design-preview.md)). The child
  screens keep the provisional appearance.

- **P2B6A — Lotly Personalization and Notifications** (implemented,
  uncommitted): Profile's two interactive child screens restyled onto the
  tokens with every behaviour, storage rule, permission boundary and route
  intact. Personalization: the navigator's title as the only heading, then
  three content sections (title-case `heading-3` headings) — one state and
  the stores each as a compact trigger row that opens a native page sheet
  (`SelectorSheet`, React Native's own `Modal`) holding the shared search
  bar and, for the state, the questionnaire's radio `ChoiceRow`s (choosing
  replaces and closes; `Clear selection` keeps the sheet open) or, for the
  stores, the whole catalog as a new checkbox sibling, `CheckRow`, in a
  stable canonical order where a checked row never moves, with a count in
  words and `Done`; the nine allergens as `CheckRow`s on the main screen —
  with the same autosave and offline line, and `Loading…` / read-failure /
  web states that are never an empty form. The follow-up also set the
  founder's approved copy on both screens and added the "Consumer copy" and
  "Section headings and group labels" rules to DESIGN.md; a whole-app
  authored-copy audit is recorded for after P2B6B.
  Notifications: an information callout with one truthful sentence per
  permission state and the one shared `Button` that state allows (`Enable
recall alerts` is still the only path to the system prompt; opening the
  screen only reads), a checking line while the status loads, an alert
  surface for a failed operation. The routes keep the store and permission
  code; the sections live in `src/components/settings/` with their copy and
  rules in `src/lib/personalization-screen.ts` and
  `src/lib/notifications-screen.ts`. `src/components/settings-design.test.ts`
  and the two rules suites pin it; the dev-only Design Preview gained
  galleries of every Personalization and Notification state that can save,
  register and prompt nothing ([DESIGN.md](DESIGN.md) "Personalization and
  Notifications", [docs/recall-design-preview.md](docs/recall-design-preview.md)).
  The trust documents keep the provisional appearance.

- **P2B6B — Lotly trust and document-screen design** (implemented,
  uncommitted): the seven trust documents (Privacy & Data Controls, Sources &
  Methodology, How Affects Me Works, Risk Levels Explained, Safety
  Disclaimer, Corrections Policy, Attributions) render through one shared
  reading page — `src/components/document/` over the unchanged content
  registry — on the warm page under the tokenized header: the navigator's
  bar names the Profile group (`About & Safety`, `Privacy & Data`, `Legal`)
  and the page carries the full document title in `heading-1`, the
  registry's summary as a standfirst, and content section headings in
  `heading-3` over `body` prose, with sections parted by air rather than
  cards. The content model gained three typed kinds the documents needed
  and nothing untyped: a `note` (the information callout) for the medical,
  source-precedence and "no level means safe" limitations, a
  `document-link` (three, between documents that already named each other),
  and `risk-levels` rows so Risk Levels Explained draws the production
  `RiskLabel` for exactly the seven tiers beside each meaning. External
  links keep Recall Detail's treatment and their exact URLs. The reset
  section stays at the bottom of Privacy & Data Controls alone, set apart
  by a rule and the strong border, consequence before the shared secondary
  `Button`, with its confirmation, queue, busy, success and failure
  behaviour untouched and no destructive token added. Product-name rule
  applied to the document bodies and the reset copy (`Lotly` where the
  product was meant — 46 lines; `recall`, `Recall data`, `All Recalls` and
  the official agency titles kept); no sentence was removed and no other
  wording changed. Every slug, route, link and safety boundary is pinned by
  `src/components/document-design.test.ts`; the dev-only Design Preview
  gained a gallery of the renderer over real content and the reset panel in
  every state, wired to nothing ([DESIGN.md](DESIGN.md) "Trust documents",
  [docs/recall-design-preview.md](docs/recall-design-preview.md)). The
  whole-app copy and tone audit remains the next milestone.

- **P2B6C — Lotly whole-app copy and tone** (implemented, uncommitted):
  every Lotly-authored consumer string now follows the "Consumer copy" rules
  in [DESIGN.md](DESIGN.md), with behaviour unchanged. Shared copy modules
  and the seven trust documents were rewritten first, then their consumers:
  no authored em dash remains; `Recall` is never the product (`Set up
personalization`, `Open Lotly on your phone`); prose says `Affects me`,
  `All recalls`, `recall alerts`, `state` and `store`; hints end with a full
  stop; the save control speaks `Remove from Saved` with its state in
  `selected`; the Feed's Edit action names what it edits; the stale-feed
  notice is a polite live region. Risk Levels Explained and Sources &
  Methodology no longer claim Detail shows official classifications or that
  the app shows a case timeline (Detail keeps the canonical Risk Label; the
  official notice link carries the classification; a material change shows
  as the `Update` line and the `Updated` date). Privacy & Data Controls and
  How Affects Me Works describe community shopper reports conditionally
  while the server gate is off, and the two interim launch placeholders (a
  promised privacy policy, a promised support contact) are gone without
  anything invented in their place. Feed, Saved, Detail and Notifications
  never render a raw error message or HTTP status: one consumer sentence per
  surface, the cause in the development console. Push bodies carry the
  approved classification sentences on the same triggers.
  `src/lib/consumer-copy.test.ts` pins the rules; the P2B6C audit's open
  launch items (formal Privacy Policy and URL, support destination, App
  Store privacy answers, shopper-report launch state, push activation, legal
  review) stay in
  [docs/recall-launch-blockers.md](docs/recall-launch-blockers.md). The
  display name is no longer among them: P3C1 renamed the installed app to
  Lotly (see
  [docs/recall-release-readiness.md](docs/recall-release-readiness.md)).

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
