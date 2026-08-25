-- Product visuals derived from official source documents (FSIS label PDFs).
--
-- FSIS notices supply no inline product photography; their official label
-- PDFs are rasterized once, server-side (scripts/render-fsis-labels.ts), into
-- hosted page images that join the ordinary Product Photos gallery. Rows here
-- are derived, re-creatable read-model data: the authoritative provenance is
-- the source PDF URL preserved on each row (and the notice's own summary
-- HTML). Nothing existing is altered by this migration — it is purely
-- additive.

create table public.product_visuals (
  id uuid primary key default gen_random_uuid(),
  recall_case_id uuid not null references public.recall_cases (id) on delete cascade,
  source_record_id uuid references public.source_records (id),
  -- The official document this image was rendered from (provenance).
  source_url text not null,
  -- sha256 of the source PDF bytes at render time; a changed PDF re-renders
  -- under new content-addressed storage keys and replaces these rows.
  source_sha256 text not null,
  -- 1-based page number in the source document; source order is preserved.
  page integer not null,
  -- Public URL of the hosted rendered image (Supabase Storage).
  url text not null,
  -- Semantic role in the photo system; label pages are package_label.
  role text not null default 'package_label'
    check (role in ('package_front', 'package_full', 'package_back', 'package_label',
                    'product_only', 'barcode_closeup', 'code_closeup', 'other_supporting')),
  width integer,
  height integer,
  -- sha256 of the rendered image bytes (duplicate-page suppression).
  content_hash text not null,
  created_at timestamptz not null default now(),
  -- One row per rendered page per source-document revision.
  unique (source_url, source_sha256, page)
);

create index product_visuals_case_idx on public.product_visuals (recall_case_id, page);

alter table public.product_visuals enable row level security;

-- Recall visuals are public exactly as recall cases are.
create policy "public read of product visuals"
  on public.product_visuals for select
  to anon, authenticated
  using (true);

grant select on public.product_visuals to anon, authenticated;
grant select, insert, update, delete on public.product_visuals to service_role;

-- Public bucket for the rendered label images. Objects are content-addressed
-- (fsis-labels/<pdf-sha>/p<page>.webp), served read-only to the app; writes
-- go through the service role only. Idempotent insert: re-running this
-- migration or the render script never duplicates the bucket.
insert into storage.buckets (id, name, public)
values ('product-visuals', 'product-visuals', true)
on conflict (id) do nothing;

create policy "public read of product visual objects"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'product-visuals');
