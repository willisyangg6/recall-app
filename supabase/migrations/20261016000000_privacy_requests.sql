-- Privacy-rights requests (2026-10-13, proposal §3): an in-app view and
-- export of what Lotly's server holds for an installation, and a request
-- code the app creates for an email request (a copy of the data, or its
-- deletion). PREPARED, NOT APPLIED.
--
-- ── The principle ───────────────────────────────────────────────────────────
--
-- The installation id is a bearer credential held in the device keychain. It
-- is never shown, typed, emailed or used as proof. A request that comes FROM
-- the installation (the export view, "Reset app and delete my data") needs
-- nothing more. An email request carries a request code instead: the app
-- creates it with the installation's own credential, so presenting it shows
-- the requester controlled that installation when it was issued.
--
-- ── The request code ────────────────────────────────────────────────────────
--
--   * 12 characters from a 32-character alphabet (Crockford base 32: no I,
--     L, O or U), about 60 bits, drawn on the server from gen_random_bytes.
--     A byte masked to 5 bits is uniform over 32 symbols.
--   * The server stores ONLY sha256(code) as hex, with the installation id,
--     the purpose chosen in the app ('access' or 'delete'), created_at,
--     expires_at (created + 14 days, a CHECK) and used_at. The plain code
--     exists only in the create call's response and on the device's screen.
--   * At most 3 live codes per installation; a new one revokes (deletes)
--     the oldest live code beyond the newest two.
--   * Single use. Redemption marks used_at under a row lock with the
--     predicate `used_at is null and expires_at > now()`, so a second
--     redemption, concurrent or later, finds nothing.
--   * Guessing. Only the service role can look a code up or redeem it: the
--     table has no client grants and both functions are service-role only,
--     so the app's public key cannot test a code at all. An emailed guess
--     reaches the operator, who would need ~2^59 attempts on average.
--   * It authorizes nothing by itself: it is a reference the operator uses
--     to find one installation for the one purpose chosen in the app.
--   * Cleanup. Spent codes (used, or expired) are deleted 30 days later by a
--     daily job; every code goes immediately with the installation's data
--     ("Reset app and delete my data", the inactivity purge, or a redeemed
--     deletion request), because delete_installation_data covers the table.
--
-- ── Logs ────────────────────────────────────────────────────────────────────
--
-- No function here raises an error carrying a code, a hash, an installation
-- id or preference contents; messages are fixed strings. The create call's
-- request carries no code (the code is in its RESPONSE body), and the
-- operator CLI sends only the hash.

create extension if not exists pgcrypto with schema extensions;

-- ── 1. The request codes ────────────────────────────────────────────────────

create table public.installation_request_codes (
  code_hash text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  installation_id text not null check (installation_id ~ '^[A-Za-z0-9-]{16,64}$'),
  purpose text not null check (purpose in ('access', 'delete')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  constraint request_code_lifetime check (expires_at = created_at + interval '14 days'),
  constraint request_code_used_while_live check (
    used_at is null or (used_at >= created_at and used_at < expires_at)
  )
);

create index installation_request_codes_installation_idx
  on public.installation_request_codes (installation_id);

alter table public.installation_request_codes enable row level security;
-- No policies, no client grants: reachable only through the functions below.
grant select, insert, update, delete on public.installation_request_codes to service_role;

-- ── 2. What the server holds, for one installation ──────────────────────────
--
-- An EXPLICIT list of approved fields (2026-10-13, founder correction): a
-- column a later migration adds is NOT exported until it is added here on
-- purpose, so an internal value (an age or consent-revocation key, a hash)
-- can never reach a person's export by accident. The same list is
-- src/lib/privacy-requests.ts EXPORT_FIELDS; privacy-requests-migration.test.ts
-- holds the two equal and privacy-requests-live.test.ts proves a new column
-- stays out.
--
-- Left out on purpose:
--   installation_id (every table)   a bearer credential: it can read and
--                                   delete this data
--   push_subscriptions.expo_push_token   shown only as its last 4 characters;
--                                   the full token addresses notifications
--   push_subscriptions.id           an internal row id linking deliveries
--   installation_preferences.state_code  the older single-state copy of the
--                                   first entry in state_codes
--   installation_preferences.user_id     reserved for accounts; never set
--   shopper_reports.id, .version    internal row id and edit counter
--   installation_request_codes.code_hash a scrambled form of the code, used
--                                   only to check a code someone sends
--
-- The allergen consent record (allergen_consent_version / _at / _decided_at)
-- is approved. It is read by name from to_jsonb(p), so this function works
-- before and after the allergen-consent migration: a missing column reads as
-- null, and no unlisted column is ever emitted.

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
                 )
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

