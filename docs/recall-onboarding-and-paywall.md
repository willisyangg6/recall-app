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
a one-time "building your watch" interstitial follows Stores (§6.6), the
Ready step is the personalized recall preview — the summary card and a
horizontal carousel of real matches — with no purchase UI (§6.4), and the
plans live on a dedicated onboarding paywall (§6.7) built from the shared
purchase flow the 2026-09-27 work created. The progress bar is a full-width
five-segment mark with no visible count. The standalone paywall remains for
a lapsed subscriber. The notification education keeps its P2B7X.1 content._

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
  → Building your watch (once, ~3.2s) → Ready (the personalized preview)
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
- The building interstitial plays exactly once (§6.6): not again when
  returning from Ready or the paywall, not on a relaunch after it
  completed, and a kill during the play finishes the one play. It replaces
  itself with Ready, so it never joins the back chain.
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
  There is no Done and nothing to lose on a kill.
- Killing and reopening resumes the exact incomplete screen, forwards or
  backwards — the paywall included.
- Ready shows what the watch found (§6.4): up to three REAL current matches
  through the Feed's own matching layer and card, or the honest empty,
  checking or could-not-check state. Nothing is ever fabricated, and
  matches beyond the third are locked without exposing anything about them.
- Ready's Back goes to Stores; `Edit preferences` opens States with every
  choice kept; `See my plan` (and the locked strip and sentinel) opens the
  dedicated onboarding paywall, whose Back returns to Ready.
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
| `watchBuilt`                     | Sticky. The building interstitial completed its one play; Stores' Continue then skips it forever                                            |
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

`src/hooks/use-access.tsx` is the provider that performs all of this once,
above the stack, and exposes the phase and the transitions.

## 5. The purchase boundary

`src/lib/purchases/purchase-provider.ts` is the typed interface the paywall,
the gate and the education stand on:

```ts
interface PurchaseProvider {
  readonly id: 'unconfigured' | 'development' | 'revenuecat';
  loadOfferings(): Promise<OfferingsResult>; // ready | unavailable | error
  readEntitlement(): Promise<EntitlementReading>; // active | inactive | unavailable
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
- `unconfiguredPurchaseProvider()` is what a release build runs until a real
  provider is configured: it answers `unavailable` to everything, which the
  gate resolves to inactive with no cache. **Production without a configured
  provider fails closed.**

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
set.` once, in that session, until it loses focus.

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

### 6.4 The Ready step: the personalized preview (2026-09-26; carousel 2026-09-28)

The Ready step shows what the watch found, and nothing else is sold on it:
the merged Ready/paywall presentation (2026-09-27) is retired, and every
plan, benefit row, renewal term, legal link and subscription control moved
to the dedicated paywall (§6.7). The approved composition target is
`assets/brand/reference/lotly-onboarding-ready-carousel-target.png` — a
design reference only: nothing bundles it (§11). Top to bottom:

1. The top bar: Back (to Stores). No progress bar.
2. The heading `Your recall watch is ready.` and the body `Here’s what
Lotly found for your household.` — the body keeps the approved "cliff":
   it wraps left of the mascot, which peeks over the card in the space it
   leaves.
3. The summary card with the trust-peek mascot (below); a long Stores row
   is compacted, and `Edit preferences` lives INSIDE the card — a quiet
   `body-small-bold` text action with the `chevron-right` affordance,
   right-aligned on the card's own last row, 44pt through hitSlop, in
   `action/primary` (`action/secondary` on the soft blue is 4.1:1, below AA
   for 13pt text). It pushes States with every choice kept.
4. `See what affects you today` (`heading-2`, a real header), then the lime
   count pill — the Affects You treatment (`relevancePalette`), a
   personalization signal and never a safety claim — reading `1 recall for
your watch`, `2 recalls…` or `3 recalls…` for the READABLE matches.
5. The horizontal recall deck (`ReadyCarousel`, below), then its dots.
6. The soft-blue locked strip (`More matching recalls are locked`, a lock
   glyph, one button to the paywall) — ONLY when more real matches exist
   than the preview shows; otherwise the truthful monitoring line (`We’ll
keep checking as new recalls are announced.`).
7. The one pinned action: `See my plan`, which opens the onboarding paywall.

