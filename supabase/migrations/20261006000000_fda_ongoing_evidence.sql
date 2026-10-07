-- FDA "still open" evidence for Affects You counting (2026-10-06).
--
-- One nullable column on recall_cases: the openFDA bulk-export date of the
-- last COMPLETE export in which at least one enforcement record linked to
-- (and owned by) this case had status `Ongoing`. Null means no such evidence.
--
-- What it is for. Affects You counts a matching recall older than the 60-day
-- window only when an agency affirmatively shows it is still open. FSIS does
-- that through lifecycle (`Active Recall`, already in `state`); FDA's only
-- signal is the enforcement report's per-product `status`, which never drives
-- lifecycle (architecture Phase B decision, unchanged). The client counts the
-- evidence only while it is at most 21 days old, so if refreshes stop the
-- devices fail closed on their own (src/lib/open-evidence.ts).
--
-- Why a column, not a projection key. The single writer is the enforcement
-- job's open-evidence sync (src/server/fda-enforcement/open-evidence-sync.ts),
-- which updates ONLY this column. A status change therefore never touches
-- `projection`, `timeline`, `last_changed_at`, affected products or the
-- notification ledger: it cannot re-date a recall, move it in a newest-first
-- feed, or send a push. apply_case_transition updates only projection,
-- timeline and last_changed_at, so ingestion never overwrites this column and
-- this column never conflicts with ingestion's compare-and-set.
--
-- Read surface. `grant select on public.recall_cases` is table-level
-- (20260821193721), so anon reads the column through the existing RLS policy
-- with no new grant. The consumer manifest token is extended so a change to
-- the column moves the token — and is defined so that a NULL column leaves
-- every token byte-identical to the C8 formula: applying this migration
-- re-downloads nothing on any device.
--
-- Expand only: a nullable column and a token formula that is unchanged for
-- every existing row. No data is written here.

alter table public.recall_cases
  add column fda_ongoing_as_of date null;

comment on column public.recall_cases.fda_ongoing_as_of is
  'openFDA export date of the last complete export in which an enforcement '
  'record linked to this case had status Ongoing; null = no such evidence. '
  'Written only by the fda_enforcement open-evidence sync; never by ingestion.';

create or replace view public.consumer_feed_manifest
with (security_invoker = true) as
select
  rc.id,
  md5(
    rc.projection::text
    || '|'
    || rc.timeline::text
    || '|'
    || coalesce(
         (
           select string_agg(ap.name, chr(31) order by ap.ordinal)
           from public.affected_products ap
           where ap.recall_case_id = rc.id
         ),
         ''
       )
    -- Null evidence appends nothing: the token stays the C8 token.
    || case
         when rc.fda_ongoing_as_of is null then ''
         else '|' || rc.fda_ongoing_as_of::text
       end
  ) as version
from public.recall_cases rc
where rc.state = 'active'
  and rc.merged_into is null;

comment on view public.consumer_feed_manifest is
  'Per-case sync token for the mobile feed cache (C8): id + md5 over the '
  'client-visible representation (projection, timeline, ordered product '
  'names, and FDA open evidence when present). security_invoker — anon '
  'reads through recall_cases RLS.';

grant select on public.consumer_feed_manifest to anon, authenticated, service_role;
