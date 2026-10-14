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
NEW horizon, so nothing from a dark period is sent as catch-up — and nothing
queued BEFORE the deactivation either (2026-10-10, "Queued rows" below).

**Subscription horizon (per device).** Each subscription carries
`enabled_at`; eligibility requires the event to postdate
`max(push_enabled_at, enabled_at)`. A device that enables alerts on Sept 5
never receives Sept 1 events. Idempotent re-registration keeps the horizon;
re-enabling after a disable moves it forward.

**Queued rows obey the current horizons (2026-10-10).** Delivery rows
already queued — `pending`, `retryable_failure`, or `sending` left by a crash —
are judged again before every send against the horizons as they stand NOW
(`queuedRowHorizonFailure` in `worker.ts`): a row whose event predates the
current `push_enabled_at` fails closed as `before_activation`, and one whose
event predates its subscription's current `enabled_at` as
`before_subscription`. Before this, the send pool ignored horizons: a
deactivate → reactivate sent rows queued before the rollback hours late, a
ticket stranded by a deactivation was re-sent as a duplicate once its receipt
expired (>24 h, `ReceiptUnavailable` → retryable), and a disable + re-enable
before the next tick revived a row from before the disable. Preference
changes are deliberately not re-judged at send time — matching is decided
once, when the row is created. A dry run reports these rows as
`queuedBeforeHorizon` and excludes them from would-send. Tests: the "Queued
rows obey the CURRENT horizons" block in `worker.test.ts`.

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
  disabled (`token_reassigned`) so one phone never gets doubles. A parent's
  revoked consent disables with `consent_revoked` (see "Consent revocation").
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

### Write ordering: the subscription sequence (applied in production 2026-10-04)

`supabase/migrations/20261004000000_push_subscription_sequence.sql` adds
`push_installation_sequences` (installation id → the highest write sequence
applied and the operation that carried it), a gate function
`push_sequence_gate` (not callable by the client role), and an optional
`p_sequence bigint default null` on both RPCs, which now return
`{"applied": bool, "last_sequence": n}`. The rule per installation:

- a write carrying a LOWER sequence than the recorded one is refused;
- the recorded sequence with the SAME operation is the same write retried
  and applies (idempotent; a retried registration keeps `enabled_at`); the
  recorded sequence with a DIFFERENT operation is refused — one sequence
  names one write;
- a HIGHER sequence applies and is recorded;
- NO sequence is a legacy client: it applies only while the installation
  has never written with a sequence; once an installation has entered the
  protocol an unsequenced write is refused, so an older build can never undo
  a sequenced disable.

Concurrent writes for one installation are serialized on a transaction-scoped
advisory lock inside the gate, so two requests in flight at once are decided
one after the other in commit order. The data-reset RPC deletes the sequence
row with everything else; the fresh installation id starts at 1. The old
four- and one-argument function signatures are dropped and re-created with
the defaulted parameter, so PostgREST has exactly one candidate per name and
old-shaped calls still resolve (they ignore the returned value).

Why: the education's 10 s deadline aborts a registration the server may
commit in the instant before the abort. The client then knows nothing, writes
no flag, and `Continue without alerts` would leave an enabled row. The
client's side (`src/lib/alert-intent.ts`, persisted under
`recall.alerts-intent`): every write carries the next sequence from one
monotonic counter per installation; a registration whose outcome is unknown
(abort, timeout, network, a gateway 5xx — anything but a 4xx refusal, which
committed nothing) is followed by a disable carrying the NEXT sequence, so
it outranks the registration whether that landed before it, after it, or
never; the cleanup stays `pending` in storage until the server answers it
(applied, or refused because this installation has since written something
newer — only this client writes for its id), or until a LATER registration
is confirmed; a pending cleanup is retried at launch and before the next
registration; a registration interrupted by a crash (`inFlight` in storage)
is cleaned up the same way at launch. A refused registration means the
persisted counter is behind the server's (lost or reset while the
installation id survived): nothing was committed, the client adopts the
server's count and sends once more ahead of it. The confirmed flag
(`enabled`) is written only after the server answered and cleared before any
disable is sent, so "Recall alerts are on" is never reported while the
server's state is unknown. The silent refresh carries a sequence but never
cleans up: the state it re-asserts is the one already wanted. Every
operation runs on the installation mutation queue, so sequence allocation
and the intent record are never raced from the client.

