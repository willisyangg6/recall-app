-- FDA Phase B: enforcement-record linkage (additive only).
--
-- Matched openFDA enforcement records join their RecallCase through the
-- existing source_records / source_snapshots architecture (source_system
-- 'openfda_enforcement', native_id = recall_number). The only schema change
-- required is teaching the link_method CHECK the honest name for this
-- relationship: 'enforcement_match' — an authoritative FDA enforcement
-- record reconciled to the announcement's case by the evidence-gated
-- matcher (src/server/fda-enforcement/match.ts). Match evidence, method,
-- and matcher version travel inside the record's normalized payload;
-- raw openFDA payloads are preserved as ordinary hash-gated snapshots.
--
-- No table is created or dropped and no row is touched. The original CHECK
-- was declared inline (auto-named), so it is located by definition rather
-- than by an assumed name. Existing link_method values remain valid.

do $$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'source_records'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) like '%link_method%';
  if constraint_name is not null then
    execute format('alter table public.source_records drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.source_records
  add constraint source_records_link_method_check
  check (link_method in ('self', 'expansion_prefix', 'retraction_reference', 'enforcement_match'));
