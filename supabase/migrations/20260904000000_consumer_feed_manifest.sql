-- Consumer feed sync manifest (Phase C8).
--
-- One lightweight row per consumer-visible active case: the case id plus an
-- opaque version token derived from the EXACT client-visible representation.
-- The mobile app diffs this manifest against its persistent cache and
-- re-downloads only the cases whose token moved, instead of re-downloading
-- all ~900 full feed rows on every refresh (~1.7 MB decompressed per load).
--
-- Why a read-time hash and not a writer-maintained version column:
--
--   Maintenance repairs (retailer enrichment, geography repair, image
--   backfill) DELIBERATELY preserve last_changed_at so they cannot fire
--   material-change notifications — which means no stored timestamp can be
--   trusted to move on every client-visible change. A version column would
--   need every present and future writer to bump it reliably; one missed
--   writer silently strands stale rows in every client cache. Hashing the
--   row content at read time has no writer discipline to get wrong: ANY
--   change to the served representation — re-projection, retailer or
--   geography repair, hero-image backfill, timeline growth, product-line
--   replacement, state transitions — changes the token by construction.
--
-- What the token covers, and why it is sufficient:
--
--   The client feed SELECT (src/lib/recall-feed.ts FEED_SELECT) reads only
--   (a) projection fields (including the generated columns, which are STORED
--   projections of the same jsonb), (b) the timeline column, and (c) the
--   embedded affected_products names in ordinal order. The token hashes
--   exactly those three inputs, so it moves if and only if something the
--   client could observe changed (jsonb text output is canonical for equal
--   values, so byte-stable). It deliberately over-approximates in one
--   direction only: a projection change the feed row does not display still
--   moves the token and costs one redundant row re-download — never the
--   reverse (a client-visible change can never leave the token unmoved).
--
-- Security:
--
--   security_invoker: the view runs with the CALLER's privileges, so the
--   anon role reads recall_cases through its existing RLS policy
--   ("merged_into is null") and table grants — the view adds no privilege.
--   The WHERE clause restates the consumer read contract (state = 'active'
--   AND merged_into IS NULL) as defense in depth: even under a role that
--   bypasses RLS, the view exposes no closed, retracted, or merged case ids,
--   and the md5 token reveals nothing about hidden rows because hidden rows
--   produce no manifest row at all. No SECURITY DEFINER, no new policies,
--   no writes, no new table surface.

create view public.consumer_feed_manifest
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
  ) as version
from public.recall_cases rc
where rc.state = 'active'
  and rc.merged_into is null;

comment on view public.consumer_feed_manifest is
  'Per-case sync token for the mobile feed cache (C8): id + md5 over the '
  'client-visible representation (projection, timeline, ordered product '
  'names). security_invoker — anon reads through recall_cases RLS.';

-- Read-only surface for the same roles that can already read the feed.
grant select on public.consumer_feed_manifest to anon, authenticated, service_role;
