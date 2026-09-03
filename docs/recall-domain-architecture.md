# Recall Domain Model & Ingestion Architecture

**Status:** design specification for the first backend implementation. No code exists yet.
**Evidence base:** every source-behavior claim cited as "§n" refers to [`docs/recall-source-contract.md`](recall-source-contract.md) (all sources verified live 2026-08-21). Where this document makes a product/engineering choice not dictated by evidence, it is marked **[DECISION]** with the reasoning.

**Design priorities (in order):** usability → useful coverage → understandable information → correctness and traceability → maintainability → elegance. Concretely: prefer graceful uncertainty over missing information; never fabricate recall facts; never let ingestion ambiguity silently drop an authoritative recall.

---

## Part 1 — The consumer-facing concept

### 1.1 Five things that must not be conflated

| Concept                               | Definition                                                                                                                                                                                                     | Example from verified data                                                                                                                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Government source record**          | One record in one government system, exactly as that system defines a record.                                                                                                                                  | One FDA announcement page; one openFDA enforcement record (which is _per product_, §3.2); one FSIS API record (which can be an expansion like `005-2026-EXP`, §4.1).                                |
| **Canonical recall case** (ours)      | Our application's representation of one real-world recall action by one firm under one agency. Aggregates every source record about it.                                                                        | Albertsons tuna salad = **1 case** built from 2 announcements + 5 openFDA records sharing `event_id` 97306 (§7.1). Ajinomoto fried rice = **1 case** built from `005-2026` + `005-2026-EXP` (§7.2). |
| **Affected product**                  | One product line within a case (brand, description, sizes, codes).                                                                                                                                             | The 5 per-product openFDA records of event 97306; the individual `field_product_items` lines of an FSIS record.                                                                                     |
| **Source snapshot (version)**         | The raw payload of a source record as fetched at a moment in time. Records mutate in place at both agencies (§3.2 update-in-place, §4.1 Editor's Notes), so versions are how we prove what a source said when. | `005-2026` before vs after its 2026-03-09 Editor's Note.                                                                                                                                            |
| **Related-but-distinct safety items** | Outbreak investigations (CORE), market withdrawals, FDA device "safety alerts". Legally and semantically not recalls (§2).                                                                                     | CORE table row #1402 (illness counts live there, not in recall records, §2).                                                                                                                        |

FSIS **Public Health Alerts** are deliberately _inside_ the canonical model as a case subtype, not a separate concept: they are "stop eating this" notices carried by the same FSIS feed with the same fields (§2, §4.1), and excluding them would hide exactly the cases where a firm _refused_ to recall. The case carries `noticeType: recall | public_health_alert` and the UI must label PHAs distinctly. Outbreaks and market withdrawals are **outside** the MVP model (future enrichment; §2 recommendation).

### 1.2 The consumer-facing unit: the canonical recall case **[DECISION]**

**Recommendation: the dashboard unit is the canonical recall case.** Rejected alternatives:

- _Per source notice:_ Albertsons would show two near-identical cards (initial + expansion) and Ajinomoto two; FSIS retractions would appear disconnected from the thing they retract. Users would see duplicates for exactly the most serious, most-updated recalls.
- _Per affected product:_ event 99211 would render **18 cards** for one recall (§3.2). Products are what users drill into, not what they scroll.

**UX implications:**

- One card per real-world recall; expansions appear as an "Expanded" badge + timeline entry on the same card, not a new card.
- The card can always render the fields that are reliable in every source (§6 consequence): title, brand/product, reason, agency, date, consumer action, official link.
- The detail view shows: affected products list, geography, severity, the case timeline (announced → expanded → classified → closed), and **links to every underlying official government record** — provenance is a visible feature, not just an audit artifact.
- Failure mode is explicitly acceptable: if we cannot confidently join two source records that are really the same case, the user briefly sees two cards (both true, both sourced) rather than zero or a fabricated merge. Duplicate-but-true beats merged-but-wrong beats missing.

---

## Part 2 — What "current" means, and the lifecycle model

### 2.1 The problem, from the evidence

No single source gives us a trustworthy universal "active" bit:

- A fresh FDA announcement has **no classification and no enforcement record for weeks** (§7.1: classification +23 days after announcement; §3.2). It is obviously "current".
- FDA's own status field is disclaimed by FDA ("should not be used … to track the lifecycle of a recall", §3.2) yet `termination_date` demonstrably advances (§9.1). It is _eventually_ right, never _timely_.
- The FDA announcement listing carries a "Terminated Recall" yes/no flag (§3.1) — structured but sparse in meaning (no date).
- FSIS `field_recall_type` (`Active Recall` / `Closed Recall`) is reliable; `field_active_notice` is verified unreliable (§4.1, §9.6). FSIS closure has **year granularity only**.
- Some FDA announcements may never link to any enforcement record and never get a terminated flag — a case with no termination semantics at all.

### 2.2 Lifecycle states **[DECISION]**

Three persisted states, each solving a real source problem — plus one internal disposition:

| State                     | Meaning                                                                         | Entry evidence                                                                                                                                                         | Why it must exist                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `active`                  | We have an authoritative public notice and **no authoritative closure signal**. | Any new case (default).                                                                                                                                                | The only honest default; matches consumer intent ("is this recall in effect?").                                                   |
| `closed`                  | An authoritative closure signal exists.                                         | FSIS: `field_recall_type = Closed Recall` (§4.1). FDA: announcement listing `Terminated Recall = Yes`, **or** all linked openFDA records `status = Terminated` (§3.2). | Users need to distinguish live recalls from concluded ones; both agencies do emit real closure signals, just late and asymmetric. |
| `retracted`               | The agency withdrew the notice.                                                 | FSIS PHA retraction records (verified live, §4.1).                                                                                                                     | A retracted warning shown as active would be misinformation — the one case where "conservative" means _removing_ prominence.      |
| _(internal)_ `mergedInto` | This case was reconciled into another case; not a consumer state.               | Late evidence proves two cases are one (Part 6.5).                                                                                                                     | Tombstone so old links/notifications stay auditable; consumers never see it.                                                      |

**Deliberately rejected states:** `discovered` (our sources are already public at discovery — there is no pre-public phase to model); `updated` (an update is an _event on_ a case, recorded in the case timeline and material-change log, not a state — a case doesn't stop being active because it was updated); `superseded` (FSIS expansions don't supersede the parent, they extend it — both records stay live, §7.2); `uncertain` (uncertainty is per-_field_ — geography unknown, classification pending — not per-case; a case-level "uncertain" state would be meaningless to users and would tempt us to hide cases).

**Important honesty rule:** `closed` means the _agency concluded its recall process_ (FSIS: firm "made all reasonable efforts to retrieve" product, §4.1) — **not** "the product is now safe." Recalled food can sit in freezers for months. UI copy must say "Recall closed by FSIS", never "resolved/safe", and closed cases stay searchable.

### 2.3 "Current" and the default dashboard **[DECISION]**

`current` = `state = active`. Freshness is handled by **display tiers derived from dates**, not by inventing lifecycle states:

- **Recent** — `lastPublicActivityAt` within 60 days (announcement, expansion, correction, classification, or FSIS modification — all from source-published dates, not our fetch times).
- **Ongoing, older** — active but quiet for >60 days. Shown after Recent, clearly dated ("Announced 5 months ago"). This tier absorbs the FDA cases with no termination semantics: they never silently vanish, they age visibly. The 60-day boundary is a display default to tune with real usage, not a data-model constant.
- **Closed / Retracted** — accessible via filter, badged, never in the default scroll.

**Correction (2026-08-21, from live data): agency-active ≠ consumer-current.** FSIS has no closure mechanism for Public Health Alerts, so they stay `Active` indefinitely — verified live: 167 of 178 active cases were PHAs, dating back to 2014. An earlier reading of this section implicitly equated "FSIS Active" with primary-feed placement; that is wrong for consumers. The rule is: **source lifecycle** (`active`, truthful, never changed by us based on age) and **consumer feed relevance** (a display tier) are separate concerns. The Home feed shows the Recent tier as the primary experience and presents older agency-active items in a clearly separated, collapsed-by-default section with honest ages — never terminated, hidden, or relabeled.

Every card shows its authoritative date ("Announced Aug 18" / "Updated Mar 9") plus a global "sources last checked" indicator from ingestion run metadata — freshness honesty is part of the trust proposition.

**Refinement (2026-08-26, C3.2): two activity dates, one window.** `lastPublicActivityAt` is source-published, but it is `max(publishedAt, lastModifiedAt)` across a case's records, so it also moves on wording edits and `field_last_modified_date` churn — measured live, ahead of the last material event on 354 of 895 active cases. All Recalls keeps using it (a source edit IS public activity, and that view makes no relevance claim). The personalized "Affects me" view applies the same 60-day boundary to **material activity** instead: `max(publishedAt, latest material timeline entry)`, i.e. Part 9 Layer-2 verdicts only. A recall may therefore re-enter recent activity on a genuine expansion or classification, but never on bookkeeping — and never on our own maintenance writes, which append no timeline entry at all. Because every material entry is stamped with the source-published activity date, material activity ≤ `lastPublicActivityAt` always, so the personalized window is a strict tightening of the general one. See `docs/recall-personalization.md` for the full ordering model.

### 2.4 The complete-feed contract **[DECISION]** (2026-08-27, C5.1)

Everything above computes on the client — the recent/older split, section counts, "affects me" eligibility, the ranking — over one array of active cases. That makes **completeness a correctness property, not a performance one**: a feed missing its tail produces a wrong answer in every one of those places at once, and produces it silently.

**The defect this replaced.** Home issued a single request with `limit=500` against 882 consumer-visible active cases. 382 cases — 43% of the corpus — never reached the phone. All Recalls omitted them, "affects me" could not evaluate them (120 of the representative profile's 320 qualifying cases were outside the window), and the older-section count reported the size of the page rather than the size of the corpus. Nothing errored, because nothing could tell the difference.

**Raising the number is not the fix.** PostgREST enforces a server-side `max_rows` ceiling — measured live at 1000 on this project. A request for `limit=5000` returns exactly 1000 rows, and the response body is indistinguishable from a complete one. Any single-request design is a silent-truncation bug waiting for the corpus to grow into it.

**The contract:**

|                      |                                                                                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Canonical loader** | `fetchCurrentFeed` (`src/lib/recall-feed.ts`) — the only Home feed read path. It is `loadAllPages(fetchFeedPage)`; no caller may issue a bare, unpaged query.                       |
| **Pagination**       | Keyset on the case `id`, ascending: each page asks `id=gt.<last id of the previous page>`.                                                                                          |
| **Page size**        | `FEED_PAGE_SIZE = 500` — a **transfer bound, never a total**. The loader keeps paging until a page returns short. There is no total-row ceiling at any layer.                       |
| **Completion**       | Only a short page ends the scan. A page that exactly fills costs one more request, which correctly returns empty.                                                                   |
| **Failure**          | Complete or throw. A page failure is retried (3 attempts, same cursor); if it still fails, the loader rejects rather than resolving with what it has.                               |
| **Display order**    | Imposed client-side by `buildFeedSections` / `buildAffectsMeSections`, each a total order ending in `id`.                                                                           |
| **Scope**            | `state = active AND merged_into IS NULL` — the second half is the client's RLS policy, so a merged duplicate is not missing from the feed, it is represented by its surviving case. |

**Why the cursor is the `id` and not the activity date.** Ingestion runs every 30 minutes and rewrites `last_public_activity_at` on existing rows. Under offset/range paging that is a correctness bug: a row whose activity date jumps to today moves onto page 1 while the client is reading page 3, every later row shifts by one, and exactly one active case is skipped — invisibly, because a short page never happens. Paging on a date is worse still here, because the dates are not unique: 230 of 882 active cases share their `(lastPublicActivityAt, publishedAt)` pair with another case, in groups of up to 5. The `id` is an immutable uuid primary key, so a row's position in an id-ordered scan cannot change while we page. That removes the failure mode instead of narrowing it, and it costs nothing, because display order was never the server's job.

The residual races are benign and self-correcting on the next refresh: a case inserted behind the cursor mid-scan, or one whose lifecycle state flips mid-scan. Neither can corrupt what the client already holds, and duplicates are collapsed by case id regardless.

**As the corpus grows.** Cost is linear and bounded by page count, not by a ceiling: 882 cases load in 2 requests, ~1.23 MB, ~600 ms — measured faster than the single truncated 500-row request it replaced (~1160 ms for 43% less data). At 5,000 active cases this is 10 requests and ~7 MB. The number to watch is total payload, not row count, and the first lever is the feed projection, not the page size: `timeline` (17.6% of bytes) and `geography` (17.2%) dominate, and `timeline` is carried only to derive one date per case (§2.3). Nothing detail-only — full HTML, label data, affected-product rows — is on the feed row today, and none should be added.

**C9 addendum (2026-08-29, corrected 2026-08-30).** The feed hero (`projection.heroImageUrl`) remains exactly what `projectCase` derives from the records — an official FDA photograph or nothing, byte-identical to the historical behavior. FSIS label renders in product_visuals are detail-screen evidence and are never automatically promoted to card heroes (frozen policy: an ordinary regulatory label sheet is not card imagery; professional-quality hero sourcing is C9.1, on the reserved `updateCaseHeroImage` compare-and-set seam). URL/fetch security, GTIN rules, coverage taxonomy, and the provider decision: docs/recall-imagery.md.

**C8 addendum (2026-08-29).** The complete cold load above is no longer the every-refresh cost: the client keeps the last complete corpus in a persistent on-device cache and reconciles it against a lightweight per-case token manifest (`consumer_feed_manifest`, id + content hash), re-downloading only changed/new rows and removing vanished ones. Every commit is still a complete corpus — the loader above remains the cold path and the fallback, and every guarantee in this section is unchanged. Design, consistency model, and measurements: docs/recall-feed-sync.md.

---

## Part 3 — Canonical domain model

### 3.1 Entities (5 — and why not more)

**1. `RecallCase`** — the consumer unit (Part 1). Owns canonical consumer-facing fields (Part 4), lifecycle state, geography, severity, timeline. _Why:_ it is the product.

**2. `SourceRecord`** — one government record identity: `(sourceSystem, nativeId)` where sourceSystem ∈ `fsis_api | fda_announcement | openfda_enforcement` and nativeId is the source-native key (trimmed FSIS recall number + langcode; announcement URL path; openFDA per-product `recall_number`, with `event_id` kept alongside). Carries its normalized parse, its link to a RecallCase, and link metadata (method, score, linkedAt). _Why:_ every case is built from 1..N of these (verified: 7 records for Albertsons across two systems); provenance and reconciliation both operate on this grain. openFDA's per-product grain is preserved here because it _is_ the source's grain (§3.2) — grouping to `event_id` happens at reconciliation, not identity.

**3. `SourceSnapshot`** — append-only raw payload for a SourceRecord: `(sourceRecordId, fetchedAt, contentHash, rawPayload, sourceUrl)`. New row **only when contentHash changes**. _Why:_ both agencies mutate records in place (§3.2, §4.1); snapshots are the audit trail ("what did the government say when we alerted?") and the raw material for future parser improvements (Part 12).

**4. `AffectedProduct`** — `(recallCaseId, …)` product lines: brand, description, package sizes, and **best-effort extracted** UPCs/lots/dates over preserved source text (§6: these are prose everywhere; the model must never pretend otherwise). _Why:_ "inspect exact affected products" is a stated product goal; events verifiably fan out to many products (18 in event 99211); products are also the search index for future "check my pantry" features. Each row keeps `sourceRecordId` provenance and `rawText`.

**5. `NotificationEvent`** — append-only: `(recallCaseId, kind: initial|material_update, triggerRuleId, dedupKey, materialChangeRef, createdAt)`. _Why:_ the dedup ledger and audit trail that make the founder's notification rules enforceable (Part 10). Exists from day one even though delivery infrastructure doesn't.

**Plus one operational table, not a domain entity:** `IngestRun` — per adapter: startedAt, outcome, itemsSeen/changed, error. Powers idempotent polling, stale-source detection (Part 8), and the dashboard's "last checked" stamp.

**Deliberately not entities:**

- _Organization/firm_ — a normalized `recallingFirm` string + raw variants array on the case. No MVP feature needs firm-level joins across cases; a firm entity would immediately demand its own (hard) name-deduplication problem for zero user value. Revisit if we ever build "follow this brand".
- _Geographic scope_ — a structured value object embedded in RecallCase (Part 5), not a table. States are a closed set of 50-odd values; a join table adds queries, not capability.
- _Source version cursor / reconciliation link_ — columns on SourceRecord; link-change history goes to the material-change log, which we need anyway.
- _Material change log_ — implemented as rows in the case timeline (`RecallCase.timeline` in the logical model): each entry = (occurredAt, kind, summary, causedBySnapshotIds, materialVerdict). Whether it becomes its own table is a physical-schema decision deferred to implementation.

### 3.2 Relationship diagram

```
                         ┌────────────────┐
                         │   RecallCase   │  ← consumer unit; lifecycle; canonical fields
                         └───┬───────┬────┘
             1..N linked     │       │ 1..N
        ┌────────────────────┤       ├──────────────────┐
        ▼                    ▼       ▼                  ▼
┌────────────────┐  ┌─────────────────┐  ┌──────────────────────┐
│  SourceRecord   │  │ AffectedProduct │  │  NotificationEvent   │
│ (per gov record)│  │ (per product,   │  │ (append-only ledger) │
│ link method/    │  │  with provenance│  └──────────────────────┘
│ score to case   │  │  + rawText)     │
└───────┬────────┘  └─────────────────┘
        │ 1..N (only on content change)
        ▼
┌────────────────┐        ┌───────────┐
│ SourceSnapshot  │        │ IngestRun │  (operational, per adapter poll)
│ (raw, append-   │        └───────────┘
│  only, hashed)  │
└────────────────┘
```

An unlinked SourceRecord is **never orphaned**: ingestion always creates a RecallCase for a credible new record it cannot link (Part 6.6) — the coverage invariant.

### 3.3 Future-expansion check

Non-food agencies (CPSC/NHTSA, §1) fit without rewrite: `sourceAgency` is already a first-class dimension, SourceRecord admits new `sourceSystem` values, and nothing in the model assumes food semantics except the optional hazard taxonomy values. FSIS Spanish records (`langcode`, §4.1) attach as additional SourceRecords on the same case later.

---

## Part 4 — Canonical field specification

Conventions: **Req** = required at creation. Provenance: every source-derived field on RecallCase carries which SourceRecord supplied it (implementation may store this as a per-field provenance map or by recomputing from precedence rules — Part 8.4 makes projection deterministic, so recomputation suffices).
Unknown-representation rule: _absence of knowledge is always explicit_ (`null`/`unknown` enum member), never encoded as `""`, `[]`, or a guessed default. FSIS's `""`/`[]` emptiness (§4.1) is normalized to explicit unknowns at parse time.

| Field                             | Purpose                            | Type/shape                                                                                                           | Req    | Derivation                      | Unknown handling / normalization                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                              | Internal canonical ID              | opaque UUID/ULID                                                                                                     | ✔      | app                             | Never a government number: every external ID is dirty, absent, or late for part of a case's life (§10.9).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `sourceAgency`                    | Trust label, filtering, routing    | enum `FDA \| FSIS` (open set)                                                                                        | ✔      | source                          | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `noticeType`                      | Recall vs PHA distinction (Part 1) | enum `recall \| public_health_alert`                                                                                 | ✔      | source                          | FDA is always `recall` in MVP (market withdrawals/safety alerts are filtered out at the adapter by product type + reason category where identifiable; see Part 8.2).                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `sourceIdentifiers`               | Traceability, joins, support       | array of `{system, id, url?}`                                                                                        | ✔ (≥1) | source                          | Raw **and** trimmed forms of FSIS numbers (§4.1 dirty-string warning); announcement `path`; openFDA `event_id` + all per-product `recall_number`s (may be empty pre-classification, §3.2).                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `title`                           | Card headline                      | string                                                                                                               | ✔      | source, cleaned                 | HTML entities decoded (§4.1); "Updated –/UPDATED:" prefixes stripped for display but kept in raw; recompute from newest primary notice.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `summary`                         | Card body / detail intro           | string (plain text) + `summaryHtml` retained                                                                         | ✔      | source                          | FSIS `field_summary` HTML sanitized to text; FDA announcement excerpt/description. Never paraphrased by us — always source words, possibly truncated with ellipsis.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `reasonText`                      | "Why recalled" in source words     | string                                                                                                               | ✔      | source                          | e.g. "Products may be contaminated with Listeria monocytogenes."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `hazardCategory`                  | Filtering/iconography              | enum `allergen \| microbial_contamination \| foreign_material \| product_integrity \| other_regulatory \| unknown`   | ✔      | app-derived, deterministic      | Mapped from FSIS's 9-value reason enum and FDA's reason category (§6) by a fixed lookup table; anything unmapped → `other_regulatory` or `unknown`, never guessed. Raw source category also kept.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `pathogenOrAllergen`              | Specific agent when stated         | string \| null                                                                                                       | —      | app-extracted                   | Deterministic, evidence-gated extraction shared by both adapters (`domain/hazard.ts`): fixed pathogen keyword list, plus allergens only when a bounded official reason construction states them — `undeclared <allergen list>`, the FSIS apposition `contains X, a known allergen`, `does not declare X` — negation-aware, closed source vocabulary only (multi-allergen lists preserved whole, e.g. `undeclared egg and milk`); FDA structured category tokens lead and text evidence adds only families the category omitted. Never from ingredient lists, precautionary copy, or facility prose. null = not stated/extracted. |
| `classification`                  | Severity as the agency states it   | `{value: class_I \| class_II \| class_III \| not_yet_classified \| not_applicable_pha, classifiedAt?: date, source}` | ✔      | source                          | **`not_yet_classified` is a first-class value**, the normal FDA state for weeks (§7.1) — UI shows "Awaiting FDA classification", never blank, never inferred. FSIS classifies at issuance (§4.1). Class wording is near-identical across agencies (§3.2 vs §4.1) so the shared enum is safe; the agency label is always displayed with it. No invented cross-agency "risk score".                                                                                                                                                                                                                                                |
| `state`                           | Lifecycle (Part 2)                 | enum `active \| closed \| retracted`                                                                                 | ✔      | app-derived from source signals | Rules in §2.2; `closedAt` only when a real date exists (FDA terminated flag date-less → `closedAt: null, closedYear?`; FSIS gives year only, §4.1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `publishedAt`                     | When the public was told           | date                                                                                                                 | ✔      | source                          | FDA: FDA Publish Date; FSIS: `field_recall_date`. Drives "Newest".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `initiatedAt`                     | When firm action began             | date \| null                                                                                                         | —      | source                          | FDA announcement "Company Announcement Date" / openFDA `recall_initiation_date`; null when unstated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `lastPublicActivityAt`            | Recency tiering (Part 2.3)         | date                                                                                                                 | ✔      | app-derived                     | Max of source-published activity dates (publish, expansion, Editor's Note date when parseable, classification, FSIS `field_last_modified_date`). Never our fetch time.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `lastFetchedAt` / `lastChangedAt` | Freshness honesty, debugging       | timestamps                                                                                                           | ✔      | app                             | From ingest runs / snapshot creation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `affectedProducts`                | Drill-down, search                 | AffectedProduct[] (≥0)                                                                                               | —      | source + extraction             | Each: `{brand?, name, description?, packageSizes?: string[], upcs?: string[], lotCodes?: string[], dateCodes?: string[], rawText, sourceRecordId, extractionConfidence: stated \| extracted}`. Empty list = "see official notice" (real case: FSIS PHAs with product lists only in PDFs, §4.1) — displayed as such, never hidden. UPC/lot/date arrays are **best-effort extracted from prose** (§6); `stated` only when the source structured it.                                                                                                                                                                                |
| `brands`                          | Card display, search               | string[]                                                                                                             | —      | source                          | FDA listing `field_brand_name` (HTML stripped) is reliably structured (§6); FSIS brands come from product lines/title (extracted). Empty = unknown, show firm instead.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `recallingFirm`                   | "Who" on the card                  | `{displayName, rawVariants: string[]}`                                                                               | ✔      | source                          | Keep every observed variant ("Albertsons" + "Albertsons Companies LLC", §7.1); displayName = announcement/FSIS form (consumer-recognizable), not the regulatory form.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `geography`                       | Part 5                             | see Part 5 value object                                                                                              | ✔      | source + rule-based inference   | Tri-state semantics; **never default unknown → nationwide**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `retailers`                       | "Where sold"                       | `{text: string \| null, names?: string[]}`                                                                           | —      | source prose                    | Prose-only everywhere (§6); MVP stores the text span; per-store lists (FSIS Class I PDFs) deferred. null = not stated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `quantity`                        | Scale context                      | `{rawText: string \| null, normalizedLbs?: number}`                                                                  | —      | source                          | `field_qty_recovered`/`product_quantity` are dirty prose ("0 Ibs", §4.1); show rawText, parse number only when unambiguous.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `illness`                         | Health impact as stated            | `{statementText: string \| null, illnesses?: number, hospitalizations?: number, deaths?: number, asOf?: date}`       | —      | source (+extraction)            | Three-way semantics: `statementText` null = **source silent (unknown)**; text like "No illnesses have been reported" = **explicit none** (shown verbatim); counts filled only when the source states numbers. Counts are usually in outbreak systems, not recall records (§2) — the model must tolerate permanent null.                                                                                                                                                                                                                                                                                                          |
| `consumerAction`                  | "What should I do"                 | string \| null                                                                                                       | —      | source prose                    | Extracted section of the release ("should not consume… return for refund"); null = show official-link fallback. Never authored by us.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `contact`                         | Firm contact                       | `{text: string \| null}`                                                                                             | —      | source prose                    | FSIS `field_company_media_contact` needs whitespace cleanup (§4.1). Changes are never material (founder rule).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `officialUrls`                    | Trust anchor                       | `{primary: url, others: url[]}`                                                                                      | ✔      | source                          | FDA announcement URL / FSIS `field_recall_url` (http→https normalized, §4.1); plus every linked record's URL. Announcement URLs can churn on updates (§9) — keep old + new.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `media`                           | Photos/labels                      | `{imageUrls: string[], labelPdfUrls: string[]}`                                                                      | —      | source                          | FDA announcement photos exist on detail pages (§3.1, not in the listing JSON — populated only when we fetch detail HTML, Part 12); FSIS labels are PDFs whose URLs must be recovered from summary HTML (§4.1) — MVP stores what's cheaply available, empty arrays otherwise.                                                                                                                                                                                                                                                                                                                                                     |
| `timeline`                        | Case history for card + audit      | array of `{occurredAt, kind, summary, causedBy}`                                                                     | ✔      | app                             | Kinds: published, expanded, corrected, classified, closed, retracted, linked_enforcement. Powers the detail-view timeline and material-change audit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

---

## Part 5 — Geography and "Affects me"

### 5.1 The value object **[DECISION]**

```
geography: {
  scope: 'states' | 'nationwide' | 'unknown',
  states: StateCode[],            // non-empty iff scope = 'states'
  confidence: 'stated' | 'inferred',
  sourceText: string | null,      // the distribution prose we based this on
}
```

Three-way `scope` is the core requirement: **`unknown` is not `nationwide` and not `none`.** There is no `none` scope for geography — a recall with genuinely no US distribution wouldn't be in these feeds; "no information" is `unknown`.

Mapping rules per source:

| Source situation                                                                                                      | Result                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| FSIS `field_states` = explicit list (structured, §4.1)                                                                | `states`, `stated`                                                                                                                                    |
| FSIS `field_states` = `["Nationwide"]`                                                                                | `nationwide`, `stated`                                                                                                                                |
| FDA/openFDA prose says "nationwide" (a defined term for FDA: "the fifty states or a significant portion", §3.2)       | `nationwide`, `inferred`                                                                                                                              |
| Prose enumerates states ("distributed to the following states: MD, VA" — the semi-conventional openFDA pattern, §3.2) | `states`, `inferred`                                                                                                                                  |
| Regional prose without a state list ("the Southeast", "distributors in 6 states")                                     | `unknown`, sourceText preserved and displayed                                                                                                         |
| Retailer names only, no states                                                                                        | `unknown` + retailers.text filled. **No inference from retailer footprints** — that requires external non-authoritative data and is fabrication risk. |
| Nothing stated                                                                                                        | `unknown`                                                                                                                                             |

### 5.2 Inference policy **[DECISION]**

Inference from government prose is **acceptable and necessary** (openFDA distribution is prose-only, §6; refusing to parse it would blind "Affects me" for most FDA cases), under these rules:

1. Deterministic extraction only: full state names + unambiguous postal abbreviations from the distribution field/section, plus the literal token "nationwide". No model-based guessing for geography in MVP.
2. Inference can only ever come from the **official source's own text**, which is preserved in `sourceText` and shown to the user ("Based on FDA distribution description: '…'").
3. `confidence: 'inferred'` is rendered visibly (badge/tooltip) — uncertainty is displayed, not hidden.
4. Ambiguous extraction (e.g. "in." vs Indiana) → drop to `unknown`, keep the text. Precision beats coverage _for geography specifically_ because a wrong "doesn't affect you" is dangerous.

### 5.3 "Affects me" semantics (future personalization, model-ready now)

Given a user state `S`, a case is:

- **Affects your area** — scope `nationwide`, or `S ∈ states` (stated or inferred; inferred badged).
- **Unknown distribution** — scope `unknown`: shown in "Affects me" view in a distinct clearly-labeled section ("Distribution not specified — check the notice"), **never silently excluded** — hiding unknown-geography Class I recalls from a user's filtered view would be the exact "conservatism destroys value" failure the product brief forbids.
- **Not matched** — scope `states` and `S ∉ states`: de-emphasized in "Affects me", still present in the full national feed (personalization organizes, never hides — founder rule).

No location services; `S` arrives later via manual onboarding input. Nothing else in the model changes then.

---

## Part 6 — FDA reconciliation system

Goal: link FDA announcement-derived cases to later openFDA enforcement records (grouped by `event_id`) with very high automatic coverage, without fabricating relationships. Evidence base: no shared key exists (§3.1); firm names differ across systems; enforcement arrives 3–10+ weeks later (§3.2, §7.1); ~300–600 FDA food announcements/year (§3.1 listing counts) means candidate sets are small after blocking — this is a tractable matching problem, not a big-data one.

### 6.1 Architecture: linking is enrichment, never gatekeeping

Both sides are ingested unconditionally as SourceRecords. An openFDA `event_id` group either links to an existing announcement-born case (enrichment) or **founds its own case** (the enforcement-only recalls that never get announcements, §3.1 — genuinely new information for users, published on the weekly cadence with an honest "from FDA's weekly enforcement report" framing). Therefore: a missed match costs a duplicate card, never a missing recall. This asymmetry is what lets us tune aggressively for coverage.

### 6.2 Normalization layer (deterministic, shared by matching and evaluation)

- **Firm names:** lowercase; strip punctuation; drop corporate suffixes (LLC, Inc, Co, Corp, Companies, Foods, …suffix list versioned); token set. "Albertsons" ⊂ "albertsons companies" → subset match true (verified real pair, §7.1).
- **Product text:** announcement `brand + product description` tokens vs openFDA `product_description` tokens; lowercase, strip stopwords, keep size/count tokens ("16 oz", "6 bars") which are high-signal; token-set overlap ratio.
- **Hazard:** map both sides' reason text into `hazardCategory` + `pathogenOrAllergen` (Part 4) and compare at that level ("Listeria monocytogenes" appears verbatim on both sides in the verified pair).
- **Dates:** compare announcement `Company Announcement Date`/`initiatedAt` with `recall_initiation_date` — **verified equal in the traced example** (§7.1) and definitionally close (both mean "firm began notifying", §3.2).

### 6.3 Match tiers

**Tier 0 — blocking (candidate generation):** candidate openFDA events where `recall_initiation_date` ∈ [announcement companyDate − 14d, + 45d] _(window widths are calibration outputs, Part 7, not constants — these are starting points)_. Everything below runs only within a block; with ~10 food announcements/week, blocks are tiny.

**Tier 1 — deterministic accept:** ALL of: (a) firm token-set subset/equality after normalization; (b) `recall_initiation_date` within ±3 days of companyDate; (c) hazardCategory agrees (or pathogen string matches). This is the Albertsons shape and should be the common case.

**Tier 2 — composite score:** for blocks failing Tier 1, an interpretable weighted score over: firm-name similarity, product token overlap, pathogen/hazard agreement, date proximity, distribution-state overlap (inferred states both sides), quantity-mention consistency. Two thresholds: **accept** (auto-link) and **floor**; between them = `pending` queue (surfaces in an internal review list; case stays unlinked and visible meanwhile). Weights/thresholds come from Part 7 calibration — we explicitly refuse to invent numbers here.

**Tier 3 — LLM assist (post-MVP, optional):** for the residual `pending` band only. Justification: the hard tail is _semantic_ product equivalence — "READY MEALS DUO TUNA SALAD W/ CRACKERS" vs "Tuna Salad products" (real pair, §7.1) defeats token overlap but is trivial for an LLM reading both texts. Hard limits: the LLM sees only the two records' preserved source text; it outputs a judgment + cited evidence; **an LLM verdict alone can never create a link** — it can only lift a pair that already passed Tier 0 blocking + the deterministic evidence floor (firm-name similarity above minimum, dates in window). Its verdicts are logged and sampled against the benchmark like any other tier.

**Hard guards (all tiers):** never link across agencies; never link when firm similarity is zero; never link two _announcements_ into one case on score alone unless the expansion heuristic fires (below).

### 6.4 Expansion announcements (announcement↔announcement linking)

A new announcement links to an existing case (as an expansion, not a new case) when: same normalized firm + product token overlap + published within 45 days + title/wording cue ("expands", "expanded", "additional") — the verified Albertsons pattern (§3.1). "Updated –" retitles of the _same_ URL-churned announcement are caught by near-identical content hashing + firm/brand equality (§9 URL-churn risk). If in doubt → new case (duplicate-tolerant), flagged `pending` for the same review queue.

### 6.5 Tie-breaking, revision, and repair

- **Tie-break** within a block: closest initiation-date, then highest product overlap; if two candidates remain within a small margin of each other → `pending`, no auto-link (two same-firm same-week recalls are exactly the false-merge trap; multiple products per firm are already handled by `event_id` grouping before matching).
- **Links are revisable:** every link stores method + score + evidence snapshot. New evidence (corrected openFDA record, expansion, review decision) triggers re-scoring; a link that falls below floor is severed → the enforcement group founds its own case again (cards split; timeline entries record both operations). `mergedInto` tombstones keep notification history attached to the surviving case.
- **What auto-merge may write:** linking fills _empty or strictly-additive_ canonical fields (classification, event/recall numbers, code_info-derived lots, distribution, per-product records) with provenance. It never overwrites announcement-derived consumer text (title, summary, consumer action) — the firm's public warning stays the consumer voice; enforcement adds the regulatory layer.
- **Duplicate-card avoidance vs false-merge avoidance:** resolved by the asymmetry in 6.1 — coverage errs aggressive on _linking enforcement to announcements_ (worst case: misattached classification metadata, repairable), and errs conservative on _merging two consumer-visible cases_ (worst case: users see one card for two different recalls — the only unrepairable-in-hindsight harm). Case-merge always requires Tier 1-grade evidence or human confirmation.

### 6.6 Coverage invariant (restated as a rule)

> Reconciliation failure must never remove, hide, or delay a credible recall. Any credible unlinked source record becomes a visible case within one ingestion cycle.

---

## Part 7 — Matching evaluation strategy

### 7.1 Fixture set

Built from historical public data we already know how to fetch (§3.1, §3.2): the fda.gov listing XLSX/JSON (~3-year window, ~744 food announcements) × openFDA food enforcement (bulk zip). Assemble ~200–300 labeled examples:

- **Obvious matches** — same-firm same-week pairs (Albertsons-shaped).
- **Difficult matches** — renamed firms ("X" vs "X Companies LLC"), generic product wording, long classification lag (§9: 2–9+ weeks observed).
- **Similar-but-different** — same firm, two distinct recalls in one quarter; different firms recalling the same product type in the same Listeria wave (the §7.1 jalapeño cluster shape: multiple firms, one outbreak).
- **Expansions** — announcement pairs (initial + expands) and FSIS `-EXP` analogs for the expansion heuristic.
- **Multi-product events** — one announcement ↔ many per-product enforcement records (event 97306, event 99211).
- **Negatives** — announcements with no enforcement record in-window (Dreyer's-shaped, §7.1) and enforcement-only events with no announcement.

Labeling is manual (founder/engineer, a few hours) using the same evidence a reviewer would see; each label records its justification. Fixtures are checked into the repo as JSON + provenance and grow whenever a production mismatch is found (regression capture).

### 7.2 Metrics

| Metric                      | Definition                                                              | Goal orientation                                                 |
| --------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Match recall (coverage)** | of true announcement↔enforcement pairs, % auto-linked                   | maximize — the business goal                                     |
| **Precision**               | of auto-links made, % correct                                           | high                                                             |
| **False-merge rate**        | % of _consumer-visible case merges_ joining distinct real-world recalls | drive to ~0 on fixtures; the one near-inviolable                 |
| **Unmatched rate**          | % of true pairs left unlinked (ends as duplicate cards)                 | minimize, tolerate residual                                      |
| **Pending rate**            | % routed to review                                                      | keep small enough to actually review (single-digit weekly items) |

### 7.3 Calibration process (how thresholds actually get chosen)

Thresholds and weights are **outputs of a sweep over the fixture set**, not designed numbers: run the matcher across parameter grids, plot coverage vs false-merge, and pick the operating point that maximizes coverage subject to zero fixture false-merges and an acceptable pending rate. Record the chosen point + sweep results in the repo. Re-run the benchmark on every matcher change (plain `npm`-script harness — no ML infrastructure; the matcher is deterministic string/date logic, so the benchmark is just a test suite with metrics output). If Tier 3 LLM assist is ever enabled, it is evaluated on the same fixtures, and its net contribution must be demonstrated there before production use.

---

## Part 8 — Ingestion architecture

### 8.1 Shape

Three source adapters feeding one shared pipeline. Stages are small functions with data handoffs, not services — this is a small MVP; the "architecture" is mostly disciplined boundaries.

```
 fsis_api ─┐  (poll 30–60 min)
 fda_announcements ─┤  (poll 30–60 min; JSON listing + RSS cross-check)
 openfda_enforcement ─┘  (poll daily)
        │ fetch (per-source HTTP quirks live HERE and only here)
        ▼
   SourceSnapshot store  (hash-gated append; raw payload)
        ▼
   parse + normalize → NormalizedSourceRecord (one shared shape, quirk-free)
        ▼
   identity upsert (source-native key → SourceRecord)
        ▼
   reconciliation (FDA linking Part 6; FSIS -EXP prefix linking; PHA retraction linking)
        ▼
   canonical projection (recompute RecallCase from its linked records — pure function)
        ▼
   material-change detection (Part 9: diff of consumer-relevant projection)
        ▼
   notification eligibility (Part 10; append NotificationEvent)
```

### 8.2 Adapter responsibilities (quirk containment)

Adapters own everything source-specific; nothing downstream may know a Drupal field name or an Akamai header. Per the contract:

- **`fsis_api`:** full fetch of `?field_translation_language=en` (no pagination exists, §4.1 — the full set is ~1 MB; fetch it all, don't be clever); browser-fingerprint headers + 403-retry with fingerprint variants (verified necessity, §4.1); trim recall numbers; decode entities; map `field_recall_type`, ignore `field_active_notice` (§9.6); split `-EXP`-suffixed records and PHA retractions into link directives; normalize `""`/`[]` to explicit unknowns.
- **`fda_announcements`:** fetch listing JSON (browser UA, §3.1); **sort client-side** (verified unsorted); filter to food product types (`Food & Beverages` + food-tagged variants; this is also where market withdrawals/non-recall safety alerts get excluded when identifiable from reason category — anything ambiguous stays _in_, per coverage-over-conservatism); strip HTML from brand field; treat `path` as native ID with churn tolerance (retitle detection, §6.4); RSS polled as a cheap cross-check that the JSON backend hasn't silently died (they should agree on newest items).
- **`openfda_enforcement`:** query by `report_date` range since last checkpoint (documented API, key auth, §3.2); group records by `event_id` for reconciliation; weekly bulk-zip full sync as a monthly self-heal against in-place edits our range queries missed.

### 8.3 Operational semantics

- **Idempotency:** snapshots are hash-gated (refetching identical content is a no-op); SourceRecord upserts key on native ID; canonical projection is a pure function of current linked records (re-running changes nothing); notifications dedup on `dedupKey` (Part 10). The whole pipeline can be re-run from snapshots at any time — which is also the parser-improvement path (Part 12).
- **Retries / errors:** per-adapter isolation — an FSIS 403 storm must not stall FDA polling. Bounded retries with backoff inside a run; a failed run is just recorded (IngestRun) and the next scheduled run tries again — at 30–60 min cadence, sophisticated retry orchestration is unnecessary. A record that fails parsing is quarantined _with its snapshot retained_ and surfaced in run output — never silently dropped (a parse bug must not hide a recall; the quarantine list is the bug queue).
- **Cursors / checkpoints:** FSIS + FDA listing: none needed — each poll is a full fetch diffed against stored records (simplest correct thing at ~1 MB scale; in-place edits are caught for free). openFDA: `report_date` checkpoint + monthly full sync.
- **Deduplication:** by source-native ID at the SourceRecord layer; by reconciliation at the case layer; by dedupKey at the notification layer. Three independent guards.
- **Stale-source detection:** per-adapter freshness alarms from IngestRun history — consecutive failures, schema-shape drift (missing expected keys), and "no new item in N days" horizons set from observed publish rates (FSIS ~1–2/week, FDA food ~4–6/week ⇒ silence >14 days is an alarm even though it _could_ be legitimate). The fda.gov JSON backend is undocumented (§3.1) and the FSIS fingerprint rules shift (§4.1) — assume feeds _will_ silently break; detection, not prevention, is the defense. Founder additionally subscribes to the iRES keyword emails as an out-of-band canary (§3.3).

### 8.4 Canonical projection precedence

Deterministic per-field precedence when multiple linked records disagree (Part 4 provenance): consumer text (title/summary/action) — newest primary notice (announcement/FSIS record); classification — openFDA/FSIS regulatory record; products — union with per-record provenance; geography — `stated` beats `inferred`, wider _stated_ scope beats narrower on conflict (safety-first: an expansion widening MD,VA → nationwide must win; a _narrowing_ is applied only from an explicit correction, not from record disagreement). Ties resolved by newest source-published date. Precedence rules live in one module and are covered by fixtures.

---

## Part 9 — Material-change model

Two strictly separated layers:

**Layer 1 — source changed** (mechanical): a SourceRecord produced a new snapshot hash, or a new linked record appeared. High-frequency, zero user meaning by itself. Recorded in timeline only.

**Layer 2 — consumer-relevant change** (semantic, deterministic): diff the _canonical consumer projection_ (the Part 4 fields users actually see) before/after re-projection, then classify against a fixed rule table:

| Diff detected                                                                                                                                                                                                      | Verdict                                                                            | Example (from evidence)                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Affected-product set grew, or lot/date-code scope broadened                                                                                                                                                        | **Material — expansion**                                                           | `005-2026-EXP` +33.6M lbs (§7.2); Albertsons "Additional Tuna Salad products" (§7.1) |
| Correction broadening product identification                                                                                                                                                                       | **Material — correction**                                                          | FSIS 2026-03-09 note: lots controlling "regardless of best-by date" (§7.2)           |
| Geography widened (states added / → nationwide)                                                                                                                                                                    | **Material — expansion**                                                           | —                                                                                    |
| Classification assigned or changed — upgrades **and** downgrades (founder correction 2026-08-21)                                                                                                                   | **Material — severity**                                                            | Class I arriving +23 days after announcement (§7.1)                                  |
| Illness statement materially changed (first illnesses reported; deaths/hospitalizations added)                                                                                                                     | **Material — health impact**                                                       | outbreak-linked cases                                                                |
| Consumer action changed in substance ("return" → "destroy, do not open")                                                                                                                                           | **Material — instructions**                                                        | —                                                                                    |
| PHA/notice retracted                                                                                                                                                                                               | **Material — retraction**                                                          | `PHA-04012026-01` (§4.1)                                                             |
| `state` → closed                                                                                                                                                                                                   | Not material (dashboard-visible, no push)                                          | founder rule                                                                         |
| openFDA record arrives matching what we already told users                                                                                                                                                         | Not material                                                                       | founder rule: enrichment ≠ news                                                      |
| Contact info, wording/HTML cleanup, qty_recovered updates, `field_last_modified_date` churn without projection diff, report_date/termination bookkeeping, Spanish record appearing, our own link/unlink operations | Not material                                                                       | §10.7                                                                                |
| Geography _narrowed_, products removed                                                                                                                                                                             | Not material for push; timeline-visible with "scope corrected by [agency]" framing | rare; never silently shrink what users were told without the timeline showing it     |

Every verdict (including "not material") is recorded on the timeline with the causing snapshot IDs — the audit answer to "why did/didn't we notify?". Classification _downgrades_ (I → II/III) are material and notification-eligible like upgrades (founder correction 2026-08-21: any authoritative classification assignment or change is consumer-relevant; earlier versions of this document excluded downgrades). Delivery-rate coalescing (Part 10) may combine messages, but never erases the underlying ledger event.

---

## Part 10 — Notification event model

Delivery infrastructure is out of scope; what we design now is the **eligibility ledger** that makes notifications correct later.

- **Append-only `NotificationEvent`** rows created by the eligibility stage: `(recallCaseId, kind, triggerRuleId, dedupKey, materialChangeRef, createdAt, payloadSummary)`.
- **Exactly-one-initial invariant:** `kind = initial` has `dedupKey = caseId` with a uniqueness guarantee — a case can never alert twice as "new", no matter how many polling cycles, re-projections, snapshots, or reconciliation operations touch it. A case founded by an enforcement-only record and _later_ linked to an announcement does not re-fire (the link is enrichment; the initial already exists on the surviving case, and `mergedInto` tombstones carry history across merges).
- **Material updates:** `kind = material_update` requires a `materialChangeRef` to a Layer-2 material verdict (Part 9); `dedupKey = hash(caseId, changeClass, changeFingerprint)` so the same expansion can't fire twice, while a second _distinct_ expansion can. Rate guard: max one update push per case per 24h — multiple same-day material changes coalesce into one (severity retraction excepted: `retraction` always fires immediately).
- **Timing honesty:** initial notifications include the source-published date; if discovery lagged publication (e.g. a case surfacing from the weekly openFDA sweep, weeks old by then), the notification says "FDA published this in its weekly enforcement report" framing rather than implying it just happened. Eligibility rule: cases older than a staleness horizon at discovery (e.g. publishedAt > 30 days before discovery — backfills, historical imports) get `initial` ledger rows marked `suppressed: backfill`, auditable but never delivered.
- **Auditability:** ledger + materialChangeRef + snapshot IDs = full chain from push text back to raw government bytes.

---

## Part 11 — Dashboard implications (model verification)

Check of each future dashboard need against the model — no UI design here, only "can the model serve it":

| Dashboard need                 | Served by                                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| Current recalls                | `state = active`, tiered by `lastPublicActivityAt` (Part 2.3)                                       |
| Newest recalls                 | `publishedAt` ordering (source-published, not fetch time)                                           |
| Category/source filters        | `sourceAgency`, `noticeType`, `hazardCategory`, `classification`                                    |
| State relevance / "Affects me" | Part 5 value object incl. the unknown-distribution section                                          |
| Severity display               | `classification` with honest `not_yet_classified` rendering                                         |
| Affected product specifics     | `AffectedProduct` rows incl. rawText fallback + "see official notice" empty state                   |
| Official source links          | `officialUrls` (≥1 required) + per-record URLs                                                      |
| Freshness                      | `lastPublicActivityAt`, `lastChangedAt`, global IngestRun "last checked"                            |
| Search                         | title, brands, firm displayName+variants, product rawText, pathogenOrAllergen — all present as text |
| Update history on a card       | `timeline`                                                                                          |

One deliberate UX-over-normalization choice already embedded: preserved _prose_ fields (consumer action, retailer text, illness statement, product rawText) are first-class canonical data, not parse failures — the dashboard renders source words wherever structure is absent, which is both the honest and the more useful behavior given §6.

---

## Part 12 — Raw-source preservation **[DECISION]**

**Retain (append-only, hash-gated — Part 3 SourceSnapshot):**

1. Every FSIS API record JSON, FDA listing JSON item, and openFDA record that created or changed a SourceRecord — new snapshot only on content-hash change. Scale check: ~2,000 FSIS records ≈ 1.7 MB total today (§4.1); openFDA full food dataset is 5.5 MB zipped (§3.2); FDA listing items are ~1 KB each. Years of full history is megabytes — cost is a non-issue, so hash-gating is about noise, not storage.
2. RSS items that triggered discovery (tiny XML fragments; they carry publish times-of-day the listing lacks, §3.1).
3. **Announcement detail-page HTML for every case we alert on**, fetched once at case creation: it holds the photos, UPC-bearing alt text, full press-release body, and both dates (§3.1) — and pages churn/archive within ~3 years (§3.1). This is the one fetch-beyond-the-feed the MVP performs.
4. Ingest-run metadata (already in IngestRun).

**Do not retain in MVP:** label/photo binary files (store URLs; both agencies' assets are stable enough short-term, and fetching FSIS label PDFs requires the summary-HTML URL recovery deferred in §10.2), every-poll page HTML, Spanish records (re-fetchable on demand), iRES/Data Dashboard anything.

**Licensing:** unambiguous — openFDA is CC0 (§3.2); FDA/USDA web content is US-government public domain, USDA requests "U.S. Department of Agriculture" credit (§4.1). Retention, processing, and in-app redistribution are all permitted. Attribution lives on the detail screen as the one prominent official-source link, whose label names the agency ("View the official FDA report" / "View the official FSIS report"); per-card attribution on Home and the separate source-organization line were retired by the P1/P2a presentation contract ([docs/recall-feed-usability.md](recall-feed-usability.md)), which keeps every card one tap from the official government notice.

**Traceability test this must pass:** for any fact on a consumer card, walk `field → provenance/projection rule → SourceRecord → SourceSnapshot → raw bytes + fetch time + source URL`. Every retention choice above exists to keep that chain complete; nothing beyond it is kept.

---

## Part 13 — Implementation boundary: first milestone

**Milestone 1 — "FSIS vertical slice": one source, the full pipeline, real data on the shell app's screen.**

FSIS first because it is one authenticated-by-nothing JSON feed that exercises _every_ pipeline stage — snapshots, in-place edits, expansions (`-EXP` linking), retractions, closures — without needing the FDA reconciliation system at all (§4.1: FSIS is "simultaneously the fast channel, the structured channel, and the lifecycle channel").

Contents:

1. Ingestion core: SourceSnapshot/SourceRecord/RecallCase/AffectedProduct/NotificationEvent stores + the pipeline skeleton (Part 8) with the `fsis_api` adapter. Storage engine chosen at implementation (deliberately unspecified here; the logical model above is storage-agnostic).
2. Canonical projection + lifecycle rules + material-change detection with fixture tests built from _recorded real FSIS payloads_ (e.g. the 005-2026 family, a PHA, a retraction).
3. NotificationEvent ledger writing (no delivery).
4. A minimal read endpoint/JSON the existing Expo shell can render as a first real dashboard list — proving the model serves the UI.
5. Stale-source alarms + quarantine list (cheap now, expensive to retrofit).

**Milestone 2:** `fda_announcements` adapter (discovery + cases, no reconciliation yet — unlinked FDA cases are already correct per Part 6.1). **Milestone 3:** `openfda_enforcement` adapter + reconciliation Tiers 0–2 + the Part 7 benchmark (fixtures built before the matcher). **Milestone 4:** notification delivery.

**Explicitly postponed:** LLM match assist (Tier 3); parsing the _contents_ of FSIS label/product-list PDFs (the PDF **links** are now surfaced from summary HTML — implemented 2026-08-21 as deterministic href extraction, no PDF parsing/OCR; extracting the product rows inside those PDFs is the specifically prioritized follow-up for PHAs whose product list exists only as an attachment); FDA announcement photo harvesting beyond stored HTML; retailer/establishment parsing; outbreak (CORE) enrichment; Spanish localization; iRES API; CPSC/NHTSA; any onboarding/personalization UI; historical backfill beyond each feed's natural window.

**Implementation notes added 2026-08-21 (consumer data-quality pass):**

- **Illness-report semantics** follow the Part 4 three-way rule via a deterministic sentence classifier (`src/domain/illness.ts`): explicit-zero boilerplate → standardized "No illnesses have been reported."; positive reports → the source's own count sentences verbatim; source silence → "No illness count is provided" (never zero). Disease education ("…can cause salmonellosis…"), healthcare advice, and discovery prose ("problem was discovered during surveillance…") are excluded from illness reporting; education may appear separately as "Health risk".
- **Upstream-ingredient notices** (PHAs for FSIS products containing an FDA-recalled ingredient — a recurring family, 21 live records) keep the causal ingredient in the consumer product summary ("…Products Containing Recalled FDA-Regulated Jalapeños"), never collapsing to a bare product-category label; when no single firm represents the notice, the display says "Multiple products and brands" only when the source title states that scope, else "Company not specified" — never a fabricated organization.
- **Consumer feed relevance vs lifecycle** — see the §2.3 correction above.

**Implementation notes added 2026-08-21 (Milestone 2 — FDA announcement discovery):**

- The pipeline core is now source-agnostic (`runSourceIngest`): adapters hand
  it already-normalized records plus raw payloads; FSIS and FDA share
  snapshots, identity upserts, case projection, material-change detection, and
  the notification ledger unchanged. No schema migration was needed — the
  Milestone 1 schema was already source-agnostic.
- **FDA announcement identity (Phase A):** the announcement URL slug with the
  observed update-churn prefixes (`updated-`, `update-`, `updated-release-`)
  stripped; the full path is retained as the raw identity and in
  `officialUrl`/snapshots. This is explicitly the identity of the
  _announcement_, not the eventual enforcement event — Phase B reconciliation
  gets the preserved path, title, firm, dates, and body verbatim to match on.
  Residual risk (accepted): a retitle whose slug truncates differently than
  the original would found a duplicate case — duplicate-but-true, per Part
  1.2's failure-mode ranking.
- **FDA lifecycle in Phase A is always `active`:** the listing JSON exposes no
  closure signal; truthful closure arrives with openFDA reconciliation.
  Announcements are pre-classification (`not_yet_classified`) unless the page
  itself states a class; hazard language never implies one.
- The listing item's `changed` timestamp moves on any page edit, so the
  listing row is the content-hash key and detail pages are fetched only for
  new/changed records; the stored snapshot carries the listing row plus the
  page's `<main>` region (per Part 12.3, extended to every FDA case since the
  body holds distribution/illness/codes needed for the consumer projection).
- RSS is corroborating discovery, never a second identity: an RSS item missing
  from the listing is an operational warning and is ingested from its official
  page (scoped by the page's own Product Type field); one seen in both
  channels is one source record.
- Pet food (listing rows co-tagged `Animal & Veterinary`) is excluded and
  counted, pending an explicit product decision — deferred, not silently
  dropped or included.
- `hazardCategory` gained `chemical_contamination` (lead, Cesium-137 — real
  FDA reason categories with no honest home in the original enum);
  `NormalizedSourceRecord`/`CaseProjection` gained source-structured `brands`,
  `productDescription`, and (normalized-record only) `imageUrls` — fields FDA
  structures but FSIS does not; older persisted rows omit them and readers
  treat absence as unknown.

**Product decisions recorded 2026-08-22 (FDA consumer-UX pass):**

- **The government source is provenance, not required reading.** The app must
  answer "does this apply to me?" itself: package identifiers, distribution,
  instructions, and health context are extracted into the app wherever the
  official source states them in machine-readable form. UX copy never directs
  a user to the official notice as part of the normal task flow; the official
  link remains at the bottom of every case for credibility and verification.
- **Future Home default is "Affects me", with "All recalls" always available.**
  Once user preferences exist (state, allergens, stores — manual input, no
  location APIs, no accounts yet), the default feed organizes by personal
  relevance; the full national feed is never deleted or permanently hidden,
  and unknown-distribution cases surface as their own labeled category per
  Part 5.3. The read model already answers these filters (geography scope and
  states, `pathogenOrAllergen` → canonical allergen tokens via
  `domain/hazard.normalizedAllergenTokens`, source-stated
  `projection.retailerNames`); `lib/relevance.ts` proves the matching
  semantics without any stored preferences or fake badges.
- **Company, brand, and retailer are three distinct consumer roles.**
  `recallingFirm` (who recalled), `brands` (what the package says), and
  `retailerNames` (where the source says it was sold — deterministic
  extraction from sold-at/shipped-to/distributed-to constructions in
  `domain/retailer.ts`, never inferred from retail footprints). Since C3.1
  `projectCase` owns the field via `domain/retailer-evidence.ts`, so FDA and
  FSIS derive it identically with no adapter-specific retailer system, and a
  re-projection recomputes rather than erases it. Only the verb-gated
  sentence seam may populate it: the display layer additionally reads source
  tables and block store lists, which a live census showed carry product
  rows, barcodes, addresses, and column headings — safe to show beside the
  official source, not safe to persist as the claim push notifications match
  on. Projections that predate the field omit the key; the display layer
  re-derives from preserved source text, and `npm run backfill:retailers`
  repairs the stored value without re-ingestion.
- **Package identification is progressive.** "Check your package" shows a
  recognizable summary (product, brand, package description) with identifiers
  (UPCs, lots, date codes, on-package locations — extracted at display time
  by `lib/package-check.ts` from structured product lines plus label-driven
  prose patterns) behind an explicit "Do you have this product?" expansion.
  Lot-specific detail never appears in the always-visible consumer action.
  Benchmark telemetry distinguishes "source states no identifiers" from
  "parser missed stated identifiers".
- **Classification pending is an intentional state.** Cards carry a risk
  badge only when a tier is rated; the detail page shows "Official FDA
  classification: Not yet assigned" with a one-line explanation. The hazard
  line ("Possible E. coli contamination", "Undeclared soy allergen" —
  standardized casing over the structured hazard slots) is the prominent risk
  information until an official classification arrives.
- **Health risk is template-built.** 1–2 sentence deterministic hazard-family
  templates (pathogens, allergens, foreign material, chemical agents) replace
  source-prose education excerpts; when no safe template exists the section is
  omitted. Illness-report semantics are unchanged and never contaminated by
  education text.

**Consumer Projection V2 (2026-08-22): a semantic layer between source data and UI.**

Manual review kept finding a different defect on every recall inspected, and the
common cause was architectural: the app was rendering _source shapes_ (an FDA
table column, a press-release heading) instead of _consumer concepts_. V2 adds
the missing layer:

```
source data → parsed facts → consumer concepts → UI
```

- **Concept routing** (`src/lib/consumer-concepts.ts`): every extracted fact is
  routed into one of our concepts (variant, package size, packaging, package
  color, best/use/sell-by, expiration, barcode, lot, case code, establishment
  number, identifier location, distribution, brand, company, quantity). Source
  headings never become UI sections: `Intended use` / `Condition` / `Shelf life`
  route to deliberately-not-displayed concepts, and `See Image Below` routes to
  `layout_artifact`, which is dropped everywhere. Unmatched labels become
  `unknown` rather than being guessed.
- **Table orientation detection** (`src/lib/source-tables.ts`): FDA publishes
  both standard tables (header row, one variant per row) and **transposed**
  tables (field labels down the first column, one variant per column — Grand
  Central Bakery). Misreading the transposed form is what produced the
  "product name repeated before every value" defect, because row labels were
  mistaken for product names. Orientation is now detected explicitly, colspan
  values are applied to every variant they cover, and each variant carries its
  own facts.
- **Grid reconstruction before meaning**: `rowspan` cells are expanded into
  their real grid positions before any cell is labelled (a barcode spanning
  five lot rows otherwise slides every later row left, presenting each row's
  LOT number as a barcode), header cells that carry their own value
  (`BEST IF USED BY 09/23/2023` over a column of codes) are split so the codes
  beneath are not labelled as dates, and a repeated sub-heading row
  (`Affected Lot Codes:`) labels the block under it.
- **Aggregation and dedup**: repeated values collapse into one concept row
  (`Net weight: 12 oz, 20 oz`), layout artifacts (`None`, `No Packaging`) are
  dropped, and grouping is by **canonical identity** rather than display
  string, so a date the notice spelled two ways (`2026 AUGUST 31` in a caption,
  `August 31, 2026` in prose) renders once instead of as two dates joined by
  "and". Dates additionally sort chronologically.
- **Prose identifiers** (`src/lib/prose-identifiers.ts`): most announcements use
  no table at all. Label-driven extraction handles the recurring inline shapes,
  including labels split across a line break (`UPC: … Best` / `Before: 2026
AUGUST 31`), value lists, clause-separated values, and barcodes stated in a
  photo caption. Notices that state they carry _no_ codes are recognized as
  honest source silence, never counted as extraction failures.
- **Product photography** (`src/lib/product-photos.ts`): official images are
  primary recognition information and are shown in-app, referenced at their
  authoritative agency URLs (never rehosted), deduplicated, with page furniture
  excluded and code close-ups reserved for the package checker.
- **Progressive package checking**: the checker states what matching means,
  shows a recognizable summary, and keeps identifiers behind "Do you have this
  product?" — with a second disclosure step for large code sets (Outshine: 54
  batch codes with their date pairing preserved). Small sets stay inline.
- **Persistence boundary**: V2 is entirely display-layer, derived from
  `summaryText`/`summaryHtml` already stored with every case, so all 712
  persisted FDA cases improved with **no re-ingestion**. The one exception is
  `heroImageUrl` (a short string for feed-card thumbnails, which cannot carry
  announcement HTML); existing rows simply render without a thumbnail until a
  routine ingest populates it.

**Relationship preservation (2026-08-22, second pass).** Extraction quality was
by then good; what remained was facts losing their _semantic role_ on the way
to the UI. The root cause was structural: `summaryText` flattens the
announcement's own tables into the body, so every table cell was read twice —
once by the table interpreter, which knows which product row it belongs to, and
once by the prose extractor, which does not. The second reading is where
relationships died, and it is what turned one loaf's barcode into a recall-wide
barcode. Prose is now read only outside the tables, and the projection carries
relationships end to end:

- **Evidence-bound facts**: every `SemanticFact` records what supported it
  (`table` / `prose` / `caption` / `legacy`), the authoritative raw value, and
  the `scope` (source row) it belongs to when the source establishes one.
- **Affected versions own their identifiers** (`AffectedVariant`): each version
  keeps its own dates, barcode, size, codes, and photo. A value a version owns
  is never restated as a recall-wide identifier; where ownership is genuinely
  uncertain the value stays at case level rather than being invented onto a
  version. Versions are named from a product column, a photo caption, a
  transposed table's column headers (`Sura Tanmen (Unit)` / `(Case)`), or —
  when rows differ only by brand — the brand.
- **Photos carry identity**: when a table's product cells say only
  "See Image Below" and the row count matches the number of recognizable
  product photos, the agency's own ordering pairs them, and each caption names
  its version and barcode. Elsewhere, a caption naming a product is matched to
  that version by name, most specific first.
- **Code ↔ calendar date**: codes the source printed with their date keep the
  pairing, in every observed shape — dash-separated (`LLA616903 – 30 SEP
2027`), parenthesized (`26192 (07/11/26)`), across a row, and down a column.
  Consumer-facing dates lead with the readable calendar date; the opaque
  printed code stays available beneath it, mapped to that date. Where a Julian
  pack code resolves to the same day as one reading of an ambiguous numeric
  date, the notice has stated the day twice and proved its own ordering — the
  only condition under which such a date is reformatted.
- **Honest labels**: barcode lengths are fixed (8/12/13/14 digits), so a
  source-labelled "UPC" that is not one is shown as a `Product code` rather
  than as something a scanner would recognize. A label longer than six words is
  a product line, not a field name, and never routes by keyword.
- **Distribution hierarchy**: specific geography, then named retailers, then
  ecommerce platforms, then generic channels — composed into one grammatical
  sentence instead of concatenated capitalized fragments
  ("Distributed in Texas and sold at Costco."). Named-store list blocks
  (a heading plus one store per line) are extracted, so twelve Seattle stores
  are no longer compressed into "grocery stores"; long lists sit behind
  "View all retailers" rather than crowding the paragraph. Retailers appear in
  "Where it was sold" only — never repeated in the detail header.
- **Image roles**, not keep/reject: `package_front`, `package_full`,
  `package_back`, `package_label`, `product_only`, `barcode_closeup`,
  `code_closeup`, `other_supporting`, assigned from the source's own alt text,
  published dimensions, filename, and position. A crop counts as a code shot
  only when its caption describes nothing but a code **and** the image is small
  — so a photograph of a package label that happens to include a barcode (the
  only visual the Dairyland Produce jalapeño notice supplies) stays a primary
  recognition image, while Outshine's 172×80 barcode macros move to the package
  checker. Feed thumbnails can only ever be recognition images. Galleries size
  each tile to its published aspect ratio, so a 93×619 bread-bag label does not
  leave most of its tile empty.
- **Shared value formatting**: measurements get their space back (`3oz` →
  `3 oz`) everywhere, through one formatter rather than per-case string fixes;
  codes are exempt by design, since their characters are what a consumer
  compares.

**Standardization (2026-08-22, third pass).** Extraction was by then strong, but
presentation still varied with how each notice happened to phrase things. The
contract is now that the same semantic fact always means the same thing, passes
type validation, uses the same words and format, and appears in the same place —
or is omitted rather than rendered wrongly.

- **Semantic type validation** (`src/lib/fact-types.ts`): a source label says
  what a value is _meant_ to be, not what it is. A shifted column is enough to
  file a net weight under a date heading, and `Use by: 58 oz` is worse than
  showing nothing — a shopper looks for that date, never finds it, and
  concludes they are safe. Every value is now checked against the kind of thing
  its concept promises; rejection removes it from display only, never from the
  preserved source.
- **One date standard**: `February 14, 2026`, from every shape notices print
  (`02/14/2026`, `2/14/26`, `14FEB2026`, `2026 FEBRUARY 14`, ISO). Numeric dates
  read month-first — the convention of every US federal notice — and a first
  component above 12 is rejected rather than guessed. Ranges standardize to
  `July 13–August 11, 2026`, stating the year twice only when it changes.
  Qualifiers are meaning, not formatting, so `through February 27, 2026` becomes
  `Through February 27, 2026` rather than collapsing to a single day. Lists
  split into one date each, sorted; dates sharing a month collapse into
  `July 11, 15, 16, 18, and 22, 2026`.
- **Code location as a model, not a phrase**: surface, position, relationship,
  and appearance are recognized separately and the sentence is composed from
  them, so the same physical arrangement always reads the same way
  (`On the bottom of the package.`, `At the top of the label.`, `On the jar cap,
directly beneath the expiration date.`) instead of being concatenated into
  `Located on at the top of the label`. How a code _looks_ is a second line
  (`Look for: Black printed text.`). Every candidate must name a real surface or
  position and is rejected if it carries recall narrative, a firm address, or a
  cross-reference between versions — the NatureBest regression, where a
  free-text search produced "located in Missouri City, TX … is voluntarily
  recalling products containing", is now structurally impossible. No location is
  better than a wrong one.
- **One location, one place**: a location true of every affected version is
  hoisted and stated once; per-version locations survive only when they
  genuinely differ.
- **Checker images**: the checker already prints each barcode as text, so a
  macro photograph of that barcode is excluded there as it is from the gallery —
  while a package or label photograph that happens to contain a barcode stays.
  Once most versions carry their own picture, no central image repeats one.
- **Distribution describes distribution**: in-store placement ("sold in the
  frozen section") is merchandising and never enters "Where it was sold". A
  specific name supersedes the generic word for the same route, so Amazon is
  named once and "sold at Publix and also through retail stores" loses the
  category Publix already is.
- **Health-risk completeness**: templates are matched against the reason text as
  well as the pathogen field, because the pathogen is frequently null even when
  the notice names the organism outright. A recognized hazard with an approved
  template must always render one.
- **Recall quantity** is read at display time when ingest did not capture it —
  only from an explicit statement, never inferred from a package size, and never
  from a count of illnesses.

**Closed consumer schemas (2026-08-22, fourth pass).** The three passes above
made extraction strong and presentation consistent, but the projection was still
_open_: any source label that routed to a concept could reach the screen through
a generic `label: value` renderer. Across the 160-announcement corpus that
produced **nineteen** different package field labels, including `Details`,
`Item number`, `Case code`, and `Product code` — and, in one record, two hundred
store addresses rendered as a single `Details` row. Every one of those was a
source fact faithfully extracted and then rendered somewhere it did not belong.

The architecture is now:

```
source → broad extraction → typed fact inventory → CLOSED CONSUMER SCHEMA → UI
                                                          ↓
                                          rejected facts stay as provenance
```

- **The app decides the display schema** (`src/lib/consumer-schema.ts`). A
  package card may render exactly nine fields — Best by, Use by, Sell by,
  Expiration, Size, Packaging, Barcode (UPC), Lot code, Batch code — always in
  that order. `PackageField.label` can only come from a closed table, so no
  parser, heading, or table column can introduce a tenth. There is no
  catch-all field and no generic renderer; the UI component accepts
  `PackageField[]`, not arbitrary label/value pairs.
- **One destination per fact.** `CONCEPT_DESTINATION` states where each kind of
  fact is allowed to appear: a recall total only in What happened, geography and
  sellers only in Where it was sold, dates and codes only in Check your package.
  Facts with no approved consumer field (`Item number`, `Case code`, a bare
  `Product code`, `Package color`, `Establishment number`) are preserved,
  classified, and counted — never rendered.
- **Explicit UPCs stay UPCs.** A number the source publishes under a `UPC`
  heading reaches the consumer as `Barcode (UPC)` even when it is shorter than a
  scannable barcode: Publix prints `41415-06453` on the box and Zion Market
  prints `8541200408`, and relabelling either sends a shopper looking for a
  field their package does not carry. Ten digits is the floor, below which the
  number is a lot code a mis-read sentence attached to the word "UPC".
- **The kill switch.** Check your package renders only when a useful approved
  fact survives — a field, a variant photo, or a code set. A bare list of
  product names is not package identification, and an empty section is better
  than a residual blob (25 of 160 FDA records, 34 of 66 FSIS records).
- **Structured distribution.** Where it was sold is now typed concepts —
  area, retailers, retail locations, online platforms, broad channels — with no
  free-text path at all. The old "prefer the source's richer sentence" fallback
  is gone: it was what carried a lot number and a two-week shipping window into
  the answer to "did this reach my store?". The generic shop words
  ("retail stores", "grocery stores", "supermarkets") are absent from the
  approved channel set, so specific retailer evidence can never be compressed
  into them. Store addresses paired with a store name become their own
  disclosure.
- **Complete instructions only.** A source action must actually instruct the
  reader; "Consumers who have purchased Sura Tanmen." falls back to our own
  recommendation rather than rendering a fragment the reader will believe.

**Automated consumer-projection QA** (`src/lib/consumer-qa.ts`, `npm run qa:fda`):
a 160-announcement corpus sampled deterministically across years and hazard
families, audited against invariants encoding every anti-pattern review found —
external-notice referrals, layout artifacts, raw source headings, repeated
product names, duplicate values, distribution inside the package checker, firm
address as distribution, uncollapsed code walls, codes in the action or in
"What happened", malformed sentences, unknown geography becoming nationwide,
illness education counted as reports, missing photos, and source-missing vs
parser-missed identifiers. `src/server/fda/qa-harness.test.ts` keeps critical
violations at zero and caps the documented remainder.

The harness also tests **semantic relationships**, not just extraction: orphan
identifiers (a value the source scoped to one version rendered globally), raw
and normalized spellings of one fact rendered together, placement phrases left
inside identifier values, code↔date pairs split apart, variant relationships
flattened into parallel global lists, values labelled as barcodes that are not,
named retailers or metro geography lost to generic distribution text, code
crops in the primary gallery, useful label images rejected, and feed thumbnails
chosen from a code image.

Alongside it runs a **source → projection completeness report**: every fact the
source supports is classified as retained, normalized, aggregated,
relationship-preserved, intentionally suppressed, or dropped by the projection.
This is a development instrument, not a runtime system, and its purpose is to
make information loss countable rather than something someone has to notice.

Standardization is measured the same way: dates normalized versus raw-format
leaks, semantic type mismatches, code-location candidates shown versus rejected
as unusable, recognized hazards rendering a health-risk template, and stated
recall quantities surfaced versus missed.

**Unresolved risks carried into implementation** (from §9, still open): undocumented fda.gov JSON endpoint stability; FSIS Akamai fingerprint drift; announcement URL churn semantics on updates; FSIS publish→API latency; no SLA anywhere for FDA classification timing. All are mitigated by design (RSS cross-check, fingerprint retries, retitle detection, stale-source alarms, honest not-yet-classified state) — none is eliminated.

**Source semantics and identity (2026-08-22, fifth pass).** The closed schemas
above stay closed; this pass fixed what flows into them and how many cases one
real-world recall produces.

- **One canonical U.S. geography module** (`src/domain/us-geography.ts`): state
  names, postal codes, and a curated city/borough gazetteer, shared by the FDA
  parser, the display projection, the retailer extractor, and QA. Postal codes
  count as states only in geographic shapes — the ", XX" address form or a code
  list after a locality preposition ("throughout MI, MN, and ND") — with every
  listed state retained; "in NE Ohio" never becomes Nebraska, and a code inside
  a product string never becomes a state. Display-time distribution UNIONS the
  persisted geography with the states the notice's own distribution sentences
  name, so parser improvements (and prose that names more states than an FSIS
  structured field) reach stored cases without re-ingestion. A union can only
  widen; stated Nationwide is never second-guessed.
- **A closed distribution entity taxonomy.** Every consumer-visible
  distribution entity is typed as exactly one of state / area / retailer /
  retail location / online platform / channel. Retailer classification requires
  retailer evidence (a sold-at construction with a venue word, a store-list
  heading, a table's Retailer column) — capitalization alone never qualifies,
  and known cities, boroughs, states, and language names are rejected outright.
  City lists after a venue word ("Market of Choice stores in Ashland, Bend, …
  in Oregon") and bare gazetteer-known place lists ("distributed in Brooklyn,
  Queens, Bronx…") are typed as AREAS and render in their own block. The
  retailer → geography relationships the source states ("PCC Markets in
  Washington") are preserved internally as `distribution.coverage` for future
  store personalization.
- **Source-declared product lists are structural** (`src/lib/source-lists.ts`).
  A bullet list under a declaring lead-in ("The affected products include … the
  following formats:") is read like a table: one variant per item, each owning
  the identifiers its own item states (the White Cheddar gift box keeps
  088594-2-1; the 1.6 oz jars keep 088594-7-1), with a lead-in size ("The
  following 4-count tamales") applied to every item.
- **Zero orphan package fields in variant mode.** When versions own identifying
  fields, a case-level value of a kind any version carries either matches a
  version by canonical identity (code lists split into individual codes first)
  or is suppressed as `ambiguous-scope` — it never renders as a loose row below
  the cards. A field kind no version carries may still render once for the
  whole recall.
- **Month/year date granularity.** "05/27" renders as `May 2027` — never given
  an invented day — with canonical identity `month:2027-05` and chronological
  sorting beside full dates. QA counts invented days and holds them at zero.
- **Recall-case identity across FDA re-publications.** FDA's CMS appends a
  slug-collision suffix ("…-health-risk-0") when a revised announcement's title
  slugifies identically. The parser proposes the base slug as a candidate
  parent; the pipeline links the two into ONE case only when the evidence gate
  passes — same firm, same hazard, ≤180 days apart, and ≥0.6 body overlap.
  Title similarity alone is deliberately insufficient: an identical title is
  why the slug collided, and a firm that recalls the same product twice reuses
  its headline (verified live: JFE Franchising cucumbers, two distinct events).
  A rejected candidate founds its own case; a false merge is worse than a
  temporary duplicate. Merged cases keep both source records, the original
  announcement date, the newest content, and an untouched notification ledger;
  the absorbed row is preserved with `merged_into` set and hidden by RLS.
  `npm run qa:duplicates` reports deterministic/review/distinct candidate pairs
  without merging; `npm run reconcile:duplicates` (dry-run by default) performs
  only deterministic, record-level-verified merges.
- **FSIS label PDFs become product visuals** (`src/server/fsis/labels.ts`,
  `npm run labels:fsis:dry` / `labels:fsis`). Official label PDFs are
  rasterized once, server-side (pdfjs + @napi-rs/canvas — no OCR, no models),
  to WebP pages under content-addressed storage keys
  (`fsis-labels/<pdf-sha>/p<n>.webp`), deduplicated per page, capped at six
  pages and 15 MB per document, and recorded in the additive `product_visuals`
  table (migration `20260822120000_product_visuals.sql`, public-read bucket
  `product-visuals`). The app merges them into the ordinary Product Photos
  gallery with role `package_label`; the PDF link remains the provenance
  artifact, and the Check Your Package section still hides itself when no
  approved structured metadata exists — photos and package metadata are
  independent concepts.

**Closed value, identity, and role contracts (2026-08-24, sixth pass).** The
closed FIELD schema held; the remaining drift was in what could fill a field,
name a version, or occupy two roles at once. This pass closes those.

- **A closed variant-identity contract** (`src/lib/variant-identity.ts`),
  enforced where variants are built and audited by QA. A variant name must be
  a product distinction; it can never be a date ("Best by 12/14/2026" —
  Aquafaba's date list read as products), geography ("California" … "Texas" —
  Pounded Yam's distribution list read as products), a code, a field label, a
  serialized source row ("Item name : Birch Benders…" — a property list read
  as four products), a symptom, recall narrative, or a reference to one of the
  notice's own attachments. A row with valid facts but no valid identity attaches its
  facts to the parent product scope; nothing is lost and nothing is invented.
  The "Affected versions:" line renders only with ≥2 valid product names.
- **List ROLE classification before interpretation**
  (`classifyListRole` in `src/lib/source-lists.ts`). A declared list is typed
  as affected products, geography, identifiers, single-product properties,
  shopper instructions, or sellers — from its lead-in noun and its items' own
  shapes — before any item becomes a variant. Geography lists under a distribution lead-in feed the distribution
  states; identifier lists and property lists flow through prose extraction to
  case-level fields (property rows split on "•" bullets, so "Lot code : 5 265
  • Best-If-Used-By date: MAR 24, 2027" is two clean facts).
- **Package field VALUE contracts.** A supported key with an invalid value
  renders nothing: dates require a digit and semantic completeness (a bound
  that dangles — "between November 2028 through" — is rejected outright, while
  a complete year-less marking like "11-28 thru 12-15" stays raw), and
  separator artifacts (bullets, stranded conjunctions) never survive into a
  value. Identifiers inside a supplier-recall reference sentence ("…after
  notification that Rooted in Rare Aquafaba powder … was recalled") belong to
  the OTHER product and are withheld from extraction entirely.
- **One agency-neutral consumer date model** (`src/lib/identifiers.ts`).
  Bounded spans parse as ranges ("between July 20, 2026 and August 17, 2026" →
  `July 20–August 17, 2026`; splitting that on "and" had told egg buyers only
  the two endpoint days were affected), month-granular spans keep month
  granularity at both ends ("November 2028–May 2029"), a range's single stated
  year lends itself to the start, "up to" renders as Through, and the Canadian
  bilingual month symbols on imported product ("2028 FE 04", corroborated by
  the notice's own production date) normalize like any other date. Safe
  textual values flow through one shared renderer (`sentenceCaseValue`), so
  FSIS's "vacuum package" and FDA's "glass jars" both read as consumer copy.
- **Shared package fields, explicitly** (`packageCheck.sharedFields`). In
  variant mode a fact has exactly two legal scopes: a version card, or the
  proven-shared block rendered ABOVE the cards ("Applies to all affected
  versions"). Proof is either unanimity — every version's own row states the
  identical value (all thirty-three egg rows carry `July 20–August 17, 2026`;
  both Aller-C rows carry `May 2027`) — or a scope-less recall-level prose
  statement of a kind no version carries ("Sura Tanmen with lot code
  1226183"). Row-scoped residue is suppressed as `ambiguous-scope`; shared
  scope is never inferred from a fact merely being unassigned, and nothing
  ever renders loosely after the cards.
- **Mutually exclusive distribution roles.** An entity this projection types
  as geography — a state, a city, a metro phrase, a directional region
  ("Southern California") — is thereby excluded from RETAILERS, at both the
  extractor (regions and state-runs fail `isRetailerName`) and the projection
  boundary (a hard filter against the typed geography). Bear Stewart renders
  states + AREAS Southern California/Southern Nevada + RETAILER Target, and
  QA holds every geography∩retailer intersection at zero.
- **Recall lineage beyond slug collisions.** FDA also publishes revisions as
  NEW announcements that declare themselves expansions ("Lidl US Expands
  Recall of Eridanous Shortbread Cookies…"). The parser flags declared
  expansions; the pipeline searches recent records for the parent under a
  stricter gate (`isExpansionOfSameEvent`: expansion wording + same firm +
  same hazard + ≤120 days + UPC overlap or the expansion title naming the
  parent's product + ≥0.45 body overlap) and links only when exactly ONE case
  qualifies — ambiguity founds a separate case for the reconcile flow. Because
  FDA re-dates a base page when editing it, a case's consumer voice prefers an
  expansion-titled record within 30 days of the newest record, so a merged
  case always states the widest declared scope. `qa:duplicates` classifies
  both lineage signals; the reconcile script (dry-run by default) verifies
  each pair at record level before any merge and picks the earlier-founded
  case as survivor for expansion pairs.

**Declared-revision lineage (2026-08-25, seventh pass).** The Momchipz pair
(Exotique Foods) exposed a third verified way FDA republishes one recall
under a new identity: a RETITLED CORRECTION. The slug derives from the
title, so a correction that changes the title moves the announcement to a
fresh URL — "…Due to Undeclared Gluten" (08/19) became "…Due to Undeclared
Wheat" (08/24), the old slug left the listing, and the old URL now
301-redirects to the new one. Neither existing mechanism could see it (no
slug suffix, no expansion wording), so one recall became two cases and TWO
initial notifications. The authoritative in-band signal is FDA's editorial
note opening the new body ("On 8/24/2026, the recalling firm updated their
press release to correctly identify wheat, rather than gluten, as the
allergen." — the same shape opens Hartford Bakery, ByHeart, Tropicale,
H-E-B, and others). `declaresRevision` detects that note in the body's
first 600 characters (the old page's trailing "Link to Updated Press
Release" navigation link never qualifies); `isRevisionOfSameEvent` gates
the link on same firm + same hazard + ≤120 days + an overlapping UPC + body
overlap ≥0.8 — a revision is a near-copy re-publication, and the 0.8 floor
sits decisively above the 0.6 that two distinct events by one firm can
reach on shared boilerplate. The pipeline reuses the declared-expansion
search (link only when exactly one case qualifies), `qa:duplicates` reports
a `declared-revision` lineage count, and the reconcile script accepts the
new gate in its record-level verification. Alongside this, `projectCase`
now selects `pathogenOrAllergen` newest-first instead of input-order-first,
so a merged correction names the corrected allergen deterministically.

**Maintenance backfills (2026-08-25, eighth pass).** Ingestion's hash gate is
a correctness feature — it refuses to re-fetch pages the agency has not
changed — but it means any field the parser learns to extract LATER never
reaches older records. `heroImageUrl` hit this exactly: extraction worked,
yet only 16 of 701 FDA cases carried an image, because only those 17 records
had happened to change since the field was added. The fix is not to weaken
the gate (that would re-crawl the agency for nothing and re-open
material-change detection on unchanged content) but to add an explicit
maintenance path with a much narrower contract than ingestion:

- **Snapshots are the source, not the network.** Every snapshot preserves the
  raw payload its record was parsed from, including the announcement's detail
  HTML (Part 12). Re-running the canonical parser over those archived bytes
  reproduces exactly what ingestion would have produced. Measured live: 714
  FDA records, 0 missing detail HTML, 0 parse failures, **0 network
  requests**. A refetch path was therefore never built — there is no evidence
  it is needed, and an unnecessary crawler is a liability.
- **One canonical extractor.** The backfill calls `parseFdaAnnouncement` and
  reads only its image fields; case-level precedence is delegated to
  `projectCase` itself, so a merged multi-record case resolves its hero the
  way a real re-projection would. No second image parser exists to drift.
- **Minimum write surface.** `normalized.heroImageUrl`/`imageUrls` on the
  record, `projection.heroImageUrl` on the case — timeline, `lastChangedAt`,
  dates, identity, link method, and the notification ledger are all carried
  through untouched. The record is updated alongside the projection on
  purpose: the projection must remain a pure function of its records, or the
  next legitimate re-projection would silently erase the backfilled image.
- **Honest coverage.** Success is coverage among cases that HAVE usable
  imagery, never total/total: 86 of 701 FDA announcements publish no product
  photo at all. Cases whose snapshot could not be read are counted separately
  as _undetermined_ rather than folded into "no photo" — absence of evidence
  is not evidence of absence.

`src/server/fda/image-backfill.ts`, commands `npm run backfill:fda-images:dry`
(also the post-apply verification report) and `npm run backfill:fda-images`.
Two read-only store methods were added for it (`listSourceRecords`,
`getLatestSnapshotPayload`); the ingestion path is unchanged.

**FDA enforcement reconciliation (2026-08-25, Phase B).** Fast FDA
announcements reach consumers weeks before FDA assigns the formal Class
I/II/III (measured: recall-initiation→enforcement-report lag p50 46 days).
Phase B enriches the SAME RecallCase when openFDA's Food Enforcement data
(weekly mirror of FDA's Recall Enterprise System) publishes the official
classification — precision first: a wrong class is worse than "Not yet
assigned" persisting.

- **Source & identity.** openFDA bulk export (one ~5.5 MB zip names the
  whole 29k-record dataset — politer and more mutation-proof than paging
  the query API). `recall_number` is the globally unique record identity;
  `event_id` groups one event's per-product records; both verified against
  the full corpus. Records mutate in place; ingestion is hash-gated.
- **Data model.** Matched enforcement records are ordinary source_records
  (source_system 'openfda_enforcement', native_id = recall_number,
  link_method 'enforcement_match' — one additive CHECK migration) with raw
  payloads preserved as snapshots. `projectCase` partitions notice vs
  enforcement records: enforcement contributes ONLY the classification —
  never the voice, dates, identifiers, firm variants, products, or Home
  ordering. Unmatched enforcement records are not persisted: the corpus is
  re-fetchable, matching is deterministic, and only records that influence
  consumer data need provenance in our store.
- **Matching.** Blocking: cleaned-firm-token prefix equality (absorbs
  measured drift like "The Kroger Co"/"Meijer #816…") + a date window,
  publishedAt−initiation ∈ [−45,+90] days, derived from UPC-confirmed pairs
  (p5=−15, p95=+44) and excluding every measured recurring-product false
  friend (nearest at +229 days; Gold Medal flour reuses UPCs across recalls
  YEARS apart, so firm+UPC without the window is forbidden). Evidence:
  code identity (shared UPC digit runs) accepts outright, several events may
  each accept (expansions span events — Total Nutrition 99317+99072); name
  identity (distinctive product-token agreement ≥0.6, both directions —
  title→description and description→full announcement, ingredient lists
  stripped) accepts only a SOLE qualifying event; two name-qualified events
  stay `ambiguous`, never forced. Match states: unmatched / candidate /
  matched_deterministic / ambiguous. Every accepted match stores
  human-readable evidence + method + matcher version + timestamp inside the
  linked record's normalized payload — "why does this say Class I?" is
  answerable from the row.
- **Benchmark.** 24 labeled real case↔corpus entries
  (src/server/fda-enforcement/fixtures/match-benchmark.json.gz): UPC and
  name positives, multi-product hard positives, multi-event expansions,
  recurring-product negatives, in-window same-firm different-recall
  negatives (Conagra's Birds Eye at d=73, Gellert's artichokes at d=48),
  not-yet-published entries. Measured: precision 1.0 (0 false accepts —
  the hard gate), recall 20/23 labeled truth events; the two misses are a
  body that under-names one of two events (stays candidate) and a genuinely
  inseparable overlapping-product pair (stays ambiguous).
- **Enrichment & notifications.** Accepted matches re-project the case
  (classification is the only diff by construction), append a 'classified'
  timeline entry dated by FDA's center_classification_date, and write
  ledger notifications through the existing dedup keys. Classification
  older than 30 days at attach time is suppressed 'backfill' — the full
  historical backfill plans 394 suppressed vs 6 deliverable notifications,
  no storm. Official reclassifications (record mutated in place) flow
  through classification_upgraded/downgraded and always notify. A
  recall_number already linked to a different case is a reported conflict,
  never re-linked — the 17 events matched by two cases each are exactly the
  unmerged duplicate-review pairs, which stay unclassified until merged.
- **Deliberately out of scope, by decision:** enforcement status/termination
  never drives consumer lifecycle (FDA's own disclaimer calls it untimely);
  enforcement prose never overwrites Phase A consumer projection; and the
  ~7,400 enforcement events with no announcement in our corpus are
  quantified but NOT surfaced as consumer cases (a future bounded task).

**Consumer risk tier vs official classification (2026-08-25).** Phase B made
one thing unavoidable: FDA classifies per affected PRODUCT, so a single
RecallCase can legitimately hold several official classes (measured: 175 of
7,836 openFDA events; 16 of our 400 matched cases). Presenting the most severe
of them as though the whole recall were uniformly Class I states something the
agency did not. The app therefore carries two separate layers.

- **Official classification — source truth, preserved as a SET.**
  `classification.officialClasses` holds every distinct authoritative class,
  most severe first. The scalar `classification.value` stays for single-class
  cases (and for the non-class states), but a MIXED case sets it to
  `multiple_classes`: any reader that assumes one class gets an unmistakable
  value instead of a silently promoted "Class I". A source record still
  carries at most one class; the set is a case-level fact. Projections
  persisted before the set exists derive it from the scalar
  (`officialClassesOf`), so no backfill is required for correct display.
- **Consumer risk tier — derived product semantics, never persisted.**
  Five levels (Critical, High, Moderate, Low, Minimal) plus two non-scale
  states (Pending, Unrated), computed from the class set alone by
  `src/domain/risk-tier.ts`:
  {I}→Critical · {I,II}/{I,III}/{I,II,III}→High · {II}→Moderate ·
  {II,III}→Low · {III}→Minimal · {} with a class still expected→Pending ·
  {} where none is ever expected (FSIS public health alerts)→Unrated.
  This is deliberate interpolation between categorical regulatory classes,
  NOT arithmetic: averaging would let nine Class III products make one
  Class I product look mild. Pure Class I is Critical because EVERY affected
  product carries the most serious class; a mixed set containing Class I is
  High, and the official classes stay visible in the detail view. Nothing
  infers a tier from hazard, pathogen, allergen, illness counts, or our
  Health Risk copy — before an authoritative classification exists, an FDA
  recall is Pending. Because the tier is a pure function of the set, it is
  derived at read time and never stored: a second copy could only drift.
- **Where each appears.** Home cards and the top of Recall Detail lead with
  the consumer tier (badge + "HIGH RISK"), never with a regulatory class.
  The agency's own wording lives deeper in the detail screen ("Official FDA
  classifications — Class I and Class II", with "FDA assigned different
  classifications to different affected products." when mixed). Matcher
  internals — scores, evidence, event_id, recall_number — never reach a
  consumer surface. Risk is never communicated by color alone: every chip
  carries visible text plus a spoken "Risk level: …" label, and the tokens
  live in one place (`RiskColors`, no green anywhere in the scale).
- **Material change compares SETS.** {I,III} → {I,II} keeps the consumer tier
  at High and is still a real regulatory change, so the authoritative class
  set — not the tier, and not the scalar — is what `detectChanges` diffs.
  Single-class transitions keep their existing rule ids and byte-identical
  fingerprints (already-ledgered events cannot re-fire); transitions
  involving a set use `classification_changed`, which claims no direction
  because none is defined between sets. The derived tier never emits an
  event of its own, so one classification transition is always exactly one
  NotificationEvent, and historical suppression is unchanged.

**Affected-product identifier integrity (2026-09-01, P0A).** Extraction and
relationship-preservation were by then sound; what remained were pure
formatting and separator defects that corrupted the identifiers themselves on
the last step to the screen. Four modules each carried their own idea of what
separates two codes, and the disagreements were the bug.

- **One separator policy** (`src/lib/identifier-lists.ts`), used by prose
  extraction, table-cell display, barcode lists, and the collapsed code-set
  builder. Commas, semicolons, ampersands, bullets, newlines and the words
  "and"/"or" separate identifiers; a plus separates only when the source
  spaced it as a connector, so a code containing one is never split through
  the middle. Every part is stripped of the seam it arrived with — Everything
  Sprouts' `LOT# 223, 226, 230, & 233` rendered "223, 226, 230, and & 233"
  because `&` was not a separator anywhere, and the leftover connector became
  part of the fourth code. It now yields four clean codes.
- **A semicolon is a separator, not a terminator.** The prose value grammar
  stopped at the first `;`, so Al'Fez Natural Tahini's
  `BEST BEFORE: "2024 JL 31"; "2024 SE 09"; "2025 MR 27"; "2025 AL 04"` lost
  three of its four markings. A labelled value now continues across semicolons
  while the segments continue the same list — one that opens a new label,
  carries no digit, reads as prose, or states a time ends it — so the sentence
  after a list can never be absorbed into it.
- **Identifiers are strings.** Splitting removes only what is between values.
  Leading zeroes, hyphens, dots, letters, internal spacing and source-stated
  ranges all survive verbatim; no digit grouping is ever applied to an
  identifier (`groupDigits` remains scoped to the recall total, where a
  separator is meaningful). The collapsed code set carries a second shape for
  PERIOD-DELIMITED codes — FSIS publishes "lot code GP.1051.18", "lot code
  2457744.2", "lot code is 2025.6.30", and a shape without the period
  discarded all of them. It is alphanumeric runs joined by single interior
  periods and nothing else, which no decimal quantity with its unit ("Net Wt
  3.2 Oz"), abbreviation inside a phrase ("2507199 Exp. 09/2027"), or clock
  time can satisfy; a telephone number can, and the type gate refuses it.
- **Placement is not identity, and leading prose is not a code.** A labelled
  value that OPENS with a placement word is the notice saying where the code
  is: Middlefield's "Customers can find the lot codes on 8 oz. packets and 5
  lb. loaves located on the side." rendered `Lot code: …, and on 8 oz`, and the
  phrase now reaches the code-location path that owns it ("On the side of the
  package."). Prose at the FRONT of a code is a flattened source row rather
  than a code with noise after it — Moonlight's column-header run ("… Facility
  Code Lot Code") is followed by the row's own cells, and the `4401` in it sits
  under the PLU Sticker column, so emitting it would state a lot the notice
  never gave. A trailing tail is trimmed and the code kept; a leading one is
  refused outright. Before a DATE the same word "on" is only the connector the
  label handed off with ("best by date on 05/2026" is May 2026), so dates strip
  it and codes reject it.
- **A field label never rides inside a value.** "…with a lot code of 22739 and
  date code of 17037" split into `22739` and `date code of 17037`. A part that
  repeats a label is resolved by that label: the SAME kind is noise and is
  removed (`lot code 22740` → `22740`), a DIFFERENT kind is a second labelled
  statement the split tore loose, and it both drops and ends the list — a
  package date and a production code are not lot codes, and everything after
  the label change was stated under the other label. The same defect ran
  through the clause-then-colon grammar, whose guard listed "Best By" but not
  "Best Before" or "Production codes"; both now end the clause, and production
  codes reach their own concept instead of a best-by field. A notice also
  writes its label on either side of the value — "a Best By date of February
  2021" and "a Best By February 2021 date" both occur — so the trailing bare
  noun is dropped, but only when what remains still resolves to a calendar
  date, which is what proves the word was the label's and not the source's.
- **Conservative false-positive rejection** (`src/lib/fact-types.ts`,
  `isTimeOrPhoneFragment` / `hasProseWordRun`). Three named shapes are refused:
  clock times and production time stamps (Valley Meats' "…Use By 01/15/2024,
  and time stamp 1:02:55PM" rendered `Use by: time stamp 1`, because the value
  grammar truncates at the clock's own colon), telephone numbers and
  extensions, and a run of three ordinary lowercase words — the signature of a
  sentence tail a list split carried into a code. A tail that CONTINUES a
  sentence is trimmed and the identifier kept ("615 appears on both the wooden
  box" → `615`); a capitalized run is a proper name and is left alone, because
  Whole Foods' own brand is the number 365 and trimming there would invent a
  lot code out of a product name. The collapsed code set now passes the same
  type gate as every other rendered value — it was the one path that skipped
  it.
- **Variant identity closes over symptoms and narrative.** FDA closes most
  announcements with "Consumers should take the following actions:" over a
  bulleted list, structurally identical to a product list; SunFed's five
  instructions became five version cards. `classifyListRole` now types
  instruction, symptom and seller lists, and `variantIdentityRejection` adds
  `symptom` (a closed vocabulary, matched against the whole name so
  Fever-Tree is untouched), `prose`, and `document-reference` — FSIS hands off
  its product list through a bracketed link run ("[View Labels(PDF only)
  Labels A , Labels B , Labels C ]"), and split on its commas that run became
  version cards named "Labels B" and "Labels C ]". The whole candidate must be
  the reference, so "Label Rouge Chicken" is untouched, and the recall's own
  best-by ranges and stated quantity stay after the cards are refused. When extraction is low-confidence the
  case falls back to the recall-level product wording rather than to garbage,
  and the prose-variant fallback drops its final fragment when its
  300-character bound cut a name mid-way instead of showing a truncated one.

This pass is display-layer only: raw snapshots, canonical projections, and
persistence are unchanged, and it required no migration, backfill, or
re-projection.

**Canonical allergen evidence (2026-09-02, P2d-A).** The recorded FSIS Steak
Burrito PHA (PHA-07292026-01) states its reason plainly — "The product
contains egg, a known allergen, which is not declared on the product label" —
yet `pathogenOrAllergen` was null: the shared extractor's only allergen
construction was `undeclared …<word>` inside one sentence, and FSIS's standard
allergen statement lives in a different sentence from the word "undeclared".
The P2a typed reason derives its allergen solely from the canonical slot, so
the miss propagated identically to Home, Detail, push copy, and — most
important — personalization, where an unnamed allergen is `unidentified` and
can never match an egg preference. The fix is in the one owner:

- **Evidence-gated constructions** in `domain/hazard.ts`
  (`extractAllergenEvidence`): `undeclared <allergen list>` (with the recorded
  "allergen, specifically peanut residue" glue), the FSIS apposition
  `contains <list>, (a) known allergen(s)` (verb-gated on containment wording;
  facility/allergen-control prose and negations like "contains no milk" are
  explicitly refused), and `does not declare <list>`. Only the established
  closed vocabulary is ever collected — an unsupported word (MSG, Yellow 5)
  ends the list and is never guessed into it. Multi-allergen evidence is
  preserved whole ("contains egg and milk, known allergens" →
  `undeclared egg and milk`), in the exact list shape
  `normalizedAllergenTokens` and both display layers already parse.
- **FDA structured evidence stays senior.** `deriveFdaHazard` keeps the
  listing's category tokens first and unions in text evidence only for
  families the category omitted — the recorded Lee K of NY announcement is
  filed under "Crustacean Shellfish" while its official reason is "Milk and
  Shrimp", and milk was silently dropped. `shrimp` joins the token map as a
  `shellfish` alias (FDA's own category for its shrimp recalls). A generic
  allergen category with only non-vocabulary wording keeps the verbatim
  source statement ("Undeclared Carmoisine") exactly as before.
- **Recorded-corpus delta (all 227 records re-run, every change
  source-reviewed):** 18 records change, 0 hazard categories change, 0
  pathogen extractions change, 0 extractions are lost. FSIS: 13 of 15
  allergen-category records went null → named (the "known allergen" family).
  FDA: 5 multi-allergen completions (Lee K of NY, Raw SeaFoods, Troemner,
  Cal Yee, Natural Organics — each verified against the announcement's own
  reason statement). The benchmark now pins a hand-verified allergen ledger
  for every named extraction in the FSIS set.
- **Downstream:** material-change detection has no hazard rule, so a
  corrected value can never generate a notification; relevance and
  Affects-Me semantics are unchanged — the corrected value simply reaches the
  existing `classifyAllergenOnly`/`normalizedAllergenTokens` path, proven by
  benchmark tests from the recorded fixture through parse → projection →
  matching. Feed/cache payload shape is unchanged (string field), so no cache
  schema bump.
- **Persistence:** stored `normalized` records and case projections were
  computed with the old extractor, and the ingest hash gate (see Maintenance
  backfills above) means unchanged sources never re-project. Correcting
  persisted values therefore needs a P2d-B maintenance re-projection in the
  image-backfill mold — re-run the canonical parser over archived snapshots,
  write only `normalized.pathogenOrAllergen` + `projection.pathogenOrAllergen`,
  leave timeline/notifications/dates untouched, dry-run first. **Not executed
  in P2d-A**; no production data was touched. The command is
  `repair:allergens` — see
  [docs/recall-operations.md](recall-operations.md).
- **P2d-B follow-up (2026-09-02).** The first production dry run (read-only,
  accepted) exposed two extractor gaps the recorded corpus never exhibited,
  both fixed in the one owner: (1) "including" now bridges an
  **allergen-governed** list only — "contained undeclared allergens,
  including eggs, milk, and wheat" (verified against the archived production
  snapshot for FSIS 111-2015, whose stored partial value would otherwise have
  regressed to null); without the explicit allergen governor, "including"
  still ends the run, so ordinary ingredient enumerations, facility prose,
  example lists, and negated constructions stay refused. (2) Evidence words
  are deduplicated by **grammatical alias** (singular/plural of one family:
  "peanut"/"peanuts", "tree nut"/"tree nuts"), so two constructions naming
  one allergen no longer produce "undeclared peanut and peanuts"; distinct
  source words that merely share a family ("almonds and walnuts", "shellfish
  and shrimp") are all preserved, and family grouping stays downstream.
  Re-running the complete recorded corpus (226 records): **zero** value or
  category changes from these fixes — they alter only production wordings
  outside the recorded set.

**Canonical hazard-category precedence (2026-09-02, P2e).** P2e-A audited
every record whose stored `hazardCategory` disagreed with its official
notice — the 22 records the P2d-B repair refused as out-of-scope, plus its one
category conflict — and found that only ONE was stale data. The other 21 were
a live parser gap: the derivation trusted FSIS's structured reason enum
exclusively, and FSIS under-reports allergens in it.

- **FSIS structured-reason under-reporting.** 20 notices whose body states the
  standard "The product contains X, a known allergen, which is not declared on
  the product label" carry only `Misbranding`/`Mislabeling` — or an empty
  `field_recall_reason` array — because misbranding is how an undeclared
  allergen is _reported_, not a second hazard. They were filed
  `other_regulatory` or `unknown`, so `classifyAllergenOnly` (which hard-gates
  on `hazardCategory === 'allergen'`) could never match them to an allergen
  preference. **Rule:** a labeling-only or absent reason, plus affirmative
  undeclared-allergen evidence from the one canonical extractor, is an
  allergen recall. Any other stated reason — import, inspection, insanitary,
  processing, contamination — keeps its own category: incidental allergen
  words never displace a stated hazard.
- **Packaging is not foreign-material evidence.** `Product Contamination`
  covers pathogens, foreign matter and, rarely, a mis-filed allergen recall.
  115-2017 is an undeclared-anchovy recall whose only material word is its
  packaging ("9.75-oz. plastic bowls"), and a bare keyword scan filed it
  `foreign_material` — so Detail asserted "Potential plastic contamination.",
  a hazard the source never states. **Rule:** `extractForeignMaterialEvidence`
  in `domain/hazard.ts` is THE foreign-material evidence owner, evidence-gated
  on the same principle as the allergen extractor — a material word counts
  only inside a bounded construction that states it as the contaminant
  ("foreign material, specifically glass", "pieces of glass", "glass
  contamination", "may contain hard plastic", "glass found in product").
  Nothing enumerates packaging nouns; the rule is the inverse, so an unlisted
  container word cannot outrun it. Within `Product Contamination`, supported
  hazards resolve in evidence order — pathogen, then genuine foreign material,
  then chemical — and only with none of them stated may allergen evidence
  resolve the category.
- **One record was genuinely stale.** PHA-07302018-1 (Cyclospora, Caito Foods)
  was ingested 2026-08-21 from working-tree code whose `PATHOGENS` list
  predated Cyclospora; it has a single archived snapshot, and the ingest hash
  gate means an unchanged page is never re-parsed — by design. The current
  parser reads it correctly; only the persisted value was wrong.
- **The display layer consumes the canonical category.** `interpretReason`'s
  `Product Contamination` branch now honours a canonical `allergen` category
  instead of re-deciding from the enum string, and `sniffMaterial` delegates
  to the shared evidence owner. Neither surface can name a material the
  category derivation did not accept as evidence.
- **Recorded-corpus delta (66 FSIS + 160 FDA records re-run, every change
  source-reviewed):** 0 category changes, 0 agent changes, 0 other normalized
  fields changed, and FDA derivation byte-identical. Three consumer reason
  lines change, all correcting the same defect — a material read from
  packaging or from a category label rather than from the hazard: FSIS
  005-2026 and PHA-10092020-01 plastic → **glass** (both state "contaminated
  with foreign material, specifically glass"; both are sold in plastic), and
  FDA Palermo Villa metal → **plastic** (its own title says "Due to Possible
  Plastic Contaminant"; "metal" came from the disjunctive taxonomy label
  "Potential Metal or Chemical Contaminant", which names a category covering
  two possibilities and states neither).
- **Mixed-hazard debt (deferred, explicit).** 083-2016 is excluded from the
  repair. Its primary `other_regulatory` category is correct (produced without
  benefit of inspection), and its editor's note adds _secondary_
  cross-contamination allergens that the canonical extractor correctly
  declines as affirmative evidence. Its stored `undeclared wheat` is a
  truthful-but-incomplete pre-P2d artifact; replacing it with null would lose
  information. Representing several hazard roles on one case needs its own
  model decision and is not part of P2e.
- **Persistence.** As with P2d, stored values were computed by the old parser
  and the hash gate means unchanged sources never re-project, so the
  historical correction is an explicit maintenance operation:
  `repair:hazards` re-runs the canonical adapters over archived snapshots and
  writes only `normalized.hazardCategory`/`pathogenOrAllergen` and the same
  pair inside `projection`, along an approved transition allowlist. The
  generated `recall_cases.hazard_category` column follows the projection JSON
  automatically and is never written directly. Feed/cache payload shape is
  unchanged (enum + string fields), so no cache schema bump — and the C8
  manifest token is a read-time content hash, so corrected rows reach clients
  without `last_changed_at` moving. See
  [docs/recall-operations.md](recall-operations.md).
- **Future material-change policy (deferred, NOT implemented in P2e).** When a
  new or changed authoritative source causes an active case's canonical hazard
  family or named hazard to materially change, that change should be eligible
  for notification. Parser maintenance, backfills, and historical repairs with
  no source change must never create retroactive notifications. `detectChanges`
  has no hazard rule today and was deliberately not modified in P2e-B; adding
  one is its own milestone with its own founder decision.
