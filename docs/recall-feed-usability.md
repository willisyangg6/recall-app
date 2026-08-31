# Feed usability foundation (C6)

_Written 2026-08-28. Functional milestone on the temporary UI — final visual
design happens separately and may restyle everything here without touching the
business logic, which lives entirely in pure libs._

## Control hierarchy (C6.1)

Home renders **two conceptual levels**, not one row of peer chips:

1. **Feed mode** — a segmented `All | Affects me` control. Which feed you are
   looking at. Mutually exclusive.
2. **All-only filters** — a horizontally scrollable `Location · Risk ·
Clear all` row, rendered **only while All is active**.

In Affects me the filter row, its active counts, and Clear all are absent
entirely — they cannot be opened, read, or cleared from there, and the earlier
"Location/Risk filters apply to All recalls — selections kept" sentence is
gone. The selections survive silently in session state and return with All. A
short context row (`Based on your personalization` + `Edit` → the existing
settings screen) replaces the instruction; it holds no preference logic.
Search stays visible in both modes and is never reset by a mode switch.

## Filter model

Category exists as a derived projection field and a tested predicate, but is not yet wired into this UI (below).

- **All / Affects me** are mutually exclusive feed modes, unchanged: the same
  default-mode rule (personalized once preferences exist, chosen once per
  session), the same eligibility (`lib/relevance.ts`), the same ranking
  (`lib/affects-me-ranking.ts`).
- **Location / Risk** are browsing filters over the complete All Recalls feed
  (`lib/feed-filters.ts`): multi-select sheets with Apply / Clear / Cancel,
  a count on the chip when active, and a global Clear all chip. OR within a
  dimension, AND across dimensions. They are session-only view state — never
  persisted, never part of the personalization profile, never applied to
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

## Category: accepted for discovery, foundation built, UI not wired

"Category" (produce/poultry/dairy/prepared…) is now a canonical projection
field, derived in `projectCase` from the recalled product's own text and never
from the hazard, allergen, firm or retailer. The derivation has failed a 95%
research gate twice on never-seen data:

| Phase   | Vocabulary | Natural holdout | Research gate |
| ------- | ---------- | --------------- | ------------- |
| C5.3B-2 | 11         | 89.5%           | 95%           |
| C10A    | 12         | **91.5%**       | 95%           |

C10A ran the bounded milestone this section previously recommended — the
extraction-policy change preferring structured product lines over
jurisdiction-only FSIS titles, plus the catchable-gap list, then a fresh freeze
and a fresh 200-case holdout. **The extraction change was measured and
reverted**: scored against identical labels on the 60 rows it affects, the
title grammar reached 80.0% and the product lines 50.0%, because FSIS product
lines are packaging prose whose product names are brand-dominated. The residual
error is concentrated — 59% of natural failures are one confusion,
`prepared_foods` mislabelled `meat_poultry` on a jurisdiction-only title.

The founder then accepted 91.5% for a NARROWER purpose than the original brief
assumed. Category is an **optional discovery tool**: it applies to All Recalls,
only when intentionally selected, and it never touches Affects Me, relevance,
risk, ranking, push, notification eligibility, or membership of the unfiltered
feed. Under that framing it clears separate ≥90% product gates, and the
reviewed rate of "placed somewhere no shopper would look" is 2.0%. A
miscategorized card is a discovery miss with the whole feed behind it; that is
a different kind of failure from a missed allergen alert, and the two paths
hold different bars on purpose.

Semantics, already implemented and tested in `feed-filters.ts`: OR within the
selected categories, AND with Location and Risk, filtering picks the set and
the existing comparator orders it, and a case with no derived categories
matches no active selection while never being hidden from the unfiltered feed.

**The UI is still not wired** (C10B), and the historical backfill has not been
applied — see docs/recall-food-categories.md §6 and §8.

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
