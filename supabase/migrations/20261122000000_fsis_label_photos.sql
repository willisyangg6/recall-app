-- FSIS label photographs (docs/recall-imagery.md §16).
--
-- The product photographs placed INSIDE an announcement's official label
-- documents (PDFs, image files, linked pages), cropped server-side
-- (src/server/fsis/label-photos.ts) into the public product-visuals bucket.
-- A full rendered label page stays in product_visuals exactly as before;
-- shipped builds keep reading only that table, so nothing they show changes.
--
-- Rows are derived, re-creatable read-model data: provenance is the source
-- document URL and its sha256 on each row. Purely additive.

create table public.fsis_label_photos (
  id uuid primary key default gen_random_uuid(),
  recall_case_id uuid not null references public.recall_cases (id) on delete cascade,
  source_record_id uuid references public.source_records (id),
  -- The official document the photo was taken from, and its bytes' hash.
  source_url text not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  -- 1-based page (1 for an image file) and the image's drawing order on it.
  page integer not null check (page >= 1),
  image_index integer not null check (image_index >= 0),
  -- Document order across the case's sources: the carousel order.
  position integer not null check (position >= 0),
  -- Public URL of the hosted crop (Supabase Storage).
  url text not null,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  -- sha256 of the stored crop bytes.
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  -- 64-bit difference hash: the same photograph re-encoded in another
  -- document is one photo, not two.
  dhash text not null check (dhash ~ '^[0-9a-f]{16}$'),
  -- product: a package photograph. detail: a strip or close-up (a side
  -- panel, a date code) — shown after the products, never a card or row image.
  kind text not null check (kind in ('product', 'detail')),
  -- The printed text that names this photo in its document, or null.
  caption text,
  created_at timestamptz not null default now(),
  unique (source_url, source_sha256, page, image_index),
  -- One stored copy of a photograph per case, whichever document carried it.
  unique (recall_case_id, content_hash)
);

create index fsis_label_photos_case_idx on public.fsis_label_photos (recall_case_id, position);

alter table public.fsis_label_photos enable row level security;

-- Recall photos are public exactly as recall cases and product visuals are.
create policy "public read of fsis label photos"
  on public.fsis_label_photos for select
  to anon, authenticated
  using (true);

grant select on public.fsis_label_photos to anon, authenticated;
grant select, insert, update, delete on public.fsis_label_photos to service_role;

-- Private ledger of label sources read for photos: one row per case and
-- source URL, so a document that yields no photograph (a panels-only sheet)
-- is not fetched again every tick, and a failing one backs off.
create table public.fsis_label_photo_sources (
  recall_case_id uuid not null references public.recall_cases (id) on delete cascade,
  source_url text not null,
  -- How the source was found and what it is: a PDF, an image file, a page.
  source_kind text not null check (source_kind in ('pdf', 'image', 'page')),
  source_sha256 text check (source_sha256 is null or source_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('done', 'failed')),
  photos integer not null default 0 check (photos >= 0),
  dropped jsonb not null default '{}' check (jsonb_typeof(dropped) = 'object'),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  processed_at timestamptz not null,
  primary key (recall_case_id, source_url)
);

alter table public.fsis_label_photo_sources enable row level security;
revoke all on table public.fsis_label_photo_sources from public, anon, authenticated;
grant select, insert, update, delete on table public.fsis_label_photo_sources to service_role;

-- Fail closed: the Data API roles may READ this table and nothing more.
do $$
declare
  extra text;
begin
  select string_agg(grantee || ':' || privilege_type, ', ')
    into extra
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'fsis_label_photos'
    and grantee in ('anon', 'authenticated', 'PUBLIC')
    and privilege_type <> 'SELECT';
  if extra is not null then
    raise exception 'fsis_label_photos grants a client role more than SELECT: %', extra;
  end if;
  if not has_table_privilege('anon', 'public.fsis_label_photos', 'SELECT') then
    raise exception 'Deliberate SELECT grant lost: fsis_label_photos';
  end if;
  select string_agg(grantee || ':' || privilege_type, ', ')
    into extra
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'fsis_label_photo_sources'
    and grantee in ('anon', 'authenticated', 'PUBLIC');
  if extra is not null then
    raise exception 'fsis_label_photo_sources is reachable by a client role: %', extra;
  end if;
end $$;
