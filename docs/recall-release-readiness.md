# Release readiness — build identity, EAS configuration, and what is still blocked (P3C1)

Status: **the repository side of an iOS release is configured and verified
(2026-09-16; re-verified 2026-09-22 — see §9). Nothing has been built, signed,
submitted, or registered with Apple.** No Apple Developer account exists yet,
so every step from "produce an installable binary" onward is blocked on an
input this repository cannot supply. This document records what is decided,
what each command does, and what is genuinely still missing — separately, so
neither is mistaken for the other.

Companion documents: [recall-app-store-readiness.md](recall-app-store-readiness.md)
(App Privacy answers and the Apple questionnaire) and
[recall-launch-blockers.md](recall-launch-blockers.md) (founder inputs and
counsel review). This file covers only the **build and release mechanics**.

## 1. Identity

Two identities, deliberately different, both pinned by
`src/lib/release-configuration.test.ts`.

### Internal — the EAS linkage, unchanged

| Field                 | Value                                  | Why it must not change                                                                                       |
| --------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| EAS owner             | `willisyangg6`                         | The account the project belongs to.                                                                          |
| EAS project           | `@willisyangg6/recall-app`             | The existing project. A new slug would create a SECOND EAS project.                                          |
| `expo.slug`           | `recall-app`                           | Together with the owner, this is the project's address on EAS.                                               |
| `extra.eas.projectId` | `c81f13ab-2408-43b7-9cfd-2df84055725c` | The binding itself. Changing it orphans the remote build-number sequence and every existing build's history. |

The rename to Lotly deliberately does **not** touch any of these. The git
repository, the npm package name, and the GitHub repository referenced by the
scheduler watchdog also stay `recall-app`.

### Public — what a person sees

| Field                     | Value                  | Where it appears                                                   |
| ------------------------- | ---------------------- | ------------------------------------------------------------------ |
| `expo.name`               | `Lotly`                | Under the home-screen icon, in the notification-permission dialog. |
| `expo.scheme`             | `lotly`                | Deep links: `lotly://recall/<id>`, `lotly://settings`.             |
| `ios.bundleIdentifier`    | `com.willisyang.lotly` | Registered with Apple. **Permanent once shipped.**                 |
| `ios.supportsTablet`      | `false`                | iPhone-only. iPad is not a supported device family.                |
| `expo.userInterfaceStyle` | `light`                | Light appearance only (founder decision, 2026-09-14).              |
| `expo.orientation`        | `portrait`             | Portrait only.                                                     |

The previous scheme (`recallapp`) and bundle identifier
(`com.willisyang.recall`) appear nowhere in the repository any more. Neither
was ever registered with Apple, so nothing is orphaned by the change. Ordinary
uses of the word "recall" — the domain model, the database, the docs, the
product's own subject matter — are untouched and correct.

## 2. Build profiles

`eas.json` defines exactly four profiles. **None of them uses `extends`**: a
shared base is the usual way a development setting reaches production through
a chain nobody re-reads, so every profile states all of its own values.

| Profile       | `environment` | `developmentClient` | `distribution` | `autoIncrement` | Produces                                          |
| ------------- | ------------- | ------------------- | -------------- | --------------- | ------------------------------------------------- |
| `development` | `development` | `true`              | `internal`     | `false`         | A debug build hosting the dev client and Metro.   |
| `preview`     | `preview`     | `false`             | `internal`     | `true`          | A release-configuration build installable ad hoc. |
| `simulator`   | `development` | `false`             | `internal`     | `false`         | A `.app` for an iOS Simulator. No Apple account.  |
| `production`  | `production`  | `false`             | `store`        | `true`          | The App Store / TestFlight archive.               |

What keeps production honest, each pinned by a test:

- `developmentClient: false` is **written out** on `preview` and `production`
  rather than left to the default, so a reviewer sees the answer.
- `distribution: "store"` on production, `internal` on the other two.
- `environment` names each profile's own EAS variable set, so a production
  build cannot silently pick up development values.
