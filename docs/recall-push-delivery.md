# Recall push delivery (Phase C2)

_Written 2026-08-26. Turns deliverable NotificationEvents into real mobile
push notifications via the Expo Push Service. Personalization (states,
allergens, retailers, preferences) is Phase C3 and filters through the one
eligibility seam described below._

## The pipeline

```
new / materially changed recall
        → NotificationEvent            (Phase A/B domain logic — authoritative)
        → delivery eligibility         (activation + subscription horizons)
        → active device subscription   (push_subscriptions)
        → Expo Push Service            (ticket)
        → APNs / FCM                   (receipt)
        → phone notification
        → tap → /recall/[id]
```

C2 never decides whether an event should exist and never overrides
suppression — `suppressed IS NOT NULL` events are structurally excluded.

## Transport: Expo Push Service

ExpoPushToken → Expo Push Service → APNs/FCM. One cross-platform API, no
Apple/Google server credentials in this repo (they live in EAS), plain HTTP
from the worker (verified against current Expo docs, 2026-08):

- send: `https://exp.host/--/api/v2/push/send`, ≤100 messages/request,
  600 notifications/second/project — the worker chunks to 100.
- receipts: `/--/api/v2/push/getReceipts`, ≤1000 ids/request; Expo recommends
  checking ~15 minutes after send; receipts are cleared after 24 h.
- A **ticket** means Expo accepted the request. Only a **receipt** with
  `status: ok` means Expo handed the message to APNs/FCM (`receipt_ok` —
  deliberately not named "delivered": even that is not proof of display).
- `DeviceNotRegistered` (ticket or receipt) disables the subscription;
  history is kept; a later re-registration with a fresh token revives it.

## Safety: two horizons, both explicit

**Activation horizon (global).** `push_delivery_config.push_enabled_at` is
set only by `npm run push:activate -- --confirm` — never inferred from
deploys, migrations, or first runs. Only events created ON/AFTER it are ever
considered, so the pre-C2 deliverable backlog (42 events as measured
2026-08-26; a historical figure — the ledger has grown since, and every
pre-activation event is excluded regardless of count) can never be
broadcast. Until activation the worker runs as a no-send no-op.
`--deactivate --confirm` is the emergency off switch; reactivating records a
NEW horizon, so nothing from a dark period is sent as catch-up.

**Subscription horizon (per device).** Each subscription carries
`enabled_at`; eligibility requires the event to postdate
`max(push_enabled_at, enabled_at)`. A device that enables alerts on Sept 5
never receives Sept 1 events. Idempotent re-registration keeps the horizon;
re-enabling after a disable moves it forward.

**Preference horizon (Phase C3).** When an installation has stored
preferences, `installation_preferences.updated_at` joins the max above, so
changing preferences (new allergen, new state) can never make an OLDER event
newly deliverable. Personalized matching itself — state / allergen /
retailer, same evaluation the app renders — happens inside the same
eligibility seam. See
[docs/recall-personalization.md](recall-personalization.md).

**Deletion interacts safely with all three (C7.1).**
`delete_installation_data` removes an installation's subscription rows and
their `notification_deliveries`. That cannot resurrect old sends: delivery
eligibility is decided by the horizon seam, not by delivery-row dedup. A
post-deletion re-registration — same id string or a new one — always takes
the RPC's fresh-insert path (the old row is gone), producing a **new
subscription uuid with `enabled_at = now()`**, so every event created before
the reset stays structurally undeliverable
(`src/server/push/installation-deletion.test.ts`, the NO BACKFILL proof).
The `(event_id, subscription_id)` unique pair continues to make reruns
idempotent for surviving subscriptions. Inside the RPC, a `FOR UPDATE` lock
on the installation's subscription rows keeps a concurrently ticking worker
from inserting a delivery row between the two deletes (FK `KEY SHARE`
conflicts with `FOR UPDATE`), so the single transaction cannot fail
half-way through a tick. One bounded edge, same class as the worker's
documented crash window: a worker that already read a delivery row into
memory before the deletion commits may still complete that one send — it
cannot recreate any row.

## Data model (all additive — migration `20260828000000_push_delivery.sql`)

- `push_delivery_config` — one row: the activation horizon.
- `push_subscriptions` — one row per app installation, keyed by a
  client-generated opaque random `installation_id` (the device's bearer
  capability for its own row; no hardware identifiers). Carries the
  ExpoPushToken, platform, enabled/enabled_at/disabled_reason. When a token
  re-registers under a new installation (reinstall), the stale row is
  disabled (`token_reassigned`) so one phone never gets doubles.
