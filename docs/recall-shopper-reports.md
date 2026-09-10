# Community shopper reports (P1C — data foundation, feature OFF)

_Authoritative home for the shopper-report domain: the product contract, the
schema and RPC surface, aggregation and privacy rules, the ownership/threat
model, retention and deletion, and launch preconditions. P1C built the
secure data foundation only; the questionnaire and all community copy on
Recall Detail are P1D and do not exist yet. The migration
(`supabase/migrations/20260910000000_shopper_reports.sql`) has **not** been
applied to production, and the feature gate ships **disabled**._

## 1. What a shopper report is — and is not

A shopper report is structured corroboration from one app installation about
one active recall: _"I found this product in **state** [at **retailer**],
bought **time bucket**."_ It exists so the future Detail experience can show
a thresholded community signal:

- Below threshold: `Did you find this product here? Add your report`
- At threshold: `12 shoppers reported finding it here · Add your report`

(P1C renders neither string; they are recorded here as the target contract.)

It is **not** official recall evidence, not a discovery feed, and not input
to anything official. Community data never modifies or influences official
geography, official retailer identities, illness counts, classification,
risk tier, case status, Affects Me, personalization, notification creation
or delivery, feed membership or ordering, search ranking, or
ingestion/reconciliation. The one-way rule is structural: no shopper-report
value joins into `recall_cases`, `affected_products`,
`consumer_feed_manifest`, or any notification/personalization path, and the
only public read over report data returns at most one number.

## 2. Data minimization — enforced by shape

A report can contain ONLY:

| field                                 | contract                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| case reference                        | FK to `recall_cases` (`on delete cascade`)                                            |
| `state_code`                          | one supported jurisdiction (50 states + DC + PR), validated against the case          |
| `retailer_name`                       | exact canonical name from the case's `projection.retailerNames`, or null              |
| `purchase_window`                     | closed enum: `past_week`, `past_month`, `past_three_months`, `longer_ago`, `not_sure` |
| `installation_id`                     | the owning installation's opaque bearer id                                            |
| `version`, `created_at`, `updated_at` | edit-safety metadata                                                                  |

There is no column — and no RPC parameter — for symptoms, illness, allergic
reaction, consumption, medical information, name, email, phone, account,
exact store address, coordinates, receipt, photo, lot-code transcription,
free text, or IP/device fingerprints stored by application code. No health
questionnaire exists. A future questionnaire cannot collect what the schema
cannot store; the closed column set is pinned by
`src/server/shopper-reports/shopper-reports-migration.test.ts`.

"Not sure" for the retailer is represented as **no retailer** (`null`),
never a stored string. A "No / Not sure" answer to _did you find it here_ is
not a report at all: nothing is stored and nothing is counted — the future
UI ends the flow gracefully client-side.

## 3. Eligibility: which cases can take reports

Validated **server-side from the current canonical projection** on every
submission — client choices are never trusted:

- The case must be an active (`state = 'active'`), non-merged
  (`merged_into is null`) recall or Public Health Alert.
- One-state / multi-state geography (`scope = 'states'`): the submitted
  jurisdiction must resolve (via the SQL mirror of `POSTAL_TO_STATE` — full
  parity pinned by test) to one of the official state names.
- Nationwide: any of the 52 supported jurisdictions.
- Unknown or unusable geography (scope `unknown`, or an empty official
  state list): submission refused, summary unavailable.
- Retailer: only when the case carries safe canonical retailer identities
  (`projection.retailerNames` — the verb-gated evidence seam; there is no
  second retailer parser). The value must be an **exact** member of the
  current list; the personalization catalog is deliberately not consulted,
  so a legitimate notice identity outside the catalog (e.g. Walgreens) is
  allowed. A case with no safe identities requires `null`. Edits validate
  against the case as it is **now**; historical stored input is never
  silently rewritten during a read.

Closed and retracted (v1, final): no new or updated submissions, no public
summary. Existing rows remain private under the retention contract (§7) and
never contribute to a visible count while the case is ineligible. Owners
can still read and withdraw their own report on an ineligible case —
eligibility gates collection and display, never a person's access to their
own data. Every case-ineligibility failure returns one identical error
(`reporting is not available for this recall`), so submission errors reveal
nothing beyond what the public feed already shows.

## 4. Ownership model and honest threat model

**Credential.** Rows are owned by the same bearer capability every
installation RPC uses (C2/C3/C7.1): the opaque `Crypto.randomUUID()` the
app generates once and keeps in SecureStore (keychain-grade). It appears in
no publicly readable table, view, or response; both new tables have RLS
enabled with **no policies** and no anon/authenticated grants, so raw rows
are unreachable with the publishable key in any direction. All public
interaction goes through five SECURITY DEFINER RPCs (§5) with pinned
`search_path = public`, schema-qualified references, PUBLIC execute
revoked, and minimal grants. Possession of the id is the proof of
ownership; "taking over" a report requires guessing its owner's random
122-bit UUID, and there is no parameter, listing, or error message through
which another installation's rows or existence can be observed.

