# Product analytics (PostHog)

Authoritative for what the app sends for product analytics, how it is kept
apart from development and from the team's own devices, and the dashboard
that reads it. Added 2026-11-25 to answer two questions: are real people
opening the app, and where do they leave the onboarding → paywall → purchase
→ Feed funnel?

## Design

- **No SDK.** `src/lib/analytics/analytics-client.ts` posts events to
  PostHog's HTTP batch API (`POST {host}/batch/`). Nothing can autocapture
  taps or screens, record sessions, show surveys or load remote config: that
  code is not in the app. `package-lock.json` stays free of PostHog packages
  (pinned by `profile-trust-center.test.ts` and `analytics-client.test.ts`).
- **Explicit events only.** Every event and property is declared in
  `src/lib/analytics/analytics-events.ts`. The client drops anything else; a
  test fails if a catalog key looks like personal or preference data.
- **Anonymous.** A random analytics id is created on the installation and
  stored in the app's documents folder (`lotly-analytics.json`), so it is
  removed with the app. It is never the installation id (a server
  credential), the RevenueCat purchase id, or a push token. Events set
  `$process_person_profile: false` (no person profiles) and
  `$geoip_disable: true`.
- **Never in the way.** Every call returns at once and never throws. Storage
  and network work runs on a serialized promise chain whose failures are
  swallowed. A send times out after 10 s. Nothing awaits analytics.
- **Off when it should be.** With no project key, analytics is off. It is
  also off on the web build, and for a person 13–17 by this launch's age
  answer or the stored one. Nothing is queued or sent before this launch's
  age decision exists: `AgeGate` records the decision
  (`src/lib/launch-age-decision.ts`) before anything beneath it mounts, and
  `analyticsSuppressedForAge` treats "no decision yet" as off. Analytics
  starts in `LaunchedApp` (`src/app/_layout.tsx`), past the gate.
- **Exactly once.** Each event gets a UUID when it is captured and keeps it
  through retries. PostHog keeps one event per UUID, so a batch resent after
  a lost response is not double counted. Delivered events leave the queue. A
  `400` or `413` drops the batch, since resending it would fail the same way.
  The offline queue holds at most 200 events, dropping the oldest.
- **Reset.** "Reset app and delete my data" deletes the analytics id and the
  unsent queue (`clearLocalAnalytics`). Later events use a new id and cannot
  be joined to earlier ones. Events already sent stay in PostHog under the
  earlier id until the one-year retention period ends; they are not deleted
  early.

## Events

| Event                                  | When                                                        | Properties                               |
| -------------------------------------- | ----------------------------------------------------------- | ---------------------------------------- |
| `app_first_seen`                       | First launch with analytics on this installation            | `install_kind`: `new` / `returning`      |
| `app_updated`                          | First launch of a different version or build                | `previous_version`, `previous_build`     |
| `app_opened`                           | Every launch, and a return after ≥ 30 min in the background | `trigger`: `launch` / `foreground`       |
| `onboarding_step_viewed`               | A setup screen shown, once per step per launch              | `step`, `step_index` (1–9)               |
| `onboarding_completed`                 | The watch is first built (end of setup, before Ready)       | —                                        |
| `paywall_viewed`                       | A paywall mounted                                           | `placement`: `onboarding` / `standalone` |
| `purchase_started`                     | Buy tapped                                                  | `placement`                              |
| `purchase_completed` / `_cancelled`    | The purchase's observed outcome                             | `placement`                              |
| `purchase_failed`                      | Store error or store unavailable                            | `placement`, `reason`                    |
| `restore_started`                      | Restore tapped                                              | `placement`                              |
| `restore_completed` / `_nothing_found` | The restore's observed outcome                              | `placement`                              |
| `restore_failed`                       | Store error or store unavailable                            | `placement`, `reason`                    |
| `feed_viewed`                          | The Feed mounted, once per launch                           | `first_time`                             |
| `internal_device_marked`               | Team device marked or unmarked                              | `internal`                               |

Every event also carries `app_version`, `app_build`, `environment`,
`store_environment`, `distribution`, `internal`, `os` and `os_version`.

- **New vs. returning.** `install_kind` is decided once, the first time
  analytics runs. Onboarding progress kept in the keychain means a person
  who used Lotly before. That covers everyone updating from a build without
  analytics, and a reinstall.
- **Restore vs. purchase.** A restore is always `restore_*`, never
  `purchase_completed`.
- **RevenueCat stays authoritative.** These events record what the paywall
  observed. Subscription and lifetime status come from RevenueCat, and
  revenue numbers come from RevenueCat's dashboard.
- **Visits.** The App Store purchase sheet backgrounds the app, which is why
  a return under 30 minutes is not a new `app_opened`.

## Conversion window

**7 days.** A new installation has converted when `purchase_completed`
follows its `app_first_seen` within 7 days (`CONVERSION_WINDOW_DAYS`). The
dashboard funnels use the same window.

## Separating environments and the team's devices

Lotly uses **one PostHog project** (Lotly Production, id 770372, US Cloud)
for every build. Builds are told apart by explicit properties on every event,
and customer dashboards filter on them.

