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

Every card shows its authoritative date ("Announced Aug 18" / "Updated Mar 9") plus a global "sources last checked" indicator from ingestion run metadata — freshness honesty is part of the trust proposition.

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

| Field                             | Purpose                            | Type/shape                                                                                                           | Req    | Derivation                      | Unknown handling / normalization                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                              | Internal canonical ID              | opaque UUID/ULID                                                                                                     | ✔      | app                             | Never a government number: every external ID is dirty, absent, or late for part of a case's life (§10.9).                                                                                                                                                                                                                                                                                                                                         |
| `sourceAgency`                    | Trust label, filtering, routing    | enum `FDA \| FSIS` (open set)                                                                                        | ✔      | source                          | —                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `noticeType`                      | Recall vs PHA distinction (Part 1) | enum `recall \| public_health_alert`                                                                                 | ✔      | source                          | FDA is always `recall` in MVP (market withdrawals/safety alerts are filtered out at the adapter by product type + reason category where identifiable; see Part 8.2).                                                                                                                                                                                                                                                                              |
| `sourceIdentifiers`               | Traceability, joins, support       | array of `{system, id, url?}`                                                                                        | ✔ (≥1) | source                          | Raw **and** trimmed forms of FSIS numbers (§4.1 dirty-string warning); announcement `path`; openFDA `event_id` + all per-product `recall_number`s (may be empty pre-classification, §3.2).                                                                                                                                                                                                                                                        |
| `title`                           | Card headline                      | string                                                                                                               | ✔      | source, cleaned                 | HTML entities decoded (§4.1); "Updated –/UPDATED:" prefixes stripped for display but kept in raw; recompute from newest primary notice.                                                                                                                                                                                                                                                                                                           |
| `summary`                         | Card body / detail intro           | string (plain text) + `summaryHtml` retained                                                                         | ✔      | source                          | FSIS `field_summary` HTML sanitized to text; FDA announcement excerpt/description. Never paraphrased by us — always source words, possibly truncated with ellipsis.                                                                                                                                                                                                                                                                               |
| `reasonText`                      | "Why recalled" in source words     | string                                                                                                               | ✔      | source                          | e.g. "Products may be contaminated with Listeria monocytogenes."                                                                                                                                                                                                                                                                                                                                                                                  |
| `hazardCategory`                  | Filtering/iconography              | enum `allergen \| microbial_contamination \| foreign_material \| product_integrity \| other_regulatory \| unknown`   | ✔      | app-derived, deterministic      | Mapped from FSIS's 9-value reason enum and FDA's reason category (§6) by a fixed lookup table; anything unmapped → `other_regulatory` or `unknown`, never guessed. Raw source category also kept.                                                                                                                                                                                                                                                 |
| `pathogenOrAllergen`              | Specific agent when stated         | string \| null                                                                                                       | —      | app-extracted                   | Deterministic keyword extraction from reasonText (Listeria, Salmonella, E. coli, undeclared milk…); null = not stated/extracted.                                                                                                                                                                                                                                                                                                                  |
| `classification`                  | Severity as the agency states it   | `{value: class_I \| class_II \| class_III \| not_yet_classified \| not_applicable_pha, classifiedAt?: date, source}` | ✔      | source                          | **`not_yet_classified` is a first-class value**, the normal FDA state for weeks (§7.1) — UI shows "Awaiting FDA classification", never blank, never inferred. FSIS classifies at issuance (§4.1). Class wording is near-identical across agencies (§3.2 vs §4.1) so the shared enum is safe; the agency label is always displayed with it. No invented cross-agency "risk score".                                                                 |
| `state`                           | Lifecycle (Part 2)                 | enum `active \| closed \| retracted`                                                                                 | ✔      | app-derived from source signals | Rules in §2.2; `closedAt` only when a real date exists (FDA terminated flag date-less → `closedAt: null, closedYear?`; FSIS gives year only, §4.1).                                                                                                                                                                                                                                                                                               |
| `publishedAt`                     | When the public was told           | date                                                                                                                 | ✔      | source                          | FDA: FDA Publish Date; FSIS: `field_recall_date`. Drives "Newest".                                                                                                                                                                                                                                                                                                                                                                                |
| `initiatedAt`                     | When firm action began             | date \| null                                                                                                         | —      | source                          | FDA announcement "Company Announcement Date" / openFDA `recall_initiation_date`; null when unstated.                                                                                                                                                                                                                                                                                                                                              |
| `lastPublicActivityAt`            | Recency tiering (Part 2.3)         | date                                                                                                                 | ✔      | app-derived                     | Max of source-published activity dates (publish, expansion, Editor's Note date when parseable, classification, FSIS `field_last_modified_date`). Never our fetch time.                                                                                                                                                                                                                                                                            |
| `lastFetchedAt` / `lastChangedAt` | Freshness honesty, debugging       | timestamps                                                                                                           | ✔      | app                             | From ingest runs / snapshot creation.                                                                                                                                                                                                                                                                                                                                                                                                             |
| `affectedProducts`                | Drill-down, search                 | AffectedProduct[] (≥0)                                                                                               | —      | source + extraction             | Each: `{brand?, name, description?, packageSizes?: string[], upcs?: string[], lotCodes?: string[], dateCodes?: string[], rawText, sourceRecordId, extractionConfidence: stated \| extracted}`. Empty list = "see official notice" (real case: FSIS PHAs with product lists only in PDFs, §4.1) — displayed as such, never hidden. UPC/lot/date arrays are **best-effort extracted from prose** (§6); `stated` only when the source structured it. |
| `brands`                          | Card display, search               | string[]                                                                                                             | —      | source                          | FDA listing `field_brand_name` (HTML stripped) is reliably structured (§6); FSIS brands come from product lines/title (extracted). Empty = unknown, show firm instead.                                                                                                                                                                                                                                                                            |
| `recallingFirm`                   | "Who" on the card                  | `{displayName, rawVariants: string[]}`                                                                               | ✔      | source                          | Keep every observed variant ("Albertsons" + "Albertsons Companies LLC", §7.1); displayName = announcement/FSIS form (consumer-recognizable), not the regulatory form.                                                                                                                                                                                                                                                                             |
| `geography`                       | Part 5                             | see Part 5 value object                                                                                              | ✔      | source + rule-based inference   | Tri-state semantics; **never default unknown → nationwide**.                                                                                                                                                                                                                                                                                                                                                                                      |
| `retailers`                       | "Where sold"                       | `{text: string \| null, names?: string[]}`                                                                           | —      | source prose                    | Prose-only everywhere (§6); MVP stores the text span; per-store lists (FSIS Class I PDFs) deferred. null = not stated.                                                                                                                                                                                                                                                                                                                            |
| `quantity`                        | Scale context                      | `{rawText: string \| null, normalizedLbs?: number}`                                                                  | —      | source                          | `field_qty_recovered`/`product_quantity` are dirty prose ("0 Ibs", §4.1); show rawText, parse number only when unambiguous.                                                                                                                                                                                                                                                                                                                       |
| `illness`                         | Health impact as stated            | `{statementText: string \| null, illnesses?: number, hospitalizations?: number, deaths?: number, asOf?: date}`       | —      | source (+extraction)            | Three-way semantics: `statementText` null = **source silent (unknown)**; text like "No illnesses have been reported" = **explicit none** (shown verbatim); counts filled only when the source states numbers. Counts are usually in outbreak systems, not recall records (§2) — the model must tolerate permanent null.                                                                                                                           |
| `consumerAction`                  | "What should I do"                 | string \| null                                                                                                       | —      | source prose                    | Extracted section of the release ("should not consume… return for refund"); null = show official-link fallback. Never authored by us.                                                                                                                                                                                                                                                                                                             |
| `contact`                         | Firm contact                       | `{text: string \| null}`                                                                                             | —      | source prose                    | FSIS `field_company_media_contact` needs whitespace cleanup (§4.1). Changes are never material (founder rule).                                                                                                                                                                                                                                                                                                                                    |
| `officialUrls`                    | Trust anchor                       | `{primary: url, others: url[]}`                                                                                      | ✔      | source                          | FDA announcement URL / FSIS `field_recall_url` (http→https normalized, §4.1); plus every linked record's URL. Announcement URLs can churn on updates (§9) — keep old + new.                                                                                                                                                                                                                                                                       |
| `media`                           | Photos/labels                      | `{imageUrls: string[], labelPdfUrls: string[]}`                                                                      | —      | source                          | FDA announcement photos exist on detail pages (§3.1, not in the listing JSON — populated only when we fetch detail HTML, Part 12); FSIS labels are PDFs whose URLs must be recovered from summary HTML (§4.1) — MVP stores what's cheaply available, empty arrays otherwise.                                                                                                                                                                      |
| `timeline`                        | Case history for card + audit      | array of `{occurredAt, kind, summary, causedBy}`                                                                     | ✔      | app                             | Kinds: published, expanded, corrected, classified, closed, retracted, linked_enforcement. Powers the detail-view timeline and material-change audit.                                                                                                                                                                                                                                                                                              |

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
| Classification first assigned or upgraded toward Class I                                                                                                                                                           | **Material — severity**                                                            | Class I arriving +23 days after announcement (§7.1)                                  |
| Illness statement materially changed (first illnesses reported; deaths/hospitalizations added)                                                                                                                     | **Material — health impact**                                                       | outbreak-linked cases                                                                |
| Consumer action changed in substance ("return" → "destroy, do not open")                                                                                                                                           | **Material — instructions**                                                        | —                                                                                    |
| PHA/notice retracted                                                                                                                                                                                               | **Material — retraction**                                                          | `PHA-04012026-01` (§4.1)                                                             |
| `state` → closed                                                                                                                                                                                                   | Not material (dashboard-visible, no push)                                          | founder rule                                                                         |
| openFDA record arrives matching what we already told users                                                                                                                                                         | Not material                                                                       | founder rule: enrichment ≠ news                                                      |
| Contact info, wording/HTML cleanup, qty_recovered updates, `field_last_modified_date` churn without projection diff, report_date/termination bookkeeping, Spanish record appearing, our own link/unlink operations | Not material                                                                       | §10.7                                                                                |
| Geography _narrowed_, products removed                                                                                                                                                                             | Not material for push; timeline-visible with "scope corrected by [agency]" framing | rare; never silently shrink what users were told without the timeline showing it     |

Every verdict (including "not material") is recorded on the timeline with the causing snapshot IDs — the audit answer to "why did/didn't we notify?". Classification _downgrades_ (I → II/III) update the card but do not push (no urgent consumer action follows from "less dangerous than stated").

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

**Licensing:** unambiguous — openFDA is CC0 (§3.2); FDA/USDA web content is US-government public domain, USDA requests "U.S. Department of Agriculture" credit (§4.1). Retention, processing, and in-app redistribution are all permitted; the app should show "Source: FDA/USDA" attribution on every card, which we'd want for trust anyway.

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

**Explicitly postponed:** LLM match assist (Tier 3); FSIS label-PDF URL recovery and retail-list PDFs; FDA announcement photo harvesting beyond stored HTML; retailer/establishment parsing; outbreak (CORE) enrichment; Spanish localization; iRES API; CPSC/NHTSA; any onboarding/personalization UI; historical backfill beyond each feed's natural window.

**Unresolved risks carried into implementation** (from §9, still open): undocumented fda.gov JSON endpoint stability; FSIS Akamai fingerprint drift; announcement URL churn semantics on updates; FSIS publish→API latency; no SLA anywhere for FDA classification timing. All are mitigated by design (RSS cross-check, fingerprint retries, retitle detection, stale-source alarms, honest not-yet-classified state) — none is eliminated.
