-- O1: Supabase-owned ingestion scheduler watchdog (additive only).
--
-- GitHub's native `schedule` has repeatedly failed to deliver the requested
-- cadence (measured 2026-08-26/28: 24% of ticks before the :07/:37 offset,
-- ~9% after it, worst gaps 10–11 h), while manual workflow_dispatch always
-- succeeds. This migration installs the database half of an independent
-- watchdog: Supabase Cron invokes an Edge Function every 5 minutes; the
-- function calls watchdog_tick() — a single atomic freshness/dispatch claim —
-- and only a claimed tick calls GitHub's workflow-dispatch API to start the
-- EXISTING scheduled-ingest.yml. Ingestion itself is untouched: the same
-- workflow, job runner, job_leases, and ingest_runs bookkeeping do the work.
--
-- Nothing here reads or writes recall_cases, notification_events, push
-- tables, or job_leases. All new tables are server-only (RLS enabled, no
-- policies, no anon/authenticated grants), hold no secrets, and are bounded
-- by deterministic retention. The GitHub token and the cron shared secret
-- live in Edge Function secrets / Vault — never in these tables or this file.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── 1. Watchdog configuration (single row, no secrets) ───────────────────────
--
-- github_token_expires_at stores ONLY the expiry date of the fine-grained
-- GitHub token so ops:health can warn before it lapses — never the token.

