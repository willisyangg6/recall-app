# Recall personalization (Phase C3)

Personalization turns "here are all recalls" into "here are the recalls most
relevant to me, and here is why" — without ever hiding the full truth. Three
dimensions only: **home state**, **allergens**, **retailers**. No accounts, no
location tracking, no purchase inference, no analytics.

The core product principle, everywhere in this design:

> **Absence of a personalization match is not proof of safety.** Retailer and
> allergen metadata is incomplete at the source. State is the primary
> geographic relevance signal; allergens and retailers are POSITIVE signals
> that raise and explain relevance — never universal exclusion predicates.

## The three vocabularies (all closed)

- **State** — one of the 52 jurisdictions the geography layer already
  normalizes to (50 states + DC + Puerto Rico), stored as a postal code.
  Chosen explicitly by the user in Settings; never inferred from GPS/IP, no
  location permission exists in the app.
- **Allergens** — the nine major US food allergens (peanut, tree nuts, milk,
  egg, wheat, soy, sesame, fish, crustacean shellfish), expressed as the
  canonical tokens `normalizedAllergenTokens` (src/domain/hazard.ts) already
  derives from authoritative notice text. A notice naming cashews or walnuts
  yields the `tree nuts` token, and one naming shrimp yields the
  `crustacean shellfish` token (FDA's own category for its shrimp recalls),
  so a "Tree nuts" or "Crustacean shellfish" preference matches those recalls
  with zero new inference. Known non-major tokens the
  data layer can produce (`gluten`, `sulfites`) are deliberately not
  selectable.
- **Retailers** — canonical ids from a curated catalog
  (src/domain/retailer-catalog.ts): chains observed as retailer evidence in
  the live corpus plus major US chains, with explicit alias lists
  (Walmart/Wal-Mart, Costco/Costco Wholesale, H-E-B/HEB/H.E.B.). Matching is
  exact against normalized aliases, never fuzzy; distinct banners of one
  parent stay distinct (Fred Meyer ≠ Kroger, Safeway ≠ Albertsons); known
  ambiguity stays unresolved (a bare "Giant" matches neither Giant Food nor
  The GIANT Company). The long tail of one-off local shops stays
  uncanonicalized and simply never matches.

## One relevance evaluation (src/lib/relevance.ts)

`evaluatePersonalRelevance(caseFacts, preferences)` is the single
deterministic core shared by the Home "Affects me" feed, the detail screen's
"Why this may affect you" section, and push eligibility. It returns:

- `geographic`: `matches` | `does_not_match` | `unknown` — tri-state, because
  a wrong "doesn't affect you" is dangerous. Nationwide ⇒ matches (always).
  Authoritative state list containing the home state ⇒ matches; a known list
  without it ⇒ does_not_match; source silent ⇒ unknown. Nothing is ever
  inferred from company or retailer headquarters.
- `matchedAllergens` / `matchedRetailers`: the deterministic intersections of
  the user's selections with the case's authoritative facts.
- `affectsMe`: with a state chosen — geography matches, OR geography unknown
  with at least one allergen/retailer signal. **Authoritative geographic
  exclusion is final**: a Maine-only sesame recall is not "affects me" for a
  Californian sesame allergy (the match stays available internally, but
  never overrides the agency's own distribution statement). With no state
  chosen — only personal signals qualify, and the UI asks for a state
  instead of pretending to know geography. And since C5.2B one further
  exclusion applies after geography: a **known allergen-only mismatch**.
- `reasons`: priority-ordered (allergen, retailer, geography): "Your
  allergen · Sesame", "Sold at Costco", "Affects California", "Nationwide
  recall", "Location not specified". Empty when there is nothing personal to
  say. Since P2a these labels are model-level facts only — Home cards render
  ONE generic "Affects you" flag, never the per-reason chips
  ([docs/recall-feed-usability.md](recall-feed-usability.md)); the reasons
  stay available for ranking, QA, and future surfaces.

## Home

Two views: **Affects me** and **All recalls** — All recalls is always one tap
away and personalization never deletes or permanently hides anything. The
default is Affects me once any personalization exists, otherwise All recalls
with a compact "Personalize Recall" CTA (which never requests notification
permission). Within Affects me:

- AFFECTS ME — recent items where `affectsMe` holds, each carrying the one
  generic "Affects you" flag (risk tier stays in its own badge, visually
  separate; the per-reason chips were retired in P2a).
- OLDER ACTIVE NOTICES — the existing collapsed tier, filtered the same way.

There is no third section. The generic **"Location not specified" section was
removed in C5.2B**: heading, count, copy, disclosure control and membership.
A notice with unknown geography and no allergen or retailer match said nothing
about this user, and a permanently-collapsed list of them neither answered
"does this affect me" nor could be acted on. Such a notice now appears **zero
times** in Affects Me — and is NOT moved into Older Active Notices, which hold
qualifying notices only. All Recalls remains the complete safety net.

An unknown-location notice that DOES match an allergen or a retailer still
ranks in the main flow, carrying its honest "Location not specified" context
chip. A state is never inferred.

Lifecycle and freshness stay authoritative and untouched: personalization
composes with the existing recent/older tiers, and a closed recall never
looks active because it matches a preference.

## Affects Me eligibility (C5.2B)

### The truth table

| User                       | Notice                                          | Affects Me |
| -------------------------- | ----------------------------------------------- | ---------: |
| CA + Milk                  | CA milk-only recall                             |    **Yes** |
| CA + Milk                  | nationwide milk-only recall                     |    **Yes** |
| CA + Milk                  | unknown-location milk-only recall               |    **Yes** |
| CA + Milk                  | explicit TX-only milk recall                    |         No |
| CA + Peanut                | CA milk-only recall                             |         No |
| CA + Peanut                | nationwide wheat-only recall                    |         No |
| CA + Peanut + Costco       | CA Costco milk-only recall                      |         No |
| CA + Peanut                | allergen-only recall naming no allergen         |    **Yes** |
| CA + Peanut                | sulfites-only recall (not selectable)           |         No |
| CA (no allergens selected) | any identified allergen-only recall             |         No |
| CA + Peanut                | CA Salmonella recall                            |    **Yes** |
| CA + Peanut                | nationwide foreign-material recall              |    **Yes** |
| CA + Peanut                | CA Salmonella + undeclared milk recall          |    **Yes** |
| CA + Peanut                | unknown-location Salmonella, no retailer signal |         No |
| CA + Peanut + Costco       | unknown-location Salmonella sold at Costco      |    **Yes** |
| any                        | explicit state list excluding the user's state  |         No |

Read as an ordered rule: **geographic exclusion is final first**, then a known
allergen-only mismatch, then the positive signals. A retailer or state match
can never resurrect a recall the source proves does not involve the user's
allergens.

### Known allergen-only mismatch

A milk-only recall is not information a peanut-allergic shopper needs, however
close to home it happened — and before C5.2B every one of them qualified on
geography alone. Measured on the live active corpus, that was **97 of 357**
qualifying notices for a California + Peanut + Costco profile.

The determination is deliberately timid, because a wrong answer hides a safety
notice. `domain/allergen-only.ts` reads only canonical fields the ingestion
layer already derived — never announcement prose, never keyword guessing — and
all three of these must hold:

1. The agency's own `hazardCategory` is `allergen`.
2. No non-allergen hazard is stated: not a pathogen (via the canonical
   `extractPathogen`), and not one of FSIS's structured non-allergen reason
   labels (`Product Contamination`, `Insanitary Conditions`, `Processing
Defect`, `Unfit for Human Consumption`). `Misbranding` and `Mislabeling` are
   deliberately absent — they are how an undeclared allergen is REPORTED, not a
   second hazard.
3. `normalizedAllergenTokens` names at least one allergen.

Anything short of that returns `unidentified` and **preserves location-based
eligibility exactly**. A notice saying only "undeclared allergen" could be the
user's own, so it is never a mismatch — 46 active cases rely on this.

### General and mixed hazards are never suppressed

Location alone still qualifies Salmonella, E. coli, Listeria, foreign material,
metal, chemical contamination, spoilage and every other non-allergen hazard. A
recall carrying BOTH an allergen and a general hazard is not allergen-only.
Proven by corpus diff: of the 97 notices this rule removed for the
representative profile, **97 were `hazardCategory: allergen` and none was a
general or mixed hazard**, and **zero** notices were added.

### Non-selectable substances

Sulfites and gluten are real, identified allergen hazards that the supported
nine-allergen vocabulary cannot express (16 active sulfites-only cases; no
active gluten-only cases). They are confidently identified and can match
nothing, so the same rule withholds them from Affects Me with no special case.
They remain in All Recalls.

### Household-aware allergen copy

The Settings label and helper are exactly:

> **Allergens to watch**
> Select any allergens relevant to you or anyone you shop or cook for.

Copy only. One shared allergen list, as before — no person names, no child or
household-member records, no new preference field, no account, no schema
change. The wording lives in `lib/personalization-copy.ts` so it is a tested
contract rather than a string that can drift.

### All Recalls is the safety net

All Recalls is unchanged in membership, order, sectioning and count. It never
reads preferences, so nothing personalization decides can remove a notice from
the product — only from one person's shortlist.

## Affects Me ordering (C3.2)

Qualifying is not enough: once dozens of notices affect one person, the order
IS the product. One pure function ranks them (`src/lib/affects-me-ranking.ts`),
used by every Affects-me surface, so ordering can never depend on which
component rendered. It changes ORDER ONLY — eligibility, geography tri-state
semantics, allergen/retailer matching, push eligibility, All Recalls, and
NotificationEvent behavior are all untouched.

### A lexicographic tuple, never an additive score

Each dimension fully decides before the next is consulted:

```
risk priority → geographic confidence → personal signal → material activity
              → announcement date → case id
```

A points model was rejected outright: with weights, two retailer matches could
out-rank a Critical classification, and no one could explain afterwards why a
card placed second. Here every position answers in one sentence.

| #   | Dimension             | Order                                                            |
| --- | --------------------- | ---------------------------------------------------------------- |
| 1   | Consumer risk         | Critical → High → Moderate → **Pending/Unrated** → Low → Minimal |
| 2   | Geographic confidence | confirmed (state **or** nationwide) → unknown-with-signal        |
| 3   | Personal signal       | allergen+retailer → allergen → retailer → neither                |
| 4   | Material activity     | newest authoritative event first                                 |
| 5   | Announcement date     | newest first                                                     |
| 6   | Case id               | ascending — a total order, so renders never reshuffle            |

**Pending and Unrated share one position, and are never relabeled.** A notice
the agency has not classified yet, or never will (a public health alert), must
not sink below one the agency actively rated Low or Minimal — but it is not
Moderate either, and nothing infers a preliminary level from hazard text. They
are grouped for sequence only; `riskView` still says "Pending" / "Not rated"
and still refuses to badge them as a rated tier. This is deliberately separate
from `RISK_TIER_RANK` (domain/risk-tier.ts), which ranks them `null` precisely
because they have no severity.

**Explicit state and nationwide are the same confidence** — both are the agency
saying the product reached the user's area. Which one it was is carried by the
relevance reasons ("Affects California" / "Nationwide recall") in the model,
never by position — and since P2a not by any on-card chip.
An authoritative geographic **exclusion** never enters Affects Me at all, so it
cannot be out-ranked by any personal signal.

**Signals are Boolean categories, never counts.** Matching three selected
retailers is the same fact as matching one: the user shops there. Allergen
outranks retailer because an allergen match is a direct hazard relationship
with the product, while a retailer match only says the user shops where it was
sold — it never implies they bought it.

### Material activity: the one date allowed to make a recall feel current

`src/domain/material-activity.ts`. Neither existing date answers the question:

- `lastChangedAt` is OUR write time — it moves for retailer backfills and image
  enrichment. Never consumer information.
- `lastPublicActivityAt` is source-published and much better, but it is
  `max(publishedAt, lastModifiedAt)` across the case's records, so it also
  moves on wording edits, HTML cleanup, and `field_last_modified_date` churn.
  Measured live 2026-08-26: **ahead of the last material event on 354 of 895
  active cases**.

The trustworthy signal is the case timeline, which already records the Layer-2
verdict per entry: `material: true` means a fixed rule fired (expansion,
broadening correction, classification assigned/upgraded/downgraded/changed,
first illnesses, instructions changed, retraction). Those are exactly the
notification-eligible events, so "what can raise a recall's prominence" and
"what can notify a user" stay one definition instead of two that drift.

```
materialActivityAt = max(publishedAt, {occurredAt of material timeline entries})
```

`publishedAt` seeds it because the original announcement is itself an
authoritative event — the pipeline records it as a `published` entry with
`material: false` (a founding fact, not a change to one), so seeding rather
than counting keeps that distinction intact. Deliberately excluded:
`source_updated` bookkeeping, agency closure (dashboard-visible, never
notification-eligible), and our own maintenance writes, which append no
timeline entry at all.

Because every material entry is stamped with the source-published activity date
of the re-projection that created it, material activity is always
≤ `lastPublicActivityAt`. The Affects-me 60-day window is therefore a strict
**tightening** of the All Recalls one, never a widening — the same
`RECENT_WINDOW_DAYS` boundary applied to a stricter date. Live delta for the
representative profile: 22 recent by public activity → 21 by material activity
(one demoted for bookkeeping-only movement), with 8 of the 21 raised above
their announcement date by a genuine authoritative event.

The feed row therefore carries `timeline` (~257 bytes per active case, ~130 KB
over a 500-row feed). The alternative — a persisted derived date — would be a
second truth able to drift from the timeline it was derived from.

### Sections and copy

At C3.2 the structure was unchanged: recent qualifying notices, "Location not
specified", then older active collapsed. Only the recency date changed, and
all sections are ordered by the one comparator, so nothing jumps between
renders. Sections are disjoint by construction — qualifying cases split by one
boundary into recent/older. _Superseded by C5.2B (see "Home" above): the
generic "Location not specified" **section** no longer exists — Affects Me
renders two sections, and an unknown-location notice appears only when a
personal signal qualifies it, carrying its honest context chip._

Every card shows exactly one activity label from the material-change ledger
(P1: "Announced …", or "Updated …" only when an authoritative material event
happened) in every feed mode, so a card can never imply an old recall was
announced today. Cards still show risk state and that one date, plus the
generic "Affects you" flag when the verdict holds; no numeric score, sort
key, purchase claim, or safety claim about excluded items is ever exposed.

## Preferences: storage and sync

Preferences are **installation-level application state**, deliberately
separate from push subscriptions — an installation can hold preferences with
alerts off (Home uses them locally), and reading or writing them never
triggers a notification-permission prompt. They reuse C2's installation
identity (`src/lib/installation-id.ts`); no second device identity exists.

- **Local (source of truth)**: SecureStore JSON on the device
  (src/lib/preferences-store.ts) — works offline, before any migration is
  applied, and before push exists. Settings autosaves on every change.
- **Server (mirror for delivery)**: `installation_preferences` (migration
  `20260830000000_installation_preferences.sql`), written only through the
  SECURITY DEFINER RPC `set_installation_preferences` — same bearer-capability
  model as C2 registration: RLS with no policies and no anon grants, shape
  validation of every field (state against the closed 52-code set, allergens
  against the closed 9-token set, retailer ids by shape and count; ids
  outside the code catalog are inert — the matcher can never match them).
  A client can set its own row and nothing else: no enumeration, no reads of
  other installations, no access to tokens or deliveries.
- **Reconciliation**: local always wins; a failed sync sets a dirty flag and
  is retried at next launch (`flushPreferencesSync`) or next save. The RPC is
  a strict no-op for identical values — including `updated_at` — which
  matters below.

### Deletion and reset (C7.1)

"Reset app and delete my data" (bottom of Privacy & Data Controls) is the
one comprehensive lifecycle exit. It calls `delete_installation_data`
(migration `20260902000000_installation_deletion.sql`) — the same
bearer-capability model: possession of the opaque installation id authorizes
deleting exactly that installation's rows (`installation_preferences`,
`push_subscriptions`, their `notification_deliveries`) in one atomic,
idempotent, void-returning transaction, then clears local state and mints a
fresh installation id through the canonical path
(`src/lib/installation-reset.ts` + `installation-reset-runner.ts`).

Ordering is the safety property, in both directions:

- **Server first.** Local state is cleared only after the server deletion
  succeeds; a failure changes nothing on the device, so the id — the only
  credential able to retry the deletion — is never lost while server rows
  exist. The RPC's idempotency makes an ambiguous outcome (server committed,
  response lost) safe to retry.