- `notification_deliveries` — per (event, subscription) lifecycle:
  `pending → sending → ticket_accepted → receipt_ok`, with
  `retryable_failure` / `permanent_failure` exits, attempt counts, ticket id,
  and failure codes. **`unique (event_id, subscription_id)` is the delivery
  idempotency guarantee** — a rerun or scheduler retry cannot re-enqueue, and
  a persisted ticket is never re-sent.

Client access: the tables have RLS with no policies and no anon grants. The
app's ONLY write path is two `SECURITY DEFINER` RPCs —
`register_push_subscription` (validated, idempotent upsert by installation
id) and `disable_push_subscription`. A client can never list tokens, read
other rows, or touch events/deliveries.

## Worker (`npm run jobs:push`)

Runs through the C1 runner — same lease (`push_delivery`, 25-min TTL, stale
recovery), same one-`ingest_runs`-row bookkeeping, same failure semantics —
so overlapping runs skip safely and manual + scheduled execution are the
same code. Each run: process due receipts → create missing deliveries for
newly eligible events (one eligibility seam — `classifySubscriptionsForEvent`
in `src/server/push/worker.ts`, with `eligibleSubscriptions()` as its thin
wrapper; C3 preference filters go there and nowhere else) → send
pending/retryable/crash-recovered rows in chunks of 100.

Retries: transient failures (network, `MessageRateExceeded`, unknown codes)
back off 30 min · 2ⁿ capped at 6 h, at most 5 attempts, then
`permanent_failure`. Permanent codes (`DeviceNotRegistered`,
`InvalidCredentials`, `MessageTooBig`, `MismatchSenderId`) never retry.
At-least-once edge (documented, bounded): a crash between the HTTP send and
the ticket write can duplicate that one chunk on the next run; a receipt
missing after 24 h goes retryable rather than silently counting as ok.

Copy is one deterministic formatter (`src/server/push/format.ts`, golden-
tested) reusing the app's own display helpers — product identity, hazard
reason, ConsumerRiskTier words (Critical/High/…); official Class I/II/III
never appears in a push, mixed classes are never shown as one class, and a
Pending-risk recall announces hazard facts without inventing a tier. Product
titles flow through the shared display-capitalization contract (P3D,
[recall-feed-usability.md](recall-feed-usability.md)), so a defectively
lowercase source name is headline-cased in future delivery copy exactly as on
the app's cards. The P3E reason-clause casing does not reach push copy at
all — the push body is the card's own concise reason line (`conciseReasonLine`,
since P2B7Q), never the raw source sentence. Both are formatting
only: neither activates push, creates notification events, or rewrites any
recorded notification data — copy is rendered at delivery time and is never
stored in the ledger. Payload is
`{kind:'recall', recallCaseId, notificationEventId}` — the app validates it
and builds the route itself; it never navigates to a pushed URL.

Scheduling: a `jobs:push` step at the end of both existing workflows. The
30-minute tick delivers events created in the same cycle and reads the
previous tick's receipts (≥15 min old — matching Expo's guidance); the daily
maintenance run delivers enforcement-driven risk updates same-cycle.

### Notification titles: the short product name (2026-10-03)

Every title's product part is `notificationProductName`
(`src/server/push/product-name.ts`), the same for new recalls, safety alerts,
risk updates, recall updates and retractions; prefixes, bodies, the payload
and the tap destination are unchanged. In order:

1. **The card's own name** — `cleanProductName` (description, else the parsed
   headline, else the title; the card's trailing-size rule; the shared
   shopper casing) WITHOUT the card's brand-prefix strip: a notification has
   no brand line, so `Tostitos Avocado Salsa Dip` keeps `Tostitos`. Before
   this change push used only the display name, so 47 of 1,934 visible cases
   named a product differently from the card they open.
2. **Notification-only removals**, each a confident classification: code and
   date tails after a separator (`, UPC …`, `| Lot …`, `, Best By …`),
   size-only parentheticals (`(NET WT 38 OZ, 107 G)`, `(16 FL OZ glass
jars)`), closing size lists (`, 7 oz., 10 oz. and 16 oz`, `in 50 gram, …
and 1 kilogram packages.`) and exact list repeats. Flavours, formulations,
   allergens and brands are never targeted (`Peanut Butter`, `Gluten-Free`,
   `Black Sesame` pass through). An unmatched bracket left by the source is
   dropped; a removal never empties a name.
3. **Only when still over the limit and the recall names two or more
   distinct products** (each affected-product line's own parsed name; sizes,
   codes and `Field: value` fragments are not products): `{Brand} products`
   when exactly one real brand is on record AND the name or every product
   line carries it, or the existing `Multiple products and brands` when two
   or more real brands are (corporate suffixes such as `Inc.` are not
   brands). Never an invented brand or category.
4. **Otherwise a whole-word cut with `…`**, joiners and punctuation dropped,
   never inside a grapheme.

