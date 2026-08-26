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

## Retailer evidence: one rule, one known gap

Personalization matches on the **persisted** `projection.retailerNames` —
the same field everywhere (feed chips, detail personal lines, push
eligibility), so app and server can never disagree about a decision. The
detail screen's "Where it was sold" section derives richer retailer facts at
render time (store-list blocks, table columns); QA measures the gap
(census 2026-08-26: 283 cases carry display-derivable retailer evidence vs 4
with persisted `retailerNames`, because most stored projections predate the
field). The follow-up that closes it is ingest-time enrichment of
`retailerNames` (re-projection), which lifts every surface through the same
seam at once — deliberately not part of C3.

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