Validation (2026-10-04, local Supabase stack from `supabase start`, which
applied the full migration chain): the SQL cases — registration then a
higher-sequence disable; a disable arriving before the lower-sequence
registration; a retry outranking its cleanup; the same request repeated;
equal sequence with a different operation; legacy before and after protocol
entry; data reset and re-registration; concurrent transactions in both
orders — all behaved as stated above, and local PostgREST resolved exactly
one function per RPC name for the old and the new argument lists. The client
side is proven in `src/lib/alert-intent.test.ts` against the memory store's
mirror of the gate (server commit before abort, delayed commit after
cleanup, Continue after timeout, immediate retry, stale cleanup after a
successful retry, relaunch with a pending cleanup, crash mid-registration,
lost counter, refused cleanup, and simultaneous operations on the queue).
The migration was applied in production on 2026-10-04 and verified read-only
(schema, signatures, grants, RLS, reset body); no hosted RPC was executed in
that step. Builds carrying this client may be distributed. See
[recall-operations.md](recall-operations.md) "Push subscription sequence".

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

### Matching versus the Feed's Affects You (aligned 2026-10-04)

Push and Affects You call the same `evaluatePersonalRelevance`, and since
2026-10-04 `pushEligible` IS the Affects You verdict (`affectsYouVerdict`):
the same two inputs, the same answer, for every profile. The two places
where push used to be broader than the Feed (audit K3, 2026-10-03) are
closed:

- **No jurisdiction chosen** (or no preference row): formerly deliver-all.
  Now only an allergen or store signal qualifies, and a profile with nothing
  chosen — or no preference row at all — receives nothing, exactly as
  Affects You shows nothing and asks for a state. Nationwide alone is not a
  personal signal. The consumer document `How Affects Me works` says the same
  ([recall-personalization.md](recall-personalization.md) has the policy).
- **Lifecycle and merges**: see the next section.

Only new ledger events created after the latest of activation, the
subscription's enable time and the preferences' update time can send
(per-subscription horizons in `worker.ts`), so enabling alerts or changing
preferences never replays a backlog. Delivery remains globally inactive.

### Eligibility by event type (2026-10-04)

The ledger never rewrites an event, but between its creation and the tick
that would deliver it the case can close, be retracted, or be reconciled
into a surviving duplicate — and the Feed lists a case only while
`state = 'active' AND merged_into IS NULL`. Before any subscription is
considered, `resolveDeliverableEvent` (`worker.ts`) reads the case's current
`state` and `merged_into` with the projection, follows a merge tombstone to
the canonical surviving case (bounded, cycle-safe), and `decideDelivery`
(`src/server/push/event-eligibility.ts`, a pure leaf) applies this table:

| Event                              | Destination case      | Decision                                                  |
| ---------------------------------- | --------------------- | --------------------------------------------------------- |
| `initial` (new recall)             | active, unmerged      | deliver                                                   |
| `initial`                          | closed or retracted   | skip (`lifecycleSkipped`) — not an active recall          |
| `initial`                          | an absorbed duplicate | skip (`mergedDuplicateSkipped`) — the survivor's own      |
|                                    |                       | `initial` is the new-recall alert                         |
| `material_update` · `retraction`   | retracted             | deliver — the one update whose case is not active         |
| `material_update` · `retraction`   | not retracted         | skip (`lifecycleSkipped`)                                 |
| `material_update` · any other rule | active                | deliver (expansion, correction, classification, health    |
|                                    |                       | impact, instructions changed)                             |
| `material_update` · any other rule | closed or retracted   | skip (`lifecycleSkipped`)                                 |
| `material_update` on an absorbed   | survivor, eligible    | deliver RE-POINTED at the survivor (`reroutedToSurvivor`) |
| duplicate                          | per the rows above    | — payload id and copy are the survivor's                  |
| `material_update` on an absorbed   | survivor already has  | skip (`mergedDuplicateSkipped`) — one alert per change    |
| duplicate                          | the same change       |                                                           |
| any                                | chain unresolvable    | skip (`destinationUnresolved`)                            |

