-- Personalized alerts for approved retailer-only notices
-- (docs/recall-push-delivery.md, "Retailer-only notices").
--
-- NOT APPLIED. Additive for every existing row:
--
-- 1. A notification event names EXACTLY ONE subject: an agency case
--    (recall_case_id, every existing row) or an approved retailer notice
--    (retailer_notice_id, new). The exactly-one-initial and no-duplicate-update
--    invariants stay on the existing unique dedup_key.
-- 2. No grant changes. notification_events keeps RLS with no client policy;
--    retailer notices stay unreachable by client roles.
-- 3. export_installation_data gains alerts_sent.retailer_notice_id (below).
--
-- Rollout constraint: apply this BEFORE merging the worker that reads
-- retailer_notice_id, and create no retailer event before that worker is the
-- scheduled code (the previous worker requires a joined recall case).

alter table public.notification_events
  alter column recall_case_id drop not null;

alter table public.notification_events
  add column retailer_notice_id uuid references public.retailer_notices (id);

alter table public.notification_events
  add constraint notification_events_one_subject
  check (num_nonnulls(recall_case_id, retailer_notice_id) = 1);

create index notification_events_retailer_notice_idx
  on public.notification_events (retailer_notice_id)
  where retailer_notice_id is not null;

comment on column public.notification_events.retailer_notice_id is
  'The approved retailer-only notice this event announces (exactly one of '
  'recall_case_id / retailer_notice_id). Delivered only while the notice is '
  'still returned by consumer_retailer_notices().';

-- 3. The privacy export names the notice a retailer alert announced. Every
--    existing field is kept as it was; alerts_sent gains one key,
--    retailer_notice_id (null for an agency alert, as recall_id is null for a
--    retailer alert). The id is the notice's public identifier, the one its
--    alert opens in the app. Re-bodied from 20261018000000 with that single
--    change (src/lib/privacy-requests.ts EXPORT_FIELDS; the migration test
--    holds the two equal). Same signature, grants and security definer.

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
                 'retailer_notice_id', e.retailer_notice_id,
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

do $$
declare
  leaked text;
begin
  select string_agg(grantee || ':' || privilege_type, ', ')
    into leaked
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'notification_events'
    and grantee in ('anon', 'authenticated', 'PUBLIC');
  if leaked is not null then
    raise exception 'notification_events is reachable by a client role: %', leaked;
  end if;
end $$;
