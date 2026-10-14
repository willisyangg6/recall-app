-- Alert entitlement gate (D2, founder-approved 2026-10-14). PREPARED, NOT APPLIED.
--
-- Recall alerts stop when a subscription ends. The app grants access from
-- RevenueCat's `premium` entitlement under the PURCHASE id (a random keychain
-- UUID, never rotated by "Reset app and delete my data";
-- src/lib/purchases/purchase-identity.ts). The server gates alerts on the same
-- entitlement under the same id, so the two read one source. The decision is
-- docs/recall-push-delivery.md "Alert entitlement gate".
--
-- What this migration adds, all on push_subscriptions (no other table):
--
--   purchase_id             sent by the app with every alert registration.
--                           BEARER-SENSITIVE: anyone holding it could read the
--                           entitlement through the RevenueCat SDK. No RPC
--                           returns it, no raised error carries it, and the
--                           export shows only its last 4 characters.
--   entitlement_status      unknown | active | inactive (RevenueCat counts a
--                           billing grace period as active)
--   entitlement_expires_at  from the active `premium` entitlement
--   entitlement_checked_at  the last SUCCESSFUL check (push worker, hourly)
--   entitled_since          the no-backlog horizon: an event created before it
--                           is never delivered to this registration
--
-- The push worker writes the four entitlement fields after asking RevenueCat
-- (src/server/push/entitlement-refresh.ts); the app never can.
--
-- Retention, enforced by ONE trigger rather than by each write path:
--   * a row that is DISABLED, for any reason (the user's own disable, token
--     reassignment, device_not_registered, consent_revoked), loses its
--     purchase_id and every entitlement field in the same statement;
--   * a CHANGED purchase_id resets the entitlement to unknown, so one
--     purchase's status can never be read under another's id;
--   * "Reset app and delete my data", privacy deletion and the 12-month
--     purge delete the whole row (delete_installation_data, unchanged).
--
-- Older clients that send no purchase id still register: the row stays
-- `unknown`, and the worker sends it nothing (fail closed).

-- ── 1. The columns ──────────────────────────────────────────────────────────

alter table public.push_subscriptions
  add column purchase_id text
    check (purchase_id is null or purchase_id ~ '^[A-Za-z0-9-]{16,64}$'),
  add column entitlement_status text not null default 'unknown'
    check (entitlement_status in ('unknown', 'active', 'inactive')),
  add column entitlement_expires_at timestamptz,
  add column entitlement_checked_at timestamptz,
  add column entitled_since timestamptz;

-- The refresh reads enabled rows oldest-checked first.
create index push_subscriptions_entitlement_refresh_idx
  on public.push_subscriptions (entitlement_checked_at nulls first)
  where enabled and purchase_id is not null;

-- ── 2. Retention and identity guard ─────────────────────────────────────────

create or replace function public.push_subscription_entitlement_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not new.enabled then
    new.purchase_id := null;
  end if;
  if not new.enabled or new.purchase_id is distinct from old.purchase_id then
    new.entitlement_status := 'unknown';
    new.entitlement_expires_at := null;
    new.entitlement_checked_at := null;
    new.entitled_since := null;
  end if;
  return new;
end;
$$;

revoke execute on function public.push_subscription_entitlement_guard() from public, anon, authenticated;

create trigger push_subscriptions_entitlement_guard
  before update on public.push_subscriptions
  for each row execute function public.push_subscription_entitlement_guard();

-- ── 3. Registration carries the purchase id ─────────────────────────────────

-- 3a. The internal registration (20261017000000) gains p_purchase_id. Its
--     body is otherwise unchanged.
drop function public.push_register_subscription(text, text, text, text, bigint, boolean);

