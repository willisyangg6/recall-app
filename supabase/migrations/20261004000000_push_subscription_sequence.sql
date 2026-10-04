-- Push subscription write ordering (2026-10-04): a client-issued sequence on
-- the two subscription RPCs, so a registration the client abandoned can
-- never outrank the disable that cleaned it up, and that cleanup can never
-- outrank a later, successful retry — whatever order the requests reach the
-- server in.
--
-- Why: the notification education bounds a registration at 10 s and aborts
-- the request. The server may have committed the row in the instant before
-- the abort; the client then sees a failure, writes no local flag, and the
-- shopper taps "Continue without alerts" — leaving an ENABLED subscription
-- the app does not know about. The client now follows every uncertain
-- registration with a disable. Without ordering, that disable could arrive
-- before the delayed registration (and be undone by it), or after a newer
-- registration the shopper retried successfully (and silence it).
--
-- The rule, per installation (push_installation_sequences — a separate
-- table, because a disable can legitimately arrive before any subscription
-- row exists, and must still be remembered so the delayed registration it
-- outranks is refused):
--
--   - A write carrying a sequence LOWER than the recorded one is refused.
--   - A write carrying the recorded sequence with the SAME operation is the
--     same write retried, and applies (idempotent). The recorded sequence
--     with a DIFFERENT operation is refused: one sequence names one write.
--   - A write carrying a higher sequence applies and is recorded.
--   - A write carrying NO sequence is a legacy client. It applies only while
--     the installation has never written with a sequence; once an
--     installation has entered the protocol, an unsequenced write is refused,
--     so an older build can never undo a sequenced disable.
--
-- Every RPC returns what the gate decided — {"applied": bool,
-- "last_sequence": n} — so a client whose persisted counter was lost can
-- see the server's count, adopt it and retry with a higher sequence
-- (src/lib/alert-intent.ts). Sequences start again from 1 with the fresh
-- installation id a data reset creates; the reset deletes the sequence row.
--
-- Expand only: a new table, a defaulted parameter and a return value on
-- each RPC, and the deletion RPC extended to clear the sequence row. Old
-- clients keep calling the four- and one-argument shapes, which still
-- resolve (the added parameter defaults to null) and ignore the returned
-- value. The old function signatures are dropped so PostgREST has exactly
-- one candidate per name.

create table public.push_installation_sequences (
  installation_id text primary key,
  last_sequence bigint not null check (last_sequence >= 1),
  last_operation text not null check (last_operation in ('register', 'disable')),
  updated_at timestamptz not null default now()
);

alter table public.push_installation_sequences enable row level security;
-- No policies, no anon grants: reachable only via the RPCs below.
grant select, insert, update, delete on public.push_installation_sequences to service_role;

-- The gate. Records `p_sequence`/`p_operation` for the installation when the
-- write may apply, and returns the decision with the sequence now recorded.
-- Locks the installation's row for the rest of the transaction, so two
-- concurrent writes for one installation are decided one after the other.
create or replace function public.push_sequence_gate(
  p_installation_id text,
  p_sequence bigint,
  p_operation text
) returns table (applies boolean, last_sequence bigint)
language plpgsql
set search_path = public
as $$
declare
  v_last bigint;
  v_operation text;
begin
  if p_operation not in ('register', 'disable') then
    raise exception 'invalid operation';
  end if;
  if p_sequence is not null and p_sequence < 1 then
    raise exception 'invalid sequence';
  end if;
  -- Serialize concurrent writers for this installation on one advisory
  -- lock, so the first writer's insert is visible to the second.
  perform pg_advisory_xact_lock(hashtext('push_installation_sequences'), hashtext(p_installation_id));
  select s.last_sequence, s.last_operation
    into v_last, v_operation
    from public.push_installation_sequences s
   where s.installation_id = p_installation_id;
  if p_sequence is null then
    -- Legacy: fine until the installation enters the protocol.
    return query select (v_last is null), coalesce(v_last, 0::bigint);
    return;
  end if;
  if v_last is not null
     and (v_last > p_sequence or (v_last = p_sequence and v_operation <> p_operation)) then
    return query select false, v_last;
    return;
  end if;
  insert into public.push_installation_sequences (installation_id, last_sequence, last_operation)
  values (p_installation_id, p_sequence, p_operation)
  on conflict (installation_id) do update
    set last_sequence = excluded.last_sequence,
        last_operation = excluded.last_operation,
        updated_at = now();
  return query select true, p_sequence;
