-- FSIS vertical slice: canonical recall persistence, per docs/recall-domain-architecture.md.
--
-- Entities: recall_cases (consumer unit), source_records (per government
-- record), source_snapshots (append-only raw payloads, hash-gated),
-- affected_products, notification_events (append-only ledger), plus the
-- operational ingest_runs table.
--
-- Security model: all tables have RLS enabled. The mobile client (anon /
-- authenticated roles) can SELECT the consumer read model only (recall_cases,
-- affected_products). Everything else — and every write — is reachable only
-- through the service role used by server-side ingestion.

-- ── Consumer unit ────────────────────────────────────────────────────────────

create table public.recall_cases (
  id uuid primary key default gen_random_uuid(),
  -- The canonical consumer projection (CaseProjection in src/domain).
  -- Authoritative for material-change diffing; read-model columns below are
  -- generated from it so the two can never drift.
  projection jsonb not null,
  timeline jsonb not null default '[]'::jsonb,
  merged_into uuid references public.recall_cases (id),
  created_at timestamptz not null default now(),
  last_changed_at timestamptz not null,
  -- Generated read-model columns (dates stay ISO text: '::date' casts are not
  -- immutable, and ISO strings order correctly anyway).
  source_agency text generated always as (projection ->> 'sourceAgency') stored,
  notice_type text generated always as (projection ->> 'noticeType') stored,
  state text generated always as (projection ->> 'state') stored,
  title text generated always as (projection ->> 'title') stored,
  classification_value text generated always as (projection -> 'classification' ->> 'value') stored,
  hazard_category text generated always as (projection ->> 'hazardCategory') stored,
  published_at text generated always as (projection ->> 'publishedAt') stored,
  last_public_activity_at text generated always as (projection ->> 'lastPublicActivityAt') stored,
  constraint recall_cases_notice_type_check
    check (notice_type in ('recall', 'public_health_alert')),
  constraint recall_cases_state_check
    check (state in ('active', 'closed', 'retracted'))
);

create index recall_cases_feed_idx
  on public.recall_cases (state, last_public_activity_at desc, published_at desc);

-- ── Source records and snapshots ─────────────────────────────────────────────

create table public.source_records (
  id uuid primary key default gen_random_uuid(),
  source_system text not null,
  native_id text not null,
  recall_case_id uuid not null references public.recall_cases (id),
  link_method text not null
    check (link_method in ('self', 'expansion_prefix', 'retraction_reference')),
  normalized jsonb not null,
  source_url text not null,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  unique (source_system, native_id)
);

create index source_records_case_idx on public.source_records (recall_case_id);

create table public.source_snapshots (
  id uuid primary key default gen_random_uuid(),
  -- Monotonic insert order; "latest snapshot" must not depend on timestamp ties.
  seq bigint generated always as identity,
  source_record_id uuid not null references public.source_records (id),
  fetched_at timestamptz not null,
  content_hash text not null,
  raw_payload jsonb not null,
  source_url text not null
);

create index source_snapshots_record_idx on public.source_snapshots (source_record_id, seq desc);

-- ── Affected products (read model, replaced on re-projection) ────────────────

create table public.affected_products (
  id uuid primary key default gen_random_uuid(),
  recall_case_id uuid not null references public.recall_cases (id) on delete cascade,
  ordinal integer not null,
  source_native_id text not null,
  name text not null,
  raw_text text not null,
  extraction_confidence text not null check (extraction_confidence in ('stated', 'extracted')),
  unique (recall_case_id, ordinal)
);

-- ── Notification ledger (append-only; no delivery in this milestone) ─────────

create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  recall_case_id uuid not null references public.recall_cases (id),
  kind text not null check (kind in ('initial', 'material_update')),
  trigger_rule_id text not null,
  -- Exactly-one-initial and no-duplicate-update invariants live here.
  dedup_key text not null unique,
  material_change_ref text,
  payload_summary text not null,
  suppressed text check (suppressed in ('backfill', 'coalesced')),
  source_snapshot_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create index notification_events_case_idx
  on public.notification_events (recall_case_id, kind, created_at desc);

-- ── Operational ──────────────────────────────────────────────────────────────

create table public.ingest_runs (
  id uuid primary key default gen_random_uuid(),
  source_system text not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  outcome text check (outcome in ('succeeded', 'failed')),
  items_seen integer,
  items_changed integer,
  quarantined jsonb not null default '[]'::jsonb,
  error text
);

create index ingest_runs_source_idx on public.ingest_runs (source_system, started_at desc);

-- ── Row Level Security ───────────────────────────────────────────────────────

alter table public.recall_cases enable row level security;
alter table public.source_records enable row level security;
alter table public.source_snapshots enable row level security;
alter table public.affected_products enable row level security;
alter table public.notification_events enable row level security;
alter table public.ingest_runs enable row level security;

-- Recall information is public: the mobile client may read the consumer model.
create policy "public read of recall cases"
  on public.recall_cases for select
  to anon, authenticated
  using (merged_into is null);

create policy "public read of affected products"
  on public.affected_products for select
  to anon, authenticated
  using (true);

-- No other policies exist: provenance/ledger/ops tables and ALL writes are
-- service-role only (RLS is bypassed by the service role; anon has no path).

-- ── Grants ───────────────────────────────────────────────────────────────────
-- New Supabase projects no longer auto-expose tables to the Data API roles,
-- so grants are explicit. anon/authenticated: read-only on the two consumer
-- tables (RLS still applies). service_role: full access for ingestion.

grant select on public.recall_cases, public.affected_products to anon, authenticated;

grant select, insert, update, delete on
  public.recall_cases,
  public.source_records,
  public.source_snapshots,
  public.affected_products,
  public.notification_events,
  public.ingest_runs
to service_role;