The decision is made again for a retry or crash-recovered delivery row
whose event is no longer in the run's map, so a case merged or closed
between runs fails that row closed (`case_<reason>`) instead of sending.
Every alert's payload `recallCaseId` is therefore a case the client's RLS
policy lets Detail read (closed and retracted cases included; a tombstone
never), and no second alert is produced for one change across a merge. The
horizons, suppression, per-pair idempotency and ticket/receipt honesty are
untouched; this leaf never creates an event and is not a blanket
active-only filter — retractions are delivered precisely because the Feed
no longer lists them. Tests: `event-eligibility.test.ts` (the table) and
`worker.test.ts` (closed, retracted, merged, chained, twin, retry and
no-backlog cases).

### Permission outcomes on the education screen (repaired 2026-10-04)

The two gaps recorded here on 2026-10-03 are closed in
[recall-onboarding-and-paywall.md](recall-onboarding-and-paywall.md) §6.11:
a denial the system will not revisit shows `Notifications are turned off
for Lotly. Enable them in your device settings.` with `Open settings` /
`Continue without alerts`, and a registration that fails or passes its 10 s
deadline shows `We couldn't finish turning on alerts.` with `Try again` /
`Continue without alerts`. The system permission and the server
registration are two distinct steps (`EnablePorts` in
`src/lib/push-registration.ts`); the education completes only when the
registration succeeded, the prompt was refused just now, or the shopper
chose to go on without alerts. The Notifications screen's behaviour is
unchanged.

## Client

- Explicit opt-in only: Profile → **Notifications** → "Enable recall alerts"
  and, since P2B7X.1, the one-time notification-education screen's "Turn on
  notifications" — shown only after a verified purchase or restore — are the
  two explicit presses that reach the enable ports (`resolvePermission`,
  then `register`; `enableRecallAlerts` is the Notifications screen's shape
  of them), and therefore the system permission prompt (never on launch,
  never merely by opening a screen, never from "Not now"; see
  [recall-onboarding-and-paywall.md](recall-onboarding-and-paywall.md) §6);
  denial routes to system settings, no re-prompting. P2A split the former
  combined "Alerts" screen into Personalization and Notifications; the
  controls and their behavior are unchanged. P2B6A restyled Notifications
  onto the design tokens — one truthful status sentence per permission state
  and the one action that state allows ([../DESIGN.md](../DESIGN.md)
  "Personalization and Notifications") — with the read, the enable path,
  the registration and this boundary untouched.
- `expo-notifications` + `expo-secure-store` (installation id + the alert
  intent record: sequence, confirmed flag, pending cleanup) + `expo-crypto`
  (random UUID). Foreground notifications show the
  system banner/list (no custom duplicate). Cold start / background /
  foreground taps all route through `useLastNotificationResponse` →
  validated payload → `/recall/[id]`; unknown ids land on the detail
  screen's "not found" state.
- **A tap waits for the gate (2026-10-10).** On a cold launch the launch
  response is read at mount, before the access gate has read onboarding and
  entitlement from secure storage, so the first answer is always "not ready,
  phase onboarding". The hook used to decide the tap on that answer and mark
  it handled, so every cold-launch tap opened the Feed. The tap is now held
  in memory (`src/lib/push-tap-intent.ts`) and opened once the gate has
  settled on the `app` phase AND the navigation container is ready (its
  `ready` and `state` events retry it). While onboarding, the paywall or the
  education stands it opens nothing — never a door around the gate — and if
  that phase ends in `app` in the same session (a lapsed subscriber who buys
  again), the tapped recall opens then. It is never persisted, the newest
  tap wins, and a newer tap that names no recall cancels a waiting one.
  Tests: `push-tap-intent.test.ts`; the wiring is pinned in
  `access-gate.test.ts`.
- Silent upkeep: on launch and on Expo token rotation the app first sends
  any disable it still owes the server (see "Write ordering" above), then
  re-registers (idempotent, sequenced) — only if a registration is confirmed
  here and nothing is owed.

## Allergen consent in matching (2026-10-13; migration 20261014000000 applied 2026-10-13)

`toUserPreferences` (worker.ts) gives the relevance evaluation a row's
allergens **only when it carries `allergen_consent_version`**. The relevance
rules themselves are unchanged. Without consent a profile is judged exactly
like one that chose no allergens.

