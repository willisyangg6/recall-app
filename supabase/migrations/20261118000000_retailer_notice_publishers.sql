-- A second retailer notice source (ALDI), and the shared product category
-- (docs/recall-retailer-notices.md, "Sources" and "One presentation path").
--
-- NOT APPLIED. Three changes, all additive for existing rows:
--
-- 1. Widens the publisher CHECK: every existing row is 'costco' and still
--    satisfies it.
-- 2. Adds retailer_notice_approvals.product_categories: the shared server-side
--    classifier's answer for the approved product, written by the approval
--    tool. Nullable: an approval written before it holds no answer, which the
--    client reads as "no category", never as "other".
-- 3. Recreates consumer_retailer_notices() to also return that column. Every
--    visibility condition is unchanged, and an ALDI notice still needs a live
--    reviewer approval to be returned. The private tables stay unreachable
--    by client roles.

alter table public.retailer_notices
  drop constraint retailer_notices_publisher_check;

alter table public.retailer_notices
  add constraint retailer_notices_publisher_check
  check (publisher in ('costco', 'aldi'));

alter table public.retailer_notice_approvals
  add column product_categories jsonb;

comment on column public.retailer_notice_approvals.product_categories is
  'Derived, not reviewed: the shared food-category classifier''s ids for the '
  'approved product name, as agency cases store projection.productCategories.';

-- The return type changes, so the function is dropped and recreated with the
-- same body, conditions, owner rights and grants.
drop function public.consumer_retailer_notices();

create function public.consumer_retailer_notices()
returns table (
  id uuid,
  publisher text,
  document_url text,
  notice_date date,
  approved_at timestamptz,
  fields jsonb,
  product_categories jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.publisher, n.document_url, n.stated_notice_date, a.approved_at, a.fields,
    a.product_categories
  from public.retailer_notice_approvals a
  join public.retailer_notices n on n.id = a.notice_id
  where a.withdrawn_at is null
    and a.agency_case_id is null
    and a.document_content_hash = n.document_content_hash
    and a.fields_version = 1
    and n.decision = 'new_candidate'
    and n.notice_kind = 'recall'
    and n.food_status = 'food'
    and n.document_extraction = 'text'
    and n.stated_notice_date is not null
  order by n.stated_notice_date desc, n.id
$$;

revoke execute on function public.consumer_retailer_notices() from public;
grant execute on function public.consumer_retailer_notices() to anon, authenticated, service_role;

comment on function public.consumer_retailer_notices() is
  'Approved, standalone retailer notices with display-safe fields only. Hidden '
  'when withdrawn, when an agency match is confirmed, when the letter''s hash '
  'changes, or when the monitor no longer classes it a standalone food recall.';
