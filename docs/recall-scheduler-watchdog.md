# Scheduler watchdog (O1)

_Written 2026-08-28. Code, migration, and tooling are complete and tested;
**nothing is deployed, applied, scheduled, or credentialed** until the founder
runs the activation sequence below. Until then every surface reports an
explicit pre-activation state._

## Why GitHub's native schedule is not enough

Measured on this repository (workflow starts recorded as `ingest_runs`
attempts — every start leaves a row, so absence of rows is absence of runs):

| window                          | cron       | expected | delivered | median gap | worst gap |
| ------------------------------- | ---------- | -------- | --------- | ---------- | --------- |
| 2026-08-26 04:55 → 08-27 14:34Z | `*/30`     | 67       | 16 (24%)  | 64 min     | 664 min   |
| 2026-08-27 20:00 → 08-28 18:15Z | `7,37 * *` | 44       | ≤ 4 (9%)  | 386 min    | 694 min   |

The `:07/:37` offset — the cheap fix recommended before adding
infrastructure — **did not work**: delivery got worse, none of the four
post-offset starts landed on a scheduled minute (some are the founder's
manual recoveries, so true scheduled delivery is even lower), and
`ops:health` attributed every gap to **scheduler silence**, never lease
contention or source/job failure. Manual `workflow_dispatch` runs succeed and
reconcile completely every time. That satisfies the bar recorded in
docs/recall-operations.md for adopting external scheduling.

## Architecture

```
Supabase Cron (pg_cron, */5) ── net.http_post + Vault-held secret
        ↓
Edge Function supabase/functions/ingest-watchdog   (verify_jwt off;
        ↓                                           shared-secret auth in-function)
watchdog_tick()  — ONE atomic Postgres decision:
        heartbeat + freshness + running-check + cooldown + dispatch claim
        ↓ (only on dispatch_claimed)
GitHub REST: POST /repos/willisyangg6/recall-app/actions/workflows/
             scheduled-ingest.yml/dispatches   {ref: master}
        ↓
The EXISTING workflow → existing job runner → existing job_leases →
existing ingest_runs bookkeeping → existing ops:health
```

Ingestion logic is not duplicated anywhere: the watchdog only decides _when_
to press the same `workflow_dispatch` button a human presses. The native
GitHub `schedule` stays enabled as a free best-effort extra tick during the
observation period (below).

Alternatives considered and rejected against repository evidence:

- **More GitHub cron offsets / duplicate schedules** — already tried once
  (`:07/:37`) with delivery _worse_ than baseline; every extra entry is the
  same best-effort delivery with the same silent-drop failure mode, and
  ops:health proved the drops are GitHub-side. More of the same is not a fix.
- **Port ingestion into Edge Functions** — ruled out in C1 and still true:
  the pipelines need Node + native modules (`@napi-rs/canvas`, pdfjs WASM
  from `node_modules`); a Deno port forks the parser and violates the
  one-parser rule.
- **External commercial scheduler** (cron service hitting the dispatch API) —
  adds a third-party trust boundary holding a GitHub credential, a new
  billing surface, and no observability inside our database. Supabase is
  already trusted, already paid for, and the claim ledger lands next to the
  data it protects.
- **Supabase Cron calling GitHub directly (no Edge Function)** — pg_net
  cannot express the claim/finalize protocol (fire-and-forget HTTP, no
  response handling), so failures would be invisible and the GitHub token
  would sit in Vault subject to interpolation into cron command text. The
  function keeps the token in function secrets, handles every response
  class, and records the outcome.

## The reliability contract

Cadence target stays ~30 min. The watchdog runs every 5 min and dispatches
when **all** of:

1. FDA announcements **or** FSIS recalls/PHAs has no `succeeded`/`partial`
   run within 40 min (`stale_after_minutes`); push, labels, and enforcement
   freshness are deliberately excluded — they must never trigger ingest;
2. no outcome-less `ingest_runs` row younger than 25 min exists for those
   jobs (`running_grace_minutes` — an ingest is mid-flight);
3. no accepted dispatch within 20 min (`cooldown_minutes`), no unfinalized
   claim within 10 min (`claim_ttl_minutes` — an abandoned claim expires),
   and no failed dispatch within 10 min (`failure_backoff_minutes` — failures
   retry after a short backoff, automatically).

Bound under normal availability: staleness is detected at most ~45 min after
the last success (40 min threshold + one 5-min tick), and a dispatch failure
retries within ~10–15 min without founder involvement.

Every invocation returns and records exactly one decision:
`fresh` · `ingest_running` · `dispatch_cooldown` · `dispatch_claimed` ·
`configuration_error`.

### Atomicity

`watchdog_tick()` is one transaction that starts with
`pg_advisory_xact_lock(hashtext('recall_watchdog_dispatch'))`: concurrent
invocations serialize, the second sees the first's committed claim row and
reads `dispatch_cooldown`. The claim row is durable state — a function that
dies after claiming leaves a `claimed` row that blocks re-dispatch only for
`claim_ttl_minutes`. Finalize (`watchdog_finalize_dispatch`) only ever
touches a still-`claimed` row. The existing `job_leases` (untouched) remain
the final duplicate-execution rail: even a double workflow start queues on
the GitHub concurrency group and stands down on the lease. The known benign
race — native cron starting a workflow in the ~2 min before its first run row
appears while the watchdog dispatches — costs at most one queued, skipped,
~1-minute run.