**What that means for delivery.** Under C5.2B, an identified allergen-only
recall with **no** selected allergens is a mismatch. So for those profiles:

- every allergen-only recall is withheld;
- a recall with no stated distribution that only an allergen would qualify
  is not sent;
- state and store matches are untouched;
- an allergens-only profile receives nothing.

**Production rows written before consent existed** (`allergen_consent_version`
null) are therefore matched without allergens from the moment this code
runs. At the apply (2026-10-13 03:50 UTC) that was 9 of 10 rows; their
allergens are retained, not cleared. Push is still **not activated**, so no
delivery has used this rule yet; checking it end to end is a device check in
[recall-operations.md](recall-operations.md) "Allergen consent: schema
migration", after a separate activation decision.

**Safe before the migration** (the state until 2026-10-13 03:50 UTC). If the
column does not exist yet,
`listPreferences` reads without it, so allergens are ignored: never a
broader match. Tests are in `worker.test.ts` ("consent: …").

## Inactivity retention (APPLIED 2026-10-13; cleanup not enabled)

`20261013000000_installation_inactivity_retention` deletes an installation's
push subscription and its `notification_deliveries` (with its other rows)
after 12 months without user activity. Delivering a notification is never
activity; the app opened from one is. A returning installation's daily
foreground check-in (`src/lib/installation-checkin.ts`) calls
`refreshRegistrationIfEnabled`, which re-registers with a fresh `enabled_at`,
so no pre-purge event can be backfilled. Details:
[recall-operations.md](recall-operations.md).

## Consent revocation (age assurance; migration applied, receiver deployed for Sandbox, 2026-10-13)

**Status (2026-10-13).**

- **Migration applied.** `20261017000000_consent_revocation.sql` was applied
  in production at 06:31 UTC from `eeed810`; all 17 post-apply checks
  passed.
- **Receiver deployed, Sandbox only.** The `app-store-notifications` Edge
  Function was deployed at 21:13 UTC (v1, `APP_STORE_ENVIRONMENTS=Sandbox`).
  A Production-claim notification is still refused.
- **Production waits for TestFlight.** Production is enabled only after the
  TestFlight revocation chain passes, by setting
  `APP_STORE_ENVIRONMENTS=Sandbox,Production`; `APP_STORE_APP_APPLE_ID` is
  already set.
- **Forwarding configured, not yet proven.** The founder configured
  RevenueCat's forwarding URL. End-to-end forwarding of `RESCIND_CONSENT`
  stays unproven until that chain passes.
- **Bounded read.** The app's StoreKit read is bounded (`d71430c`).

**Why.** When a parent revokes consent for a teen's use of Lotly, Apple
blocks the app from launching and sends an App Store Server Notification
`RESCIND_CONSENT`. Apple says: "To handle consent revocations, use the
`RESCIND_CONSENT` value". The app can't act, because it can't launch, so
alerts are stopped on the server.

**The mapping** (migration `20261017000000_consent_revocation.sql`)

- **The column.** `push_subscriptions.app_transaction_hmac` holds
  `hex(HMAC-SHA256(appTransactionId, key))`.
  - The key is the Vault secret `app_transaction_hmac_key`.
  - The migration generates it on the server. It is never in git, the app or
    the Edge Function.
- **Atomic for regulated teens.** For a stored 13–17 answer that Apple
  reports as regulated, the app registers **only** through
  `register_push_subscription_with_revocation_key`
  (`src/lib/revocation-key.ts`, `routedRegistration`). That RPC enables the
  row **and** stores the hash in one transaction.
  - A regulated teen's alerts are therefore never eligible without the
    mapping.
  - An invalid id, or a missing Vault key, writes nothing.
- **No key, no alerts.** If StoreKit cannot produce the id, nothing is sent.
  - On a deliberate enable, the alert protocol's outranking cleanup disable
    runs. On a silent refresh of an enabled row, the row is disabled.
  - Both are persisted and retried like any disable.
  - Alerts stay off until the user turns them on again with the id
    available. Tested in `src/lib/alert-protection.test.ts`, including a
    failed upload and its retry.
  - **A stalled StoreKit read cannot hang anything** (2026-10-13). The read
    has a 5-second limit (`src/lib/app-transaction-read.ts`). A timeout or
    rejection counts as "no id", so the user stays blocked with alerts off.
    The registration, and the preference saves and reset queued behind it,
    then proceed. One native call is shared by retries while it is stalled;
    a late completion is ignored, and the next attempt reads afresh. Tested
    in `src/lib/app-transaction-read.test.ts`, with a control that shows the
    unbounded wait blocking saves and reset.
