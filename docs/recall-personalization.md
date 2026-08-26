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
  yields the `tree nuts` token, so a "Tree nuts" preference matches
  specific-nut recalls with zero new inference. Known non-major tokens the
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
  instead of pretending to know geography.
- `reasons`: chip-ready, priority-ordered (allergen, retailer, geography):
  "Your allergen · Sesame", "Sold at Costco", "Affects California",
  "Nationwide recall", "Location not specified". Empty when there is nothing
  personal to say, so no surface ever renders an empty or misleading block.

## Home

Two views: **Affects me** and **All recalls** — All recalls is always one tap
away and personalization never deletes or permanently hides anything. The
default is Affects me once any personalization exists, otherwise All recalls
with a compact "Personalize Recall" CTA (which never requests notification
permission). Within Affects me:

- AFFECTS ME — recent items where `affectsMe` holds, each carrying up to two
  reason chips (risk tier stays in its own badge, visually separate).
- LOCATION NOT SPECIFIED — recent unknown-geography items with no personal
  signal, collapsed behind their own disclosure with honest copy ("these
  notices don't say where products were sold — they may still affect you").
  Never labeled "doesn't affect you". Only shown once a state is chosen.
- OLDER ACTIVE NOTICES — the existing collapsed tier, filtered the same way.

Lifecycle and freshness stay authoritative and untouched: personalization
composes with the existing recent/older tiers, and a closed recall never
looks active because it matches a preference.

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
representative states. The deterministic relevance matrix (nationwide /
state match / state exclusion / unknown+signal / unknown+none, §-C3 cases
A–H) lives in `src/lib/relevance.test.ts`; delivery safety (no-backfill,
horizons, idempotency) in `src/server/push/worker.test.ts`.
