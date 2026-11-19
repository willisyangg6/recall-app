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