**The limit** is a soft 55 graphemes for the product part (the prefix is
outside it), down from the former hard 60-character cut. Over the 1,934
visible live cases (read-only, 2026-10-03): 132 titles change, no body
changes, the longest product part is 55, the median 20; 12 take a group
label and 113 an ellipsis. iOS decides how many lines a title shows; nothing
here promises a line count. Tests: `product-name.test.ts` (recorded FDA/FSIS
notices plus synthetic edge shapes), `format.test.ts`.

### Matching versus the Feed's Affects You (audited 2026-10-03, unchanged)

Push and Affects You call the same `evaluatePersonalRelevance`, so states
(including several), nationwide, unknown geography and the known-allergen
rule agree once a jurisdiction is chosen. They differ where push is
deliberately broader or unfiltered:

- **No jurisdiction chosen** (or no preference row): `pushEligible` delivers
  everything, while Affects You needs an allergen or store signal
  (`relevance.ts` `pushEligible`; documented in
  [recall-personalization.md](recall-personalization.md)). Onboarding requires
  a state, so this reaches only installations without one.
- **Lifecycle and merges:** the Feed reads only active, unmerged cases; the
  worker's deliverable events are not filtered by case lifecycle or by a later
  merge, so an update on a closed case, or an event on a case merged
  afterwards, could send for a recall the Feed does not list.

Only new ledger events created after the latest of activation, the
subscription's enable time and the preferences' update time can send
(per-subscription horizons in `worker.ts`), so enabling alerts or changing
preferences never replays a backlog. Delivery remains globally inactive.

### Known permission-path gaps (kept as they are)

From notification education and the Notifications screen alike:

- A shopper who **denied the permission earlier** gets no prompt and no
  explanation from `Turn on notifications` — iOS cannot ask again, and the
  education completes silently (the Notifications screen does explain it).
- A **registration error** after a granted permission is swallowed by the
  education route (logged in development only); the education completes and
  nothing claims alerts are on.

## Client

- Explicit opt-in only: Profile → **Notifications** → "Enable recall alerts"
  and, since P2B7X.1, the one-time notification-education screen's "Turn on
  notifications" — shown only after a verified purchase or restore — are the
  two explicit presses that reach `enableRecallAlerts`, and therefore the
  system permission prompt (never on launch, never merely by opening a
  screen, never from "Not now"; see
  [recall-onboarding-and-paywall.md](recall-onboarding-and-paywall.md) §6);
  denial routes to system settings, no re-prompting. P2A split the former
  combined "Alerts" screen into Personalization and Notifications; the
  controls and their behavior are unchanged. P2B6A restyled Notifications
  onto the design tokens — one truthful status sentence per permission state
  and the one action that state allows ([../DESIGN.md](../DESIGN.md)
  "Personalization and Notifications") — with the read, the enable path,
  the registration and this boundary untouched.
- `expo-notifications` + `expo-secure-store` (installation id + enabled
  flag) + `expo-crypto` (random UUID). Foreground notifications show the
  system banner/list (no custom duplicate). Cold start / background /
  foreground taps all route through `useLastNotificationResponse` →
  validated payload → `/recall/[id]`; unknown ids land on the detail
  screen's "not found" state.
- Silent upkeep: on launch and on Expo token rotation the app re-registers
  (idempotent) — only if the user enabled alerts here.

## Secrets and privacy

Server env (GitHub repo secrets): `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and
optionally `EXPO_ACCESS_TOKEN` (only if enhanced push security is enabled on
the Expo account — recommended eventually, not required for MVP). Nothing
new in the client bundle. ExpoPushTokens are private operational data: no
policy exposes them to clients, jobs never print them, `push:test` lists ids
only. No analytics, ad identifiers, or fingerprinting.

## Activation (founder steps — see also the ops doc)

0. One-time Expo/EAS setup (external accounts, not done by code):
   `eas init` (links the project, writes `extra.eas.projectId`), set
   `ios.bundleIdentifier` (and `android.package` when Android matters), then
   `eas build --profile development --platform ios` and let EAS create the
   APNs push key. Push does NOT work in Expo Go (SDK 53+) — use the
   development build; the iOS Simulator (Xcode 14+) can receive pushes.
1. Review + apply the migration: `supabase db push` (additive only).
2. Commit + push C2 (the workflow step ships; it is a no-send no-op).
3. On the dev-build device: Alerts → Enable recall alerts.
4. `npm run push:test` (lists subscription ids) →
   `npm run push:test -- --subscription <id>` → notification appears.
5. `npm run jobs:push -- --dry-run` — confirm 0 would-send and the full
   pre-activation backlog excluded.
6. `npm run push:activate` (review) → `npm run push:activate -- --confirm`.
7. Watch the next scheduled tick, then `npm run ops:health`.
