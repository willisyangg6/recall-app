-- P1C: community shopper reports — data foundation (additive, feature OFF).
--
-- Structured shopper corroboration for an active recall: "I found this
-- product in <state> [at <retailer>], bought <time bucket>". It is NOT
-- official recall evidence and never touches the official domain: nothing
-- here reads from or writes to notification_events, push tables, preferences,
-- source records/snapshots, or ingest state, and nothing modifies
-- recall_cases — the case projection is READ (only) to validate submissions
-- against the official geography and retailer evidence.
--
-- Ownership model (same bearer capability as C2/C3/C7.1): rows are keyed by
-- the opaque random installation id the client generated with
-- Crypto.randomUUID() and stores in its keychain. That id appears in no
-- publicly readable table, view, or response, so possession proves
-- ownership; guessing another installation's id means guessing a random
-- UUID. Honest limit: this is NOT Sybil-proof — one person can mint many
-- installations (reinstalls, devices, scripted REST calls with fresh ids)
-- and submit one report from each. No device attestation or account system
-- exists to prevent that; the visibility threshold raises the floor of the
-- effort, it does not stop a determined actor. The founder accepted this
-- residual risk for the initial MVP (2026-09-10): its impact is bounded —
-- inflation can only move a count, never introduce an unofficial state,
-- retailer, classification, or notification — and the kill switch below
-- contains it immediately. Hardening (attestation, rate limiting,
-- accounts) is a future option if abuse appears or usage materially
-- scales (docs/recall-shopper-reports.md).
--
-- Data minimization is enforced by shape: the table can hold ONLY a case
-- reference, one validated jurisdiction, one exact canonical retailer name
-- (or null), one purchase-time bucket from a closed enum, the owning
-- installation id, and edit-safety metadata. There is no free-text column,
-- no health/symptom field, no location beyond the state, and no contact
-- field — a questionnaire cannot collect what the schema cannot store.
--
-- Security model mirrors installation_preferences: RLS enabled with NO
-- policies and no anon/authenticated grants — raw rows are unreachable with
-- the publishable key, in any direction. The only public surface is the four
-- SECURITY DEFINER RPCs below, each of which validates every
-- client-controlled value server-side and returns only the caller's own row
-- or a thresholded aggregate. Aggregates are one-way: no shopper-report
-- value joins into recall_cases, affected_products, consumer_feed_manifest,
-- or any notification/personalization path.

-- ── Feature gate (disabled by default) ───────────────────────────────────────
-- Same single-row shape as push_delivery_config. While reports_enabled is
-- false, submissions are refused and the public summary reports 'unavailable'
-- for every case. Reading one's OWN report, withdrawing it, and installation
-- data deletion keep working regardless — a kill switch may stop new
-- collection and public display, but it must never lock a person out of
-- their own data. Enabling is a founder action (an explicit service-role
-- UPDATE), never something this migration or a deploy does implicitly.