- **One mutation queue.** Every installation-scoped mutation — preference
  saves, the launch dirty-flag flush, push registration/refresh/disable
  server writes, and the reset — now shares ONE serial queue
  (`src/lib/installation-lifecycle.ts`). A save or silent push refresh in
  flight when the user confirms deletion completes first and its rows are
  deleted; anything queued later runs against the fresh identity. The
  save-vs-save last-request-wins ordering is unchanged (same
  `createSerialQueue` chain, proofs in `serial-queue.test.ts`; deletion
  interplay proofs in `installation-reset.test.ts`).

Uninstalling the app alone is **not** a deletion request — the app never
gets to run. Rows left by a pre-reinstall installation (a different, now
credential-less id, disabled `token_reassigned`) are not reachable by this
RPC; their retention remains a founder decision
(docs/recall-launch-blockers.md).

## Push eligibility (the one seam)

All per-subscription delivery decisions happen in
`classifySubscriptionsForEvent` (src/server/push/worker.ts) — C2's
`eligibleSubscriptions` seam, now preference-aware, calling the SAME
`pushEligible`/`evaluatePersonalRelevance` the app renders. Policy:

- No preference row, or no state chosen → pre-C3 behavior: every deliverable
  event qualifies (allergen/retailer selections alone never become exclusion
  filters — recalls are safety information).
