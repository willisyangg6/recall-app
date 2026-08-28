# Recall data-flow & SDK audit (C7)

Audited 2026-08-28 at HEAD `5cef70d` (clean tree). Every fact below was
verified from production code, migrations, configuration, and the dependency
lock — not from README copy. File references are the evidence trail.

Scope: everything the shipped app and its backend collect, store, process,
sync, and delete — plus the SDK/privacy-manifest inventory and the exported
bundle secret scans required for App Store preparation. Consumer-facing
explanations derived from this audit live in the in-app trust documents
(`src/content/`); the Apple-questionnaire mapping lives in
`recall-app-store-readiness.md`; unresolved founder/legal items live in
`recall-launch-blockers.md`.

## 1. Summary of what is and is not collected

Collected (transmitted off-device and retained):

- **Installation identifier** — a random UUID generated on-device
  (`src/lib/installation-id.ts`), stored in SecureStore (keychain), sent as
  the key for the preference mirror and push registration. Not a hardware,
  advertising, or user identifier; regenerating it only creates a fresh
  registration.
- **Preferences** — state code, allergen tokens, retailer catalog ids
  (`src/lib/preferences-store.ts` → `set_installation_preferences` RPC).
  Local-first (SecureStore is the source of truth); the server row
  (`installation_preferences`) is explicitly a delivery-eligibility mirror.
- **Push registration** (only after the user taps "Enable recall alerts") —
  Expo push token, platform (`ios`/`android`), app version, and
  enabled/registered/last-seen/disabled timestamps
  (`src/lib/push-registration.ts` → `register_push_subscription` RPC →
  `push_subscriptions`).
- **Notification delivery records** — per (event, subscription) delivery
  status rows (`notification_deliveries`), created by the server-side worker.

Not collected (verified absent):

- No account, name, email, phone, contacts, photos, or any contact info.
- No device location; the state is a manual pick from 52 postal codes.
- No advertising identifier; no analytics, advertising, or crash-reporting
  SDK anywhere in the dependency lock (grep of `package-lock.json` for
  sentry/crashlytics/firebase/amplitude/mixpanel/segment/appsflyer/adjust/
  google-analytics/facebook: zero hits; pinned by
  `src/content/profile-trust-center.test.ts`).
- No search-term transmission: Home search and filters are session-only React
  state over the already-loaded corpus (`src/app/index.tsx`,
  `src/lib/feed-search.ts` — "Nothing here queries a service").
- No per-user record of viewed recalls: `fetchCaseDetail(id)` is a REST GET
  authenticated only by the shared publishable key; the installation id is
  never sent on any read path (`src/lib/recall-feed.ts`).
- No logging/diagnostics pipeline in the app: no error-reporting SDK, no
  custom telemetry; failures degrade to UI states.

Infrastructure caveat (documented in the consumer privacy explanation):
requests to Supabase and to agency image hosts necessarily carry standard
connection metadata (IP address, user agent) which those providers process to
serve the request; Recall's schema stores none of it.

## 2. Data element inventory

