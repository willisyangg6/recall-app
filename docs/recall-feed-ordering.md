# Feed ordering and the Ready preview: newest first (planning pass, 2026-10-05)

**Status (2026-10-05): the feed ordering is COMMITTED (e6f5e7e, 2858916); the Ready preview
selection is NOT implemented — its decision brief is §17.** Implemented: the shared comparator (`src/lib/recency-order.ts`) in both feeds,
both sections and every filtered view including Location; All recalls' recent/older split on
material activity (D1); the post-full-reload recovery pass (D8, `recoverBehindCursor` in
`src/lib/feed-sync.ts`); and the D9 prerequisite in `src/server/fda-enforcement/enrich.ts`. Not
implemented, by founder direction: Ready's photo/rated-risk selection, the zero-eligible rendering
and the image-failure behavior (§13) — D4 and D5 are **open, not settled**; Ready inherits the shared
order with no layout change. The sections below are the planning record and keep their original
tense. Second planning pass appended 2026-10-05 (§10–§16:
founder approvals, live-versus-baseline evidence, the FSIS photo trace, Ready recommendations, the
pagination proof, the date audit and the updated decision list). This document is the planning record for one
bounded milestone: both feeds sort newest first, severity and preference-match strength leave the
ordering, and the Ready preview selects only recalls it can show well. It replaces the earlier
"recency-led ranking" proposal recorded on 2026-09-28 (see
[recall-personalization.md](recall-personalization.md), "Superseded: recency-led Affects You
ranking"). Runtime code, finalized layouts, production data and dependencies are untouched by this
pass. Every number below was computed read-only over the bundled baseline corpus
(`src/content/baseline-recalls.json`, 64 real cases recorded 2026-10-04 04:13 UTC), with the clock
fixed at the recording time so the recency window is exactly what it was.

## 1. Founder decisions (2026-10-05) — the frozen inputs

- All recalls and Affects You both sort **newest first**.
- Affects You **eligibility is preserved** exactly (`lib/relevance.ts`, C5.2B truth table).
- **Severity and preference-match strength leave the ordering.** No risk tier, no
  allergen-over-retailer, no geography-confidence rung.
- **No** seen/acknowledged model, viewed demotion, critical pins or urgency override.
- Recency means **authoritative announcement or meaningful official-update recency**. Internal
  ingestion, normalization and database-write timestamps never bump a case.
- Ties stay **deterministic**; pagination stays **stable**.
- Ready uses the **same shared ordering**, selects **up to three** matching recalls with a usable
  photo and an assigned risk label, **skips Pending** classifications and photo-less records, and
  keeps the displayed total and the Building count on **all genuine matches**.
- The approved deck, artwork, purchase boundary and fallback presentation stay as they are.
- Filters: one **Filters** button on both feeds opening every supported filter is the intended
  design, deferred to a later mockup pass. Nothing filter-related is built in the ranking pass.
  Discounts stay deferred.

## 2. Current versus proposed behavior, in plain English

### All recalls

| Aspect             | Current (shipped)                                                                                                                                                                                                                                          | Proposed                                                                                                                                                                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recent section     | Ordered by `lastPublicActivityAt` (newest first), then `publishedAt`, then case id (`buildFeedSections`, `lib/feed-relevance.ts`). That date is `max(publishedAt, lastModifiedAt)` across the case's records, so an agency wording edit moves a recall up. | Ordered by **material activity** (`materialActivityAt`: the announcement, or the latest material timeline entry), then `publishedAt`, then case id. A wording edit, HTML fix or `field_last_modified_date` touch no longer moves a recall. The same comparator Affects You uses.   |
| Older section      | Ordered by `publishedAt`, then id.                                                                                                                                                                                                                         | The same one comparator as the recent section (material activity, announcement, id). For a case with no update after announcement the result is identical to today.                                                                                                                |
| Recent/older split | `lastPublicActivityAt` within 60 days.                                                                                                                                                                                                                     | **Decision D1 (recommended):** material activity within 60 days, so one date decides both where a case sits and in which section. Strict tightening: material activity ≤ `lastPublicActivityAt` always (architecture §2.3). Alternative: keep the split on `lastPublicActivityAt`. |
| Location filter    | With a jurisdiction selected, `orderByLocationTiers` sorts location tier → **consumer risk** → inherited date → id (C6.1).                                                                                                                                 | **Decision D2 (recommended):** location tier → inherited newest-first → id. The risk rung is the one remaining severity ordering in the app; removing it makes "no severity in ordering" true everywhere. Filter UI itself is untouched.                                           |

### Affects You

| Aspect     | Current (shipped, C3.2)                                                                                                                                        | Proposed                                                                                                                                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Membership | `evaluatePersonalRelevance(...).affectsMe` (state or nationwide; or unknown geography with an allergen or store signal; allergen-only exclusion applies).      | **Unchanged.**                                                                                                                                                                                                  |
| Order      | Six-level tuple: risk tier → geographic confidence → personal signal (allergen+retailer > allergen > retailer > none) → material activity → announcement → id. | Three-level tuple: **material activity → announcement → id.** Risk, geography confidence and personal signal are no longer compared. A Pending recall announced today sits above a Critical recall from August. |
| Sections   | `affects` (material activity within 60 days) and `older` (beyond), each ranked by the six-level tuple.                                                         | The same two sections and the same window; each ranked by the three-level tuple.                                                                                                                                |
| Card copy  | One activity line, "Announced …" or "Updated …" from the material ledger (P1).                                                                                 | **Unchanged.** The order and the label now read the same date.                                                                                                                                                  |
| Push       | Not part of the delivery decision.                                                                                                                             | **Unchanged.**                                                                                                                                                                                                  |

What a shopper notices: Affects You stops being a fixed wall of the same Class I recalls and
becomes a dated stream. The cost is visible in the tables below: because FDA assigns a class
one to four weeks after announcement, the top of Affects You is mostly **Pending** cards, with the
rated recalls further down.

## 3. The date hierarchy, grounded in the schema and the ledger

### 3.1 The fields

| Field                                          | Where it lives                                                                                                                                                       | What sets it                                                                                                                                                                                                                     | Role in ordering                                                                                                                                 |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `projection.publishedAt`                       | `recall_cases.projection`, mirrored to the generated column `published_at`                                                                                           | The earliest `publishedAt` across the case's voiced source records (`domain/projection.ts`). FDA: the announcement's publish date; FSIS: the notice's date field. Day precision at both agencies.                                | **Seed**: the founding authoritative event.                                                                                                      |
| `timeline[].occurredAt` where `material: true` | `recall_cases.timeline` (JSONB, also on the feed row)                                                                                                                | Stamped by the pipeline with `next.lastPublicActivityAt` at the moment a material rule fires (`server/pipeline.ts`, the re-projection step): the agency's own source-published date for that record set, never the ingest clock. | **The meaningful update**: the latest such date wins when it postdates the announcement.                                                         |
| `projection.lastPublicActivityAt`              | Projection, mirrored to `last_public_activity_at`                                                                                                                    | `max(publishedAt, lastModifiedAt)` across voiced records. `lastModifiedAt` is FDA's listing `changed` datetime or FSIS `field_last_modified_date`. Moves on wording edits, HTML cleanup and bookkeeping.                         | **Demoted**: no longer an ordering key anywhere. Still a true source fact and still part of the sync manifest token.                             |
| `recall_cases.last_changed_at`, `created_at`   | Row columns                                                                                                                                                          | Our write time (`nowIso`), also moved by retailer backfills, image enrichment and repairs.                                                                                                                                       | **Never read.**                                                                                                                                  |
| `notification_events.created_at`               | The ledger                                                                                                                                                           | The pipeline's clock when the event was ledgered.                                                                                                                                                                                | **Never read.** The ledger proves eligibility; the timeline carries the agency date.                                                             |
| Non-material timeline entries                  | `kind: 'source_updated'`, `'closed'`, the founding `'published'` entry (`material: false`), and repair `'corrected'` entries (`material: false`, `repair` block set) | Layer-1 churn, closure, the announcement itself, and governed historical repairs.                                                                                                                                                | **Never bump.** The announcement is counted through `publishedAt`, so seeding rather than counting keeps "founding fact" distinct from "change". |

### 3.2 The comparator

```
materialActivityAt(item) = max(day(publishedAt), day(occurredAt) of every entry with material: true)

order(a, b) =
  materialActivityAt(b) vs materialActivityAt(a)      -- newest first
  then day(b.publishedAt) vs day(a.publishedAt)       -- newest announcement first
  then a.id vs b.id                                   -- ascending; total order
```

`materialActivityAt` already exists (`domain/material-activity.ts`) and already feeds the card's
"Updated …" label and the Affects You window; the proposal makes it the one ordering date as well.
Day-string comparison keeps the order total and correct if a source ever supplies a fuller
timestamp.

### 3.3 "Meaningful official update", exactly

A meaningful update is a timeline entry the pipeline marked `material: true`. Those are produced by
exactly the Layer-2 rules in `domain/material-change.ts` (architecture Part 9), and only by them:

| Rule id                     | Timeline kind    | Fires when                                                                   |
| --------------------------- | ---------------- | ---------------------------------------------------------------------------- |
| `expansion_products`        | `expanded`       | The affected-product set grew (or an FSIS expansion notice joined the case). |
| `expansion_geography`       | `expanded`       | States were added, scope became nationwide, or unknown became known.         |
| `correction_broadened`      | `corrected`      | A notice that named no products now names some.                              |
| `classification_assigned`   | `classified`     | The first official class arrived.                                            |
| `classification_upgraded`   | `classified`     | A single class became more severe.                                           |
| `classification_downgraded` | `classified`     | A single class became less severe.                                           |
| `classification_changed`    | `classified`     | The class set changed with no definable direction.                           |
| `health_impact`             | `source_updated` | The notice first reports illnesses.                                          |
| `instructions_changed`      | `source_updated` | Consumer action changed in substance.                                        |
| `retraction`                | `retracted`      | The notice was retracted.                                                    |

This is the same set that makes a case notification-eligible, so "what moves a recall up" and "what
may notify a shopper" stay one definition. Two ledger facts matter for the proposal:

- A suppressed ledger event (`backfill`, `coalesced`) still has a material timeline entry. Ordering
  reads the entry, not the delivery decision, so an update the agency published still counts as
  recency even when no push was sent.
- `health_impact` and `instructions_changed` entries carry kind `source_updated` but `material:
true`. `materialActivityAt` reads the flag, not the kind, so they bump correctly. Any new reader
  must do the same.

Observed in the baseline: 19 of 64 cases have a material update after announcement; 15 of 64 have
`lastPublicActivityAt` ahead of their material activity (bookkeeping-only movement); 28 of 64 share
their (material activity, announcement) pair with another case, so the id tie-break decides their
relative order. Two ledger quirks, harmless to a `max`, worth knowing: one FSIS case carries three
identical `expansion_geography` entries on one day, and one FDA case's `instructions_changed`
entry is dated the announcement day, so it bumps nothing.

## 4. Before and after, on real fixtures

All rows below are real cases from the bundled baseline (first eight characters of the case id,
truncated title). "ann" is the announcement, "pub-act" is `lastPublicActivityAt`, "upd" is the
material update date when one exists.

### 4.1 All recalls, top of the recent section

Current (by `lastPublicActivityAt`):

| #   | Case                                         | Tier     | ann        | pub-act    | upd        |
| --- | -------------------------------------------- | -------- | ---------- | ---------- | ---------- |
| 1   | 11032eb1 Saint Francis Apizza                | pending  | 2026-10-03 | 2026-10-03 |            |
| 2   | 12a737d7 EAK Distribution HOME GROWN sprouts | pending  | 2026-10-02 | 2026-10-02 |            |
| 3   | 2236fa01 Stewart's Shops                     | pending  | 2026-10-02 | 2026-10-02 |            |
| 4   | 329426e0 WinCo Foods                         | pending  | 2026-10-02 | 2026-10-02 |            |
| 5   | 6fcdc02c Inexport Logistics pork             | critical | 2026-10-02 | 2026-10-02 |            |
| 6   | cf595654 Frutas y Hortalizas (expansion)     | pending  | 2026-10-02 | 2026-10-02 |            |
| 7   | 958e02ad Frutas y Hortalizas (earlier case)  | critical | 2026-09-03 | 2026-10-02 | 2026-09-16 |
| 8   | 3ace62ab Gias Foods Bettergoods              | pending  | 2026-10-01 | 2026-10-01 |            |
| 9   | 31023a06 Gias Foods Bettergoods (first)      | pending  | 2026-09-15 | 2026-10-01 |            |
| 10  | 46d449b7 Sierra Nevada Cheese                | pending  | 2026-09-29 | 2026-09-30 |            |
| 11  | e96bf01c Prime Line / Ferrarini              | critical | 2026-09-06 | 2026-09-29 |            |
| 12  | ef0c3d01 Star Meat Delivery                  | critical | 2026-09-22 | 2026-09-28 |            |
| 13  | 803abb50 G. L. Mezzetta                      | pending  | 2026-09-26 | 2026-09-26 |            |
| 14  | 0f9eee46 Sempio Food Services                | critical | 2026-09-25 | 2026-09-25 |            |
| 15  | 9632ad5f Fontanini Foods                     | critical | 2026-09-25 | 2026-09-25 |            |

Proposed (by material activity, announcement, id):

| #   | Case                                         | Tier     | ann        | pub-act    | upd |
| --- | -------------------------------------------- | -------- | ---------- | ---------- | --- |
| 1   | 11032eb1 Saint Francis Apizza                | pending  | 2026-10-03 | 2026-10-03 |     |
| 2   | 12a737d7 EAK Distribution HOME GROWN sprouts | pending  | 2026-10-02 | 2026-10-02 |     |
| 3   | 2236fa01 Stewart's Shops                     | pending  | 2026-10-02 | 2026-10-02 |     |
| 4   | 329426e0 WinCo Foods                         | pending  | 2026-10-02 | 2026-10-02 |     |
| 5   | 6fcdc02c Inexport Logistics pork             | critical | 2026-10-02 | 2026-10-02 |     |
| 6   | cf595654 Frutas y Hortalizas (expansion)     | pending  | 2026-10-02 | 2026-10-02 |     |
| 7   | 3ace62ab Gias Foods Bettergoods              | pending  | 2026-10-01 | 2026-10-01 |     |
| 8   | 46d449b7 Sierra Nevada Cheese                | pending  | 2026-09-29 | 2026-09-30 |     |
| 9   | 803abb50 G. L. Mezzetta                      | pending  | 2026-09-26 | 2026-09-26 |     |
| 10  | 0f9eee46 Sempio Food Services                | critical | 2026-09-25 | 2026-09-25 |     |
| 11  | 9632ad5f Fontanini Foods                     | critical | 2026-09-25 | 2026-09-25 |     |
| 12  | 62c123cf Galil Importing cinnamon            | pending  | 2026-09-24 | 2026-09-24 |     |
| 13  | 9d7d4167 Deano's Pasta                       | pending  | 2026-09-24 | 2026-09-24 |     |
| 14  | 02593a77 Berlin Seeds                        | pending  | 2026-09-23 | 2026-09-23 |     |
| 15  | 457779d5 Wakefern Food Corp.                 | pending  | 2026-09-22 | 2026-09-22 |     |

Four of the current top fifteen leave it (958e02ad, 31023a06, e96bf01c, ef0c3d01): each was lifted
only by a source edit after its last authoritative event. Four announced-in-September cases take
their places. Rows 1–6 are identical, and every (material, announced) tie resolves the same way on
every device because the id decides it.

### 4.2 Affects You, the 2026-10-01 trace profile (Alabama + Arizona · peanuts, milk · Aldi)

23 current matches, no older tail (the baseline is within-window by construction).

| #   | Current (risk → geography → signal → dates)           | Proposed (newest first)                            |
| --- | ----------------------------------------------------- | -------------------------------------------------- |
| 1   | 6518e1ac Khong Guan · critical · allergen · upd 08-21 | 12a737d7 EAK Distribution · pending · ann 10-02    |
| 2   | b8aa10f5 Bazzini · critical · allergen · upd 08-12    | 329426e0 WinCo Foods · pending · ann 10-02         |
| 3   | 6fcdc02c Inexport Logistics · critical · ann 10-02    | 6fcdc02c Inexport Logistics · critical · ann 10-02 |
| 4   | ef0c3d01 Star Meat · critical · ann 09-22             | cf595654 Frutas y Hortalizas · pending · ann 10-02 |
| 5   | 958e02ad Frutas y Hortalizas · critical · upd 09-16   | 3ace62ab Gias Foods · pending · ann 10-01          |

The two allergen matches that led the list today (both Class I peanut recalls from May and July,
classified in August) move to the middle of the stream; the Aldi signal matched nothing in this
corpus either way.

### 4.3 Affects You, California only (19 matches)

| #   | Current                                    | Proposed                                |
| --- | ------------------------------------------ | --------------------------------------- |
| 1   | 6fcdc02c Inexport Logistics · critical     | 12a737d7 EAK Distribution · pending     |
| 2   | 9632ad5f Fontanini Foods · critical        | 329426e0 WinCo Foods · pending          |
| 3   | ef0c3d01 Star Meat · critical              | 6fcdc02c Inexport Logistics · critical  |
| 4   | 7a9159b7 Foods Alive Moringa · critical    | 3ace62ab Gias Foods · pending           |
| 5   | e96bf01c Prime Line / Ferrarini · critical | 46d449b7 Sierra Nevada Cheese · pending |

### 4.4 Affects You, New York · milk, sesame (28 matches)

| #   | Current                                             | Proposed                                |
| --- | --------------------------------------------------- | --------------------------------------- |
| 1   | 0f9eee46 Sempio · critical                          | 12a737d7 EAK Distribution · pending     |
| 2   | ef0c3d01 Star Meat · critical                       | 2236fa01 Stewart's Shops · pending      |
| 3   | 9ab55e38 El Eden · critical · upd 09-17             | cf595654 Frutas y Hortalizas · pending  |
| 4   | 25c1db15 Taylor Fresh · critical · upd 09-15        | 3ace62ab Gias Foods · pending           |
| 5   | 7a9159b7 Foods Alive Moringa · critical · upd 09-11 | 46d449b7 Sierra Nevada Cheese · pending |

## 5. Ready preview eligibility

### 5.1 The proposed rule

```
matches   = affectsYouMatches(corpus, prefs)        -- unchanged: Affects You current window
total     = matches.length                            -- displayed total AND the Building count
eligible  = matches (in shared order) where
              heroImageUrl !== null                   -- a usable official product photo
              and tier ∈ {critical, very_high, high, moderate, low}   -- an assigned risk label
cards     = eligible[0..3)
locked    = eligible[3] ?? null                       -- the real next previewable match
strip     = total > cards.length                      -- unchanged: more genuine matches exist
```

`heroImageUrl` is the only card-level photo the feed row carries; it is an agency-hosted photo by
construction (`lib/hero-provenance.ts`; FSIS label renders are never heroes under the frozen
imagery policy). Pending is excluded by founder decision; Unknown is **Decision D3** below.

### 5.2 Counts for representative profiles (baseline, 2026-10-04)

| Profile                        | Matches (total, Building count) | Preview-eligible | Pending | No photo (of which rated) | Deck under the proposal                                           |
| ------------------------------ | ------------------------------- | ---------------- | ------- | ------------------------- | ----------------------------------------------------------------- |
| AL + AZ · peanuts, milk · Aldi | 23                              | 7                | 11      | 6 (4)                     | 958e02ad, 25c1db15, 7a9159b7; locked 6c54040d                     |
| CA                             | 19                              | **3**            | 9       | 7 (6)                     | 7a9159b7, 6c54040d, 080dedcf; **no locked card**, strip shows     |
| NY · milk, sesame              | 28                              | 8                | 13      | 8 (6)                     | bc2cb630 (high), 25c1db15, 7a9159b7; locked 4e2cb847 (moderate)   |
| TX · Walmart                   | 26                              | 5                | 14      | 8 (6)                     | 958e02ad, 25c1db15, 7a9159b7; locked 6c54040d                     |
| WA                             | 17                              | 4                | 9       | 4 (3)                     | 7a9159b7, 6c54040d, 080dedcf; locked 2237e14f (high)              |
| HI                             | 13                              | **3**            | 6       | 4 (3)                     | 7a9159b7, 6c54040d, 080dedcf; **no locked card**, strip shows     |
| WY                             | 14                              | **3**            | 7       | 4 (3)                     | 7a9159b7, 6c54040d, 080dedcf; **no locked card**, strip shows     |
| DC                             | 15                              | 4                | 7       | 4 (3)                     | 7a9159b7, 6c54040d, 080dedcf; locked d594c275                     |
| MI · egg                       | 22                              | 6                | 9       | 7 (6)                     | 958e02ad, 25c1db15, 7a9159b7; locked 6c54040d                     |
| no state · peanuts only        | 2                               | **2**            | 0       | 0                         | 6518e1ac, b8aa10f5; **fewer than three**, no strip                |
| no state · Costco only         | 1                               | **0**            | 1       | 0                         | **nothing previewable** while the count says one recall was found |

**Fewer than three eligible previews**, explicitly:

- Peanuts only (no state): 2 of 2 matches preview; two cards, no locked card, no strip. Today's
  rendering for one or two matches already covers this.
- Costco only (no state): 1 match, 0 previewable. The count line would read one recall while the
  deck has nothing to draw. Today the preview has only `checking`, `none` (zero matches) and
  `matches`; a fourth situation now exists and needs a decision (D5).
- CA, HI, WY: exactly 3 eligible of 13–19 matches. Three cards, no locked card, and the strip
  still shows because more genuine matches exist. `hasLockedMatches` already keys on the total, so
  the strip-without-locked-card combination is reachable today in code; it has never been
  rendered and needs a visual check in implementation.

**What the counts reveal about the deck** (for review, not a recommendation to change the
decisions): the baseline has 54 FDA and 10 FSIS cases. All 10 FSIS recalls lack a photo, so every
FSIS Class I recall is excluded. 35 of the 54 FDA cases are Pending because FDA classifies weeks
after announcement. Only 16 of 64 cases (12 Critical, 3 High, 1 Moderate) are previewable at all.
The result is that the deck for most state-only profiles is the same three August FDA Class I
recalls (Moringa Leaf Powder, Hampton Grocers, Food to Live green powder) while the feed above
shows October recalls. The preview is systematically older than the top of the feed it previews.

### 5.3 Pending versus Unknown — flagged, not merged (Decision D3)

They are distinct states today and the proposal keeps them distinct:

| State       | Classification value                                                                                                                                            | Meaning                                                                                           | Badge today                                                                                                | Live evidence                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Pending** | `not_yet_classified` (exactly one value)                                                                                                                        | The agency has not assigned a class **yet**; an answer is coming. FDA recalls sit here for weeks. | `PENDING`, with the note "The agency assigns a formal recall classification later in its process."         | 35 of 64 baseline cases.                                                  |
| **Unknown** | `not_applicable_pha` (a Public Health Alert, which never receives a class); a legacy `multiple_classes` scalar with no `officialClasses`; any unsupported value | This app **cannot determine** a supported class, and nothing is coming.                           | `UNKNOWN` for a recall; **no badge at all** for a PHA (`riskLabelSuppressed`), Detail says "Not assigned". | 1 PHA in the baseline (no photo). P2B7N measured 0 non-PHA Unknowns live. |

The founder decision names Pending only. The question for D3 is whether "assigned risk label"
admits Unknown:

- A PHA carries **no label** on any surface, so it cannot satisfy "assigned risk label" and is out
  on the words of the decision.
- A non-PHA Unknown shows the word `UNKNOWN`. It is a label, but it is not an assigned risk, and
  the state means the data is unrecoverable, not that a class is late.

**Recommendation:** previewable = the five rated tiers only. Pending and Unknown are both excluded,
for different reasons, and the code says so in two separate checks (never `tier === 'pending' ||
tier === 'unknown'` folded into one "unrated" notion). There is no live example today in either
direction, so the choice costs nothing now and prevents a silent merge later.

## 6. Pagination, offline baseline and shared consumers

**Pagination.** Nothing changes server-side. Since C5.1 the feed is paged by immutable case id and
the client sorts the complete set (`lib/feed-pagination.ts`, `fetchFeedPage` orders by `id.asc`).
The comparator never influences which page a row lands on, so a material update arriving mid-scan
cannot skip or duplicate a row. The index `(state, last_public_activity_at desc, published_at
desc)` is already unused by the app and needs no migration.

**Cache.** `FeedItem` gains no field; `publishedAt` and `timeline` are already on the row. No
`FEED_CACHE_SCHEMA_VERSION` bump. The sync manifest token includes `timeline`, so a new material
entry re-fetches the row and the order follows.

**Offline baseline.** `scripts/record-baseline-recalls.ts` already selects by material activity
within the window; the file is unchanged and is sorted on device by the shared comparator. The
§5.2 decks are what the baseline would show offline on 2026-10-04. The baseline ages one day at a
time; the launch gate (`baselineReadinessFailures`) is untouched.

**Shared consumers that change behavior:**

- `src/app/(tabs)/index.tsx`: both tabs read the new order; the older-section counts follow D1.
- `lib/ready-preview.ts`: `affectsYouMatches` unchanged in meaning (the count); `buildReadyPreview`
  gains the eligibility filter for `models` and `locked`.
- `lib/building-watch.ts`: reads `affectsYouMatches(...).length`, unchanged by construction.
- `lib/feed-filters.ts` `orderByLocationTiers`: drops the risk rung under D2.
- `lib/design-preview.ts` and the design tests (`feed-design.test.ts`,
  `card-presentation-design.test.ts`, `onboarding-design.test.ts`) render ranked samples and will
  re-pin.
- Read-only QA (`qa:personalization`, `qa:feed-completeness`, `qa:product-categories`) print
  `explainAffectsMePriority`; the explanation string shrinks to the two dates.

**Unchanged by construction:** Affects You eligibility and reasons, push eligibility
(`pushEligible`), the card's "Announced / Updated" line, Saved (save order), search, the Risk
filter's seven selectable tiers, `RISK_TIER_RANK`, Detail.

**Tests that pin the current order and must be rewritten, not deleted:** `affects-me-ranking.test.ts`
(risk-first, geography, signal and "strongest case first" cases), `feed-relevance.test.ts` (section
ordering), `ready-preview.test.ts` ("imaged or not" deck cases), the three design tests above.
`ready-count.test.ts` and `feed-sync-equivalence.test.ts` should pass unchanged: the first pins
the count, the second pins determinism.

## 7. Decisions flagged for the founder (first pass; the current list is §16)

| #   | Decision                                                                                                                        | Recommendation                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | All recalls recent/older split: material activity (one date) or keep `lastPublicActivityAt`?                                    | Material activity. One date for position and section; strict tightening; a few quiet cases move to Older.                                                                                                                                       |
| D2  | Location-filter ordering keeps its consumer-risk rung or drops it?                                                              | Drop it in this pass. It is ordering, not filter UI, and it is the last severity ordering in the app.                                                                                                                                           |
| D3  | Does "assigned risk label" admit Unknown?                                                                                       | No. Five rated tiers only; Pending and Unknown excluded by separate, named checks.                                                                                                                                                              |
| D4  | A selected photo fails                                                                                                          | **Revised in §17.4, awaiting founder:** a readable preview needs a LOADED photo; a failed or timed-out candidate reclassifies to its no-photo group; bounded probes, generation-tagged callbacks, session memory, changes applied only at rest. |
| D5  | Matches exist, zero previews qualify                                                                                            | **Superseded by the priority groups (§17.1):** with one or more genuine matches at least one preview is always readable, so the zero-readable state no longer arises.                                                                           |
| D6  | Accept that the deck lags the feed (§5.2)? The alternative is to relax the photo or Pending rule when fewer than three qualify. | Flagged for awareness; the decisions as given are implementable as-is.                                                                                                                                                                          |

The "strict tightening" claim in D1 was wrong; §14 corrects it.

## 8. Implementation scope (for the next pass, after review)

1. `lib/affects-me-ranking.ts`: replace the six-level tuple with the three-level comparator; keep
   `buildAffectsMeSections`, `priorityById` and `explainAffectsMePriority` shapes stable for callers;
   delete the geography and signal rungs; `RISK_PRIORITY` stays exported only while D2 is open.
2. `lib/feed-relevance.ts`: `buildFeedSections` uses the shared comparator and (D1) the material
   window; `feedTier` reads material activity.
3. `lib/feed-filters.ts`: D2.
4. `lib/ready-preview.ts`: eligibility filter for `models` and `locked`; a `previewable` predicate
   with separate Pending / Unknown / photo checks; the D5 state.
5. Tests rewritten per §6; `npm run check`; `npm run qa:personalization` as the read-only QA.
6. Documentation in the same change: [recall-personalization.md](recall-personalization.md)
   "Affects Me ordering", [recall-feed-usability.md](recall-feed-usability.md) "The one activity
   date", "Filter model" and "Location ordering",
   [recall-domain-architecture.md](recall-domain-architecture.md) §2.3 (All recalls no longer uses
   `lastPublicActivityAt`), [recall-onboarding-and-paywall.md](recall-onboarding-and-paywall.md)
   §6.4 deck bullets, [README.md](../README.md), and this document's status line.

No migration, backfill, repair, dependency, baseline re-record or production action is needed.

## 9. Roadmap (2026-10-05)

1. **This milestone:** newest-first ordering in both feeds and the Ready preview eligibility rule,
   after review of §7.
2. **Feed and filter UI mockups.** One **Filters** button on both feeds (All recalls and Affects
   You) opening every supported filter in one place; no separate risk-only control. Mockups
   first, then implementation.
3. **Card and in-app polish** once the filter design is approved.
4. **Deferred:** paywall back-out discount and any discount product; the seen/acknowledged
   model and anything that depends on it.

## 10. Second pass (2026-10-05): founder approvals

- The comparator in §3.2 (material activity → announcement date → case id) is **approved**, for
  both feeds and **every filtered view, including Location**. D2 is closed: `orderByLocationTiers`
  keeps its location tier and drops the consumer-risk rung; within a tier the inherited
  newest-first order decides.
- Matching eligibility is preserved. No risk priority, seen tracking, viewed demotion or critical
  pins.
- Ready requires a matching recall with a photo **and a confirmed risk label**. Pending and Unknown
  are excluded **separately** (D3 closed as recommended).
- Total matches and the Building count stay independent of preview eligibility.

Still planning only: nothing below changed runtime code.

## 11. Preview eligibility: live feed versus bundled baseline (Q1)

Both runs used the app's own read-only loader (`fetchCurrentFeed`: paged GETs under the
publishable key, the same path the Feed uses) and the same eligibility predicate: a stored hero
photo and a tier in the five rated levels. "Matches" is `affectsYouMatches(...)` and is what the
count line and the Building step show. Candidates are listed in the approved order with their
announcement date and, where one exists, the material update date.