- State chosen → deliver when geography **matches** (nationwide always), or
  geography is **unknown** with a matching allergen/retailer. An
  authoritative geographic exclusion never delivers.

**No retroactive blast**: `installation_preferences.updated_at` joins the C2
horizons — eligibility requires
`event.created_at ≥ max(push_enabled_at, subscription.enabled_at, preferences.updated_at)`.
Adding "Peanuts" today cannot enqueue last month's peanut recalls; moving
California → Texas cannot backfill old Texas-only events. Proof shape: an old
event either already has its (event, subscription) delivery row (unchanged —
the unique pair blocks re-enqueue) or it didn't qualify before the change and
is now behind the preference horizon. The known trade-off: an event created
minutes before a preference save is skipped for that installation (≤ one
30-minute tick, and it still appears in the app) — the same window C2 already
accepts for re-enabled subscriptions. Because identical-value syncs never
touch `updated_at`, app-launch re-syncs cannot widen that window.

All other C2 rails are untouched: global activation horizon, suppressed
events never deliver, per-pair idempotency, ticket/receipt honesty, bounded
retries.

## Geography evidence (C5.2A)

Personalization matches on the **persisted** `projection.geography`. Before
C5.2A that field was written once by whichever adapter parsed the record first
(FDA prose, FSIS `field_states`) and then frozen — incremental ingestion
re-projects a case only when its source page's content hash moves. So a parser
improvement never reached a stored case, and the detail screen quietly
compensated with a display-time supplement the feed card and push eligibility
could not see. Manual QA found the result: a notice whose own sentence says the
bread was sold "within the Seattle and Tacoma Metro areas in WA" carried
`unknown` and rendered as **"Distribution not specified"**.