- No profile carries an `env` block. Configuration values are not committed to
  `eas.json`, which is in git and cannot be rotated without a commit.
- `simulator` (added P3C1.5) is the one profile that sets `ios.simulator:
true`, and it is boxed in for that reason: `internal`, no development
  client, no `autoIncrement`, no `extends`, and the `development` environment
  rather than production's. It exists because it is the only iOS build this
  project can currently produce at all (§6), which also makes it the profile
  most likely to be run casually — and a simulator binary can never be signed
  or shipped.

### Environment variables on EAS

The app needs exactly two public variables, and **only** these two
(`src/lib/release-exposure.test.ts` fails if a third appears):

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

`.env` is gitignored and is **not** uploaded by EAS Build, so these must exist
in each EAS environment before a build can work. They are public by design
(the publishable key is limited to read-only access by Row Level Security), so
`plaintext` is the correct visibility:

```bash
npx eas-cli env:set --name EXPO_PUBLIC_SUPABASE_URL \
  --value "<project url>" --environment production --visibility plaintext
npx eas-cli env:set --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
  --value "<publishable key>" --environment production --visibility plaintext
```

**`production` is configured** (P2B7W.1, 2026-09-22). Both variable names
exist in that environment, and `npx eas-cli config --platform ios --profile
production` now reports them loaded by name: "Environment variables with
visibility 'Plain text' and 'Sensitive' loaded from the 'production'
environment on EAS: EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
EXPO_PUBLIC_SUPABASE_URL." Their **values are deliberately not recorded in
this repository** — `.env` is gitignored, and EAS is the only place the build
reads them from.

`preview` and `development` are **deliberately left unconfigured**: both still
report "No variables found for this environment." Only the `production`
profile is on the TestFlight path, so neither is needed yet. A build on either
profile would produce an app whose Feed shows the "Recalls are unavailable"
state; the commands above close that gap whenever one of them is next used.
See §6.

