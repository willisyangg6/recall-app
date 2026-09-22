-- P2B7U — multi-jurisdiction preferences: the EXPAND phase, and only that.
--
-- This migration is ADDITIVE. It drops nothing, renames nothing, and removes
-- no consumer-facing contract, so it can be applied while the CURRENTLY
-- DEPLOYED code is still running and still writing single states. The
-- destructive CONTRACT phase — removing `state_code` and the singular RPC
-- signature — is a separate, separately authorized migration that may only
-- run once no deployed client writes through the singular path.
--
-- An earlier draft of this file added `state_codes` and dropped `state_code`
-- and the singular signature in one transaction. That is a contract phase
-- wearing an expand phase's name: between applying it and shipping the new
-- bundle, the deployed app would have called an RPC signature that no longer
-- existed and the delivery worker would have selected a column that no longer
-- existed. Expand first, deploy, then contract.
--
-- Nothing here alters recall_cases, notification_events, push_subscriptions,
-- notification_deliveries, push_delivery_config, ingest_runs, shopper_reports
-- or any source table. No notification, delivery or ingest row is created.

-- ── 1. The canonical plural column ──────────────────────────────────────────
--
-- `state_codes` is from here the ONE answer to "where does this installation
-- shop". `state_code` survives as a compatibility projection for the code
-- that has not shipped yet; no new application logic may read it.
alter table public.installation_preferences
  add column if not exists state_codes text[] not null default '{}';

comment on column public.installation_preferences.state_codes is
  'CANONICAL (P2B7U). Chosen jurisdictions as postal codes, sorted distinct. '
  'Empty = no location preference. Push eligibility reads this column.';

comment on column public.installation_preferences.state_code is
  'COMPATIBILITY PROJECTION (P2B7U expand phase), maintained as state_codes[1] '
  'or null. Written for pre-P2B7U clients only; never read as canonical by new '
  'code, and removed in the separately authorized contract phase.';

-- ── 2. Backfill ─────────────────────────────────────────────────────────────
--
-- Every stored answer survives: a chosen state becomes a one-element list, and
-- a null becomes the empty list the column default already wrote — which is
-- exactly what "no location preference" has always meant to eligibility.
--
-- Idempotent: the guard means a second run matches no rows, because the rows
-- it would touch no longer hold an empty array.
--
-- `updated_at` is deliberately NOT touched. It is the delivery-safety horizon
-- (push eligibility requires event.created_at >= preferences.updated_at), and
-- reshaping our own storage is not the shopper changing their mind. Moving it
-- would re-open that window for every installation at once, for a change none
-- of them made.
update public.installation_preferences
   set state_codes = array[state_code]
 where state_code is not null
   and state_codes = '{}';