end;
$$;

revoke execute on function public.push_sequence_gate(text, bigint, text) from public;

drop function if exists public.register_push_subscription(text, text, text, text);

create or replace function public.register_push_subscription(
  p_installation_id text,
  p_expo_push_token text,
  p_platform text,
  p_app_version text,
  p_sequence bigint default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_applies boolean;
  v_last bigint;
begin
  -- Shape validation: this endpoint is reachable with the publishable key.
  if p_installation_id is null
     or p_installation_id !~ '^[A-Za-z0-9-]{16,64}$' then
    raise exception 'invalid installation id';
  end if;
  if p_expo_push_token is null
     or p_expo_push_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,128}\]$' then
    raise exception 'invalid Expo push token';
  end if;
  if p_platform not in ('ios', 'android') then
    raise exception 'invalid platform';
  end if;
  if p_app_version is not null and length(p_app_version) > 40 then
    raise exception 'invalid app version';
  end if;

  -- A registration the client has since outranked (its cleanup, a later
  -- disable, or a newer registration) changes nothing — not even the token
  -- reassignment below, which the newer write performed for itself.
  select g.applies, g.last_sequence into v_applies, v_last
    from public.push_sequence_gate(p_installation_id, p_sequence, 'register') g;
  if not v_applies then
    return jsonb_build_object('applied', false, 'last_sequence', v_last);
  end if;

  update public.push_subscriptions
     set enabled = false,
         disabled_at = now(),
         disabled_reason = 'token_reassigned'
   where expo_push_token = p_expo_push_token
     and installation_id <> p_installation_id
     and enabled;

  insert into public.push_subscriptions
    (installation_id, expo_push_token, platform, app_version)
  values
    (p_installation_id, p_expo_push_token, p_platform, p_app_version)
  on conflict (installation_id) do update
    set expo_push_token = excluded.expo_push_token,
        platform = excluded.platform,
        app_version = excluded.app_version,
        last_seen_at = now(),
        -- Re-enabling moves the horizon; staying enabled keeps it.
        enabled_at = case
          when public.push_subscriptions.enabled then public.push_subscriptions.enabled_at
          else now()
        end,
        enabled = true,
        disabled_at = null,
        disabled_reason = null,
        last_token_error = null;
  return jsonb_build_object('applied', true, 'last_sequence', v_last);
end;
$$;

drop function if exists public.disable_push_subscription(text);

-- The user turned alerts off — or the client is cleaning up a registration
-- whose outcome it never learned. Only the holder of the installation id can
-- do this, and only for its own row. With a sequence, the disable is
-- remembered even when no row exists yet, so a delayed registration it
-- outranks is refused when it finally arrives.
create or replace function public.disable_push_subscription(
  p_installation_id text,
  p_sequence bigint default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_applies boolean;
  v_last bigint;
begin
  if p_installation_id is null
     or p_installation_id !~ '^[A-Za-z0-9-]{16,64}$' then
    raise exception 'invalid installation id';
  end if;
  select g.applies, g.last_sequence into v_applies, v_last
    from public.push_sequence_gate(p_installation_id, p_sequence, 'disable') g;
  if not v_applies then
    return jsonb_build_object('applied', false, 'last_sequence', v_last);
  end if;
  update public.push_subscriptions
     set enabled = false,
         disabled_at = now(),
         disabled_reason = 'user_disabled'
   where installation_id = p_installation_id
     and enabled;
  return jsonb_build_object('applied', true, 'last_sequence', v_last);
end;
$$;

revoke execute on function public.register_push_subscription(text, text, text, text, bigint)
  from public;
revoke execute on function public.disable_push_subscription(text, bigint) from public;
grant execute on function public.register_push_subscription(text, text, text, text, bigint)
  to anon, authenticated, service_role;
grant execute on function public.disable_push_subscription(text, bigint)
  to anon, authenticated, service_role;

-- The data reset clears the installation's sequence row with everything
-- else; the fresh installation id starts its own count at 1.
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
end;
$$;
