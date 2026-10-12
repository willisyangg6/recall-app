-- Installation inactivity retention (2026-10-12, founder-approved direction):
-- Lotly-held installation data is deleted after 12 months without meaningful
-- user activity. PREPARED, NOT APPLIED. Applying it schedules the daily job,
-- but the job deletes nothing until a separate, explicit service-role update
-- sets installation_retention_config.purge_enabled = true AND a
-- deletions_start_on date has arrived. Go-live sets that date to go-live
-- day + 12 months, so every installation that exists when the retention
-- promise is published gets the full 12-month grace period, whatever its
-- earlier activity (docs/recall-operations.md, the rollout sequence).
--
-- ── The activity signal ─────────────────────────────────────────────────────
--
-- Recall reads are anonymous (no installation id), so an installation that
-- only opens the app leaves no trace keyed to it. The signal is therefore
-- explicit: record_installation_activity(id), which the app calls when it
-- comes to the FOREGROUND, at most once per UTC day, and only for an
-- installation id that already exists (src/lib/installation-checkin.ts).
-- It stores one UTC calendar date per installation — day granularity, the
-- least this rule needs — never a time, a count, a screen or a recall.
--
-- An installation's last activity is the latest of:
--   installation_activity.last_active_on              (the check-in)
--   installation_preferences.created_at / updated_at  (written only by the
--                                                      app's own RPCs)
--   push_subscriptions.registered_at / last_seen_at / enabled_at
--                                                     (app RPCs only)
--   push_installation_sequences.updated_at            (app RPCs only)
--   shopper_reports.created_at / updated_at           (app RPCs only)
-- Deliberately EXCLUDED, because background work writes them, not the user:
-- push_subscriptions.enabled / disabled_at / disabled_reason /
-- last_token_error (the delivery worker and token reassignment),
-- notification_deliveries (sends), notification_events, ingest and job
-- tables. A notification being SENT is never activity; a user OPENING the
-- app from it is (that is a foreground check-in).
--
-- ── What is deleted ─────────────────────────────────────────────────────────
--
-- Exactly what "Reset app and delete my data" deletes, through the same
-- function (delete_installation_data, re-bodied below to cover the new
-- activity row): the preference mirror, push subscription(s), their
-- notification_deliveries, the push sequence row, shopper reports, and the
-- activity row. Never touched: Apple subscriptions and RevenueCat records
-- (outside this database; the purchase id is not stored here), shared recall
-- tables, notification_events, and anything on the device.
--
-- ── Concurrency ─────────────────────────────────────────────────────────────
--
-- Per candidate, the purge takes a per-installation advisory lock (the same
-- one record_installation_activity takes), row-locks the installation's
-- existing rows, RE-COMPUTES its last activity under those locks, and deletes
-- only if it is still older than the cutoff. So:
--   - a check-in that commits first is seen, and the installation is kept;
--   - a check-in that arrives during the purge waits on the advisory lock
--     and then records activity for the returning installation;
--   - another app write (preferences, registration) that commits first moves
--     a timestamp the recheck reads; one that commits after recreates its
--     row with fresh timestamps.
-- Every interleaving ends either with the installation kept, or deleted and
-- then cleanly recreated by the returning app (below) — never a half-deleted
-- installation the app cannot repair.
--
-- ── A returning installation ────────────────────────────────────────────────
--
-- The device keeps everything local (choices, alerts setting, saved recalls,
-- installation id). Its next foreground check-in records activity, re-sends
-- the preference mirror (set_installation_preferences inserts a missing row;
-- an unchanged one is a strict no-op), and refreshes the push registration
-- when alerts are on (register_push_subscription inserts a fresh row with a
-- new enabled_at horizon, so no pre-purge event can be backfilled; a client
-- sequence higher than "no row" applies). Nothing the user did is lost
-- except server-side delivery history and shopper reports.

-- ── 1. The activity table ───────────────────────────────────────────────────

create table public.installation_activity (
  installation_id text primary key check (installation_id ~ '^[A-Za-z0-9-]{16,64}$'),
  -- UTC calendar date of the latest foreground check-in.
  last_active_on date not null
);

alter table public.installation_activity enable row level security;
-- No policies, no client grants: reachable only through the RPC below and
-- the service-role purge.
grant select, insert, update, delete on public.installation_activity to service_role;

-- Seed every installation that already holds data with today's date, so no
-- installation can be deleted sooner than 12 months after this change ships
-- (builds before it never checked in).
insert into public.installation_activity (installation_id, last_active_on)
select ids.installation_id, (now() at time zone 'utc')::date
  from (
    select installation_id from public.installation_preferences
    union select installation_id from public.push_subscriptions
    union select installation_id from public.push_installation_sequences
    union select installation_id from public.shopper_reports
  ) ids
 where ids.installation_id ~ '^[A-Za-z0-9-]{16,64}$'
on conflict (installation_id) do nothing;

-- ── 2. The purge switch (off) ───────────────────────────────────────────────

create table public.installation_retention_config (
  id boolean primary key default true check (id),
  purge_enabled boolean not null default false,
  -- No deletion happens before this UTC date. Set at go-live to go-live day
  -- + 12 months: the full grace period for every existing installation.
  deletions_start_on date,
  updated_at timestamptz not null default now(),
  -- The purge cannot be switched on without a grace date.
  constraint purge_needs_grace_date check (not purge_enabled or deletions_start_on is not null)
);

alter table public.installation_retention_config enable row level security;
grant select, update on public.installation_retention_config to service_role;

insert into public.installation_retention_config (id, purge_enabled) values (true, false);

-- ── 3. The check-in RPC ─────────────────────────────────────────────────────

create or replace function public.record_installation_activity(
  p_installation_id text
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

  -- Serializes with the purge's decision for this installation.
  perform pg_advisory_xact_lock(hashtextextended('installation:' || p_installation_id, 0));

  insert into public.installation_activity (installation_id, last_active_on)
  values (p_installation_id, (now() at time zone 'utc')::date)
  on conflict (installation_id) do update
    set last_active_on = greatest(public.installation_activity.last_active_on,
                                  excluded.last_active_on);
end;
$$;

revoke execute on function public.record_installation_activity(text) from public;
grant execute on function public.record_installation_activity(text)
  to anon, authenticated, service_role;

-- ── 4. Last activity, candidates, preview ───────────────────────────────────

create or replace function public.installation_last_activity(
  p_installation_id text
) returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    (select a.last_active_on::timestamp at time zone 'utc'
       from public.installation_activity a
      where a.installation_id = p_installation_id),
    (select greatest(p.created_at, p.updated_at)
       from public.installation_preferences p
      where p.installation_id = p_installation_id),
    (select max(greatest(s.registered_at, s.last_seen_at, s.enabled_at))
       from public.push_subscriptions s
      where s.installation_id = p_installation_id),
    (select q.updated_at
       from public.push_installation_sequences q
      where q.installation_id = p_installation_id),
    (select max(greatest(r.created_at, r.updated_at))
       from public.shopper_reports r
      where r.installation_id = p_installation_id)
  );
$$;

create or replace function public.inactive_installation_candidates(
  p_cutoff timestamptz,
  p_limit integer
) returns table (installation_id text, last_activity timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select c.installation_id, c.last_activity
    from (
      select ids.installation_id,
             public.installation_last_activity(ids.installation_id) as last_activity
        from (
          select installation_id from public.installation_activity
          union select installation_id from public.installation_preferences
          union select installation_id from public.push_subscriptions
          union select installation_id from public.push_installation_sequences
          union select installation_id from public.shopper_reports
        ) ids
       -- Only ids delete_installation_data accepts: one off-shape row (a
       -- manual insert) would otherwise raise inside the purge, roll back
       -- the whole run and recur every day.
       where ids.installation_id ~ '^[A-Za-z0-9-]{16,64}$'
    ) c
   where c.last_activity < p_cutoff
   order by c.last_activity
   limit greatest(p_limit, 0);
$$;

-- The dry run: what a purge would delete right now. Reads only.
-- `deleting_now` is false while the switch is off or before
-- deletions_start_on: the candidates are what WOULD go once it is true.
create or replace function public.preview_inactive_installation_purge()
returns table (
  candidates bigint,
  oldest_last_activity timestamptz,
  cutoff timestamptz,
  purge_enabled boolean,
  deletions_start_on date,
  deleting_now boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select count(c.installation_id),
         min(c.last_activity),
         now() - interval '12 months',
         cfg.purge_enabled,
         cfg.deletions_start_on,
         coalesce(cfg.purge_enabled
                  and cfg.deletions_start_on is not null
                  and (now() at time zone 'utc')::date >= cfg.deletions_start_on, false)
    from public.installation_retention_config cfg
    left join public.inactive_installation_candidates(now() - interval '12 months', 2147483647) c
      on true
   group by cfg.purge_enabled, cfg.deletions_start_on;
$$;

-- ── 5. The purge ────────────────────────────────────────────────────────────

create or replace function public.purge_inactive_installations(
  p_limit integer default 500
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff constant timestamptz := now() - interval '12 months';
  v_id text;
  v_purged integer := 0;
begin
  -- Switched on AND past the grace date, or nothing happens.
  if not coalesce(
    (select c.purge_enabled
            and c.deletions_start_on is not null
            and (now() at time zone 'utc')::date >= c.deletions_start_on
       from public.installation_retention_config c),
    false
  ) then
    return 0;
  end if;

  for v_id in
    select c.installation_id from public.inactive_installation_candidates(v_cutoff, p_limit) c
  loop
    perform pg_advisory_xact_lock(hashtextextended('installation:' || v_id, 0));
    perform 1 from public.push_subscriptions where installation_id = v_id for update;
    perform 1 from public.installation_preferences where installation_id = v_id for update;
    perform 1 from public.installation_activity where installation_id = v_id for update;
    perform 1 from public.push_installation_sequences where installation_id = v_id for update;
    perform 1 from public.shopper_reports where installation_id = v_id for update;

    -- Re-decide under the locks: a concurrent check-in or app write that
    -- committed meanwhile is visible to this statement's snapshot.
    if coalesce(public.installation_last_activity(v_id) < v_cutoff, false) then
      perform public.delete_installation_data(v_id);
      v_purged := v_purged + 1;
    end if;
  end loop;

  return v_purged;
end;
$$;

revoke execute on function public.installation_last_activity(text) from public;
revoke execute on function public.inactive_installation_candidates(timestamptz, integer) from public;
revoke execute on function public.preview_inactive_installation_purge() from public;
revoke execute on function public.purge_inactive_installations(integer) from public;
grant execute on function public.installation_last_activity(text) to service_role;
grant execute on function public.inactive_installation_candidates(timestamptz, integer) to service_role;
grant execute on function public.preview_inactive_installation_purge() to service_role;
grant execute on function public.purge_inactive_installations(integer) to service_role;

-- ── 6. The reset covers the activity row ────────────────────────────────────
--
-- Re-bodied from the LATEST definition (20261012000000, which restored the
-- shopper-report delete) plus one statement. The effective-definition test
-- (installation-deletion-effective.test.ts) requires every installation-
-- keyed table, so this table cannot be left out.

create or replace function public.delete_installation_data(
  p_installation_id text
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

  -- Serialize against a concurrent worker delivery insert (see the
  -- installation_deletion migration's header).
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

  delete from public.push_installation_sequences
   where installation_id = p_installation_id;

  delete from public.installation_preferences
   where installation_id = p_installation_id;

  delete from public.shopper_reports
   where installation_id = p_installation_id;

  delete from public.installation_activity
   where installation_id = p_installation_id;
end;
$$;

revoke execute on function public.delete_installation_data(text) from public;
grant execute on function public.delete_installation_data(text)
  to anon, authenticated, service_role;

-- ── 7. The daily job (gated by purge_enabled, which ships false) ────────────

do $$
begin
  if exists (select 1 from cron.job where jobname = 'recall-installation-inactivity-purge') then
    perform cron.unschedule('recall-installation-inactivity-purge');
  end if;
end $$;

select cron.schedule(
  'recall-installation-inactivity-purge',
  '30 9 * * *',
  $CRON$ select public.purge_inactive_installations(); $CRON$
);