### What the field means

> The authoritative source stated, in a distribution construction, that the
> recalled product went to these places.

### Where it is derived

`domain/geography-evidence.ts` — one function, called from `projectCase`,
exactly like `retailerNames`. Live ingestion and the historical repair run the
same code; there is no repair-only parser. Three kinds of evidence, all
explicit:

| Evidence      | Example                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| prose         | "…were sold at grocery stores … within the Seattle and Tacoma Metro areas in WA"                     |
| declared list | "…and the following United States:" then one state per bullet                                        |
| table         | a column whose HEADER assigns it a state role — `State/Retailer`, `US Distribution States`, `States` |

**Structure decides, never content.** A table full of state abbreviations is
not a distribution table: the "State" column of a 30-row store-address table
(Address / City / State / Zip) contributes nothing, and a column headed
`Distributed to` earns its states only if the column holds nothing but states —
a live one holds Walmart, UNFI and Sprouts, and a retailer's footprint is not
geography.

Never geography, however many place names they contain: the recalling firm's
own address, a headquarters, a manufacturing facility, a contact block, a
store-address table, a retailer footprint, or a bare city the source never
attached a state to.

### Widening only, with one proven exception

- `nationwide` is returned untouched; it is never re-derived or narrowed.
- A carried state always survives. The planner carries a second guard on top
  of the derivation's own rule: any state that would disappear turns the case
  into a reported **conflict** and leaves it untouched.
