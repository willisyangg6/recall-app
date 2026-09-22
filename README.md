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
(Phase C3) is implemented. Foreground revalidation (P2B7S) is
implemented: the app now refreshes when it returns to the foreground, not
only on cold launch and pull-to-refresh. **Ingestion freshness is
operations-only** — shoppers never see "last checked" times or stale-state
messaging, and a refresh that fails over recalls already on screen is
silent; the founder is alerted instead by a dead-man heartbeat, which is
built and wired but **not yet live** (the Healthchecks check is paused
pending a push). No migration is involved. See
[docs/recall-production-runbook.md](docs/recall-production-runbook.md) §16
and §18. Push delivery machinery — registration, the
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
npm run qa:titles    # shopper-title casing QA: an offline boundary gate (the
                     # exit code) plus a read-only live-corpus measurement
npm run qa:search    # search-correctness QA: an offline boundary gate (the
                     # exit code) proving every searchable field is still
                     # reachable on its own and that codes match exactly,
                     # plus a read-only measurement of the field inventory
                     # and stored retailer-evidence quality. `-- --report`
                     # also writes a durable artifact under .reports/
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
npm run ops:heartbeat       # dead-man heartbeat (P2B7S) — read-only, pings the external
                            # monitor only when BOTH agency channels satisfy the 90-minute
                            # SLO. Reads ingest_runs directly (no view, no migration).
                            # Prints "NOT CONFIGURED" and exits 0 without HEARTBEAT_URL;
                            # never fails a run, never prints a URL.
```

`--dry-run` on `jobs:fda`/`jobs:fsis` runs the full pipeline in memory and
persists nothing (zero configuration needed); on `jobs:labels`/
`jobs:enforcement`/`jobs:push` it reads the live database and writes nothing
(`jobs:push` additionally sends nothing to Expo). `--force` bypasses the
unchanged-source gate after a code change.

Historical corrections are separate, explicitly invoked maintenance commands,
never scheduled. **Every** one of them is dry-run by default, and a production
write requires the operator to type all three of `--apply --confirm --expect
<fresh-count>` — no package script, wrapper or internal argv rewrite supplies
any of them (P2B7T). The flags are resolved and refused before a database
client is constructed, the whole corpus is planned before the first write, and
a count that no longer matches the live corpus aborts with zero writes. Each
leaves a durable JSON ledger on apply. The completed ones are kept as
operational record — see [docs/recall-operations.md](docs/recall-operations.md)
for each one's exact status and semantics.

```bash
npm run repair:geography:dry             # P2B7Q.2 — re-measured 2026-09-22: 0 rows, no apply needed
npm run repair:allergens:dry             # applied 2026-09-02 (completed)
npm run repair:hazards:dry               # P2e-B, applied 2026-09-03 (completed)
npm run repair:fda-contaminants:dry      # P3B, applied 2026-09-04 (completed)
npm run repair:illness-flags:dry         # P2B7L — re-measured 2026-09-22: 0 stale, no apply needed

# Every apply is typed in full; --help prints the contract at the terminal:
#   npm run repair:geography -- --apply --confirm --expect <fresh count>
#   npm run repair:illness-flags -- --apply --confirm --expect <fresh count>
# A dry run with nothing to do prints "No apply needed" and offers no command.
```

The P2B7U expand migration
(`supabase/migrations/20260921000000_installation_preference_states_expand.sql`)
is **applied in production**, verified read-only on 2026-09-22 two ways:
`npm run preflight:preference-states` reports `state_codes EXISTS` (3 rows, a
re-run backfills 0), and the Data API exposes `set_installation_preferences`
with the plural `p_state_codes` argument the shipped client calls. It added a
`state_codes` array beside the mirror's existing `state_code` and a plural
write RPC beside the existing one, dropping nothing — the additive half of an
expand-and-contract rollout. The precondition it placed on push activation is
therefore satisfied. The separately authorized **contract** phase (dropping
`state_code` and the singular signature) is still unwritten and is not a
launch blocker.

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
npm run dev:reset    # stop this project's dev servers, clear caches, start fresh
```

