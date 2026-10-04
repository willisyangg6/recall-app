# Onboarding, the hard paywall, and the purchase boundary (P2B7X.1)

_Authoritative home for the first-launch flow, the access gate, the
subscription paywall, the notification education, the purchase-provider
boundary and its development adapter, the retailer-logo pipeline and the
allergen icon set. Personalization's own rules stay in
[recall-personalization.md](recall-personalization.md); push delivery's in
[recall-push-delivery.md](recall-push-delivery.md); the design tokens and each
screen's composition in [../DESIGN.md](../DESIGN.md)._

_Status: **implemented and uncommitted (2026-09-23).** The flow, the gate and
the boundary are real. What is deliberately NOT here is the store: no
RevenueCat SDK, no App Store products, no purchase has ever been made, and
push delivery stays globally inactive. Connecting the real store is
**P2B7X.2** (§10)._

_P2B7Y (2026-09-24): the four-step progress bar and the map-first States
step (§6.1)._

_Grocery-atlas States (2026-09-30, uncommitted): the founder-approved
States composition replaces the map-first step — one static scene, one
search entry opening a chooser, removable chips (§6.1)._

_P2B7Z (2026-09-24, uncommitted): the Allergens step as a two-column grid of
tiles (§6.2)._

_Receipt Stores (2026-09-30, uncommitted): the founder-approved receipt
composition replaces the ten-tile Popular stores (2026-09-24) — six quick
choices on an illustrated grocery receipt that grows upward to hold real
44pt rows, and one `Search all stores` action opening the full-catalog
search sheet (§6.3)._

_Visual polish pass (2026-09-28, uncommitted): the Ready preview is an
image-led overlapping deck of uniform real cards ending on the real fourth
match, frosted (§6.4, `expo-blur` added — §6.9); Stores loses its blue
summary for a quiet count row (§6.3); States' mascot joins the heading
aside (§6.1); the problem screens become visual stories (§6.5); the paywall
gains M04, check-row benefits and a corner `BEST VALUE` tab (§6.7); the
progress segment is final on the first frame except a one-step forward
fill; and the development reset now genuinely restarts the flow (§6.6)._

_Onboarding restructured (2026-09-28, uncommitted): the merged Ready/paywall
presentation is retired. Two problem-framing screens follow Welcome (§6.5),
a one-time "building your watch" interstitial follows Stores (§6.6; the
five-stop watch since 2026-10-02), the
Ready step is the personalized recall preview — the summary card and a
horizontal carousel of real matches — with no purchase UI (§6.4), and the
plans live on a dedicated onboarding paywall (§6.7) built from the shared
purchase flow the 2026-09-27 work created. The progress bar is a full-width
five-segment mark with no visible count. The standalone paywall remains for
a lapsed subscriber. The notification education takes the phone-led
composition of 2026-10-03 (§6.11)._

_Statistic screens (2026-09-28, uncommitted): the two problem screens take
their approved statistic compositions — the 2×3 six-person pictograph and
the approved household illustrations with live-text labels — four
editorial rows since 2026-09-29, superseding the 2×2 grid (§6.5); the
four production illustrations join `assets/brand/production/` with their
audit under `assets/brand/reference/statistics/`._

## 1. The sequence

```
Welcome → Problem: scale (1 of 5) → Problem: stakes (2 of 5)
  → States (3 of 5) → Allergens (4 of 5) → Stores (5 of 5)
  → Building (once; real results, ~7.4s with a usable feed) → Ready
  → the onboarding paywall → purchase or restore success
  → Notification education → Apple's prompt only if the shopper chooses it
  → Feed

A lapsed subscriber (personalization complete, no entitlement):
  → the standalone hard paywall → purchase or restore → the app
```

The rules, each pinned by a test named in §11:

- Five screens carry the segmented progress bar — the two problem screens
  and the three selectors. Welcome, the interstitial, Ready and both
  paywalls draw none, and there is no visible `1 of 5` copy anywhere: the
  count is the bar's spoken label (`Onboarding progress, step 3 of 5`).
- The two problem screens state the CDC's facts verbatim (§6.5), cite
  `Source: CDC` quietly, and never imply that every foodborne illness had a
  recall or that Lotly could have prevented them.
- The Building step is presented exactly once (§6.6): not again when
  returning from Ready or the paywall, not on a relaunch after it
  completed or after Continue to preview, and a kill during it presents it
  again from the real state. It replaces itself with Ready, so it never
  joins the back chain, and it shows a count only from real results.
- States shows one search entry; the jurisdictions are listed only in the
  chooser it opens, and the chooser and the chips edit one draft (§6.1). No
  location permission is asked, no state is inferred, and none is chosen by
  default.
- States requires at least one selection. Continue is disabled with none,
  its reason (`Choose at least one state to continue.`) spoken as its hint,
  and the helper beneath the chips always says `Choose one or more states.`
- Allergens and retailers are optional. An empty selection is a complete
  answer and never blocks Continue.
- `Clear selection` is always in the layout on Allergens. With
  nothing selected it is disabled and its handler is a true no-op, so choosing
  or clearing never moves the rows (the P2B7V rule). Retailers is the
  deliberate exception: its summary, with its count and compact `Clear`,
  exists only while a store is chosen, and the grid moves down once when the
  first is (§6.3).
- The count above the Allergens grid is unconditional (`2 allergens
selected`). States has no list on the step, so no count: its chips sit
  below the one search entry, and a chip added or removed moves nothing a
  finger is on.
- Preferences save progressively through the existing store on every change.
  There is no Done and nothing to lose on a kill: since 2026-10-04 the
  durable local write never waits on the server mirror
  (`src/lib/preference-persistence.ts`), so rapid changes land on the device
  in order within milliseconds and the mirror follows as one coalescing run
  that always sends the newest value.
- Killing and reopening resumes the exact incomplete screen, forwards or
  backwards — the paywall included.
- Ready shows what the watch found (§6.4): up to three REAL current matches
  through the Feed's own matching layer and card (with or without a product
  image) over the corpus the session answered — else the bundled baseline
  of real records under the same rules — or the honest checking or zero
  state. Nothing is ever fabricated, Affects You is always computed, and
  matches beyond the third are locked without exposing anything about them.
- Ready's Back goes to Stores; `Edit preferences` opens the one-page editor
  over Ready (§6.4), which saves only on `Save changes` (Cancel and the
  hardware back are locked for the milliseconds a save is in flight, and a
  save's answer never pops a page that has already gone, 2026-10-04); `See my plan` (and
  the locked strip and card) opens the dedicated onboarding paywall, whose
  Back returns to Ready.
- Personalization is completed by the purchase or restore made on the
  onboarding paywall, in the same commit as the entitlement, so the gate
  goes straight to education — never through the paywall phase or the Feed
  on the way. A kill and relaunch before buying resumes where the shopper
  was.
- Once personalization is complete, an unsubscribed relaunch (a lapsed
  subscriber) opens on the standalone paywall, never Welcome.
- Editing preferences later, from the Ready step or from Profile, never
  resets onboarding or the entitlement.
- Neither paywall offers a close, skip, free, trial or dismiss route. Each
  paywall's one way back is to the Ready step.
- Purchase cancellation or failure leaves the shopper on the paywall with a
  calm inline sentence and every choice kept. Purchase or restore success
  proceeds to notification education.
- A shopper who is already entitled when they reach the onboarding paywall
  (restored elsewhere, or subscribed on another device) is never shown an
  actionable paywall: they meet the entitled panel, whose `Continue`
  completes personalization and opens education. Ready itself stays usable.
- Notification permission is never requested before entitlement success. `Not
now` proceeds to the Feed without asking anything.
- After education is completed once, every later entitled launch opens the
  app directly.
- Expiration returns the shopper to the paywall and preserves preferences,
  saved recalls and every other local datum.
- Push delivery stays globally inactive; the education screen registers a
  device exactly as the Notifications screen does, and nothing is sent.

## 2. The onboarding record

`src/lib/onboarding-state.ts` — a versioned record, kept apart from the
preferences it collects, because completion cannot be inferred from
preference values: a shopper who chose no allergens has the same empty list a
never-onboarded device has.

```ts
{
  version: (2, step, watchBuilt, personalizationCompleted, notificationEducationCompleted);
}
```

