# Release readiness — build identity, EAS configuration, and what is still blocked (P3C1)

Status: **the repository side of an iOS release is configured and verified
(2026-09-16). Nothing has been built, signed, submitted, or registered with
Apple.** No Apple Developer account exists yet, so every step from "produce an
installable binary" onward is blocked on an input this repository cannot
supply. This document records what is decided, what each command does, and
what is genuinely still missing — separately, so neither is mistaken for the
other.

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

`eas.json` defines exactly three profiles. **None of them uses `extends`**: a
shared base is the usual way a development setting reaches production through
a chain nobody re-reads, so every profile states all of its own values.

| Profile       | `environment` | `developmentClient` | `distribution` | `autoIncrement` | Produces                                          |
| ------------- | ------------- | ------------------- | -------------- | --------------- | ------------------------------------------------- |
| `development` | `development` | `true`              | `internal`     | `false`         | A debug build hosting the dev client and Metro.   |
| `preview`     | `preview`     | `false`             | `internal`     | `true`          | A release-configuration build installable ad hoc. |
| `production`  | `production`  | `false`             | `store`        | `true`          | The App Store / TestFlight archive.               |

What keeps production honest, each pinned by a test:

- `developmentClient: false` is **written out** on `preview` and `production`
  rather than left to the default, so a reviewer sees the answer.
- `distribution: "store"` on production, `internal` on the other two.
- `environment` names each profile's own EAS variable set, so a production
  build cannot silently pick up development values.
- No profile carries an `env` block. Configuration values are not committed to
  `eas.json`, which is in git and cannot be rotated without a commit.

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

Repeat for `preview` and `development`. **Not yet done, and confirmed not
done:** `npx eas-cli config --platform ios --profile production` reports "No
environment variables with visibility 'Plain text' and 'Sensitive' found for
the 'production' environment on EAS" for all three environments. A build run
today would therefore produce an app whose Feed shows the "Recalls are
unavailable" state. See §6.

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

All of this was run on 2026-09-16 at the working tree described in §8.

- `npm run check` — typecheck, lint, and **2,388 tests, all passing**. Lint
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
- `npx eas-cli config --platform ios --profile <profile>` — all three
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

One consequence worth a decision: a **simulator** build needs no Apple
account, and would be the only way to run a custom development client before
enrollment. All three profiles set `ios.simulator: false`, so producing one
today would mean changing a profile. That is recorded here as an option rather
than done, because the three profiles are the ones this milestone was asked
for.

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
