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

_P2B7Z (2026-09-24, uncommitted): the Allergens step as a two-column grid of
tiles (§6.2). Retailers, the Preview, the paywall and the notification
education keep their P2B7X.1 content; their redesigns are later
milestones._

## 1. The sequence

```
Welcome → States (1 of 4) → Allergens (2 of 4) → Retailers (3 of 4)
  → Personalized Preview (4 of 4) → Hard paywall
  → purchase or restore success → Notification education
  → Apple's prompt only if the shopper chooses it → Feed
```

The rules, each pinned by a test named in §11:

- Welcome is not counted; the four counted steps read `1 of 4` … `4 of 4`.
- States opens on a map of the states and offers the searchable list beside
  it; both edit one draft (§6.1). No location permission is asked and no
  state is inferred.
- States requires at least one selection. Continue is disabled with none, and
  the reason is written beneath it (`Choose at least one state to continue.`)
  in a permanently allocated slot: the sentence is always laid out, and while
  a state is chosen it is invisible and hidden from assistive technology, so
  the footer and Continue keep one height and position at every text size
  when the last state is cleared (measured on device, §6.1).
- Allergens and retailers are optional. An empty selection is a complete
  answer and never blocks Continue.
- `Clear selection` is always in the layout on every selector step. With
  nothing selected it is disabled and its handler is a true no-op, so choosing
  or clearing never moves the rows (the P2B7V rule).
- The count line above each list is unconditional (`No states selected`, `2
allergens selected`, `3 stores selected`).
- Preferences save progressively through the existing store on every change.
  There is no Done and nothing to lose on a kill.
- Killing and reopening resumes the exact incomplete screen, forwards or
  backwards.
- Once personalization is complete, an unsubscribed relaunch opens on the
  paywall, never Welcome.
- Editing preferences later, from the Preview or from Profile, never resets
  onboarding or the entitlement.
- The paywall has no close, skip, free, trial or dismiss route. Its one way
  back is to the Preview.