| Field                               |                   Collected? | Source                                         | Local storage                                                                       | Server storage                                                                   | Purpose                                             | Linked to installation? | Shared processor                      | Retention                                                               | User deletion/reset path                           |
| ----------------------------------- | ---------------------------: | ---------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------: | ------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------- |
| Installation id                     |                          Yes | Generated on device (`expo-crypto` randomUUID) | SecureStore `recall.installation-id` (keychain; survives reinstall per OS behavior) | `installation_preferences.installation_id`, `push_subscriptions.installation_id` | Key the installation's own rows (bearer capability) |       Is the identifier | Supabase                              | Indefinite (no purge job)                                               | None in-app (gap; see §7)                          |
| State preference                    |                          Yes | User pick in Settings                          | SecureStore `recall.preferences`                                                    | `installation_preferences.state_code`                                            | Affects Me + push eligibility                       |                     Yes | Supabase                              | Indefinite                                                              | Clear in Settings → empty value syncs; row remains |
| Allergen preferences                |                          Yes | User pick (9-token closed set)                 | Same                                                                                | `installation_preferences.allergens`                                             | Affects Me + push eligibility                       |                     Yes | Supabase                              | Indefinite                                                              | Same as state                                      |
| Retailer preferences                |                          Yes | User pick (catalog ids)                        | Same                                                                                | `installation_preferences.retailer_ids`                                          | Affects Me + push eligibility                       |                     Yes | Supabase                              | Indefinite                                                              | Same as state                                      |
| Push token                          |                 Yes (opt-in) | `expo-notifications` `getExpoPushTokenAsync`   | Not persisted by app code                                                           | `push_subscriptions.expo_push_token`                                             | Alert delivery                                      |                     Yes | Supabase, Expo push service, APNs/FCM | Indefinite; row disabled (not deleted) on opt-out/`DeviceNotRegistered` | "Turn off alerts" disables row                     |
| Push-enabled timestamps             |                 Yes (opt-in) | Server `now()`                                 | `recall.alerts-enabled` flag ('1')                                                  | `enabled_at`, `registered_at`, `last_seen_at`, `disabled_at`                     | Delivery-safety horizons (no catch-up blasts)       |                     Yes | Supabase                              | Indefinite                                                              | Same                                               |
| Platform + app version              |                 Yes (opt-in) | `Platform.OS`, `expo-constants`                | —                                                                                   | `push_subscriptions.platform`, `.app_version`                                    | Delivery formatting/diagnostics                     |                     Yes | Supabase                              | Indefinite                                                              | Same                                               |
| Delivery records                    |                Yes (derived) | Server push worker                             | —                                                                                   | `notification_deliveries` (status, attempts, ticket id, failure code)            | Idempotent delivery + receipts                      |     Via subscription id | Supabase, Expo                        | Indefinite (no purge job)                                               | None                                               |
| Recall interactions (views, shares) |                       **No** | —                                              | —                                                                                   | —                                                                                | —                                                   |                       — | —                                     | —                                                                       | —                                                  |
| Search terms / filter state         | **No** (never leaves device) | User input                                     | In-memory React state only                                                          | —                                                                                | Client-side browse                                  |                       — | —                                     | Session only                                                            | Clear search / Clear all / app restart             |
| Preference dirty flag               |                   Local only | Sync failure                                   | SecureStore `recall.preferences-dirty`                                              | —                                                                                | Retry a failed mirror sync                          |                       — | —                                     | Until sync succeeds                                                     | Automatic                                          |
| Logs / diagnostics / crash reports  |                       **No** | —                                              | —                                                                                   | —                                                                                | —                                                   |                       — | —                                     | —                                                                       | —                                                  |

Notification ledger (`notification_events`) and ingest bookkeeping
(`ingest_runs`, `job_leases`, `product_visual_failures`, watchdog tables) are
recall/operations data with **no personal fields**; watchdog history is the
only table with automatic retention (30 days, `watchdog_tick`).

## 3. Network calls made directly by the app

All app-side networking uses plain `fetch`/OS facilities with `EXPO_PUBLIC_*`
configuration only (`@supabase/supabase-js` is imported exclusively by
`src/server/` and `scripts/` — never bundled into the app):

1. `GET {SUPABASE_URL}/rest/v1/recall_cases…` and `…affected_products` embed —
   feed pages (`src/lib/recall-feed.ts`). Publishable key only.
2. `GET …/rest/v1/recall_cases?id=eq.…` + `…/rest/v1/product_visuals…` —
   detail screen.
3. `POST …/rest/v1/rpc/register_push_subscription | disable_push_subscription
| set_installation_preferences` — the ONLY write path
   (`src/lib/push-api.ts`).
4. Image loads: FDA-hosted product photos (`www.fda.gov/files/…`, referenced
   not rehosted — `src/lib/product-photos.ts`) and Supabase Storage
   `product-visuals` bucket (rendered FSIS label pages).
5. `Linking.openURL` to official notice URLs and notice attachments;
   OS share sheet with canonical facts + official URL only
   (`src/lib/share-message.ts` — input type has no personal fields).
6. `expo-notifications` token fetch (Expo push infrastructure) — only after
   explicit enable; permission prompt fires only from the Settings button
   (`src/lib/push-registration.ts`).

## 4. Server-side data map (RLS verified from migrations)

Readable by the publishable (anon) client key — the intentional client
surface:

- `recall_cases` (`merged_into is null` policy), `affected_products`,
  `product_visuals` + public `product-visuals` storage bucket.
- Executable RPCs: `register_push_subscription`, `disable_push_subscription`,
  `set_installation_preferences` — SECURITY DEFINER, shape-validated, keyed by
  the caller-supplied installation id, returning nothing.

Inaccessible to anon/authenticated (RLS enabled, **no policies, no grants**):
`source_records`, `source_snapshots`, `notification_events`, `ingest_runs`,
`job_leases`, `product_visual_failures`, `push_delivery_config`,
`push_subscriptions`, `installation_preferences`, `notification_deliveries`,
`watchdog_config`, `watchdog_dispatches`, `watchdog_invocations`. Watchdog
RPCs are explicitly revoked from anon/authenticated. A client can therefore
write its own opaque rows and can never read tokens, preferences, or any
other installation's data back.

