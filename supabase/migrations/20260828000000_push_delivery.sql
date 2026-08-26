-- Phase C2: push delivery substrate (additive only).
--
-- Turns deliverable NotificationEvents into per-device push deliveries. The
-- ledger itself stays authoritative and untouched: nothing here alters
-- notification_events, recall_cases, ingest_runs, or the C1 lease tables.
--
-- Four concerns:
--
-- 1. push_delivery_config — one durable row holding the explicit activation
--    horizon (push_enabled_at). Delivery considers only events created on or
--    after it, so the pre-C2 deliverable backlog can never be broadcast. The
--    founder sets it intentionally (npm run push:activate); it is never
--    inferred from deploy time or migration time.
--
-- 2. push_subscriptions — one row per app installation. The client identifies
--    itself by an opaque random installation id it generated and stores
--    locally; that id acts as the bearer capability for its own row. Each
--    subscription carries its own enabled_at horizon: a device that enables
--    alerts on Sept 5 never receives events created Sept 1.
--
-- 3. notification_deliveries — per (event, subscription) delivery state. The
--    unique pair is the idempotency guarantee: a worker rerun or scheduler
--    retry cannot enqueue the same event twice for the same device. Status
--    models Expo semantics honestly: a ticket is Expo accepting the request,
--    only a receipt is Expo handing off to APNs/FCM ("receipt_ok" — even that
--    is not proof the phone displayed it).
--
-- 4. register_push_subscription / disable_push_subscription — the ONLY client
--    write path (SECURITY DEFINER RPCs granted to anon). The tables themselves
--    have RLS with no policies and no anon grants: a client can register or
--    disable its own opaque subscription but can never list tokens, read other
--    rows, or touch events/deliveries.

-- ── 1. Activation horizon ────────────────────────────────────────────────────

create table public.push_delivery_config (
  -- Boolean primary key with a CHECK forces at most one row.
  id boolean primary key default true check (id),
  push_enabled_at timestamptz,
  activated_by text,
  updated_at timestamptz not null default now()
);

alter table public.push_delivery_config enable row level security;
grant select, insert, update on public.push_delivery_config to service_role;

-- ── 2. Push subscriptions ────────────────────────────────────────────────────

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  -- Client-generated opaque random id, persisted on the device. Unique makes
  -- re-registration an idempotent upsert instead of a duplicate row.
  installation_id text not null unique,
  expo_push_token text not null,
  platform text not null check (platform in ('ios', 'android')),
  app_version text,
  enabled boolean not null default true,
  -- Per-subscription horizon: set when alerts were (re-)enabled, NOT advanced
  -- by idempotent re-registration, so a pending delivery is never orphaned.
  enabled_at timestamptz not null default now(),
  registered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  -- 'device_not_registered' (Expo said stop), 'user_disabled', 'token_reassigned'.
  disabled_reason text,
  last_token_error text
);

create index push_subscriptions_enabled_idx on public.push_subscriptions (enabled);
create index push_subscriptions_token_idx on public.push_subscriptions (expo_push_token);

alter table public.push_subscriptions enable row level security;
-- No policies, no anon grants: reachable only via the RPCs below and the
-- service-role worker.
grant select, insert, update on public.push_subscriptions to service_role;

-- ── 3. Notification deliveries ───────────────────────────────────────────────

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.notification_events (id),
  subscription_id uuid not null references public.push_subscriptions (id),
  -- Lifecycle: pending → sending → ticket_accepted → receipt_ok, with
  -- retryable_failure/permanent_failure exits at each Expo interaction.
  status text not null default 'pending' check (
    status in (
      'pending',
      'sending',
      'ticket_accepted',
      'receipt_ok',
      'retryable_failure',
      'permanent_failure'
    )
  ),
  attempts integer not null default 0,
  ticket_id text,
  -- Expo error code (DeviceNotRegistered, MessageRateExceeded, …) when failed.
  failure_code text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  receipt_checked_at timestamptz,
  -- THE delivery idempotency guarantee.
  unique (event_id, subscription_id)
);

create index notification_deliveries_status_idx
  on public.notification_deliveries (status, updated_at);
create index notification_deliveries_subscription_idx
  on public.notification_deliveries (subscription_id);

alter table public.notification_deliveries enable row level security;
grant select, insert, update on public.notification_deliveries to service_role;

-- ── 4. Client registration RPCs ──────────────────────────────────────────────

-- Register or refresh this installation's subscription. Idempotent:
--   new installation        → enabled row, horizon = now()
--   already enabled         → token/platform/last_seen refresh; horizon KEPT
--   previously disabled     → re-enabled, horizon = now() (no catch-up sends)
-- Any other enabled row holding the same token belongs to a stale install of
-- the same device (app reinstall) and is disabled so one phone is never sent
-- the same event twice.
create or replace function public.register_push_subscription(
  p_installation_id text,
  p_expo_push_token text,
  p_platform text,
  p_app_version text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Shape validation: this endpoint is reachable with the publishable key.
  if p_installation_id is null
     or p_installation_id !~ '^[A-Za-z0-9-]{16,64}$' then
    raise exception 'invalid installation id';
  end if;
  if p_expo_push_token is null
     or p_expo_push_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,128}\]$' then
    raise exception 'invalid Expo push token';
  end if;
  if p_platform not in ('ios', 'android') then
    raise exception 'invalid platform';
  end if;
  if p_app_version is not null and length(p_app_version) > 40 then
    raise exception 'invalid app version';
  end if;

  update public.push_subscriptions
     set enabled = false,
         disabled_at = now(),
         disabled_reason = 'token_reassigned'
   where expo_push_token = p_expo_push_token
     and installation_id <> p_installation_id
     and enabled;

  insert into public.push_subscriptions
    (installation_id, expo_push_token, platform, app_version)
  values
    (p_installation_id, p_expo_push_token, p_platform, p_app_version)
  on conflict (installation_id) do update
    set expo_push_token = excluded.expo_push_token,
        platform = excluded.platform,
        app_version = excluded.app_version,
        last_seen_at = now(),
        -- Re-enabling moves the horizon; staying enabled keeps it.
        enabled_at = case
          when public.push_subscriptions.enabled then public.push_subscriptions.enabled_at
          else now()
        end,
        enabled = true,
        disabled_at = null,
        disabled_reason = null,
        last_token_error = null;
end;
$$;

-- The user turned alerts off. Only the holder of the installation id can do
-- this, and only for its own row.
create or replace function public.disable_push_subscription(
  p_installation_id text
) returns void
language sql
security definer
set search_path = public
as $$
  update public.push_subscriptions
     set enabled = false,
         disabled_at = now(),
         disabled_reason = 'user_disabled'
   where installation_id = p_installation_id
     and enabled;
$$;

revoke execute on function public.register_push_subscription(text, text, text, text) from public;
revoke execute on function public.disable_push_subscription(text) from public;
grant execute on function public.register_push_subscription(text, text, text, text)
  to anon, authenticated, service_role;
grant execute on function public.disable_push_subscription(text)
  to anon, authenticated, service_role;