The server-only values (`SUPABASE_SECRET_KEY`, `WATCHDOG_SHARED_SECRET`, and
the Edge Function's GitHub token) must never be created in any EAS
environment: nothing in a build needs them, and an `EXPO_PUBLIC_` prefix on
any of them would inline it into the shipped bundle.

## 3. Versions and build numbers

`expo.version` in `app.json` is the **marketing version**
(`CFBundleShortVersionString`), currently `1.0.0`. It is edited by hand, in a
commit, when a release's user-visible version changes.

The **build number** (`CFBundleVersion`) is not in `app.json` at all.
`cli.appVersionSource` is `remote`, so EAS holds the current build number for
this project on its servers, and `autoIncrement: true` increments it there as
part of each `preview` and `production` build. (Under a remote version source
`autoIncrement` is a boolean; the EAS CLI rejects the `"buildNumber"` string
form, which is verified below.) Consequences worth knowing before the first
build:

- **The next build number is whatever EAS says it is**, not something this
  repository can compute. Read the current value, or set a starting point once
  if the first App Store build should not begin at 1:

  ```bash
  npx eas-cli build:version:get --platform ios
  npx eas-cli build:version:set --platform ios
  ```

- **Preview and production share one counter** for iOS. That is intentional:
  Apple only requires each uploaded build to have a higher `CFBundleVersion`
  than the last, and a single increasing sequence across both makes every
  installable Lotly build uniquely identifiable.
- **Development builds do not consume a number** (`autoIncrement: false`).
  They go to the founder's own device and never to a tester or a store.
- Nothing increments anything locally, so a build number can never be created
  by an uncommitted working tree.

## 4. Commands

Every command below is run from the repository root. None of them has been
run — see §6.

```bash
# Offline checks. Safe at any time.
npm run check                       # typecheck + lint + tests
npx expo-doctor                     # SDK/config diagnostics
npx expo install --check            # dependency alignment against SDK 57

# Development build (dev client) — then start Metro against it.
npx eas-cli build --profile development --platform ios
npx expo start --dev-client

# Preview: a release-configuration build for internal installation.
npx eas-cli build --profile preview --platform ios

# Production: the App Store archive, then the upload.
npx eas-cli build --profile production --platform ios
npx eas-cli submit --profile production --platform ios
```

`expo start` and `expo export` need no Apple account. Every `eas build`
invocation above does — see §6.

## 5. What is verified today

All of this was run at the working tree described in §8 (offline checks
2026-09-16; the native evidence in §5.1 on 2026-09-17).

- `npm run check` — typecheck, lint, and **2,402 tests, all passing**. Lint
  reports 0 errors and 3 warnings, all pre-existing in `src/server` test files
  this milestone did not touch.
- `npx expo-doctor` — 21/21 checks pass.
- `npx expo install --check` — "Dependencies are up to date."
- `npx expo export --platform ios` — the release bundle builds (3.4 MB), and a
  scan of it confirms:
  - no server secret's **value** appears in it;
  - the strings `SUPABASE_SECRET_KEY`, `WATCHDOG_SHARED_SECRET`,
    `EXPO_ACCESS_TOKEN`, `service_role` and `sb_secret_` appear nowhere in it;
  - both `EXPO_PUBLIC_` values are inlined, as intended.
- `npx eas-cli config --platform ios --profile <profile>` — all four
  profiles resolve against the CLI's own schema and print the expected
  identity (`Lotly`, `lotly`, `com.willisyang.lotly`, `supportsTablet: false`,
  slug and project id unchanged). This validation is what caught the one
  configuration error made during this milestone: `autoIncrement` was first
  written as `"buildNumber"`, which the CLI rejects under
  `appVersionSource: remote`, and is now `true`.
- Structural tests (`src/lib/release-configuration.test.ts`,
  `src/lib/release-exposure.test.ts`) pin the identity, the profiles, the
  build-number scheme, the error boundary's silence about errors, the
  environment-variable boundary, the client/server import boundary, and the
  route inventory.

### 5.1 Native evidence, from the simulator build (P3C1.5)

The `simulator` profile produced a real `Lotly.app`, installed on an iPhone 17
Pro simulator (iOS 26.3) with `xcrun simctl`. It is a **release-configuration**
build, which is what makes the gating evidence below meaningful.

The artifact all of the following was verified against:

- Build `e5bab902-4f23-4f4d-8a35-89b67456b679`
- `https://expo.dev/artifacts/eas/q_nY6InnEuYJ3ZHK1LfEhAXNuaaeE5t7Bk-6qHNMTK8.tar.gz`

Two earlier simulator builds were made and superseded: `11fc5aa8` (the first
native build, which found the `StateMessage` wrapping defect) and `fbd4ba0f`
(which found the vertical-overflow defect the wrapping fix exposed).

From the shipped bundle's own `Info.plist`:

| Checked               | Value                           |
| --------------------- | ------------------------------- |
| `CFBundleDisplayName` | `Lotly`                         |
| `CFBundleIdentifier`  | `com.willisyang.lotly`          |
| `UIDeviceFamily`      | `[1]` — iPhone only             |
| `CFBundleURLSchemes`  | `lotly`, `com.willisyang.lotly` |

Observed on the running app:

- **The installed name is Lotly** — it is the name under the icon on the home
  screen, and iOS's own cross-app prompt reads _Open in "Lotly"?_.
- **`lotly://` opens the app**, from a cold start (the app terminated first).
- **Deep links resolve and reach a FINAL state**, each from a cold launch:
  `lotly://saved` lands on the Saved tab, `lotly://profile` on Profile,
  `lotly://recall/<id>` on a pushed Recall Details. None sat on a loading
  state.
- **Development routes are guarded.** A cold `lotly://design-preview` reaches
  an inert page reading "Design Preview is a development-only tool and is not
  available in this build." No harness, no simulated data, no controls.
- **The release wording is what ships.** Every screen showed the shopper
  sentence ("Recalls are unavailable / Lotly couldn't reach the recall
  service…"), never the developer wording that names environment variables —
  first-hand confirmation that `__DEV__` is false in this build and that the
  P3C1 copy split works.
- **Nothing clips at accessibility sizes.** At
  `accessibility-extra-extra-extra-large`, with a cold `lotly://saved`: the
  navigator title "Saved" renders in full in a grown bar; the state message's
  title and body wrap within the screen's horizontal bounds with no text cut
  off at either edge; the first line of the title is present; and scrolling
  reaches the last word of the explanation. Nothing overlaps. Restoring the
  simulator to the default text size renders the same screen exactly as
  before — one-line title, two-line body, vertically centred. Getting here
  took two corrections; both are described in §8.

**What this build cannot show.** It carries no `EXPO_PUBLIC_` configuration,
because none is set on EAS (§2) and populating it was out of scope. Every
feed-dependent path therefore short-circuits to the not-configured state, so
this build cannot exercise: a populated feed, a real recall on Detail, or the
Saved screen's _loading_ gate — `SavedScreen` returns the not-configured state
before reaching it. The cold-launch Saved symptom P3C1.5 set out to reproduce
is consequently **still unreproduced**; see §8.

**Not verified, because it requires a signed build:** that the app launches
under a release configuration on a physical device, that the error boundary
renders correctly there, that the splash and icon composite properly, and that
deep links on the `lotly` scheme resolve on a device. Screenshots and the
simulator cannot establish any of these.

## 6. Blocked on Apple enrollment

The Apple Developer Program membership is not active. Until it is, **no iOS
binary of any kind can be produced through EAS**, because every profile builds
for a device and device builds require signing credentials:

- [ ] Apple Developer Program membership (and the §1 entity decision in
      `recall-launch-blockers.md` — guideline 5.1.1(ix) prefers a legal entity
      for apps in regulated fields, which interacts with whose account this is).
- [ ] Register `com.willisyang.lotly` as an App ID.
- [ ] Create the App Store Connect app record.
- [ ] Signing credentials (distribution certificate, provisioning profiles).
      EAS can manage these once an account exists; none exist now.
- [ ] Register the founder's device UDID, for `development` and `preview`
      installs.
- [ ] APNs key, **only** when push is activated — it stays off
      (`recall-push-delivery.md`).
- [ ] Set the two `EXPO_PUBLIC_` variables in each EAS environment (§2). Not
      itself Apple-blocked, but pointless before a build can run.

**The simulator route, taken in P3C1.5.** A simulator build needs no Apple
account, so the `simulator` profile above is the one way to get a native
Lotly binary before enrollment. It is what §5's native evidence comes from.

**The local toolchain cannot substitute for it.** `npx expo prebuild` succeeds
and generates a correct project (`ios/Lotly.xcodeproj`, display name `Lotly`,
`PRODUCT_BUNDLE_IDENTIFIER = com.willisyang.lotly`), but `xcodebuild` fails in
the `ExpoModulesJSI` xcframework phase, reproduced 2026-09-17 against
`expo-modules-jsi@57.1.0`:

```
node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI-Cxx/include/RuntimeScheduler.h:53:26:
error: 'RuntimeScheduler' cannot be annotated with either SWIFT_RETURNS_RETAINED
or SWIFT_RETURNS_UNRETAINED because it is not returning a SWIFT_SHARED_REFERENCE type
```

`class RuntimeScheduler` annotates its constructors `SWIFT_RETURNS_RETAINED`
without being declared a `SWIFT_SHARED_REFERENCE` type. Swift 6.3 accepts it;
the Swift 6.2.4 in Xcode 26.3 — the only Xcode on this machine — rejects it.
The podspec always builds that xcframework from source (`build-xcframework.sh`,
no prebuilt download path), so there is no project-level flag that avoids
compiling the header, and the only local fixes would edit `node_modules`. EAS
Build's image carries a newer Swift and compiles it.

## 7. Still pending, not blocked by Apple

- **App icon and splash artwork.** `assets/expo.icon` and
  `assets/images/splash-icon.png` are the Expo template placeholders. They are
  deliberately unchanged: no AI-generated or temporary branding was
  substituted. Final artwork is a design deliverable.
- **Support URL and Privacy Policy URL.** Both are App Store Connect
  requirements with no real destination yet
  (`recall-launch-blockers.md` §1). Nothing was invented.
- **App Privacy answers**, including the unresolved health/coarse-location
  rows, and the app-level privacy manifest that must match them
  (`recall-app-store-readiness.md` §1–2).
- **Export-compliance declaration.** The audit concluded the app uses only
  exempt (OS/HTTPS) encryption, so `ios.config.usesNonExemptEncryption: false`
  is the expected answer. It is **not** set: it is a compliance assertion, and
  it belongs to submission prep with the rest of the questionnaire.
- **Onboarding** and the **subscription paywall** — separate milestones, not
  started. No purchase surface exists, so none of guideline 3.1.x applies yet.
- **Push activation** — built, deliberately inactive, and activated only by
  `npm run push:activate` when the founder decides.
- **Shopper reports** — the server gate stays off.
- **A signed archive and a TestFlight build** — neither exists.

## 8. Working tree at the time of writing

Branch `master`, in sync with `origin/master`, based on `608d257`. Nothing was
committed, pushed, deployed, or written to any live service by this milestone.

### P3C1.5 — the two clipping defects, and the one that got away

**Fixed: the navigator title clipped at accessibility sizes.** The shared
`screenHeader` left the bar at the platform's flat 44pt while its title
honours Dynamic Type, so at the accessibility sizes the title's line box was
taller than the bar. The bar now grows instead: `minHeight` of the scaled
`heading-3` line box plus its padding, floored at `layout.navHeaderHeight`
and offset by the status-bar inset. `minHeight` rather than `height` leaves
the platform's own notch/landscape maths alone. Verified on the simulator at
`accessibility-extra-extra-extra-large`. Pushed screens are untouched: they
use the NATIVE stack header, which iOS sizes itself and which does not accept
a height from here.

**Fixed, in two steps: whole-screen state messages clipped.** Found by the
simulator runs, not by reading the code — which is the argument for having
made the native build at all.

1. _They did not wrap._ `StateMessage`'s container sets
   `alignItems: 'center'`, so each `Text` was laid out at its own intrinsic
   width — and an unwrapped sentence is as wide as the sentence. At ordinary
   sizes it still fit the screen, which is why this was invisible; at the
   accessibility sizes the title and body were clipped off both edges. They
   now stretch to the container's content width (`alignSelf: 'stretch'`) and
   wrap.
2. _Wrapping made them taller than the phone._ The next build showed the
   consequence: a wrapped message at those sizes exceeds the screen, and
   `justifyContent: 'center'` clips an overflow at BOTH ends — the first line
   of the title as well as the last of the body. `StateMessage` now grows and
   then scrolls: a `ScrollView` whose `contentContainerStyle` uses
   `flexGrow: 1`, so it is centred while it fits and reachable when it is not.
   Scrolling is opt-OUT (`scrollable`, default true) so that the two settings
   panels — which already render inside their screen's own `ScrollView` —
   do not nest a second one.

This was NOT part of the milestone's brief; it is the same defect class, on
the same screens, at the same setting, and DESIGN.md already required 200%
text without clipping.

**Not reproduced: the cold-launch Saved deep link.** The reported symptom is a
cold launch into `/saved` sitting on its loading state. It could not be
reproduced, because no build available in this milestone can reach that state:
the local toolchain cannot compile the project (§6), and the EAS simulator
build has no `EXPO_PUBLIC_` configuration, so `SavedScreen` returns the
not-configured state before the loading gate — the cold deep link was
confirmed to reach that expected final unconfigured state, which is routing
evidence, not evidence about the loading gate. What WAS found and fixed is a
genuine render-safety defect on that exact path: `useSavedRecalls` computed
`loaded` as `snapshot !== null`, a read of module-level mutable state during
render, beside `useSyncExternalStore` rather than through it. React only
tracks what `getSnapshot` returns, and the React Compiler (enabled in
`app.json`) does not treat that read as a dependency of the memoization it
inserts. The warm path masks it — a Feed card drives the store to loaded long
before Saved mounts — while the cold path needs `loaded` to flip after mount.
`loaded` is now part of the published snapshot
(`src/lib/saved-recalls-cache.ts`), with the cold and warm sequences driven
directly in `saved-recalls-cache.test.ts`. **It is not claimed that this was
the whole of the reported symptom.** Re-check once a configured build exists.

### The one pre-existing failure, diagnosed and fixed

`src/server/fda-enforcement/reconcile.test.ts` failed on the clean tree
**before** any of this work, and is now fixed. It was a test defect, not a
production defect, and no backfill, delivery, push, or eligibility semantics
were changed.

`enrichCaseWithMatches` decides backfill suppression by comparing FDA's own
`center_classification_date` against a clock and a 30-day horizon. It accepts
an injectable clock (`EnrichOptions.now`, the same seam `IngestOptions` has),
but `ReconcileOptions` had none and `reconcile.ts` forwarded none, so the
enrichment fell back to `new Date()`. The fixture's classification date is
2026-08-18, which put the cliff at 2026-09-17: the test asserted
`currentlyDeliverable === true` and passed for 30 days, then failed for ever
after. It was measuring how long ago the fixture was written.

The correction adds `now?: () => Date` to `ReconcileOptions` and forwards it.
Production passes nothing and still gets the real clock, so behaviour is
unchanged. The test now runs against a frozen `2026-08-25T12:00:00Z` — the
instant `enrich.test.ts` already uses — and asserts the suppression state
directly alongside deliverability, so a future failure says which half moved.

Verified by a throwaway probe running the same assertions three ways: the real
clock fails, the frozen clock passes, and a frozen `2027-01-01` fails again
because the change genuinely is backfill by then. That last case is the
evidence that suppression semantics were left intact rather than loosened.

## 9. P2B7W re-verification (2026-09-22)

Re-run at `ea3da46` on clean, pushed `master`. Read-only throughout: no build,
no submission, no Apple authentication, no credential command, no EAS write.
What changed since §5 is listed first, because §5 is otherwise still accurate.

**Changed since §5.**

- `npx expo-doctor` is now **20/21**, not 21/21. The one failure is four
  patch-version drifts inside SDK 57 that upstream released after §5 was
  written: `expo` 57.0.23 → 57.0.24, `expo-constants` 57.0.18 → 57.0.19,
  `expo-notifications` 57.0.19 → 57.0.20, `expo-router` 57.0.21 → 57.0.22.
  All four are inside the `~` ranges `package.json` already declares, so
  `npx expo install --check` resolves them without a range edit. Take them
  before the first TestFlight build rather than after: `expo-notifications`
  is on the path this release is meant to exercise.
  **Closed by §10** — all four are aligned and Doctor is back to 21/21.
- `npm run check` is green: 2,996 tests, 0 failures, 14 skipped; lint 0
  errors and the same 3 pre-existing `no-unused-vars` warnings in
  `src/server` test files.

**Re-confirmed unchanged.**

- Identity (§1) and the four build profiles (§2) are byte-for-byte as
  recorded. `/ios` and `/android` are generated and gitignored; neither is
  committed.
- **No EAS environment variable exists in any environment.**
  `npx eas-cli env:list` returns "No variables found" for `development`,
  `preview` and `production`, and `build:version:get` prints the same
  "No environment variables …" notice. This remains the one blocker that is
  not Apple-gated, and §2 has the two commands that close it.
  **Closed for `production` as of 2026-09-22** — the founder set both names
  there, so the one non-Apple blocker is gone. `preview` and `development`
  stay empty on purpose. §2 and §10 carry the current state.
- Remote iOS `buildNumber` is **1**, and the only three builds this project
  has ever produced are the three P3C1.5 `simulator` builds from commit
  `86675cb`. Nothing has been built for a device or a store.
- The bundle boundary still holds. `npx expo export --platform ios` produces
  a 3.6 MB Hermes bundle; a byte-level scan of all 93 exported files finds
  neither server secret's value and none of the strings
  `SUPABASE_SECRET_KEY`, `WATCHDOG_SHARED_SECRET`, `EXPO_ACCESS_TOKEN`,
  `service_role` or `sb_secret_`, while both `EXPO_PUBLIC_` values are
  inlined as intended. This is the re-run that
  [recall-launch-blockers.md](recall-launch-blockers.md) §5 asked for at
  submission prep.
- `assets/expo.icon` is still the Expo template — its layers are literally
  `expo-symbol 2.svg` and `grid.png`. Shipping it to review would put
  another party's mark on the icon; §7 already lists final artwork as a
  design deliverable, and it is an App Store blocker rather than a
  TestFlight one.

**One nuance worth stating precisely.** Design Preview's _executable_ harness
does not run in a release build — §5.1 saw the inert page natively, and the
screen returns `null` behind a bare `__DEV__`. Its _string literals_ are
nevertheless present in the exported Hermes string table (for example
"Eligible recall naming at least one retailer"). Nothing shopper-facing
renders them and no secret is among them, so this is a bundle-size and
tidiness observation, not a leak — but "Metro eliminates it outright" is true
of the Profile entry row, not of every literal in the route module.

**Over-the-air updates.** There is no `expo-updates` dependency, no
`updates` block, and no runtime-version policy. That is a coherent choice,
but it has one consequence worth writing down before the first TestFlight
build: **there is no client-side rollback.** Every client fix — including a
crash — needs a new binary and a new review. The kill switches that do exist
(`push:activate --deactivate --confirm`, the `shopper_report_config` gate)
are all server-side.

**No unapplied database work remains.** All three items §5-era documents
carried as pending are closed, each re-measured read-only today: the P2B7U
expand migration is applied (`state_codes` exists; the Data API exposes the
plural `p_state_codes` argument), `repair:geography:dry` would update 0 of
1,931 cases, and `repair:illness-flags:dry` finds 0 stale flags of 1,931.
The corresponding README and [recall-personalization.md](recall-personalization.md)
claims were corrected in the same change.

## 10. P2B7W.1 — Expo patch alignment (2026-09-22)

Run at `7316209` on clean, pushed `master`. The single purpose was to close the
one Expo Doctor failure §9 recorded, so the first TestFlight build is made on a
dependency baseline Expo itself calls current. No build, no Apple
authentication, no push activation, no production write, nothing staged or
committed.

**What moved.** Four packages, each a patch bump inside SDK 57:

| Package              | Before  | After   |
| -------------------- | ------- | ------- |
| `expo`               | 57.0.23 | 57.0.24 |
| `expo-constants`     | 57.0.18 | 57.0.19 |
| `expo-notifications` | 57.0.19 | 57.0.20 |
| `expo-router`        | 57.0.21 | 57.0.22 |

Applied with `npx expo install --fix`, Expo's own alignment mechanism, which
resolved the set under the updated `expo` version and installed with npm
against the existing `package-lock.json`. No `--force`, no
`--legacy-peer-deps`, no `npm audit fix`, no package-manager change.

**Scope of the diff.** `package.json` moved three declared ranges — `expo`
`~57.0.23 → ~57.0.24`, `expo-notifications` `~57.0.19 → ~57.0.20`,
`expo-router` `~57.0.21 → ~57.0.22`. `expo-constants` stays declared at
`~57.0.14`, which already admits 57.0.19; the lockfile pins the new patch, so
`npm ci` is deterministic either way.

`package-lock.json` holds the same **913 entries** before and after: zero
added, zero removed, and exactly **eight** version changes. The four above,
plus four transitive dependencies of those four — `@expo/cli` 57.0.25 →
57.0.26 and `expo-asset` 57.0.17 → 57.0.18 (both dependencies of `expo`), and
`@expo/metro-runtime` 57.0.15 → 57.0.16 and `@expo/ui` 57.0.18 → 57.0.19 (both
dependencies of `expo-router`). Every remaining changed line in the lockfile is
a dependency-range string naming one of those same eight packages. React
19.2.3 and React Native 0.86.3 did not move, and neither did any non-Expo
dependency.

**`expo-notifications` regression check.** Its changelog records 57.0.18,
57.0.19 and 57.0.20 as "does not introduce any user-facing changes" — the last
substantive entry is the 57.0.17 iOS `NotificationCenterManager` data-race fix,
which was already installed. The config plugin is present and intact
(`app.plugin.js` → `plugin/build/withNotifications`, a `createRunOncePlugin`
wrapping the Android and iOS mods), and `expo-notifications` still resolves in
the plugin list of `npx expo config --type prebuild`. Every API the app uses
still resolves under `tsc`: `setNotificationHandler` with the four
`shouldShowBanner` / `shouldShowList` / `shouldPlaySound` / `shouldSetBadge`
flags, `useLastNotificationResponse`, `addPushTokenListener`,
`setNotificationChannelAsync`, `AndroidImportance`, `getPermissionsAsync`,
`requestPermissionsAsync` and `getExpoPushTokenAsync`. Permission UX,
tap-routing and the push worker contract were not touched; push remains
inactive.

**Verification.**

- `npx expo install --check` — "Dependencies are up to date."
- `npx expo-doctor` — **21/21 checks passed. No issues detected.**
- `npm run check` — typecheck clean, lint 0 errors and the same 3 pre-existing
  `no-unused-vars` warnings in `src/server` test files, and **2,996 tests,
  0 failures, 14 skipped** — identical to the §9 baseline.
- `npx expo export --platform ios` — succeeds; 93 files, a 3.6 MB Hermes
  bundle, the same shape §9 measured.
- Byte-level scan of all 93 exported files: **no server secret value**, and
  none of `SUPABASE_SECRET_KEY`, `WATCHDOG_SHARED_SECRET`, `EXPO_ACCESS_TOKEN`,
  `service_role`, `sb_secret_`, `ghp_`, `github_pat_`, the server-only table
  and RPC names, or any tracking domain. Both `EXPO_PUBLIC_` values are inlined,
  as intended. The one substring hit, `segment`, is Expo Router's own routing
  vocabulary (`useSegments`, `parseRouteSegments`, `stripGroupSegmentsFromPath`)
  — `segment.com`, `segment.io` and `analytics.js` are all zero.
- `npx prettier --check` on the changed files, and `git diff --check`, both clean.

**EAS configuration, read-only.** `production` holds both required variable
names and the `production` build profile is bound to it (`eas.json` →
`build.production.environment: "production"`), which
`npx eas-cli config --platform ios --profile production` confirms by printing
exactly those two names as loaded and nothing else. No server-only secret is
referenced by the mobile build: none of `SUPABASE_SECRET_KEY`,
`WATCHDOG_SHARED_SECRET` or `EXPO_ACCESS_TOKEN` appears in `eas.json` or
`app.json`, and the client reads only `EXPO_PUBLIC_SUPABASE_URL` and
`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`src/lib/recall-feed.ts`,
`src/lib/report-api.ts`), so a production build would talk to the configured
Supabase backend. No EAS variable was created, updated or deleted.

**Still true after this change.** **No TestFlight build has been created** —
no signed archive exists, remote iOS `buildNumber` is still 1, and §6's Apple
Developer Program enrollment remains the blocker. The placeholder
`assets/expo.icon` (§7) is untouched and is still an App Store blocker.
