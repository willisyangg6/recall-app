-- Restore shopper-report deletion to "Reset app and delete my data"
-- (2026-10-10). Re-body only: no table, column, row, policy or grant changes.
--
-- What went wrong. delete_installation_data has been redefined three times:
--
--   20260902000000_installation_deletion    deliveries, subscriptions, preferences
--   20260910000000_shopper_reports          + shopper_reports
--   20261004000000_push_subscription_sequence
--                                           + push_installation_sequences,
--                                             but re-bodied from the 20260902
--                                             text, so shopper_reports was lost
--
-- Each `create or replace` replaces the whole body, and each migration's tests
-- read only their own file, so nothing compared the effective (latest)
-- definition against the tables keyed by installation id. The in-app Privacy
-- & Data Controls document promised that the reset deletes shopper reports;
-- since the 2026-10-04 apply it has not. While the shopper-report gate stays
-- off (shopper_report_config.reports_enabled = false), submission is refused
-- server-side, so no new rows can be created through the app.
--
-- The body below is the 20261004 body plus the one statement 20260910 added.
-- Every earlier property is preserved:
--   - the closed id shape and the 'invalid installation id' refusal;
--   - the FOR UPDATE lock on the installation's subscriptions, which blocks
--     a concurrent delivery-worker insert between the two deletes
--     (20260902 header);
--   - FK order: deliveries before their subscriptions;
--   - the sequence row is deleted, so the fresh installation id a reset
--     creates starts its own count at 1 (20261004 header);
--   - one transaction, idempotent, void return — no enumeration oracle.
--
-- src/server/push/installation-deletion-effective.test.ts now pins the
-- EFFECTIVE definition (the last migration to define it) against every table
-- with an installation_id column, so a future re-body cannot drop one again.

create or replace function public.delete_installation_data(
  p_installation_id text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_installation_id is null
     or p_installation_id !~ '^[A-Za-z0-9-]{16,64}$' then
    raise exception 'invalid installation id';
  end if;

  -- Serialize against a concurrent worker delivery insert (see the
  -- installation_deletion migration's header).
  perform 1 from public.push_subscriptions
    where installation_id = p_installation_id
    for update;

  delete from public.notification_deliveries
   where subscription_id in (
     select id from public.push_subscriptions
      where installation_id = p_installation_id
   );

  delete from public.push_subscriptions
   where installation_id = p_installation_id;

  delete from public.push_installation_sequences
   where installation_id = p_installation_id;

  delete from public.installation_preferences
   where installation_id = p_installation_id;

  delete from public.shopper_reports
   where installation_id = p_installation_id;
end;
$$;

-- `create or replace` keeps the existing ACL; restated so this file alone
-- shows the function's exposure.
revoke execute on function public.delete_installation_data(text) from public;
grant execute on function public.delete_installation_data(text)
  to anon, authenticated, service_role;