Server-side processing (service-role key, never in the app):

- GitHub Actions workflows `scheduled-ingest.yml` / `daily-maintenance.yml`
  run the ingestion/label/enforcement/push jobs with `SUPABASE_URL` +
  `SUPABASE_SECRET_KEY` from repo secrets.
- Supabase Edge Function `ingest-watchdog` + pg_cron: heartbeat/dispatch only;
  its tick touches only watchdog RPCs (pinned by
  `src/server/watchdog/contract.test.ts`), and credentials live in Edge
  Function secrets / Vault, never in tables or the repo.
- Push worker: reads deliverable events + enabled subscriptions, POSTs to
  Expo's push API, records tickets/receipts. Not activated
  (`push_delivery_config.push_enabled_at` unset → no-send no-op).

## 5. SDK & privacy-manifest inventory (iOS dependency graph)

Autolinked native packages (from `node_modules/*/ios` + root podspecs), with
their bundled Apple privacy manifests (`PrivacyInfo.xcprivacy`) read directly:

| Package (version)                                                                                                           | Function                                                                     | Network destinations    | Data it can touch            | Privacy manifest                                                        | Required-reason APIs declared                        | On Apple's third-party-SDK list |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------- | ---------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------- |
| expo 57.0.16 / expo-modules-core                                                                                            | Runtime                                                                      | —                       | —                            | via submodules                                                          | —                                                    | No                              |
| react-native 0.86.2                                                                                                         | Runtime                                                                      | Metro (dev only)        | —                            | Yes (×5 incl. RCT-Folly, boost, glog)                                   | FileTimestamp C617.1, UserDefaults CA92.1            | No                              |
| expo-constants 57.0.14                                                                                                      | App config                                                                   | —                       | app config                   | Yes                                                                     | UserDefaults CA92.1                                  | No                              |
| expo-notifications 57.0.14                                                                                                  | Push registration/handling                                                   | Expo push token service | push token                   | Yes                                                                     | UserDefaults CA92.1                                  | No                              |
| expo-secure-store 57.0.1                                                                                                    | Keychain storage                                                             | —                       | preferences, installation id | No manifest (none required: keychain APIs are not required-reason APIs) | —                                                    | No                              |
| expo-crypto 57.0.2                                                                                                          | randomUUID                                                                   | —                       | —                            | No manifest (no required-reason API)                                    | —                                                    | No                              |
| expo-linking / expo-router 57                                                                                               | Navigation, external links                                                   | —                       | —                            | No manifest needed                                                      | —                                                    | No                              |
| expo-splash-screen / expo-status-bar / expo-system-ui                                                                       | UI chrome                                                                    | —                       | —                            | system-ui: Yes                                                          | UserDefaults CA92.1                                  | No                              |
| expo-application (transitive)                                                                                               | App metadata                                                                 | —                       | version/build                | Yes                                                                     | FileTimestamp C617.1                                 | No                              |
| expo-file-system (transitive)                                                                                               | FS for expo internals                                                        | —                       | local files                  | Yes                                                                     | FileTimestamp 0A2A.1+3B52.1, DiskSpace E174.1+85F4.1 | No                              |
| expo-asset / expo-font / expo-keep-awake / expo-json-utils / expo-manifests / expo-glass-effect / expo-symbols (transitive) | Runtime support                                                              | —                       | —                            | none required                                                           | —                                                    | No                              |
| expo-dev-client + dev-launcher/dev-menu 57.0.15                                                                             | **Dev builds only** — excluded from release builds                           | dev server              | —                            | n/a (dev)                                                               | —                                                    | No                              |
| react-native-safe-area-context 5.7.0 / react-native-screens 4.26.2 / @react-native-masked-view                              | UI                                                                           | —                       | —                            | none required                                                           | —                                                    | No                              |
| @supabase/supabase-js 2.112.3                                                                                               | **Server/scripts only** — never in the app bundle (verified by import audit) | n/a                     | n/a                          | n/a                                                                     | n/a                                                  | No                              |

Findings:

- **Every bundled manifest declares `NSPrivacyCollectedDataTypes = []` and
  `NSPrivacyTracking = false`, with no tracking domains.** All declared
  required-reason APIs carry approved reason codes (C617.1, CA92.1, 0A2A.1,
  3B52.1, E174.1, 85F4.1).
- No dependency appears on Apple's commonly-used third-party SDK list
  (checked 2026-08-28), so no SDK signature requirement applies.
