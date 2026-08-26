-- Phase C3: installation preferences (additive only).
--
-- The three personalization dimensions — home state, allergens, retailers —
-- stored per app installation. Deliberately separate from push_subscriptions:
-- preferences are application state an installation can hold with alerts off
-- (the Home "Affects me" feed uses them locally), while a push subscription
-- is a delivery transport. Nothing here alters recall_cases,
-- notification_events, push_subscriptions, notification_deliveries,
-- push_delivery_config, ingest_runs, or source tables.
--
-- Security model mirrors C2: the table has RLS with no policies and no anon
-- grants; the ONLY client write path is a SECURITY DEFINER RPC keyed by the
-- same opaque installation id (bearer capability). A client can set its own
-- preferences and nothing else — it can never enumerate installations, read
-- another installation's preferences, or touch push tokens/deliveries.
--
-- updated_at is a delivery-safety horizon, not bookkeeping: push eligibility
-- treats it like the C2 enabled_at horizons, so changing preferences can
-- never make OLD events newly deliverable (no retroactive blast when a user
-- adds an allergen or moves states). The RPC therefore leaves updated_at
-- untouched when a sync writes identical values.

create table public.installation_preferences (
  -- Same opaque client-generated id push_subscriptions uses; one row per
  -- installation whether or not a subscription exists.
  installation_id text primary key,
  -- Two-letter postal code (50 states + DC + PR), validated in the RPC
  -- against the same closed set the geography layer normalizes to.
  state_code text,
  -- Canonical allergen tokens (closed nine-token consumer set).
  allergens text[] not null default '{}',
  -- Canonical retailer catalog ids. The catalog lives in application code
  -- (src/domain/retailer-catalog.ts), so the RPC validates shape and count;
  -- an id outside the catalog is inert — the matcher can never match it.
  retailer_ids text[] not null default '{}',
  -- Future account ownership (no auth exists yet; never populated today).
  user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.installation_preferences enable row level security;
-- No policies, no anon grants: reachable only via the RPC below and the
-- service-role delivery worker.
grant select, insert, update on public.installation_preferences to service_role;

-- Set (or refresh) this installation's preferences. Idempotent in the strong
-- sense: writing values identical to the stored row changes NOTHING —
-- including updated_at — so a client retry or app-launch re-sync can never
-- move the delivery-safety horizon.
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
declare
  v_allergens text[];
  v_retailers text[];
  v_existing public.installation_preferences%rowtype;
begin
  -- Shape validation: this endpoint is reachable with the publishable key.
  if p_installation_id is null
     or p_installation_id !~ '^[A-Za-z0-9-]{16,64}$' then
    raise exception 'invalid installation id';
  end if;
  if p_state_code is not null and p_state_code not in (
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN',
    'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV',
    'NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN',
    'TX','UT','VT','VA','WA','WV','WI','WY','DC','PR'
  ) then
    raise exception 'invalid state code';
  end if;
  if p_allergens is null or array_length(p_allergens, 1) > 16 then
    raise exception 'invalid allergen list';
  end if;
  if p_retailer_ids is null or array_length(p_retailer_ids, 1) > 100 then
    raise exception 'invalid retailer list';
  end if;

  -- Normalize to sorted distinct arrays so identical selections always
  -- compare equal regardless of client ordering.
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

  if found
     and v_existing.state_code is not distinct from p_state_code
     and v_existing.allergens = v_allergens
     and v_existing.retailer_ids = v_retailers then
    return; -- identical: leave updated_at (the safety horizon) alone.
  end if;

  insert into public.installation_preferences
    (installation_id, state_code, allergens, retailer_ids)
  values
    (p_installation_id, p_state_code, v_allergens, v_retailers)
  on conflict (installation_id) do update
    set state_code = excluded.state_code,
        allergens = excluded.allergens,
        retailer_ids = excluded.retailer_ids,
        updated_at = now();
end;
$$;

revoke execute on function public.set_installation_preferences(text, text, text[], text[]) from public;
grant execute on function public.set_installation_preferences(text, text, text[], text[])
  to anon, authenticated, service_role;