-- ── 3. Creating a code (the app) ────────────────────────────────────────────

create or replace function public.create_privacy_request_code(
  p_installation_id text,
  p_purpose text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_created timestamptz := now();
  v_bytes bytea;
  v_code text;
  v_index integer;
begin
  if p_installation_id is null
     or p_installation_id !~ '^[A-Za-z0-9-]{16,64}$' then
    raise exception 'invalid installation id';
  end if;
  if p_purpose is null or p_purpose not in ('access', 'delete') then
    raise exception 'invalid request purpose';
  end if;

  -- Serializes with this installation's other code creations (so the cap
  -- below holds), its redemptions, its check-in and the inactivity purge.
  perform pg_advisory_xact_lock(hashtextextended('installation:' || p_installation_id, 0));

  -- Keep at most 3 live: revoke every live code beyond the newest two.
  delete from public.installation_request_codes c
   where c.code_hash in (
     select live.code_hash
       from public.installation_request_codes live
      where live.installation_id = p_installation_id
        and live.used_at is null
        and live.expires_at > v_created
      order by live.created_at desc, live.code_hash
     offset 2
   );

  loop
    v_bytes := extensions.gen_random_bytes(12);
    v_code := '';
    for v_index in 0..11 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, v_index) & 31) + 1, 1);
    end loop;
    begin
      insert into public.installation_request_codes
        (code_hash, installation_id, purpose, created_at, expires_at)
      values (
        encode(sha256(convert_to(v_code, 'UTF8')), 'hex'),
        p_installation_id,
        p_purpose,
        v_created,
        v_created + interval '14 days'
      );
      exit;
    exception when unique_violation then
      -- A 60-bit collision: astronomically unlikely, and harmless. Draw again.
      null;
    end;
  end loop;

  return jsonb_build_object(
    'code', v_code,
    'purpose', p_purpose,
    'expires_at', v_created + interval '14 days'
  );
end;
$$;

revoke execute on function public.create_privacy_request_code(text, text) from public;
grant execute on function public.create_privacy_request_code(text, text)
  to anon, authenticated, service_role;

-- ── 4. Looking a code up and redeeming it (the operator, service role) ──────

-- Row counts per table for one installation: the dry run's report and the
-- redemption's count gate. Counts only, never contents.
create or replace function public.installation_data_row_counts(
  p_installation_id text
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'preferences', c.preferences,
    'push_registrations', c.push_registrations,
    'alerts_sent', c.alerts_sent,
    'alert_order', c.alert_order,
    'last_opened', c.last_opened,
    'shopper_reports', c.shopper_reports,
    'request_codes', c.request_codes,
    'total', c.preferences + c.push_registrations + c.alerts_sent + c.alert_order
             + c.last_opened + c.shopper_reports + c.request_codes
  )
  from (
    select
      (select count(*) from public.installation_preferences
        where installation_id = p_installation_id) as preferences,
      (select count(*) from public.push_subscriptions
        where installation_id = p_installation_id) as push_registrations,
      (select count(*) from public.notification_deliveries d
         join public.push_subscriptions s on s.id = d.subscription_id
        where s.installation_id = p_installation_id) as alerts_sent,
      (select count(*) from public.push_installation_sequences
        where installation_id = p_installation_id) as alert_order,
      (select count(*) from public.installation_activity
        where installation_id = p_installation_id) as last_opened,
      (select count(*) from public.shopper_reports
        where installation_id = p_installation_id) as shopper_reports,
      (select count(*) from public.installation_request_codes
        where installation_id = p_installation_id) as request_codes
  ) c;
$$;