If icons disappear from a running development session — glyphs gone while
their labels stay — that is the dev server, not the app. In development every
icon is fetched from the address baked into the loaded bundle, so a server
that moved port or LAN IP leaves each newly mounted icon with nothing to
draw. `npm run dev:reset` is the cure; release builds embed their assets and
are unaffected. See
[docs/recall-development-assets.md](docs/recall-development-assets.md).

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
  Photos gallery; the PDF link remains as provenance. The scheduled work is
  `npm run jobs:labels` (the job runner, with its Postgres lease);
  `npm run labels:fsis:dry` is the separate manual historical backfill's plan.
- **Maintenance backfills are explicit, never folded into ingestion.** Fields
  derived at parse time only reach older records when something re-parses
  them, and incremental ingestion deliberately skips unchanged pages. A
  backfill therefore re-derives from the preserved snapshots — the archived
  source bytes — through the same canonical parser, with no network fetch and
  no second extractor: `npm run backfill:fda-images:dry` reports what would
  change (it doubles as the post-apply verification report), and
  `npm run backfill:fda-images -- --apply --confirm --expect <n>` writes only
  `heroImageUrl` and the record's image fields. It cannot create a case, write a notification, re-date a
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
scope, Spanish records, CPSC/NHTSA, analytics, final visual design. Native
sharing is deferred on purpose — its founder contract (an HTTPS Lotly
Universal Link, blocked on the final domain) is in
[docs/recall-launch-blockers.md](docs/recall-launch-blockers.md) §6.

## Known defects and planned milestones

Recorded, not implemented. Each is an observed defect with its evidence, not a
speculative improvement; each needs its own milestone and its own founder
review. Nothing here is a launch blocker — those live in
[docs/recall-launch-blockers.md](docs/recall-launch-blockers.md).

- **P2B7O — search field audit and retailer presentation. IMPLEMENTED
  2026-09-20.** The audit found search reads six stored fields the Feed card
  renders none of directly, two of which it never renders at all — so
  "Walmart" returns 23 active recalls and no card shows the word. A
  per-result explanation was built for that and **rejected by founder
  decision**: consumers are not shown why a result matched, so matching stays
  silent and `lib/feed-search.ts` is byte-for-byte its pre-P2B7O self. What
  shipped is the retailer summary P2a deferred, on **Recall Detail only** —
  the retailers a notice named (labelled `Retailers:`, a deliberate founder
  override of the app-wide "store, never retailer" copy rule, scoped to that
  one exact string so personalization and Detail use the same word), from the
  hardened sold-at evidence through a per-segment display gate — not from the
  wider evidence list a live census showed carries table headings, product
  attributes and a freight carrier.
  Feed and Saved carry no retailer content. Contract and measurements:
  [docs/recall-feed-usability.md](docs/recall-feed-usability.md); read-only
  audit: `npm run qa:search`.