- **Clearing.** An installation that held a key but is no longer eligible
  registers keyed once more, so a revoked row can still renew. It then calls
  `clear_push_revocation_key`. A revoked row always keeps its key.
- **Coverage.**
  - Reset, privacy-request deletion and the inactivity purge delete the
    subscription row, and the key with it.
- **What the key is.** It is **pseudonymous personal data, not anonymous.**
  - The keyed hash stops someone holding only the database from reading
    Apple's id.
  - But Lotly holds the key, so Lotly can match the hash to a known id. The
    row ties it to one installation.
  - Its presence also reveals that Apple reported a regulated 13–17 user.
- **Export.**
  - It is left out of the ordinary privacy-request export (the approved
    field list in `20261016000000`).
  - The export must still say that the key exists and what it is for. The
    wording is agreed with the privacy-requests work, and it lands with the
    integration. It does not claim that the key "cannot be turned back"
    into anything.
  - Asked for directly, it is provided like any other held data.

**The receiver** (`supabase/functions/app-store-notifications`)

- **Where it listens.** It is RevenueCat's **Apple Server Notification
  Forwarding URL**. App Store Connect's URLs stay RevenueCat's.
- **Verification.** It verifies every payload with `apple-jws.ts`, which uses
  WebCrypto and has no imports. It checks:
  - the x5c chain to the pinned Apple Root CA - G3 (x5c[2] is never
    trusted);
  - that each certificate's outer signature algorithm equals the one inside
    its signed data;
  - that the intermediate is a CA (basicConstraints cA);
  - Apple's marker OIDs;
  - that the leaf, intermediate **and root** are valid at the payload's own
    signing date;
  - the ES256 signature;
  - the bundle id;
  - the environment, and the app's Apple id in Production.

  The CA, root-date and algorithm checks were added after two independent
  reviews (2026-10-13). Before them, a non-CA intermediate and an expired
  root were accepted, though neither was exploitable without an
  Apple-issued certificate's key.

- **Why not Apple's library.** `@apple/app-store-server-library` cannot run
  in Supabase's Edge Runtime: edge-runtime 1.74.3 does not implement
  `X509Certificate.verify`, `checkIssued` or `toString`. So the library is a
  **test oracle** only. `apple-jws.test.ts` requires both verifiers to agree
  on every case.
  - The parity is with the library's **offline** mode
    (`enableOnlineChecks = false`), not its online mode.
  - Two deliberate differences, both stricter: a payload without a signing
    date is refused, and no clock-skew allowance is applied.
- **Residual risk: no OCSP.** Apple's certificates are judged at the
  payload's signing date and never checked for revocation.
  - **The exposure.** If Apple revoked a compromised signing key, its holder
    could still sign backdated payloads, and they would be accepted.
  - **Why it's bounded.** A forgery can only **disable** alert subscriptions
    whose Apple id the forger already knows: regulated 13–17 users with
    alerts on. It never enables, reads or deletes anything, and the app's
    next registration upkeep re-enables the row.
  - **The reviewers' recommendation**, accepted for launch by the founder
    (2026-10-13): accept the risk, implement no OCSP, and keep a trip-wire.
    On any Apple certificate-compromise or root-change notice, set
    `APP_STORE_ENVIRONMENTS` to an empty value (the function then refuses
    every payload) until it is reviewed.
- **What it acts on.** It acts only on `RESCIND_CONSENT`, and logs nothing
  identifying.
