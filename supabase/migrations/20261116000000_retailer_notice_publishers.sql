-- More retailer notice sources: ALDI (automated) and H-E-B (manual intake)
-- (docs/recall-retailer-notices.md, "Sources").
--
-- NOT APPLIED. Widens one CHECK constraint and nothing else: every existing
-- row is a 'costco' row and still satisfies it, no column, grant, policy or
-- function changes, and the private tables stay unreachable by client roles.
-- consumer_retailer_notices() is unchanged: it never filtered on publisher,
-- and an ALDI or H-E-B notice still needs a live reviewer approval to be
-- returned.

alter table public.retailer_notices
  drop constraint retailer_notices_publisher_check;

alter table public.retailer_notices
  add constraint retailer_notices_publisher_check
  check (publisher in ('costco', 'aldi', 'heb'));
