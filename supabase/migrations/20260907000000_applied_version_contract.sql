-- O3-B1: the applied-version contract (additive only; NOT yet applied).
--
-- O3-A proved a silent-drop defect: the per-record unchanged gate compared the
-- incoming content hash against the newest ARCHIVED snapshot, while the
-- snapshot was inserted BEFORE the normalized write, case re-projection,
-- product replacement, and notification events. A crash between those writes
-- left every later run treating the version as processed — permanently stale
-- consumer data with a green run. This migration installs the durable
-- distinction the gate was missing ("archived" vs "APPLIED") plus the three
-- narrow transactions that make every remaining window pending-and-retryable
-- (design C+3, .reports/o3-b0-design-closure.json).
--
-- Legacy initialization is deliberately ABSENT: existing rows keep NULL
-- apply_state ("legacy_unverified") because a snapshot's existence is not
-- proof it was applied — exactly the defect under repair. Verified seeding
-- happens only through the separately authorized O3-B2 reconciliation, or
-- naturally when a record's next real upstream change flows through the new
-- apply path. Nothing here reads or rewrites existing rows.
--
-- Security model unchanged: all three functions are SECURITY INVOKER (the
-- repo's lease/watchdog pattern), execute revoked from public/anon/
-- authenticated and granted to service_role only; every referenced object is
-- schema-qualified. The health view is service-role only. No RLS policy is
-- added, changed, or weakened, and no client-visible surface changes.

-- ── 1. Applied-version marker columns ────────────────────────────────────────
--
-- Nullable, NO defaults: an ADD COLUMN default would stamp every legacy row,
-- and no stored value may claim an existing record was applied. New code
-- writes 'pending' on insert and 'applied'/'applied_degraded' only through
-- the transactions below. 'superseded' is derived (seq < latest), never
-- stored.

alter table public.source_records
  add column apply_state text,
  add column applied_content_hash text,
  add column applied_snapshot_seq bigint,
  add column applied_at timestamptz;

alter table public.source_records
  add constraint source_records_apply_state_check
  check (apply_state in ('pending', 'applied', 'applied_degraded'));

-- Health and the reconciliation sweep enumerate actionable states only; the
-- partial index keeps that scan from ever touching the applied majority.
create index source_records_apply_state_idx
  on public.source_records (apply_state)
  where apply_state in ('pending', 'applied_degraded');

-- ── 2. Health view: archived vs applied, per record ──────────────────────────
--
-- The substrate for the O3-B2 health counters and the reconciliation sweep's
-- cheap pass (this milestone ships the view; wiring ops:health is O3-B2).
-- security_invoker so the view never escalates privileges; only the service
-- role can select it, and the service role bypasses RLS anyway.

create view public.source_record_apply_health
  with (security_invoker = true) as
select
  sr.id,
  sr.source_system,
  sr.native_id,
  sr.recall_case_id,
  sr.apply_state,
  sr.applied_content_hash,
  sr.applied_snapshot_seq,
  sr.applied_at,
  latest.seq as latest_snapshot_seq,
  latest.content_hash as latest_content_hash,
  latest.fetched_at as latest_fetched_at
from public.source_records sr
left join lateral (
  select s.seq, s.content_hash, s.fetched_at
  from public.source_snapshots s
  where s.source_record_id = sr.id
  order by s.seq desc
  limit 1
) latest on true;

grant select on public.source_record_apply_health to service_role;

-- ── 3. archive_snapshot: atomic archive-and-pending, stale-fetch safe ────────
--
-- Serializes per record (FOR UPDATE), rejects a delayed older fetch BEFORE
-- any write (fetched_at monotonicity; the app captures fetched_at when the
-- request STARTS, so a slow response cannot launder old content under a new
-- timestamp), refuses to duplicate the already-archived current version
-- unless the caller is honestly re-archiving a richer payload of the same
-- content (FDA degraded-detail completion), and marks the record pending in
-- the same transaction — "archived" and "awaiting apply" become one fact.

create or replace function public.archive_snapshot(
  p_source_record_id uuid,
  p_fetched_at timestamptz,
  p_content_hash text,
  p_raw_payload jsonb,
  p_source_url text,
  p_allow_same_hash boolean default false
) returns jsonb
language plpgsql
as $$
declare
  v_latest record;
  v_id uuid;
  v_seq bigint;
begin
  if p_source_record_id is null or p_fetched_at is null
     or coalesce(p_content_hash, '') = '' or p_raw_payload is null then
    raise exception 'archive_snapshot: invalid input';
  end if;

  perform 1 from public.source_records where id = p_source_record_id for update;
  if not found then
    return jsonb_build_object('status', 'missing_record');
  end if;

  select s.id, s.seq, s.content_hash, s.fetched_at into v_latest
  from public.source_snapshots s
  where s.source_record_id = p_source_record_id
  order by s.seq desc
  limit 1;

  if v_latest.id is not null and p_fetched_at < v_latest.fetched_at then
    return jsonb_build_object('status', 'stale');
  end if;

  if v_latest.id is not null and v_latest.content_hash = p_content_hash
     and not p_allow_same_hash then
    return jsonb_build_object(
      'status', 'duplicate', 'snapshot_id', v_latest.id, 'snapshot_seq', v_latest.seq
    );
  end if;

  insert into public.source_snapshots
    (source_record_id, fetched_at, content_hash, raw_payload, source_url)
  values
    (p_source_record_id, p_fetched_at, p_content_hash, p_raw_payload, p_source_url)
  returning id, seq into v_id, v_seq;

  -- Pending in the same transaction; the seq guard cannot fail here (v_seq is
  -- the new maximum) but states the monotonic invariant the marker lives by.
  update public.source_records
     set apply_state = 'pending'
   where id = p_source_record_id
     and (applied_snapshot_seq is null or applied_snapshot_seq < v_seq);

  return jsonb_build_object('status', 'archived', 'snapshot_id', v_id, 'snapshot_seq', v_seq);
end;
$$;

-- ── 4. apply_case_transition: the atomic consumer transition ─────────────────
--
-- One transaction: case CAS (projection + timeline + last_changed_at) →
-- affected-product replacement → notification events (existing dedup keys;
-- a key collision is idempotent success, not failure) → applied markers for
-- every source version this transition carries. A CAS miss returns
-- 'conflict' before any write; any later failure raises and rolls the whole
-- transaction back — a consumer can never observe a case without its
-- products, or a ledger event describing a case version that was never
-- stored. Notification POLICY stays in the application: this function
-- persists precomputed events verbatim and never invents or filters one.

create or replace function public.apply_case_transition(
  p_case_id uuid,
  p_expected_last_changed_at timestamptz,
  p_projection jsonb,
  p_timeline jsonb,
  p_last_changed_at timestamptz,
  p_products jsonb,
  p_events jsonb,
  p_markers jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_inserted text[] := '{}';
  v_key text;
  v_item jsonb;
  v_ordinal integer := 0;
begin
  if p_case_id is null or p_projection is null or p_timeline is null
     or p_last_changed_at is null
     or jsonb_typeof(coalesce(p_products, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_events, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_markers, '[]'::jsonb)) <> 'array' then
    raise exception 'apply_case_transition: invalid input';
  end if;

  update public.recall_cases
     set projection = p_projection,
         timeline = p_timeline,
         last_changed_at = p_last_changed_at
   where id = p_case_id
     and last_changed_at = p_expected_last_changed_at;
  if not found then
    return jsonb_build_object('status', 'conflict');
  end if;

  delete from public.affected_products where recall_case_id = p_case_id;
  for v_item in select * from jsonb_array_elements(coalesce(p_products, '[]'::jsonb)) loop
    insert into public.affected_products
      (recall_case_id, ordinal, source_native_id, name, raw_text, extraction_confidence)
    values
      (p_case_id, v_ordinal, v_item->>'sourceNativeId', v_item->>'name',
       v_item->>'rawText', v_item->>'extractionConfidence');
    v_ordinal := v_ordinal + 1;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) loop
    v_key := null;
    insert into public.notification_events
      (recall_case_id, kind, trigger_rule_id, dedup_key, material_change_ref,
       payload_summary, suppressed, source_snapshot_ids, created_at)
    values
      (p_case_id, v_item->>'kind', v_item->>'triggerRuleId', v_item->>'dedupKey',
       v_item->>'materialChangeRef', v_item->>'payloadSummary', v_item->>'suppressed',
       coalesce(
         (select array_agg(x.value::uuid)
          from jsonb_array_elements_text(coalesce(v_item->'sourceSnapshotIds', '[]'::jsonb)) x),
         '{}'::uuid[]
       ),
       (v_item->>'createdAt')::timestamptz)
    on conflict (dedup_key) do nothing
    returning dedup_key into v_key;
    if v_key is not null then
      v_inserted := array_append(v_inserted, v_key);
    end if;
  end loop;

  -- Markers: sequence-monotonic, and confined to records of THIS case — a
  -- marker can never complete work on a record the transition did not cover,
  -- and an older worker can never mark over a newer applied version.
  for v_item in select * from jsonb_array_elements(coalesce(p_markers, '[]'::jsonb)) loop
    update public.source_records
       set apply_state = v_item->>'state',
           applied_content_hash = v_item->>'contentHash',
           applied_snapshot_seq = (v_item->>'snapshotSeq')::bigint,
           applied_at = (v_item->>'appliedAt')::timestamptz
     where id = (v_item->>'sourceRecordId')::uuid
       and recall_case_id = p_case_id
       and (applied_snapshot_seq is null
            or applied_snapshot_seq <= (v_item->>'snapshotSeq')::bigint);
  end loop;

  return jsonb_build_object(
    'status', 'applied', 'inserted_dedup_keys', to_jsonb(v_inserted)
  );
end;
$$;

-- ── 5. found_recall_case: atomic founding ────────────────────────────────────
--
-- The N1 fix: the founding case, its source record, initial snapshot,
-- product rows, initial notification event, and applied marker commit as one
-- transaction — a crash leaves nothing, never an orphan case. Identity is
-- the EXISTING unique(source_system, native_id), evaluated inside the
-- transaction: a concurrent founder's collision rolls the whole block back
-- (subtransaction) and reports 'record_exists' so the caller re-enters the
-- existing-record path against the winner. The initial event's dedup_key is
-- built here from the generated case id ('initial:' || id), keeping the
-- exactly-one-initial invariant server-anchored.

create or replace function public.found_recall_case(
  p_case jsonb,
  p_record jsonb,
  p_snapshot jsonb,
  p_products jsonb,
  p_initial_event jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_case_id uuid;
  v_record_id uuid;
  v_seq bigint;
  v_key text;
  v_initial_inserted boolean := false;
  v_item jsonb;
  v_ordinal integer := 0;
begin
  if p_case is null or p_record is null or p_snapshot is null
     or jsonb_typeof(coalesce(p_products, '[]'::jsonb)) <> 'array'
     or coalesce(p_record->>'sourceSystem', '') = ''
     or coalesce(p_record->>'nativeId', '') = ''
     or coalesce(p_snapshot->>'id', '') = '' then
    raise exception 'found_recall_case: invalid input';
  end if;

  -- Fast path: the identity already exists (a prior founding, or another
  -- worker) — nothing to write.
  if exists (
    select 1 from public.source_records
    where source_system = p_record->>'sourceSystem'
      and native_id = p_record->>'nativeId'
  ) then
    return jsonb_build_object('status', 'record_exists');
  end if;

  begin
    insert into public.recall_cases (projection, timeline, created_at, last_changed_at)
    values
      (p_case->'projection', p_case->'timeline',
       (p_case->>'createdAt')::timestamptz, (p_case->>'lastChangedAt')::timestamptz)
    returning id into v_case_id;

    insert into public.source_records
      (source_system, native_id, recall_case_id, link_method, normalized, source_url,
       first_seen_at, last_seen_at, apply_state, applied_content_hash, applied_at)
    values
      (p_record->>'sourceSystem', p_record->>'nativeId', v_case_id,
       p_record->>'linkMethod', p_record->'normalized', p_record->>'sourceUrl',
       (p_record->>'firstSeenAt')::timestamptz, (p_record->>'lastSeenAt')::timestamptz,
       p_record->>'applyState', p_record->>'appliedContentHash',
       (p_record->>'appliedAt')::timestamptz)
    returning id into v_record_id;

    -- The app pre-generates the snapshot id so the case timeline's
    -- causedBySnapshotIds can reference it inside this same transaction.
    insert into public.source_snapshots
      (id, source_record_id, fetched_at, content_hash, raw_payload, source_url)
    values
      ((p_snapshot->>'id')::uuid, v_record_id,
       (p_snapshot->>'fetchedAt')::timestamptz, p_snapshot->>'contentHash',
       p_snapshot->'rawPayload', p_snapshot->>'sourceUrl')
    returning seq into v_seq;

    update public.source_records set applied_snapshot_seq = v_seq where id = v_record_id;

    for v_item in select * from jsonb_array_elements(coalesce(p_products, '[]'::jsonb)) loop
      insert into public.affected_products
        (recall_case_id, ordinal, source_native_id, name, raw_text, extraction_confidence)
      values
        (v_case_id, v_ordinal, v_item->>'sourceNativeId', v_item->>'name',
         v_item->>'rawText', v_item->>'extractionConfidence');
      v_ordinal := v_ordinal + 1;
    end loop;

    if p_initial_event is not null then
      insert into public.notification_events
        (recall_case_id, kind, trigger_rule_id, dedup_key, material_change_ref,
         payload_summary, suppressed, source_snapshot_ids, created_at)
      values
        (v_case_id, 'initial', p_initial_event->>'triggerRuleId',
         'initial:' || v_case_id, null, p_initial_event->>'payloadSummary',
         p_initial_event->>'suppressed',
         array[(p_snapshot->>'id')::uuid], (p_initial_event->>'createdAt')::timestamptz)
      on conflict (dedup_key) do nothing
      returning dedup_key into v_key;
      v_initial_inserted := v_key is not null;
    end if;
  exception
    when unique_violation then
      -- A concurrent founder won the identity between our fast-path check
      -- and the insert: the subtransaction rolls back every write above
      -- (case included — no orphan), and the caller re-enters the
      -- existing-record path.
      return jsonb_build_object('status', 'record_exists');
  end;

  return jsonb_build_object(
    'status', 'founded',
    'case_id', v_case_id,
    'record_id', v_record_id,
    'snapshot_seq', v_seq,
    'initial_inserted', v_initial_inserted
  );
end;
$$;

-- ── 6. Privileges: server-only, the lease/watchdog hardening pattern ─────────

revoke execute on function public.archive_snapshot(uuid, timestamptz, text, jsonb, text, boolean)
  from public, anon, authenticated;
revoke execute on function public.apply_case_transition(uuid, timestamptz, jsonb, jsonb, timestamptz, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
revoke execute on function public.found_recall_case(jsonb, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;

grant execute on function public.archive_snapshot(uuid, timestamptz, text, jsonb, text, boolean)
  to service_role;
grant execute on function public.apply_case_transition(uuid, timestamptz, jsonb, jsonb, timestamptz, jsonb, jsonb, jsonb)
  to service_role;
grant execute on function public.found_recall_case(jsonb, jsonb, jsonb, jsonb, jsonb)
  to service_role;