**Offline snapshot** — the bundled baseline, 64 active cases, recorded 2026-10-04 04:13 UTC, clock
fixed at the recording time:

| Profile                       | Matches | Eligible | First three candidates (ann → upd)                                      | Locked 4th          |
| ----------------------------- | ------- | -------- | ----------------------------------------------------------------------- | ------------------- |
| CA                            | 19      | **3**    | 7a9159b7 09-04→09-11; 6c54040d 08-14→08-28; 080dedcf 08-07→08-28        | none                |
| TX                            | 26      | 5        | 958e02ad 09-03→09-16; 25c1db15 08-09→09-15; 7a9159b7 09-04→09-11        | 6c54040d            |
| NY                            | 25      | 6        | bc2cb630 (High) 08-29→09-15; 25c1db15 08-09→09-15; 7a9159b7 09-04→09-11 | 6c54040d            |
| FL                            | 23      | 5        | 958e02ad; 25c1db15; 7a9159b7                                            | 6c54040d            |
| WA                            | 17      | 4        | 7a9159b7; 6c54040d; 080dedcf                                            | 2237e14f (High)     |
| HI                            | 13      | **3**    | 7a9159b7; 6c54040d; 080dedcf                                            | none                |
| WY                            | 14      | **3**    | 7a9159b7; 6c54040d; 080dedcf                                            | none                |
| AL + AZ · peanut, milk · Aldi | 23      | 7        | 958e02ad; 25c1db15; 7a9159b7                                            | 6c54040d            |
| NY · milk, sesame             | 28      | 8        | bc2cb630 (High); 25c1db15; 7a9159b7                                     | 4e2cb847 (Moderate) |
| TX · Walmart                  | 26      | 5        | 958e02ad; 25c1db15; 7a9159b7                                            | 6c54040d            |
| MI · egg                      | 22      | 6        | 958e02ad; 25c1db15; 7a9159b7                                            | 6c54040d            |
| CA · Trader Joe's, Costco     | 19      | **3**    | 7a9159b7; 6c54040d; 080dedcf                                            | none                |
| no state · peanut             | 2       | **2**    | 6518e1ac 07-15→08-21; b8aa10f5 05-27→08-12                              | none                |
| no state · Costco             | 1       | **0**    | —                                                                       | none                |