- The one removal: a state whose name occurs in the notice **only inside a
  longer state's name**. `\bVirginia\b` matches inside "West Virginia", so 16
  stored cases claimed a Virginia distribution their source never stated.

A missing state is not a harmless gap. `unknown` is non-negative — the user is
told the location is not specified — but a state **list** that omits a state
turns a shopper there from "not sure" into "does not affect you". That is why
a declared list must keep its first entry: sources write "…in the following
states: SD, ND, MN, IA, WY", and reading only the comma-preceded codes dropped
`SD` in 54 sentences corpus-wide, including a Trader Joe's dressing recall
stored without Arkansas.

### Deliberately not interpreted

`WVA` (Ukrop's) and `RS` (Military Resale Store) are reported by the dry run
as unresolved fragments and never guessed. Only conventional postal codes and
full state names resolve; there is no traditional-abbreviation table and no
fuzzy matching. In the one notice where `WVA` appears, the same column spells
West Virginia conventionally three times, so refusing to guess costs it
nothing — and the dry run names any fragment it declined, so a future notice
that depends on one is visible rather than silent.

### Historical repair

`npm run repair:geography:dry` / `npm run repair:geography` — see
`docs/recall-operations.md`. A projection repair is **not** a material recall
change. `detectChanges` would classify a widening as `expansion_geography` and
notify, which is exactly why the repair does not use that path: finding
evidence an older parser could not read is not the agency announcing that a
recall grew.

## Retailer evidence (C3.1)

Personalization matches on the **persisted** `projection.retailerNames` — the
same field everywhere (feed chips, detail personal lines, push eligibility),
so app and server can never disagree about a decision.

### What the field means

> The authoritative source stated, in a high-confidence sold-at /
> shipped-to / distributed-to construction, that the product was associated
> with this retailer.

Only that **verb-gated sentence seam** (`domain/retailer.ts`) may populate it.
The detail screen's "Where it was sold" section also reads source TABLES and
block store lists, and a live census proved those seams unsafe to persist:
they carry product rows, barcodes, package weights, store street addresses,
export-country lists, and column headings alongside real store names. A
notice's product table flattened to text is indistinguishable from a store
list once the heading is gone, and no shape test tells "Chef Salad" from a
delicatessen.

Display can show an uncertain string beside the official source link. This
field cannot: it drives push notifications, and a false "Sold at Costco" is
worse than no retailer at all. Measured trade: the verb-gated seam alone
reaches 222 of the 283 retailer-bearing cases and **165 of the 162**
catalog-matchable ones — more than the unsafe derivation managed, because
preserving source possessives ("Baker's", not "Baker") resolves banners that
truncation was destroying.

### Where it is derived

`domain/retailer-evidence.ts` — one function, called from `projectCase`
itself, so the case-level projection is authoritative:

- **Both agencies, one contract.** FSIS previously never set `retailerNames`
  at any point; it now derives them from the same place FDA does, with no
  adapter-specific retailer system. The FDA parse-time field remains and
  unions in, subject to the same gate.
- **Self-healing.** Because the derivation runs during projection rather than
  being stored by an adapter, a later legitimate re-projection recomputes the
  same answer instead of erasing a repaired one.
- **Aliases are not authority.** The curated catalog resolves exact
  normalized aliases for _matching_; it never asserts that a recall was sold
  at a chain. Evidence that resolves to nothing is still real evidence — it
  displays, and simply never matches a preference. Ambiguity stays ambiguous:
  a bare "Giant" matches neither Giant Food nor The GIANT Company. Stripping
  is one-directional — "Costco's" reduces to a known alias, but "Baker" is
  never guessed up into "Baker's".

The gate `isRetailerName` is shared by every seam, so hardening it fixed the
display path too: column headings, addresses, countries, state abbreviations,
`City ST` localities, barcodes, package rows, phone numbers, distribution
centres, generic venue categories ("Asian markets"), and mid-sentence
fragments no longer render as somewhere to shop.

### Historical repair

`npm run backfill:retailers:dry` / `npm run backfill:retailers` — see
`docs/recall-operations.md`. A projection repair is **not** a material recall
change: `detectChanges` does not diff `retailerNames` under any rule, so a
retailer-only difference cannot produce a NotificationEvent even through the
normal path — and the repair does not use the normal path, writing one field
while carrying `timeline` and `lastChangedAt` through untouched.

### Role, not shape

Some strings pass every shape test and are still not shops. "C&S Wholesale
Grocers" and "Russ Davis Wholesale" are grocery wholesalers; "Ardmore" and
"Blair" are the towns a distribution centre sits in; "Elevation Foods" was
sent labels _in error_. What disqualifies each is the ROLE the source gives
it, so `contextRejectsRetailer` reads the sentence around a name rather than
the name alone, and rejects it when the notice says:

| Source wording                                             | Role                         |
| ---------------------------------------------------------- | ---------------------------- |
| "Wakefern distribution centers in Elizabeth, NJ"           | warehouse                    |
| "AMD Imports Inc., **a distributor** in Houston"           | distributor, stated          |
| "TRIMAR USA LLC … **who further distributed** the product" | intermediary                 |
| "distributed through Russ Davis **Wholesale.**"            | the wholesale trade          |
| "HRI Commercial **Food Service** locations"                | institutional channel        |
| "PGA **golf events** in Minneapolis"                       | an event                     |
| "shipped to Elevation Foods **in error**"                  | not a distribution statement |
| "grocery stores mainly in **these cities:** Sunnyvale, …"  | a place list                 |
| "Cleveland and Youngstown, **Ohio** Foodbanks"             | a city in its state          |
| "Army **&** Air Force Exchange Services"                   | half a name                  |

Any such mention disqualifies the name, because a false "Sold at" is worse
than a missing one. Two guards keep that from over-reaching, both driven by
the source's own words: a warehouse mention is ignored when a retail venue
word is named first ("Costco, Foodmaxx, Kroger, Safeway and other retail
stores and distribution centers" keeps all four), and a name is kept outright
when the notice attaches it directly to a venue ("shipped to Costco
distribution centers … and may have been further distributed to **Costco
retail locations**"). "Aldi distribution centers", with no such clause, stays
rejected — the source never said it reached a shop.

The word "Wholesale" alone decides nothing: what follows it does. "C&S
Wholesale **Grocers**" is a supplier; **Costco Wholesale** and **BJ's
Wholesale Club** are shops, and both remain valid.

Known residuals, deliberately not chased: a handful of genuinely ambiguous
consignees the source labels no further ("Bally Produce", "Shapiro Produce",
"Kilduff", "Foodhold", "Cedraui") stay in place, because guessing at an
unstated role is exactly what this layer refuses to do; and truncations of
real chains ("Great Wall Super", "Heinen's Locations", "Texas HEB") name a
real shop imperfectly rather than a wrong one. None can produce a false
preference match, which requires an exact catalog alias.

## Filter contract (recorded pre-C6; since implemented, one dimension open)

This contract was recorded before the filter UI existed so that milestone
could start from settled semantics. **It has since shipped**: C6/C6.1 built
the control hierarchy and the Location and Risk filters, and C10B added
Category — the implementation is
[recall-feed-usability.md](recall-feed-usability.md) ("Control hierarchy
(C6.1)", "Filter model", "Category (C10B)") and `lib/feed-filters.ts`.
Status per clause:

- **`All` and `Affects Me` are mutually exclusive scopes** — implemented.
- **`Location`, `Category` and `Risk` are composable filters** within the
  All scope — implemented (a C6.1 founder decision scoped them to All
  Recalls only; they never apply to Affects Me).
- **Within one filter, selections OR together**: Critical OR High —
  implemented.
- **Between filters, AND**: (Critical OR High) AND (Location = CA) —
  implemented.
- **Applied dimensions stay active while others are added** — implemented.
- **Filter chips scroll horizontally** — implemented.
- **Rated risk values are Critical, High, Moderate, Low, Minimal**, with
  `Pending` and `Not rated` as neutral additional states, never folded into
  a rated value and never inferred from hazard text (`domain/risk-tier.ts`)
  — implemented.
- **Category corpus audit before any UI** — completed: the C10A/C10B audits
  and the founder shipping decision are recorded in
  [recall-food-categories.md](recall-food-categories.md); the launch filter
  uses the derived `productCategories` vocabulary, never `hazardCategory`.
- **Allergen filtering remains TBD** and deliberately unresolved — the one
  filter dimension with no UI. Allergens drive Affects Me eligibility, so
  exposing them as a browsing filter as well needs a product decision about
  whether the two interact or one replaces the other. No allergen filter
  exists in `lib/feed-filters.ts` today.

## Privacy

Preferences are personal data and treated that way: stored in the keychain
locally, readable server-side only by the service role, never logged with
installation ids, never in QA snapshots (QA reports aggregates only), no
analytics or tracking of any kind. `user_id uuid null` exists on the table
for future account ownership; no auth work was done.

## QA

`npm run qa:personalization` (read-only, live DB) reports geography scope
distribution, allergen token coverage and unmapped agents, retailer
canonicalization compatibility (persisted vs display-derived, resolved vs
unresolved, alias and ambiguity proofs), and live Affects-Me coverage for
representative states. C3.2 adds a bounded **ranking diagnostic** for the
representative profile (California · Sesame + Peanuts · Costco + Trader Joe's):
the top 10 recent Affects-me results with product, risk tier, geography reason,
signals, announcement date, material activity date, and the resulting priority
— review material only, never consumer UI — followed by the invariants
(eligibility unchanged by ranking, zero duplicates across sections, zero
excluded cases placed anywhere, the recency delta, All Recalls counts).

Both this report and `npm run qa:feed` (architecture §2.4) measure the same
corpus — `state = active AND merged_into IS NULL`, the client's RLS contract —
so their counts are directly comparable. Before C5.1 this report swept merged
duplicates too, which inflated it to 895 cases against the 882 a phone can
actually see; the two now agree exactly.

Ranking correctness depends on completeness. The lexicographic order is only
meaningful over the whole active corpus: evaluated per server page it would put
lower-priority cards above higher-priority ones purely because they loaded
first. Until C5.1 the client held 500 of 882 cases, so 120 of this profile's
320 qualifying cases could not be ranked at all. `qa:feed` re-derives this
profile's eligibility and section totals from the real loader's output and
gates on them.

The deterministic relevance matrix (nationwide / state match / state exclusion
/ unknown+signal / unknown+none, §-C3 cases A–H) lives in
`src/lib/relevance.test.ts`; the ranking hierarchy and its invariants in
`src/lib/affects-me-ranking.test.ts` and `src/domain/material-activity.test.ts`;
delivery safety (no-backfill, horizons, idempotency) in
`src/server/push/worker.test.ts`.