- **The RPC.** `apply_consent_revocation` (service_role only) works in one
  transaction:
  1. It hashes the verified `appTransactionId`.
  2. It records the notification UUID, which is the replay protection.
  3. It disables the matching subscriptions with
     `disabled_reason = 'consent_revoked'`.
  - A replay is a no-op.
  - A missing key raises before anything is recorded, so the notification is
    retried, not consumed.
  - **No silent revival.** `register_push_subscription`, re-bodied from
    `20261004000000` with only this guard added, never re-enables a
    `consent_revoked` row.
  - **Renewal.** Only the keyed registration renews a revoked row, and only
    when the presented id hashes to the stored value. Renewal starts a new
    `enabled_at` horizon, so nothing from the revoked period is backfilled.
    Another account's id is refused (400).
  - **What the server proves, and what needs an Apple device.** The server
    verifies only that the same Apple Account's app presented its id. It
    cannot see Apple's consent decision. Three things are Apple behavior and
    are **proved only on a device** (sandbox runbook Phase 3):
    - Apple blocks a revoked app from launching.
    - Apple lets it launch again once a parent restores consent.
    - StoreKit returns the same `appTransactionID` afterwards.

    The rules above are verified on an isolated Postgres stack.

**Configuration** (Edge Function secrets, none of them a credential)

- `APP_STORE_BUNDLE_ID`, default `com.willisyang.lotly`.
- `APP_STORE_APP_APPLE_ID`, the numeric App Store Connect id. It is required
  to accept Production.
- `APP_STORE_ENVIRONMENTS`, default `Sandbox,Production`.
- `verify_jwt = false` in `config.toml`, because the sender can't hold a
  Supabase JWT.

**Verified locally.** Evidence is in the age-assurance review pack.

- **Node tests:**
  - the endpoint, with a test chain shaped like Apple's;
  - a differential suite against Apple's library;
  - Apple's real G3 root verifying its real WWDR G6 intermediate.
- **The Edge Runtime image** (edge-runtime 1.74.3): the verifier accepts a
  correctly signed payload and refuses it under the Apple root. The adapter
  boots and refuses unsigned payloads.
- **An isolated Supabase stack** ran master's chain with the allergen-consent
  and privacy-request migrations applied before this one. It confirmed:
  - hashing, with no raw id stored;
  - grants;
  - replay;
  - the missing-key refusal;
  - re-enable on re-registration;
  - reset;
  - an end-to-end pass from `core.ts` to the real RPC.

**Not verified.**

- That RevenueCat forwards `RESCIND_CONSENT`.
- That Apple's sandbox delivers it. Apple's forums report missed sandbox
  deliveries in late 2025.
- That the device's id equals the notification's.

The sandbox runbook in the review pack settles all three.

## When the server stops alerts (age assurance review, 2026-10-13)

Two routes stop alerts to a device, and they behave differently. The worker
side is pinned run by run in
`src/server/push/disabled-subscription-timeline.test.ts`. The under-13
request and its retry are pinned in `src/lib/alert-protection.test.ts`.

| Route                                                                | Server row disabled                                                                                                                                                                                                                                                                                                          | Queued alerts (`pending`, `retryable_failure`)                      | In-flight alerts (`ticket_accepted`)                                               |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Revoked consent** (`apply_consent_revocation`)                     | **At once**, `consent_revoked`                                                                                                                                                                                                                                                                                               | Failed closed at the next run (`subscription_disabled`), never sent | Already handed to Expo, so they cannot be recalled; their receipts settle as usual |
| **Under-13 stop** (2026-10-13: one protective request)               | **On the server's answer.** The stop sends the existing sequenced `disable_push_subscription` (`user_disabled`), carrying only the stored installation id and the write sequence. No age, no RevenueCat, no other launch sync. It also unregisters from APNs, locally                                                        | Failed closed at the next run once the disable has landed           | Already handed to Expo, so they cannot be recalled                                 |
| **Under-13 stop, offline**                                           | **Not until it is confirmed.** The disable is owed in SecureStore and sent again at every launch, because the stop screen shows each launch, until the server answers. Meanwhile the row stays enabled: if delivery is activated, queued alerts can still be handed to Expo, and the APNs unregister is the only local guard | Still handed to Expo until then                                     | Cannot be recalled                                                                 |
| **Under-13 stop, no stored installation id or alerts never enabled** | Nothing to disable, so **nothing is sent**                                                                                                                                                                                                                                                                                   | —                                                                   | —                                                                                  |

The receipt route still applies on top: once delivery is active, a send to
an unregistered token disables the row as `device_not_registered` after
Expo's receipt (at least `RECEIPT_DELAY_MINUTES` = 15).

