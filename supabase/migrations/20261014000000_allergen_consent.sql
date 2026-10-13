-- Allergen consent (2026-10-13): the server stores a shopper's allergens
-- only with their explicit consent. PREPARED, NOT APPLIED.
--
-- Design: docs/recall-privacy-program-proposal.md §1 (rev. 2/3) and
-- docs/recall-personalization.md. On-device matching (Affects Me, labels)
-- reads local preferences and is unaffected by anything here.
--
-- ── What changes ─────────────────────────────────────────────────────────────
--
-- 1. installation_preferences gains allergen_consent_version (null = no
--    consent) and allergen_consent_at.
-- 2. apply_installation_preferences — the ONE implementation both entry
--    points call — takes the consent version:
--      null            → allergens are stored as '{}' (and the consent
--                        columns cleared). Declining, withdrawing, and every
--                        older client that sends no consent land here.
--      'allergens-v1' or 'allergens-prompt-v1'
--                      → allergens are stored as sent; allergen_consent_at is
--                        set when consent is first given (or the version
--                        changes) and otherwise kept. The version records
--                        WHICH disclosure was accepted: the long consent
--                        sheet ('allergens-v1') or the compact onboarding
--                        prompt ('allergens-prompt-v1').
--      anything else   → 'invalid allergen consent' (a 4xx: the client treats
--                        it as a definite rejection).
--    Re-bodied from the LATEST definition (20260921000000) plus the consent
--    rule; the no-op check now includes the consent version.
-- 3. The plural set_installation_preferences gains `p_allergen_consent text
--    default null` and `p_allergen_consent_decided_at timestamptz default
--    null` (decision ordering, below). The 4-argument signature is DROPPED and recreated with
--    the defaulted fifth argument, so PostgREST keeps exactly one candidate
--    for the plural argument names and an older client's 4-argument call
--    still resolves (to consent null). Same pattern as 20261004000000.
-- 4. The legacy singular set_installation_preferences keeps its signature
--    and passes consent null.
--
-- ── What deliberately does NOT change ───────────────────────────────────────
--
-- * Existing rows. Allergens stored before this migration have
--   allergen_consent_version = null. They are NOT cleared here (founder
--   decision: no production data clearing). The push worker ignores
--   allergens without a consent version (src/server/push/worker.ts), so they
--   stop counting for alerts immediately; a later, separately authorized
--   step may clear them.
-- * Recall eligibility and matching rules. The worker still runs the same
--   relevance evaluation; it is simply not GIVEN allergens without consent.
-- * Grants. Same exposure as before: the plural and legacy RPCs to the
--   client roles, apply_installation_preferences to service_role only.

alter table public.installation_preferences
  add column if not exists allergen_consent_version text,
  add column if not exists allergen_consent_at timestamptz,
  -- The device time of the shopper's LATEST consent decision (grant,
  -- decline or withdrawal). A write carrying an older decision time is
  -- stale — a delayed or retried request — and cannot change the stored
  -- decision, so an old grant can never restore allergens after a newer
  -- withdrawal (and an old withdrawal can never undo a newer grant). Such a
  -- write is refused ('stale allergen consent decision'), so no client is
  -- ever told a decision was stored when it was not.
  add column if not exists allergen_consent_decided_at timestamptz;

-- ── The one implementation ──────────────────────────────────────────────────

drop function if exists public.apply_installation_preferences(text, text[], text[], text[]);