- **P2B7U — multi-state personalization with an explicit Done. IMPLEMENTED
  2026-09-21; the server-mirror migration is PREPARED AND NOT APPLIED.**

  A shopper can now hold **several jurisdictions**, not one. People live near
  a border, shop across one, and keep a second home; a single answer forced
  them to under-report where a recall could reach them.

  **The editor.** The state selector was a radio list that closed on the first
  tap. It is now a multi-select sheet that stays open: Check Rows in canonical
  order (by full name, so District of Columbia sits between Delaware and
  Florida), a count line in words, `Clear selection`, and **`Done` at the
  top-right**, where it stays reachable while the list scrolls and the
  keyboard is open. It is the one place in the app that edits a **draft**:
  opening copies the saved selection, every tap changes the copy, `Done`
  writes the whole draft once and closes, and any other exit — the swipe down,
  Android's back — discards it. No radio role or `radiogroup` survives on the
  screen. Stores deliberately keep autosave: a store list is composed one
  chain at a time, while a jurisdiction list is picked from 52 rows in one
  sitting and each half-finished state of that edit is a different Affects me.

  **The contract.** One canonical `states` array, de-duplicated and in
  canonical order rather than tap order. The legacy singular `state` migrates
  inside `sanitizePreferences` — the function every read already passes
  through — by taking the **union** of both keys and emitting only the plural
  one, so the migration is lossless, idempotent by construction, and leaves no
  singular field for a second authority to grow out of. An empty list is a
  real answer: no location preference, exactly as "no state chosen" always
  behaved.

  **The matching.** One `includes` became a set intersection in
  `evaluatePersonalRelevance`, and nothing else moved: one jurisdiction in
  common matches, an exclusion needs the source to name none of them, unknown
  geography is still unknown, nationwide still matches everyone, and the
  C5.2B allergen-only rule is untouched. Feed, Saved, Detail and push read
  that one function, proven together over recorded real notices.

  **The Settings row** shows the first two full names in canonical order then
  `+N` (`District of Columbia, Montana +1`) — never an unbounded list — and
  above a text scale of 1.5 it stacks instead of squeezing the value into a
  few characters' width. Contract:
  [docs/recall-personalization.md](docs/recall-personalization.md),
  [DESIGN.md](DESIGN.md) "Personalization and Notifications".

  **The server mirror changes in two migrations, and only the first is
  written.** `installation_preferences` and the code reading it are both
  deployed, so
  `supabase/migrations/20260921000000_installation_preference_states_expand.sql`
  is a strictly **additive expand phase**: it adds `state_codes text[]`,
  backfills each non-null `state_code` into a one-element array, and KEEPS
  both the singular column (now a maintained projection of `state_codes[1]`)
  and the singular RPC signature, adding the plural RPC as a PostgREST
  overload. Both entry points delegate to one internal implementation, so a
  write through either maintains both representations in a single statement
  and the deployed app keeps working against the expanded database. The
  backfill leaves `updated_at` — the delivery horizon — alone.

  A first draft dropped `state_code` and the singular signature in the same
  transaction. That is a contract phase wearing an expand phase's name: it
  would have broken the deployed app and the deployed delivery worker for the
  whole window before the new bundle shipped. `preference-states-migration.test.ts`
  now fails the build if the expand phase contains a `DROP`, a `RENAME`, a
  destructive `ALTER`, or loses the singular signature, and
  `preference-states-live.test.ts` proves the behaviour against real Postgres
  and real PostgREST on the local disposable stack.

  **Applied in production** (P2B7W, verified read-only 2026-09-22). Rollout
  order was migrate → verify → ship, and the exact commands are in
  [docs/recall-operations.md](docs/recall-operations.md) "P2B7U
  preference-states expand". `npm run preflight:preference-states` is the
  read-only census: measured 2026-09-21 it read 3 rows, 2 to backfill, 0
  invalid; re-run 2026-09-22 it reads `state_codes EXISTS` and a backfill that
  would touch 0 rows. The Data API independently confirms the plural
  `p_state_codes` argument the shipped client calls. The precondition this
  placed on push activation is met; push itself is still not activated.

- **P2B7U contract phase — remove `state_code` and the singular RPC. RECORDED,
  NOT IMPLEMENTED.** The second half of the expand-and-contract rollout: drop
  `installation_preferences.state_code` and the
  `set_installation_preferences(text, text, text[], text[])` signature, and
  delete the compatibility branch from the shared implementation. It needs its
  own migration and its own authorization, and it may run only once **all** of
  these hold: the expand migration is applied and verified; the P2B7U bundle
  is the only build any device can be running (pre-launch this means the
  simulator/TestFlight builds have been replaced, and post-launch it means the
  oldest supported release already speaks the plural RPC); a read-only check
  shows no write has arrived through the singular signature for a full
  retention window; and the delivery worker reads `state_codes` in production.
  Until then `state_code` stays, unread by application logic and maintained
  only as a projection.

