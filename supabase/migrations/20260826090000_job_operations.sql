-- Phase C1: scheduled-job operations (additive only).
--
-- Three concerns, all operational — no consumer data is touched:
--
-- 1. ingest_runs grows job-level columns: which production job produced the
--    run (job_name), compact operational facts (metrics jsonb — counts and
--    hashes, never logs), and the code version (git SHA) that ran. The
--    outcome CHECK widens to include 'partial' (completed, but with item
--    failures such as quarantined records or failed detail fetches).
--
-- 2. job_leases: one row per logical job, the mutual-exclusion primitive for
--    scheduled + manual execution. A lease is acquired atomically via
--    acquire_job_lease(); a crashed holder's lease simply expires (TTL), so a
--    stuck job can never block ingestion permanently. Holder strings record
--    who ran (host, pid, version) for auditability.
--
-- 3. product_visual_failures: per-PDF failure state for the incremental FSIS
--    label sync, so a failing label PDF is retried with backoff instead of
--    being hammered every tick — and so accumulating failures are visible to
--    ops:health.
--
-- Nothing here alters historical RecallCases or NotificationEvents.

-- ── 1. ingest_runs job columns ───────────────────────────────────────────────

alter table public.ingest_runs
  add column job_name text,
  add column metrics jsonb,
  add column version text;

create index ingest_runs_job_idx on public.ingest_runs (job_name, started_at desc);

-- Widen the outcome CHECK to allow 'partial'. The original was declared
-- inline (auto-named), so it is located by definition rather than by an
-- assumed name (same pattern as the enforcement_match migration).
do $$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'ingest_runs'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) like '%outcome%';
  if constraint_name is not null then
    execute format('alter table public.ingest_runs drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.ingest_runs
  add constraint ingest_runs_outcome_check
  check (outcome in ('succeeded', 'partial', 'failed'));

-- ── 2. Job leases ────────────────────────────────────────────────────────────

create table public.job_leases (
  job_name text primary key,
  holder text not null,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.job_leases enable row level security;
-- No policies: server-only (service role bypasses RLS; anon has no grants).
grant select, insert, update, delete on public.job_leases to service_role;

-- Atomic acquire: succeeds when the lease is free, expired, or already held
-- by the same holder (re-entrant). Returns false otherwise.
create or replace function public.acquire_job_lease(
  p_job_name text,
  p_holder text,
  p_ttl_seconds integer
) returns boolean
language plpgsql
as $$
begin
  insert into public.job_leases (job_name, holder, acquired_at, expires_at)
  values (p_job_name, p_holder, now(), now() + make_interval(secs => p_ttl_seconds))
  on conflict (job_name) do update
    set holder = excluded.holder,
        acquired_at = excluded.acquired_at,
        expires_at = excluded.expires_at
    where public.job_leases.expires_at < now()
       or public.job_leases.holder = excluded.holder;
  return found;
end;
$$;

-- Release only what you hold; an expired/stolen lease is left alone.
create or replace function public.release_job_lease(
  p_job_name text,
  p_holder text
) returns void
language sql
as $$
  delete from public.job_leases
  where job_name = p_job_name and holder = p_holder;
$$;

revoke execute on function public.acquire_job_lease(text, text, integer) from public, anon, authenticated;
revoke execute on function public.release_job_lease(text, text) from public, anon, authenticated;
grant execute on function public.acquire_job_lease(text, text, integer) to service_role;
grant execute on function public.release_job_lease(text, text) to service_role;

-- ── 3. Label-sync failure state ──────────────────────────────────────────────

create table public.product_visual_failures (
  source_url text primary key,
  attempts integer not null default 1,
  last_attempt_at timestamptz not null,
  last_error text
);

alter table public.product_visual_failures enable row level security;
grant select, insert, update, delete on public.product_visual_failures to service_role;