create table public.shopper_report_config (
  -- Boolean primary key with a CHECK forces at most one row.
  id boolean primary key default true check (id),
  reports_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.shopper_report_config enable row level security;
grant select, update on public.shopper_report_config to service_role;

insert into public.shopper_report_config (id, reports_enabled) values (true, false);

-- ── Shopper reports ──────────────────────────────────────────────────────────

create table public.shopper_reports (
  id uuid primary key default gen_random_uuid(),
  -- A merged/deleted case takes its reports with it; reports never outlive
  -- the case they corroborate.
  recall_case_id uuid not null references public.recall_cases (id) on delete cascade,
  -- The owning installation's bearer id (see header). Same closed shape the
  -- other installation RPCs enforce; the CHECK is defense in depth behind
  -- the RPC validation.
  installation_id text not null check (installation_id ~ '^[A-Za-z0-9-]{16,64}$'),
  -- Two-letter jurisdiction code (50 states + DC + PR), validated in the RPC
  -- against the case's own official geography — never trusted from the
  -- client. Stored as the postal code, matching installation_preferences.
  state_code text not null check (state_code ~ '^[A-Z]{2}$'),
  -- Exact canonical retailer name from the case's projection.retailerNames,
  -- or null when the shopper answered "Not sure" (or the case names no
  -- retailer). Never free text: the RPC requires exact membership.
  retailer_name text check (retailer_name is null or char_length(retailer_name) between 1 and 120),
  -- Closed purchase-time vocabulary. Must match PURCHASE_WINDOWS in
  -- src/domain/shopper-report.ts (pinned by test).
  purchase_window text not null check (
    purchase_window in ('past_week', 'past_month', 'past_three_months', 'longer_ago', 'not_sure')
  ),
  -- Edit-safety metadata: bumped only when a re-submission actually changes
  -- a value (an identical retry changes nothing, including updated_at).
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Retention (founder decision, 2026-09-10): a report lives exactly 12
  -- months past its most recent MEANINGFUL accepted write. The RPC sets it
  -- on insert and resets it on a value-changing update; an identical retry
  -- extends nothing. Boundary: `expires_at <= now()` IS expired — an
  -- expired row never counts, never returns from get_my_shopper_report,
  -- and never blocks a fresh submission; the scheduled cleanup below then
  -- deletes it physically. Calendar-interval semantics, evaluated in UTC.
  expires_at timestamptz not null default (now() + interval '12 months'),
  -- One installation, one current report per case — the aggregation
  -- invariant AND the concurrency guard (the upsert below serializes on it).
  unique (installation_id, recall_case_id)
);

-- Aggregation path: the live-report count filters by case AND expiry, so
-- the case index carries expires_at. Ownership lookup and per-installation
-- deletion use the unique (installation_id, recall_case_id) index; the
-- scheduled physical cleanup scans by expiry alone.
create index shopper_reports_case_idx on public.shopper_reports (recall_case_id, expires_at);
create index shopper_reports_expiry_idx on public.shopper_reports (expires_at);

alter table public.shopper_reports enable row level security;
-- No policies, no anon/authenticated grants: raw rows are reachable only via
-- the RPCs below and the service role.
grant select, insert, update, delete on public.shopper_reports to service_role;

-- ── Shared validation: case eligibility + jurisdiction resolution ────────────
--
-- Reports are accepted, and summaries exposed, only while the case is an
-- ACTIVE, non-merged recall or public health alert with usable official
-- geography:
--   scope 'nationwide'  -> any of the 52 supported jurisdictions qualifies;
--   scope 'states'      -> the selection must be one of the official states;
--   scope 'unknown'     -> reporting unavailable (nothing to corroborate
--                          against), as is an empty official state list.
-- Closed and retracted cases refuse submissions and expose no summary;
-- existing rows remain, private, under the retention contract.
--
-- The jurisdiction mapping is the SQL mirror of POSTAL_TO_STATE in
-- src/domain/us-geography.ts (projection geography stores FULL state names;
-- reports store postal codes). Parity is pinned by
-- src/server/shopper-reports/shopper-reports-migration.test.ts.

create or replace function public.shopper_report_state_name(p_state_code text)
returns text
language sql
immutable
as $$
  select '{
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut",
    "DE": "Delaware", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii",
    "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
    "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine",
    "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan",
    "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri",
    "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire",
    "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio",
    "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania",
    "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
    "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont",
    "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming", "DC": "District of Columbia",
    "PR": "Puerto Rico"
  }'::jsonb ->> p_state_code
$$;

revoke execute on function public.shopper_report_state_name(text) from public;
grant execute on function public.shopper_report_state_name(text) to service_role;

-- ── RPC: submit or update my report ──────────────────────────────────────────
--
-- Upsert keyed by (installation_id, recall_case_id): a first submission
-- inserts; a re-submission with changed values updates in place (version + 1);
-- a re-submission with identical values changes NOTHING — not even
-- updated_at — so a client retry can never look like an edit. The count of
-- rows (what the public summary aggregates) moves only on first insert and
-- on withdrawal, never on update, by construction. Concurrent duplicate
-- submissions serialize on the unique constraint: exactly one row survives.
--
-- Every error here is a function of PUBLIC case data and the caller's own
-- inputs; no error or timing branch depends on other installations' rows, so
-- failure reveals nothing about whether anyone else has reported.