## Schema and observability

Three server-only tables (RLS enabled, **no** policies, **no**
anon/authenticated grants — the app and the publishable key have no path to
them):

- `watchdog_config` — single row: enabled flag, target
  (repository/workflow/ref), the timing knobs above, retention, and
  `github_token_expires_at` (the token's expiry **date only**, so health can
  warn — never the token).
- `watchdog_dispatches` — one row per claim: status
  `claimed`/`accepted`/`failed`, GitHub HTTP status, the returned
  `workflow_run_id`, sanitized `error_class`, attempt count.
- `watchdog_invocations` — one row per invocation: decision, observed
  freshness, stale sources, probe flag, claim link.

No row ever contains the GitHub token, the shared secret, an authorization
header, or an upstream response body — failures are recorded as classes
(`github_unauthorized`, `github_not_found`, `github_rate_limited`,
`network_timeout`, …). Retention: every tick deletes history older than 30
days (`retention_days`) — deterministic, bounded, nothing else deleted.

### GitHub API contract (verified 2026-08-28, current docs)

`POST /repos/{owner}/{repo}/actions/workflows/{workflow}/dispatches` with
headers `Accept: application/vnd.github+json`,
`X-GitHub-Api-Version: 2026-03-10`, body `{"ref":"master"}`. Under the
current API version success is **200 with `{workflow_run_id, run_url,
html_url}`** (recorded on the claim row); older versions documented **204 No
Content**. The function treats any 2xx as accepted and reads the run id only
when a JSON body exists. Errors: 401 credential, 403 (rate-limit
distinguished via `x-ratelimit-remaining: 0`), 404 workflow/repo/token
scope, 422 ref validation, 5xx retried once. Timeout 10 s per request, max 2
attempts in-function; beyond that the failure backoff hands retry to a later
tick. Fine-grained PAT permission verified: repository **Actions: write**.

## Credentials

| credential               | lives in                                                              | scope                                                       |
| ------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------- |
| `GITHUB_ACTIONS_TOKEN`   | Edge Function secret ONLY                                             | fine-grained PAT, ONLY willisyangg6/recall-app, Actions: RW |
| `WATCHDOG_SHARED_SECRET` | Edge Function secret + Vault (cron side) + founder `.env` (probe CLI) | authenticates cron→function; high-entropy random            |

The function is deployed with `verify_jwt = false` (Supabase Cron cannot
send a user JWT — the officially documented pattern for scheduler-invoked
functions) and authenticates **every** request itself: the
`x-watchdog-secret` header is compared via SHA-256 digests (constant-time in
effect). The service-role key is never circulated for this — the function
uses only its platform-injected key internally for the two RPCs. Neither
credential can appear in tables, logs, responses, migrations, or the app
bundle; tests assert all of it.

## Ops surfaces

- `npm run ops:health` — new **Scheduler watchdog** section: status, last
  heartbeat, last decision, last accepted dispatch (with run id), last
  dispatch failure, consecutive failures, token expiration. Pre-activation
  prints `not installed` and never gates the exit code. Activated semantics:
  heartbeat ≤10 min healthy / >15 min UNHEALTHY (cron stopped); latest
  decision `configuration_error` UNHEALTHY; ≥2 consecutive dispatch failures
  UNHEALTHY (1 = degraded, retryable); accepted dispatch within the 20-min
  grace = healthy-with-note, never failed; token expiry ≤30 d warning,
  expired UNHEALTHY. Probe invocations are excluded from heartbeat
  freshness, so a manual probe can never mask a dead cron. The existing
  scheduler-silence vs lease-contention distinction is untouched.
- `npm run scheduler:status` — the same section plus recent
  invocation/dispatch history. Strictly read-only (test-enforced).
- `npm run scheduler:probe` — one authenticated round trip that validates
  reachability, auth, the claim logic (probe mode computes and records the
  decision but **never inserts a claim row**), and the GitHub credential +
  workflow existence via a **GET** (never a dispatch). With no local secret
  it still distinguishes "not deployed" (404) from "deployed, auth
  enforced" (401).
- `npm run scheduler:probe -- --dispatch` — the founder-only controlled
  dispatch (activation step 10): prints a loud warning, then asks the
  function for `force-dispatch`, which bypasses **only** the freshness check
  — atomic claim, running-ingest, and cooldown guards all still apply.

## Cost (monthly, current scale)

| item                      | volume                                                                                      | cost                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Edge Function invocations | ~8,640 (12/h)                                                                               | free tier (500K included)                                                |
| DB rows                   | ~8.6K invocations + ≤~1K dispatches, 30-day retention                                       | < 10 MB, negligible                                                      |
| GitHub dispatches         | ~0 while native delivers; ≤ ~1,000 if native dies completely (~40–45 min effective cadence) | free (API calls)                                                         |
| Actions minutes           | restores the INTENDED C1 cadence (~1,440 runs × ~1–2 min with the skip gate)                | the ~$0–8 already budgeted in C1; the watchdog adds no cadence beyond it |

