# Feed usability foundation (C6)

_Written 2026-08-28. Functional milestone on the temporary UI — final visual
design happens separately and may restyle everything here without touching the
business logic, which lives entirely in pure libs._

## Control hierarchy (C6.1)

Home renders **two conceptual levels**, not one row of peer chips:

1. **Feed mode** — a segmented `All | Affects me` control. Which feed you are
   looking at. Mutually exclusive.
2. **All-only filters** — a horizontally scrollable `Location · Risk ·
Category · Clear all` row, rendered **only while All is active**. Category is
   last because it is the only dimension whose values are _derived_ rather than
   stated by the agency (C10B).

In Affects me the filter row, its active counts, and Clear all are absent
entirely — they cannot be opened, read, or cleared from there, and the earlier
"Location/Risk filters apply to All recalls — selections kept" sentence is
gone. The selections survive silently in session state and return with All. A
short context row (`Based on your personalization` + `Edit` → the existing
settings screen) replaces the instruction; it holds no preference logic.
Search stays visible in both modes and is never reset by a mode switch.

## Filter model

- **All / Affects me** are mutually exclusive feed modes, unchanged: the same
  default-mode rule (personalized once preferences exist, chosen once per
  session), the same eligibility (`lib/relevance.ts`), the same ranking
  (`lib/affects-me-ranking.ts`).
- **Location / Risk / Category** are browsing filters over the complete All
  Recalls feed (`lib/feed-filters.ts`): multi-select sheets with Apply / Clear
  / Cancel, a count on the chip when active, and a global Clear all chip. OR
  within a dimension, AND across dimensions. They are session-only view state —
  never persisted, never part of the personalization profile, never applied to
  Affects me.
- **Location semantics** (canonical tri-state geography): a selected
  jurisdiction matches notices explicitly distributed there and nationwide
  notices; explicitly-elsewhere and unknown-geography notices do not match.
  Nothing is inferred from headquarters, firm address, or retailer footprint.
  The vocabulary is the same 52 jurisdictions preferences use.
- **Risk semantics**: the seven canonical consumer tiers
  (`domain/risk-tier.ts`), existing labels only, Pending and Not rated as
  their own selectable levels — never renamed or collapsed.
- With no search and no filters, the pipeline returns the same arrays it was
  given, so All Recalls sectioning/ordering is byte-for-byte the pre-C6
  output (test-pinned).

### Location ordering (C6.1)

With one or more jurisdictions selected, results are ordered **within the
existing sections** (`orderByLocationTiers`), four levels deep:

1. **Location tier** — Tier 1: the notice's own state list names a selected
   jurisdiction. Tier 2: canonically nationwide. Every explicit match is one
   tier: "California", "California + Texas", and "California + 40 others"
   weigh the same, because a narrower list is not better evidence that the
   product reached you.
2. **Consumer risk** — the canonical display sequence, imported from the one
   place it is defined (`RISK_PRIORITY`) so All Recalls and Affects me can
   never sequence tiers differently.
3. **Activity date**, newest first, and 4. **case id** — both _inherited_
   rather than restated: the sort is stable and runs over a list
   `buildFeedSections` has already ordered, so each section keeps its own
   canonical date (`lastPublicActivityAt` for Recent activity, `publishedAt`
   for Older active notices) and its id tie-break, with no second copy able
   to drift.

Location specificity outranks risk and recency: an explicit California notice
stays above a nationwide one that is newer or more severe. Ordering never
changes membership — an old notice is never promoted into Recent activity by
matching the selected location. Measured live on the California filter: 351 of
882 cases admitted (139 explicit, 212 nationwide), every explicit match ahead
of every nationwide one in both sections, risk non-decreasing within each tier.

## Search

`lib/feed-search.ts`, pure and index-based (built once per load, ~38 ms for
882 cases; per-keystroke filter+search+section mean ~0.2 ms). Operates on the
selected mode: in All, after the active filters; in Affects me, over the
already-eligible ranked output only (an ineligible notice has no path in).

Fields: title, product description, affected product/variant lines, brands,
recalling firm, retailer names. Product lines ride the feed query as an
embedded `affected_products(name)` select (+~0.4 MB over the full load,
measured) — they carry the printed UPC/lot/batch/case codes and, where FSIS
states them, establishment numbers.

Rules: human text is normalized (case, diacritics, punctuation) and
substring-matched with AND across whitespace tokens; identifier-looking
queries (≥4 digits after stripping label prefixes like "UPC"/"lot"/"EST")
additionally match extracted code candidates with separators removed — exact
substring, **never fuzzy**: one wrong digit does not match. Raw announcement
HTML/prose is not searched; no external service is queried; empty search is a
strict no-op (same array instance).

## Category (C10B): shipped as an optional discovery filter

"Category" (produce/meat/dairy/bakery…) is a canonical projection field,
derived server-side in `projectCase` from the recalled product's own text and
never from the hazard, allergen, firm or retailer. C10B ships it as a filter
chip and backfills every historical case.

### The accuracy, stated plainly

The classifier **missed every research bar it was built against** and is
shipped anyway, under a narrower purpose:

| Phase   | Vocabulary | Natural holdout | Bar | Met? |
| ------- | ---------- | --------------- | --- | ---- |
| C5.3B-2 | 11         | 89.5%           | 95% | no   |
| C10A    | 12         | 91.5%           | 95% | no   |
| C10A.1  | 12         | 86.5%           | 90% | no   |
| C10A.2  | 12         | **87.5%**       | 90% | no   |