-- The dry run. Reads only. Never returns the installation id: the operator
-- sees its first four characters, enough to tell two requests apart.
create or replace function public.lookup_privacy_request(
  p_code_hash text
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.installation_request_codes%rowtype;
  v_status text;
begin
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid code hash';
  end if;

  select * into v_row
    from public.installation_request_codes c
   where c.code_hash = p_code_hash;
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;

  v_status := case
    when v_row.used_at is not null then 'used'
    when v_row.expires_at <= now() then 'expired'
    else 'live'
  end;

  return jsonb_build_object(
    'status', v_status,
    'purpose', v_row.purpose,
    'installation_hint', left(v_row.installation_id, 4),
    'created_at', v_row.created_at,
    'expires_at', v_row.expires_at,
    'used_at', v_row.used_at,
    'counts', case when v_status = 'live'
                   then public.installation_data_row_counts(v_row.installation_id)
              end
  );
end;
$$;

-- The apply. One transaction: the code is consumed and the request carried
-- out together, or neither happens. p_expected_rows is the total the
-- operator reviewed in the dry run; if the installation's rows changed since,
-- nothing is consumed and the operator runs the dry run again.
create or replace function public.redeem_privacy_request(
  p_code_hash text,
  p_expected_rows integer
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_installation_id text;
  v_purpose text;
  v_counts jsonb;
  v_total integer;
  v_export jsonb;
begin
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid code hash';
  end if;

  -- Find the installation first, so its advisory lock is taken BEFORE the
  -- code's row lock: the same order create_privacy_request_code uses (lock,
  -- then revoke), so the two can never deadlock.
  select c.installation_id into v_installation_id
    from public.installation_request_codes c
   where c.code_hash = p_code_hash;
  if not found then
    return jsonb_build_object('status', 'not_redeemable');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('installation:' || v_installation_id, 0));

  -- Single use: the row lock makes a concurrent redemption wait, and its
  -- re-check then sees used_at set and finds nothing.
  select c.purpose into v_purpose
    from public.installation_request_codes c
   where c.code_hash = p_code_hash
     and c.installation_id = v_installation_id
     and c.used_at is null
     and c.expires_at > now()
   for update;
  if not found then
    return jsonb_build_object('status', 'not_redeemable');
  end if;

  v_counts := public.installation_data_row_counts(v_installation_id);
  v_total := (v_counts ->> 'total')::integer;
  if p_expected_rows is null or p_expected_rows <> v_total then
    -- Nothing has been written yet: the code stays live.
    return jsonb_build_object(
      'status', 'count_changed',
      'expected', p_expected_rows,
      'actual', v_total
    );
  end if;

  update public.installation_request_codes
     set used_at = now()
   where code_hash = p_code_hash
     and used_at is null
     and expires_at > now();

  if v_purpose = 'access' then
    v_export := public.export_installation_data(v_installation_id);
    return jsonb_build_object(
      'status', 'redeemed',
      'purpose', v_purpose,
      'counts', v_counts,
      'export', v_export
    );
  end if;

  -- 'delete': the same function the in-app reset and the inactivity purge
  -- use. It deletes this code too.
  perform public.delete_installation_data(v_installation_id);
  return jsonb_build_object(
    'status', 'redeemed',
    'purpose', v_purpose,
    'counts', v_counts
  );
end;
$$;

-- Daily: spent codes go 30 days after use or expiry.
create or replace function public.purge_spent_request_codes()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.installation_request_codes
   where coalesce(used_at, expires_at) < now() - interval '30 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.installation_data_row_counts(text) from public;
revoke execute on function public.lookup_privacy_request(text) from public;
revoke execute on function public.redeem_privacy_request(text, integer) from public;
revoke execute on function public.purge_spent_request_codes() from public;
grant execute on function public.installation_data_row_counts(text) to service_role;
grant execute on function public.lookup_privacy_request(text) to service_role;
grant execute on function public.redeem_privacy_request(text, integer) to service_role;
grant execute on function public.purge_spent_request_codes() to service_role;

-- ── 5. The reset covers the request codes ───────────────────────────────────
--
-- Re-bodied from the LATEST definition (20261013000000, the inactivity
-- retention migration) plus one statement. The effective-definition test
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

  delete from public.installation_request_codes
   where installation_id = p_installation_id;
end;
$$;

revoke execute on function public.delete_installation_data(text) from public;
grant execute on function public.delete_installation_data(text)
  to anon, authenticated, service_role;

-- ── 6. The daily cleanup ────────────────────────────────────────────────────

do $$
begin
  if exists (select 1 from cron.job where jobname = 'recall-request-code-cleanup') then
    perform cron.unschedule('recall-request-code-cleanup');
  end if;
end $$;

select cron.schedule(
  'recall-request-code-cleanup',
  '45 9 * * *',
  $CRON$ select public.purge_spent_request_codes(); $CRON$
);
