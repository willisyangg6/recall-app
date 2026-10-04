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
- Silent upkeep: on launch and on Expo token rotation the app first sends
  any disable it still owes the server (see "Write ordering" above), then
  re-registers (idempotent, sequenced) — only if a registration is confirmed
  here and nothing is owed.

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