**Live production feed** — 911 active cases, read 2026-10-05 18:06 UTC (device clock = read time):

| Profile                       | Matches | Older tail | Eligible | First three candidates              | Locked 4th          |
| ----------------------------- | ------- | ---------- | -------- | ----------------------------------- | ------------------- |
| CA                            | 18      | 221        | **3**    | 7a9159b7; 6c54040d; 080dedcf        | none                |
| TX                            | 25      | 211        | 5        | 958e02ad; 25c1db15; 7a9159b7        | 6c54040d            |
| NY                            | 24      | 219        | 6        | bc2cb630 (High); 25c1db15; 7a9159b7 | 6c54040d            |
| FL                            | 22      | 190        | 5        | 958e02ad; 25c1db15; 7a9159b7        | 6c54040d            |
| WA                            | 16      | 185        | 4        | 7a9159b7; 6c54040d; 080dedcf        | 2237e14f (High)     |
| HI                            | 12      | 137        | **3**    | 7a9159b7; 6c54040d; 080dedcf        | none                |
| WY                            | 13      | 152        | **3**    | 7a9159b7; 6c54040d; 080dedcf        | none                |
| AL + AZ · peanut, milk · Aldi | 22      | 256        | 7        | 958e02ad; 25c1db15; 7a9159b7        | 6c54040d            |
| NY · milk, sesame             | 27      | 290        | 8        | bc2cb630 (High); 25c1db15; 7a9159b7 | 4e2cb847 (Moderate) |
| TX · Walmart                  | 25      | 213        | 5        | 958e02ad; 25c1db15; 7a9159b7        | 6c54040d            |
| MI · egg                      | 21      | 211        | 6        | 958e02ad; 25c1db15; 7a9159b7        | 6c54040d            |
| CA · Trader Joe's, Costco     | 18      | 221        | **3**    | 7a9159b7; 6c54040d; 080dedcf        | none                |
| no state · peanut             | 2       | 32         | **2**    | 6518e1ac; b8aa10f5                  | none                |
| no state · Costco             | 1       | 9          | **0**    | —                                   | none                |

