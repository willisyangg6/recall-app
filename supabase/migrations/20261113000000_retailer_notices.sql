-- Retailer notice monitoring (Costco first). PREPARED, NOT APPLIED.
--
-- Two PRIVATE tables that hold what a retailer published and what the
-- monitor decided about it (docs/recall-retailer-notices.md). They are not
-- part of the consumer surface: no client role can read or write them, no
-- view exposes them, and nothing in the recall pipeline reads them. The
-- monitor writes ONLY these two tables; it never writes recall_cases,
-- source_records, affected_products or notification_events.
--
--   retailer_notices           one row per index entry (publisher, native_id):
--                              stated facts, evidence, and the decision
--                              (new_candidate | link_candidate | review | excluded)
--   retailer_notice_documents  append-only document versions, one per
--                              (notice, content hash): the original bytes
--                              and the text read from them
--
-- Absence of knowledge is NULL / '{}', never a guessed default. Two time
-- families are kept apart on purpose: stated_notice_date is what the
-- document says; first_seen_at / last_seen_on_index_at are what we measured.
-- A notice leaving the index changes nothing (there is no status column a
-- disappearance could flip).
--
-- link_case_id is a plain uuid, NOT a foreign key: a retailer proposal must
-- never constrain, block or cascade into recall_cases.

-- ── 1. Notices ──────────────────────────────────────────────────────────────

create table public.retailer_notices (
  id uuid primary key default gen_random_uuid(),
  publisher text not null check (publisher in ('costco')),
  native_id text not null check (native_id <> ''),
  index_label text,
  index_title text not null,
  index_url text not null,
  document_url text not null,
  first_seen_at timestamptz not null,
  last_seen_on_index_at timestamptz not null,
  stated_notice_date date,
  stated_notice_date_text text,
  recalling_firm_text text,
  agencies_named text[] not null default '{}',
  notice_kind text not null
    check (notice_kind in ('recall', 'public_health_alert', 'quality_notice', 'unclear')),
  food_status text not null check (food_status in ('food', 'non_food', 'unclear')),
  retailer_item_numbers text[] not null default '{}',
  upcs text[] not null default '{}',
  code_evidence text[] not null default '{}',
  package_claims jsonb not null default '[]' check (jsonb_typeof(package_claims) = 'array'),
  state_claims jsonb not null default '[]' check (jsonb_typeof(state_claims) = 'array'),
  index_scope_text text,
  evidence jsonb not null default '{}' check (jsonb_typeof(evidence) = 'object'),
  document_extraction text not null
    check (document_extraction in ('text', 'image_only', 'failed')),
  document_content_hash text not null check (document_content_hash ~ '^[0-9a-f]{64}$'),
  decision text not null
    check (decision in ('new_candidate', 'link_candidate', 'review', 'excluded')),
  decision_reasons text[] not null default '{}',
  link_case_id uuid,
  candidate_case_ids uuid[] not null default '{}',
  agency_lag_days integer,
  decided_at timestamptz not null,
  parser_version text not null,
  unique (publisher, native_id),
  -- Only a consistent single match is a link; every other decision has none.
  constraint retailer_notices_link_matches_decision
    check ((decision = 'link_candidate') = (link_case_id is not null)),
  constraint retailer_notices_seen_order check (last_seen_on_index_at >= first_seen_at)
);

create index retailer_notices_decision_idx on public.retailer_notices (decision, publisher);

-- ── 2. Document versions (append-only, hash-gated) ──────────────────────────

create table public.retailer_notice_documents (
  id bigint generated always as identity primary key,
  notice_id uuid not null references public.retailer_notices (id) on delete cascade,
  fetched_at timestamptz not null,
  document_url text not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  content_type text,
  byte_length integer not null check (byte_length > 0 and byte_length <= 8388608),
  document_bytes bytea not null,
  extracted_text text,
  index_entry jsonb not null,
  unique (notice_id, content_hash)
);

-- ── 3. Private: no client role, no policy, service role only ───────────────

alter table public.retailer_notices enable row level security;
alter table public.retailer_notice_documents enable row level security;
-- No policies on purpose: with RLS on and no policy, a role that somehow held
-- a grant would still read zero rows. The revokes remove the grants too.

revoke all on table public.retailer_notices from public, anon, authenticated;
revoke all on table public.retailer_notice_documents from public, anon, authenticated;

grant select, insert, update on table public.retailer_notices to service_role;
-- Documents are append-only: no update for anyone.
grant select, insert on table public.retailer_notice_documents to service_role;

-- ── 4. Fail closed if a client role can still reach either table ───────────

do $$
declare
  leaked text;
begin
  select string_agg(format('%s.%s', grantee, privilege_type), ', ')
    into leaked
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('retailer_notices', 'retailer_notice_documents')
     and grantee in ('anon', 'authenticated', 'PUBLIC');
  if leaked is not null then
    raise exception 'Retailer notice tables are reachable by client roles: %', leaked;
  end if;

  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname in ('retailer_notices', 'retailer_notice_documents')
       and not c.relrowsecurity
  ) then
    raise exception 'Retailer notice tables must have row level security enabled';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('retailer_notices', 'retailer_notice_documents')
  ) then
    raise exception 'Retailer notice tables must have no policies';
  end if;
end;
$$;

comment on table public.retailer_notices is
  'PRIVATE. Retailer-published recall notices and the monitor''s decision about each. '
  'Service role only; never read by the app. docs/recall-retailer-notices.md';
comment on table public.retailer_notice_documents is
  'PRIVATE. Append-only original documents behind retailer_notices, one per content hash.';