- **`distribution`** — where this copy came from: `app_store`, `testflight`,
  `xcode`, `preview`, `development`, or `unknown`. It is derived from:
  - **`environment`**: `development` for a Metro bundle; for a store build,
    `production` only when `EXPO_PUBLIC_ANALYTICS_ENV=production` is set (EAS
    production environment), otherwise `preview`;
  - **`store_environment`**: StoreKit's app-transaction environment
    (`Production` = App Store, `Sandbox` = TestFlight, `Xcode`).
    A production build installed from TestFlight is `testflight`, never
    `app_store`. `unknown` (StoreKit did not answer within 5 s) is excluded
    from customer numbers.
- **The team's own devices.** Long-press (1.2 s) the version line under
  Profile → App, then tap Mark. Every later event carries `internal: true`,
  and the alert shows the analytics id. The mark lives with the app's data,
  so it survives app updates, including moving from TestFlight to the App
  Store version. **Mark the device on TestFlight before installing from the
  App Store**, and no event from it ever counts as a customer. A device
  marked later has earlier `app_store` events; add its analytics id to
  `POSTHOG_EXCLUDED_IDS` and rerun the dashboard script, or add a
  `distinct_id` filter in PostHog.
- **Customer filter.** Every dashboard insight carries
  `distribution = app_store` and `internal ≠ true` (plus any excluded ids)
  itself; it does not rely on the project's test-account filter.

### EAS environment (set 2026-11-26)

| Variable                    | production                 | preview / development      |
| --------------------------- | -------------------------- | -------------------------- |
| `EXPO_PUBLIC_POSTHOG_KEY`   | the project token (public) | the same token             |
| `EXPO_PUBLIC_POSTHOG_HOST`  | `https://us.i.posthog.com` | `https://us.i.posthog.com` |
| `EXPO_PUBLIC_ANALYTICS_ENV` | `production`               | unset (reports `preview`)  |

A local Metro run needs `EXPO_PUBLIC_POSTHOG_KEY` in `.env` to send anything;
without it analytics is off.

### PostHog project settings

- **Discard client IP data: ON** (Settings → Privacy; switched on by the
  founder 2026-11-26). Found OFF earlier that day: the first test events had
  stored the sender's IP. Events sent after the switch store no `$ip`.
- **GeoIP transformation: Active** (Data management → Transformations; a
  PostHog default). It runs before the IP is discarded, but skips any event
  with `$geoip_disable: true`, which every Lotly event carries (pinned by
  `analytics-client.test.ts`). Verified 2026-11-26: no `$geoip_*` or other
  location property on any Lotly event, before or after the IP switch.
- **Session replay: off** ("Recording is disabled"). The app has no SDK, so
  it could not record anyway.
- **Autocapture:** the project's web-autocapture switch only affects
  PostHog's own SDKs. The app has none and sends only the catalog above.
- **Events retention: 1 year** (organization default on the Free plan,
  read 2026-11-26). The privacy texts state one year; change them together
  if the plan or setting changes.

## Dashboard

`npm run analytics:dashboard` prints the insight definitions. With
`--apply` it creates the dashboard "Lotly — customers" with its insights
(running it again creates a second copy). It needs
`POSTHOG_PERSONAL_API_KEY` (scopes `dashboard:write`, `insight:write`) and
`POSTHOG_PROJECT_ID`, and never prints the key. The dashboard holds:

- first opens by `install_kind`;
- daily and weekly active installations;
- the onboarding funnel, step by step;
- paywall reach and conversion within the 7-day window;
- purchase and restore outcomes;
- return visits (retention from `app_first_seen` to `app_opened`).

Created 2026-11-26: **Lotly — customers**, dashboard 2418280
(<https://us.posthog.com/project/770372/dashboard/2418280>), 7 insights.

## Verification (2026-11-26)

- **Delivery.** The real client code (`AnalyticsClient`, Node, real
  `fetch`) sent a full development-labelled funnel to project 770372: 17
  events, all accepted (HTTP 200). PostHog SQL showed each event exactly
  once (`count = count(distinct uuid)`), including the first batch sent a
  second time with the same UUIDs.
- **Failure.** On the simulator (2026-11-25), with the endpoint down, the
  app ran normally and the held event arrived once after recovery.
- **Dashboard exclusion.** Labelled test installs were sent: TestFlight
  (`testflight`), development, and an App Store install marked internal.
  Every dashboard insight showed no data. Controls with the same insight:
  `distribution = development` with `internal ≠ true` showed the three
  development installs, and `distribution = app_store` WITHOUT the internal
  filter showed only the internal App Store install — so the internal filter
  is what removes it.
- **Exclusion.** Only events after the mark carried `internal = true`;
  development events had `distribution = development`, so the customer
  filter matched none of them.

## Privacy disclosures

- **In-app:** Privacy & Data Controls → "Usage analytics"
  (`src/content/privacy-data-controls.ts`).
- **Privacy Policy:** [recall-privacy-policy-draft.md](recall-privacy-policy-draft.md).
- **App Store privacy answers:** the [readiness doc](recall-app-store-readiness.md) §1.2.

Both are done (2026-11-26): the website Privacy Policy is effective November
26, 2026 (lotly-website `c4f34f9`, rendered from
`~/Desktop/Lotly-Analytics-Setup/LEGAL-1.2.0/PRIVACY.md`), and the App Store
Connect answers are published.