**The preview data.** `src/lib/ready-preview.ts` is the whole rule, and it
is the Feed's own layers called in the Feed's own order: the shared feed
session (`useFeed`; the interstitial warmed it), `evaluatePersonalRelevance`
per item, membership and ordering from `buildAffectsMeSections` (the
CURRENT Affects Me ordering — no ranking changed), and `buildHomeCardModel`
for each shown item. The preview shows the current window (`affects`); the
Feed's collapsed older tail is not "today" and is not counted. There is no
onboarding-only matcher, no copied card, no fixture data and no screenshot.

**The image-led selection (polish pass).** From the ranked matches the
deck keeps only recalls with a usable product image (the shared image-role
allocation's `heroImageUrl`), in rank order: the first three image-bearing
matches are the readable cards, and the NEXT image-bearing match — when one
exists — is the locked final card. These are the first image-bearing
results in rank order, not necessarily the raw first results, and no copy
calls them "top". The true total of every match (imaged or not) is carried:
the locked STRIP shows whenever more real matches exist than the deck
shows (`hasLockedMatches`), while the locked CARD requires a real next
image-bearing match (`preview.locked`). With matches but none imaged, the
deck is empty and the pill counts the real total; fewer imaged matches
simply mean fewer cards. Nothing is invented or duplicated.

**The deck.** Not a flat list: one card per page, snapping one card at a
time, with the NEXT card waiting partly behind the active card's trailing
edge — scaled to 0.93 and tucked 16pt toward it (`DECK_NEXT_SCALE`,
`DECK_TUCK`), under a descending static z-order so the active card always
covers it. Both transforms interpolate on the scroll position alone, so the
depth follows the finger and settles with the snap; there is no autonomous
motion, so Reduce Motion has nothing to remove. Restrained depth only: the
cards keep their own `card` elevation, and there is no glass, gradient or
extra shadow. No arrows, no instruction copy, no auto-advance, no loop.
The dots count only the readable cards (navy active on pale blue,
decorative, none for a single card); the locked card earns none.

**Uniform cards.** Every deck card takes one outer size at a given width
and text-size class, through the shared surface's opt-in `uniform` variant
(`RecallCardSurface`, `previewCardLayout`): the title is limited to two
lines and reserves both, the category chip and the reason (two lines)
reserve their slots even when the case has neither, and the status row
reserves the tallest row the deck MEASURED (`deckStatusHeight` — one chip
row on most decks, two where a card's row wraps, never an empty band).
Every deck card has an image by construction, so the 112pt media region is
identical. All reservations are min heights that grow with Dynamic Type and
never clip, and every clamped text node still carries its full content to
the card's one spoken element. From the accessibility text sizes
(`previewCardUniform`, scale 1.5) the variant is off and the cards wrap
freely — an accessible responsive deck, never capped type. Feed and Saved
never receive the variant: the live card passes nothing and renders exactly
as before (`feed-design.test.ts` pins the callers).

**The locked final card.** The real next image-bearing recall's own
uniform card — the same dimensions as the readable cards — under a real
blur (`expo-blur`'s `BlurView`, intensity 60, light tint, clipped to the
card's radius) with one centered lock in a small white well, and no text
of its own. It is the last page: a swipe past it goes nowhere. To
assistive technology it is ONE concise button, `More matches are locked`
(the plan screen); the blurred card underneath is hidden entirely, so
VoiceOver never traverses illegible content and nothing of the recall is
exposed. Under Reduce Transparency the blur yields to a 96% opaque frost,
still illegible. The locked STRIP below the deck is unchanged — the same
words, the same action — and stays the persistent explanation whichever
card is active.

**The edges, each honest.** One, two or three image-bearing matches: those
cards and no locked card; the strip appears only if further real matches
(imaged or not) exist, else the monitoring line. One card has no dots.
Zero matches: no deck, no dots, no strip — the body becomes `Lotly will
keep checking for recalls that match your household.` and one quiet card
reads `Nothing currently matches your watch.` A feed that has not answered
shows `Checking for recalls that match your watch…`, and one that could not
be read says `Lotly couldn’t check for matches right now.` `See my plan`
stands in every state.

Removed from the step (2026-09-28): the plans, the benefit check rows, the
`Choose your plan` heading, the independence note, the renewal terms, the
legal links, the development store controls, the pinned purchase CTA and
its overlay-footer and scroll-threshold machinery (the frame is back to one
fixed footer), and the entitled `Continue` variant — an entitled shopper
meets the entitled panel on the paywall instead (§6.7).

**The Stores row, compacted.** Up to three stores show in full. Four or more
show the first two in the summary's own (chosen) order and `+N more`
(`Aldi, BJ's Wholesale Club +4 more`), with a no-break space so the count
never wraps apart. The row still SPEAKS every store (`Stores: Aldi, BJ's
Wholesale Club, Trader Joe's, Sam's Club, Safeway and Publix, completed`).
States and allergens are never compacted. The rule is `storeSummaryText` in
`src/lib/ready-presentation.ts`.

**Analytics.** None. Lotly ships no analytics SDK (the privacy lock in
`src/content/privacy-data-controls.ts`), so there were no Ready or paywall
events to preserve and none were added.

**The summary card.** One soft-blue `background/subtle` card headed `Your
preferences are set`, with three rows: `States`, `Allergens`, `Stores`. The
last was `Retailers`; it now uses Profile's own row name, so the second copy
exception is gone. Each row is the category's artwork in a 40pt white
rounded-square well at the leading edge, the label over the values in the
middle, and a completed check in a pale-blue circle at the trailing edge.
Every row shares the white well; this was the founder's 2026-09-26 decision,
made after seeing the tint evidence below. States carries the navy `map-pin`
glyph and Stores the navy `shopping-cart` glyph. The cart is new to the icon
set: Lucide's `shopping-cart` (ISC), byte-identical to the file at the
allergen family's pinned commit (`f06ac67e…`, release 1.47.0), vendored in
`assets/icon-sources/lucide/`. `scripts/render-onboarding-assets.mjs`
rasterises it at the set's box and stroke natively at each scale (24, 48 and
72px). The older Lucide glyphs were rasterised once at 24px and stretched,
which is why the cart's first rasters looked soft beside the Figma-exported
map pin. `allergen-icons.test.ts` pins the source and the three files by
hash. Both lines of text are `text/primary`, because grey `text/secondary`
on the soft blue is 3.2:1, below AA. The label is Public Sans `caption`
(medium, 12pt) over the values' `body` (regular, 16pt), and the check is a
20pt `icon/primary` glyph, the pin's navy, in the pale circle.

**The allergen artwork.** The approved pictograms, through the one map in
`src/lib/allergen-assets.ts`, **untinted**. The brief asked for navy
tinting, but tinted navy, tree nuts turns into a blob and egg into two
merged ovals, so the founder kept full colour. The order is always
`CONSUMER_ALLERGENS`', never tap order:

- **None:** a neutral navy dash (the project has no generic allergen glyph),
  and the value reads `None`.
- **One:** its pictogram in a 32pt box, at most 22.3pt of drawing, the map
  pin's size.
- **Two:** both in 28pt boxes on the well's diagonal, meeting only at one
  corner; the pair fills the 40pt well exactly.
- **Three or more:** the first two and a `+N` in the well's empty top
  trailing corner; the text still names every allergen.

**The mascot.** M06, `assets/brand/production/lotly-mascot-ready-trust-peek-1024.png`,
is a transparent raster (not SVG) drawn whole with `contain` as the card's
sibling after it. It is seated from measurements of its own artwork: the flat
cut is on the card's top border, the left paw rests about 7pt over it, and
the shield and right paw hang in front at the trailing edge, above the checks.

- **Size:** 0.195 of the window height, 140–180pt (172pt on an iPhone 17),
  and 140pt from the accessibility sizes. The 2026-09-26 polish pass raised
  it from 120–152pt, about 17–19% more visible drawing; the card sits that
  much lower to keep the reserved clearance above it.
- **Space:** the reserve above the card is the drawing's height less a
  48pt rise (`readyMascotReserve`, 2026-09-28): at ordinary text sizes the
  crest climbs beside the body paragraph's trailing whitespace, tightening
  the iPhone 17 composition by 48pt, and from text scale 1.2 the full lift
  comes back so the wrapping paragraph can never touch it. The seat, the
  paw and the shield are unmoved, and the drawing still never reaches
  the body text. The card heading keeps clear of the shield, and the first
  row starts below it.
- **Decorative:** hidden from VoiceOver and `pointerEvents="none"`.

The file as supplied was 1254×1254 with 625,268 pixels at alpha 240–254 and
a `caBX` metadata chunk. It was repaired with the mascots' mechanical rule
at its own size, then uniformly resampled to 1024. It was not cropped,
shifted or recoloured, and has zero enclosed holes. It replaces nothing:
M03, the grocery-bag "ready" pose, is a different character (it left
Stores with the receipt, 2026-09-30, and is drawn nowhere). The paywall draws no
mascot; the watchful pose M04 now belongs to the building interstitial
(§6.6), and M05 stays unreferenced.

**Accessibility.** Each row is one element spoken with its complete
selection: `States: California, completed`, `Allergens: Peanuts and Tree
nuts, completed`, `Stores: Aldi and BJ's Wholesale Club, completed`, and
`Allergens: None, completed` when nothing is chosen. The artwork, `+N`,
check and mascot are never heard. The card heading is a header. From the
accessibility sizes (text scale 1.5) each row stacks, with the artwork and
check on a top line and the text full-width beneath, and the heading drops
below the shield at full width. Values then wrap only between words. At AX5
the heading's `preferences` is wider than the card's whole line and still
breaks, which only a capped type size could prevent.

**Motion.** The mascot's one entrance is the States and Retailers mascots'
fade with an 8pt settle, played once after the push. Under Reduce Motion, or
before the setting is known, it is simply there. The root route transition
is unchanged.

**Native verification of the summary card (2026-09-26, iPhone 17 and iPhone
SE 3rd gen, iOS 26.3).** Checked through the real flow:

- Two allergens (Peanuts + Tree nuts) with Aldi and BJ's Wholesale Club.
- Four allergens chosen out of canonical order, which drew Peanuts, Tree
  nuts and `+2`.
- One allergen (Sesame), and none (the dash).
- Six stores, which wrap between words.
- Default text and AX5.
- Reduce Motion off (the mascot fades in after the slide) and on (drawn in
  place through the cross-dissolve).
- Back to Stores and Continue back to Ready.
- Edit preferences to States with every choice kept.
- A kill and relaunch that resumed on Ready.

The accessibility tree, read through the Simulator's bridge, showed the row
labels above and no mascot, pictogram or check.

**The merged step's 2026-09-27 native verification** covered a presentation
this restructure retired; its purchase findings carry over only insofar as
the shared purchase pieces are unchanged and are re-verified on the
dedicated paywall (§6.7). The restructure's own native verification is
recorded in §6.8.

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

### 6.6 The building interstitial (2026-09-28)

After Stores' Continue on a first pass, `/onboarding/building` plays ONE
~3.2-second assembly of the watch (`src/lib/building-watch.ts`,
`src/components/onboarding/building-step.tsx`): the M04 watchful mascot
(its first integration; decorative, fixed box), then a checklist of four
working captions at 700ms each and a completion line held 400ms —

1. `Checking recalls in your selected states`
2. `Matching the allergens you watch` — or, with none chosen, `Keeping
allergen matching broad`
3. `Watching the stores you chose` — or, with none, `Scanning recalls
across all stores`
4. `Building your Affects You feed`
5. `Your recall watch is ready`

The captions name real work: the route mounts `useFeed`, so the feed sync
the Ready preview reads runs (or answers from cache) underneath — the
prefetch — and the preferences described are the saved ones. No caption
lists selection names, and none claims a match was found: matches are
Ready's to report, after the query answers. The screen never waits on the
feed and never traps — at the sequence's end it marks the sticky
`watchBuilt` fact and REPLACES itself with Ready, whose own honest states
cover a slow or failed feed (§6.4). An unreadable preference store skips
the play entirely and routes to Ready, whose pending state explains it.

**Once means once.** Stores' Continue routes through the interstitial only
while `watchBuilt` is false; returning from Ready or the paywall, editing
preferences (`dismissTo` the Ready beneath), and every relaunch after
completion skip it. A kill DURING the play resumes on it (the recorded
step) and finishes the one play. Because it replaces itself, Back from
Ready pops to Stores and can never land on a spent interstitial.

**Why a full-flow recording can miss it (polish-pass diagnosis).** The
interstitial is skipped whenever the stored record already says
`watchBuilt: true` — by design, once per onboarding. Walking Back to
Welcome, or a record migrated from version 1 at the old Preview, keeps the
flag, so a device that has played it once never plays it again from
Stores: that is what the earlier recording showed. The development
`Reset onboarding to Welcome` writes the INITIAL record (`watchBuilt:
false`), but from the onboarding paywall (inside the onboarding phase) the
phase did not change, so nothing moved and the reset LOOKED broken until a
relaunch; it now pops to the stack's root and replaces it with the entry
screen, as the Design Preview's gate scenarios do (the same same-phase gap
was fixed there). A genuinely fresh flow after the reset was recorded
playing the interstitial between Stores and Ready (§6.10). The intended
once-only behavior is unchanged.

**Motion and accessibility.** Rows appear one at a time with a single
200ms fade each — no rings, no springs, no loops. Under Reduce Motion (or
before the setting is known) the finished checklist is drawn at once and
the screen advances after a readable 1.6s minimum. The checklist is ONE
element (`Building your recall watch`, role `progressbar`); exactly two
announcements are made — the start and the completion — never a frame or a
percentage; the mascot is hidden and untouchable; and the replace hands
focus to Ready's own heading.

### 6.7 The dedicated onboarding paywall (2026-09-28)

`/onboarding/paywall`, reached from Ready's `See my plan`, its locked strip
and its locked sentinel — and nothing else. It composes the SAME
`PaywallPanel` and the SAME purchase flow as the standalone `/paywall`
(§6.4 of the 2026-09-27 work created both; the split keeps them): there is
still exactly one implementation of offering loading, plan state, purchase,
restore, notices, legal links, entitlement handling and the development
controls (`hooks/use-purchase-flow.tsx`), and neither route holds purchase
state. Top to bottom: Back (pops to Ready); the headline `Stay ahead of
recalls that affect you.` (reworded for the split — the paywall now follows
the personalized preview) and its body; the three approved benefits; the
Annual and Monthly plan cards; the development-store controls in a
development build only; the independence note; then the shared footer — the
outcome notice and the primary purchase action pinned, with the renewal
disclosure and Restore Purchases / Terms / Privacy / Support sticky at
ordinary sizes and inline from the accessibility sizes
(`paywallFooterPlacement`, unchanged). No preference summary, no example
recall, no notification preview, no progress bar, no second "your watch is
ready" message, and no discount/back-out offer (deferred, §12).

**Lotly personality, restrained (polish pass).** No new copy or sections.
M04, the watchful pose, sits beside the heading in the frame's aside — the
States and Stores seat and 120pt size — decorative, with the shared
one-time entrance, and gone from the accessibility sizes. The three
benefits are navy `check` rows (20pt `icon/primary`, the check decorative)
instead of dots. The selected plan's border grows to 2px `action/primary`
(the padding gives the pixel back, so nothing reflows); Monthly stays fully
available and legible, subordinate by the absent badge and thinner border.
`BEST VALUE` is a TAB of the Annual card: flush with its top trailing
corner, its border on the card's, squared where it meets the card's radius;
from the accessibility sizes it returns to the title row, where wrapping
text cannot run under it. The badge is drawing — the radio's own label
already speaks `Best value` — so it adds no second element. Store price
strings are untouched, and every purchase, cancellation, error, restore and
entitlement path is the shared flow's, unchanged. The entitled panel gains
the same mascot and check rows.

**Navigation and entitlement.** The route records itself as the resume
point, so a kill on the paywall resumes there. A verified purchase or
restore completes personalization WITH the entitlement in one commit (§3):
the gate goes straight to education, never through the paywall phase or the
Feed. Cancellation and failure stay here with their calm notice and every
choice kept; no free Feed access exists in any path. A shopper already
entitled (restored elsewhere, subscribed on another device) meets
`EntitledPaywallPanel` instead: the active subscription said plainly
(`Subscription active` on the success surface), the benefits, and a
`Continue` that completes personalization — never a second purchase ask.
The lapsed subscriber's standalone `/paywall` is untouched: same panel,
same flow, its Back still `reviewingPreview` (§3).

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

## 10. P2B7X.2 — connecting the real store (not started)

What P2B7X.2 does, and what it does not touch:

1. Create the App Store subscription group with two products, expected US
   prices `$29.99/year` and `$4.99/month`. Apple Developer enrollment and the
   App Store Connect record come first
   ([recall-release-readiness.md](recall-release-readiness.md) §6).
2. Configure RevenueCat with those products, one entitlement, and one
   offering holding the annual and monthly packages.
3. Add the RevenueCat adapter behind `PurchaseProvider` — `id: 'revenuecat'`
   — constructed with `purchaseIdentity` (`Purchases.logIn(installationId)`),
   mapping `CustomerInfo` to `EntitlementReading` (an active entitlement with
   its expiry; `unavailable` on a network or configuration error, never a
   guess), `Offerings` to `Offering` (the store's `priceString`, `price` and
   `currencyCode`), and the purchase and restore results to the four
   outcomes. Replace the one line in `resolvePurchaseProvider`'s release
   path. Nothing above the boundary changes: not the gate, not the paywall,
   not onboarding.
4. Add the SDK's public API key as the third `EXPO_PUBLIC_` variable, which
   `release-exposure.test.ts` freezes today on purpose so the addition is a
   recorded decision, and set it on EAS for `production`.
5. Supply the Terms, Privacy and Support destinations and make
   `qa:launch-readiness` pass.
6. Update the App Privacy answers (Purchases: collected, linked to the
   installation identifier) and the EULA decision for a subscription
   ([recall-app-store-readiness.md](recall-app-store-readiness.md)).

## 11. Tests

| Concern                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Test                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Record transitions, sticky completion and `watchBuilt`, empty optional ≠ incomplete, the v1→v2 migration that keeps the shopper's place, foreign blobs restart                                                                                                                                                                                                                                                                                                                                                                                       | `src/lib/onboarding-state.test.ts`                                                                                 |
| Phase matrix, route matrix, layout order and guards, push-tap guard, no cross-phase navigation                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `src/lib/access-gate.test.ts`                                                                                      |
| Fail-closed, cached access, grace, launch timeout                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `src/lib/entitlement.test.ts`                                                                                      |
| Unconfigured provider, adapter scenarios and containment, savings math, no USD in product code                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `src/lib/purchases/purchase-provider.test.ts`                                                                      |
| Paywall copy, prices, cards, state matrix, no close/free/trial/lifetime                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `src/lib/paywall-screen.test.ts`                                                                                   |
| Release destinations and the readiness failure                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `src/lib/release-destinations.test.ts`                                                                             |
| Allergen icons: coverage, one family, provenance, assets                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `src/lib/allergen-icons.test.ts`                                                                                   |
| Retailer logos: manifest parity, local-only, containment, fallback, a11y name                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `src/lib/retailer-logos.test.ts`                                                                                   |
| Clear selection allocation, count lines, States gate, one store, copy, permission timing, example card, tokens                                                                                                                                                                                                                                                                                                                                                                                                                                       | `src/components/onboarding-design.test.ts`                                                                         |
| Reset clears the record in order                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `src/lib/installation-reset.test.ts`                                                                               |
| Route inventory and the release bundle boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `src/lib/release-exposure.test.ts`                                                                                 |
| States map: vocabulary coverage, hit testing in both views and the insets, one draft, empty clear, no network                                                                                                                                                                                                                                                                                                                                                                                                                                        | `src/lib/state-map.test.ts`                                                                                        |
| Progress names and fills, motion gates, palettes, routes; the grocery-atlas States: one draft, composition, local type, chips, chooser                                                                                                                                                                                                                                                                                                                                                                                                               | `src/components/onboarding-design.test.ts`                                                                         |
| Onboarding Clear hint vs the sheet's, the always-laid-out required note, the root fade under Reduce Motion, the reference mock-up unbundled                                                                                                                                                                                                                                                                                                                                                                                                          | `src/components/onboarding-design.test.ts`                                                                         |
| No `retailers` copy exception left in onboarding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `src/lib/consumer-copy.test.ts`                                                                                    |
| Allergens grid: canonical order, icons, two columns, one-column and stacked reflow, measured word widths, select/deselect/clear, count words                                                                                                                                                                                                                                                                                                                                                                                                         | `src/lib/allergen-grid.test.ts`                                                                                    |
| Allergen pictograms: nine semantic pairs by static require, 1024² RGBA sRGB files, alpha repair pinned to the originals, 44pt box geometry, review artifacts unbundled                                                                                                                                                                                                                                                                                                                                                                               | `src/lib/allergen-assets.test.ts`                                                                                  |
| Allergen tiles: one checkbox element, hidden pictogram and check, no layout change, compact Clear, motion gate, Back/Continue, mock-up unbundled                                                                                                                                                                                                                                                                                                                                                                                                     | `src/components/onboarding-design.test.ts`                                                                         |
| Stores quick choices and search: the six ids and order, one catalog record each, the other four and every store findable, catalog unchanged at 77, case/punctuation/alias search, empty and no-match queries, the sheet's fixed top edge, toggle/clear/empty clear                                                                                                                                                                                                                                                                                   | `src/lib/retailer-grid.test.ts`                                                                                    |
| Stores receipt layout: the slice maps to its rows at any height, the paper grows on every phone for 44pt rows, targets never overlap, scene vs stacked by text size, every word fits its column (measured from the font), the SE AX5 headline limit                                                                                                                                                                                                                                                                                                  | `src/lib/stores-receipt-presentation.test.ts`                                                                      |
| Stores receipt layers: approved bytes and format, the report's offsets and slice, only Stores draws them, no reference imported                                                                                                                                                                                                                                                                                                                                                                                                                      | `src/lib/stores-receipt-assets.test.ts`                                                                            |
| Stores step and search sheet: no second mode and none of the retired grid, six checkbox rows in order, no marks, the count row's allocated slot, the search action, the three decorative layers growing upward and stacking, one Modal sheet with a fixed frame and pinned Done, autofocus, instruction and no-match lines, single-column checkbox results, one shared selection, choosing keeps the sheet, every exit keeps choices, query never saved, Reduce Motion, overlay gone, Profile unchanged, Back/Continue/resume, mock-ups unreferenced | `src/components/onboarding-design.test.ts`                                                                         |
| M04 on the interstitial and paywall, M06 on Ready; M01, M02, M03 and M05 unreferenced; M06's measured seat and repaired bytes                                                                                                                                                                                                                                                                                                                                                                                                                        | `src/lib/mascot-assets.test.ts`                                                                                    |
| The receipt Welcome's two images: approved bytes, RGBA sRGB at the measured sizes, the report's accuracy and superseded hero, drawn only by Welcome, no reference or source material imported                                                                                                                                                                                                                                                                                                                                                        | `src/lib/welcome-receipt-assets.test.ts`                                                                           |
| The grocery-atlas States' scene: approved bytes, RGBA sRGB at the measured size, the report's accuracy, drawn only by States, no reference or source material imported                                                                                                                                                                                                                                                                                                                                                                               | `src/lib/states-grocery-atlas-assets.test.ts`                                                                      |
| The States chooser's search (names, postal codes, Washington DC, no match, no duplicates) and the measured geometry                                                                                                                                                                                                                                                                                                                                                                                                                                  | `src/lib/states-presentation.test.ts`                                                                              |
| Ready: allergen artwork for 0, 1, 2 and 3+ in canonical order, row labels, the mascot's seat at both size bounds, heading and rows clear of the shield, the accessibility-size stacking                                                                                                                                                                                                                                                                                                                                                              | `src/lib/ready-presentation.test.ts`                                                                               |
| Ready: rows and order, artwork left and check right, one spoken element per row, untinted pictograms through the one map, the decorative mascot and its once-only entrance, Back/Edit/See my plan, the approved order (card → Edit → heading → pill → deck → locked strip → CTA), no purchase UI, honest empty/checking/unavailable states                                                                                                                                                                                                           | `src/components/onboarding-design.test.ts`                                                                         |
| The carousel: horizontal snap and peek geometry, the real shared card surface and media tile, one spoken element per card with its position, no arrows/instruction copy/auto-advance/loop, truthful dots, the sentinel exposing nothing                                                                                                                                                                                                                                                                                                              | `src/components/onboarding-design.test.ts`, `src/lib/ready-presentation.test.ts`                                   |
| The preview data: the Feed's own matching and ordering, at most three readable, the true total, zero/one/two/three/more-than-three, checking and unavailable, hidden matches absent entirely                                                                                                                                                                                                                                                                                                                                                         | `src/lib/ready-preview.test.ts`                                                                                    |
| The problem screens: exact CDC copy and sources (comments only, never bundled), the spoken stat, the one-element pictograph, the four risk rows (one element each, decorative illustrations, heading-3 live labels, hairlines only between rows, no pill/card/background/grid), no mascot, no capped or truncated text, no unsupported statistics                                                                                                                                                                                                    | `src/components/onboarding-design.test.ts`                                                                         |
| The statistic assets: byte-identical sources, production format/alpha/holes, the report's accuracy, the one-to-one mapping, no reference imported by app code                                                                                                                                                                                                                                                                                                                                                                                        | `src/lib/statistics-assets.test.ts`                                                                                |
| The problem presentation rules: the accessibility threshold, the pictograph canvas, the risk rows' measured label widths, transparent-band trims, default iPhone 17 and SE fit arithmetic, larger-text and accessibility-size arrangements                                                                                                                                                                                                                                                                                                           | `src/lib/problem-presentation.test.ts`                                                                             |
| The interstitial: truthful captions and both zero variants, ~3.2s timing, plays once and replaces itself, Reduce Motion static path, no loop, two announcements, safe preference-failure exit                                                                                                                                                                                                                                                                                                                                                        | `src/lib/building-watch.test.ts`, `src/components/onboarding-design.test.ts`                                       |
| The segmented progress: five segments, no visible count, one spoken element, the five counted screens only                                                                                                                                                                                                                                                                                                                                                                                                                                           | `src/components/onboarding-design.test.ts`                                                                         |
| One purchase flow: purchase, restore and offering loads called only in `use-purchase-flow.tsx`, announced outcomes, both paywall routes composing it, Ready touching none of it                                                                                                                                                                                                                                                                                                                                                                      | `src/components/onboarding-design.test.ts`                                                                         |
| The paywall order (benefits → plans → controls → independence note → shared footer), no Ready content, the entitled panel without a purchase ask                                                                                                                                                                                                                                                                                                                                                                                                     | `src/components/onboarding-design.test.ts`                                                                         |
| A paywall purchase completes personalization in the same commit and goes straight to education, never the paywall phase                                                                                                                                                                                                                                                                                                                                                                                                                              | `src/lib/access-gate.test.ts`                                                                                      |
| The merged machinery is gone: no overlay footer, no scroll CTA rule, no merged copy in product source                                                                                                                                                                                                                                                                                                                                                                                                                                                | `src/components/onboarding-design.test.ts`                                                                         |
| Polish pass — the image-led deck: ranked matches narrowed to image-bearing ones in rank order, three readable, the real fourth locked, no locked card without one, the strip counting every unshown match, deterministic                                                                                                                                                                                                                                                                                                                             | `src/lib/ready-preview.test.ts`                                                                                    |
| Polish pass — uniform cards (reserved slots from the type scale, off from the accessibility sizes), the measured status row, restrained depth; the variant opt-in with no Feed or Saved caller                                                                                                                                                                                                                                                                                                                                                       | `src/lib/ready-presentation.test.ts`, `src/components/feed-design.test.ts`, `src/server/feed-saved-parity.test.ts` |
| Polish pass — the deck's frosted real final card (one button, nothing exposed), Stores' quiet count row with no summary or chips, the story screens, the paywall's M04, check rows and corner badge                                                                                                                                                                                                                                                                                                                                                  | `src/components/onboarding-design.test.ts`                                                                         |
| Polish pass — the progress fill only forward-by-one; Stores' Continue and the reset restoring the interstitial                                                                                                                                                                                                                                                                                                                                                                                                                                       | `src/lib/onboarding-state.test.ts`, `src/lib/onboarding-navigation.test.ts`                                        |
| Store summary: three in full, then two and `+N more`, every store still spoken                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `src/lib/ready-presentation.test.ts`                                                                               |

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
4. **Notification education polish.** The education screen keeps its
   P2B7X.1 composition; it is the one onboarding screen this pass left
   visually untouched.
5. **Regenerate the remaining blurred Lucide rasters.** The allergen and
   States glyphs predate the native-scale rasterization (`shopping-cart`
   and `lock` are crisp; see §9 and `render-onboarding-assets.mjs`); a
   separate asset change should re-render them natively, with the hash pins
   updated in the same change.
6. **A cross-flow motion audit** once every layout is approved: the
   mascot entrances, the progress fill, the interstitial rows and the
   deck's depth, reviewed together for timing and restraint.
