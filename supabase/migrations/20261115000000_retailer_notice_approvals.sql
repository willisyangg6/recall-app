-- Retailer notice approvals and the new client's read path
-- (docs/recall-retailer-notices.md, "Approval and the client read path").
--
-- NOT APPLIED. Additive: one private table and one read-only function. It
-- touches no existing table, column, policy or grant, so every installed
-- build keeps reading exactly what it reads today.
--
-- 1. retailer_notice_approvals (private, service role only): a reviewer's
--    approval of ONE archived letter, recorded with that letter's exact
--    SHA-256, the shopper-facing fields they approved, the verbatim excerpt
--    and page behind each field, and their notes. Evidence and notes never
--    leave this table.
--
-- 2. consumer_retailer_notices() (anon-executable, read-only): the approved,
--    standalone notices and their display-safe fields, and nothing else. A
--    notice is returned only while ALL of these hold, evaluated on every
--    read, so nothing has to remember to hide it:
--      - its approval is live (not withdrawn);
--      - no agency case has been confirmed as the same recall;
--      - the approval's document hash equals the notice's CURRENT document
--        hash, so a revised letter disappears until it is approved again;
--      - the monitor still classes it a standalone new candidate that is a
--        food recall read from a text letter (a later agency match moves it
--        to link_candidate or review, and that hides it too).
--
-- Retailer notices never enter recall_cases: shipped builds attribute every
-- case there to an agency ("FDA" for any non-FSIS source), so a retailer row
-- would be shown and alerted as an FDA recall.

-- ── 1. Approvals ────────────────────────────────────────────────────────────

create table public.retailer_notice_approvals (
  id uuid primary key default gen_random_uuid(),
  notice_id uuid not null references public.retailer_notices (id) on delete restrict,
  -- The exact letter the reviewer read (retailer_notice_documents.content_hash).
  document_content_hash text not null check (document_content_hash ~ '^[0-9a-f]{64}$'),
  fields_version integer not null check (fields_version = 1),
  -- The approved shopper-facing fields (src/lib/retailer-notice-fields.ts).
  fields jsonb not null check (jsonb_typeof(fields) = 'object'),
  -- Private: the verbatim excerpt and PDF page behind each approved field.
  field_evidence jsonb not null check (jsonb_typeof(field_evidence) = 'object'),
  -- Private: the reviewer's notes. Never returned to a client.
  review_notes text,
  approved_by text not null check (length(btrim(approved_by)) > 0),
  approved_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  withdrawn_reason text,
  -- A confirmed matching agency case. Deliberately not a foreign key: an
  -- approval can never constrain or cascade into recall_cases.
  agency_case_id uuid,
  agency_match_confirmed_at timestamptz,
  constraint retailer_notice_approvals_withdrawn_pair
    check ((withdrawn_at is null) = (withdrawn_reason is null)),
  constraint retailer_notice_approvals_agency_pair
    check ((agency_case_id is null) = (agency_match_confirmed_at is null))
);

-- At most one live approval per notice: a notice can appear once, never twice.
create unique index retailer_notice_approvals_one_live
  on public.retailer_notice_approvals (notice_id)
  where withdrawn_at is null;

alter table public.retailer_notice_approvals enable row level security;
revoke all on public.retailer_notice_approvals from public, anon, authenticated;
grant select, insert, update on public.retailer_notice_approvals to service_role;

comment on table public.retailer_notice_approvals is
  'Private reviewer approvals of retailer notices, bound to one document hash. '
  'Evidence and review notes are service-role only; clients read approved '
  'fields through consumer_retailer_notices() alone.';

-- ── 2. The client read path ─────────────────────────────────────────────────

-- SECURITY DEFINER with a pinned, empty search_path, like every client RPC in
-- this schema: it reads the private tables on the caller's behalf and returns
-- only the display-safe columns listed here. Clients gain no table privilege.
create function public.consumer_retailer_notices()
returns table (
  id uuid,
  publisher text,
  document_url text,
  notice_date date,
  approved_at timestamptz,
  fields jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.publisher, n.document_url, n.stated_notice_date, a.approved_at, a.fields
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

-- ── 3. Fail the migration if the private table is reachable ─────────────────

do $$
declare
  leaked text;
begin
  select string_agg(grantee || ':' || privilege_type, ', ')
    into leaked
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'retailer_notice_approvals'
    and grantee in ('anon', 'authenticated', 'PUBLIC');
  if leaked is not null then
    raise exception 'retailer_notice_approvals is reachable by a client role: %', leaked;
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.retailer_notice_approvals'::regclass) then
    raise exception 'retailer_notice_approvals must have row level security enabled';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'retailer_notice_approvals') then
    raise exception 'retailer_notice_approvals must have no policies';
  end if;
end $$;
