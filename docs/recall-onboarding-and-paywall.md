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

## 1. The sequence

```
Welcome → States (1 of 4) → Allergens (2 of 4) → Retailers (3 of 4)
  → Personalized Preview (4 of 4) → Hard paywall
  → purchase or restore success → Notification education
  → Apple's prompt only if the shopper chooses it → Feed
```

The rules, each pinned by a test named in §11:

- Welcome is not counted; the four counted steps read `1 of 4` … `4 of 4`.
- States requires at least one selection. Continue is disabled with none, and
  the reason is written beneath it (`Choose at least one state to continue.`)
  in a permanently allocated line.
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

| Screen                   | Component                                   | Route                       |
| ------------------------ | ------------------------------------------- | --------------------------- |
| 1 Welcome                | `WelcomeContent`                            | `/onboarding/welcome`       |
| 2 States, 1 of 4         | `StatesStep` over `StateSelectorContent`    | `/onboarding/states`        |
| 3 Allergens, 2 of 4      | `AllergensStep`                             | `/onboarding/allergens`     |
| 4 Retailers, 3 of 4      | `RetailersStep` over `StoreSelectorContent` | `/onboarding/retailers`     |
| 5 Personalized Preview   | `PreviewStep`                               | `/onboarding/preview`       |
| 6 Hard paywall           | `PaywallPanel`                              | `/paywall`                  |
| 7 Notification education | `NotificationEducation`                     | `/onboarding/notifications` |

**Welcome.** The name `lotly` above the approved mascot
(`assets/brand/production/lotly-mascot-transparent.png`), the headline and
body, the example card, the source note, and `Get started`. It is the one
screen with an entrance of its own (`src/lib/welcome-presentation.ts`): the
mascot, then the heading, then the card, done within 900 ms, played once and
skipped entirely under Reduce Motion. Composition in
[../DESIGN.md](../DESIGN.md) "Onboarding and paywall".

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

One family for all nine rows: **Lucide** (ISC), the outline language the
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

| Concern                                                                                                        | Test                                          |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Record transitions, sticky completion, empty optional ≠ incomplete, sanitizing                                 | `src/lib/onboarding-state.test.ts`            |
| Phase matrix, route matrix, layout order and guards, push-tap guard, no cross-phase navigation                 | `src/lib/access-gate.test.ts`                 |
| Fail-closed, cached access, grace, launch timeout                                                              | `src/lib/entitlement.test.ts`                 |
| Unconfigured provider, adapter scenarios and containment, savings math, no USD in product code                 | `src/lib/purchases/purchase-provider.test.ts` |
| Paywall copy, prices, cards, state matrix, no close/free/trial/lifetime                                        | `src/lib/paywall-screen.test.ts`              |
| Release destinations and the readiness failure                                                                 | `src/lib/release-destinations.test.ts`        |
| Allergen icons: coverage, one family, provenance, assets                                                       | `src/lib/allergen-icons.test.ts`              |
| Retailer logos: manifest parity, local-only, containment, fallback, a11y name                                  | `src/lib/retailer-logos.test.ts`              |
| Clear selection allocation, count lines, States gate, one store, copy, permission timing, example card, tokens | `src/components/onboarding-design.test.ts`    |
| Reset clears the record in order                                                                               | `src/lib/installation-reset.test.ts`          |
| Route inventory and the release bundle boundary                                                                | `src/lib/release-exposure.test.ts`            |
| The two `retailers` copy exceptions                                                                            | `src/lib/consumer-copy.test.ts`               |

The Design Preview hub renders every screen and every paywall state from the
production components and offers gate scenarios that restart the real flow
from a chosen state ([recall-design-preview.md](recall-design-preview.md)).