## Activation (founder steps — exact order; no secret values anywhere)

Prereqs: Supabase CLI linked to the project (`supabase link`), dashboard SQL
editor access, GitHub account owning `willisyangg6/recall-app`.

0. _(Optional but recommended, needs Docker)_ `supabase db start` +
   `supabase db reset` — executes the migration end-to-end locally,
   including the plpgsql bodies and cron registration.
1. **GitHub token.** GitHub → Settings → Developer settings → Fine-grained
   personal access tokens → Generate: Resource owner `willisyangg6`;
   Repository access: **Only** `willisyangg6/recall-app`; Repository
   permissions: **Actions: Read and write** (Metadata: read is added
   automatically); expiration e.g. 90 days — note the date for step 7.
2. **Shared secret.** `openssl rand -hex 32` — keep it in your clipboard /
   password manager only.
3. **Function secrets** (history-safe — `read -s` keeps values out of shell
   history):

   ```bash
   read -s GH_TOKEN   # paste the PAT
   supabase secrets set GITHUB_ACTIONS_TOKEN="$GH_TOKEN"
   read -s WD_SECRET  # paste the shared secret
   supabase secrets set WATCHDOG_SHARED_SECRET="$WD_SECRET"
   unset GH_TOKEN WD_SECRET
   ```

4. **Deploy the function.** `supabase functions deploy ingest-watchdog`
   (config.toml already declares `verify_jwt = false` for it; pass
   `--no-verify-jwt` if your CLI version prompts).
5. **Vault secrets** (SQL editor; placeholders, not values):

   ```sql
   select vault.create_secret(
     'https://YOUR-PROJECT-REF.supabase.co/functions/v1/ingest-watchdog',
     'watchdog_function_url');
   select vault.create_secret('THE-SHARED-SECRET', 'watchdog_shared_secret');
   ```

6. **Apply the migration.** `supabase db push` (review first). This creates
   the tables/functions **and registers the `*/5` cron — the watchdog is
   live from here.** With ingestion healthy, every tick decides `fresh`.
7. **Record token expiry** (SQL editor):
   `update watchdog_config set github_token_expires_at = 'YYYY-MM-DD';`
8. Add `WATCHDOG_SHARED_SECRET=...` to the local `.env` (gitignored) for the
   probe CLI.
9. **Dry probe:** `npm run scheduler:probe` — expect auth accepted, a
   decision, `github: { ok: true }`, "Nothing was dispatched."
10. **Controlled dispatch:** `npm run scheduler:probe -- --dispatch` — one
    real run.
11. **Verify the run:** GitHub → Actions → scheduled-ingest shows a new
    `workflow_dispatch` run; after it finishes, `npm run ops:health` — fresh
    FDA/FSIS successes, `job_leases` released (no ACTIVE row), watchdog
    section healthy with the accepted dispatch + run id.
12. **Observe 24 h:** `npm run scheduler:status` shows 5-minute heartbeats,
    decisions mostly `fresh`, dispatches only where native ticks dropped.
13. **Then decide the native cron's future** (see below). Recommendation:
    keep it, reduced to hourly (`7 * * * *`) — a free second chance at a
    tick with the watchdog as the real cadence owner; do NOT remove
    `workflow_dispatch` ever (it is the watchdog's target).

## Rollback (fast, no code deletion, history preserved)

1. Stop invocations (SQL editor): `select cron.unschedule('recall-ingest-watchdog');`
   — or softer: `update watchdog_config set enabled = false;` (heartbeats
   continue, every decision becomes a no-dispatch `configuration_error`
   recorded as `watchdog_disabled`; health shows **disabled**, not
   UNHEALTHY).
2. Revoke the GitHub token (GitHub → Settings → Fine-grained tokens →
   Revoke). Optionally `supabase secrets unset GITHUB_ACTIONS_TOKEN WATCHDOG_SHARED_SECRET`.
3. Done. The native GitHub schedule and manual `workflow_dispatch` are
   untouched and keep working; all watchdog history stays in the tables for
   diagnosis; ingestion data, source records, RecallCases,
   NotificationEvents, and push configuration are unaffected (the watchdog
   never had a write path to any of them).

## Verification status (2026-08-28, pre-activation)

`npm run check` 862/862 · `npx prettier --check .` clean ·
`npm run scheduler:status` → "not installed", exit 0 ·
`npm run scheduler:probe` → live 404 = "not deployed", exit 0, nothing
dispatched · `npm run ops:health` → all jobs healthy, watchdog "not
installed", exit 0. Migration validated with the real PostgreSQL parser
(libpg-query: all 22 statements + the cron command); the plpgsql bodies are
review-validated — their first machine execution is step 0/6 above, and
Supabase migrations are transactional, so a failure rolls back cleanly.
Mutation proofs (each reverted byte-identically): advisory lock removed,
cooldown clause removed, secret validation removed, failure-recording
inverted, health distinction removed — a test failed for every one.