**What this prevents:** one installation reading, editing, or withdrawing
another installation's report; duplicate rows per installation and case
(database unique constraint + atomic conditional upsert, proven under real
parallel PostgREST submissions); client-supplied states, retailers, or
buckets outside the validated sets; free text anywhere; public access to
raw rows or sub-threshold counts.

**What this does NOT prevent — stated plainly:** anonymous reporting here
is **not Sybil-proof**. The bearer-installation model protects one
installation's report from another installation; it does not prove that
one human has only one installation. A determined actor can mint many
installations (reinstalls, multiple devices, or scripted REST calls
fabricating fresh ids — the RPC surface is necessarily public) and submit
one report from each, inflating a public count past the threshold. The
visibility threshold (§6) raises the effort floor; it does not stop a
motivated adversary, and nothing here may be described as Sybil-proof,
abuse-proof, or verified-human reporting.

**Accepted MVP limitation (founder decision, 2026-09-10).** The founder
explicitly accepts this residual multi-installation risk for the initial
MVP, on these grounds:

- **Bounded impact.** Inflation can only move a count. A report cannot
  introduce an unofficial state, retailer, classification, illness figure,
  or notification behavior — server validation restricts every field to
  the case's own official evidence, and community data joins nothing
  official (§1).
- **Immediately containable.** The existing kill switch (§8) turns off
  collection and every public summary in one service-role update, with no
  deploy and no data loss.
- **Future hardening, not a present dependency.** Device attestation (App
  Attest / Play Integrity), edge rate limiting, or accounts remain
  available as hardening if abuse actually appears or usage materially
  scales. None was added now — no accounts, no attestation, no device
  fingerprinting, no IP storage, no invented quotas.

Accepting this risk does **not** mean the feature is enabled or
production-ready: the gate still ships off, and P1D, the privacy
disclosure, migration review/application, and explicit enablement all
remain outstanding ([recall-launch-blockers.md](recall-launch-blockers.md)).

## 5. RPC surface (the only public interaction)

| RPC                                                                          | contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `submit_shopper_report(installation, case, state, retailer, window) → jsonb` | Validates everything (§2–3), refuses while the gate is off, then upserts on `(installation_id, recall_case_id)`. First insert `version = 1` with `expires_at = now() + 12 months`; an edit updates in place with `version + 1` and restarts the retention clock; an **identical** re-submission changes nothing — not `updated_at`, not `expires_at` — so retries can never look like edits, move any count, or extend retention. A caller's own **expired** row is physically cleared first, so a valid post-expiration submission is a fresh report (fresh `created_at`, version 1), never a revival. Returns the stored report (`stateCode`, `retailerName`, `purchaseWindow`, `version`, `createdAt`, `updatedAt`). |
| `get_my_shopper_report(installation, case) → jsonb`                          | The caller's own **live** report or SQL `null` — an expired row is `null` here, exactly as it is absent from the public count. Never gated by the kill switch or case state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `withdraw_shopper_report(installation, case) → void`                         | Physical deletion of the caller's own row; idempotent; returns nothing (no existence oracle). Never gated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `get_shopper_report_summary(case) → jsonb`                                   | The only public read; see §6.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `delete_installation_data(installation) → void`                              | The C7.1 deletion RPC, replaced to also delete the installation's shopper reports in the same atomic transaction. All C7.1 properties preserved.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

The internal jurisdiction mapping (`shopper_report_state_name`) is not
public surface (no anon execute). Client-side, the P1D-ready foundation is:
`src/domain/shopper-report.ts` (types, closed purchase vocabulary,
threshold constant, pure eligibility/validation, response sanitizers),
`src/lib/report-api.ts` (RPC wrappers; every response passes through the
sanitizers, which degrade — never fabricate), and
`src/lib/shopper-report-store.ts` (mutations ride the shared installation
mutation queue so they serialize with preference saves, push writes, and
the C7.1 reset; reads never mint an installation id).

## 6. Aggregation and the privacy threshold

Only current rows count — and every row is qualifying by construction,
because validation happens at write time. Views, CTA taps, questionnaire
starts, failed submissions, withdrawn rows, and non-qualifying state
answers never create rows, so they can never count.

- 0, 1, or 2 reports → `{"status": "below_threshold"}` — one literal, one
  code path, byte-identical for all three (proven live), with no count
  field, no distinguishing error, and no application-controlled timing
  branch. The response cannot leak whether the true count is 0, 1, or 2.
- 3 or more → `{"status": "reported", "count": N}` — the real exact total,
  never padded, rounded, estimated, or implied.
- Feature disabled, case unknown/merged/closed/retracted, or unusable
  geography → `{"status": "unavailable"}` (all facts already public).
- Updates never increment; withdrawal reflects immediately; a fall from 3
  to 2 hides the count again.
- **Expired rows never count.** A report past its 12-month retention (§7)
  drops out of the aggregate the instant `expires_at` passes — before any
  physical cleanup runs — and threshold transitions caused purely by
  expiration behave exactly like withdrawals: 4 → 3 shows exactly 3,
  3 → 2 hides the count again. A case changing state can never make an
  expired row visible (case eligibility and row expiry are independent
  filters, both applied).