- The **app-level** privacy manifest is generated at prebuild/EAS build time;
  since the app itself collects data (installation id, preferences, push
  token), the app-level `NSPrivacyCollectedDataTypes` must be populated to
  match the App Privacy answers — tracked in `recall-app-store-readiness.md`.
  No first-party code calls a required-reason API directly.
- `pdfjs-dist`, `@napi-rs/canvas`, `tsx`, `prettier`, `eslint`, `typescript`,
  `@types/*` are dev/server-only and never ship in the app.
- Unrelated Expo patch drift observed and deliberately not fixed in C7 (see
  §8): `npx expo install --check` reports newer patch versions for several
  SDK 57 packages. Report only; C7 changes no dependencies.

## 6. Exported-bundle secret scans

Method: `npx expo export --platform ios` and `--platform web` to a scratch
directory at the audited HEAD, then case-insensitive sweeps of every emitted
bundle for: `sb_secret`, `service_role`, `SUPABASE_SECRET_KEY`, `ghp_`,
`github_pat_`, `WATCHDOG_SHARED_SECRET`, `EXPO_ACCESS_TOKEN`, server-only
table names (`source_snapshots`, `notification_events`, `ingest_runs`,
`job_leases`, `push_delivery_config`, `watchdog_`), server-only RPCs
(`watchdog_tick`, `acquire_job_lease`), and tracking domains
(`google-analytics`, `doubleclick`, `facebook.com`, `segment`, `sentry`).

Results (2026-08-28; iOS = strings sweep of the Hermes `.hbc` bundle, web =
grep of the emitted JS/HTML):

- **Zero hits in both bundles** for every secret pattern: `sb_secret`,
  `service_role`, `SUPABASE_SECRET_KEY`, `ghp_`, `github_pat_`,
  `WATCHDOG_SHARED_SECRET`, `EXPO_ACCESS_TOKEN`.
- **Zero hits in both bundles** for every server-only identifier:
  `source_snapshots`, `notification_events`, `ingest_runs`, `job_leases`,
  `push_delivery_config`, `watchdog_tick`, `acquire_job_lease`.
- **Zero analytics/tracking domains.** The single raw-substring match for
  "doubleclick" in the web bundle is React DOM's `onDoubleClick` event name —
  a false positive, not the ad domain; no `google-analytics`, `segment`,
  `sentry`, or `facebook.com` string appears in either bundle.
- Present, as intended (the RLS-constrained client surface): the
  `EXPO_PUBLIC_SUPABASE_URL` value, the `sb_publishable_…` key,
  `recall_cases`, `affected_products`, `product_visuals`, and the three
  client RPC names (`register_push_subscription`,
  `disable_push_subscription`, `set_installation_preferences`; absent from
  the web bundle, whose platform variants exclude the push/preference APIs).
  No actual secret values are reproduced in this report.

## 7. Deletion, reset, and lifecycle semantics (verified)

- **"Turn off alerts"** clears the local enabled flag and calls
  `disable_push_subscription`: the row gets `enabled=false`,
  `disabled_at=now()`, `disabled_reason='user_disabled'`. The token and
  history are **preserved in the disabled row**; preferences are untouched.
- **Clearing preferences** in Settings syncs the cleared (empty) state to the
  mirror; the row itself remains (empty arrays / null state).
- **Uninstalling the app** removes nothing server-side, and SecureStore
  values (preferences + installation id) live in the OS keychain, which can
  survive uninstall/reinstall. A reinstall that re-enables alerts under a new
  installation id causes the backend to disable the stale row when the same
  push token re-registers (`register_push_subscription`'s token-reassignment
  branch).
- **A complete "reset my data" operation does not exist.** There is no client
  RPC to delete `installation_preferences` or `push_subscriptions` rows, and
  no retention job prunes them or `notification_deliveries`. This is the
  principal product gap for the privacy story; the consumer document states
  it honestly, and the founder decision (in-app delete control and/or
  server-side retention windows) is tracked in `recall-launch-blockers.md`.
  Any future purge job or delete RPC would require a migration and is
  explicitly **not** part of C7.

## 8. Out-of-scope observations (reported, not acted on)

- Expo patch drift exists across several SDK 57 packages (expo-doctor/
  `expo install --check`); left untouched per the milestone instruction.
- `app.json` sets no `ios.infoPlist.ITSAppUsesNonExemptEncryption` flag yet;
  the app uses only exempt (OS/HTTPS) encryption, so the standard `false`
  declaration is expected at release preparation — tracked in the readiness
  checklist, deliberately not added in C7.
- `notification_deliveries` / disabled `push_subscriptions` rows accumulate
  without retention; a founder-approved retention promise (and its migration)
  is a prerequisite for the final Privacy Policy's retention section.