create or replace function public.submit_shopper_report(
  p_installation_id text,
  p_case_id uuid,
  p_state_code text,
  p_retailer_name text,
  p_purchase_window text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case public.recall_cases%rowtype;
  v_scope text;
  v_state_name text;
  v_row public.shopper_reports%rowtype;
begin
  -- Shape validation: this endpoint is reachable with the publishable key.
  if p_installation_id is null
     or p_installation_id !~ '^[A-Za-z0-9-]{16,64}$' then
    raise exception 'invalid installation id';
  end if;
  if p_case_id is null then
    raise exception 'invalid case id';
  end if;
  if p_purchase_window is null or p_purchase_window not in
     ('past_week', 'past_month', 'past_three_months', 'longer_ago', 'not_sure') then
    raise exception 'invalid purchase window';
  end if;
  if p_retailer_name is not null
     and (char_length(p_retailer_name) < 1 or char_length(p_retailer_name) > 120) then
    raise exception 'invalid retailer';
  end if;

  -- Kill switch: no new collection while the feature is disabled.
  if not exists (select 1 from public.shopper_report_config where reports_enabled) then
    raise exception 'shopper reports are not available';
  end if;

  -- Case eligibility (active, non-merged, usable geography). One message for
  -- every ineligibility so a probe learns nothing beyond what the public
  -- feed already shows.
  select * into v_case from public.recall_cases where id = p_case_id;
  if not found or v_case.merged_into is not null or v_case.state <> 'active' then
    raise exception 'reporting is not available for this recall';
  end if;

  v_scope := v_case.projection -> 'geography' ->> 'scope';
  v_state_name := public.shopper_report_state_name(p_state_code);
  if v_state_name is null then
    raise exception 'invalid state code';
  end if;
  if v_scope = 'nationwide' then
    null; -- any supported jurisdiction qualifies.
  elsif v_scope = 'states' then
    if jsonb_array_length(coalesce(v_case.projection -> 'geography' -> 'states', '[]'::jsonb)) = 0
       or not (v_case.projection -> 'geography' -> 'states' ? v_state_name) then
      raise exception 'invalid state for this recall';
    end if;
  else
    -- 'unknown' or malformed: nothing official to corroborate against.
    raise exception 'reporting is not available for this recall';
  end if;

  -- Retailer: exact membership in the CURRENT canonical evidence, or null.
  -- A case with no safe retailer identities requires null (any non-null
  -- value fails membership). Projections persisted before retailerNames
  -- existed lack the key; coalesce treats that as "no choices".
  if p_retailer_name is not null
     and not (coalesce(v_case.projection -> 'retailerNames', '[]'::jsonb) ? p_retailer_name) then
    raise exception 'invalid retailer for this recall';
  end if;

  -- Retention: a row past its 12-month expiry is dead metadata, not a
  -- report. A new valid submission must start FRESH — fresh created_at,
  -- version 1 — so the caller's own expired row (if any) is physically
  -- removed first, which routes the upsert below to its insert path. This
  -- deletes only the presented credential's own row, and only when expired.
  delete from public.shopper_reports
   where installation_id = p_installation_id
     and recall_case_id = p_case_id
     and expires_at <= now();

  insert into public.shopper_reports as sr
    (recall_case_id, installation_id, state_code, retailer_name, purchase_window, expires_at)
  values
    (p_case_id, p_installation_id, p_state_code, p_retailer_name, p_purchase_window,
     now() + interval '12 months')
  on conflict (installation_id, recall_case_id) do update
    set state_code = excluded.state_code,
        retailer_name = excluded.retailer_name,
        purchase_window = excluded.purchase_window,
        version = sr.version + 1,
        updated_at = now(),
        -- A meaningful edit restarts the retention clock; the WHERE below
        -- means an identical retry restarts nothing.
        expires_at = now() + interval '12 months'
    where sr.state_code is distinct from excluded.state_code
       or sr.retailer_name is distinct from excluded.retailer_name
       or sr.purchase_window is distinct from excluded.purchase_window
  returning * into v_row;

  if v_row.id is null then
    -- Identical re-submission: the conditional upsert touched nothing.
    -- Return the standing row unchanged.
    select * into v_row from public.shopper_reports
     where installation_id = p_installation_id and recall_case_id = p_case_id;
  end if;

  return jsonb_build_object(
    'stateCode', v_row.state_code,
    'retailerName', v_row.retailer_name,
    'purchaseWindow', v_row.purchase_window,
    'version', v_row.version,
    'createdAt', to_char(v_row.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(v_row.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
end;
$$;

revoke execute on function public.submit_shopper_report(text, uuid, text, text, text) from public;
grant execute on function public.submit_shopper_report(text, uuid, text, text, text)
  to anon, authenticated, service_role;

-- ── RPC: get my report ───────────────────────────────────────────────────────
--
-- The caller's own current report for a case, for pre-filling an edit — or
-- SQL null when none exists. Only rows keyed by the presented bearer id are
-- reachable; there is no parameter that could name another installation.
-- Works regardless of the kill switch and case state: reading your own data
-- is never gated. An EXPIRED row (expires_at <= now()) is null here too —
-- the read, the public count, and the fresh-submission path all apply the
-- same boundary, so a row can never be "expired for the aggregate" yet
-- still visible to its owner.

create or replace function public.get_my_shopper_report(
  p_installation_id text,
  p_case_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.shopper_reports%rowtype;
begin
  if p_installation_id is null
     or p_installation_id !~ '^[A-Za-z0-9-]{16,64}$' then
    raise exception 'invalid installation id';
  end if;
  if p_case_id is null then
    raise exception 'invalid case id';
  end if;

  select * into v_row from public.shopper_reports
   where installation_id = p_installation_id
     and recall_case_id = p_case_id
     and expires_at > now();
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'stateCode', v_row.state_code,
    'retailerName', v_row.retailer_name,
    'purchaseWindow', v_row.purchase_window,
    'version', v_row.version,
    'createdAt', to_char(v_row.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(v_row.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
end;
$$;

revoke execute on function public.get_my_shopper_report(text, uuid) from public;
grant execute on function public.get_my_shopper_report(text, uuid)
  to anon, authenticated, service_role;

-- ── RPC: withdraw my report ──────────────────────────────────────────────────
--
-- Physical deletion of the caller's own row; the aggregate reflects it
-- immediately (the summary counts live rows — there is no cached total and
-- no analytics copy). Idempotent, returns void, reveals nothing about
-- whether a row existed (no enumeration oracle). Deliberately NOT gated by
-- the kill switch or case state: withdrawing your own data always works.

create or replace function public.withdraw_shopper_report(
  p_installation_id text,
  p_case_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_installation_id is null
     or p_installation_id !~ '^[A-Za-z0-9-]{16,64}$' then
    raise exception 'invalid installation id';
  end if;
  if p_case_id is null then
    raise exception 'invalid case id';
  end if;

  delete from public.shopper_reports
   where installation_id = p_installation_id and recall_case_id = p_case_id;
end;
$$;

revoke execute on function public.withdraw_shopper_report(text, uuid) from public;
grant execute on function public.withdraw_shopper_report(text, uuid)
  to anon, authenticated, service_role;

-- ── RPC: public thresholded summary ──────────────────────────────────────────
--
-- The ONLY public read over shopper reports, and it returns a single number
-- at most. Contract (docs/recall-shopper-reports.md):
--
--   {"status": "unavailable"}      feature disabled, case unknown/merged/
--                                  closed/retracted, or unusable geography —
--                                  all facts already visible in the public
--                                  feed;
--   {"status": "below_threshold"}  eligible case with 0, 1, or 2 qualifying
--                                  reports. ONE literal for all three: the
--                                  same code path runs one COUNT and emits
--                                  the same bytes, so no field, error, or
--                                  application-controlled timing branch
--                                  distinguishes 0 from 1 from 2;
--   {"status": "reported",
--    "count": N}                   3 or more — the REAL exact total, never
--                                  padded, rounded, or estimated.
--
-- Updates never change the count (one row per installation); a withdrawal
-- that drops the total from 3 to 2 makes the very next call say
-- below_threshold again. No state or retailer breakdown exists in v1.

create or replace function public.get_shopper_report_summary(
  p_case_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_case public.recall_cases%rowtype;
  v_scope text;
  v_count bigint;
begin
  if p_case_id is null then
    raise exception 'invalid case id';
  end if;

  if not exists (select 1 from public.shopper_report_config where reports_enabled) then
    return jsonb_build_object('status', 'unavailable');
  end if;

  select * into v_case from public.recall_cases where id = p_case_id;
  if not found or v_case.merged_into is not null or v_case.state <> 'active' then
    return jsonb_build_object('status', 'unavailable');
  end if;
  v_scope := v_case.projection -> 'geography' ->> 'scope';
  if v_scope <> 'nationwide' and not (
    v_scope = 'states'
    and jsonb_array_length(coalesce(v_case.projection -> 'geography' -> 'states', '[]'::jsonb)) > 0
  ) then
    return jsonb_build_object('status', 'unavailable');
  end if;

  -- Live rows only: an expired report stops counting the instant its
  -- expires_at passes, whether or not the physical cleanup has run yet.
  select count(*) into v_count from public.shopper_reports
   where recall_case_id = p_case_id
     and expires_at > now();

  if v_count < 3 then
    return jsonb_build_object('status', 'below_threshold');
  end if;
  return jsonb_build_object('status', 'reported', 'count', v_count);
end;
$$;

revoke execute on function public.get_shopper_report_summary(uuid) from public;
grant execute on function public.get_shopper_report_summary(uuid)
  to anon, authenticated, service_role;

-- ── Scheduled physical cleanup of expired reports ────────────────────────────
--
-- Query-time exclusion (above) makes an expired row invisible the instant
-- expires_at passes; this job then makes the deletion PHYSICAL. One
-- narrowly scoped function — the only statement it can run is the one
-- delete, and only over rows already past their expiry — plus one daily
-- pg_cron job. pg_cron is created earlier in this same migration chain
-- (20260901 scheduler_watchdog) and is verified live in production, so no
-- new external configuration is needed. Maximum delay between logical
-- expiration and physical deletion: one cadence — just under 24 hours for
-- a row that expires moments after a run (invisible the whole time).
--
-- Not granted to anon/authenticated: expiry is not a client operation.
-- service_role may invoke it manually (ops verification, or catch-up after
-- an incident); the schedule itself runs it as the job owner.
--
-- Rollback is one statement, preserving all rows:
--   select cron.unschedule('recall-shopper-report-expiry');

create or replace function public.cleanup_expired_shopper_reports()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.shopper_reports
   where expires_at <= now();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.cleanup_expired_shopper_reports() from public;
grant execute on function public.cleanup_expired_shopper_reports() to service_role;

-- Same idempotent pattern as the watchdog cron registration: re-running
-- this migration (or a local db reset) replaces the job instead of
-- duplicating it. The name is unique among this project's jobs.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'recall-shopper-report-expiry') then
    perform cron.unschedule('recall-shopper-report-expiry');
  end if;
end $$;

select cron.schedule(
  'recall-shopper-report-expiry',
  '45 8 * * *',
  $CRON$ select public.cleanup_expired_shopper_reports(); $CRON$
);

-- ── Installation data deletion now covers shopper reports ────────────────────
--
-- Replaces the C7.1 function body verbatim plus ONE added statement: the
-- installation's shopper reports are deleted in the same atomic transaction
-- as its preference mirror, push registrations, and delivery records. Every
-- documented C7.1 property is preserved unchanged — idempotent, no
-- enumeration oracle, FOR UPDATE serialization against the delivery worker,
-- FK-safe order, and no statement touching any shared table.

create or replace function public.delete_installation_data(
  p_installation_id text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Shape validation: this endpoint is reachable with the publishable key.
  -- Same closed shape the other installation RPCs enforce.
  if p_installation_id is null
     or p_installation_id !~ '^[A-Za-z0-9-]{16,64}$' then
    raise exception 'invalid installation id';
  end if;

  -- Serialize against a concurrent worker delivery insert (see the C7.1
  -- migration header).
  perform 1 from public.push_subscriptions
    where installation_id = p_installation_id
    for update;

  delete from public.notification_deliveries
   where subscription_id in (
     select id from public.push_subscriptions
      where installation_id = p_installation_id
   );

  delete from public.push_subscriptions
   where installation_id = p_installation_id;

  delete from public.installation_preferences
   where installation_id = p_installation_id;

  delete from public.shopper_reports
   where installation_id = p_installation_id;
end;
$$;

revoke execute on function public.delete_installation_data(text) from public;
grant execute on function public.delete_installation_data(text)
  to anon, authenticated, service_role;