Final holdout (200 previously untouched cases, labelled blind, measured once):
**87.5% exact-set · 88.0% at-least-one-correct · 88.0% micro P · 87.1% micro
R**. Three independent fresh draws read 91.5% / 86.5% / 87.5% — the honest
summary is "high 80s", not any single figure.

The number the founder actually decided on is a different one: **1.0% (2/200)**
of the final holdout was placed somewhere no reasonable shopper would look.
The rest of the error is a near-miss between two adjacent aisles, and 20 of the
25 mismatches are a single boundary — Prepared foods vs Meat & poultry.

### Optional discovery is not authoritative availability

The decision rests entirely on what Category is allowed to do:

- it applies **only to All Recalls**, and only when the user selects a chip;
- **every recall stays reachable** with it cleared — the unfiltered feed,
  search, Affects Me, risk and notifications are the authoritative surfaces
  and none of them consults a category;
- a miscategorized card is a **discovery miss with the whole feed behind it**;
  a missed allergen match is a missed alert. The two paths hold deliberately
  different bars and share no input, which `category-invariance.test.ts` and
  `qa:product-categories` enforce structurally rather than by promise.

**No future accuracy claim may be made without new independent evidence** — a
newly drawn, blind-labelled holdout. This corpus has no untouched 200 left, so
that requires corpus growth, not re-scoring a spent split and never rewriting
an old label to improve an old number.

### Launch-visible categories

`domain/food-category-launch.ts` is the one canonical allowlist, separate from
the twelve-id internal vocabulary and derived from it, so the chip order is the
canonical display order by construction. Nine are offered:

| ID                  | Label               |
| ------------------- | ------------------- |
| `produce`           | Fruits & vegetables |
| `meat_poultry`      | Meat & poultry      |
| `seafood`           | Seafood             |
| `dairy_eggs`        | Dairy & eggs        |
| `bakery_grains`     | Bakery              |
| `snacks_sweets`     | Snacks & sweets     |
| `beverages`         | Beverages           |
| `pantry_condiments` | Pantry & staples    |
| `baby_food_formula` | Baby food & formula |

Three stay **valid internally but hidden from the filter**. Hidden is not
deleted: cases keep carrying them, the backfill keeps writing them, QA keeps
reporting them, and every one of those recalls stays in the unfiltered feed.

- `prepared_foods` — the known weakness. 64.8% recall (35/54) against 94.6%
  precision on the final holdout: about a third of genuine prepared-food
  recalls are filed elsewhere, nearly always under Meat & poultry. A chip that
  silently omits a third of its aisle is worse than no chip. High precision is
  why the id is still worth storing.
- `supplements` — the final holdout contains **zero** supplement rows, so there
  is no evidence at all about how the shipped classifier places them, and
  earlier phases recorded a supplement filed under Pantry & staples.
- `other` — an internal fallback, not an aisle. It exists so the derivation can
  be total; totality is a data property, and nobody browses for "Other".

Hiding these does not narrow the feed. It narrows the menu.

### Feed field and filter semantics

`FEED_SELECT` gains `product_categories:projection->productCategories` — the
derived ids only. No announcement text, no classifier input, no confidence, no
fixture; the app receives the answer and never the evidence, and an `expo
export` scan proves the classifier, gold set, holdouts, Node-only QA code and
`@napi-rs/canvas` are absent from both the iOS and web bundles.

Values are normalized by `domain/product-categories-stored.ts` — a leaf module
that imports only the frozen vocabulary, so the feed loader cannot drag the
classifier into the bundle, with a test pinning it equivalent to the
server-side reader. **Missing is not `['other']`**: an absent key, `null`, `[]`
and an all-invalid list all read as "no categories derived", which matches no
active selection and is never shown under a chip.

`FEED_CACHE_SCHEMA_VERSION` is bumped to 2, which is a correctness gate rather
than hygiene. A v1 cache holds rows written by a build whose SELECT never asked
for the column; if that build re-synced after the backfill it re-cached them
under current manifest tokens, and the new build would then find every token
matching, download nothing, and serve an un-enriched corpus that looks
enriched — an empty result under every chip, with no error anywhere.

Semantics (`feed-filters.ts`, tested): OR within the selected categories, AND
with Location and Risk, filtering picks the **set** and the existing comparator
orders it (so state-specific results still lead nationwide ones), and Category
never touches Affects Me membership or ranking. Selections are sanitized
against the launch allowlist at the state boundary, so a hidden, unknown,
duplicate or malformed id cannot enter the filter through any path. With no
category selected, All Recalls is byte-identical to its pre-C10B self.

## Sharing

Recall detail gains a native share sheet. The message is built by
`lib/share-message.ts` (pure, tested) from canonical facts only: product,
company/brand, the "What happened" sentence, the notice's own consumer
instruction (the app's substituted recommendation is deliberately not
quoted), and the official agency URL — always included, never a tracking
link. Nothing personal can enter (the input type has no such fields) and the
copy never claims the recipient is affected. Cancellation or a platform
without a share sheet rejects the promise; both are absorbed.

## Profile

`/profile` (header entry on Home, replacing the direct Alerts link) is
navigation only: Personalization and Notifications rows both open the
existing, unchanged Settings screen (route `/settings` preserved for deep
links), plus an About block (runtime app version via expo-constants). No
preference state, no duplication, no new fields — the serial save queue,
local-first persistence, and server mirror are untouched. Privacy, legal,
methodology, and support rows are deliberately absent until real screens
exist. Restyling or moving Profile later means touching only
`src/app/profile.tsx` and the header entry in `_layout.tsx`.