create or replace function public.push_register_subscription(
  p_installation_id text,
  p_expo_push_token text,
  p_platform text,
  p_app_version text,
  p_sequence bigint,
  p_allow_consent_renewal boolean,
  p_purchase_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_applies boolean;
  v_last bigint;
  v_enabled boolean;
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
  if p_purchase_id is not null and p_purchase_id !~ '^[A-Za-z0-9-]{16,64}$' then
    raise exception 'invalid purchase id';
  end if;

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
    (installation_id, expo_push_token, platform, app_version, purchase_id)
  values
    (p_installation_id, p_expo_push_token, p_platform, p_app_version, p_purchase_id)
  on conflict (installation_id) do update
    set expo_push_token = excluded.expo_push_token,
        platform = excluded.platform,
        app_version = excluded.app_version,
        last_seen_at = now(),
        -- The guard trigger keeps the entitlement when the id is unchanged,
        -- resets it when the id changed, and clears both on a row that stays
        -- disabled (a revoked one, below).
        purchase_id = excluded.purchase_id,
        enabled_at = case
          when public.push_subscriptions.enabled then public.push_subscriptions.enabled_at
          when public.push_subscriptions.disabled_reason is not distinct from 'consent_revoked'
               and not p_allow_consent_renewal then public.push_subscriptions.enabled_at
          else now()
        end,
        enabled = not (public.push_subscriptions.disabled_reason is not distinct from 'consent_revoked'
                       and not p_allow_consent_renewal),
        disabled_at = case
          when public.push_subscriptions.disabled_reason is not distinct from 'consent_revoked'
               and not p_allow_consent_renewal then public.push_subscriptions.disabled_at
          else null
        end,
        disabled_reason = case
          when public.push_subscriptions.disabled_reason is not distinct from 'consent_revoked'
               and not p_allow_consent_renewal then 'consent_revoked'
          else null
        end,
        last_token_error = null;
  select enabled into v_enabled
    from public.push_subscriptions
   where installation_id = p_installation_id;
  return jsonb_build_object(
    'applied', true,
    'last_sequence', v_last,
    'enabled', v_enabled,
    'consent_revoked', not v_enabled
  );
end;
$$;

revoke execute on function public.push_register_subscription(text, text, text, text, bigint, boolean, text)
  from public, anon, authenticated;

-- 3b. The public registration gains an optional p_purchase_id (older clients
--     omit it). It still can never revive a revoked row.
drop function public.register_push_subscription(text, text, text, text, bigint);

create or replace function public.register_push_subscription(
  p_installation_id text,
  p_expo_push_token text,
  p_platform text,
  p_app_version text,
  p_sequence bigint default null,
  p_purchase_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.push_register_subscription(
    p_installation_id, p_expo_push_token, p_platform, p_app_version, p_sequence, false, p_purchase_id
  );
end;
$$;

revoke execute on function public.register_push_subscription(text, text, text, text, bigint, text)
  from public;
grant execute on function public.register_push_subscription(text, text, text, text, bigint, text)
  to anon, authenticated, service_role;

-- 3c. The keyed registration (regulated 13–17) gains the same optional id.
--     Body otherwise unchanged from 20261017000000.
drop function public.register_push_subscription_with_revocation_key(text, text, text, text, bigint, text);

create or replace function public.register_push_subscription_with_revocation_key(
  p_installation_id text,
  p_expo_push_token text,
  p_platform text,
  p_app_version text,
  p_sequence bigint,
  p_app_transaction_id text,
  p_purchase_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hmac text;
  v_reason text;
  v_stored text;
  v_result jsonb;
begin
  if p_installation_id is null
     or p_installation_id !~ '^[A-Za-z0-9-]{16,64}$' then
    raise exception 'invalid installation id';
  end if;
  if p_app_transaction_id is null
     or p_app_transaction_id !~ '^[A-Za-z0-9-]{1,64}$' then
    raise exception 'invalid app transaction id';
  end if;
  v_hmac := public.app_transaction_hmac(p_app_transaction_id);

  select disabled_reason, app_transaction_hmac into v_reason, v_stored
    from public.push_subscriptions
   where installation_id = p_installation_id
   for update;
  if v_reason = 'consent_revoked' and v_stored is distinct from v_hmac then
    -- Only the same Apple Account's app may renew a revoked registration.
    raise exception 'consent revoked for this installation';
  end if;

  v_result := public.push_register_subscription(
    p_installation_id, p_expo_push_token, p_platform, p_app_version, p_sequence, true, p_purchase_id
  );
  if (v_result ->> 'applied')::boolean then
    update public.push_subscriptions
       set app_transaction_hmac = v_hmac
     where installation_id = p_installation_id;
  end if;
  return v_result || jsonb_build_object(
    'renewed', coalesce(v_reason = 'consent_revoked', false) and (v_result ->> 'applied')::boolean
  );
end;
$$;

revoke execute on function public.register_push_subscription_with_revocation_key(text, text, text, text, bigint, text, text)
  from public;
grant execute on function public.register_push_subscription_with_revocation_key(text, text, text, text, bigint, text, text)
  to anon, authenticated;

-- ── 4. The export: the new fields, the id redacted ──────────────────────────
--
-- Re-bodied from 20261016000000 with five approved push_registrations fields
-- (src/lib/privacy-requests.ts EXPORT_FIELDS; the migration test holds the two
-- equal). The purchase id is exported as its last 4 characters only:
-- the full id unlocks the subscription in RevenueCat's SDK.

create or replace function public.export_installation_data(
  p_installation_id text
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_installation_id is null
     or p_installation_id !~ '^[A-Za-z0-9-]{16,64}$' then
    raise exception 'invalid installation id';
  end if;

  return jsonb_build_object(
    'exported_at', now(),
    'preferences', (
      select jsonb_build_object(
               'state_codes', p.state_codes,
               'allergens', p.allergens,
               'retailer_ids', p.retailer_ids,
               'allergen_consent_version', to_jsonb(p) -> 'allergen_consent_version',
               'allergen_consent_at', to_jsonb(p) -> 'allergen_consent_at',
               'allergen_consent_decided_at', to_jsonb(p) -> 'allergen_consent_decided_at',
               'created_at', p.created_at,
               'updated_at', p.updated_at
             )
        from public.installation_preferences p
       where p.installation_id = p_installation_id
    ),
    'push_registrations', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'platform', s.platform,
                 'app_version', s.app_version,
                 'enabled', s.enabled,
                 'enabled_at', s.enabled_at,
                 'registered_at', s.registered_at,
                 'last_seen_at', s.last_seen_at,
                 'disabled_at', s.disabled_at,
                 'disabled_reason', s.disabled_reason,
                 'push_token', '…' || right(rtrim(s.expo_push_token, ']'), 4),
                 'last_token_error', regexp_replace(
                   s.last_token_error, 'ExponentPushToken\[[^]]*\]', 'ExponentPushToken[…]', 'g'
                 ),
                 'purchase_id_last4', right(s.purchase_id, 4),
                 'entitlement_status', s.entitlement_status,
                 'entitlement_expires_at', s.entitlement_expires_at,
                 'entitlement_checked_at', s.entitlement_checked_at,
                 'entitled_since', s.entitled_since
               )
               order by s.registered_at)
        from public.push_subscriptions s
       where s.installation_id = p_installation_id
    ), '[]'::jsonb),
    'alert_order', (
      select jsonb_build_object(
               'last_sequence', q.last_sequence,
               'last_operation', q.last_operation,
               'updated_at', q.updated_at
             )
        from public.push_installation_sequences q
       where q.installation_id = p_installation_id
    ),
    'alerts_sent', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'recall_id', e.recall_case_id,
                 'kind', e.kind,
                 'created_at', d.created_at,
                 'sent_at', d.sent_at,
                 'status', d.status,
                 'failure_code', d.failure_code
               )
               order by d.created_at)
        from public.notification_deliveries d
        join public.push_subscriptions s on s.id = d.subscription_id
        join public.notification_events e on e.id = d.event_id
       where s.installation_id = p_installation_id
    ), '[]'::jsonb),
    'last_opened_on', (
      select a.last_active_on
        from public.installation_activity a
       where a.installation_id = p_installation_id
    ),
    'shopper_reports', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'recall_id', r.recall_case_id,
                 'state_code', r.state_code,
                 'retailer_name', r.retailer_name,
                 'purchase_window', r.purchase_window,
                 'created_at', r.created_at,
                 'updated_at', r.updated_at
               )
               order by r.created_at)
        from public.shopper_reports r
       where r.installation_id = p_installation_id
    ), '[]'::jsonb),
    'request_codes', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'purpose', c.purpose,
                 'created_at', c.created_at,
                 'expires_at', c.expires_at,
                 'used_at', c.used_at
               )
               order by c.created_at)
        from public.installation_request_codes c
       where c.installation_id = p_installation_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.export_installation_data(text) from public;
grant execute on function public.export_installation_data(text)
  to anon, authenticated, service_role;