-- ── 3. One implementation, two entry points ─────────────────────────────────
--
-- The validated upsert lives here once, so the legacy singular RPC and the new
-- plural RPC cannot drift apart in what they accept or in what they write.
-- Both columns are written in the SAME statement, so a row can never be
-- observed with a canonical array and a stale projection.
--
-- Internal: SECURITY DEFINER with a pinned search_path like every other RPC in
-- this schema, and executable by nobody over the Data API — the two wrappers
-- call it with the definer's own rights.
create or replace function public.apply_installation_preferences(
  p_installation_id text,
  p_state_codes text[],
  p_allergens text[],
  p_retailer_ids text[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_states text[];
  v_allergens text[];
  v_retailers text[];
  v_existing public.installation_preferences%rowtype;
begin
  -- Shape validation: the wrappers are reachable with the publishable key.
  if p_installation_id is null
     or p_installation_id !~ '^[A-Za-z0-9-]{16,64}$' then
    raise exception 'invalid installation id';
  end if;
  if p_state_codes is null or array_length(p_state_codes, 1) > 52 then
    raise exception 'invalid state list';
  end if;
  if p_allergens is null or array_length(p_allergens, 1) > 16 then
    raise exception 'invalid allergen list';
  end if;
  if p_retailer_ids is null or array_length(p_retailer_ids, 1) > 100 then
    raise exception 'invalid retailer list';
  end if;

  -- Normalize to sorted distinct arrays so identical selections always compare
  -- equal regardless of client ordering — which is what makes the no-op below
  -- reliable. Display order is the app's business and never reaches here.
  select coalesce(array_agg(distinct t order by t), '{}')
    into v_states
    from unnest(p_state_codes) as t;
  if exists (
    select 1 from unnest(v_states) as t
    where t not in (
      'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN',
      'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV',
      'NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN',
      'TX','UT','VT','VA','WA','WV','WI','WY','DC','PR'
    )
  ) then
    raise exception 'invalid state code';
  end if;

  select coalesce(array_agg(distinct t order by t), '{}')
    into v_allergens
    from unnest(p_allergens) as t;
  if exists (
    select 1 from unnest(v_allergens) as t
    where t not in ('peanut','tree nuts','milk','egg','wheat','soy','sesame','fish','shellfish')
  ) then
    raise exception 'invalid allergen token';
  end if;

  select coalesce(array_agg(distinct t order by t), '{}')
    into v_retailers
    from unnest(p_retailer_ids) as t;
  if exists (
    select 1 from unnest(v_retailers) as t
    where t !~ '^[a-z0-9][a-z0-9-]{0,39}$'
  ) then
    raise exception 'invalid retailer id';
  end if;

  select * into v_existing
    from public.installation_preferences
   where installation_id = p_installation_id;

  -- Identical values change NOTHING, updated_at included. The projection is
  -- part of the comparison so that a row whose state_code somehow drifted from
  -- its canonical array is repaired by the next write rather than left behind;
  -- after the backfill above it always matches, so an unchanged profile still
  -- returns here and the delivery horizon still does not move.
  if found
     and v_existing.state_codes = v_states
     and v_existing.state_code is not distinct from v_states[1]
     and v_existing.allergens = v_allergens
     and v_existing.retailer_ids = v_retailers then
    return;
  end if;

  insert into public.installation_preferences
    (installation_id, state_codes, state_code, allergens, retailer_ids)
  values
    (p_installation_id, v_states, v_states[1], v_allergens, v_retailers)
  on conflict (installation_id) do update
    set state_codes = excluded.state_codes,
        state_code = excluded.state_code,
        allergens = excluded.allergens,
        retailer_ids = excluded.retailer_ids,
        updated_at = now();
end;
$$;

revoke execute on function public.apply_installation_preferences(text, text[], text[], text[]) from public;
revoke execute on function public.apply_installation_preferences(text, text[], text[], text[]) from anon, authenticated;
grant execute on function public.apply_installation_preferences(text, text[], text[], text[]) to service_role;

-- ── 4. The legacy singular RPC: same signature, both columns ────────────────
--
-- KEPT, deliberately. The deployed app calls this, and it must keep working
-- until the new bundle has shipped. Only the body changes: a single code now
-- also maintains the canonical array, so a pre-P2B7U client writing to an
-- expanded database leaves a row the new delivery worker reads correctly.
-- `create or replace` preserves the signature, the argument names PostgREST
-- dispatches on, and the existing grants.
create or replace function public.set_installation_preferences(
  p_installation_id text,
  p_state_code text,
  p_allergens text[],
  p_retailer_ids text[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.apply_installation_preferences(
    p_installation_id,
    case when p_state_code is null then '{}'::text[] else array[p_state_code] end,
    p_allergens,
    p_retailer_ids
  );
end;
$$;

revoke execute on function public.set_installation_preferences(text, text, text[], text[]) from public;
grant execute on function public.set_installation_preferences(text, text, text[], text[])
  to anon, authenticated, service_role;

-- ── 5. The plural RPC: the new client's entry point ─────────────────────────
--
-- An overload, not a replacement. PostgREST dispatches an RPC by the argument
-- NAMES in the request body, and `p_state_codes` differs from `p_state_code`,
-- so the two resolve unambiguously and both remain callable.
create or replace function public.set_installation_preferences(
  p_installation_id text,
  p_state_codes text[],
  p_allergens text[],
  p_retailer_ids text[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.apply_installation_preferences(
    p_installation_id,
    p_state_codes,
    p_allergens,
    p_retailer_ids
  );
end;
$$;

revoke execute on function public.set_installation_preferences(text, text[], text[], text[]) from public;
grant execute on function public.set_installation_preferences(text, text[], text[], text[])
  to anon, authenticated, service_role;
