-- C7.1: installation data deletion (additive only — one RPC, no table change).
--
-- The app is accountless. An installation's server rows are keyed by the
-- opaque random installation id the client generated and stores in its
-- keychain; possession of that id is the bearer capability that authorizes
-- writes to those rows (the same model as register_push_subscription /
-- disable_push_subscription / set_installation_preferences). This RPC extends
-- that model with self-service deletion:
--
--   delete_installation_data(p_installation_id) removes every first-party row
--   whose purpose is specific to that installation —
--     1. notification_deliveries for its subscriptions (FK order),
--     2. its push_subscriptions rows (token, platform, timestamps),
--     3. its installation_preferences row (state, allergens, retailers)
--   — in ONE transaction (a plpgsql function body is atomic: any failure
--   rolls the whole deletion back; partial deletion is impossible).
--
-- Deliberately NOT touched: recall_cases, source_records, source_snapshots,
-- affected_products, product_visuals, notification_events (the shared
-- append-only ledger has no per-installation fields), ingest_runs, job
-- leases, push_delivery_config, and every watchdog table. A subscription row
-- left behind by a PREVIOUS install of the same device (a different
-- installation id, disabled 'token_reassigned') belongs to a different — now
-- credential-less — installation and is NOT reachable through this RPC; its
-- cleanup is the founder's retention decision (docs/recall-launch-blockers.md).
--
-- Safety properties:
-- - Idempotent: deleting an already-deleted (or never-seen) installation
--   deletes zero rows and succeeds identically. The function returns void and
--   never reports row counts, so a caller cannot learn whether an
--   installation exists — no enumeration oracle.
-- - No listing: only rows keyed by the presented id are reachable. Guessing
--   another installation's id means guessing a random UUID.
-- - Re-registration after deletion is backfill-safe by construction: a later
--   register_push_subscription takes the fresh-insert path (the old row is
--   gone), producing a NEW subscription uuid with enabled_at = now(). The
--   delivery worker's eligibility seam requires
--   event.created_at >= max(activation, subscription.enabled_at,
--   preferences.updated_at), so every event created before the reset is
--   structurally undeliverable to the new registration — deleting the old
--   delivery rows cannot resurrect old sends (src/server/push/worker.ts,
--   classifySubscriptionsForEvent).
-- - Concurrency: the FOR UPDATE lock on the installation's subscription rows
--   blocks a concurrently running delivery worker from inserting a new
--   notification_deliveries row between our two deletes (the FK's KEY SHARE
--   lock conflicts with FOR UPDATE), so the FK cannot make the transaction
--   fail halfway through a tick. On zero rows it locks nothing and costs
--   nothing.

create or replace function public.delete_installation_data(
  p_installation_id text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Shape validation: this endpoint is reachable with the publishable key.
  -- Same closed shape the other installation RPCs enforce.
  if p_installation_id is null
     or p_installation_id !~ '^[A-Za-z0-9-]{16,64}$' then
    raise exception 'invalid installation id';
  end if;

  -- Serialize against a concurrent worker delivery insert (see header).
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

  delete from public.installation_preferences
   where installation_id = p_installation_id;
end;
$$;

revoke execute on function public.delete_installation_data(text) from public;
grant execute on function public.delete_installation_data(text)
  to anon, authenticated, service_role;