Reading the two together: the live corpus is fourteen times the snapshot, yet the first three
candidates are **identical for every profile**, because the eligible set is the same handful of
August FDA Class I and Class II recalls with photos. Live match counts are one lower than the
snapshot for most profiles: a day passed and one case aged out of the window. The live census:
previewable 358 of 911 overall; FSIS 179 cases, **0 with a photo**; FDA 732, 643 with a photo;
Pending 331; Unknown 167 (all FSIS public health alerts, all photo-less). Under the approved
comparator the live top five of All recalls is the same five cases as the snapshot's.

## 12. Why all ten baseline FSIS cases lack photos (Q2)

Traced end to end; this is source plus policy, not a defect, and no substitute image is proposed.

1. **Source.** The FSIS API record (`FsisRawRecord`, `server/fsis/parse.ts`) carries title, number,
   type, classification, risk level, reasons, dates, states, product items, establishment, summary,
   quantity, contact, URL, archive and outbreak fields. **No media or image field exists.** The
   `field_summary` HTML of all ten baseline cases contains zero `<img>` tags. FSIS publishes product
   imagery only as label PDFs linked from the notice page.
2. **Ingestion.** `parseFsisRecord` never sets `heroImageUrl`; only `parseFdaAnnouncement` does, by
   extracting the announcement's own `www.fda.gov/files/…` photographs (`lib/product-photos.ts`).
   Live: 643 of 732 FDA cases carry one; 89 FDA announcements publish no photo, which
   [recall-imagery.md](recall-imagery.md) §10 records as an honest gap.