- **P2B7V — final UI polish. IMPLEMENTED 2026-09-21.** The last presentation
  milestone: five shipped defects, each fixed as a general shared rule rather
  than a case-specific patch. Nothing about ingestion, identity, search,
  ranking, projections or material-change detection moved, and no production
  data was written.

  **1. `Clear selection` is permanently allocated.** It rendered only once a
  state was checked, so checking the FIRST state inserted a 44pt pill above
  the 52-row list and clearing the LAST one removed it — the whole list jumped
  down and back up under the shopper's finger at the moment they were aiming
  at a row. The control now renders in the same place on every visit and is
  merely INERT when there is nothing to clear: pressing it then changes no
  state, saves nothing, dismisses nothing, dirties nothing and announces
  nothing. The no-op is enforced twice — `disabled` on the control, and
  `clearStateDraft` returning the SAME draft reference — so removing either
  guard alone cannot make an empty clear mutate. The sheet's controls slot is
  structurally pinned: a test fails if any conditional reappears inside it.
  Multi-state selection, search, `Done`, dismissal semantics and the P2B7U
  additive server contract are unchanged.

  **2. `What Happened` is two paragraphs.** The recall's EXTENT is a different
  fact from its cause, and it read as a run-on: "…not declared on the label.
  The recall covers 13,619 pounds of product." The scope sentence is now an
  optional second paragraph under the cause, one normal paragraph gap apart —
  ordinary body prose, never a badge, tag, heading, card or section. The split
  is a `scope` field on the shared model (`buildWhatHappened`, `DetailModel`),
  so the screen composes nothing and null renders nothing at all. **Measured
  over the 898 consumer-visible active cases: 111 (12.4%) carry a scope
  paragraph, 787 (87.6%) carry none, and 0 cause paragraphs still contain a
  quantity.** Two things the split fixed on the way: 5 cases printed the SAME
  quantity twice in one paragraph ("The recall covers 1271 cases. The recall
  covers 1,271 cases of green onions.") because the two derivations formatted
  the thousands separator differently — the scope slot now holds exactly one
  sentence, and the agency's structured field wins; and 5 more derived a scope
  sentence that never reached the screen at all, because an import-context
  sentence had taken the single shared slot. No quantity is invented,
  inferred, rounded or reworded, and the removed update note stays removed.

  **3. Illnesses, hospitalizations and deaths are three separate boxes.**
  P2B7Q.1 gave them their own lines inside ONE outlined container under ONE
  glyph, which left the second and third indented with no icon of their own,
  reading as a continuation of the first — and forced one treatment to carry
  three different severities. Each established fact now gets its own compact
  box, stacked vertically on one left edge, in the fixed order illnesses →
  hospitalizations → deaths, each with the same warning glyph and the same
  counted-sentence grammar. **Severity is the treatment, by founder decision:**
  illnesses take `risk/high`, hospitalizations `risk/very-high`, deaths
  `risk/critical`, and an explicit denial keeps the calm blue it has always
  had. `harmNoticePalette` holds REFERENCES to the risk palette's own entries,
  never copies of its values, so there is still exactly one definition of
  Critical's red. This deliberately reverses P2B7K's "the Risk Label is the
  only reader of `riskPalette`" rule for this one case; the narrower rule that
  replaces it — severity is reached only through a named semantic map, and no
  screen or component indexes the palette directly — is pinned in
  `design-foundation.test.ts`. Every treatment clears WCAG AA with its glyph
  tinted to match its text. The classifier, the stored flags, the repair plan,
  source attribution and count derivation are untouched, and no Feed or Saved
  badge was added.

  **4. Category labels are Title Case.** "Snacks & Sweets", "Pantry &
  Staples". Applied at `foodCategoryLabel`, which is already THE one display
  mapping every surface reads — the card tag, the Category filter's options,
  the selected-filter copy, the card's accessibility label and the design
  previews — so a card and the chip that filters for it cannot drift. Seven of
  the twelve labels changed; five were already Title Case. **No identifier,
  membership, ordering, filtering, ranking, persistence or projection moved.**
  `food-category.ts` is a frozen classifier file, so its hash was amended with
  a recorded `displayOnlyAmendments` entry, and a new test proves the
  amendment is safe: the derivation cannot read a label at all.

  **5. Retailers are one inline row.** A caption heading stacked over a second
  line of names became a single sentence-style row under the geography:
  `[house] Retailers: ALDI, Costco, and BJ's`. The glyph is the Feed tab's own
  `house`, from the shared icon system, in the same leading column the
  location pin occupies above it; label and names share one text flow, so the
  list wraps as one and is announced once. The list is punctuated by the SAME
  `joinNames` the jurisdiction list uses — one, two, three-or-more — and each
  stored entry is preserved verbatim: 19 of the 170 retailer-bearing cases
  store a run the source wrote whole, and "Stop and Shop", "Smart & Final" and
  "Lunds & Byerlys" are store NAMES, not two stores each. Detail only; Feed
  and Saved carry none. No trusted-field filtering, display gate, search
  membership or "Matched…" provenance changed.

  **6. The Detail title collapses to four lines.** Only Detail; Feed and Saved
  clamps are untouched. Overflow is MEASURED, not guessed: an off-layout probe
  renders the same string in the same type at the same width with no clamp,
  and its line count decides whether the control exists — a character
  heuristic is wrong at accessibility text sizes and wrong beside the hero
  tile, which are exactly the cases the control is for. A title that fits gets
  no control at all; one that overflows gets a quiet caption-type
  `Show full title` / `Show less` sitting with the title block. Expansion
  removes the clamp entirely rather than raising it, and every per-recall
  disclosure resets when the route points at a different recall — during
  render, so no frame of the previous recall's expanded title can paint. The
  FULL title remains what search matches, what a screen reader hears, and what
  share, push, identity and de-duplication use. Nothing has a fixed height.

  **Explicitly NOT in this milestone:** no new Feed or Saved badges, no change
  to the illness classifier or stored flags, no change to the prepared
  `repair:geography`, no resurrection of the update note or of
  "What should I do?", no PHA/Affects-You redesign, no new design vocabulary,
  no general long-geography audit, and no broad re-run of the P2B7Q consumer
  copy audit.

  Contracts: [DESIGN.md](DESIGN.md),
  [docs/recall-personalization.md](docs/recall-personalization.md),
  [docs/recall-copy-contract.md](docs/recall-copy-contract.md),
  [docs/recall-illness-status.md](docs/recall-illness-status.md),
  [docs/recall-food-categories.md](docs/recall-food-categories.md),
  [docs/recall-feed-usability.md](docs/recall-feed-usability.md).

- **P2B7Q — Lotly-authored copy audit. IMPLEMENTED 2026-09-20.** Every
  shopper-facing sentence Lotly CONSTRUCTS rather than reproduces verbatim was
  inventoried, classified and audited against the whole 1,931-case table
  (898 active consumer-visible). The taxonomy, the evidence rule, the one
  owner per family, the unknown/null rules and the cross-surface rules are now
  a document: [docs/recall-copy-contract.md](docs/recall-copy-contract.md).
  Five objective defects were corrected at their shared source, all
  display-time so every future ingest inherits them with no backfill:
  the update note's date was taken from the first date-shaped string anywhere
  in an Editor's Note, which on 21 of 58 dated notes was the date of the
  notice being EXPANDED — 20 rendered an "Updated" identical to the recall's
  own announcement date and one rendered an update ten days before the recall
  existed; `expan` matched distribution and poundage expansions and rendered
  them as "additional affected products were added"; a note saying "the recall
  is not expanded" rendered as an expansion; "additional products **may be**
  recalled" rendered as a completed addition; and the outbreak clause said
  "product samples" where the sequenced sample was the upstream ingredient at
  its own manufacturer. Separately, push copy built its own reason line from
  the retired `recall-display.reasonLine` and disagreed with the card it opens
  on 534 of 898 active cases — including the certainty word ("Possible" vs
  "Potential") — and now reads the same `conciseReasonLine` the card does;
  four dormant duplicate copy generators (`illnessDisplay`, `geographyLabel`,
  `geographyDetail`, `timingLine`) that contradicted the live contracts were
  deleted. The worked example (`Updated Feb 9, 2024: additional affected
products were added.`) is **kept, verbatim** — the source states the
  completed change and dates it. Ten mutation checks are recorded in the
  milestone report; all are caught. Two findings were deliberately left for a
  founder decision rather than changed: hospitalizations and deaths reach no
  shopper surface (8 active cases —
  [docs/recall-illness-status.md](docs/recall-illness-status.md) §1.2), and
  the card and Detail contradict each other about location on 11 active cases.
  No production, migration, backfill or repair action was taken. **One of
  those findings was closed by founder decision in P2B7Q.1 below; the
  card/Detail location disagreement was NOT, and is tracked as its own
  milestone.**

- **P2B7Q.1 — the founder's decisions on the P2B7Q audit. IMPLEMENTED
  2026-09-21.** All display-time; no production action.
  **Removed:** the generated update note is gone from Recall Detail and
  `normalizedUpdate` is deleted rather than left dormant — THAT a recall
  changed is already told by its resurfacing in Recent activity and by the
  "Updated" date the material-change ledger earns, while WHAT changed was
  editorial prose the app should not write; and the unused
  "What should I do?" consumer-action generator is deleted with its concept.
  **Added:** the Detail illness notice now states hospitalizations and deaths
  on their own lines, closing the gap P2B7Q measured — 11 active cases gain a
  line and 3 of them previously rendered nothing at all, including two
  notices whose only fact was "One hospitalization due to Listeria
  monocytogenes has been reported to date". The extraction inherits the
  illness contract's own attribution and vetoes hazard education ("the
  diarrhea may be so severe that the patient needs to be hospitalized" is not
  a report), which is the largest shape in the corpus.
  **Preserved and pinned:** update resurfacing, recall identity (one case, one
  card), push/card copy parity, safe subject attribution, and the date
  handling still in use.
  **Attempted and REVERTED:** a geography consolidation that made the four
  surfaces agree by making Detail read the canonical projection. It was
  rejected by founder decision: the surfaces agreed, but on an answer the
  audit itself proves is incomplete on ~18 active cases, which ships real
  filter and Affects Me misses. Location behaviour is byte-for-byte its
  pre-P2B7Q.1 self, and the repair is tracked as the milestone below.
  Contracts: [docs/recall-copy-contract.md](docs/recall-copy-contract.md),
  [docs/recall-illness-status.md](docs/recall-illness-status.md) §1.2.