create table public.watchdog_config (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  repository text not null default 'willisyangg6/recall-app',
  workflow text not null default 'scheduled-ingest.yml',
  ref text not null default 'master',
  -- No FDA/FSIS success within this window ⇒ stale. Cadence is 30 min; 40
  -- allows one dropped native tick before the watchdog steps in.
  stale_after_minutes integer not null default 40,
  -- After an ACCEPTED dispatch, wait this long before dispatching again —
  -- covers GitHub queue delay + npm ci + the ingest steps.
  cooldown_minutes integer not null default 20,
  -- A claim never finalized (Edge Function died mid-flight) blocks re-dispatch
  -- only this long, then becomes retryable.
  claim_ttl_minutes integer not null default 10,
  -- A FAILED dispatch retries after this backoff (~2 watchdog ticks).
  failure_backoff_minutes integer not null default 10,
  -- An outcome-less ingest_runs row younger than this counts as "running"
  -- (matches the tick jobs' lease TTL, after which a crashed run is dead).
  running_grace_minutes integer not null default 25,
  retention_days integer not null default 30,
  github_token_expires_at timestamptz,
  installed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.watchdog_config enable row level security;
grant select, insert, update on public.watchdog_config to service_role;

insert into public.watchdog_config (id) values (true);

-- ── 2. Dispatch claims (the durable atomic-claim rows) ───────────────────────

create table public.watchdog_dispatches (
  id uuid primary key default gen_random_uuid(),
  claimed_at timestamptz not null default now(),
  status text not null default 'claimed' check (status in ('claimed', 'accepted', 'failed')),
  stale_sources text[] not null default '{}',
  repository text not null,
  workflow text not null,
  ref text not null,
  -- GitHub interaction result, recorded by watchdog_finalize_dispatch().
  attempt_count integer not null default 0,
  github_status integer,
  github_run_id bigint,
  -- Sanitized class only ('github_unauthorized', 'network_timeout', …) —
  -- never a response body, header, or credential.
  error_class text,
  finalized_at timestamptz
);

create index watchdog_dispatches_claimed_idx on public.watchdog_dispatches (claimed_at desc);

alter table public.watchdog_dispatches enable row level security;
grant select, insert, update, delete on public.watchdog_dispatches to service_role;

-- ── 3. Invocation heartbeats ─────────────────────────────────────────────────

create table public.watchdog_invocations (
  id uuid primary key default gen_random_uuid(),
  invoked_at timestamptz not null default now(),
  -- Founder-run probes record themselves but are excluded from heartbeat
  -- freshness, so a manual probe can never mask a dead cron.
  probe boolean not null default false,
  decision text not null check (
    decision in ('fresh', 'ingest_running', 'dispatch_cooldown', 'dispatch_claimed', 'configuration_error')
  ),
  stale_sources text[] not null default '{}',
  -- Observed source freshness (last-success timestamps) — counts and dates
  -- only, never logs or credentials.
  freshness jsonb,
  claim_id uuid references public.watchdog_dispatches (id) on delete set null,
  error_class text
);

create index watchdog_invocations_invoked_idx on public.watchdog_invocations (invoked_at desc);

alter table public.watchdog_invocations enable row level security;
grant select, insert, update, delete on public.watchdog_invocations to service_role;

-- ── 4. The atomic tick: heartbeat + freshness + dispatch claim ───────────────
--
-- One call, one transaction, one explainable decision. Concurrent invocations
-- serialize on a transaction-scoped advisory lock, so the second caller
-- blocks until the first commits and then sees its claim row — an Edge
-- Function read followed by an unguarded insert can never race. The claim row
-- is durable state: a claim not finalized within claim_ttl_minutes is
-- abandoned and re-dispatch becomes possible again.
--
-- p_probe:  compute and record the decision but never insert a claim row —
--           a probe must not put real ticks into cooldown.
-- p_force:  bypass ONLY the freshness check (the founder's controlled
--           dispatch verification); running/cooldown/claim atomicity all
--           still apply.
-- p_configuration_error: the Edge Function found its own configuration
--           broken (e.g. no GitHub token) — record the heartbeat with that
--           class and decide 'configuration_error' without claiming.

create or replace function public.watchdog_tick(
  p_probe boolean default false,
  p_force boolean default false,
  p_configuration_error text default null
) returns jsonb
language plpgsql
as $$
declare
  cfg public.watchdog_config%rowtype;
  v_now timestamptz := now();
  v_fda timestamptz;
  v_fsis timestamptz;
  v_stale text[] := '{}';
  v_freshness jsonb;
  v_decision text;
  v_claim_id uuid := null;
  v_error_class text := p_configuration_error;
begin
  perform pg_advisory_xact_lock(hashtext('recall_watchdog_dispatch'));

  select * into cfg from public.watchdog_config where id;
  if cfg.id is null or not cfg.enabled
     or coalesce(cfg.repository, '') = '' or coalesce(cfg.workflow, '') = ''
     or coalesce(cfg.ref, '') = ''
     or cfg.stale_after_minutes < 5 or cfg.cooldown_minutes < 5
     or cfg.claim_ttl_minutes < 1 or cfg.failure_backoff_minutes < 1 then
    v_decision := 'configuration_error';
    v_error_class := coalesce(
      v_error_class,
      case
        when cfg.id is null then 'missing_config'
        when not cfg.enabled then 'watchdog_disabled'
        else 'invalid_config'
      end
    );
  elsif v_error_class is not null then
    v_decision := 'configuration_error';
  end if;

  -- Freshness of the two required primary source jobs — and ONLY those two.
  -- Push, labels, and enforcement freshness never drive a dispatch.
  select max(started_at) into v_fda from public.ingest_runs
    where job_name = 'fda_announcements' and outcome in ('succeeded', 'partial');
  select max(started_at) into v_fsis from public.ingest_runs
    where job_name = 'fsis_ingest' and outcome in ('succeeded', 'partial');

  if cfg.id is not null then
    if v_fda is null or v_fda < v_now - make_interval(mins => cfg.stale_after_minutes) then
      v_stale := array_append(v_stale, 'fda_announcements');
    end if;
    if v_fsis is null or v_fsis < v_now - make_interval(mins => cfg.stale_after_minutes) then
      v_stale := array_append(v_stale, 'fsis_ingest');
    end if;
  end if;

  v_freshness := jsonb_build_object(
    'fdaLastSuccessAt', v_fda,
    'fsisLastSuccessAt', v_fsis,
    'staleAfterMinutes', cfg.stale_after_minutes,
    'forced', p_force
  );

  if v_decision is null then
    if array_length(v_stale, 1) is null and not p_force then
      v_decision := 'fresh';
    elsif exists (
      select 1 from public.ingest_runs
      where job_name in ('fda_announcements', 'fsis_ingest')
        and finished_at is null
        and started_at > v_now - make_interval(mins => cfg.running_grace_minutes)
    ) then
      v_decision := 'ingest_running';
    elsif exists (
      select 1 from public.watchdog_dispatches
      where (status = 'accepted'
             and claimed_at > v_now - make_interval(mins => cfg.cooldown_minutes))
         or (status = 'claimed'
             and claimed_at > v_now - make_interval(mins => cfg.claim_ttl_minutes))
         or (status = 'failed'
             and coalesce(finalized_at, claimed_at) > v_now - make_interval(mins => cfg.failure_backoff_minutes))
    ) then
      v_decision := 'dispatch_cooldown';
    else
      v_decision := 'dispatch_claimed';
      if not p_probe then
        insert into public.watchdog_dispatches (stale_sources, repository, workflow, ref)
        values (coalesce(v_stale, '{}'), cfg.repository, cfg.workflow, cfg.ref)
        returning id into v_claim_id;
      end if;
    end if;
  end if;

  insert into public.watchdog_invocations
    (probe, decision, stale_sources, freshness, claim_id, error_class)
  values
    (p_probe, v_decision, coalesce(v_stale, '{}'), v_freshness, v_claim_id, v_error_class);

  -- Deterministic bounded retention: expired history only, every tick.
  if cfg.retention_days is not null then
    delete from public.watchdog_invocations
      where invoked_at < v_now - make_interval(days => cfg.retention_days);
    delete from public.watchdog_dispatches
      where claimed_at < v_now - make_interval(days => cfg.retention_days);
  end if;

  return jsonb_build_object(
    'decision', v_decision,
    'claimId', v_claim_id,
    'staleSources', to_jsonb(coalesce(v_stale, '{}'::text[])),
    'freshness', v_freshness,
    'repository', cfg.repository,
    'workflow', cfg.workflow,
    'ref', cfg.ref,
    'errorClass', v_error_class
  );
end;
$$;

-- ── 5. Finalize a claim as accepted or failed ────────────────────────────────
--
-- Only a still-'claimed' row can be finalized (returns whether one was), so a
-- retried finalize or a finalize racing the claim TTL can never flip an
-- already-recorded result.

create or replace function public.watchdog_finalize_dispatch(
  p_claim_id uuid,
  p_accepted boolean,
  p_github_status integer default null,
  p_github_run_id bigint default null,
  p_error_class text default null,
  p_attempts integer default 1
) returns boolean
language plpgsql
as $$
begin
  update public.watchdog_dispatches
     set status = case when p_accepted then 'accepted' else 'failed' end,
         github_status = p_github_status,
         github_run_id = p_github_run_id,
         error_class = p_error_class,
         attempt_count = p_attempts,
         finalized_at = now()
   where id = p_claim_id and status = 'claimed';
  return found;
end;
$$;

revoke execute on function public.watchdog_tick(boolean, boolean, text)
  from public, anon, authenticated;
revoke execute on function public.watchdog_finalize_dispatch(uuid, boolean, integer, bigint, text, integer)
  from public, anon, authenticated;
grant execute on function public.watchdog_tick(boolean, boolean, text) to service_role;
grant execute on function public.watchdog_finalize_dispatch(uuid, boolean, integer, bigint, text, integer)
  to service_role;

-- ── 6. Cron registration ─────────────────────────────────────────────────────
--
-- Every 5 minutes, POST to the Edge Function. Both the function URL and the
-- shared secret are read from Vault AT TICK TIME by name — no secret value
-- exists in this file or in cron.job. The founder creates both Vault secrets
-- BEFORE applying this migration (activation sequence in
-- docs/recall-scheduler-watchdog.md); a tick that finds them missing fails
-- inside pg_net, which the missing-heartbeat health state then surfaces.
--
-- Rollback is one statement, preserving all history:
--   select cron.unschedule('recall-ingest-watchdog');

do $$
begin
  if exists (select 1 from cron.job where jobname = 'recall-ingest-watchdog') then
    perform cron.unschedule('recall-ingest-watchdog');
  end if;
end $$;

select cron.schedule(
  'recall-ingest-watchdog',
  '*/5 * * * *',
  $CRON$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets
            where name = 'watchdog_function_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-watchdog-secret', (select decrypted_secret from vault.decrypted_secrets
                            where name = 'watchdog_shared_secret')
    ),
    body := '{"mode":"tick"}'::jsonb,
    timeout_milliseconds := 8000
  ) as request_id;
  $CRON$
);
