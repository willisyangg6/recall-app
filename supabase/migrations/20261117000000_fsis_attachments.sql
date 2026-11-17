-- FSIS notice attachments: verified product facts from official PDFs.
--
-- Purely additive. Two changes:
--
-- 1. `fsis_attachments` — one row per (FSIS source record, attachment URL):
--    the product list ("View the list of products…") or label document
--    ("View labels") a notice links, the sha256 of the bytes last read, the
--    verdict (verified / needs_review / unreadable) with its reasons, and
--    the extraction itself (the parsed table with page numbers, or each
--    label page's printed caption). A revised PDF at the same URL updates
--    its row and keeps the previous hash — never a second row. Server-side
--    operations data: service role only, exactly like retailer_notices.
--
-- 2. `product_visuals.caption` — the printed caption of a rendered label
--    page ("Bami Rolls (Pork)"), read from the PDF's text layer. Null for a
--    page with no text. It is the evidence that ties a page to one product
--    row; page order never is. Readable by the app through the existing
--    table-level select grant.

create table public.fsis_attachments (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid not null references public.source_records (id) on delete cascade,
  url text not null check (url ~ '^https://'),
  kind text not null check (kind in ('labels', 'product_list')),
  link_text text not null,
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  previous_sha256 text check (previous_sha256 is null or previous_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('verified', 'needs_review', 'unreadable')),
  review_reasons text[] not null default '{}',
  extraction jsonb check (extraction is null or jsonb_typeof(extraction) = 'object'),
  fetched_at timestamptz not null,
  revised_at timestamptz,
  created_at timestamptz not null default now(),
  unique (source_record_id, url),
  -- A verified attachment always has the bytes it was verified from.
  constraint fsis_attachments_verified_has_hash check (status <> 'verified' or sha256 is not null)
);

create index fsis_attachments_review_idx on public.fsis_attachments (status)
  where status <> 'verified';

alter table public.fsis_attachments enable row level security;
revoke all on table public.fsis_attachments from public, anon, authenticated;
grant select, insert, update on table public.fsis_attachments to service_role;

alter table public.product_visuals add column caption text;

do $$
declare
  leaked text;
begin
  select string_agg(format('%s.%s', grantee, privilege_type), ', ')
    into leaked
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name = 'fsis_attachments'
     and grantee in ('anon', 'authenticated', 'PUBLIC');
  if leaked is not null then
    raise exception 'fsis_attachments is reachable by client roles: %', leaked;
  end if;
end;
$$;