- **P2B7Q.2 — the canonical geography repair. IMPLEMENTED 2026-09-20; the
  production correction is NO LONGER NEEDED.** Re-measured read-only on
  2026-09-22 (P2B7W): `npm run repair:geography:dry` examines all 1,931 cases
  and would update **0** — the stored corpus already matches the contract,
  because the fix landed upstream in the derivation and every case has since
  been re-projected through it. Geography before and after are identical
  (nationwide 444, states 1,342, unknown 145), with 0 conflicts and 0
  refusals. No apply is pending, and nothing below is a launch blocker; the
  account of the defect is kept because the contract it established still
  governs the derivation.

  One location value now answers for the Feed card, Saved, Recall Detail, the
  Location filter, Affects Me and anything push ever reads —
  `projection.geography`, derived in one place
  ([docs/recall-domain-architecture.md §5.4](docs/recall-domain-architecture.md)).

  **The defect.** There were four readers. Recall Detail had its own, and it
  worked at PARAGRAPH scope: every state anywhere in a paragraph that mentioned
  distribution was admitted. So Detail named states no other surface had —
  **19 of 911 active cases** — and some of them were wrong in the dangerous
  direction: North Carolina from "Publix locations in Virgina and North
  Carolina are **not** impacted by this voluntary recall", Michigan from the
  state Department of Agriculture that ran the sampling, Maryland and Virginia
  from a company called Maryland & Virginia Milk Producers Cooperative. The
  canonical derivation was incomplete in the opposite direction: it required a
  preposition frame in a single sentence, so it lost every declared list that
  continued past its own sentence ("Angelicae Sinensis was distributed in the
  following states." and the fourteen that followed), "Product was **sent to**
  retail stores located in…", "available **to consumers** at…", and the
  state list after "Distribution:". It also read "Washington, DC" as
  Washington State on **16** stored cases.

  **The fix, upstream.** The evidence contract now reads at sentence and clause
  scope, requires an affirmative distribution frame, cuts non-destination spans
  (dateline, firm apposition, supplier farm, shipping origin) out of an
  otherwise good sentence rather than vetoing the sentence, follows a declared
  list past the full stop the source wrote instead of a comma, preserves
  negation, excludes what the notice rules out, unions every affirmative
  clause, and refuses a state the notice both affirms and denies. Nationwide
  must be stated and is never inferred from a long list. `parseFdaGeography`
  delegates to it, so a new case is born with the corrected answer and no
  repair participates in derivation. Detail's reader is deleted; structural
  tests fail if any surface grows one again.

  **What it changes, measured read-only over all 1,931 stored cases.** 61
  cases (54 active consumer-visible), +414 states, −25, 27 unknown → states,
  0 states → unknown, 0 nationwide either way, 0 conflicts, 0 contradictions.
  Location-filter membership changes on 53 active cases and the Affects Me
  verdict on 27. Washington loses 8 matches — those were "Washington, D.C."
  Texas gains 16, New York 12, Virginia 11.

  **Why the repair is narrow.** An ordinary re-projection of the same 61 cases
  would also move `sourceIdentifiers` on 60, `classification` on 20,
  `retailerNames` and `affectedProducts` on 19 each, and would raise **53
  `expansion_geography` notifications** — "this recall expanded" for notices
  that have not changed since publication. The repair writes one field, raises
  none, and is gated on `--apply --confirm --expect <n>` — all three typed by a
  person, since no package script carries `--apply` — with the whole corpus
  planned before the first write, every write verified by re-reading the row,
  and a durable ledger that
  `npm run repair:geography:rollback -- <ledger.json> --apply --confirm --expect <n>`
  replays backwards.

  **Not yet applied.** The stored corpus still carries the old answers, so
  until the repair runs Recall Detail shows the stored (smaller) list rather
  than the one it used to read for itself. Final live Feed/Detail/filter/
  Affects-Me QA belongs after a separately authorized apply.

  **Founder decision, recorded: city-level evidence stays truthful and stays
  unknown.** A notice that names a city without a state — "sold by Dandelion at
  their retail stores (in San Francisco and Las Vegas)", 1 active case — keeps
  that phrase on Detail, because the notice says it. It is never resolved to
  California or Nevada: the notice does not say them, and a gazetteer lookup
  would be the app inventing distribution. The card therefore says
  `Distribution not specified`, no Location filter matches, and Affects Me
  reads `unknown`. This is a property of the evidence class with no per-case
  rule behind it, pinned by
  [`src/lib/geography-boundary.test.ts`](src/lib/geography-boundary.test.ts).

- **Illness-repair ledger checkpointing (operational hardening).** The illness
  repair CLI (`npm run repair:illness-flags`) writes its durable apply ledger
  only after the write loop completes. An exception mid-loop could therefore
  leave rows written with no apply ledger recording them. The retained
  pre-apply artifact still provides recovery evidence, so this is a hardening
  item rather than a correctness defect; the fix is to checkpoint or finalize
  the ledger inside failure handling. Recorded during P2B7M; deliberately NOT
  implemented there, as it is unrelated to title presentation.

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
  Card in its complete relevance × media matrix — a 112pt media tile beside
  the text when the recall has a usable image and no media column at all
  when it does not (P2B7I: the text takes the width; never a grey
  placeholder square), the
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

- **P2B7C — official Recall Detail imagery** (implemented and corrected,
  uncommitted): Detail now renders the official FDA product photography the
  P2c allocation had been computing since 2026-09-02 but nothing displayed.
  The header tile holds the whole set — the stored hero first (the same image
  the Feed card shows), then the allocator's gallery order, **complete and
  uncapped**, virtualized so the 51-photo corpus outlier mounts one page at a
  time. One photo is the static tile exactly as before; two to five add
  position dots; six or more replace the dots with the compact `2 / 15`
  counter, and no prose accompanies either. A candidate whose image cannot
  load **leaves the set**, so the indicator always describes pages that
  actually rendered and a blank tile can never sit under one; if every
  candidate fails the header returns to its no-image shape. Everything renders
  `contain`, nothing advances on its own, there are no arrow controls, and
  the images are not pressable. One tokenized primitive
  (`src/components/ui/official-image-set.tsx`) renders it; the retired
  pre-design-system `PhotoGallery` was deleted. **FSIS label renders are
  rendered nowhere** — the label galleries this milestone first built were
  removed by founder decision, and the only imagery under Affected Products
  is a thumbnail matched to that exact product row. Feed imagery is unchanged
  and stays single-image. No schema, ingestion, API, allocation, or
  production-data change; the Design Preview gained twelve real-recall
  imagery scenarios, an imagery-and-failure gallery and a complete icon
  gallery. Native sharing stays **deferred** and its founder contract — an
  HTTPS Lotly Universal Link, never `lotly://`, blocked on the final domain —
  is recorded in
  [docs/recall-launch-blockers.md](docs/recall-launch-blockers.md) §6
  ([docs/recall-imagery.md](docs/recall-imagery.md) §14,
  [DESIGN.md](DESIGN.md) "Recall Detail").

- **P2B7D — product-category tags on recall cards** (implemented,
  uncommitted): Feed and Saved cards now show one quiet product-category
  word under the brand, so a shopper scanning the list can tell what kind of
  product a recall is. It **displays** the category C10B already derives,
  stores and filters on — no classifier, no inference in UI code, and no
  schema, ingestion, projection or production-data change. The rule is one
  function in the shared presentation contract
  (`cardCategoryLabel`), so Feed and Saved reach it through the same
  `buildHomeCardModel` and cannot disagree. Which categories may appear is
  decided by the **same launch allowlist the Category filter uses**, not a
  second list: the nine offered ids render their frozen label, and
  `prepared_foods`, `supplements` and `other` render **nothing** — no
  placeholder, no container, no spacer, nothing spoken. At most one tag per
  recall (the first launch-visible id in canonical display order); measured
  on the live feed, 695 of 895 loaded cards show one and the per-label
  counts sum to exactly 695. One tokenized primitive
  (`src/components/ui/category-tag.tsx`): an outlined `radius/4` mark in
  Public Sans `caption`, no fill, no icon, no risk or relevance colour, no
  uppercase, no interactivity — deliberately not the Navigation Chip's pill
  and not the compact mono status labels. Recall Detail, filtering, Affects
  Me, risk, search, Save and the Detail carousel are unchanged. Three
  treatments were compared in Design Preview over the same real recalls
  before one shipped, and the comparison stays there as the decision record
  ([docs/recall-feed-usability.md](docs/recall-feed-usability.md) "The card
  tag (P2B7D)", [DESIGN.md](DESIGN.md) "Category Tag",
  [docs/recall-food-categories.md](docs/recall-food-categories.md) §8).

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
- **P2B7R — read-only production and launch-readiness audit, completed
  2026-09-19. Final classification: `healthy`.** Re-verified the watchdog as
  the freshness owner (100% heartbeat delivery, worst fast-channel gap 56 min,
  zero failed runs in seven days, zero duplicate executions in thirty), traced
  the executable ingestion path end to end, and established that **no AI or
  LLM dependency exists anywhere in production**. It also confirmed that
  pushing `master` _is_ deployment — a push changes what the next run
  executes, never when it runs. Findings, the failure-mode table, alerting
  gaps, freshness SLOs, cost model, and the P0/P1/P2 launch list are in
  [docs/recall-production-runbook.md](docs/recall-production-runbook.md); the
  dated operational measurements are in
  [docs/recall-operations.md](docs/recall-operations.md) ("Production
  verification (P2B7R, 2026-09-19)"). No production action was taken.
- **P2B7W — TestFlight, push and App Store launch-readiness audit, completed
  2026-09-22. Read-only; no production, external, or repository mutation
  beyond the documentation corrections it made.** Verdict: the product is
  feature-complete and `npm run check` is green (2,996 tests, 0 failures, 3
  pre-existing lint warnings), but **no iOS binary can be built, because no
  Apple Developer Program membership exists** — the same block
  [docs/recall-release-readiness.md](docs/recall-release-readiness.md) §6
  records, re-confirmed today. The one non-Apple blocker is that **no EAS
  environment variable is set in any environment** (`eas env:list` returns
  empty for `development`, `preview` and `production`), so a build made today
  would ship with no backend and show "Recalls are unavailable" on every
  screen. Push is verifiably inactive in production (`push_delivery_config`
  holds no row, `notification_deliveries` is empty, 1 enabled subscription,
  75 deliverable ledger events that activation would permanently exclude).
  Corrections this audit made to stale documentation, each from a read-only
  production measurement: the P2B7U expand migration **is applied**, the
  geography repair **is no longer needed** (0 rows), and the illness repair
  **is no longer needed** (0 stale of 1,931). Build and release detail:
  [docs/recall-release-readiness.md](docs/recall-release-readiness.md) §9.
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