3. **Projection.** `projectCase` takes the newest voiced record's `heroImageUrl`, so an FSIS case
   projects `null` deterministically. Live: 179 FSIS active cases, 0 heroes.
4. **Label renders exist, and are deliberately not heroes.** Nine of the ten baseline FSIS cases
   have rendered label pages live in `product_visuals` (1–6 pages each, role `package_label`, from
   the official `Recall-0xx-2026-Labels.pdf`); the public health alert has none. The frozen imagery
   policy ([recall-imagery.md](recall-imagery.md) §2, §14) says a label render is never promoted to
   `heroImageUrl`, is rendered on no consumer screen, and `qa:imagery` gates on zero label-render
   heroes in production.

Consequence for Ready, stated plainly: **under the approved rules no FSIS recall can ever be
previewed**, including every Class I meat and poultry recall, and the deck draws only from FDA
recalls that FDA has already classified. Whether the frozen label-render policy should be revisited
for Ready is a founder decision (D7 in §15), outside this milestone.

## 13. Ready: concrete recommendations (Q3)

These compose only elements the founder has already approved — the heading, the count line, the
cards, the dots, the locked card, the locked strip and `See my plan` — and add no copy.

**Matches exist, zero candidates qualify** (live example: Costco only, 1 match, Pending). Render
`Your recall preview`, the count line `We found 1 recall for you.`, **no deck**, then the locked
strip `More matching recalls are locked` (true: one genuine match exists beyond the zero readable
cards) and `See my plan`. `hasLockedMatches` already keys on the total, so the strip needs no new
rule; the only new thing is a preview state with an empty `models` array and `locked: null`, which
the step renders by omitting the deck block. The `none` state stays reserved for zero matches: its
words would be false here.

**One or two qualify** (live example: peanut only, 2 of 2 match). Exactly today's one-or-two-card
rendering: those cards in the approved order, one dot per card, no locked card (a locked card needs
a fourth eligible match) and the strip only when the total exceeds the readable cards. For a
profile such as California (18 matches, 3 eligible) the deck shows three cards, no locked card, and
the strip, a combination the code already allows but no screenshot has shown; the implementation
pass must look at it on the iPhone 17 and SE simulators.