**Unverified: what the iPhone displays.** Apple documents that an app that
called `unregisterForRemoteNotifications` stops receiving remote
notifications. Whether an alert sent between the stop and the disable is
shown has **not** been tested on a device. It needs an activated send or
`push:test`, which require separate authorization.

## Alert entitlement gate (2026-10-14; prepared, NOT applied or deployed)

**Rule (founder decision D2, 2026-10-14):** recall alerts stop when a
subscription ends. The server gates alerts on the same RevenueCat `premium`
entitlement, under the same purchase id, that unlocks the app
(`src/lib/purchases/revenuecat-adapter.ts`). Migration
`20261018000000_push_entitlement.sql` is prepared, not applied.

**How it works.**

1. **Registration.** Every alert registration (plain or keyed) also sends
   the purchase id (`p_purchase_id`), from the provider's memoized resolver
   (`purchaseIdentity`). That's the keychain UUID that reset never rotates.
2. **Refresh (`src/server/push/entitlement-refresh.ts`).** It is the first step
   of every **activated** push run, before any matching. It checks each
   enabled row that carries a purchase id and is due: never checked, checked
   at least `REFRESH_INTERVAL` (1 h) ago, or expiring within the next hour.
   - **The call:** RevenueCat REST API v2,
     `GET /v2/projects/{project}/customers/{purchase id}/active_entitlements`.
   - **Never triggered by a recall match.** A match-triggered check would let
     RevenueCat infer when a customer's alerts matched (health-adjacent for
     allergens). RevenueCat learns only that alerts are on.
   - **Budget:** at most 400 checks per run (RevenueCat allows 480/min for
     customer information). Rows beyond the budget wait for the next run, and
     a 429 ends the run's checking at once.
   - **Before `push:activate`:** nothing is checked. The purchase id is stored
     but unused.
3. **Gate (`src/server/push/entitlement.ts`).** It is applied in the
   eligibility seam, in the send pool and again at the send. A delivery needs
   all four:

   | Gate           | Rule                                                                                                     | On failure                                                                                          |
   | -------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
   | Status         | `entitlement_status = 'active'` (RevenueCat counts billing grace as active)                              | not entitled                                                                                        |
   | **Clock**      | `entitlement_expires_at > now()`. A null expiry (a non-expiring grant) is refused, as the app refuses it | not entitled: the known expiry stops alerts at that instant, with no refresh, however old the check |
   | **Staleness**  | last successful check within `MAX_STALENESS` (3 h)                                                       | **held**: unverified, retried next run (fail closed)                                                |
   | **No backlog** | event created at or after `entitled_since`                                                               | not entitled                                                                                        |

   `entitled_since` moves to the check time whenever a check finds the
   subscription active and the stored state was not continuously entitled
   (unknown, inactive, or past its known expiry). A renewal seen before
   expiry keeps it.

4. **Outcomes.** A definitive failure is never sent later:
   - at matching, no row is created;
   - for a queued row, `permanent_failure` with `not_entitled`.

   A held row stays queued.

**Maximum delays.** Run gaps were measured from GitHub's API, 2026-10-06 to
14: median 45.0 min, maximum 52.4 min.

| Change in RevenueCat                                                                              | The server acts within                                                                                                  |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Expiry                                                                                            | 0: the clock gate                                                                                                       |
| Refund; subscription moved to another purchase id (restore elsewhere); promotional access removed | the next due check: about 1 h 53 min at the worst measured gap, **never more than 3 h** (the staleness gate)            |
| Renewal                                                                                           | seen hourly, and every run in the last hour before expiry. One seen only after the old expiry restarts `entitled_since` |
| Re-subscribe after a lapse                                                                        | the next due check. Recalls announced before that check are not sent                                                    |
| A new registration, including after a reset                                                       | its first check, at most one run. Recalls announced before that check are not sent                                      |
| RevenueCat unreachable                                                                            | alerts held once the status is 3 h old. The run is `partial` with a payload-free reason                                 |

**Outside Lotly's control:**

- RevenueCat learns of refunds from Apple, so it lags Apple; the app sees the
  same lag.
- During an outage, the app honours a cached entitlement for up to 3 days
  past expiry (`CACHED_ACCESS_GRACE_MS`). The server is stricter.