- Purchase cancellation leaves the shopper on the paywall with a calm inline
  sentence. Purchase or restore success proceeds to notification education.
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
  version: (1, step, personalizationCompleted, notificationEducationCompleted);
}
```

| Field                            | Meaning                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| `step`                           | The last onboarding screen shown, recorded on focus while personalization is incomplete    |
| `personalizationCompleted`       | Sticky. Set by `View plans`. Never regresses, however the selectors are walked again       |
| `notificationEducationCompleted` | Sticky. Set by either education choice. Cannot be true while personalization is incomplete |

Stored as JSON in SecureStore under `recall.onboarding`
(`src/lib/onboarding-store.ts`), beside the preferences, so a reinstall keeps
the shopper's place with their choices. Every read passes through
`sanitizeOnboardingRecord`: any value that is not a well-formed version-1
record becomes the initial record — a corrupt or future blob restarts
onboarding rather than skipping it. "Reset app and delete my data" removes
the record with the rest of the local state (§7).

## 3. The access gate

`src/lib/access-gate.ts` resolves ONE phase from the record, the entitlement
and one in-memory flag:

| Phase        | When                                                                                | Lands on                          |
| ------------ | ----------------------------------------------------------------------------------- | --------------------------------- |
| `onboarding` | personalization incomplete, OR complete but the shopper pressed Back on the paywall | the resume step (Preview on Back) |
| `paywall`    | personalization complete, not entitled                                              | `/paywall`                        |
| `education`  | entitled, education not yet completed                                               | `/onboarding/notifications`       |
| `app`        | entitled and educated                                                               | `(tabs)` — the Feed               |

`reviewingPreview` is the paywall's Back: in memory only, so it re-enters
the onboarding phase on the Preview without touching completion, and a
relaunch forgets it — a device that completed personalization always
relaunches on the paywall.

### 3.1 The route matrix, and how it is enforced

Every route file under `src/app` is declared in the root layout inside a
`Stack.Protected` group whose guard is `phase === <its phase>`:

| Group       | Routes                                                                                                                                                   | Mounted in                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| paywall     | `paywall`                                                                                                                                                | `paywall`                                                                  |
| education   | `onboarding/notifications`                                                                                                                               | `education`                                                                |
| app         | `(tabs)` (Feed, Saved, Profile), `recall/[id]`, `settings/index`, `settings/personalization`, `settings/notifications`, `document/[slug]`, `report/[id]` | `app`                                                                      |
| onboarding  | `onboarding/welcome`, `onboarding/states`, `onboarding/allergens`, `onboarding/retailers`, `onboarding/preview`                                          | `onboarding`                                                               |
| development | `design-preview/index`                                                                                                                                   | every phase of a development build; `app` in a release build (inert there) |

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
   the paywall opens on the Preview);
5. the development hub.

No screen navigates across a phase. `View plans` completes the record; a
purchase or restore applies the entitlement; either education choice
completes the education; expiry changes the entitlement. The gate does the
rest. Within a phase, the steps push and pop as any stack does (`Back` pops
when the previous step is beneath, else replaces with it, so Back is
sequential on a resumed launch too; the last selector's Continue returns to
a Preview beneath it or pushes a new one).

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
   the paywall's development controls and the Design Preview's galleries.
   `npx expo export --platform ios` on 2026-09-23 confirmed the release bundle
   contains none of `recall.dev-purchases`, `DEVELOPMENT_PURCHASE_SCENARIOS`,
   `developmentPurchaseProvider`, `Apply scenario` or the long-price fixture,
   while `recall.entitlement`, `Subscribe for` and `Restore Purchases` are
   present. The adapter is **absent**, not merely unreachable.
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
absent on Welcome) and the mono `1 of 4` progress, the headline in
`heading-1` and body in secondary `body`, and a sticky footer for the actions
above a hairline that lifts with the keyboard on iOS. No fixed height around
text, no `maxFontSizeMultiplier`, no raw colour, no gradient. The paywall's
footer is the one that can outgrow a screen: from the accessibility text
sizes (`paywallFooterPlacement`, text scale 1.5 and up) its renewal
disclosure and four footer actions move to the end of the scrolling content,
directly above the still-sticky primary action, so the plans stay reachable.
Compositions are in [../DESIGN.md](../DESIGN.md) "Onboarding and paywall".

The copy is the founder's, verbatim, in `src/lib/onboarding-copy.ts` and
`src/lib/paywall-screen.ts`; `onboarding-design.test.ts` and
`paywall-screen.test.ts` pin every string.

| Screen                   | Component                                          | Route                       |
| ------------------------ | -------------------------------------------------- | --------------------------- |
| 1 Welcome                | `WelcomeContent`                                   | `/onboarding/welcome`       |
| 2 States, 1 of 4         | `StatesStep`: `StateMap` or `StateSelectorContent` | `/onboarding/states`        |
| 3 Allergens, 2 of 4      | `AllergensStep`: `AllergenTile` grid               | `/onboarding/allergens`     |
| 4 Retailers, 3 of 4      | `RetailersStep` over `StoreSelectorContent`        | `/onboarding/retailers`     |
| 5 Personalized Preview   | `PreviewStep`                                      | `/onboarding/preview`       |
| 6 Hard paywall           | `PaywallPanel`                                     | `/paywall`                  |
| 7 Notification education | `NotificationEducation`                            | `/onboarding/notifications` |

**Welcome.** The name `lotly`, the headline and body, the M01 mascot
(`assets/brand/production/lotly-mascot-welcome-peek-1024.png`) peeking over
the example card with its paws on the card's top edge, the source note, and
`Get started`. The mascot is the card's decorative sibling
(`SampleRecallCard`'s `peek`): hidden from VoiceOver, `pointerEvents="none"`,
never part of the card's accessibility element. It is the one screen with an
entrance of its own (`src/lib/welcome-presentation.ts`): the heading, then the
mascot rising from behind the card, then the card following, done within
900 ms, played once and skipped entirely under Reduce Motion. Composition in
[../DESIGN.md](../DESIGN.md) "Onboarding and paywall".

**Progress (P2B7Y).** The four counted steps show `OnboardingProgress` in
the frame's top bar: four segments over the visible `1 of 4` line. Completed
and current segments fill the `onboarding/progress` token; the steps ahead
keep the quiet `background/subtle` track. It is one accessibility element
spoken `Step 1 of 4: States` (then `Allergens`, `Stores`, `Preview`). The
current segment fills once, briefly, after the screen's push settles, and
only when Reduce Motion is known to be off; otherwise it is drawn full.
Welcome, the paywall and the notification education pass no progress and
draw none.

**The example card.** Welcome and the Preview show one illustrative recall —
Critical, Gummy Products, an undeclared peanut allergen, Nationwide, Affects
You — rendered through the Feed card's own `RecallCardSurface` over a static
model (`src/lib/onboarding-sample.ts`) with a bundled drawing of gummy candy
in the media slot and no save control. It is distinguishable from live data
three ways: the screen labels it (`Example` / `Example match`), its activity
slot reads `Example`, and its brand slot reads `Example, not a live recall`.
It opens nothing, cannot be saved, and needs no network. The shared
`MediaTile` keeps its "official URL or nothing" contract; the example draws
its own tile of the same geometry.

**Two copy exceptions.** The Retailers step's body (`Choose the retailers you
want Lotly to watch for in recall notices. This is optional.`) and the
Preview summary's row label (`Retailers`) say `retailers`, which the app-wide
copy rule otherwise forbids in favour of `store`. They are the founder's
final copy for this flow and are exempted by exact string in
`consumer-copy.test.ts`; everything else in onboarding keeps `Search stores`
and `N stores selected`. Flagged for confirmation in the milestone report.

**The paywall's states**, mapped by `paywallPresentation`: offering loading,
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

### 6.1 The States step: Map and List (P2B7Y)

**Why both.** Most shoppers find where they live faster on a map than in a
52-row list, so Map is the default. A map is also the hardest control for a
screen-reader user and for the smallest jurisdictions, so the searchable
list stays a first-class mode rather than a fallback. A `Map` / `List`
control switches between them.

**One draft.** `StatesStep` holds the draft, seeded from the saved
selection. The map toggles it with `toggleStateCode` and clears it with
`clearStateDraft`, the shared selector's own rules; List is the unchanged
shared `StateSelectorContent`, mounted over the current draft and reporting
every change back into the same commit. Every change saves progressively
through the route, exactly as before. Switching modes keeps every choice in
its canonical order; the list search starts blank on each List visit and
never unchecks anything.

**Map mode.** The contiguous states and the District of Columbia in one
panel; Alaska, Hawaii and Puerto Rico each in a dashed inset box beneath it,
the whole box its target. A tap is converted into the map's own units and
`stateAtPoint` (`src/lib/state-map.ts`) names the shape under the finger, or
the nearest shape within 10pt for a tap on water. `Zoom in on the Northeast`
enlarges Maine to Maryland about four times in a square framed view, where
Rhode Island and Delaware become real targets and the District, still a few
points across, is drawn as a round marker that takes taps within 12pt;
`Show the whole map` returns. Below the map: the count line, `Clear
selection`, and every chosen jurisdiction by name as a chip with a removal
control (`Remove California`). A chosen shape fills `action/primary` with a
white edge and carries a check at its interior point where the check fits
(always in the enlarged view, where the smallest need it); a chosen inset
gets a solid border and a checked badge; the chip list names every choice,
so colour is never the only channel. The map never animates.

**Clear selection** is always rendered in both modes, disabled with nothing
chosen, and an empty clear returns the same draft reference, so nothing is
set or saved (the P2B7V rule). In both modes its hint is onboarding's own
`Unchecks every state.`: the shared selector's default hint says nothing is
saved until Done, which is true in the Profile sheet and false here, so the
step passes `clearHint` and the sheet keeps its words. Continue, Back and the
resume point are unchanged.

**The required-state note** occupies the same slot whether or not it shows:
`STATES_REQUIRED_NOTE` is always laid out, at `opacity: 0` and hidden from
assistive technology while a state is chosen. A `' '` placeholder was one
line where the sentence wraps to three at the accessibility sizes, so
clearing the last state used to lift Continue. Measured through the iOS
accessibility tree on 2026-09-24, Continue's frame is identical before and
after clearing the last state, at the default size (iPhone 17) and at
AX-XXXL (iPhone SE 3rd generation), and the sentence is not clipped.

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

**Accessibility.** The drawing is hidden from assistive technology. Each
jurisdiction on the panel is an invisible checkbox element at its interior
point, named in full, reporting checked, and activated by VoiceOver's
double-tap (`onAccessibilityTap`) without intercepting finger touches; iOS
orders these by position, so VoiceOver reads the map north to south, and
List is the alphabetical path. Each inset is a named checkbox. `Map` and
`List` are buttons reporting `selected`, and the active word turns bold.
The Northeast control reports `expanded`. Removal controls name their state.
Every control is at least 44pt. At the accessibility text sizes the mascot
yields its room (text scale 1.5, the app's shared threshold), the
Map / List control takes the full width, the Northeast control wraps, and
the page scrolls; nothing is capped or clipped and Continue stays reachable.

**Mascot.** M02, `assets/brand/production/lotly-mascot-helper-1024.png`,
72pt beside the Map / List control: decorative, hidden from VoiceOver,
`pointerEvents="none"`, never over the map. It fades in with an 8pt settle
once, after the push settles, only when Reduce Motion is known to be off.

**Motion.** Two small entrances — the progress segment's fill and the
mascot's fade — each played once and skipped outright under Reduce Motion
(or while the setting is still unknown). `useReduceMotion` reads the setting
once per process, so later screens know it on their first frame. Nothing
loops.

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

**Deferred.** Retailers, the Preview ("Ready"), the paywall and the
notification education keep their P2B7X.1 content; only the shared progress
bar reached them. Their redesigns are later milestones.

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
in the selector rows — the onboarding Retailers step and the store sheet
under Profile — or the shared `home` glyph when no trustworthy mark is
bundled. Never on a recall card, never in Detail's retailer row.

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

| Concern                                                                                                                                                                | Test                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Record transitions, sticky completion, empty optional ≠ incomplete, sanitizing                                                                                         | `src/lib/onboarding-state.test.ts`            |
| Phase matrix, route matrix, layout order and guards, push-tap guard, no cross-phase navigation                                                                         | `src/lib/access-gate.test.ts`                 |
| Fail-closed, cached access, grace, launch timeout                                                                                                                      | `src/lib/entitlement.test.ts`                 |
| Unconfigured provider, adapter scenarios and containment, savings math, no USD in product code                                                                         | `src/lib/purchases/purchase-provider.test.ts` |
| Paywall copy, prices, cards, state matrix, no close/free/trial/lifetime                                                                                                | `src/lib/paywall-screen.test.ts`              |
| Release destinations and the readiness failure                                                                                                                         | `src/lib/release-destinations.test.ts`        |
| Allergen icons: coverage, one family, provenance, assets                                                                                                               | `src/lib/allergen-icons.test.ts`              |
| Retailer logos: manifest parity, local-only, containment, fallback, a11y name                                                                                          | `src/lib/retailer-logos.test.ts`              |
| Clear selection allocation, count lines, States gate, one store, copy, permission timing, example card, tokens                                                         | `src/components/onboarding-design.test.ts`    |
| Reset clears the record in order                                                                                                                                       | `src/lib/installation-reset.test.ts`          |
| Route inventory and the release bundle boundary                                                                                                                        | `src/lib/release-exposure.test.ts`            |
| States map: vocabulary coverage, hit testing in both views and the insets, one draft, empty clear, no network                                                          | `src/lib/state-map.test.ts`                   |
| Progress names and fills, motion gates, Map/List draft wiring, count and Clear, chips, a11y, M02, palettes, routes                                                     | `src/components/onboarding-design.test.ts`    |
| M02 on States only; M03–M05 unreferenced                                                                                                                               | `src/lib/mascot-assets.test.ts`               |
| Onboarding Clear hint vs the sheet's, the always-laid-out required note, the root fade under Reduce Motion, the reference mock-up unbundled                            | `src/components/onboarding-design.test.ts`    |
| The two `retailers` copy exceptions                                                                                                                                    | `src/lib/consumer-copy.test.ts`               |
| Allergens grid: canonical order, icons, two columns, one-column and stacked reflow, measured word widths, select/deselect/clear, count words                           | `src/lib/allergen-grid.test.ts`               |
| Allergen pictograms: nine semantic pairs by static require, 1024² RGBA sRGB files, alpha repair pinned to the originals, 44pt box geometry, review artifacts unbundled | `src/lib/allergen-assets.test.ts`             |
| Allergen tiles: one checkbox element, hidden pictogram and check, no layout change, compact Clear, motion gate, Back/Continue, mock-up unbundled                       | `src/components/onboarding-design.test.ts`    |

The Design Preview hub renders every screen and every paywall state from the
production components and offers gate scenarios that restart the real flow
from a chosen state ([recall-design-preview.md](recall-design-preview.md)).