**A candidate's image fails to load.** Selection stays pure: `heroImageUrl !== null` on the stored
row, evaluated when the preview is built, and nothing else. A failure must never re-run selection
while the deck is on screen. Today's mechanics already give most of this: `MediaTile` records the
failed URL in the session memory and re-renders itself to nothing, so the card takes its text-led
shape (the Feed's own P2B7I rule), every card is raised to the deck's tallest measured height and
never shrinks, and the deck's identity (`deckKey`: the card ids and the text size) does not change,
so nothing remounts. What is missing is a guard against the **other** sources of a mid-gesture
change: `buildReadyPreview` is computed on every render of the preview route, so a sync completing
(live corpus replacing the baseline, or a revalidation) or any selection that consulted the failure
memory would hand the carousel new `models`, change `deckKey` and remount the deck in the middle of
a drag, a hard cut the audit already recorded for a sibling screen. Proposed rule, component-level
and small: the carousel owns the items it is showing; new `models`/`locked` props are **held while
a drag is active or a settle animation is running** (`PanResponder` grant → release, then
`Animated.timing` end) and applied at rest, where today's remount happens. The pending deck is
applied once, on settle, never during a gesture. The selection predicate must **not** read
`hasImageFailed` (D4 closed): a failed photo keeps its card for the rest of the session, and the
next time the preview is built from scratch (a fresh mount, a saved preference edit) it is still
chosen, because the stored row still has a photo. That is accepted: it keeps selection
deterministic across devices and testable without a renderer.

## 14. Material dates are agency-published dates (Q5)

| Entry                              | Date written                                                                                                                                                                                                  | Agency-published?                                                                                                                         | Evidence                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Announcement (`publishedAt`)       | FDA: the announcement's publish date; FSIS: `field_recall_date`. Both parsers **throw** when the date is missing or unparseable; the record is not ingested.                                                  | Yes. No clock fallback exists.                                                                                                            | `server/fda/parse.ts`, `server/fsis/parse.ts`                                         |
| Pipeline material entries          | `next.lastPublicActivityAt` at detection: the max of notice `publishedAt` and `lastModifiedAt` (FDA listing `changed`; FSIS `field_last_modified_date`). A null `lastModifiedAt` simply drops out of the max. | Yes.                                                                                                                                      | `server/pipeline.ts`; live: 0 material entries with a time component, 0 non-ISO dates |
| Enforcement classification entries | FDA `center_classification_date`, else `report_date`, else **the ingest day**.                                                                                                                                | Yes in practice: all 384 fixture enforcement records carry both dates. The third fallback is unreachable on real data but exists in code. | `server/fda-enforcement/enrich.ts`; live: 232 cases carry such an entry               |
| Same-day update                    | A material entry dated the announcement day.                                                                                                                                                                  | Yes; `max()` leaves the case on its announcement date and the card keeps "Announced".                                                     | 4 live cases, 2 in the baseline                                                       |
| Material `source_updated` entries  | `health_impact` and `instructions_changed` write kind `source_updated` with `material: true`.                                                                                                                 | Yes (pipeline stamp). Bump correctly because `materialActivityAt` reads the flag, not the kind.                                           | 1 live case (Mezzetta, `instructions_changed`)                                        |
| Non-material entries               | `source_updated`, `closed`, the founding `published` entry: agency dates. Repair `corrected` entries: **our clock**, `material: false`.                                                                       | Irrelevant to ordering; never read.                                                                                                       | `server/historical-rederivation.ts`                                                   |

**One documented invariant is false and must be corrected at implementation.** The architecture
(§2.3), [recall-personalization.md](recall-personalization.md) and the header of
`domain/material-activity.ts` all state that material activity is always ≤ `lastPublicActivityAt`,
so the Affects You window is a "strict tightening" of All's. It is not: enforcement classification
entries are dated by FDA's classification date, while `lastPublicActivityAt` is computed over
notice records only (enforcement records "never supply the dates"). Live, **232 of 911** active
cases have material activity **after** their `lastPublicActivityAt`, every one a
`classification_assigned` entry; the baseline shows 16 of 64. This strengthens D1: with All split on
`lastPublicActivityAt` and Affects You on material activity, a recall announced 70 days ago and
classified last week would be Older in All and current in Affects You. One date for both (D1 as
recommended) removes the contradiction. The three documents are rewritten in the implementation
change.

## 15. Newest-first pagination, end to end (Q4)

**What is loaded before the client sorts.** A cold start runs `syncFeed`: the complete manifest
(id → version token, paged by id, complete or throw), then, with an empty cache, a full reload
through `loadAllPages(fetchFeedPage)`: `state=eq.active`, `order=id.asc`, 500 rows per request,
cursor `id > last`, until a short page. Only then does the client sort the whole set. Ids are
random uuids, so id order says nothing about recency, and the server never orders by date.

**Can a newer case be omitted?** Yes, in one narrow way, and stable ids do not prevent it. A case
founded by ingestion **while the scan is running** whose uuid sorts **before the cursor** is behind
the scan and is not in the cold result. Demonstrated with the real `loadAllPages` over a scripted
1,200-row server: a case announced today inserted between page 1 and page 2 with a lower id was
absent from the 1,200-row cold result, and the newest-first top card was a case from August. A case
whose uuid sorts after the cursor is picked up by the scan as usual, and a case that lands between
the manifest request and the full reload is stored with a `null` token and re-verified next sync.

**Does it arrive late?** Yes, bounded. The manifest is a complete snapshot of consumer-visible ids,
so the next reconciliation lists the missed id as not cached and fetches it by id. Demonstrated with
the real `syncFeed`: sync 1 (empty cache) committed the 1,200 cold rows; sync 2 ran incremental,
downloaded exactly one row, and the newest-first top card became the new case. In the app that next
reconciliation is a pull-to-refresh, a return to the foreground after 15 minutes
(`FOREGROUND_REVALIDATE_AFTER_MINUTES`), or the next launch. Ingestion runs every 30 minutes, the
scan takes about a second, and the uuid has to sort behind the cursor, so the window is small; its
cost under newest-first is that the one missing card is the one that belongs at the very top.

**Correction.** No change to the loader or the cursor: keyset paging on the immutable id is still
the only design that cannot skip or duplicate under 30-minute rewrites. The specified correction is
to the **reconciliation after a full reload**: when a sync took the full-reload path, run one
manifest reconciliation immediately after it commits (one request of roughly 100 bytes per case,
about 90 KB today), which the engine already dedupes by id. This closes the mid-scan window on cold
start at negligible cost; the incremental path is already closed by the manifest. Recorded as D8; it
is optional, and the bound above holds without it.

## 16. Updated decision list

| #   | Decision                                                                        | Status after the second pass                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | All recalls recent/older split on material activity                             | **Approved and IMPLEMENTED 2026-10-05** (`buildFeedSections`, `feedTier`). §14 showed the two-date model contradictory on 232 live cases.                                                                                                                                            |
| D2  | Location-filter ordering drops the risk rung                                    | **Closed by founder, IMPLEMENTED — and widened in review:** the location tier went too. `orderByLocationTiers` is deleted; a filtered view keeps the sections' shared order, so a newer nationwide recall precedes an older explicit state match. Location eligibility is unchanged. |
| D3  | Unknown excluded from previews, separately from Pending                         | **Closed** by founder; the Ready selection itself is not implemented (deferred with D4/D5).                                                                                                                                                                                          |
| D4  | Photo usability keyed on the stored hero URL only; deck changes applied at rest | **OPEN — not approved.** Founder direction 2026-10-05: image-failure behavior is not approved and D4 is not settled. §13 is a proposal only.                                                                                                                                         |
| D5  | Matches but none previewable                                                    | **OPEN — not approved.** Founder direction 2026-10-05: the zero-eligible rendering is not approved and D5 is not settled. §13 is a proposal only.                                                                                                                                    |
| D6  | The deck lags the feed                                                          | **Quantified live** (§11): the same three August FDA recalls lead every state-only profile; left as awareness.                                                                                                                                                                       |
| D7  | FSIS label visuals as preview images                                            | **No (kept for this milestone):** documents, not product photos; the frozen policy stays; FSIS recalls now enter the deck as rated-without-photo cards instead.                                                                                                                      |
| D8  | One manifest reconciliation immediately after a cold full reload                | **Approved and IMPLEMENTED 2026-10-05** (`recoverBehindCursor`, `src/lib/feed-sync.ts`; [recall-feed-sync.md](recall-feed-sync.md) §3b step 5).                                                                                                                                      |
| D9  | Close the ingest-day fallback for enforcement classification dates              | **IMPLEMENTED as the prerequisite change** (`src/server/fda-enforcement/enrich.ts`): no FDA date → the case's `lastPublicActivityAt`, never the ingest day. Not deployed.                                                                                                            |

## 17. Ready preview decision brief, revised (2026-10-05, after commits e6f5e7e and 2858916)

**Status: IMPLEMENTED 2026-10-05 (uncommitted), awaiting review.** The selection in §17.1, the photo
loading in §17.4 and the at-rest rule are now the shipped code: `lib/ready-preview.ts`
(`priorityGroup`, `selectReadyMatches`, `photoCandidates`, photo knowledge on
`buildReadyPreview`), `lib/photo-probe.ts` and `lib/ready-photo-session.ts` (the bounded probe
and the per-screen session), `hooks/use-ready-preview.ts` (one session per corpus and
preferences, as an external store), `components/onboarding/ready-carousel.tsx` (busy reporting
and the shown photo's failure) and `components/onboarding/preview-step.tsx` (the held preview).
Unknown and public health alerts sit after the four groups as recommended (option A, §17.3), never
relabeled. The authoritative description now lives in
[recall-onboarding-and-paywall.md](recall-onboarding-and-paywall.md) §6.4; the sections below are
the decision record. This revision replaced the earlier strict photo-and-rated rule and the
locked-only proposal. The founder's direction: fill three
readable previews whenever at least three genuine Affects You matches exist, selecting by priority
group; never borrow a non-matching recall or inflate the count; show every match when fewer than
three exist; add the existing locked fourth page only when genuine matches remain beyond the
readable previews; preserve the count, board, purchase boundary and approved deck styling; keep
FSIS label pages excluded. Captures, the record list and a comparison sheet are in
`~/Desktop/Lotly-Feed-Ordering-Staging/evidence/ready-review/`.

### 17.1 The rule under review

```
matches   = affectsYouMatches(corpus, prefs)        -- unchanged; shared newest-first order
total     = matches.length                            -- the count line AND the Building count

group 1   confirmed risk label, photo successfully loaded
group 2   confirmed risk label, no photo (none stored, or the stored one failed to load)
group 3   Pending, photo successfully loaded
group 4   Pending, no photo
group 5   Unknown / public health alert — not in the founder's list; see §17.3

readable  = the first three of matches ordered by group, the shared newest-first order
            inside each group; every match when fewer than three exist
locked    = the next match in that same order, when one remains     (flag: see §17.2)
strip     = total > readable.length                                   -- unchanged
```

"Confirmed risk label" is one of the five rated tiers. Pending and Unknown are tested separately
by name, never folded into one "unrated" notion.

### 17.2 The examples, on real records

The review is `src/components/development/ready-selection-review.tsx`, a development-only file
that applies the rule above to the bundled baseline (64 real recalls recorded 2026-10-04, clock
fixed at the recording) and hands the result to the production Ready step. It does not touch
`lib/ready-preview.ts`; it shares only what must not change (`affectsYouMatches`,
`buildHomeCardModel`, `PreviewStep`). Each scenario is a real preference profile found by
searching every single-choice profile and the named pairs; nothing was chosen by hand to look good.
"Photo" in the review means a stored photo: the review cannot probe loading (§17.4 does).

| #   | Scenario                                     | Profile            | Genuine | Readable                                                                                                                                                              | Locked page                                                          | Strip  |
| --- | -------------------------------------------- | ------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------ |
| 1   | Three rated recalls with photos              | California         | 19      | g1 `7a9159b7` Moringa Leaf Powder (Critical, Updated Sep 11); g1 `6c54040d` Granola (Critical); g1 `080dedcf` Green Powder Products (Critical)                        | g2 `6fcdc02c` Ineligible Pork Cracklings (Critical, no photo, Oct 2) | shown  |
| 2   | A mix requiring rated recalls without photos | tree nuts + Kroger | 3       | g1 `c858146a` Eridanous shortbread (High, photo); g2 `b3faf760` Apulian almond spread (High, no photo); g2 `e29ba3f8` Fruit puree pouches (High, no photo)            | none                                                                 | hidden |
| 3   | A mix requiring Pending recalls              | soy                | 3       | g1 `c858146a` Eridanous shortbread (High); g3 `ea4c7576` Loaded bacon & cheddar chips (Pending, photo); g4 `11032eb1` Saint Francis pizzas (Pending, no photo, Oct 3) | none                                                                 | hidden |
| 4   | Pending fills, a Pending match locked        | milk               | 5       | g1 `4e2cb847` Variety of Breads (Moderate); g1 `c858146a` Eridanous shortbread (High); g3 `6061bbb8` Chocolatey Eyeballs (Pending, photo)                             | g3 `fab432cd` Plant Based Snack (Pending, photo); 1 beyond           | shown  |
| 5   | Two genuine matches total                    | tree nuts          | 2       | g1 `c858146a` Eridanous shortbread; g2 `b3faf760` Apulian almond spread (no photo)                                                                                    | none                                                                 | hidden |
| 6   | One genuine match total                      | Costco             | 1       | g3 `365434a6` Pepper Jalapenos (Pending, photo)                                                                                                                       | none                                                                 | hidden |

Captures: `i17-review-<n>.png` and `se-review-<n>.png` (scenario top), `-bottom` (scrolled to
the strip) and `-locked` (deck swiped to the locked page) for scenarios 1 and 4, and
`comparison-sheet.png` with every cell labelled by scenario, genuine match count, readable count
and device. The deck's dots, frost, strip, monitoring line and See my plan are the production
components unchanged.

**What the examples show.** Three readable cards appear in every scenario with three or more
matches, so the count never stands beside an empty deck and the 2026-10-03 audit's F7 cannot
recur. In scenario 3 the newest recall (Saint Francis, announced Oct 3, Pending, no photo) is the
third card, behind an August High recall with a photo: the groups outrank recency by design. In
scenario 1 the locked page is a Critical FSIS recall from Oct 2 with no photo, frosted; the
fourteen Pending California matches and the public health alert sit behind it, unseen.

**Flags on the locked page and the strip copy (founder decision, not changed silently):**

- **Which match is locked.** The review locks the next match in group order (scenario 1: a
  Critical FSIS recall). The alternative is the newest remaining match (scenario 1: the Oct 2
  Pending sprouts recall). Under frost the difference is invisible on the card and audible only
  as "More matches are locked", so this is a question of what the locked page stands for, not
  of what it shows.
- **"More matching recalls are locked" and "More matches are locked" are plural.** Accurate in
  scenarios 1 (16 hidden) and 4 (2 hidden). When exactly four matches exist, three are readable,
  the locked page is the fourth and nothing lies beyond it: both strings then say "more … are"
  about one recall. No baseline single-choice profile has exactly four matches, but live profiles
  will. Options: accept the plural, or add a singular form; neither is done here.
- **The monitoring line** ("We'll keep checking as new recalls are announced.") replaces the
  strip whenever every match is readable (scenarios 2, 3, 5, 6). It remains accurate.

### 17.3 Unknown and public health alert records — flagged for the founder

The founder's four groups name "confirmed" and "Pending" labels. A third state exists:
**Unknown**, which `riskView` gives to a public health alert (no classification ever arrives;
the badge is suppressed and the card shows "Public Health Alert" instead) and to a recall whose
classification is unrecoverable (badge `UNKNOWN`). Live on 2026-10-05: 167 Unknown cases, every
one an FSIS public health alert, all nationwide and all photo-less, so one or more are genuine
matches for every state profile. The baseline carries one (`dab5f7c7`, Aug 8; the 19th match in
scenario 1, never readable there).

The review does not exclude them and does not invent a label: it places them in a fifth group
after Pending without photo, so they become readable only when fewer than three rated or Pending
matches exist, and they count in the total exactly as today. Three placements are possible:

| Option | Placement                              | Consequence                                                                                                      |
| ------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| A      | Group 5, last (the review as captured) | A PHA is readable only for sparse profiles; the card shows "Public Health Alert", no risk label.                 |
| B      | With Pending, by photo (group 3 or 4)  | A PHA could outrank a Pending recall without a photo; it never has a photo, so in practice group 4 ties by date. |
| C      | Never readable, counted only           | A profile whose only matches are alerts shows a count and no cards — the F7 shape returns for that profile.      |

Recommendation: **A**, because it fills the deck without presenting an alert as a rated recall
and without re-creating an empty deck. It needs the founder's word; the groups list is theirs.

### 17.4 Photo loading: bounded, reclassifying, at rest

A readable preview in group 1 or 3 must have a photo that **loaded**, not merely a stored URL.
The specification, with its named bounds:

1. **Probe, do not render.** Candidates with a stored photo are probed with the platform image
   prefetch (`Image.prefetch`), in group order, at most `PHOTO_PROBE_CONCURRENCY = 3` in flight,
   until three readable cards are confirmed or the candidates run out. A probe resolves
   `loaded`, `failed`, or `timed out` after `PHOTO_PROBE_TIMEOUT_MS = 4000`.
2. **Reclassify, never drop.** A failed or timed-out candidate moves to its no-photo group
   (1 → 2, 3 → 4) and keeps its place there by the shared order. The selection is recomputed
   over the same matches. `total` never changes: probing reads matches, it never filters them.
3. **One bounded wait.** The deck stays in `checking` until the probes needed for the first
   three settle, or `PHOTO_DECK_DEADLINE_MS = 5000` passes, whichever is first; unsettled candidates
   are treated as no-photo for that build. No candidate is ever awaited indefinitely. (As built,
   the session starts during Building and Ready adopts it, so arriving from Building usually needs
   no wait at all — [recall-onboarding-and-paywall.md](recall-onboarding-and-paywall.md) §6.4.)
4. **Stale callbacks.** Every build carries a generation (the corpus identity, the preferences
   and a counter). A probe result tagged with an older generation is dropped. Unmount advances
   the generation, so nothing settles into a screen that is gone.
5. **No unnecessary retries.** The session failure memory (`lib/image-failures.ts`) is consulted
   before probing: a URL that failed or timed out this session is treated as no-photo at once,
   with no request. Loaded URLs are remembered for the session too, so a rebuild (a preference
   edit, a sync) re-probes nothing it already knows. Nothing retries within a session; a relaunch
   starts fresh.
6. **Changes only at rest.** The carousel owns the items it is showing. A new deck — from a
   reclassification, a sync completing, or a saved edit — is held while a drag is active or a
   settle animation runs, and applied once on settle; if several arrive, the last wins. Nothing
   is replaced mid-gesture.
7. **A shown photo that fails anyway** (prefetch succeeded, the tile's `onError` fires) takes the
   same path: the failure is recorded, the candidate reclassifies, the new deck is applied at
   rest. Until then the card draws its text-led shape in place, exactly as the Feed card does.
8. **Late successes do not reorder.** Once a deck has been shown, a probe that resolves `loaded`
   afterwards promotes nothing in that session; only failures move cards. This keeps a shown deck
   from rearranging itself while the shopper is looking at it.
9. **Offline and the bundled baseline.** With no network every probe fails inside the bound, every
   photo candidate reclassifies, and the deck still fills with text-led cards: the honest answer,
   with the same count.

### 17.5 Implementation scope, once approved

- `lib/ready-preview.ts`: `priorityGroup(item, photoState)`, the grouped selection, the locked
  page, and the probe state machine with the named constants; `total` and `hasLockedMatches`
  unchanged. The photo probe is injected (a port), so the selection stays pure and testable.
- `components/onboarding/ready-carousel.tsx`: hold incoming items while dragging or settling;
  apply on settle. No new motion, copy or layout.
- Tests: `ready-preview.test.ts` rewritten around the groups (the six scenarios above over the
  real baseline, plus failure, timeout, generation and session-memory cases);
  `ready-count.test.ts` must pass unchanged; a carousel test for the deferred apply.
- Device check on both simulators through the review screen and the real route with the
  device-only saves switch.
- The review file and the hub's `?review=<n>` branch are development tooling and fold out of a
  release with the hub; they can stay as the standing visual harness for the Ready deck or be
  removed in the implementation change.

### 17.6 Limitations of this review

- "Photo" is a stored URL, not a loaded image: the review cannot exercise §17.4, so a scenario
  whose photo fails live would show one more text-led card than the capture does.
- The hub's gallery cannot host the Ready step: its hidden board measurement never settles inside
  the hub's scrolling gallery (the hub's own three Ready samples are blank there too, a
  pre-existing limitation), which is why the review draws full-screen through `?review=<n>`.
- On the iPhone 17 at the default size the locked strip sits half under the sticky footer until
  the page is scrolled; this is the audit's open V1, not something this review changes.
- The captures come from development builds on simulators, not from a release build.

## 18. Follow-up tasks recorded 2026-10-05 (not started)

Each arose from this milestone's work and is kept here, separately, rather than folded into the
implementation above. Ingestion healthchecks stay on the separate operations roadmap and are only
pointed to from here.

1. **The Building step's fallback gap.** Building counts `affectsYouMatches` over `readyCorpus`,
   so when the session cannot answer it counts the bundled baseline and Ready then previews from
   it. Ready's photo probes cannot succeed without a network, so an offline fresh install shows the
   baseline's count beside text-led cards; and the baseline count can differ from the live count
   that replaces it moments later (today, California: 19 on the baseline, 18 live). Audit the
   handoff (what Building promises, what Ready then shows, and whether a baseline-backed count
   should be worded or timed differently) before changing either screen.
2. **Older-match and count audit.** The count covers the Affects You current window only; the
   collapsed older tail (live, California: 221 cases) is neither counted nor previewed, and the
   locked page can stand for a match the shopper would rank lower than many hidden ones. Audit
   whether the count, the strip's "more" and the older tail tell one consistent story to a
   shopper who then opens the Feed.
3. **Ingestion healthchecks.** Not part of the feed or Ready work; tracked in
   [recall-production-runbook.md](recall-production-runbook.md) and
   [recall-scheduler-watchdog.md](recall-scheduler-watchdog.md) as operations work.

## 19. Confirmed-open membership (2026-10-06, founder decision)

The comparator in §3.2 is unchanged and remains the only order. What changed is
membership of the Affects me list (and therefore the Building and Ready count):
a match outside the 60-day window is counted when its agency confirms it is
still open — an FSIS recall FSIS lists as active, or an FDA recall with an
accepted linked product FDA lists as `Ongoing` (evidence at most 21 days old).
The counted list is sorted once by the shared comparator, so confirmed-open
older recalls sit below every in-window recall because their dates are older;
there is no current-first tier. All recalls' "Recent activity" stays date-only.
Ready's priority groups (§17) are unchanged and apply over the larger list.
Authoritative description: `docs/recall-personalization.md`, "Confirmed open".