**Stored fields** (all on `push_subscriptions`; no other table):
`purchase_id`, `entitlement_status` (unknown | active | inactive),
`entitlement_expires_at`, `entitlement_checked_at`, `entitled_since`. No
product, price, transaction id or other RevenueCat data.

**Redaction.**

- The purchase id is **bearer-sensitive**: it unlocks the entitlement in
  RevenueCat's SDK. So no RPC returns it, raised errors are fixed strings,
  and the worker reads it only through `listEntitlementRefreshRows`, never on
  `PushSubscription`.
- No log line, metric, delivery row or error carries it. That is pinned in
  `entitlement-gate.test.ts`.
- The export shows `purchase_id_last4` only.
- **Before activation:** after one sandbox registration, search Supabase
  `postgres_logs` for that purchase id and record the result. Gateway logs
  carry no request body, but database logs can carry statement text.

**Retention.** One trigger (`push_subscription_entitlement_guard`) clears the
purchase id and every entitlement field when a row is disabled for **any**
reason, and resets the entitlement when the purchase id changes. Reset,
privacy deletion and the 12-month purge delete the row. No purchase-id to
old-installation mapping survives a reset. After a reset the same purchase id
returns with the new registration, which is disclosed in the privacy text.

**Reset continuity.** The purchase id survives "Reset app and delete my
data". Re-enabling alerts registers it again, and the first check finds the
same entitlement.

**Deployment order (each step its own approval):**

1. Apply `20261018000000`. It's backward compatible: older builds register
   without an id and are held.
2. Distribute any build that sends `p_purchase_id` only **after** step 1.
   Without the migration, PostgREST finds no matching function and turning
   alerts on fails.
3. Before `push:activate`:
   - create the RevenueCat v2 secret key (`customer_information:customers:read`
     only);
   - set `REVENUECAT_SECRET_KEY`, `REVENUECAT_PROJECT_ID` and
     `REVENUECAT_PREMIUM_ENTITLEMENT_ID` in the GitHub `production`
     environment;
   - run the `postgres_logs` check.

   Unset settings hold every alert.

**Metrics** (job run):

- `entitlementSource` (`revenuecat` | `unconfigured`);
- `entitlementRowsDue`, `entitlementChecks`, `entitlementActive`,
  `entitlementInactive`;
- `entitlementCheckFailures`, `entitlementDeferred`, `entitlementNotLanded`;
- `entitlementSkipped`, `entitlementUnverified`;
- `queuedEntitlementHeld`, `queuedNotEntitled`.

**Tests:**

- `entitlement.test.ts` (rules);
- `revenuecat-entitlement.test.ts` (request, reading, payload-free failures);
- `entitlement-gate.test.ts` (end to end);
- `push-entitlement-migration.test.ts` (SQL text);
- `push-api-purchase-id.test.ts` (client bodies).

**Not yet run:** a live run of the migration on an isolated stack.

## Secrets and privacy

Server env (GitHub `production` environment secrets, declared per step):
`SUPABASE_URL`, `SUPABASE_SECRET_KEY`; on the `jobs:push` steps only, the
entitlement gate's `REVENUECAT_SECRET_KEY`, `REVENUECAT_PROJECT_ID` and
`REVENUECAT_PREMIUM_ENTITLEMENT_ID`; and optionally `EXPO_ACCESS_TOKEN` (only if enhanced push security is enabled on
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
   `npm run push:test -- --subscription <id>` → the labelled Lotly test
   notification appears (tapping it opens nothing) →
   `npm run push:test -- --subscription <id> --recall <active case id>` → a
   notification titled `Test: Recall alert: …` with the real formatter copy
   for that case; tapping it opens that recall, from the foreground, the
   background and a cold launch. The message is built by
   `src/server/push/test-message.ts` (pure, tested: one explicit
   subscription, active canonical cases only, no ledger event or delivery
   row, no notification event id, token never printed); `--dry-run` prints it
   and sends nothing.
5. `npm run jobs:push -- --dry-run` — confirm 0 would-send and the full
   pre-activation backlog excluded.
6. `npm run push:activate` (review) → `npm run push:activate -- --confirm`.
7. Watch the next scheduled tick, then `npm run ops:health`.