| Field                            | Meaning                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `step`                           | The last onboarding screen shown, recorded on focus while personalization is incomplete                                                     |
| `watchBuilt`                     | Sticky. The one-time Building presentation was spent (completed, or left by Continue to preview); never evidence that data succeeded        |
| `personalizationCompleted`       | Sticky. Set with the entitlement by a purchase or restore (or by an entitled shopper's Continue on the onboarding paywall). Never regresses |
| `notificationEducationCompleted` | Sticky. Set by either education choice. Cannot be true while personalization is incomplete                                                  |

Stored as JSON in SecureStore under `recall.onboarding`
(`src/lib/onboarding-store.ts`), beside the preferences, so a reinstall keeps
the shopper's place with their choices. Every read passes through
`sanitizeOnboardingRecord`. A well-formed version-1 record (the four-step
flow this restructure replaced) MIGRATES rather than restarting: its step
names all still exist, so the shopper keeps their place, and `watchBuilt`
is derived — true for a record already on the old Preview or completed, so
nobody is pulled back through the interstitial, false mid-selectors, so
they meet it once on the way forward. Any other value — corrupt, foreign or
future — becomes the initial record: onboarding restarts rather than being
skipped. "Reset app and delete my data" removes the record with the rest of
the local state (§7).

## 3. The access gate

`src/lib/access-gate.ts` resolves ONE phase from the record, the entitlement
and one in-memory flag:

| Phase        | When                                                                                | Lands on                        |
| ------------ | ----------------------------------------------------------------------------------- | ------------------------------- |
| `onboarding` | personalization incomplete, OR complete but the shopper pressed Back on the paywall | the resume step (Ready on Back) |
| `paywall`    | personalization complete, not entitled (a lapsed subscriber)                        | `/paywall`                      |
| `education`  | entitled, education not yet completed                                               | `/onboarding/notifications`     |
| `app`        | entitled and educated                                                               | `(tabs)` — the Feed             |

`reviewingPreview` is the STANDALONE paywall's Back: in memory only, so it
re-enters the onboarding phase on the Ready step without touching
completion, and a relaunch forgets it — a device that completed
personalization without an entitlement always relaunches on the paywall.
(The onboarding paywall needs no such flag: it lives inside the onboarding
phase and Back simply pops to Ready.)

A first-time shopper's personalization is completed by the purchase itself,
on the onboarding paywall: `applyEntitlement` writes the verified
entitlement AND the completed record in one commit, so the gate resolves
from `onboarding` to `education` directly. Completing the record first, on
its own, would resolve to `paywall` for a moment and move the navigator
there; the single commit is what prevents it (`access-gate.test.ts`).

### 3.1 The route matrix, and how it is enforced

Every route file under `src/app` is declared in the root layout inside a
`Stack.Protected` group whose guard is `phase === <its phase>`:

| Group       | Routes                                                                                                                                                                                                              | Mounted in                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| paywall     | `paywall`                                                                                                                                                                                                           | `paywall`                                                                  |
| education   | `onboarding/notifications`                                                                                                                                                                                          | `education`                                                                |
| app         | `(tabs)` (Feed, Saved, Profile), `recall/[id]`, `settings/index`, `settings/personalization`, `settings/notifications`, `document/[slug]`, `report/[id]`                                                            | `app`                                                                      |
| onboarding  | `onboarding/welcome`, `onboarding/problem-scale`, `onboarding/problem-risk`, `onboarding/states`, `onboarding/allergens`, `onboarding/retailers`, `onboarding/building`, `onboarding/preview`, `onboarding/paywall` | `onboarding`                                                               |
| development | `design-preview/index`                                                                                                                                                                                              | every phase of a development build; `app` in a release build (inert there) |

A protected screen is not hidden; Expo Router removes it from the navigator.
React Navigation drops unknown routes when it rehydrates a deep link and
refuses to navigate to a name it does not have, so a tab, a `lotly://` link,
a notification tap, a swipe-back gesture or a relaunch has no screen to reach
outside the current phase. The push-tap handler additionally asks the gate
before navigating (`pushNavigationAllowed`), so a notification is never the
door around the paywall even in principle.

### 3.2 Transitions are state changes, never navigation

When a phase changes underneath the current screen, React Navigation removes
the now-protected routes and lands on the **first declared screen** of the
new phase. The root layout's declaration order is therefore load-bearing and
pinned by `access-gate.test.ts`:

1. the paywall;
2. notification education;
3. the app, `(tabs)` first;
4. onboarding, with the **resume step declared first** (so a relaunch
   mid-onboarding opens on exactly the step that was showing, and Back from
   the standalone paywall opens on Ready);
5. the development hub.

No screen navigates across a phase. A purchase or restore applies the
entitlement and completes the record together; an entitled shopper's
`Continue` on the onboarding paywall completes the record; either education
choice completes the education; expiry changes the entitlement. The gate
does the rest. Within a phase, the steps push and pop as any stack does
(`Back` pops when the previous step is beneath, else replaces with it, so
Back is sequential on a resumed launch too; the last selector's Continue
returns to a Ready beneath it, or reaches a new one through the one-time
building interstitial, which REPLACES itself with Ready so it never joins
the back chain — Back from Ready pops to Stores either way).

The web build has no purchases and no personalization; it answers as already
onboarded and lands on the paywall's unconfigured state, which is its
existing "available in the app" posture.

## 4. Entitlement resolution

`src/lib/entitlement.ts` turns the provider's reading and this device's
cached verification into the one decision the gate acts on:

| Reading       | Cache                                   | Status                    | Cache after |
| ------------- | --------------------------------------- | ------------------------- | ----------- |
| `active`      | any                                     | active, **verified**      | the reading |
| `inactive`    | any                                     | inactive, verified        | cleared     |
| `unavailable` | verified, not lapsed past a 3-day grace | active, **cached**        | kept        |
| `unavailable` | none, or lapsed                         | inactive, **unconfirmed** | kept        |

The invariant is fail-closed: nothing grants access that no verification
established. A first launch that has never been verified meets the paywall's
could-not-confirm state when the store is unreachable; a subscriber this
device verified keeps access through an outage, bounded by the cached
expiry plus `CACHED_ACCESS_GRACE_MS` (three days) so staying offline cannot
keep a cancelled subscription alive. The cache lives in SecureStore under
`recall.entitlement` (`src/lib/entitlement-store.ts`) and is written only
from a verified reading or a successful purchase or restore. It is
deliberately **not** cleared by the data reset: the purchase belongs to the
store account, not to the installation.

The launch reading is bounded (`readWithTimeout`, 4 s): a silent store
counts as `unavailable` and the rule above resolves it safely in both
directions, so launch never hangs on a store. The entitlement is re-read on
every return to the foreground, so an expired subscription meets the paywall
on the next return.

### 4.1 Ordering: the entitlement session (2026-10-04)

The StoreKit sheet backgrounds the app, so the return to the foreground —
and its refresh — overlaps the purchase. The 2026-10-03 audit (F5) found
that a refresh started before the purchase succeeded could land after it
with pre-purchase data and, resolved against its own stale cache snapshot,
revoke the purchase and move an entitled shopper to the lapsed paywall. Every
read, refresh and apply now goes through one **entitlement session**
(`src/lib/entitlement-session.ts`), which orders them with three guards:

1. **A sequence number.** `applyEntitlement` advances it synchronously,
   before anything else. A read that started under an older number is
   discarded whole when it answers — no cache write, no status — whether
   its answer was `inactive`, `unavailable` or the timeout.
2. **A store-operation guard.** The purchase flow runs a purchase or restore
   _and the apply that follows a success_ under `runStoreOperation`. A
   foreground event during it starts no refresh; one runs when it settles,
   and the guard is released in `finally`, so success, cancellation, error
   and a thrown store exception all release it.
3. **Freshness.** An `inactive` reading carries `asOf`, the instant the
   store's data was fetched. `reconcileReading` treats a reading dated
   _before_ the last verified fact (the cache's `verifiedAt`, whether from a
   purchase, a restore or an earlier verified reading) as `unavailable`: it
   says nothing new, so the first refresh after a success cannot revoke it
   with pre-purchase data. A reading dated at or after the verification is
   taken as is — an `inactive` from then on is a real expiry or revocation,
   clears the cache and ends access. A stale _active_ reading is treated the
   same way, so an older record never overwrites the newer one in the cache.
   A reading that cannot be dated against the verified fact (a missing or
   unparseable instant on either side) is neither a fresh confirmation nor a
   fresh revocation: it resolves as `unavailable` too. This adds **no grace
   period**: a stale store falls under the existing cached-access bound, so
   it cannot keep a lapsed subscription alive either.

Cache writes are serialized through one chain in call order, and every read
waits for the chain before loading the cache, so a refresh never resolves
against a cache a pending write is about to replace. The real adapter must
stamp `asOf` and `verifiedAt` from the same store clock —
`CustomerInfo.requestDate`, the instant the store last served that customer
info — and **never from `Date.now()`**: the SDK answers from a cache minutes
old, and dating a cached answer with the device clock would turn
pre-purchase data into a fresh revocation.
`entitlement-session.test.ts` drives all of this with a fake provider whose
every answer the test releases by hand.

`src/hooks/use-access.tsx` is the provider that performs all of this once,
above the stack, and exposes the phase and the transitions.

## 5. The purchase boundary

`src/lib/purchases/purchase-provider.ts` is the typed interface the paywall,
the gate and the education stand on:

```ts
interface PurchaseProvider {
  readonly id: 'unconfigured' | 'development' | 'revenuecat';
  loadOfferings(): Promise<OfferingsResult>; // ready | unavailable | error
  readEntitlement(): Promise<EntitlementReading>; // active | inactive (dated `asOf`) | unavailable
  purchase(pkg: PlanPackage): Promise<PurchaseOutcome>; // success | cancelled | error | unavailable
  restore(): Promise<RestoreOutcome>; // restored | nothing_to_restore | error | unavailable
}
```

- An `Offering` is exactly one annual and one monthly `PlanPackage`, each
  carrying a `StorePrice` — the numeric amount, the ISO currency code, and
  the store's own localized `formatted` string, which is displayed verbatim.
- `annualSavingsPercent` and `monthlyEquivalentAmount` derive the saving and
  the monthly equivalent from the store's amounts. Nothing in product code
  holds a price: `$29.99` and `$4.99` appear only in the development
  adapter's fixtures, and `purchase-provider.test.ts` scans every route and
  component for a dollar amount.
- The anonymous purchase identity is the existing installation id
  (`purchaseIdentity.appUserId` resolves `getOrCreateInstallationId` lazily).
  No account, no sign-in.
- `unconfiguredPurchaseProvider()` answers `unavailable` to everything, which
  the gate resolves to inactive with no cache. It is what a release build runs
  whenever the real provider cannot be constructed (§5.2). **Production
  without a configured provider fails closed.**

### 5.2 The RevenueCat provider (P2B7X.2, 2026-10-04)

The release build's provider is RevenueCat, `react-native-purchases`
**10.11.0** (peer React Native ≥ 0.73; this repo runs 0.86.3 under Expo SDK
57). No config plugin and no extra native configuration: the SDK autolinks
its pod (`RNPurchases` → `PurchasesHybridCommon` 19.5.0). The custom paywall
stays; `react-native-purchases-ui` is deliberately not installed.

Two modules split the work so the mapping is provable in Node:

- `src/lib/purchases/revenuecat-adapter.ts` — SDK-agnostic. Takes a
  five-method `RevenueCatSdk` interface, the public key and the purchase
  identity, and implements `PurchaseProvider`:
  - **Configure once, lazily.** The first call that needs the store resolves
    the installation id and calls `configure({ apiKey, appUserID })`;
    concurrent callers share the one in-flight promise, so the SDK is never
    configured twice. A failed configuration (no identity, SDK refusal) is
    forgotten so the next call retries, and classifies as `unavailable`.
  - **The store's configuration is validated, never assumed.** The CURRENT
    offering (expected `default`) must carry the built-in `annual` and
    `monthly` packages, each selling exactly its Apple product
    (`com.willisyang.lotly.annual`, `com.willisyang.lotly.monthly`) with a
    finite positive `price`, a non-empty `priceString` and a `currencyCode`.
    Anything else is `unavailable`. The paywall receives `priceString`
    verbatim; no price lives in product code.
  - **Readings are dated by the store.** `CustomerInfo.requestDate` becomes
    `verifiedAt` for an active `premium` entitlement and `asOf` for an
    inactive one — **never `Date.now()`**, because the SDK answers from a
    cache up to five minutes old and dating that with the device clock would
    make pre-purchase data look like a fresh revocation (§4.1). A customer
    info with no parseable `requestDate` is `unavailable`. An active
    entitlement for an unknown product, or without a parseable
    `expirationDate`, is `unavailable` too: these are subscriptions, and
    nothing here invents an expiry or grants lifetime access.
  - **A resolved SDK call is not proof of access.** `purchase` buys the
    actual `PurchasesPackage` the offering resolved (re-resolved from the
    store if the plan predates this adapter, `unavailable` if the store no
    longer sells it) and succeeds only when the returned customer info holds
    an active, valid `premium`; a sheet that completes without one is a
    recoverable `error`. `restore` is reached only from the explicit Restore
    Purchases action; an active `premium` is `restored`, none is
    `nothing_to_restore`, an undatable answer is `unavailable`.
  - **Rejections are classified, never trusted.** `userCancelled` or
    `PURCHASE_CANCELLED_ERROR` → `cancelled`; the store-unreachable and
    misconfiguration codes (store problem, network, offline, credentials,
    Apple subscription key, configuration, unsupported, endpoint blocked) →
    `unavailable`; everything else, including a non-SDK throw → `error`.
- `src/lib/purchases/revenuecat-provider.ts` — the native wiring. Binds the
  real SDK and returns the **unconfigured** provider when the platform is not
  iOS, when `EXPO_PUBLIC_REVENUECAT_IOS_KEY` is absent from the build, or
  when the `RNPurchases` native module is not linked. The last check matters:
  without it the SDK falls back to its browser "preview" store in Expo Go,
  which answers purchases, and that must never be a source of access.
  `revenuecat-provider.web.ts` returns the unconfigured provider and imports
  no SDK.

`resolvePurchaseProvider` is unchanged for a development build — the
development adapter and its controls (§5.1) still run in the Simulator and
the Design Preview, so an ordinary preview never touches the live store —
and its release path now constructs the RevenueCat provider with
`purchaseIdentity`. Nothing above the boundary changed: not the gate, the
paywalls, onboarding or the notification education.

The public key is the third `EXPO_PUBLIC_` variable
(`release-exposure.test.ts`, `.env.example`,
[recall-release-readiness.md](recall-release-readiness.md) §2). It is set on
EAS `production`; it is **not** in the local `.env`, so every local export
and compile recorded here ran with the key absent and exercised the
fail-closed path, not the live store.

### 5.1 The development adapter, and why it cannot ship as a bypass

`src/lib/purchases/development-scenarios.ts` is a fake store: a persisted
simulated **account** (whether a subscription exists, under the dev-only
SecureStore key `recall.dev-purchases`, so a relaunch after a simulated
purchase behaves like a real subscriber's) and an in-memory **scenario**
chosen from ten presets — inactive, loading, annual purchase success,
monthly purchase success, user cancellation, purchase error, restore success,
restore finds nothing, temporarily unavailable with a cached active
entitlement, unavailable with no prior entitlement. The scenario resets to
`inactive` on relaunch; the account persists.

Three locks keep it out of a release build, each pinned by test:

1. `resolvePurchaseProvider` (`provider.ts`) reaches it only through a
   `require` inside `if (__DEV__)`. Metro replaces `__DEV__` with a literal
   and folds the dead branch — and the dependency with it. The same holds for
   the development controls the purchase flow hands both paywall routes
   (`src/hooks/use-purchase-flow.tsx`), and the Design Preview's galleries.
   `npx expo export --platform ios` on 2026-09-23 confirmed the release bundle
   contains none of `recall.dev-purchases`, `DEVELOPMENT_PURCHASE_SCENARIOS`,
   `developmentPurchaseProvider`, `Apply scenario` or the long-price fixture,
   while `recall.entitlement`, `Subscribe for` and `Restore Purchases` are
   present. The adapter is **absent**, not merely unreachable. Re-run on
   2026-09-27 after the controls moved into the shared purchase flow, and
   again on 2026-09-28 after the restructure: the five adapter markers and
   `Simulated store` absent; the retired merged copy (`Example match`,
   `View plans`, `Keep your recall watch active.`, `Choose your plan`)
   absent; the problem screens' CDC page URLs absent (they live in comments
   only — the `cdc.gov` strings in the bundle are the hazard guides'
   long-standing official links); the approved carousel target screenshot
   and M05 not bundled; M04, the trust-peek mascot and the three `lock`
   rasters bundled; and the new flow's strings (`Stay ahead of recalls that
affect you.`, `See what affects you today`, `See my plan`, the pill and
   locked-strip copy, the interstitial captions, `1 in 6`, `Source: CDC`,
   `Onboarding progress, step`) present with `recall.entitlement`,
   `Subscribe for` and `Restore Purchases`.
   The clean-capture switch (2026-10-01) lives in the same adapter module,
   in memory and off at every launch; the purchase flow and the Design
   Preview read it through the same `__DEV__` branches, so the 2026-10-01
   export carries none of its names.
2. Every method of the adapter re-checks the development gate and answers
   `unavailable` outside a development build, so even a constructed instance
   is inert.
3. Nothing imports the adapter statically except its own native wiring and
   the development-only controls component, which itself returns null outside
   a development build.

## 6. The screens

Every screen is drawn from the tokens and the shared primitives in one frame
(`src/components/onboarding/onboarding-frame.tsx`): the warm page,
safe-area correct, a top bar with the `chevron-left` back control (44 pt;
absent on Welcome), the full-width segmented progress bar on its own row
when a counted step passes one, the headline in `heading-1` and body in
secondary `body`, and a sticky footer for the actions above a hairline that
lifts with the keyboard on iOS. No fixed height around text, no
`maxFontSizeMultiplier`, no raw colour, no gradient. The paywall's purchase
footer is the one that can outgrow a screen: from the accessibility text
sizes (`paywallFooterPlacement`, text scale 1.5 and up) its renewal
disclosure and four footer actions move to the end of the scrolling
content, directly above the still-sticky primary action, so the plans stay
reachable. (The building interstitial is the one screen outside the frame:
it has no headline, footer or back control by design, §6.6.)
Compositions are in [../DESIGN.md](../DESIGN.md) "Onboarding and paywall".

The copy is the founder's, verbatim, in `src/lib/onboarding-copy.ts` and
`src/lib/paywall-screen.ts`; `onboarding-design.test.ts` and
`paywall-screen.test.ts` pin every string.

| Screen                    | Component                                                    | Route                       |
| ------------------------- | ------------------------------------------------------------ | --------------------------- |
| 1 Welcome                 | `WelcomeContent`                                             | `/onboarding/welcome`       |
| 2 Problem: scale, 1 of 5  | `ProblemScaleStep`                                           | `/onboarding/problem-scale` |
| 3 Problem: stakes, 2 of 5 | `ProblemRiskStep`                                            | `/onboarding/problem-risk`  |
| 4 States, 3 of 5          | `StatesStep` and `StateSearchSheet`                          | `/onboarding/states`        |
| 5 Allergens, 4 of 5       | `AllergensStep`: `AllergenTile` grid                         | `/onboarding/allergens`     |
| 6 Stores, 5 of 5          | `RetailersStep`: the receipt and `RetailerSearchSheet`       | `/onboarding/retailers`     |
| 7 Building your watch     | `BuildingStep` (once; outside the frame)                     | `/onboarding/building`      |
| 8 Ready (the preview)     | `PreviewStep` with `ReadyCarousel`                           | `/onboarding/preview`       |
| 9 Onboarding paywall      | `PaywallPanel` / `EntitledPaywallPanel` over the shared flow | `/onboarding/paywall`       |
| 10 Hard paywall (lapsed)  | `PaywallPanel` over the same flow                            | `/paywall`                  |
| 11 Notification education | `NotificationEducation`                                      | `/onboarding/notifications` |

**Welcome (the receipt composition, 2026-09-29).** The founder-approved
full-screen target
(`assets/brand/reference/lotly-onboarding-welcome-receipt-target.png`) built
natively: the bespoke illustrated-o wordmark
(`assets/brand/production/lotly-wordmark-welcome-receipt.png`, 395×200), the
headline `A closer look at your groceries.` and body `Food recalls
personalized just for you and your household.`, the grocery scene with the
mascot holding the fictional Granola Bites receipt
(`assets/brand/production/lotly-welcome-receipt-scene.png`, 852×920) across
the full width, the native caption `Illustrative example, not a live
recall.`, the source note `Built from FDA and USDA recall notices.`, and
`Get started`. The headline (36pt), body (18pt) and `Get started` (at least
51pt, 18pt label) take the target's sizes and leading on Welcome alone
(fidelity pass, founder-approved); the shared type scale and Button are
unchanged. Both images are the approved bytes, unchanged
(`src/lib/welcome-receipt-assets.test.ts`), drawn whole at their own aspect
ratios on the cream page only. Welcome draws its own page (the scene bleeds
to both edges) but keeps the frame's safe areas, scroll view and sticky
footer. The caption is native text over the scene's quiet counter, at the
target's own caption row, while one line of it fits there; at a larger text
size it moves into the flow under the scene and the page scrolls
(`captionPlacement`, `src/lib/welcome-presentation.ts`, which also holds
every measurement). The receipt's words are part of the artwork: nothing is
overlaid, no live card or recall data is drawn, and its printed bookmark,
flag and pin are not controls. VoiceOver hears seven elements in order: the
wordmark (`Lotly`), the headline, the body, the scene as one image spoken as
its printed notice (`Granola Bites. Critical. Possible Salmonella
contamination. Nationwide. Marked Affects You.`), the caption, the source
note, and `Get started`. Static: no entrance of its own. The earlier Welcome
(M01 peeking over the example card, with its entrance) is retired; the
composition and its measured deviations from the target are in
[../DESIGN.md](../DESIGN.md) "Onboarding and paywall".

**Receipt Welcome assets (prepared and approved 2026-09-29).** The target
(pinned by its manifest's SHA-256) is cut into the two rasters above from
its ORIGINAL pixels. Each is a rectangular crop plus alpha only — exterior
page cream keyed out, edges unmatted against the measured cream, the
mascots' 240–254 and alpha-0 rules, and (hero only) a 40-row lower fade to
the page over original RGB — never resampled or recoloured. The hero keeps
the whole apple and the original counter-to-page fade down to just above
the source sentence; the reference prints the native example caption inside
that fade, so the caption's glyph footprint (7,822 pixels) is the one
interpolated region, making the hero's source a DERIVED asset
(`assets/brand/reference/welcome/source/lotly-welcome-receipt-scene-bottom-repaired-source.png`).
The exact crops are under `assets/brand/reference/welcome/source/`; crop
rectangles, the repair region, operations, pixel counts, hashes and
limitations are in
`assets/brand/reference/welcome/lotly-welcome-receipt-asset-report.json`, with
the two review sheets beside it. None of the reference material is bundled.
The rasters carry no more detail than the 852px-wide target: at 3x they are
drawn about 1.4 device pixels per source pixel.

**Progress (P2B7Y; full-width 2026-09-28).** The five counted screens show
`OnboardingProgress` on its own full-width row under the top bar: five
equal segments, a fixed 6pt mark across the content width, with NO visible
numeric copy. Completed and current segments fill the
`onboarding/progress` token (the personalization lime); the steps ahead
keep the pale `background/subtle` track. It is one accessibility element
spoken `Onboarding progress, step 3 of 5` — the decorative segments are
never separate elements — and its vertical position never changes with
progress. The current segment fills once, briefly, after the screen's push
settles — only when that step was reached FORWARD from the one directly
before it (`segmentFillAnimates`, polish pass) and only when Reduce Motion
is known to be off. Going Back, resuming after a relaunch, or jumping in
from Ready's Edit preferences draws every segment in its final state on
the first frame, so a completed segment never empties and refills. Nothing
ever loops. Welcome, the interstitial,
Ready, both paywalls and the education pass no progress and draw none.

**The example card (no longer drawn).** Until the receipt Welcome
(2026-09-29), Welcome showed one illustrative recall —
Critical, Gummy Products, an undeclared peanut allergen, Nationwide, Affects
You — rendered through the Feed card's own `RecallCardSurface` over a static
model (`src/lib/onboarding-sample.ts`) with a bundled drawing of gummy candy
in the media slot and no save control. It is distinguishable from live data
three ways: the screen labels it (`Example`), its activity
slot reads `Example`, and its brand slot reads `Example, not a live recall`.
It opens nothing, cannot be saved, and needs no network. The shared
`MediaTile` keeps its "official URL or nothing" contract; the example draws
its own tile of the same geometry. The Ready step showed it too, labelled
`Example match`, until 2026-09-27; Ready now previews REAL matches through
the same card surface (§6.4). Since 2026-09-29 no screen draws it; the
component stays for a later decision.

**No copy exception.** Onboarding says `store` everywhere (`Search stores`,
`N stores selected`). The Retailers step's old body (`Choose the retailers
you want Lotly to watch for in recall notices.`) was the one exemption until
the receipt Stores (2026-09-30) replaced it with `Choose the stores where
your household buys food.`; the Preview summary's row label, the second,
became `Stores` with the Ready redesign (§6.4).

**The purchase states** (the Ready step's plans and the paywall share them,
§6.4), mapped by `paywallPresentation`: offering loading,
unavailable or errored; Annual or Monthly selected; purchasing; restoring;
and the notices — cancelled and restore-found-nothing on the calm
information surface, recoverable and unavailable errors on the bordered
alert surface, restore success on the lime success surface, and the
could-not-confirm notice when the gate failed closed. Restore Purchases,
Terms, Privacy and Support are always rendered before a purchase.

**Terms, Privacy, Support** open the typed `RELEASE_DESTINATIONS`
(`src/lib/release-destinations.ts`), all `null` today. An unconfigured
destination shows `This link is not available yet.` on press — never
`example.com`, never a dead link. `npm run qa:launch-readiness` exits
non-zero while any destination is absent or not a valid HTTPS URL on a real
host; the founder supplies them in a commit once they exist
([recall-launch-blockers.md](recall-launch-blockers.md) §1).

**Notification education** is reachable only in the education phase. Its
primary action calls `enableRecallAlerts` — the same single path the
Notifications screen uses, which prompts only when iOS can still ask, and
once. `Not now` calls nothing but the completion. Both choices complete the
education, the gate opens the app, and the Feed shows `Your preferences are
set.` once, in that session, until it loses focus. The composition is
§6.11.

### 6.1 The States step: the grocery atlas (2026-09-30)

**What it is.** The founder-approved composition
(`assets/brand/reference/lotly-onboarding-states-grocery-atlas-target.png`,
853×1844, pinned by its manifest's SHA-256) built natively from ONE
production image and native UI: back and progress (the frame's own
`OnboardingTopBar`), `Make it local.`, `Choose every state where you or your
household buys food.`, the grocery-atlas scene across the full width, one
`Search states` entry, the chosen states as removable chips, `Choose one or
more states.`, and `Continue`. It replaces the P2B7Y map-first step (below),
its Map / List control, Northeast enlargement and insets, the count line,
`Clear selection` and the M02 aside. Composition and measured deviations:
[../DESIGN.md](../DESIGN.md) "States (the grocery atlas)".

**The scene.** `assets/brand/production/lotly-states-grocery-atlas-scene.png`
(853×731, sha256 `a1216e8d…`), a deterministic crop + alpha of the target
(rows 597–1327; exterior cream keyed, edge unmatted, a 12-row counter fade,
every opaque pixel byte-identical to the crop), founder-approved 2026-09-30
and pinned by `src/lib/states-grocery-atlas-assets.test.ts`. Crop,
operations, hashes and the one limitation (the far-left corner's fade is
completed within 12 rows) are in
`assets/brand/reference/states-grocery-atlas/lotly-states-grocery-atlas-asset-report.json`,
with the review sheet beside it; none of it is bundled. The scene is static
and identical for every household: its atlas shows no state or marker, and
nothing about the selection is ever drawn on it. It is decorative — hidden
from assistive technology, touching nothing — and drawn whole with
`contain` at its own aspect ratio, never cropped, tinted or shrunk to fit.

**One draft.** `StatesStep` holds the draft, seeded from the saved
selection; the chooser's rows and the chips toggle it with
`toggleStateCode`, the shared selector's rule, and every change saves
progressively through the route exactly as before. Back, Continue →
Allergens and the resume point are unchanged.

**The chooser** (`StateSearchSheet`) is the Stores search's pattern
(§6.3): React Native's own transparent `Modal` over the dimmed step, the
same backdrop and slide, simply there under Reduce Motion. Its top edge sits
just under the status bar (`chooserTop`), so it owns the viewport while the
shopper searches. It holds `Choose states` with `Close`, the `Search states`
field (focused on opening; named apart from its placeholder), the shared
Check Rows for all 52 jurisdictions alphabetically by full name, and
`Done`. A query matches full names (the shared filter), postal codes
(`NY`, `DC`, `PR`) and `Washington DC` (`searchStateChoices`,
`src/lib/states-presentation.ts`); no match reads `No state matches that
search.`, and what was found is announced as the query changes. Checking a
row never closes the sheet; `Close`, `Done`, the backdrop and Android's
back only close, keeping every choice; the query is forgotten; focus
returns to the search entry.

**Sizes.** States-local and measured against the target with the app's
Public Sans files (`STATES_TYPE`): the headline 50/56 Bold (the target's
308pt of ink in one line; fits an SE's 343pt column), the body 18/23 in a
290pt measure × text scale (the target's break after `or`), the placeholder
16, chips 16 SemiBold, the helper 14/19, and `Continue` 51pt with an 18pt
label, drawn locally with the shared Button's primary and disabled
semantics. The shared type scale and Button are unchanged. Nothing is
capped: no `maxFontSizeMultiplier`, `numberOfLines` or scaling rule; the
page scrolls above the footer and every chip stays reachable.

**Usability pass (founder decisions, 2026-09-30).** At the accessibility
text sizes (text scale 1.5 and up, the app's shared threshold) the headline
uses the standard `display` base, 33pt, still fully scaled by Dynamic Type
(`headlineType`): at 50pt × AX5 its words outgrew the column and broke
inside themselves; at 33pt the longest word fits at every size. There each
chosen state is a full-width row (`chipLayout`), its name wrapping in the
width left beside a separate 44pt `Remove <state>` button; below that
threshold the chips stay the approved pills. On a screen under 700pt tall
(`COMPACT_HEIGHT`, an SE) the vertical gaps tighten (`verticalGaps`) so the
whole search entry is above the footer on arrival at the default size; the
scene keeps its full width and aspect ratio and no default text size
changes. Intrinsic word wrapping that remains: a single word wider than the
whole row still breaks — `Massachusetts` from AX4, `Pennsylvania` at AX5,
and on an SE at AX5 also `Connecticut` and `Washington` (Public Sans
SemiBold 16 × scale against the row's text width, 306pt on iPhone 17 and
279pt on an SE); no name is clipped or truncated.

**Verified on device (2026-09-30, iPhone 17 and iPhone SE 3rd generation
simulators, offline dev bundle).** The accessibility tree reads Back,
`Onboarding progress, step 3 of 5`, the headline (header), the body,
`Search states` (button, with its hint), each `Remove <state>`, the helper
and `Continue`; the scene is absent. The chooser lists all 52 with checked
state; `ny`, `Rhode`, `Conn`, `dc`, `Washington DC` and `pr` each find
their jurisdiction and `zz` shows the empty text; six choices made there
appear as six chips; removing the last chip disables `Continue` (hint
spoken, press inert); a kill and relaunch resumes States with the saved
choices; `Continue` reaches Allergens and Back returns with them kept. With
Reduce Motion on, the chooser appears without its slide and the push into
States is a cross-dissolve; the scene is present on the first frame with no
layout shift. At AX5 everything wraps and scrolls. Before the usability pass the
50pt headline broke inside words at AX5 (and AX4 on an SE) and the search
entry's lowest ~7pt started under the footer on an SE; after it, the AX5
headline wraps only between words on both devices and the SE's search
entry ends 15pt above the footer's hairline at the default size (measured
from screenshots), with the chips and helper a scroll away. VoiceOver listening was not performed (Simulator); the order and
labels above are from the accessibility tree.

**The P2B7Y map (retired from the step).** What follows records the map
that States drew from 2026-09-24 to 2026-09-30. Its code
(`src/components/onboarding/state-map.tsx`, `src/lib/state-map.ts`, the
generated geometry) stays in the tree, unreferenced by the step, and is
still pinned by `src/lib/state-map.test.ts`; removing it is a separate
milestone.

**Geometry.** The US Census Bureau's 2017 cartographic boundary files
(`cb_2017_us_state_*`, public domain as a US government work), via
**us-atlas 3.0.1** (ISC, © Michael Bostock; npm tarball sha1
`367d64e4b31d3f945827710f1a43813c38e17d6b`), vendored with its licence in
`assets/geography-sources/us-atlas/`. `states-albers-10m.json` supplies the
50 states and DC already projected with d3's `geoAlbersUsa`, including its
Alaska and Hawaii insets; Puerto Rico, which that projection omits, comes
from the unprojected `states-10m.json`, projected with the conic equal-area
parameters d3-composite-projections uses for its Puerto Rico inset.
`scripts/build-state-map.ts` generates `src/lib/state-map-geometry.ts`
offline (coordinates rounded to 0.1 projected unit, nothing else
simplified); nothing is traced or drawn by hand, and nothing is fetched at
runtime. All 52 vocabulary entries are on the map, each exactly once, so no
entry is List-only today; any future vocabulary entry without geometry
would still be in List, which is built from the vocabulary alone.

**Rendering.** `react-native-svg` 15.15.4, installed with `npx expo
install` (the Expo SDK 57 version). No mapping SDK, MapKit, Google Maps,
WebView or web content; the reference mock-up image is documentation in
`assets/brand/reference/` and is not bundled.

**Route transitions.** A native stack does not honour Reduce Motion by
itself: onboarding's pushes still slid with the setting on. The root stack
(`src/app/_layout.tsx`) now sets react-native-screens' own `animation:
'fade'` whenever the setting is on, for every route in every phase, and the
platform default otherwise. Recorded on device: with Reduce Motion on,
Welcome → States and Back are cross-dissolves with no lateral movement; with
it off, the normal slide is unchanged; the interactive swipe back still
follows the finger. Until the setting has been read (it is read when the
app starts, well before the first navigation) the default applies.

### 6.2 The Allergens step: a two-column grid (P2B7Z)

**What it is.** The heading, body, `2 of 4` progress and copy are
unchanged. Beneath them, the count line and a compact `Clear selection` in
one row, then the nine consumer allergens (`CONSUMER_ALLERGENS`, in their
catalog order: Peanuts, Tree nuts, Milk, Egg, Wheat, Soy, Sesame, Fish,
Crustacean shellfish) as tiles — each the allergen's Lotly pictogram, its
full name and an explicit checkbox. No mascot. Composition and tokens are in
[../DESIGN.md](../DESIGN.md) "Onboarding and paywall".

**Optional, and still one store.** An empty selection is a complete answer:
Continue is always enabled, with zero or with every allergen. Tapping
anywhere on a tile toggles it through the shared `toggleAllergen`, so
several can be chosen together, a chosen tile deselects, and the saved value
is exactly as before — the canonical tokens, appended in the order chosen —
saved progressively on every change. `Clear selection` is always laid out;
with nothing chosen it is disabled, its handler returns at once, and
`clearAllergens` (`src/lib/allergen-grid.ts`) hands back the same
preferences object for an empty list, so an empty clear sets and saves
nothing (the P2B7V rule). Back, Continue and the resume point are
unchanged.

**The grid adapts deterministically.** `allergenGridColumns(width,
fontScale)` answers two columns only while the widest label word
(`Crustacean`, measured from the bundled Public Sans at 85.2pt in `body`;
`allergen-grid.test.ts` re-measures every label word from the font file)
fits a half-width tile's label line at the reader's text size, and one
column otherwise — always one from the accessibility sizes (text scale 1.5).
Where even a full-width tile's line is narrower than that word (AX4 and AX5
on the 375pt iPhone SE, AX5 on an iPhone 17), `allergenTileStacked` puts the
pictogram and checkbox on the tile's top line and the label beneath at full
width, so the word wraps between words instead of breaking mid-word. The
answer depends on the window alone, so the first frame is final. Text size
is never capped and labels are never truncated; every tile, Clear and
Continue stay reachable by scrolling, and the sticky footer (Continue alone)
never changes height.

**Accessibility.** Each tile is one checkbox element — the full name, the
role, checked or unchecked, one target. The pictogram and the drawn check
are hidden (`accessible={false}`, hidden from the accessibility tree,
`pointerEvents="none"`), so neither is its own element or target. `Clear selection` is a button with the onboarding hint `Unchecks
every allergen.` and a disabled state. The count is one element level with
Clear, so VoiceOver reads the count first. The progress still speaks `Step
2 of 4: Allergens`.

**Motion.** A tile's chosen surface and filled checkbox fade over 150ms,
opacity only — no layout change, no bounce, nothing loops. With Reduce
Motion on, or unknown, the final state is drawn at once. The route
transition is the root stack's, unchanged.

**Pictograms.** The tiles draw the approved Lotly allergen pictogram
family: nine production pictogram assets, the runtime masters directly in
`assets/icons/` as `allergen-<name>-1024.png` (`peanuts`, `tree-nuts`,
`milk`, `egg`, `wheat`, `soy`, `sesame`, `fish`,
`crustacean-shellfish`) — 1024×1024 8-bit RGBA on a transparent canvas,
normalized to one 720px optical bound, tagged sRGB.
`src/lib/allergen-assets.ts` maps each canonical token to its file by
static `require`. Each is drawn whole (`contain`), untinted, in a fixed
44pt box where the art is about 31pt, so every label starts at one x; the
same picture chosen or not, never dimmed or animated — the surface and
checkbox carry the state. No halo, background circle or shadow behind it.
The Lucide allergen glyphs (§9) were not replaced globally: Profile's
allergen rows still draw them, and their sources and rasters are unchanged.

To fit the 44pt box without moving a breakpoint, the box's sides overhang
the tile's padding and the gap beside it by 4pt — less than the 6.5pt of
transparent margin every file has at that size (measured from the files
by `allergen-assets.test.ts`), so only transparent pixels overhang and the
box never overlaps the label. The tile's padding went from 12 to 8 across
and its gaps from 8 to 4, so the row's chrome is still exactly 80pt and
every column and stacking threshold above is unchanged.

**Alpha repair (2026-09-24).** As delivered, the drawings' bodies sat at
alpha 250–254 rather than 255, the same flaw the mascots had. All nine
carry the mascots' mechanical repair: clear pixels hold no colour, alpha
240–254 is lifted to 255 with RGB untouched, the soft edge (1–239) keeps its
alpha and is unmatted against white, and the embedded `sRGB built-in` ICC
profile is replaced by an explicit `sRGB` chunk. Dimensions, clear-pixel
positions, the drawing's bounds and the RGB of every pixel that was at 240
or above are unchanged; `allergen-assets.test.ts` pins each against digests
of the originals (whose SHA-256s are in `source-pack-asset-report.json`).

**Tree-nuts pinhole fill (2026-09-24, founder-approved).** Where the tree
nuts' almond, cashew and walnut outlines meet, the pack had keyed a small
triangle out as background: one enclosed non-opaque component of 166
pixels (36 clear, 130 translucent; x 497–513, y 456–473; about 0.7pt in the
tile). Exactly those pixels — not their bounding box — were set to
`(1, 37, 71, 255)`, the dominant colour of the solid outline around them
(the first ring distance with a single most common colour, and still the most common further out);
every other pixel is byte-identical. The test pins the component as an
exact mask, so the fill cannot grow, move or reopen, and all nine
pictograms must have no enclosed transparent or translucent hole.
`assets/brand/reference/allergens/production-asset-report.json` records
the final repository files (SHA-256, dimensions, PNG type, sRGB, alpha
counts, bounds, enclosed holes), and the test checks it against them;
`source-pack-asset-report.json` is the pack's own report of the unrepaired
files it delivered, kept byte-for-byte under that name.

**Pictograms verified on device (2026-09-24).** iPhone 17 at the default
size: two columns, every tile its own pictogram, sharp and untinted on the
open and the chosen surface; choosing Peanuts and Tree nuts, then a mixed
seven, and `Clear selection` leave every tile's frame and Continue's frame
identical; Clear disables when empty; Continue advances with none and with
two; Back and a killed-app relaunch return with the choices; each tile is
still one element (`Peanuts, checkbox, checked`) with nothing inside it in
the accessibility tree. iPhone SE (3rd generation): two columns at the
default size with `Crustacean` whole, one column at xLarge, stacked tiles
at AX-XXXL, Continue reachable in all three. VoiceOver speech itself was not
listened to; the tree was read directly.

**Grid verified on device (2026-09-24, before the pictograms).** Through
the iOS accessibility tree:
iPhone 17 at the default size is two columns; choosing Peanuts, then Tree
nuts, deselecting one, `Clear selection` and an empty clear leave every
tile's frame and Continue's frame identical to the point; Continue with
none and with two advances to Stores, Back returns with the choices intact,
and a killed app resumes on Allergens with them. iPhone SE (3rd generation):
two columns at the default size with `Crustacean` whole; one column at
xLarge; one column of stacked tiles at AX-XXXL, where the count box keeps
its height across 2, 1 and 0 choices, so the grid does not move. A recorded
selection fades through intermediate frames with Reduce Motion off and
lands at once with it on.

**Reference.** The approved mock-up
(`assets/brand/reference/lotly-onboarding-allergens-grid-target.png`) and
the pictogram pack's review artifacts
(`assets/brand/reference/allergens/production-contact-sheet.png`,
`source-pack-asset-report.json` and `production-asset-report.json`) are
documentation only; nothing imports them and the
iOS export does not contain them.

**Deferred.** The paywall and the notification education keep their
P2B7X.1 content; only the shared progress bar reached them. Their redesigns
are later milestones. Retailers was redesigned next (§6.3), then the Preview
(§6.4).

### 6.3 The Stores step: the receipt (2026-09-30)

**What it is.** The founder-approved composition
(`assets/brand/reference/lotly-onboarding-stores-receipt-target.png`, 934px
wide, pinned by its manifest's SHA-256) built natively from THREE production
layers and native UI: back and progress (the frame's own
`OnboardingTopBar`, spoken `Step 5 of 5`), `Your regulars.`, `Choose the
stores where your household buys food.`, the illustration across the full
width — the mascot holding a grocery receipt, a produce bag, a towel — with
the receipt's contents native, and `Continue`. It replaces the Popular
stores step of 2026-09-24: its ten tiles, its `Not listed? Search all stores`
field and the M03 aside. There is no top search field, no `See more` or
`Show fewer`, and no inline expansion. Composition, type and colours:
[../DESIGN.md](../DESIGN.md) "Stores (the receipt)"; measurements and rules:
`src/lib/stores-receipt-presentation.ts`.

**The layers.** `assets/brand/production/lotly-stores-receipt-scene.png`
(934×1032: backdrop, mascot, table, bag, towel, transparent where the
receipt covers it), `…-paper.png` (579×863: the blank receipt, every
printed label, rule and checkbox removed and its paper restored) and
`…-overlap.png` (113×483: the glove and two lime rays, with the shadows they
cast on the paper), founder-approved 2026-09-30 and pinned byte-for-byte by
`src/lib/stores-receipt-assets.test.ts` against
`assets/brand/reference/stores-receipt/lotly-stores-receipt-asset-report.json`
(offsets, slices, hashes, repair footprints, limits; with its review sheets;
none of it bundled). All three draw at ONE scale, the page width over 934,
so the mascot and food are never stretched. They are decorative: hidden
from assistive technology, touching nothing, static.

**A receipt that grows upward.** The target's rows are 38pt apart at 402pt,
too close for 44pt targets, so the paper grows instead of the targets
shrinking. Its contents lay out at their real size — every row at least
44pt, at the reader's text size — and the paper takes whatever height they
need: its bottom stays anchored to the scene (the teeth, the table shadows
and the glove's grip never move) and one slice of quiet paper (paper rows
32–356) stretches, lifting the torn top. The illustration reserves that
height in the page's flow, so the scene moves down and the receipt never
meets the headline; the founder approved the top rising above the blue
backdrop onto the page. The paper is never shorter than exported: the
scene is transparent exactly where the receipt covers it, because nothing
hidden behind the receipt was invented. Growing downward is not supported —
the receipt flares toward its foot, so it would expose scenery that does not
exist (asset report). On iPhone 17 at the default size the receipt grows
about 45pt; on the SE, where the page then scrolls above the footer, about
67pt.

**The receipt.** Top to bottom: `Popular stores` (a header); the count row;
seven dashed rules around six quick choices, in this curated order —
Walmart (`walmart`), Costco (`costco`), Kroger (`kroger`), Aldi (`aldi`),
Target (`target`), Trader Joe's (`trader-joes`); and `Search all stores`.
The ids live once, in `POPULAR_RETAILER_IDS` (`src/lib/retailer-grid.ts`),
and resolve to the catalog's own records. The order is a curation, not a
ranking: nothing claims size, sales or nearness, and the six are the same
for every shopper. Fewer quick choices is not less coverage: Sam's Club,
Safeway, Publix, Ralphs and every other store of the unchanged 77 are one
search away (`retailer-grid.test.ts` finds each by name). Each quick choice
is ONE checkbox element — the canonical name, checked or not, the whole
row its target — with the shared Check Row indicator hidden inside it.
`Search all stores` is blue text and a blue magnifier across the whole row:
a button, with no box, field or chevron. No retailer logo, wordmark, brand
colour, monogram or glyph ([retailer-logo-source-audit.md](retailer-logo-source-audit.md);
§8).

**The count row.** `2 selected` (spoken `2 stores selected`) and `Clear`,
with no surface. It reads the whole saved selection, so a store chosen
through the search is counted though no row shows it, and `Clear` removes
those too. Its slot is permanently allocated (the P2B7V rule): with nothing
chosen it is invisible and out of the accessibility tree, so the first
choice or the last clear never moves the rows. `Clear`'s 44pt target comes
from hitSlop, and the gap beneath the row keeps it clear of Walmart's.

**Accessibility sizes: stacked.** From text scale 1.5 the receipt's column
cannot hold a name word, so the step stacks: the illustration drawn whole
with its receipt blank and unstretched (all three layers — the scene cannot
render alone), then the paper alone at the page's content width holding the
receipt, with wider insets. That receipt spreads its growth over its whole
quiet body (paper rows 32–830), which keeps the paper's grain within about
2.5× at AX5 where one slice would streak it. The headline takes the
`heading-2` base (23pt) and the receipt heading `heading-3`, both still
scaled by the reader's setting. Nothing caps Dynamic Type; names wrap
between words. Intrinsic limit: on the 375pt SE at AX5 the headline's final
period wraps alone under `regulars` (352.8pt of word in a 343pt column).

**The search sheet.** `RetailerSearchSheet`
(`src/components/onboarding/retailer-search-sheet.tsx`) is React Native's
transparent `Modal` drawing its own backdrop and sheet, with no dependency.
The app's `SelectorSheet` was not reused: it is iOS's page sheet, nearly
full height and pushing the screen behind it back, where this search is a
contextual layer over a step that must stay exactly where it was. The step
stays mounted, dimmed by a full-screen backdrop, and, being under a modal,
takes no touch and is hidden from assistive technology. The sheet's top edge
is `searchSheetTop` (`src/lib/retailer-grid.ts`), a function of the window
height, the top safe area and the text size alone, so the query, the result
count and the keyboard never resize it. In order it holds a decorative drag
indicator, `Search all stores` (a header) with `Close`, the Search Bar
(placeholder and label `Search stores`, autofocused so the keyboard is up at
once, with the Search Bar's `Clear search` while there is text), the results
region, and `Done` pinned at the bottom. With the keyboard up, `Done` is
under the keyboard and the results region insets itself
(`automaticallyAdjustKeyboardInsets`) so every row can still be scrolled
into view above it; dragging the results or pressing the keyboard's search
key puts the keyboard away and `Done` is there.

A query is matched by `retailerSearchResults` (`src/lib/retailer-grid.ts`):
the catalog's own `searchRetailers` over all 77 canonical records — case-,
punctuation- and surrounding-whitespace-insensitive, on name and aliases,
results in name order — except that an empty, blank or punctuation-only
query is no search at all: the region shows `Search the complete store
list.`, never the whole catalog. Matches are single-column rows
(`RetailerResultRow`), the name and the checkbox at the trailing edge;
with no match, the region is one line, `No stores found.` Only the region's content changes as the
shopper types; it scrolls inside itself.

The one-page editor opens this same sheet in its catalog form, which lists
the whole catalog before a query (§6.4). The Stores step never passes it.

Choosing a result checks it at once and keeps the sheet, keyboard and query
for the next. `Close`, `Done`, a tap on the dimmed step and Android's back
all do one thing: put the keyboard away and close, keeping every choice —
`Done` commits nothing, because every choice was already saved. The query
lives in the sheet's contents, which mount with each opening and unmount
with each close, so it starts blank every time and on every launch, and it
never reaches the step, the route or the preference store. When the sheet
has gone, VoiceOver focus returns to `Search all stores`. The shared
`StoreSelectorContent` is not mounted by onboarding; the Profile store sheet
uses it unchanged.

**One selection.** The step holds no draft. Every row, search result and
`Clear` goes through the route's `onToggle` / `onClear`, which save
progressively through the one preference store exactly as before
(`toggleRetailer`; `clearRetailers` hands back the same preferences object
for an empty list, so an empty clear saves nothing). A store chosen on the
receipt or in the sheet is checked in both places and counted at once —
behind the sheet too, while it is open. When the sheet has gone, focus
returns to `Search all stores`. Continue is always enabled; Back
(Allergens), Continue (the one-time building interstitial, then Ready;
straight to Ready once it has played, or back to Ready when editing from
it), the route and the resume point are unchanged. No schema, storage shape
or backend changed.

**Accessibility.** The illustration is not in the tree. `Popular stores`
is a header; the count reads `N stores selected` before `Clear`, which says
`Unchecks every store.`; each quick choice is one checkbox element;
`Search all stores` is a button with the hint that it opens a search of the
complete store list. The sheet is `accessibilityViewIsModal` inside a
`Modal`, so the step behind leaves the tree while it is open; there
`Search all stores` is a header, the field is `Search stores`, `Close` and
`Done` say `Closes the search. Your choices are kept.`, and what a search
found is announced once per change (`7 stores found.`, `No stores
found.`). Every target is at least 44pt and none overlaps another.

**Motion.** None of its own: the art is static and has no entrance. A
row's checkbox fades over 150ms (opacity only); the sheet slides as
described above; under Reduce Motion, or while that setting is unknown,
both are simply there.

**Verified on device (2026-09-30).** Through the iOS accessibility tree,
screenshots, pixel comparison and recorded video, on the review simulator
(iPhone 17, 402pt) and the QA iPhone SE (3rd generation). The tree reads
Back, `Onboarding progress, step 5 of 5`, the headline, the body, `Popular
stores`, (the count and `Clear` once something is chosen), the six
checkboxes, `Search all stores` and `Continue`, with no image in it. Rows
are 44pt on a 46pt pitch. Walmart and Costco checked read `2 stores
selected` and moved nothing. `Search all stores` opened the sheet with the
field focused; `wegm` found Wegmans, `sam` Sam's Club, `zzqq` `No stores
found.`; choosing Wegmans made `3 stores selected`; a quick toggle after the
search made 4; reopening showed Wegmans checked and a blank field; `Close`
and `Done` kept every choice; `Clear` removed all four including Wegmans and
returned the screen to within 3 units of the untouched one (the development
tools button and ±1 compositing only). Aldi and Wegmans reached Ready
(`Stores: Aldi and Wegmans`), came back with Back and survived a kill and
relaunch; Back from Stores reached Allergens (`step 4 of 5`). From a reset
record, Continue played the building interstitial (`Watching the stores
you chose`) and then Ready; with it played, Continue went straight to
Ready. Video: with Reduce Motion off the checkbox fades over about 170ms;
with it on it changes between one frame and the next. The SE at the default
size scrolls the search action above the footer; iPhone 17 and the SE at
AX5 stack as described, every row reachable. VoiceOver speech was not
listened to: focus return is in code, not heard.

**Reference.** The approved mock-ups
(`assets/brand/reference/lotly-onboarding-stores-receipt-target.png` and the
earlier `lotly-onboarding-retailers-popular-grid-target.png`) are
documentation only: no source or config file references them
(`onboarding-design.test.ts`, `stores-receipt-assets.test.ts`).

### 6.4 The Ready step: the preference board (2026-09-30)

The founder-approved target is
`assets/brand/reference/lotly-onboarding-ready-preference-board-target.png`,
a design reference that nothing bundles (§11). Ready shows the saved
preferences on a physical board in the approved grocery scene, then what the
watch found. It sells nothing. From the top:

1. **The top bar:** Back (to Stores). No progress bar.
2. **The headline:** `You’re all set.`, Bold 34pt (Ready-local; from text
   scale 1.5 the `heading-2` base, still scaled). No line beneath it.
3. **The scene:** full width, with the board and the seated waving mascot
   (below). The board holds `Your preferences`, the States, Allergens and
   Stores rows, and the blue `Edit preferences`.
4. **The preview heading:** `Your recall preview` (Bold 25pt, a real
   header), then one muted `body` sentence counting every real match:
   `We found 21 recalls for you.` (`We found 1 recall for you.`). Only the
   number is emphasised, in Bold primary ink; it is not a pill or a button,
   and it never says `today`. The count is absent in every other state.
5. **The deck and its dots** (below), or the state's own card (see "Four
   states").
6. **The locked strip or the monitoring line:** the soft-blue locked strip
   only when more real matches exist than the deck shows; otherwise the
   truthful monitoring line. Never under an example deck.
7. **The footer:** `See my plan`, pinned, opening the separate onboarding
   paywall (§6.7).

The checking, could-not-check and nothing-matches states draw no count, no
deck and no dots. One quiet card says exactly what is known.

**The layers.** The approved composition was decomposed into a scene, a
blank board and a foreground overlap (the mascot, bowl and cloth where they
stand in front of the board). All three are drawn at one scale, the page
width over 934. The layer files are:

- `assets/brand/production/lotly-ready-preference-board-scene.png`
- `assets/brand/production/lotly-ready-preference-board-paper.png`
- `assets/brand/production/lotly-ready-preference-board-overlap.png`

Their offsets, the content-safe rectangle and the growth rules are the
founder-approved asset report's,
`assets/brand/reference/ready-preference-board/lotly-ready-preference-board-asset-report.json`.
`ready-board-assets.test.ts` pins the bytes and the placement to it.

The order is: page, scene, board, native rows, overlap. So the mascot, bowl
and cloth always stand in front, and no row can reach them: the rows sit in
the report's content-safe rectangle (target x 173–534, y 264–679), 152pt
wide at 393pt. The soft shadows painted on the board stay where they were
photographed. The layers are decorative: hidden from assistive technology
and untouchable.

**Two boards, chosen by fit (2026-10-02).** Every preference and
`Edit preferences` are always on illustrated paper. The founder rejected the
separate full-width preferences card in every case, so there is none. Text
is never shrunk, capped or truncated beyond the compact summary rule, and
the page scrolls.

- **The compact board** (the approved composition above) is used when the
  native block fits its content-safe column within the approved +80
  source-pixel growth with every word whole. It grows upward through one
  slice of blank paper (target rows 346–399) and, by the same amount, one
  thin band of out-of-focus wall (rows 244–247). The board's foot, painted
  shadows, food, cloth and mascot never move or stretch.
- **The wide board** is used otherwise. It is the founder-approved broader
  composition
  (`assets/brand/reference/lotly-onboarding-ready-wide-board-target.png`).
  The native block sits above the mascot and groceries, which overlap only
  a blank bottom margin of the paper. Its layers are
  `assets/brand/production/lotly-ready-wide-board-*.png`: the scene, the
  blank paper and the foreground overlap, plus paper and wall extension
  plates and their feathers. Their offsets, text region and growth rules
  are the asset report's,
  `assets/brand/reference/ready-wide-board/lotly-ready-wide-board-asset-report.json`;
  `ready-wide-board-assets.test.ts` pins the bytes and the placement.
- **The wide text region.** The block starts at board pixels x 134, row
  265, and is 719px wide: 289pt on the SE and 310pt on iPhone 17. The
  heading is limited to 648px so it stays 8px clear of the lime ribbon
  beside it.
- **How far it may run (2026-10-03).** This is not a rectangle. The hidden
  measurement reports where every drawn piece of the block sits: each line
  of text, each plate, each dashed rule and `Edit preferences`. The board
  grows (`wideGrowth`) just enough that each piece clears the foreground
  directly beneath it. The clearance is 16 source pixels below and 8 to the
  side, measured against `WIDE_FOREGROUND_TOP_PX`, the overlap's own top per
  8px column (re-derived from the PNG by `ready-wide-board-assets.test.ts`).
  Where nothing stands in front, only the board's foot holds a piece, 14px
  above it. A full-width line is held by the mascot's rays; a short
  `Edit preferences` over the empty middle of the board can sit lower.
  - For the long QA summary at the default size this made the wide scene
    24.5pt shorter on the SE and 26.3pt shorter on iPhone 17 than the
    earlier rectangular region.
- **Wide growth.** The board grows upward without limit. New rows go in at
  target row 470, where each layer draws its 1,200-row extension plate.
  Each plate is real paper or wall texture, quilted, never stretched, and
  repeats mirrored only past its own height. A 24-row feather cross-fades
  each plate back into the original. Everything below the row, the
  foreground included, moves down together.
- **Plates on the wide board** sit beside the words, unless that breaks
  more words than putting them above.
- **The choice** (`boardTemplate`) comes from a hidden, unheard,
  untouchable measurement of the block three ways: compact, wide with the
  plates beside the words, and wide with them above. Each text reports its
  broken words (`brokenWordCount`), and the wide copies also report their
  pieces. The measurement is keyed by this content, width and text size.
  After an edit, the last board stays until the new content is measured.
- **No jump and no text without its art on arrival.** The page is laid out
  but not shown until the choice is made AND every image of the chosen
  board has loaded or failed (`heroImageCount`, each `Image`'s
  `onLoadEnd`). It waits on no timer, and Building's timing is untouched.
  The compact board is mounted from the first frame, as before, so its
  pixels are unchanged; the wide board mounts once chosen.
  - Measurement wrappers exist only in the hidden copies, so the visible
    texts keep their original view tree and antialiasing.

Verified natively on 2026-10-02 on iPhone SE and iPhone 17, with short,
long and no-optional-choice QA profiles, from the default size through
AX5:

- Short summaries keep the compact board at the default size.
- The long summary takes the wide board, with its store row in two lines at
  the default size and no word broken through AX1.
- The text never meets the mascot, food or ribbon.

Rechecked on 2026-10-03:

- The "two States rows" in the AX5 full-board sheets were adjacent scroll
  captures: one frame ends on States and the next, scrolled down, starts
  with it. Each frame draws it once, and the accessibility tree holds
  exactly one States, Allergens and Stores row, one heading and one
  `Edit preferences` on both phones.
- In a release build on an isolated simulator, Building → Ready showed the
  board art with the text from the first frame of the slide, both with and
  without the artwork gate. The text-first frame was the development
  server's image loading; the gate makes the order certain anyway.
  - That build's backend went through a read-only proxy, so no preference
    write reached the server.

Two limits remain:

- From AX3 on the SE (AX4 on iPhone 17), a single word such as
  `Massachusetts,` can be wider than the whole text region, and iOS breaks
  it.
- Each foreground layer's alpha edge renders a faint light hairline at
  3–4× contrast (about 11 levels) on the device. The compact board shows
  the same thing; the files themselves recompose exactly.

**The measured constraint (2026-10-01).** The founder asked for 14pt labels
and 16pt values. The labels fit, but 16pt values do not fit the approved
board within the +80px cap:

- At 402pt the text column beside the 34pt plate is 110pt wide. At 16pt,
  `Alabama, Arizona` is 130pt and `Wheat, Sesame` is 115.5pt, so both wrap.
  Even the single word `Massachusetts,` (115.5pt) is wider than the column.
- Natively, the founder's QA profile measured 245pt of board content at 16pt
  values against the 213pt the capped board holds. That is 32pt over, about
  154 source pixels of growth against the cap's 80.
- The shipped values are therefore 15pt, the largest size that keeps that
  profile on the compact board on iPhone 17. (Since 2026-10-02 longer
  content takes the wide board, so the cap no longer forces the size; the
  type is kept at 15pt so layout and typography do not change together.)

The proposal is a re-authored taller board, not a further stretch. At 16pt
values with 8pt rule spacing, a row that wraps adds 21pt, and the content
measures:

| Rows that wrap | Content |
| -------------- | ------- |
| 0              | 200pt   |
| 1              | 221pt   |
| 2              | 242pt   |
| 3              | 263pt   |

Holding two wrapped rows needs about 147 source pixels of growth on iPhone
17 and about 188 on the SE. Three wrapped rows need about 240 on the SE.
Making that growth from a new, longer quiet paper section, plus the matching
wall, means a board of about 700 source pixels instead of 458. The cost on
iPhone 17 is that the deck's dots move about 30pt below the fold.

**The rows.** Each row has:

- a 34pt plate (the soft blue under a white wash), holding the `map-pin`
  glyph, the `shopping-cart` glyph, or the allergen pictograms;
- the label in title case, `States`, `Allergens` and `Stores`, exactly as
  spoken. It is Public Sans SemiBold 14pt (`body-small-bold` at Ready's
  size) with normal letter spacing; the 10pt spaced capitals were retired
  on 2026-10-01.
- the value at 15pt, Regular: the SAVED choice through Profile's compact
  rule (two names, then `+N`), or `None` for an empty optional group. The
  `+N` is joined to the last name by a no-break space, so it wraps with
  that name and never sits alone on a line.
- dashed rules between the rows, 6pt above and below (4pt before
  2026-10-01).

The Allergens plate draws the first two chosen pictograms, untinted and in
canonical order. One choice draws one pictogram, and none draws the neutral
dash. The rest are named in the text.

Each row is one accessibility element that speaks every chosen name
(`States: Alabama, Arizona and California`). `Edit preferences` is blue
`action/secondary` text with a chevron, a 44pt target through hitSlop. It
presents the one-page editor (below) and never replays the steps. When the
editor closes, focus returns to it.

**The preview data** is unchanged: `src/lib/ready-preview.ts`, the Feed's
own layers in the Feed's own order:

- the shared feed session (`useFeed`);
- `evaluatePersonalRelevance`;
- `buildAffectsMeSections`, the current Affects Me ordering;
- `buildHomeCardModel` for each shown item;
- the first three ranked matches as the readable cards, imaged or not (the
  image-led narrowing of the polish pass is retired, 2026-10-04: a match
  without a product image draws the card's own text-led shape, as the Feed
  does, so a count can never stand beside an empty deck), with the real
  next match as the locked card.

The deck shows up to three readable matches, and the locked final card only
when a real next match exists. The strip shows only when more real matches
exist than the deck shows; one match is one card, no strip, nothing locked.
From the accessibility text sizes the card's media sits ABOVE its text
(`RecallCardSurface`'s `mediaPlacement`, used by the deck alone), so a title
is never squeezed into the column beside the tile and broken mid-word.

**One experience over three sources (founder override, 2026-10-04).** Ready
looks and behaves the same whether its corpus was just downloaded, is the
device's cached copy, or is the bundled baseline: `Your recall preview`,
`We found N recalls for you.` with N bold, the card stack and dots, the
locked strip only when more genuine matches exist, and `See my plan`. There
is no fallback-specific notice, heading or action — no saved-results banner,
no last-checked time, no Try again, no example deck, no connection-error
panel. The corpus is chosen by `lib/ready-preview.ts` `readyCorpus`, which
the Building step calls too, so their counts agree:

1. the feed the shared session answered — a finished sync, or the cached
   corpus `useFeed` serves first (the cached-offline case);
2. else, when the session could not answer at all (a fresh install with no
   network), the bundled baseline (`lib/baseline-recalls.ts`): real, verified
   recall records recorded from the public feed by one rule — every active,
   unmerged case whose material activity was within the Affects Me recency
   window at recording time — with each case's detail rows, through the SAME
   matching, lifecycle and recency rules. Dates, hazards, locations and
   identities are the agencies' own; Affects You is computed, never stored;
   N is the genuine match count over that corpus; nothing is manufactured.

The choice is remembered in the process so Ready, mounting while the quiet
retry is still failing, shows exactly the corpus Building counted; it is
forgotten the moment a sync succeeds, and live results replace the baseline
with the genuine corpus and its actual count (the deck remounts on new
content as it always did). The retry is the shared feed path alone —
`useFeed`'s mount and foreground revalidation — and Ready asks the network
for nothing itself. A recall shown from the baseline always opens: Recall
Detail renders the bundled detail when the live row cannot be fetched or no
longer exists.

`lib/ready-preview.ts` then builds one of three states:

- `matches` — above. The count is every current match: a recall whose
  stated geography names a chosen state or is Nationwide (which qualifies
  for every state, whatever the hazard), or whose geography is unknown but
  carries a chosen allergen or store signal, within the Affects Me recency
  window, less the one allergen-only exclusion (an identified allergen-only
  recall is withheld from a shopper who chose none of its allergens,
  including a shopper who chose no allergens; `ready-count.test.ts`).
- `none` — the check answered and nothing currently matches:
  `No matching recalls right now.` and the monitoring line, no cards,
  nothing locked. A defensive state: with a healthy corpus Nationwide
  recalls make it rare, so an unexpected zero is investigated as a data or
  loading problem, never papered over with a positive count.
- `checking` — the first read has not answered; nothing is claimed.

**The baseline ages.** The recency window is measured against the device's
clock, so a baseline recorded on its `recordedAt` holds fewer current
matches each day and none once it is older than the window (60 days): a
fresh install offline then meets the truthful `none`. Re-record before each
release with `npm run record:baseline` (read-only: public GETs under the
publishable key, writing only `src/content/baseline-recalls.json`), and
`npm run qa:launch-readiness` FAILS while the shipped baseline is past the
window (`baselineReadinessFailures`) — a hard gate, not a warning. The
baseline is read and matched, never written to the feed cache or the session,
and a session answer always replaces it. Recorded 2026-10-04 04:13 UTC: 64
cases (16 Nationwide, of which 13 qualify for a no-allergen profile and 3 are
identified allergen-only), ~0.73 MB of JSON in the bundle (`summaryHtml`
dropped), approved by the founder 2026-10-04.

The count is now `previewMatchCount`, the true total of every match. The
previous pill counted the deck's readable cards whenever any existed, so a
watch with 20 matches read `3`; that is fixed. A saved edit recomputes the
preview at once from the same feed and the new preferences. The feed is not
per-preference, so no stale response can overwrite the new choices.

**What the count counts** (traced 2026-10-01). The number in
`We found N recalls for you.` is exactly the length of the Feed's own
Affects Me list for the saved preferences. It updates with the preferences,
the feed data and the recency window:

- **Source.** The current feed (`fetchCurrentFeed`): every `active` recall
  case, one row per `recall_cases.id`, FDA and FSIS together.
- **Identity.** One case is one match, so a recall is never counted twice,
  whatever its number of notices or products.
- **Filter.** `buildAffectsMeSections`: the case is personally relevant
  (`evaluatePersonalRelevance`: a chosen state or nationwide, a chosen
  allergen, or a chosen store) AND its last material activity falls in the
  Feed's 60-day window (`RECENT_WINDOW_DAYS`). Older relevant cases are the
  Feed's tail and are not counted here.
- **Not a factor.** Images, the three readable cards, the locked card and
  the deck's pages never change the total; they only choose what is drawn.

On 2026-10-01, for Alabama and Arizona, Peanuts and Milk, and Aldi, the feed
held 905 active cases, 274 personally relevant, 21 of them inside the
window (16 with images). Ready read 21, with 3 readable cards and a locked
fourth. The figure moves day to day as cases enter and
leave the window, so it is never a fixed expectation.

**A card without its category chip is intentional.** A deck card shows the
Feed's category chip only for a launch category (`cardCategoryLabel` →
`sanitizeLaunchCategoryIds`). A case whose only category is launch-hidden
(`prepared_foods`, `supplements`, `other`) shows none, exactly as in the
Feed, and leaves no empty slot. The Black Sesame recall (`prepared_foods`)
and Moringa Leaf Powder are such cases. It is a policy omission, not missing
data or a rendering defect.

**Deck cards group their content as the Feed does** (the Moringa
correction, 2026-10-01). The uniform variant used to reserve a two-line
title, a category row and a two-line reason. A short card such as Moringa
Leaf Powder therefore showed an empty line between its name and
`Foods Alive`, and an empty chip row before the hazard. Now:

- The variant reserves only the status row. Its line limits are the title
  (2), the brand (1) and the reason (2), and VoiceOver still speaks every
  full text.
- The brand sits directly beneath the name, the category chip follows only
  when the launch rule shows one, then the reason, at the Feed's own
  spacing.
- Each card is still raised to the deck's tallest, but the spare height
  goes below the content, above the location. The Feed is unchanged
  (compared side by side on the same recall).
- In the deck the location row sits the card's own 8pt below the content,
  without the Feed's extra 8pt above it (the spacing pass below).
- The one-line brand was reviewed in that pass and kept. Restoring the
  Feed's wrapping makes the Jalapeños card two lines taller (its brand is
  `Trader Joe's, Freshness Guaranteed and more`), and natively that put the
  dots below the fold. Every hidden-category card checked groups its title,
  brand and hazard with no gap: Moringa on iPhone 17, and Black Sesame on
  the SE.

**The deck** (`ReadyDeck`, components/onboarding/ready-carousel.tsx; the
physical deck, 2026-10-01). It is a physical stack of the real cards, with
one continuous `position`. Every card's pose is a function of its depth
below that position, read from one table (`deckPoseRanges`).

**At rest:**

- The active card is on top, upright and full size.
- The next genuine cards, at most two, are mounted directly beneath it.
  Each is uniformly smaller than the one in front (94% and 88%) and pushed
  right, so only an 8pt strip of its right edge shows. That strip is inside
  the card's own 12pt padding, so it is clean white and nothing of a later
  recall leaks.
- The locked card wears a plain white face (a veil) whenever it is behind
  the front card, because its blur would otherwise spread the badge colours
  into the strip. The veil lifts as the card comes forward.
- Nothing sits behind the last card or a single match.

**Forward** (`PanResponder`, a clearly horizontal drag):

- The top card follows the finger left and leaves the deck to the left. It
  is a rigid rectangle the whole way: never scaled, turned, skewed or
  resized, and it never moves right first.
- The card beneath is uncovered where it already sits. It comes forward
  into the active place by one uniform scale-and-move, never entering from
  the right. The cards behind each rise one place, and a new one fades in
  at the back.
- The uniform promotion of the card beneath is the only scale anywhere in
  the deck (the founder's 2026-10-01 decision, superseding the blanket ban
  on scaling).

**Backward and cancel:**

- Backward is the exact reverse: the previous card returns from the left
  over the stack, and the active card settles back into the first rear
  place.
- A release commits one card when the drag travelled a quarter of the exit
  distance, or was flicked that way at 0.3pt/ms (`deckReleaseTarget`).
  Anything less settles the stack back exactly as it was.
- Past either end the deck follows at a quarter and returns.
- A vertical swipe that starts on the deck still scrolls the page.

**The index and the dots:**

- `active` is the committed card. It changes on the release (or
  accessibility move) that commits, before the 260ms settle, and drives the
  dots, the touch target and the spoken value together. There is no timer
  and no second animation.
- A cancelled drag never changes it.
- There is one dot per navigable page, the locked page included
  (`deckDotCount`), and none for a single card.
- Under Reduce Motion the cards still follow the finger, but the settle is
  immediate.

**Geometry:**

- Every card is the height of the tallest one measured (`deckCardHeight`),
  at every text size (`deckHeight`, so from the accessibility sizes, too,
  no taller card shows beneath the front one). No gesture resizes the
  deck.
- Measurements are whole points past layout's float noise (`wholePoints`).
  At XL a card laid out at 285pt reports 285.00006pt, and a plain
  round-up raised the card to 286, which measured 286.00006, and so on
  until the deck reached 1,023pt.
- The stack does not clip, so it keeps no room above its cards. The dots
  sit 4pt below the card.
- The step remounts the deck when its cards or the text size change, so it
  re-measures and starts at the first card.
- At the default text size on iPhone 17 the dots arrive above the footer
  without scrolling. The locked strip may sit below the fold.

**The spacing pass (2026-10-01).** `Your recall preview` has 16pt of page
cream above it, giving 22.3pt of clear space between the scene's straight
bottom edge and the heading's capitals (6.3pt before). Its 2pt spacing to
the count is unchanged. The deck gave the height back from space it did not
use:

| Source                                             | Recovered |
| -------------------------------------------------- | --------- |
| The room above the cards (the stack never clipped) | 4pt       |
| The Feed's extra space above the location row      | 8pt       |
| Between the card and the dots (8pt down to 4pt)    | 4pt       |

On iPhone 17 at the default text size the dots still arrive 4pt above the
footer. The board, scene, cap and 15pt values are unchanged, and the SE
still uses the full-width fallback and scrolls to the deck.

To VoiceOver the deck is ONE adjustable element, named `Your recall
preview`, whose value is the active card's complete content (`Match 1 of 3.
Risk level: Critical. …`). Swiping up or down moves to the next or previous
card with no visual arrows. On the locked card the value is `More matches
are locked`, and activation opens the plan screen. A requested move settles
exactly as a released drag does.

The cards keep the frosted locked card from the 2026-09-28 polish pass. No arrows, instruction copy, auto-advance, loop or
entrance animation.

**Ready-local type** (`READY_TYPE`, measured on the target at 393pt with the
bundled Public Sans): headline 34pt, board heading 17pt, preview heading
25pt, count `body`, and `See my plan` at 16pt on a 46pt pill. The board's
rows are larger than the target's since 2026-10-01: labels SemiBold 14pt and
values 15pt. The shared type scale and Button are unchanged.

The deliberate differences from the target are:

- Its headline face renders heavier than Public Sans Bold.
- Its link blue is brighter than `action/secondary`.
- The Feed's real card is taller than its illustrated card, because of the
  112pt media.

**Edit preferences, one page (2026-09-30).** `/onboarding/edit-preferences`
is a full-screen modal over Ready in the onboarding group. It is never a
step and never a resume point, and it has no swipe-to-dismiss. The approved
target is `assets/brand/reference/lotly-ready-edit-preferences-target.png`.
From the top:

- `Cancel`.
- `Edit your preferences` and `Adjust your watch, all in one place.`
- States, Allergens and Stores between rules, all three visible together.
  - Each has its artwork, `N selected`, its helper (`Choose at least one
state.` / `Optional`), a blue `Edit`, and its chosen values as removable
    chips.
  - The allergen artwork is the draft's first two pictograms, or the dash.
  - Allergens adds `Add allergens`.
- The approved mini mascot
  (`assets/brand/production/lotly-ready-preferences-mini-mascot.png`,
  decorative) beside `Your recall preview updates when you save.`
- `Save changes`, pinned.

The page edits ONE working draft (`src/lib/edit-preferences.ts`):

- Opening it reads the saved preferences once into the draft.
- Each `Edit` opens that category's EXISTING chooser, handed the draft and
  its toggles. All three choosers are controlled and save nothing of their
  own.
  - States opens the States search sheet: all 52 jurisdictions, matching
    full names, postal codes and the DC alias.
  - Stores opens the Stores search sheet in its catalog form (`catalog`).
    Before anything is typed it lists the whole canonical catalog, every
    store alphabetically, row by row, with the draft's stores checked.
    - It uses two columns while the widest store word (`Supermarkets`) fits
      a half-width tile at the reader's text size (`storeCatalogColumns`):
      iPhone 17 to XL, the SE to Large. Otherwise, and at every
      accessibility size, it uses one column.
    - Names wrap between words and are never truncated, and every tile is
      at least 44pt.
    - Typing narrows the same catalog by the catalog's own matching.
      Clearing it restores the whole list.
    - The field is not focused on opening, so the list shows first.
    - The Stores step's sheet is unchanged: it focuses its field and shows
      one instruction line until something is typed.
  - Allergens opens the Allergens step's own nine-tile grid (now the shared
    `AllergenGrid`) in a sheet of the same pattern. Both `Edit` and `Add
allergens` open it.
- Closing a chooser keeps the draft, and chip removal changes only the
  draft.

`Save changes` is disabled, with `Choose at least one state to save.` spoken
as its reason, while no state is chosen. Zero allergens and zero stores save.

When pressed, it commits the whole draft ONCE through the canonical store's
new local-first `commitPreferences`. That call answers as soon as the device
holds the value; the server mirror syncs afterwards in the same queued turn,
with the same dirty-flag retry. A second press does nothing.

The page then returns directly to Ready. Ready already shows the saved value,
because `onPreferencesSaved` tells mounted screens the moment it is written.
A failed local write keeps the page open with the draft intact, says
`Your changes couldn’t be saved. Try again.`, and retries on the next press.

`Cancel` and Android's back discard the whole draft. Nothing reaches the
store, Profile, the Feed or Ready. Onboarding completion, `watchBuilt`, the
installation, the paywall and any purchase are untouched either way, and the
building interstitial never replays.

The editor's type (`EDITOR_TYPE`) is measured too:

| Element        | Size | Notes                                    |
| -------------- | ---- | ---------------------------------------- |
| Headline       | 31pt | `heading-2` base from text scale 1.5     |
| Body           | 17pt |                                          |
| Section titles | 19pt |                                          |
| Counts         | 14pt |                                          |
| Helpers        | 12pt | The target's 10.8pt is too small to read |
| Chips          | 13pt |                                          |
| `Save changes` | 16pt | On a 46pt pill                           |

**Editor accessibility:**

- Every control is at least 44pt with its own target.
  - Chips are drawn at 32pt and reach 44pt through vertical hitSlop; rows
    sit 12pt apart, wider than the two slops meet.
  - `Edit`, `Add allergens` and `Cancel` are 44pt boxes.
- Each `Edit` shares its section header's top edge, so VoiceOver reads
  `States, 2 selected` before `Edit states`.
- From text scale 1.5:
  - each section stacks: artwork, heading, `Edit`, then the helper;
  - each chip becomes a full-width row with its own 44pt Remove, as on
    States.
- When a chooser closes, focus returns to the action that opened it.

**Native verification (2026-09-30, iPhone 17 and iPhone SE, iOS 26.3, the
QA simulators, real feed data).** Everything below was checked through the
Simulator's accessibility bridge, with screenshots and video.

- Ready at default size compared with the target at matched point scale,
  on both devices.
- Every edit, re-checked with the editor open:
  - edits in all three categories kept across choosers;
  - Cancel leaving Ready and storage unchanged;
  - Save updating the board, the allergen plate, the true count (20 → 21 → 16) and the real cards;
  - a kill and relaunch resuming Ready with the saved choices and no
    Building;
  - the last state removed disabling Save with its reason;
  - zero allergens and zero stores saved as `None`.
- Search and chooser checks:
  - state search for NY, DC, PR, `az`, full names and a no-match query;
  - store search;
  - both allergen entry points opening the same chooser.
- Deck checks:
  - swipes through three cards to the frosted locked card;
  - accessible next and previous through the deck;
  - the locked card's activation and `See my plan` reaching the paywall and
    Back returning;
  - Ready's Back to Stores and Continue straight back to Ready.
- Reduce Motion: video showed the deck's requested move as a slide with
  motion allowed and a one-frame change with Reduce Motion on.
- XL, XXL, XXXL and AX5 text on both devices, all content reachable above
  the pinned actions.

At AX5 the SE editor stacks its sections, after an earlier build broke
`selected` mid-word. Keyboard dismissal was not re-run: the Simulator had a
hardware keyboard attached, and the search sheets are unchanged from their
§6.1 and §6.3 verification. Real VoiceOver listening could not be run in the
Simulator. The accessibility tree, labels, values, actions and focus targets
were inspected instead.

### 6.5 The problem screens (2026-09-28)

Two framing screens between Welcome and States, so the selectors are asked
for a reason: the problem matters → Lotly learns the household → Lotly
builds a watch → the shopper sees personalized value → the shopper chooses
a plan. Both use the shared frame, the segmented bar (steps 1 and 2 of 5),
Back and a pinned Continue (`src/components/onboarding/problem-steps.tsx`).

Both compositions are the founder-approved 2026-09-28 statistic mockups
(`assets/brand/reference/statistics/`), and every size below comes from the
deterministic, React-Native-free rules in `src/lib/problem-presentation.ts`
(pinned by `problem-presentation.test.ts`). Neither screen has a mascot —
no import, no reserved space — and neither adds motion: the only animation
anywhere is the progress bar's own one-step forward fill, already skipped
under Reduce Motion, so with the setting on everything appears in its
final state at once.

**The scale (the authored pictograph, 2026-09-29).** `1 in 6` in the
`stat` type (Public Sans 700, 56pt), the headline `Americans get sick
from foodborne illness each year.`, the supporting `That’s about 48
million people.`, then the authored one-in-six pictograph and the quiet
`Source: CDC` anchored to the foot of the content; the pictograph and the
source split the leftover space through auto margins, so the
visualization owns the screen's centre. The pictograph is ONE production
image — `statistics-one-in-six-figures-1024.png` (`SCALE_PICTOGRAPH`,
lib/statistics-assets.ts): six authored full-body figures in the approved
3×2 arrangement, one lime with its three emphasis rays, five pale blue —
drawn whole with `contain`, never cropped, tinted or assembled from
glyphs. (It replaced the interim `figure-person` glyph grid, whose
rasters and vendored `user-round.svg` are retired with no remaining
consumer.) The square canvas keeps its own transparent margins (solid
artwork 765×783 of 1024, the report's bounds), and the canvas box is
320pt on taller phones, 216pt on the SE class, 220pt from the first
accessibility text size — the whole composition always visible. The stat
and sentence are ONE spoken thought (`PROBLEM_SCALE_SPOKEN` on the
headline; the drawn stat is decorative), and the pictograph is ONE spoken
infographic — `One out of six people highlighted.`
(`PROBLEM_SCALE_FIGURES_LABEL`) — never six figures or rays. Source:
<https://www.cdc.gov/food-safety/about/index.html> — recorded here and in
the copy module's comments; no URL is bundled and the note is not a link.

**The stakes (the approved editorial rows, 2026-09-29).** `Some
households face higher stakes.`, the claim as the body — `These household
members are more likely to become seriously ill from foodborne illness.` —
then the CDC's four groups as four vertical editorial rows, in canonical
order: Young children, Pregnant people, Adults 65 and older, Weakened
immune systems. The approved risk-row target
(`assets/brand/reference/statistics/lotly-onboarding-problem-risk-rows-target.png`)
**supersedes the earlier 2×2 grid target** (`…-problem-risk-target.png`,
kept as history) for layout and composition; the grid, its label pills,
full-column slots and label seat are retired.

Each row is the approved production illustration on the left
(`src/lib/statistics-assets.ts` maps `young-children`, `pregnant-people`,
`adults-65-plus`, `weakened-immune-systems` to
`assets/brand/production/statistics-<group>-1024.png`, unchanged) and its
exact label as live `heading-3` text on the right, vertically centred, with
a `border/subtle` hairline beneath every row but the last. Rows are
transparent: the illustrations' own pale-blue ovals are the only
backgrounds — no pill, card, panel, row border, shadow, number, bullet or
icon. `heading-3` (Public Sans SemiBold 19) is the closest existing bold
token to the target's ≈17pt labels; there is no `body-bold`.

Sizes come from `riskRowLayout` (`src/lib/problem-presentation.ts`), from
the measured width, height and safe-area insets, never a device name. At
default text size the illustration is the largest box that keeps the
widest label (`Weakened immune systems`, 248.4pt, re-measured in the tests
with the vendored font) on one line, with the roomiest row padding the
height allows: **105pt with 12pt padding on the iPhone 17** (a 387pt list
in a 429pt budget) and **78pt with 8pt padding on the SE** (283pt in 298pt).
Each illustration overlaps its own canvas's transparent top and bottom
bands (`riskArtTrim`, from the report's solid bounds, 176–869 of 1024), so
a row is as tall as the visible artwork; nothing is cropped. The list
starts 24pt below the body and the spare height falls between the last row
and Source. Larger text keeps the default-size illustration and scrolls;
labels wrap between words, never truncated, capped or shrunk. At
accessibility sizes the illustration stays beside its label while the
label's longest word fits (down to 56pt); past that — AX4 and AX5 on the
SE, AX5 on the iPhone 17 — it moves above the label inside the same row,
so no word is ever broken.

Each row is ONE spoken element carrying exactly its name; the illustration
is decorative and the hairline is a border, never an element. The spoken
order is Back → progress → heading → body → the four rows → source →
Continue. No motion is added: the route transition and the progress fill
are unchanged, and under Reduce Motion the screen is in its final state at
once. Source: <https://www.cdc.gov/food-safety/risk-factors/index.html>.

**The assets.** The five approved 1254×1254 sources stay byte-identical
under `assets/brand/reference/statistics/source/`; the production files
carry the mascots' mechanical repair applied at native resolution (alpha 0
→ RGB 0; 240–254 → 255 with RGB untouched; 1–239 unmatted against white),
a uniform premultiplied box-filter resample of the complete canvas to
1024×1024 (never cropped, shifted or recoloured; the solid artwork bounds
land within 2px of the uniform-scale prediction), a post-resample pass of
the same alpha rules, and explicit sRGB/gAMA/cHRM with no ICC profile or
export metadata. The audit of sources and productions is
`statistics-production-asset-report.json` beside the references; the two
contact sheets are review material bundled by nothing. The pictograph
alone carries six enclosed translucent components (4,213 pixels, one
between-the-legs gap per figure over its soft shadow) — intended artwork
the report records, sealed off when the repair lifts the 240–254 shadow
to opaque; nothing was filled. Byte identity,
format, alpha, holes, the report's accuracy, the one-to-one mapping and
the absence of every reference from app code are pinned by
`src/lib/statistics-assets.test.ts`.

Neither screen implies that every foodborne illness had a published recall
or that Lotly could have prevented them, and the unverified "6K products",
"18 recalls a day" and "25% Class I" figures appear nowhere
(`onboarding-design.test.ts`).

### 6.6 The Building step: the five-stop watch (2026-10-02)

After Stores' Continue on a first pass, `/onboarding/building` presents the
founder-approved five-stop composition
(`assets/brand/reference/lotly-onboarding-building-grocery-search-target.png`;
measurements in
`assets/brand/reference/building-grocery-search/lotly-building-grocery-search-asset-report.json`)
over REAL data. It replaces the 2026-09-28 checklist interstitial and its
fixed 3.2-second success timer.

**Composition** (`src/components/onboarding/building-step.tsx`, every
number in `src/lib/building-presentation.ts`). The decorative hero
(`lotly-building-grocery-search-scene.png`: the canvas tote, its three
hanging tags, the groceries, and the mascot holding binoculars over both
eyes) at the page's full width, with the tags' three printed glyphs drawn
back natively at their fitted centres, boxes and angles (location pin,
the general octagon-and-exclamation allergen symbol, cart); the headline
`Getting your watch ready.` (Public Sans 700, 36/36, centred, 270pt column);
one native rail of five equal stops, Area, Allergens, Stores, Matches and
Feed (map-pin, octagon-alert, shopping-cart, file-search-corner and the
Lotly-authored stacked cards), joined by short thin connectors; and ONE
changing caption (Public Sans 700, 18/23). The circles alternate blue,
lime, blue, lime, blue as fixed decoration: the lime is
`background/accent`, the blue is the mockup's lighter `#D4EBFE`, local to
this screen so the shared `background/subtle` is unchanged. Active is two
lime rays above a stop and complete is a navy badge with a white check on
its lower right — shape and position, never colour alone. On a short screen
(an SE) only the page cream above the art compresses; everything scrolls at
large text sizes, and from text scale 1.5 the headline and caption take
smaller bases (`heading-2`, and `body`'s size at a screen-local 1.25
leading — 16/20 — stepping to `body-small`'s 13/16 wherever the widest
caption word, `personalized`, would not fit the measured column with 5% to
spare: at AX5, React Native's 3.571×, on an SE, where 16pt broke it as
`personalize|d`), still multiplied by the reader's setting, so no word ever
breaks across lines at AX5 and the slow or error message fits above its
footer on an SE. M04 is no longer drawn
here (it stays on the standalone paywall).

**The stops and the real work** (`src/lib/building-watch.ts`). Mounting the
route starts or joins the shared feed session's sync. Area is that sync
delivering a complete corpus (the session's cache or a finished sync) plus
the saved preferences; Allergens and Stores are the allergen and retailer
signals of `evaluatePersonalRelevance`; Matches is `affectsYouMatches`, the
Affects You current window whose length is exactly the count Ready shows;
Feed is that ranked list, which Ready receives. Stops 2–5 are one
synchronous evaluation over the loaded corpus presented one beat at a
time — no request per stop, no matching of the screen's own, no staged
work. Nothing completes before the corpus and the preferences exist: the
presentation holds on Area, active, until usable results arrive.

**Captions.** `Searching recalls in your area…`, `Checking for allergen
matches…` (`Checking recalls across allergens…` with none chosen),
`Checking recalls where you shop…` (`Checking recalls across stores…`),
`Found N recalls for you.` (`Found 1 recall for you.`; `No matching recalls
found.` at zero), `Putting your personalized feed together…`, then `Your
personalized feed is ready.` Every caption, the whole count sentence
included, is Public Sans 700 (2026-10-02: the count line's earlier Medium
words with a bold number are retired). `watch` appears only in the headline; no caption names
a selection or claims safety.

**The handoff.** The feed session remembers the corpus it last served
(`FeedSession.served()`), and Ready reads the feed with
`useFeed({ reuseRecent: true })`: it opens on exactly the corpus Building
counted and reconciles again only past the existing 15-minute foreground
threshold (joining a sync still in flight). The count therefore matches
Ready's from the same corpus; a sync that lands after the handoff updates
Ready as Ready always updated. The preferences hand over the same way:
Building and Ready read them with `useOnboardingPreferences({ reuseLoaded:
true })`, starting from the choices already read or saved in this process
(and still re-reading on focus), so Ready never flashes `Loading your
preferences` after Building; a cold launch or resume onto Ready, or a store
that fails, still shows Ready's real loading and error states. The selectors
and the editor, which save, never reuse.

**Timing** (foreground, visible time). Presentation starts when the route
is VISIBLE — the stack's `transitionEnd` for its arrival, or a 700ms
fallback on a cold resume with no push — never at mount, and it stops while
the app is in the background. With usable results each stop's caption is
read for at least 1,100ms of foreground time ONCE FULLY VISIBLE — Area's
from arrival, every later one after its 220ms fade-through completes — and
the completion caption for 800ms: about 7.4s in all (the founder's pacing of
2026-10-04, from the 1,500ms holds of 2026-10-02; the transitions keep their
own 80ms out and 140ms in, only the settled reading time changed). These are
display minima, not evidence: a stop holds longer while its data is not
ready, and a usable cache presents at once. Under Reduce Motion the reduced
path is unchanged (Area at least 560ms, the count held 1.6s, the
completion 0.9s: about 3 s), never the
7.4-second sequence. Under the existing freshness policy a valid cached corpus is
the feed, so an offline launch with a cache completes from it without any
freshness wording, while a first launch with no cache waits for the sync.

**Slow and failed.** After 10 seconds of foreground visible time spent
WAITING for usable results (Area pending) the caption becomes `Recalls are taking longer than usual to
load.`; the presentation's own length can never trigger it, since the
warning is armed only while data is pending. A failure with nothing cached says `Lotly couldn’t reach the recall
service.` at once. Both show a footer with `Try again` (a real refresh
through the same session; the slow bound restarts) and `Continue to
preview`; when the footer appears the page scrolls the message into view
from its first line (the rail too when both fit; positions from the
screen's measured layout and the footer's own height). Neither
path shows a count or a completion, and late results resume the
presentation from the real state. Continue replaces Building with Ready,
whose own checking and could-not-check states take over.

**Once means once.** Completion and Continue both mark the sticky
`watchBuilt` fact and REPLACE Building with Ready (one guarded exit), so
Back from Ready pops to Stores and Stores' Continue then goes straight to
Ready. `watchBuilt` records that the one-time presentation was spent —
never that data succeeded. Onboarding is not completed here. A kill during
the presentation resumes on Building, which presents again from the real
state; a relaunch after it resumes on Ready. Interactive swipe-back is
disabled on this route (`gestureEnabled: false`). An unreadable preference
store routes straight to Ready, unspent.

**Motion** (core `Animated`, native driver, opacity and transform only;
expo-animation and emil-design-eng guidance). One beat moves everything
together. The caption fades THROUGH: the outgoing caption fades to nothing
over 80ms (linear — under the strong ease-out it vanished within ~25ms and
left a measurable blank), the words change while nothing is visible, and the
incoming caption fades in over 140ms with no pause between (ease-out
`cubic-bezier(0.23, 1, 0.32, 1)`) — one native sequence over two layers
that are never visible together, the incoming one created transparent, in a
box of stable height (the tallest caption this screen can show for these
choices, measured at the current width and text size, wrapping naturally):
no overlapping sentences, no flash, no movement, no layout change. From that
hidden swap point, over the fade-in, the finished stop's badge settles in
(opacity, scale 0.85→1), the next stop's rays appear (0.9→1), and the
matching bag-tag glyph swells to 1.1 and settles (260ms ease-in-out back)
for Area, Allergens and Stores; at Matches and Feed the three glyphs stay
settled. An interruption stops the running sequence and a stale completion
is ignored. (Until 2026-10-02 the new words first replaced the old ones at
once and an effect then reset their opacity — a one-frame flash, then a
blank; an interim overlapping crossfade followed, then this fade-through.) Nothing loops, springs or bounces,
and the hero never moves. Under Reduce Motion (or before the setting is known)
every change is immediate — the caption's words swap with no fade —
and there is no staged build-up: once results
are usable the first three stops complete together, the count holds 1.6s
and the completion 0.9s — it still waits for real results.

**Accessibility.** The hero, its glyphs and the rail visuals are hidden.
The headline is a header. The rail and caption are ONE element, `Recall
check progress` (role `progressbar`), whose value is the current caption and
`N of 5 done.` The start (`Getting your watch ready. Searching recalls in
your area…`), the completion (`Found N recalls for you. Your personalized
feed is ready.`) and the slow or error message are announced, each only
when true and never mid-slide. Try again and Continue to preview are
ordinary buttons.

**QA controls** (Design Preview, development only). `BUILDING QA` sets a
feed scenario (Live, slow 12 s, failed, zero matches, one match) that
persists across relaunches under its own development key until changed,
and clears the feed cache; the gate scenario `Resumed incomplete
onboarding` opens Stores with the one-time flag unset and choices kept. The
scenarios wrap the one session: the match scenarios hide real current
matches for the saved preferences, the failure never reaches the network,
and nothing filtered is cached. A display-only QA profile (`QA profile: no
allergens, no stores`, its own development key) presents the saved choices
to Building and Ready with no allergens and no stores, never saving them —
a save would rewrite the device's preferences and their server mirror —
so the no-selection captions and their real counts can be checked. A
release bundle carries none of it.

### 6.7 The dedicated onboarding paywall (2026-09-28; the grocery watch, 2026-10-01)

`/onboarding/paywall`, reached from Ready's `See my plan`, its locked strip
and its locked sentinel — and nothing else. Since 2026-10-01 it draws
`OnboardingPaywallPanel` (`components/paywall/onboarding-paywall-panel.tsx`),
the founder-approved grocery-watch composition; the standalone `/paywall` a
lapsed subscriber meets keeps `PaywallPanel`. Both compose the SAME purchase
flow: there is still exactly one implementation of offering loading, plan
state, purchase, restore, notices, legal links, entitlement handling and the
development controls (`hooks/use-purchase-flow.tsx`), and neither route
holds purchase state. Top to bottom: Back (pops to Ready); the headline
`Keep a closer watch.` over the hero's open band, the blue wave rising
beside it; the grocery hero (decorative, static, hidden from assistive
technology; its notification is fixed example artwork labelled
`Example notification` in the art, with no hit area, and has nothing to do
with notification permission or delivery); three benefit rows — `See recalls
that match you` / `Based on your states, allergens and stores.`, `Get
matching recall alerts` / `Notifications tailored to your preferences.`,
`Know what to check` / `Search, save and view full recall details.` — each an
app line glyph on a powder-blue plate and one spoken element; the Annual and
Monthly cards stacked; the development-store controls in a development build
only; the independence note; then the shared footer in its explicit
`onboarding` appearance — the outcome notice, the 51pt purchase pill, the
renewal disclosure and Restore Purchases / Terms / Privacy / Support,
sticky at ordinary sizes and inline from the accessibility sizes
(`paywallFooterPlacement`, unchanged). No preference summary, no example
recall, no progress bar, no second "your watch is ready" message, and no
discount/back-out offer (deferred, §12). Visual specification, measured
type and deviations: [../DESIGN.md](../DESIGN.md) "Onboarding and paywall";
rules and copy: `src/lib/onboarding-paywall-presentation.ts`.

**Offer.** Every price is the provider's own `formatted` string: the cards
show it with its period (`$29.99 / year`, `$4.99 / month`) and the action
names it (`Subscribe for $29.99/year`). The Annual card adds the
store-derived `$2.50/month equivalent` (explanatory, never the charge) and a
`Save {N}%` pill computed by the existing `annualSavingsPercent`, shown only
for a positive saving in one currency. Annual stays preselected (or the
development scenario's plan). Choosing Monthly moves the border, the radio,
the action (`Subscribe for $4.99/month`) and the disclosure (`Renews
monthly. Cancel anytime in Apple Account settings.`) together; while there
is no offering the disclosure is the period-neutral sentence. The radio
speaks `Annual, $29.99 per year. $2.50 per month equivalent. Save 50%.`;
the pill is drawing. No trial, discount, new product or provider.

**Shared pieces, explicit variant.** The standalone paywall's appearance is
unchanged. The onboarding panel passes `usePurchaseFooterSlots` an
`appearance: 'onboarding'` (the CTA becomes `OnboardingActionPill`: the
shared Button's primary treatment, disabled and busy state and busy word at
51pt with a 16pt label; the shared Button has no size override and is
untouched) and the chosen plan's `disclosure` (`PurchaseTerms` defaults to
the standalone's sentence). `EntitledPaywallPanel` was onboarding-only and is
replaced by `OnboardingEntitledPanel`; M04, the body, the check rows and
`BEST VALUE` remain only on the standalone paywall.

**Navigation and entitlement.** The route records itself as the resume
point, so a kill on the paywall resumes there. A verified purchase or
restore completes personalization WITH the entitlement in one commit (§3):
the gate goes straight to education, never through the paywall phase or the
Feed. Cancellation and failure stay here with their calm notice and every
choice kept; no free Feed access exists in any path. A shopper already
entitled (restored elsewhere, subscribed on another device) meets
`OnboardingEntitledPanel` instead: the same headline and hero, the active
subscription said plainly (`Subscription active` on the success surface),
the benefits, and a 51pt `Continue` that completes personalization — never
a second purchase ask. The lapsed subscriber's standalone `/paywall` is
untouched: same panel, same flow, its Back still `reviewingPreview` (§3).

**Grocery-watch hero (prepared 2026-10-01; founder-approved on the cream
page and imported the same day).** The approved grocery-watch target
(pinned by its manifest's SHA-256) is cut into one decorative hero,
`assets/brand/production/lotly-paywall-grocery-watch-scene.png` (934×620,
reference rows 152–771): a crop plus alpha from its ORIGINAL pixels, with
the exterior cream keyed out, the 240–254 and alpha-0 rules, and a 19-row
lower fade over original RGB. The printed headline is the one derived
region: its glyph footprint is interpolated, and all but 156 of those
pixels end as transparent page (the 156 are wave haze within 2 units of the
original). Only `onboarding-paywall-panel.tsx` draws it, its bytes pinned by
`src/lib/paywall-grocery-watch-assets.test.ts`. Crop, repair, placement
offsets, fidelity and limitations are in
`assets/brand/reference/paywall-grocery-watch/lotly-paywall-grocery-watch-asset-report.json`,
with the review sheet beside it. None of the reference material is bundled.

**Native verification (2026-10-01).** Separate QA simulators (`Lotly
Onboarding Review`, iPhone 17, 402pt; `Lotly QA iPhone SE (3rd
generation)`), the development provider only, a separate Metro; no real
purchase, live restore, production service, push or permission prompt.
Against the width-normalised target under the real status bar, on iPhone 17
at the default size, the headline's capitals land 3.3pt lower, the hero 4pt
and the first benefit 3.3pt lower, the Annual card 0.7pt lower; Monthly
17.7pt and the action 28.7pt lower (the real 51pt action, 44pt links and
legible type are taller than the mock's), with both plans above the pinned
footer. A spacing pass the same day added 7pt between the headline and the
hero (the wave's closest approach beneath `watch.` went from 7pt to 14pt on
iPhone 17 and from 5.5pt to 12.5pt on the SE), moved the benefit plates to
the plan cards' left edge (16pt, from 40pt) with the text 12pt from the
plate across the remaining width, and trimmed the cards' vertical padding
from 10pt to 8pt (Annual 86.7→82.7pt, Monthly 65.7→61.7pt), so both plans
still end above the footer on iPhone 17 (Monthly 8.3pt clear) and, on the
SE, the explanations fit one line each and the plans start higher. The
first pass measured two line-box effects of the 38pt leading
and corrected them: the hero sat 5pt low (iOS keeps the descent at the
bottom of the line box rather than centring the glyphs), and the Text's
own bounds shaved 1–2pt off `K` and `l` (it now pads its ascenders). On the
SE the hero keeps its proportions and the page scrolls to the plans above
the footer. xxxLarge, AX1 and AX5 wrap every word with no truncation; from
AX1 the hero follows the headline and the terms move inline; the CTA stays
pinned (three lines at AX5). Through the accessibility bridge: Monthly
selection moves the radios, the action and the disclosure together; the
`Loading`, `Unavailable, no prior entitlement` (could-not-confirm, fails
closed), `User cancellation` (selection kept, including Monthly), `Purchase
error` and `Restore finds nothing` scenarios show their notices with Subscribe
pressed twice; `Monthly purchase success` goes straight to education; the
`Active entitlement, onboarding unfinished` gate scenario shows the entitled
panel, whose Back returns to Ready; a relaunch resumes on the paywall;
Reduce Motion renders pixel-identically. `Subscribing…` (busy, inert) and
the long localized pair were captured in the Design Preview, because the
development store answers at once. Clean comparisons hide the development
controls with the Design Preview's capture switch (§5.1); the controls were
also exercised while shown. `npx expo export --platform ios` (2026-10-01):
the hero's bytes identical in the bundle; the target, manifest, source
crops, operation map, report, comparison sheet and source kit absent; the
adapter markers, `Simulated store`, the capture switch's names and the long
fixture absent; `Keep a closer watch.`, both renewal sentences, `Subscribe
for`, `Restore Purchases` and `recall.entitlement` present; M04 still bundled
for the standalone paywall.

### 6.8 Native verification of the restructure (2026-09-28)

Checked through the real flow on the iPhone 17 and the iPhone SE 3rd
generation simulators (iOS 26.3), against the live corpus, driven through
the macOS accessibility bridge (element labels and frames are what an
assistive client receives):

- **The full sequence:** Welcome → the scale screen (`1 in 6`, the spoken
  headline `1 in 6 Americans get sick…`, `Source: CDC`) → the stakes screen
  (the four-group echo card absent from the accessibility tree) → States →
  Allergens → Stores, the five-segment bar filling 1→5 with no visible
  count and the spoken `Onboarding progress, step N of 5` → the
  interstitial's one ~3.2s play (captions in order, checks accruing, M04)
  → Ready → the paywall.
- **Once means once:** Back from Ready pops to Stores (never the
  interstitial); Stores' Continue then goes STRAIGHT to Ready; a kill and
  relaunch resumes on Ready without a replay. The migrated completed
  record (this device's pre-restructure v1 record) also skipped it.
- **Ready with live data:** California + Peanuts/Tree nuts + six stores
  found 3+ real matches — the pill `3 recalls for your watch`, three cards
  over the Feed's own surface with real imagery, the next-card peek,
  snapping in both directions, three dots (third navy on the third card,
  none for the sentinel), the locked sentinel exposing nothing, and the
  locked strip. The SE's California-only, no-allergen profile drew the
  `None` rows and its own live matches. Reading order and one-element-per-
  card labels (`Match 1 of 3. Risk level: Critical. Affects you. …`) read
  exactly as designed; no mascot, pictogram, check or dot appears in the
  tree, and nothing of the hidden matches does.
- **Navigation and entitlement:** Edit preferences → States with every
  choice kept, Continue×3 dismissing back to Ready; See my plan, the
  locked strip and the sentinel all reaching `/onboarding/paywall`; its
  Back popping to Ready; a kill ON the paywall resuming on the paywall;
  cancellation (`Purchase cancelled. Nothing was charged…`), purchase
  error (`Lotly couldn’t complete the purchase…`) and restore-finds-
  nothing (`No Lotly subscription was found…`) each staying put with calm
  notices; a successful purchase landing on notification education
  directly, `Subscription active` shown; education surviving a relaunch;
  `Not now` opening the Feed. The entitled gate scenario met
  `EntitledPaywallPanel` (no plans, no purchase ask) whose Continue opened
  education. The lapsed scenario opened the standalone paywall, whose Back
  reviewed Ready. One gap: the standalone paywall's footer `Restore
Purchases` would not fire under the synthetic input harness in this
  session while the identical control on `/onboarding/paywall` fired and
  produced its notice — the two routes render the same `PaywallPanel`, so
  this is recorded as a tooling artifact, not a behavioral difference.
- **Reduce Motion:** the interstitial drew its FINISHED checklist at once
  and advanced after the readable minimum; the bar and mascots drew in
  place.
- **Dynamic Type (AX5):** Ready's headline and cards grew uncapped, the
  body inset correctly dropped (no cliff squeeze at accessibility sizes),
  the deck kept its peek and dots, the locked strip wrapped, and `See my
plan` stayed reachable; the SE paywall kept plans, notices and the
  footer reachable at its 667pt height.
- The 2026-09-28 composition fix this pass surfaced: the new two-line body
  needed an explicit trailing inset (`readyBodyAside`) to keep the
  approved cliff clear of the rising crest — the old body only wrapped
  clear by its own length.

The zero-, one- and two-match presentations are conditional rendering over
the same deck, pinned by `ready-preview.test.ts` and the design tests, and
rendered in the Design Preview gallery from example-model fixtures; the
live corpus could not be made to produce them on demand, and no production
data was touched to force them. VoiceOver speech itself was not listened
to; announcements are asserted in code (`onboarding-design.test.ts`).

### 6.9 The `expo-blur` dependency (polish pass)

`expo-blur` (~57.0.3, installed with `npx expo install expo-blur`, so the
SDK-matched version) is the one dependency this pass adds, used only by
the Ready deck's locked final card. The requirement was a visibly blurred
full card; the installed primitives could not do it cleanly: React
Native's `Image.blurRadius` blurs an image, not the card's text, and a
white wash over the real card (tried first, at 0.9) left the recall's
title faintly legible — it read as disabled rather than frosted and leaked
the hidden recall's name. `expo-glass-effect` is present only as a
transitive dependency of `expo-router` (unused by the app) and is Liquid
Glass, which the design forbids. No other blur solution existed in the
tree. Because it ships native code, the iOS dev client was rebuilt (`pod
install` — `ExpoBlur` linked — then a Debug simulator build) and installed
on the QA simulators; a release/EAS build picks it up through autolinking
like every other Expo module. Under Reduce Transparency the card falls back
to an opaque frost without the BlurView.

### 6.10 Native verification of the polish pass (2026-09-28)

On the iPhone 17 and iPhone SE 3rd generation simulators (iOS 26.3),
against the live corpus, with the rebuilt dev client:

- **A genuinely fresh flow** after the fixed development reset: Welcome →
  both story screens → States (M02 in the heading aside, Map / List full
  width) → Allergens → Stores (`6 stores selected` while five tiles were
  checked — the sixth chosen through search) → the interstitial's one play
  with every caption in order → Ready, recorded end to end.
- **Ready's deck:** three uniform image-bearing cards (identical outer
  size; titles clamped to two lines; the SE's wrapped status rows raising
  every card together), the next card tucked and scaled behind the active
  one, the dots following the snap, and the frosted real fourth card as
  the last position (a further swipe stays put). The accessibility tree
  read three `Match N of 3. …` elements and one `More matches are locked`
  button, with nothing of the frosted recall exposed. Editing the stores
  (a tile plus a search-only Whole Foods) recomputed the deck from the real
  feed. Zero-, one- and two-image-card decks are unit-tested
  (`ready-preview.test.ts`) and rendered in the gallery; the live corpus
  could not be made to produce them on demand and no data was touched.
- **Paywall:** Annual and Monthly switching (the CTA naming each store
  price), cancellation, purchase error and restore-finds-nothing each
  staying put with their notices, a simulated purchase landing on
  notification education directly, the already-entitled panel's Continue
  opening education, a kill on the paywall resuming there, and Back to
  Ready.
- **Reduce Motion:** the interstitial drew its finished checklist at once
  and advanced. **Dynamic Type (AX5, SE):** Ready, Stores, States and the
  paywall stayed reachable and uncapped, the mascot asides yielded, the
  deck's uniform variant switched off, and the paywall's terms moved
  inline under the pinned CTA.
- **Harness notes, not app defects:** the macOS accessibility bridge can
  scroll content into view while reading the tree (a shifted deck seen
  once was that); and one mis-aimed swipe landed on the locked strip and
  the paywall's Subscribe button, which — as buttons do — fired on
  release, raising the real notification prompt on the QA simulator, where
  `Don’t Allow` was chosen.

### 6.11 Notification education: the phone-led example (2026-10-03)

The founder approved the second concept: a phone above the headline whose
screen shows an example notification, pointed at by the mascot from a crate.
Source kit `docs/lotly-notifications-source-kit/`; asset report
`assets/brand/reference/notifications-phone/lotly-notifications-phone-asset-report.json`;
every measured number in `src/lib/notification-education-presentation.ts`.

**Art and native.** One production image,
`lotly-notifications-phone-scene.png` (934×768, rows 128–896): the mock's
printed card content, its `Illustrative notification` caption and its badge
are removed (harmonic fills, recorded), so the card is blank. The example is
native, drawn in the card's own plane by the measured homography (the card is
in true perspective — its edges differ by 1–2°, so no rotation can place it)
as a React Native `matrix` transform about the top-left corner: the approved
iOS icon, `Lotly`, the title and the body, in the system font at the art's
scale. Verified on the Simulator by rectifying a screenshot back through the
same homography: every line sits within ~1 unit of the mock vertically. iOS
draws the system font this small in its looser Text optical size, so the
example carries −0.09em tracking, which returns every line to the mock's
width and wrapping.

**The example is a real recall, formatted by the real formatter.** FDA,
Regal Health Food International (Regal Gourmet Snacks), _Milk Chocolate
Raisins_, undeclared peanuts, 2023-06-08 — since completed and terminated by
FDA (`EDUCATION_EXAMPLE_SOURCE`). The screen shows the formatter's actual
output, `Recall alert: Milk Chocolate Raisins` / `Undeclared peanut allergen.
Check your package.`, pinned by `src/server/push/product-name.test.ts`; both
fit the illustrated card whole (verified on iPhone 17 and SE, 2026-10-03), so
nothing on the onboarding screens is truncated. The mock's `Glutinous Rice
Balls` example was replaced (founder decision, 2026-10-03): its real
formatter output, `…Glutinous Rice Balls with Black Sesame Filling`, needs
three lines at the card's size and the card holds two.

**Layout.** The mark sits over the hero's transparent top rows exactly as in
the mock; when a larger mark would reach the art (measured clearance profile
`BADGE_CLEARANCE`) the hero moves down instead. `Example notification` is
centred under the phone, not the page. The headline, body and reassurance
follow the mock's measured baselines. The footer is pinned with its hairline
shown only while content runs beneath; from the accessibility sizes the
footnote moves inline after the reassurance so the footer keeps only the two
actions. An SE at the default size compacts the cream above the mark
(Building's rule) and scrolls.

**Choices and outcomes (2026-10-04).** `lib/notification-education-actions.ts`
drives the two enable ports of `lib/push-registration.ts` — the SYSTEM
permission (`resolvePermission`: read, and prompt once only while the
system can still ask) and the SERVER registration (`register`: token,
subscription row, then the local flag) — and never conflates them: alerts
are on only when the registration succeeded. One attempt at a time (a
double tap is one prompt and one registration); the registration is bounded
by a 10 s deadline that aborts the attempt's signal (the server write is
cancelled; the Expo token read is a platform call with no cancellation, so
it is awaited and discarded — nothing registers on a dead signal); the
education completes at most once, and a result that lands after
`Continue without alerts` changes no view and completes nothing again.

| Outcome                                | What the shopper sees                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Granted (now or before) and registered | the Feed, with `Your preferences are set.` once                                                                                                  |
| Denied at the prompt shown now         | the Feed, with the same notice — no enabled claim                                                                                                |
| Denied before; the system will not ask | the calm callout `Notifications are turned off for Lotly. Enable them in your device settings.` over `Open settings` / `Continue without alerts` |
| Granted, registration failed or > 10 s | the bordered alert `We couldn't finish turning on alerts.` over `Try again` / `Continue without alerts`                                          |
| Not now                                | the Feed — no read, no prompt, no registration                                                                                                   |

`Open settings` opens the system settings and remembers that it did; when
the app becomes active again the route calls `resume`, which re-runs the
enable ONLY in that case — a now-granted permission registers (the primary
reads `Checking…`), a still-denied one leaves the blocked notice. Opening
settings alone never completes the education, and a foreground for any
other reason reads nothing. `Try again` is the same single enable path. The
page above the footer is the approved composition in every phase; the
notices are the paywall's own two treatments (`PaywallNotice`), so an
outcome here reads as a purchase outcome does on the screen before, and
nothing animates in or out; the screen announces the notice once, when an
attempt settles on it, and the notice itself is not a live region. From the
accessibility sizes (text scale ≥ 1.5) the notice reads inline after the
reassurance, as the footnote already does. When the notice with its margins
would not fit in the room the pinned footer leaves above it — the scroll
view's measured height against the notice's measured height, never a
character count — the two actions follow it into the scrolling content and
no footer is pinned; once joined they never move back. Either way the page
jumps, unanimated, so the notice's first line sits just below the safe
area, and the reading order is explanation, then its actions. The blocked
phase omits the Settings footnote at those sizes, since the notice already
says so. Nothing is capped or shrunk, and both actions keep their 44pt
targets. (Founder review 2026-10-04: a pinned footer at AX5 on an iPhone SE
took half the screen and the first version's jump to the page's end showed
the notice by its last line; on the SE at AX5 the blocked notice now goes
inline with its actions, while the shorter failed notice, and both notices
on an iPhone 17 at AX5, still fit above a pinned footer.) Copy and footer
mapping:
`lib/notification-education-outcomes.ts`; behaviour:
`notification-education-actions.test.ts` (granted, denied now, blocked,
failure, timeout, late result, double tap, skip during an attempt, Settings
return granted/denied).

The Feed's one-time notice is keyed to the stable taker: the foreground
entitlement refresh that follows closing the system prompt used to re-run
the Feed's focus effect and clear the notice it had just taken (found on
the Simulator, 2026-10-03). A relaunch from the blocked or failed phase
shows the intro again: nothing was completed.

**Development QA.** The Design Preview's `Notification education QA`
controls choose what `Turn on notifications` meets on this device
(`lib/notification-enable-scenarios.ts`, persisted by
`lib/development-notification-scenarios.ts`, reached through a `__DEV__`
`require` in `lib/notification-education-ports.ts`): `Live` (the real
ports), or a simulated permission and registration — granted and
succeeding, failing, never answering, answering late after the deadline,
denied at the prompt, denied before with Settings granting, denied before
and staying so. No simulated choice prompts, reads a push token or writes
anywhere. Set `Live` when done; `notification-education-ports.test.ts` pins
the containment.

## 7. Local data on reset and on expiry

- **Expiry** changes the phase and nothing else. Preferences, saved recalls,
  the onboarding record and the installation id are untouched; the shopper
  meets the paywall with everything intact.
- **"Reset app and delete my data"** now also removes the onboarding record,
  so the next launch starts from Welcome; the entitlement cache is kept
  (§4). The reset's order is unchanged — server first, then every local
  clear — and `installation-reset.test.ts` pins the new step.

## 8. Retailer logos

`src/components/ui/retailer-logo.tsx` renders a store's mark beside its name
in the store sheet's rows under Profile, or the shared `home` glyph when no
trustworthy mark is bundled. Never on a recall card, never in Detail's
retailer row, and never on the onboarding Stores step, whose quick choices
and search-result rows are logo-free by decision (§6.3).

- One fixed container, `RETAILER_LOGO_BOX` (40 × 24 pt), for every row. A
  mark is CONTAINED in it: its aspect ratio is preserved, nothing is
  stretched, cropped, tinted or recoloured. The fallback glyph sits centred
  in the same box, so rows with and without a mark are the same height.
- A mark renders only when `RETAILER_LOGO_MANIFEST` (`src/lib/retailer-logos.ts`)
  holds a provenance entry for the canonical id AND the component declares a
  bundled `require` for the same id; the two are pinned to each other. Every
  entry records the official source URL, the owner, the retrieval date, the
  permission it rests on and the raster's size. Nothing is fetched at
  runtime: no `uri`, no hotlink, no logo service, no favicon.
- The image is decorative; the row speaks the retailer's name from its own
  label, and the mark carries the name as its own accessibility label too.

**Coverage today: 0 of 77.** No official retailer asset could be sourced and
license-checked with confidence in this milestone, and whether Lotly may
display third-party marks at all — nominative use of 77 trademarks in a
paid app — is a founder and counsel decision that was not made. So the
manifest is complete and empty, all 77 retailers render the fallback, and
the exact list is the whole catalog (`retailerLogoCoverage().fallback`).
The provenance method is defined and enforced: an entry per retailer, from
an official brand kit or press page, with the fields above, plus the raster
at 1x/2x/3x under `assets/retailer-logos/`. Nothing was approximated or
substituted.

## 9. Allergen icons

One family for all nine of Profile's allergen rows — the onboarding
Allergens tiles draw the Lotly pictograms instead (§6.2): **Lucide** (ISC), the outline language the
app's icon set already uses. The nine SVG sources are vendored under
`assets/icon-sources/lucide/` beside the license, from
`lucide-icons/lucide` at commit `f06ac67e33d645c40b8ce19a0419c85c5d7dd751`
(release 1.47.0), retrieved 2026-09-23, and rasterised offline by
`scripts/render-onboarding-assets.mjs` onto the icon set's 24 pt box at 1x,
2x and 3x at the set's stroke weight (2.4 grid units), black on transparent,
tinted at render time by the one icon primitive. `allergen-icons.test.ts`
proves every consumer allergen has a distinct glyph, every raster exists at
the three scales on one box, and no emoji or second family reaches the rows.

| Allergen             | Icon                 | Lucide glyph     | Depiction |
| -------------------- | -------------------- | ---------------- | --------- |
| Peanuts              | `allergen-peanut`    | `nut`            | concept   |
| Tree nuts            | `allergen-tree-nut`  | `tree-deciduous` | concept   |
| Milk                 | `allergen-milk`      | `milk`           | literal   |
| Egg                  | `allergen-egg`       | `egg`            | literal   |
| Wheat                | `allergen-wheat`     | `wheat`          | literal   |
| Soy                  | `allergen-soy`       | `bean`           | literal   |
| Sesame               | `allergen-sesame`    | `sprout`         | concept   |
| Fish                 | `allergen-fish`      | `fish`           | literal   |
| Crustacean shellfish | `allergen-shellfish` | `shrimp`         | literal   |

No permissively licensed outline family publishes a peanut, a tree-nut or a
sesame glyph (Lucide, Lucide Lab, Phosphor, Tabler, Iconoir and Font Awesome
were checked on 2026-09-23). Rather than mix families or draw food symbols,
those three rows use the family's nearest honest concept and the label
carries the meaning; every icon is decorative and hidden from assistive
technology. Every row uses one treatment: a 20 pt glyph, `icon/secondary`
unchecked and `icon/primary` checked, with the checkbox carrying the state.

## 10. P2B7X.2 — connecting the real store (adapter implemented 2026-10-04; device-unverified)

What exists, and what still stands between it and a verified purchase:

1. **Founder setup — done (2026-10-04).** Apple Developer membership active
   with agreements, tax and banking entered; bundle `com.willisyang.lotly`;
   Apple products `com.willisyang.lotly.annual` and
   `com.willisyang.lotly.monthly`; RevenueCat entitlement `premium` attached
   to both; offering `default` with `$rc_annual` and `$rc_monthly`; the
   public iOS SDK key saved on EAS `production` as
   `EXPO_PUBLIC_REVENUECAT_IOS_KEY`.
2. **The adapter — implemented (§5.2)**, behind `PurchaseProvider`, with
   `id: 'revenuecat'`, mapping `CustomerInfo` to `EntitlementReading` (an
   active entitlement with its expiry; `inactive` dated `asOf`
   `CustomerInfo.requestDate`, with `verifiedAt` stamped from that same date
   — never `Date.now()`, which would date a cached answer as fresh — so
   §4.1's freshness comparison never crosses a device clock; `unavailable`
   on a network or configuration error, never a guess), `Offerings` to
   `Offering` (the store's `priceString`, `price` and `currencyCode`), and
   the purchase and restore results to the four outcomes. The release line
   in `resolvePurchaseProvider` constructs it with `purchaseIdentity`.
3. **The public variable — recorded** in `release-exposure.test.ts`,
   `.env.example` and the release-readiness doc.
4. **Not yet verified on a device.** No purchase, restore or sandbox
   transaction has been made. Local verification covered the mapping and the
   ordering in Node, a release export whose bundle contains the provider and
   none of the development adapter, and a Release compile onto a dedicated QA
   simulator — all with the key absent, so all on the fail-closed path. A
   physical-device sandbox build is the next step
   ([recall-release-readiness.md](recall-release-readiness.md) §6).
5. Supply the Terms, Privacy and Support destinations and make
   `qa:launch-readiness` pass.
6. Update the App Privacy answers (Purchases: collected, linked to the
   installation identifier) and the EULA decision for a subscription
   ([recall-app-store-readiness.md](recall-app-store-readiness.md)).

## 11. Tests

| Concern                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Test                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Record transitions, sticky completion and `watchBuilt`, empty optional ≠ incomplete, the v1→v2 migration that keeps the shopper's place, foreign blobs restart                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `src/lib/onboarding-state.test.ts`                                                                                 |
| Phase matrix, route matrix, layout order and guards, push-tap guard, no cross-phase navigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `src/lib/access-gate.test.ts`                                                                                      |
| Fail-closed, cached access, grace, launch timeout, freshness reconciliation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `src/lib/entitlement.test.ts`                                                                                      |
| Entitlement session: a stale refresh is discarded whole, foreground waits for a store operation, post-success stale data cannot revoke, cache writes in order, later expiry honoured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `src/lib/entitlement-session.test.ts`                                                                              |
| Unconfigured provider, adapter scenarios and containment, savings math, no USD in product code, the RevenueCat wiring fails closed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `src/lib/purchases/purchase-provider.test.ts`                                                                      |
| RevenueCat adapter: customer-info and offering mapping, requestDate dating, undatable/unknown/expiry-less fail closed, localized prices, configure-once, purchase/restore/cancel/error outcomes, the races through its readings                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `src/lib/purchases/revenuecat-adapter.test.ts`                                                                     |
| Paywall copy, prices, cards, state matrix, no close/free/trial/lifetime                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `src/lib/paywall-screen.test.ts`                                                                                   |
| Release destinations and the readiness failure                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `src/lib/release-destinations.test.ts`                                                                             |
| Allergen icons: coverage, one family, provenance, assets                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `src/lib/allergen-icons.test.ts`                                                                                   |
| Retailer logos: manifest parity, local-only, containment, fallback, a11y name                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `src/lib/retailer-logos.test.ts`                                                                                   |
| Clear selection allocation, count lines, States gate, one store, copy, permission timing, example card, tokens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `src/components/onboarding-design.test.ts`                                                                         |
| Reset clears the record in order                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `src/lib/installation-reset.test.ts`                                                                               |
| Route inventory and the release bundle boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `src/lib/release-exposure.test.ts`                                                                                 |
| States map: vocabulary coverage, hit testing in both views and the insets, one draft, empty clear, no network                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `src/lib/state-map.test.ts`                                                                                        |
| Progress names and fills, motion gates, palettes, routes; the grocery-atlas States: one draft, composition, local type, chips, chooser                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `src/components/onboarding-design.test.ts`                                                                         |
| Onboarding Clear hint vs the sheet's, the always-laid-out required note, the root fade under Reduce Motion, the reference mock-up unbundled                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `src/components/onboarding-design.test.ts`                                                                         |
| No `retailers` copy exception left in onboarding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `src/lib/consumer-copy.test.ts`                                                                                    |
| Allergens grid: canonical order, icons, two columns, one-column and stacked reflow, measured word widths, select/deselect/clear, count words                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `src/lib/allergen-grid.test.ts`                                                                                    |
| Allergen pictograms: nine semantic pairs by static require, 1024² RGBA sRGB files, alpha repair pinned to the originals, 44pt box geometry, review artifacts unbundled                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `src/lib/allergen-assets.test.ts`                                                                                  |
| Allergen tiles: one checkbox element, hidden pictogram and check, no layout change, compact Clear, motion gate, Back/Continue, mock-up unbundled                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `src/components/onboarding-design.test.ts`                                                                         |
| Stores quick choices and search: the six ids and order, one catalog record each, the other four and every store findable, catalog unchanged at 77, case/punctuation/alias search, empty and no-match queries, the sheet's fixed top edge, toggle/clear/empty clear; the editor's catalog: every store alphabetically, rows read row by row, two columns at default on iPhone 17 and the SE and one at larger sizes, the widest word re-measured from the bundled font                                                                                                                                                                                                                                                                                                                                                                                                                                   | `src/lib/retailer-grid.test.ts`                                                                                    |
| Stores receipt layout: the slice maps to its rows at any height, the paper grows on every phone for 44pt rows, targets never overlap, scene vs stacked by text size, every word fits its column (measured from the font), the SE AX5 headline limit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `src/lib/stores-receipt-presentation.test.ts`                                                                      |
| Stores receipt layers: approved bytes and format, the report's offsets and slice, only Stores draws them, no reference imported                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `src/lib/stores-receipt-assets.test.ts`                                                                            |
| Stores step and search sheet: no second mode and none of the retired grid, six checkbox rows in order, no marks, the count row's allocated slot, the search action, the three decorative layers growing upward and stacking, one Modal sheet with a fixed frame and pinned Done, autofocus, instruction and no-match lines, single-column checkbox results, one shared selection, choosing keeps the sheet, every exit keeps choices, query never saved, Reduce Motion, overlay gone, Profile unchanged, Back/Continue/resume, mock-ups unreferenced                                                                                                                                                                                                                                                                                                                                                    | `src/components/onboarding-design.test.ts`                                                                         |
| M04 on the standalone paywall only (it left Building 2026-10-02); the onboarding paywall reaches no mascot file; M01, M02, M03, M05 and M06 unreferenced; M06's repaired bytes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `src/lib/mascot-assets.test.ts`                                                                                    |
| The grocery-watch hero: approved bytes, RGBA sRGB at the measured size, the report's crop and accuracy, drawn only by the onboarding paywall, no reference, source, mask, report, sheet or kit in app code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `src/lib/paywall-grocery-watch-assets.test.ts`                                                                     |
| The onboarding paywall's presentation: approved copy, cards from the store prices, Monthly moving the action and the disclosure, no badge without a positive one-currency saving, long localized prices, the hero overlap and ascender rules, no type below the shared floor                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `src/lib/onboarding-paywall-presentation.test.ts`                                                                  |
| The onboarding paywall's composition: top bar, headline above the hero, decorative static hero, benefits as one element, radio cards, decorative pill, the shared footer's explicit `onboarding` appearance, no purchase state, mascot or close; the entitled panel; the 51pt pill's Button semantics                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `src/components/onboarding-design.test.ts`                                                                         |
| The paywall glyphs `file-search` and `bell`: Lucide's own sources at the pinned commit, native rasters pinned; the bell is named only by the paywall's benefits (no bell control)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `src/lib/allergen-icons.test.ts`, `src/components/detail-design.test.ts`                                           |
| The clean-capture switch: in memory, off by default, heard by subscribers, scenario untouched, folded from release                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `src/lib/purchases/purchase-provider.test.ts`                                                                      |
| The receipt Welcome's two images: approved bytes, RGBA sRGB at the measured sizes, the report's accuracy and superseded hero, drawn only by Welcome, no reference or source material imported                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `src/lib/welcome-receipt-assets.test.ts`                                                                           |
| The grocery-atlas States' scene: approved bytes, RGBA sRGB at the measured size, the report's accuracy, drawn only by States, no reference or source material imported                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `src/lib/states-grocery-atlas-assets.test.ts`                                                                      |
| The States chooser's search (names, postal codes, Washington DC, no match, no duplicates) and the measured geometry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `src/lib/states-presentation.test.ts`                                                                              |
| Ready: the safe rectangle at 393/402/375pt, the compact board within the 80px cap with every word whole, otherwise the wide board (never a separate card), plates above the words only when that breaks fewer words, the wide layers and text region against the report, plate copies only past 1,200 rows, broken-word counting, slice placement, allergen artwork for 0, 1, 2 and 3+ in canonical order, compact values that speak every name with `+N` glued to the last name, the 14pt/15pt board type, the physical deck's pose table (front upright; the outgoing card rigid and unscaled; the card beneath promoted uniformly from where it sits, never from the right; at most two rear cards showing only a strip inside their padding), drag resistance at both ends, the commit/cancel/flick release rule, one dot per navigable page, the tallest-card height, only the status row reserved | `src/lib/ready-presentation.test.ts`                                                                               |
| Ready: both boards' layers in order with the native rows between board and foreground, compact growth through the slice and wall band only, wide growth by plates and feathers only, no separate preferences card and no workaround, the hidden three-way measurement keyed to the content and the page hidden until it answers, rows heard once, untinted pictograms and the dash, Back/Edit (the one-page editor)/See my plan, the true count as plain text, no purchase UI, honest empty/checking/unavailable states                                                                                                                                                                                                                                                                                                                                                                                 | `src/components/onboarding-design.test.ts`                                                                         |
| The deck: no pager; one position driven by a horizontal PanResponder; every real card posed from the shared table and painted last-first; only the front card touchable; the one uniform scale and no rotation/skew/perspective/axis scale; the locked card's white veil behind the front; measured geometry; the index committed on release before the settle; remount on new content or text size; one adjustable element with next/previous and the locked card's activation, Reduce Motion, no arrows/instruction copy/auto-advance/loop, decorative dots                                                                                                                                                                                                                                                                                                                                           | `src/components/onboarding-design.test.ts`, `src/lib/ready-presentation.test.ts`                                   |
| The preview data: the Feed's own matching and ordering, at most three readable (imaged or not), the true total as the count (never the deck's length), zero/one/two/three/more-than-three, checking, the corpus decision (session answer, else the remembered baseline), baseline matching with computed Affects You, live recovery, an offline preference edit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `src/lib/ready-preview.test.ts`                                                                                    |
| What the count includes and excludes: Nationwide for every chosen state, any non-allergen hazard, no image or category or page-size dependence, Building/Ready/Affects You parity, the allergen-only exclusion recorded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `src/lib/ready-count.test.ts`                                                                                      |
| The bundled baseline corpus: recorded by one rule within the recency window, every record active with an official URL, a bundled detail that renders for each, Nationwide non-allergen hazards matching any state, the age reported                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `src/lib/baseline-recalls.test.ts`                                                                                 |
| Preference persistence: the durable local write never waits on the network, rapid changes land in order, the mirror sends the newest value and never regresses, failures stay owed and flush retries, the reset settles the mirror, a settled read sees every prior write                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `src/lib/preference-persistence.test.ts`                                                                           |
| The selection sheets' motion rule: the opening waits for the Modal's view, an interrupted close reopens from where it is, closing keeps the Modal, Reduce Motion is immediate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `src/lib/sheet-motion.test.ts`                                                                                     |
| The problem screens: exact CDC copy and sources (comments only, never bundled), the spoken stat, the one-element pictograph, the four risk rows (one element each, decorative illustrations, heading-3 live labels, hairlines only between rows, no pill/card/background/grid), no mascot, no capped or truncated text, no unsupported statistics                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `src/components/onboarding-design.test.ts`                                                                         |
| The statistic assets: byte-identical sources, production format/alpha/holes, the report's accuracy, the one-to-one mapping, no reference imported by app code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `src/lib/statistics-assets.test.ts`                                                                                |
| The problem presentation rules: the accessibility threshold, the pictograph canvas, the risk rows' measured label widths, transparent-band trims, default iPhone 17 and SE fit arithmetic, larger-text and accessibility-size arrangements                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `src/lib/problem-presentation.test.ts`                                                                             |
| The Building step: the data gate and the shared Affects You count, the five captions with both no-selection variants and the singular/zero count, presentation only after visibility, foreground-only timing, the 10 s slow escape and the immediate error with Try again, Reduce Motion waiting for real results, one exit replacing with Ready, swipe-back disabled, one grouped progress element, the approved hero bytes and tag calibration, the pinned and Lotly-authored glyphs                                                                                                                                                                                                                                                                                                                                                                                                                  | `src/lib/building-watch.test.ts`, `src/lib/building-assets.test.ts`, `src/components/onboarding-design.test.ts`    |
| The Building → Ready handoff: `served()` is the newest complete corpus (a cache read never replaces a finished sync, a failure never replaces anything), and Ready alone opts into `reuseRecent`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `src/lib/feed-sync.test.ts`, `src/hooks/use-feed.test.ts`                                                          |
| The segmented progress: five segments, no visible count, one spoken element, the five counted screens only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `src/components/onboarding-design.test.ts`                                                                         |
| One purchase flow: purchase, restore and offering loads called only in `use-purchase-flow.tsx`, announced outcomes, both paywall routes composing it, Ready touching none of it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `src/components/onboarding-design.test.ts`                                                                         |
| The paywall order (benefits → plans → controls → independence note → shared footer), no Ready content, the entitled panel without a purchase ask                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `src/components/onboarding-design.test.ts`                                                                         |
| A paywall purchase completes personalization in the same commit and goes straight to education, never the paywall phase                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `src/lib/access-gate.test.ts`                                                                                      |
| The merged machinery is gone: no overlay footer, no scroll CTA rule, no merged copy in product source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `src/components/onboarding-design.test.ts`                                                                         |
| The deck's selection: the first ranked matches in rank order whatever their images, three readable, the real fourth locked, the strip counting every unshown match, deterministic                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `src/lib/ready-preview.test.ts`                                                                                    |
| Polish pass — uniform cards (one outer height; since 2026-10-01 only the status row is reserved and the brand is one line; off from the accessibility sizes), the measured status row, restrained depth; the variant opt-in with no Feed or Saved caller                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `src/lib/ready-presentation.test.ts`, `src/components/feed-design.test.ts`, `src/server/feed-saved-parity.test.ts` |
| Polish pass — the deck's frosted real final card (one button, nothing exposed), Stores' quiet count row with no summary or chips, the story screens, the paywall's M04, check rows and corner badge                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `src/components/onboarding-design.test.ts`                                                                         |
| Polish pass — the progress fill only forward-by-one; Stores' Continue and the reset restoring the interstitial                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `src/lib/onboarding-state.test.ts`, `src/lib/onboarding-navigation.test.ts`                                        |
| Edit preferences: one isolated draft, edits across categories kept, Cancel writing nothing, at least one state, zero optional choices valid, one commit per Save through a double tap, a failed save keeping the draft and retrying, chips in canonical order                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `src/lib/edit-preferences.test.ts`                                                                                 |
| Edit preferences: the existing choosers handed the draft and saving nothing, both allergen actions on one chooser, the route's single latched commit and failure path, the full-screen modal, Save disabled with its reason, 44pt distinct targets, decorative artwork and mini mascot, focus return                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `src/components/onboarding-design.test.ts`                                                                         |
| The four preference-board images pinned by hash to the report, placed where it says, drawn only by Ready and the editor; no reference, source, mask, report, sheet or kit in app code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `src/lib/ready-board-assets.test.ts`                                                                               |
| The seven wide-board images pinned by hash to the report, sized and placed where it says, drawn only by Ready; no target, manifest, source, mask, report, sheet or kit in app code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `src/lib/ready-wide-board-assets.test.ts`                                                                          |

The Design Preview hub renders every screen and every paywall state from the
production components and offers gate scenarios that restart the real flow
from a chosen state ([recall-design-preview.md](recall-design-preview.md)).

## 12. Deferred milestones (recorded 2026-09-28, not started)

None of these is implemented. Ranking weights, matching semantics,
discount products and purchase offerings are untouched.

1. **Recency-led Affects You ranking.** Revisit the Affects Me ordering so
   recency carries substantially more weight: the feed should feel current
   and change over time rather than leaving the same high-risk recalls
   permanently at the top. The Ready preview and the Feed both use the
   CURRENT ordering deliberately; the full specification (match filter,
   new/unseen first, recency primary with severity as an urgent
   override/tiebreaker, decay, viewed below unseen, temporary pins for
   critical unacknowledged notices, re-ranking on meaningful updates) is in
   [recall-personalization.md](recall-personalization.md) ("Deferred:
   recency-led Affects You ranking").
2. **Onboarding and paywall copy audit.** Once the layouts are approved,
   audit and rewrite repeated copy across the flow (the paywall headline
   and body, the Ready body, the benefits and education all restate
   related promises).
3. **A compliant paywall back-out discount.** Research an introductory
   offer shown when a shopper leaves the onboarding paywall — App Store
   offer rules, pricing disclosure, gate behavior. No exit interception
   and no discount are built.
4. ~~**Notification education polish.**~~ Done 2026-10-03 (§6.11).
5. **Regenerate the remaining blurred Lucide rasters.** The allergen and
   States glyphs predate the native-scale rasterization (`shopping-cart`
   and `lock` are crisp; see §9 and `render-onboarding-assets.mjs`); a
   separate asset change should re-render them natively, with the hash pins
   updated in the same change.
6. **A cross-flow motion audit** once every layout is approved: the
   mascot entrances, the progress fill, the interstitial rows and the
   deck's depth, reviewed together for timing and restraint.