- No state or retailer breakdown is exposed in v1, and no raw row fields
  ever leave the database through this RPC.

The threshold constant lives in `src/domain/shopper-report.ts`
(`SHOPPER_REPORT_VISIBILITY_THRESHOLD = 3`); the SQL literal's parity is
pinned by test. The client sanitizer additionally refuses a malformed
"reported" echo below the threshold — the UI can under-show community
activity but can never fabricate or inflate it.

## 7. Retention and deletion

**Twelve-month retention (founder decision, 2026-09-10).** A shopper
report expires exactly 12 calendar months (UTC interval semantics) after
its most recent **meaningful** accepted submission or edit, carried as an
explicit `expires_at` column:

- New report: `created_at = updated_at = now`,
  `expires_at = now + interval '12 months'`.
- Meaningful edit (any value change): `version + 1`, `updated_at = now`,
  and the retention clock restarts — `expires_at = now + 12 months`.
- Identical idempotent retry: nothing moves — not the version, not
  `updated_at`, not `expires_at`. Retrying an unchanged submission never
  extends retention.
- **Boundary (precise):** a report with `expires_at <= now()` is expired —
  the inclusive comparison, applied identically by the public count, the
  owner read, and the fresh-submission path, so no state can exist where a
  row is expired for the aggregate yet still readable by its owner or able
  to block a new report.
- Expired rows never count, never return from `get_my_shopper_report`,
  cannot become visible through any case-state change, and never block a
  valid new submission — which behaves as a completely fresh report (fresh
  `created_at`, version 1; stale metadata is physically cleared, never
  revived).

**Physical cleanup.** Query-time exclusion makes an expired row invisible
immediately; a scheduled job then deletes it physically.
`cleanup_expired_shopper_reports()` (SECURITY DEFINER, pinned
`search_path`, **no** anon/authenticated execute — service_role may invoke
it manually) deletes only rows with `expires_at <= now()`, and a pg_cron
job (`recall-shopper-report-expiry`, daily at 08:45 UTC, registered with
the same idempotent unschedule-then-schedule pattern as the watchdog cron
so re-application never duplicates it) runs it. pg_cron is already created
by the 20260901 watchdog migration in this same chain and verified live in
production — no new external configuration. **Maximum delay between
logical expiration and physical deletion: one cadence, i.e. just under 24
hours** — during which the row is already invisible, unreadable, and
excluded from every count.

Immediate deletion paths, unchanged:

- **Withdrawal** (`withdraw_shopper_report`): physical deletion, removed
  from the aggregate immediately — expired or not. No tombstone, no
  soft-delete flag, no analytics copy — the summary counts live rows and
  nothing else, and no other copy of report content exists anywhere.
- **Installation data deletion** (C7.1 "Reset app and delete my data"):
  `delete_installation_data` removes all shopper reports owned by the
  installation — live and expired — in the same atomic transaction as its
  preference mirror, push registrations, and delivery records. No client
  change was needed; the app keeps no local shopper-report state.
- **Uninstall alone** is not deletion, exactly as the existing privacy
  documents already state; an abandoned installation's reports now age out
  under the 12-month rule regardless. (The separate C7-era gap — stale
  push-registration rows of never-reset installations — remains its own
  open item and is unaffected by this decision.)

## 8. Kill switch

`shopper_report_config` (single-row, same shape as `push_delivery_config`)
ships with `reports_enabled = false` — seeded false by the migration, never
enabled by a deploy. While disabled: submissions refuse and every public
summary reads `unavailable`; reading one's own report, withdrawing it, and
installation deletion keep working (a kill switch may stop collection and
display, never a person's access to their own data). Enabling is an
explicit founder action (service-role
`update shopper_report_config set reports_enabled = true`), reversible at
any time, and must not happen before the launch preconditions in §4/§7 are
settled.

## 9. Verification record (2026-09-10)

Deterministic suites: behavioral semantics against the RPC-mirroring memory
store (`src/server/shopper-reports/shopper-reports.test.ts`), textual
migration pins (`shopper-reports-migration.test.ts`), domain purity
(`src/domain/shopper-report.test.ts`), and client request/response pins
(`src/lib/report-api.test.ts`).

Live: a uniquely named disposable local Supabase stack
(`recall-p1c-disposable-6f2a`, Docker, local demo credentials only) applied
the full 12-migration chain including this migration, then passed a
78-check matrix over real PostgREST: direct anon table access refused in
all four verbs (config table and internal helper included); the complete
validation matrix; ownership isolation including guessed-id attempts;
byte-identical 0/1/2 hidden summaries and exact 3/4 totals; update/withdraw
semantics; 10-way parallel duplicate submissions settling to one row;
cross-table atomic deletion; public recall reads unchanged; zero writes to
any recall-domain or notification table; and the kill-switch scope in both
directions. The stack was torn down completely (0 containers, 0 volumes,
shared images preserved). Production was not touched.