create or replace function public.apply_installation_preferences(
  p_installation_id text,
  p_state_codes text[],
  p_allergens text[],
  p_retailer_ids text[],
  p_allergen_consent text,
  p_allergen_consent_decided_at timestamptz
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_states text[];
  v_allergens text[];
  v_retailers text[];
  v_consent text;
  v_decided timestamptz;
  v_existing public.installation_preferences%rowtype;
begin
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
  -- The known consent texts. A new version is added here when the consent
  -- wording changes materially; an unknown one is refused, never stored.
  if p_allergen_consent is not null
     and p_allergen_consent not in ('allergens-v1', 'allergens-prompt-v1') then
    raise exception 'invalid allergen consent';
  end if;
  v_consent := p_allergen_consent;
  v_decided := p_allergen_consent_decided_at;

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
  -- THE consent rule: no consent version, no allergens on the server.
  if v_consent is null then
    v_allergens := '{}';
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

  -- Locked: two writes for one installation are decided one after the other,
  -- each against the other's committed decision time.
  select * into v_existing
    from public.installation_preferences
   where installation_id = p_installation_id
   for update;

  -- Decision ordering. Once a timed decision is stored:
  --   * an untimed write (an older build) keeps the stored decision AND the
  --     stored allergens; its states and stores still apply;
  --   * a write whose decision time is older is stale, and so is a GRANT at
  --     exactly the stored time of a withdrawal (a tie never restores
  --     allergens; a withdrawal at the same time as a grant does apply);
  --   * a stale write that would CHANGE the decision is refused, never
  --     silently ignored: the client keeps it owed and shows it pending
  --     instead of reporting a decision the server did not take. A stale
  --     write that agrees with the stored decision keeps it (and its
  --     allergens) and applies states and stores.
  if found and v_existing.allergen_consent_decided_at is not null then
    if v_decided is null then
      v_consent := v_existing.allergen_consent_version;
      v_decided := v_existing.allergen_consent_decided_at;
      v_allergens := v_existing.allergens;
    elsif v_decided < v_existing.allergen_consent_decided_at
       or (v_decided = v_existing.allergen_consent_decided_at
           and v_consent is not null
           and v_existing.allergen_consent_version is null) then
      if v_consent is distinct from v_existing.allergen_consent_version then
        raise exception 'stale allergen consent decision';
      end if;
      v_decided := v_existing.allergen_consent_decided_at;
      v_allergens := v_existing.allergens;
    end if;
  end if;

  -- Strict no-op on identical values, consent included, so a retry or the
  -- daily re-send never moves the delivery horizon.
  if found
     and v_existing.state_codes = v_states
     and v_existing.state_code is not distinct from v_states[1]
     and v_existing.allergens = v_allergens
     and v_existing.retailer_ids = v_retailers
     and v_existing.allergen_consent_version is not distinct from v_consent
     and v_existing.allergen_consent_decided_at is not distinct from v_decided then
    return;
  end if;

  insert into public.installation_preferences
    (installation_id, state_codes, state_code, allergens, retailer_ids,
     allergen_consent_version, allergen_consent_at, allergen_consent_decided_at)
  values
    (p_installation_id, v_states, v_states[1], v_allergens, v_retailers,
     v_consent, case when v_consent is null then null else now() end, v_decided)
  on conflict (installation_id) do update
    set state_codes = excluded.state_codes,
        state_code = excluded.state_code,
        allergens = excluded.allergens,
        retailer_ids = excluded.retailer_ids,
        allergen_consent_version = excluded.allergen_consent_version,
        allergen_consent_decided_at = excluded.allergen_consent_decided_at,
        -- Kept while the same consent stands; set when it is first given or
        -- the version changes; cleared on withdrawal.
        allergen_consent_at = case
          when excluded.allergen_consent_version is null then null
          when public.installation_preferences.allergen_consent_version
               is not distinct from excluded.allergen_consent_version
            then public.installation_preferences.allergen_consent_at
          else now()
        end,
        updated_at = now();
end;
$$;

revoke execute on function public.apply_installation_preferences(text, text[], text[], text[], text, timestamptz) from public;
revoke execute on function public.apply_installation_preferences(text, text[], text[], text[], text, timestamptz) from anon, authenticated;
grant execute on function public.apply_installation_preferences(text, text[], text[], text[], text, timestamptz) to service_role;

-- ── The legacy singular RPC: same signature, no consent ─────────────────────

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
    p_retailer_ids,
    null,
    null
  );
end;
$$;

revoke execute on function public.set_installation_preferences(text, text, text[], text[]) from public;
grant execute on function public.set_installation_preferences(text, text, text[], text[])
  to anon, authenticated, service_role;

-- ── The plural RPC: one candidate, with a defaulted consent argument ────────

drop function if exists public.set_installation_preferences(text, text[], text[], text[]);

create or replace function public.set_installation_preferences(
  p_installation_id text,
  p_state_codes text[],
  p_allergens text[],
  p_retailer_ids text[],
  p_allergen_consent text default null,
  p_allergen_consent_decided_at timestamptz default null
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
    p_retailer_ids,
    p_allergen_consent,
    p_allergen_consent_decided_at
  );
end;
$$;

revoke execute on function public.set_installation_preferences(text, text[], text[], text[], text, timestamptz) from public;
grant execute on function public.set_installation_preferences(text, text[], text[], text[], text, timestamptz)
  to anon, authenticated, service_role;
